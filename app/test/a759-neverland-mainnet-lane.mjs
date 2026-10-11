// Second mainnet W3-N: a fail-closed, evidence-bounded Neverland USDC local model.
//   node app/test/a759-neverland-mainnet-lane.mjs
// Node only, no network: `fetch` is replaced by a thrower. Nothing here sends, signs or reads a chain.
//
// Part E (evidence): every fact the module encodes equals the fork run record (cross-checked against the raw
//   record when it is present), selectors are derived from the recorded signatures, and nothing is borrowed
//   from the Aave Job.
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

import * as NV from "../src/mainnet-job-neverland.js";
import * as COMMON from "../src/mainnet-job-common.js";
import { MAINNET_LANE_CONFIG } from "../src/mainnet-job-lane.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { authorize, issuePermission, permissionNonce } from "../src/permission-envelope.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const {
  NEVERLAND_ACTION, NEVERLAND_FIELDS, NEVERLAND_FORK_EVIDENCE, NEVERLAND_FORK_SIZE_RAW, NEVERLAND_JOB_ID, NEVERLAND_PROOF,
  NEVERLAND_STAGE, NEVERLAND_STEPS, NEVERLAND_UNKNOWN_FIELDS, NEVERLAND_UNPROVEN_STEPS,
  encodeNeverlandStep, neverlandExecutionGate, neverlandField, neverlandPermissionRequest, neverlandReadiness, neverlandStageAfter,
} = NV;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const MODULE = "mainnet-job-neverland.js";
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const CODE = strip(SRC(MODULE));
const MAINNET = resolveChainProfile("monad-mainnet");
const TESTNET = resolveChainProfile("monad-testnet");
const BLOCKED = resolveChainProfile("nonsense-profile");
const PIGGY = { id: "piggy-1", address: "0x1111111111111111111111111111111111111111" };
const FORK_EXECUTOR = { kind: "local_fork", chainId: 143, forkBlock: 108999816, send: async () => { throw new Error("no send in this suite"); }, receipt: async () => null };
const LIVE_EXECUTOR = { ...FORK_EXECUTOR, kind: "live" };
const NEVERLAND_RAW = privatePath("ops/receipts/A652_mainnet_fork_lab/raw/neverland-usdc.json");
const NEVERLAND_HARNESS_OLD = privatePath("ops/receipts/A480_fork_lab/G_neverland/run.mjs");

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
  if (!existsSync(NEVERLAND_RAW)) return "SKIP";
  const raw = JSON.parse(readFileSync(NEVERLAND_RAW, "utf8"));
  const E = NEVERLAND_FORK_EVIDENCE;
  assert.equal(raw.label, E.label);
  assert.equal(raw.chainId, E.chainId);
  assert.equal(raw.block.number, E.block);
  assert.equal(raw.block.timestampIso.replace(".000Z", "Z"), E.blockTimestamp);
  assert.equal(raw.contracts.pool.address, E.pool);
  assert.equal(raw.contracts.pool.codeBytes, E.poolCodeBytes);
  assert.deepEqual({ ...E.asset }, { symbol: raw.contracts.usdc.symbol, address: raw.contracts.usdc.address, decimals: raw.contracts.usdc.decimals });
  assert.deepEqual({ ...E.receiptToken }, { ...raw.contracts.receiptToken });
  assert.equal(raw.reserve.aTokenAddress, E.receiptToken.address);
  assert.equal(raw.reserve.matchesRepoEvidence, true);
  assert.equal(raw.roundTrip.sentRaw, E.sentRaw);
  assert.equal(raw.roundTrip.returnedRaw, E.returnedRaw);
  assert.equal(raw.roundTrip.deltaRaw, E.deltaRaw);
  assert.equal(raw.allowance.afterEntry, E.allowanceAfterEntryRaw);
  assert.equal(raw.allowance.approvedExact, "5");
  assert.equal(raw.balances.sharesAfterEntry, E.receiptAfterEntry);
  assert.match(raw.roundTrip.timeWarp, /^none/);
  const byStep = Object.fromEntries(raw.steps.map((s) => [s.step, s]));
  const map = { approve: "1a_approve", supply: "1b_supply", withdraw: "2_withdraw_immediate" };
  for (const [k, rawId] of Object.entries(map)) {
    const s = byStep[rawId];
    const m = NEVERLAND_STEPS[k];
    assert.equal(s.status, "success", k);
    assert.equal(s.signature, m.signature, k);
    assert.equal(s.selector, m.selector, k);
    assert.equal(Number(s.gasUsed), m.gasUsed, k);
    assert.equal(Number(s.gasUsed), E.gasUsed[k], k);
    assert.equal(s.to, m.target === "pool" ? E.pool : E.asset.address, k);
  }
  assert.match(byStep["2_withdraw_immediate"].label, /withdraw\(max\) next block, no time warp/);
  const probe = byStep["3_probe_withdraw_zero"];
  assert.equal(probe.status, E.revertProbe.status);
  assert.equal(probe.estimateError.message, `execution reverted: ${E.revertProbe.reason}`);
  assert.equal(E.revertProbe.name, "UNKNOWN");
  // the run's own Piggy stand-in is the sender of every user step: the supply and withdraw act for it
  for (const id of Object.values(map)) assert.equal(byStep[id].from, byStep["1a_approve"].from);
});

