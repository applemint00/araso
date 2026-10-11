// Mainnet Job — FastLane shMON (native MON in through deposit, whole share position redeemed back to MON). Local model of
// what is PROVEN on one mainnet fork run, nothing more. Same lane shape as the other mainnet Job modules.
//
// Evidence: one mainnet fork run, chain 143, block 110746900 (2026-10-05T12:01:37Z), anvil fork, impersonated fixture actor,
// 1 MON, no time warp:  deposit(1 MON, receiver = Piggy) payable with value = 1 MON → redeem(all shares, Piggy, Piggy) next block
//   → probe: redeem more than held reverts (custom error 0xb94abeec, ERC4626ExceededMaxRedeem). Evidence class PASS_FORK_SIM —
//   a fork run is never product readiness, permission, a rate or a mainnet transaction.
//
//   PROVEN on the fork (success):  deposit (payable, assets == msg.value, receiver = the Piggy) · redeem of the whole measured share
//                                  position to the Piggy (owner = receiver = the Piggy), next block
//   NOT PROVEN for this lane:  a partial redeem · withdraw-by-assets · mint · any amount above 1 MON as the lane size (0.1 and 10 MON
//                              ran a round trip only) · behaviour at another block · the cause of the exit-leg loss · pause / admin
//
// Shares are not MON. At the pin 1 MON minted 613133273679279212 raw shares, and the round trip returned 991382447278540197 wei
// (gas excluded): a loss of 8617552721459803 wei = 0.8617 %, almost all of it on the exit leg (previewRedeem below convertToAssets).
// The same measurement at an earlier block was 0.9527 %. The loss is MEASURED for one block, never a rate, and its cause (fee vs
// buffer) is UNKNOWN. ERC-4626 redeem takes no minimum out: nothing on chain bounds what comes back. Nothing here converts MON to
// shares or shares to MON; expected shares and expected MON back stay UNKNOWN.
//
// No ERC-20 approve is used (native entry via msg.value; redeem burns the Piggy's own shares). Only the shared-fork profile binds native
// MON (its asset table; token null, native true); the 143 profile's record binding is USDC-only, so a native-MON errand cannot be bound
// there: the permission request and the gate refuse at that boundary. A fork binding is never a permission.
//
// Fork review — 9 conditions, ALL OPEN (never closed here):
//   [ ] 1 separate Owner-GO live-tx card (amount chosen by the Owner; 1 MON is a fork vector, not a cap)
//   [ ] 2 grounded MON/USD at the same cutoff for the principal and the ≈0.0193 MON round-trip gas
//   [ ] 3 live-head re-read of vault identity / code hash / asset() sentinel / previewDeposit / previewRedeem / maxRedeem vs the pin
//   [ ] 4 cause of the exit-leg loss (previewRedeem ≈0.85 % below convertToAssets): fee vs buffer, from source, not from the ABI
//   [ ] 5 ShMonad admin / upgrade / pause powers review, incl. a paused or capped redeem
//   [ ] 6 native-MON record binding on the 143 profile (only the fork profile binds native MON; 143 is USDC-only)
//   [ ] 7 no on-chain minimum on redeem: a product bound on the returned MON (measured preview) before any send
//   [ ] 8 money-executor design and guard review
//   [ ] 9 product copy and lineage (OPEN; the same action as the first journey's MON step)
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no storage key and reads no
// network. shmonExecutionGate() runs the existing boundaries and then refuses anyway, because no shMON lane is wired to the one send
// chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { bindRecordToProfile, chainMatchesExecutor, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const SHMON_JOB_ID = "fastlane-shmon";
export const SHMON_ACTION = "shmon_deposit_redeem_roundtrip";

