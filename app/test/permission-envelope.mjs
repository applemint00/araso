// [A-492 Lane A → A-512 Gate C] 권한 봉투 계약 — 네트워크 0 · 체인 0 · 비밀값 0.
// A-512: 봉투는 signerAddress 를 묶고, authorize 는 지금의 선택/서명자 context 를 요구한다.
//   node app/test/permission-envelope.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PERMISSION_TTL_MS,
  PERMISSION_STATE,
  authorize,
  cancel,
  consume,
  issuePermission,
  onUnknownOutcome,
  permissionNonce,
} from "../src/permission-envelope.js";

const SRC = readFileSync(new URL("../src/permission-envelope.js", import.meta.url), "utf8");
const NOW = 1_800_000_000_000;
const DEST = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const SIGNER = "0x00000000000000000000000000000000000000c3"; // Honeybun 서명자
const CTX = { selectedPiggyId: "honeybun", selectedPiggyAddress: SIGNER, activeSignerAddress: SIGNER };
const intent = (over = {}) => ({
  piggyId: "honeybun", signerAddress: SIGNER, action: "send_money", asset: "USDC",
  amount: "2.5", chain: "monad-mainnet", destination: DEST, destinationRequired: true, ...over,
});
const auth = (over = {}) => ({ method: "passkey", verified: true, verifiedAt: NOW - 1000, credentialId: "cred-1", ...over });
const nonceOf = (i = intent()) => permissionNonce({ ...i, at: NOW });

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 인증 없이는 봉투가 없다 ──────────────────────────────────────────────────
check("no passkey auth means no permission, ever", () => {
  assert.equal(issuePermission({ intent: intent(), auth: null, nonce: nonceOf(), nowMs: NOW }).error, "no_passkey_auth");
  assert.equal(issuePermission({ intent: intent(), auth: { method: "password", verified: true, verifiedAt: NOW }, nonce: nonceOf(), nowMs: NOW }).error, "no_passkey_auth");
  assert.equal(issuePermission({ intent: intent(), auth: auth({ verified: false }), nonce: nonceOf(), nowMs: NOW }).error, "auth_not_verified");
});

check("a stale or future auth cannot mint permission", () => {
  assert.equal(issuePermission({ intent: intent(), auth: auth({ verifiedAt: NOW - DEFAULT_PERMISSION_TTL_MS - 1 }), nonce: nonceOf(), nowMs: NOW }).error, "auth_stale");
  assert.equal(issuePermission({ intent: intent(), auth: auth({ verifiedAt: NOW + 1000 }), nonce: nonceOf(), nowMs: NOW }).error, "auth_time_in_future");
});

check("no secret-like field may ride along with the auth", () => {
  for (const bad of [{ privateKey: "0x1" }, { prf: "x" }, { signingKey: "k" }, { seed: "s" }]) {
    const out = issuePermission({ intent: intent(), auth: auth(bad), nonce: nonceOf(), nowMs: NOW });
    assert.equal(out.envelope, null);
    assert.match(out.error, /^secret_like_field:/);
  }
});

check("the envelope itself carries no secret, only a credential id", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  const raw = JSON.stringify(envelope).toLowerCase();
  for (const word of ["privatekey", "prf", "secret", "seed", "mnemonic", "signature"]) {
    assert.equal(raw.includes(word), false, `envelope must not contain ${word}`);
  }
  assert.equal(envelope.credentialId, "cred-1");
});

// ── 2. 봉투는 정확한 한 행동만 담는다 ───────────────────────────────────────────
check("an envelope binds piggy, action, asset, exact amount, chain and destination", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  assert.equal(envelope.state, PERMISSION_STATE.PERMITTED);
  assert.equal(envelope.piggyId, "honeybun");
  assert.equal(envelope.action, "send_money");
  assert.equal(envelope.asset, "USDC");
  assert.equal(envelope.amount, "2.5");
  assert.equal(envelope.chain, "monad-mainnet");
  assert.equal(envelope.destination, DEST);
  assert.equal(envelope.expiresAt, NOW + DEFAULT_PERMISSION_TTL_MS);
});

