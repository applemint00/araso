// Mainnet Job lane — ONE Job (Aave v3 USDC supply, then withdraw to the same Piggy), one asset,
// one Piggy, one errand, one permission, one Receipt. Runs only under the "monad-mainnet" chain
// profile (chain-profile.js).
//
// What this module does:
//   · pre-action read: a block-pinned, read-only read of the Job's own contract state and the
//     Piggy's balances (transport injected; the product passes none, so the read is unconfigured);
//   · decision: the existing contract in rule-decision.js (decideRules + decideSemanticReturnRule),
//     never a new engine. unknown stays unknown; nah and ask are action 0;
//   · exact permission preview bound to chain / asset / action / amount / target / Piggy, shaped
//     for permission-envelope.js (issuePermission / authorize);
//   · lifecycle record bound to chain + asset + token + Piggy, persisted before every send, with
//     pending / revert / success / unknown and no automatic retry;
//   · Receipt fields from measured balances only, labelled with the evidence class that produced
//     them (a local fork run is PASS_FORK_SIM and is never promoted).
//
// What it does not do: sign, hold a key, pick a network, or execute live. The profile's
// `liveExecution` is false, so only an injected executor of kind "local_fork" can advance the
// lifecycle, and no product code constructs one.

import { decodeFunctionResult, encodeFunctionData, maxUint256 } from "viem";
import { ACTION, RESULT, decideRules, decideSemanticReturnRule } from "./rule-decision.js";
import {
  EVIDENCE_LABEL,
  EXECUTION_MODE,
  JOB_FAMILY,
  RETURN_READ_METHODS,
  buildExecutionPlan,
  readDestinationReturnEvidence,
} from "./second-job-readiness.js";
import { DECISION_RECEIPT_SCHEMA, validateDecisionReceipt } from "./second-journey-state.js";
import { authorize, consume, onUnknownOutcome, permissionNonce } from "./permission-envelope.js";
import { CHAIN_PROFILE_ID, bindRecordToProfile, checkRecordBinding, isProfileActive } from "./chain-profile.js";
import { executeMoneyStep, TRANSPORT_KIND } from "./money-executor.js";

export const LANE_JOB_ID = "aave-usdc";
export const LANE_ACTION = "grow_stable_roundtrip";
// The Explore destination this Job stands behind (job-feed.js fixture with an immediate return model).
export const LANE_DESTINATION_ID = "aave-like-grow-supply";
const LANE_ERRAND_IDS = Object.freeze(["grow"]);
const LANE_JIT_QUESTION_ID = "return_tolerance";

// The Pool's receipt token for USDC, re-derived on chain from getReserveData(USDC).aTokenAddress
// at the pinned fork block and equal to the recorded value.
export const LANE_RECEIPT_TOKEN = Object.freeze({
  symbol: "aMonUSDC",
  address: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042",
  decimals: 6,
});

// Fork evidence this lane was built from (mainnet fork, chain 143, no time warp).
export const LANE_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 108999816,
  blockTimestamp: "2026-09-29T09:24:32Z",
  sentRaw: "5000000",
  returnedRaw: "4999999",
  deltaRaw: "-1",
  gasUsed: Object.freeze({ approve: 55437, supply: 197122, withdraw: 177464 }),
  exit: "immediate",
  revertProbe: Object.freeze({ step: "withdraw with zero position", selector: "0x47bc4b2c", name: "NotEnoughAvailableUserBalance()" }),
  unmeasured: Object.freeze(["supplyApr", "gasUsd"]),
});

// The only size proven end to end on the fork. A different cap is an Owner decision.
export const LANE_AMOUNT_CAP_RAW = "5000000";

// Product config for this lane: no reader, no writer. Both stay off until a separate Owner step.
export const MAINNET_LANE_CONFIG = Object.freeze({ reader: null, liveExecution: false });

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const lower = (v) => String(v || "").toLowerCase();
const isDigits = (v) => typeof v === "string" && /^\d+$/.test(v);

const ERC20_ABI = Object.freeze([
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
]);

const POOL_ABI = Object.freeze([
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "onBehalfOf", type: "address" }, { name: "referralCode", type: "uint16" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getReserveData", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "configuration", type: "uint256" }, { name: "liquidityIndex", type: "uint128" }, { name: "currentLiquidityRate", type: "uint128" },
    { name: "variableBorrowIndex", type: "uint128" }, { name: "currentVariableBorrowRate", type: "uint128" }, { name: "currentStableBorrowRate", type: "uint128" },
    { name: "lastUpdateTimestamp", type: "uint40" }, { name: "id", type: "uint16" }, { name: "aTokenAddress", type: "address" },
    { name: "stableDebtTokenAddress", type: "address" }, { name: "variableDebtTokenAddress", type: "address" }, { name: "interestRateStrategyAddress", type: "address" },
    { name: "accruedToTreasury", type: "uint128" }, { name: "unbacked", type: "uint128" }, { name: "isolationModeTotalDebt", type: "uint128" }] }] },
]);

export const LANE_SELECTORS = Object.freeze({
  approve: "0x095ea7b3",
  supply: "0x617ba037",
  withdraw: "0x69328dec",
  getReserveData: "0x35ea6a75",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
});

function isLaneProfile(profile) {
  return isProfileActive(profile) && profile.id === CHAIN_PROFILE_ID.MAINNET && profile.jobId === LANE_JOB_ID
    && !!profile.usdc && ADDR.test(profile.usdc.address);
}

