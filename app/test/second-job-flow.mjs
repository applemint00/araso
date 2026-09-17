import assert from "node:assert/strict";
import { ACTION, RESULT, decideRules } from "../src/rule-decision.js";
import { STATUS, buildDestinationFixtures, runInternalPreflight, runSecondJourney } from "../src/job-feed.js";
import { createSecondJourneyState } from "../src/second-journey-state.js";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("1 visible second Journey starts only after A-174 first Receipt reference", () => {
  const flow = runSecondJourney();
  assert.equal(flow.visibleFlow[0], "First shMON Receipt");
  assert.equal(flow.firstReceipt.sourceTask, "A-174");
  assert.equal(flow.firstReceipt.receiptClosed, true);
});

check("2 visible choices are Explore errands, not shMON preview/capacity pseudo-Jobs", () => {
  const flow = runSecondJourney();
  assert.ok(flow.visibleChoices.some((choice) => choice.label === "시장 다녀오기"));
  assert.ok(flow.visibleChoices.some((choice) => choice.label === "지갑 청소하기"));
  assert.equal(flow.visibleChoices.every((choice) => choice.visibleAs === "Explore-visible"), true);
  assert.equal(flow.visibleChoices.some((choice) => /preview|capacity|shmon/i.test(choice.id + choice.label)), false);
});

check("3 one/two/all/none/unsure produce bounded hints and never permission", () => {
  const one = runSecondJourney({ selectionKind: "one", selectedErrandIds: ["market"] });
  const two = runSecondJourney({ selectionKind: "multi", selectedErrandIds: ["market", "claim"] });
  const all = runSecondJourney({ selectionKind: "all" });
  const none = runSecondJourney({ selectionKind: "none", selectedErrandIds: [] });
  const unsure = runSecondJourney({ selectionKind: "unsure", selectedErrandIds: [] });
  assert.deepEqual([one.selection.kind, two.selection.kind, all.selection.kind, none.selection.kind, unsure.selection.kind], ["one", "multi", "all", "none", "unsure"]);
  for (const flow of [one, two, all, none, unsure]) {
    assert.equal(flow.preferenceState.executionPermission, false);
    assert.equal(flow.preferenceState.fixedPersonalityLabel, null);
    assert.ok(Object.values(flow.preferenceState.after).filter((value) => typeof value === "number").every((value) => value >= -0.6 && value <= 0.6));
  }
});

check("4 max one JIT question is produced", () => {
  assert.equal(runSecondJourney({ selectionKind: "one", selectedErrandIds: ["market"] }).jitQuestions.length, 1);
  assert.equal(runSecondJourney({ selectionKind: "multi", selectedErrandIds: ["market", "claim"] }).jitQuestions.length, 1);
  assert.equal(runSecondJourney({ selectionKind: "all" }).jitQuestions.length, 1);
  assert.equal(runSecondJourney({ selectionKind: "none", selectedErrandIds: [] }).jitQuestions.length, 0);
});

check("5 preference does not become an agreed rule", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["grow"], jitAnswer: "few_days" });
  assert.equal(flow.preferenceState.agreedRule, null);
  assert.deepEqual(flow.agreedRule, { returnTolerance: "few_days" });
});

check("6 capability context and current Piggy context are independently represented", () => {
  const flow = runSecondJourney({ selectionKind: "all", jitAnswer: "few_days" });
  for (const destination of flow.destinations) {
    assert.ok(destination.capabilityContext);
    assert.ok(destination.currentPiggyContext);
    assert.notEqual(destination.capabilityContext, destination.currentPiggyContext);
  }
});

check("7 no-funding current Piggy does not become Job-level NAH", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["grow"], jitAnswer: "few_days" });
  const aave = flow.destinations.find((destination) => destination.id === "aave-like-grow-supply");
  assert.equal(aave.currentPiggyStatus, "NEEDS_FUNDING");
  assert.equal(aave.currentPiggyContext.jobLevelNah, false);
  assert.equal(aave.derivedStatus, STATUS.JOB_ELIGIBLE_NEEDS_FUNDING);
});

check("8 delayed return can remain WAITING when known+trackable+accepted", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["grow"], jitAnswer: "few_days" });
  const kintsu = flow.destinations.find((destination) => destination.id === "kintsu-like-grow-delayed-return");
  assert.equal(kintsu.capabilityContext.returnModel.known, true);
  assert.equal(kintsu.capabilityContext.returnModel.trackable, true);
  assert.equal(kintsu.derivedStatus, STATUS.JOB_WAITING_RETURN);
});

check("9 delayed return becomes rule_nah when user explicitly requires right-back", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["grow"], jitAnswer: "right_back" });
  const kintsu = flow.destinations.find((destination) => destination.id === "kintsu-like-grow-delayed-return");
  assert.equal(kintsu.derivedStatus, STATUS.NAH);
  assert.equal(kintsu.decision.reasonCode, "rule_nah");
});

