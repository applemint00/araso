// [A-512] Gate C — selected Piggy == active signer. 네트워크 0 · 실제 Face ID 0 · 비밀값 출력 0.
//   node app/test/gate-c-signer.mjs
//
// 1) 규칙 모듈(piggy-session.js) + 봉투(permission-envelope.js) 음성 검사.
// 2) prfSalt 재오픈: **실제 Mera 코드**(getPasskeyPrfOutput → signing session → 주소)에 가짜 WebAuthn 을 붙여
//    Piggy locator 의 salt 가 실제로 쓰이고 기본 salt 로 바뀌지 않음을 주소로 확인한다(A-493 하네스 방식).
// 3) main.js 배선을 소스 텍스트로 잰다(DOM 결합이 커서 — two-paper-money.mjs 와 같은 방식).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { authRequestForPiggy, bindSigner, normalizeLocator, prfSaltFromHex, selectionContext, switchSelection } from "../src/piggy-session.js";
import { authorize, consume, issuePermission, permissionNonce } from "../src/permission-envelope.js";
import { normalizePiggy } from "../src/piggy-registry.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const NOW = 1_800_000_000_000;
const HONEY = "0x00000000000000000000000000000000000000c3";
const MOCHI = "0x00000000000000000000000000000000000000d4";
const DEST = "0x00000000000000000000000000000000000000a1";
const honeybun = { id: "honeybun", address: HONEY, locator: { credentialId: "aG9uZXk", transports: ["internal"] } };
const mochi = { id: "mochi", address: MOCHI, locator: { credentialId: "bW9jaGk", prfSalt: "07".repeat(32) } };

const intentFor = (piggyId, signerAddress, over = {}) => ({
  piggyId, signerAddress, action: "send_money", asset: "USDC", amount: "2.5",
  chain: "monad-testnet", destination: DEST, destinationRequired: true, ...over,
});
const auth = { method: "passkey", verified: true, verifiedAt: NOW - 1000, credentialId: "aG9uZXk" };
function envelopeFor(piggyId, signer) {
  const i = intentFor(piggyId, signer);
  return issuePermission({ intent: i, auth, nonce: permissionNonce({ ...i, at: NOW }), nowMs: NOW }).envelope;
}
const reqFor = (piggyId, signerAddress) => ({ piggyId, signerAddress, action: "send_money", asset: "USDC", amount: "2.5", chain: "monad-testnet", destination: DEST });

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 선택 전환이 이전 권한을 먼저 죽인다 ─────────────────────────────────────
await check("switching Honeybun → Mochi invalidates the old session and revokes the held permission", () => {
  const held = envelopeFor("honeybun", HONEY);
  const first = switchSelection(null, honeybun);
  const out = switchSelection(first.selection, mochi, { heldEnvelope: held });
  assert.equal(out.invalidate, true);
  assert.equal(out.revokeNonce, held.nonce);
  assert.deepEqual({ ...out.selection }, { id: "mochi", address: MOCHI });
});

await check("re-selecting the same Piggy does not throw away its own live authority", () => {
  const sel = switchSelection(null, honeybun).selection;
  const again = switchSelection(sel, { ...honeybun });
  assert.equal(again.invalidate, false);
  assert.equal(again.selection, sel);
});

await check("a Piggy without an address can never become the money selection", () => {
  assert.equal(switchSelection(null, { id: "x" }).error, "missing_piggy_address");
  assert.equal(switchSelection(null, null).error, "missing_piggy");
});

// ── 2. Honeybun 봉투는 Mochi 가 선택된 동안 못 쓴다 ─────────────────────────────
await check("a permission issued for Honeybun's signer cannot be used while Mochi is selected", () => {
  const env = envelopeFor("honeybun", HONEY);
  const mochiSel = switchSelection(null, mochi).selection;
  const out = authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, context: selectionContext(mochiSel, MOCHI) });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "selected_piggy_mismatch");
  // Mochi 선택인데 Honeybun 서명자가 아직 살아 있어도 안 된다.
  const stale = authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, context: selectionContext(mochiSel, HONEY) });
  assert.equal(stale.ok, false);
});

await check("same piggyId but a different signer address is rejected", () => {
  const env = envelopeFor("honeybun", HONEY);
  const sel = switchSelection(null, honeybun).selection;
  assert.equal(authorize(env, reqFor("honeybun", MOCHI), { nowMs: NOW, context: selectionContext(sel, HONEY) }).reason, "signer_mismatch");
  assert.equal(authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, context: selectionContext(sel, MOCHI) }).reason, "active_signer_mismatch");
});

