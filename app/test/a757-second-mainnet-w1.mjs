// Second mainnet W1: common / Aave split of the mainnet lane (move-only) + a fail-closed Kintsu local model.
//   node app/test/a757-second-mainnet-w1.mjs
// Node only, no network: `fetch` is replaced by a thrower. Nothing here sends, signs or reads a chain.
//
// Part C (compatibility): mainnet-job-lane.js keeps every public name it had, the Aave names are the very
//   objects mainnet-job-aave.js defines, the shared helpers behave as the lane's own did, the lane still
//   routes its one send through money-executor.js, and live execution stays off.
// Part K (Kintsu): only deposit / requestUnlock / pending / cancel are modelled (fork-proven); submitBatch /
//   redeem / return are unproven and refused; nothing can reach READY, return-complete, permission or live.
// Part S (source): the new modules have no send, sign, storage, network, executor import, invented
//   cooldown, Aave shape (Kintsu) or card id; no other product file imports them except the lane.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, toFunctionSelector } from "viem";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };

import * as LANE from "../src/mainnet-job-lane.js";
import * as AAVE from "../src/mainnet-job-aave.js";
import * as COMMON from "../src/mainnet-job-common.js";
import {
  KINTSU_FORK_EVIDENCE, KINTSU_JOB_ID, KINTSU_PROOF, KINTSU_STAGE, KINTSU_STEPS, KINTSU_UNPROVEN_STEPS,
  encodeKintsuStep, kintsuExecutionGate, kintsuOutcomeWord, kintsuReadiness, kintsuStageAfter, readKintsuPending,
} from "../src/mainnet-job-kintsu.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const NEW_MODULES = ["mainnet-job-common.js", "mainnet-job-aave.js", "mainnet-job-kintsu.js"];
const MAINNET = resolveChainProfile("monad-mainnet");
const PIGGY = { id: "piggy-1", address: "0x1111111111111111111111111111111111111111" };
const FORK_EXECUTOR = { kind: "local_fork", chainId: 143, forkBlock: 108999816, send: async () => { throw new Error("no send in this suite"); }, receipt: async () => null };

let pass = 0;
let fail = 0;
let skip = 0;
async function check(label, fn) {
  try {
    const r = await fn();
    if (r === "SKIP") { console.log(`SKIP  ${label}`); skip += 1; } else { console.log(`PASS  ${label}`); pass += 1; }
  } catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}

// ── Part C · compatibility ──────────────────────────────────────────────────────────────────────────────
// The lane's public surface before the split (33 names). Not one may disappear or change kind.
const LANE_EXPORTS_BEFORE = [
  "EXPLORE_CANDIDATE_STATUS", "LANE_ACTION", "LANE_AMOUNT_CAP_RAW", "LANE_DESTINATION_ID", "LANE_FORK_EVIDENCE", "LANE_JOB_ID",
  "LANE_RECEIPT_TOKEN", "LANE_RULES", "LANE_SELECTORS", "LANE_STAGE", "MAINNET_LANE_CONFIG", "SECOND_LANE_DESCRIPTORS",
  "SECOND_LANE_DESCRIPTOR_SCHEMA", "SECOND_LANE_OPEN_GATES", "SECOND_LANE_STAGE", "acceptAgreedRule", "advanceLaneIntent",
  "buildLanePermissionPreview", "buildLaneReceipt", "decideCurrentCandidate", "decideCurrentCandidates", "decideLane",
  "decodeReserveConfiguration", "describeSecondLaneCandidate", "exploreCandidateRows", "laneIntentKey", "laneReceiptCandidate",
  "loadLaneIntent", "readLanePreAction", "reconcileLaneIntent", "secondLaneDescriptor", "startLaneIntent", "validateSecondLaneDescriptor",
];