function lanePlan(profile, piggyAddress) {
  const out = buildExecutionPlan(LANE_JOB_ID, { context: { address: piggyAddress, chain: profile.scope }, executionMode: EXECUTION_MODE.LIVE });
  return out.plan && ADDR.test(out.plan.destination || "") ? out.plan : null;
}

/** Reserve configuration bitmap: decimals bits 48-55, active 56, frozen 57, paused 60. */
export function decodeReserveConfiguration(word) {
  if (typeof word !== "bigint" || word < 0n) return null;
  return {
    decimals: Number((word >> 48n) & 0xffn),
    active: ((word >> 56n) & 1n) === 1n,
    frozen: ((word >> 57n) & 1n) === 1n,
    paused: ((word >> 60n) & 1n) === 1n,
  };
}

class LaneReadError extends Error {
  constructor(status) { super(status); this.status = status; }
}

/**
 * Block-pinned, read-only pre-action read. Transport and clock are injected; without them the
 * read does not happen and the decision stays unknown.
 * @returns {Promise<{status: string, read: object|null}>}
 */
export async function readLanePreAction({ profile, piggyAddress, rpcUrl, fetchImpl, now } = {}) {
  if (!isLaneProfile(profile)) return { status: "profile_not_mainnet_lane", read: null };
  if (!ADDR.test(piggyAddress || "")) return { status: "missing_piggy_address", read: null };
  const plan = lanePlan(profile, piggyAddress);
  if (!plan) return { status: "no_read_plan", read: null };
  if (typeof rpcUrl !== "string" || !/^https:\/\/[^\s]+$/.test(rpcUrl)) return { status: "no_rpc", read: null };
  if (typeof fetchImpl !== "function" || typeof now !== "function") return { status: "no_transport", read: null };
  const pool = plan.destination;
  const usdc = profile.usdc.address;
  let id = 0;
  const rpc = async (method, params) => {
    if (!RETURN_READ_METHODS.includes(method)) throw new LaneReadError("method_not_read_only");
    let response;
    try {
      response = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method, params }) });
    } catch {
      throw new LaneReadError("rpc_unreachable");
    }
    if (!response || response.ok !== true || typeof response.json !== "function") throw new LaneReadError("rpc_unreachable");
    let body;
    try { body = await response.json(); } catch { throw new LaneReadError("unreadable_result"); }
    if (!body || typeof body !== "object" || body.error || typeof body.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) throw new LaneReadError("unreadable_result");
    return body.result;
  };
  const call = async (to, abi, functionName, args, blockTag) => {
    const data = encodeFunctionData({ abi, functionName, args });
    const raw = await rpc("eth_call", [{ to, data }, blockTag]);
    try { return decodeFunctionResult({ abi, functionName, data: raw }); } catch { throw new LaneReadError("unreadable_result"); }
  };
  try {
    const chainHex = await rpc("eth_chainId", []);
    const blockHex = await rpc("eth_blockNumber", []);
    const chainId = Number(BigInt(chainHex));
    const block = Number(BigInt(blockHex));
    if (!Number.isSafeInteger(chainId) || !Number.isSafeInteger(block) || block < 0) throw new LaneReadError("unreadable_result");
    const blockTag = `0x${block.toString(16)}`;
    const code = await rpc("eth_getCode", [pool, blockTag]);
    const reserveData = await call(pool, POOL_ABI, "getReserveData", [usdc], blockTag);
    const config = decodeReserveConfiguration(reserveData?.configuration);
    if (!config || !ADDR.test(reserveData?.aTokenAddress || "")) throw new LaneReadError("unreadable_result");
    const usdcRaw = await call(usdc, ERC20_ABI, "balanceOf", [piggyAddress], blockTag);
    const aTokenRaw = await call(LANE_RECEIPT_TOKEN.address, ERC20_ABI, "balanceOf", [piggyAddress], blockTag);
    const allowanceRaw = await call(usdc, ERC20_ABI, "allowance", [piggyAddress, pool], blockTag);
    if (typeof usdcRaw !== "bigint" || typeof aTokenRaw !== "bigint" || typeof allowanceRaw !== "bigint") throw new LaneReadError("unreadable_result");
    const observedAt = now();
    if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) throw new LaneReadError("unreadable_result");
    return {
      status: "ok",
      read: {
        source: `read-only rpc ${RETURN_READ_METHODS.join("/")} @${block}`,
        observedAt,
        chainId,
        block,
        pool,
        codePresent: code.length > 2,
        reserve: { ...config, aTokenAddress: reserveData.aTokenAddress },
        piggy: { address: piggyAddress, usdcRaw: usdcRaw.toString(), aTokenRaw: aTokenRaw.toString(), allowanceRaw: allowanceRaw.toString() },
      },
    };
  } catch (error) {
    return { status: error instanceof LaneReadError ? error.status : "unreadable_result", read: null };
  }
}

// A read that no longer describes the proven Job is a conflict (unknown), never a nah.
function readConflict(profile, piggyAddress, read) {
  if (!read) return null;
  if (read.chainId !== profile.numericChainId) return "chain_mismatch";
  if (read.codePresent !== true) return "code_absent";
  if (lower(read.reserve?.aTokenAddress) !== lower(LANE_RECEIPT_TOKEN.address)) return "receipt_token_mismatch";
  if (read.reserve?.decimals !== profile.usdc.decimals) return "decimals_mismatch";
  if (lower(read.piggy?.address) !== lower(piggyAddress)) return "piggy_mismatch";
  return null;
}

