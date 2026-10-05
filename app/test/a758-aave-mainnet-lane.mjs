// Aave mainnet lane: execution-boundary hardening (local only, no network, live execution off).
//   node app/test/a758-aave-mainnet-lane.mjs
//
// Every step of the Aave errand goes through advanceAaveLaneGuarded (second-execution-adapter.js), which
// re-checks on the STORED errand, before the lane's one send: the exact envelope, current block-tagged evidence,
// supply-cap + exit-liquidity evidence, local amount/gas/fee caps, and that the authorized calldata was not
// replaced. Unknown outcomes stay unknown and are reconciled by reading only. The world below replays the
// mainnet-fork measurements (chain 143, block 108,999,816) over an in-memory transport; `fetch` throws.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult } from "viem";

import { resolveChainProfile } from "../src/chain-profile.js";
import {
  LANE_FORK_EVIDENCE, LANE_SELECTORS, LANE_STAGE, MAINNET_LANE_CONFIG,
  buildLanePermissionPreview, decideLane, laneIntentKey, loadLaneIntent, readLanePreAction, startLaneIntent,
} from "../src/mainnet-job-lane.js";
import { issuePermission } from "../src/permission-envelope.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import {
  AAVE_GUARD_UNKNOWN, advanceAaveLaneGuarded, aaveCapacityProblem, aaveEvidenceProblem, aavePreviewDigest, buildAaveGuardedReceipt,
  checkAaveFeeGuard, classifySecondSendPending, makeSecondDepositTx, makeSecondRedeemTx, rebuildAaveLaneSteps, reconcileAaveLaneReadOnly,
  reconcileSecondPendingOnBoot, revalidateAaveEnvelope, runSecondPlumbingProof, secondMoneyLockName, secondSendPendingBelongsToScope,
  secondSendPendingKey,
} from "../src/second-execution-adapter.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, "../src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}

globalThis.fetch = () => { throw new Error("network is forbidden in this test"); };

// ── exact fork values (same as a653) ───────────────────────────────────────────────────────────
const CHAIN = 143;
const FORK_BLOCK = 108999816;
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";
const ATOKEN = "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042";
const FORK_CONFIG_WORD = 7237005577332262213973186568752005780840647977154502683997290204037023014220n;
const PIGGY = { id: "legacy-0x32b8b801348386f62ca7ca1647c7092012dd5661", address: "0x32b8B801348386f62cA7ca1647c7092012dd5661" };
const OTHER = "0x81DbCA3540Fe6320F5Ff781433FCdd8Fd0fF8F89";
const FORK_TX = Object.freeze({
  approve: { hash: "0x0f83e686459ea995b198fa593567bb92" + "1968564105c4c4051a9c618f9bd56757", block: 108999818, gasUsed: 55437 },
  supply: { hash: "0x161a73f3e5df47b9d4ebd7398631d776" + "22fd9d3c47a43f4242aa340a9cdfca0b", block: 108999819, gasUsed: 197122 },
  withdraw: { hash: "0x052806a2ccd9fc26f9430f12d77b7627" + "e7edb960fcab7a1e3c3b1df81275ee08", block: 108999820, gasUsed: 177464 },
});
const NOW_ISO = "2026-09-30T03:30:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const MAINNET = resolveChainProfile("monad-mainnet");
const AMOUNT = "5000000";

