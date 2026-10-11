// Mainnet Job — Neverland USDC (USDC into a lending pool, withdrawn to the same Piggy). Local model of what is
// PROVEN on one mainnet fork run, nothing more.
//
// Evidence: one mainnet fork run, chain 143, block 108999816 (2026-09-29T09:24:32Z), no time warp, 5 USDC.
// Evidence class PASS_FORK_SIM — a fork run is never product readiness, permission, a rate or a mainnet
// transaction.
//
//   PROVEN on the fork (success):  approve(exact) · supply · withdraw(whole position, next block)
//   NOT PROVEN:  a partial withdraw · any amount above the 5 USDC that was run · exit liquidity or a supply
//                cap at a later block · what the reserve configuration word means · the name of revert "32"
//
// This module carries Neverland's own recorded facts. It does not borrow the Aave Job's constants, ABIs,
// reserve decoder or receipt token, and it does not assume that any Aave fact holds for this pool: the
// signatures, selectors, addresses and gas below are the ones the Neverland fork run itself recorded.
// There is no cooldown, wait, interval or ETA here. The fork withdrew in the next block without a time
// warp; how long a real exit takes is UNKNOWN and nothing below fills it in.
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no
// storage key and reads no network. neverlandExecutionGate() runs the existing boundaries (chain-profile.js
// binding, the shared local-fork executor refusal) and then refuses anyway, because no Neverland lane is
// wired to the one send chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData, maxUint256 } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { bindRecordToProfile, chainMatchesExecutor, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const NEVERLAND_JOB_ID = "neverland-usdc";
export const NEVERLAND_ACTION = "neverland_supply_withdraw";

export const NEVERLAND_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// What the fork run recorded. Values are copied from the run record, not derived.
export const NEVERLAND_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 108999816,
  blockTimestamp: "2026-09-29T09:24:32Z",
  timeWarp: false,
  pool: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585",
  poolCodeBytes: 2333,
  asset: Object.freeze({ symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }),
  // Re-derived on the fork from the pool's reserve read and equal to the recorded value.
  receiptToken: Object.freeze({ symbol: "nUSDC", address: "0x38648958836eA88b368b4ac23b86Ad44B0fe7508", decimals: 6 }),
  approvalExact: true,
  allowanceAfterEntryRaw: "0",
  sentRaw: "5000000",
  receiptAfterEntry: "4.999999",
  returnedRaw: "4999999",
  deltaRaw: "-1",
  gasUsed: Object.freeze({ approve: 55437, supply: 287893, withdraw: 236348 }),
  // Observed on the fork only: supply in block N, withdraw of the whole position in block N+1, no time warp.
  exitObserved: "whole_position_next_block_no_time_warp",
  revertProbe: Object.freeze({ step: "withdraw with zero position", status: "reverted", reason: "32", name: "UNKNOWN" }),
  // Never measured or never re-proven for this pool: there is no value to show for these.
  unknown: Object.freeze([
    "real_world_exit_timing", "exit_liquidity", "supply_cap", "reserve_configuration_meaning", "reserve_flags",
    "revert_32_name", "supply_rate", "gas_fee_usd", "partial_withdraw", "amount_above_fork_size",
    "freshness_window", "fee_cap", "eligibility_policy", "reserve_factor", "ltv", "liquidation_penalty",
  ]),
});

// The only size run end to end on the fork. Anything larger is unproven, not merely uncapped.
export const NEVERLAND_FORK_SIZE_RAW = NEVERLAND_FORK_EVIDENCE.sentRaw;

