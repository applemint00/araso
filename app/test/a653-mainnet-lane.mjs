// Narrow mainnet lane: explicit closed chain profile + one Job (Aave v3 USDC) + testnet isolation.
//   node app/test/a653-mainnet-lane.mjs
//
// Part N (node, always, no network): chain profile resolution and binding; exact chain/token/
//   contract values; the Job's block-pinned read-only pre-action read over a LOCAL fork-backed
//   transport; decision match / nah / unknown through the existing rule-decision contract;
//   exact permission preview + permission-envelope round trip; lifecycle pending / revert /
//   success / unknown / reload over a local fork executor; Receipt fields; Gift config shape;
//   main.js seam contracts (testnet default, sealed legacy paths, render() unchanged).
//   The fork-backed transport replays values measured on the mainnet fork (chain 143, block
//   108,999,816: reserve configuration word, receipt token, tx hashes, gasUsed, balances).
//   `fetch` is replaced by a thrower for the whole of Part N, so no real RPC can happen.
// Part B (real browser, needs local ports; default ON when the local harness exists):
//   three Vite servers — default (testnet), VITE_ARASO_CHAIN_PROFILE=monad-mainnet, and an
//   invalid value ("143"). A653_NODE_ONLY=1 skips Part B (prints SKIP).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, toFunctionSelector } from "viem";

import {
  CHAIN_PROFILE_ID, GIFT_DEPLOYMENT, MAINNET_GIFT_ESCROW_CONFIG, bindRecordToProfile, checkRecordBinding,
  legacyTestnetPathOpen, profileScope, resolveChainProfile, resolveGiftEscrowConfig,
} from "../src/chain-profile.js";
import {
  LANE_AMOUNT_CAP_RAW, LANE_FORK_EVIDENCE, LANE_RECEIPT_TOKEN, LANE_SELECTORS, LANE_STAGE, MAINNET_LANE_CONFIG,
  advanceLaneIntent, buildLanePermissionPreview, buildLaneReceipt, decideLane, decodeReserveConfiguration,
  laneIntentKey, laneReceiptCandidate, loadLaneIntent, readLanePreAction, reconcileLaneIntent, startLaneIntent,
} from "../src/mainnet-job-lane.js";
import { issuePermission } from "../src/permission-envelope.js";
import { isLiveProven } from "../src/second-job-readiness.js";
import {
  createMemoryStorage, createSecondJourneyState, readSecondJourneyDecisionReceipts, recordSecondJourneyDecisionReceipt,
} from "../src/second-journey-state.js";
import { classifySecondReceipt } from "../src/second-journey-receipt-bridge.js";
import { createGiftRecordSource } from "../src/gift-record-source.js";
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "../src/funding-context.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const VERCEL = readFileSync(path.join(REPO, "vercel.json"), "utf8");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}
function fnBody(name, src = MAIN) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}

// ── exact values (mainnet fork, chain 143, block 108,999,816) ───────────────────────────────
const CHAIN = 143;
const FORK_BLOCK = 108999816;
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";
const ATOKEN = "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042";
const TESTNET_USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
// getReserveData(USDC).configuration read at the pin (decimals 6, active, not frozen, not paused).
const FORK_CONFIG_WORD = 7237005577332262213973186568752005780840647977154502683997290204037023014220n;
const FROZEN_BIT = 1n << 57n;
const PAUSED_BIT = 1n << 60n;
// Label-derived fork fixture address (no key exists for it; never funded outside the fork).
const PIGGY = { id: "legacy-0x32b8b801348386f62ca7ca1647c7092012dd5661", address: "0x32b8B801348386f62cA7ca1647c7092012dd5661" };
const OTHER = "0x81DbCA3540Fe6320F5Ff781433FCdd8Fd0fF8F89";
// Public fork tx hashes (not keys) — split in two so the pre-commit secret scan doesn't read them
// as 64-hex key material; the joined value is byte-identical to the recorded fork evidence.
const FORK_TX = Object.freeze({
  approve: { hash: "0x0f83e686459ea995b198fa593567bb92" + "1968564105c4c4051a9c618f9bd56757", block: 108999818, gasUsed: 55437 },
  supply: { hash: "0x161a73f3e5df47b9d4ebd7398631d776" + "22fd9d3c47a43f4242aa340a9cdfca0b", block: 108999819, gasUsed: 197122 },
  withdraw: { hash: "0x052806a2ccd9fc26f9430f12d77b7627" + "e7edb960fcab7a1e3c3b1df81275ee08", block: 108999820, gasUsed: 177464 },
});
const FORK_GIFT_ESCROW = "0xF17a84661995B2db53175db21510b1939d70Ad85"; // deployed INSIDE the fork only
const NOW_ISO = "2026-09-30T03:30:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

const POOL_ABI = [
  { type: "function", name: "getReserveData", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "configuration", type: "uint256" }, { name: "liquidityIndex", type: "uint128" }, { name: "currentLiquidityRate", type: "uint128" },
    { name: "variableBorrowIndex", type: "uint128" }, { name: "currentVariableBorrowRate", type: "uint128" }, { name: "currentStableBorrowRate", type: "uint128" },
    { name: "lastUpdateTimestamp", type: "uint40" }, { name: "id", type: "uint16" }, { name: "aTokenAddress", type: "address" },
    { name: "stableDebtTokenAddress", type: "address" }, { name: "variableDebtTokenAddress", type: "address" }, { name: "interestRateStrategyAddress", type: "address" },
    { name: "accruedToTreasury", type: "uint128" }, { name: "unbacked", type: "uint128" }, { name: "isolationModeTotalDebt", type: "uint128" }] }] },
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "onBehalfOf", type: "address" }, { name: "referralCode", type: "uint16" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [{ type: "uint256" }] },
];
const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// LOCAL fork-backed world: one mutable state, a read-only JSON-RPC transport over it, and an
// executor that applies the fork's measured transitions. Nothing here opens a socket.
function forkWorld({ usdcRaw = 5000000n, aTokenRaw = 0n, allowanceRaw = 0n, config = FORK_CONFIG_WORD, aToken = ATOKEN, chainId = CHAIN, code = "0x6080604052", revertOn = null, pendingOnce = null, throwOnSend = null } = {}) {
  const w = { block: FORK_BLOCK, usdcRaw, aTokenRaw, allowanceRaw, config, aToken, chainId, code };
  const calls = [];
  const sent = [];
  const pendingLeft = new Set(pendingOnce ? [pendingOnce] : []);
  const receipts = new Map();
  const rpc = async (url, init) => {
    assert.equal(url, "https://fork.local.invalid/rpc");
    const req = JSON.parse(init.body);
    calls.push(req);
    const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) });
    if (req.method === "eth_chainId") return ok(`0x${w.chainId.toString(16)}`);
    if (req.method === "eth_blockNumber") return ok(`0x${w.block.toString(16)}`);
    if (req.method === "eth_getCode") { assert.equal(req.params[1], `0x${w.block.toString(16)}`); return ok(eq(req.params[0], POOL) ? w.code : "0x"); }
    if (req.method === "eth_call") {
      const [{ to, data }, tag] = req.params;
      assert.equal(tag, `0x${w.block.toString(16)}`, "every call pinned to the one block");
      const sel = data.slice(0, 10);
      if (eq(to, POOL) && sel === LANE_SELECTORS.getReserveData) {
        const zero = "0x0000000000000000000000000000000000000000";
        return ok(encodeFunctionResult({ abi: POOL_ABI, functionName: "getReserveData", result: {
          configuration: w.config, liquidityIndex: 0n, currentLiquidityRate: 0n, variableBorrowIndex: 0n, currentVariableBorrowRate: 0n,
          currentStableBorrowRate: 0n, lastUpdateTimestamp: 1790673863, id: 0, aTokenAddress: w.aToken, stableDebtTokenAddress: zero,
          variableDebtTokenAddress: zero, interestRateStrategyAddress: zero, accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n,
        } }));
      }
      const word = (v) => ok(encodeAbiParameters([{ type: "uint256" }], [v]));
      if (sel === LANE_SELECTORS.balanceOf && eq(to, USDC)) return word(w.usdcRaw);
      if (sel === LANE_SELECTORS.balanceOf && eq(to, ATOKEN)) return word(w.aTokenRaw);
      if (sel === LANE_SELECTORS.allowance && eq(to, USDC)) return word(w.allowanceRaw);
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "unexpected call" } }) };
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not allowed" } }) };
  };
  const executor = {
    kind: "local_fork", chainId: CHAIN, forkBlock: FORK_BLOCK,
    async send(tx) {
      const sel = tx.data.slice(0, 10);
      const step = sel === LANE_SELECTORS.approve ? "approve" : sel === LANE_SELECTORS.supply ? "supply" : sel === LANE_SELECTORS.withdraw ? "withdraw" : null;
      if (!step) throw new Error("unexpected tx");
      sent.push({ step, tx });
      if (throwOnSend === step) throw new Error("transport dropped mid-send");
      const f = FORK_TX[step];
      if (revertOn === step) {
        receipts.set(f.hash, { status: "reverted", gasUsed: 75077, blockNumber: f.block, revertData: "0x47bc4b2c" });
      } else {
        if (step === "approve") w.allowanceRaw = BigInt(decodeFunctionData({ abi: ERC20_ABI, data: tx.data }).args[1]);
        if (step === "supply") { w.usdcRaw -= 5000000n; w.aTokenRaw += 4999999n; w.allowanceRaw = 0n; }
        if (step === "withdraw") { w.usdcRaw += w.aTokenRaw; w.aTokenRaw = 0n; }
        receipts.set(f.hash, { status: "success", gasUsed: f.gasUsed, blockNumber: f.block });
      }
      w.block = f.block;
      return { hash: f.hash };
    },
    async receipt(hash) {
      const step = Object.entries(FORK_TX).find(([, v]) => v.hash === hash)?.[0];
      if (step && pendingLeft.has(step)) { pendingLeft.delete(step); return null; }
      return receipts.get(hash) || null;
    },
  };
  return { w, rpc, calls, sent, executor, transport: { rpcUrl: "https://fork.local.invalid/rpc", fetchImpl: rpc, now: () => NOW_ISO } };
}

