// Mainnet Job — Euler Earn "K3 Capital Earn WETH" vault (WETH in, k3WETH shares; exit back to WETH). Local model of what is PROVEN on
// one mainnet fork run, nothing more. Same lane shape as the other mainnet Job modules.
//
// Evidence: one mainnet fork run, chain 143, block 110746900 (2026-10-05T12:01:37Z), anvil fork, fixture actor, 1 WETH:
//   approve(exact 1 WETH → vault) → deposit(1e18, receiver) → redeem(all shares, receiver, owner). 3 tx on the lane path, 0 reverted,
//   no time warp. Evidence class PASS_FORK_SIM — a fork run is never product readiness, permission, a rate or a mainnet transaction.
//
//   PROVEN on the fork (success):  approve(exact) · deposit (ERC-4626, 1 WETH) · redeem (all measured shares, receiver = owner)
//   NOT PROVEN for this lane:  withdraw(assets) · a partial redeem · any amount above 1 WETH · an EVC-batched path · Permit2 ·
//                              allowance revoke (the exact approve was spent by the deposit; no revoke tx was run) · another block
//
// Shares are not WETH (0.991583922407801588 k3WETH for 1 WETH at the pin). Nothing here converts WETH to shares or shares to WETH.
// ERC-4626 deposit / redeem carry no minimum-out argument, so the calldata itself has no slippage bound: that field stays UNKNOWN.
//
// Fork review — 9 conditions, ALL OPEN (never closed here):
//   [ ] 1 separate Owner-GO live-tx card (amount chosen by the Owner; 1 WETH is a fork vector, not a cap)
//   [ ] 2 grounded MON/USD at the same cutoff for the round-trip gas
//   [ ] 3 live-head re-read of vault identity / asset / queues / fee / lostAssets / timelock vs the pin (stop on drift)
//   [ ] 4 Euler Earn curator / allocator / guardian powers review (queue changes, caps, timelock 86400 s at the pin)
//   [ ] 5 strategy vault (EVK eWETH-3, sole supply + withdraw queue entry) liquidity at a larger size — not measured
//   [ ] 6 WETH acquisition path for a tester (bridged token, no wrap path on this chain)
//   [ ] 7 no minimum-out in deposit / redeem: a preview-and-compare guard design is still open
//   [ ] 8 money-executor design and guard review
//   [ ] 9 product copy (OPEN)
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no storage key and reads no
// network. eulerExecutionGate() runs the existing boundaries and then refuses anyway, because no Euler lane is wired to the one send
// chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { NATIVE_ASSET_NOT_ERC20, bindRecordToProfile, chainMatchesExecutor, erc20TokenOfBinding, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const EULER_JOB_ID = "euler-k3-weth";
export const EULER_ACTION = "earn_vault_weth_roundtrip";

export const EULER_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// Copied from the fork run record, not derived.
export const EULER_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 110746900,
  blockTimestamp: "2026-10-05T12:01:37Z",
  timeWarp: false,
  vault: "0x2C803c8C3C57b9D4A9abA011615561315c2b6aC1",
  vaultName: "K3 Capital Earn WETH",
  shareSymbol: "k3WETH",
  asset: Object.freeze({ symbol: "WETH", address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", decimals: 18 }),
  evc: "0x7a9324E8f270413fa2E458f5831226d99C7477CD",
  strategyVault: "0x502e4a0B61dEBA3015Eb9E51116B832003B22c2C",
  approvalExact: true,
  sentRaw: "1000000000000000000",
  measured: Object.freeze({
    previewSharesRaw: "991583922407801588", // previewDeposit(1e18) at the pin
    realizedSharesRaw: "991583922407801588", // what deposit credited (read as a balance)
    maxRedeemRaw: "991583922407801587", // maxRedeem read after the deposit (1 below the held shares; redeem of all shares still succeeded)
    previewRedeemRaw: "999999999999999999",
    returnedRaw: "999999999999999999",
    deltaRaw: "-1",
    feeAtPin: "0",
    lostAssetsAtPin: "0",
    timelockSecondsAtPin: "86400",
  }),
  gasUsed: Object.freeze({ approve: 51207, deposit: 347279, redeem: 290832 }),
  txCountLanePath: 3,
  reverted: 0,
  unknown: Object.freeze([
    "slippage_guard", "amount_above_fork_size", "strategy_liquidity_at_size", "live_head_drift", "curator_powers", "weth_acquisition",
    "gas_fee_usd", "freshness_window",
  ]),
});