await check("E2 selectors are the recorded signatures' own selectors; calldata decodes back to exactly the recorded call shape", () => {
  for (const [k, s] of Object.entries(NEVERLAND_STEPS)) assert.equal(toFunctionSelector(`function ${s.signature}`), s.selector, k);
  const abi = parseAbi(["function approve(address,uint256)", "function supply(address,uint256,address,uint16)", "function withdraw(address,uint256,address)"]);
  const ap = encodeNeverlandStep("approve", { amountRaw: "5000000", piggyAddress: PIGGY.address }).call;
  assert.deepEqual(decodeFunctionData({ abi, data: ap.data }).args, [NEVERLAND_FORK_EVIDENCE.pool, 5000000n]);
  assert.equal(ap.to, NEVERLAND_FORK_EVIDENCE.asset.address);
  const su = encodeNeverlandStep("supply", { amountRaw: "5000000", piggyAddress: PIGGY.address }).call;
  assert.deepEqual(decodeFunctionData({ abi, data: su.data }).args, [NEVERLAND_FORK_EVIDENCE.asset.address, 5000000n, PIGGY.address, 0]);
  assert.equal(su.to, NEVERLAND_FORK_EVIDENCE.pool);
  const wd = encodeNeverlandStep("withdraw", { piggyAddress: PIGGY.address }).call;
  assert.deepEqual(decodeFunctionData({ abi, data: wd.data }).args, [NEVERLAND_FORK_EVIDENCE.asset.address, maxUint256, PIGGY.address]);
  assert.equal(wd.to, NEVERLAND_FORK_EVIDENCE.pool);
  for (const c of [ap, su, wd]) { assert.equal(c.value, "0"); assert.ok(Object.isFrozen(c)); }
});

await check("E3 call arguments match the older harness (supply onBehalfOf=Piggy, referral 0; withdraw max to Piggy) (SKIP if absent)", () => {
  if (!existsSync(NEVERLAND_HARNESS_OLD)) return "SKIP";
  const h = readFileSync(NEVERLAND_HARNESS_OLD, "utf8");
  assert.match(h, /functionName: "supply", args: \[USDC, AMOUNT, PIGGY, 0\]/);
  assert.match(h, /functionName: "withdraw", args: \[USDC, \(1n << 256n\) - 1n, PIGGY\]/);
  assert.equal(NEVERLAND_FIELDS.referralCode.value, 0);
  assert.equal(NEVERLAND_FIELDS.withdrawAmount.value, "whole_position");
});

