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
import { ACTION, RESULT, decideRule, decideRules, decideSemanticReturnRule } from "./rule-decision.js";
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
import { bindRecordToProfile, checkRecordBinding } from "./chain-profile.js";
import { executeMoneyStep, TRANSPORT_KIND } from "./money-executor.js";
// Protocol-neutral helpers (move-only) and the Aave Job's own facts (move-only). Every public Aave
// name stays exported from this module, so existing imports of mainnet-job-lane.js keep working.
import {
  ADDR, DECISION_WORD, TX, executorRefusal, foldDecisions, formatUnits, isDigits, lower, saveRecord, saveRecordVerified, stampRecord,
} from "./mainnet-job-common.js";
import {
  ERC20_ABI, LANE_ACTION, LANE_AMOUNT_CAP_RAW, LANE_DESTINATION_ID, LANE_ERRAND_IDS, LANE_FORK_EVIDENCE, LANE_JIT_QUESTION_ID,
  LANE_JOB_ID, LANE_RECEIPT_TOKEN, LANE_SELECTORS, POOL_ABI, decodeReserveConfiguration, isAaveLaneProfile,
} from "./mainnet-job-aave.js";

export {
  LANE_ACTION, LANE_AMOUNT_CAP_RAW, LANE_DESTINATION_ID, LANE_FORK_EVIDENCE, LANE_JOB_ID, LANE_RECEIPT_TOKEN, LANE_SELECTORS,
  decodeReserveConfiguration,
};

// Product config for this lane: no reader, no writer. Both stay off until a separate Owner step.
export const MAINNET_LANE_CONFIG = Object.freeze({ reader: null, liveExecution: false });

const isLaneProfile = isAaveLaneProfile;

function lanePlan(profile, piggyAddress) {
  const out = buildExecutionPlan(LANE_JOB_ID, { context: { address: piggyAddress, chain: profile.scope }, executionMode: EXECUTION_MODE.LIVE });
  return out.plan && ADDR.test(out.plan.destination || "") ? out.plan : null;
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

const fold = foldDecisions;

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
  return saveRecord(storage, laneIntentKey(profile, intent.piggyId), intent);
}

// [money-safety M1] setItem + read-back (mainnet-job-common.js saveRecordVerified). Used for the writes the money path depends
// on (the "about to send" record and the post-send hash), where "setItem did not throw" is not enough.
function saveIntentVerified(storage, profile, intent) {
  return saveRecordVerified(storage, laneIntentKey(profile, intent.piggyId), intent);
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

const stamp = stampRecord;

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
const executorAllowed = executorRefusal;

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

// ── [E1] current-reader output → candidate decision (action 0 unless an exact permission follows) ──
// Input: ONE row of second-current-reader.js readSecondCurrent().candidates, plus the rule the user agreed for
// THIS event (if any). Output: a decision and, for nah / ask / unknown, an action-0 decision Receipt in the
// existing grammar (second_journey_decision_receipt_v1: expected · found · block N, executable:false).
//
// Four things that are NOT the same and are never converted into each other here:
//   · Preference   (learned taste; second-journey-state preference)  → never a rule
//   · Permission   (an issued envelope, permission-envelope.js)      → never a rule, never produced here
//   · Agreed Rule  (what the user said for this one event)            → the only thing a reading is compared to
//   · READY        (runtime readiness for execution)                  → never produced here; no field carries it
// A reading alone decides nothing: without an agreed rule the answer is `unknown`. A match is `action: "ask"`
// (the exact permission is still required, through buildLanePermissionPreview → permission-envelope.js →
// money-executor.js); nothing in this function can execute.
// Evidence that is missing, stale (by an evidence-side signal only — no clock constant, no freshness window:
// the freshness definition is an open Owner question, E8), or conflicting decides `unknown`, never `nah`.
// The candidate universe is whatever the reader reports: every row gets a decision (no top-3 cut here).

const CURRENT_READ_JOB_CHAIN = Object.freeze({ chain: "monad-mainnet", chainId: LANE_FORK_EVIDENCE.chainId });
const asRaw = (v) => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);
const asBool = (v) => (typeof v === "boolean" ? v : null);
const asInt = (v) => (Number.isInteger(v) ? v : null);

