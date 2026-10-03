// [A-531] 모델 A — 기존 패스키 하나 + 순번 salt 로 추가 Piggy. 네트워크 0 · 실제 Face ID 0 · 비밀값 출력 0.
//   node app/test/model-a-add-piggy.mjs
//
// 실제 Mera 코드(getPasskeyPrfOutput → signing session → 주소)에 결정적 가짜 WebAuthn 을 붙인다(A-493/A-512 방식).
// main.js 의 + Piggy 구간은 실제 소스를 잘라 node:vm 에서 돌린다(multi-piggy-b2.mjs 와 같은 방식).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress, MeraError } from "@category-labs/mera";
import { MODEL_A_NAMESPACE, bytesToHex, modelASalt, modelASaltHex, modelASaltSource } from "../src/piggy-session.js";
import { admitModelAPiggy, admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, myPiggiesLockName, registerControlledPiggy, renameIndexedPiggy, markBornPiggyIssuance } from "../src/piggy-index.js";
import { createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry } from "../src/piggy-registry.js";
import { createMemoryStorage } from "../src/second-journey-state.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CHAIN = "monad-testnet";
const AT = "2026-09-22T12:00:00.000Z";
const RP = "araso-harness.local.test";
const ROOT_ID_BYTES = new Uint8Array(Buffer.from("honeybun-root"));
const ROOT_ID = Buffer.from(ROOT_ID_BYTES).toString("base64url");

// ── 결정적 가짜 WebAuthn: 한 credential, PRF = HMAC(secret, salt) — 이 실행에서만 산다 ──
const secret = crypto.randomBytes(32);
function fakeClient({ credentialBytes = ROOT_ID_BYTES, fail = false, gate = null } = {}) {
  return {
    async createCredential() { throw new Error("createCredential must never be called for + Piggy"); },
    async getCredential(req) {
      if (gate) await gate();
      if (fail) throw new Error("NotAllowedError: user cancelled");
      return { credentialId: credentialBytes, prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
}
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);
const requestPrfWith = (client) => (credential, prfSalt) => getPasskeyPrfOutput({ rpId: RP, credential, prfSalt, webAuthnClient: client });

// 직렬화 잠금(탭 사이 Web Locks 대역) — 같은 이름은 한 번에 하나, 도착 순서대로.
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

// 첫 Piggy(레거시) 를 색인에 둔다 — 기본 salt 원시 PRF 주소.
async function seedFirstPiggy(storage) {
  const prf = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, CHAIN, { id: `legacy-${address.toLowerCase()}`, name: "Honeybun", address, signerAddress: address, locator: { credentialId: ROOT_ID }, at: AT });
  assert.equal(out.ok, true);
  assert.equal(markBornPiggyIssuance(storage, CHAIN, { address }).ok, true);   // [A-695] 생성 경로가 찍는 발급 출처
  return address;
}

// [A-579 Lane B] 순번 행은 admitSequencedPiggy(유일한 입장 경로)로만 들어간다. 규칙(워터마크/중복/충돌) 검사용으로
// 파생 주소를 고정한 가짜 provider — salt 는 여전히 함수 안에서 modelASalt(n) 로 계산돼 locator 에 박힌다.
const regSeq = (s, address, sequence) => admitSequencedPiggy({
  storage: s, chainId: CHAIN, sequence, rootCredential: { credentialId: "aG9uZXk" },
  requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }),
  deriveAddress: () => address, now: () => AT,
});

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── A. salt 계약 v1 ─────────────────────────────────────────────────────────────
await check("A1. frozen v1 salt vectors: source string → SHA-256(UTF-8) hex", async () => {
  const vectors = {
    1: "b94ebd79a9e716eeb1ddcc7686776d90972de949921dc7032be9f00531aa6caf",
    2: "a6f5cd4c67e66ea8516da7ec5bf5a27ab9e6d4c0a81513fbed1155ee5d28af1b",
    3: "b4270d902da396a57c8ca0f21ea3e8400b8297722c803b7fd71c78fe0e6b118b",
  };
  assert.equal(MODEL_A_NAMESPACE, "araso.piggy.v1.");
  for (const [n, hex] of Object.entries(vectors)) {
    assert.equal(modelASaltSource(Number(n)), `araso.piggy.v1.${n}`);
    const salt = await modelASalt(Number(n));
    assert.equal(salt.length, 32);
    assert.equal(bytesToHex(salt), hex);
    assert.equal(crypto.createHash("sha256").update(`araso.piggy.v1.${n}`, "utf8").digest("hex"), hex); // 독립 계산과 일치
  }
});

