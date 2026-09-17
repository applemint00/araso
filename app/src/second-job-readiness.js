import { ACTION, RESULT, decideRules } from "./rule-decision.js";

export const PREFLIGHT_STATUS = Object.freeze({
  READY: "JOB_READY",
  ASK: "ASK_RULE_OR_PERMISSION",
  NAH: "NAH",
  UNKNOWN: "UNKNOWN",
  OPEN: "JOB_OPEN",
  CONDITIONAL: "JOB_CONDITIONAL",
  NEEDS_FUNDING: "JOB_ELIGIBLE_NEEDS_FUNDING",
});

function unknown(reason, details = {}) {
  return { status: PREFLIGHT_STATUS.UNKNOWN, action: ACTION.NONE, reason, executionPermission: false, ...details };
}

function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isUnknown(value) {
  return value === undefined || value === null || text(value) === "unknown" || text(value) === "";
}

function isKnownString(value) {
  return typeof value === "string" && !isUnknown(value);
}

function hasFreshness(evidence, nowMs) {
  if (evidence.sourceConflict === true) return "source_conflict";
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return "missing_clock";
  if (typeof evidence.timestampMs !== "number" || !Number.isFinite(evidence.timestampMs) || evidence.timestampMs < 0) return "invalid_timestamp";
  if (evidence.timestampMs > nowMs) return "future_evidence";
  if (typeof evidence.expiresAtMs !== "number" || !Number.isFinite(evidence.expiresAtMs) || evidence.expiresAtMs < 0) return "invalid_expiry";
  if (evidence.expiresAtMs <= nowMs) return "stale_evidence";
  return "";
}

function isValidStringArray(value) {
  return Array.isArray(value) && value.every((item) => isKnownString(item));
}

function normalizeAssets(value = []) {
  return [...new Set(value.map((item) => item.trim()))];
}

