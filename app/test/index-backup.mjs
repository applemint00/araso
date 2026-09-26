// [Gate B prototype — LOCAL ONLY] index-backup.js 단위 테스트. 네트워크 0 · 실제 Face ID 0.
//   node app/test/index-backup.mjs
//
// model-a-add-piggy.mjs 와 같은 방식: 결정적 가짜 WebAuthn 을 실제 Mera 코드
// (getPasskeyPrfOutput → secp256k1 세션 → 주소)에 붙인다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { bytesToHex, modelASalt } from "../src/piggy-session.js";
import { admitSequencedPiggy, loadMyPiggiesIndex, registerControlledPiggy } from "../src/piggy-index.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import {
  INDEX_BACKUP_NAMESPACE_SOURCE,
  buildBackupPayload,
  createMemoryBackupAdapter,
  indexBackupSalt,
  openBackup,
  restoreCandidates,
  restoreFromBackup,
  sealBackup,
} from "../src/index-backup.js";

const CHAIN = "monad-testnet";
const AT = "2026-09-22T12:00:00.000Z";
const RP = "araso-harness.local.test";
const ROOT_ID_BYTES = new Uint8Array(Buffer.from("honeybun-root"));
const ROOT_ID = Buffer.from(ROOT_ID_BYTES).toString("base64url");
const ROOT = { credentialId: ROOT_ID };

// ── 결정적 가짜 WebAuthn: 한 credential, PRF = HMAC(secret, salt) — 이 실행에서만 산다 ──
const secret = crypto.randomBytes(32);
function fakeClient({ credentialBytes = ROOT_ID_BYTES, secretOverride = secret } = {}) {
  return {
    async createCredential() { throw new Error("createCredential must never be called for Gate B restore"); },
    async getCredential(req) {
      return { credentialId: credentialBytes, prfOutput: new Uint8Array(crypto.createHmac("sha256", secretOverride).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
}
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);
const requestPrfWith = (client) => (credential, prfSalt) => getPasskeyPrfOutput({ rpId: RP, credential, prfSalt, webAuthnClient: client });
const liveRequestPrf = requestPrfWith(fakeClient());

// 첫 Piggy(레거시, 순번 없음) 를 색인에 둔다.
async function seedFirstPiggy(storage) {
  const prf = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, CHAIN, { id: `legacy-${address.toLowerCase()}`, name: "Honeybun", address, signerAddress: address, locator: { credentialId: ROOT_ID }, at: AT });
  assert.equal(out.ok, true);
  return address;
}

// 모델 A 순번 n 을 (admitModelAPiggy 를 거치지 않고) 직접 입장시킨다 — 백업 대상 만들기용.
async function seedSequence(storage, n) {
  // [A-579 Lane B] 순번 행은 admitSequencedPiggy(유일한 입장 경로 — salt 를 스스로 modelASalt(n) 로 계산) 로만 들어간다.
  const out = await admitSequencedPiggy({ storage, chainId: CHAIN, sequence: n, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, now: () => AT });
  assert.equal(out.ok, true);
  return out.piggy.address;
}

async function indexPrfOutput() {
  const salt = await indexBackupSalt();
  return (await liveRequestPrf(ROOT, salt)).prfOutput;
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 왕복 ────────────────────────────────────────────────────────────────────
await check("1. round trip: build → seal → open returns the same payload", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  await seedSequence(s, 1);
  await seedSequence(s, 2);
  const payload = buildBackupPayload(loadMyPiggiesIndex(s, CHAIN).index);
  assert.equal(payload.issuedThrough, 2);
  assert.deepEqual(payload.entries, [{ sequence: 1, createdAt: AT }, { sequence: 2, createdAt: AT }]);

  const prf = await indexPrfOutput();
  const envelope = await sealBackup(payload, prf);
  assert.equal(envelope.version, 1);
  assert.ok(typeof envelope.nonce === "string" && typeof envelope.ciphertext === "string");

  const opened = await openBackup(envelope, prf);
  assert.equal(opened.error, null);
  assert.deepEqual(opened.payload, payload);
});

// ── 2. 위조된 ciphertext ────────────────────────────────────────────────────────
await check("2. tampered ciphertext → decrypt_failed", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  await seedSequence(s, 1);
  const payload = buildBackupPayload(loadMyPiggiesIndex(s, CHAIN).index);
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(payload, prf);
  const flippedChar = envelope.ciphertext[0] === "A" ? "B" : "A";
  const tampered = { ...envelope, ciphertext: flippedChar + envelope.ciphertext.slice(1) };
  const opened = await openBackup(tampered, prf);
  assert.equal(opened.error, "decrypt_failed");
  assert.equal(opened.payload, null);
});

// ── 3. 다른 PRF ────────────────────────────────────────────────────────────────
await check("3. wrong PRF (different root) → decrypt_failed, never returns the payload", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  await seedSequence(s, 1);
  const payload = buildBackupPayload(loadMyPiggiesIndex(s, CHAIN).index);
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(payload, prf);
  const wrongPrf = (await requestPrfWith(fakeClient({ secretOverride: crypto.randomBytes(32) }))(ROOT, await indexBackupSalt())).prfOutput;
  const opened = await openBackup(envelope, wrongPrf);
  assert.equal(opened.error, "decrypt_failed");
});