const POOL_ABI = [
  { type: "function", name: "getReserveData", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "configuration", type: "uint256" }, { name: "liquidityIndex", type: "uint128" }, { name: "currentLiquidityRate", type: "uint128" },
    { name: "variableBorrowIndex", type: "uint128" }, { name: "currentVariableBorrowRate", type: "uint128" }, { name: "currentStableBorrowRate", type: "uint128" },
    { name: "lastUpdateTimestamp", type: "uint40" }, { name: "id", type: "uint16" }, { name: "aTokenAddress", type: "address" },
    { name: "stableDebtTokenAddress", type: "address" }, { name: "variableDebtTokenAddress", type: "address" }, { name: "interestRateStrategyAddress", type: "address" },
    { name: "accruedToTreasury", type: "uint128" }, { name: "unbacked", type: "uint128" }, { name: "isolationModeTotalDebt", type: "uint128" }] }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [{ type: "uint256" }] },
];
const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function forkWorld({ kind = "local_fork", throwOnSend = null, pendingOnce = null } = {}) {
  const w = { block: FORK_BLOCK, usdcRaw: 5000000n, aTokenRaw: 0n, allowanceRaw: 0n };
  const sent = [];
  const receipts = new Map();
  const pendingLeft = new Set(pendingOnce ? [pendingOnce] : []);
  const rpc = async (url, init) => {
    const req = JSON.parse(init.body);
    const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) });
    if (req.method === "eth_chainId") return ok(`0x${CHAIN.toString(16)}`);
    if (req.method === "eth_blockNumber") return ok(`0x${w.block.toString(16)}`);
    if (req.method === "eth_getCode") return ok(eq(req.params[0], POOL) ? "0x6080604052" : "0x");
    if (req.method === "eth_call") {
      const [{ to, data }] = req.params;
      const sel = data.slice(0, 10);
      if (eq(to, POOL) && sel === LANE_SELECTORS.getReserveData) {
        const zero = "0x0000000000000000000000000000000000000000";
        return ok(encodeFunctionResult({ abi: POOL_ABI, functionName: "getReserveData", result: {
          configuration: FORK_CONFIG_WORD, liquidityIndex: 0n, currentLiquidityRate: 0n, variableBorrowIndex: 0n, currentVariableBorrowRate: 0n,
          currentStableBorrowRate: 0n, lastUpdateTimestamp: 1790673863, id: 0, aTokenAddress: ATOKEN, stableDebtTokenAddress: zero,
          variableDebtTokenAddress: zero, interestRateStrategyAddress: zero, accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n,
        } }));
      }
      const word = (v) => ok(encodeAbiParameters([{ type: "uint256" }], [v]));
      if (sel === LANE_SELECTORS.balanceOf && eq(to, USDC)) return word(w.usdcRaw);
      if (sel === LANE_SELECTORS.balanceOf && eq(to, ATOKEN)) return word(w.aTokenRaw);
      if (sel === LANE_SELECTORS.allowance && eq(to, USDC)) return word(w.allowanceRaw);
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not allowed" } }) };
  };
  const executor = {
    kind, chainId: CHAIN, forkBlock: FORK_BLOCK,
    async send(tx) {
      const sel = tx.data.slice(0, 10);
      const step = sel === LANE_SELECTORS.approve ? "approve" : sel === LANE_SELECTORS.supply ? "supply" : sel === LANE_SELECTORS.withdraw ? "withdraw" : null;
      sent.push({ step, tx });
      if (throwOnSend === step) throw new Error("transport dropped mid-send");
      const f = FORK_TX[step];
      if (step === "approve") w.allowanceRaw = BigInt(decodeFunctionData({ abi: ERC20_ABI, data: tx.data }).args[1]);
      if (step === "supply") { w.usdcRaw -= 5000000n; w.aTokenRaw += 4999999n; w.allowanceRaw = 0n; }
      if (step === "withdraw") { w.usdcRaw += w.aTokenRaw; w.aTokenRaw = 0n; }
      receipts.set(f.hash, { status: "success", gasUsed: f.gasUsed, blockNumber: f.block });
      w.block = f.block;
      return { hash: f.hash };
    },
    async receipt(hash) {
      const step = Object.entries(FORK_TX).find(([, v]) => v.hash === hash)?.[0];
      if (step && pendingLeft.has(step)) { pendingLeft.delete(step); return null; }
      return receipts.get(hash) || null;
    },
  };
  return { w, sent, executor, transport: { rpcUrl: "https://fork.local.invalid/rpc", fetchImpl: rpc, now: () => NOW_ISO } };
}

const CAPS = Object.freeze({ maxReadAgeMs: 60000, maxGasUnits: { approve: "80000", supply: "260000", withdraw: "240000" }, maxFeeWei: "50000000000000000" });
const QUOTE = Object.freeze({
  approve: { gasLimit: "70000", maxFeePerGasWei: "100000000000" },
  supply: { gasLimit: "250000", maxFeePerGasWei: "100000000000" },
  withdraw: { gasLimit: "230000", maxFeePerGasWei: "100000000000" },
});
const signerContext = (piggy = PIGGY) => ({ selectedPiggyId: piggy.id, selectedPiggyAddress: piggy.address, activeSignerAddress: piggy.address });

// The lane's own read, plus the capacity evidence taken at the same block.
async function freshRead(world, extra = {}) {
  const r = await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address, ...world.transport });
  assert.equal(r.status, "ok");
  return { ...r.read, supplyCap: { block: r.read.block, capRaw: "1000000000000", suppliedRaw: "0" }, exitLiquidity: { block: r.read.block, availableRaw: "100000000000" }, ...extra };
}