function parseClaimable(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function requiresClaimable(candidate) {
  return candidate.currentPiggyStatus === "CONDITIONAL_CLAIMABLE_ABSENT" || candidate.capabilityStatus === PREFLIGHT_STATUS.CONDITIONAL || candidate.laneId === "collect";
}

function hasPositiveCurrentEvidence(candidate, evidence, options = {}) {
  if (!candidate?.id || candidate.destinationKind !== "destination_job_fixture") return "missing_candidate_identity";
  if (candidate.capabilityStatus !== "qualified" && candidate.capabilityStatus !== PREFLIGHT_STATUS.READY) return "capability_not_qualified";
  if (candidate.currentPiggyStatus === "NAH" || candidate.currentPiggyStatus === PREFLIGHT_STATUS.NAH) return "capability_nah";
  if (!isKnownString(candidate.currentPiggyContext?.chain)) return "missing_candidate_chain";
  if (!isKnownString(candidate.currentPiggyContext?.address)) return "missing_candidate_address";
  if (!isKnownString(evidence.source)) return "missing_source";
  if (!isKnownString(evidence.chain)) return "invalid_chain";
  if (!isKnownString(evidence.address)) return "invalid_address";
  if (!isKnownString(evidence.destinationId)) return "invalid_destination";
  if (evidence.chain !== candidate.currentPiggyContext?.chain) return "target_chain_mismatch";
  if (evidence.address !== candidate.currentPiggyContext?.address) return "target_address_mismatch";
  if (evidence.destinationId !== candidate.id) return "target_destination_mismatch";
  if (typeof evidence.block !== "number" || !Number.isInteger(evidence.block) || evidence.block < 0) return "invalid_block";
  if (evidence.eligibility !== true && text(evidence.eligibility) !== "known") return "eligibility_unknown";
  if (evidence.exit !== true && text(evidence.exit) !== "known") return "exit_unknown";
  if (evidence.proof !== true && text(evidence.proof) !== "known") return "proof_unknown";
  if (evidence.gas !== true && text(evidence.gas) !== "known" && text(evidence.gas) !== "ok") return "gas_unknown";
  if (!isValidStringArray(candidate.currentPiggyContext?.requiredAssets || [])) return "invalid_candidate_assets";
  if (!isValidStringArray(evidence.requiredAssets)) return "invalid_required_assets";
  if (!isValidStringArray(evidence.availableAssets)) return "invalid_available_assets";
  if (evidence.missingNow !== undefined && !isValidStringArray(evidence.missingNow)) return "invalid_missing_now";
  if (evidence.missingNow?.length > 0) return "missing_current_input";
  const required = normalizeAssets([...(candidate.currentPiggyContext?.requiredAssets || []), ...(evidence.requiredAssets || [])]);
  if (required.length > 0) {
    const available = new Set(normalizeAssets(evidence.availableAssets || []));
    if (required.some((asset) => !available.has(asset))) return "missing_input_asset";
  }
  if (evidence.claimable !== undefined) {
    const claimable = parseClaimable(evidence.claimable);
    if (claimable === null) return "invalid_claimable";
    if (claimable <= 0) return "condition_missing";
  } else if (requiresClaimable(candidate)) {
    return "missing_claimable";
  }
  return hasFreshness(evidence, options.nowMs);
}

export function evaluateReadinessEvidence(candidate = {}, evidence = {}, options = {}) {
  const context = candidate.currentPiggyContext || {};
  const observed = { ...evidence };
  const combinedEvidence = { ...context, ...observed };
  if (observed.sourceConflict === true) return unknown("source_conflict", { evidence: combinedEvidence });
  if (candidate.currentPiggyStatus === "NEEDS_FUNDING" || (isValidStringArray(observed.missingNow) && observed.missingNow.includes("gas")) || observed.funded === false) {
    return { status: PREFLIGHT_STATUS.NEEDS_FUNDING, action: ACTION.NONE, reason: "current_context_needs_funding", executionPermission: false, evidence: combinedEvidence };
  }
  if (candidate.currentPiggyStatus === "CONDITIONAL_CLAIMABLE_ABSENT" && observed.claimable === undefined) {
    return { status: PREFLIGHT_STATUS.CONDITIONAL, action: ACTION.NONE, reason: "condition_missing", executionPermission: false, evidence: combinedEvidence };
  }
  if (observed.claimable !== undefined && parseClaimable(observed.claimable) === 0) {
    return { status: PREFLIGHT_STATUS.CONDITIONAL, action: ACTION.NONE, reason: "condition_missing", executionPermission: false, evidence: combinedEvidence };
  }
  if (candidate.capabilityStatus === "JOB_OPEN") return { status: PREFLIGHT_STATUS.OPEN, action: ACTION.NONE, reason: "capability_open", executionPermission: false, evidence: combinedEvidence };
  if (isUnknown(observed.eligibility) || isUnknown(observed.exit) || isUnknown(observed.proof)) return unknown("missing_current_evidence", { evidence: combinedEvidence });
  const positiveDeficit = hasPositiveCurrentEvidence(candidate, observed, { nowMs: options.nowMs });
  if (positiveDeficit) return unknown(positiveDeficit, { evidence: combinedEvidence });
  return { status: PREFLIGHT_STATUS.READY, action: ACTION.ASK, reason: "ready_needs_permission", executionPermission: false, evidence: combinedEvidence };
}

export function decideSecondJobPreflight(candidate = {}, options = {}) {
  const evidenceCheck = evaluateReadinessEvidence(candidate, options.evidence || {}, { nowMs: options.nowMs });
  if (evidenceCheck.status !== PREFLIGHT_STATUS.READY) return { ...evidenceCheck, ruleDecision: null };
  const rules = options.rules || candidate.rules || [];
  if (rules.length === 0) return unknown("missing_explicit_rule", { evidence: evidenceCheck.evidence, ruleDecision: null });
  const ruleDecision = decideRules(rules, options.values || {});
  if (ruleDecision.result === RESULT.UNKNOWN) return { status: PREFLIGHT_STATUS.UNKNOWN, action: ACTION.NONE, reason: "rule_unknown", executionPermission: false, ruleDecision, evidence: evidenceCheck.evidence };
  if (ruleDecision.result === RESULT.NAH) return { status: PREFLIGHT_STATUS.NAH, action: ACTION.NONE, reason: "rule_nah", executionPermission: false, ruleDecision, evidence: evidenceCheck.evidence };
  if (ruleDecision.result === RESULT.ASK) return { status: PREFLIGHT_STATUS.ASK, action: ACTION.ASK, reason: "rule_material_change_ask", executionPermission: false, ruleDecision, evidence: evidenceCheck.evidence };
  if (options.permission !== true) return { status: PREFLIGHT_STATUS.ASK, action: ACTION.ASK, reason: "permission_required", executionPermission: false, ruleDecision, evidence: evidenceCheck.evidence };
  return { status: PREFLIGHT_STATUS.READY, action: ACTION.EXECUTE, reason: "rule_and_permission_ready", executionPermission: true, ruleDecision, evidence: evidenceCheck.evidence };
}

export function summarizeReadOnlyCandidateEvidence(candidates = [], context = {}) {
  return candidates.map((candidate) => ({
    id: candidate.id,
    chain: context.chain || candidate.currentPiggyContext?.chain || "UNKNOWN",
    addressProvenance: context.address ? "provided_current_context" : "UNKNOWN",
    timestamp: context.timestamp || "UNKNOWN",
    block: context.block || "UNKNOWN",
    source: context.source || "local_fixture_only",
    readiness: evaluateReadinessEvidence(candidate, context.evidence || {}, { nowMs: context.nowMs }),
  }));
}

export const LP_JOB_ACTION = Object.freeze({
  ADD: "lp_add",
  ADJUST_RANGE: "lp_adjust_range",
  COLLECT: "lp_collect",
  PARTIAL_EXIT: "lp_partial_exit",
  FULL_EXIT: "lp_full_exit",
});

const LP_ECONOMIC_FIELDS = Object.freeze([
  "capital",
  "campaignRewards",
  "organicFees",
  "inventoryDeltaVsHodl",
  "entryCost",
  "adjustCost",
  "claimCost",
  "exitCost",
  "gasCost",
]);

function strictFiniteRecord(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "invalid_input" };
  for (const field of fields) {
    if (typeof input[field] !== "number" || !Number.isFinite(input[field])) return { error: `invalid_${field}` };
  }
  return { value: Object.fromEntries(fields.map((field) => [field, input[field]])) };
}

