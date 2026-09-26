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
  // [A-579] A destination bound to a real Job on another chain is evidence only in this
  // runtime. Its evidence may be cited, but it never becomes READY at the Send gate here,
  // whatever capability override or readiness evidence is supplied.
  if (isKnownString(candidate.jobChain) && candidate.jobChain !== context.chain) return unknown("job_chain_not_runtime_chain", { evidence: combinedEvidence });
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

// ─────────────────────────────────────────────────────────────────────────────
// [A-484 Lane A] J2-6 fork-backed adapter core
//
// fork 로 증명된 능력을 Second Journey 판정 구조에 **계획(plan)** 으로 잇는다.
// 이 절이 하지 않는 것: 실행 · 권한 부여 · 실거래.
// 모든 반환값은 `executionPermission: false` 이고, fork/live 는 언제나 라벨로 드러난다.
// `PASS_FORK_SIM` 이 `PASS_MAINNET_TX` 로 승격되는 코드 경로는 **없다**.
// ─────────────────────────────────────────────────────────────────────────────

export const EXECUTION_MODE = Object.freeze({
  FORK_SIMULATION: "fork_simulation",
  LIVE: "live",
});

export const EVIDENCE_LABEL = Object.freeze({
  FORK_SIM: "PASS_FORK_SIM",
  FORK_SIM_PENDING: "PASS_FORK_SIM_WITH_PENDING",
  APP_FORK_E2E: "PASS_APP_FORK_E2E",
  MAINNET_TX: "PASS_MAINNET_TX",
});

// 사용자에게 보이는 심부름 가족 — **프로토콜 수가 아니라 경험 수**다.
export const JOB_FAMILY = Object.freeze({
  GROW_STABLE: "grow_stable",     // 맡기고 바로 찾기
  GROW_DELAYED: "grow_delayed",   // 며칠 나갔다 오기
  PROTECT: "protect",             // 열어둔 권한 정리
  OWN_RWA: "own_rwa",             // 값을 따라가는 것 갖기
});

const ADAPTER_ADDR = /^0x[0-9a-fA-F]{40}$/;