// Rule fields a reading can be compared on, per candidate. Values come only from what the reader read.
const CURRENT_FIELDS = Object.freeze({
  "aave-usdc": Object.freeze({
    piggyUsdcRaw: (r) => asRaw(r.holdings?.usdcRaw),
    receiptTokenRaw: (r) => asRaw(r.holdings?.receiptRaw),
    allowanceToPoolRaw: (r) => asRaw(r.holdings?.allowanceToPoolRaw),
    reserveAcceptsSupply: (r) => (r.reserve && typeof r.reserve.active === "boolean" ? r.reserve.active && !r.reserve.frozen && !r.reserve.paused : null),
  }),
  "neverland-usdc": Object.freeze({
    piggyUsdcRaw: (r) => asRaw(r.holdings?.usdcRaw),
    receiptTokenRaw: (r) => asRaw(r.holdings?.receiptRaw),
    allowanceToPoolRaw: (r) => asRaw(r.holdings?.allowanceToPoolRaw),
  }),
  "curvance-usdc": Object.freeze({
    sharesRaw: (r) => asRaw(r.holdings?.sharesRaw),
    assetsRaw: (r) => asRaw(r.holdings?.assetsRaw),
  }),
  "protect-revoke-allowance": Object.freeze({
    allowanceRaw: (r) => asRaw(r.allowanceRaw),
  }),
  "kintsu-smon": Object.freeze({
    exitFeeBips: (r) => asInt(r.exitFeeBips),
    codePresent: (r) => asBool(r.codePresent),
  }),
});
const SEMANTIC_FIELD = "returnSemantic";
const SEMANTIC_CANDIDATES = Object.freeze(["kintsu-smon"]);
// Reader statuses that mean "values were read" (second-current-reader.js CURRENT_READER_STATUS; literal strings
// here to keep this module free of a load-time import cycle with the reader).
const READ_OK_STATUS = Object.freeze(["aave_buildable", "neverland_derived_assumed", "curvance_erc4626", "protect_caller_supplied", "kintsu_observation"]);
const COMPARATORS = Object.freeze(["lte", "lt", "gte", "gt", "eq", "is"]);

/**
 * Is `rule` an agreed rule for THIS event? A preference, a permission envelope, a READY flag or a code constant
 * (e.g. LANE_RULES `agreed:true`) is not. Returns { rule } (decide-ready) or { error }.
 */
export function acceptAgreedRule(input, { candidateId, eventId } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "rule_not_agreed" };
  if (input.kind === "preference" || "reasonDislike" in input || "explorationWidth" in input) return { error: "preference_is_not_agreed_rule" };
  if (input.kind === "permission" || "nonce" in input || "signature" in input || "envelope" in input) return { error: "permission_is_not_agreed_rule" };
  if (input.kind !== "agreed_rule" || input.agreedBy !== "user") return { error: "rule_not_agreed" };
  if (typeof eventId !== "string" || !eventId || input.eventId !== eventId) return { error: "rule_not_for_this_event" };
  if (input.candidateId !== candidateId) return { error: "rule_not_for_this_candidate" };
  const fields = CURRENT_FIELDS[candidateId] || {};
  if (input.field === SEMANTIC_FIELD) {
    if (!SEMANTIC_CANDIDATES.includes(candidateId) || typeof input.expected !== "string" || !input.expected) return { error: "rule_field_not_readable" };
    return { rule: { id: input.id || "return_semantic", field: SEMANTIC_FIELD, expected: input.expected, agreed: true }, semantic: true };
  }
  if (!Object.prototype.hasOwnProperty.call(fields, input.field)) return { error: "rule_field_not_readable" };
  if (!COMPARATORS.includes(input.comparator)) return { error: "rule_comparator_unknown" };
  let expected = input.expected;
  if (/Raw$/.test(input.field)) {
    expected = asRaw(typeof input.expected === "bigint" ? input.expected.toString() : input.expected);
    if (expected === null) return { error: "rule_expected_not_exact" };
  } else if (typeof expected !== "boolean" && !Number.isFinite(expected)) {
    return { error: "rule_expected_not_exact" };
  }
  return { rule: { id: input.id || input.field, field: input.field, comparator: input.comparator, expected, agreed: true, requiresBlock: true }, semantic: false };
}

