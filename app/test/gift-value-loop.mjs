// [A-499 Lane G] **Gift value loop** 계약 — 네트워크 0 · 체인 0 · tx 0.
//   node app/test/gift-value-loop.mjs
//
// 이 파일은 값을 옮기지 않는다. 두 가지만 지킨다:
//
//  1) `gift-piggy-claim-link.js` 의 **영수증 문**이 여전히 닫혀 있는가 —
//     가짜 영수증·로컬 라벨·"성공했을 것"으로는 `value_transferred` 에 못 간다.
//  2) 하네스가 남긴 실행 기록(`_private/ops/harness/gift-value-run.json`)이
//     **스스로 앞뒤가 맞는가** — 라벨·잔고 델타·재생 거부·브로드캐스트 0.
//     기록이 없으면 그렇다고 말하고 통과시키지 않는다(**없음을 성공으로 읽지 않는다**).
//     포크 실행 자체는 하네스에서만 돈다 — 저장소 테스트는 네트워크를 만지지 않는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PROOF_LEVEL, TRANSFER_STATUS, attachTransferReceipt, proofLevel,
  createClaimLink, sealClaimLink, settleClaim, isStorableLinkRecord,
} from "../src/gift-piggy-claim-link.js";

const RUN_PATH = fileURLToPath(new URL("../../_private/ops/harness/gift-value-run.json", import.meta.url));

const SENDER = "0x00000000000000000000000000000000000000a1";
const RECIPIENT = "0x00000000000000000000000000000000000000b2";
const T0 = "2026-09-21T09:00:00Z";
const T1 = "2026-09-21T10:00:00Z";