await check("E4 no Aave fact is borrowed: no Aave/lane import, no Aave addresses, gas, revert selector or reserve decoder", () => {
  assert.equal(/mainnet-job-aave|mainnet-job-lane|LANE_|decodeReserveConfiguration|getReserveData|POOL_ABI|ERC20_ABI|aMonUSDC|aToken/.test(CODE), false);
  // Aave pool, Aave receipt token, Aave gas and Aave revert selector from the Aave Job's own record
  assert.equal(/0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef|0x35a73BAcb179d3740395A3ceCc87FF2e581d6042|\b197122\b|\b177464\b|0x47bc4b2c|NotEnoughAvailableUserBalance/i.test(SRC(MODULE)), false);
  assert.notEqual(NEVERLAND_FORK_EVIDENCE.pool.toLowerCase(), "0x69a5f9ad4f96ebf0a0c792dd42a01cc5c0102fef");
  // the reserve configuration word is not decoded with any layout: its meaning and the reserve flags are UNKNOWN
  assert.equal(neverlandField("reserveFlags"), "UNKNOWN");
  assert.ok(NEVERLAND_FORK_EVIDENCE.unknown.includes("reserve_configuration_meaning"));
});

await check("E5 no invented timing: no cooldown / wait / ETA number, no old 4-hour or 20-minute figure, no clock", () => {
  const all = JSON.stringify({ NEVERLAND_FORK_EVIDENCE, NEVERLAND_FIELDS, NEVERLAND_STEPS });
  assert.equal(/cooldown|minutes?"|hours?"|days?"|seconds?"|interval"\s*:\s*\d|eta"\s*:\s*"?\d|delay/i.test(all), false);
  assert.equal(/\b(1200|14400|86400|604800|3600)\b|\*\s*60\s*\*|\b20\s*min|\b4\s*h(ou)?r|setTimeout|setInterval|Date\.now|cooldown/i.test(CODE), false);
  assert.equal(neverlandField("exitTiming"), "UNKNOWN");
  assert.ok(NEVERLAND_FORK_EVIDENCE.unknown.includes("real_world_exit_timing"));
  assert.equal(NEVERLAND_FORK_EVIDENCE.exitObserved, "whole_position_next_block_no_time_warp");
});

// ── Part U · unknowns are UNKNOWN / action 0 ────────────────────────────────────────────────────────────
await check("U1 every unproven field reads UNKNOWN; unlisted and prototype names read UNKNOWN; tables are frozen", () => {
  assert.deepEqual([...NEVERLAND_UNKNOWN_FIELDS].sort(), ["eligibilityPolicy", "exitLiquidity", "exitTiming", "feeCap", "freshnessWindow", "gasFeeUsd", "reserveFlags", "supplyCap", "supplyRate"]);
  for (const f of NEVERLAND_UNKNOWN_FIELDS) { assert.equal(neverlandField(f), "UNKNOWN", f); assert.equal(NEVERLAND_FIELDS[f].value, "UNKNOWN", f); }
  for (const f of ["constructor", "__proto__", "toString", "hasOwnProperty", "cooldown", "apr", "", null, undefined, 1, {}, { toString: () => "pool" }]) assert.equal(neverlandField(f), "UNKNOWN", String(f));
  for (const o of [NEVERLAND_FORK_EVIDENCE, NEVERLAND_FIELDS, NEVERLAND_STEPS, NEVERLAND_STAGE, NEVERLAND_UNKNOWN_FIELDS, NEVERLAND_UNPROVEN_STEPS, NEVERLAND_FORK_EVIDENCE.gasUsed, NEVERLAND_FIELDS.supplyCap, NEVERLAND_STEPS.withdrawPartial]) assert.ok(Object.isFrozen(o));
  assert.throws(() => { "use strict"; NEVERLAND_FIELDS.supplyCap.proof = NEVERLAND_PROOF.PROVEN_FORK; });
  assert.equal(neverlandField("supplyCap"), "UNKNOWN");
});

const PROFILES = [
  ["blocked", BLOCKED], ["testnet", TESTNET], ["real mainnet (aave job)", MAINNET], ["null", null], ["undefined", undefined],
  ["forged neverland job", { ...MAINNET, jobId: NEVERLAND_JOB_ID }],
  ["forged neverland live", { ...MAINNET, jobId: NEVERLAND_JOB_ID, liveExecution: true }],
  ["forged neverland liveExecution 'false'", { ...MAINNET, jobId: NEVERLAND_JOB_ID, liveExecution: "false" }],
  ["forged neverland no usdc", { ...MAINNET, jobId: NEVERLAND_JOB_ID, usdc: null }],
  ["forged neverland other chain", { ...MAINNET, jobId: NEVERLAND_JOB_ID, numericChainId: 1 }],
];
const EXECUTORS = [["none", undefined], ["null", null], ["live", LIVE_EXECUTOR], ["fork wrong chain", { ...FORK_EXECUTOR, chainId: 1 }], ["fork no block", { ...FORK_EXECUTOR, forkBlock: "x" }], ["fork ok", FORK_EXECUTOR]];
const PIGGIES = [["valid", PIGGY], ["null", null], ["undefined", undefined], ["no address", { id: "p" }], ["array address", { id: "p", address: [PIGGY.address] }], ["string", "piggy"]];
const STEPS = [...Object.keys(NEVERLAND_STEPS), "redeem", "deposit", "approveUnlimited", "constructor", "__proto__", null, 1, { toString: () => "approve" }, new String("approve")];

await check("U2 gate: every step x profile x executor x Piggy is refused, action none, count 0, never live or permitted", () => {
  let n = 0;
  const reasons = new Set();
  for (const step of STEPS) for (const [pl, profile] of PROFILES) for (const [el, executor] of EXECUTORS) for (const [gl, piggy] of PIGGIES) {
    const g = neverlandExecutionGate({ profile, piggy, executor, step });
    const tag = `${String(step)}/${pl}/${el}/${gl}`;
    assert.equal(g.allowed, false, tag); assert.equal(g.action, "none", tag); assert.equal(g.actionCount, 0, tag);
    assert.equal(g.liveExecution, false, tag); assert.equal(g.executionPermission, false, tag); assert.ok(Object.isFrozen(g), tag);
    assert.equal(typeof g.reason, "string", tag);
    reasons.add(g.reason); n += 1;
  }
  for (const bad of [undefined, null, 0, "x", []]) assert.equal(neverlandExecutionGate(bad).allowed, false);
  assert.ok(n >= 3000, `combinations ${n}`);
  // the furthest any input gets is the first UNKNOWN field: the lane is not reachable past it
  const furthest = neverlandExecutionGate({ profile: { ...MAINNET, jobId: NEVERLAND_JOB_ID }, piggy: PIGGY, executor: FORK_EXECUTOR, step: "supply" });
  assert.equal(furthest.reason, `unknown_field:${NEVERLAND_UNKNOWN_FIELDS[0]}`);
  for (const r of ["profile_blocked", "profile_not_neverland_lane", "live_execution_disabled", "asset_not_in_profile", "missing_piggy_address", "no_executor", "executor_chain_mismatch", "unproven_step:withdrawPartial", "unknown_step"]) assert.ok(reasons.has(r), r);
});

await check("U3 readiness: never READY / executable / permitted / live under any forged stage, profile, executor or claimed numbers", () => {
  const forged = [undefined, "withdrawn", "holding_receipt", "ready", "READY", "returned", null, 7, {}, "__proto__"];
  for (const stage of forged) for (const [, profile] of PROFILES) for (const [, executor] of EXECUTORS) {
    const r = neverlandReadiness({ stage, profile, executor, piggy: PIGGY, supplyCap: "999", exitLiquidity: "999", ready: true, liveExecution: true });
    for (const k of ["ready", "executable", "executionPermission", "createsPermission", "liveExecution"]) assert.equal(r[k], false, `${k} ${String(stage)}`);
    assert.equal(r.action, "none"); assert.equal(r.actionCount, 0); assert.equal(r.decision, "unknown");
    for (const f of NEVERLAND_UNKNOWN_FIELDS) assert.ok(r.blockedBy.includes(`unknown_field:${f}`), f);
    assert.ok(r.blockedBy.includes("unproven_step:withdrawPartial"));
    assert.ok(r.blockedBy.includes("live_execution_disabled") && r.blockedBy.includes("neverland_lane_not_wired"));
    assert.ok(Object.values(NEVERLAND_STAGE).includes(r.stage));
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.blockedBy));
  }
  assert.equal(neverlandReadiness({ stage: "ready" }).stage, NEVERLAND_STAGE.UNKNOWN);
  for (const bad of [undefined, null, 0, "x"]) assert.equal(neverlandReadiness(bad).ready, false);
  assert.equal(neverlandReadiness().evidenceClass, "PASS_FORK_SIM");
});