// Evidence gate. A reading that cannot be compared is unknown with a named reason, never nah.
function currentEvidenceProblem(row, nowMs) {
  if (!row || typeof row !== "object") return "evidence_missing";
  if (!READ_OK_STATUS.includes(row.status) || !row.read || typeof row.read !== "object") return `evidence_unavailable:${row.status || "UNKNOWN"}`;
  const r = row.read;
  if (r.conflict === true || r.sourceConflict === true) return "source_conflict";
  if (r.chainId !== CURRENT_READ_JOB_CHAIN.chainId) return "source_conflict";
  if (r.codePresent === false) return "source_conflict";
  if (row.id === "aave-usdc" && r.receiptToken && r.receiptToken.matchesRecorded === false) return "source_conflict";
  if (r.stale === true) return "stale_evidence";
  // A reader-supplied expiry can only be honoured against a clock the caller supplies. Without one the reading's
  // freshness cannot be shown, so it is stale (unknown) — never compared into a nah.
  if (r.expiresAtMs !== undefined && r.expiresAtMs !== null) {
    if (typeof r.expiresAtMs !== "number" || !Number.isFinite(r.expiresAtMs)) return "stale_evidence";
    if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || r.expiresAtMs <= nowMs) return "stale_evidence";
  }
  if (typeof r.source !== "string" || !r.source || typeof r.observedAt !== "string" || !Number.isFinite(Date.parse(r.observedAt))) return "missing_evidence";
  if (!Number.isInteger(r.block) || r.block < 0) return "missing_block";
  return "";
}

const CURRENT_DECISION_WORD = Object.freeze({ [RESULT.NAH]: "nah", [RESULT.ASK]: "ask", [RESULT.UNKNOWN]: "unknown", [RESULT.DO_IT]: "match" });

/**
 * One candidate, one event. Never throws, never executes, never issues permission, never marks READY.
 * @returns {{kind, candidateId, eventId, decision, result, action, reason, executionPermission:false, decisions, receipt, receiptError}}
 */