check("`all` must be resolved to an exact amount before the envelope", () => {
  assert.equal(issuePermission({ intent: intent({ amount: "all" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "amount_not_exact");
  assert.equal(issuePermission({ intent: intent({ amount: "0" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "amount_not_exact");
  assert.equal(issuePermission({ intent: intent({ amount: "" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "amount_not_exact");
});

check("a destination-requiring action refuses a bad or missing address", () => {
  assert.equal(issuePermission({ intent: intent({ destination: "" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "destination_invalid");
  assert.equal(issuePermission({ intent: intent({ destination: "0x123" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "destination_invalid");
});

check("missing piggy, action, asset, chain or nonce all fail closed", () => {
  assert.equal(issuePermission({ intent: intent({ piggyId: "" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "missing_piggy");
  assert.equal(issuePermission({ intent: intent({ action: "" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "missing_action");
  assert.equal(issuePermission({ intent: intent({ asset: "" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "missing_asset");
  assert.equal(issuePermission({ intent: intent({ chain: "" }), auth: auth(), nonce: nonceOf(), nowMs: NOW }).error, "missing_chain");
  assert.equal(issuePermission({ intent: intent(), auth: auth(), nonce: "", nowMs: NOW }).error, "missing_nonce");
});

// ── 3. 범위가 어긋나면 실행되지 않는다 ──────────────────────────────────────────
check("a permission for one Piggy does not work for another", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  const req = { piggyId: "honeybun", signerAddress: SIGNER, action: "send_money", asset: "USDC", amount: "2.5", chain: "monad-mainnet", destination: DEST };
  assert.equal(authorize(envelope, req, { context: CTX, nowMs: NOW }).ok, true);
  assert.equal(authorize(envelope, { ...req, piggyId: "mochi" }, { context: CTX, nowMs: NOW }).reason, "piggy_mismatch");
});

check("action, asset, amount, chain and destination mismatches all fail closed", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  const req = { piggyId: "honeybun", signerAddress: SIGNER, action: "send_money", asset: "USDC", amount: "2.5", chain: "monad-mainnet", destination: DEST };
  assert.equal(authorize(envelope, { ...req, action: "bring_all_home" }, { context: CTX, nowMs: NOW }).reason, "action_mismatch");
  assert.equal(authorize(envelope, { ...req, asset: "AUSD" }, { context: CTX, nowMs: NOW }).reason, "asset_mismatch");
  assert.equal(authorize(envelope, { ...req, amount: "2.50001" }, { context: CTX, nowMs: NOW }).reason, "amount_mismatch");
  assert.equal(authorize(envelope, { ...req, chain: "monad-testnet" }, { context: CTX, nowMs: NOW }).reason, "chain_mismatch");
  assert.equal(authorize(envelope, { ...req, destination: OTHER }, { context: CTX, nowMs: NOW }).reason, "destination_mismatch");
});

check("an expired permission cannot be used", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  const req = { piggyId: "honeybun", signerAddress: SIGNER, action: "send_money", asset: "USDC", amount: "2.5", chain: "monad-mainnet", destination: DEST };
  assert.equal(authorize(envelope, req, { context: CTX, nowMs: NOW + DEFAULT_PERMISSION_TTL_MS + 1 }).reason, "permission_expired");
});

check("a used permission cannot be replayed", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  const req = { piggyId: "honeybun", signerAddress: SIGNER, action: "send_money", asset: "USDC", amount: "2.5", chain: "monad-mainnet", destination: DEST };
  const used = new Set();
  assert.equal(authorize(envelope, req, { context: CTX, nowMs: NOW, consumedNonces: used }).ok, true);
  consume(envelope, used);
  assert.equal(authorize(envelope, req, { context: CTX, nowMs: NOW, consumedNonces: used }).reason, "permission_already_used");
});

// ── 4. 취소/실패/미지 결과 ──────────────────────────────────────────────────────
check("cancelling changes nothing", () => {
  const out = cancel();
  assert.equal(out.state, PERMISSION_STATE.CANCELLED);
  assert.equal(out.envelope, null);
  assert.equal(out.mutated, false);
});

check("an unknown outcome never auto-retries", () => {
  const { envelope } = issuePermission({ intent: intent(), auth: auth(), nonce: nonceOf(), nowMs: NOW });
  const out = onUnknownOutcome(envelope);
  assert.equal(out.retry, false);
  assert.equal(out.action, "reconcile_first");
});

// ── 5. 봉투는 오직 인증에서만 나온다 (소스 규율) ────────────────────────────────
check("nothing but a verified passkey can mint an envelope", () => {
  // 봉투를 만드는 유일한 경로가 issuePermission 이고, 그 안에 auth 검사가 먼저 온다
  const body = SRC.slice(SRC.indexOf("export function issuePermission"), SRC.indexOf("export function authorize"));
  assert.match(body, /if \(!auth \|\| auth\.method !== "passkey"\) return invalid\("no_passkey_auth"\)/);
  // PERMITTED 를 만드는 자리가 이 함수 하나뿐이다
  const permittedAssignments = SRC.split("PERMISSION_STATE.PERMITTED").length - 1;
  assert.ok(permittedAssignments <= 3, "PERMITTED should only appear in issue + authorize guard + enum");
});

check("the module never signs, sends or reads a key", () => {
  for (const banned of ["writeContract", "sendTransaction", "signMessage", "signTypedData", "privateKey", "createSecp256k1"]) {
    assert.equal(SRC.includes(banned), false, `permission module must not contain ${banned}`);
  }
});

check("the same intent yields the same nonce, a different one does not", () => {
  assert.equal(nonceOf(), nonceOf());
  assert.notEqual(nonceOf(), permissionNonce({ ...intent({ amount: "3" }), at: NOW }));
});

console.log(`\n${pass}/${pass} PASS`);