export const SHMON_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// Copied from the fork run record, not derived.
export const SHMON_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 110746900,
  blockHash: "0xdc08e3a1ce3d73a0d907ad7fca87a1faf733a307dbe8fa7859e09438aed026dd",
  blockTimestamp: "2026-10-05T12:01:37Z",
  timeWarp: false,
  // The vault contract is also the share token (18 decimals); asset() reads the native sentinel.
  vault: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
  vaultCodeBytes: 793,
  vaultCodeKeccak: "0x0e405f8ff7f1fb273d85ad25d643008f8b9fae93b140a7dd213f0795072b7040",
  share: Object.freeze({ symbol: "shMON", address: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c", decimals: 18 }),
  assetSentinel: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  entryAsset: Object.freeze({ symbol: "MON", decimals: 18, native: true }),
  approvalsUsed: 0,
  sentWei: "1000000000000000000",
  measured: Object.freeze({
    previewDepositRaw: "613133273679279212", // previewDeposit(1 MON) at the pin
    convertToSharesRaw: "613175754117953530",
    sharesAfterEntryRaw: "613133273679279212", // what deposit credited (preview − realized = 0 on this run)
    maxRedeemRaw: "613133273679279212", // == the whole position
    previewRedeemAllWei: "991382446047840318",
    convertToAssetsAllWei: "999930721857335579",
    returnedWeiExGas: "991382447278540197",
    haircutWei: "8617552721459803",
    haircutBpsX100: 8617, // 0.8617 %
    exitGapConvertVsPreviewWei: "8548275809495261",
    priorBlock: Object.freeze({ block: 108999816, sharesAfterEntryRaw: "614361488083760786", returnedWeiExGas: "990472836026416174", haircutBpsX100: 9527 }),
  }),
  sharesAfterExitRaw: "0",
  gasUsed: Object.freeze({ deposit: 93095, redeem: 99752 }),
  revertProbe: Object.freeze({ step: "redeem more than held", selector: "0xb94abeec", name: "ERC4626ExceededMaxRedeem" }),
  exitSemantics: "immediate_next_block_no_time_warp",
  unknown: Object.freeze([
    "exit_loss_cause", "current_exchange_rate", "live_head_drift", "admin_pause_powers", "redeem_min_out", "native_mon_binding",
    "amount_above_fork_size", "partial_redeem", "gas_fee_usd", "mon_usd", "freshness_window",
  ]),
});

// The size run end to end as the lane scenario. 0.1 and 10 MON were also run (round trip only, same loss %): not a lane size.
export const SHMON_FORK_SIZE_WEI = SHMON_FORK_EVIDENCE.sentWei;
// The share position the redeem was run from.
export const SHMON_FORK_SHARES_RAW = SHMON_FORK_EVIDENCE.measured.sharesAfterEntryRaw;

export const SHMON_FIELDS = Object.freeze({
  vault: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, value: SHMON_FORK_EVIDENCE.vault }),
  shareToken: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, value: SHMON_FORK_EVIDENCE.share.address }),
  entryAsset: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, value: "MON (native, msg.value)" }),
  exitAsset: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, value: "MON (native)" }),
  exitTiming: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, value: "next block on the fork, no time warp" }),
  exitLossCause: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  currentExchangeRate: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  redeemMinOut: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  liveHeadDrift: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  adminPowers: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  nativeMonBinding: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  monUsd: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const SHMON_UNKNOWN_FIELDS = Object.freeze(Object.keys(SHMON_FIELDS).filter((k) => SHMON_FIELDS[k].proof !== SHMON_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function shmonField(name) {
  if (typeof name !== "string" || !has(SHMON_FIELDS, name)) return "UNKNOWN";
  const f = SHMON_FIELDS[name];
  return f.proof === SHMON_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully, in the exact ABI forms the fork used (payable deposit(assets, receiver);
// ERC-4626 redeem(shares, receiver, owner)). Return values are never decoded here: shares credited and MON back are read as
// balances, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [] },
]);

export const SHMON_STAGE = Object.freeze({
  NONE: "none",
  HOLDING: "holding_shares",
  REDEEMED: "redeemed",
  UNKNOWN: "unknown",
});

export const SHMON_STEPS = Object.freeze({
  deposit: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, signature: "deposit(uint256,address)", selector: "0x6e553f65", payable: true, target: "vault", from: SHMON_STAGE.NONE, to: SHMON_STAGE.HOLDING, forkStatus: "success", gasUsed: 93095 }),
  redeem: Object.freeze({ proof: SHMON_PROOF.PROVEN_FORK, signature: "redeem(uint256,address,address)", selector: "0xba087652", payable: false, target: "vault", from: SHMON_STAGE.HOLDING, to: SHMON_STAGE.REDEEMED, forkStatus: "success", gasUsed: 99752, amount: "whole_measured_position" }),
  // Not run on this lane path: different claims, unproven.
  redeemPartial: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, signature: "redeem(uint256,address,address)", selector: "0xba087652", payable: false, target: "vault", from: null, to: null, forkStatus: "never_observed" }),
  withdraw: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, signature: "withdraw(uint256,address,address)", selector: "0xb460af94", payable: false, target: "vault", from: null, to: null, forkStatus: "never_observed" }),
  mint: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, signature: "mint(uint256,address)", selector: "0x94bf804d", payable: true, target: "vault", from: null, to: null, forkStatus: "never_observed" }),
  redeemAboveHeld: Object.freeze({ proof: SHMON_PROOF.UNPROVEN, signature: "redeem(uint256,address,address)", selector: "0xba087652", payable: false, target: "vault", from: null, to: null, forkStatus: "reverted", revertData: "0xb94abeec" }),
});