let pass = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
async function run() {
  for (const [name, fn] of cases) {
    try { await fn(); pass += 1; console.log(`PASS  ${name}`); }
    catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${pass}/${cases.length} PASS`);
}

async function claimedRecord() {
  const made = createClaimLink({ giftId: "g-499", senderAddress: SENDER, chainId: "10143", createdAt: T0 });
  const record = await sealClaimLink(made.record, made.token);
  const settled = await settleClaim(record, {
    token: made.token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT,
    claimedAt: T1, now: T1,
  });
  assert.equal(settled.result, "ok");
  return settled.record;
}

// ── 1. 영수증 문 ──────────────────────────────────────────────────────────────
test("a claim on its own still stops at identity — value is a separate axis", async () => {
  const record = await claimedRecord();
  assert.equal(record.transfer.status, TRANSFER_STATUS.NOT_ATTEMPTED);
  assert.equal(proofLevel(record), PROOF_LEVEL.IDENTITY_CLAIMED_NO_VALUE_MOVED);
});

test("a receipt without a real tx hash, block or success never opens the value door", async () => {
  const record = await claimedRecord();
  assert.equal(attachTransferReceipt(record, {}).reason, "no_real_tx_hash");
  assert.equal(attachTransferReceipt(record, { txHash: "local-fork-ok" }).reason, "no_real_tx_hash");
  assert.equal(attachTransferReceipt(record, { txHash: `0x${"a".repeat(64)}` }).reason, "no_block_number");
  assert.equal(attachTransferReceipt(record, { txHash: `0x${"a".repeat(64)}`, blockNumber: 0 }).reason, "no_block_number");
  assert.equal(attachTransferReceipt(record, { txHash: `0x${"a".repeat(64)}`, blockNumber: 7, status: "pending" }).reason, "tx_not_successful");
  assert.equal(attachTransferReceipt(record, { txHash: `0x${"a".repeat(64)}`, blockNumber: 7, status: "reverted" }).reason, "tx_not_successful");
});

test("a real mined receipt, and only that, reaches value_transferred", async () => {
  const record = await claimedRecord();
  const ok = attachTransferReceipt(record, { txHash: `0x${"a".repeat(64)}`, blockNumber: 64411191, status: "success" });
  assert.equal(ok.ok, true);
  assert.equal(proofLevel(ok.record), PROOF_LEVEL.VALUE_TRANSFERRED);
  assert.equal(isStorableLinkRecord(ok.record), true);
});

// ── 2. 하네스 실행 기록 ───────────────────────────────────────────────────────
// Public checkout (no local harness workspace): §2 is SKIP, never PASS. Locally, an absent run still fails.
const SECTION_2_START = cases.length;
test("the fork run evidence exists — an absent run is not a pass", () => {
  assert.equal(existsSync(RUN_PATH), true,
    `no harness run at ${RUN_PATH} — run: node _private/ops/harness/gift-value-loop.mjs`);
});

const runData = existsSync(RUN_PATH) ? JSON.parse(readFileSync(RUN_PATH, "utf8")) : null;
const need = (t) => { assert.ok(runData, "no harness run recorded"); return t(runData); };

test("the run names the exact recovered contract, not a lookalike", () => need((r) => {
  assert.equal(r.recovery.deployedAddress.toLowerCase(), "0xfe7668db837337c34c10f1a529998e468cb71ae0");
  assert.equal(r.recovery.chainId, 10143);
  assert.equal(r.recovery.artifactRuntimeSha256, r.recovery.recordedRuntimeSha256);
  assert.equal(r.steps.codeIdentity.byteIdenticalToArtifact, true);
  assert.equal(r.steps.codeIdentity.forkRuntimeSha256, r.recovery.recordedRuntimeSha256);
}));

test("nothing was broadcast to a real network", () => need((r) => {
  assert.equal(r.network.kind, "anvil_local_fork");
  assert.equal(r.network.broadcastToRealNetwork, false);
  assert.equal(r.checks.noRealNetworkBroadcast, true);
  assert.notEqual(r.verdict, "PASS_TESTNET_TX");
  assert.notEqual(r.verdict, "PASS_MAINNET_TX");
}));

test("local funding is labelled as setup, never as ownership or real funding", () => need((r) => {
  assert.ok(/증명 아님|not .*proof/i.test(r.labels.SETUP_FIXTURE.meaning));
  assert.equal(r.checks.recipientStartsWithNoForkFixtureFunding, true,
    "the recipient must start empty, or the balance delta proves nothing");
}));

test("recipient ownership is an actual signature, as in A-495", () => need((r) => {
  assert.equal(r.checks.recipientSignatureRecoversToRecipient, true);
  assert.equal(r.checks.recipientSignatureVerifies, true);
  assert.equal(r.checks.claimClosedByRealSignature, true);
  assert.equal(r.checks.impersonationStillRefused, true);
  assert.equal(r.labels.OWNERSHIP_PROOF.recipient, r.steps.claim.recipient);
}));

test("identity alone was recorded as moving nothing", () => need((r) => {
  assert.equal(r.steps.identityClaim.proofLevelAfterIdentityOnly, PROOF_LEVEL.IDENTITY_CLAIMED_NO_VALUE_MOVED);
  assert.equal(r.steps.identityClaim.transferStatus, TRANSFER_STATUS.NOT_ATTEMPTED);
}));

test("the recipient balance delta is exactly gift plus grant, from a mined tx", () => need((r) => {
  const c = r.steps.claim;
  assert.equal(c.status, "success");
  assert.equal(c.balanceBeforeWei, "0");
  assert.equal(c.deltaWei, c.expectedDeltaWei);
  assert.equal(BigInt(c.deltaWei), BigInt(r.steps.deposit.amountWei) + 200000000000000000n);
  assert.match(c.txHash, /^0x[0-9a-fA-F]{64}$/);
  assert.ok(Number.isInteger(c.blockNumber) && c.blockNumber > 0);
}));

test("the record's transfer cell carries that same real receipt", () => need((r) => {
  assert.equal(r.steps.finalRecord.proofLevel, PROOF_LEVEL.VALUE_TRANSFERRED);
  assert.equal(r.steps.finalRecord.transfer.status, TRANSFER_STATUS.SETTLED);
  assert.equal(r.steps.finalRecord.transfer.txHash, r.steps.claim.txHash);
  assert.equal(r.steps.finalRecord.transfer.blockNumber, r.steps.claim.blockNumber);
  assert.notEqual(
    r.steps.finalRecord.senderAddress.toLowerCase(),
    r.steps.finalRecord.recipientAddress.toLowerCase(),
  );
}));

test("the same claim cannot be replayed, and the destination cannot be swapped", () => need((r) => {
  assert.equal(r.steps.replay.refused, true);
  assert.equal(r.checks.recipientRebindRefused, true);
}));

test("an expired gift refuses the claim and returns to the sender", () => need((r) => {
  assert.equal(r.checks.expiredGiftCannotBeClaimed, true);
  assert.equal(r.steps.refund.status, "success");
  assert.equal(r.steps.refund.refundedEventAmountWei, r.steps.refund.expectedWei);
  assert.equal(BigInt(r.steps.refund.escrowDeltaWei), -BigInt(r.steps.refund.expectedWei));
  assert.equal(r.steps.refund.giftMarkedSpent, true);
}));

test("no secret is anywhere in the run record", () => need((r) => {
  assert.equal(r.checks.noSecretInOutput, true);
  const text = JSON.stringify(r);
  assert.equal(/privateKey|prfOutput|mnemonic|passkeySecret/i.test(text), false);
  assert.equal(/"0x[0-9a-fA-F]{64}"\s*:/.test(text), false);
}));

test("the verdict is the fork label and every required check holds", () => need((r) => {
  assert.deepEqual(r.missing, []);
  assert.equal(r.verdict, "PASS_FORK_GIFT_VALUE_LOOP");
}));

if (!existsSync(fileURLToPath(new URL("../../_private", import.meta.url)))) {
  const skipped = cases.splice(SECTION_2_START);
  console.log(`SKIP  ${skipped.length} harness-run checks (§2) — local harness workspace absent (public checkout)`);
}
await run();