// 주소는 A-480/A-481 에서 **직접 체인에서 읽어** 확인한 것들이다.
const FORK_PROVEN_DESTINATIONS = Object.freeze([
  Object.freeze({
    id: "aave-usdc", family: JOB_FAMILY.GROW_STABLE, baseline: true,
    chain: "monad-mainnet", chainId: 143, protocol: "Aave v3",
    destination: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
    requiredAssets: Object.freeze(["USDC", "gas"]),
    steps: Object.freeze(["approve(USDC -> Pool)", "supply(USDC, onBehalfOf=Piggy)"]),
    measurableDelta: "USDC down / aMonUSDC up",
    exit: Object.freeze({ mode: "immediate", path: "withdraw(USDC -> Piggy)", expectedDuration: "immediate" }),
    receiptFields: Object.freeze(["approveTx", "supplyTx", "withdrawTx", "usdcBefore", "usdcAfter", "aTokenBefore", "aTokenAfter", "supplyApr", "gasUsed"]),
    stopConditions: Object.freeze(["reserve frozen or paused", "supply cap reached", "gas cost exceeds agreed share", "balance delta mismatch"]),
    forkEvidence: Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, block: 106616273, note: "$5 -> 5.016499 recovered (A-480)" }),
  }),
  Object.freeze({
    id: "curvance-usdc", family: JOB_FAMILY.GROW_STABLE, baseline: false,
    chain: "monad-mainnet", chainId: 143, protocol: "Curvance",
    destination: "0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774",
    requiredAssets: Object.freeze(["USDC", "gas"]),
    steps: Object.freeze(["approve(USDC -> cUSDC)", "deposit(USDC)"]),
    measurableDelta: "USDC down / cUSDC up",
    exit: Object.freeze({ mode: "immediate", path: "redeem(shares)", expectedDuration: "immediate" }),
    receiptFields: Object.freeze(["depositTx", "redeemTx", "usdcBefore", "usdcAfter", "shareBefore", "shareAfter", "gasUsed"]),
    stopConditions: Object.freeze(["vault paused", "insufficient liquidity", "share price unreadable"]),
    forkEvidence: Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, block: 106616273, note: "$5 -> 5.020637 recovered (A-480)" }),
  }),
  Object.freeze({
    id: "neverland-usdc", family: JOB_FAMILY.GROW_STABLE, baseline: false,
    chain: "monad-mainnet", chainId: 143, protocol: "Neverland",
    destination: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585",
    requiredAssets: Object.freeze(["USDC", "gas"]),
    steps: Object.freeze(["approve(USDC -> Pool)", "supply(USDC, onBehalfOf=Piggy)"]),
    measurableDelta: "USDC down / nUSDC up",
    exit: Object.freeze({ mode: "immediate", path: "withdraw(USDC -> Piggy)", expectedDuration: "immediate" }),
    receiptFields: Object.freeze(["supplyTx", "withdrawTx", "usdcBefore", "usdcAfter", "nTokenBefore", "nTokenAfter", "gasUsed"]),
    stopConditions: Object.freeze(["reserve frozen or paused", "insufficient liquidity", "gas cost exceeds agreed share"]),
    forkEvidence: Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, block: 106616273, note: "$5 -> 5.008743 recovered (A-480)" }),
  }),
  Object.freeze({
    id: "kintsu-smon", family: JOB_FAMILY.GROW_DELAYED, baseline: true,
    chain: "monad-mainnet", chainId: 143, protocol: "Kintsu",
    destination: "0xA3227C5969757783154C60bF0bC1944180ed81B9",
    requiredAssets: Object.freeze(["MON", "gas"]),
    steps: Object.freeze(["deposit(minShares, receiver) payable"]),
    measurableDelta: "MON down / sMON up",
    exit: Object.freeze({
      mode: "delayed",
      path: "requestUnlock -> submitBatch -> redeem",
      // 문서에 숫자가 없다. 모르는 것을 모른다고 적는다(A-477).
      expectedDuration: null,
      expectedDurationUnknownReason: "COOLDOWN_PERIOD / BATCH_INTERVAL_DELAY not published (A-477)",
      cancelPath: "cancelUnlockRequest (only before batch submission)",
      exitFeeBips: 10,
    }),
    receiptFields: Object.freeze(["depositTx", "monBefore", "monAfter", "sMonBefore", "sMonAfter", "batchId", "spotValue", "exitFeeInBips", "redeemTx"]),
    stopConditions: Object.freeze(["expected duration still unknown", "batch submission unavailable", "MON exposure not acknowledged"]),
    risks: Object.freeze(["MON price exposure", "return timing unknown", "exit fee 0.10%"]),
    forkEvidence: Object.freeze({
      label: EVIDENCE_LABEL.FORK_SIM_PENDING, block: 106616273,
      note: "entry + requestUnlock + trackable pending PASS; submitBatch blocked on fork; cancel restored full shares (A-480)",
    }),
  }),
  Object.freeze({
    id: "protect-revoke-allowance", family: JOB_FAMILY.PROTECT, baseline: true,
    chain: "monad-mainnet", chainId: 143, protocol: "ERC-20",
    destination: null, // 대상 토큰은 런타임에 정해진다 — 상수로 박지 않는다
    requiredAssets: Object.freeze(["gas"]),
    steps: Object.freeze(["approve(spender, 0)"]),
    measurableDelta: "allowance positive -> 0",
    exit: Object.freeze({ mode: "not_applicable", path: "no money moves; re-approve to undo", expectedDuration: "immediate" }),
    receiptFields: Object.freeze(["revokeTx", "token", "spender", "allowanceBefore", "allowanceAfter", "gasUsed"]),
    stopConditions: Object.freeze(["no allowance to revoke", "target token or spender unresolved"]),
    forkEvidence: Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, block: 106616273, note: "allowance 5 -> 0 (A-480)" }),
  }),
  Object.freeze({
    id: "abil-spot", family: JOB_FAMILY.OWN_RWA, baseline: true,
    chain: "monad-mainnet", chainId: 143, protocol: "public spot AMM",
    destination: "0xFE951b693A2FE54BE5148614B109E316B567632F",
    requiredAssets: Object.freeze(["USDC", "gas"]),
    steps: Object.freeze(["approve(USDC -> router)", "exactInputSingle(USDC -> aBIL, fee 3000)"]),
    measurableDelta: "USDC down / aBIL up",
    exit: Object.freeze({ mode: "immediate", path: "exactInputSingle(aBIL -> USDC)", expectedDuration: "immediate" }),
    receiptFields: Object.freeze(["buyTx", "sellTx", "usdcBefore", "usdcAfter", "abilBefore", "abilAfter", "roundTripCost"]),
    stopConditions: Object.freeze(["pool liquidity absent", "slippage beyond agreed bound", "eligibility gate unresolved"]),
    risks: Object.freeze(["round trip friction about 0.6% at measured snapshot", "thin liquidity", "dividend UNKNOWN"]),
    // A-481 이 확정한 경계. 이 네 줄은 선택이 아니라 계약이다.
    rights: Object.freeze({
      shareholderRights: false,
      statement: "economic exposure only - no voting rights, no shareholder reporting rights, no direct legal ownership",
      dividend: "UNKNOWN",
      dividendReason: "issuer docs define no ETF distribution rule; aBIL wording is venue-sourced only (A-481)",
    }),
    eligibilityGate: "jurisdiction/terms unresolved - runtime fact, not provable here",
    forkEvidence: Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, block: 106616273, note: "$5 -> 0.0544 aBIL -> $4.970045 recovered (A-481)" }),
  }),
]);

