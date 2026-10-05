// Mainnet Job — Kintsu sMON (native MON in, delayed exit). Local model of what is PROVEN, nothing more.
//
// Evidence: one mainnet fork run, chain 143, block 108999816 (2026-09-29T09:24:32Z), no time warp,
// 1 MON. Evidence class PASS_FORK_SIM_WITH_PENDING — a fork run is never product readiness, permission,
// a rate or a mainnet transaction.
//
//   PROVEN on the fork (success):  deposit · requestUnlock · pending read · cancelUnlockRequest
//   NOT PROVEN (reverted / never observed):  submitBatch · redeem · return of MON to the Piggy
//
// So this module can say "holding shares" and "pending unlock", and how cancel goes back from pending.
// It cannot say "returned", "redeemable" or when: there is no returned stage, no cooldown, no batch
// interval and no ETA here — those are UNKNOWN on the evidence, and nothing below fills them in.
// It is not Aave-shaped: no ERC-20 approve, no Pool, no receipt token, no immediate exit.
//
// No execution path: this module imports no executor and no permission issuer, builds no signer,
// holds no storage key and reads no network. kintsuExecutionGate() runs the existing boundaries
// (chain-profile.js binding, the shared local-fork executor refusal) and then refuses anyway, because
// no Kintsu lane is wired to the one send chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { bindRecordToProfile, isProfileActive } from "./chain-profile.js";
import { ADDR, executorRefusal, isDigits } from "./mainnet-job-common.js";

export const KINTSU_JOB_ID = "kintsu-smon";

export const KINTSU_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// What the fork run measured. Values are copied from the run record, not derived.
export const KINTSU_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM_PENDING,
  chainId: 143,
  block: 108999816,
  blockTimestamp: "2026-09-29T09:24:32Z",
  timeWarp: false,
  vault: "0xA3227C5969757783154C60bF0bC1944180ed81B9",
  share: Object.freeze({ symbol: "sMON", decimals: 18 }),
  entryAsset: "MON",
  approvalsUsed: 0,
  sentWei: "1000000000000000000",
  sharesAfterEntryRaw: "899864250694037717",
  sharesAfterRequestRaw: "0",
  pendingAtRequest: Object.freeze({ shares: "899864250694037717", spotValueWei: "998999999999999999", batchId: 1359, exitFeeInBips: 10 }),
  cancelRestoredSharesExactly: true,
  exitSemantics: "pending",
  // Never observed: there is no number to show for these.
  unknown: Object.freeze(["redeem_revert_name", "submit_batch_revert_cause", "real_world_eta", "cooldown", "batch_interval", "final_return_value", "gas_fee_usd"]),
});

// Writer calls the fork run made successfully. Only these can be encoded. Return values were not
// evidenced and are never decoded here (outputs left empty on purpose).
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "minShares", type: "uint96" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "requestUnlock", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint96" }, { name: "minSpotValue", type: "uint96" }], outputs: [] },
  { type: "function", name: "cancelUnlockRequest", stateMutability: "nonpayable", inputs: [{ name: "index", type: "uint256" }], outputs: [] },
]);

// Stages a Kintsu errand can be described in. There is deliberately no "returned" / "redeemed" stage.
export const KINTSU_STAGE = Object.freeze({
  NONE: "none",
  HOLDING: "holding_shares",
  PENDING_UNLOCK: "pending_unlock",
  UNKNOWN: "unknown",
});

const UINT96_MAX = (1n << 96n) - 1n;