await check("U4 stage machine: only the fork-proven path approve -> supply -> withdraw; unproven / unknown answer an error", () => {
  assert.deepEqual(neverlandStageAfter(NEVERLAND_STAGE.NONE, "approve"), { stage: NEVERLAND_STAGE.APPROVED, error: null });
  assert.deepEqual(neverlandStageAfter(NEVERLAND_STAGE.APPROVED, "supply"), { stage: NEVERLAND_STAGE.SUPPLIED, error: null });
  assert.deepEqual(neverlandStageAfter(NEVERLAND_STAGE.SUPPLIED, "withdraw"), { stage: NEVERLAND_STAGE.WITHDRAWN, error: null });
  assert.equal(neverlandStageAfter(NEVERLAND_STAGE.SUPPLIED, "withdrawPartial").error, "unproven_step:withdrawPartial");
  assert.equal(neverlandStageAfter(NEVERLAND_STAGE.NONE, "supply").error, "step_not_valid_from_stage");
  assert.equal(neverlandStageAfter(NEVERLAND_STAGE.WITHDRAWN, "withdraw").error, "step_not_valid_from_stage");
  assert.equal(neverlandStageAfter(NEVERLAND_STAGE.UNKNOWN, "withdraw").error, "unknown_stage");
  assert.equal(neverlandStageAfter("ready", "approve").error, "unknown_stage");
  for (const s of ["redeem", "constructor", "__proto__", null, new String("approve"), { toString: () => "approve" }]) assert.equal(neverlandStageAfter(NEVERLAND_STAGE.NONE, s).error, "unknown_step");
  assert.deepEqual([...NEVERLAND_UNPROVEN_STEPS], ["withdrawPartial"]);
});