export function decideCurrentCandidate({ row, agreedRule = null, scope = {}, eventId, selectionSource, nowMs, nowIso } = {}) {
  const candidateId = typeof row?.id === "string" ? row.id : "UNKNOWN_CANDIDATE";
  const event = typeof eventId === "string" && eventId ? eventId.slice(0, 120) : "UNKNOWN_EVENT";
  const accepted = acceptAgreedRule(agreedRule, { candidateId, eventId: event });
  const problem = currentEvidenceProblem(row, nowMs);
  const r = row?.read || null;
  let decided;
  if (accepted.error) {
    decided = { result: RESULT.UNKNOWN, action: ACTION.NONE, reason: accepted.error, evidence: { field: agreedRule?.field ?? "UNKNOWN", comparator: agreedRule?.comparator ?? "UNKNOWN", expected: "UNKNOWN", found: "UNKNOWN", block: null } };
  } else if (problem) {
    decided = { result: RESULT.UNKNOWN, action: ACTION.NONE, reason: problem, evidence: { field: accepted.rule.field, comparator: accepted.rule.comparator ?? "semantic_return_match", expected: String(accepted.rule.expected), found: "UNKNOWN", block: null } };
  } else if (accepted.semantic) {
    const observation = { source: r.source, observedAt: r.observedAt, block: r.block, chainId: r.chainId, codePresent: r.codePresent, ...(Number.isInteger(r.exitFeeBips) ? { exitFeeBips: r.exitFeeBips } : {}) };
    const evidence = readDestinationReturnEvidence(candidateId, { observation, nowMs, requireObservation: true });
    const semantic = decideSemanticReturnRule(accepted.rule, evidence);
    // nah needs the block its evidence was read at; a semantic nah cites the reader's pinned block.
    decided = { ...semantic, evidence: { ...semantic.evidence, block: semantic.result === RESULT.UNKNOWN ? null : r.block } };
  } else {
    const found = CURRENT_FIELDS[candidateId][accepted.rule.field](r);
    decided = decideRule(accepted.rule, { found, block: r.block, source: r.source });
  }
  const result = decided.result;
  const out = {
    kind: "second_candidate_decision",
    candidateId,
    eventId: event,
    decision: CURRENT_DECISION_WORD[result],
    result,
    // A match is still not execution: the exact permission is asked for next. Everything else is action 0.
    action: result === RESULT.DO_IT ? ACTION.ASK : ACTION.NONE,
    reason: decided.reason,
    executionPermission: false,
    decisions: [decided],
    receipt: null,
    receiptError: null,
  };
  if (result === RESULT.DO_IT) return out;

  const ev = decided.evidence || {};
  const runtimeChain = typeof scope.chainId === "string" ? scope.chainId : "UNKNOWN";
  const evidenceOk = !problem && !accepted.error;
  const receipt = {
    schema: DECISION_RECEIPT_SCHEMA,
    eventId: `current:${event}:${candidateId}`,
    accountId: scope.accountId,
    chainId: scope.chainId,
    destinationId: candidateId,
    jobId: candidateId,
    decision: CURRENT_DECISION_WORD[result],
    reason: decided.reason,
    category: accepted.semantic ? "return_semantic" : `rule_${CURRENT_DECISION_WORD[result]}`,
    expected: String(ev.expected ?? "UNKNOWN"),
    found: String(ev.found ?? "UNKNOWN"),
    did: "nothing",
    why: typeof ev.why === "string" && ev.why
      ? ev.why
      : decided.reason === "hard_rule_breach"
        ? `${ev.field}: expected ${ev.comparator} ${ev.expected}; found ${ev.found} at block ${ev.block}`
        : `${ev.field ?? "UNKNOWN"}: ${decided.reason} — not guessed`,
    delay: ev.delay ?? null,
    action: ACTION.NONE,
    actionCount: 0,
    txExecuted: false,
    evidence: {
      source: evidenceOk ? r.source : null,
      observedAt: evidenceOk ? r.observedAt : null,
      block: evidenceOk ? r.block : null,
      evidenceMode: "current_reader",
      readStatus: typeof row?.status === "string" ? row.status : "UNKNOWN",
      readReason: typeof row?.reason === "string" ? row.reason : null,
    },
    executionContext: {
      runtimeChain,
      jobChain: CURRENT_READ_JOB_CHAIN.chain,
      executable: false,
      role: runtimeChain === CURRENT_READ_JOB_CHAIN.chain ? "same_chain_live_execution_disabled" : "evidence_only_other_chain",
    },
    selection: {
      source: typeof selectionSource === "string" && selectionSource ? selectionSource.slice(0, 64) : "UNKNOWN_SELECTION_SOURCE",
      ruleField: typeof agreedRule?.field === "string" ? agreedRule.field.slice(0, 64) : null,
      semanticScope: "this_selection_event_only",
      ownerFinancialChoice: false,
      createsPermission: false,
    },
    recordedAt: typeof nowIso === "string" && nowIso ? nowIso : "UNKNOWN_TIME",
  };
  const verdict = validateDecisionReceipt(receipt, { accountId: scope.accountId, chainId: scope.chainId });
  out.receipt = verdict.error ? null : verdict.receipt;
  out.receiptError = verdict.error || null;
  return out;
}

/**
 * Every candidate the reader reported gets a decision (the reader's universe is preserved; a display cap is a
 * view concern elsewhere). `agreedRules` maps candidateId → the rule agreed for this event (absent = unknown).
 */
