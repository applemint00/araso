// Mainnet Job — Curve Stableswap-NG AUSD / USDC / USDT0 (USDC in, single-sided; exit back to USDC). Local model of what is
// PROVEN on one mainnet fork run, nothing more. Same lane shape as the other mainnet Job modules.
//
// Evidence: one mainnet fork run, chain 143, block 110874000 (2026-10-05T22:41:21Z), anvil fork, fixture actors, scenario A = 10 USDC:
//   approve(exact 10 USDC) → add_liquidity([0, 10e6, 0], min_mint = calc_token_amount × 0.999) → remove_liquidity_one_coin(50 % LP → USDC)
//   → remove_liquidity_one_coin(remaining LP → USDC) → approve(pool, 0). 69 tx in all variants, 0 reverted. Evidence class PASS_FORK_SIM —
//   a fork run is never product readiness, permission, a rate or a mainnet transaction.
//
//   PROVEN on the fork (success):  approve(exact) · add_liquidity (single-sided USDC, dynamic-array ABI) · remove_liquidity_one_coin to USDC
//                                  (half of the LP, then the rest) · approve(pool, 0)
//   NOT PROVEN for this lane:  any amount above 10 USDC with a partial exit · an exit to AUSD / USDT0 from a USDC entry · fees as income ·
//                              incentives · behaviour at another block · depeg · a freeze of the pool address · admin parameter changes
//
// LP tokens are not dollars (18 decimals, virtual price ≈ 1.07 at the pin). Nothing here converts USDC to LP or LP to USDC. The minimum LP
// out and the minimum USDC back come only from a caller's MEASURED preview (calc_token_amount / calc_withdraw_one_coin read for exactly
// that amount), with the fork run's 0.999 factor; without that measurement the step is refused.
//
// Fork review — 9 conditions, ALL OPEN (never closed here):
//   [ ] 1 separate Owner-GO live-tx card (amount chosen by the Owner; 10 USDC is a fork vector, not a cap)
//   [ ] 2 grounded MON/USD at the same cutoff for the ≈0.052 MON round-trip gas
//   [ ] 3 live-head re-read of identity / fee / A / future_A_time / asset types / balances & skew / VP / calc vs the pin (stop on drift)
//   [ ] 4 Curve NG implementation source + factory admin powers review (fee/A ramp, ma_exp_time, kill/pause, admin-fee withdrawal)
//   [ ] 5 AUSD / USDT0 freeze-blocklist-pause authority, incl. a freeze of the pool address on proportional vs one-coin exit
//   [ ] 6 depeg not simulated
//   [ ] 7 Merkl WMON incentive eligibility / claim path — PENDING / UNKNOWN on any Receipt, never income
//   [ ] 8 money-executor design and guard review
//   [ ] 9 product copy (OPEN)
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no storage key and reads no
// network. lpExecutionGate() runs the existing boundaries and then refuses anyway, because no LP lane is wired to the one send chokepoint
// (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { bindRecordToProfile, chainMatchesExecutor, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const LP_JOB_ID = "curve-ausd-usdc-usdt0-lp";
export const LP_ACTION = "lp_single_sided_usdc_roundtrip";