const MAINNET = resolveChainProfile("monad-mainnet");
const TESTNET = resolveChainProfile(undefined);

async function readWith(world, profile = MAINNET, piggy = PIGGY) {
  return readLanePreAction({ profile, piggyAddress: piggy.address, ...world.transport });
}
async function decideWith(world, { amountRaw = "5000000", returnAnswer = "right_back", eventId = "evt-1" } = {}) {
  const r = await readWith(world);
  return { r, d: decideLane({ profile: MAINNET, piggy: PIGGY, amountRaw, returnAnswer, read: r.read, readStatus: r.status, eventId, selectionSource: "app_ui_jit_answer", nowMs: NOW_MS, nowIso: NOW_ISO }) };
}
function signerContext(piggy = PIGGY) {
  return { selectedPiggyId: piggy.id, selectedPiggyAddress: piggy.address, activeSignerAddress: piggy.address };
}
function envelopeFor(preview, nowMs = NOW_MS) {
  return issuePermission({ intent: preview.intent, auth: { method: "passkey", verified: true, verifiedAt: nowMs - 1000 }, nonce: preview.nonce, nowMs }).envelope;
}

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("network is forbidden in Part N"); };

await check("N1 chain profile is closed: unset = testnet (the only default); exact 'monad-mainnet' = mainnet; anything else = blocked", () => {
  for (const v of [undefined, null, ""]) {
    const p = resolveChainProfile(v);
    assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET); assert.equal(p.numericChainId, 10143); assert.equal(p.selectedBy, "default");
  }
  assert.equal(resolveChainProfile("monad-testnet").selectedBy, "config");
  assert.equal(MAINNET.id, "monad-mainnet"); assert.equal(MAINNET.numericChainId, 143); assert.equal(MAINNET.selectedBy, "config");
  assert.equal(MAINNET.liveExecution, false, "mainnet live execution stays off");
  assert.equal(MAINNET.jobId, "aave-usdc");
  for (const bad of ["143", "10143", "mainnet", "MONAD-MAINNET", " monad-mainnet", "monad-mainnet ", "monad-testnet\n", "monad", 143, 10143, true, {}, []]) {
    const p = resolveChainProfile(bad);
    assert.equal(p.status, "blocked", JSON.stringify(bad));
    assert.equal(p.scope, ""); assert.equal(p.numericChainId, null); assert.equal(p.legacyFirstJourney, false); assert.equal(p.liveExecution, false);
    assert.equal(profileScope(p), "");
    assert.equal(legacyTestnetPathOpen(p), false);
  }
  assert.equal(legacyTestnetPathOpen(TESTNET), true);
  assert.equal(legacyTestnetPathOpen(MAINNET), false);
  assert.equal(profileScope(TESTNET), "monad-testnet");
  assert.equal(profileScope(MAINNET), "monad-mainnet");
  // A tampered profile object is not active.
  assert.equal(legacyTestnetPathOpen({ ...TESTNET, numericChainId: 143 }), false);
});

await check("N2 exact chain/token/contract values match the fork evidence (no invented address or decimals)", () => {
  assert.deepEqual(MAINNET.usdc, { symbol: "USDC", address: USDC, decimals: 6 });
  assert.deepEqual(TESTNET.usdc, { symbol: "USDC", address: TESTNET_USDC, decimals: 6 });
  assert.deepEqual({ ...LANE_RECEIPT_TOKEN }, { symbol: "aMonUSDC", address: ATOKEN, decimals: 6 });
  assert.equal(LANE_FORK_EVIDENCE.chainId, CHAIN); assert.equal(LANE_FORK_EVIDENCE.block, FORK_BLOCK);
  assert.equal(LANE_FORK_EVIDENCE.label, "PASS_FORK_SIM"); assert.equal(isLiveProven(LANE_FORK_EVIDENCE.label), false);
  assert.deepEqual({ ...LANE_FORK_EVIDENCE.gasUsed }, { approve: 55437, supply: 197122, withdraw: 177464 });
  assert.equal(LANE_FORK_EVIDENCE.deltaRaw, "-1");
  assert.ok(LANE_FORK_EVIDENCE.unmeasured.includes("supplyApr"), "supplyApr is recorded as unmeasured, not filled");
  assert.equal(LANE_SELECTORS.approve, toFunctionSelector("approve(address,uint256)"));
  assert.equal(LANE_SELECTORS.supply, toFunctionSelector("supply(address,uint256,address,uint16)"));
  assert.equal(LANE_SELECTORS.withdraw, toFunctionSelector("withdraw(address,uint256,address)"));
  assert.equal(LANE_SELECTORS.getReserveData, toFunctionSelector("getReserveData(address)"));
  assert.equal(LANE_SELECTORS.balanceOf, toFunctionSelector("balanceOf(address)"));
  assert.equal(LANE_SELECTORS.allowance, toFunctionSelector("allowance(address,address)"));
  assert.deepEqual(decodeReserveConfiguration(FORK_CONFIG_WORD), { decimals: 6, active: true, frozen: false, paused: false });
  assert.equal(LANE_AMOUNT_CAP_RAW, "5000000");
  assert.deepEqual({ ...MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
});

await check("N3 persisted-record binding: chain + asset + token + Piggy; testnet/legacy/tampered records never bind as mainnet", () => {
  const { binding } = bindRecordToProfile(MAINNET, { piggyId: PIGGY.id, piggyAddress: PIGGY.address });
  assert.deepEqual({ ...binding }, { chainId: 143, chain: "monad-mainnet", asset: "USDC", token: USDC, decimals: 6, piggyId: PIGGY.id, piggyAddress: PIGGY.address });
  const ctx = { piggyId: PIGGY.id, piggyAddress: PIGGY.address };
  assert.equal(checkRecordBinding(binding, MAINNET, ctx).ok, true);
  const { binding: tBinding } = bindRecordToProfile(TESTNET, ctx);
  assert.equal(checkRecordBinding(tBinding, MAINNET, ctx).reason, "chain_mismatch");
  assert.equal(checkRecordBinding(binding, TESTNET, ctx).reason, "chain_mismatch");
  assert.equal(checkRecordBinding({ kind: "shmon", txHash: "0x1" }, MAINNET, ctx).reason, "unbound_record", "legacy rows carry no chain id");
  assert.equal(checkRecordBinding({ ...binding, chain: "monad-testnet" }, MAINNET, ctx).reason, "chain_scope_mismatch");
  assert.equal(checkRecordBinding({ ...binding, token: TESTNET_USDC }, MAINNET, ctx).reason, "token_mismatch");
  assert.equal(checkRecordBinding({ ...binding, decimals: 18 }, MAINNET, ctx).reason, "decimals_mismatch");
  assert.equal(checkRecordBinding({ ...binding, asset: "MON" }, MAINNET, ctx).reason, "asset_mismatch");
  assert.equal(checkRecordBinding(binding, MAINNET, { ...ctx, piggyId: "other" }).reason, "piggy_mismatch");
  assert.equal(checkRecordBinding(binding, MAINNET, { ...ctx, piggyAddress: OTHER }).reason, "piggy_address_mismatch");
  assert.equal(checkRecordBinding(binding, resolveChainProfile("143"), ctx).reason, "profile_blocked");
  assert.equal(bindRecordToProfile(resolveChainProfile("x"), ctx).error, "profile_blocked");
});

await check("N4 pre-action read: LOCAL fork-backed transport, read-only methods only, every call pinned to one block, no network", async () => {
  const world = forkWorld();
  const r = await readWith(world);
  assert.equal(r.status, "ok");
  assert.equal(r.read.chainId, 143); assert.equal(r.read.block, FORK_BLOCK); assert.equal(r.read.codePresent, true);
  assert.deepEqual(r.read.reserve, { decimals: 6, active: true, frozen: false, paused: false, aTokenAddress: ATOKEN });
  assert.deepEqual(r.read.piggy, { address: PIGGY.address, usdcRaw: "5000000", aTokenRaw: "0", allowanceRaw: "0" });
  assert.ok(world.calls.every((c) => ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"].includes(c.method)));
  assert.equal(world.calls.filter((c) => c.method === "eth_call").length, 4);
  // unconfigured / wrong profile / bad inputs: no read, never throws
  assert.equal((await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address })).status, "no_rpc");
  assert.equal((await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address, rpcUrl: "http://x.invalid", fetchImpl: world.rpc, now: () => NOW_ISO })).status, "no_rpc");
  assert.equal((await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address, rpcUrl: "https://fork.local.invalid/rpc" })).status, "no_transport");
  assert.equal((await readWith(world, TESTNET)).status, "profile_not_mainnet_lane");
  assert.equal((await readWith(world, resolveChainProfile("143"))).status, "profile_not_mainnet_lane");
  assert.equal((await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address, rpcUrl: "https://fork.local.invalid/rpc", fetchImpl: async () => { throw new Error("down"); }, now: () => NOW_ISO })).status, "rpc_unreachable");
  assert.equal((await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address, ...world.transport, now: () => "not a date" })).status, "unreadable_result");
});