await check("U5 encoder: exact amounts only, within the fork-proven size; no unlimited approve; no partial withdraw; malformed input refused", () => {
  const ok = { piggyAddress: PIGGY.address };
  for (const amountRaw of ["0", "", "-1", "5.0", "1e6", " 5000000", 5000000, 5000000n, null, undefined, ["5000000"], { toString: () => "5000000" }]) {
    for (const step of ["approve", "supply"]) assert.equal(encodeNeverlandStep(step, { ...ok, amountRaw }).error, "amount_not_exact", `${step} ${String(amountRaw)}`);
  }
  assert.equal(NEVERLAND_FORK_SIZE_RAW, "5000000");
  for (const amountRaw of ["5000001", maxUint256.toString(), "115792089237316195423570985008687907853269984665640564039457584007913129639936"]) {
    assert.equal(encodeNeverlandStep("approve", { ...ok, amountRaw }).error, "amount_above_fork_proven_size");
    assert.equal(encodeNeverlandStep("supply", { ...ok, amountRaw }).error, "amount_above_fork_proven_size");
  }
  assert.equal(encodeNeverlandStep("approve", { ...ok, amountRaw: "1" }).call.amountRaw, "1");
  for (const amountRaw of ["1", "4999999", "5000000", "max", 0]) assert.equal(encodeNeverlandStep("withdraw", { ...ok, amountRaw }).error, "unproven_step:withdrawPartial", String(amountRaw));
  assert.equal(encodeNeverlandStep("withdrawPartial", { ...ok, amountRaw: "1" }).error, "unproven_step:withdrawPartial");
  for (const piggyAddress of [undefined, null, "", "0x1", [PIGGY.address], { toString: () => PIGGY.address }, new String(PIGGY.address)]) {
    for (const step of ["approve", "supply", "withdraw"]) assert.equal(encodeNeverlandStep(step, { amountRaw: "1", piggyAddress }).error, "missing_piggy_address", `${step}`);
  }
  for (const args of [undefined, null, "x", 1, [PIGGY.address]]) assert.equal(encodeNeverlandStep("supply", args).call, null);
  for (const step of ["redeem", "deposit", "constructor", "__proto__", new String("supply"), null]) assert.equal(encodeNeverlandStep(step, { ...ok, amountRaw: "1" }).error, "unknown_step");
  // getter read-once: the encoder snapshots its inputs once
  let reads = 0;
  const tricky = { get amountRaw() { reads += 1; return reads === 1 ? "1" : "999999999999"; }, piggyAddress: PIGGY.address };
  const c = encodeNeverlandStep("approve", tricky).call;
  assert.equal(reads, 1); assert.equal(c.amountRaw, "1");
});