export const LP_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// Copied from the fork run record, not derived.
export const LP_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 110874000,
  blockHash: "0x8b069cc48799e34174bb4310c1b1d512a0855b41d67f76c3b837626fcb73255d",
  blockTimestamp: "2026-10-05T22:41:21Z",
  timeWarp: false,
  pool: "0x942644106B073E30D72c2C5D7529D5C296ea91ab",
  poolCodeBytes: 23635,
  // Curve NG plain pool: the pool contract is also the LP token (18 decimals).
  lpToken: Object.freeze({ symbol: "AUSDCT0", address: "0x942644106B073E30D72c2C5D7529D5C296ea91ab", decimals: 18 }),
  coins: Object.freeze([
    Object.freeze({ index: 0, symbol: "AUSD", address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", decimals: 6 }),
    Object.freeze({ index: 1, symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }),
    Object.freeze({ index: 2, symbol: "USDT0", address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6 }),
  ]),
  usdcIndex: 1,
  approvalExact: true,
  allowanceAfterEntryRaw: "0",
  sentRaw: "10000000",
  minMintFactor: Object.freeze({ numerator: 999, denominator: 1000 }),
  measured: Object.freeze({
    previewLpRaw: "9339618795389258487", // calc_token_amount([0, 10e6, 0], true) at the pin
    realizedLpRaw: "9339618795389258487", // what add_liquidity credited (preview − realized = 0 on this run)
    partialExitUsdcRaw: "4999753", // remove_liquidity_one_coin(half LP → USDC)
    fullExitUsdcRaw: "4999753", // remove_liquidity_one_coin(rest → USDC)
    returnedRaw: "9999506",
    deltaRaw: "-494",
    virtualPriceAtPin: "1070662807868531724",
  }),
  gasUsed: Object.freeze({ approve: 55437, addLiquidity: 193918, removeOneCoinHalf: 154839, removeOneCoinRest: 150039, revoke: 35501 }),
  txCountAllVariants: 69,
  reverted: 0,
  unknown: Object.freeze([
    "fees_as_income", "incentive_merkl_wmon", "exit_to_other_coin_from_usdc_entry", "amount_above_fork_size", "live_head_drift",
    "admin_parameter_changes", "freeze_of_pool_address", "depeg_behaviour", "gas_fee_usd", "current_virtual_price", "freshness_window",
  ]),
});

// The size run end to end WITH a partial exit (scenario A). 5 and 50 USDC were also run (full round trip only): not a lane size.
export const LP_FORK_SIZE_RAW = LP_FORK_EVIDENCE.sentRaw;
// The LP position the partial / full exits were run from.
export const LP_FORK_POSITION_RAW = LP_FORK_EVIDENCE.measured.realizedLpRaw;

export const LP_FIELDS = Object.freeze({
  pool: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, value: LP_FORK_EVIDENCE.pool }),
  lpToken: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, value: LP_FORK_EVIDENCE.lpToken.address }),
  entryCoin: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, value: LP_FORK_EVIDENCE.coins[1].address }),
  exitCoin: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, value: LP_FORK_EVIDENCE.coins[1].address }),
  minOutFactor: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, value: "0.999 of a measured preview" }),
  feesAsIncome: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  incentive: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  currentVirtualPrice: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  liveHeadDrift: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  adminPowers: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freezeAuthority: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  depegBehaviour: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: LP_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const LP_UNKNOWN_FIELDS = Object.freeze(Object.keys(LP_FIELDS).filter((k) => LP_FIELDS[k].proof !== LP_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function lpField(name) {
  if (typeof name !== "string" || !has(LP_FIELDS, name)) return "UNKNOWN";
  const f = LP_FIELDS[name];
  return f.proof === LP_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully, in the exact ABI forms the fork resolved (dynamic array add; one-coin remove).
// Return values are never decoded here: LP credited and USDC back are read as balances, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "add_liquidity", stateMutability: "nonpayable", inputs: [{ name: "amounts", type: "uint256[]" }, { name: "min_mint_amount", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "remove_liquidity_one_coin", stateMutability: "nonpayable", inputs: [{ name: "burn_amount", type: "uint256" }, { name: "i", type: "int128" }, { name: "min_received", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
]);

export const LP_STAGE = Object.freeze({
  NONE: "none",
  APPROVED: "approved_exact",
  IN_POOL: "holding_lp",
  HALF_OUT: "half_exited",
  OUT: "exited",
  REVOKED: "allowance_revoked",
  UNKNOWN: "unknown",
});

export const LP_STEPS = Object.freeze({
  approve: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "usdc", from: LP_STAGE.NONE, to: LP_STAGE.APPROVED, forkStatus: "success", gasUsed: 55437 }),
  addLiquidity: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, signature: "add_liquidity(uint256[],uint256,address)", selector: "0xa7256d09", target: "pool", from: LP_STAGE.APPROVED, to: LP_STAGE.IN_POOL, forkStatus: "success", gasUsed: 193918 }),
  exitHalf: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, signature: "remove_liquidity_one_coin(uint256,int128,uint256,address)", selector: "0x081579a5", target: "pool", from: LP_STAGE.IN_POOL, to: LP_STAGE.HALF_OUT, forkStatus: "success", gasUsed: 154839, amount: "half_of_measured_lp" }),
  exitRest: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, signature: "remove_liquidity_one_coin(uint256,int128,uint256,address)", selector: "0x081579a5", target: "pool", from: LP_STAGE.HALF_OUT, to: LP_STAGE.OUT, forkStatus: "success", gasUsed: 150039, amount: "rest_of_measured_lp" }),
  revoke: Object.freeze({ proof: LP_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "usdc", from: LP_STAGE.OUT, to: LP_STAGE.REVOKED, forkStatus: "success", gasUsed: 35501, amount: "0" }),
  // Not run on this lane path: different claims, unproven.
  exitOtherCoin: Object.freeze({ proof: LP_PROOF.UNPROVEN, signature: "remove_liquidity_one_coin(uint256,int128,uint256,address)", selector: "0x081579a5", target: "pool", from: null, to: null, forkStatus: "not_on_this_lane" }),
  addAboveForkSize: Object.freeze({ proof: LP_PROOF.UNPROVEN, signature: "add_liquidity(uint256[],uint256,address)", selector: "0xa7256d09", target: "pool", from: null, to: null, forkStatus: "never_observed" }),
});

