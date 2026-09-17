import assert from "node:assert/strict";
import { ACTION } from "../src/rule-decision.js";
import { buildDestinationFixtures } from "../src/job-feed.js";
import {
  LP_JOB_ACTION,
  PREFLIGHT_STATUS,
  buildLpJobAdapter,
  calculateLpNetVsHodl,
  decideSecondJobPreflight,
  evaluateLpEvidenceAlert,
  summarizeReadOnlyCandidateEvidence,
} from "../src/second-job-readiness.js";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

const [aave, kintsu, swap, merkl] = buildDestinationFixtures();
const amountRule = { id: "amount", field: "amount", comparator: "lte", expected: 1, agreed: true };
const readyFixture = { ...kintsu, capabilityStatus: "qualified" };
function completeEvidence(candidate = readyFixture) {
  return {
    eligibility: "known",
    exit: "known",
    proof: "known",
    gas: "known",
    requiredAssets: ["gas"],
    availableAssets: ["gas"],
    missingNow: [],
    timestampMs: 900,
    expiresAtMs: 2000,
    source: "explicit_review_mock",
    chain: candidate.currentPiggyContext.chain,
    address: candidate.currentPiggyContext.address,
    destinationId: candidate.id,
    block: 1,
    evidenceMode: "fixture_not_live",
  };
}

function passOptions(candidate = readyFixture, evidence = completeEvidence(candidate), overrides = {}) {
  return {
    evidence,
    nowMs: 1000,
    rules: [amountRule],
    values: { amount: { found: 1, block: 1, source: "review_mock" } },
    permission: true,
    ...overrides,
  };
}

check("empty candidate cannot become READY from passing rule and permission", () => {
  const result = decideSecondJobPreflight({}, { rules: [amountRule], values: { amount: { found: 1, block: 1 } }, permission: true });
  assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(result.action, ACTION.NONE);
  assert.equal(result.executionPermission, false);
});

check("null and uppercase UNKNOWN current evidence fail closed", () => {
  const nullResult = decideSecondJobPreflight(readyFixture, { evidence: { eligibility: null, exit: "known", proof: "known", gas: "known", availableAssets: ["gas"] }, rules: [amountRule], values: { amount: { found: 1, block: 1 } }, permission: true });
  const upper = decideSecondJobPreflight(readyFixture, { evidence: { eligibility: "KNOWN", exit: "UNKNOWN", proof: "known", gas: "known", availableAssets: ["gas"] }, rules: [amountRule], values: { amount: { found: 1, block: 1 } }, permission: true });
  assert.equal(nullResult.status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(upper.status, PREFLIGHT_STATUS.UNKNOWN);
});

check("ineligible, capability nah, stale, missing asset, and numeric zero claimable fail closed", () => {
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), eligibility: false })).status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(decideSecondJobPreflight({ ...readyFixture, currentPiggyStatus: "NAH" }, passOptions()).status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), expiresAtMs: 1000 })).status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), availableAssets: [] })).status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(decideSecondJobPreflight({ ...readyFixture, currentPiggyStatus: "CONTEXT_READY" }, passOptions(readyFixture, { ...completeEvidence(), claimable: 0 })).status, PREFLIGHT_STATUS.CONDITIONAL);
});

check("funding gap closes execution path without becoming dislike or permission", () => {
  const result = decideSecondJobPreflight(aave, { rules: [amountRule], values: { amount: { found: 1, block: 1 } }, permission: true });
  assert.equal(result.status, PREFLIGHT_STATUS.NEEDS_FUNDING);
  assert.equal(result.action, ACTION.NONE);
  assert.equal(result.executionPermission, false);
});

check("missing explicit rule returns UNKNOWN/action 0", () => {
  const result = decideSecondJobPreflight(readyFixture, passOptions(readyFixture, completeEvidence(), { rules: [] }));
  assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(result.reason, "missing_explicit_rule");
});