// One errand started through the existing path: decide -> preview -> passkey envelope -> startLaneIntent (consumes).
async function started(opts = {}) {
  const world = forkWorld(opts);
  const storage = createMemoryStorage();
  const r0 = await readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY.address, ...world.transport });
  const decision = decideLane({ profile: MAINNET, piggy: PIGGY, amountRaw: AMOUNT, returnAnswer: "right_back", read: r0.read, readStatus: r0.status, eventId: "evt-a758", selectionSource: "app_ui_jit_answer", nowMs: NOW_MS, nowIso: NOW_ISO });
  assert.equal(decision.decision, "match");
  const { preview } = buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: AMOUNT, decision });
  const envelope = issuePermission({ intent: preview.intent, auth: { method: "passkey", verified: true, verifiedAt: NOW_MS - 1000 }, nonce: preview.nonce, nowMs: NOW_MS }).envelope;
  const consumedNonces = new Set();
  const s = startLaneIntent({ profile: MAINNET, piggy: PIGGY, preview, envelope, signerContext: signerContext(), consumedNonces, before: { usdcRaw: r0.read.piggy.usdcRaw, aTokenRaw: r0.read.piggy.aTokenRaw, block: r0.read.block }, storage, nowMs: NOW_MS, nowIso: NOW_ISO });
  assert.equal(s.error, null);
  return { world, storage, preview, envelope, consumedNonces, intent: s.intent };
}

function stepArgs(ctx, read, step, over = {}) {
  return {
    profile: MAINNET, piggy: PIGGY, intent: loadLaneIntent(ctx.storage, MAINNET, PIGGY).intent, preview: ctx.preview, envelope: ctx.envelope,
    signerContext: signerContext(), consumedNonces: ctx.consumedNonces, read, quote: QUOTE[step], caps: CAPS, executor: ctx.world.executor,
    storage: ctx.storage, nowMs: NOW_MS, nowIso: NOW_ISO, ...over,
  };
}
const stage = (ctx) => loadLaneIntent(ctx.storage, MAINNET, PIGGY).intent.stage;

// ═══ tests ══════════════════════════════════════════════════════════════════════════════════════
await check("G1 guarded round trip: approve -> supply -> withdraw, each on a fresh read; lane gets the rebuilt calldata", async () => {
  const ctx = await started();
  const steps = [];
  for (const step of ["approve", "supply", "withdraw"]) {
    const out = await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), step));
    assert.equal(out.step, step);
    assert.ok(["confirmed", "returned"].includes(out.status), `${step}: ${out.status} ${out.reason}`);
    assert.equal(out.retry, false);
    assert.equal(out.quoted.gasUsd, "UNKNOWN");
    steps.push(out);
  }
  assert.equal(stage(ctx), LANE_STAGE.RETURNED);
  const rebuilt = rebuildAaveLaneSteps({ token: USDC, pool: POOL, piggyAddress: PIGGY.address, amountRaw: AMOUNT });
  assert.deepEqual(ctx.world.sent.map((s) => s.tx.data), rebuilt.map((s) => s.data));
  assert.equal(steps[0].previewDigest, aavePreviewDigest(ctx.intent.nonce, rebuilt));
});

await check("G2 rebuilt calldata is byte-identical to the lane's own preview (approve exact, supply onBehalfOf Piggy, withdraw max to Piggy)", async () => {
  const ctx = await started();
  const rebuilt = rebuildAaveLaneSteps({ token: USDC, pool: POOL, piggyAddress: PIGGY.address, amountRaw: AMOUNT });
  assert.deepEqual(rebuilt.map((s) => [s.step, s.to.toLowerCase(), s.data]), ctx.preview.steps.map((s) => [s.step, s.to.toLowerCase(), s.data]));
  assert.ok(Object.isFrozen(rebuilt) && rebuilt.every(Object.isFrozen));
  for (const bad of [{ token: [USDC], pool: POOL, piggyAddress: PIGGY.address, amountRaw: AMOUNT }, { token: USDC, pool: POOL, piggyAddress: PIGGY.address, amountRaw: "0" }, { token: USDC, pool: POOL, piggyAddress: PIGGY.address, amountRaw: 5000000 }]) {
    assert.equal(rebuildAaveLaneSteps(bad), null);
  }
});