export const SHMON_UNPROVEN_STEPS = Object.freeze(Object.keys(SHMON_STEPS).filter((k) => SHMON_STEPS[k].proof !== SHMON_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(SHMON_STEPS, step)) return "unknown_step";
  if (SHMON_STEPS[step].proof !== SHMON_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/** The stage after one step, only along fork-proven transitions. */
export function shmonStageAfter(stage, step) {
  if (!Object.values(SHMON_STAGE).includes(stage) || stage === SHMON_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = SHMON_STEPS[step];
  if (stage !== s.from) return { stage: null, error: "step_not_valid_from_stage" };
  return { stage: s.to, error: null };
}

function snapshotPiggy(piggy) {
  if (!piggy || typeof piggy !== "object") return {};
  const id = piggy.id;
  const address = piggy.address;
  return { id: typeof id === "string" ? id : undefined, address: typeof address === "string" ? address : undefined };
}

function exactWithin(v, limit, notExact, above) {
  if (!isDigits(v) || BigInt(v) === 0n) return { amount: null, error: notExact };
  if (BigInt(v) > BigInt(limit)) return { amount: null, error: above };
  return { amount: BigInt(v), error: null };
}
const exactAmount = (v) => exactWithin(v, SHMON_FORK_SIZE_WEI, "amount_not_exact", "amount_above_fork_proven_size");
const exactShares = (v) => exactWithin(v, SHMON_FORK_SHARES_RAW, "held_shares_not_measured", "shares_above_fork_proven_position");

/**
 * Calldata for ONE fork-proven step, built from the recorded vault only. Every argument is explicit: the deposit sends exactly the
 * amount as msg.value AND as the assets argument (never different), crediting the Piggy; the redeem burns the Piggy's whole MEASURED
 * share position (a caller's balanceOf read), with the Piggy as receiver and owner. A vault given by the caller must be the recorded
 * one. Expected shares / MON back stay UNKNOWN. A description of a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeShmonStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? { amountWei: args.amountWei, valueWei: args.valueWei, piggyAddress: args.piggyAddress, heldSharesRaw: args.heldSharesRaw, sharesRaw: args.sharesRaw, vault: args.vault }
    : {};
  const vault = SHMON_FORK_EVIDENCE.vault;
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  if (a.vault !== undefined && lower(a.vault) !== lower(vault)) return { call: null, error: "vault_not_fork_evidence" };
  if (step === "redeem") {
    const held = exactShares(a.heldSharesRaw);
    if (held.error) return { call: null, error: held.error };
    if (a.sharesRaw !== undefined && (!isDigits(a.sharesRaw) || BigInt(a.sharesRaw) !== held.amount)) return { call: null, error: "unproven_step:redeemPartial" };
    return {
      call: Object.freeze({
        step, to: vault, value: "0", sharesRaw: held.amount.toString(), receiver: a.piggyAddress, owner: a.piggyAddress, expectedMonWei: "UNKNOWN", minOutWei: "UNKNOWN",
        data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "redeem", args: [held.amount, a.piggyAddress, a.piggyAddress] }),
      }),
      error: null,
    };
  }
  // deposit — native MON; value must equal assets
  const { amount, error } = exactAmount(a.amountWei);
  if (error) return { call: null, error };
  if (a.valueWei !== undefined && (!isDigits(a.valueWei) || BigInt(a.valueWei) !== amount)) return { call: null, error: "value_not_equal_assets" };
  return {
    call: Object.freeze({
      step, to: vault, value: amount.toString(), amountWei: amount.toString(), receiver: a.piggyAddress, expectedSharesRaw: "UNKNOWN",
      data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "deposit", args: [amount, a.piggyAddress] }),
    }),
    error: null,
  };
}

/**
 * The exact request a permission envelope for the shMON entry would have to match. Issues nothing (permission null). The binding
 * comes from chain-profile.js: the 143 profile binds USDC only, so a MON errand is refused there ("asset_not_in_profile"); the fork
 * profile binds native MON but is refused by the evidence chain check first. A binding that is not native 18-decimal MON is refused.
 */
export function shmonPermissionRequest(input) {
  const { profile, piggy, amountWei, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, SHMON_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_shmon_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: SHMON_FORK_EVIDENCE.entryAsset.symbol });
  if (error) return { request: null, error };
  if (binding.asset !== SHMON_FORK_EVIDENCE.entryAsset.symbol || binding.decimals !== SHMON_FORK_EVIDENCE.entryAsset.decimals || binding.native !== true) return { request: null, error: "profile_asset_not_shmon_evidence" };
  const exact = exactAmount(amountWei);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: SHMON_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: SHMON_FORK_EVIDENCE.vault,
  };
  return {
    request: Object.freeze({
      ...fields,
      destinationRequired: true,
      amountDisplay: `${formatUnits(exact.amount, binding.decimals)} ${binding.asset}`,
      expectedSharesRaw: "UNKNOWN",
      nonce: permissionNonce({ ...fields, at: typeof eventId === "string" && eventId ? eventId : "UNKNOWN_EVENT" }),
      permission: null,
      createsPermission: false,
    }),
    error: null,
  };
}

/** Could this step run for this Piggy? Always { allowed: false }. First refusal from the existing boundaries, then "shmon_lane_not_wired". */
export function shmonExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  // [live-gate-form] fork-only gate: `!== false` lets exactly false through (to the local_fork executor check below); true / undefined / "true" / 1 refuse. Not the live gate.
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== SHMON_JOB_ID) return refuse("profile_not_shmon_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: SHMON_FORK_EVIDENCE.entryAsset.symbol });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (SHMON_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${SHMON_UNKNOWN_FIELDS[0]}`);
  return refuse("shmon_lane_not_wired");
}