// ── 4. 버전 불일치 ──────────────────────────────────────────────────────────────
await check("4. bad envelope version → version, checked before decrypt is attempted", async () => {
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(buildBackupPayload({ chainId: CHAIN, issuedThrough: 0, piggies: [] }), prf);
  const bad = { ...envelope, version: 2 };
  const opened = await openBackup(bad, prf);
  assert.equal(opened.error, "version");
});

// ── 5. 손상된 JSON ─────────────────────────────────────────────────────────────
await check("5. garbage input → corrupt (string that fails JSON.parse, or valid JSON that isn't an object)", async () => {
  const prf = await indexPrfOutput();
  assert.equal((await openBackup("not json {{{", prf)).error, "corrupt");
  assert.equal((await openBackup("42", prf)).error, "corrupt");
  assert.equal((await openBackup([1, 2, 3], prf)).error, "corrupt");
  assert.equal((await openBackup(null, prf)).error, "corrupt");
});

// ── 6. payload 최소성 ───────────────────────────────────────────────────────────
await check("6. payload carries only sequence/createdAt — never address, name, locator, or PRF-shaped keys", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  await seedSequence(s, 1);
  await seedSequence(s, 2);
  const index = loadMyPiggiesIndex(s, CHAIN).index;
  assert.ok(index.piggies.some((p) => p.address && p.locator));   // 색인 자체는 주소·locator 를 갖고 있음을 재확인
  const payload = buildBackupPayload(index);
  assert.deepEqual(Object.keys(payload).sort(), ["chainId", "entries", "issuedThrough", "version"]);
  for (const entry of payload.entries) assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "sequence"]);
  const flat = JSON.stringify(payload).toLowerCase();
  for (const bad of ["address", "locator", "credentialid", "prf", "0x"]) assert.equal(flat.includes(bad), false, bad);
});

// ── 7. 후보 계산 ────────────────────────────────────────────────────────────────
await check("7. restoreCandidates: sorted, deduped, excludes what's already local, excludes what's unlisted, bounded to 64", () => {
  const payload = { version: 1, chainId: CHAIN, issuedThrough: 5, entries: [{ sequence: 5 }, { sequence: 1 }, { sequence: 1 }, { sequence: 100 }] };
  assert.deepEqual(restoreCandidates(payload, { localIssuedThrough: 0 }), [1, 5]);        // 중복 제거·정렬·issuedThrough=5 초과인 100 제외
  assert.deepEqual(restoreCandidates(payload, { localIssuedThrough: 1 }), [5]);            // 이미 로컬에 있는 1 제외

  const wide = { version: 1, chainId: CHAIN, issuedThrough: 999, entries: Array.from({ length: 80 }, (_, i) => ({ sequence: i + 1 })) };
  const bounded = restoreCandidates(wide, { localIssuedThrough: 0 });
  assert.equal(bounded.length, 64);
  assert.deepEqual(bounded, Array.from({ length: 64 }, (_, i) => i + 1));

  // n=3..10 은 issuedThrough(=10) 이하지만 entries 에 없다 — 목록에 없으면 후보가 아니다.
  const gapped = { version: 1, chainId: CHAIN, issuedThrough: 10, entries: [{ sequence: 1 }, { sequence: 2 }] };
  assert.deepEqual(restoreCandidates(gapped, { localIssuedThrough: 0 }), [1, 2]);
});

// ── 8·9. 새 기기 복원 흐름 ────────────────────────────────────────────────────────
async function seededRemote({ sequences = [1, 2] } = {}) {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  const addresses = {};
  for (const n of sequences) addresses[n] = await seedSequence(origin, n);
  const payload = buildBackupPayload(loadMyPiggiesIndex(origin, CHAIN).index);
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(payload, prf);
  const adapter = createMemoryBackupAdapter({ [CHAIN]: envelope });
  return { addresses, adapter };
}

await check("8. restore registers only after a live derive — restored addresses match a fresh per-sequence derivation, never a value the blob supplied", async () => {
  const { addresses, adapter } = await seededRemote({ sequences: [1, 2] });
  const fresh = createMemoryStorage();                                    // 새 기기 — 로컬 색인 비어 있음
  const derivedFrom = [];
  const out = await restoreFromBackup({
    adapter, key: CHAIN, storage: fresh, chainId: CHAIN,
    pinnedCredential: ROOT,
    requestPrf: liveRequestPrf,
    deriveAddress: (prf) => { const a = addressOf(prf); derivedFrom.push(a); return a; },
  });
  assert.equal(out.source, "remote");
  assert.deepEqual(out.restored.map((r) => r.sequence).sort(), [1, 2]);
  for (const r of out.restored) {
    assert.equal(r.address, addresses[r.sequence]);        // 라이브 파생 == 원본 기기에서 같은 salt 로 파생한 값
    assert.ok(derivedFrom.includes(r.address));             // deriveAddress 가 실제로 호출돼 나온 값
  }
  const registered = loadMyPiggiesIndex(fresh, CHAIN).index.piggies;
  assert.deepEqual(registered.map((p) => p.address).sort(), Object.values(addresses).sort());
});