// The size run end to end, and the share position the exit was run from.
export const EULER_FORK_SIZE_RAW = EULER_FORK_EVIDENCE.sentRaw;
export const EULER_FORK_POSITION_RAW = EULER_FORK_EVIDENCE.measured.realizedSharesRaw;

export const EULER_FIELDS = Object.freeze({
  vault: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, value: EULER_FORK_EVIDENCE.vault }),
  asset: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, value: EULER_FORK_EVIDENCE.asset.address }),
  spender: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, value: EULER_FORK_EVIDENCE.vault }),
  exitAsset: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, value: EULER_FORK_EVIDENCE.asset.address }),
  slippageGuard: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
  strategyLiquidityAtSize: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
  curatorPowers: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
  liveHeadDrift: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
  wethAcquisition: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: EULER_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const EULER_UNKNOWN_FIELDS = Object.freeze(Object.keys(EULER_FIELDS).filter((k) => EULER_FIELDS[k].proof !== EULER_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function eulerField(name) {
  if (typeof name !== "string" || !has(EULER_FIELDS, name)) return "UNKNOWN";
  const f = EULER_FIELDS[name];
  return f.proof === EULER_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully. Return values are never decoded here: shares credited and WETH back are read as
// balances, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [] },
]);

export const EULER_STAGE = Object.freeze({
  NONE: "none",
  APPROVED: "approved_exact",
  IN_VAULT: "holding_shares",
  OUT: "exited",
  UNKNOWN: "unknown",
});

export const EULER_STEPS = Object.freeze({
  approve: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "asset", from: EULER_STAGE.NONE, to: EULER_STAGE.APPROVED, forkStatus: "success", gasUsed: 51207 }),
  deposit: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, signature: "deposit(uint256,address)", selector: "0x6e553f65", target: "vault", from: EULER_STAGE.APPROVED, to: EULER_STAGE.IN_VAULT, forkStatus: "success", gasUsed: 347279 }),
  redeem: Object.freeze({ proof: EULER_PROOF.PROVEN_FORK, signature: "redeem(uint256,address,address)", selector: "0xba087652", target: "vault", from: EULER_STAGE.IN_VAULT, to: EULER_STAGE.OUT, forkStatus: "success", gasUsed: 290832, amount: "all_of_measured_shares" }),
  // Not run on this lane path: different claims, unproven.
  withdraw: Object.freeze({ proof: EULER_PROOF.UNPROVEN, signature: "withdraw(uint256,address,address)", selector: "0xb460af94", target: "vault", from: null, to: null, forkStatus: "never_observed" }),
  revoke: Object.freeze({ proof: EULER_PROOF.UNPROVEN, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "asset", from: null, to: null, forkStatus: "never_observed" }),
  depositAboveForkSize: Object.freeze({ proof: EULER_PROOF.UNPROVEN, signature: "deposit(uint256,address)", selector: "0x6e553f65", target: "vault", from: null, to: null, forkStatus: "never_observed" }),
});