export function decideCurrentCandidates({ currentRead, agreedRules = {}, scope = {}, eventId, selectionSource, nowMs, nowIso } = {}) {
  const rows = Array.isArray(currentRead?.candidates) ? currentRead.candidates : [];
  const rules = agreedRules && typeof agreedRules === "object" ? agreedRules : {};
  return rows.map((row) => decideCurrentCandidate({
    row,
    agreedRule: typeof row?.id === "string" && Object.prototype.hasOwnProperty.call(rules, row.id) ? rules[row.id] : null,
    scope, eventId, selectionSource, nowMs, nowIso,
  }));
}

// ── [D1] Second lane descriptors — description only: never READY, never permission, never live ──────────────────
// One frozen record per Second candidate that the build record already evidences on a mainnet fork (chain 143):
// Neverland USDC, Curvance USDC and the Protect allowance cleanup. A descriptor says what is already evidenced and
// what is still missing before a lane could exist for it. It is data, not a lane:
//   · it carries no destination address, no writer ABI and no measured rate — those are UNKNOWN here;
//   · its evidence class is fork simulation only, and a fork PASS is not product readiness, permission or a rate;
//   · it is never a rule, a reading or a permission: acceptAgreedRule refuses it, decideCurrentCandidate cannot
//     read it, buildLanePermissionPreview refuses it, and nothing in this section reaches the executor;
//   · no product code imports it (MAINNET_LANE_CONFIG stays reader:null / liveExecution:false).
// Rule fields are derived from CURRENT_FIELDS (the reader's comparable values), not restated.
export const SECOND_LANE_DESCRIPTOR_SCHEMA = "araso_second_lane_descriptor_v1";
export const SECOND_LANE_STAGE = Object.freeze({ DESCRIBED: "described_not_runnable" });
// What is still open before any of these could run. Listed, not tracked: closing one is a separate Owner step.
export const SECOND_LANE_OPEN_GATES = Object.freeze([
  "owner_live_go",
  "product_reader_config",
  "destination_bound_in_lane",
  "writer_abi_in_app",
  "exact_permission",
  "lane_money_lock",
  "freshness_definition",
]);
// The boolean locks every descriptor carries. Each must be exactly `false`.
const DESCRIPTOR_LOCKS = Object.freeze(["ready", "executable", "executionPermission", "createsPermission", "liveExecution", "rateVerified"]);
const DESCRIPTOR_KEYS = Object.freeze([
  "schema", "candidateId", "family", "protocol", "asset", "chainId", "shape", "readerStatus", "comparableFields", "steps",
  "exit", "forkEvidence", "unknown", "stage", "openGates", ...DESCRIPTOR_LOCKS,
]);
const FORK_EVIDENCE_KEYS = Object.freeze(["label", "chainId", "block", "blockTimestamp", "timeWarp", "sentRaw", "deltaRaw", "gasUsedUserSteps", "change", "currentPin"]);
const DESCRIPTOR_FORK_LABELS = Object.freeze([EVIDENCE_LABEL.FORK_SIM]);

function descriptor(fields) {
  const fork = Object.freeze({ ...fields.forkEvidence });
  return Object.freeze({
    schema: SECOND_LANE_DESCRIPTOR_SCHEMA,
    ...fields,
    chainId: CURRENT_READ_JOB_CHAIN.chainId,
    comparableFields: Object.freeze(Object.keys(CURRENT_FIELDS[fields.candidateId] || {})),
    steps: Object.freeze([...fields.steps]),
    forkEvidence: fork,
    unknown: Object.freeze([...fields.unknown]),
    stage: SECOND_LANE_STAGE.DESCRIBED,
    openGates: SECOND_LANE_OPEN_GATES,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    rateVerified: false,
  });
}

// Fork re-run at the current pin: chain 143, block 108999816 (2026-09-29T09:24:32Z), no time warp, $5 USDC round trip.
const CURRENT_FORK_PIN = Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, chainId: 143, block: 108999816, blockTimestamp: "2026-09-29T09:24:32Z", timeWarp: false, sentRaw: "5000000", currentPin: true });