await check("9. a $0 never-transacted Piggy — a sequence the blob lists with no balance/history data at all — is restored just the same", async () => {
  const { addresses, adapter } = await seededRemote({ sequences: [1] });   // 백업 payload 는 애초에 잔액 개념이 없다
  const fresh = createMemoryStorage();
  const out = await restoreFromBackup({ adapter, key: CHAIN, storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf });
  assert.deepEqual(out.restored, [{ sequence: 1, address: addresses[1] }]);
  assert.equal(loadMyPiggiesIndex(fresh, CHAIN).index.piggies[0].address, addresses[1]);
});

// ── 10. 목록에 없는 n ────────────────────────────────────────────────────────────
await check("10. an n absent from the blob's entries is never attempted or restored", async () => {
  // origin 에는 1,2,3 이 있지만 백업은 1,3 만 안다(2 는 blob 에서 빠졌다 — 예: 오래된 백업).
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  const a1 = await seedSequence(origin, 1);
  await seedSequence(origin, 2);
  const a3 = await seedSequence(origin, 3);
  const fullIndex = loadMyPiggiesIndex(origin, CHAIN).index;
  const stalePayload = { version: 1, chainId: CHAIN, issuedThrough: fullIndex.issuedThrough, entries: fullIndex.piggies.filter((p) => p.sequence && p.sequence !== 2).map((p) => ({ sequence: p.sequence, createdAt: p.createdAt })) };
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(stalePayload, prf);
  const adapter = createMemoryBackupAdapter({ [CHAIN]: envelope });

  const fresh = createMemoryStorage();
  const requested = [];
  const spiedRequestPrf = async (cred, salt) => { requested.push(bytesToHex(salt)); return liveRequestPrf(cred, salt); };
  const out = await restoreFromBackup({ adapter, key: CHAIN, storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: spiedRequestPrf, deriveAddress: addressOf });

  assert.equal(requested.includes(bytesToHex(await modelASalt(2))), false);   // n=2 는 한 번도 요청되지 않았다
  assert.deepEqual(out.restored.map((r) => r.sequence), [1]);                  // n=1 만 들어간다(2 결번이라 3 은 stale_sequence)
  assert.equal(out.restored.some((r) => r.address === a3), false);
  assert.equal(out.restored[0].address, a1);
  assert.ok(out.skipped.some((sk) => sk.sequence === 3));
});

// ── 11. 원격 없음 ───────────────────────────────────────────────────────────────
await check("11. missing/unreachable remote → { restored: [], source: 'local_only' }, no auth ever asked", async () => {
  const fresh = createMemoryStorage();
  let asked = 0;
  const neverAsk = async () => { asked += 1; return liveRequestPrf(ROOT, await modelASalt(1)); };

  const noAdapter = await restoreFromBackup({ storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: neverAsk, deriveAddress: addressOf });
  assert.deepEqual(noAdapter, { restored: [], source: "local_only" });

  const emptyAdapter = createMemoryBackupAdapter({});
  const noKey = await restoreFromBackup({ adapter: emptyAdapter, key: CHAIN, storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: neverAsk, deriveAddress: addressOf });
  assert.deepEqual(noKey, { restored: [], source: "local_only" });
  assert.equal(asked, 0);
});

// ── 12. 워터마크는 확인된 것만큼만 ─────────────────────────────────────────────────
await check("12. the local watermark rises only as far as confirmed admissions go — never by the blob's own (possibly stale) claim", async () => {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  await seedSequence(origin, 1);
  await seedSequence(origin, 2);
  // blob 이 issuedThrough=50 이라고(잘못) 주장해도, entries 는 실제로 있던 1·2 뿐이다.
  const inflatedPayload = { version: 1, chainId: CHAIN, issuedThrough: 50, entries: [{ sequence: 1, createdAt: AT }, { sequence: 2, createdAt: AT }] };
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(inflatedPayload, prf);
  const adapter = createMemoryBackupAdapter({ [CHAIN]: envelope });

  const fresh = createMemoryStorage();
  const out = await restoreFromBackup({ adapter, key: CHAIN, storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf });
  assert.deepEqual(out.restored.map((r) => r.sequence).sort(), [1, 2]);
  assert.equal(loadMyPiggiesIndex(fresh, CHAIN).index.issuedThrough, 2);   // 50 이 아니라 실제로 확인된 2
});

// ── 부록: salt 네임스페이스가 모델 A 순번 salt 와 겹치지 않는다 ───────────────────────
await check("13. indexBackupSalt is a fixed 32B value in its own namespace, distinct from every modelASalt(n)", async () => {
  assert.equal(INDEX_BACKUP_NAMESPACE_SOURCE, "araso.index.v1");
  const a = await indexBackupSalt();
  const b = await indexBackupSalt();
  assert.equal(a.length, 32);
  assert.deepEqual(a, b);                                      // 결정적 · 고정
  for (const n of [1, 2, 3]) assert.notDeepEqual(a, await modelASalt(n));
});

console.log(`\n${pass}/${pass} PASS`);