/** Readiness of a shMON errand. Never READY / executable / live / permitted, whatever the input claims. */
export function shmonReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of SHMON_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of SHMON_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = shmonExecutionGate({ profile: profile ?? null, piggy, executor, step: "deposit" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "shmon_lane_not_wired", "fork_review_conditions_open");
  const known = typeof stage === "string" && Object.values(SHMON_STAGE).includes(stage) ? stage : (stage === undefined ? SHMON_STAGE.NONE : SHMON_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: SHMON_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    sharesAssumedEqualToMon: false,
    evidenceClass: SHMON_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(SHMON_STEPS).filter((k) => SHMON_STEPS[k].proof === SHMON_PROOF.PROVEN_FORK)),
    unprovenSteps: SHMON_UNPROVEN_STEPS,
    unknownFields: SHMON_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}

// ── [fork-link] live-readiness checks (job-executor review conditions) ──────────────────────────────────────────────────────────────
// encodeShmonStep() above stays the fork DESCRIPTION and still takes the Piggy from its args. A future live lane must build a step
// ONLY through shmonLiveStep() below:
//   (a) the Piggy in the args == the record binding's Piggy == the signer; receiver / owner / user are then always that one address
//       (taken from the binding, never from the args alone);
//   (b) redeem: a min-out floor (MON back) against a fresh previewRedeem for exactly the held shares (no on-chain minimum, so the lane
//       must also run shmonOutMeetsFloor() after the send, with the gas paid taken out of the MON delta by the caller);
//   (c) the binding must name native MON (asset "MON", 18 decimals). chain-profile.js binds USDC only today, so no such binding can
//       be made yet: this is a judgement, not a fix (open question in the fork-link receipt).
// Nothing here is wired and nothing reads a network: reads are injected, each with its block and read time. The gate still refuses.
export const SHMON_LIVE_LIMITS = Object.freeze({ maxReadAgeMs: 30000, maxSlippageBps: 100 });