export const EULER_UNPROVEN_STEPS = Object.freeze(Object.keys(EULER_STEPS).filter((k) => EULER_STEPS[k].proof !== EULER_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(EULER_STEPS, step)) return "unknown_step";
  if (EULER_STEPS[step].proof !== EULER_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/** The stage after one step, only along fork-proven transitions. */
export function eulerStageAfter(stage, step) {
  if (!Object.values(EULER_STAGE).includes(stage) || stage === EULER_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = EULER_STEPS[step];
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
const exactAmount = (v) => exactWithin(v, EULER_FORK_SIZE_RAW, "amount_not_exact", "amount_above_fork_proven_size");
const exactShares = (v) => exactWithin(v, EULER_FORK_POSITION_RAW, "shares_not_measured", "shares_above_fork_proven_position");

// A caller may name the token / spender / vault it expects; any name other than the fork-proven address is refused (never re-aimed).
function pinnedTargetProblem(a) {
  const want = { token: EULER_FORK_EVIDENCE.asset.address, spender: EULER_FORK_EVIDENCE.vault, vault: EULER_FORK_EVIDENCE.vault };
  for (const k of Object.keys(want)) {
    if (a[k] === undefined) continue;
    if (typeof a[k] !== "string" || !ADDR.test(a[k]) || lower(a[k]) !== lower(want[k])) return `${k}_not_fork_proven`;
  }
  return null;
}

/**
 * Calldata for ONE fork-proven step. Every argument is explicit: the approve is exactly the amount (never unlimited) to the vault;
 * deposit credits the Piggy; redeem burns a MEASURED share amount (at most the fork position) with receiver = owner = the Piggy.
 * Expected shares / WETH out stay UNKNOWN. A description of a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeEulerStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? { amountRaw: args.amountRaw, piggyAddress: args.piggyAddress, heldSharesRaw: args.heldSharesRaw, token: args.token, spender: args.spender, vault: args.vault }
    : {};
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  const pinned = pinnedTargetProblem(a);
  if (pinned) return { call: null, error: pinned };
  const vault = EULER_FORK_EVIDENCE.vault;
  const weth = EULER_FORK_EVIDENCE.asset.address;
  if (step === "redeem") {
    const held = exactShares(a.heldSharesRaw);
    if (held.error) return { call: null, error: held.error };
    return {
      call: Object.freeze({
        step, to: vault, value: "0", sharesRaw: held.amount.toString(), receiver: a.piggyAddress, owner: a.piggyAddress, expectedWethRaw: "UNKNOWN",
        data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "redeem", args: [held.amount, a.piggyAddress, a.piggyAddress] }),
      }),
      error: null,
    };
  }
  const { amount, error } = exactAmount(a.amountRaw);
  if (error) return { call: null, error };
  if (step === "approve") {
    return { call: Object.freeze({ step, to: weth, value: "0", spender: vault, amountRaw: amount.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [vault, amount] }) }), error: null };
  }
  // deposit
  return {
    call: Object.freeze({
      step, to: vault, value: "0", amountRaw: amount.toString(), receiver: a.piggyAddress, expectedSharesRaw: "UNKNOWN",
      data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "deposit", args: [amount, a.piggyAddress] }),
    }),
    error: null,
  };
}

/**
 * The exact request a permission envelope for the Euler entry would have to match. Issues nothing (permission null). Only the shared-fork
 * profile carries WETH in its asset table; the 143 profile binds USDC only, so a WETH request there is refused at the binding
 * ("asset_not_in_profile"), and the fork profile is refused by the evidence chain check before it. A binding is never a permission.
 */
export function eulerPermissionRequest(input) {
  const { profile, piggy, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, EULER_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_euler_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: EULER_FORK_EVIDENCE.asset.symbol });
  if (error) return { request: null, error };
  const weth = EULER_FORK_EVIDENCE.asset;
  if (erc20TokenOfBinding(binding).error === NATIVE_ASSET_NOT_ERC20) return { request: null, error: NATIVE_ASSET_NOT_ERC20 };
  if (lower(binding.token) !== lower(weth.address) || binding.decimals !== weth.decimals) return { request: null, error: "profile_asset_not_euler_evidence" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: EULER_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: EULER_FORK_EVIDENCE.vault,
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

/** Could this step run for this Piggy? Always { allowed: false }. First refusal from the existing boundaries, then "euler_lane_not_wired". */
export function eulerExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  // [live-gate-form] fork-only gate: `!== false` lets exactly false through (to the local_fork executor check below); true / undefined / "true" / 1 refuse. Not the live gate.
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== EULER_JOB_ID) return refuse("profile_not_euler_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: EULER_FORK_EVIDENCE.asset.symbol });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (EULER_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${EULER_UNKNOWN_FIELDS[0]}`);
  return refuse("euler_lane_not_wired");
}

/** Readiness of an Euler errand. Never READY / executable / live / permitted, whatever the input claims. */
export function eulerReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of EULER_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of EULER_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = eulerExecutionGate({ profile: profile ?? null, piggy, executor, step: "approve" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "euler_lane_not_wired", "fork_review_conditions_open");
  const known = typeof stage === "string" && Object.values(EULER_STAGE).includes(stage) ? stage : (stage === undefined ? EULER_STAGE.NONE : EULER_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: EULER_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    sharesAssumedEqualToWeth: false,
    evidenceClass: EULER_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(EULER_STEPS).filter((k) => EULER_STEPS[k].proof === EULER_PROOF.PROVEN_FORK)),
    unprovenSteps: EULER_UNPROVEN_STEPS,
    unknownFields: EULER_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}

// ── [fork-link] live-readiness checks (job-executor review conditions) ──────────────────────────────────────────────────────────────
// encodeEulerStep() above stays the fork DESCRIPTION and still takes the Piggy from its args. A future live lane must build a step
// ONLY through eulerLiveStep() below:
//   (a) the Piggy in the args == the record binding's Piggy == the signer; receiver / owner / user are then always that one address
//       (taken from the binding, never from the args alone);
//   (b) deposit / redeem: a min-out floor against a fresh measured preview for exactly this amount (ERC-4626 has no on-chain minimum,
//       so the lane must also run eulerOutMeetsFloor() on the realized delta after the send);
//   (d) redeem: held shares and maxRedeem re-read at the live head (same block); held may exceed maxRedeem by at most the measured
//       rounding gap (EULER_MAX_REDEEM_GAP_RAW, the fork run: maxRedeem 1 below held, redeem-all succeeded), else refused.
// Nothing here is wired and nothing reads a network: reads are injected, each with its block and read time. The gate still refuses.
export const EULER_LIVE_LIMITS = Object.freeze({ maxReadAgeMs: 30000, maxSlippageBps: 100 });

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
  const L = EULER_LIVE_LIMITS;
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
  if (min * 10000n < preview * BigInt(10000 - EULER_LIVE_LIMITS.maxSlippageBps)) return "min_out_too_loose";
  return null;
}
const withFloor = (out, minOutRaw, outAsset, previewBlock) => (out.error ? out : { call: Object.freeze({ ...out.call, minOutRaw, minOutAsset: outAsset, previewBlock, postCheck: "eulerOutMeetsFloor" }), error: null });

/** After a send: did the realized balance delta (measured before / after, gas excluded by the caller) reach the floor? */
export function eulerOutMeetsFloor({ minOutRaw, beforeRaw, afterRaw } = {}) {
  if (!isDigits(minOutRaw) || !isDigits(beforeRaw) || !isDigits(afterRaw)) return { ok: false, deltaRaw: null, reason: "balances_not_measured" };
  const delta = BigInt(afterRaw) - BigInt(beforeRaw);
  return delta >= BigInt(minOutRaw) ? { ok: true, deltaRaw: delta.toString(), reason: null } : { ok: false, deltaRaw: delta.toString(), reason: "realized_below_min_out" };
}

export const EULER_MAX_REDEEM_GAP_RAW = "1";

/**
 * One step for a live lane, after the job-executor live-readiness checks. input = { piggyAddress, binding, signerAddress, amountRaw,
 * minSharesRaw (deposit), minAssetsRaw (redeem), reads: { previewDeposit, previewRedeem, heldShares, maxRedeem }, nowMs }.
 * @returns {{call: object|null, error: string|null}}
 */
export function eulerLiveStep(step, input) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = liveIdentityProblem(i.piggyAddress, i.binding, i.signerAddress);
  if (id) return liveRefuse(id);
  if (erc20TokenOfBinding(i.binding).error === NATIVE_ASSET_NOT_ERC20) return liveRefuse(NATIVE_ASSET_NOT_ERC20); // native MON never takes the WETH approve path
  if (lower(i.binding.token) !== lower(EULER_FORK_EVIDENCE.asset.address)) return liveRefuse("binding_asset_not_euler_evidence");
  const piggy = i.binding.piggyAddress;
  const reads = i.reads && typeof i.reads === "object" ? i.reads : {};
  if (step === "deposit") {
    const pv = freshRead(reads.previewDeposit, i.nowMs, "preview_deposit");
    if (pv.error) return liveRefuse(pv.error);
    if (reads.previewDeposit.forRaw !== i.amountRaw) return liveRefuse("preview_not_for_this_amount");
    const f = floorProblem(i.minSharesRaw, pv.value);
    if (f) return liveRefuse(f);
    return withFloor(encodeEulerStep("deposit", { amountRaw: i.amountRaw, piggyAddress: piggy }), i.minSharesRaw, EULER_FORK_EVIDENCE.shareSymbol, pv.block);
  }
  if (step === "redeem") {
    const held = freshRead(reads.heldShares, i.nowMs, "held_shares");
    if (held.error) return liveRefuse(held.error);
    const max = freshRead(reads.maxRedeem, i.nowMs, "max_redeem");
    if (max.error) return liveRefuse(max.error);
    if (held.block !== max.block) return liveRefuse("reads_not_same_block");
    if (held.value > max.value && held.value - max.value > BigInt(EULER_MAX_REDEEM_GAP_RAW)) return liveRefuse("max_redeem_below_held");
    const pv = freshRead(reads.previewRedeem, i.nowMs, "preview_redeem");
    if (pv.error) return liveRefuse(pv.error);
    if (reads.previewRedeem.forRaw !== held.value.toString()) return liveRefuse("preview_not_for_this_amount");
    const f = floorProblem(i.minAssetsRaw, pv.value);
    if (f) return liveRefuse(f);
    return withFloor(encodeEulerStep("redeem", { heldSharesRaw: held.value.toString(), piggyAddress: piggy }), i.minAssetsRaw, EULER_FORK_EVIDENCE.asset.symbol, pv.block);
  }
  return encodeEulerStep(step, { amountRaw: i.amountRaw, piggyAddress: piggy });
}
