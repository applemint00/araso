import { explainRejected, selectThreeJobs, updatePreference } from "./job-selector.js";
import { ACTION, RESULT, decideRules } from "./rule-decision.js";
import { applyExploreSelection, createSecondJourneyState, normalizeSecondJourneyState } from "./second-journey-state.js";
import { decideSecondJobPreflight, summarizeReadOnlyCandidateEvidence } from "./second-job-readiness.js";

export const STATUS = Object.freeze({
  JOB_READY: "JOB_READY",
  JOB_ELIGIBLE_NEEDS_FUNDING: "JOB_ELIGIBLE_NEEDS_FUNDING",
  JOB_WAITING_RETURN: "JOB_WAITING_RETURN",
  JOB_CONDITIONAL: "JOB_CONDITIONAL",
  JOB_OPEN: "JOB_OPEN",
  NAH: "NAH",
  NOT_JOB: "NOT_JOB",
});

export const FIRST_JOB_RECEIPT = Object.freeze({
  sourceTask: "A-174",
  flow: "Invite/Birth/Home/Send/Away/File Box",
  action: "first_job_shmon_roundtrip",
  address: "0x4DCDA9fD1B320C36d2B6D3C77bc98a8a4f14e500",
  depositTx: "0x088e511140dfb9ee6f5aabe835478395d2f77268c1fb63907c634838f0bdc45c",
  redeemTx: "0xe8fb2d81a058cea22aca165ffa99b5a126fb19893165e523d1db5898a6525d97",
  depositBlock: 61230270,
  redeemBlock: 61230275,
  shmonReceived: "77639184641355",
  finalShmonBalance: "0",
  receiptClosed: true,
});