await check("A2. only positive safe integers form a source (no 0, negatives, fractions, strings, leading zeros)", async () => {
  for (const bad of [0, -1, 1.5, "1", NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(modelASaltSource(bad), null, String(bad));
  assert.equal(modelASaltSource(10), "araso.piggy.v1.10");   // String(n) 는 선행 0 을 만들지 않는다
  await assert.rejects(() => modelASalt(0), /invalid_sequence/);
  const salt = await modelASalt(1);
  assert.equal(new TextDecoder().decode(new TextEncoder().encode("araso.piggy.v1.1")), "araso.piggy.v1.1");
  assert.ok(salt instanceof Uint8Array);
});

await check("A3. same root + same n → same address; different n → different; default salt (first Piggy) differs from all", async () => {
  const req = requestPrfWith(fakeClient());
  const cred = { credentialId: ROOT_ID };
  const a1 = addressOf((await req(cred, await modelASalt(1))).prfOutput);
  const a1again = addressOf((await req(cred, await modelASalt(1))).prfOutput);
  const a2 = addressOf((await req(cred, await modelASalt(2))).prfOutput);
  const first = addressOf((await getPasskeyPrfOutput({ rpId: RP, credential: cred, webAuthnClient: fakeClient() })).prfOutput);
  assert.equal(a1, a1again);
  assert.notEqual(a1, a2);
  assert.notEqual(first, a1);
  assert.notEqual(first, a2);
});

// ── B. 순번 스키마 ─────────────────────────────────────────────────────────────
await check("B1. legacy rows without sequence stay valid; absent watermark normalizes to 0", () => {
  const key = myPiggiesIndexKey(CHAIN);
  const s = createMemoryStorage({ [key]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [
    { id: "legacy-a", name: "Honeybun", address: "0x00000000000000000000000000000000000000c3", locator: { credentialId: "aG9uZXk" }, createdAt: AT, lastControlProofAt: AT },
  ] }) });
  const { index } = loadMyPiggiesIndex(s, CHAIN);
  assert.equal(index.piggies.length, 1);
  assert.equal(index.issuedThrough, 0);
  assert.equal("sequence" in index.piggies[0], false);
});

await check("B2. first-Piggy (no sequence) registration never advances the additional-Piggy watermark", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  await seedFirstPiggy(s);                                   // 재증명(recover) 도 마찬가지
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 0);
});

await check("B3. sequence admission rules: must be issuedThrough+1, no duplicates, positive integer, same-address conflict", async () => {
  const s = createMemoryStorage();
  const A = "0x00000000000000000000000000000000000000a1", B = "0x00000000000000000000000000000000000000b2", C = "0x00000000000000000000000000000000000000c3";
  const reg = (address, sequence) => regSeq(s, address, sequence);
  // [A-579 Lane B] 손으로 (주소, 순번) 을 넘기는 동기 경로는 닫혔다.
  assert.equal(registerControlledPiggy(s, CHAIN, { address: A, signerAddress: A, locator: { credentialId: "aG9uZXk" }, at: AT, sequence: 1 }).reason, "sequence_requires_model_a_path");
  assert.equal((await reg(A, 2)).reason, "stale_sequence");          // 1 을 건너뛸 수 없다
  assert.equal((await reg(A, 0)).reason, "invalid_sequence");
  assert.equal((await reg(A, 1.5)).reason, "invalid_sequence");
  assert.equal((await reg(A, 1)).ok, true);
  assert.equal((await reg(B, 1)).reason, "duplicate_sequence");
  assert.equal((await reg(A, 2)).reason, "sequence_address_conflict");
  assert.equal((await reg(A, 1)).ok, true);                          // 같은 주소·같은 순번 = 제자리 재증명(워터마크 불변)
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 1);
  assert.equal((await reg(C, 2)).ok, true);
  assert.deepEqual(loadMyPiggiesIndex(s, CHAIN).index.piggies.map((p) => p.sequence), [1, 2]);
});

await check("B4. row + watermark are written in the same single JSON write", async () => {
  const s = createMemoryStorage();
  const writes = [];
  const spy = { getItem: (k) => s.getItem(k), setItem: (k, v) => { writes.push(JSON.parse(v)); s.setItem(k, v); }, removeItem: (k) => s.removeItem(k) };
  const A = "0x00000000000000000000000000000000000000a1";
  await regSeq(spy, A, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].issuedThrough, 1);
  assert.equal(writes[0].piggies[0].sequence, 1);
});

await check("B5. rename / row loss never lowers the watermark; a used n is never reissued", async () => {
  const s = createMemoryStorage();
  const A = "0x00000000000000000000000000000000000000a1";
  await regSeq(s, A, 1);
  renameIndexedPiggy(s, CHAIN, { id: `piggy-${A}`, name: "Mochi" });
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 1);
  // 줄이 사라져도(보관/손상) 저장된 워터마크가 남는다
  const raw = JSON.parse(s.getItem(myPiggiesIndexKey(CHAIN)));
  raw.piggies = [];
  s.setItem(myPiggiesIndexKey(CHAIN), JSON.stringify(raw));
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 1);
  // 워터마크가 누락·축소돼 있어도 남은 줄의 최대 순번보다 낮아지지 않는다
  const s2 = createMemoryStorage({ [myPiggiesIndexKey(CHAIN)]: JSON.stringify({ version: 1, chainId: CHAIN, issuedThrough: 0, piggies: [{ id: "b", address: A, locator: { credentialId: "aG9uZXk", prfSalt: modelASaltHex(4) }, createdAt: AT, lastControlProofAt: AT, sequence: 4 }] }) }); // [A-579 repair RV-2] a sequenced row must carry modelASalt(n) to load
  assert.equal(loadMyPiggiesIndex(s2, CHAIN).index.issuedThrough, 4);
});

await check("B6. sequence stays non-financial metadata — financial/secret fields still reject the row", () => {
  const key = myPiggiesIndexKey(CHAIN);
  for (const extra of [{ valuation: { usd: "1" } }, { permission: {} }, { prfOutput: "00" }, { sequence: "2" }, { sequence: 0 }]) {
    const s = createMemoryStorage({ [key]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [{ id: "x", address: "0x00000000000000000000000000000000000000a1", locator: { credentialId: "aG9uZXk" }, createdAt: AT, lastControlProofAt: AT, ...extra }] }) });
    assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 0, JSON.stringify(extra));
  }
});

