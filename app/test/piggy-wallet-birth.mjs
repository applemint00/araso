// [A-493 Lane B] 지갑 탄생 계약 — 격리 하네스 · 네트워크 0 · 실거래 0.
//   node app/test/piggy-wallet-birth.mjs
// 하네스 스크립트를 **그대로 실행**해 결과를 검사한다(로직 재작성 0).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

// Public checkout: every check here runs the local-only isolated harness. Without it, SKIP (not PASS).
if (!existsSync(privatePath())) {
  console.log("SKIP  piggy-wallet-birth — local isolated harness absent (public checkout); 0 checks run");
  process.exit(0);
}
const SCRIPT = privatePath("ops/harness/piggy-wallet-birth.mjs");
const SRC = readFileSync(SCRIPT, "utf8");
const raw = execFileSync("node", [SCRIPT], { encoding: "utf8", timeout: 120000 });
const out = JSON.parse(raw);

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("the proof runs in the isolated harness rpId, never production", () => {
  assert.equal(out.rpId, "araso-harness.local.test");
  assert.equal(out.productionRpIdUsed, false);
  assert.equal(SRC.includes('"araso.app"') && SRC.includes("PRODUCTION_RP_ID"), true);
  // production rpId 를 실제로 쓰는 경로가 없다
  assert.equal(/rp: \{ id: PRODUCTION_RP_ID/.test(SRC), false);
});

check("three wallets are born with three distinct addresses", () => {
  assert.equal(out.piggies.length, 3);
  const addrs = out.piggies.map((p) => p.address.toLowerCase());
  assert.equal(new Set(addrs).size, 3);
  for (const a of addrs) assert.match(a, /^0x[0-9a-f]{40}$/);
  assert.equal(out.checks.distinctAddresses, true);
});

check("each Piggy has its own credential, not a shared one", () => {
  const fps = out.piggies.map((p) => p.credentialFingerprint);
  assert.equal(new Set(fps).size, 3);
});

check("every wallet actually signs through the product auth stack", () => {
  assert.equal(out.signatures.length, 3);
  for (const s of out.signatures) {
    assert.equal(s.verified, true, `${s.name} must verify`);
    assert.equal(s.recoveredMatchesAddress, true, `${s.name} signature must recover to its own address`);
    assert.equal(s.signatureLength, 132); // 65-byte secp256k1 signature as hex
  }
  assert.equal(out.checks.allSigned, true);
});

check("one Piggy's signature does not validate for another Piggy", () => {
  assert.equal(out.checks.signatureDoesNotValidateForOtherPiggy, true);
});

check("reopening the same credential yields the same wallet that can still sign", () => {
  assert.equal(out.checks.reopenSameAddress, true);
  assert.equal(out.checks.reopenCanStillSign, true);
});

check("no secret, PRF output or private key appears in the result", () => {
  assert.equal(out.checks.noSecretInOutput, true);
  const s = JSON.stringify(out).toLowerCase();
  for (const word of ["privatekey", "prfoutput", "mnemonic", "seed", "secret:"]) {
    assert.equal(s.includes(word), false, `output must not contain ${word}`);
  }
});

check("ownership is proven by signing, not by impersonation", () => {
  // anvil 가장 호출이 이 증명에 전혀 쓰이지 않는다
  for (const banned of ["anvil_impersonateAccount", "anvil_setBalance", "eth_sendTransaction"]) {
    assert.equal(SRC.includes(banned), false, `wallet birth proof must not use ${banned}`);
  }
  assert.equal(out.realTx, 0);
  assert.equal(out.realFunding, 0);
});

check("the harness verdict is the wallet-birth PASS", () => {
  assert.equal(out.verdict, "PASS_MAKE_PIGGY_REAL_WALLET_HARNESS");
});

console.log(`\n${pass}/${pass} PASS`);
