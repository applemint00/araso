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
  runSecondJourney,
  selectSecondJobCandidates,
} from "../src/job-feed.js";
import { readFileSync } from "node:fs";
import { readDestinationReturnEvidence } from "../src/second-job-readiness.js";

// [A-476] buildDestinationFixtures 는 이제 현재 Piggy context 를 **런타임에서** 받는다.
// 제품 코드에 주소 상수가 없으므로 테스트가 주입한다 — 이 값은 테스트 전용이다.
const TEST_RUNTIME_CONTEXT = { address: "0x00000000000000000000000000000000000000a1", chain: "monad-testnet" };


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
  const destinations = buildDestinationFixtures(TEST_RUNTIME_CONTEXT);
  assert.equal(lanes.length, 8);
  assert.equal(destinations.length, 4);
  assert.equal(destinations.every((destination) => destination.destinationKind === "destination_job_fixture"), true);
  assert.equal(lanes.every((lane) => lane.destinationId === null), true);
});

check("status derivation distinguishes funding, waiting, conditional, and rule nah", () => {
  const [aave, kintsu, swap, merkl] = buildDestinationFixtures(TEST_RUNTIME_CONTEXT);
  assert.equal(deriveDestinationStatus(aave, { returnTolerance: "few_days" }).status, STATUS.JOB_ELIGIBLE_NEEDS_FUNDING);
  // [A-579] was JOB_WAITING_RETURN/return_waiting_accepted: few_days on a delayed Job whose
  // duration is not published is not checkable -> unknown, action 0 (never accepted blind).
  assert.equal(deriveDestinationStatus(kintsu, { returnTolerance: "few_days" }).status, STATUS.JOB_OPEN);
  assert.equal(deriveDestinationStatus(kintsu, { returnTolerance: "few_days" }).reasonCode, "return_duration_unknown");
  assert.equal(deriveDestinationStatus(kintsu, { returnTolerance: "right_back" }).reasonCode, "rule_nah");
  assert.equal(deriveDestinationStatus(swap, { returnTolerance: "few_days" }).status, STATUS.JOB_ELIGIBLE_NEEDS_FUNDING);
  assert.equal(deriveDestinationStatus(merkl, { returnTolerance: "few_days" }).status, STATUS.JOB_CONDITIONAL);
});

check("legacy runSecondJobFlow entrypoint now returns the second Journey harness", () => {
  const flow = runSecondJobFlow({ selectedErrandIds: ["grow"], jitAnswer: "few_days" });
  assert.ok(flow.visibleChoices.some((choice) => choice.label === "돈 좀 일시키고 오기"));
  assert.equal(flow.mockReceipt.txExecuted, false);
  // [A-579] was derivedStatus JOB_WAITING_RETURN for few_days on Kintsu (duration unknown -> unknown now).
  assert.ok(flow.destinations.some((destination) => destination.decision.reasonCode === "return_duration_unknown" && destination.decision.action === "none"));
});

// ── [A-576] actual flow binding: Explore "grow" -> Kintsu destination -> JIT right_back ──
// The selection below is a LOCAL/FIXTURE USER-SELECTION: a deterministic product-flow
// event for a local proof. It is not an Owner financial choice and creates no permission.
const LOCAL_SELECTION = "LOCAL/FIXTURE USER-SELECTION";
const KINTSU_DEST = "kintsu-like-grow-delayed-return";
const SCOPE = { accountId: TEST_RUNTIME_CONTEXT.address, chainId: "monad-testnet" };
function flowWith(extra = {}) {
  return runSecondJourney({
    scope: SCOPE,
    selectionKind: "one",
    selectedErrandIds: ["grow"],
    preferredDestinationId: KINTSU_DEST,
    selectionSource: LOCAL_SELECTION,
    eventId: "a576-local-selection-1",
    now: "2026-09-24T00:00:00Z",
    nowMs: Date.parse("2026-09-24T12:00:00Z"),
    ...extra,
  });
}
const kintsuOf = (flow) => flow.destinations.find((d) => d.id === KINTSU_DEST);