// ── Part R · reuse of the shared guards ────────────────────────────────────────────────────────────────
await check("R1 imports the shared exact-amount / address / executor-refusal / binding / nonce helpers and defines no copies", () => {
  assert.match(SRC(MODULE), /import \{ ADDR, executorRefusal, formatUnits, isDigits, lower \} from "\.\/mainnet-job-common\.js";/);
  assert.match(SRC(MODULE), /import \{ bindRecordToProfile, chainMatchesExecutor, isProfileActive \} from "\.\/chain-profile\.js";/); // pre-A-965: no chainMatchesExecutor (the permission chain line now asks it)
  assert.match(SRC(MODULE), /import \{ permissionNonce \} from "\.\/permission-envelope\.js";/);
  assert.equal(/0x\[0-9a-fA-F\]\{40\}|\^\\d\+\$|function (executorRefusal|bindRecordToProfile|permissionNonce|isDigits|formatUnits)\b|kind\s*!==\s*"local_fork"/.test(CODE), false);
});

await check("R2 the gate's executor refusals are exactly the shared executorRefusal's answers", () => {
  const profile = { ...MAINNET, jobId: NEVERLAND_JOB_ID };
  for (const [label, executor] of EXECUTORS) {
    const shared = COMMON.executorRefusal(profile, executor);
    const g = neverlandExecutionGate({ profile, piggy: PIGGY, executor, step: "approve" });
    if (shared) assert.equal(g.reason, shared, label);
    else assert.equal(g.reason, `unknown_field:${NEVERLAND_UNKNOWN_FIELDS[0]}`, label);
  }
});

