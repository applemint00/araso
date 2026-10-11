// Mainnet Job — Curvance USDC (USDC into a share-price vault, redeemed to the same Piggy). Local model of what is
// PROVEN on one mainnet fork run, nothing more.
//
// Evidence: one mainnet fork run, chain 143, block 108999816 (2026-09-29T09:24:32Z), no time warp, 5 USDC.
// Evidence class PASS_FORK_SIM — a fork run is never product readiness, permission, a rate or a mainnet
// transaction.
//
//   PROVEN on the fork (success):  approve(exact) · deposit · redeem(whole share position, next block)
//   NOT PROVEN:  a partial redeem · withdraw-by-assets · mint · any amount above the 5 USDC that was run ·
//                exit liquidity or a deposit cap at a later block · the share price at any other block ·
//                the name of revert 0xe6c95926 · whether a documented holding period applies to this vault
//
// Shares are not dollars. The vault prices a share above one USDC, so a deposit returns FEWER shares than the
// USDC sent, and the preview read before the deposit did not equal what the deposit returned. Both are kept
// below as MEASURED numbers from the run. Nothing here converts USDC to shares or shares to USDC — not 1:1 and
// not by the measured ratio, which belongs to one block. Expected shares and expected USDC back are UNKNOWN
// unless a caller brings its own preview measurement of exactly that amount, and even then the realized result
// stays UNKNOWN, because the fork already showed a preview and the realized result differing.
//
// There is no cooldown, holding period, wait, interval or ETA here. The fork redeemed in the next block without
// a time warp; how long a real exit takes, and whether any documented holding period applies, is UNKNOWN.
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no
// storage key and reads no network. curvanceExecutionGate() runs the existing boundaries (chain-profile.js
// binding, the shared local-fork executor refusal) and then refuses anyway, because no Curvance lane is wired to
// the one send chokepoint (money-executor.js). The product imports nothing here.

import { encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { bindRecordToProfile, chainMatchesExecutor, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const CURVANCE_JOB_ID = "curvance-usdc";
export const CURVANCE_ACTION = "curvance_deposit_redeem";

export const CURVANCE_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// What the fork run recorded. Values are copied from the run record, not derived.
export const CURVANCE_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 108999816,
  blockTimestamp: "2026-09-29T09:24:32Z",
  timeWarp: false,
  vault: "0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774",
  vaultCodeBytes: 24367,
  vaultCodeKeccak: "0x5ba6ee35f829d4774fe7e32405dce24760b3252b9100f8dd132a467dfdbd79c1",
  asset: Object.freeze({ symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }),
  // The share token is the vault itself; its asset() read back as the USDC above.
  share: Object.freeze({ symbol: "cUSDC", address: "0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774", decimals: 6 }),
  assetOfVaultMatches: true,
  approvalExact: true,
  allowanceAfterEntryRaw: "0",
  sentRaw: "5000000",
  sharesAfterEntryRaw: "4829898",
  returnedRaw: "4999998",
  deltaRaw: "-2",
  // Measured on the fork. Each is a reading at one point of the run, not a rule.
  measured: Object.freeze({
    previewDepositInputRaw: "5000000",
    previewDepositSharesRaw: "4830034",     // read before the deposit block
    realizedDepositSharesRaw: "4829898",    // what the deposit actually credited
    depositPreviewGapRaw: "136",            // preview minus realized, in raw shares
    maxRedeemRaw: "4829898",
    previewRedeemAllRaw: "4999998",         // read before the redeem
    realizedRedeemAssetsRaw: "4999998",     // what the redeem actually paid
    redeemPreviewGapRaw: "0",
  }),
  gasUsed: Object.freeze({ approve: 55437, deposit: 130633, redeem: 106993 }),
  // Observed on the fork only: deposit in block N, redeem of the whole share balance in block N+1, no time warp.
  exitObserved: "whole_position_next_block_no_time_warp",
  revertProbe: Object.freeze({ step: "redeem more shares than held", status: "reverted", reason: "0xe6c95926", name: "UNKNOWN" }),
  // Never measured or never re-proven for this vault: there is no value to show for these.
  unknown: Object.freeze([
    "real_world_exit_timing", "holding_period_applicability", "exit_liquidity", "deposit_cap", "current_share_price",
    "preview_to_realized_relation", "min_shares_out_guard", "fee_or_haircut", "revert_0xe6c95926_name", "supply_rate",
    "gas_fee_usd", "partial_redeem", "withdraw_by_assets", "mint", "amount_above_fork_size", "proxy_implementation",
    "freshness_window", "fee_cap", "eligibility_policy",
  ]),
});