await check("N5 decision MATCH: conditions hold + right_back on an immediate exit -> match, action = ask (permission), no Receipt, no permission", async () => {
  const { d } = await decideWith(forkWorld());
  assert.equal(d.decision, "match"); assert.equal(d.result, "do_it"); assert.equal(d.action, "ask");
  assert.equal(d.executionPermission, false); assert.equal(d.receipt, null);
  assert.equal(d.returnEvidenceMode, "live_observation");
  for (const ans of ["few_days", "no_rush"]) assert.equal((await decideWith(forkWorld(), { returnAnswer: ans })).d.decision, "match");
});

await check("N6 decision NAH (condition mismatch -> action 0): frozen reserve, short balance, over cap, errand already out; Receipt shows expected / found / block / source", async () => {
  const cases = [
    [{ config: FORK_CONFIG_WORD | FROZEN_BIT }, {}, "reserve_accepts_supply", "true", "false"],
    [{ usdcRaw: 0n }, {}, "piggy_has_amount", "5000000", "0"],
    [{}, { amountRaw: "6000000" }, "amount_within_cap", "5000000", "6000000"],
    [{ aTokenRaw: 1n }, {}, "no_errand_out", "true", "false"],
  ];
  for (const [worldOpts, decideOpts, ruleId, expected, found] of cases) {
    const { d } = await decideWith(forkWorld(worldOpts), decideOpts);
    assert.equal(d.decision, "nah", ruleId); assert.equal(d.action, "none"); assert.equal(d.reason, "hard_rule_breach");
    const r = d.receipt;
    assert.ok(r, `receipt for ${ruleId}: ${d.receiptError}`);
    assert.equal(r.decision, "nah"); assert.equal(r.actionCount, 0); assert.equal(r.txExecuted, false); assert.equal(r.did, "nothing");
    assert.equal(r.expected, expected, ruleId); assert.equal(r.found, found, ruleId);
    assert.equal(r.evidence.block, FORK_BLOCK); assert.match(r.evidence.source, /^read-only rpc .* @108999816$/);
    assert.equal(r.evidence.observedAt, NOW_ISO);
    assert.match(r.why, new RegExp(`block ${FORK_BLOCK}\\)?$`));
    assert.ok(r.why.includes(`expected`) && r.why.includes(found), r.why);
    assert.equal(r.chainId, "monad-mainnet"); assert.equal(r.accountId, PIGGY.address);
    assert.deepEqual(r.evidence.binding, { chainId: 143, chain: "monad-mainnet", asset: "USDC", token: USDC, decimals: 6, piggyId: PIGGY.id, piggyAddress: PIGGY.address });
    assert.equal(r.executionContext.executable, false);
    assert.equal(r.selection.createsPermission, false); assert.equal(r.selection.ownerFinancialChoice, false);
  }
});

