// Mainnet Job — Upshift earnAUSD vault (AUSD in, earnAUSD shares; exit back to AUSD). Local model of what is PROVEN on one mainnet
// fork run, nothing more. Same lane shape as the other mainnet Job modules.
//
// Evidence: one mainnet fork run, chain 143, block 110746900 (2026-10-05T12:01:37Z), anvil fork, fixture actor, 100 AUSD:
//   path 1  approve(exact 100 AUSD → vault) → deposit(AUSD, 100e6, receiver) → instantRedeem(all shares, receiver)   [no time warp]
//   path 2  approve(exact 100 AUSD → vault) → deposit(...) → approve(earnAUSD → vault, exact shares) → requestRedeem(all shares, receiver)
//           [no time warp]; a claim right after the request reverted for both the request date and request + lag.
//   Evidence class PASS_FORK_SIM_WITH_PENDING — a fork run is never product readiness, permission, a rate or a mainnet transaction.
//
//   PROVEN on the fork (success):  approve(exact) · deposit · instantRedeem (all measured shares) · approve(shares, exact) ·
//                                  requestRedeem (all measured shares) — the queued exit is proven only up to the request.
//   NOT PROVEN for this lane:  claim after the lag (succeeded only under a separate TIME WARP: not a realized return, not a step here) ·
//                              when / whether a queued request becomes claimable live (operator batching) · the claim date encoding ·
//                              allowance revoke (no revoke tx was run) · any amount above 100 AUSD · another block
//   A queued request is PENDING; everything after it is UNKNOWN (no ETA, no amount, no claim step).
//
// Shares are not AUSD (95.643316 earnAUSD for 100 AUSD at the pin). The redeem leg carries a fee on-chain field (20 at the pin; unit not
// documented) and returned 99.799999 AUSD of 100 on the fork; nothing here converts shares to AUSD. deposit / instantRedeem /
// requestRedeem carry no minimum-out argument, so the calldata itself has no slippage bound: that field stays UNKNOWN.
// Function names were recovered from on-chain selectors (not from docs); argument meaning is proven only by the fork calls succeeding.
//
// Fork review — 10 conditions, ALL OPEN (never closed here):
//   [ ] 1 separate Owner-GO live-tx card (amount chosen by the Owner; 100 AUSD is a fork vector, not a cap)
//   [ ] 2 grounded MON/USD at the same cutoff for the round-trip gas
//   [ ] 3 live-head re-read of identity / asset / share token / pause flags / fees / lag / caps vs the pin (stop on drift)
//   [ ] 4 vault proxy admin / operator powers review (upgradeable proxy, operator-processed claims, assets whitelist rules)
//   [ ] 5 redeem-fee unit and redeem liquidity at a larger size — not measured
//   [ ] 6 queued claim timing / claim date encoding / operator batching live — UNKNOWN; a queued request stays PENDING
//   [ ] 7 AUSD acquisition path and any issuer freeze / blocklist authority for a tester
//   [ ] 8 no minimum-out in deposit / redeem: a preview-and-compare guard design is still open
//   [ ] 9 money-executor design and guard review
//   [ ] 10 product copy (OPEN)
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no storage key and reads no
// network. upshiftExecutionGate() runs the existing boundaries and then refuses anyway, because no Upshift lane is wired to the one
// send chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { NATIVE_ASSET_NOT_ERC20, bindRecordToProfile, chainMatchesExecutor, erc20TokenOfBinding, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const UPSHIFT_JOB_ID = "upshift-earnausd";
export const UPSHIFT_ACTION = "earn_vault_ausd_roundtrip";