check("rule breach returns NAH/action 0", () => {
  const result = decideSecondJobPreflight(readyFixture, passOptions(readyFixture, completeEvidence(), { values: { amount: { found: 2, block: 1 } } }));
  assert.equal(result.status, PREFLIGHT_STATUS.NAH);
  assert.equal(result.reason, "rule_nah");
  assert.equal(result.action, ACTION.NONE);
});

check("rule pass still asks without separate permission", () => {
  const result = decideSecondJobPreflight(readyFixture, passOptions(readyFixture, completeEvidence(), { permission: false }));
  assert.equal(result.status, PREFLIGHT_STATUS.ASK);
  assert.equal(result.reason, "permission_required");
  assert.equal(result.action, ACTION.ASK);
});

check("rule plus permission can become headless READY without tx execution", () => {
  const result = decideSecondJobPreflight(readyFixture, passOptions());
  assert.equal(result.status, PREFLIGHT_STATUS.READY);
  assert.equal(result.action, ACTION.EXECUTE);
  assert.equal(result.executionPermission, true);
});

check("current evidence requires provenance, target binding, block, observation time, and trusted clock", () => {
  for (const field of ["source", "chain", "address", "destinationId", "block", "timestampMs", "expiresAtMs"]) {
    const evidence = completeEvidence();
    delete evidence[field];
    const result = decideSecondJobPreflight(readyFixture, passOptions(readyFixture, evidence));
    assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN, field);
    assert.equal(result.action, ACTION.NONE, field);
  }
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), chain: "wrong-chain" })).reason, "target_chain_mismatch");
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), address: "0xwrong" })).reason, "target_address_mismatch");
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), destinationId: "other" })).reason, "target_destination_mismatch");
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), timestampMs: 1001 })).reason, "future_evidence");
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), expiresAtMs: 999 })).reason, "stale_evidence");
  assert.equal(decideSecondJobPreflight(readyFixture, { ...passOptions(readyFixture, { ...completeEvidence(), nowMs: 1000 }), nowMs: undefined }).reason, "missing_clock");
});

check("current evidence validates exact scalar types before numeric/string coercion", () => {
  for (const patch of [
    { timestampMs: null },
    { block: null },
    { timestampMs: "900" },
    { source: {} },
    { source: " UNKNOWN " },
    { requiredAssets: undefined },
  ]) {
    const result = decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), ...patch }));
    assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN, JSON.stringify(patch));
    assert.equal(result.action, ACTION.NONE, JSON.stringify(patch));
    assert.equal(result.executionPermission, false, JSON.stringify(patch));
  }
});

check("candidate current target cannot be UNKNOWN even when evidence matches it", () => {
  for (const field of ["chain", "address"]) {
    const candidate = { ...readyFixture, currentPiggyContext: { ...readyFixture.currentPiggyContext, [field]: "UNKNOWN" } };
    const result = decideSecondJobPreflight(candidate, passOptions(candidate, { ...completeEvidence(candidate), [field]: "UNKNOWN" }));
    assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN, field);
    assert.equal(result.action, ACTION.NONE, field);
    assert.equal(result.executionPermission, false, field);
  }
});

check("candidate and evidence target values require valid known strings before match", () => {
  for (const field of ["chain", "address"]) {
    const candidate = { ...readyFixture, currentPiggyContext: { ...readyFixture.currentPiggyContext, [field]: 42 } };
    const result = decideSecondJobPreflight(candidate, passOptions(candidate, { ...completeEvidence(candidate), [field]: 42 }));
    assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN, field);
    assert.equal(result.action, ACTION.NONE, field);
    assert.equal(result.executionPermission, false, field);
  }
});