// ── C·D·E. 입장 흐름 ────────────────────────────────────────────────────────────
const ROOT = { credentialId: ROOT_ID };
const run = (s, over = {}) => admitModelAPiggy({ storage: s, chainId: CHAIN, locks: fifoLocks(), rootCredential: ROOT, requestPrf: requestPrfWith(fakeClient()), deriveAddress: addressOf, now: () => AT, ...over });

await check("C1. one pinned assertion admits a distinct additional Piggy with sequence 1 and a Model-A locator", async () => {
  const s = createMemoryStorage();
  const first = await seedFirstPiggy(s);
  const out = await run(s);
  assert.equal(out.ok, true);
  assert.equal(out.piggy.sequence, 1);
  assert.notEqual(out.piggy.address, first);
  assert.equal(out.piggy.locator.credentialId, ROOT_ID);
  assert.equal(out.piggy.locator.prfSalt, bytesToHex(await modelASalt(1)));
  assert.equal(out.piggy.address, addressOf((await requestPrfWith(fakeClient())(ROOT, await modelASalt(1))).prfOutput)); // 다시 열면 같은 주소
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 1);
});

await check("C2. two concurrent + Piggy flows are serialized: they get n=1 and n=2, never the same", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const locks = fifoLocks();
  const [a, b] = await Promise.all([run(s, { locks }), run(s, { locks })]);
  assert.equal(a.ok && b.ok, true);
  assert.deepEqual([a.piggy.sequence, b.piggy.sequence].sort(), [1, 2]);
  assert.notEqual(a.piggy.address, b.piggy.address);
  assert.equal(locks.names[0], myPiggiesLockName(CHAIN));
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 2);
});

await check("C3. the real Web Locks API (when present) serializes too", async () => {
  if (!globalThis.navigator?.locks) { console.log("      (navigator.locks absent here — covered by C4 fail-closed)"); return; }
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const [a, b] = await Promise.all([run(s, { locks: navigator.locks }), run(s, { locks: navigator.locks })]);
  assert.deepEqual([a.piggy.sequence, b.piggy.sequence].sort(), [1, 2]);
});

await check("C4. without a lock primitive it fails closed — no auth, no row", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  let asked = 0;
  const out = await run(s, { locks: null, requestPrf: async () => { asked += 1; } });
  assert.equal(out.reason, "lock_unsupported");
  assert.equal(asked, 0);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 1);
});

await check("C5. cancellation / auth failure consumes no n and leaves no phantom row", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const cancelled = await run(s, { requestPrf: requestPrfWith(fakeClient({ fail: true })) });
  assert.equal(cancelled.reason, "auth_cancelled");
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 0);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 1);
  const next = await run(s);
  assert.equal(next.piggy.sequence, 1);                        // 취소된 번호가 그대로 다음에 쓰인다
});

await check("C5b. [A-532] auth failures are classified, not all reported as cancellation — no n consumed, no row, no raw error leaked", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const prfUnavailable = await run(s, { requestPrf: async () => { throw new MeraError("PRF_UNAVAILABLE", "authenticator did not enable PRF"); } });
  assert.equal(prfUnavailable.reason, "auth_unsupported");
  const cryptoUnavailable = await run(s, { requestPrf: async () => { throw new MeraError("CRYPTO_UNAVAILABLE", "no getRandomValues"); } });
  assert.equal(cryptoUnavailable.reason, "auth_unavailable");
  const inputInvalid = await run(s, { requestPrf: async () => { throw new MeraError("INPUT_INVALID", "bad salt length"); } });
  assert.equal(inputInvalid.reason, "auth_invalid_request");
  // PASSKEY_OPERATION_FAILED is Mera's own catch-all for cancel/unavailable/unexpected-credential — stays auth_cancelled.
  const opFailed = await run(s, { requestPrf: async () => { throw new MeraError("PASSKEY_OPERATION_FAILED", "cancelled"); } });
  assert.equal(opFailed.reason, "auth_cancelled");
  const nonMera = await run(s, { requestPrf: async () => { throw new Error("boom"); } });
  assert.equal(nonMera.reason, "auth_failed");
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 0);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 1);
});

await check("C6. a stale write (another admission slipped in after the assertion) is rejected, not duplicated", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  // 잠금을 우회한 다른 쓰기가 assertion 도중 n=1 을 가져간다(잠금 없는 구버전 탭 가정)
  const sneaky = async () => {
    const A = "0x00000000000000000000000000000000000000a1";
    await regSeq(s, A, 1);
  };
  const out = await run(s, { requestPrf: requestPrfWith(fakeClient({ gate: sneaky })) });
  assert.equal(out.reason, "stale_sequence");
  assert.deepEqual(loadMyPiggiesIndex(s, CHAIN).index.piggies.filter((p) => p.sequence).map((p) => p.sequence), [1]);
});

await check("D1. a different credential coming back (root switch) is refused", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const out = await run(s, { requestPrf: requestPrfWith(fakeClient({ credentialBytes: new Uint8Array(Buffer.from("someone-else")) })) });
  assert.equal(out.reason, "root_credential_mismatch");
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 0);
});