export const LP_UNPROVEN_STEPS = Object.freeze(Object.keys(LP_STEPS).filter((k) => LP_STEPS[k].proof !== LP_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(LP_STEPS, step)) return "unknown_step";
  if (LP_STEPS[step].proof !== LP_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/** The stage after one step, only along fork-proven transitions. */
export function lpStageAfter(stage, step) {
  if (!Object.values(LP_STAGE).includes(stage) || stage === LP_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = LP_STEPS[step];
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
const exactAmount = (v) => exactWithin(v, LP_FORK_SIZE_RAW, "amount_not_exact", "amount_above_fork_proven_size");
const exactLp = (v) => exactWithin(v, LP_FORK_POSITION_RAW, "lp_not_measured", "lp_above_fork_proven_position");
// min out = measured preview × 999 / 1000 (the fork run's factor); a missing / non-integer preview = refused.
function minOutFrom(preview, missing) {
  if (!isDigits(preview) || BigInt(preview) === 0n) return { min: null, error: missing };
  const f = LP_FORK_EVIDENCE.minMintFactor;
  return { min: (BigInt(preview) * BigInt(f.numerator)) / BigInt(f.denominator), error: null };
}

/**
 * Calldata for ONE fork-proven step. Every argument is explicit: the approve is exactly the amount (never unlimited) and the revoke is 0;
 * add_liquidity puts USDC only ([0, amount, 0]) and credits the Piggy; each exit burns a MEASURED LP amount (half of the measured
 * position, then the measured rest) to USDC (coin index 1) for the Piggy; every minimum comes from a caller's measured preview.
 * Expected LP / USDC out stay UNKNOWN. A description of a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeLpStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? { amountRaw: args.amountRaw, piggyAddress: args.piggyAddress, previewLpRaw: args.previewLpRaw, heldLpRaw: args.heldLpRaw, previewUsdcRaw: args.previewUsdcRaw }
    : {};
  const pool = LP_FORK_EVIDENCE.pool;
  const usdc = LP_FORK_EVIDENCE.coins[LP_FORK_EVIDENCE.usdcIndex].address;
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  if (step === "revoke") {
    return { call: Object.freeze({ step, to: usdc, value: "0", spender: pool, amountRaw: "0", data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [pool, 0n] }) }), error: null };
  }
  if (step === "exitHalf" || step === "exitRest") {
    const held = exactLp(a.heldLpRaw);
    if (held.error) return { call: null, error: held.error };
    const burn = step === "exitHalf" ? held.amount / 2n : held.amount;
    if (burn === 0n) return { call: null, error: "lp_not_measured" };
    const { min, error } = minOutFrom(a.previewUsdcRaw, "usdc_preview_not_measured");
    if (error) return { call: null, error };
    return {
      call: Object.freeze({
        step, to: pool, value: "0", burnLpRaw: burn.toString(), coinIndex: LP_FORK_EVIDENCE.usdcIndex, minUsdcRaw: min.toString(), receiver: a.piggyAddress, expectedUsdcRaw: "UNKNOWN",
        data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "remove_liquidity_one_coin", args: [burn, BigInt(LP_FORK_EVIDENCE.usdcIndex), min, a.piggyAddress] }),
      }),
      error: null,
    };
  }
  const { amount, error } = exactAmount(a.amountRaw);
  if (error) return { call: null, error };
  if (step === "approve") {
    return { call: Object.freeze({ step, to: usdc, value: "0", spender: pool, amountRaw: amount.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [pool, amount] }) }), error: null };
  }
  // addLiquidity — USDC only
  const m = minOutFrom(a.previewLpRaw, "lp_preview_not_measured");
  if (m.error) return { call: null, error: m.error };
  const amounts = [0n, 0n, 0n];
  amounts[LP_FORK_EVIDENCE.usdcIndex] = amount;
  return {
    call: Object.freeze({
      step, to: pool, value: "0", amountRaw: amount.toString(), amounts: amounts.map(String), minLpRaw: m.min.toString(), receiver: a.piggyAddress, expectedLpRaw: "UNKNOWN",
      data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "add_liquidity", args: [amounts, m.min, a.piggyAddress] }),
    }),
    error: null,
  };
}

/** The exact request a permission envelope for the LP entry would have to match. Issues nothing (permission null). */
export function lpPermissionRequest(input) {
  const { profile, piggy, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, LP_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_lp_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return { request: null, error };
  const usdc = LP_FORK_EVIDENCE.coins[LP_FORK_EVIDENCE.usdcIndex];
  if (lower(binding.token) !== lower(usdc.address) || binding.decimals !== usdc.decimals) return { request: null, error: "profile_asset_not_lp_evidence" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: LP_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: LP_FORK_EVIDENCE.pool,
  };
  return {
    request: Object.freeze({
      ...fields,
      destinationRequired: true,
      amountDisplay: `${formatUnits(exact.amount, binding.decimals)} ${binding.asset}`,
      expectedLpRaw: "UNKNOWN",
      nonce: permissionNonce({ ...fields, at: typeof eventId === "string" && eventId ? eventId : "UNKNOWN_EVENT" }),
      permission: null,
      createsPermission: false,
    }),
    error: null,
  };
}

/** Could this step run for this Piggy? Always { allowed: false }. First refusal from the existing boundaries, then "lp_lane_not_wired". */
export function lpExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== LP_JOB_ID) return refuse("profile_not_lp_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (LP_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${LP_UNKNOWN_FIELDS[0]}`);
  return refuse("lp_lane_not_wired");
}

/** Readiness of an LP errand. Never READY / executable / live / permitted, whatever the input claims. */
export function lpReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of LP_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of LP_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = lpExecutionGate({ profile: profile ?? null, piggy, executor, step: "approve" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "lp_lane_not_wired", "fork_review_conditions_open");
  const known = typeof stage === "string" && Object.values(LP_STAGE).includes(stage) ? stage : (stage === undefined ? LP_STAGE.NONE : LP_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: LP_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    lpAssumedEqualToUsdc: false,
    evidenceClass: LP_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(LP_STEPS).filter((k) => LP_STEPS[k].proof === LP_PROOF.PROVEN_FORK)),
    unprovenSteps: LP_UNPROVEN_STEPS,
    unknownFields: LP_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}