check("10 conditional claim remains CONDITIONAL; evidence read is separate from claim action", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["claim"], jitAnswer: "few_days" });
  const merkl = flow.destinations.find((destination) => destination.id === "merkl-like-collect-claim");
  assert.equal(merkl.derivedStatus, STATUS.JOB_CONDITIONAL);
  assert.ok(merkl.evidenceState.evidence.some((item) => item.includes("evidence, not the Job")));
  assert.equal(merkl.capabilityContext.contractActionPath.includes("claim action"), true);
});

check("11 safety/eligibility/rule/current-context blocks do not become preference dislike", () => {
  const blocked = runSecondJourney({ selectedErrandIds: ["grow"], jitAnswer: "right_back" });
  const funded = runSecondJourney({ selectedErrandIds: ["market"], jitAnswer: "few_days" });
  assert.equal(blocked.preferenceState.after.reasonDislike?.yield || 0, 0);
  assert.equal(funded.preferenceState.after.reasonDislike?.novelty || 0, 0);
  assert.equal(blocked.mockReceipt.learn.preferenceUpdated, true);
});

check("12 PreferenceState / KnowledgeState / EvidenceState are separate outputs", () => {
  const flow = runSecondJourney();
  assert.ok(flow.preferenceState);
  assert.ok(flow.knowledgeState);
  assert.ok(flow.evidenceState);
  assert.equal(flow.knowledgeState.inferredFromPreference, false);
  assert.notDeepEqual(flow.preferenceState, flow.knowledgeState);
});

check("13 mock Receipt/Learn has txExecuted=false and no real action", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["grow"], jitAnswer: "few_days" });
  assert.equal(flow.txExecuted, false);
  assert.equal(flow.mockReceipt.txExecuted, false);
  assert.equal(flow.mockReceipt.realActionExecuted, false);
  assert.ok(flow.mockReceipt.proofPlaceholders.length > 0);
});

check("14 hard safety fail-closed semantics from existing selector/rule core remain intact", () => {
  const selectorPreflight = runInternalPreflight({ rules: [{ id: "amount", field: "amount", comparator: "lte", expected: 1, agreed: true }] }, "breach");
  const ruleCore = decideRules([{ id: "amount", field: "amount", comparator: "lte", expected: 1, agreed: true }], { amount: { found: 2, block: 1 } });
  assert.equal(selectorPreflight.result, RESULT.NAH);
  assert.equal(ruleCore.result, RESULT.NAH);
  assert.equal(ruleCore.action, ACTION.NONE);
});

check("destination fixtures cover Aave/Kintsu/swap/Merkl semantics", () => {
  assert.deepEqual(buildDestinationFixtures().map((destination) => destination.id), [
    "aave-like-grow-supply",
    "kintsu-like-grow-delayed-return",
    "monad-swap-like-trade",
    "merkl-like-collect-claim",
  ]);
});

check("15 explicit interest list survives after one selected Job path", () => {
  const flow = runSecondJourney({ selectionKind: "multi", selectedErrandIds: ["market", "claim"], jitAnswer: "few_days" });
  assert.deepEqual(flow.explicitInterestState.interests.map((item) => item.errandId), ["market", "claim"]);
  assert.equal(flow.preflight.executionPermission, false);
  assert.equal(flow.preflight.action, ACTION.NONE);
});

check("16 restored state preference is the next selection default", () => {
  const first = runSecondJourney({ selectedErrandIds: ["market"], eventId: "reload-a" });
  const next = runSecondJourney({ secondJourneyState: first.explicitInterestState, selectedErrandIds: ["claim"], eventId: "reload-b" });
  assert.equal(next.preferenceState.before.novelty, first.explicitInterestState.preference.novelty);
  assert.ok(next.preferenceState.after.novelty >= first.explicitInterestState.preference.novelty);
  assert.deepEqual(next.explicitInterestState.interests.map((item) => item.errandId), ["market", "claim"]);
});

check("16b restored state wins over legacy preference seed and empty object", () => {
  const scope = { accountId: "a", chainId: "1" };
  const restored = createSecondJourneyState(scope);
  restored.preference.novelty = 0.6;
  restored.preference.clarity = 0.2;
  restored.interests = [{ errandId: "market", label: "시장 다녀오기", lane: "Trade" }];
  const emptySeed = runSecondJourney({ scope, secondJourneyState: restored, preference: {}, selectedErrandIds: ["claim"], eventId: "restored-empty" });
  const conflictingSeed = runSecondJourney({ scope, secondJourneyState: restored, preference: { novelty: -0.6, clarity: -0.6 }, selectedErrandIds: ["claim"], eventId: "restored-conflict" });
  assert.equal(emptySeed.preferenceState.before.novelty, 0.6);
  assert.equal(emptySeed.preferenceState.before.clarity, 0.2);
  assert.equal(conflictingSeed.preferenceState.before.novelty, 0.6);
  assert.equal(conflictingSeed.preferenceState.before.clarity, 0.2);
  assert.ok(emptySeed.explicitInterestState.interests.some((item) => item.errandId === "market"));
  assert.ok(conflictingSeed.explicitInterestState.interests.some((item) => item.errandId === "market"));
});