check("candidate assets cannot be wiped by evidence and malformed arrays fail closed", () => {
  assert.equal(decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), requiredAssets: [], availableAssets: [] })).reason, "missing_input_asset");
  for (const patch of [{ requiredAssets: "gas" }, { availableAssets: [""] }, { missingNow: "gas" }, { requiredAssets: ["gas", "UNKNOWN"], availableAssets: ["gas", "UNKNOWN"] }, { availableAssets: ["gas", "UNKNOWN"] }]) {
    const result = decideSecondJobPreflight(readyFixture, passOptions(readyFixture, { ...completeEvidence(), ...patch }));
    assert.equal(result.status, PREFLIGHT_STATUS.UNKNOWN);
    assert.equal(result.action, ACTION.NONE);
  }
  const noAssets = { ...readyFixture, currentPiggyContext: { ...readyFixture.currentPiggyContext, requiredAssets: [] } };
  const noAssetEvidence = { ...completeEvidence(noAssets), requiredAssets: [], availableAssets: [] };
  const { availableAssets, ...missingInventoryEvidence } = noAssetEvidence;
  const positive = decideSecondJobPreflight(noAssets, passOptions(noAssets, noAssetEvidence));
  const missingInventory = decideSecondJobPreflight(noAssets, passOptions(noAssets, missingInventoryEvidence));
  assert.equal(positive.status, PREFLIGHT_STATUS.READY);
  assert.equal(missingInventory.status, PREFLIGHT_STATUS.UNKNOWN);
});

check("claimable must be strict and positive for claim family", () => {
  const claimReady = { ...merkl, capabilityStatus: "qualified", currentPiggyStatus: "CONTEXT_READY" };
  const claimEvidence = { ...completeEvidence(claimReady), requiredAssets: ["claim proof", "gas"], availableAssets: ["claim proof", "gas"] };
  assert.equal(decideSecondJobPreflight(claimReady, passOptions(claimReady, claimEvidence)).reason, "missing_claimable");
  for (const claimable of [null, true, {}, "soon", Number.POSITIVE_INFINITY]) {
    assert.equal(decideSecondJobPreflight(claimReady, passOptions(claimReady, { ...claimEvidence, claimable })).reason, "invalid_claimable");
  }
  assert.equal(decideSecondJobPreflight(claimReady, passOptions(claimReady, { ...claimEvidence, claimable: "0" })).status, PREFLIGHT_STATUS.CONDITIONAL);
  assert.equal(decideSecondJobPreflight(claimReady, passOptions(claimReady, { ...claimEvidence, claimable: "1.5" })).status, PREFLIGHT_STATUS.READY);
});

check("conditional claim and funded swap stay non-executable without current evidence", () => {
  assert.equal(decideSecondJobPreflight(merkl, { rules: [amountRule], values: { amount: { found: 1, block: 1 } }, permission: true }).status, PREFLIGHT_STATUS.CONDITIONAL);
  assert.equal(decideSecondJobPreflight(swap, { rules: [amountRule], values: { amount: { found: 1, block: 1 } }, permission: true }).status, PREFLIGHT_STATUS.NEEDS_FUNDING);
});

check("read-only evidence summary records UNKNOWN provenance instead of inventing readiness", () => {
  const summary = summarizeReadOnlyCandidateEvidence([merkl], { timestamp: "2026-09-11T00:00:00Z" });
  assert.equal(summary[0].addressProvenance, "UNKNOWN");
  assert.equal(summary[0].readiness.status, PREFLIGHT_STATUS.CONDITIONAL);
});

const lpEconomics = {
  capital: 1000,
  campaignRewards: 12,
  organicFees: 8,
  inventoryDeltaVsHodl: -5,
  entryCost: 1,
  adjustCost: 2,
  claimCost: 1,
  exitCost: 3,
  gasCost: 1,
};

check("LP calculator separates revenue, inventory delta, friction, and net versus HODL", () => {
  const result = calculateLpNetVsHodl(lpEconomics);
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.calculation.totalFriction, 8);
  assert.equal(result.calculation.netVsHodl, 7);
  assert.equal(result.calculation.returnOnCapital, 0.007);
  assert.equal(result.executionPermission, false);
  assert.equal(result.action, ACTION.NONE);
});