check("A-576 the destination the user reaches is bound to the real kintsu-smon record (no placeholder)", () => {
  const kintsu = kintsuOf(flowWith());
  assert.equal(kintsu.boundJobId, "kintsu-smon");
  assert.deepEqual(kintsu.returnEvidence, readDestinationReturnEvidence("kintsu-smon"));
  assert.equal(kintsu.evidenceState.boundJobId, "kintsu-smon");
  assert.equal(kintsu.evidenceState.evidenceLabel, "PASS_FORK_SIM_WITH_PENDING");
  assert.equal(kintsu.evidenceState.evidence.some((line) => /placeholder/i.test(line)), false);
  assert.equal(kintsu.capabilityContext.returnModel.type, "delayed");
  assert.equal(kintsu.capabilityContext.returnModel.maxWait, null);
  assert.equal(kintsu.capabilityContext.returnModel.upperBound, "UNKNOWN");
});

check("A-576 Explore-visible vs Send-visible boundary is preserved (never READY, never permission)", () => {
  const flow = flowWith({ jitAnswer: "right_back" });
  const kintsu = kintsuOf(flow);
  assert.equal(kintsu.capabilityStatus, STATUS.JOB_OPEN);
  assert.notEqual(flow.preflight.status, "JOB_READY");
  assert.equal(flow.preflight.executionPermission, false);
  assert.equal(flow.txExecuted, false);
  assert.equal(buildVisibleLaneChoices().every((lane) => lane.destinationId === null), true);
  // The other fixtures keep their existing labels. None of them was relabeled READY.
  const others = buildDestinationFixtures(TEST_RUNTIME_CONTEXT).filter((d) => d.id !== KINTSU_DEST);
  assert.equal(others.some((d) => d.boundJobId), false);
  assert.equal(others.some((d) => d.capabilityStatus === STATUS.JOB_READY), false);
});

check("A-576 fresh delayed evidence + right_back -> nah, action 0, provenance survives into the Receipt", () => {
  const flow = flowWith({ jitAnswer: "right_back" });
  const kintsu = kintsuOf(flow);
  assert.equal(kintsu.derivedStatus, STATUS.NAH);
  assert.equal(kintsu.decision.reasonCode, "rule_nah");
  assert.equal(kintsu.decision.action, "none");
  assert.equal(kintsu.decision.semantic.reason, "semantic_return_mismatch");
  const r = flow.decisionReceipt;
  assert.equal(r.decision, "nah");
  assert.equal(r.expected, "right_back");
  assert.equal(r.found, "delayed");
  assert.equal(r.did, "nothing");
  assert.equal(r.action, "none");
  assert.equal(r.actionCount, 0);
  assert.equal(r.txExecuted, false);
  assert.match(r.why, /expected "right_back", found "delayed"/);
  assert.equal(r.jobId, "kintsu-smon");
  assert.equal(r.evidence.observedAt, "2026-09-24");
  assert.equal(r.evidence.block, 107556248);
  assert.equal(r.evidence.provenance.contract, "0xA3227C5969757783154C60bF0bC1944180ed81B9");
  assert.equal(r.evidence.provenance.chainId, 143);
  assert.equal(r.evidence.provenance.forkEvidence.block, 106616273);
  assert.equal(r.evidence.provenance.liveRead.sourceTask, "A-571");
  assert.equal(r.evidence.provenance.expectedDuration, null);
  assert.match(r.evidence.source, /kintsu-smon/);
});

check("A-576 selection is labeled LOCAL/FIXTURE and never an Owner financial choice / permission", () => {
  const r = flowWith({ jitAnswer: "right_back" }).decisionReceipt;
  assert.equal(r.selection.source, LOCAL_SELECTION);
  assert.equal(r.selection.ownerFinancialChoice, false);
  assert.equal(r.selection.createsPermission, false);
  assert.equal(r.selection.semanticScope, "this_selection_event_only");
  for (const key of ["permission", "executionPermission", "agreedRule", "txHash", "signature"]) assert.equal(key in r, false);
  // Without a caller label the source is never inferred.
  assert.equal(flowWith({ jitAnswer: "right_back", selectionSource: undefined }).decisionReceipt.selection.source, "UNKNOWN_SELECTION_SOURCE");
});

check("A-576 ambiguous evidence -> ask (not nah), action ask, Receipt action 0", () => {
  const ambiguous = { ...readDestinationReturnEvidence("kintsu-smon"), returnClass: "same_session", source: "FIXTURE ambiguous evidence" };
  const flow = flowWith({ jitAnswer: "right_back", destinationOverrides: { [KINTSU_DEST]: { returnEvidence: ambiguous } } });
  const kintsu = kintsuOf(flow);
  assert.notEqual(kintsu.derivedStatus, STATUS.NAH);
  assert.equal(kintsu.decision.action, "ask");
  assert.equal(kintsu.decision.semantic.reason, "semantic_return_ambiguous");
  assert.equal(flow.decisionReceipt.decision, "ask");
  assert.equal(flow.decisionReceipt.actionCount, 0);
});