export const KINTSU_STEPS = Object.freeze({
  deposit: Object.freeze({
    proof: KINTSU_PROOF.PROVEN_FORK, signature: "deposit(uint96,address)", selector: "0x1c3477dd", payable: true,
    from: KINTSU_STAGE.NONE, to: KINTSU_STAGE.HOLDING, forkStatus: "success", gasUsed: 79785,
  }),
  requestUnlock: Object.freeze({
    proof: KINTSU_PROOF.PROVEN_FORK, signature: "requestUnlock(uint96,uint96)", selector: "0x24f67e18", payable: false,
    from: KINTSU_STAGE.HOLDING, to: KINTSU_STAGE.PENDING_UNLOCK, forkStatus: "success", gasUsed: 105483,
  }),
  cancelUnlockRequest: Object.freeze({
    proof: KINTSU_PROOF.PROVEN_FORK, signature: "cancelUnlockRequest(uint256)", selector: "0x1610247b", payable: false,
    from: KINTSU_STAGE.PENDING_UNLOCK, to: KINTSU_STAGE.HOLDING, forkStatus: "success", gasUsed: 74761,
  }),
  submitBatch: Object.freeze({
    proof: KINTSU_PROOF.UNPROVEN, signature: "submitBatch()", selector: "0x46115383", payable: false,
    from: null, to: null, forkStatus: "reverted", revertData: "0x", timeWarpedStatus: "reverted",
  }),
  redeem: Object.freeze({
    proof: KINTSU_PROOF.UNPROVEN, signature: "redeem(uint256,address)", selector: "0x7bde82f2", payable: false,
    from: null, to: null, forkStatus: "reverted", revertData: "0xfc08f5f2", revertName: "UNKNOWN", timeWarpedStatus: "reverted",
  }),
  // The step that would bring MON back to the Piggy. Never observed, so it has no signature at all.
  return: Object.freeze({
    proof: KINTSU_PROOF.UNPROVEN, signature: null, selector: null, payable: false,
    from: null, to: null, forkStatus: "never_observed",
  }),
});