await check("E1 envelope revalidated at the boundary: missing / unsealed / expired / other nonce / not consumed / other signer / other amount all fail closed, nothing sent", async () => {
  const ctx = await started();
  const read = await freshRead(ctx.world);
  const other = issuePermission({ intent: { ...ctx.preview.intent, amount: "4000000" }, auth: { method: "passkey", verified: true, verifiedAt: NOW_MS - 1000 }, nonce: ctx.preview.nonce, nowMs: NOW_MS }).envelope;
  const otherNonce = issuePermission({ intent: ctx.preview.intent, auth: { method: "passkey", verified: true, verifiedAt: NOW_MS - 1000 }, nonce: `${ctx.preview.nonce}-x`, nowMs: NOW_MS }).envelope;
  const cases = [
    [{ envelope: null }, "no_permission"],
    [{ envelope: { ...ctx.envelope } }, "envelope_not_sealed"],
    [{ nowMs: ctx.envelope.expiresAt + 1 }, "permission_expired"],
    [{ nowMs: undefined }, "permission_clock_missing"],
    [{ envelope: otherNonce }, "envelope_nonce_mismatch"],
    [{ consumedNonces: new Set() }, "envelope_not_consumed_for_errand"],
    [{ consumedNonces: [ctx.preview.nonce] }, "envelope_not_consumed_for_errand"],
    [{ signerContext: { ...signerContext(), activeSignerAddress: OTHER } }, "active_signer_mismatch"],
    [{ signerContext: null }, "no_selection_context"],
    [{ envelope: other }, "amount_mismatch"],
  ];
  for (const [over, reason] of cases) {
    const out = await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", over));
    assert.equal(out.status, "blocked", reason);
    assert.equal(out.reason, reason);
    assert.equal(out.sent, false);
  }
  assert.equal(ctx.world.sent.length, 0);
  assert.equal(stage(ctx), LANE_STAGE.AUTHORIZED);
  assert.equal(revalidateAaveEnvelope({ envelope: ctx.envelope, intent: ctx.intent, signerContext: signerContext(), consumedNonces: ctx.consumedNonces, nowMs: NOW_MS }), null);
});

await check("E2 a stale in-memory errand (stage or nonce differs from storage) is refused before any check passes", async () => {
  const ctx = await started();
  const read = await freshRead(ctx.world);
  for (const intent of [{ ...ctx.intent, stage: LANE_STAGE.APPROVED }, { ...ctx.intent, nonce: "x" }, null]) {
    const out = await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { intent }));
    assert.equal(out.reason, "stored_intent_changed");
  }
  assert.equal(ctx.world.sent.length, 0);
});

await check("R1 pre-send evidence must be current, block-tagged and name this destination / Piggy / chain", async () => {
  const ctx = await started();
  const good = await freshRead(ctx.world);
  const cases = [
    [null, "evidence_missing"],
    [{ ...good, block: FORK_BLOCK - 1, source: `x @${FORK_BLOCK - 1}` }, "stale_evidence"],
    [{ ...good, source: "read-only rpc" }, "evidence_block_untagged"],
    [{ ...good, block: "108999816" }, "evidence_block_missing"],
    [{ ...good, chainId: 10143 }, "evidence_chain_mismatch"],
    [{ ...good, pool: OTHER }, "destination_evidence_mismatch"],
    [{ ...good, codePresent: false }, "destination_code_absent"],
    [{ ...good, reserve: { ...good.reserve, aTokenAddress: OTHER } }, "receipt_token_mismatch"],
    [{ ...good, reserve: { ...good.reserve, decimals: 18 } }, "decimals_mismatch"],
    [{ ...good, reserve: { ...good.reserve, frozen: true } }, "reserve_not_accepting_supply"],
    [{ ...good, piggy: { ...good.piggy, address: OTHER } }, "piggy_mismatch"],
    [{ ...good, piggy: { ...good.piggy, allowanceRaw: undefined } }, "balance_evidence_missing"],
    [{ ...good, piggy: { ...good.piggy, usdcRaw: "4999999" } }, "balance_below_amount"],
    [{ ...good, stale: true }, "stale_evidence"],
    [{ ...good, observedAt: "2026-09-30T03:28:00.000Z" }, "stale_evidence"],
    [{ ...good, observedAt: "2026-09-30T03:31:00.000Z" }, "evidence_from_future"],
    [{ ...good, observedAt: undefined }, "evidence_time_missing"],
    [{ ...good, expiresAtMs: NOW_MS }, "stale_evidence"],
  ];
  for (const [read, reason] of cases) {
    const out = await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve"));
    assert.equal(out.reason, reason, JSON.stringify(read && { block: read.block, source: read.source }));
  }
  // No freshness window stated -> freshness cannot be shown -> refused (no default window exists).
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, good, "approve", { caps: { ...CAPS, maxReadAgeMs: undefined } }))).reason, "freshness_window_unknown");
  assert.equal(ctx.world.sent.length, 0);
});