await check("C1 mainnet-job-lane.js still exports every name it had (and nothing Kintsu)", () => {
  const now = Object.keys(LANE).sort();
  for (const name of LANE_EXPORTS_BEFORE) assert.ok(now.includes(name), `missing export ${name}`);
  // [A-977 RE-PIN] + the fork Job section's exports (Job 10 on the shared fork). pre-A-977 baseline: exactly LANE_EXPORTS_BEFORE
  // assert.deepEqual(now, [...LANE_EXPORTS_BEFORE].sort(), "the public surface is exactly the same"); // pre-A-977
  const A977_FORK_JOB_EXPORTS = ["FORK_JOB_HELD", "FORK_JOB_KEYS", "FORK_JOB_PARENT_CHAIN", "forkExploreRows", "forkJobForErrand", "forkJobProfile", "forkJobReceiptCandidate", "forkJobRecordKey", "forkJobRow", "forkJobSteps", "forkJobStrictTransport", "runForkJob"];
  assert.deepEqual(now, [...LANE_EXPORTS_BEFORE, ...A977_FORK_JOB_EXPORTS].sort(), "the public surface is the old one + the fork Job section");
  assert.equal(now.some((n) => /kintsu/i.test(n)), false);
});

await check("C2 Aave names re-exported by the lane are the same objects mainnet-job-aave.js defines; values unchanged", () => {
  for (const n of ["LANE_ACTION", "LANE_AMOUNT_CAP_RAW", "LANE_DESTINATION_ID", "LANE_FORK_EVIDENCE", "LANE_JOB_ID", "LANE_RECEIPT_TOKEN", "LANE_SELECTORS", "decodeReserveConfiguration"]) {
    assert.equal(LANE[n], AAVE[n], n);
  }
  assert.equal(LANE.LANE_JOB_ID, "aave-usdc");
  assert.equal(LANE.LANE_AMOUNT_CAP_RAW, "5000000");
  assert.deepEqual({ ...LANE.LANE_RECEIPT_TOKEN }, { symbol: "aMonUSDC", address: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042", decimals: 6 });
  assert.equal(LANE.LANE_FORK_EVIDENCE.block, 108999816);
  assert.equal(LANE.LANE_FORK_EVIDENCE.exit, "immediate");
  for (const [step, sel] of Object.entries(LANE.LANE_SELECTORS)) {
    const abi = [...AAVE.ERC20_ABI, ...AAVE.POOL_ABI].find((f) => f.name === step);
    assert.equal(toFunctionSelector(abi), sel, step);
  }
});

await check("C3 live stays off: MAINNET_LANE_CONFIG reader:null / liveExecution:false; mainnet profile liveExecution false", () => {
  assert.deepEqual({ ...LANE.MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
  assert.equal(Object.isFrozen(LANE.MAINNET_LANE_CONFIG), true);
  assert.equal(MAINNET.liveExecution, false);
  assert.equal(AAVE.isAaveLaneProfile(MAINNET), true);
  assert.equal(AAVE.isAaveLaneProfile(resolveChainProfile("monad-testnet")), false);
});

await check("C4 shared executor refusal = the lane's: only a local fork executor on chain 143 with a pinned block", () => {
  const r = COMMON.executorRefusal;
  assert.equal(r(MAINNET, null), "no_executor");
  assert.equal(r(MAINNET, { kind: "local_fork", chainId: 143, forkBlock: 1, send: 1, receipt: () => null }), "no_executor");
  for (const kind of ["live", "mainnet", "viem_send", "viem_raw", "lane_executor", undefined, "LOCAL_FORK"]) {
    assert.equal(r(MAINNET, { ...FORK_EXECUTOR, kind }), "live_execution_disabled", String(kind));
  }
  assert.equal(r(MAINNET, { ...FORK_EXECUTOR, chainId: 10143 }), "executor_chain_mismatch");
  assert.equal(r(MAINNET, { ...FORK_EXECUTOR, forkBlock: "108999816" }), "executor_chain_mismatch");
  assert.equal(r(MAINNET, FORK_EXECUTOR), null);
});

await check("C5 shared helpers keep the lane's semantics: verified save, fold precedence, formatUnits, stamp history cap", () => {
  const base = createMemoryStorage();
  assert.equal(COMMON.saveRecordVerified(base, "k", { a: 1 }), true);
  const silent = { setItem: () => {}, getItem: () => null };
  assert.equal(COMMON.saveRecordVerified(silent, "k", { a: 1 }), false, "a silently dropped write is not a save");
  assert.equal(COMMON.saveRecordVerified({ setItem: () => { throw new Error("x"); }, getItem: () => null }, "k", {}), false);
  assert.equal(COMMON.saveRecordVerified(base, null, {}), false);
  assert.equal(COMMON.saveRecord(null, "k", {}), false);
  assert.equal(COMMON.saveRecord({ setItem: () => { throw new Error("x"); } }, "k", {}), false);
  const d = (result) => ({ result });
  assert.equal(COMMON.foldDecisions([d("do_it"), d("ask"), d("nah"), d("unknown")]).result, "unknown");
  assert.equal(COMMON.foldDecisions([d("ask"), d("nah")]).result, "nah");
  assert.equal(COMMON.formatUnits(5000000n, 6), "5.000000");
  assert.equal(COMMON.formatUnits(1n, 6), "0.000001");
  let rec = { history: [] };
  for (let i = 0; i < 30; i += 1) rec = COMMON.stampRecord(rec, `s${i}`, `t${i}`);
  assert.equal(rec.history.length, 24);
  assert.equal(rec.stage, "s29");
});

await check("C6 the lane still owns its one send path: imports money-executor.js, calls executeMoneyStep, no direct broadcast", () => {
  const lane = SRC("mainnet-job-lane.js");
  assert.match(lane, /from "\.\/money-executor\.js"/);
  assert.match(strip(lane), /executeMoneyStep\(/);
  assert.match(lane, /from "\.\/mainnet-job-common\.js"/);
  assert.match(lane, /from "\.\/mainnet-job-aave\.js"/);
  assert.equal(/\.sendTransaction\s*\(|\.sendRawTransaction\s*\(|\bexecutor\s*\.\s*send\s*\(/.test(strip(lane)), false);
  // the lane's permission boundary is the one permission-envelope.js, unchanged
  assert.match(lane, /import \{ authorize, consume, onUnknownOutcome, permissionNonce \} from "\.\/permission-envelope\.js";/);
});

// ── Part K · Kintsu ─────────────────────────────────────────────────────────────────────────────────────
await check("K1 proven = deposit / requestUnlock / cancelUnlockRequest; unproven = submitBatch / redeem / return", () => {
  const proven = Object.keys(KINTSU_STEPS).filter((k) => KINTSU_STEPS[k].proof === KINTSU_PROOF.PROVEN_FORK).sort();
  assert.deepEqual(proven, ["cancelUnlockRequest", "deposit", "requestUnlock"]);
  assert.deepEqual([...KINTSU_UNPROVEN_STEPS].sort(), ["redeem", "return", "submitBatch"]);
  for (const s of proven) assert.equal(KINTSU_STEPS[s].forkStatus, "success", s);
  assert.equal(KINTSU_STEPS.submitBatch.forkStatus, "reverted");
  assert.equal(KINTSU_STEPS.redeem.forkStatus, "reverted");
  assert.equal(KINTSU_STEPS.redeem.revertName, "UNKNOWN");
  assert.equal(KINTSU_STEPS.return.forkStatus, "never_observed");
  assert.equal(KINTSU_STEPS.return.signature, null);
  for (const s of KINTSU_UNPROVEN_STEPS) { assert.equal(KINTSU_STEPS[s].from, null); assert.equal(KINTSU_STEPS[s].to, null); }
});

await check("K2 every recorded selector is the keccak of its recorded signature", () => {
  for (const [name, s] of Object.entries(KINTSU_STEPS)) {
    if (s.signature === null) continue;
    assert.equal(toFunctionSelector(`function ${s.signature}`), s.selector, name);
  }
});

const A652_RAW = privatePath("ops/receipts/A652_mainnet_fork_lab/raw/kintsu-smon.json");
await check("K3 module values equal the recorded fork run (skipped when the private record is absent)", () => {
  if (!existsSync(A652_RAW)) return "SKIP";
  const raw = JSON.parse(readFileSync(A652_RAW, "utf8"));
  const step = (id) => raw.steps.find((s) => s.step === id);
  assert.equal(raw.chainId, KINTSU_FORK_EVIDENCE.chainId);
  assert.equal(raw.block.number, KINTSU_FORK_EVIDENCE.block);
  assert.equal(raw.contracts.vault.address, KINTSU_FORK_EVIDENCE.vault);
  assert.equal(raw.contracts.share.symbol, KINTSU_FORK_EVIDENCE.share.symbol);
  assert.equal(raw.contracts.share.decimals, KINTSU_FORK_EVIDENCE.share.decimals);
  assert.equal(raw.allowance.approvalsUsed, KINTSU_FORK_EVIDENCE.approvalsUsed);
  assert.equal(raw.balances.sharesAfterEntryRaw, KINTSU_FORK_EVIDENCE.sharesAfterEntryRaw);
  assert.equal(raw.balances.sharesAfterRequestRaw, KINTSU_FORK_EVIDENCE.sharesAfterRequestRaw);
  assert.equal(raw.roundTrip.sentWei, KINTSU_FORK_EVIDENCE.sentWei);
  const pending = step("2_requestUnlock").pending[0];
  assert.deepEqual({ ...KINTSU_FORK_EVIDENCE.pendingAtRequest }, pending);
  assert.equal(step("4_cancel_no_warp").sharesRestoredExactly, KINTSU_FORK_EVIDENCE.cancelRestoredSharesExactly);
  const map = { deposit: "1_deposit", requestUnlock: "2_requestUnlock", redeem: "3_redeem_now_no_warp", submitBatch: "3b_submitBatch_now_no_warp", cancelUnlockRequest: "4_cancel_no_warp" };
  for (const [name, id] of Object.entries(map)) {
    const r = step(id);
    assert.equal(r.signature, KINTSU_STEPS[name].signature, name);
    assert.equal(r.selector, KINTSU_STEPS[name].selector, name);
    assert.equal(r.status, KINTSU_STEPS[name].forkStatus, name);
    if (r.status === "success") assert.equal(Number(r.gasUsed), KINTSU_STEPS[name].gasUsed, name);
    else assert.equal(r.estimateError.data, KINTSU_STEPS[name].revertData, name);
  }
  // time-warped probes also reverted and never redeemed: the module records no success for them
  assert.equal(raw.timeWarpedSimulation.redeemedInSimulation, false);
  for (const row of raw.timeWarpedSimulation.rows) { assert.equal(row.submitBatch.status, "reverted"); assert.equal(row.redeem.status, "reverted"); }
  assert.equal(raw.exitSemantics.startsWith("pending"), true);
});

await check("K4 stage machine follows proven transitions only; unproven steps never move a stage; no returned stage exists", () => {
  assert.deepEqual(kintsuStageAfter(KINTSU_STAGE.NONE, "deposit"), { stage: KINTSU_STAGE.HOLDING, error: null });
  assert.deepEqual(kintsuStageAfter(KINTSU_STAGE.HOLDING, "requestUnlock"), { stage: KINTSU_STAGE.PENDING_UNLOCK, error: null });
  assert.deepEqual(kintsuStageAfter(KINTSU_STAGE.PENDING_UNLOCK, "cancelUnlockRequest"), { stage: KINTSU_STAGE.HOLDING, error: null });
  for (const stage of Object.values(KINTSU_STAGE)) {
    for (const step of KINTSU_UNPROVEN_STEPS) assert.deepEqual(kintsuStageAfter(stage, step), { stage: null, error: `unproven_step:${step}` }, `${stage}/${step}`);
  }
  assert.equal(kintsuStageAfter(KINTSU_STAGE.PENDING_UNLOCK, "deposit").error, "step_not_valid_from_stage");
  assert.equal(kintsuStageAfter(KINTSU_STAGE.UNKNOWN, "cancelUnlockRequest").error, "step_not_valid_from_stage");
  assert.equal(kintsuStageAfter("returned", "deposit").error, "unknown_stage");
  assert.equal(kintsuStageAfter(KINTSU_STAGE.HOLDING, "withdraw").error, "unknown_step");
  assert.equal(kintsuStageAfter(KINTSU_STAGE.HOLDING, "__proto__").error, "unknown_step");
  // reachable closure from NONE never contains a returned / redeemed / done stage
  const seen = new Set([KINTSU_STAGE.NONE]);
  const queue = [KINTSU_STAGE.NONE];
  while (queue.length) {
    const s = queue.shift();
    for (const step of Object.keys(KINTSU_STEPS)) {
      const n = kintsuStageAfter(s, step).stage;
      if (n && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  assert.deepEqual([...seen].sort(), [KINTSU_STAGE.HOLDING, KINTSU_STAGE.NONE, KINTSU_STAGE.PENDING_UNLOCK].sort());
  assert.equal(Object.values(KINTSU_STAGE).some((s) => /return|redeem|done|complete|ready/i.test(s)), false);
  for (const s of [...Object.values(KINTSU_STAGE), "returned", "done", "redeemed", null]) assert.notEqual(kintsuOutcomeWord(s), "done");
});

await check("K5 a pending read is pending with ETA / cooldown / redeemable UNKNOWN; forged completion fields are ignored", () => {
  const p = readKintsuPending({ ...KINTSU_FORK_EVIDENCE.pendingAtRequest });
  assert.equal(p.stage, KINTSU_STAGE.PENDING_UNLOCK);
  assert.equal(p.eta, "UNKNOWN"); assert.equal(p.cooldown, "UNKNOWN"); assert.equal(p.redeemable, "UNKNOWN");
  assert.equal(p.returnComplete, false); assert.equal(p.spotValueIsFinalReturn, false);
  const forged = readKintsuPending({ ...KINTSU_FORK_EVIDENCE.pendingAtRequest, redeemed: true, returnComplete: true, eta: "1d", cooldown: 86400, ready: true });
  assert.equal(forged.returnComplete, false); assert.equal(forged.eta, "UNKNOWN"); assert.equal(forged.cooldown, "UNKNOWN");
  assert.equal("ready" in forged, false);
  for (const bad of [null, [], {}, { ...KINTSU_FORK_EVIDENCE.pendingAtRequest, shares: "0" }, { ...KINTSU_FORK_EVIDENCE.pendingAtRequest, shares: 5 },
    { ...KINTSU_FORK_EVIDENCE.pendingAtRequest, batchId: "1359" }, { ...KINTSU_FORK_EVIDENCE.pendingAtRequest, exitFeeInBips: 10001 },
    { ...KINTSU_FORK_EVIDENCE.pendingAtRequest, spotValueWei: "-1" }]) {
    const r = readKintsuPending(bad);
    assert.equal(r.stage, KINTSU_STAGE.UNKNOWN, JSON.stringify(bad));
    assert.equal(r.returnComplete, false);
  }
});

await check("K6 calldata only for proven steps, every argument explicit (no default minimum), decodes back exactly", () => {
  for (const s of KINTSU_UNPROVEN_STEPS) assert.deepEqual(encodeKintsuStep(s, { index: "0" }), { call: null, error: `unproven_step:${s}` });
  assert.equal(encodeKintsuStep("deposit", { valueWei: "1000000000000000000", receiver: PIGGY.address }).error, "min_shares_not_exact");
  assert.equal(encodeKintsuStep("deposit", { valueWei: "0", minSharesRaw: "0", receiver: PIGGY.address }).error, "amount_not_exact");
  assert.equal(encodeKintsuStep("deposit", { valueWei: "1", minSharesRaw: "0" }).error, "missing_receiver");
  assert.equal(encodeKintsuStep("requestUnlock", { sharesRaw: "1" }).error, "min_spot_value_not_exact");
  assert.equal(encodeKintsuStep("requestUnlock", { sharesRaw: (1n << 96n).toString(), minSpotValueWei: "0" }).error, "shares_not_exact");
  assert.equal(encodeKintsuStep("cancelUnlockRequest", {}).error, "unlock_index_not_exact");
  const abi = [
    { type: "function", name: "deposit", stateMutability: "payable", inputs: [{ type: "uint96" }, { type: "address" }], outputs: [] },
    { type: "function", name: "requestUnlock", stateMutability: "nonpayable", inputs: [{ type: "uint96" }, { type: "uint96" }], outputs: [] },
    { type: "function", name: "cancelUnlockRequest", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  ];
  const dep = encodeKintsuStep("deposit", { valueWei: "1000000000000000000", minSharesRaw: "0", receiver: PIGGY.address }).call;
  assert.equal(dep.to, KINTSU_FORK_EVIDENCE.vault); assert.equal(dep.value, "1000000000000000000");
  assert.equal(dep.data.slice(0, 10), KINTSU_STEPS.deposit.selector);
  assert.deepEqual(decodeFunctionData({ abi, data: dep.data }).args, [0n, PIGGY.address]);
  const req = encodeKintsuStep("requestUnlock", { sharesRaw: "899864250694037717", minSpotValueWei: "0" }).call;
  assert.equal(req.data.slice(0, 10), KINTSU_STEPS.requestUnlock.selector); assert.equal(req.value, "0");
  const can = encodeKintsuStep("cancelUnlockRequest", { index: "0" }).call;
  assert.equal(can.data.slice(0, 10), KINTSU_STEPS.cancelUnlockRequest.selector);
  assert.equal(Object.isFrozen(dep), true);
  assert.equal("permission" in dep || "nonce" in dep || "ready" in dep, false);
});

// every profile / executor / Piggy combination a caller could hand in, including forged ones
const forgedProfiles = [
  null, undefined, {}, MAINNET, resolveChainProfile("monad-testnet"), resolveChainProfile("143"),
  { ...MAINNET, jobId: KINTSU_JOB_ID }, { ...MAINNET, jobId: KINTSU_JOB_ID, liveExecution: true },
  { ...MAINNET, jobId: KINTSU_JOB_ID, usdc: { symbol: "MON", address: "0x0000000000000000000000000000000000000000", decimals: 18 } },
  { ...MAINNET, liveExecution: true },
];
const forgedExecutors = [null, FORK_EXECUTOR, { ...FORK_EXECUTOR, kind: "live" }, { ...FORK_EXECUTOR, kind: "lane_executor" }];
const piggies = [{}, PIGGY];

await check("K7 execution gate is never open: every step × profile × executor × Piggy refuses (first refusal from the existing boundaries)", () => {
  let n = 0;
  for (const step of [...Object.keys(KINTSU_STEPS), "withdraw", undefined]) for (const profile of forgedProfiles) for (const executor of forgedExecutors) for (const piggy of piggies) {
    const g = kintsuExecutionGate({ profile, piggy, executor, step });
    assert.equal(g.allowed, false); assert.equal(g.liveExecution, false); assert.equal(g.executionPermission, false);
    assert.equal(typeof g.reason, "string");
    n += 1;
  }
  assert.ok(n > 300);
  assert.equal(kintsuExecutionGate({ profile: MAINNET, piggy: PIGGY, executor: FORK_EXECUTOR, step: "redeem" }).reason, "unproven_step:redeem");
  assert.equal(kintsuExecutionGate({ profile: MAINNET, piggy: PIGGY, executor: FORK_EXECUTOR, step: "deposit" }).reason, "profile_not_kintsu_lane");
  // [A-791 re-pin, named reason: Kintsu now refuses explicitly when liveExecution !== true, BEFORE binding. A Kintsu-named profile
  // with liveExecution:false (every real profile) stops there; the binding boundary below is still asserted, reached by forging
  // liveExecution:true — which then still cannot bind a MON errand (chain-profile.js binds USDC only).]
  assert.equal(kintsuExecutionGate({ profile: { ...MAINNET, jobId: KINTSU_JOB_ID }, piggy: PIGGY, executor: FORK_EXECUTOR, step: "deposit" }).reason, "live_execution_disabled");
  // a profile forged to name Kintsu (and forged live) still cannot bind a MON errand: chain-profile.js binds USDC only
  assert.equal(kintsuExecutionGate({ profile: { ...MAINNET, jobId: KINTSU_JOB_ID, liveExecution: true }, piggy: PIGGY, executor: FORK_EXECUTOR, step: "deposit" }).reason, "asset_not_in_profile");
  // Past every boundary the gate still refuses: the source has no "allowed: true" and ends on the not-wired refusal.
  const code = strip(SRC("mainnet-job-kintsu.js"));
  assert.equal(/allowed\s*:\s*(true|!|[a-z])/i.test(code.replace(/allowed: false/g, "")), false);
  const gate = code.slice(code.indexOf("export function kintsuExecutionGate"), code.indexOf("export function kintsuReadiness"));
  assert.match(gate, /return refuse\("kintsu_lane_not_wired"\);\s*\}\s*$/);
});

await check("K8 readiness is never READY / executable / return-complete / live, for any stage or forged input", () => {
  for (const stage of [...Object.values(KINTSU_STAGE), "returned", "redeemed", "done", "ready", undefined, 7]) for (const profile of forgedProfiles) for (const executor of forgedExecutors) {
    const r = kintsuReadiness({ stage, profile, piggy: PIGGY, executor });
    assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.returnComplete, false);
    assert.equal(r.liveExecution, false); assert.equal(r.executionPermission, false);
    assert.notEqual(r.outcome, "done");
    for (const s of KINTSU_UNPROVEN_STEPS) assert.ok(r.blockedBy.includes(`unproven_step:${s}`));
    assert.ok(r.blockedBy.includes("cooldown_unknown") && r.blockedBy.includes("eta_unknown"));
    assert.equal(Object.isFrozen(r), true);
  }
  const r = kintsuReadiness();
  assert.equal(r.evidenceClass, "PASS_FORK_SIM_WITH_PENDING");
  assert.deepEqual([...r.provenSteps].sort(), ["cancelUnlockRequest", "deposit", "requestUnlock"]);
});

await check("K9 Kintsu cannot obtain the Aave lane's permission preview or lifecycle (the lane is Aave-only)", () => {
  const kintsuProfile = { ...MAINNET, jobId: KINTSU_JOB_ID };
  const forgedMatch = { result: "do_it", binding: { piggyAddress: PIGGY.address, piggyId: PIGGY.id, chainId: 143 }, eventId: "e" };
  assert.equal(LANE.buildLanePermissionPreview({ profile: kintsuProfile, piggy: PIGGY, amountRaw: "1", decision: forgedMatch }).error, "profile_not_mainnet_lane");
  assert.equal(LANE.laneIntentKey(kintsuProfile, PIGGY.id), null);
  assert.equal(LANE.decideLane({ profile: kintsuProfile, piggy: PIGGY, amountRaw: "1" }).reason, "profile_not_mainnet_lane");
});

await check("K10 no invented cooldown or ETA: the evidence and step tables carry no duration, only UNKNOWN", () => {
  const all = JSON.stringify({ KINTSU_FORK_EVIDENCE, KINTSU_STEPS });
  assert.equal(/cooldown"\s*:\s*\d|eta"\s*:\s*"?\d|days?"|hours?"|seconds?"|interval"\s*:\s*\d/i.test(all), false);
  for (const k of ["cooldown", "real_world_eta", "batch_interval", "final_return_value"]) assert.ok(KINTSU_FORK_EVIDENCE.unknown.includes(k), k);
  const code = strip(SRC("mainnet-job-kintsu.js"));
  assert.equal(/\b(86400|604800|3600)\b|\*\s*24\s*\*|setTimeout|setInterval|Date\.now/.test(code), false);
});

// ── Part S · source boundaries ─────────────────────────────────────────────────────────────────────────
await check("S1 new modules: no send / sign / storage / network / timers / executor import / permission issuing", () => {
  for (const f of NEW_MODULES) {
    const code = strip(SRC(f));
    assert.equal(/\.sendTransaction\s*\(|\.sendRawTransaction\s*\(|\bexecutor\s*\.\s*send\s*\(|executeMoneyStep|money-executor|signTransaction|signMessage|privateKey|mnemonic|walletClient|fetch\(|localStorage|sessionStorage|setTimeout|setInterval|issuePermission|authorize\(|consume\(/.test(code), false, f);
  }
  // only the lane module may touch storage, and only through the injected `storage`
  assert.equal(/\.setItem\(|\.getItem\(/.test(strip(SRC("mainnet-job-kintsu.js"))), false);
  assert.equal(/\.setItem\(|\.getItem\(/.test(strip(SRC("mainnet-job-aave.js"))), false);
});

await check("S2 Kintsu is not Aave-shaped: no Aave import, no approve / Pool / receipt token / immediate exit", () => {
  const code = strip(SRC("mainnet-job-kintsu.js"));
  assert.equal(/mainnet-job-aave|mainnet-job-lane|\bapprove\b|\bsupply\b|\bwithdraw\b|aToken|getReserveData|POOL_ABI|ERC20_ABI|LANE_|"immediate"/.test(code), false);
  assert.equal(Object.keys(KINTSU_STEPS).includes("approve"), false);
  assert.equal(KINTSU_FORK_EVIDENCE.exitSemantics, "pending");
  assert.equal(KINTSU_FORK_EVIDENCE.approvalsUsed, 0);
});

await check("S3 hygiene: no private-dir path, card id or yield/venue wording in the shipped new modules", () => {
  for (const f of NEW_MODULES) {
    const src = SRC(f);
    assert.equal(PRIVATE_RE.test(src), false, `${f}: private dir path`);
    assert.equal(/\bA-\d{3}\b/.test(src), false, `${f}: card id`);
    assert.equal(/\b(apy|yield|venue)\b|["'`>](safe|instant)\b/i.test(strip(src)), false, `${f}: wording`);
  }
});

await check("S4 import graph: the Kintsu module is imported by no product file; common / Aave only by the lane and each other", () => {
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js"));
  const importers = (mod) => files.filter((f) => f !== mod && new RegExp(`from "\\./${mod.replace(/\./g, "\\.")}"`).test(SRC(f)));
  assert.deepEqual(importers("mainnet-job-kintsu.js"), []);
  assert.deepEqual(importers("mainnet-job-aave.js"), ["mainnet-job-lane.js"]);
  // [A-939 RE-PIN] + mainnet-job-lp.js (the new LP module imports the shared helpers). pre-A-939 baseline: the 6 modules without it
  // [A-951 RE-PIN] + the five new executor modules (euler · kuru · revoke · shmon · upshift) import the shared helpers. pre-A-951: the 7 modules above
  assert.deepEqual(importers("mainnet-job-common.js").sort(), ["mainnet-job-aave.js", "mainnet-job-abil.js", "mainnet-job-curvance.js", "mainnet-job-euler.js", "mainnet-job-kintsu.js", "mainnet-job-kuru.js", "mainnet-job-lane.js", "mainnet-job-lp.js", "mainnet-job-neverland.js", "mainnet-job-revoke.js", "mainnet-job-shmon.js", "mainnet-job-upshift.js"]);
  assert.equal(/mainnet-job-(kintsu|aave|common)/.test(SRC("main.js")), false);
});

await check("S5 only mainnet-job-* modules name a local fork executor; no product file constructs one", () => {
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js") && !x.startsWith("mainnet-job-"));
  // [A-977 RE-PIN] main.js constructs the ONE fork-run executor inside its [A-977] block (fork profile only; strict transport). pre-A-977: []
  // assert.deepEqual(files.filter((f) => /local_fork/.test(SRC(f))), []); // pre-A-977
  assert.deepEqual(files.filter((f) => /local_fork/.test(SRC(f))), ["main.js"]);
  const m = SRC("main.js"), a = m.indexOf("// ── [A-977] Job 10 on the shared fork"), z = m.indexOf("// ── [A-977] end Job 10");
  assert.equal(/local_fork/.test(m.slice(0, a) + m.slice(z)), false, "outside the [A-977] block main.js names no local fork executor");
  for (const f of NEW_MODULES) assert.equal(/kind\s*:\s*"local_fork"/.test(SRC(f)), false, f);
});

console.log(`\n${pass}/${pass + fail} PASS${skip ? ` (${skip} SKIP)` : ""}`);
process.exit(fail === 0 ? 0 : 1);