export const KINTSU_UNPROVEN_STEPS = Object.freeze(Object.keys(KINTSU_STEPS).filter((k) => KINTSU_STEPS[k].proof !== KINTSU_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function stepProblem(step) {
  if (typeof step !== "string" || !has(KINTSU_STEPS, step)) return "unknown_step";
  if (KINTSU_STEPS[step].proof !== KINTSU_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/**
 * The stage after one step, only along fork-proven transitions. An unproven step (submitBatch, redeem,
 * return) has no next stage: it answers an error and the stage is unchanged.
 * @returns {{stage: string|null, error: string|null}}
 */
export function kintsuStageAfter(stage, step) {
  if (!Object.values(KINTSU_STAGE).includes(stage)) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = KINTSU_STEPS[step];
  if (stage !== s.from) return { stage: null, error: "step_not_valid_from_stage" };
  return { stage: s.to, error: null };
}

/** Words a Kintsu stage may be shown as. There is no "done": a returned outcome is not representable. */
export function kintsuOutcomeWord(stage) {
  if (stage === KINTSU_STAGE.PENDING_UNLOCK) return "pending";
  if (stage === KINTSU_STAGE.HOLDING) return "holding";
  if (stage === KINTSU_STAGE.NONE) return "none";
  return "unknown";
}

/**
 * Interprets ONE pending-unlock entry the way the fork run read it ({shares, spotValueWei, batchId,
 * exitFeeInBips}). It says the errand is pending; it never says when it ends or what comes back.
 * Anything malformed is unknown, never pending.
 */
export function readKintsuPending(entry) {
  const unknown = (reason) => Object.freeze({ stage: KINTSU_STAGE.UNKNOWN, reason, eta: "UNKNOWN", cooldown: "UNKNOWN", redeemable: "UNKNOWN", returnComplete: false });
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return unknown("pending_missing");
  if (!isDigits(entry.shares) || BigInt(entry.shares) === 0n) return unknown("pending_shares_unreadable");
  if (!isDigits(entry.spotValueWei)) return unknown("pending_spot_value_unreadable");
  if (!Number.isSafeInteger(entry.batchId) || entry.batchId < 0) return unknown("pending_batch_unreadable");
  if (!Number.isSafeInteger(entry.exitFeeInBips) || entry.exitFeeInBips < 0 || entry.exitFeeInBips > 10000) return unknown("pending_fee_unreadable");
  return Object.freeze({
    stage: KINTSU_STAGE.PENDING_UNLOCK,
    reason: "pending_unlock_read",
    sharesRaw: entry.shares,
    spotValueWei: entry.spotValueWei,
    batchId: entry.batchId,
    exitFeeInBips: entry.exitFeeInBips,
    // A spot value at request time is not what comes back: the final value was never observed.
    spotValueIsFinalReturn: false,
    eta: "UNKNOWN",
    cooldown: "UNKNOWN",
    redeemable: "UNKNOWN",
    returnComplete: false,
  });
}

const exactUint = (v, max) => (isDigits(v) && BigInt(v) <= max ? BigInt(v) : null);

/**
 * Calldata for ONE fork-proven step. Every argument is explicit: there is no default minimum (minShares
 * / minSpotValue are a product choice the evidence does not make — the fork probe used 0). Unproven
 * steps are refused. This is a description of a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeKintsuStep(step, args = {}) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const vault = KINTSU_FORK_EVIDENCE.vault;
  const a = args && typeof args === "object" ? args : {};
  if (step === "deposit") {
    const value = exactUint(a.valueWei, (1n << 256n) - 1n);
    const minShares = exactUint(a.minSharesRaw, UINT96_MAX);
    if (value === null || value === 0n) return { call: null, error: "amount_not_exact" };
    if (minShares === null) return { call: null, error: "min_shares_not_exact" };
    if (!ADDR.test(a.receiver || "")) return { call: null, error: "missing_receiver" };
    return { call: Object.freeze({ step, to: vault, value: value.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "deposit", args: [minShares, a.receiver] }) }), error: null };
  }
  if (step === "requestUnlock") {
    const shares = exactUint(a.sharesRaw, UINT96_MAX);
    const minSpot = exactUint(a.minSpotValueWei, UINT96_MAX);
    if (shares === null || shares === 0n) return { call: null, error: "shares_not_exact" };
    if (minSpot === null) return { call: null, error: "min_spot_value_not_exact" };
    return { call: Object.freeze({ step, to: vault, value: "0", data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "requestUnlock", args: [shares, minSpot] }) }), error: null };
  }
  // cancelUnlockRequest
  const index = exactUint(a.index, (1n << 256n) - 1n);
  if (index === null) return { call: null, error: "unlock_index_not_exact" };
  return { call: Object.freeze({ step, to: vault, value: "0", data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "cancelUnlockRequest", args: [index] }) }), error: null };
}

/**
 * Could this step run for this Piggy? Always { allowed: false }. The first refusal comes from the
 * existing boundaries, in order: proof of the step, the chain profile, the profile's Job, the record
 * binding (chain-profile.js — it binds USDC only, so a MON errand cannot be bound), the shared local-fork
 * executor refusal, and finally the fact that no Kintsu lane reaches the send chokepoint.
 */
export function kintsuExecutionGate({ profile, piggy = {}, executor, step } = {}) {
  const refuse = (reason) => Object.freeze({ allowed: false, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  if (profile.jobId !== KINTSU_JOB_ID) return refuse("profile_not_kintsu_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: piggy.id, piggyAddress: piggy.address, asset: KINTSU_FORK_EVIDENCE.entryAsset });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  return refuse("kintsu_lane_not_wired");
}

/**
 * Readiness of a Kintsu errand. Never READY, never executable, never return-complete, never live —
 * whatever the input claims (a forged "redeemed" read, a live profile, an executor). The reasons list
 * what is still open; the evidence fields say what was proven.
 */
export function kintsuReadiness({ stage = KINTSU_STAGE.NONE, profile = null, piggy = {}, executor = null } = {}) {
  const blockedBy = [];
  for (const s of KINTSU_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  const gate = kintsuExecutionGate({ profile, piggy, executor, step: "deposit" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "cooldown_unknown", "eta_unknown");
  const known = Object.values(KINTSU_STAGE).includes(stage) ? stage : KINTSU_STAGE.UNKNOWN;
  return Object.freeze({
    jobId: KINTSU_JOB_ID,
    stage: known,
    outcome: kintsuOutcomeWord(known),
    ready: false,
    executable: false,
    executionPermission: false,
    liveExecution: false,
    returnComplete: false,
    evidenceClass: KINTSU_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(KINTSU_STEPS).filter((k) => KINTSU_STEPS[k].proof === KINTSU_PROOF.PROVEN_FORK)),
    unprovenSteps: KINTSU_UNPROVEN_STEPS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}