export function calculateLpNetVsHodl(input = {}) {
  const parsed = strictFiniteRecord(input, LP_ECONOMIC_FIELDS);
  if (parsed.error) return unknown(parsed.error, { calculation: null });
  const value = parsed.value;
  if (value.capital <= 0) return unknown("invalid_capital", { calculation: null });
  for (const field of ["campaignRewards", "organicFees", "entryCost", "adjustCost", "claimCost", "exitCost", "gasCost"]) {
    if (value[field] < 0) return unknown(`negative_${field}`, { calculation: null });
  }
  const grossRevenue = value.campaignRewards + value.organicFees;
  const totalFriction = value.entryCost + value.adjustCost + value.claimCost + value.exitCost + value.gasCost;
  const netVsHodl = grossRevenue + value.inventoryDeltaVsHodl - totalFriction;
  return {
    status: "CALCULATED",
    action: ACTION.NONE,
    executionPermission: false,
    calculation: {
      capital: value.capital,
      campaignRewards: value.campaignRewards,
      organicFees: value.organicFees,
      inventoryDeltaVsHodl: value.inventoryDeltaVsHodl,
      totalFriction,
      netVsHodl,
      returnOnCapital: netVsHodl / value.capital,
    },
  };
}

function validSnapshot(snapshot, nowMs) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "invalid_snapshot";
  if (!isKnownString(snapshot.contentHash)) return "missing_snapshot_hash";
  if (snapshot.sourceConflict === true) return "source_conflict";
  return hasFreshness(snapshot, nowMs);
}

