import { explainRejected, selectThreeJobs, updatePreference } from "./job-selector.js";
import { ACTION, RESULT, decideRules, decideSemanticReturnRule } from "./rule-decision.js";
import { DECISION_RECEIPT_SCHEMA, applyExploreSelection, createSecondJourneyState, normalizeSecondJourneyState } from "./second-journey-state.js";
import { decideSecondJobPreflight, readDestinationReturnEvidence, summarizeReadOnlyCandidateEvidence } from "./second-job-readiness.js";

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

// [A-476] 예전에는 여기에 mainnet 성격의 고정 chain 라벨 + A-174 시절 dev 주소가 상수로
// 박혀 있었다. 그 고정값이 J2-3 READY 0 의 **구조적 원인**이었다(A-466): 현재 account/chain 이
// 무엇이든 후보의 target chain/address 는 낡은 fixture 를 가리켜 readiness 가 항상
// target_chain_mismatch / target_address_mismatch 로 떨어졌다.
//
// 이제 현재 Piggy context 는 **런타임에서 들어온다**(scope = 인증된 address + chainId).
// 제품 코드에는 어떤 특정 주소도 새로 박지 않는다 — Harness Piggy 주소 역시 test/harness
// 에서만 주입한다. context 가 없거나 불완전하면 mainnet fixture 로 되돌아가지 않고
// **UNRESOLVED 로 fail-closed** 한다(readiness 가 UNKNOWN/NOT_READY 를 낸다).
export const UNRESOLVED_PIGGY_CONTEXT = Object.freeze({
  piggyId: "UNKNOWN",
  chain: "UNKNOWN",
  address: "UNKNOWN",
  gas: "UNKNOWN",
  assets: Object.freeze({ mon: "UNKNOWN", usdc: "UNKNOWN", kintsuPosition: "UNKNOWN", merklClaimable: "UNKNOWN" }),
  evidenceMode: "no_runtime_context",
});