export const LANE_RULES = Object.freeze([
  Object.freeze({ id: "reserve_accepts_supply", field: "reserveAcceptsSupply", comparator: "is", expected: true, agreed: true, requiresBlock: true }),
  Object.freeze({ id: "amount_within_cap", field: "amountRaw", comparator: "lte", agreed: true, requiresBlock: false }),
  Object.freeze({ id: "piggy_has_amount", field: "piggyUsdcRaw", comparator: "gte", agreed: true, requiresBlock: true }),
  Object.freeze({ id: "no_errand_out", field: "noPositionOut", comparator: "is", expected: true, agreed: true, requiresBlock: true }),
]);

// Without an exact amount or cap there is nothing to compare: those rules are not agreed and
// decide `unknown` (rule_not_agreed), never a comparison against a placeholder.
function laneRules(amount, cap) {
  return LANE_RULES.map((rule) => {
    if (rule.id === "piggy_has_amount") return amount === null ? { ...rule, expected: "UNKNOWN", agreed: false } : { ...rule, expected: amount };
    if (rule.id === "amount_within_cap") return cap === null ? { ...rule, expected: "UNKNOWN", agreed: false } : { ...rule, expected: cap };
    return { ...rule };
  });
}

// A conflicting read keeps its values but carries `conflict`, so decideRule answers
// `source_conflict` (unknown) instead of comparing them.
function laneValues(read, conflict, amount) {
  const base = read ? { block: read.block, source: read.source } : { block: null, source: "no_read" };
  const flag = conflict ? { conflict: true } : {};
  return {
    reserve_accepts_supply: { ...base, ...flag, found: read ? (read.reserve.active && !read.reserve.frozen && !read.reserve.paused) : null },
    no_errand_out: { ...base, ...flag, found: read ? BigInt(read.piggy.aTokenRaw) === 0n : null },
    piggy_has_amount: { ...base, ...flag, found: read ? BigInt(read.piggy.usdcRaw) : null },
    amount_within_cap: { block: null, source: "user_amount", found: amount },
  };
}

function ruleWhy(decision, readBlock) {
  const ev = decision.evidence || {};
  if (decision.reason === "hard_rule_breach") {
    const where = ev.block !== null && ev.block !== undefined ? `at block ${ev.block}` : `(entered amount; read at block ${readBlock})`;
    return `${ev.field}: expected ${ev.comparator} ${ev.expected}; found ${ev.found} ${where}`;
  }
  if (decision.reason === "source_conflict") return `${ev.field}: the read no longer matches the proven Job — not guessed`;
  if (decision.reason === "missing_value" || decision.reason === "missing_block") return `${ev.field}: no read for this decision — not guessed`;
  return `${ev.field}: ${decision.reason}`;
}

function fold(decisions) {
  for (const result of [RESULT.UNKNOWN, RESULT.NAH, RESULT.ASK]) {
    const first = decisions.find((d) => d.result === result);
    if (first) return { result, deciding: first };
  }
  return { result: RESULT.DO_IT, deciding: null };
}

const DECISION_WORD = Object.freeze({ [RESULT.NAH]: "nah", [RESULT.ASK]: "ask", [RESULT.UNKNOWN]: "unknown", [RESULT.DO_IT]: "match" });

/**
 * One decision for one event. Rules come from the live read; the return meaning comes from the
 * JIT answer through the Job's own exit evidence. Precedence: unknown > nah > ask > match.
 * A match is still not execution: action = ask (exact permission required).
 */