export const UPSHIFT_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// Copied from the fork run record, not derived.
export const UPSHIFT_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM_PENDING,
  chainId: 143,
  block: 110746900,
  blockTimestamp: "2026-10-05T12:01:37Z",
  timeWarp: false,
  vault: "0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA",
  vaultImplementation: "0x7a5606730b4c7f40b0f2079d873232034560e718",
  shareToken: Object.freeze({ symbol: "earnAUSD", address: "0x103222f020e98Bba0AD9809A011FDF8e6F067496", decimals: 6 }),
  asset: Object.freeze({ symbol: "AUSD", address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", decimals: 6 }),
  approvalExact: true,
  allowanceAfterDepositRaw: "0",
  sentRaw: "100000000",
  measured: Object.freeze({
    previewSharesRaw: "95643316", // previewDeposit(AUSD, 100e6) at the pin
    realizedSharesRaw: "95643316", // what deposit credited (read as a balance)
    redeemPreviewForSharesRaw: Object.freeze(["99999998", "99799999"]), // previewRedemption(shares, true) after the deposit
    returnedRaw: "99799999", // instantRedeem(all shares) → AUSD back
    deltaRaw: "-200001",
    redeemFeeFieldAtPin: "20",
    withdrawalFeeAtPin: "0",
    lagDurationSecondsAtPin: "259200",
    sharesAfterRequestRaw: "0", // requestRedeem burned the shares
    assetBackAtRequestRaw: "0", // and returned no AUSD at the request
    earlyClaimReverts: Object.freeze(["0x738aad9a", "0x085de625"]),
  }),
  gasUsed: Object.freeze({ approve: 50958, deposit: 174343, instantRedeem: 147118, approveShares: 55993, requestRedeem: 218117 }),
  txCountLanePaths: 7,
  reverted: 0,
  unknown: Object.freeze([
    "queued_claim", "slippage_guard", "redeem_fee_unit", "redeem_liquidity_at_size", "amount_above_fork_size", "live_head_drift",
    "proxy_operator_powers", "assets_whitelist_rules", "ausd_acquisition", "gas_fee_usd", "freshness_window",
  ]),
});

// The size run end to end, and the share position each exit was run from.
export const UPSHIFT_FORK_SIZE_RAW = UPSHIFT_FORK_EVIDENCE.sentRaw;
export const UPSHIFT_FORK_POSITION_RAW = UPSHIFT_FORK_EVIDENCE.measured.realizedSharesRaw;

export const UPSHIFT_FIELDS = Object.freeze({
  vault: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, value: UPSHIFT_FORK_EVIDENCE.vault }),
  asset: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, value: UPSHIFT_FORK_EVIDENCE.asset.address }),
  shareToken: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, value: UPSHIFT_FORK_EVIDENCE.shareToken.address }),
  spender: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, value: UPSHIFT_FORK_EVIDENCE.vault }),
  exitAsset: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, value: UPSHIFT_FORK_EVIDENCE.asset.address }),
  queuedClaim: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  slippageGuard: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  redeemFeeUnit: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  redeemLiquidityAtSize: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  proxyOperatorPowers: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  assetsWhitelistRules: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  liveHeadDrift: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  ausdAcquisition: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const UPSHIFT_UNKNOWN_FIELDS = Object.freeze(Object.keys(UPSHIFT_FIELDS).filter((k) => UPSHIFT_FIELDS[k].proof !== UPSHIFT_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function upshiftField(name) {
  if (typeof name !== "string" || !has(UPSHIFT_FIELDS, name)) return "UNKNOWN";
  const f = UPSHIFT_FIELDS[name];
  return f.proof === UPSHIFT_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully. Return values are never decoded here: shares credited and AUSD back are read as
// balances, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "instantRedeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "requestRedeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
]);

export const UPSHIFT_STAGE = Object.freeze({
  NONE: "none",
  APPROVED: "approved_exact",
  IN_VAULT: "holding_shares",
  SHARES_APPROVED: "shares_approved_exact",
  OUT: "exited",
  QUEUED: "redeem_requested_pending",
  UNKNOWN: "unknown",
});

export const UPSHIFT_STEPS = Object.freeze({
  approve: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "asset", from: UPSHIFT_STAGE.NONE, to: UPSHIFT_STAGE.APPROVED, forkStatus: "success", gasUsed: 50958 }),
  deposit: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, signature: "deposit(address,uint256,address)", selector: "0xf45346dc", target: "vault", from: UPSHIFT_STAGE.APPROVED, to: UPSHIFT_STAGE.IN_VAULT, forkStatus: "success", gasUsed: 174343 }),
  instantRedeem: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, signature: "instantRedeem(uint256,address)", selector: "0x22928208", target: "vault", from: UPSHIFT_STAGE.IN_VAULT, to: UPSHIFT_STAGE.OUT, forkStatus: "success", gasUsed: 147118, amount: "all_of_measured_shares" }),
  approveShares: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "shareToken", from: UPSHIFT_STAGE.IN_VAULT, to: UPSHIFT_STAGE.SHARES_APPROVED, forkStatus: "success", gasUsed: 55993, amount: "all_of_measured_shares" }),
  requestRedeem: Object.freeze({ proof: UPSHIFT_PROOF.PROVEN_FORK, signature: "requestRedeem(uint256,address)", selector: "0x107703ab", target: "vault", from: UPSHIFT_STAGE.SHARES_APPROVED, to: UPSHIFT_STAGE.QUEUED, forkStatus: "success", gasUsed: 218117, amount: "all_of_measured_shares" }),
  // Not run on this lane path (or only under a time warp): different claims, unproven. Beyond a queued request = UNKNOWN.
  claim: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, signature: "claim(uint256,uint256,uint256,address)", selector: "0xb3c9e83d", target: "vault", from: null, to: null, forkStatus: "time_warp_only" }),
  revoke: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "asset", from: null, to: null, forkStatus: "never_observed" }),
  depositAboveForkSize: Object.freeze({ proof: UPSHIFT_PROOF.UNPROVEN, signature: "deposit(address,uint256,address)", selector: "0xf45346dc", target: "vault", from: null, to: null, forkStatus: "never_observed" }),
});

