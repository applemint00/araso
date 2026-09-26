// [A-520 Stream B1] MY PIGGIES 비금융 색인 — 네트워크 0 · 실제 Face ID 0 · 비밀값 출력 0.
//   node app/test/piggy-index.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { modelASaltHex, prfSaltFromHex } from "../src/piggy-session.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const SRC = readFileSync(new URL("../src/piggy-index.js", import.meta.url), "utf8");
const CHAIN = "monad-testnet";
const HONEY = "0x00000000000000000000000000000000000000c3";
const MOCHI = "0x00000000000000000000000000000000000000d4";
const AT = "2026-09-22T05:00:00.000Z";
const loc = (id, extra = {}) => ({ credentialId: id, transports: ["internal"], ...extra });
const reg = (storage, over = {}) => registerControlledPiggy(storage, CHAIN, {
  id: "honeybun", name: "Honeybun", address: HONEY, signerAddress: HONEY, locator: loc("aG9uZXk"), at: AT, ...over,
});

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

await check("1. an address with no control proof is refused", () => {
  const s = createMemoryStorage();
  assert.equal(reg(s, { signerAddress: undefined }).reason, "no_control_proof");
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 0);
});

await check("2. a proof signer that is not the Piggy address is refused", () => {
  const s = createMemoryStorage();
  assert.equal(reg(s, { signerAddress: MOCHI }).reason, "control_proof_mismatch");
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 0);
});

await check("3. a valid proof stores exactly one Piggy", () => {
  const s = createMemoryStorage();
  const out = reg(s);
  assert.equal(out.ok, true);
  const rows = loadMyPiggiesIndex(s, CHAIN).index.piggies;
  assert.equal(rows.length, 1);
  assert.deepEqual({ id: rows[0].id, name: rows[0].name, address: rows[0].address }, { id: "honeybun", name: "Honeybun", address: HONEY });
});

await check("4. two controlled Piggies both survive a reload (fresh read of the same storage)", () => {
  const s = createMemoryStorage();
  reg(s);
  reg(s, { id: "mochi", name: "Mochi", address: MOCHI, signerAddress: MOCHI, locator: loc("bW9jaGk", { prfSalt: "07".repeat(32) }) });
  const reopened = createMemoryStorage(s.dump());
  assert.deepEqual(loadMyPiggiesIndex(reopened, CHAIN).index.piggies.map((p) => p.id), ["honeybun", "mochi"]);
});

await check("5. the index key does not depend on the selected Piggy / active signer", () => {
  assert.equal(myPiggiesIndexKey(CHAIN), "araso.myPiggiesIndex.v1.monad-testnet");
  const code = SRC.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const k of ["state.address", "selectedPiggy", "activeSignerAddress"]) assert.equal(code.includes(k), false, k);
  const s = createMemoryStorage();
  reg(s);
  reg(s, { id: "mochi", name: "Mochi", address: MOCHI, signerAddress: MOCHI, locator: loc("bW9jaGk") });
  // 누가 서명자든(Honeybun → Mochi → 없음) 같은 키에서 같은 두 줄이 읽힌다.
  for (let i = 0; i < 3; i += 1) assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 2);
  assert.equal(Object.keys(s.dump()).length, 1);
});

await check("6. renaming an indexed Piggy persists without reordering; renaming cannot register", () => {
  const s = createMemoryStorage();
  reg(s);
  reg(s, { id: "mochi", name: "Mochi", address: MOCHI, signerAddress: MOCHI, locator: loc("bW9jaGk") });
  assert.equal(renameIndexedPiggy(s, CHAIN, { id: "honeybun", name: "Honey" }).ok, true);
  assert.deepEqual(loadMyPiggiesIndex(s, CHAIN).index.piggies.map((p) => [p.id, p.name]), [["honeybun", "Honey"], ["mochi", "Mochi"]]);
  assert.equal(renameIndexedPiggy(s, CHAIN, { id: "bebe", name: "Bebe" }).reason, "not_indexed");
  // 재증명도 순서를 바꾸지 않는다
  reg(s, { name: null, at: "2026-09-22T06:00:00.000Z" });
  assert.deepEqual(loadMyPiggiesIndex(s, CHAIN).index.piggies.map((p) => [p.id, p.name]), [["honeybun", "Honey"], ["mochi", "Mochi"]]);
});