export const SECOND_LANE_DESCRIPTORS = Object.freeze({
  "neverland-usdc": descriptor({
    candidateId: "neverland-usdc",
    family: JOB_FAMILY.GROW_STABLE,
    protocol: "Neverland",
    asset: "USDC",
    shape: "aave_v3_fork_pool",
    readerStatus: "neverland_derived_assumed",
    steps: ["approve_exact", "supply", "withdraw"],
    exit: "immediate",
    forkEvidence: { ...CURRENT_FORK_PIN, deltaRaw: "-1", gasUsedUserSteps: 579678 },
    unknown: ["destination_in_lane", "writer_abi", "rate", "gas_fee_usd", "receipt_token_shape_assumed"],
  }),
  "curvance-usdc": descriptor({
    candidateId: "curvance-usdc",
    family: JOB_FAMILY.GROW_STABLE,
    protocol: "Curvance",
    asset: "USDC",
    shape: "erc4626_vault",
    readerStatus: "curvance_erc4626",
    steps: ["approve_exact", "deposit", "redeem"],
    exit: "immediate",
    forkEvidence: { ...CURRENT_FORK_PIN, deltaRaw: "-2", gasUsedUserSteps: 293063 },
    unknown: ["destination_in_lane", "writer_abi", "rate", "gas_fee_usd", "cooldown"],
  }),
  "protect-revoke-allowance": descriptor({
    candidateId: "protect-revoke-allowance",
    family: JOB_FAMILY.PROTECT,
    protocol: "ERC-20",
    asset: "UNKNOWN",
    shape: "erc20_allowance_reset",
    readerStatus: "protect_caller_supplied",
    steps: ["approve_zero"],
    exit: "not_applicable",
    // Older pin (block 106616273); not re-run at the current pin. No target means unavailable, never invented work.
    forkEvidence: { label: EVIDENCE_LABEL.FORK_SIM, chainId: 143, block: 106616273, change: "allowance 5 -> 0", currentPin: false },
    unknown: ["target_token", "target_spender", "current_allowance", "gas_at_current_pin", "gas_fee_usd", "writer_abi"],
  }),
});

/** Is this a well-formed descriptor that implies nothing it must not? Returns { ok: true } or { error }. */
export function validateSecondLaneDescriptor(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { error: "descriptor_missing" };
  if (d.schema !== SECOND_LANE_DESCRIPTOR_SCHEMA) return { error: "descriptor_schema" };
  for (const k of Object.keys(d)) if (!DESCRIPTOR_KEYS.includes(k)) return { error: `descriptor_unknown_key:${k}` };
  for (const k of DESCRIPTOR_LOCKS) if (d[k] !== false) return { error: `descriptor_lock_not_false:${k}` };
  if (d.stage !== SECOND_LANE_STAGE.DESCRIBED) return { error: "descriptor_stage" };
  if (!Object.prototype.hasOwnProperty.call(CURRENT_FIELDS, d.candidateId)) return { error: "descriptor_candidate_not_read" };
  if (!READ_OK_STATUS.includes(d.readerStatus)) return { error: "descriptor_reader_status" };
  if (d.chainId !== CURRENT_READ_JOB_CHAIN.chainId) return { error: "descriptor_chain" };
  const fields = Object.keys(CURRENT_FIELDS[d.candidateId]);
  if (!Array.isArray(d.comparableFields) || d.comparableFields.length !== fields.length || d.comparableFields.some((f) => !fields.includes(f))) return { error: "descriptor_fields" };
  const fe = d.forkEvidence;
  if (!fe || typeof fe !== "object" || !DESCRIPTOR_FORK_LABELS.includes(fe.label) || fe.chainId !== CURRENT_READ_JOB_CHAIN.chainId || !Number.isInteger(fe.block)) return { error: "descriptor_evidence_class" };
  for (const k of Object.keys(fe)) if (!FORK_EVIDENCE_KEYS.includes(k)) return { error: `descriptor_evidence_key:${k}` };
  if (!Array.isArray(d.unknown) || !d.unknown.includes("writer_abi")) return { error: "descriptor_unknown_list" };
  if (!Array.isArray(d.openGates) || SECOND_LANE_OPEN_GATES.some((g) => !d.openGates.includes(g))) return { error: "descriptor_gates" };
  // No address of any kind lives in a descriptor (destinations are not bound to a lane yet).
  if (/0x[0-9a-fA-F]{40}/.test(JSON.stringify(d))) return { error: "descriptor_has_address" };
  return { ok: true };
}