await check("R2 supply needs allowance == the exact amount at a block not older than the confirmed approve", async () => {
  const ctx = await started();
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "approve"))).status, "confirmed");
  const good = await freshRead(ctx.world);
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, { ...good, piggy: { ...good.piggy, allowanceRaw: "5000001" } }, "supply"))).reason, "allowance_not_exact");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, { ...good, piggy: { ...good.piggy, allowanceRaw: "0" } }, "supply"))).reason, "allowance_not_exact");
  // A read from before the approve landed (the approve receipt's block) is stale for the supply step.
  const old = { ...good, block: FORK_TX.approve.block - 1, source: `x @${FORK_TX.approve.block - 1}`, supplyCap: { ...good.supplyCap, block: FORK_TX.approve.block - 1 }, exitLiquidity: { ...good.exitLiquidity, block: FORK_TX.approve.block - 1 } };
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, old, "supply"))).reason, "stale_evidence");
  assert.equal(ctx.world.sent.length, 1);
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, good, "supply"))).status, "confirmed");
});

await check("C1 capacity is explicit and fail-closed: supply-cap evidence before entry, exit liquidity on every step", async () => {
  const ctx = await started();
  const good = await freshRead(ctx.world);
  const cases = [
    [{ ...good, supplyCap: undefined }, "supply_cap_unknown"],
    [{ ...good, supplyCap: { ...good.supplyCap, block: good.block - 1 } }, "supply_cap_unknown"],
    [{ ...good, supplyCap: { block: good.block, capRaw: "10000000", suppliedRaw: "5000001" } }, "supply_cap_exceeded"],
    [{ ...good, exitLiquidity: undefined }, "exit_liquidity_unknown"],
    [{ ...good, exitLiquidity: { block: good.block, availableRaw: 1e12 } }, "exit_liquidity_unknown"],
    [{ ...good, exitLiquidity: { block: good.block, availableRaw: "4999999" } }, "exit_liquidity_insufficient"],
  ];
  for (const [read, reason] of cases) assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve"))).reason, reason);
  assert.equal(ctx.world.sent.length, 0);
  // Exit precheck on withdraw: liquidity must cover the whole position; missing evidence refuses.
  for (const step of ["approve", "supply"]) assert.ok(["confirmed"].includes((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), step))).status));
  const out = await freshRead(ctx.world);
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, { ...out, exitLiquidity: undefined }, "withdraw"))).reason, "exit_liquidity_unknown");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, { ...out, exitLiquidity: { block: out.block, availableRaw: "4999998" } }, "withdraw"))).reason, "exit_liquidity_insufficient");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, { ...out, reserve: { ...out.reserve, paused: true } }, "withdraw"))).reason, "reserve_exit_unavailable");
  // supply-cap evidence is not required to take money back
  assert.equal(aaveCapacityProblem({ read: { ...out, supplyCap: undefined }, intent: loadLaneIntent(ctx.storage, MAINNET, PIGGY).intent, step: "withdraw" }), null);
  assert.equal(ctx.world.sent.length, 2);
});

await check("F1 fee / gas / amount caps only from measured or quoted integers; missing quote or cap refuses; gasUsd stays UNKNOWN", () => {
  const base = { step: "supply", amountRaw: AMOUNT, quote: QUOTE.supply, caps: CAPS };
  const ok = checkAaveFeeGuard(base);
  assert.equal(ok.problem, null);
  assert.equal(ok.quoted.maxFeeWei, (250000n * 100000000000n).toString());
  assert.equal(ok.quoted.forkMeasuredGasUsed, LANE_FORK_EVIDENCE.gasUsed.supply);
  assert.equal(ok.quoted.gasUsd, "UNKNOWN");
  assert.equal(checkAaveFeeGuard({ ...base, quote: { ...QUOTE.supply, gasUsd: "0.01" } }).quoted.gasUsd, "UNKNOWN", "a caller-supplied USD figure is never taken");
  const cases = [
    [{ quote: undefined }, "gas_quote_unknown"],
    [{ quote: { gasLimit: 250000, maxFeePerGasWei: "1" } }, "gas_quote_unknown"],
    [{ quote: { gasLimit: "250000" } }, "fee_quote_unknown"],
    [{ quote: { gasLimit: "197121", maxFeePerGasWei: "1" } }, "gas_limit_below_measured"],
    [{ caps: { ...CAPS, maxGasUnits: undefined } }, "gas_cap_unknown"],
    [{ caps: { ...CAPS, maxGasUnits: { supply: "200000" } } }, "gas_over_cap"],
    [{ caps: { ...CAPS, maxFeeWei: undefined } }, "fee_cap_unknown"],
    [{ caps: { ...CAPS, maxFeeWei: "1" } }, "fee_over_cap"],
    [{ amountRaw: "5000001" }, "amount_over_cap"],
    [{ caps: { ...CAPS, amountCapRaw: "4999999" } }, "amount_over_cap"],
    [{ caps: { ...CAPS, amountCapRaw: "lots" } }, "amount_over_cap"],
    [{ amountRaw: "0" }, "amount_not_exact"],
    [{ step: "sweep" }, "no_step"],
  ];
  for (const [over, problem] of cases) assert.equal(checkAaveFeeGuard({ ...base, ...over }).problem, problem, problem);
});

