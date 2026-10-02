// [A-554] Gate B — product recovery core proof. 네트워크 0 · 실제 Face ID 0 · 실제 원격 저장소 0.
//   node app/test/gate-b-product-recovery.mjs
//
// 결정적 가짜 WebAuthn + 실제 Mera SDK(model-a-add-piggy.mjs/index-backup.mjs 방식). 두 파트:
//   Part A — main.js checkPiggy 구간을 실제 소스 그대로 vm 에서 돌려 **배선**(adapter 있음/
//            없음에 따라 recoverProductList 가 정확히 언제만 불리는지, 루트 R1 은 항상 그대로인지)을 증명한다.
//   Part B — gate-b-recovery.js/index-backup.js 를 직접 호출해 복구/발행 코어 계약(체인
//            바인딩·gap·워터마크·멱등성·최소 payload·잠금 직렬화)을 증명한다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress, isMeraError } from "@category-labs/mera";
import { bytesToHex, modelASalt, prfSaltFromHex } from "../src/piggy-session.js";
import { admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, myPiggiesLockName, registerControlledPiggy, admitModelAPiggy } from "../src/piggy-index.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { buildBackupPayload, createMemoryBackupAdapter, indexBackupSalt, openBackup, publishIndexBackup, restoreFromBackup, sealBackup } from "../src/index-backup.js";
import { recoverProductList } from "../src/gate-b-recovery.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CHAIN = "monad-testnet";
const AT = "2026-09-22T12:00:00.000Z";
const RP = "araso-harness.local.test";
const ROOT_ID_BYTES = new Uint8Array(Buffer.from("honeybun-root"));
const ROOT_ID = Buffer.from(ROOT_ID_BYTES).toString("base64url");
const ROOT = { credentialId: ROOT_ID };