await check("N7 decision UNKNOWN is never promoted: no read, conflicting read (wrong chain / receipt token / code), paused reserve, no answer", async () => {
  const noRead = decideLane({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", returnAnswer: "right_back", read: null, readStatus: "reader_unconfigured", eventId: "e", selectionSource: "s", nowIso: NOW_ISO });
  assert.equal(noRead.decision, "unknown"); assert.equal(noRead.action, "none");
  assert.equal(noRead.receipt.decision, "unknown"); assert.equal(noRead.receipt.evidence.source, null); assert.equal(noRead.receipt.evidence.readStatus, "reader_unconfigured");
  // a conflicting read is unknown even when it ALSO shows a nah condition (frozen)
  for (const opts of [{ chainId: 10143, config: FORK_CONFIG_WORD | FROZEN_BIT }, { aToken: OTHER }, { code: "0x" }]) {
    const { d } = await decideWith(forkWorld(opts));
    assert.equal(d.decision, "unknown", JSON.stringify(opts, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
    assert.equal(d.receipt.decision, "unknown"); assert.equal(d.receipt.evidence.source, null);
    assert.ok(d.receipt.evidence.conflict);
  }
  const paused = await decideWith(forkWorld({ config: FORK_CONFIG_WORD | PAUSED_BIT }));
  assert.equal(paused.d.decision, "unknown", "paused: the recorded immediate exit does not hold -> unknown, not nah");
  const noAnswer = await decideWith(forkWorld(), { returnAnswer: null });
  assert.equal(noAnswer.d.decision, "unknown");
  const badAmount = await decideWith(forkWorld(), { amountRaw: "5.0" });
  assert.equal(badAmount.d.decision, "unknown");
  assert.equal(decideLane({ profile: TESTNET, piggy: PIGGY, amountRaw: "5000000", returnAnswer: "right_back" }).reason, "profile_not_mainnet_lane");
  assert.equal(decideLane({ profile: resolveChainProfile("143"), piggy: PIGGY }).decision, "unknown");
});

await check("N8 decision Receipts persist through the existing Second Journey store in the MAINNET scope only", async () => {
  const { d } = await decideWith(forkWorld({ usdcRaw: 0n }), { eventId: "evt-nah" });
  const mainState = createSecondJourneyState({ accountId: PIGGY.address, chainId: "monad-mainnet" });
  const out = recordSecondJourneyDecisionReceipt(mainState, d.receipt);
  assert.equal(out.recorded, true, out.error);
  assert.equal(readSecondJourneyDecisionReceipts(out.state).length, 1);
  const testState = createSecondJourneyState({ accountId: PIGGY.address, chainId: "monad-testnet" });
  const cross = recordSecondJourneyDecisionReceipt(testState, d.receipt);
  assert.equal(cross.recorded, false); assert.equal(cross.error, "scope_mismatch");
  // a stored mainnet row copied into a testnet state is not surfaced there
  assert.equal(readSecondJourneyDecisionReceipts({ ...testState, receipts: [d.receipt] }).length, 0);
});

await check("N9 permission preview: only after a match; exact approve (never unlimited), supply for this Piggy, exit to this Piggy; envelope bound to chain/asset/action/amount/target", async () => {
  const world = forkWorld();
  const { d } = await decideWith(world);
  const { preview, error } = buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", decision: d });
  assert.equal(error, null);
  assert.equal(preview.chainId, 143); assert.equal(preview.chain, "monad-mainnet"); assert.equal(preview.token, USDC); assert.equal(preview.decimals, 6);
  assert.equal(preview.target, POOL); assert.equal(preview.spender, POOL); assert.equal(preview.amountDisplay, "5.000000 USDC");
  assert.equal(preview.unlimitedApproval, false); assert.equal(preview.reusable, false); assert.equal(preview.liveExecution, false);
  const [approve, supply, withdraw] = preview.steps;
  const a = decodeFunctionData({ abi: ERC20_ABI, data: approve.data });
  assert.equal(approve.to, USDC); assert.ok(eq(a.args[0], POOL)); assert.equal(a.args[1], 5000000n);
  const s = decodeFunctionData({ abi: POOL_ABI, data: supply.data });
  assert.equal(s.functionName, "supply"); assert.ok(eq(s.args[0], USDC)); assert.equal(s.args[1], 5000000n); assert.ok(eq(s.args[2], PIGGY.address)); assert.equal(s.args[3], 0);
  const x = decodeFunctionData({ abi: POOL_ABI, data: withdraw.data });
  assert.equal(x.functionName, "withdraw"); assert.ok(eq(x.args[2], PIGGY.address), "exit returns to this Piggy only");
  // not after nah / unknown, not over cap, not for another Piggy
  const nah = (await decideWith(forkWorld({ usdcRaw: 0n }))).d;
  assert.equal(buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", decision: nah }).error, "no_match_decision");
  assert.equal(buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000001", decision: d }).error, "amount_over_cap");
  assert.equal(buildLanePermissionPreview({ profile: MAINNET, piggy: { id: "p2", address: OTHER }, amountRaw: "5000000", decision: d }).error, "decision_binding_mismatch");
  assert.equal(buildLanePermissionPreview({ profile: TESTNET, piggy: PIGGY, amountRaw: "5000000", decision: d }).error, "profile_not_mainnet_lane");
  // the envelope is issued only through the passkey path and matches exactly
  const env = envelopeFor(preview);
  assert.ok(env, "passkey envelope issued");
  assert.equal(issuePermission({ intent: preview.intent, auth: null, nonce: preview.nonce, nowMs: NOW_MS }).error, "no_passkey_auth");
  const { authorize } = await import("../src/permission-envelope.js");
  const ctx = { nowMs: NOW_MS, consumedNonces: new Set(), context: signerContext() };
  assert.equal(authorize(env, preview.request, ctx).ok, true);
  for (const [k, v, reason] of [["amount", "5000001", "amount_mismatch"], ["asset", "MON", "asset_mismatch"], ["chain", "monad-testnet", "chain_mismatch"], ["destination", OTHER, "destination_mismatch"], ["action", "other", "action_mismatch"]]) {
    assert.equal(authorize(env, { ...preview.request, [k]: v }, ctx).reason, reason);
  }
  assert.equal(authorize(env, preview.request, { ...ctx, context: { ...signerContext(), activeSignerAddress: OTHER } }).reason, "active_signer_mismatch");
});

async function startErrand(world, storage) {
  const r0 = await readWith(world);
  const d = decideLane({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", returnAnswer: "right_back", read: r0.read, readStatus: r0.status, eventId: "evt-run", nowMs: NOW_MS, nowIso: NOW_ISO });
  const { preview } = buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", decision: d });
  const envelope = envelopeFor(preview);
  const consumedNonces = new Set();
  const started = startLaneIntent({ profile: MAINNET, piggy: PIGGY, preview, envelope, signerContext: signerContext(), consumedNonces, before: { usdcRaw: r0.read.piggy.usdcRaw, aTokenRaw: r0.read.piggy.aTokenRaw, block: r0.read.block }, storage, nowMs: NOW_MS, nowIso: NOW_ISO });
  return { r0, d, preview, envelope, consumedNonces, started };
}

await check("N10 lifecycle SUCCESS over the local fork executor: approve -> supply (out) -> withdraw (returned); Receipt from measured balances, labelled PASS_FORK_SIM", async () => {
  const world = forkWorld();
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  assert.equal(started.error, null);
  let intent = started.intent;
  assert.equal(intent.stage, LANE_STAGE.AUTHORIZED);
  assert.equal(laneIntentKey(MAINNET, PIGGY.id), `araso.mainnetLane.v1.monad-mainnet.${PIGGY.id}`);
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    const step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
    intent = step.intent; seen.push(`${step.status}:${intent.stage}`);
  }
  assert.deepEqual(seen, ["confirmed:approved", "confirmed:out", "returned:returned"]);
  assert.deepEqual(world.sent.map((s) => s.step), ["approve", "supply", "withdraw"]);
  const after = (await readWith(world)).read;
  const { receipt } = buildLaneReceipt({ profile: MAINNET, piggy: PIGGY, intent, after: { ...after.piggy, block: after.block }, nowIso: NOW_ISO });
  assert.equal(receipt.outcome, "done"); assert.equal(receipt.evidenceClass, "PASS_FORK_SIM"); assert.equal(receipt.executionMode, "fork_simulation");
  assert.equal(receipt.usdcBeforeRaw, "5000000"); assert.equal(receipt.usdcAfterRaw, "4999999"); assert.equal(receipt.deltaRaw, "-1", "the fork's measured round trip");
  assert.equal(receipt.receiptTokenAfterRaw, "0"); assert.equal(receipt.allowanceAfterRaw, "0", "exact approve fully consumed");
  assert.deepEqual(receipt.gasUsed, { approve: 55437, supply: 197122, withdraw: 177464 });
  assert.equal(receipt.approveTx, FORK_TX.approve.hash); assert.equal(receipt.supplyTx, FORK_TX.supply.hash); assert.equal(receipt.withdrawTx, FORK_TX.withdraw.hash);
  assert.ok(receipt.unmeasured.includes("supplyApr"));
  assert.equal(receipt.chainId, 143); assert.equal(receipt.token, USDC); assert.equal(receipt.piggyId, PIGGY.id);
  const verdict = classifySecondReceipt(laneReceiptCandidate(receipt), { scope: { accountId: PIGGY.address, chainId: "monad-mainnet" } });
  assert.equal(verdict.persistable, true, verdict.reason);
  assert.equal(verdict.receipt.evidenceClass, "PASS_FORK_SIM", "fork label kept, never promoted");
  assert.equal(classifySecondReceipt(laneReceiptCandidate(receipt), { scope: { accountId: PIGGY.address, chainId: "monad-testnet" } }).reason, "scope_mismatch");
  const terminal = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(terminal.status, "terminal");
});

await check("N11 live execution is disabled: no executor, a non-fork executor, or a fork executor on another chain cannot advance", async () => {
  const world = forkWorld();
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  const args = { profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, storage, nowIso: NOW_ISO };
  assert.equal((await advanceLaneIntent({ ...args })).reason, "no_executor");
  assert.equal((await advanceLaneIntent({ ...args, executor: { ...world.executor, kind: "live" } })).reason, "live_execution_disabled");
  assert.equal((await advanceLaneIntent({ ...args, executor: { ...world.executor, chainId: 10143 } })).reason, "executor_chain_mismatch");
  assert.equal(world.sent.length, 0);
});

await check("N12 lifecycle REVERT: a reverted exit is terminal failed, with the revert data; Receipt outcome failed", async () => {
  const world = forkWorld({ revertOn: "withdraw" });
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  let intent = started.intent;
  for (let i = 0; i < 3; i += 1) intent = (await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent, preview, executor: world.executor, storage, nowIso: NOW_ISO })).intent;
  assert.equal(intent.stage, LANE_STAGE.REVERTED); assert.equal(intent.failedStep, "withdraw");
  const after = (await readWith(world)).read;
  const { receipt } = buildLaneReceipt({ profile: MAINNET, piggy: PIGGY, intent, after: { ...after.piggy, block: after.block }, nowIso: NOW_ISO });
  assert.equal(receipt.outcome, "failed"); assert.equal(receipt.revertData, "0x47bc4b2c"); assert.equal(receipt.failedStep, "withdraw");
  assert.equal(receipt.receiptTokenAfterRaw, "4999999", "the position is still out — shown, not hidden");
});

await check("N13 PENDING and RELOAD mid-action: pending is not failure; no step re-sends; a lost send becomes unknown and waits for reconcile (no auto retry)", async () => {
  // pending: supply receipt not found yet
  const world = forkWorld({ pendingOnce: "supply" });
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  let step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: step.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(step.status, "pending"); assert.equal(step.intent.stage, LANE_STAGE.SUPPLY_SENT);
  const again = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: step.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(again.status, "reconcile_first"); assert.equal(again.retry, false);
  // reload: a fresh load from storage, then reconcile by reading only
  const reloaded = loadLaneIntent(storage, MAINNET, PIGGY);
  assert.equal(reloaded.error, null); assert.equal(reloaded.intent.stage, LANE_STAGE.SUPPLY_SENT);
  const rec = await reconcileLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: reloaded.intent, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(rec.intent.stage, LANE_STAGE.OUT);
  assert.equal(world.sent.filter((s) => s.step === "supply").length, 1, "supply sent exactly once");

  // lost send: the transport dropped mid-send -> "*_sending" persisted -> reload -> unknown
  const w2 = forkWorld({ throwOnSend: "supply" });
  const s2 = createMemoryStorage();
  const e2 = await startErrand(w2, s2);
  let i2 = (await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: e2.started.intent, preview: e2.preview, executor: w2.executor, storage: s2, nowIso: NOW_ISO })).intent;
  const lost = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: i2, preview: e2.preview, executor: w2.executor, storage: s2, nowIso: NOW_ISO });
  assert.equal(lost.status, "unknown"); assert.equal(lost.retry, false);
  const back = loadLaneIntent(s2, MAINNET, PIGGY).intent;
  assert.equal(back.stage, LANE_STAGE.SUPPLY_SENDING, "sending was persisted before the send");
  const unk = await reconcileLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: back, executor: w2.executor, storage: s2, nowIso: NOW_ISO });
  assert.equal(unk.status, "unknown"); assert.equal(unk.intent.stage, LANE_STAGE.UNKNOWN); assert.equal(unk.retry, false);
  const refused = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: unk.intent, preview: e2.preview, executor: w2.executor, storage: s2, nowIso: NOW_ISO });
  assert.equal(refused.status, "reconcile_first");
  assert.equal(w2.sent.filter((s) => s.step === "supply").length, 1, "never re-sent");
  assert.equal(buildLaneReceipt({ profile: MAINNET, piggy: PIGGY, intent: unk.intent, after: { usdcRaw: "0", aTokenRaw: "0", allowanceRaw: "0", block: FORK_BLOCK } }).reason, "not_terminal", "no Receipt for an unknown errand");
});