await check("F2 a step with no quote or no caps is refused at the boundary and sends nothing", async () => {
  const ctx = await started();
  const read = await freshRead(ctx.world);
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { quote: null }))).reason, "gas_quote_unknown");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { caps: { maxReadAgeMs: 60000 } }))).reason, "gas_cap_unknown");
  assert.equal(ctx.world.sent.length, 0);
});

await check("P1 the authorized preview cannot be replaced: changed calldata / target / request / nonce is refused", async () => {
  const ctx = await started();
  const read = await freshRead(ctx.world);
  const p = ctx.preview;
  const evilWithdraw = "0x69328dec" + encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "address" }], [USDC, 2n ** 256n - 1n, OTHER]).slice(2);
  const cases = [
    [{ ...p, steps: p.steps.map((s) => (s.step === "withdraw" ? { ...s, data: evilWithdraw } : s)) }, "preview_replaced"],
    [{ ...p, steps: p.steps.map((s) => (s.step === "approve" ? { ...s, to: OTHER } : s)) }, "preview_replaced"],
    [{ ...p, steps: p.steps.slice(0, 2) }, "preview_replaced"],
    [{ ...p, target: OTHER }, "preview_destination_mismatch"],
    [{ ...p, nonce: "other" }, "preview_nonce_mismatch"],
    [{ ...p, amountRaw: "1" }, "preview_amount_mismatch"],
    [{ ...p, unlimitedApproval: true }, "preview_scope_mismatch"],
    [{ ...p, liveExecution: true }, "preview_scope_mismatch"],
    [{ ...p, request: { ...p.request, destination: OTHER } }, "preview_request_mismatch"],
    [null, "preview_unreadable"],
  ];
  for (const [preview, reason] of cases) assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { preview }))).reason, reason);
  assert.equal(ctx.world.sent.length, 0);
});

await check("P2 getter TOCTOU: a preview whose steps change after the check never reaches the executor (lane gets the sealed copy)", async () => {
  const ctx = await started();
  const read = await freshRead(ctx.world);
  let reads = 0;
  const evil = ctx.preview.steps.map((s) => ({ ...s, data: s.step === "approve" ? "0x095ea7b3" + encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [OTHER, 2n ** 255n]).slice(2) : s.data }));
  const shifty = { ...ctx.preview };
  Object.defineProperty(shifty, "steps", { enumerable: true, get() { reads += 1; return reads === 1 ? ctx.preview.steps : evil; } });
  const out = await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { preview: shifty }));
  assert.equal(out.status, "confirmed");
  assert.equal(reads, 1, "the caller's preview is read exactly once");
  assert.equal(ctx.world.sent[0].tx.data, ctx.preview.steps[0].data);
  assert.ok(eq(ctx.world.sent[0].tx.to, USDC));
});

await check("U1 unknown outcome stays unknown: no retry, the next guarded step is reconcile_first, the reconcile reader cannot send", async () => {
  const ctx = await started({ throwOnSend: "supply" });
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "approve"))).status, "confirmed");
  const u = await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "supply"));
  assert.equal(u.status, "unknown"); assert.equal(u.retry, false); assert.equal(u.next, "reconcile_read_only");
  assert.equal(stage(ctx), LANE_STAGE.SUPPLY_SENDING);
  const again = await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "supply", { intent: loadLaneIntent(ctx.storage, MAINNET, PIGGY).intent }));
  assert.equal(again.status, "reconcile_first"); assert.equal(again.retry, false); assert.equal(again.sent, false);
  const sentBefore = ctx.world.sent.length;
  let sendTouched = false;
  const spy = { ...ctx.world.executor, send: async () => { sendTouched = true; throw new Error("must not send"); } };
  const rec = await reconcileAaveLaneReadOnly({ profile: MAINNET, piggy: PIGGY, executor: spy, storage: ctx.storage, nowIso: NOW_ISO });
  assert.equal(rec.status, "unknown"); assert.equal(rec.reason, "broadcast_unknown"); assert.equal(rec.retry, false); assert.equal(rec.sent, false);
  assert.equal(stage(ctx), LANE_STAGE.UNKNOWN);
  const still = await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "supply"));
  assert.equal(still.status, "reconcile_first");
  assert.equal(sendTouched, false);
  assert.equal(ctx.world.sent.length, sentBefore);
});