// 막혀 있는 경로. 우회하지 않는다 — 왜 막혔는지만 정확히 남긴다.
export const BLOCKED_PATHS = Object.freeze([
  Object.freeze({ id: "monday-direct-issuance", reason: "authenticated partner API + unpublished ABI (A-480)", bypassAllowed: false }),
  Object.freeze({ id: "centrifuge-vault", reason: "investor whitelist: maxDeposit=0, deposit reverts (A-480)", bypassAllowed: false }),
  Object.freeze({ id: "abil-earnausd-lp", reason: "pool liquidity is 0 today; LP distribution attribution UNKNOWN (A-481)", bypassAllowed: false }),
]);

// First Journey 계보. 작동한다고 해서 Second 의 별개 경험으로 세지 않는다.
export const FIRST_JOURNEY_LINEAGE = Object.freeze({
  id: "fastlane-shmon",
  reason: "same user action as the already-PASS First Journey roundtrip",
  countsAsDistinctSecondExperience: false,
});

function adapterUnknown(reason) {
  return { status: PREFLIGHT_STATUS.UNKNOWN, action: ACTION.NONE, reason, executionPermission: false, plan: null };
}

function adapterContextDeficit(destination, context) {
  const address = typeof context?.address === "string" ? context.address.trim() : "";
  const chain = typeof context?.chain === "string" ? context.chain.trim() : "";
  if (!ADAPTER_ADDR.test(address)) return "missing_runtime_address";
  if (!chain || chain === "UNKNOWN") return "missing_runtime_chain";
  if (chain !== destination.chain) return "chain_mismatch";
  return null;
}

/** 사용자에게 보일 심부름 — **가족당 baseline 하나**. 나머지는 같은 칸의 대안이다. */
export function listVisibleJobFamilies() {
  const byFamily = new Map();
  for (const d of FORK_PROVEN_DESTINATIONS) {
    if (!byFamily.has(d.family)) byFamily.set(d.family, { family: d.family, baseline: null, alternatives: [] });
    const slot = byFamily.get(d.family);
    if (d.baseline && !slot.baseline) slot.baseline = d.id;
    else slot.alternatives.push(d.id);
  }
  return [...byFamily.values()];
}