function isAddressLike(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

// 런타임 scope/context → 후보에 실릴 현재 Piggy context. 주소나 chain 이 하나라도
// 불완전하면 통째로 UNRESOLVED 다(부분 승격 금지).
export function resolveCurrentPiggyContext(runtime = {}) {
  const address = runtime.address ?? runtime.accountId;
  const chain = runtime.chain ?? runtime.chainId;
  if (!isAddressLike(address) || typeof chain !== "string" || chain.trim() === "" || chain.trim() === "UNKNOWN") {
    return UNRESOLVED_PIGGY_CONTEXT;
  }
  return Object.freeze({
    piggyId: "current-runtime-piggy",
    chain: chain.trim(),
    address: address.trim(),
    gas: typeof runtime.gas === "string" ? runtime.gas : "UNKNOWN",
    assets: Object.freeze({
      mon: runtime.assets?.mon ?? "UNKNOWN",
      usdc: runtime.assets?.usdc ?? "UNKNOWN",
      kintsuPosition: runtime.assets?.kintsuPosition ?? "UNKNOWN",
      merklClaimable: runtime.assets?.merklClaimable ?? "UNKNOWN",
    }),
    evidenceMode: typeof runtime.evidenceMode === "string" ? runtime.evidenceMode : "runtime_context_read_only",
  });
}

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

// [A-576] Evidence seam for a destination bound to a real Job record. The address,
// exit path and provenance come from second-job-readiness.js FORK_PROVEN_DESTINATIONS
// by import. This file pins no protocol address (kintsu-capability-gate guard).
// `returnObservations` is an injection point for a read-only read. No product caller
// passes one today, so the recorded read (A-571) is the evidence.
function boundEvidenceState(jobId, returnEvidence, sourceTasks) {
  const p = returnEvidence?.provenance || null;
  return {
    sourceTasks,
    boundJobId: jobId,
    evidenceLabel: p?.forkEvidence?.label || "UNKNOWN",
    evidence: p ? [
      `exit path: ${p.exitPath}`,
      `expected duration: ${p.expectedDuration ?? "UNKNOWN"}${p.expectedDurationUnknownReason ? ` (${p.expectedDurationUnknownReason})` : ""}`,
      `fork: ${p.forkEvidence.label} @${p.forkEvidence.block}`,
      p.liveRead ? `live read-only re-check @${p.liveRead.block} (${p.liveRead.sourceTask}, ${p.liveRead.observedAt})` : "live read-only re-check: none",
    ] : ["UNKNOWN: bound Job record missing"],
    conditions: ["user return tolerance required"],
  };
}

// [A-579] The chain a bound Job lives on vs the chain this runtime runs on. When they differ
// the Job is evidence only here: it can be cited in a decision Receipt but never executed.
// Even on the same chain this path does not execute (capability stays open, action 0).
function boundExecutionContext(runtimeChain, jobChain) {
  const runtime = typeof runtimeChain === "string" && runtimeChain.trim() ? runtimeChain.trim() : "UNKNOWN";
  const job = typeof jobChain === "string" && jobChain.trim() ? jobChain.trim() : "UNKNOWN";
  return {
    runtimeChain: runtime,
    jobChain: job,
    executable: false,
    role: runtime !== "UNKNOWN" && runtime === job ? "same_chain_not_executed" : "evidence_only_other_chain",
  };
}

const KINTSU_DESTINATION_ID = "kintsu-like-grow-delayed-return";

export function buildDestinationFixtures(runtimeContext = {}, evidenceOptions = {}) {
  const CURRENT_PIGGY_CONTEXT = resolveCurrentPiggyContext(runtimeContext);
  // [A-579] Decision-time mode applies to the destination of the current decision event only.
  // In that mode the recorded A-571 read is provenance, not evidence: without a read-only
  // observation made for this event the decision is `unknown`.
  const kintsuReturnEvidence = readDestinationReturnEvidence("kintsu-smon", {
    observation: evidenceOptions.returnObservations?.["kintsu-smon"] ?? null,
    nowMs: evidenceOptions.nowMs,
    requireObservation: evidenceOptions.freshReturnDestinationId === KINTSU_DESTINATION_ID,
  });
  const kintsuJobChain = kintsuReturnEvidence?.provenance?.chain || "UNKNOWN";
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
      id: KINTSU_DESTINATION_ID,
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
        // [A-576] was maxWait:"few_days", an upper bound the real evidence does not support.
        // The duration is not published (A-477), so the bound stays UNKNOWN.
        returnModel: { type: "delayed", known: true, trackable: true, maxWait: null, upperBound: "UNKNOWN" },
      },
      currentPiggyStatus: "CONTEXT_READY",
      currentPiggyContext: {
        ...CURRENT_PIGGY_CONTEXT,
        requiredAssets: ["gas"],
        missingNow: [],
        jobLevelNah: false,
      },
      // [A-576] was the placeholder ["cooldown/read state is evidence", "return queue proof
      // placeholder"]. Now bound to the real kintsu-smon record. capabilityStatus stays
      // JOB_OPEN, so this destination remains Explore-visible and is never Send-visible.
      boundJobId: "kintsu-smon",
      // [A-579] Kintsu is proven on monad-mainnet. The Second Journey runtime is scoped to
      // its own chain (monad-testnet today), so here it is evidence only at the Send gate.
      jobChain: kintsuJobChain,
      executionContext: boundExecutionContext(CURRENT_PIGGY_CONTEXT.chain, kintsuJobChain),
      returnEvidence: kintsuReturnEvidence,
      evidenceState: boundEvidenceState("kintsu-smon", kintsuReturnEvidence, ["A-216", "A-217", "A-477", "A-480", "A-571", "A-576"]),
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

  // [A-576] A destination bound to a real Job record decides the JIT answer from that Job's
  // evidence through decideSemanticReturnRule, not from the fixture returnModel.
  // The JIT answer is the agreed meaning for THIS selection event only: it is not stored
  // as a rule and it creates no permission. A preference hint never enters here.
  // [A-579] every answer (right_back / few_days / no_rush) goes through the Job's evidence.
  if (destination.boundJobId && returnAnswer) {
    return deriveSemanticReturnStatus(destination, returnAnswer);
  }

  if (returnModel.type === "delayed") {
    // [A-579] The old placeholder path (unbound delayed: right_back -> nah, few_days/no_rush
    // -> waiting accepted) decided from a fixture label, not from any Job's evidence. It is
    // gone. An unbound delayed destination is capability-open and decides nothing.
    if (!destination.boundJobId) {
      return { status: STATUS.JOB_OPEN, reasonCode: "return_evidence_unbound", action: ACTION.NONE };
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

function deriveSemanticReturnStatus(destination, returnAnswer) {
  const semantic = decideSemanticReturnRule(
    { id: "return_semantic", field: "returnSemantic", expected: returnAnswer, agreed: true },
    destination.returnEvidence || null,
  );
  const semanticOut = {
    result: semantic.result,
    reason: semantic.reason,
    evidence: semantic.evidence,
    jobId: destination.boundJobId,
    evidenceMode: destination.returnEvidence?.evidenceMode || "missing",
    block: destination.returnEvidence?.block ?? null,
    provenance: destination.returnEvidence?.provenance || null,
    agreedScope: "this_selection_event_only",
  };
  // `rule_nah` is the same category the fixture path used: a rule mismatch, not a dislike.
  if (semantic.result === RESULT.NAH) return { status: STATUS.NAH, reasonCode: "rule_nah", action: ACTION.NONE, semantic: semanticOut };
  if (semantic.result === RESULT.ASK) return { status: STATUS.JOB_OPEN, reasonCode: "return_semantic_ask", action: ACTION.ASK, semantic: semanticOut };
  // A match is still not execution. Capability stays open and the action stays 0 on this path.
  if (semantic.result === RESULT.DO_IT) return { status: STATUS.JOB_OPEN, reasonCode: "return_semantic_match_capability_open", action: ACTION.NONE, semantic: semanticOut };
  if (semantic.reason === "return_duration_unknown") return { status: STATUS.JOB_OPEN, reasonCode: "return_duration_unknown", action: ACTION.NONE, semantic: semanticOut };
  return { status: STATUS.JOB_OPEN, reasonCode: "return_evidence_unknown", action: ACTION.NONE, semantic: semanticOut };
}

const SEMANTIC_DECISION = Object.freeze({ [RESULT.NAH]: "nah", [RESULT.ASK]: "ask", [RESULT.UNKNOWN]: "unknown" });

/**
 * [A-576] Action-0 decision Receipt for the destination the user actually checked.
 * It is persisted by second-journey-state.js recordSecondJourneyDecisionReceipt,
 * which writes to the same storage as every other Second Journey record.
 * It is built only when the semantic path produced nah/ask/unknown. A match or a
 * non-semantic decision yields null. `selectionSource` is the caller's label and is
 * never inferred. Without one it reads UNKNOWN_SELECTION_SOURCE.
 */
export function makeDecisionReceipt(destination, derived, context = {}) {
  const semantic = derived?.semantic;
  if (!destination || !semantic) return null;
  const decision = SEMANTIC_DECISION[semantic.result];
  if (!decision || derived.action === ACTION.EXECUTE) return null;
  const ev = semantic.evidence || {};
  const scope = context.scope || {};
  const selectionEventId = context.selectionEventId || "UNKNOWN_EVENT";
  return {
    schema: DECISION_RECEIPT_SCHEMA,
    eventId: `decision:${selectionEventId}:${destination.id}:${ev.expected}`,
    accountId: scope.accountId || null,
    chainId: scope.chainId || null,
    destinationId: destination.id,
    jobId: semantic.jobId || null,
    decision,
    reason: semantic.reason,
    category: derived.reasonCode,
    expected: ev.expected,
    found: ev.found,
    did: "nothing",
    why: ev.why,
    delay: ev.delay ?? null,
    action: ACTION.NONE,
    actionCount: 0,
    txExecuted: false,
    evidence: {
      source: ev.source && ev.source !== "unknown" ? ev.source : null,
      observedAt: ev.observedAt ?? null,
      block: semantic.block ?? null,
      evidenceMode: semantic.evidenceMode,
      // [A-579] What the decision-time reader reported for this event (e.g. "ok",
      // "reader_unconfigured"). UNKNOWN when the caller did not say.
      readStatus: typeof context.returnReadStatus === "string" && context.returnReadStatus ? context.returnReadStatus : "UNKNOWN",
      provenance: semantic.provenance ? JSON.parse(JSON.stringify(semantic.provenance)) : null,
    },
    // [A-579] The runtime chain this decision ran in vs the chain the Job lives on.
    // A decision Receipt is never executable.
    executionContext: boundExecutionContext(scope.chainId, destination.jobChain),
    selection: {
      source: context.selectionSource || "UNKNOWN_SELECTION_SOURCE",
      errandIds: [...(context.errandIds || [])],
      jitQuestionId: JIT_QUESTION.id,
      jitAnswer: ev.expected,
      semanticScope: semantic.agreedScope,
      ownerFinancialChoice: false,
      createsPermission: false,
    },
    recordedAt: context.now || "UNKNOWN_TIME",
  };
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
  // [A-476] 후보의 현재 Piggy context = **런타임 scope**(인증된 address + chainId).
  // options.piggyContext 는 test/harness 전용 주입구다(제품 코드에는 주소 상수 0).
  const runtimeContext = options.piggyContext || { address: scope?.accountId, chain: scope?.chainId };
  // [A-579] `requireFreshReturnObservation` = decision-time mode for the destination the user
  // checked. Default false keeps the recorded-read behaviour for every other caller.
  const freshReturnDestinationId = options.requireFreshReturnObservation === true ? options.preferredDestinationId || null : null;
  const destinations = buildDestinationFixtures(runtimeContext, { returnObservations: options.returnObservations, nowMs: options.nowMs, freshReturnDestinationId })
    .filter((destination) => destination.errandIds?.some((id) => selection.errandIds.includes(id)))
    .map((destination) => ({ ...destination, ...(destinationOverrides[destination.id] || {}) }));
  const derivedDestinations = destinations.map((destination) => {
    const derived = deriveDestinationStatus(destination, agreedRule || {});
    return { ...destination, derivedStatus: derived.status, decision: derived };
  });
  const preferred = derivedDestinations.find((destination) => destination.id === options.preferredDestinationId) || derivedDestinations.find((destination) => destination.derivedStatus !== STATUS.NAH) || derivedDestinations[0] || null;
  const receipt = makeMockReceipt(preferred, preferred?.decision || { status: STATUS.NOT_JOB, reasonCode: "no_destination" }, preferenceUpdate);
  // [A-576] Action-0 decision Receipt, only for the destination the user actually checked.
  // It is not persisted here: the caller hands it to second-journey-state.js.
  const checked = options.preferredDestinationId ? derivedDestinations.find((destination) => destination.id === options.preferredDestinationId) || null : null;
  // [A-579] A live caller passes its own decisionEventId; without it every live Receipt would
  // share the fixture id and be dropped as a duplicate.
  const decisionReceipt = checked ? makeDecisionReceipt(checked, checked.decision, {
    scope,
    selectionEventId: options.decisionEventId || options.eventId || "fixture-selection-1",
    selectionSource: options.selectionSource,
    errandIds: selection.errandIds,
    returnReadStatus: options.returnReadStatus,
    now: options.decisionAt || options.now,
  }) : null;
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
    decisionReceipt,
    txExecuted: false,
    uiImplemented: false,
  };
}

export function runSecondJobFlow(options = {}) {
  return runSecondJourney(options);
}