// ── 결정적 가짜 WebAuthn: 한 credential, PRF = HMAC(secret, salt) — 이 실행에서만 산다 ──
const secret = crypto.randomBytes(32);
function fakeClient({ credentialBytes = ROOT_ID_BYTES, secretOverride = secret, fail = false } = {}) {
  return {
    async createCredential() { throw new Error("createCredential must never be called for Gate B restore"); },
    async getCredential(req) {
      if (fail) throw new Error("NotAllowedError: user cancelled");
      return { credentialId: credentialBytes, prfOutput: new Uint8Array(crypto.createHmac("sha256", secretOverride).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
}
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);
const requestPrfWith = (client) => (credential, prfSalt) => getPasskeyPrfOutput({ rpId: RP, credential, prfSalt, webAuthnClient: client });
const liveRequestPrf = requestPrfWith(fakeClient());
// 기본 salt(순번 지정 없음)로 파생한 "첫 Piggy" 주소 — 실제 Mera 기본 경로 그대로 계산한다
// (하드코딩된 salt 상수에 기대지 않는다).
const ROOT_FIRST_ADDRESS = addressOf((await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput);

function fifoLocks() {
  const tails = new Map();
  return {
    names: [],
    request(name, _opts, fn) {
      this.names.push(name);
      const prev = tails.get(name) || Promise.resolve();
      const run = prev.then(() => fn());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

// 첫 Piggy(레거시, 순번 없음) — 기본 salt.
async function seedFirstPiggy(storage) {
  const prf = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, CHAIN, { id: `legacy-${address.toLowerCase()}`, name: "Honeybun", address, signerAddress: address, locator: { credentialId: ROOT_ID }, at: AT });
  assert.equal(out.ok, true);
  return address;
}

// 모델 A 순번 n 을 원본 기기에 직접 입장시킨다(백업 대상 만들기용).
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

// 원본 기기의 색인 → payload → 봉투 → 백업 키(myPiggiesIndexKey) 아래 메모리 adapter.
async function seededRemote({ sequences = [1, 2] } = {}) {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  const addresses = {};
  for (const n of sequences) addresses[n] = await seedSequence(origin, n);
  const payload = buildBackupPayload(loadMyPiggiesIndex(origin, CHAIN).index);
  const prf = await indexPrfOutput();
  const envelope = await sealBackup(payload, prf);
  const adapter = createMemoryBackupAdapter({ [myPiggiesIndexKey(CHAIN)]: envelope });
  return { addresses, adapter, payload };
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// ════════════════════════════════════════════════════════════════════════════════════════════
// Part A — main.js checkPiggy 배선. storedPrfSalt 부터 checkPiggy 끝까지(stayHome 앞)를 잘라
// vm 에서 돈다. main.js 자신의 requestPrf/openPiggy/startPiggyOpen 정의는 이 잘림에 들어가지만
// (openPiggy/startPiggyOpen 은 이 테스트가 호출하지 않으므로 그 자유변수는 평가되지 않는다),
// requestPrf 는 자유변수로 남겨 ctx 에서 결정적 가짜로 준다. INDEX_BACKUP_ADAPTER 상수만
// `globalThis.__ADAPTER__ ?? null` 로 치환해 테스트가 값을 주입할 수 있게 한다 — main.js 소스의
// **다른 어떤 줄도** 바꾸지 않는다(치환은 이 테스트 파일의 SLICE 문자열에만 적용).
// ════════════════════════════════════════════════════════════════════════════════════════════
const sliceStart = MAIN.indexOf("function storedPrfSalt() {");
const sliceEnd = MAIN.indexOf("function stayHome() {");
assert.ok(sliceStart > 0 && sliceEnd > sliceStart, "checkPiggy 구간 마커");
const RAW_SLICE = MAIN.slice(sliceStart, sliceEnd);
assert.match(RAW_SLICE, /const INDEX_BACKUP_ADAPTER = null;/, "치환 대상 리터럴이 소스에 그대로 있어야 한다");
const SLICE = RAW_SLICE.replace(
  "const INDEX_BACKUP_ADAPTER = null;",
  "const INDEX_BACKUP_ADAPTER = globalThis.__ADAPTER__ ?? null;",
);

function device({ adapter = null } = {}) {
  const calls = { setScene: [] };
  const state = { address: "", credential: null, authPhase: "idle", authCancelled: false, recoverFailures: 0, noPiggy: false, activeSignerAddress: null };
  const storage = createMemoryStorage();
  let requestPrfCalls = 0;
  const seenSalts = [];
  const client = fakeClient();
  const ctx = {
    state, console, Buffer, Map, String, Array, Date, JSON,
    isMeraError, getEvmAddress, createSecp256k1SigningSession,
    registerControlledPiggy, recoverProductList, prfSaltFromHex,
    localStorage: storage,
    safeLocalStorage: () => storage,
    secondJourneyScope: () => ({ chainId: CHAIN }),
    webLocks: () => fifoLocks(),
    isAllowedPiggyRpId: () => true,
    setScene: (...a) => calls.setScene.push(a),
    readPiggyName: () => null,
    isCancelledAuthError: () => false,
    PIGGY_RECEIVED_KEY: "araso.piggyReceived",
    // [A-667 re-pin] checkPiggy now runs one bounded attempt (setTimeout/clearTimeout) and recoverPiggy persists the
    // identity through commitIdentity (PASSKEY_STORAGE_KEY) — the harness supplies those free variables.
    PASSKEY_STORAGE_KEY: "araso.passkey",
    setTimeout, clearTimeout,
    toHex: (bytes) => Buffer.from(bytes).toString("hex"),
    writeCredential: (credential) => { state.credential = credential; },
    activateSigningSession: (prfOutput, opts = {}) => {
      const address = addressOf(prfOutput);
      state.activeSignerAddress = address;
      if (opts.persistAddress !== false) state.address = address;
      return { account: null, address };
    },
    endActiveSession: () => { state.activeSignerAddress = ""; },
    requestPrf: async (credential, { prfSalt } = {}) => {
      requestPrfCalls += 1;
      if (prfSalt instanceof Uint8Array) seenSalts.push(bytesToHex(prfSalt));
      return getPasskeyPrfOutput({ rpId: RP, ...(credential ? { credential } : {}), ...(prfSalt instanceof Uint8Array ? { prfSalt } : {}), webAuthnClient: client });
    },
    __ADAPTER__: adapter,
  };
  vm.createContext(ctx);
  vm.runInContext(`${SLICE}\nthis.api = { checkPiggy };`, ctx);
  return {
    checkPiggy: ctx.api.checkPiggy,
    state, calls, storage,
    requestPrfCallCount: () => requestPrfCalls,
    sawSalt: (hex) => seenSalts.includes(hex),
  };
}

await check("A1 (items 1+4). adapter absent → checkPiggy is exactly today's R1: root recovered to the deterministic first address, one auth call, zero product-list admissions, nothing fabricated", async () => {
  const d = device({ adapter: null });
  const out = await d.checkPiggy();
  assert.equal(out.ok, true);
  assert.equal(d.state.address, ROOT_FIRST_ADDRESS);
  assert.equal(d.requestPrfCallCount(), 1);                       // recoverPiggy 한 번뿐 — 추가 인증 0
  const { index } = loadMyPiggiesIndex(d.storage, CHAIN);
  assert.equal(index.piggies.length, 1);                          // 레거시 한 줄뿐 — 지어낸 추가 Piggy 0
  assert.equal(index.issuedThrough, 0);
});

await check("A2 (items 2+10). adapter present → root still recovers to the same address, and n=1..N restore through the real wiring with names NOT_RECOVERED", async () => {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  const a1 = await seedSequence(origin, 1);
  const a2 = await seedSequence(origin, 2);
  const payload = buildBackupPayload(loadMyPiggiesIndex(origin, CHAIN).index);
  const envelope = await sealBackup(payload, await indexPrfOutput());
  const adapter = createMemoryBackupAdapter({ [myPiggiesIndexKey(CHAIN)]: envelope });

  const d = device({ adapter });
  const out = await d.checkPiggy();
  assert.equal(out.ok, true);
  assert.equal(d.state.address, ROOT_FIRST_ADDRESS);              // R1 root 은 adapter 유무와 무관
  assert.equal(d.requestPrfCallCount(), 4);                       // root 1 + index-key 1 + n=1 + n=2

  const { index } = loadMyPiggiesIndex(d.storage, CHAIN);
  assert.equal(index.piggies.length, 3);                          // 레거시 + n1 + n2
  assert.equal(index.issuedThrough, 2);
  const bySeq = new Map(index.piggies.filter((p) => p.sequence).map((p) => [p.sequence, p]));
  assert.equal(bySeq.get(1).address, a1);
  assert.equal(bySeq.get(2).address, a2);
  assert.equal(bySeq.get(1).name, null);                          // 이름 NOT_RECOVERED
  assert.equal(bySeq.get(2).name, null);
  const legacy = index.piggies.find((p) => !p.sequence);
  assert.equal(legacy.address, ROOT_FIRST_ADDRESS);
});

await check("A3. checkPiggy's own body still never creates a passkey (recoverPiggy body untouched, textual guard)", () => {
  const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const body = (n) => { const i = code.indexOf(`function ${n}(`); return code.slice(i, code.indexOf("\n}\n", i)); };
  assert.equal(body("checkPiggy").includes("createPasskeyWithPrfOutput"), false);
  assert.equal(body("checkPiggy").includes("openPiggy("), false);
  assert.match(body("checkPiggy"), /if \(INDEX_BACKUP_ADAPTER\) \{/);
  assert.equal((body("recoverPiggy").match(/requestPrf\(/g) || []).length, 2);   // 손대지 않았다(피기-인덱스 테스트와 동일 불변식)
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Part B — gate-b-recovery.js / index-backup.js 를 직접 호출한다(vm 0).
// ════════════════════════════════════════════════════════════════════════════════════════════

await check("B2. after root recovery, recoverProductList restores n=1..N to the same deterministic addresses as origin, in order", async () => {
  const { addresses, adapter } = await seededRemote({ sequences: [1, 2, 3] });
  const fresh = createMemoryStorage();
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.status, "ok");
  assert.equal(out.source, "backup");
  assert.deepEqual(out.restored.map((r) => r.sequence), [1, 2, 3]);
  for (const r of out.restored) {
    assert.equal(r.address, addresses[r.sequence]);
    assert.ok(r.locator && r.locator.credentialId === ROOT_ID);   // 색인에 실제로 쓰인 locator 를 그대로 반영
  }
  assert.equal(out.namesRecovered, false);
});

await check("B3. a $0 / no-activity Piggy (blob lists it, nothing else) restores just the same", async () => {
  const { addresses, adapter } = await seededRemote({ sequences: [1] });
  const fresh = createMemoryStorage();
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(out.restored.map((r) => ({ sequence: r.sequence, address: r.address })), [{ sequence: 1, address: addresses[1] }]);
});

await check("B4. adapter absent → no_adapter status, zero auth calls, no fabricated Piggies", async () => {
  let asked = 0;
  const neverAsk = async () => { asked += 1; return liveRequestPrf(ROOT, await modelASalt(1)); };
  const fresh = createMemoryStorage();
  const out = await recoverProductList({ adapter: null, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: neverAsk, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(out, { status: "no_adapter", source: "local_only", restored: [], skipped: [], namesRecovered: false });
  assert.equal(asked, 0);
});

await check("B5a. tampered ciphertext → refused, zero admissions", async () => {
  const { adapter } = await seededRemote({ sequences: [1] });
  const key = myPiggiesIndexKey(CHAIN);
  const envelope = await adapter.get(key);
  const flipped = envelope.ciphertext[0] === "A" ? "B" : "A";
  await adapter.put(key, { ...envelope, ciphertext: flipped + envelope.ciphertext.slice(1) });
  const fresh = createMemoryStorage();
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "decrypt_failed");
  assert.deepEqual(out.restored, []);
});

await check("B5b. a different credential answering the root request (root switch) → refused, zero admissions", async () => {
  const { adapter } = await seededRemote({ sequences: [1] });
  const otherClient = fakeClient({ credentialBytes: new Uint8Array(Buffer.from("someone-else")) });
  const fresh = createMemoryStorage();
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: requestPrfWith(otherClient), deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "root_credential_mismatch");
  assert.deepEqual(out.restored, []);
});

await check("B5c. chain-mismatch blob → refused before any candidate auth (zero per-sequence requestPrf calls)", async () => {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  await seedSequence(origin, 1);
  const wrongChainPayload = { ...buildBackupPayload(loadMyPiggiesIndex(origin, CHAIN).index), chainId: "other-chain" };
  const envelope = await sealBackup(wrongChainPayload, await indexPrfOutput());
  const adapter = createMemoryBackupAdapter({ [myPiggiesIndexKey(CHAIN)]: envelope });

  const fresh = createMemoryStorage();
  const seenSalts = [];
  const spiedRequestPrf = async (cred, salt) => { seenSalts.push(bytesToHex(salt)); return liveRequestPrf(cred, salt); };
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: spiedRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "chain_mismatch");
  assert.deepEqual(out.restored, []);
  assert.equal(seenSalts.includes(bytesToHex(await modelASalt(1))), false);   // 후보 salt 는 한 번도 요청되지 않았다
  assert.equal(seenSalts.length, 1);                                          // 봉투 열기용 index-key PRF 한 번뿐
});

await check("B6. a gapped blob cannot jump the watermark or register a higher n over a missing lower n — exact skipped reason", async () => {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  const a1 = await seedSequence(origin, 1);
  await seedSequence(origin, 2);
  const a3 = await seedSequence(origin, 3);
  const full = loadMyPiggiesIndex(origin, CHAIN).index;
  const gapped = { version: 1, chainId: CHAIN, issuedThrough: full.issuedThrough, entries: full.piggies.filter((p) => p.sequence && p.sequence !== 2).map((p) => ({ sequence: p.sequence, createdAt: p.createdAt })) };
  const envelope = await sealBackup(gapped, await indexPrfOutput());
  const adapter = createMemoryBackupAdapter({ [myPiggiesIndexKey(CHAIN)]: envelope });

  const fresh = createMemoryStorage();
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.restored.map((r) => r.sequence), [1]);
  assert.equal(out.restored[0].address, a1);
  assert.equal(out.restored.some((r) => r.address === a3), false);
  assert.ok(out.skipped.some((sk) => sk.sequence === 3 && sk.reason === "stale_sequence"));
  assert.equal(loadMyPiggiesIndex(fresh, CHAIN).index.issuedThrough, 1);
});

await check("B7. repeated restore is idempotent — no duplicate rows, no sequence reuse, second pass restores nothing new", async () => {
  const { adapter } = await seededRemote({ sequences: [1, 2] });
  const fresh = createMemoryStorage();
  const first = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(first.restored.map((r) => r.sequence), [1, 2]);
  const afterFirst = loadMyPiggiesIndex(fresh, CHAIN).index;

  const second = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(second.restored, []);                          // 이미 로컬에 있음 — 다시 후보가 되지 않는다
  const afterSecond = loadMyPiggiesIndex(fresh, CHAIN).index;
  assert.equal(afterSecond.piggies.length, afterFirst.piggies.length);
  assert.equal(afterSecond.issuedThrough, afterFirst.issuedThrough);
  assert.deepEqual(afterSecond.piggies.map((p) => p.sequence).filter(Boolean).sort(), [1, 2]);
});

await check("B8. backup payload carries only sequence/createdAt — never name/address/locator/PRF/private material", async () => {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  await seedSequence(origin, 1);
  await seedSequence(origin, 2);
  const index = loadMyPiggiesIndex(origin, CHAIN).index;
  const payload = buildBackupPayload(index);
  assert.deepEqual(Object.keys(payload).sort(), ["chainId", "entries", "issuedThrough", "version"]);
  for (const entry of payload.entries) assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "sequence"]);
  const flat = JSON.stringify(payload).toLowerCase();
  for (const bad of ["address", "locator", "credentialid", "prf", "0x", "name"]) assert.equal(flat.includes(bad), false, bad);
});

await check("B9a. publishIndexBackup round-trips through an injected memory adapter", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  await seedSequence(s, 1);
  await seedSequence(s, 2);
  const adapter = createMemoryBackupAdapter({});
  const out = await publishIndexBackup({ adapter, storage: s, chainId: CHAIN, rootCredential: ROOT, requestPrf: liveRequestPrf });
  assert.equal(out.published, true);
  // [A-579 Lane B] 발행 키 = 복원(recoverProductList)이 읽는 myPiggiesIndexKey(chainId). 옛 `chainId` 키에는 아무것도 없다.
  assert.equal(await adapter.get(CHAIN), null);
  const raw = await adapter.get(myPiggiesIndexKey(CHAIN));
  assert.ok(raw);
  const opened = await openBackup(raw, await indexPrfOutput());
  assert.equal(opened.error, null);
  // 봉투 안에 단조 recordVersion 이 봉인된다(v2) — 첫 발행 = 1.
  assert.deepEqual(opened.payload, buildBackupPayload(loadMyPiggiesIndex(s, CHAIN).index, { recordVersion: 1 }));
  assert.equal(out.recordVersion, 1);

  // 그 봉투는 restoreFromBackup 이 그대로 열어 같은 후보를 낸다(발행-복원 왕복 자체의 정합성).
  const fresh = createMemoryStorage();
  const restored = await restoreFromBackup({ adapter, key: myPiggiesIndexKey(CHAIN), storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(restored.restored.map((r) => r.sequence).sort(), [1, 2]);
});

await check("B9b. publishIndexBackup with no adapter is a no-op — zero requestPrf calls, nothing published", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  let asked = 0;
  const out = await publishIndexBackup({ adapter: null, storage: s, chainId: CHAIN, rootCredential: ROOT, requestPrf: async () => { asked += 1; return liveRequestPrf(ROOT, await indexBackupSalt()); } });
  assert.deepEqual(out, { published: false, reason: "no_adapter" });
  assert.equal(asked, 0);
});

await check("B9c. product default (INDEX_BACKUP_ADAPTER = null) is never wired to publishIndexBackup — main.js performs no remote write", () => {
  assert.match(MAIN, /const INDEX_BACKUP_ADAPTER = null;/);
  assert.equal(MAIN.includes("publishIndexBackup"), false);   // 발행 코어는 아직 어디서도 호출되지 않는다(cadence 미정, OWNER_GATE)
});

await check("B-lock. restoreFromBackup and admitModelAPiggy share the same lock name and serialize through it", async () => {
  const origin = createMemoryStorage();
  await seedFirstPiggy(origin);
  const a1 = await seedSequence(origin, 1);         // 원본은 n=1 을 이미 발급했다
  const payload = buildBackupPayload(loadMyPiggiesIndex(origin, CHAIN).index);   // issuedThrough=1, entries=[1]
  const envelope = await sealBackup(payload, await indexPrfOutput());
  const adapter = createMemoryBackupAdapter({ [myPiggiesIndexKey(CHAIN)]: envelope });

  // 새 기기: 아직 아무것도 없다. 복원(가져올 후보: n=1)과 +Piggy(다음 번호 = n=1, 같은 번호를
  // 놓고 경쟁)를 **같은 잠금**으로 동시에 돌린다 — 직렬화되면 사이좋게 같은 주소로 수렴한다
  // (모델 A 는 같은 루트 + 같은 n 이면 항상 같은 주소이므로 손상이 아니라 정합).
  const fresh = createMemoryStorage();
  await seedFirstPiggy(fresh);
  const locks = fifoLocks();
  const [restoreOut, admitOut] = await Promise.all([
    restoreFromBackup({ adapter, key: myPiggiesIndexKey(CHAIN), storage: fresh, chainId: CHAIN, pinnedCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf, locks }),
    admitModelAPiggy({ storage: fresh, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: liveRequestPrf, deriveAddress: addressOf }),
  ]);
  assert.ok(locks.names.every((n) => n === myPiggiesLockName(CHAIN)));
  assert.ok(locks.names.length >= 2);                // 둘 다 같은 이름으로 잠금을 요청했다
  const { index } = loadMyPiggiesIndex(fresh, CHAIN);
  const seq1Rows = index.piggies.filter((p) => p.sequence === 1);
  assert.equal(seq1Rows.length, 1);                  // 중복 줄 0
  assert.equal(seq1Rows[0].address, a1);             // 결정적 주소로 수렴
  assert.equal(index.issuedThrough, 1);              // 워터마크가 2로 잘못 튀지 않는다
  const oneSucceeded = (admitOut.ok || (restoreOut.restored || []).some((r) => r.sequence === 1));
  assert.ok(oneSucceeded);
});

await check("[A-554 repair] adapter present but Web Locks absent → refused lock_unsupported, zero auth, zero admissions", async () => {
  const { adapter } = await seededRemote({ sequences: [1, 2] });
  const fresh = createMemoryStorage();
  await seedFirstPiggy(fresh);
  let asked = 0;
  const counting = async (...args) => { asked += 1; return liveRequestPrf(...args); };
  const out = await recoverProductList({ adapter, storage: fresh, chainId: CHAIN, rootCredential: ROOT, requestPrf: counting, deriveAddress: addressOf, locks: null });
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "lock_unsupported");
  assert.equal(asked, 0);
  assert.deepEqual(out.restored, []);
  assert.equal(loadMyPiggiesIndex(fresh, CHAIN).index.issuedThrough || 0, 0);
});

console.log(`\n${pass}/${pass} PASS`);