export function decideLane({
  profile, piggy = {}, amountRaw, returnAnswer, read = null, readStatus = "not_read",
  capRaw = LANE_AMOUNT_CAP_RAW, eventId, selectionSource, nowMs, nowIso,
} = {}) {
  if (!isLaneProfile(profile)) {
    return { decision: "unknown", result: RESULT.UNKNOWN, action: ACTION.NONE, reason: "profile_not_mainnet_lane", executionPermission: false, decisions: [], receipt: null };
  }
  const { binding, error: bindingError } = bindRecordToProfile(profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (bindingError) {
    return { decision: "unknown", result: RESULT.UNKNOWN, action: ACTION.NONE, reason: bindingError, executionPermission: false, decisions: [], receipt: null };
  }
  const amount = isDigits(amountRaw) && BigInt(amountRaw) > 0n ? BigInt(amountRaw) : null;
  const cap = isDigits(capRaw) ? BigInt(capRaw) : null;
  const conflict = readConflict(profile, piggy.address, read);
  const ruleOut = decideRules(laneRules(amount, cap), laneValues(read, conflict, amount));

  const observation = read ? {
    source: read.source,
    observedAt: read.observedAt,
    block: read.block,
    chainId: read.chainId,
    codePresent: read.codePresent,
    // Supply and withdraw both stop while a reserve is paused or inactive: the recorded
    // immediate exit does not hold then, which the evidence reader treats as a conflict.
    exitMode: read.reserve?.active && !read.reserve?.paused ? "immediate" : "unavailable",
    ...(conflict ? { conflict: true } : {}),
  } : null;
  const returnEvidence = readDestinationReturnEvidence(LANE_JOB_ID, { observation, nowMs, requireObservation: true });
  const answer = typeof returnAnswer === "string" && returnAnswer ? returnAnswer : null;
  const semantic = decideSemanticReturnRule({ id: "return_semantic", field: "returnSemantic", expected: answer ?? "UNKNOWN", agreed: !!answer }, returnEvidence);

  const all = [...ruleOut.decisions, semantic];
  const { result, deciding } = fold(all);
  const out = {
    eventId: typeof eventId === "string" && eventId ? eventId.slice(0, 120) : "UNKNOWN_EVENT",
    decision: DECISION_WORD[result],
    result,
    action: result === RESULT.DO_IT ? ACTION.ASK : ACTION.NONE,
    reason: deciding ? deciding.reason : "all_rules_and_return_match",
    executionPermission: false,
    decisions: all,
    binding,
    readStatus,
    returnEvidenceMode: returnEvidence?.evidenceMode || "missing",
    receipt: null,
    receiptError: null,
  };
  if (result === RESULT.DO_IT) return out;

  const isSemantic = deciding === semantic;
  const ev = deciding.evidence || {};
  const receipt = {
    schema: DECISION_RECEIPT_SCHEMA,
    eventId: `lane:${out.eventId}:${LANE_DESTINATION_ID}`,
    accountId: piggy.address,
    chainId: profile.scope,
    destinationId: LANE_DESTINATION_ID,
    jobId: LANE_JOB_ID,
    decision: DECISION_WORD[result],
    reason: deciding.reason,
    category: isSemantic ? "return_semantic" : `rule_${DECISION_WORD[result]}`,
    expected: String(ev.expected ?? "UNKNOWN"),
    found: String(ev.found ?? "UNKNOWN"),
    did: "nothing",
    why: isSemantic ? String(ev.why || deciding.reason) : ruleWhy(deciding, read ? read.block : null),
    delay: null,
    action: ACTION.NONE,
    actionCount: 0,
    txExecuted: false,
    evidence: {
      source: read && !conflict ? read.source : null,
      observedAt: read && !conflict ? read.observedAt : null,
      block: read && !conflict ? read.block : null,
      evidenceMode: returnEvidence?.evidenceMode || "missing",
      readStatus: typeof readStatus === "string" && readStatus ? readStatus : "UNKNOWN",
      conflict: conflict || null,
      binding: { ...binding },
      reads: read && !conflict ? {
        reserveActive: read.reserve.active,
        reserveFrozen: read.reserve.frozen,
        reservePaused: read.reserve.paused,
        piggyUsdcRaw: read.piggy.usdcRaw,
        piggyReceiptTokenRaw: read.piggy.aTokenRaw,
        piggyAllowanceRaw: read.piggy.allowanceRaw,
      } : null,
      forkEvidence: { label: LANE_FORK_EVIDENCE.label, block: LANE_FORK_EVIDENCE.block },
    },
    executionContext: { runtimeChain: profile.scope, jobChain: profile.scope, executable: false, role: "same_chain_live_execution_disabled" },
    selection: {
      source: typeof selectionSource === "string" && selectionSource ? selectionSource.slice(0, 64) : "UNKNOWN_SELECTION_SOURCE",
      errandIds: [...LANE_ERRAND_IDS],
      jitQuestionId: LANE_JIT_QUESTION_ID,
      jitAnswer: answer,
      semanticScope: "this_selection_event_only",
      ownerFinancialChoice: false,
      createsPermission: false,
    },
    recordedAt: typeof nowIso === "string" && nowIso ? nowIso : "UNKNOWN_TIME",
  };
  const verdict = validateDecisionReceipt(receipt, { accountId: piggy.address, chainId: profile.scope });
  out.receipt = verdict.error ? null : verdict.receipt;
  out.receiptError = verdict.error || null;
  return out;
}

function formatUnits(raw, decimals) {
  const s = raw.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`;
}

/**
 * The exact permission the Piggy's owner is asked for, after a match only. Approval is exactly
 * the amount (never unlimited), the supply is on behalf of this Piggy, and the exit returns to
 * this Piggy. One envelope covers one errand and is consumed when the errand starts.
 */
export function buildLanePermissionPreview({ profile, piggy = {}, amountRaw, decision, capRaw = LANE_AMOUNT_CAP_RAW } = {}) {
  if (!isLaneProfile(profile)) return { preview: null, error: "profile_not_mainnet_lane" };
  if (!decision || decision.result !== RESULT.DO_IT) return { preview: null, error: "no_match_decision" };
  const { binding, error } = bindRecordToProfile(profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (error) return { preview: null, error };
  if (lower(decision.binding?.piggyAddress) !== lower(piggy.address) || decision.binding?.piggyId !== piggy.id || decision.binding?.chainId !== profile.numericChainId) {
    return { preview: null, error: "decision_binding_mismatch" };
  }
  if (!isDigits(amountRaw) || BigInt(amountRaw) <= 0n) return { preview: null, error: "amount_not_exact" };
  if (!isDigits(capRaw) || BigInt(amountRaw) > BigInt(capRaw)) return { preview: null, error: "amount_over_cap" };
  const plan = lanePlan(profile, piggy.address);
  if (!plan) return { preview: null, error: "no_plan" };
  const pool = plan.destination;
  const amount = BigInt(amountRaw);
  const usdc = profile.usdc;
  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [pool, amount] });
  const supplyData = encodeFunctionData({ abi: POOL_ABI, functionName: "supply", args: [usdc.address, amount, piggy.address, 0] });
  const withdrawData = encodeFunctionData({ abi: POOL_ABI, functionName: "withdraw", args: [usdc.address, maxUint256, piggy.address] });
  const intent = {
    piggyId: piggy.id,
    signerAddress: piggy.address,
    action: LANE_ACTION,
    asset: usdc.symbol,
    amount: amountRaw,
    chain: profile.scope,
    destination: pool,
    destinationRequired: true,
  };
  const nonce = permissionNonce({ ...intent, at: decision.eventId || "UNKNOWN_EVENT" });
  return {
    preview: Object.freeze({
      ...binding,
      jobId: LANE_JOB_ID,
      action: LANE_ACTION,
      amountRaw,
      amountDisplay: `${formatUnits(amount, usdc.decimals)} ${usdc.symbol}`,
      target: pool,
      spender: pool,
      receiptToken: { ...LANE_RECEIPT_TOKEN },
      steps: Object.freeze([
        Object.freeze({ step: "approve", to: usdc.address, selector: LANE_SELECTORS.approve, spender: pool, amountRaw, data: approveData }),
        Object.freeze({ step: "supply", to: pool, selector: LANE_SELECTORS.supply, asset: usdc.address, amountRaw, onBehalfOf: piggy.address, referralCode: 0, data: supplyData }),
        Object.freeze({ step: "withdraw", to: pool, selector: LANE_SELECTORS.withdraw, asset: usdc.address, amount: "max", recipient: piggy.address, data: withdrawData }),
      ]),
      unlimitedApproval: false,
      allowanceAfterEntryExpectedRaw: "0",
      reusable: false,
      liveExecution: profile.liveExecution === true,
      exit: "immediate",
      intent: Object.freeze(intent),
      request: Object.freeze({ piggyId: piggy.id, signerAddress: piggy.address, action: LANE_ACTION, asset: usdc.symbol, amount: amountRaw, chain: profile.scope, destination: pool }),
      nonce,
    }),
    error: null,
  };
}

// ── lifecycle ───────────────────────────────────────────────────────────────────────────────
export const LANE_STAGE = Object.freeze({
  AUTHORIZED: "authorized",
  APPROVE_SENDING: "approve_sending",
  APPROVE_SENT: "approve_sent",
  APPROVED: "approved",
  SUPPLY_SENDING: "supply_sending",
  SUPPLY_SENT: "supply_sent",
  OUT: "out",
  WITHDRAW_SENDING: "withdraw_sending",
  WITHDRAW_SENT: "withdraw_sent",
  RETURNED: "returned",
  REVERTED: "reverted",
  UNKNOWN: "unknown",
});

const TERMINAL = new Set([LANE_STAGE.RETURNED, LANE_STAGE.REVERTED]);
const STEP_AFTER = Object.freeze({
  [LANE_STAGE.AUTHORIZED]: { step: "approve", sending: LANE_STAGE.APPROVE_SENDING, sent: LANE_STAGE.APPROVE_SENT, ok: LANE_STAGE.APPROVED },
  [LANE_STAGE.APPROVED]: { step: "supply", sending: LANE_STAGE.SUPPLY_SENDING, sent: LANE_STAGE.SUPPLY_SENT, ok: LANE_STAGE.OUT },
  [LANE_STAGE.OUT]: { step: "withdraw", sending: LANE_STAGE.WITHDRAW_SENDING, sent: LANE_STAGE.WITHDRAW_SENT, ok: LANE_STAGE.RETURNED },
});
const SENT_STAGES = Object.freeze({
  [LANE_STAGE.APPROVE_SENT]: STEP_AFTER[LANE_STAGE.AUTHORIZED],
  [LANE_STAGE.SUPPLY_SENT]: STEP_AFTER[LANE_STAGE.APPROVED],
  [LANE_STAGE.WITHDRAW_SENT]: STEP_AFTER[LANE_STAGE.OUT],
});
const SENDING_STAGES = new Set([LANE_STAGE.APPROVE_SENDING, LANE_STAGE.SUPPLY_SENDING, LANE_STAGE.WITHDRAW_SENDING]);
const INTENT_SCHEMA = "araso_mainnet_lane_intent_v1";

export function laneIntentKey(profile, piggyId) {
  if (!isLaneProfile(profile) || typeof piggyId !== "string" || !piggyId.trim()) return null;
  return `araso.mainnetLane.v1.${profile.scope}.${piggyId.trim()}`;
}

function saveIntent(storage, profile, intent) {
  const key = laneIntentKey(profile, intent.piggyId);
  if (!storage || !key) return false;
  try { storage.setItem(key, JSON.stringify(intent)); return true; } catch { return false; }
}

// [money-safety M1] setItem + read-back: true only when the stored bytes are exactly what was written. Used for the writes the
// money path depends on (the "about to send" record and the post-send hash), where "setItem did not throw" is not enough.
function saveIntentVerified(storage, profile, intent) {
  const key = laneIntentKey(profile, intent.piggyId);
  if (!storage || !key || typeof storage.getItem !== "function") return false;
  try {
    const serialized = JSON.stringify(intent);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch { return false; }
}

/** Loads and re-validates the stored errand for this Piggy. Anything that does not bind is refused. */
export function loadLaneIntent(storage, profile, piggy = {}) {
  const key = laneIntentKey(profile, piggy.id);
  if (!storage || !key) return { intent: null, error: "no_scope" };
  let raw = null;
  try { raw = storage.getItem(key); } catch { return { intent: null, error: "storage_read_failed" }; }
  if (!raw) return { intent: null, error: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { intent: null, error: "corrupt" }; }
  if (!parsed || parsed.schema !== INTENT_SCHEMA) return { intent: null, error: "wrong_schema" };
  const bound = checkRecordBinding(parsed, profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (!bound.ok) return { intent: null, error: bound.reason };
  if (!Object.values(LANE_STAGE).includes(parsed.stage)) return { intent: null, error: "unknown_stage" };
  return { intent: parsed, error: null };
}

function stamp(intent, stage, nowIso, extra = {}) {
  return { ...intent, ...extra, stage, updatedAt: nowIso, history: [...(intent.history || []), { stage, at: nowIso }].slice(-24) };
}

/**
 * Starts the one errand for this Piggy. Requires an envelope issued by the passkey path
 * (permission-envelope.js issuePermission) that matches this preview exactly, and the live
 * selection context (selected Piggy == active signer). The envelope is consumed here.
 */
export function startLaneIntent({ profile, piggy = {}, preview, envelope, signerContext, consumedNonces, before, storage, nowMs, nowIso } = {}) {
  if (!isLaneProfile(profile)) return { intent: null, error: "profile_not_mainnet_lane" };
  if (!preview) return { intent: null, error: "no_preview" };
  const { binding, error } = bindRecordToProfile(profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (error) return { intent: null, error };
  if (preview.chainId !== binding.chainId || preview.chain !== binding.chain || lower(preview.token) !== lower(binding.token)
    || preview.piggyId !== binding.piggyId || lower(preview.piggyAddress) !== lower(binding.piggyAddress)) {
    return { intent: null, error: "preview_binding_mismatch" };
  }
  const existing = loadLaneIntent(storage, profile, piggy);
  // [money-safety M1 D7] A stored errand that cannot be read or re-validated is NOT "no errand": refuse before authorize/consume,
  // so the envelope nonce is not spent and no second errand is stacked over an unknown one.
  if (existing.error) return { intent: null, error: "existing_intent_unreadable", detail: existing.error };
  if (existing.intent && !TERMINAL.has(existing.intent.stage)) return { intent: null, error: "errand_in_flight" };
  const auth = authorize(envelope, preview.request, { nowMs, consumedNonces, context: signerContext });
  if (!auth.ok) return { intent: null, error: auth.reason };
  if (!before || !isDigits(before.usdcRaw) || !isDigits(before.aTokenRaw) || before.block === undefined) return { intent: null, error: "missing_before_read" };
  consume(envelope, consumedNonces);
  const intent = stamp({
    schema: INTENT_SCHEMA,
    intentId: `lane:${binding.piggyId}:${nowIso}`,
    ...binding,
    jobId: LANE_JOB_ID,
    action: LANE_ACTION,
    pool: preview.target,
    receiptToken: LANE_RECEIPT_TOKEN.address,
    amountRaw: preview.amountRaw,
    nonce: auth.nonce,
    before: { usdcRaw: before.usdcRaw, aTokenRaw: before.aTokenRaw, block: before.block },
    steps: { approve: null, supply: null, withdraw: null },
    executionMode: null,
    evidenceClass: null,
    createdAt: nowIso,
    history: [],
  }, LANE_STAGE.AUTHORIZED, nowIso);
  if (!saveIntent(storage, profile, intent)) return { intent: null, error: "storage_write_failed" };
  return { intent, error: null };
}

// Live execution has no path here: only a local fork executor on the same chain id is accepted.
function executorAllowed(profile, executor) {
  if (!executor || typeof executor.send !== "function" || typeof executor.receipt !== "function") return "no_executor";
  if (executor.kind !== "local_fork") return "live_execution_disabled";
  if (executor.chainId !== profile.numericChainId || !Number.isInteger(executor.forkBlock)) return "executor_chain_mismatch";
  return null;
}

function stepTx(intent, step, preview) {
  const s = preview.steps.find((row) => row.step === step);
  return s ? { to: s.to, data: s.data, from: intent.piggyAddress } : null;
}

/**
 * Advances ONE step. Stage "*_sending" is persisted before the send, so a crash or reload
 * mid-send can never re-send: it resolves to unknown and waits for a reconcile.
 */
export async function advanceLaneIntent({ profile, piggy = {}, intent, preview, executor, storage, nowIso } = {}) {
  if (!isLaneProfile(profile)) return { intent, status: "blocked", reason: "profile_not_mainnet_lane" };
  const bound = checkRecordBinding(intent, profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (!bound.ok) return { intent, status: "blocked", reason: bound.reason };
  const refused = executorAllowed(profile, executor);
  if (refused) return { intent, status: "blocked", reason: refused };
  if (TERMINAL.has(intent.stage)) return { intent, status: "terminal", reason: intent.stage };
  if (SENDING_STAGES.has(intent.stage) || SENT_STAGES[intent.stage] || intent.stage === LANE_STAGE.UNKNOWN) {
    return { intent, status: "reconcile_first", reason: onUnknownOutcome({ nonce: intent.nonce }).reason, retry: false };
  }
  const next = STEP_AFTER[intent.stage];
  if (!next) return { intent, status: "blocked", reason: "no_next_step" };
  if (!preview || preview.nonce !== intent.nonce) return { intent, status: "blocked", reason: "preview_mismatch" };
  const tx = stepTx(intent, next.step, preview);
  if (!tx) return { intent, status: "blocked", reason: "no_step_tx" };

  const mode = executor.kind === "local_fork" ? EXECUTION_MODE.FORK_SIMULATION : EXECUTION_MODE.LIVE;
  const label = executor.kind === "local_fork" ? EVIDENCE_LABEL.FORK_SIM : EVIDENCE_LABEL.MAINNET_TX;
  const current = stamp(intent, next.sending, nowIso, { executionMode: mode, evidenceClass: label });
  let withHash = current;
  // [money-safety M1] The send goes through the one chokepoint (money-executor.js): authorize -> reserve -> persist-nonce -> send ->
  // persist-hash. The local-fork executor cannot expose a hash before send, so the hash is persisted right after it.
  const step = await executeMoneyStep({
    tx,
    transport: { kind: TRANSPORT_KIND.LANE_EXECUTOR, executor },
    // The stored errand must still be the one this call was handed (same stage + nonce): a stale in-memory intent
    // (reload, other tab, double tap) never reaches a signer. An unreadable/absent record also stops here.
    authorize: () => {
      const stored = loadLaneIntent(storage, profile, piggy);
      if (stored.error || !stored.intent) return { ok: false, reason: "stored_intent_unavailable" };
      if (stored.intent.stage !== intent.stage || stored.intent.nonce !== intent.nonce) return { ok: false, reason: "stored_intent_changed" };
      return { ok: true };
    },
    // Compare-and-write in ONE synchronous tick (no await between the re-load and the write): if another advance reserved
    // first, the stored stage/nonce no longer match and this one is refused before it can reach a signer.
    reserve: () => {
      const stored = loadLaneIntent(storage, profile, piggy);
      if (stored.error || !stored.intent) return { ok: false, reason: "stored_intent_unavailable" };
      if (stored.intent.stage !== intent.stage || stored.intent.nonce !== intent.nonce) return { ok: false, reason: "stored_intent_changed" };
      return saveIntentVerified(storage, profile, current) ? { ok: true } : { ok: false, reason: "storage_write_failed" };
    },
    // The consumed permission nonce lives in the persisted errand; confirm the record we just wrote carries it.
    persistNonce: () => {
      const stored = loadLaneIntent(storage, profile, piggy);
      return stored.intent && stored.intent.nonce === preview.nonce && stored.intent.stage === next.sending
        ? { ok: true } : { ok: false, reason: "nonce_not_persisted" };
    },
    // Write only while the stored record is still THIS call's sending record; never overwrite another advance's hash.
    persistHash: ({ hash }) => {
      const stored = loadLaneIntent(storage, profile, piggy);
      if (stored.error || !stored.intent) return { ok: false, reason: "stored_intent_unavailable" };
      if (stored.intent.nonce !== intent.nonce) return { ok: false, reason: "stored_intent_changed" };
      const have = stored.intent.steps?.[next.step]?.hash;
      if (stored.intent.stage === next.sent && have === hash) return { ok: true }; // idempotent retry of our own write
      if (stored.intent.stage !== next.sending || have) return { ok: false, reason: "stored_intent_changed" };
      withHash = stamp(current, next.sent, nowIso, { steps: { ...current.steps, [next.step]: { hash, status: "pending" } } });
      return saveIntentVerified(storage, profile, withHash) ? { ok: true } : { ok: false, reason: "storage_write_failed" };
    },
  });
  if (step.status === "blocked") return { intent, status: "blocked", reason: step.reason };
  if (step.status === "send_outcome_unknown") return { intent: current, status: "unknown", reason: "send_outcome_unknown", retry: false };
  if (step.status === "unknown_hash_unsaved") {
    // Sent, hash known only in memory: keep it on the returned intent so the caller can retry the write; never re-send.
    const inMemory = stamp(current, next.sent, nowIso, { steps: { ...current.steps, [next.step]: { hash: step.hash, status: "pending" } } });
    return { intent: inMemory, status: "unknown", reason: "unknown_hash_unsaved", hash: step.hash, saved: false, retry: false };
  }
  return settleSent({ profile, intent: withHash, executor, storage, nowIso });
}

async function settleSent({ profile, intent, executor, storage, nowIso }) {
  const meta = SENT_STAGES[intent.stage] || null;
  const step = meta?.step;
  const hash = step ? intent.steps?.[step]?.hash : null;
  if (!meta || !TX.test(hash || "")) return { intent, status: "unknown", reason: "no_hash_to_reconcile", retry: false };
  let r;
  try { r = await executor.receipt(hash); } catch { r = null; }
  if (!r || (r.status !== "success" && r.status !== "reverted")) {
    // Not found yet is pending, not failure. Nothing is re-sent.
    return { intent, status: "pending", reason: "receipt_not_found", retry: false };
  }
  const stepRow = { hash, status: r.status, gasUsed: Number.isInteger(r.gasUsed) ? r.gasUsed : null, blockNumber: Number.isInteger(r.blockNumber) ? r.blockNumber : null };
  if (r.status === "reverted") {
    const next = stamp(intent, LANE_STAGE.REVERTED, nowIso, {
      steps: { ...intent.steps, [step]: { ...stepRow, revertData: typeof r.revertData === "string" && /^0x[0-9a-fA-F]{0,8}$/.test(r.revertData) ? r.revertData : null } },
      failedStep: step,
    });
    // [money-safety M1 R6] A failed save is reported, never swallowed: the stored stage is still `*_sent` (hash kept) and the
    // next reconcile re-reads the receipt.
    if (!saveIntent(storage, profile, next)) return { intent: next, status: "unsaved", reason: "storage_write_failed", saved: false, retry: false };
    return { intent: next, status: "reverted", reason: `${step}_reverted` };
  }
  const next = stamp(intent, meta.ok, nowIso, { steps: { ...intent.steps, [step]: stepRow } });
  if (!saveIntent(storage, profile, next)) return { intent: next, status: "unsaved", reason: "storage_write_failed", saved: false, retry: false };
  return { intent: next, status: meta.ok === LANE_STAGE.RETURNED ? "returned" : "confirmed", reason: `${step}_confirmed` };
}

/**
 * After a reload: settles what can be known by reading, never by re-sending.
 * "*_sending" (no hash was recorded) becomes unknown; "*_sent" reads its receipt.
 */
export async function reconcileLaneIntent({ profile, piggy = {}, intent, executor, storage, nowIso } = {}) {
  if (!isLaneProfile(profile)) return { intent, status: "blocked", reason: "profile_not_mainnet_lane" };
  const bound = checkRecordBinding(intent, profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (!bound.ok) return { intent, status: "blocked", reason: bound.reason };
  if (TERMINAL.has(intent.stage)) return { intent, status: "terminal", reason: intent.stage };
  if (SENDING_STAGES.has(intent.stage)) {
    // No hash was recorded: whether anything was broadcast cannot be known from here.
    const next = stamp(intent, LANE_STAGE.UNKNOWN, nowIso, { unknownReason: "broadcast_unknown", unknownStep: intent.stage.replace(/_sending$/, "") });
    // [money-safety M1 R6] If this write fails the stored stage stays `*_sending`, which resolves to the same unknown next time.
    const saved = saveIntent(storage, profile, next);
    return { intent: next, status: "unknown", reason: "broadcast_unknown", retry: false, ...(saved ? {} : { saved: false }) };
  }
  if (!SENT_STAGES[intent.stage]) {
    return { intent, status: intent.stage === LANE_STAGE.UNKNOWN ? "unknown" : "idle", reason: intent.unknownReason || null, retry: false };
  }
  if (!executor || typeof executor.receipt !== "function") return { intent, status: "pending", reason: "no_reader", retry: false };
  return settleSent({ profile, intent, executor, storage, nowIso });
}

/**
 * Receipt of a finished errand, from measured balances only. Pending and unknown errands have
 * no Receipt. `after` is a fresh read after the exit.
 */
export function buildLaneReceipt({ profile, piggy = {}, intent, after, nowIso } = {}) {
  if (!isLaneProfile(profile)) return { receipt: null, reason: "profile_not_mainnet_lane" };
  const bound = checkRecordBinding(intent, profile, { piggyId: piggy.id, piggyAddress: piggy.address });
  if (!bound.ok) return { receipt: null, reason: bound.reason };
  if (!TERMINAL.has(intent.stage)) return { receipt: null, reason: "not_terminal" };
  if (!after || !isDigits(after.usdcRaw) || !isDigits(after.aTokenRaw) || !isDigits(after.allowanceRaw) || !Number.isInteger(after.block)) {
    return { receipt: null, reason: "missing_after_read" };
  }
  if (!Number.isInteger(intent.before?.block) || after.block < intent.before.block) return { receipt: null, reason: "after_read_older_than_before" };
  const done = intent.stage === LANE_STAGE.RETURNED;
  const gas = Object.fromEntries(["approve", "supply", "withdraw"].map((s) => [s, intent.steps?.[s]?.gasUsed ?? null]));
  const deltaRaw = (BigInt(after.usdcRaw) - BigInt(intent.before.usdcRaw)).toString();
  return {
    receipt: Object.freeze({
      schema: "araso_mainnet_lane_receipt_v1",
      eventId: intent.intentId,
      outcome: done ? "done" : "failed",
      evidenceClass: intent.evidenceClass,
      executionMode: intent.executionMode,
      chainId: intent.chainId,
      chain: intent.chain,
      asset: intent.asset,
      token: intent.token,
      decimals: intent.decimals,
      piggyId: intent.piggyId,
      piggyAddress: intent.piggyAddress,
      jobId: intent.jobId,
      action: intent.action,
      pool: intent.pool,
      receiptToken: intent.receiptToken,
      amountRaw: intent.amountRaw,
      approveTx: intent.steps?.approve?.hash ?? null,
      supplyTx: intent.steps?.supply?.hash ?? null,
      withdrawTx: intent.steps?.withdraw?.hash ?? null,
      gasUsed: gas,
      usdcBeforeRaw: intent.before.usdcRaw,
      usdcAfterRaw: after.usdcRaw,
      receiptTokenBeforeRaw: intent.before.aTokenRaw,
      receiptTokenAfterRaw: after.aTokenRaw,
      allowanceAfterRaw: after.allowanceRaw,
      deltaRaw,
      beforeBlock: intent.before.block,
      afterBlock: after.block,
      failedStep: done ? null : intent.failedStep || null,
      revertData: done ? null : intent.steps?.[intent.failedStep]?.revertData ?? null,
      unmeasured: [...LANE_FORK_EVIDENCE.unmeasured],
      recordedAt: typeof nowIso === "string" ? nowIso : "UNKNOWN_TIME",
    }),
    reason: null,
  };
}

/** The same Receipt as a Second Journey receipt candidate (second-journey-receipt-bridge.js). */
export function laneReceiptCandidate(receipt) {
  if (!receipt) return null;
  const lastTx = receipt.withdrawTx || receipt.supplyTx || receipt.approveTx || null;
  return {
    eventId: receipt.eventId,
    outcome: receipt.outcome,
    evidenceClass: receipt.evidenceClass,
    executionMode: receipt.executionMode,
    accountId: receipt.piggyAddress,
    chainId: receipt.chain,
    piggyId: receipt.piggyId,
    destinationId: LANE_DESTINATION_ID,
    jobFamily: JOB_FAMILY.GROW_STABLE,
    ...(lastTx ? { txHash: lastTx } : {}),
    ...(receipt.executionMode === EXECUTION_MODE.FORK_SIMULATION ? { forkBlock: LANE_FORK_EVIDENCE.block } : {}),
    txExecuted: true,
    measuredDelta: `${receipt.asset} ${receipt.deltaRaw} raw (decimals ${receipt.decimals})`,
    ...(receipt.outcome === "failed" ? { failureReason: `${receipt.failedStep || "unknown"}_reverted` } : {}),
    evidencePointer: { ...receipt, gasUsed: { ...receipt.gasUsed }, unmeasured: [...receipt.unmeasured] },
  };
}
