// Second mainnet W3-C: a fail-closed, evidence-bounded Curvance USDC local model.
//   node app/test/a760-curvance-mainnet-lane.mjs
// Node only, no network: `fetch` is replaced by a thrower. Nothing here sends, signs or reads a chain.
//
// Part E (evidence): every fact the module encodes equals the fork run record (cross-checked against the raw
//   record when it is present), selectors are derived from the recorded signatures, and nothing is borrowed
//   from the Aave or Neverland Jobs.
// Part M (measured): share counts are never the USDC amount; preview and realized are kept as separate
//   measurements and their gap is computed, never assumed zero.
// Part U (unknowns): every unproven field reads UNKNOWN; the gate / readiness / stage machine / encoder are
//   action 0 on every unknown and never reach READY, allowed, permission or live.
// Part R (reuse): exact-amount, permission-request, record-binding and executor refusal come from the shared
//   modules (mainnet-job-common.js, permission-envelope.js, chain-profile.js), not from copies.
// Part S (source): no send / sign / storage / network / timer / executor construction / invented timing.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, maxUint256, parseAbi, toFunctionSelector } from "viem";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };

import * as CV from "../src/mainnet-job-curvance.js";
import * as COMMON from "../src/mainnet-job-common.js";
import { MAINNET_LANE_CONFIG } from "../src/mainnet-job-lane.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { authorize, issuePermission, permissionNonce } from "../src/permission-envelope.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const {
  CURVANCE_ACTION, CURVANCE_FIELDS, CURVANCE_FORK_EVIDENCE, CURVANCE_FORK_SHARES_RAW, CURVANCE_FORK_SIZE_RAW, CURVANCE_JOB_ID, CURVANCE_PROOF,
  CURVANCE_STAGE, CURVANCE_STEPS, CURVANCE_UNKNOWN_FIELDS, CURVANCE_UNPROVEN_STEPS,
  curvanceExecutionGate, curvanceField, curvancePermissionRequest, curvancePreviewGap, curvanceReadiness, curvanceShareQuote, curvanceStageAfter,
  encodeCurvanceStep,
} = CV;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const MODULE = "mainnet-job-curvance.js";
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const CODE = strip(SRC(MODULE));
const MAINNET = resolveChainProfile("monad-mainnet");
const TESTNET = resolveChainProfile("monad-testnet");
const BLOCKED = resolveChainProfile("nonsense-profile");
const PIGGY = { id: "piggy-1", address: "0x1111111111111111111111111111111111111111" };
const FORK_EXECUTOR = { kind: "local_fork", chainId: 143, forkBlock: 108999816, send: async () => { throw new Error("no send in this suite"); }, receipt: async () => null };
const LIVE_EXECUTOR = { ...FORK_EXECUTOR, kind: "live" };
const CURVANCE_RAW = privatePath("ops/receipts/A652_mainnet_fork_lab/raw/curvance-usdc.json");
const CURVANCE_HARNESS_OLD = privatePath("ops/receipts/A480_fork_lab/C_curvance/run.mjs");
const E = CURVANCE_FORK_EVIDENCE;
const M = E.measured;

let pass = 0;
let fail = 0;
let skip = 0;
async function check(label, fn) {
  try {
    const r = await fn();
    if (r === "SKIP") { console.log(`SKIP  ${label}`); skip += 1; } else { console.log(`PASS  ${label}`); pass += 1; }
  } catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}