await check("7. duplicate id / address ambiguity: id reuse for another address is refused; stored duplicates keep the first", () => {
  const s = createMemoryStorage();
  reg(s);
  assert.equal(reg(s, { address: MOCHI, signerAddress: MOCHI }).reason, "id_conflict");
  // 같은 주소 재등록은 새 줄을 만들지 않고 그 자리를 갱신한다
  reg(s, { id: "other-id" });
  assert.deepEqual(loadMyPiggiesIndex(s, CHAIN).index.piggies.map((p) => p.id), ["honeybun"]);
  // 저장값에 중복이 섞여 있어도 먼저 나온 줄만 — 결정적
  const row = (id, address) => ({ id, name: null, address, locator: loc("aG9uZXk"), createdAt: AT, lastControlProofAt: AT });
  const dup = createMemoryStorage({ [myPiggiesIndexKey(CHAIN)]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [row("a", HONEY), row("b", HONEY), row("a", MOCHI)] }) });
  const out = loadMyPiggiesIndex(dup, CHAIN);
  assert.deepEqual(out.index.piggies.map((p) => p.id), ["a"]);
  assert.equal(out.dropped, 2);
});

await check("8. locator credentialId/transports/prfSalt persists; PRF/private/session material is rejected", () => {
  const s = createMemoryStorage();
  reg(s, { locator: loc("aG9uZXk", { prfSalt: "07".repeat(32) }) });
  assert.deepEqual(loadMyPiggiesIndex(s, CHAIN).index.piggies[0].locator, { credentialId: "aG9uZXk", transports: ["internal"], prfSalt: "07".repeat(32) });
  const bad = (extra) => createMemoryStorage({ [myPiggiesIndexKey(CHAIN)]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [{ id: "x", address: HONEY, locator: { credentialId: "aG9uZXk", ...extra }, createdAt: AT, lastControlProofAt: AT }] }) });
  for (const extra of [{ prfOutput: "00" }, { privateKey: "00" }, { sessionKey: "00" }]) {
    assert.equal(loadMyPiggiesIndex(bad(extra), CHAIN).index.piggies.length, 0, JSON.stringify(extra));
  }
  // 등록 입력에 섞인 비밀은 복사되지 않는다(locator 는 허용 필드만 남긴다)
  const s2 = createMemoryStorage();
  reg(s2, { locator: { credentialId: "aG9uZXk", prfOutput: "SECRET" } });
  assert.equal(JSON.stringify(s2.dump()).includes("SECRET"), false);
});

await check("9. financial / receipt / permission / draft fields never enter the index", () => {
  const withField = (field) => createMemoryStorage({ [myPiggiesIndexKey(CHAIN)]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [{ id: "x", address: HONEY, locator: loc("aG9uZXk"), createdAt: AT, lastControlProofAt: AT, ...field }] }) });
  for (const field of [{ assets: [] }, { valuation: { usd: "1" } }, { receipts: [] }, { permission: {} }, { draft: {} }, { preference: {} }, { balance: "1" }]) {
    assert.equal(loadMyPiggiesIndex(withField(field), CHAIN).index.piggies.length, 0, JSON.stringify(field));
  }
  const s = createMemoryStorage();
  registerControlledPiggy(s, CHAIN, { id: "honeybun", address: HONEY, signerAddress: HONEY, locator: loc("aG9uZXk"), at: AT, assets: [{ quantity: "9" }], valuation: { usd: "9" } });
  const raw = JSON.stringify(s.dump());
  assert.equal(raw.includes("valuation") || raw.includes("assets"), false);
});