/** The descriptor for one candidate, or null (unknown candidate, or a descriptor that fails validation). */
export function secondLaneDescriptor(candidateId) {
  const d = Object.prototype.hasOwnProperty.call(SECOND_LANE_DESCRIPTORS, candidateId) ? SECOND_LANE_DESCRIPTORS[candidateId] : null;
  return d && validateSecondLaneDescriptor(d).ok ? d : null;
}

/**
 * A descriptor beside a decision (from decideCurrentCandidate). Read-only view: whatever the decision says, the
 * combination is not runnable, grants nothing and is not live — a match still leaves every open gate open.
 */
export function describeSecondLaneCandidate(candidateId, decision = null) {
  const d = secondLaneDescriptor(candidateId);
  const sameCandidate = !!decision && typeof decision === "object" && decision.candidateId === candidateId;
  return Object.freeze({
    candidateId: typeof candidateId === "string" ? candidateId : "UNKNOWN_CANDIDATE",
    described: !!d,
    stage: d ? d.stage : "UNKNOWN",
    decision: sameCandidate && typeof decision.decision === "string" ? decision.decision : "unknown",
    runnable: false,
    executionPermission: false,
    liveExecution: false,
    openGates: SECOND_LANE_OPEN_GATES,
  });
}

// ── [U1] Explore candidate rows — what the user may pick from this event, never what may run ──────────────────────
// Joins the decisions above (one per reader row, the whole universe) with the family table the readiness module
// already publishes (one baseline per family; the rest are alternatives in the same slot) and the D1 view above.
// A row's status is "nah" only when the decision core said nah for this event; everything else (unknown, ask,
// match) is "unknown" here, because nothing in this card is runnable: a match still only asks for the exact
// permission, which no row carries. There is no display cap in this section; the visible limit is a view concern.
export const EXPLORE_CANDIDATE_STATUS = Object.freeze({ NAH: "nah", UNKNOWN: "unknown" });

/** @returns {{rows: object[], universe: number, decidedIds: string[]}} rows are frozen and never runnable. */
export function exploreCandidateRows({ decisions = [], families = [] } = {}) {
  const list = Array.isArray(decisions) ? decisions : [];
  const byId = new Map();
  for (const d of list) if (d && typeof d.candidateId === "string" && !byId.has(d.candidateId)) byId.set(d.candidateId, d);
  const rows = [];
  for (const f of Array.isArray(families) ? families : []) {
    if (!f || typeof f.family !== "string" || typeof f.baseline !== "string" || !f.baseline) continue;
    const d = byId.get(f.baseline) || null;
    const view = describeSecondLaneCandidate(f.baseline, d);
    const nah = !!d && d.decision === "nah" && d.action === ACTION.NONE && d.executionPermission === false;
    rows.push(Object.freeze({
      candidateId: f.baseline,
      family: f.family,
      alternatives: Object.freeze((Array.isArray(f.alternatives) ? f.alternatives : []).filter((x) => typeof x === "string")),
      status: nah ? EXPLORE_CANDIDATE_STATUS.NAH : EXPLORE_CANDIDATE_STATUS.UNKNOWN,
      reason: d && typeof d.reason === "string" ? d.reason : "not_decided",
      described: view.described,
      runnable: false,
      executionPermission: false,
      liveExecution: false,
    }));
  }
  return Object.freeze({ rows: Object.freeze(rows), universe: list.length, decidedIds: Object.freeze([...byId.keys()]) });
}