// ── Part E · evidence ───────────────────────────────────────────────────────────────────────────────────
await check("E1 every encoded fork fact equals the raw fork record (SKIP when the record is not in this checkout)", () => {
  if (!existsSync(CURVANCE_RAW)) return "SKIP";
  const raw = JSON.parse(readFileSync(CURVANCE_RAW, "utf8"));
  assert.equal(raw.id, CURVANCE_JOB_ID);
  assert.equal(raw.label, E.label);
  assert.equal(raw.chainId, E.chainId);
  assert.equal(raw.block.number, E.block);
  assert.equal(raw.block.timestampIso.replace(".000Z", "Z"), E.blockTimestamp);
  assert.equal(raw.contracts.vault.address, E.vault);
  assert.equal(raw.contracts.vault.codeBytes, E.vaultCodeBytes);
  assert.equal(raw.contracts.vault.codeKeccak, E.vaultCodeKeccak);
  assert.deepEqual({ ...E.asset }, { symbol: raw.contracts.usdc.symbol, address: raw.contracts.usdc.address, decimals: raw.contracts.usdc.decimals });
  assert.deepEqual({ ...E.share }, { address: raw.contracts.share.address, decimals: raw.contracts.share.decimals, symbol: raw.contracts.share.symbol });
  assert.equal(raw.contracts.share.address, raw.contracts.vault.address);
  assert.equal(raw.contracts.assetOfVault, E.asset.address);
  assert.equal(raw.contracts.assetMatchesUsdc, E.assetOfVaultMatches);
  assert.equal(raw.roundTrip.sentRaw, E.sentRaw);
  assert.equal(raw.roundTrip.deltaRaw, E.deltaRaw);
  assert.match(raw.roundTrip.timeWarp, /^none/);
  assert.equal(raw.allowance.approvedExact, "5");
  assert.equal(raw.allowance.afterEntry, E.allowanceAfterEntryRaw);
  assert.equal(raw.balances.sharesAfterEntryRaw, E.sharesAfterEntryRaw);
  assert.equal(raw.balances.usdcAfterExit, COMMON.formatUnits(BigInt(E.returnedRaw), 6).replace(/0+$/, ""));
  assert.equal((BigInt(E.returnedRaw) - BigInt(E.sentRaw)).toString(), E.deltaRaw);
  // measured preview / realized readings
  assert.equal(raw.preview.previewDeposit5, M.previewDepositSharesRaw);
  assert.equal(M.previewDepositInputRaw, raw.roundTrip.sentRaw);
  assert.equal(raw.preExit.maxRedeem, M.maxRedeemRaw);
  assert.equal(raw.preExit.previewRedeemAll, M.previewRedeemAllRaw);
  assert.equal(raw.preExit.shareRaw, M.realizedDepositSharesRaw);
  const byStep = Object.fromEntries(raw.steps.map((s) => [s.step, s]));
  assert.equal(byStep["1b_deposit"].shareRaw, `0 -> ${M.realizedDepositSharesRaw}`);
  assert.equal(byStep["2_redeem_immediate"].shareRaw, `${M.realizedDepositSharesRaw} -> 0`);
  assert.equal(byStep["2_redeem_immediate"].usdc, `0 -> ${COMMON.formatUnits(BigInt(M.realizedRedeemAssetsRaw), 6)}`);
  const map = { approve: "1a_approve", deposit: "1b_deposit", redeem: "2_redeem_immediate" };
  for (const [k, rawId] of Object.entries(map)) {
    const s = byStep[rawId];
    const m = CURVANCE_STEPS[k];
    assert.equal(s.status, "success", k);
    assert.equal(s.signature, m.signature, k);
    assert.equal(s.selector, m.selector, k);
    assert.equal(Number(s.gasUsed), m.gasUsed, k);
    assert.equal(Number(s.gasUsed), E.gasUsed[k], k);
    assert.equal(s.to, m.target === "vault" ? E.vault : E.asset.address, k);
  }
  assert.match(byStep["2_redeem_immediate"].label, /redeem\(all\) next block, no time warp/);
  assert.equal(byStep["2_redeem_immediate"].blockNumber, byStep["1b_deposit"].blockNumber + 1);
  const probe = byStep["3_probe_redeem_too_much"];
  assert.equal(probe.status, E.revertProbe.status);
  assert.equal(probe.estimateError.data, E.revertProbe.reason);
  assert.equal(E.revertProbe.name, "UNKNOWN");
  for (const id of Object.values(map)) assert.equal(byStep[id].from, byStep["1a_approve"].from);
});

await check("E2 selectors are the recorded signatures' own selectors; calldata decodes back to exactly the recorded call shape", () => {
  for (const [k, s] of Object.entries(CURVANCE_STEPS)) assert.equal(toFunctionSelector(`function ${s.signature}`), s.selector, k);
  const abi = parseAbi(["function approve(address,uint256)", "function deposit(uint256,address)", "function redeem(uint256,address,address)"]);
  const ap = encodeCurvanceStep("approve", { amountRaw: "5000000", piggyAddress: PIGGY.address }).call;
  assert.deepEqual(decodeFunctionData({ abi, data: ap.data }).args, [E.vault, 5000000n]);
  assert.equal(ap.to, E.asset.address);
  const de = encodeCurvanceStep("deposit", { amountRaw: "5000000", piggyAddress: PIGGY.address }).call;
  assert.deepEqual(decodeFunctionData({ abi, data: de.data }).args, [5000000n, PIGGY.address]);
  assert.equal(de.to, E.vault);
  const rd = encodeCurvanceStep("redeem", { heldSharesRaw: M.realizedDepositSharesRaw, piggyAddress: PIGGY.address }).call;
  assert.deepEqual(decodeFunctionData({ abi, data: rd.data }).args, [4829898n, PIGGY.address, PIGGY.address]);
  assert.equal(rd.to, E.vault);
  for (const c of [ap, de, rd]) { assert.equal(c.value, "0"); assert.ok(Object.isFrozen(c)); }
});