function thresholdSide(value, threshold, direction) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) return null;
  return direction === "max" ? value <= threshold : value >= threshold;
}

export function evaluateLpEvidenceAlert(previous, current, options = {}) {
  const currentError = validSnapshot(current, options.nowMs);
  if (currentError) {
    return { notify: true, reason: currentError, action: ACTION.NONE, executionPermission: false };
  }
  if (previous?.contentHash === current.contentHash) {
    return { notify: false, reason: "unchanged_snapshot", action: ACTION.NONE, executionPermission: false };
  }
  if (!previous) {
    return { notify: false, reason: "baseline_created", action: ACTION.NONE, executionPermission: false };
  }
  const previousError = validSnapshot(previous, options.previousNowMs ?? previous.timestampMs);
  if (previousError && previousError !== "stale_evidence") {
    return { notify: true, reason: "previous_snapshot_invalid", action: ACTION.NONE, executionPermission: false };
  }
  const checks = [
    ["netVsHodl", options.thresholds?.minNetVsHodl, "min"],
    ["tvl", options.thresholds?.minTvl, "min"],
    ["displayedApr", options.thresholds?.minDisplayedApr, "min"],
    ["exitFriction", options.thresholds?.maxExitFriction, "max"],
  ];
  const crossed = checks.flatMap(([field, threshold, direction]) => {
    if (threshold === undefined) return [];
    const before = thresholdSide(previous[field], threshold, direction);
    const after = thresholdSide(current[field], threshold, direction);
    return before !== null && after !== null && before !== after ? [{ field, before, after }] : [];
  });
  return {
    notify: crossed.length > 0,
    reason: crossed.length > 0 ? "threshold_crossing" : "changed_but_not_actionable",
    crossings: crossed,
    action: ACTION.NONE,
    executionPermission: false,
  };
}

const LP_RECEIPT_SHAPES = Object.freeze({
  [LP_JOB_ACTION.ADD]: ["poolId", "positionId", "depositedAssets", "range", "txHash"],
  [LP_JOB_ACTION.ADJUST_RANGE]: ["positionId", "oldRange", "newRange", "feesCollected", "txHash"],
  [LP_JOB_ACTION.COLLECT]: ["positionId", "feesCollected", "rewardsCollected", "txHash"],
  [LP_JOB_ACTION.PARTIAL_EXIT]: ["positionId", "liquidityRemoved", "returnedAssets", "remainingLiquidity", "txHash"],
  [LP_JOB_ACTION.FULL_EXIT]: ["positionId", "liquidityRemoved", "returnedAssets", "remainingLiquidity", "txHash"],
});

export function buildLpJobAdapter(actionType, context = {}) {
  const receiptFields = LP_RECEIPT_SHAPES[actionType];
  if (!receiptFields) return unknown("unsupported_lp_action", { job: null });
  const missing = ["poolId", "chain", "exitMethod", "proofSource"].filter((field) => !isKnownString(context[field]));
  if (missing.length > 0) return unknown("missing_lp_job_context", { missing, job: null });
  return {
    status: "JOB_PLAN_READY",
    action: ACTION.NONE,
    executionPermission: false,
    job: {
      actionType,
      lifecycle: ["action", "measurable_state_change", "exit_or_return", "receipt"],
      target: { chain: context.chain, poolId: context.poolId },
      exitMethod: context.exitMethod,
      receipt: { txExecuted: false, status: "NOT_ATTEMPTED", proofSource: context.proofSource, requiredFields: receiptFields },
    },
  };
}