await check("R3 permission request: exact shape authorize() compares, nonce from permissionNonce, issues nothing, binds via chain-profile", () => {
  const { request, error } = neverlandPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", eventId: "evt-1" });
  assert.equal(error, null);
  assert.equal(request.permission, null); assert.equal(request.createsPermission, false); assert.ok(Object.isFrozen(request));
  assert.equal(request.action, NEVERLAND_ACTION); assert.equal(request.asset, "USDC"); assert.equal(request.amount, "5000000");
  assert.equal(request.destination, NEVERLAND_FORK_EVIDENCE.pool); assert.equal(request.chain, MAINNET.scope);
  assert.equal(request.amountDisplay, "5.000000 USDC");
  const fields = { piggyId: PIGGY.id, signerAddress: PIGGY.address, action: NEVERLAND_ACTION, asset: "USDC", amount: "5000000", chain: MAINNET.scope, destination: NEVERLAND_FORK_EVIDENCE.pool };
  assert.equal(request.nonce, permissionNonce({ ...fields, at: "evt-1" }));
  // compatibility only (the module itself never calls these): an envelope issued for this request authorizes it, and a 1-raw-unit change does not
  const nowMs = 1_000_000;
  const { envelope } = issuePermission({ intent: request, auth: { method: "passkey", verified: true, verifiedAt: nowMs }, nonce: request.nonce, nowMs });
  const context = { selectedPiggyId: PIGGY.id, selectedPiggyAddress: PIGGY.address, activeSignerAddress: PIGGY.address };
  assert.equal(authorize(envelope, request, { nowMs, context }).ok, true);
  assert.equal(authorize(envelope, { ...request, amount: "4999999" }, { nowMs, context }).reason, "amount_mismatch");
  assert.equal(authorize(envelope, { ...request, destination: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef" }, { nowMs, context }).reason, "destination_mismatch");
  // refusals
  assert.equal(neverlandPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000001" }).error, "amount_above_fork_proven_size");
  assert.equal(neverlandPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5.0" }).error, "amount_not_exact");
  assert.equal(neverlandPermissionRequest({ profile: TESTNET, piggy: PIGGY, amountRaw: "1" }).error, "profile_chain_not_neverland_evidence");
  assert.equal(neverlandPermissionRequest({ profile: BLOCKED, piggy: PIGGY, amountRaw: "1" }).error, "profile_blocked");
  assert.equal(neverlandPermissionRequest({ profile: { ...MAINNET, usdc: { symbol: "USDC", address: PIGGY.address, decimals: 6 } }, piggy: PIGGY, amountRaw: "1" }).error, "profile_asset_not_neverland_evidence");
  assert.equal(neverlandPermissionRequest({ profile: MAINNET, piggy: { id: "p", address: [PIGGY.address] }, amountRaw: "1" }).error, "missing_piggy_address");
  for (const bad of [undefined, null, "x"]) assert.equal(neverlandPermissionRequest(bad).request, null);
  assert.equal(neverlandPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "1" }).request.nonce.endsWith("|UNKNOWN_EVENT"), true);
});

// ── Part S · source boundaries / live off ──────────────────────────────────────────────────────────────
await check("S1 no send / sign / storage / network / timers / executor construction / permission issuing in the module", () => {
  assert.equal(/\.sendTransaction\s*\(|\.sendRawTransaction\s*\(|\bexecutor\s*\.\s*send\s*\(|\.send\s*\(|executeMoneyStep|money-executor|signTransaction|signMessage|privateKey|mnemonic|walletClient|createWalletClient|createPublicClient|fetch\(|localStorage|sessionStorage|setItem|getItem|setTimeout|setInterval|issuePermission|authorize\(|consume\(|eth_|rpcUrl|http/.test(CODE), false);
  assert.equal(/kind\s*:\s*"local_fork"|local_fork/.test(SRC(MODULE)), false);
  // no code path can answer yes: the source has no true lock and no non-zero action count
  assert.equal(/(allowed|ready|executable|executionPermission|createsPermission|liveExecution|returnComplete)\s*:\s*true|actionCount\s*:\s*[1-9]|action\s*:\s*"(?!none")/.test(CODE), false);
});

await check("S2 live stays off: lane config unchanged, nothing in the product imports this module, main.js untouched by it", () => {
  assert.deepEqual({ ...MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
  assert.equal(MAINNET.liveExecution, false);
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js") && x !== MODULE);
  // [A-977 RE-PIN] the lane's fork Job section imports the module (fork profile only). pre-A-977: []
  // assert.deepEqual(files.filter((f) => /mainnet-job-neverland/.test(SRC(f))), []); // pre-A-977
  assert.deepEqual(files.filter((f) => /mainnet-job-neverland/.test(SRC(f))), ["mainnet-job-lane.js"]);
  assert.equal(existsSync(path.join(SRC_DIR, "abi", MODULE)), false, "no writer ABI under abi/ (second-current-reader forbids it)");
});

await check("S3 hygiene: no private path, card id or yield / venue / safe / instant wording in the shipped module", () => {
  const src = SRC(MODULE);
  assert.equal(PRIVATE_RE.test(src) || /receipts\//.test(src), false);
  assert.equal(/\bA-\d{3}\b/.test(src), false);
  assert.equal(/\b(apy|apr|yield|venue|earn)\b|["'`>](safe|instant|immediate)\b/i.test(strip(src)), false);
  assert.equal(/\bcash\b|receiptOnly|receipt_only/i.test(src), false);
});

console.log(`\n${pass}/${pass + fail} PASS${skip ? ` (${skip} SKIP)` : ""}`);
process.exit(fail === 0 ? 0 : 1);