await check("same signer address but a different piggyId is rejected", () => {
  const env = envelopeFor("honeybun", HONEY);
  const sel = switchSelection(null, honeybun).selection;
  assert.equal(authorize(env, reqFor("mochi", HONEY), { nowMs: NOW, context: selectionContext(sel, HONEY) }).reason, "piggy_mismatch");
  const wrongSel = Object.freeze({ id: "honeybun", address: MOCHI });
  assert.equal(authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, context: selectionContext(wrongSel, HONEY) }).reason, "selected_address_mismatch");
});

await check("the correct Piggy + signer + request still passes (the gate is not just closed)", () => {
  const env = envelopeFor("honeybun", HONEY);
  const sel = switchSelection(null, honeybun).selection;
  assert.equal(authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, context: selectionContext(sel, HONEY) }).ok, true);
});

await check("switching away and back does not revive a revoked, consumed or expired permission", () => {
  const used = new Set();
  const env = envelopeFor("honeybun", HONEY);
  let sel = switchSelection(null, honeybun).selection;
  const away = switchSelection(sel, mochi, { heldEnvelope: env });
  if (away.revokeNonce) used.add(away.revokeNonce);
  sel = switchSelection(away.selection, honeybun).selection;
  assert.equal(authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, consumedNonces: used, context: selectionContext(sel, HONEY) }).reason, "permission_already_used");
  const env2 = envelopeFor("honeybun", HONEY);
  const used2 = new Set();
  consume(env2, used2);
  assert.equal(authorize(env2, reqFor("honeybun", HONEY), { nowMs: NOW, consumedNonces: used2, context: selectionContext(sel, HONEY) }).ok, false);
  assert.equal(authorize(envelopeFor("honeybun", HONEY), reqFor("honeybun", HONEY), { nowMs: NOW + 10 * 60 * 1000, context: selectionContext(sel, HONEY) }).reason, "permission_expired");
});

// ── 3. 결합이 없으면 닫힌다 ─────────────────────────────────────────────────────
await check("no signer binding means no envelope, and no selection context means no authorization", () => {
  const i = intentFor("honeybun", undefined);
  assert.equal(issuePermission({ intent: i, auth, nonce: "n", nowMs: NOW }).error, "missing_signer");
  const env = envelopeFor("honeybun", HONEY);
  assert.equal(authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW }).reason, "no_selection_context");
  assert.equal(authorize(env, reqFor("honeybun", HONEY), { nowMs: NOW, context: selectionContext(null, HONEY) }).reason, "no_selection_context");
});

await check("a missing locator refuses to ask for Face ID at all — no global credential fallback", () => {
  assert.equal(authRequestForPiggy({ id: "mochi", address: MOCHI }).error, "missing_locator");
  assert.equal(authRequestForPiggy({ id: "mochi", address: MOCHI, locator: { credentialId: "" } }).error, "invalid_credential_id");
  assert.equal(authRequestForPiggy({ id: "mochi" }).error, "missing_piggy_address");
  assert.equal(normalizeLocator({ credentialId: "x", prfSalt: "zz" }).error, "invalid_prf_salt");
});

await check("the auth request carries exactly that Piggy's credential (and its salt when it has one)", () => {
  const h = authRequestForPiggy(honeybun).request;
  assert.equal(h.credential.credentialId, "aG9uZXk");
  assert.deepEqual(h.credential.transports, ["internal"]);
  assert.equal("prfSalt" in h, false);                  // 기본 salt Piggy — 필드 없음 = Mera 기본
  const m = authRequestForPiggy(mochi).request;
  assert.equal(m.credential.credentialId, "bW9jaGk");
  assert.deepEqual([...m.prfSalt], new Array(32).fill(7));
});

await check("a signer derived from the wrong credential is refused even if the global slot was overwritten", () => {
  // 전역 credential 이 Honeybun 으로 덮여 있어도, Mochi 선택에서 나온 서명자가 Honeybun 주소면 멈춘다.
  const sel = switchSelection(null, mochi).selection;
  assert.equal(bindSigner(sel, HONEY).reason, "signer_mismatch");
  assert.equal(bindSigner(sel, MOCHI).ok, true);
  assert.equal(bindSigner(null, MOCHI).reason, "no_selection");
});

await check("locator is stored as non-secret metadata only", () => {
  const { piggy } = normalizePiggy({ id: "mochi", address: MOCHI, locator: { ...mochi.locator, prfOutput: "x", privateKey: "y" } });
  assert.equal(piggy, null); // 비밀 냄새 필드가 있으면 레코드 자체를 거부(A-484 규칙)
  const ok = normalizePiggy({ id: "mochi", address: MOCHI, locator: mochi.locator }).piggy;
  assert.deepEqual(Object.keys(ok.locator).sort(), ["credentialId", "prfSalt", "transports"]);
});

