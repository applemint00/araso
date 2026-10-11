// Mainnet Job — USDC approval revoke (approve(spender, 0) on USDC, for a fixed allowlisted spender set). Local model of what is
// PROVEN on one mainnet fork run, nothing more. Same lane shape as the other mainnet Job modules.
//
// Evidence: one mainnet fork run, chain 143, block 110746900 (2026-10-05T12:01:37Z), anvil fork, impersonated fixture actor holding
// 10 USDC. For each of three spenders: approve(spender, 5 USDC) as setup → approve(spender, 0) → approve(spender, 0) again; and once
// approve(Aave pool, max) → approve(Aave pool, 0). Evidence class PASS_FORK_SIM — a fork run is never product readiness, permission,
// a rate or a mainnet transaction.
//
//   PROVEN on the fork (success):  approve(spender, 0) on USDC from a non-zero allowance (5 USDC and max) for exactly these spenders:
//                                  Aave v3 pool · Kuru USDC/MON market · Kuru margin account. Allowance read 0 after; the USDC balance
//                                  did not move; the only cost was gas (33501 used).
//   ALSO OBSERVED, NOT A STEP HERE:  approve(spender, 0) when the allowance is already 0 also succeeds and still costs gas (35501):
//                                  this module refuses it instead ("allowance_already_zero").
//   NOT PROVEN for this lane:  any other spender · any other token · Permit2 allowances · decreaseAllowance · finding old or foreign
//                              allowances (needs an indexer / Approval-log scan — UNKNOWN) · behaviour at another block
//
// A revoke moves no principal. It is still a signed transaction that costs gas, and it can break an errand that relies on the
// allowance: the caller must bring a MEASURED allowance read for exactly this Piggy and spender, and a non-zero one.
//
// Fork review — 7 conditions, ALL OPEN (never closed here):
//   [ ] 1 separate Owner-GO live-tx card
//   [ ] 2 grounded MON/USD at the same cutoff for the ≈0.0022 MON gas of one revoke
//   [ ] 3 live-head re-read of USDC identity / code and each spender's code vs the pin (stop on drift)
//   [ ] 4 allowance discovery: which spenders this Piggy actually approved (indexer / log scan), never guessed
//   [ ] 5 interaction with open errands (a revoke under a pending order or lane step) — an ordering rule
//   [ ] 6 money-executor design and guard review
//   [ ] 7 product copy (OPEN)
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no storage key and reads no
// network. revokeExecutionGate() runs the existing boundaries and then refuses anyway, because no revoke lane is wired to the one send
// chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { NATIVE_ASSET_NOT_ERC20, bindRecordToProfile, chainMatchesExecutor, erc20TokenOfBinding, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const REVOKE_JOB_ID = "usdc-allowance-revoke";
export const REVOKE_ACTION = "usdc_approval_revoke";

export const REVOKE_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// Copied from the fork run record, not derived.
export const REVOKE_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 110746900,
  blockTimestamp: "2026-10-05T12:01:37Z",
  timeWarp: false,
  token: Object.freeze({ symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6, codeBytes: 1798 }),
  // The fixed allowlist: exactly the spenders the fork revoked, nothing else.
  spenders: Object.freeze([
    Object.freeze({ id: "aavePool", address: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef" }),
    Object.freeze({ id: "kuruMarket", address: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394" }),
    Object.freeze({ id: "kuruMargin", address: "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5" }),
  ]),
  measured: Object.freeze({
    setupAllowanceRaw: "5000000",
    allowanceAfterRaw: "0",
    usdcBalanceBeforeRaw: "10000000",
    usdcBalanceAfterRaw: "10000000",
    principalMoved: false,
    fromMaxAllowanceAfterRaw: "0",
  }),
  gasUsed: Object.freeze({ revoke: 33501, revokeFromMax: 33501, revokeAlreadyZero: 35501, setupApprove: 55437, setupApproveMax: 55785 }),
  gasEstimate: Object.freeze({ revoke: 38411, revokeAlreadyZero: 35567 }),
  unknown: Object.freeze([
    "foreign_allowance_enumeration", "other_spenders", "other_tokens", "permit2_allowances", "live_head_drift", "gas_fee_usd",
    "open_errand_interaction", "freshness_window",
  ]),
});

export const REVOKE_SPENDER_IDS = Object.freeze(REVOKE_FORK_EVIDENCE.spenders.map((s) => s.id));

export const REVOKE_FIELDS = Object.freeze({
  token: Object.freeze({ proof: REVOKE_PROOF.PROVEN_FORK, value: REVOKE_FORK_EVIDENCE.token.address }),
  spenders: Object.freeze({ proof: REVOKE_PROOF.PROVEN_FORK, value: REVOKE_SPENDER_IDS }),
  amount: Object.freeze({ proof: REVOKE_PROOF.PROVEN_FORK, value: "0" }),
  principalMoved: Object.freeze({ proof: REVOKE_PROOF.PROVEN_FORK, value: false }),
  allowanceDiscovery: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  permit2: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  liveHeadDrift: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  openErrandInteraction: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const REVOKE_UNKNOWN_FIELDS = Object.freeze(Object.keys(REVOKE_FIELDS).filter((k) => REVOKE_FIELDS[k].proof !== REVOKE_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function revokeField(name) {
  if (typeof name !== "string" || !has(REVOKE_FIELDS, name)) return "UNKNOWN";
  const f = REVOKE_FIELDS[name];
  return f.proof === REVOKE_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

/** The allowlisted spender for an address or id (case-insensitive address match), or null. */
export function revokeSpender(spender) {
  if (typeof spender !== "string") return null;
  const hit = REVOKE_FORK_EVIDENCE.spenders.find((s) => s.id === spender || (ADDR.test(spender) && lower(s.address) === lower(spender)));
  return hit || null;
}

// The writer call the fork run made successfully. The return value is never decoded: the allowance is read, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
]);

export const REVOKE_STAGE = Object.freeze({
  OPEN: "allowance_open",
  REVOKED: "allowance_revoked",
  UNKNOWN: "unknown",
});

export const REVOKE_STEPS = Object.freeze({
  revoke: Object.freeze({ proof: REVOKE_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "usdc", from: REVOKE_STAGE.OPEN, to: REVOKE_STAGE.REVOKED, forkStatus: "success", gasUsed: 33501, amount: "0" }),
  // Not run on this lane path, or not a revoke: unproven.
  revokeOtherToken: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "other", from: null, to: null, forkStatus: "never_observed" }),
  revokePermit2: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, signature: null, selector: null, target: "permit2", from: null, to: null, forkStatus: "never_observed" }),
  decreaseAllowance: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, signature: "decreaseAllowance(address,uint256)", selector: "0xa457c2d7", target: "usdc", from: null, to: null, forkStatus: "never_observed" }),
  approveNonZero: Object.freeze({ proof: REVOKE_PROOF.UNPROVEN, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "usdc", from: null, to: null, forkStatus: "setup_only_not_a_revoke" }),
});