check("A-576 missing / stale / conflicting evidence -> unknown (not nah), action 0", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const obs = { source: "FIXTURE read-only observation", observedAt: "2026-09-24T11:59:00Z", chainId: 143, block: 107600000, codePresent: true, exitMode: "delayed" };
  const cases = [
    ["missing", { destinationOverrides: { [KINTSU_DEST]: { returnEvidence: null } } }, "missing_evidence"],
    ["stale", { returnObservations: { "kintsu-smon": { ...obs, expiresAtMs: now } } }, "stale_evidence"],
    ["conflict", { returnObservations: { "kintsu-smon": { ...obs, codePresent: false } } }, "source_conflict"],
  ];
  for (const [label, extra, reason] of cases) {
    const flow = flowWith({ jitAnswer: "right_back", ...extra });
    const kintsu = kintsuOf(flow);
    assert.notEqual(kintsu.derivedStatus, STATUS.NAH, label);
    assert.equal(kintsu.decision.reasonCode, "return_evidence_unknown", label);
    assert.equal(kintsu.decision.action, "none", label);
    assert.equal(kintsu.decision.semantic.reason, reason, label);
    assert.equal(flow.decisionReceipt.decision, "unknown", label);
    assert.equal(flow.decisionReceipt.actionCount, 0, label);
  }
  // A fresh, consistent observation keeps nah.
  const fresh = flowWith({ jitAnswer: "right_back", returnObservations: { "kintsu-smon": obs } });
  assert.equal(kintsuOf(fresh).derivedStatus, STATUS.NAH);
  assert.equal(fresh.decisionReceipt.evidence.evidenceMode, "live_observation");
});

check("A-576 preference hint alone never produces nah", () => {
  const hint = { reasonDislike: { yield: 0.35 }, liquidity: 0.6, lowCost: 0, yield: -0.6, novelty: 0, clarity: 0, confidence: 0, explorationWidth: 0 };
  const noAnswer = flowWith({ preference: hint });
  assert.notEqual(kintsuOf(noAnswer).derivedStatus, STATUS.NAH);
  assert.equal(kintsuOf(noAnswer).decision.action, "ask");
  assert.equal(noAnswer.decisionReceipt, null);
  const kintsu = buildDestinationFixtures(TEST_RUNTIME_CONTEXT)[1];
  assert.notEqual(deriveDestinationStatus(kintsu, { preference: hint, liquidity: 0.6 }).status, STATUS.NAH);
  // A different explicit answer is not right_back and does not become nah.
  assert.notEqual(kintsuOf(flowWith({ preference: hint, jitAnswer: "no_rush" })).derivedStatus, STATUS.NAH);
});

check("A-576 rule/safety/eligibility rejection reasons do not mutate preference dislike", () => {
  const nah = flowWith({ jitAnswer: "right_back" });
  const unknown = flowWith({ jitAnswer: "right_back", destinationOverrides: { [KINTSU_DEST]: { returnEvidence: null } } });
  const accepted = flowWith({ jitAnswer: "few_days" });
  assert.deepEqual(nah.preferenceState.after, accepted.preferenceState.after);
  assert.deepEqual(unknown.preferenceState.after, accepted.preferenceState.after);
  assert.equal(Object.values(nah.preferenceState.after.reasonDislike).every((v) => v === 0), true);
  assert.doesNotMatch(`${nah.decisionReceipt.reason} ${nah.decisionReceipt.category}`, /preference|dislike/i);
  assert.equal(nah.knowledgeState.inferredFromPreference, false);
});

check("A-576 no global return-time constant in job-feed.js (source scan)", () => {
  const src = readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /(right_back|few_days|no_rush)[\s\S]{0,80}\d+\s*(h|hr|hours?|d|days?|ms)\b/i);
  assert.doesNotMatch(src, /\d+\s*\*\s*60\s*\*\s*60|\b(3600000|86400000|86400)\b/);
  assert.equal(src.includes("0xA3227C5969757783154C60bF0bC1944180ed81B9"), false);
});

console.log(`\n${pass}/${pass} PASS`);