// ── 4. prfSalt 재오픈 — 실제 Mera 경로 ─────────────────────────────────────────
const secret = crypto.randomBytes(32); // 이 실행에서만 산다 — 출력·저장 0
function fakeWebAuthn(label) {
  const prfFor = (salt) => new Uint8Array(crypto.createHmac("sha256", secret).update(label).update(Buffer.from(salt)).digest());
  return {
    async createCredential() { throw new Error("not used"); },
    async getCredential(req) {
      if (!(req?.prfSalt instanceof Uint8Array) || req.prfSalt.length !== 32) throw new Error("prfSalt must be 32 bytes");
      return { credentialId: new Uint8Array(Buffer.from(label)), prfOutput: prfFor(req.prfSalt) };
    },
  };
}
const addressOf = (prfOutput) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prfOutput }).publicKey);

await check("a non-default prfSalt locator reopens with that salt and yields that Piggy's address — not the default-salt address", async () => {
  const client = fakeWebAuthn("mochi");
  const salt = prfSaltFromHex(mochi.locator.prfSalt);
  const born = addressOf((await getPasskeyPrfOutput({ rpId: "araso-harness.local.test", prfSalt: salt, webAuthnClient: client })).prfOutput);
  const req = authRequestForPiggy({ ...mochi, address: born }).request;
  const reopened = addressOf((await getPasskeyPrfOutput({
    rpId: "araso-harness.local.test", credential: req.credential, prfSalt: req.prfSalt, webAuthnClient: client,
  })).prfOutput);
  assert.equal(reopened, born);
  const defaultSalt = addressOf((await getPasskeyPrfOutput({ rpId: "araso-harness.local.test", webAuthnClient: client })).prfOutput);
  assert.notEqual(defaultSalt, born, "default salt must not silently stand in for the Piggy's salt");
  assert.equal(bindSigner(Object.freeze({ id: "mochi", address: born }), reopened).ok, true);
  assert.equal(bindSigner(Object.freeze({ id: "mochi", address: born }), defaultSalt).reason, "signer_mismatch");
});

// ── 5. main.js 배선 ────────────────────────────────────────────────────────────
const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const fnBody = (name) => { const i = code.indexOf(`function ${name}(`); return code.slice(i, code.indexOf("\n}\n", i)); };

await check("money permission asks with the selected Piggy's locator, never the global credential slot", () => {
  const body = fnBody("requestMoneyPermission");
  assert.match(body, /authRequestForPiggy\(selectedRegistryPiggy\(\)\)/);
  assert.match(body, /requestPrf\(request\.credential, \{ prfSalt: request\.prfSalt \?\? null \}\)/);
  assert.equal(body.includes("state.credential"), false);
  assert.match(body, /bindSigner\(sel, signerAddress\)/);
  assert.match(body, /signerAddress: bound\.signerAddress/);
  assert.match(body, /persistAddress: false/);         // 한 마리 경로의 저장 scope 를 건드리지 않는다
});

await check("authorization passes the live selection + signer context", () => {
  assert.match(fnBody("authorizeMoneyAction"), /context: selectionContext\(state\.selectedPiggy,/);
});

await check("selecting a Piggy row goes through the invalidating switch", () => {
  const body = fnBody("applyPiggySelection");
  assert.match(body, /switchSelection\(state\.selectedPiggy, piggy/);
  assert.match(body, /endActiveSession\(\)/);
  assert.match(body, /consumedPermissionNonces\.add\(out\.revokeNonce\)/);
  assert.match(body, /state\.moneyIntent = null/);
  // [A-522] 선택 목록 = 레지스트리 + MY PIGGIES 색인 병합(locator 는 색인에서) — 여전히 전환 경유
  assert.match(code, /applyPiggySelection\(moneyPiggiesSnapshot\(\)\.piggies\.find/);
});

await check("reopen reads the stored prfSalt instead of silently defaulting", () => {
  const body = fnBody("recoverPiggy");
  assert.match(body, /const prfSalt = storedPrfSalt\(\)/);
  assert.match(body, /requestPrf\(pinned, \{ prfSalt \}\)/);
  assert.match(body, /requestPrf\(null, \{ prfSalt \}\)/);
});

await check("the First single-Piggy path still persists its address exactly as before", () => {
  // openPiggy / recoverPiggy 는 기본값(persistAddress=true)으로 부른다 — 한 마리 흐름 무변경.
  assert.match(fnBody("openPiggy"), /activateSigningSession\(result\.prfOutput\)/);
  assert.match(fnBody("recoverPiggy"), /activateSigningSession\(result\.prfOutput\)/);
  assert.match(fnBody("activateSigningSession"), /if \(persistAddress\) \{\n\s+localStorage\.setItem\("araso\.address", address\);\n\s+state\.address = address;/);
});

console.log(`\n${pass}/${pass} PASS`);