export const REVOKE_UNPROVEN_STEPS = Object.freeze(Object.keys(REVOKE_STEPS).filter((k) => REVOKE_STEPS[k].proof !== REVOKE_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(REVOKE_STEPS, step)) return "unknown_step";
  if (REVOKE_STEPS[step].proof !== REVOKE_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/** The stage after one step, only along fork-proven transitions (a revoke at an already-zero allowance is refused). */
export function revokeStageAfter(stage, step) {
  if (!Object.values(REVOKE_STAGE).includes(stage) || stage === REVOKE_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  if (stage === REVOKE_STAGE.REVOKED) return { stage: null, error: "allowance_already_zero" };
  const s = REVOKE_STEPS[step];
  if (stage !== s.from) return { stage: null, error: "step_not_valid_from_stage" };
  return { stage: s.to, error: null };
}

function snapshotPiggy(piggy) {
  if (!piggy || typeof piggy !== "object") return {};
  const id = piggy.id;
  const address = piggy.address;
  return { id: typeof id === "string" ? id : undefined, address: typeof address === "string" ? address : undefined };
}

// The amount of a revoke is 0 and nothing else. Absent = 0; anything other than the string "0" is refused.
function zeroOnly(v) {
  if (v === undefined || v === "0") return null;
  return "revoke_amount_not_zero";
}

/**
 * Calldata for the ONE fork-proven step: approve(spender, 0) on the recorded USDC. The spender must be one of the allowlisted
 * spenders (by id or address); the token, if given, must be the recorded USDC; the amount, if given, must be "0"; the caller must
 * bring a MEASURED non-zero allowance of this Piggy to this spender (a revoke at 0 is refused: it only costs gas). A description of
 * a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeRevokeStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? { spender: args.spender, token: args.token, amountRaw: args.amountRaw, piggyAddress: args.piggyAddress, allowanceRaw: args.allowanceRaw }
    : {};
  const usdc = REVOKE_FORK_EVIDENCE.token.address;
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  if (a.token !== undefined && lower(a.token) !== lower(usdc)) return { call: null, error: "token_not_usdc" };
  const sp = revokeSpender(a.spender);
  if (!sp) return { call: null, error: "spender_not_allowlisted" };
  const z = zeroOnly(a.amountRaw);
  if (z) return { call: null, error: z };
  if (!isDigits(a.allowanceRaw)) return { call: null, error: "allowance_not_measured" };
  if (BigInt(a.allowanceRaw) === 0n) return { call: null, error: "allowance_already_zero" };
  return {
    call: Object.freeze({
      step, to: usdc, value: "0", spender: sp.address, spenderId: sp.id, amountRaw: "0", allowanceBeforeRaw: a.allowanceRaw,
      data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [sp.address, 0n] }),
    }),
    error: null,
  };
}

/** The exact request a permission envelope for one revoke would have to match. Issues nothing (permission null). Amount is "0". */
export function revokePermissionRequest(input) {
  const { profile, piggy, spender, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, REVOKE_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_revoke_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return { request: null, error };
  const usdc = REVOKE_FORK_EVIDENCE.token;
  if (erc20TokenOfBinding(binding).error === NATIVE_ASSET_NOT_ERC20) return { request: null, error: NATIVE_ASSET_NOT_ERC20 };
  if (lower(binding.token) !== lower(usdc.address) || binding.decimals !== usdc.decimals) return { request: null, error: "profile_asset_not_revoke_evidence" };
  const sp = revokeSpender(spender);
  if (!sp) return { request: null, error: "spender_not_allowlisted" };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: REVOKE_ACTION,
    asset: binding.asset,
    amount: "0",
    chain: binding.chain,
    destination: sp.address,
  };
  return {
    request: Object.freeze({
      ...fields,
      destinationRequired: true,
      amountDisplay: `${formatUnits(0n, binding.decimals)} ${binding.asset}`,
      principalMoves: false,
      nonce: permissionNonce({ ...fields, at: typeof eventId === "string" && eventId ? eventId : "UNKNOWN_EVENT" }),
      permission: null,
      createsPermission: false,
    }),
    error: null,
  };
}

/** Could this step run for this Piggy? Always { allowed: false }. First refusal from the existing boundaries, then "revoke_lane_not_wired". */
export function revokeExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  // [live-gate-form] fork-only gate: `!== false` lets exactly false through (to the local_fork executor check below); true / undefined / "true" / 1 refuse. Not the live gate.
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== REVOKE_JOB_ID) return refuse("profile_not_revoke_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (REVOKE_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${REVOKE_UNKNOWN_FIELDS[0]}`);
  return refuse("revoke_lane_not_wired");
}

/** Readiness of a revoke errand. Never READY / executable / live / permitted, whatever the input claims. */
export function revokeReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of REVOKE_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of REVOKE_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = revokeExecutionGate({ profile: profile ?? null, piggy, executor, step: "revoke" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "revoke_lane_not_wired", "fork_review_conditions_open");
  const known = typeof stage === "string" && Object.values(REVOKE_STAGE).includes(stage) ? stage : REVOKE_STAGE.UNKNOWN;
  return Object.freeze({
    jobId: REVOKE_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    principalMoves: false,
    evidenceClass: REVOKE_FORK_EVIDENCE.label,
    spenders: REVOKE_SPENDER_IDS,
    provenSteps: Object.freeze(Object.keys(REVOKE_STEPS).filter((k) => REVOKE_STEPS[k].proof === REVOKE_PROOF.PROVEN_FORK)),
    unprovenSteps: REVOKE_UNPROVEN_STEPS,
    unknownFields: REVOKE_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}

// ── [fork-link] live-readiness checks (job-executor review conditions) ──────────────────────────────────────────────────────────────
// encodeRevokeStep() above stays the fork DESCRIPTION and still takes the Piggy from its args. A future live lane must build a step
// ONLY through revokeLiveStep() below:
//   (a) the Piggy in the args == the record binding's Piggy == the signer; receiver / owner / user are then always that one address
//       (taken from the binding, never from the args alone);
//   (b) not applicable: a revoke moves no principal and has no output (amount "0").
// Nothing here is wired and nothing reads a network. The gate still refuses.
const liveRefuse = (error) => ({ call: null, error });
function liveIdentityProblem(piggyAddress, binding, signerAddress) {
  if (!binding || typeof binding !== "object" || !ADDR.test(binding.piggyAddress || "")) return "binding_missing";
  if (typeof signerAddress !== "string" || !ADDR.test(signerAddress)) return "signer_missing";
  if (typeof piggyAddress !== "string" || !ADDR.test(piggyAddress)) return "missing_piggy_address";
  if (lower(binding.piggyAddress) !== lower(piggyAddress) || lower(signerAddress) !== lower(piggyAddress)) return "piggy_binding_signer_mismatch";
  return null;
}

/**
 * One step for a live lane, after the job-executor live-readiness check (a). input = { piggyAddress, binding, signerAddress, spender, token,
 * amountRaw, allowanceRaw }.
 * @returns {{call: object|null, error: string|null}}
 */
export function revokeLiveStep(step, input) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = liveIdentityProblem(i.piggyAddress, i.binding, i.signerAddress);
  if (id) return liveRefuse(id);
  if (erc20TokenOfBinding(i.binding).error === NATIVE_ASSET_NOT_ERC20) return liveRefuse(NATIVE_ASSET_NOT_ERC20); // native MON has no allowance to revoke
  if (lower(i.binding.token) !== lower(REVOKE_FORK_EVIDENCE.token.address)) return liveRefuse("binding_asset_not_revoke_evidence");
  return encodeRevokeStep(step, { spender: i.spender, token: i.token, amountRaw: i.amountRaw, piggyAddress: i.binding.piggyAddress, allowanceRaw: i.allowanceRaw });
}