// The only size run end to end on the fork. Anything larger is unproven, not merely uncapped.
export const CURVANCE_FORK_SIZE_RAW = CURVANCE_FORK_EVIDENCE.sentRaw;
// The only share position redeemed on the fork. A larger position was never redeemed.
export const CURVANCE_FORK_SHARES_RAW = CURVANCE_FORK_EVIDENCE.sharesAfterEntryRaw;

// Protocol fields a Curvance errand would need, each marked with what the fork proved. A field that is not
// proven has no value: it reads as "UNKNOWN", and any step that would depend on it is action 0.
export const CURVANCE_FIELDS = Object.freeze({
  vault: Object.freeze({ proof: CURVANCE_PROOF.PROVEN_FORK, value: CURVANCE_FORK_EVIDENCE.vault }),
  vaultCodeKeccak: Object.freeze({ proof: CURVANCE_PROOF.PROVEN_FORK, value: CURVANCE_FORK_EVIDENCE.vaultCodeKeccak }),
  asset: Object.freeze({ proof: CURVANCE_PROOF.PROVEN_FORK, value: CURVANCE_FORK_EVIDENCE.asset.address }),
  shareToken: Object.freeze({ proof: CURVANCE_PROOF.PROVEN_FORK, value: CURVANCE_FORK_EVIDENCE.share.address }),
  redeemAmount: Object.freeze({ proof: CURVANCE_PROOF.PROVEN_FORK, value: "whole_position" }),
  exitTiming: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  holdingPeriod: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  exitLiquidity: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  depositCap: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  sharePrice: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  expectedShares: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  expectedAssetsBack: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  minSharesOut: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  feeOrHaircut: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  supplyRate: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  feeCap: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
  eligibilityPolicy: Object.freeze({ proof: CURVANCE_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const CURVANCE_UNKNOWN_FIELDS = Object.freeze(Object.keys(CURVANCE_FIELDS).filter((k) => CURVANCE_FIELDS[k].proof !== CURVANCE_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function curvanceField(name) {
  if (typeof name !== "string" || !has(CURVANCE_FIELDS, name)) return "UNKNOWN";
  const f = CURVANCE_FIELDS[name];
  return f.proof === CURVANCE_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully. Return values are never decoded here (outputs left empty on
// purpose): the shares a deposit returns and the USDC a redeem returns are read as balances, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [] },
]);

// Stages a Curvance errand can be described in, along fork-proven steps only.
export const CURVANCE_STAGE = Object.freeze({
  NONE: "none",
  APPROVED: "approved_exact",
  DEPOSITED: "holding_shares",
  REDEEMED: "redeemed",
  UNKNOWN: "unknown",
});

export const CURVANCE_STEPS = Object.freeze({
  approve: Object.freeze({
    proof: CURVANCE_PROOF.PROVEN_FORK, signature: "approve(address,uint256)", selector: "0x095ea7b3", target: "asset",
    from: CURVANCE_STAGE.NONE, to: CURVANCE_STAGE.APPROVED, forkStatus: "success", gasUsed: 55437,
  }),
  deposit: Object.freeze({
    proof: CURVANCE_PROOF.PROVEN_FORK, signature: "deposit(uint256,address)", selector: "0x6e553f65", target: "vault",
    from: CURVANCE_STAGE.APPROVED, to: CURVANCE_STAGE.DEPOSITED, forkStatus: "success", gasUsed: 130633,
  }),
  redeem: Object.freeze({
    proof: CURVANCE_PROOF.PROVEN_FORK, signature: "redeem(uint256,address,address)", selector: "0xba087652", target: "vault",
    from: CURVANCE_STAGE.DEPOSITED, to: CURVANCE_STAGE.REDEEMED, forkStatus: "success", gasUsed: 106993, amount: "whole_position",
  }),
  // Never run on the fork. Same or sibling selectors, different claims: unproven.
  redeemPartial: Object.freeze({
    proof: CURVANCE_PROOF.UNPROVEN, signature: "redeem(uint256,address,address)", selector: "0xba087652", target: "vault",
    from: null, to: null, forkStatus: "never_observed",
  }),
  withdraw: Object.freeze({
    proof: CURVANCE_PROOF.UNPROVEN, signature: "withdraw(uint256,address,address)", selector: "0xb460af94", target: "vault",
    from: null, to: null, forkStatus: "never_observed",
  }),
  mint: Object.freeze({
    proof: CURVANCE_PROOF.UNPROVEN, signature: "mint(uint256,address)", selector: "0x94bf804d", target: "vault",
    from: null, to: null, forkStatus: "never_observed",
  }),
});

export const CURVANCE_UNPROVEN_STEPS = Object.freeze(Object.keys(CURVANCE_STEPS).filter((k) => CURVANCE_STEPS[k].proof !== CURVANCE_PROOF.PROVEN_FORK));

function stepProblem(step) {
  if (typeof step !== "string" || !has(CURVANCE_STEPS, step)) return "unknown_step";
  if (CURVANCE_STEPS[step].proof !== CURVANCE_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/**
 * The stage after one step, only along fork-proven transitions. An unproven step has no next stage.
 * @returns {{stage: string|null, error: string|null}}
 */
export function curvanceStageAfter(stage, step) {
  if (!Object.values(CURVANCE_STAGE).includes(stage) || stage === CURVANCE_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = CURVANCE_STEPS[step];
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

/** An exact raw integer within `limit`, as a BigInt; otherwise an error word. */
function exactWithin(v, limit, notExact, above) {
  if (!isDigits(v) || BigInt(v) === 0n) return { amount: null, error: notExact };
  if (BigInt(v) > BigInt(limit)) return { amount: null, error: above };
  return { amount: BigInt(v), error: null };
}
const exactAmount = (v) => exactWithin(v, CURVANCE_FORK_SIZE_RAW, "amount_not_exact", "amount_above_fork_proven_size");
const exactShares = (v) => exactWithin(v, CURVANCE_FORK_SHARES_RAW, "shares_not_exact", "shares_above_fork_proven_position");

/**
 * Preview minus realized, in raw units, from two MEASURED readings. Signed; zero only if they were equal. It
 * never assumes the two agree and never compares either with the USDC amount.
 * @returns {{gapRaw: string|null, error: string|null}}
 */
export function curvancePreviewGap(previewRaw, realizedRaw) {
  if (!isDigits(previewRaw) || !isDigits(realizedRaw)) return { gapRaw: null, error: "measurement_not_exact" };
  return { gapRaw: (BigInt(previewRaw) - BigInt(realizedRaw)).toString(), error: null };
}

/**
 * What a deposit of `amountRaw` USDC can be said to buy. Without a preview measured for exactly this amount the
 * shares are UNKNOWN — never the USDC amount (no 1:1) and never scaled from another reading (the share price is
 * one block's state). With such a measurement the preview is reported as a preview, the realized shares stay
 * UNKNOWN (the fork's realized deposit differed from its preview), and nothing here is an action.
 */
export function curvanceShareQuote(input) {
  const { amountRaw, measuredPreview } = input && typeof input === "object" ? input : {};
  const base = { action: "none", actionCount: 0, sharesAssumedEqualToAmount: false, realizedSharesRaw: "UNKNOWN", minSharesOut: "UNKNOWN", freshness: "UNKNOWN" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return Object.freeze({ ...base, previewSharesRaw: "UNKNOWN", basis: "none", error: exact.error });
  const m = measuredPreview && typeof measuredPreview === "object" && !Array.isArray(measuredPreview)
    ? { inputRaw: measuredPreview.inputRaw, sharesRaw: measuredPreview.previewSharesRaw, block: measuredPreview.blockNumber }
    : null;
  if (!m) return Object.freeze({ ...base, amountRaw: exact.amount.toString(), previewSharesRaw: "UNKNOWN", basis: "unmeasured", error: "no_measured_preview" });
  if (!isDigits(m.inputRaw) || BigInt(m.inputRaw) !== exact.amount) return Object.freeze({ ...base, amountRaw: exact.amount.toString(), previewSharesRaw: "UNKNOWN", basis: "unmeasured", error: "preview_amount_mismatch" });
  if (!isDigits(m.sharesRaw) || !Number.isInteger(m.block) || m.block < 0) return Object.freeze({ ...base, amountRaw: exact.amount.toString(), previewSharesRaw: "UNKNOWN", basis: "unmeasured", error: "preview_not_measured" });
  return Object.freeze({ ...base, amountRaw: exact.amount.toString(), previewSharesRaw: m.sharesRaw, previewBlock: m.block, basis: "measured_preview", error: null });
}

/**
 * Calldata for ONE fork-proven step, built from the recorded vault and asset only. Every argument is explicit:
 * the approve is exactly the amount (never unlimited), the deposit credits the Piggy itself, and the redeem
 * returns the Piggy's whole measured share position to the Piggy — the only redeem the fork ran. The redeem
 * needs the share balance as a caller's measurement (`heldSharesRaw`); shares are never derived from USDC.
 * Expected shares or USDC out are UNKNOWN on every call. This is a description of a call, not a permission and
 * not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeCurvanceStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args)
    ? { amountRaw: args.amountRaw, sharesRaw: args.sharesRaw, heldSharesRaw: args.heldSharesRaw, piggyAddress: args.piggyAddress }
    : {};
  const vault = CURVANCE_FORK_EVIDENCE.vault;
  const asset = CURVANCE_FORK_EVIDENCE.asset.address;
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  if (step === "redeem") {
    const held = exactShares(a.heldSharesRaw);
    if (held.error) return { call: null, error: held.error === "shares_not_exact" ? "held_shares_not_measured" : held.error };
    if (a.sharesRaw !== undefined && (!isDigits(a.sharesRaw) || BigInt(a.sharesRaw) !== held.amount)) return { call: null, error: "unproven_step:redeemPartial" };
    return {
      call: Object.freeze({
        step, to: vault, value: "0", sharesRaw: held.amount.toString(), amount: "whole_position", receiver: a.piggyAddress, owner: a.piggyAddress,
        expectedAssetsRaw: "UNKNOWN",
        data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "redeem", args: [held.amount, a.piggyAddress, a.piggyAddress] }),
      }),
      error: null,
    };
  }
  const { amount, error } = exactAmount(a.amountRaw);
  if (error) return { call: null, error };
  if (step === "approve") {
    return { call: Object.freeze({ step, to: asset, value: "0", spender: vault, amountRaw: amount.toString(), data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "approve", args: [vault, amount] }) }), error: null };
  }
  // deposit
  return {
    call: Object.freeze({
      step, to: vault, value: "0", amountRaw: amount.toString(), receiver: a.piggyAddress, expectedSharesRaw: "UNKNOWN", minSharesOut: "UNKNOWN",
      data: encodeFunctionData({ abi: PROVEN_ABI, functionName: "deposit", args: [amount, a.piggyAddress] }),
    }),
    error: null,
  };
}

/**
 * The exact request a permission envelope for the Curvance entry would have to match, in the shape
 * permission-envelope.js authorize() compares, with its nonce from permissionNonce(). It issues nothing:
 * `permission` is always null and `createsPermission` false. The binding comes from chain-profile.js. The
 * amount is USDC sent; the shares it would buy are UNKNOWN and are not part of the request.
 * @returns {{request: object|null, error: string|null}}
 */
export function curvancePermissionRequest(input) {
  const { profile, piggy, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, CURVANCE_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_curvance_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return { request: null, error };
  if (lower(binding.token) !== lower(CURVANCE_FORK_EVIDENCE.asset.address) || binding.decimals !== CURVANCE_FORK_EVIDENCE.asset.decimals) return { request: null, error: "profile_asset_not_curvance_evidence" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: CURVANCE_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: CURVANCE_FORK_EVIDENCE.vault,
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

/**
 * Could this step run for this Piggy? Always { allowed: false, action: "none" }. The first refusal comes from
 * the existing boundaries, in order: proof of the step, the chain profile, live-off, the profile's Job, the
 * record binding (chain-profile.js), the shared local-fork executor refusal, every still-UNKNOWN field, and
 * finally the fact that no Curvance lane reaches the send chokepoint.
 */
export function curvanceExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== CURVANCE_JOB_ID) return refuse("profile_not_curvance_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (CURVANCE_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${CURVANCE_UNKNOWN_FIELDS[0]}`);
  return refuse("curvance_lane_not_wired");
}

/**
 * Readiness of a Curvance errand. Never READY, never executable, never live, never permitted — whatever the
 * input claims (a forged stage, a live profile, an executor, caller-supplied cap, liquidity or share-price
 * numbers). The reasons list what is still open; the evidence fields say what was proven.
 */
export function curvanceReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of CURVANCE_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of CURVANCE_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = curvanceExecutionGate({ profile: profile ?? null, piggy, executor, step: "approve" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "curvance_lane_not_wired");
  const known = typeof stage === "string" && Object.values(CURVANCE_STAGE).includes(stage) ? stage : (stage === undefined ? CURVANCE_STAGE.NONE : CURVANCE_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: CURVANCE_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    sharesAssumedEqualToAmount: false,
    evidenceClass: CURVANCE_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(CURVANCE_STEPS).filter((k) => CURVANCE_STEPS[k].proof === CURVANCE_PROOF.PROVEN_FORK)),
    unprovenSteps: CURVANCE_UNPROVEN_STEPS,
    unknownFields: CURVANCE_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}
