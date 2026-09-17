import assert from "node:assert/strict";
import {
  FIRST_JOB_RECEIPT,
  SHMON_CURRENT_EVIDENCE,
  STATUS,
  buildDestinationFixtures,
  buildSecondJobCandidateFeed,
  buildVisibleLaneChoices,
  deriveDestinationStatus,
  runSecondJobFlow,
  selectSecondJobCandidates,
} from "../src/job-feed.js";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("feed is gated after the A-174 first shMON receipt", () => {
  assert.equal(FIRST_JOB_RECEIPT.sourceTask, "A-174");
  assert.equal(FIRST_JOB_RECEIPT.action, "first_job_shmon_roundtrip");
  assert.equal(FIRST_JOB_RECEIPT.finalShmonBalance, "0");
});

check("current shMON evidence remains explicit but is no longer the visible second-job feed", () => {
  assert.equal(SHMON_CURRENT_EVIDENCE.sourceTask, "A-188");
  assert.equal(SHMON_CURRENT_EVIDENCE.block, 61250600);
  assert.match(SHMON_CURRENT_EVIDENCE.contract, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(SHMON_CURRENT_EVIDENCE.role, "first_job_receipt_evidence_only");
});

check("visible feed returns three lane intents", () => {
  const feed = buildSecondJobCandidateFeed();
  assert.deepEqual(feed.map((job) => job.label), [
    "시장 다녀오기",
    "주문 걸고 오기",
    "지갑 청소하기",
    "받을 것 받아오기",
    "자산 조각 가져오기",
    "돈 좀 일시키고 오기",
    "다른 자리로 옮기기",
    "집에 있기",
  ]);
  assert.equal(feed.every((job) => job.kind === "errand_intent"), true);
  assert.equal(feed.some((job) => /preview|redeem|capacity/i.test(job.id + job.label)), false);
});

check("selector can rank Explore errands without admitting protocol destinations", () => {
  const { selected, rejected } = selectSecondJobCandidates({ novelty: 0.2 });
  assert.equal(selected.length, 3);
  assert.deepEqual(new Set(selected.map((job) => job.kind)), new Set(["errand_intent"]));
  assert.deepEqual(rejected, []);
});

check("destination pool is separate from visible lanes", () => {
  const lanes = buildVisibleLaneChoices();
  const destinations = buildDestinationFixtures();
  assert.equal(lanes.length, 8);
  assert.equal(destinations.length, 4);
  assert.equal(destinations.every((destination) => destination.destinationKind === "destination_job_fixture"), true);
  assert.equal(lanes.every((lane) => lane.destinationId === null), true);
});

check("status derivation distinguishes funding, waiting, conditional, and rule nah", () => {
  const [aave, kintsu, swap, merkl] = buildDestinationFixtures();
  assert.equal(deriveDestinationStatus(aave, { returnTolerance: "few_days" }).status, STATUS.JOB_ELIGIBLE_NEEDS_FUNDING);
  assert.equal(deriveDestinationStatus(kintsu, { returnTolerance: "few_days" }).status, STATUS.JOB_WAITING_RETURN);
  assert.equal(deriveDestinationStatus(kintsu, { returnTolerance: "right_back" }).reasonCode, "rule_nah");
  assert.equal(deriveDestinationStatus(swap, { returnTolerance: "few_days" }).status, STATUS.JOB_ELIGIBLE_NEEDS_FUNDING);
  assert.equal(deriveDestinationStatus(merkl, { returnTolerance: "few_days" }).status, STATUS.JOB_CONDITIONAL);
});

check("legacy runSecondJobFlow entrypoint now returns the second Journey harness", () => {
  const flow = runSecondJobFlow({ selectedErrandIds: ["grow"], jitAnswer: "few_days" });
  assert.ok(flow.visibleChoices.some((choice) => choice.label === "돈 좀 일시키고 오기"));
  assert.equal(flow.mockReceipt.txExecuted, false);
  assert.ok(flow.destinations.some((destination) => destination.derivedStatus === STATUS.JOB_WAITING_RETURN));
});

console.log(`\n${pass}/${pass} PASS`);