check("LP calculator fails closed on missing, coerced, or negative economic inputs", () => {
  assert.equal(calculateLpNetVsHodl({ ...lpEconomics, organicFees: undefined }).status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(calculateLpNetVsHodl({ ...lpEconomics, capital: "1000" }).reason, "invalid_capital");
  assert.equal(calculateLpNetVsHodl({ ...lpEconomics, gasCost: -1 }).reason, "negative_gasCost");
});

function lpSnapshot(overrides = {}) {
  return {
    contentHash: "snapshot-a",
    timestampMs: 900,
    expiresAtMs: 2000,
    netVsHodl: 3,
    tvl: 4_000_000,
    displayedApr: 8,
    exitFriction: 0.2,
    ...overrides,
  };
}

check("LP alert stays quiet for baseline, same hash, and non-actionable changes", () => {
  assert.equal(evaluateLpEvidenceAlert(null, lpSnapshot(), { nowMs: 1000 }).notify, false);
  assert.equal(evaluateLpEvidenceAlert(lpSnapshot(), lpSnapshot(), { nowMs: 1000 }).reason, "unchanged_snapshot");
  const changed = evaluateLpEvidenceAlert(lpSnapshot(), lpSnapshot({ contentHash: "snapshot-b", tvl: 4_100_000 }), { nowMs: 1000, thresholds: { minTvl: 2_000_000 } });
  assert.equal(changed.notify, false);
  assert.equal(changed.reason, "changed_but_not_actionable");
});

check("LP alert reports threshold crossing and stale/conflicting evidence without granting action", () => {
  const crossing = evaluateLpEvidenceAlert(lpSnapshot(), lpSnapshot({ contentHash: "snapshot-b", netVsHodl: -2 }), { nowMs: 1000, thresholds: { minNetVsHodl: 0 } });
  assert.equal(crossing.notify, true);
  assert.equal(crossing.reason, "threshold_crossing");
  assert.deepEqual(crossing.crossings.map((item) => item.field), ["netVsHodl"]);
  assert.equal(crossing.executionPermission, false);
  assert.equal(evaluateLpEvidenceAlert(lpSnapshot(), lpSnapshot({ contentHash: "snapshot-c", expiresAtMs: 999 }), { nowMs: 1000 }).reason, "stale_evidence");
  assert.equal(evaluateLpEvidenceAlert(lpSnapshot(), lpSnapshot({ contentHash: "snapshot-d", sourceConflict: true }), { nowMs: 1000 }).reason, "source_conflict");
});

check("LP actions become non-executing Job plans with explicit state and Receipt shapes", () => {
  for (const actionType of Object.values(LP_JOB_ACTION)) {
    const result = buildLpJobAdapter(actionType, { chain: "ethereum", poolId: "pool-1", exitMethod: "decrease-liquidity", proofSource: "local-test" });
    assert.equal(result.status, "JOB_PLAN_READY", actionType);
    assert.equal(result.action, ACTION.NONE, actionType);
    assert.equal(result.executionPermission, false, actionType);
    assert.deepEqual(result.job.lifecycle, ["action", "measurable_state_change", "exit_or_return", "receipt"], actionType);
    assert.equal(result.job.receipt.txExecuted, false, actionType);
    assert.equal(result.job.receipt.status, "NOT_ATTEMPTED", actionType);
    assert.ok(result.job.receipt.requiredFields.includes("txHash"), actionType);
  }
  assert.equal(buildLpJobAdapter("lp_watch", { chain: "ethereum", poolId: "pool-1", exitMethod: "none", proofSource: "read" }).status, PREFLIGHT_STATUS.UNKNOWN);
  assert.equal(buildLpJobAdapter(LP_JOB_ACTION.ADD, {}).reason, "missing_lp_job_context");
});

console.log(`\n${pass}/${pass} PASS`);