await check("10. corrupt, wrong-version, wrong-chain or unproven storage fabricates no ownership", () => {
  const key = myPiggiesIndexKey(CHAIN);
  for (const raw of ["{not json", JSON.stringify({ version: 2, chainId: CHAIN, piggies: [] }), JSON.stringify({ version: 1, chainId: "monad-mainnet", piggies: [] })]) {
    assert.equal(loadMyPiggiesIndex(createMemoryStorage({ [key]: raw }), CHAIN).index.piggies.length, 0);
  }
  const unproven = createMemoryStorage({ [key]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [{ id: "x", address: HONEY, locator: loc("aG9uZXk"), createdAt: AT }] }) });
  assert.equal(loadMyPiggiesIndex(unproven, CHAIN).index.piggies.length, 0);
});

// ── 11. 실제 Mera 경로로 파생된 서명자만 등록된다 (가짜 WebAuthn · A-493/A-512 방식) ──────
const secret = crypto.randomBytes(32);
const fakeClient = (label) => ({
  async createCredential() { throw new Error("not used"); },
  async getCredential(req) {
    return { credentialId: new Uint8Array(Buffer.from(label)), prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(label).update(Buffer.from(req.prfSalt)).digest()) };
  },
});
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);

await check("11. open/recover-style registration uses the actually derived signer; a different salt cannot register the Piggy", async () => {
  const client = fakeClient("mochi");
  const salt = prfSaltFromHex("07".repeat(32));
  const opened = await getPasskeyPrfOutput({ rpId: "araso-harness.local.test", prfSalt: salt, webAuthnClient: client });
  const address = addressOf(opened.prfOutput);
  const s = createMemoryStorage();
  const ok = registerControlledPiggy(s, CHAIN, { address, signerAddress: address, locator: { credentialId: opened.credentialId, prfSalt: "07".repeat(32) }, at: AT });
  assert.equal(ok.ok, true);
  const wrongSalt = await getPasskeyPrfOutput({ rpId: "araso-harness.local.test", webAuthnClient: client });
  assert.equal(registerControlledPiggy(s, CHAIN, { address, signerAddress: addressOf(wrongSalt.prfOutput), locator: { credentialId: wrongSalt.credentialId }, at: AT }).reason, "control_proof_mismatch");
  // main.js: 성공 뒤 한 번 적고, 증명은 활성 서명자에서 온다(추가 Face ID 0)
  const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const body = (n) => { const i = code.indexOf(`function ${n}(`); return code.slice(i, code.indexOf("\n}\n", i)); };
  assert.match(body("indexControlledPiggy"), /signerAddress: state\.activeSignerAddress/);
  assert.match(body("recoverPiggy"), /activateSigningSession\(result\.prfOutput\);\n\s+indexControlledPiggy\(\{/);
  assert.match(body("openPiggy"), /indexControlledPiggy\(\{ address, credentialId: result\.credentialId, transports: result\.transports, prfSaltHex: toHex\(result\.prfSalt\) \}\)/);
  assert.equal((body("recoverPiggy").match(/requestPrf\(/g) || []).length, 2); // 기존 두 번(고정 + 한 번 재시도) 그대로 — 추가 요청 0
});

await check("12. First single-Piggy flow keeps every original write; the index write only follows success and cannot block it", () => {
  const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const i = code.indexOf("function openPiggy(");
  const open = code.slice(i, code.indexOf("\n}\n", i));
  const order = ["activateSigningSession(result.prfOutput)", "writeCredential(credential)", 'localStorage.setItem("araso.prfSalt"', "localStorage.setItem(PIGGY_RECEIVED_KEY", "indexControlledPiggy(", "noteRecoverSuccess()"];
  let last = -1;
  for (const token of order) { const at = open.indexOf(token); assert.ok(at > last, token); last = at; }
  const idx = code.slice(code.indexOf("function indexControlledPiggy("), code.indexOf("\n}\n", code.indexOf("function indexControlledPiggy(")));
  assert.match(idx, /try \{/);                       // 실패해도 First 흐름을 막지 않는다
  for (const banned of ["activateSigningSession", "issuePermission", "requestPrf", "setScene", "homeMoneyNativeWei"]) {
    assert.equal(idx.includes(banned), false, `index write must not ${banned}`);
  }
  // 색인 모듈은 서명·권한·네트워크를 부르지 않는다
  for (const banned of ["createSecp256k1SigningSession", "issuePermission", "authorize(", "fetch(", "writeContract", "sendTransaction"]) {
    assert.equal(SRC.includes(banned), false, `piggy-index must not contain ${banned}`);
  }
});

// ── [A-579 repair RV-2] sequence↔salt holds on the update path and on load (review RV-2 repro) ──
const RV2_ADDR = "0x" + "ab".repeat(20);
const rv2Admit = (s) => admitSequencedPiggy({ storage: s, chainId: CHAIN, sequence: 1, rootCredential: { credentialId: "root1" },
  requestPrf: async () => ({ credentialId: "root1", prfOutput: new Uint8Array(32) }), deriveAddress: () => RV2_ADDR, now: () => AT });

await check("RV-2a. an unsequenced register on the address of a sequenced row is refused; the row keeps sequence 1, modelASalt(1) and its credential", async () => {
  const s = createMemoryStorage();
  const admitted = await rv2Admit(s);
  assert.equal(admitted.ok, true);
  assert.equal(admitted.piggy.locator.prfSalt, modelASaltHex(1));
  const before = s.getItem(myPiggiesIndexKey(CHAIN));
  const w = registerControlledPiggy(s, CHAIN, { address: RV2_ADDR, signerAddress: RV2_ADDR, locator: { credentialId: "OTHER", prfSalt: "00".repeat(32) }, at: "t" });
  assert.equal(w.ok, false);
  assert.equal(w.reason, "sequenced_row_requires_model_a_path");
  assert.equal(s.getItem(myPiggiesIndexKey(CHAIN)), before); // not a byte changed
  const row = loadMyPiggiesIndex(s, CHAIN).index.piggies[0];
  assert.equal(row.sequence, 1);
  assert.equal(row.locator.prfSalt, modelASaltHex(1));
  assert.equal(row.locator.credentialId, "root1");
  // also with the right salt: the unsequenced path still may not touch a sequenced row
  assert.equal(registerControlledPiggy(s, CHAIN, { address: RV2_ADDR, signerAddress: RV2_ADDR, locator: { credentialId: "root1", prfSalt: modelASaltHex(1) }, at: "t2" }).reason, "sequenced_row_requires_model_a_path");
  // an unsequenced (legacy/root) row is still updatable in place as before
  assert.equal(reg(s).ok, true);
  assert.equal(reg(s, { locator: loc("aG9uZXk", { prfSalt: "11".repeat(32) }), at: "t3" }).ok, true);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.find((p) => p.address === HONEY).lastControlProofAt, "t3");
});

await check("RV-2b. on load a sequenced row whose salt is not modelASalt(n) is dropped (counted), not trusted; a matching row loads", () => {
  const key = myPiggiesIndexKey(CHAIN);
  const row = (sequence, prfSalt) => ({ id: `x${sequence}`, address: "0x" + String(sequence).padStart(40, "0"), locator: { credentialId: "c", ...(prfSalt ? { prfSalt } : {}) }, lastControlProofAt: "t", sequence });
  const s = createMemoryStorage({ [key]: JSON.stringify({ version: 1, chainId: CHAIN, issuedThrough: 5, piggies: [row(5, "11".repeat(32)), row(3), row(2, modelASaltHex(2))] }) });
  const out = loadMyPiggiesIndex(s, CHAIN);
  assert.deepEqual(out.index.piggies.map((p) => p.sequence), [2]);
  assert.equal(out.dropped, 2);
  assert.equal(out.index.issuedThrough, 5); // the stored watermark never goes down (n is never reissued)
});

console.log(`\n${pass}/${pass} PASS`);