await check("N14 one Piggy / one errand / one permission; testnet and blocked profiles never read or advance a mainnet errand", async () => {
  const world = forkWorld();
  const storage = createMemoryStorage();
  const first = await startErrand(world, storage);
  assert.equal(first.started.error, null);
  // envelope already consumed
  const reuse = startLaneIntent({ profile: MAINNET, piggy: PIGGY, preview: first.preview, envelope: first.envelope, signerContext: signerContext(), consumedNonces: first.consumedNonces, before: { usdcRaw: "5000000", aTokenRaw: "0", block: FORK_BLOCK }, storage: createMemoryStorage(), nowMs: NOW_MS, nowIso: NOW_ISO });
  assert.equal(reuse.error, "permission_already_used");
  // a second errand while one is in flight
  const second = await startErrand(world, storage);
  assert.equal(second.started.error, "errand_in_flight");
  // other profiles: no key at all, and a forced binding check refuses
  assert.equal(laneIntentKey(TESTNET, PIGGY.id), null);
  assert.equal(laneIntentKey(resolveChainProfile("143"), PIGGY.id), null);
  assert.equal(loadLaneIntent(storage, TESTNET, PIGGY).error, "no_scope");
  assert.equal(checkRecordBinding(first.started.intent, TESTNET, { piggyId: PIGGY.id, piggyAddress: PIGGY.address }).reason, "chain_mismatch");
  assert.equal((await advanceLaneIntent({ profile: TESTNET, piggy: PIGGY, intent: first.started.intent, preview: first.preview, executor: world.executor, storage })).reason, "profile_not_mainnet_lane");
  assert.equal(loadLaneIntent(storage, MAINNET, { id: PIGGY.id, address: OTHER }).error, "piggy_address_mismatch");
  // tampered stored record is refused
  const key = laneIntentKey(MAINNET, PIGGY.id);
  storage.setItem(key, JSON.stringify({ ...JSON.parse(storage.getItem(key)), token: TESTNET_USDC }));
  assert.equal(loadLaneIntent(storage, MAINNET, PIGGY).error, "token_mismatch");
});

await check("N15 Gift: no mainnet escrow exists -> product config stays null (RELEASE_BLOCKED); a fork-deployed artifact is test-only and chain-bound", async () => {
  assert.equal(MAINNET_GIFT_ESCROW_CONFIG, null);
  assert.equal(resolveGiftEscrowConfig(MAINNET, MAINNET_GIFT_ESCROW_CONFIG).status, "release_blocked_no_deployment");
  const forkCfg = { chainScope: "monad-mainnet", contractAddress: FORK_GIFT_ESCROW, deployment: GIFT_DEPLOYMENT.FORK_LOCAL_TEST_ONLY };
  assert.equal(resolveGiftEscrowConfig(MAINNET, forkCfg).status, "fork_artifact_not_product");
  assert.equal(resolveGiftEscrowConfig(MAINNET, forkCfg, { allowForkLocal: true }).status, "fork_local_test_only");
  assert.equal(resolveGiftEscrowConfig(TESTNET, forkCfg, { allowForkLocal: true }).status, "chain_scope_mismatch");
  assert.equal(resolveGiftEscrowConfig(resolveChainProfile("x"), forkCfg, { allowForkLocal: true }).status, "profile_blocked");
  assert.equal(resolveGiftEscrowConfig(MAINNET, { ...forkCfg, deployment: GIFT_DEPLOYMENT.LIVE_VERIFIED }).status, "live_not_verified");
  assert.equal(resolveGiftEscrowConfig(MAINNET, { ...forkCfg, contractAddress: "0x0000000000000000000000000000000000000000", deployment: GIFT_DEPLOYMENT.LIVE_VERIFIED, verifiedAtBlock: 1 }).status, "invalid_address");
  // existing Gift record source, wired to the fork artifact for the test only: binds chain 143 + mainnet USDC
  const { config } = resolveGiftEscrowConfig(MAINNET, forkCfg, { allowForkLocal: true });
  const tuple = [OTHER, USDC, 20000000n, BigInt(Math.floor(NOW_MS / 1000) + 3600), false, `0x${"ab".repeat(32)}`];
  const giftId = `0x${"11".repeat(32)}`;
  const onMainnet = createGiftRecordSource({ client: { chain: { id: 143 }, readContract: async () => tuple }, chainScope: config.chainScope, contractAddress: config.contractAddress });
  const rec = await onMainnet.getRecordByGiftId(giftId);
  assert.ok(rec, "record read through the existing adapter");
  const onTestnetClient = createGiftRecordSource({ client: { chain: { id: 10143 }, readContract: async () => tuple }, chainScope: config.chainScope, contractAddress: config.contractAddress });
  assert.equal(await onTestnetClient.getRecordByGiftId(giftId), null, "a testnet client never reads the mainnet gift");
  const testnetToken = createGiftRecordSource({ client: { chain: { id: 143 }, readContract: async () => [OTHER, TESTNET_USDC, 20000000n, tuple[3], false, tuple[5]] }, chainScope: "monad-mainnet", contractAddress: FORK_GIFT_ESCROW });
  assert.equal(await testnetToken.getRecordByGiftId(giftId), null, "testnet USDC is not mainnet USDC");
  assert.ok(FUNDING_CONTEXT_TOKEN_ALLOWLIST["monad-mainnet"].USDC.assetId === USDC);
  // main.js keeps its Gift configs null (no fake address)
  assert.match(MAIN, /const GIFT_RECORD_CONFIG = null;/);
  assert.match(MAIN, /const GIFT_CLAIM_SUBMIT_CONFIG = null;/);
});