export function listForkProvenDestinations() {
  return FORK_PROVEN_DESTINATIONS.map((d) => ({ id: d.id, family: d.family, baseline: d.baseline, evidence: d.forkEvidence.label }));
}

/**
 * 목적지 하나를 **실행 계획**으로 바꾼다. 실행하지 않는다.
 * 반환은 언제나 `executionPermission: false`, `executionMode` 로 fork/live 를 구분한다.
 */
export function buildExecutionPlan(destinationId, { context = {}, executionMode = EXECUTION_MODE.FORK_SIMULATION, allowanceTarget = null } = {}) {
  const destination = FORK_PROVEN_DESTINATIONS.find((d) => d.id === destinationId);
  if (!destination) return adapterUnknown("unknown_destination");
  if (executionMode !== EXECUTION_MODE.FORK_SIMULATION && executionMode !== EXECUTION_MODE.LIVE) return adapterUnknown("invalid_execution_mode");

  const deficit = adapterContextDeficit(destination, context);
  if (deficit) return adapterUnknown(deficit);

  // Protect 는 취소할 대상이 실제로 있을 때만 계획이 된다.
  if (destination.family === JOB_FAMILY.PROTECT) {
    const token = typeof allowanceTarget?.token === "string" ? allowanceTarget.token.trim() : "";
    const spender = typeof allowanceTarget?.spender === "string" ? allowanceTarget.spender.trim() : "";
    const allowance = typeof allowanceTarget?.allowance === "string" ? allowanceTarget.allowance.trim() : "";
    if (!ADAPTER_ADDR.test(token) || !ADAPTER_ADDR.test(spender)) return adapterUnknown("protect_target_missing");
    if (!/^\d+$/.test(allowance) || allowance === "0") return adapterUnknown("protect_target_absent");
  }

  const plan = {
    id: destination.id,
    family: destination.family,
    chain: destination.chain,
    chainId: destination.chainId,
    protocol: destination.protocol,
    destination: destination.family === JOB_FAMILY.PROTECT ? allowanceTarget.token.trim() : destination.destination,
    account: context.address.trim(),
    requiredAssets: [...destination.requiredAssets],
    steps: [...destination.steps],
    measurableDelta: destination.measurableDelta,
    exit: { ...destination.exit },
    returnMode: destination.exit.mode,
    receiptFields: [...destination.receiptFields],
    stopConditions: [...destination.stopConditions],
    risks: destination.risks ? [...destination.risks] : [],
    forkEvidence: { ...destination.forkEvidence },
    executionMode,
    // live 모드여도 여전히 false 다 — 권한은 이 층이 주지 않는다.
    executionPermission: false,
    permissionRequired: true,
  };
  if (destination.rights) plan.rights = { ...destination.rights };
  if (destination.eligibilityGate) plan.eligibilityGate = destination.eligibilityGate;

  return { status: "PLAN_READY", action: ACTION.ASK, reason: "plan_requires_permission", executionPermission: false, plan };
}

/** fork 증거는 실거래 증거가 아니다. */
export function isLiveProven(label) {
  return label === EVIDENCE_LABEL.MAINNET_TX;
}