await check("U2 receipt not found yet = pending; read-only reconcile settles it from the receipt without a send", async () => {
  const ctx = await started({ pendingOnce: "approve" });
  const p = await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "approve"));
  assert.equal(p.status, "pending"); assert.equal(p.next, "reconcile_read_only"); assert.equal(p.retry, false);
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "supply"))).status, "reconcile_first");
  const readerOnly = { receipt: ctx.world.executor.receipt };
  const rec = await reconcileAaveLaneReadOnly({ profile: MAINNET, piggy: PIGGY, executor: readerOnly, storage: ctx.storage, nowIso: NOW_ISO });
  assert.equal(rec.status, "confirmed");
  assert.equal(stage(ctx), LANE_STAGE.APPROVED);
  assert.equal(ctx.world.sent.length, 1);
  assert.equal((await reconcileAaveLaneReadOnly({ profile: MAINNET, piggy: PIGGY, executor: null, storage: ctx.storage })).status, "idle");
});

await check("Q1 Receipt keeps quoted and measured apart: measured gas from step receipts, quoted gas limits from the quote, USD unknown in both", async () => {
  const ctx = await started();
  const quotes = {};
  for (const step of ["approve", "supply", "withdraw"]) quotes[step] = (await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), step))).quoted;
  const after = await freshRead(ctx.world);
  const intent = loadLaneIntent(ctx.storage, MAINNET, PIGGY).intent;
  const { record } = buildAaveGuardedReceipt({ profile: MAINNET, piggy: PIGGY, intent, after: { usdcRaw: after.piggy.usdcRaw, aTokenRaw: after.piggy.aTokenRaw, allowanceRaw: after.piggy.allowanceRaw, block: after.block }, nowIso: NOW_ISO, quotes });
  assert.equal(record.outcome, "done");
  assert.deepEqual({ ...record.measured.gasUsed }, { approve: 55437, supply: 197122, withdraw: 177464 });
  assert.deepEqual(Object.fromEntries(Object.entries(record.quoted.gas).map(([k, v]) => [k, v.gasLimit])), { approve: "70000", supply: "250000", withdraw: "230000" });
  assert.equal(record.measured.deltaRaw, "-1");
  assert.equal(record.quoted.amountRaw, AMOUNT);
  assert.equal(record.quoted.returnRaw, AAVE_GUARD_UNKNOWN);
  assert.equal(record.quoted.gasUsd, "UNKNOWN"); assert.equal(record.measured.gasUsd, "UNKNOWN");
  assert.ok(record.unmeasured.includes("gasUsd"));
  // no quotes -> quoted side is UNKNOWN; it never borrows the measured value (and vice versa)
  const bare = buildAaveGuardedReceipt({ profile: MAINNET, piggy: PIGGY, intent, after: { usdcRaw: after.piggy.usdcRaw, aTokenRaw: after.piggy.aTokenRaw, allowanceRaw: after.piggy.allowanceRaw, block: after.block }, nowIso: NOW_ISO }).record;
  assert.equal(bare.quoted.gas.supply.gasLimit, "UNKNOWN");
  assert.equal(bare.measured.gasUsed.supply, 197122);
  const noGas = { ...intent, steps: { ...intent.steps, supply: { ...intent.steps.supply, gasUsed: null } } };
  const r2 = buildAaveGuardedReceipt({ profile: MAINNET, piggy: PIGGY, intent: noGas, after: { usdcRaw: after.piggy.usdcRaw, aTokenRaw: after.piggy.aTokenRaw, allowanceRaw: after.piggy.allowanceRaw, block: after.block }, nowIso: NOW_ISO, quotes }).record;
  assert.equal(r2.measured.gasUsed.supply, "UNKNOWN");
  assert.equal(r2.quoted.gas.supply.gasLimit, "250000");
  assert.equal(buildAaveGuardedReceipt({ profile: MAINNET, piggy: PIGGY, intent: ctx.intent, after: null }).record, null);
});

await check("L1 live stays off: config frozen false/null; a profile with liveExecution or a non-fork executor sends nothing", async () => {
  assert.deepEqual({ ...MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
  assert.ok(Object.isFrozen(MAINNET_LANE_CONFIG));
  assert.equal(MAINNET.liveExecution, false);
  const ctx = await started();
  const read = await freshRead(ctx.world);
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { profile: { ...MAINNET, liveExecution: true } }))).reason, "live_execution_disabled");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { profile: { ...MAINNET, liveExecution: undefined } }))).reason, "live_execution_disabled");
  const liveish = { ...ctx.world.executor, kind: "live" };
  const out = await advanceAaveLaneGuarded(stepArgs(ctx, read, "approve", { executor: liveish }));
  assert.equal(out.status, "blocked"); assert.equal(out.reason, "live_execution_disabled"); assert.equal(out.sent, false);
  assert.equal(ctx.world.sent.length, 0);
  assert.equal(stage(ctx), LANE_STAGE.AUTHORIZED);
});