await check("D2. no root credential → fail closed; createCredential is never reached", async () => {
  const s = createMemoryStorage();
  assert.equal((await run(s, { rootCredential: null })).reason, "missing_root_credential");
  assert.equal((await run(s, { rootCredential: { credentialId: "" } })).reason, "missing_root_credential");
  // fakeClient.createCredential 은 throw 한다 — 위 C1–C6 이 통과했다는 것은 한 번도 불리지 않았다는 뜻
});

await check("D3. the pinned credential is what gets asked (never an unpinned any-passkey request)", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const seen = [];
  await run(s, { requestPrf: async (cred, salt) => { seen.push(cred); return requestPrfWith(fakeClient())(cred, salt); } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].credentialId, ROOT_ID);
});

// ── main.js 배선 ────────────────────────────────────────────────────────────────
const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const fnBody = (name) => { const i = code.indexOf(`function ${name}(`); return code.slice(i, code.indexOf("\n}\n", i)); };

await check("E1. + Piggy product path never calls createPasskeyWithPrfOutput and keeps the first Piggy scope", () => {
  // [A-579 Lane G] the admission body is the shared runModelAAdmission() helper (beginAddPiggy +
  // beginGiftPiggy); beginAddPiggy must still route through it and never create a passkey.
  assert.match(fnBody("beginAddPiggy"), /await runModelAAdmission\(root\.credential\)/);
  for (const caller of ["beginAddPiggy", "beginGiftPiggy"]) {
    assert.equal(fnBody(caller).includes("createPasskeyWithPrfOutput"), false, caller);
    assert.equal(fnBody(caller).includes("openPiggy("), false, caller);
  }
  const begin = fnBody("runModelAAdmission");
  assert.equal(begin.includes("createPasskeyWithPrfOutput"), false);
  assert.equal(begin.includes("openPiggy("), false);
  assert.match(begin, /requestPrf\(credential, \{ prfSalt \}\)/);
  assert.match(begin, /activateSigningSession\(prfOutput, \{ persistAddress: false \}\)/);
  assert.match(begin, /finally \{\s*\n\s*endActiveSession\(\);/);            // 탄생 세션은 성공/실패 모두 정리
  assert.match(begin, /locks: webLocks\(\)/);
  // 첫 Piggy 경로는 그대로 — 생성도, 기본 저장 scope 도
  assert.match(fnBody("openPiggy"), /createPasskeyWithPrfOutput\(\{/);
  // [A-667 R1/R2 re-pin] 첫 Piggy 경로는 서명자만 세우고 주소는 commitIdentity 가 credential 과 한 덩어리로 저장한다.
  // 옛 단언: openPiggy/recoverPiggy 의 activateSigningSession(result.prfOutput)(기본 persistAddress=true).
  assert.match(fnBody("openPiggy"), /activateSigningSession\(result\.prfOutput, \{ persistAddress: false \}\)/);
  assert.match(fnBody("openPiggy"), /commitIdentity\(\{ credential, address, prfSaltHex: toHex\(result\.prfSalt\), received: true \}\)/);
  assert.match(fnBody("recoverPiggy"), /activateSigningSession\(prfOutput, \{ persistAddress: false \}\);/);
});

await check("E2. the root credential cannot silently switch: index row and saved credential must agree", () => {
  const root = fnBody("modelARootCredential");
  assert.match(root, /root_credential_ambiguous/);
  assert.match(root, /!r\.sequence/);                                      // 루트 = 순번 없는 첫 Piggy 행
  assert.match(root, /missing_root_credential/);
});

// ── F. $0 탄생 투영과 실패 순서 — main.js 구간을 vm 으로 ─────────────────────────────
const start = MAIN.indexOf("// [A-522 B2a] MY PIGGIES 색인 = **제품 읽기 원천**");
const end = MAIN.indexOf("function homePadMarkup(scene) {");
const SLICE = MAIN.slice(start, end);
function openApp(storage, { address }) {
  const calls = { setScene: [] };
  const state = { address, secondJourneyCompletedOnce: true, addPiggy: null, pendingNamePiggyId: null, piggyName: "Honeybun" };
  const ctx = {
    state, console, Map, String, Array, Date, JSON,
    loadMyPiggiesIndex, registerControlledPiggy, normalizePiggy, projectRegistryTotals,
    admitModelAPiggy, loadRegistry, createPiggy, saveRegistry, migrateSinglePiggy,
    safeLocalStorage: () => storage,
    secondJourneyScope: () => ({ accountId: state.address, chainId: CHAIN }),
    secondPiggyRegistrySnapshot: () => ({ piggies: loadRegistry(storage, { accountId: state.address, chainId: CHAIN }).registry.piggies, totals: null }),
    setScene: (...a) => calls.setScene.push(a),
    readCredential: () => null, requestPrf: async () => { throw new Error("unused"); }, activateSigningSession: () => ({}), endActiveSession: () => {}, globalThis: {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${SLICE}\nthis.api = { admitAddedPiggy, moneyPiggiesSnapshot };`, ctx);
  return { ...ctx.api, state, calls };
}

await check("F1. after control-proven admission the new Piggy is a known $0 (birth_unfunded), first Piggy stays unknown", async () => {
  const s = createMemoryStorage();
  const first = await seedFirstPiggy(s);
  const out = await run(s);
  const app = openApp(s, { address: first });
  const r = app.admitAddedPiggy(out.piggy);
  assert.equal(r.projected, true);
  assert.equal(app.calls.setScene[0][0], "name");
  const reg = loadRegistry(s, { accountId: first, chainId: CHAIN }).registry.piggies;
  const born = reg.find((p) => p.id === out.piggy.id);
  assert.deepEqual(JSON.parse(JSON.stringify(born.valuation)), { usd: "0", source: "birth_unfunded", at: AT });
  assert.equal(reg.find((p) => p.id === `legacy-${first.toLowerCase()}`).valuation, null);
});

await check("F2. if the $0 projection fails to persist, no money is fabricated — the owned row stays and reads unknown", async () => {
  const base = createMemoryStorage();
  const first = await seedFirstPiggy(base);
  const out = await run(base);
  // 레지스트리 쓰기만 실패하는 저장소
  const failing = { getItem: (k) => base.getItem(k), removeItem: (k) => base.removeItem(k), setItem: (k, v) => { if (k.startsWith("araso.piggyRegistry")) throw new Error("quota"); base.setItem(k, v); } };
  const app = openApp(failing, { address: first });
  const r = app.admitAddedPiggy(out.piggy);
  assert.equal(r.projected, false);
  assert.equal(JSON.parse(JSON.stringify(app.state.addPiggy)).status, "projection_failed");
  assert.equal(app.state.pendingNamePiggyId, out.piggy.id);             // 소유는 증명됐으므로 이름 짓기는 진행
  const snap = JSON.parse(JSON.stringify(app.moneyPiggiesSnapshot()));
  const row = snap.piggies.find((p) => p.id === out.piggy.id);
  assert.equal(row.valuation, null);                                     // 가짜 $0 0 — "모름" (수리 가능)
});

await check("F3. a registry row alone never makes a Piggy owned (no index admission → not in MY PIGGIES)", () => {
  const s = createMemoryStorage();
  const A = "0x00000000000000000000000000000000000000a1";
  const born = createPiggy({ newPiggy: { id: "piggy-x", address: A }, at: AT });
  saveRegistry(s, { accountId: A, chainId: CHAIN }, { piggies: born.piggies });
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 0);
});

// ── G. [A-695 SEQ-5=A] 원 기기의 유효한 로컬 색인만 다음 번호를 낸다 — 새/없음/손상 기기는 requestPrf 전에 닫힌다 ──
const countingPrf = () => { const c = { n: 0 }; c.fn = (...a) => { c.n += 1; return requestPrfWith(fakeClient())(...a); }; return c; };
const idxKey = myPiggiesIndexKey(CHAIN);

await check("G1. SEQ-5 valid origin index (first Piggy row + root match) issues the next unused n; a deleted row never frees its number", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const a = await run(s);
  const b = await run(s);
  assert.deepEqual([a.ok, a.piggy.sequence, b.ok, b.piggy.sequence], [true, 1, true, 2]);
  const raw = JSON.parse(s.getItem(idxKey));
  raw.piggies = raw.piggies.filter((r) => r.sequence !== 2);
  s.setItem(idxKey, JSON.stringify(raw));
  const c = await run(s);
  assert.deepEqual([c.ok, c.piggy.sequence], [true, 3]);
});

await check("G2. SEQ-5 missing index (new device): origin_index_missing, 0 requestPrf, nothing written, n=1 not guessed", async () => {
  const s = createMemoryStorage();
  const prf = countingPrf();
  const out = await run(s, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, out.piggy, out.index], [false, "origin_index_missing", null, null]);
  assert.equal(prf.n, 0);
  assert.equal(s.getItem(idxKey), null);
});

await check("G3. SEQ-5 corrupt index (bad JSON / wrong version / wrong chain / non-array piggies / read throws): origin_index_corrupt, 0 requestPrf, raw bytes untouched", async () => {
  const good = { version: 1, chainId: CHAIN, issuedThrough: 2, piggies: [] };
  for (const raw of ["{not json", JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, chainId: "other" }), JSON.stringify({ ...good, piggies: "x" })]) {
    const s = createMemoryStorage();
    await seedFirstPiggy(s);
    s.setItem(idxKey, raw);
    const prf = countingPrf();
    const out = await run(s, { requestPrf: prf.fn });
    assert.deepEqual([out.ok, out.reason], [false, "origin_index_corrupt"], raw);
    assert.equal(prf.n, 0);
    assert.equal(s.getItem(idxKey), raw);
  }
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const prf = countingPrf();
  const out = await run(throwing, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_corrupt", 0]);
});

await check("G4. SEQ-5 an index that silently drops a row (garbage row, or a sequence row whose salt does not match) is not trusted: origin_index_corrupt, 0 requestPrf (a dropped sequence row would lower the watermark)", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  assert.equal((await run(s)).ok, true);                                        // sequence 1 row exists
  const raw = JSON.parse(s.getItem(idxKey));
  const mutations = [
    (c) => { c.piggies.push({ id: "junk", balance: "1" }); },                                                       // financial-field junk row
    (c) => { const r = c.piggies.find((x) => x.sequence === 1); r.locator = { ...r.locator, prfSalt: modelASaltHex(9) }; }, // salt != modelASalt(1) → dropped on read
  ];
  for (const mutate of mutations) {
    const copy = JSON.parse(JSON.stringify(raw));
    mutate(copy);
    const t = createMemoryStorage();
    t.setItem(idxKey, JSON.stringify(copy));
    const prf = countingPrf();
    const out = await run(t, { requestPrf: prf.fn });
    assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_corrupt", 0]);
  }
});

await check("G5. SEQ-5 index with no first-Piggy (legacy) row — empty piggies, or sequence rows only — is refused: origin_index_no_first_piggy, 0 requestPrf", async () => {
  const empty = createMemoryStorage();
  empty.setItem(idxKey, JSON.stringify({ version: 1, chainId: CHAIN, issuedThrough: 0, piggies: [] }));
  let prf = countingPrf();
  let out = await run(empty, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_no_first_piggy", 0]);

  const s = createMemoryStorage();
  await regSeq(s, "0x00000000000000000000000000000000000000b1", 1);            // restore-style sequence row only
  prf = countingPrf();
  out = await run(s, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_no_first_piggy", 0]);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 1);
});

await check("G6. SEQ-5 first-Piggy row belongs to a different passkey than the pinned root → origin_index_root_mismatch, 0 requestPrf", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const prf = countingPrf();
  const out = await run(s, { rootCredential: { credentialId: "b3RoZXI" }, requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_root_mismatch", 0]);
});

await check("G7. SEQ-5 stored watermark above the surviving rows is honored (n = stored+1, never reused); refusals leave the watermark alone", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const raw = JSON.parse(s.getItem(idxKey));
  raw.issuedThrough = 4;
  s.setItem(idxKey, JSON.stringify(raw));
  const out = await run(s);
  assert.deepEqual([out.ok, out.piggy.sequence], [true, 5]);
  const bad = createMemoryStorage();
  bad.setItem(idxKey, "{bad");
  await run(bad);
  assert.equal(bad.getItem(idxKey), "{bad");
});

await check("G8. SEQ-5 the gate is admitModelAPiggy-only: admitSequencedPiggy (Gate B restore path) and registerControlledPiggy still work on an empty index", async () => {
  const s = createMemoryStorage();
  const r = await regSeq(s, "0x00000000000000000000000000000000000000c1", 1);
  assert.equal(r.ok, true);
  const t = createMemoryStorage();
  await seedFirstPiggy(t);
  assert.equal(loadMyPiggiesIndex(t, CHAIN).index.piggies.length, 1);
});

// ── H. [A-695 SEQ-5=A] 발급 출처(provenance) — 행이 "있다"가 아니라 "어떻게 생겼나" ─────────────────────────
// 되찾기가 만든 첫 행 — registerControlledPiggy 만(= recoverPiggy 가 indexControlledPiggy 로 하는 일). 표식 0.
async function seedRecoveredPiggy(storage) {
  const prf = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, CHAIN, { id: `legacy-${address.toLowerCase()}`, name: "Honeybun", address, signerAddress: address, locator: { credentialId: ROOT_ID }, at: AT });
  assert.equal(out.ok, true);
  return address;
}
await check("H1. normal creation: markBornPiggyIssuance stamps provenance=birth on the already-indexed first row; +Piggy then issues only the next unused n (1, 2)", async () => {
  const s = createMemoryStorage();
  const addr = await seedFirstPiggy(s);                          // register + markBorn
  const rows = loadMyPiggiesIndex(s, CHAIN).index.piggies;
  assert.deepEqual([rows.length, rows[0].provenance, rows[0].sequence], [1, "birth", undefined]);
  assert.deepEqual([(await run(s)).piggy.sequence, (await run(s)).piggy.sequence], [1, 2]);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.find((p) => !p.sequence).address, addr);
});

await check("H2. recovery-created row (registerControlledPiggy only) has ZERO provenance: +Piggy/Gift path refuses origin_index_no_provenance with 0 requestPrf, nothing written; registerControlledPiggy ignores a smuggled provenance arg", async () => {
  const s = createMemoryStorage();
  await seedRecoveredPiggy(s);
  assert.equal("provenance" in loadMyPiggiesIndex(s, CHAIN).index.piggies[0], false);
  const prf = countingPrf();
  const before = s.getItem(idxKey);
  const out = await run(s, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n, s.getItem(idxKey)], [false, "origin_index_no_provenance", 0, before]);
  const t = createMemoryStorage();
  const prf2 = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const a2 = addressOf(prf2);
  registerControlledPiggy(t, CHAIN, { address: a2, signerAddress: a2, locator: { credentialId: ROOT_ID }, at: AT, provenance: "birth" });
  assert.equal("provenance" in loadMyPiggiesIndex(t, CHAIN).index.piggies[0], false);
});

await check("H3. recovery re-proof of an existing row keeps what it had: born stays born, an unstamped row stays unstamped (re-registering never creates or strips provenance)", async () => {
  const born = createMemoryStorage();
  const a = await seedFirstPiggy(born);
  await seedRecoveredPiggy(born);                                // same address → update path
  assert.equal(loadMyPiggiesIndex(born, CHAIN).index.piggies[0].provenance, "birth");
  const rec = createMemoryStorage();
  await seedRecoveredPiggy(rec);
  await seedRecoveredPiggy(rec);
  assert.equal("provenance" in loadMyPiggiesIndex(rec, CHAIN).index.piggies[0], false);
  assert.equal(a.length, 42);
});

await check("H4. index lost, then recovered: the re-created row has no provenance and araso.birthPlayed=1 does not help — n=1 is never re-issued", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  assert.equal((await run(s)).piggy.sequence, 1);
  s.removeItem(idxKey);                                          // index (and its watermark) gone
  s.setItem("araso.birthPlayed", "1");                           // creation evidence from the original birth is still there
  await seedRecoveredPiggy(s);                                   // Check Piggy re-indexes the first Piggy
  const prf = countingPrf();
  const out = await run(s, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_no_provenance", 0]);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.some((p) => p.sequence), false, "no sequence row, no guessed n");
});

await check("H5. legacy pre-marker origin install (provenance-less first row, araso.birthPlayed=1, root matches, intact index) is NOT upgraded: origin_index_no_provenance, 0 requestPrf, nothing written (product impact, recorded in VERIFY)", async () => {
  const s = createMemoryStorage();
  await seedRecoveredPiggy(s);                                   // row shape of a pre-marker install: no provenance
  s.setItem("araso.birthPlayed", "1");                           // creation-only evidence — but the ROW's origin is not provable (index loss + old-build recovery gives the same state)
  s.setItem("araso.piggyReceived", "1");
  const prf = countingPrf();
  const before = s.getItem(idxKey);
  const out = await run(s, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n, s.getItem(idxKey)], [false, "origin_index_no_provenance", 0, before]);
  assert.equal(Object.keys(s.dump()).filter((k) => k !== idxKey && k !== "araso.birthPlayed" && k !== "araso.piggyReceived").length, 0, "no extra marker key invented");
});

await check("H6. no provenance value other than \"birth\" is accepted anywhere (legacy_birth_evidence is dropped on load)", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  const raw = JSON.parse(s.getItem(idxKey));
  raw.piggies[0].provenance = "legacy_birth_evidence";
  s.setItem(idxKey, JSON.stringify(raw));
  assert.equal(loadMyPiggiesIndex(s, CHAIN).dropped, 1);
  assert.equal((await run(s)).reason, "origin_index_corrupt");
});

await check("H7. born row with a wrong pinned root or a damaged index still fails closed (root match + dropped-row checks kept)", async () => {
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  assert.equal((await run(s, { rootCredential: { credentialId: "b3RoZXI" } })).reason, "origin_index_root_mismatch");
  const raw = JSON.parse(s.getItem(idxKey));
  raw.piggies.push({ id: "junk", balance: "1" });
  s.setItem(idxKey, JSON.stringify(raw));
  assert.equal((await run(s)).reason, "origin_index_corrupt");
});

await check("H8. corrupt/missing provenance: unknown value, non-string, or provenance on a sequence row → that row is dropped on load (counted) and the gate fails closed", async () => {
  for (const mutate of [
    (r) => { r.piggies[0].provenance = "recovered"; },
    (r) => { r.piggies[0].provenance = 1; },
    (r) => { r.piggies[0].provenance = {}; },
  ]) {
    const s = createMemoryStorage();
    await seedFirstPiggy(s);
    const raw = JSON.parse(s.getItem(idxKey));
    mutate(raw);
    s.setItem(idxKey, JSON.stringify(raw));
    const loaded = loadMyPiggiesIndex(s, CHAIN);
    assert.equal(loaded.dropped, 1);
    const prf = countingPrf();
    const out = await run(s, { requestPrf: prf.fn });
    assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_corrupt", 0]);
  }
  const s = createMemoryStorage();
  await seedFirstPiggy(s);
  assert.equal((await run(s)).ok, true);
  const raw = JSON.parse(s.getItem(idxKey));
  raw.piggies.find((r) => r.sequence === 1).provenance = "birth";
  s.setItem(idxKey, JSON.stringify(raw));
  assert.equal(loadMyPiggiesIndex(s, CHAIN).dropped, 1, "provenance is first-Piggy only");
});

await check("H9. markBornPiggyIssuance never creates or moves rows: unknown address / sequence row / corrupt index refused; idempotent on a born row", async () => {
  const s = createMemoryStorage();
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: "0x00000000000000000000000000000000000000d1" }).reason, "origin_index_corrupt");
  const addr = await seedRecoveredPiggy(s);
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: "0x00000000000000000000000000000000000000d1" }).reason, "not_indexed");
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: "nope" }).reason, "invalid_address");
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: addr }).ok, true);
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: addr }).ok, true);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 1);
  const seq = await run(s);
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: seq.piggy.address }).reason, "sequenced_row_has_no_provenance");
});

await check("H10. Gate B restore (admitSequencedPiggy) never creates provenance on any row", async () => {
  const s = createMemoryStorage();
  await seedRecoveredPiggy(s);
  await regSeq(s, "0x00000000000000000000000000000000000000e1", 1);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.every((p) => !p.provenance), true);
  assert.equal((await run(s)).reason, "origin_index_no_provenance");
});

// ── F1 (A-695 pre-review): 믿을 수 없는 읽기 위의 다시 쓰기는 발급 자격을 되살리지 않는다 ───────────────────
async function issueTwo() {
  const s = createMemoryStorage();
  const first = await seedFirstPiggy(s);
  const a = await run(s);
  const b = await run(s);
  assert.deepEqual([a.piggy.sequence, b.piggy.sequence], [1, 2]);
  return { s, first, b };
}
const rewriteFirst = (s) => seedRecoveredPiggy(s);             // registerControlledPiggy(first row) = Check Piggy / unlock re-proof (update branch)

await check("H12. F1 exact repro: corrupt stored issuedThrough AND #2's salt → gate refuses; ONE registerControlledPiggy(first row) rewrite does not revive it — gate still refuses and n=2 is never re-issued", async () => {
  const { s, b } = await issueTwo();
  const raw = JSON.parse(s.getItem(idxKey));
  raw.issuedThrough = "bad";
  raw.piggies.find((r) => r.sequence === 2).locator.prfSalt = modelASaltHex(9);
  s.setItem(idxKey, JSON.stringify(raw));
  assert.equal((await run(s)).reason, "origin_index_corrupt");
  await rewriteFirst(s);                                          // rewrite from a load with dropped>0 + invalid watermark
  const rewritten = JSON.parse(s.getItem(idxKey));
  assert.equal(rewritten.issuedThrough, 1, "the rewrite wrote the clean-looking watermark 1 (the F1 hazard)");
  assert.equal("provenance" in rewritten.piggies.find((r) => !r.sequence), false, "…but stripped provenance from the first row");
  const prf = countingPrf();
  const out = await run(s, { requestPrf: prf.fn });
  assert.deepEqual([out.ok, out.reason, prf.n], [false, "origin_index_no_provenance", 0]);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.some((p) => p.address === b.piggy.address && p.sequence === 2), false, "#2 row is gone, and no n=2 was re-issued at its address");
  // permanent: further rewrites (rename, re-proof, stamp attempt) never bring it back
  await rewriteFirst(s);
  const row = loadMyPiggiesIndex(s, CHAIN).index.piggies[0];
  renameIndexedPiggy(s, CHAIN, { id: row.id, name: "Z" });
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: row.address }).ok, true, "a clean index may be stamped by a real birth, but only for that address");
});

await check("H13. F1 single-corruption variants: dropped row alone, or invalid/missing stored watermark alone, each closes the device through any rewrite path (re-proof, rename)", async () => {
  const variants = {
    droppedRowOnly: (raw) => { raw.piggies.find((r) => r.sequence === 2).locator.prfSalt = modelASaltHex(9); },
    badWatermarkOnly: (raw) => { raw.issuedThrough = -3; },
    missingWatermarkOnly: (raw) => { delete raw.issuedThrough; },
    junkRowOnly: (raw) => { raw.piggies.push({ id: "junk", balance: "1" }); },
  };
  for (const [name, mutate] of Object.entries(variants)) {
    for (const rewrite of [(s) => rewriteFirst(s), (s) => { const r = loadMyPiggiesIndex(s, CHAIN).index.piggies[0]; return renameIndexedPiggy(s, CHAIN, { id: r.id, name: "Zed" }); }]) {
      const { s } = await issueTwo();
      const raw = JSON.parse(s.getItem(idxKey));
      mutate(raw);
      s.setItem(idxKey, JSON.stringify(raw));
      assert.equal((await run(s)).reason, "origin_index_corrupt", name);
      await rewrite(s);
      const prf = countingPrf();
      const out = await run(s, { requestPrf: prf.fn });
      assert.equal(out.ok, false, name);
      assert.ok(["origin_index_no_provenance", "origin_index_corrupt"].includes(out.reason), `${name}: ${out.reason}`);
      assert.equal(prf.n, 0, name);
    }
  }
});

await check("H14. F1 control: an untouched healthy index (valid watermark, no dropped rows) is not tainted — rewrites keep provenance and issuance continues with the next unused n", async () => {
  const { s } = await issueTwo();
  await rewriteFirst(s);
  const row = loadMyPiggiesIndex(s, CHAIN).index.piggies.find((p) => !p.sequence);
  renameIndexedPiggy(s, CHAIN, { id: row.id, name: "Zed" });
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.find((p) => !p.sequence).provenance, "birth");
  assert.equal((await run(s)).piggy.sequence, 3);
});

await check("H15. F1: markBornPiggyIssuance refuses on a tainted read (does not re-stamp over corruption)", async () => {
  const { s, first } = await issueTwo();
  const raw = JSON.parse(s.getItem(idxKey));
  raw.issuedThrough = "bad";
  s.setItem(idxKey, JSON.stringify(raw));
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: first }).reason, "origin_index_corrupt");
});

await check("H11. main.js wiring (source): the born marker is reachable only from the creation path — commitIdentity(received:true) arms an in-memory candidate, indexControlledPiggy consumes it once; recoverPiggy/checkPiggy never arm or call it", () => {
  const fn = (name) => { const m = new RegExp(`(?:async )?function ${name}\\(`).exec(MAIN); assert.ok(m, name); const body = MAIN.slice(m.index, MAIN.indexOf("\n}\n", m.index)); assert.ok(body.length > 100, name); return body; };
  assert.equal((MAIN.match(/markBornPiggyIssuance\(/g) || []).length, 1, "single call site");
  assert.ok(fn("indexControlledPiggy").includes("markBornPiggyIssuance("));
  assert.equal((MAIN.match(/bornPiggyPending = String\(address\)/g) || []).length, 1, "armed in one place");
  assert.ok(fn("commitIdentity").includes("if (received) bornPiggyPending"));
  assert.equal(/received:\s*true/.test(fn("recoverPiggy")), false);
  assert.equal(fn("recoverPiggy").includes("markBorn"), false);
  assert.equal(fn("checkPiggy").includes("markBorn"), false);
  assert.equal(fn("checkPiggy").includes("received: true"), false);
  assert.equal((MAIN.match(/commitIdentity\(\{[^}]*received: true/g) || []).length, 1, "only openPiggy passes received:true");
  assert.equal((MAIN.match(/BIRTH_PLAYED_KEY, "1"/g) || []).length, 1, "araso.birthPlayed has one writer (finishHatch)");
  assert.equal((MAIN.match(/setScene\("hatch"/g) || []).length, 1, "hatch scene (→ finishHatch) entered from one place");
});

console.log(`\n${pass}/${pass} PASS`);