check("16b.1 initial legacy preference seed is bounded before selection", () => {
  const flow = runSecondJourney({ preference: { novelty: 999 }, selectedErrandIds: ["claim"], eventId: "bounded-seed" });
  assert.equal(flow.preferenceState.before.novelty, 0.6);
  assert.ok(flow.preferenceState.after.novelty <= 0.6);
});

check("16c restored state scope/version admission fails closed before preflight", () => {
  const scope = { accountId: "a", chainId: "1" };
  const wrongScope = createSecondJourneyState({ accountId: "b", chainId: "1" });
  const futureVersion = { ...createSecondJourneyState(scope), version: 999 };
  const numericScope = createSecondJourneyState({ accountId: 42, chainId: 42 });
  for (const [state, explicitScope] of [[wrongScope, scope], [futureVersion, scope], [numericScope, { accountId: 42, chainId: 42 }]]) {
    const flow = runSecondJourney({ scope: explicitScope, secondJourneyState: state, permission: true, ruleAgreed: true });
    assert.equal(flow.stateError === "scope_mismatch" || flow.stateError === "unsupported_version" || flow.stateError === "missing_scope", true);
    assert.equal(flow.preflight.action, ACTION.NONE);
    assert.equal(flow.preflight.executionPermission, false);
    assert.equal(flow.stateUpdate.preferenceApplied, false);
    assert.equal(flow.txExecuted, false);
  }
});

check("16d runSecondJourney readiness uses trusted nowMs, not evidence nowMs", () => {
  const kintsu = { ...buildDestinationFixtures()[1], capabilityStatus: "qualified" };
  const readinessEvidence = {
    eligibility: "known",
    exit: "known",
    proof: "known",
    gas: "known",
    requiredAssets: ["gas"],
    availableAssets: ["gas"],
    missingNow: [],
    timestampMs: 900,
    expiresAtMs: 2000,
    nowMs: 1000,
    source: "explicit_review_mock",
    chain: kintsu.currentPiggyContext.chain,
    address: kintsu.currentPiggyContext.address,
    destinationId: kintsu.id,
    block: 1,
  };
  const destinationOverrides = { [kintsu.id]: { capabilityStatus: "qualified" } };
  const blocked = runSecondJourney({ selectedErrandIds: ["grow"], preferredDestinationId: kintsu.id, destinationOverrides, readinessEvidence, ruleAgreed: true, permission: true, evidenceBlock: 1, jitAnswer: "few_days" });
  const ready = runSecondJourney({ selectedErrandIds: ["grow"], preferredDestinationId: kintsu.id, destinationOverrides, readinessEvidence, nowMs: 1000, ruleAgreed: true, permission: true, evidenceBlock: 1, jitAnswer: "few_days" });
  assert.equal(blocked.preflight.status, "UNKNOWN");
  assert.equal(blocked.preflight.action, ACTION.NONE);
  assert.equal(ready.preflight.status, "JOB_READY");
  assert.equal(ready.preflight.executionPermission, true);
});

check("17 duplicate event returns unchanged presented preference output", () => {
  const first = runSecondJourney({ selectedErrandIds: ["market"], eventId: "dup-a" });
  const duplicate = runSecondJourney({ secondJourneyState: first.explicitInterestState, selectedErrandIds: ["claim"], eventId: "dup-a" });
  assert.equal(duplicate.stateUpdate.duplicate, true);
  assert.equal(duplicate.preferenceState.signal, "duplicate_event");
  assert.deepEqual(duplicate.preferenceState.after, first.explicitInterestState.preference);
  assert.deepEqual(duplicate.preferenceState.delta, {});
  assert.deepEqual(duplicate.explicitInterestState.interests.map((item) => item.errandId), ["market"]);
});

check("18 duplicate offered ids do not turn into all", () => {
  const repeated = runSecondJourney({ selectedErrandIds: Array(8).fill("market"), eventId: "repeat-market" });
  assert.equal(repeated.selection.kind, "one");
  assert.deepEqual(repeated.explicitInterestState.interests.map((item) => item.errandId), ["market"]);
});

console.log(`\n${pass}/${pass} PASS`);