await check("N1 null / malformed inputs answer with a refusal, never a throw (adapter-wide)", async () => {
  assert.equal((await advanceAaveLaneGuarded(null)).status, "blocked");
  assert.equal((await advanceAaveLaneGuarded()).status, "blocked");
  assert.equal((await reconcileAaveLaneReadOnly(null)).status, "unknown");
  assert.equal(revalidateAaveEnvelope(), "no_permission");
  assert.equal(aaveEvidenceProblem(), "evidence_missing");
  assert.equal(aaveCapacityProblem(), "evidence_missing");
  assert.equal(checkAaveFeeGuard().problem, "no_step");
  assert.equal(rebuildAaveLaneSteps(), null);
  const ctx = await started();
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "approve", { piggy: null }))).reason, "missing_piggy");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "approve", { piggy: { id: PIGGY.id, address: [PIGGY.address] } }))).reason, "missing_piggy");
  assert.equal((await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), "approve", { storage: null }))).reason, "stored_intent_unavailable");
  // existing plumbing-lane exports: null options / null scope / array receiver
  assert.deepEqual(await runSecondPlumbingProof(null), { outcome: "blocked", reason: "permission_not_confirmed" });
  assert.deepEqual(await reconcileSecondPendingOnBoot(null), { kind: "unknown", reason: "invalid_scope" });
  assert.deepEqual(await reconcileSecondPendingOnBoot({ scope: null, piggyId: "p" }), { kind: "unknown", reason: "invalid_scope" });
  assert.deepEqual(await classifySecondSendPending({ stage: "deposit-broadcast" }, null), { kind: "unknown" });
  assert.equal(secondSendPendingKey(null, "p"), null);
  assert.equal(secondMoneyLockName(null), null);
  assert.equal(secondSendPendingBelongsToScope({ stage: "deposit-broadcast" }, null), false);
  assert.throws(() => makeSecondDepositTx(1n, [PIGGY.address]), /invalid receiver/);
  assert.throws(() => makeSecondRedeemTx(1n, PIGGY.address, [PIGGY.address]), /invalid receiver/);
});

await check("N2 plumbing run reads the caller's scope and signer address once (getter TOCTOU cannot swap them after validation)", async () => {
  let addrReads = 0;
  let scopeReads = 0;
  const account = { get address() { addrReads += 1; return addrReads === 1 ? PIGGY.address : [OTHER]; } };
  const scope = { get accountId() { scopeReads += 1; return scopeReads === 1 ? "acct" : null; }, chainId: "monad-testnet" };
  const out = await runSecondPlumbingProof({
    confirm: true, scope, piggyId: "p1", amountWei: "1", account, storage: createMemoryStorage(),
    walletClient: { sendTransaction: async () => { throw new Error("no send"); } },
    publicClient: { waitForTransactionReceipt: async () => null, readContract: async () => 0n },
    isAppLocked: () => false, withMoneyLock: null,
  });
  assert.deepEqual(out, { outcome: "blocked", reason: "lock_unsupported" });
  assert.equal(addrReads, 1);
  assert.equal(scopeReads, 1);
});

await check("S1 source boundaries: one broadcast chokepoint, no fork-executor naming outside mainnet-job-*, Aave module imported only by the lane", () => {
  const adapter = strip(SRC("second-execution-adapter.js"));
  assert.equal(/\.sendTransaction\(|\.sendRawTransaction\(|executor\.send\(/.test(adapter), false);
  assert.equal(/local_fork/.test(SRC("second-execution-adapter.js")), false);
  assert.equal(/fetch\(|XMLHttpRequest|WebSocket|rpcUrl|https:\/\//.test(adapter), false, "the boundary opens no network");
  assert.equal(/liveExecution\s*:\s*true/.test(adapter), false);
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js"));
  assert.deepEqual(files.filter((f) => f !== "mainnet-job-aave.js" && /from "\.\/mainnet-job-aave\.js"/.test(SRC(f))), ["mainnet-job-lane.js"]);
  assert.equal(/advanceAaveLaneGuarded|reconcileAaveLaneReadOnly/.test(SRC("main.js")), false, "no product call site");
  assert.equal(laneIntentKey(MAINNET, PIGGY.id).startsWith("araso.mainnetLane.v1."), true);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