export const EXPLORE_ERRANDS = Object.freeze([
  {
    id: "market",
    label: "시장 다녀오기",
    lane: "Trade",
    kind: "errand_intent",
    reason: "novelty",
    baseScore: 0.45,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
  {
    id: "order",
    label: "주문 걸고 오기",
    lane: "Order",
    kind: "errand_intent",
    reason: "clarity",
    baseScore: 0.43,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
  {
    id: "clean",
    label: "지갑 청소하기",
    lane: "Protect",
    kind: "errand_intent",
    reason: "lowCost",
    baseScore: 0.42,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
  {
    id: "claim",
    label: "받을 것 받아오기",
    lane: "Claim",
    kind: "errand_intent",
    reason: "clarity",
    baseScore: 0.39,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
  {
    id: "asset-piece",
    label: "자산 조각 가져오기",
    lane: "Own",
    kind: "errand_intent",
    reason: "novelty",
    baseScore: 0.35,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "watch",
  },
  {
    id: "grow",
    label: "돈 좀 일시키고 오기",
    lane: "Grow",
    kind: "errand_intent",
    reason: "yield",
    baseScore: 0.34,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
  {
    id: "move",
    label: "다른 자리로 옮기기",
    lane: "Move",
    kind: "errand_intent",
    reason: "liquidity",
    baseScore: 0.32,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
  {
    id: "stay",
    label: "집에 있기",
    lane: "Reserve",
    kind: "errand_intent",
    reason: "clarity",
    baseScore: 0.3,
    permission: "known",
    exit: "known",
    testSize: "known",
    cost: "known",
    availability: "open",
  },
]);

export const SHMON_CURRENT_EVIDENCE = Object.freeze({
  sourceTask: "A-188",
  block: 61250600,
  chain: "monad-testnet",
  contract: "0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9",
  role: "first_job_receipt_evidence_only",
});

const CURRENT_PIGGY_CONTEXT = Object.freeze({
  piggyId: "a174-local-piggy",
  chain: "monad-mainnet-fixture",
  address: FIRST_JOB_RECEIPT.address,
  gas: "NEEDS_FUNDING",
  assets: { mon: "0", usdc: "0", kintsuPosition: "0", merklClaimable: "0" },
  evidenceMode: "fixture_not_live",
});

const JIT_QUESTION = Object.freeze({
  id: "return_tolerance",
  prompt: "How long can Piggy stay out?",
  answers: Object.freeze(["right_back", "few_days", "no_rush"]),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function buildVisibleLaneChoices() {
  return EXPLORE_ERRANDS.map((errand) => ({ ...errand, visibleAs: "Explore-visible", destinationId: null }));
}

export function buildDestinationFixtures() {
  return [
    {
      id: "aave-like-grow-supply",
      laneId: "grow",
      errandIds: ["grow"],
      destinationKind: "destination_job_fixture",
      title: "Aave-like Grow supply",
      capabilityStatus: "qualified",
      capabilityContext: {
        contractActionPath: "known fixture action path",
        measurableStateChange: "supply position balance changes",
        meaningfulSize: "bounded fixture amount",
        feeCostModel: "known placeholder",
        exitReturnPath: "withdraw path modeled",
        cooldownLockQueue: "none in fixture",
        receiptReopenProofShape: "supply receipt + withdraw proof placeholder",
        returnModel: { type: "immediate", known: true, trackable: true, maxWait: "right_back" },
      },
      currentPiggyStatus: "NEEDS_FUNDING",
      currentPiggyContext: {
        ...CURRENT_PIGGY_CONTEXT,
        requiredAssets: ["gas", "USDC"],
        missingNow: ["gas", "USDC"],
        jobLevelNah: false,
      },
      evidenceState: {
        sourceTasks: ["A-216", "A-217"],
        evidence: ["balance read", "allowance read", "supply/withdraw shape"],
        conditions: ["asset funding required"],
      },
    },
    {
      id: "kintsu-like-grow-delayed-return",
      laneId: "grow",
      errandIds: ["grow"],
      destinationKind: "destination_job_fixture",
      title: "Kintsu-like Grow with delayed return",
      capabilityStatus: STATUS.JOB_OPEN,
      capabilityContext: {
        contractActionPath: "open fixture until contract/constants are closed",
        measurableStateChange: "lst balance changes",
        meaningfulSize: "bounded fixture amount",
        feeCostModel: "known placeholder",
        exitReturnPath: "delayed return path modeled",
        cooldownLockQueue: "known trackable waiting state",
        receiptReopenProofShape: "stake receipt + queue/claim proof placeholder",
        returnModel: { type: "delayed", known: true, trackable: true, maxWait: "few_days" },
      },
      currentPiggyStatus: "CONTEXT_READY",
      currentPiggyContext: {
        ...CURRENT_PIGGY_CONTEXT,
        requiredAssets: ["gas"],
        missingNow: [],
        jobLevelNah: false,
      },
      evidenceState: {
        sourceTasks: ["A-216", "A-217", "A-217-post-discussion"],
        evidence: ["cooldown/read state is evidence", "return queue proof placeholder"],
        conditions: ["user return tolerance required"],
      },
    },
    {
      id: "monad-swap-like-trade",
      laneId: "trade",
      errandIds: ["market", "order"],
      destinationKind: "destination_job_fixture",
      title: "Swap-like Trade",
      capabilityStatus: "qualified",
      capabilityContext: {
        contractActionPath: "router swap path fixture",
        measurableStateChange: "asset A decreases and asset B increases",
        meaningfulSize: "bounded fixture amount",
        feeCostModel: "fee/slippage placeholders",
        exitReturnPath: "reverse trade is possible but principal return is not guaranteed",
        cooldownLockQueue: "none in fixture",
        receiptReopenProofShape: "swap receipt + quote proof placeholder",
        returnModel: { type: "conditional", known: true, trackable: true, note: "market return is not guaranteed" },
      },
      currentPiggyStatus: "NEEDS_FUNDING",
      currentPiggyContext: {
        ...CURRENT_PIGGY_CONTEXT,
        requiredAssets: ["gas", "input token"],
        missingNow: ["gas", "input token"],
        jobLevelNah: false,
      },
      evidenceState: {
        sourceTasks: ["A-216", "A-217"],
        evidence: ["quote/read state supports condition only"],
        conditions: ["funding required", "principal return not promised"],
      },
    },
    {
      id: "merkl-like-collect-claim",
      laneId: "collect",
      errandIds: ["claim"],
      destinationKind: "destination_job_fixture",
      title: "Merkl-like Collect claim",
      capabilityStatus: STATUS.JOB_CONDITIONAL,
      capabilityContext: {
        contractActionPath: "claim action path fixture",
        measurableStateChange: "reward balance increases after claim",
        meaningfulSize: "requires claimable reward",
        feeCostModel: "claim gas placeholder",
        exitReturnPath: "claimed asset is held by Piggy",
        cooldownLockQueue: "none in fixture",
        receiptReopenProofShape: "claim receipt + proof placeholder",
        returnModel: { type: "conditional", known: true, trackable: true },
      },
      currentPiggyStatus: "CONDITIONAL_CLAIMABLE_ABSENT",
      currentPiggyContext: {
        ...CURRENT_PIGGY_CONTEXT,
        requiredAssets: ["claim proof", "gas"],
        missingNow: ["claimable reward", "proof"],
        jobLevelNah: false,
      },
      evidenceState: {
        sourceTasks: ["A-216", "A-217"],
        evidence: ["claimable read is evidence, not the Job"],
        conditions: ["claimable reward and proof must exist"],
      },
    },
  ];
}

function normalizeSelection(selectionKind = "one", selectedErrandIds = ["market"]) {
  const choices = buildVisibleLaneChoices();
  const offered = new Set(choices.map((choice) => choice.id));
  const ids = [...new Set((selectedErrandIds || []).filter((id) => offered.has(id)))];
  if (selectionKind === "all") return { kind: "all", errandIds: choices.map((choice) => choice.id), errands: choices };
  if (selectionKind === "none" || selectionKind === "unsure") return { kind: selectionKind, errandIds: [], errands: [] };
  if (ids.length === 0) return { kind: "none", errandIds: [], errands: [] };
  const errands = ids.map((id) => choices.find((choice) => choice.id === id)).filter(Boolean);
  if (errands.length >= choices.length) return { kind: "all", errandIds: choices.map((choice) => choice.id), errands: choices };
  return { kind: errands.length === 1 ? "one" : "multi", errandIds: errands.map((errand) => errand.id), errands };
}

function applyPreference(preference, selection, decisionTimeMs, baselineDecisionTimeMs) {
  const offered = buildVisibleLaneChoices();
  const selected = selection.errandIds.map((id) => offered.find((errand) => errand.id === id)).filter(Boolean);
  const signal = updatePreference(preference, {
    kind: selection.kind === "multi" || selection.kind === "one" ? "select" : selection.kind,
    selectedJobs: selected,
    offeredJobs: offered,
    offeredCount: offered.length,
    decisionTimeMs,
    baselineDecisionTimeMs,
    setIndex: 2,
  });
  return {
    ...signal,
    executionPermission: false,
    agreedRule: null,
  };
}

export function buildJitQuestions(selection) {
  if (!selection?.errandIds?.length) return [];
  return [clone(JIT_QUESTION)];
}

export function deriveDestinationStatus(destination, context = {}) {
  const returnAnswer = context.returnTolerance || null;
  const returnModel = destination.capabilityContext.returnModel;

  if (destination.destinationKind !== "destination_job_fixture") {
    return { status: STATUS.NOT_JOB, reasonCode: "not_destination_job", action: ACTION.NONE };
  }

  if (destination.capabilityStatus === STATUS.JOB_OPEN && returnModel.type !== "delayed") {
    return { status: STATUS.JOB_OPEN, reasonCode: "capability_open", action: ACTION.NONE };
  }

  if (returnModel.type === "delayed") {
    if (returnAnswer === "right_back") {
      return { status: STATUS.NAH, reasonCode: "rule_nah", action: ACTION.NONE };
    }
    if (returnAnswer === "few_days" || returnAnswer === "no_rush") {
      return { status: STATUS.JOB_WAITING_RETURN, reasonCode: "return_waiting_accepted", action: ACTION.NONE };
    }
    return { status: STATUS.JOB_OPEN, reasonCode: "return_tolerance_unknown", action: ACTION.ASK };
  }

  if (destination.currentPiggyStatus === "NEEDS_FUNDING") {
    return { status: STATUS.JOB_ELIGIBLE_NEEDS_FUNDING, reasonCode: "current_context_needs_funding", action: ACTION.NONE };
  }

  if (destination.capabilityStatus === STATUS.JOB_CONDITIONAL || destination.currentPiggyStatus === "CONDITIONAL_CLAIMABLE_ABSENT") {
    return { status: STATUS.JOB_CONDITIONAL, reasonCode: "condition_missing", action: ACTION.NONE };
  }

  return { status: STATUS.JOB_READY, reasonCode: "ready_fixture", action: ACTION.EXECUTE };
}

export function makeMockReceipt(destination, derived, preferenceUpdate) {
  return {
    receiptKind: "mock_second_journey_receipt",
    destinationId: destination?.id || null,
    attempted: Boolean(destination),
    decidedStatus: derived?.status || STATUS.NOT_JOB,
    reasonCode: derived?.reasonCode || "no_destination",
    txExecuted: false,
    realActionExecuted: false,
    stateChange: derived?.status === STATUS.JOB_READY ? "mock_state_change_only" : null,
    cost: { amount: "0", source: "mock_placeholder" },
    evidencePointer: destination?.evidenceState?.sourceTasks || [],
    returnStatus: destination?.capabilityContext?.returnModel || null,
    proofPlaceholders: ["mock receipt", "mock reopen proof"],
    learn: {
      preferenceUpdated: preferenceUpdate?.signal === "one" || preferenceUpdate?.signal === "multi" || preferenceUpdate?.signal === "all",
      knowledgeUpdated: false,
      evidenceUpdated: true,
    },
  };
}

export function runInternalPreflight(job, scenario = "unchanged") {
  if (!job?.rules?.length) return { result: "unknown", action: ACTION.NONE, reason: "missing_rules", decisions: [] };
  const found = scenario === "breach" ? 2 : 1;
  const block = scenario === "missing" ? null : 1;
  return decideRules(job.rules, { amount: { found, block, source: "fixture", changed: scenario === "material" } });
}

export function buildSecondJobCandidateFeed() {
  return buildVisibleLaneChoices();
}

export function selectSecondJobCandidates(preference = {}) {
  const withRuleFixture = buildVisibleLaneChoices().map((lane) => ({
    ...lane,
    rules: [{ id: "amount", field: "amount", comparator: "lte", expected: 1, agreed: true, materialityPct: 0.1 }],
  }));
  const { selected, rejected } = selectThreeJobs(withRuleFixture, preference, { withRejected: true });
  return { selected, rejected: [...rejected, ...explainRejected(withRuleFixture).filter((row) => !rejected.some((r) => r.id === row.id))] };
}

export function runSecondJourney(options = {}) {
  const defaultScope = options.scope || { accountId: "fixture-account", chainId: "monad-testnet" };
  const restoredScope = options.secondJourneyState ? {
    accountId: options.secondJourneyState.accountId,
    chainId: options.secondJourneyState.chainId,
  } : defaultScope;
  const scope = options.scope || restoredScope;
  const restored = options.secondJourneyState ? normalizeSecondJourneyState(options.secondJourneyState, scope, { requirePersistedIdentity: true }) : null;
  if (restored?.error) {
    return {
      visibleFlow: ["First shMON Receipt", "Explore Errand Choices", "Errand Selection", "Explicit Interest List + PreferenceState seed", "JIT <=1", "Destination/current evidence", "Rule/Permission preflight", "Mock Receipt/Learn"],
      firstReceipt: FIRST_JOB_RECEIPT,
      visibleChoices: buildVisibleLaneChoices(),
      selection: normalizeSelection(options.selectionKind, options.selectedErrandIds ?? options.selectedLaneIds ?? options.pickIds ?? ["market"]),
      preferenceState: { before: {}, after: {}, signal: "state_error", delta: {}, fixedPersonalityLabel: null, executionPermission: false, agreedRule: null },
      knowledgeState: { source: "not_updated_by_preference", inferredFromPreference: false, observedDemonstrations: [] },
      evidenceState: { firstReceiptTask: FIRST_JOB_RECEIPT.sourceTask, destinationEvidence: [] },
      jitQuestions: [],
      agreedRule: null,
      destinations: [],
      explicitInterestState: restored.state,
      stateUpdate: { duplicate: false, preferenceApplied: false },
      preflight: { status: "UNKNOWN", action: ACTION.NONE, reason: restored.error, executionPermission: false, ruleDecision: null },
      readOnlyCandidateEvidence: [],
      mockReceipt: makeMockReceipt(null, { status: STATUS.NOT_JOB, reasonCode: restored.error }, null),
      txExecuted: false,
      uiImplemented: false,
      stateError: restored.error,
    };
  }
  const startingState = restored?.state || createSecondJourneyState(scope);
  const seededState = restored ? startingState : normalizeSecondJourneyState({ ...startingState, preference: options.preference || startingState.preference }, scope).state;
  const basePreference = seededState.preference;
  const selection = normalizeSelection(options.selectionKind, options.selectedErrandIds ?? options.selectedLaneIds ?? options.pickIds ?? ["market"]);
  const preferenceUpdate = applyPreference(basePreference, selection, options.decisionTimeMs ?? 900, options.baselineDecisionTimeMs ?? 1000);
  const jitQuestions = buildJitQuestions(selection);
  const agreedRule = options.jitAnswer ? { returnTolerance: options.jitAnswer } : null;
  const destinationOverrides = options.destinationOverrides || {};
  const destinations = buildDestinationFixtures()
    .filter((destination) => destination.errandIds?.some((id) => selection.errandIds.includes(id)))
    .map((destination) => ({ ...destination, ...(destinationOverrides[destination.id] || {}) }));
  const derivedDestinations = destinations.map((destination) => {
    const derived = deriveDestinationStatus(destination, agreedRule || {});
    return { ...destination, derivedStatus: derived.status, decision: derived };
  });
  const preferred = derivedDestinations.find((destination) => destination.id === options.preferredDestinationId) || derivedDestinations.find((destination) => destination.derivedStatus !== STATUS.NAH) || derivedDestinations[0] || null;
  const receipt = makeMockReceipt(preferred, preferred?.decision || { status: STATUS.NOT_JOB, reasonCode: "no_destination" }, preferenceUpdate);
  const stateUpdate = applyExploreSelection(seededState, selection, preferenceUpdate, { eventId: options.eventId || "fixture-selection-1", now: options.now || "2026-09-11T00:00:00Z" });
  const effectivePreferenceAfter = stateUpdate.duplicate ? stateUpdate.state.preference : preferenceUpdate.preference;
  const effectiveDelta = stateUpdate.duplicate ? {} : preferenceUpdate.delta;
  const preflight = preferred ? decideSecondJobPreflight(preferred, {
    rules: options.rules || [{ id: "amount", field: "amount", comparator: "lte", expected: 1, agreed: Boolean(options.ruleAgreed) }],
    values: options.ruleValues || { amount: { found: 1, block: options.evidenceBlock || null, source: "fixture" } },
    permission: options.permission === true,
    evidence: options.readinessEvidence || {},
    nowMs: options.nowMs,
  }) : null;

  return {
    visibleFlow: ["First shMON Receipt", "Explore Errand Choices", "Errand Selection", "Explicit Interest List + PreferenceState seed", "JIT <=1", "Destination/current evidence", "Rule/Permission preflight", "Mock Receipt/Learn"],
    firstReceipt: FIRST_JOB_RECEIPT,
    visibleChoices: buildVisibleLaneChoices(),
    selection,
    preferenceState: {
      before: basePreference,
      after: effectivePreferenceAfter,
      signal: stateUpdate.duplicate ? "duplicate_event" : preferenceUpdate.signal,
      delta: effectiveDelta,
      fixedPersonalityLabel: preferenceUpdate.fixedPersonalityLabel,
      executionPermission: false,
      agreedRule: null,
    },
    knowledgeState: {
      source: "not_updated_by_preference",
      inferredFromPreference: false,
      observedDemonstrations: [],
    },
    evidenceState: {
      firstReceiptTask: FIRST_JOB_RECEIPT.sourceTask,
      destinationEvidence: derivedDestinations.map((destination) => ({ id: destination.id, evidence: destination.evidenceState, currentPiggyContext: destination.currentPiggyContext })),
    },
    jitQuestions,
    agreedRule,
    destinations: derivedDestinations,
    explicitInterestState: stateUpdate.state,
    stateUpdate: { duplicate: stateUpdate.duplicate, preferenceApplied: stateUpdate.preferenceApplied },
    preflight,
    readOnlyCandidateEvidence: summarizeReadOnlyCandidateEvidence(derivedDestinations, { ...(options.readOnlyContext || {}), nowMs: options.nowMs ?? options.readOnlyContext?.nowMs }),
    mockReceipt: receipt,
    txExecuted: false,
    uiImplemented: false,
  };
}

export function runSecondJobFlow(options = {}) {
  return runSecondJourney(options);
}