// Protocol fields a Neverland errand would need, each marked with what the fork proved. A field that is not
// proven has no value: it reads as "UNKNOWN", and any step that would depend on it is action 0.
export const NEVERLAND_FIELDS = Object.freeze({
  pool: Object.freeze({ proof: NEVERLAND_PROOF.PROVEN_FORK, value: NEVERLAND_FORK_EVIDENCE.pool }),
  asset: Object.freeze({ proof: NEVERLAND_PROOF.PROVEN_FORK, value: NEVERLAND_FORK_EVIDENCE.asset.address }),
  receiptToken: Object.freeze({ proof: NEVERLAND_PROOF.PROVEN_FORK, value: NEVERLAND_FORK_EVIDENCE.receiptToken.address }),
  referralCode: Object.freeze({ proof: NEVERLAND_PROOF.PROVEN_FORK, value: 0 }),
  withdrawAmount: Object.freeze({ proof: NEVERLAND_PROOF.PROVEN_FORK, value: "whole_position" }),
  exitTiming: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  exitLiquidity: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  supplyCap: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  reserveFlags: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  supplyRate: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  feeCap: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
  eligibilityPolicy: Object.freeze({ proof: NEVERLAND_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const NEVERLAND_UNKNOWN_FIELDS = Object.freeze(Object.keys(NEVERLAND_FIELDS).filter((k) => NEVERLAND_FIELDS[k].proof !== NEVERLAND_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function neverlandField(name) {
  if (typeof name !== "string" || !has(NEVERLAND_FIELDS, name)) return "UNKNOWN";
  const f = NEVERLAND_FIELDS[name];
  return f.proof === NEVERLAND_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully, with the parameter names the pool's published interface uses.
// Return values were not evidenced and are never decoded here (outputs left empty on purpose).
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "onBehalfOf", type: "address" }, { name: "referralCode", type: "uint16" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [] },
]);

// Stages a Neverland errand can be described in, along fork-proven steps only.
export const NEVERLAND_STAGE = Object.freeze({
  NONE: "none",
  APPROVED: "approved_exact",
  SUPPLIED: "holding_receipt",
  WITHDRAWN: "withdrawn",
  UNKNOWN: "unknown",
});

export const NEVERLAND_STEPS = Object.freeze({
  approve: Object.freeze({
    proof: NEVERLAND_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "asset",
    from: NEVERLAND_STAGE.NONE, to: NEVERLAND_STAGE.APPROVED, forkStatus: "success", gasUsed: 55437,
  }),
  supply: Object.freeze({
    proof: NEVERLAND_PROOF.PROVEN_FORK, signature: "supply(address,uint256,address,uint16)", selector: "0x617ba037", target: "pool",
    from: NEVERLAND_STAGE.APPROVED, to: NEVERLAND_STAGE.SUPPLIED, forkStatus: "success", gasUsed: 287893,
  }),
  withdraw: Object.freeze({
    proof: NEVERLAND_PROOF.PROVEN_FORK, signature: "withdraw(address,uint256,address)", selector: "0x69328dec", target: "pool",
    from: NEVERLAND_STAGE.SUPPLIED, to: NEVERLAND_STAGE.WITHDRAWN, forkStatus: "success", gasUsed: 236348, amount: "whole_position",
  }),
  // A withdraw of less than the whole position was never run. Same selector, different claim: unproven.
  withdrawPartial: Object.freeze({
    proof: NEVERLAND_PROOF.UNPROVEN, signature: "withdraw(address,uint256,address)", selector: "0x69328dec", target: "pool",
    from: null, to: null, forkStatus: "never_observed",
  }),
});

export const NEVERLAND_UNPROVEN_STEPS = Object.freeze(Object.keys(NEVERLAND_STEPS).filter((k) => NEVERLAND_STEPS[k].proof !== NEVERLAND_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(NEVERLAND_STEPS, step)) return "unknown_step";
  if (NEVERLAND_STEPS[step].proof !== NEVERLAND_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/**
 * The stage after one step, only along fork-proven transitions. An unproven step has no next stage.
 * @returns {{stage: string|null, error: string|null}}
 */
export function neverlandStageAfter(stage, step) {
  if (!Object.values(NEVERLAND_STAGE).includes(stage) || stage === NEVERLAND_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = NEVERLAND_STEPS[step];
  if (stage !== s.from) return { stage: null, error: "step_not_valid_from_stage" };
  return { stage: s.to, error: null };
}

// One read of the Piggy's id and address; a non-string address is no address (an array would pass a regex test).
function snapshotPiggy(piggy) {
  if (!piggy || typeof piggy !== "object") return {};
  const id = piggy.id;
  const address = piggy.address;
  return { id: typeof id === "string" ? id : undefined, address: typeof address === "string" ? address : undefined };
}

/** An exact raw USDC amount within the fork-proven size, as a BigInt; otherwise an error word. */
function exactAmount(v) {
  if (!isDigits(v) || BigInt(v) === 0n) return { amount: null, error: "amount_not_exact" };
  if (BigInt(v) > BigInt(NEVERLAND_FORK_SIZE_RAW)) return { amount: null, error: "amount_above_fork_proven_size" };
  return { amount: BigInt(v), error: null };
}

/**
 * Calldata for ONE fork-proven step, built from the recorded pool and asset only. Every argument is explicit:
 * the approve is exactly the amount (never unlimited), the supply credits the Piggy itself, and the withdraw
 * takes the whole position back to the Piggy — the only withdraw the fork ran. This is a description of a call,
 * not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeNeverlandStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args) ? { amountRaw: args.amountRaw, piggyAddress: args.piggyAddress } : {};
  const pool = NEVERLAND_FORK_EVIDENCE.pool;
  const asset = NEVERLAND_FORK_EVIDENCE.asset.address;
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  if (step === "withdraw") {
    if (a.amountRaw !== undefined && a.amountRaw !== "whole_position") return { call: null, error: "unproven_step:withdrawPartial" };
    return { call: Object.freeze({ step, to: pool, value: "0", amount: "whole_position", data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "withdraw", args: [asset, maxUint256, a.piggyAddress] }) }), error: null };
  }
  const { amount, error } = exactAmount(a.amountRaw);
  if (error) return { call: null, error };
  if (step === "approve") {
    return { call: Object.freeze({ step, to: asset, value: "0", spender: pool, amountRaw: amount.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [pool, amount] }) }), error: null };
  }
  // supply
  return { call: Object.freeze({ step, to: pool, value: "0", amountRaw: amount.toString(), onBehalfOf: a.piggyAddress, referralCode: 0, data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "supply", args: [asset, amount, a.piggyAddress, 0] }) }), error: null };
}

/**
 * The exact request a permission envelope for the Neverland entry would have to match, in the shape
 * permission-envelope.js authorize() compares, with its nonce from permissionNonce(). It issues nothing:
 * `permission` is always null and `createsPermission` false. The binding comes from chain-profile.js.
 * @returns {{request: object|null, error: string|null}}
 */
export function neverlandPermissionRequest(input) {
  const { profile, piggy, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, NEVERLAND_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_neverland_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return { request: null, error };
  if (lower(binding.token) !== lower(NEVERLAND_FORK_EVIDENCE.asset.address) || binding.decimals !== NEVERLAND_FORK_EVIDENCE.asset.decimals) return { request: null, error: "profile_asset_not_neverland_evidence" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: NEVERLAND_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: NEVERLAND_FORK_EVIDENCE.pool,
  };
  return {
    request: Object.freeze({
      ...fields,
      destinationRequired: true,
      amountDisplay: `${formatUnits(exact.amount, binding.decimals)} ${binding.asset}`,
      nonce: permissionNonce({ ...fields, at: typeof eventId === "string" && eventId ? eventId : "UNKNOWN_EVENT" }),
      permission: null,
      createsPermission: false,
    }),
    error: null,
  };
}

/**
 * Could this step run for this Piggy? Always { allowed: false, action: "none" }. The first refusal comes from
 * the existing boundaries, in order: proof of the step, the chain profile, live-off, the profile's Job, the
 * record binding (chain-profile.js), the shared local-fork executor refusal, every still-UNKNOWN field, and
 * finally the fact that no Neverland lane reaches the send chokepoint.
 */
export function neverlandExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== NEVERLAND_JOB_ID) return refuse("profile_not_neverland_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (NEVERLAND_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${NEVERLAND_UNKNOWN_FIELDS[0]}`);
  return refuse("neverland_lane_not_wired");
}

/**
 * Readiness of a Neverland errand. Never READY, never executable, never live, never permitted — whatever the
 * input claims (a forged stage, a live profile, an executor, caller-supplied cap or liquidity numbers). The
 * reasons list what is still open; the evidence fields say what was proven.
 */
export function neverlandReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of NEVERLAND_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of NEVERLAND_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = neverlandExecutionGate({ profile: profile ?? null, piggy, executor, step: "approve" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "neverland_lane_not_wired");
  const known = typeof stage === "string" && Object.values(NEVERLAND_STAGE).includes(stage) ? stage : (stage === undefined ? NEVERLAND_STAGE.NONE : NEVERLAND_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: NEVERLAND_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    evidenceClass: NEVERLAND_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(NEVERLAND_STEPS).filter((k) => NEVERLAND_STEPS[k].proof === NEVERLAND_PROOF.PROVEN_FORK)),
    unprovenSteps: NEVERLAND_UNPROVEN_STEPS,
    unknownFields: NEVERLAND_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}