await check("E3 call arguments match the older harness (deposit receiver=Piggy; redeem whole shares, receiver=owner=Piggy) (SKIP if absent)", () => {
  if (!existsSync(CURVANCE_HARNESS_OLD)) return "SKIP";
  const h = readFileSync(CURVANCE_HARNESS_OLD, "utf8");
  assert.match(h, /functionName: "deposit", args: \[AMOUNT, PIGGY\]/);
  assert.match(h, /functionName: "redeem", args: \[a1\.c, PIGGY, PIGGY\]/);
  assert.equal(CURVANCE_FIELDS.redeemAmount.value, "whole_position");
  // the old harness approved AMOUNT * 2; exactness comes from the newer run, and the module only ever approves exactly
  assert.match(h, /args: \[CUSDC, AMOUNT \* 2n\]/);
  assert.equal(encodeCurvanceStep("approve", { amountRaw: "5000000", piggyAddress: PIGGY.address }).call.amountRaw, "5000000");
});

await check("E4 nothing borrowed: no Aave / Neverland / lane import, address, gas or revert reason; old A-480 gas not used", () => {
  assert.equal(/mainnet-job-(aave|lane|neverland|kintsu)|LANE_|NEVERLAND_|getReserveData|POOL_ABI|ERC20_ABI|aToken|supply\(/.test(CODE), false);
  assert.equal(/0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef|0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585|0x35a73BAcb179d3740395A3ceCc87FF2e581d6042|\b197122\b|\b177464\b|\b287893\b|\b236348\b|0x47bc4b2c/i.test(SRC(MODULE)), false);
  // A-480's stale-block gas (135433 / 142495) and its 30-day time-warped figures are not this run's facts
  assert.equal(/\b135433\b|\b142495\b|4\.837|5\.020637|5\.000003|106616273/.test(SRC(MODULE)), false);
});

await check("E5 no invented timing: no cooldown / holding period number, no 20-minute figure, no clock", () => {
  const all = JSON.stringify({ CURVANCE_FORK_EVIDENCE, CURVANCE_FIELDS, CURVANCE_STEPS });
  assert.equal(/cooldown|minutes?"|hours?"|days?"|seconds?"|interval"\s*:\s*\d|eta"\s*:\s*"?\d|delay/i.test(all), false);
  assert.equal(/\b(1200|14400|86400|604800|3600|2592000)\b|\*\s*60\s*\*|\b20\s*min|\b20-minute|\b30\s*d|setTimeout|setInterval|Date\.now|cooldown/i.test(CODE), false);
  for (const f of ["exitTiming", "holdingPeriod"]) assert.equal(curvanceField(f), "UNKNOWN", f);
  assert.ok(E.unknown.includes("real_world_exit_timing") && E.unknown.includes("holding_period_applicability"));
  assert.equal(E.exitObserved, "whole_position_next_block_no_time_warp");
});

// ── Part M · measured, never 1:1 ───────────────────────────────────────────────────────────────────────
await check("M1 fork measurements: shares received != USDC sent; preview != realized on deposit; gaps are computed from measurements", () => {
  assert.notEqual(M.realizedDepositSharesRaw, E.sentRaw);
  assert.notEqual(M.previewDepositSharesRaw, M.previewDepositInputRaw);
  assert.notEqual(M.previewDepositSharesRaw, M.realizedDepositSharesRaw);
  assert.equal(curvancePreviewGap(M.previewDepositSharesRaw, M.realizedDepositSharesRaw).gapRaw, M.depositPreviewGapRaw);
  assert.equal(curvancePreviewGap(M.previewRedeemAllRaw, M.realizedRedeemAssetsRaw).gapRaw, M.redeemPreviewGapRaw);
  assert.equal(M.depositPreviewGapRaw, "136");
  // signed both ways, and refused on non-measurements (no number is guessed)
  assert.equal(curvancePreviewGap("1", "3").gapRaw, "-2");
  for (const [a, b] of [["1.0", "1"], [1, "1"], ["1", null], [undefined, "1"], ["-1", "1"], [{ toString: () => "1" }, "1"]]) assert.equal(curvancePreviewGap(a, b).error, "measurement_not_exact", `${String(a)}/${String(b)}`);
  assert.equal(M.realizedRedeemAssetsRaw, E.returnedRaw);
  assert.equal(M.maxRedeemRaw, E.sharesAfterEntryRaw);
});

await check("M2 share quote: UNKNOWN without a measured preview of exactly this amount; never the USDC amount, never scaled; realized stays UNKNOWN", () => {
  for (const amountRaw of ["1", "4000000", "5000000"]) {
    const q = curvanceShareQuote({ amountRaw });
    assert.equal(q.previewSharesRaw, "UNKNOWN"); assert.notEqual(q.previewSharesRaw, amountRaw);
    assert.equal(q.basis, "unmeasured"); assert.equal(q.error, "no_measured_preview");
  }
  // a measurement of another amount is not scaled to this one (that would assume a linear share price)
  const other = curvanceShareQuote({ amountRaw: "2500000", measuredPreview: { inputRaw: M.previewDepositInputRaw, previewSharesRaw: M.previewDepositSharesRaw, blockNumber: E.block } });
  assert.equal(other.previewSharesRaw, "UNKNOWN"); assert.equal(other.error, "preview_amount_mismatch");
  for (const bad of [{ inputRaw: "5000000", previewSharesRaw: "4830034" }, { inputRaw: "5000000", previewSharesRaw: "4830034", blockNumber: "108999816" }, { inputRaw: "5000000", previewSharesRaw: 4830034, blockNumber: 1 }, [], "x"]) {
    const q = curvanceShareQuote({ amountRaw: "5000000", measuredPreview: bad });
    assert.equal(q.previewSharesRaw, "UNKNOWN", JSON.stringify(bad));
  }
  const q = curvanceShareQuote({ amountRaw: "5000000", measuredPreview: { inputRaw: M.previewDepositInputRaw, previewSharesRaw: M.previewDepositSharesRaw, blockNumber: E.block } });
  assert.equal(q.basis, "measured_preview"); assert.equal(q.previewSharesRaw, "4830034"); assert.equal(q.previewBlock, E.block);
  for (const x of [q, other, curvanceShareQuote({ amountRaw: "1" }), curvanceShareQuote(null)]) {
    assert.equal(x.realizedSharesRaw, "UNKNOWN"); assert.equal(x.minSharesOut, "UNKNOWN"); assert.equal(x.freshness, "UNKNOWN");
    assert.equal(x.sharesAssumedEqualToAmount, false); assert.equal(x.action, "none"); assert.equal(x.actionCount, 0); assert.ok(Object.isFrozen(x));
  }
  assert.equal(curvanceShareQuote({ amountRaw: "5000001" }).error, "amount_above_fork_proven_size");
  assert.equal(curvanceShareQuote({ amountRaw: "5.0" }).error, "amount_not_exact");
});

await check("M3 encoder / request never put a share or USDC-out number in from the amount: expected out is UNKNOWN; redeem needs measured held shares", () => {
  const de = encodeCurvanceStep("deposit", { amountRaw: "5000000", piggyAddress: PIGGY.address }).call;
  assert.equal(de.expectedSharesRaw, "UNKNOWN"); assert.equal(de.minSharesOut, "UNKNOWN");
  const rd = encodeCurvanceStep("redeem", { heldSharesRaw: "4829898", piggyAddress: PIGGY.address }).call;
  assert.equal(rd.expectedAssetsRaw, "UNKNOWN"); assert.equal(rd.sharesRaw, "4829898");
  // the redeem's share count is the caller's measurement, never derived from USDC: no held shares -> refused
  for (const heldSharesRaw of [undefined, null, "", "0", "4.8", 4829898, { toString: () => "1" }]) assert.equal(encodeCurvanceStep("redeem", { heldSharesRaw, piggyAddress: PIGGY.address }).error, "held_shares_not_measured", String(heldSharesRaw));
  assert.equal(encodeCurvanceStep("redeem", { amountRaw: "5000000", piggyAddress: PIGGY.address }).error, "held_shares_not_measured");
  const req = curvancePermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", eventId: "e" }).request;
  assert.equal(req.expectedSharesRaw, "UNKNOWN"); assert.equal(req.amountDisplay, "5.000000 USDC");
  assert.equal(/cUSDC|share/i.test(req.amountDisplay), false);
  // the source contains no USDC->share or share->USDC conversion
  assert.equal(/convertTo(Shares|Assets)|previewDeposit\s*\(|previewRedeem\s*\(|sharesRaw\s*[:=]\s*(amount|exact)|\*\s*BigInt\(M|\/\s*BigInt\(/.test(CODE), false);
});

// ── Part U · unknowns are UNKNOWN / action 0 ────────────────────────────────────────────────────────────
await check("U1 every unproven field reads UNKNOWN; unlisted and prototype names read UNKNOWN; tables are frozen", () => {
  assert.deepEqual([...CURVANCE_UNKNOWN_FIELDS].sort(), ["depositCap", "eligibilityPolicy", "exitLiquidity", "exitTiming", "expectedAssetsBack", "expectedShares", "feeCap", "feeOrHaircut", "freshnessWindow", "gasFeeUsd", "holdingPeriod", "minSharesOut", "sharePrice", "supplyRate"]);
  for (const f of CURVANCE_UNKNOWN_FIELDS) { assert.equal(curvanceField(f), "UNKNOWN", f); assert.equal(CURVANCE_FIELDS[f].value, "UNKNOWN", f); }
  assert.equal(curvanceField("vault"), E.vault); assert.equal(curvanceField("vaultCodeKeccak"), E.vaultCodeKeccak);
  for (const f of ["constructor", "__proto__", "toString", "hasOwnProperty", "cooldown", "apr", "", null, undefined, 1, {}, { toString: () => "vault" }]) assert.equal(curvanceField(f), "UNKNOWN", String(f));
  for (const o of [E, M, CURVANCE_FIELDS, CURVANCE_STEPS, CURVANCE_STAGE, CURVANCE_UNKNOWN_FIELDS, CURVANCE_UNPROVEN_STEPS, E.gasUsed, E.unknown, CURVANCE_FIELDS.depositCap, CURVANCE_STEPS.redeemPartial]) assert.ok(Object.isFrozen(o));
  assert.throws(() => { "use strict"; CURVANCE_FIELDS.depositCap.proof = CURVANCE_PROOF.PROVEN_FORK; });
  assert.throws(() => { "use strict"; M.depositPreviewGapRaw = "0"; });
  assert.equal(curvanceField("depositCap"), "UNKNOWN");
});

await check("U1b readiness names every UNKNOWN field and every unproven step as its own blocker, even with a forged lane profile and a fork executor", () => {
  // The gate refuses at the first UNKNOWN; readiness lists every UNKNOWN by name, so each one is individually load-bearing.
  const r = curvanceReadiness({ profile: { ...MAINNET, jobId: CURVANCE_JOB_ID }, piggy: PIGGY, executor: FORK_EXECUTOR });
  for (const f of CURVANCE_UNKNOWN_FIELDS) assert.ok(r.blockedBy.includes(`unknown_field:${f}`), f);
  for (const s of CURVANCE_UNPROVEN_STEPS) assert.ok(r.blockedBy.includes(`unproven_step:${s}`), s);
  assert.equal(r.ready, false); assert.equal(r.actionCount, 0);
});

const PROFILES = [
  ["blocked", BLOCKED], ["testnet", TESTNET], ["real mainnet (aave job)", MAINNET], ["null", null], ["undefined", undefined],
  ["forged curvance job", { ...MAINNET, jobId: CURVANCE_JOB_ID }],
  ["forged curvance live", { ...MAINNET, jobId: CURVANCE_JOB_ID, liveExecution: true }],
  ["forged curvance liveExecution 'false'", { ...MAINNET, jobId: CURVANCE_JOB_ID, liveExecution: "false" }],
  ["forged curvance no usdc", { ...MAINNET, jobId: CURVANCE_JOB_ID, usdc: null }],
  ["forged curvance other chain", { ...MAINNET, jobId: CURVANCE_JOB_ID, numericChainId: 1 }],
];
const EXECUTORS = [["none", undefined], ["null", null], ["live", LIVE_EXECUTOR], ["fork wrong chain", { ...FORK_EXECUTOR, chainId: 1 }], ["fork no block", { ...FORK_EXECUTOR, forkBlock: "x" }], ["fork ok", FORK_EXECUTOR]];
const PIGGIES = [["valid", PIGGY], ["null", null], ["undefined", undefined], ["no address", { id: "p" }], ["array address", { id: "p", address: [PIGGY.address] }], ["string", "piggy"]];
const STEPS = [...Object.keys(CURVANCE_STEPS), "supply", "approveUnlimited", "constructor", "__proto__", null, 1, { toString: () => "approve" }, new String("approve")];

await check("U2 gate: every step x profile x executor x Piggy is refused, action none, count 0, never live or permitted", () => {
  let n = 0;
  const reasons = new Set();
  for (const step of STEPS) for (const [pl, profile] of PROFILES) for (const [el, executor] of EXECUTORS) for (const [gl, piggy] of PIGGIES) {
    const g = curvanceExecutionGate({ profile, piggy, executor, step });
    const tag = `${String(step)}/${pl}/${el}/${gl}`;
    assert.equal(g.allowed, false, tag); assert.equal(g.action, "none", tag); assert.equal(g.actionCount, 0, tag);
    assert.equal(g.liveExecution, false, tag); assert.equal(g.executionPermission, false, tag); assert.ok(Object.isFrozen(g), tag);
    assert.equal(typeof g.reason, "string", tag);
    reasons.add(g.reason); n += 1;
  }
  for (const bad of [undefined, null, 0, "x", []]) assert.equal(curvanceExecutionGate(bad).allowed, false);
  assert.ok(n >= 3000, `combinations ${n}`);
  const furthest = curvanceExecutionGate({ profile: { ...MAINNET, jobId: CURVANCE_JOB_ID }, piggy: PIGGY, executor: FORK_EXECUTOR, step: "deposit" });
  assert.equal(furthest.reason, `unknown_field:${CURVANCE_UNKNOWN_FIELDS[0]}`);
  for (const r of ["profile_blocked", "profile_not_curvance_lane", "live_execution_disabled", "asset_not_in_profile", "missing_piggy_address", "no_executor", "executor_chain_mismatch", "unproven_step:redeemPartial", "unproven_step:withdraw", "unproven_step:mint", "unknown_step"]) assert.ok(reasons.has(r), r);
});

await check("U3 readiness: never READY / executable / permitted / live under any forged stage, profile, executor or claimed numbers", () => {
  const forged = [undefined, "redeemed", "holding_shares", "ready", "READY", "returned", null, 7, {}, "__proto__"];
  for (const stage of forged) for (const [, profile] of PROFILES) for (const [, executor] of EXECUTORS) {
    const r = curvanceReadiness({ stage, profile, executor, piggy: PIGGY, depositCap: "999", exitLiquidity: "999", sharePrice: "1", ready: true, liveExecution: true });
    for (const k of ["ready", "executable", "executionPermission", "createsPermission", "liveExecution", "sharesAssumedEqualToAmount"]) assert.equal(r[k], false, `${k} ${String(stage)}`);
    assert.equal(r.action, "none"); assert.equal(r.actionCount, 0); assert.equal(r.decision, "unknown");
    for (const f of CURVANCE_UNKNOWN_FIELDS) assert.ok(r.blockedBy.includes(`unknown_field:${f}`), f);
    for (const s of ["redeemPartial", "withdraw", "mint"]) assert.ok(r.blockedBy.includes(`unproven_step:${s}`), s);
    assert.ok(r.blockedBy.includes("live_execution_disabled") && r.blockedBy.includes("curvance_lane_not_wired"));
    assert.ok(Object.values(CURVANCE_STAGE).includes(r.stage));
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.blockedBy));
  }
  assert.equal(curvanceReadiness({ stage: "ready" }).stage, CURVANCE_STAGE.UNKNOWN);
  for (const bad of [undefined, null, 0, "x"]) assert.equal(curvanceReadiness(bad).ready, false);
  assert.equal(curvanceReadiness().evidenceClass, "PASS_FORK_SIM");
});

await check("U4 stage machine: only the fork-proven path approve -> deposit -> redeem; unproven / unknown answer an error", () => {
  assert.deepEqual(curvanceStageAfter(CURVANCE_STAGE.NONE, "approve"), { stage: CURVANCE_STAGE.APPROVED, error: null });
  assert.deepEqual(curvanceStageAfter(CURVANCE_STAGE.APPROVED, "deposit"), { stage: CURVANCE_STAGE.DEPOSITED, error: null });
  assert.deepEqual(curvanceStageAfter(CURVANCE_STAGE.DEPOSITED, "redeem"), { stage: CURVANCE_STAGE.REDEEMED, error: null });
  for (const s of ["redeemPartial", "withdraw", "mint"]) assert.equal(curvanceStageAfter(CURVANCE_STAGE.DEPOSITED, s).error, `unproven_step:${s}`);
  assert.equal(curvanceStageAfter(CURVANCE_STAGE.NONE, "deposit").error, "step_not_valid_from_stage");
  assert.equal(curvanceStageAfter(CURVANCE_STAGE.REDEEMED, "redeem").error, "step_not_valid_from_stage");
  assert.equal(curvanceStageAfter(CURVANCE_STAGE.UNKNOWN, "redeem").error, "unknown_stage");
  assert.equal(curvanceStageAfter("ready", "approve").error, "unknown_stage");
  for (const s of ["supply", "constructor", "__proto__", null, new String("approve"), { toString: () => "approve" }]) assert.equal(curvanceStageAfter(CURVANCE_STAGE.NONE, s).error, "unknown_step");
  assert.deepEqual([...CURVANCE_UNPROVEN_STEPS], ["redeemPartial", "withdraw", "mint"]);
});

await check("U5 encoder: exact amounts within the fork-proven size; no unlimited approve; no partial redeem; shares within the fork position; malformed refused", () => {
  const ok = { piggyAddress: PIGGY.address };
  for (const amountRaw of ["0", "", "-1", "5.0", "1e6", " 5000000", 5000000, 5000000n, null, undefined, ["5000000"], { toString: () => "5000000" }]) {
    for (const step of ["approve", "deposit"]) assert.equal(encodeCurvanceStep(step, { ...ok, amountRaw }).error, "amount_not_exact", `${step} ${String(amountRaw)}`);
  }
  assert.equal(CURVANCE_FORK_SIZE_RAW, "5000000"); assert.equal(CURVANCE_FORK_SHARES_RAW, "4829898");
  for (const amountRaw of ["5000001", maxUint256.toString()]) {
    assert.equal(encodeCurvanceStep("approve", { ...ok, amountRaw }).error, "amount_above_fork_proven_size");
    assert.equal(encodeCurvanceStep("deposit", { ...ok, amountRaw }).error, "amount_above_fork_proven_size");
  }
  const shareCap = 4829898n * 10100n / 10000n;
  for (const heldSharesRaw of [(shareCap + 1n).toString(), "5000000", maxUint256.toString()]) assert.equal(encodeCurvanceStep("redeem", { ...ok, heldSharesRaw }).error, "shares_above_fork_proven_position");
  // a partial redeem (shares != the whole measured position) is unproven
  for (const sharesRaw of ["1", "4829897", "4829899", maxUint256.toString(), "max", 0, ""]) assert.equal(encodeCurvanceStep("redeem", { ...ok, heldSharesRaw: "4829898", sharesRaw }).error, "unproven_step:redeemPartial", String(sharesRaw));
  assert.equal(encodeCurvanceStep("redeem", { ...ok, heldSharesRaw: "100", sharesRaw: "100" }).call.sharesRaw, "100");
  for (const step of ["redeemPartial", "withdraw", "mint"]) assert.equal(encodeCurvanceStep(step, { ...ok, amountRaw: "1", heldSharesRaw: "1" }).error, `unproven_step:${step}`);
  for (const piggyAddress of [undefined, null, "", "0x1", [PIGGY.address], { toString: () => PIGGY.address }, new String(PIGGY.address)]) {
    for (const step of ["approve", "deposit", "redeem"]) assert.equal(encodeCurvanceStep(step, { amountRaw: "1", heldSharesRaw: "1", piggyAddress }).error, "missing_piggy_address", step);
  }
  for (const args of [undefined, null, "x", 1, [PIGGY.address]]) assert.equal(encodeCurvanceStep("deposit", args).call, null);
  for (const step of ["supply", "constructor", "__proto__", new String("deposit"), null]) assert.equal(encodeCurvanceStep(step, { ...ok, amountRaw: "1" }).error, "unknown_step");
  let reads = 0;
  const tricky = { get amountRaw() { reads += 1; return reads === 1 ? "1" : "999999999999"; }, piggyAddress: PIGGY.address };
  const c = encodeCurvanceStep("approve", tricky).call;
  assert.equal(reads, 1); assert.equal(c.amountRaw, "1");
});

// ── Part R · reuse of the shared guards ────────────────────────────────────────────────────────────────
await check("R1 imports the shared exact-amount / address / executor-refusal / binding / nonce helpers and defines no copies", () => {
  assert.match(SRC(MODULE), /import \{ ADDR, executorRefusal, formatUnits, isDigits, lower \} from "\.\/mainnet-job-common\.js";/);
  assert.match(SRC(MODULE), /import \{ bindRecordToProfile, chainMatchesExecutor, isProfileActive \} from "\.\/chain-profile\.js";/); // pre-A-965: no chainMatchesExecutor (the permission chain line now asks it)
  assert.match(SRC(MODULE), /import \{ permissionNonce \} from "\.\/permission-envelope\.js";/);
  assert.equal(/0x\[0-9a-fA-F\]\{40\}|\^\\d\+\$|function (executorRefusal|bindRecordToProfile|permissionNonce|isDigits|formatUnits|isProfileActive)\b|kind\s*!==\s*"local_fork"/.test(CODE), false);
});

await check("R2 the gate's executor refusals are exactly the shared executorRefusal's answers", () => {
  const profile = { ...MAINNET, jobId: CURVANCE_JOB_ID };
  for (const [label, executor] of EXECUTORS) {
    const shared = COMMON.executorRefusal(profile, executor);
    const g = curvanceExecutionGate({ profile, piggy: PIGGY, executor, step: "approve" });
    if (shared) assert.equal(g.reason, shared, label);
    else assert.equal(g.reason, `unknown_field:${CURVANCE_UNKNOWN_FIELDS[0]}`, label);
  }
});

await check("R3 permission request: exact shape authorize() compares, nonce from permissionNonce, issues nothing, binds via chain-profile", () => {
  const { request, error } = curvancePermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", eventId: "evt-1" });
  assert.equal(error, null);
  assert.equal(request.permission, null); assert.equal(request.createsPermission, false); assert.ok(Object.isFrozen(request));
  assert.equal(request.action, CURVANCE_ACTION); assert.equal(request.asset, "USDC"); assert.equal(request.amount, "5000000");
  assert.equal(request.destination, E.vault); assert.equal(request.chain, MAINNET.scope);
  const fields = { piggyId: PIGGY.id, signerAddress: PIGGY.address, action: CURVANCE_ACTION, asset: "USDC", amount: "5000000", chain: MAINNET.scope, destination: E.vault };
  assert.equal(request.nonce, permissionNonce({ ...fields, at: "evt-1" }));
  const nowMs = 1_000_000;
  const { envelope } = issuePermission({ intent: request, auth: { method: "passkey", verified: true, verifiedAt: nowMs }, nonce: request.nonce, nowMs });
  const context = { selectedPiggyId: PIGGY.id, selectedPiggyAddress: PIGGY.address, activeSignerAddress: PIGGY.address };
  assert.equal(authorize(envelope, request, { nowMs, context }).ok, true);
  assert.equal(authorize(envelope, { ...request, amount: "4999999" }, { nowMs, context }).reason, "amount_mismatch");
  // a share count in place of the USDC amount is a different request
  assert.equal(authorize(envelope, { ...request, amount: M.realizedDepositSharesRaw }, { nowMs, context }).reason, "amount_mismatch");
  assert.equal(authorize(envelope, { ...request, destination: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585" }, { nowMs, context }).reason, "destination_mismatch");
  assert.equal(curvancePermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000001" }).error, "amount_above_fork_proven_size");
  assert.equal(curvancePermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5.0" }).error, "amount_not_exact");
  assert.equal(curvancePermissionRequest({ profile: TESTNET, piggy: PIGGY, amountRaw: "1" }).error, "profile_chain_not_curvance_evidence");
  assert.equal(curvancePermissionRequest({ profile: BLOCKED, piggy: PIGGY, amountRaw: "1" }).error, "profile_blocked");
  assert.equal(curvancePermissionRequest({ profile: { ...MAINNET, usdc: { symbol: "USDC", address: PIGGY.address, decimals: 6 } }, piggy: PIGGY, amountRaw: "1" }).error, "profile_asset_not_curvance_evidence");
  assert.equal(curvancePermissionRequest({ profile: MAINNET, piggy: { id: "p", address: [PIGGY.address] }, amountRaw: "1" }).error, "missing_piggy_address");
  for (const bad of [undefined, null, "x"]) assert.equal(curvancePermissionRequest(bad).request, null);
  assert.equal(curvancePermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "1" }).request.nonce.endsWith("|UNKNOWN_EVENT"), true);
});

// ── Part S · source boundaries / live off ──────────────────────────────────────────────────────────────
await check("S1 no send / sign / storage / network / timers / executor construction / permission issuing in the module", () => {
  assert.equal(/\.sendTransaction\s*\(|\.sendRawTransaction\s*\(|\bexecutor\s*\.\s*send\s*\(|\.send\s*\(|executeMoneyStep|money-executor|signTransaction|signMessage|privateKey|mnemonic|walletClient|createWalletClient|createPublicClient|fetch\(|localStorage|sessionStorage|setItem|getItem|setTimeout|setInterval|issuePermission|authorize\(|consume\(|eth_|rpcUrl|http|readContract/.test(CODE), false);
  assert.equal(/kind\s*:\s*"local_fork"|local_fork/.test(SRC(MODULE)), false);
  assert.equal(/(allowed|ready|executable|executionPermission|createsPermission|liveExecution|returnComplete|sharesAssumedEqualToAmount)\s*:\s*true|actionCount\s*:\s*[1-9]|action\s*:\s*"(?!none")/.test(CODE), false);
});

await check("S2 live stays off: lane config unchanged, nothing in the product imports this module, no writer ABI under abi/", () => {
  assert.deepEqual({ ...MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
  assert.equal(MAINNET.liveExecution, false);
  assert.notEqual(MAINNET.jobId, CURVANCE_JOB_ID);
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js") && x !== MODULE);
  // [A-977 RE-PIN] the lane's fork Job section imports the module (fork profile only). pre-A-977: []
  // assert.deepEqual(files.filter((f) => /mainnet-job-curvance/.test(SRC(f))), []); // pre-A-977
  assert.deepEqual(files.filter((f) => /mainnet-job-curvance/.test(SRC(f))), ["mainnet-job-lane.js"]);
  assert.equal(existsSync(path.join(SRC_DIR, "abi", MODULE)), false, "no writer ABI under abi/ (second-current-reader forbids it)");
});

await check("S3 hygiene: no private path, card id or yield / venue / safe / instant / immediate wording in the shipped module", () => {
  const src = SRC(MODULE);
  assert.equal(PRIVATE_RE.test(src) || /receipts\//.test(src), false);
  assert.equal(/\bA-\d{3}\b/.test(src), false);
  assert.equal(/\b(apy|apr|yield|venue|earn)\b|["'`>](safe|instant|immediate)\b/i.test(strip(src)), false);
  assert.equal(/\bcash\b|receiptOnly|receipt_only/i.test(src), false);
});

console.log(`\n${pass}/${pass + fail} PASS${skip ? ` (${skip} SKIP)` : ""}`);
process.exit(fail === 0 ? 0 : 1);