const liveRefuse = (error) => ({ call: null, error });
function liveIdentityProblem(piggyAddress, binding, signerAddress) {
  if (!binding || typeof binding !== "object" || !ADDR.test(binding.piggyAddress || "")) return "binding_missing";
  if (typeof signerAddress !== "string" || !ADDR.test(signerAddress)) return "signer_missing";
  if (typeof piggyAddress !== "string" || !ADDR.test(piggyAddress)) return "missing_piggy_address";
  if (lower(binding.piggyAddress) !== lower(piggyAddress) || lower(signerAddress) !== lower(piggyAddress)) return "piggy_binding_signer_mismatch";
  return null;
}
// One injected read: { valueRaw, block, readAt, forRaw? }. Fresh = read within maxReadAgeMs of nowMs (and not from the future).
function freshRead(r, nowMs, name) {
  const L = SHMON_LIVE_LIMITS;
  if (!r || typeof r !== "object" || !isDigits(r.valueRaw)) return { value: null, block: null, error: `${name}_not_read` };
  if (!Number.isSafeInteger(r.block) || r.block <= 0) return { value: null, block: null, error: `${name}_block_missing` };
  const at = typeof r.readAt === "string" ? Date.parse(r.readAt) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return { value: null, block: null, error: `${name}_time_missing` };
  if (nowMs - at > L.maxReadAgeMs || at - nowMs > 5000) return { value: null, block: null, error: `${name}_stale` };
  return { value: BigInt(r.valueRaw), block: r.block, error: null };
}
// The floor: present, not above the fresh preview, and not looser than maxSlippageBps under it.
function floorProblem(minOutRaw, preview) {
  if (!isDigits(minOutRaw) || BigInt(minOutRaw) === 0n) return "min_out_missing";
  const min = BigInt(minOutRaw);
  if (min > preview) return "preview_below_min_out";
  if (min * 10000n < preview * BigInt(10000 - SHMON_LIVE_LIMITS.maxSlippageBps)) return "min_out_too_loose";
  return null;
}
const withFloor = (out, minOutRaw, outAsset, previewBlock) => (out.error ? out : { call: Object.freeze({ ...out.call, minOutRaw, minOutAsset: outAsset, previewBlock, postCheck: "shmonOutMeetsFloor" }), error: null });

/** After a send: did the realized balance delta (measured before / after, gas excluded by the caller) reach the floor? */
export function shmonOutMeetsFloor({ minOutRaw, beforeRaw, afterRaw } = {}) {
  if (!isDigits(minOutRaw) || !isDigits(beforeRaw) || !isDigits(afterRaw)) return { ok: false, deltaRaw: null, reason: "balances_not_measured" };
  const delta = BigInt(afterRaw) - BigInt(beforeRaw);
  return delta >= BigInt(minOutRaw) ? { ok: true, deltaRaw: delta.toString(), reason: null } : { ok: false, deltaRaw: delta.toString(), reason: "realized_below_min_out" };
}

/**
 * One step for a live lane, after the job-executor live-readiness checks. input = { piggyAddress, binding, signerAddress, amountWei,
 * minSharesRaw (deposit), minMonWei (redeem), reads: { previewDeposit, heldShares, previewRedeem }, nowMs }.
 * @returns {{call: object|null, error: string|null}}
 */
export function shmonLiveStep(step, input) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = liveIdentityProblem(i.piggyAddress, i.binding, i.signerAddress);
  if (id) return liveRefuse(id);
  const E = SHMON_FORK_EVIDENCE.entryAsset;
  if (i.binding.asset !== E.symbol || i.binding.decimals !== E.decimals) return liveRefuse("binding_not_native_mon");
  const piggy = i.binding.piggyAddress;
  const reads = i.reads && typeof i.reads === "object" ? i.reads : {};
  if (step === "redeem") {
    const held = freshRead(reads.heldShares, i.nowMs, "held_shares");
    if (held.error) return liveRefuse(held.error);
    const pv = freshRead(reads.previewRedeem, i.nowMs, "preview_redeem");
    if (pv.error) return liveRefuse(pv.error);
    if (reads.previewRedeem.forRaw !== held.value.toString()) return liveRefuse("preview_not_for_this_amount");
    if (held.block !== pv.block) return liveRefuse("reads_not_same_block");
    const f = floorProblem(i.minMonWei, pv.value);
    if (f) return liveRefuse(f);
    return withFloor(encodeShmonStep("redeem", { heldSharesRaw: held.value.toString(), piggyAddress: piggy }), i.minMonWei, "MON", pv.block);
  }
  if (step === "deposit") {
    // native MON leaves as msg.value: a min-shares floor against a fresh previewDeposit for exactly this amount (deposit has no on-chain
    // minimum; the lane runs shmonOutMeetsFloor() on the realized share delta after the send)
    const pv = freshRead(reads.previewDeposit, i.nowMs, "preview_deposit");
    if (pv.error) return liveRefuse(pv.error);
    if (reads.previewDeposit.forRaw !== i.amountWei) return liveRefuse("preview_not_for_this_amount");
    const f = floorProblem(i.minSharesRaw, pv.value);
    if (f) return liveRefuse(f);
    return withFloor(encodeShmonStep("deposit", { amountWei: i.amountWei, valueWei: i.amountWei, piggyAddress: piggy }), i.minSharesRaw, SHMON_FORK_EVIDENCE.share.symbol, pv.block);
  }
  return encodeShmonStep(step, { amountWei: i.amountWei, valueWei: i.amountWei, piggyAddress: piggy });
}