export const UPSHIFT_UNPROVEN_STEPS = Object.freeze(Object.keys(UPSHIFT_STEPS).filter((k) => UPSHIFT_STEPS[k].proof !== UPSHIFT_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(UPSHIFT_STEPS, step)) return "unknown_step";
  if (UPSHIFT_STEPS[step].proof !== UPSHIFT_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/** The stage after one step, only along fork-proven transitions. A queued request has no proven next step. */
export function upshiftStageAfter(stage, step) {
  if (!Object.values(UPSHIFT_STAGE).includes(stage) || stage === UPSHIFT_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = UPSHIFT_STEPS[step];
  if (stage !== s.from) return { stage: null, error: "step_not_valid_from_stage" };
  return { stage: s.to, error: null };
}

/** What a stage means for the money: a queued request is pending, and what comes after it is UNKNOWN. */
export function upshiftOutcome(stage) {
  if (stage === UPSHIFT_STAGE.QUEUED) return Object.freeze({ outcome: "pending", afterThis: "UNKNOWN", eta: "UNKNOWN", amountBack: "UNKNOWN" });
  if (stage === UPSHIFT_STAGE.OUT) return Object.freeze({ outcome: "exited", afterThis: null, eta: null, amountBack: "read_as_balance" });
  if (typeof stage === "string" && Object.values(UPSHIFT_STAGE).includes(stage) && stage !== UPSHIFT_STAGE.UNKNOWN) return Object.freeze({ outcome: "in_progress", afterThis: null, eta: null, amountBack: null });
  return Object.freeze({ outcome: "unknown", afterThis: "UNKNOWN", eta: "UNKNOWN", amountBack: "UNKNOWN" });
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
const exactAmount = (v) => exactWithin(v, UPSHIFT_FORK_SIZE_RAW, "amount_not_exact", "amount_above_fork_proven_size");
const exactShares = (v) => exactWithin(v, UPSHIFT_FORK_POSITION_RAW, "shares_not_measured", "shares_above_fork_proven_position");

// A caller may name the token / spender / vault it expects; any name other than the fork-proven address for THIS step is refused
// (never re-aimed). The token of approveShares is the share token; of approve it is AUSD.
function pinnedTargetProblem(step, a) {
  const E = UPSHIFT_FORK_EVIDENCE;
  const want = { token: step === "approveShares" ? E.shareToken.address : E.asset.address, spender: E.vault, vault: E.vault };
  for (const k of Object.keys(want)) {
    if (a[k] === undefined) continue;
    if (typeof a[k] !== "string" || !ADDR.test(a[k]) || lower(a[k]) !== lower(want[k])) return `${k}_not_fork_proven`;
  }
  return null;
}

/**
 * Calldata for ONE fork-proven step. Every argument is explicit: each approve is exactly the amount (never unlimited) to the vault;
 * deposit puts AUSD in for the Piggy; instantRedeem / approveShares / requestRedeem use a MEASURED share amount (at most the fork
 * position) with the Piggy as receiver. Expected shares / AUSD out stay UNKNOWN. A description of a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeUpshiftStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? { amountRaw: args.amountRaw, piggyAddress: args.piggyAddress, heldSharesRaw: args.heldSharesRaw, token: args.token, spender: args.spender, vault: args.vault }
    : {};
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  const pinned = pinnedTargetProblem(step, a);
  if (pinned) return { call: null, error: pinned };
  const E = UPSHIFT_FORK_EVIDENCE;
  if (step === "instantRedeem" || step === "approveShares" || step === "requestRedeem") {
    const held = exactShares(a.heldSharesRaw);
    if (held.error) return { call: null, error: held.error };
    if (step === "approveShares") {
      return { call: Object.freeze({ step, to: E.shareToken.address, value: "0", spender: E.vault, amountRaw: held.amount.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [E.vault, held.amount] }) }), error: null };
    }
    return {
      call: Object.freeze({
        step, to: E.vault, value: "0", sharesRaw: held.amount.toString(), receiver: a.piggyAddress, expectedAusdRaw: "UNKNOWN",
        ...(step === "requestRedeem" ? { outcome: "pending", afterThis: "UNKNOWN" } : {}),
        data: encodeFunctionData({ abi: PROVEN_ABI, functionName: step, args: [held.amount, a.piggyAddress] }),
      }),
      error: null,
    };
  }
  const { amount, error } = exactAmount(a.amountRaw);
  if (error) return { call: null, error };
  if (step === "approve") {
    return { call: Object.freeze({ step, to: E.asset.address, value: "0", spender: E.vault, amountRaw: amount.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [E.vault, amount] }) }), error: null };
  }
  // deposit — AUSD only
  return {
    call: Object.freeze({
      step, to: E.vault, value: "0", amountRaw: amount.toString(), asset: E.asset.address, receiver: a.piggyAddress, expectedSharesRaw: "UNKNOWN",
      data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "deposit", args: [E.asset.address, amount, a.piggyAddress] }),
    }),
    error: null,
  };
}

/**
 * The exact request a permission envelope for the Upshift entry would have to match. Issues nothing (permission null). Only the
 * shared-fork profile carries AUSD in its asset table; the 143 profile binds USDC only, so an AUSD request there is refused at the binding
 * ("asset_not_in_profile"), and the fork profile is refused by the evidence chain check before it. A binding is never a permission.
 */
export function upshiftPermissionRequest(input) {
  const { profile, piggy, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, UPSHIFT_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_upshift_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: UPSHIFT_FORK_EVIDENCE.asset.symbol });
  if (error) return { request: null, error };
  const ausd = UPSHIFT_FORK_EVIDENCE.asset;
  if (erc20TokenOfBinding(binding).error === NATIVE_ASSET_NOT_ERC20) return { request: null, error: NATIVE_ASSET_NOT_ERC20 };
  if (lower(binding.token) !== lower(ausd.address) || binding.decimals !== ausd.decimals) return { request: null, error: "profile_asset_not_upshift_evidence" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: UPSHIFT_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: UPSHIFT_FORK_EVIDENCE.vault,
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

/** Could this step run for this Piggy? Always { allowed: false }. First refusal from the existing boundaries, then "upshift_lane_not_wired". */
export function upshiftExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  // [live-gate-form] fork-only gate: `!== false` lets exactly false through (to the local_fork executor check below); true / undefined / "true" / 1 refuse. Not the live gate.
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== UPSHIFT_JOB_ID) return refuse("profile_not_upshift_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: UPSHIFT_FORK_EVIDENCE.asset.symbol });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (UPSHIFT_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${UPSHIFT_UNKNOWN_FIELDS[0]}`);
  return refuse("upshift_lane_not_wired");
}

/** Readiness of an Upshift errand. Never READY / executable / live / permitted, whatever the input claims. */
export function upshiftReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of UPSHIFT_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of UPSHIFT_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = upshiftExecutionGate({ profile: profile ?? null, piggy, executor, step: "approve" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "upshift_lane_not_wired", "fork_review_conditions_open");
  const known = typeof stage === "string" && Object.values(UPSHIFT_STAGE).includes(stage) ? stage : (stage === undefined ? UPSHIFT_STAGE.NONE : UPSHIFT_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: UPSHIFT_JOB_ID,
    stage: known,
    outcome: upshiftOutcome(known).outcome,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    returnComplete: false,
    sharesAssumedEqualToAusd: false,
    evidenceClass: UPSHIFT_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(UPSHIFT_STEPS).filter((k) => UPSHIFT_STEPS[k].proof === UPSHIFT_PROOF.PROVEN_FORK)),
    unprovenSteps: UPSHIFT_UNPROVEN_STEPS,
    unknownFields: UPSHIFT_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}

// ── [fork-link] live-readiness checks (job-executor review conditions) ──────────────────────────────────────────────────────────────
// encodeUpshiftStep() above stays the fork DESCRIPTION and still takes the Piggy from its args. A future live lane must build a step
// ONLY through upshiftLiveStep() below:
//   (a) the Piggy in the args == the record binding's Piggy == the signer; receiver / owner / user are then always that one address
//       (taken from the binding, never from the args alone);
//   (b) deposit / instantRedeem: a min-out floor against a fresh measured preview for exactly this amount (no on-chain minimum, so the
//       lane must also run upshiftOutMeetsFloor() after the send). requestRedeem returns nothing at the request (PENDING): no floor
//       exists to check there; its share amount must still be a fresh read.
// Nothing here is wired and nothing reads a network: reads are injected, each with its block and read time. The gate still refuses.
export const UPSHIFT_LIVE_LIMITS = Object.freeze({ maxReadAgeMs: 30000, maxSlippageBps: 100 });

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
  const L = UPSHIFT_LIVE_LIMITS;
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
  if (min * 10000n < preview * BigInt(10000 - UPSHIFT_LIVE_LIMITS.maxSlippageBps)) return "min_out_too_loose";
  return null;
}
const withFloor = (out, minOutRaw, outAsset, previewBlock) => (out.error ? out : { call: Object.freeze({ ...out.call, minOutRaw, minOutAsset: outAsset, previewBlock, postCheck: "upshiftOutMeetsFloor" }), error: null });

/** After a send: did the realized balance delta (measured before / after, gas excluded by the caller) reach the floor? */
export function upshiftOutMeetsFloor({ minOutRaw, beforeRaw, afterRaw } = {}) {
  if (!isDigits(minOutRaw) || !isDigits(beforeRaw) || !isDigits(afterRaw)) return { ok: false, deltaRaw: null, reason: "balances_not_measured" };
  const delta = BigInt(afterRaw) - BigInt(beforeRaw);
  return delta >= BigInt(minOutRaw) ? { ok: true, deltaRaw: delta.toString(), reason: null } : { ok: false, deltaRaw: delta.toString(), reason: "realized_below_min_out" };
}

/**
 * One step for a live lane, after the job-executor live-readiness checks. input = { piggyAddress, binding, signerAddress, amountRaw,
 * minSharesRaw (deposit), minAssetsRaw (instantRedeem), reads: { previewOut, heldShares }, nowMs }. previewOut.forRaw = the amount
 * (deposit) or the held shares (instantRedeem).
 * @returns {{call: object|null, error: string|null}}
 */
export function upshiftLiveStep(step, input) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = liveIdentityProblem(i.piggyAddress, i.binding, i.signerAddress);
  if (id) return liveRefuse(id);
  if (erc20TokenOfBinding(i.binding).error === NATIVE_ASSET_NOT_ERC20) return liveRefuse(NATIVE_ASSET_NOT_ERC20); // native MON never takes the AUSD approve path
  if (lower(i.binding.token) !== lower(UPSHIFT_FORK_EVIDENCE.asset.address)) return liveRefuse("binding_asset_not_upshift_evidence");
  const piggy = i.binding.piggyAddress;
  const reads = i.reads && typeof i.reads === "object" ? i.reads : {};
  if (step === "deposit") {
    const pv = freshRead(reads.previewOut, i.nowMs, "preview_out");
    if (pv.error) return liveRefuse(pv.error);
    if (reads.previewOut.forRaw !== i.amountRaw) return liveRefuse("preview_not_for_this_amount");
    const f = floorProblem(i.minSharesRaw, pv.value);
    if (f) return liveRefuse(f);
    return withFloor(encodeUpshiftStep("deposit", { amountRaw: i.amountRaw, piggyAddress: piggy }), i.minSharesRaw, "earnAUSD", pv.block);
  }
  if (step === "instantRedeem" || step === "approveShares" || step === "requestRedeem") {
    const held = freshRead(reads.heldShares, i.nowMs, "held_shares");
    if (held.error) return liveRefuse(held.error);
    const args = { heldSharesRaw: held.value.toString(), piggyAddress: piggy };
    if (step !== "instantRedeem") return encodeUpshiftStep(step, args);
    const pv = freshRead(reads.previewOut, i.nowMs, "preview_out");
    if (pv.error) return liveRefuse(pv.error);
    if (reads.previewOut.forRaw !== held.value.toString()) return liveRefuse("preview_not_for_this_amount");
    const f = floorProblem(i.minAssetsRaw, pv.value);
    if (f) return liveRefuse(f);
    return withFloor(encodeUpshiftStep("instantRedeem", args), i.minAssetsRaw, UPSHIFT_FORK_EVIDENCE.asset.symbol, pv.block);
  }
  return encodeUpshiftStep(step, { amountRaw: i.amountRaw, piggyAddress: piggy });
}