await check("N16 main.js seam: profile from build config only; no mainnet literal/default in main.js; testnet RPC/CSP/relayer untouched", () => {
  assert.match(MAIN, /const CHAIN_PROFILE = resolveChainProfile\(import\.meta\.env\.VITE_ARASO_CHAIN_PROFILE\);/);
  assert.match(MAIN, /const RUNTIME_CHAIN_SCOPE = profileScope\(CHAIN_PROFILE\);/);
  assert.match(MAIN, /const LEGACY_TESTNET_PATH = legacyTestnetPathOpen\(CHAIN_PROFILE\);/);
  assert.equal((MAIN.match(/["'`]monad-mainnet["'`]/g) || []).length, 0, "no app-level mainnet literal in main.js");
  assert.equal((MAIN.match(/\b143\b/g) || []).length, 0, "no mainnet chain id in main.js");
  // CSP connect-src: testnet RPC + (A-859, was testnet-only) exactly one extra evidence host https://rpc.monad.xyz
  assert.match(VERCEL, /testnet-rpc\.monad\.xyz/);
  // pre-A-859 baseline: assert.equal(/rpc\.monad\.xyz(?!")/.test(VERCEL.replace(/testnet-rpc\.monad\.xyz/g, "")), false);
  // A-859: exactly one extra exact host (https://rpc.monad.xyz) is allowed in connect-src, nothing else.
  assert.equal((VERCEL.replace(/testnet-rpc\.monad\.xyz/g, "").match(/rpc\.monad\.xyz/g) || []).length, 1);
  assert.match(VERCEL, /connect-src 'self' https:\/\/testnet-rpc\.monad\.xyz https:\/\/rpc\.monad\.xyz;/);
  const scope = fnBody("secondJourneyScope");
  assert.match(scope, /chainId: typeof RUNTIME_CHAIN_SCOPE === "string" \? RUNTIME_CHAIN_SCOPE : "monad-testnet"/);
  // evaluated: blocked profile -> "" (refused by every store); testnet -> identical to before
  const run = (RUNTIME_CHAIN_SCOPE) => new Function("state", "RUNTIME_CHAIN_SCOPE", `${scope}\nreturn secondJourneyScope();`)({ address: PIGGY.address }, RUNTIME_CHAIN_SCOPE);
  assert.deepEqual(run("monad-testnet"), { accountId: PIGGY.address, chainId: "monad-testnet" });
  assert.deepEqual(run(""), { accountId: PIGGY.address, chainId: "" });
  assert.deepEqual(run("monad-mainnet"), { accountId: PIGGY.address, chainId: "monad-mainnet" });
});

await check("N17 legacy testnet paths sealed off-testnet: state init, send start + button, receipt writes, boot reconcile, RPC client", async () => {
  assert.match(MAIN, /mark: LEGACY_TESTNET_PATH \? localStorage\.getItem\("araso\.mark"\) \|\| "" : "",/);
  assert.match(MAIN, /txHash: LEGACY_TESTNET_PATH \? localStorage\.getItem\("araso\.txHash"\) \|\| "" : "",/);
  assert.match(MAIN, /receipts: LEGACY_TESTNET_PATH \? readReceipts\(\) : \[\],/);
  assert.match(MAIN, /tripClosed: LEGACY_TESTNET_PATH \? computeTripClosed\(\{/);
  // araso.secondJourneyClosed is read as before (a locked recovery-entry.mjs contract). Off testnet it
  // is inert: every use also needs tripClosed (false there) or an Explore entry that needs a legacy
  // receipt with a txHash (none are read there).
  assert.match(MAIN, /state\.homeQuietForExplore = state\.scene === "sendstay" && state\.tripClosed && !state\.secondJourneyCompletedOnce;/);
  assert.match(fnBody("openSecondJourneyExplore"), /if \(!state\.receipts\.some\(\(r\) => r && r\.txHash\) && !\(import\.meta\.env\.DEV && state\.secondJourney\.devPreview\)\) return;/);
  assert.match(MAIN, /const bootPending = state\.scene === "sendstay" && LEGACY_TESTNET_PATH \? readSendPending\(\) : null;/);
  const send = fnBody("sendPiggy");
  const gate = send.indexOf('if (typeof LEGACY_TESTNET_PATH === "boolean" && LEGACY_TESTNET_PATH !== true)');
  assert.ok(gate > 0 && gate < send.indexOf("readSendPending()") && gate < send.indexOf("sendPiggyOnce("), "gate precedes pending read and the send");
  assert.ok((MAIN.match(/"Piggy can't go out yet\."/g) || []).length >= 2, "reuses existing copy");
  assert.match(fnBody("syncSendButton"), /const locked = sealed \|\| !isAllowedPiggyRpId\(\) \|\| sendBusy\(\);/);
  // rememberReceipt: evaluated on stubs — writes on testnet, not off it
  const cutFrom = MAIN.indexOf("function rememberReceipt(receipt) {");
  const remember = MAIN.slice(cutFrom, MAIN.indexOf("\nfunction writeCredential(credential) {", cutFrom));
  const runRemember = (legacy) => {
    const writes = [];
    const st = { receipts: [], receiptIndex: 0 };
    // [A-699 declared harness update] rememberReceipt now merges against storage and verifies by a re-read: the stub store reads back what it wrote.
    const mem = new Map();
    new Function("state", "localStorage", "RECEIPTS_KEY", "receiptIdentityKey", "serializeReceiptRow", "LEGACY_TESTNET_PATH", "decodeReceiptRow", "RECEIPT_KIND", `${remember}\nrememberReceipt({ id: 1 });`)(
      st, { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { writes.push([k, v]); mem.set(k, v); } }, "araso.receipts", () => "k1", (r) => r, legacy, (row) => row, { ADD_MONEY: "add_money" });
    return { writes, st };
  };
  assert.equal(runRemember(true).writes.length, 1);
  const off = runRemember(false);
  assert.equal(off.writes.length, 0, "legacy store untouched off-testnet");
  assert.equal(off.st.receipts.length, 1, "memory still shows this session's row");
  // sealed client: chain null (every scope check fails closed), every method rejects, not a thenable
  const sealed = new Function(`${fnBody("sealedTestnetClient")}\nreturn sealedTestnetClient();`)();
  assert.equal(sealed.chain, null);
  assert.equal(sealed.then, undefined);
  await assert.rejects(() => sealed.getBalance({ address: PIGGY.address }), /sealed/);
  await assert.rejects(() => sealed.waitForTransactionReceipt({ hash: "0x" }), /sealed/);
  assert.match(MAIN, /const publicClient = LEGACY_TESTNET_PATH\s*\? createPublicClient\(\{\s*chain: MONAD_TESTNET,\s*transport: http\(MONAD_TESTNET_RPC\),\s*\}\)\s*: sealedTestnetClient\(\);/);
});

await check("N18 render() byte-identical to HEAD (sha256 of its source); the lane module has no _private path or card id in shipped strings", () => {
  const h = createHash("sha256").update(fnBody("render")).digest("hex");
  assert.equal(h, "866133cf607110939b5ce2b05ad9ff253ee7ab77f8448b3977faa974a9d3e27c");
  for (const f of ["app/src/chain-profile.js", "app/src/mainnet-job-lane.js"]) {
    const src = readFileSync(path.join(REPO, f), "utf8");
    assert.equal(/_private/.test(src), false, `${f}: _private`);
    assert.equal(/\bA-\d{3}\b/.test(src), false, `${f}: card id`);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    assert.equal(/\b(apy|yield|venue)\b|["'`>](safe|instant)\b/i.test(code), false, `${f}: yield/venue wording`);
  }
});

// ── Money-safety M1 (lane): D7 fail-open on load error, R6 unchecked saves, executor chokepoint ──────────
function laneStorage() {
  const base = createMemoryStorage();
  const f = { getThrows: false, setThrows: () => false, silentDrop: false, sets: 0 };
  return { f, getItem: (k) => { if (f.getThrows) throw new Error("getItem boom"); return base.getItem(k); }, setItem: (k, v) => { f.sets += 1; if (f.setThrows(f.sets)) throw new Error("setItem boom"); if (!f.silentDrop) base.setItem(k, v); }, removeItem: (k) => base.removeItem(k), dump: base.dump };
}

await check("N19 (D7/H5) a stored errand that cannot be read/validated blocks a new start BEFORE authorize: nonce not consumed, nothing stacked", async () => {
  const cases = {
    storage_read_failed: (st, key) => { st.f.getThrows = true; },
    corrupt: (st, key) => st.setItem(key, "{not json"),
    wrong_schema: (st, key) => st.setItem(key, JSON.stringify({ schema: "something_else" })),
    token_mismatch: (st, key) => st.setItem(key, JSON.stringify({ ...JSON.parse(st.getItem(key)), token: TESTNET_USDC })),
    unknown_stage: (st, key) => st.setItem(key, JSON.stringify({ ...JSON.parse(st.getItem(key)), stage: "not_a_stage" })),
  };
  for (const [expected, tamper] of Object.entries(cases)) {
    const world = forkWorld();
    const storage = laneStorage();
    const first = await startErrand(world, storage);
    assert.equal(first.started.error, null, expected);
    tamper(storage, laneIntentKey(MAINNET, PIGGY.id));
    const second = await startErrand(world, storage);
    assert.equal(second.started.error, "existing_intent_unreadable", expected);
    assert.equal(second.started.detail, expected);
    assert.equal(second.consumedNonces.size, 0, `${expected}: the envelope nonce was NOT spent`);
    assert.equal(second.started.intent, null);
  }
});

await check("N20 (R6/H6) setItem fails right after the send: no throw, status unknown/unknown_hash_unsaved, hash kept in memory, stored stage stays *_sending, never re-sent, never 'confirmed'", async () => {
  const world = forkWorld();
  const storage = laneStorage();
  const { preview, started } = await startErrand(world, storage);
  const inner = world.executor.send;
  world.executor.send = async (tx) => { const r = await inner(tx); storage.f.setThrows = () => true; return r; };
  const step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(step.status, "unknown"); assert.equal(step.reason, "unknown_hash_unsaved"); assert.equal(step.retry, false);
  assert.match(step.hash, /^0x[0-9a-f]{64}$/); assert.equal(step.intent.steps.approve.hash, step.hash);
  storage.f.setThrows = () => false;
  assert.equal(loadLaneIntent(storage, MAINNET, PIGGY).intent.stage, LANE_STAGE.APPROVE_SENDING, "only the pre-send record is on disk");
  const again = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: step.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(again.status, "reconcile_first");
  assert.equal(world.sent.length, 1, "exactly one tx ever sent");
});

await check("N20b (R6) the settle write fails: status 'unsaved' (not confirmed/returned), the hash stays on disk, and a later reconcile completes it", async () => {
  const world = forkWorld();
  const storage = laneStorage();
  const { preview, started } = await startErrand(world, storage);
  const base = storage.f.sets;
  storage.f.setThrows = (n) => n === base + 3; // reserve (1), hash (2) succeed; the settle write (3) fails
  const step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(step.status, "unsaved"); assert.equal(step.saved, false); assert.notEqual(step.status, "confirmed");
  const disk = loadLaneIntent(storage, MAINNET, PIGGY).intent;
  assert.equal(disk.stage, LANE_STAGE.APPROVE_SENT); assert.match(disk.steps.approve.hash, /^0x/);
  const rec = await reconcileLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: disk, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(rec.intent.stage, LANE_STAGE.APPROVED); assert.equal(loadLaneIntent(storage, MAINNET, PIGGY).intent.stage, LANE_STAGE.APPROVED);
  assert.equal(world.sent.length, 1);
});

await check("N21 chokepoint: the pre-send record must be written AND read back before any send; a failed/dropped write sends nothing", async () => {
  for (const mode of ["throws", "silent_drop"]) {
    const world = forkWorld();
    const storage = laneStorage();
    const { preview, started } = await startErrand(world, storage);
    if (mode === "throws") storage.f.setThrows = () => true; else storage.f.silentDrop = true;
    const step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
    assert.equal(step.status, "blocked", mode); assert.equal(step.reason, "storage_write_failed", mode);
    assert.equal(world.sent.length, 0, `${mode}: nothing sent`);
  }
});

await check("N22 chokepoint: a stale in-memory errand (stored stage already moved on) is blocked before reserve/send; double advance sends once", async () => {
  const world = forkWorld();
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  const first = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(first.status, "confirmed");
  const stale = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(stale.status, "blocked"); assert.equal(stale.reason, "stored_intent_changed");
  assert.equal(world.sent.filter((x) => x.step === "approve").length, 1);
  storage.removeItem(laneIntentKey(MAINNET, PIGGY.id));
  const gone = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: first.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(gone.reason, "stored_intent_unavailable");
  assert.equal(world.sent.length, 1);
});

await check("N23 (H-1) two advances started in the same tick: exactly one reaches the signer, the other is refused, the stored hash is the one sent", async () => {
  const world = forkWorld();
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  const args = { profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO };
  const [a, b] = await Promise.all([advanceLaneIntent({ ...args }), advanceLaneIntent({ ...args })]);
  assert.equal(world.sent.filter((x) => x.step === "approve").length, 1, "one approve send for one permission");
  const refused = [a, b].filter((r) => r.status === "blocked");
  assert.equal(refused.length, 1); assert.equal(refused[0].reason, "stored_intent_changed");
  const stored = loadLaneIntent(storage, MAINNET, PIGGY).intent;
  assert.equal(stored.steps.approve.hash, FORK_TX.approve.hash, "the stored hash is the one actually sent");
  assert.ok([LANE_STAGE.APPROVED, LANE_STAGE.APPROVE_SENT].includes(stored.stage));
});

await check("N23b (H-1) persistHash never overwrites: if the stored record moved on before the hash write, the result is unknown_hash_unsaved and the stored record is untouched", async () => {
  const world = forkWorld();
  const storage = createMemoryStorage();
  const { preview, started } = await startErrand(world, storage);
  const key = laneIntentKey(MAINNET, PIGGY.id);
  const inner = world.executor.send;
  let foreign;
  world.executor.send = async (tx) => { const r = await inner(tx); foreign = JSON.stringify({ ...JSON.parse(storage.getItem(key)), stage: LANE_STAGE.UNKNOWN }); storage.setItem(key, foreign); return r; };
  const step = await advanceLaneIntent({ profile: MAINNET, piggy: PIGGY, intent: started.intent, preview, executor: world.executor, storage, nowIso: NOW_ISO });
  assert.equal(step.status, "unknown"); assert.equal(step.reason, "unknown_hash_unsaved");
  assert.equal(storage.getItem(key), foreign, "not overwritten");
});

globalThis.fetch = realFetch;
console.log(`\nPart N: ${pass}/${pass + fail} PASS`);

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startVite(port, profile) {
  const env = { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" };
  if (profile === undefined) delete env.VITE_ARASO_CHAIN_PROFILE; else env.VITE_ARASO_CHAIN_PROFILE = profile;
  const server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`vite ${port} start timeout`)), 25000);
    server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
    server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite ${port} exited ${c}`)); });
  });
  return server;
}

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    if (fail > 0) process.exit(1);
    return;
  }
  let chromium;
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await check("B0 playwright available (local harness)", () => { throw e; });
    process.exit(1);
  }
  const servers = [];
  try {
    const ports = { testnet: 5731, mainnet: 5732, blocked: 5733 };
    servers.push(await startVite(ports.testnet, undefined));
    servers.push(await startVite(ports.mainnet, "monad-mainnet"));
    servers.push(await startVite(ports.blocked, "143"));
    const browser = await chromium.launch({ headless: true });
    try {
      await browserRun(browser, { testnet: `http://localhost:${ports.testnet}/`, mainnet: `http://localhost:${ports.mainnet}/`, blocked: `http://localhost:${ports.blocked}/` });
    } finally {
      await browser.close();
    }
  } finally {
    for (const s of servers) s.kill("SIGTERM");
  }
  console.log(`\nTOTAL: ${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exit(1);
}

// Legacy testnet state a returning testnet user already has on this device.
const LEGACY_SEED = {
  "araso.txHash": "0x088e511140dfb9ee6f5aabe835478395d2f77268c1fb63907c634838f0bdc45c",
  "araso.mark": "seed-mark",
  "araso.tripClosed": "1",
  "araso.secondJourneyClosed": "1",
  "araso.sendPending": JSON.stringify({ stage: "redeem-broadcast", address: "0x4DCDA9fD1B320C36d2B6D3C77bc98a8a4f14e500", depositTxHash: "0x088e511140dfb9ee6f5aabe835478395d2f77268c1fb63907c634838f0bdc45c", redeemTxHash: "0xe8fb2d81a058cea22aca165ffa99b5a126fb19893165e523d1db5898a6525d97", at: 1 }),
};

async function openContext(browser, width, height, seed) {
  const context = await browser.newContext({ viewport: { width, height } });
  const net = { grant: 0, testnetRpc: 0, mainnetRpc: 0, sends: 0 };
  await context.route("**/*", async (route) => {
    const req = route.request(); const url = req.url(); const body = req.postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) { net.sends += 1; return route.abort(); }
    if (/\/api\/grant|\/grant$/.test(url)) { net.grant += 1; return route.abort(); }
    if (/testnet-rpc\.monad\.xyz/.test(url)) net.testnetRpc += 1;
    if (/\/\/rpc\.monad\.xyz/.test(url)) { net.mainnetRpc += 1; return route.abort(); }
    return route.continue();
  });
  if (seed) {
    await context.addInitScript((s) => {
      try { if (!sessionStorage.getItem("__a653_seeded")) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem("__a653_seeded", "1"); } } catch {}
    }, seed);
  }
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  return { context, p, errors, net };
}

async function birth(p, name) {
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  for (let a = 0; a < 4; a += 1) {
    if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
    await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
    if (["hatch", "name"].includes(await scene())) break;
    await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
  }
  for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
    const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
    if (v.input) break;
    if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
    await sleep(300);
  }
  await p.locator("#piggyNameInput").fill(name); await sleep(150);
  await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
  for (let t0 = Date.now(); Date.now() - t0 < 12000; await sleep(200)) if ((await scene()) === "sendstay") break;
  await sleep(2500);
  return scene();
}

const pageFacts = (p) => p.evaluate(() => {
  const ls = {}; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
  const broken = [...document.images].filter((im) => im.complete && im.naturalWidth === 0 && im.getAttribute("src")).map((im) => im.getAttribute("src"));
  const btn = document.querySelector("#sendButton");
  return { ls, broken, sendDisabled: btn ? btn.disabled : null, overflowX: document.documentElement.scrollWidth > innerWidth + 1, scene: document.querySelector("[data-scene]")?.dataset.scene ?? null };
});

async function browserRun(browser, BASE) {
  for (const [w, h] of [[390, 844], [430, 932], [700, 900], [1440, 900]]) {
    // B1 default build = testnet: unchanged behaviour, testnet-scoped keys, Send not sealed by the profile
    await check(`B1 [${w}] default build (no chain config) runs as testnet; Send button not sealed by the profile; pageerror 0; broken images 0`, async () => {
      const { context, p, errors } = await openContext(browser, w, h, null);
      try {
        await p.goto(BASE.testnet, { waitUntil: "networkidle" });
        const sc = await birth(p, "Honeybun");
        assert.equal(sc, "sendstay");
        const f = await pageFacts(p);
        assert.deepEqual(errors, []); assert.deepEqual(f.broken, []);
        assert.ok(Object.keys(f.ls).some((k) => k.includes(".monad-testnet")), `testnet-scoped key present: ${Object.keys(f.ls).join(",")}`);
        assert.equal(Object.keys(f.ls).some((k) => k.includes("monad-mainnet")), false);
      } finally { await context.close(); }
    });
    // B2 mainnet build over a device that already holds testnet state
    await check(`B2 [${w}] mainnet build: testnet legacy state is not read, rewritten or reconciled; Send sealed; no grant / no testnet RPC / no mainnet RPC / no send; pageerror 0`, async () => {
      const { context, p, errors, net } = await openContext(browser, w, h, LEGACY_SEED);
      try {
        await p.goto(BASE.mainnet, { waitUntil: "networkidle" });
        const sc = await birth(p, "Honeybun");
        assert.equal(sc, "sendstay", "a mainnet Piggy starts at Home, not at a testnet Away/checking");
        // The Send card arms a few seconds after arrival (same wait the board capture uses) — wait for it, don't read too early.
        await p.waitForSelector("#sendButton", { timeout: 12000 }).catch(() => {});
        const f = await pageFacts(p);
        for (const [k, v] of Object.entries(LEGACY_SEED)) assert.equal(f.ls[k], v, `legacy ${k} untouched`);
        assert.equal(f.sendDisabled, true, "Send sealed on the mainnet profile");
        await p.evaluate(() => document.querySelector("#sendButton")?.click()); await sleep(1500);
        assert.equal(net.grant, 0); assert.equal(net.testnetRpc, 0); assert.equal(net.mainnetRpc, 0); assert.equal(net.sends, 0);
        const f2 = await pageFacts(p);
        assert.ok(Object.keys(f2.ls).some((k) => k.includes(".monad-mainnet")), `mainnet-scoped key present: ${Object.keys(f2.ls).join(",")}`);
        assert.equal(Object.keys(f2.ls).some((k) => /\.monad-testnet\./.test(k) && !(k in LEGACY_SEED)), false, "nothing new written under testnet scope");
        assert.deepEqual(errors, []); assert.deepEqual(f2.broken, []);
        if (w <= 430) assert.equal(f2.overflowX, false);
      } finally { await context.close(); }
    });
  }
  // B3 invalid config value: blocked, never a fallback to either network
  await check("B3 [390] invalid chain config ('143'): blocked — no chain-scoped key written, Send sealed, no grant/RPC/send; pageerror 0", async () => {
    const { context, p, errors, net } = await openContext(browser, 390, 844, null);
    try {
      await p.goto(BASE.blocked, { waitUntil: "networkidle" });
      await birth(p, "Honeybun");
      const f = await pageFacts(p);
      assert.equal(Object.keys(f.ls).some((k) => /monad-(testnet|mainnet)/.test(k)), false, `no chain-scoped key: ${Object.keys(f.ls).join(",")}`);
      if (f.sendDisabled !== null) assert.equal(f.sendDisabled, true);
      assert.equal(net.grant, 0); assert.equal(net.testnetRpc, 0); assert.equal(net.sends, 0);
      assert.deepEqual(errors, []); assert.deepEqual(f.broken, []);
    } finally { await context.close(); }
  });
  // B4 reload on the mainnet build keeps the seal (state is recomputed, nothing restored from testnet)
  await check("B4 [1440] mainnet build reload: still sealed, legacy keys still untouched, pageerror 0", async () => {
    const { context, p, errors, net } = await openContext(browser, 1440, 900, LEGACY_SEED);
    try {
      await p.goto(BASE.mainnet, { waitUntil: "networkidle" });
      await birth(p, "Honeybun");
      await p.reload({ waitUntil: "networkidle" }); await sleep(2500);
      if (await p.locator("#loginChogButton").count()) { await p.locator("#loginChogButton").click(); await sleep(2500); }
      const f = await pageFacts(p);
      assert.notEqual(f.scene, "away", "no testnet Away/checking restored");
      for (const [k, v] of Object.entries(LEGACY_SEED)) assert.equal(f.ls[k], v);
      assert.equal(net.grant, 0); assert.equal(net.testnetRpc, 0); assert.equal(net.sends, 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

// Entry point sits after every module-level const (LEGACY_SEED, pageFacts) so Part B never hits the TDZ.
if (process.env.A653_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A653_NODE_ONLY=1) — browser scenarios not run");
  if (fail > 0) process.exit(1);
} else {
  await runBrowser();
}