export function describeBlockedPath(id) {
  const row = BLOCKED_PATHS.find((b) => b.id === id);
  return row ? { ...row } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// [A-576] Return-evidence reader for the semantic return rule (E first proof)
//
// This turns a Job's OWN exit mechanics (its FORK_PROVEN_DESTINATIONS row plus its
// latest read-only live re-check) into the `value` shape that
// rule-decision.js `decideSemanticReturnRule` reads:
// { returnClass, delay, source, observedAt, stale, conflict }.
//
// What this does not do (contract):
//   · It never turns a duration into a class. The class comes only from `exit.mode`,
//     so there is no hour, day or ms constant, and no global "right back <= X".
//   · It never uses a clock constant to decide freshness. Evidence is stale or
//     conflicting only when an explicit evidence-side signal says so: a reader-supplied
//     expiry, an observation older than the record, or a chain/code/exit mismatch.
//   · It does not execute, grant permission or read the network. `observation` is
//     injected by whoever did a read-only read. No product path does one today.
// ─────────────────────────────────────────────────────────────────────────────

// Latest read-only live re-check per destination. Only rows that were actually read
// appear here. Without a row, observedAt stays null and the decision is `unknown`.
const LIVE_READ_RECORDS = Object.freeze({
  "kintsu-smon": Object.freeze({
    sourceTask: "A-571",
    method: "read-only public RPC: eth_chainId / eth_blockNumber / eth_getCode / eth_call(view)",
    chainId: 143,
    block: 107556248,
    // The date is all that was recorded. The minutes were not ("08:xx"), so none are invented here.
    observedAt: "2026-09-24",
    codePresent: true,
    exitFeeBips: 10,
  }),
});

const EXIT_MODE_RETURN_CLASS = Object.freeze({ immediate: "immediate", delayed: "delayed" });

function returnEvidenceProvenance(destination, live) {
  return {
    jobId: destination.id,
    protocol: destination.protocol,
    chain: destination.chain,
    chainId: destination.chainId,
    contract: destination.destination,
    exitMode: destination.exit.mode,
    exitPath: destination.exit.path,
    expectedDuration: destination.exit.expectedDuration ?? null,
    expectedDurationUnknownReason: destination.exit.expectedDurationUnknownReason || null,
    cancelPath: destination.exit.cancelPath || null,
    exitFeeBips: destination.exit.exitFeeBips ?? null,
    forkEvidence: { ...destination.forkEvidence },
    liveRead: live ? { ...live } : null,
  };
}

function observationSignal(destination, live, observation, nowMs, requireObservation = false) {
  if (!isKnownString(observation.source) || !isKnownString(observation.observedAt)) return "incomplete";
  // [A-579] A decision-time read must name the block it read at. Without one it is not a read.
  if (requireObservation && !Number.isInteger(observation.block)) return "incomplete";
  if (observation.sourceConflict === true || observation.conflict === true) return "conflict";
  if (observation.chainId !== undefined && observation.chainId !== destination.chainId) return "conflict";
  if (observation.codePresent === false) return "conflict";
  if (observation.exitMode !== undefined && observation.exitMode !== destination.exit.mode) return "conflict";
  // [A-579] The exit fee is read from the contract. A value other than the recorded one means
  // the Job changed since it was proven, so its recorded exit mechanics no longer hold.
  if (observation.exitFeeBips !== undefined && observation.exitFeeBips !== destination.exit.exitFeeBips) return "conflict";
  if (observation.stale === true) return "stale";
  // The reader supplies the expiry. This module holds no default lifetime.
  if (typeof observation.expiresAtMs === "number" && typeof nowMs === "number" && Number.isFinite(nowMs) && observation.expiresAtMs <= nowMs) return "stale";
  if (Number.isInteger(observation.block) && Number.isInteger(live?.block) && observation.block < live.block) return "stale";
  // [A-579] An observation dated before the recorded read is older than what we already know.
  // Both dates come from evidence; no clock is consulted here.
  const observedMs = Date.parse(observation.observedAt);
  const recordMs = typeof live?.observedAt === "string" ? Date.parse(live.observedAt) : NaN;
  if (Number.isFinite(observedMs) && Number.isFinite(recordMs) && observedMs < recordMs) return "stale";
  return "";
}

/**
 * The Job's own return evidence, shaped for `decideSemanticReturnRule`.
 * Returns null for an unknown Job. A null value decides as `missing_evidence`.
 * [A-579] `requireObservation: true` = decision-time mode. The recorded read is then
 * provenance only: without a read-only observation made for THIS decision the value has
 * no source/observedAt/block and decides as `unknown` (never `nah`).
 * @param {string} jobId  FORK_PROVEN_DESTINATIONS id, e.g. "kintsu-smon"
 * @param {{observation?: object|null, nowMs?: number, requireObservation?: boolean}} [options]
 */
export function readDestinationReturnEvidence(jobId, { observation = null, nowMs, requireObservation = false } = {}) {
  const destination = FORK_PROVEN_DESTINATIONS.find((d) => d.id === jobId);
  if (!destination) return null;
  const live = LIVE_READ_RECORDS[jobId] || null;
  const provenance = returnEvidenceProvenance(destination, live);
  const unknownDuration = destination.exit.expectedDuration === null || destination.exit.expectedDuration === undefined;
  const delay = destination.exit.mode === "delayed"
    ? `${destination.exit.path}; duration UNKNOWN${unknownDuration && destination.exit.expectedDurationUnknownReason ? ` (${destination.exit.expectedDurationUnknownReason})` : ""}`
    : null;
  const recordSource = `${destination.id} · ${destination.forkEvidence.label} @${destination.forkEvidence.block}${live ? ` · live read @${live.block} (${live.sourceTask})` : ""}`;
  const value = {
    jobId: destination.id,
    returnClass: EXIT_MODE_RETURN_CLASS[destination.exit.mode] || null,
    delay,
    source: recordSource,
    observedAt: live?.observedAt ?? null,
    block: live?.block ?? null,
    stale: false,
    conflict: false,
    // [A-579] Whether the Job states its own return duration. Read by the few_days/no_rush
    // meanings; a duration is never invented to fill it.
    durationKnown: !unknownDuration,
    evidenceMode: live ? "recorded_live_read" : "recorded_fork_only",
    provenance,
  };
  if (!observation) {
    if (!requireObservation) return value;
    return { ...value, source: null, observedAt: null, block: null, evidenceMode: "fresh_read_missing" };
  }

  const signal = observationSignal(destination, live, observation, nowMs, requireObservation);
  const observed = {
    source: typeof observation.source === "string" ? observation.source : null,
    observedAt: typeof observation.observedAt === "string" ? observation.observedAt : null,
    block: Number.isInteger(observation.block) ? observation.block : null,
    // [A-579] the values read at that block, so the Receipt shows what was found where.
    ...(Number.isInteger(observation.chainId) ? { chainId: observation.chainId } : {}),
    ...(typeof observation.codePresent === "boolean" ? { codePresent: observation.codePresent } : {}),
    ...(Number.isInteger(observation.exitFeeBips) ? { exitFeeBips: observation.exitFeeBips } : {}),
    signal: signal || "ok",
  };
  if (signal === "incomplete") {
    // A partial read does not borrow the record's provenance to look complete. It stays missing.
    return { ...value, source: null, observedAt: null, ...(requireObservation ? { block: null } : {}), evidenceMode: "observation_incomplete", provenance: { ...provenance, observation: observed } };
  }
  if (signal === "conflict") return { ...value, conflict: true, evidenceMode: "observation_conflict", provenance: { ...provenance, observation: observed } };
  if (signal === "stale") return { ...value, stale: true, evidenceMode: "observation_stale", provenance: { ...provenance, observation: observed } };
  return {
    ...value,
    source: `${recordSource} · observed ${observed.source}`,
    observedAt: observed.observedAt,
    block: observed.block ?? value.block,
    evidenceMode: "live_observation",
    provenance: { ...provenance, observation: observed },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [A-579] Decision-time read-only observation
//
// Reads a Job's own contract state for ONE decision event and returns the `observation`
// shape that readDestinationReturnEvidence accepts. Contract:
//   · Read-only JSON-RPC methods only (whitelist below). No signing, no sending.
//   · Transport and clock are injected (`fetchImpl`, `now`). This module holds no RPC URL,
//     no default lifetime and no timeout constant. A caller without a configured reader
//     gets `no_rpc` / `no_transport` and the decision stays `unknown`.
//   · All reads are pinned to the one block number returned by eth_blockNumber.
//   · Never throws. Any failure returns `{ observation: null, status }`.
// ─────────────────────────────────────────────────────────────────────────────

export const RETURN_READ_METHODS = Object.freeze(["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"]);

// Per-Job read plan: which view calls prove the Job is still the one that was proven.
// The contract address is not repeated here; it comes from FORK_PROVEN_DESTINATIONS.
const RETURN_READ_PLANS = Object.freeze({
  "kintsu-smon": Object.freeze({
    calls: Object.freeze([
      Object.freeze({ field: "exitFeeBips", signature: "getExitFeeBips()", data: "0xfde73f7d" }),
    ]),
  }),
});

class ReturnReadError extends Error {
  constructor(status) { super(status); this.status = status; }
}

function hexToSafeInteger(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return null;
  const big = BigInt(value);
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : null;
}

/**
 * @param {string} jobId FORK_PROVEN_DESTINATIONS id with a read plan (e.g. "kintsu-smon")
 * @param {{rpcUrl?: string, fetchImpl?: Function, now?: Function}} [options]
 * @returns {Promise<{observation: object|null, status: string}>}
 */
export async function readReturnObservation(jobId, { rpcUrl, fetchImpl, now } = {}) {
  const destination = FORK_PROVEN_DESTINATIONS.find((d) => d.id === jobId);
  const plan = RETURN_READ_PLANS[jobId];
  if (!destination || !plan || !ADAPTER_ADDR.test(destination.destination || "")) return { observation: null, status: "no_read_plan" };
  if (typeof rpcUrl !== "string" || !/^https:\/\/[^\s]+$/.test(rpcUrl)) return { observation: null, status: "no_rpc" };
  if (typeof fetchImpl !== "function" || typeof now !== "function") return { observation: null, status: "no_transport" };
  let id = 0;
  const rpc = async (method, params) => {
    if (!RETURN_READ_METHODS.includes(method)) throw new ReturnReadError("method_not_read_only");
    let response;
    try {
      response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method, params }),
      });
    } catch {
      throw new ReturnReadError("rpc_unreachable");
    }
    if (!response || response.ok !== true || typeof response.json !== "function") throw new ReturnReadError("rpc_unreachable");
    let body;
    try { body = await response.json(); } catch { throw new ReturnReadError("unreadable_result"); }
    if (!body || typeof body !== "object" || body.error || typeof body.result !== "string") throw new ReturnReadError("unreadable_result");
    return body.result;
  };
  try {
    const chainId = hexToSafeInteger(await rpc("eth_chainId", []));
    const block = hexToSafeInteger(await rpc("eth_blockNumber", []));
    if (chainId === null || block === null) throw new ReturnReadError("unreadable_result");
    const blockTag = `0x${block.toString(16)}`;
    const code = await rpc("eth_getCode", [destination.destination, blockTag]);
    if (!/^0x[0-9a-fA-F]*$/.test(code)) throw new ReturnReadError("unreadable_result");
    const fields = {};
    for (const call of plan.calls) {
      const value = hexToSafeInteger(await rpc("eth_call", [{ to: destination.destination, data: call.data }, blockTag]));
      if (value === null) throw new ReturnReadError("unreadable_result");
      fields[call.field] = value;
    }
    const observedAt = now();
    if (!isKnownString(observedAt) || !Number.isFinite(Date.parse(observedAt))) throw new ReturnReadError("unreadable_result");
    return {
      status: "ok",
      observation: {
        source: `read-only rpc ${RETURN_READ_METHODS.join("/")} @${block}`,
        observedAt,
        block,
        chainId,
        codePresent: code.length > 2,
        ...fields,
      },
    };
  } catch (error) {
    return { observation: null, status: error instanceof ReturnReadError ? error.status : "unreadable_result" };
  }
}
