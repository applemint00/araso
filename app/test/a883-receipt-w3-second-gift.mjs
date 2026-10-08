// A-883 · Receipt evidence W3 call-site wiring (Second + Gift), observation-only sidecar.
//
//   S  Second plumbing run / boot reconcile: tx evidence rows appear in an INJECTED store, after the result is final;
//      the money-path result, pending trail and broadcast count are identical with and without the sidecar.
//   L  Aave lane boundary (fork executor): fork hashes are reported but never written (readEligible:false, no seed).
//   D  Decisions: a decision receipt is a state_observation, reported only through onReport, never stored.
//   G  Gift submit: delivery / commit / claim tx evidence keyed per tx; the giftId gas ledger is untouched and a store
//      that IS the ledger is refused. No token / salt / preimage in any report.
//   F  Failure isolation: throwing / refusing / async-rejecting stores, throwing onReport, hostile evidence configs,
//      chain mismatch => swallowed into evidenceErrors; results identical; no unhandled rejection.
//   X  Source boundaries.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionResult, keccak256, parseTransaction, stringToHex } from "viem";

import {
  buildAaveGuardedReceipt, advanceAaveLaneGuarded, readSecondSendPending, reconcileAaveLaneReadOnly,
  reconcileSecondPendingOnBoot, runSecondPlumbingProof as runRaw, secondSendPendingKey, writeSecondSendPending,
} from "../src/second-execution-adapter.js";
import {
  LANE_SELECTORS, LANE_STAGE, buildLanePermissionPreview, decideCurrentCandidates, decideLane, loadLaneIntent, readLanePreAction, startLaneIntent,
} from "../src/mainnet-job-lane.js";
import { issuePermission } from "../src/permission-envelope.js";
import { createMemoryStorage as createJourneyMemoryStorage } from "../src/second-journey-state.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { createEvidenceStore } from "../src/receipt-evidence-store.js";
import { GIFT_CLAIM_SUBMIT_STATUS as GS, GIFT_ESCROW_CLAIM_ABI, bindGiftToNewPiggy, createGiftClaimSubmitter, createGiftGasClientDelivery } from "../src/gift-claim-entry.js";
import { CLAIM_STATUS, attachGiftValue, createClaimLink, sealClaimLink } from "../src/gift-piggy-claim-link.js";
import { buildGiftValueBinding } from "../src/gift-value-spec.js";
import { createGiftGasClient } from "../src/gift-gas-client.js";
import { createGiftGasLedger, createMemoryGiftGasStore } from "../src/gift-gas-ledger.js";

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}
const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(e));
globalThis.fetch = () => { throw new Error("network is forbidden in this test"); };

const SRC = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const big = (_k, v) => (typeof v === "bigint" ? `${v}n` : v);
// Volatile fields that differ between two runs regardless of the sidecar (wall clock / random reservation id).
const norm = (v) => JSON.stringify(v, big).replace(/\\?"at\\?":\d+/g, '"at":0').replace(/\\?"reservationId\\?":\\?"[^"\\]*\\?"/g, '"reservationId":"R"');
const mapStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => Object.fromEntries(m) }; };

// A real A-868 store over memory storage, with a call counter.
function evStore(chainId) {
  const storage = mapStorage();
  const store = createEvidenceStore({ storage, chainId });
  const calls = { append: 0 };
  return { storage, calls, store: { append: (r) => { calls.append += 1; return store.append(r); }, readAll: () => store.readAll() } };
}
const reportSink = () => { const reports = []; return { reports, onReport: (r) => { reports.push(r); } }; };
const AUTHORITY_KEYS = /permission|executable|authorize|envelope|canSend|ready|executionPermission/i;
function assertNoAuthority(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) { assert.equal(AUTHORITY_KEYS.test(k), false, `authority-like key ${k}`); assertNoAuthority(v); }
}

// ═══ S · Second plumbing (testnet actual) ═══════════════════════════════════════════════════════════════════
const HELD = new Set();
async function lock(name, body) { if (HELD.has(name)) return undefined; HELD.add(name); try { return await body(); } finally { HELD.delete(name); } }
const runPlumbing = (a) => runRaw({ isAppLocked: () => false, withMoneyLock: lock, ...a });
const SCOPE = { accountId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chainId: "monad-testnet" };
const PIGGY_ID = "piggy-1";
const ACCOUNT = { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
const DEP = `0x${"11".repeat(32)}`;
const RED = `0x${"22".repeat(32)}`;

function plumbingWorld({ failDeposit = false } = {}) {
  const sent = [];
  let deposited = false;
  const receipts = { [DEP]: { status: failDeposit ? "reverted" : "success", blockNumber: 100n }, [RED]: { status: "success", blockNumber: 101n } };
  const storage = mapStorage();
  const walletClient = {
    async prepareTransactionRequest(t) { return { ...t, type: "eip1559", chainId: 10143, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 7, gas: 21000n }; },
    async sendTransaction(tx) {
      sent.push(tx);
      if (Object.prototype.hasOwnProperty.call(tx, "value")) { deposited = true; return DEP; }
      return RED;
    },
  };
  const publicClient = {
    async waitForTransactionReceipt({ hash }) { return receipts[hash] || null; },
    async readContract({ functionName }) { if (functionName === "balanceOf") return deposited ? 777n : 0n; throw new Error(functionName); },
  };
  return { storage, walletClient, publicClient, sent };
}
const plumbingArgs = (w, extra = {}) => ({ storage: w.storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient: w.walletClient, publicClient: w.publicClient, ...extra });

await check("S1 plumbing success: 2 tx rows (deposit, redeem) in the injected store; result / storage / sends identical to no sidecar", async () => {
  const base = plumbingWorld();
  const outBase = await runPlumbing(plumbingArgs(base));
  const w = plumbingWorld();
  const ev = evStore(10143);
  const sink = reportSink();
  const out = await runPlumbing(plumbingArgs(w, { evidence: { store: ev.store, chainId: 10143, now: "2026-10-07T00:00:00.000Z", onReport: sink.onReport } }));
  assert.equal(out.outcome, "done");
  assert.equal(norm(out), norm(outBase));
  assert.equal(norm(w.storage.dump()), norm(base.storage.dump()));
  assert.equal(w.sent.length, base.sent.length);
  const rows = ev.store.readAll();
  assert.equal(rows.ok, true);
  assert.deepEqual(rows.active.map((r) => [r.txHash, r.journey, r.source, r.status, r.chainId]), [
    [DEP, "second.plumbing_proof.deposit", "second.plumbing_pending", "unknown", "10143"],
    [RED, "second.plumbing_proof.redeem", "second.plumbing_pending", "unknown", "10143"],
  ]);
  assert.equal(sink.reports.length, 1);
  const rep = sink.reports[0];
  assert.equal(rep.authority, "observation_only");
  assert.deepEqual(rep.evidenceErrors, []);
  assert.equal(rep.stored.length, 2);
  assert.ok(rep.staged.every((i) => i.kind === "tx" && i.authority === "observation_only"));
  assertNoAuthority(rep);
  assert.ok(Object.isFrozen(rep) && Object.isFrozen(rep.staged));
});

await check("S2 deposit reverted: result unchanged (failed), and the broadcast deposit hash is still observed (not dropped)", async () => {
  const outBase = await runPlumbing(plumbingArgs(plumbingWorld({ failDeposit: true })));
  const w = plumbingWorld({ failDeposit: true });
  const ev = evStore(10143);
  const out = await runPlumbing(plumbingArgs(w, { evidence: { store: ev.store, chainId: 10143 } }));
  assert.deepEqual(out, outBase);
  assert.deepEqual(out, { outcome: "failed", reason: "deposit_unconfirmed_or_reverted" });
  assert.deepEqual(ev.store.readAll().active.map((r) => [r.txHash, r.journey]), [[DEP, "second.plumbing_proof.deposit"]]);
  assert.equal(readSecondSendPending(w.storage, SCOPE, PIGGY_ID).stage, "deposit-broadcast", "pending trail kept exactly as before");
});

await check("S3 blocked before any broadcast: no hash => the sidecar maps and writes nothing", async () => {
  const ev = evStore(10143);
  const sink = reportSink();
  const out = await runPlumbing({ ...plumbingArgs(plumbingWorld()), confirm: false, evidence: { store: ev.store, chainId: 10143, onReport: sink.onReport } });
  assert.deepEqual(out, { outcome: "blocked", reason: "permission_not_confirmed" });
  assert.equal(ev.calls.append, 0);
  assert.equal(sink.reports.length, 0);
});

function seedPending(storage, stage = "deposit-broadcast") {
  const key = secondSendPendingKey(SCOPE, PIGGY_ID);
  const rec = { address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", reservationId: "r-1", shareBefore: "0", stage, depositTxHash: DEP };
  assert.equal(writeSecondSendPending(storage, key, rec).ok, true);
}

await check("S4 boot reconcile: the classified pending record's hash is observed after the result; result + storage identical", async () => {
  const reader = async (hash) => (hash === DEP ? { kind: "pending" } : { kind: "unknown" });
  // Round 2: writeSecondSendPending stamps `at: Date.now()`. Seed ONCE and clone the identical bytes into the second
  // storage before either reconcile runs; two separate seeds can straddle a millisecond and differ (flaky 1 ms diff).
  const s0 = mapStorage(); seedPending(s0);
  const s1 = mapStorage();
  for (const [k, v] of Object.entries(s0.dump())) s1.setItem(k, v);
  assert.deepEqual(s1.dump(), s0.dump());
  const base = await reconcileSecondPendingOnBoot({ storage: s0, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: reader });
  const ev = evStore(10143);
  const out = await reconcileSecondPendingOnBoot({ storage: s1, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: reader, evidence: { store: ev.store, chainId: 10143 } });
  assert.deepEqual(out, base);
  assert.deepEqual(s1.dump(), s0.dump());
  assert.deepEqual(ev.store.readAll().active.map((r) => [r.txHash, r.journey]), [[DEP, "second.plumbing_proof.deposit"]]);
  // none / out_of_scope: nothing classified, nothing observed
  const ev2 = evStore(10143);
  assert.deepEqual(await reconcileSecondPendingOnBoot({ storage: mapStorage(), scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: reader, evidence: { store: ev2.store, chainId: 10143 } }), { kind: "none" });
  assert.equal(ev2.calls.append, 0);
});

await check("S5 default none: no evidence (absent / null / {} / no sink) => the same promise path, no store call; reconcile is a plain function", async () => {
  assert.equal(reconcileSecondPendingOnBoot.constructor.name, "Function");
  const reader = async () => ({ kind: "pending" });
  for (const evidence of [undefined, null, {}, { chainId: 10143 }, 7, "x"]) {
    const s = mapStorage(); seedPending(s);
    const out = await reconcileSecondPendingOnBoot({ storage: s, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: reader, ...(evidence === undefined ? {} : { evidence }) });
    assert.deepEqual(out, { kind: "pending" });
  }
  const ev = evStore(10143);
  const out = await runPlumbing(plumbingArgs(plumbingWorld(), { evidence: { chainId: 10143 } }));
  assert.equal(out.outcome, "done");
  assert.equal(ev.calls.append, 0);
});

// ═══ F · failure isolation (Second) ═════════════════════════════════════════════════════════════════════════
await check("F1 throwing / refusing / async-rejecting / wrong-chain stores and throwing onReport never change the Second result", async () => {
  const outBase = await runPlumbing(plumbingArgs(plumbingWorld()));
  const throwing = { append() { throw new Error("store boom"); } };
  const refusing = { append: () => ({ ok: false, reason: "store_unsound" }) };
  const asyncReject = { append: () => Promise.reject(new Error("async boom")) };
  const getterThrows = Object.defineProperty({}, "append", { get() { throw new Error("getter boom"); } });
  const notAStore = { put() {} };
  const wrongChain = evStore(143).store; // store bound to mainnet, seeds are testnet 10143 => chain_mismatch from the store
  const cases = [
    [{ store: throwing, chainId: 10143 }, "evidence_store_threw"],
    [{ store: refusing, chainId: 10143 }, "store_unsound"],
    [{ store: asyncReject, chainId: 10143 }, "evidence_store_async_unconfirmed"],
    [{ store: getterThrows, chainId: 10143 }, "evidence_store_threw"],
    [{ store: notAStore, chainId: 10143 }, "evidence_store_unavailable"],
    [{ store: wrongChain, chainId: 10143 }, "chain_mismatch"],
    [{ store: refusing, chainId: 143 }, "chain_mismatch"], // mainnet id vs a monad-testnet record => mapping refuses
    [{ store: refusing }, "chain_unlabelled"],
  ];
  for (const [cfg, reason] of cases) {
    const sink = reportSink();
    const out = await runPlumbing(plumbingArgs(plumbingWorld(), { evidence: { ...cfg, onReport: sink.onReport } }));
    assert.equal(norm(out), norm(outBase), reason);
    assert.equal(sink.reports.length, 1, reason);
    // store-level failures land in evidenceErrors; a mapper refusal of the whole source lands in refused (A-878 contract)
    const seen = [...sink.reports[0].evidenceErrors, ...sink.reports[0].refused];
    assert.ok(seen.some((e) => e.reason === reason), `${reason}: ${JSON.stringify(seen)}`);
  }
  // a throwing / async-rejecting onReport
  for (const onReport of [() => { throw new Error("report boom"); }, () => Promise.reject(new Error("report async boom"))]) {
    const out = await runPlumbing(plumbingArgs(plumbingWorld(), { evidence: { store: evStore(10143).store, chainId: 10143, onReport } }));
    assert.equal(norm(out), norm(outBase));
  }
  // hostile evidence configs (throwing getters / revoked proxy)
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  const hostile = [proxy, Object.defineProperty({}, "store", { get() { throw new Error("cfg boom"); } }), new Proxy({}, { get() { throw new Error("proxy boom"); } })];
  for (const evidence of hostile) {
    assert.equal(norm(await runPlumbing(plumbingArgs(plumbingWorld(), { evidence }))), norm(outBase));
    const s = mapStorage(); seedPending(s);
    assert.deepEqual(await reconcileSecondPendingOnBoot({ storage: s, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "pending" }), evidence }), { kind: "pending" });
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(unhandled.length, 0, "no unhandled rejection from the evidence layer");
});

// ═══ L · Aave lane boundary (local fork executor) ═══════════════════════════════════════════════════════════
const CHAIN = 143;
const FORK_BLOCK = 108999816;
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";
const ATOKEN = "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042";
const FORK_CONFIG_WORD = 7237005577332262213973186568752005780840647977154502683997290204037023014220n;
const LPIGGY = { id: "legacy-0x32b8b801348386f62ca7ca1647c7092012dd5661", address: "0x32b8B801348386f62cA7ca1647c7092012dd5661" };
const FORK_TX = Object.freeze({
  approve: { hash: `0x${"a1".repeat(32)}`, block: 108999818, gasUsed: 55437 },
  supply: { hash: `0x${"a2".repeat(32)}`, block: 108999819, gasUsed: 197122 },
  withdraw: { hash: `0x${"a3".repeat(32)}`, block: 108999820, gasUsed: 177464 },
});
const NOW_ISO = "2026-09-30T03:30:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const MAINNET = resolveChainProfile("monad-mainnet");
const AMOUNT = "5000000";
const POOL_ABI = [{ type: "function", name: "getReserveData", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "tuple", components: [
  { name: "configuration", type: "uint256" }, { name: "liquidityIndex", type: "uint128" }, { name: "currentLiquidityRate", type: "uint128" },
  { name: "variableBorrowIndex", type: "uint128" }, { name: "currentVariableBorrowRate", type: "uint128" }, { name: "currentStableBorrowRate", type: "uint128" },
  { name: "lastUpdateTimestamp", type: "uint40" }, { name: "id", type: "uint16" }, { name: "aTokenAddress", type: "address" },
  { name: "stableDebtTokenAddress", type: "address" }, { name: "variableDebtTokenAddress", type: "address" }, { name: "interestRateStrategyAddress", type: "address" },
  { name: "accruedToTreasury", type: "uint128" }, { name: "unbacked", type: "uint128" }, { name: "isolationModeTotalDebt", type: "uint128" }] }] }];
const ERC20_APPROVE = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];
const eqA = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function forkWorld() {
  const w = { block: FORK_BLOCK, usdcRaw: 5000000n, aTokenRaw: 0n, allowanceRaw: 0n };
  const sent = [];
  const receipts = new Map();
  const rpc = async (_url, init) => {
    const req = JSON.parse(init.body);
    const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) });
    if (req.method === "eth_chainId") return ok(`0x${CHAIN.toString(16)}`);
    if (req.method === "eth_blockNumber") return ok(`0x${w.block.toString(16)}`);
    if (req.method === "eth_getCode") return ok(eqA(req.params[0], POOL) ? "0x6080604052" : "0x");
    if (req.method === "eth_call") {
      const [{ to, data }] = req.params;
      const sel = data.slice(0, 10);
      if (eqA(to, POOL) && sel === LANE_SELECTORS.getReserveData) {
        const zero = "0x0000000000000000000000000000000000000000";
        return ok(encodeFunctionResult({ abi: POOL_ABI, functionName: "getReserveData", result: {
          configuration: FORK_CONFIG_WORD, liquidityIndex: 0n, currentLiquidityRate: 0n, variableBorrowIndex: 0n, currentVariableBorrowRate: 0n,
          currentStableBorrowRate: 0n, lastUpdateTimestamp: 1790673863, id: 0, aTokenAddress: ATOKEN, stableDebtTokenAddress: zero,
          variableDebtTokenAddress: zero, interestRateStrategyAddress: zero, accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n,
        } }));
      }
      const word = (v) => ok(encodeAbiParameters([{ type: "uint256" }], [v]));
      if (sel === LANE_SELECTORS.balanceOf && eqA(to, USDC)) return word(w.usdcRaw);
      if (sel === LANE_SELECTORS.balanceOf && eqA(to, ATOKEN)) return word(w.aTokenRaw);
      if (sel === LANE_SELECTORS.allowance && eqA(to, USDC)) return word(w.allowanceRaw);
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not allowed" } }) };
  };
  const executor = {
    kind: "local_fork", chainId: CHAIN, forkBlock: FORK_BLOCK,
    async send(tx) {
      const sel = tx.data.slice(0, 10);
      const step = sel === LANE_SELECTORS.approve ? "approve" : sel === LANE_SELECTORS.supply ? "supply" : sel === LANE_SELECTORS.withdraw ? "withdraw" : null;
      sent.push({ step, tx });
      const f = FORK_TX[step];
      if (step === "approve") w.allowanceRaw = BigInt(decodeFunctionData({ abi: ERC20_APPROVE, data: tx.data }).args[1]);
      if (step === "supply") { w.usdcRaw -= 5000000n; w.aTokenRaw += 4999999n; w.allowanceRaw = 0n; }
      if (step === "withdraw") { w.usdcRaw += w.aTokenRaw; w.aTokenRaw = 0n; }
      receipts.set(f.hash, { status: "success", gasUsed: f.gasUsed, blockNumber: f.block });
      w.block = f.block;
      return { hash: f.hash };
    },
    async receipt(hash) { return receipts.get(hash) || null; },
  };
  return { w, sent, executor, transport: { rpcUrl: "https://fork.local.invalid/rpc", fetchImpl: rpc, now: () => NOW_ISO } };
}
const CAPS = Object.freeze({ maxReadAgeMs: 60000, maxGasUnits: { approve: "80000", supply: "260000", withdraw: "240000" }, maxFeeWei: "50000000000000000" });
const QUOTE = Object.freeze({ approve: { gasLimit: "70000", maxFeePerGasWei: "100000000000" }, supply: { gasLimit: "250000", maxFeePerGasWei: "100000000000" }, withdraw: { gasLimit: "230000", maxFeePerGasWei: "100000000000" } });
const signerContext = () => ({ selectedPiggyId: LPIGGY.id, selectedPiggyAddress: LPIGGY.address, activeSignerAddress: LPIGGY.address });
async function freshRead(world) {
  const r = await readLanePreAction({ profile: MAINNET, piggyAddress: LPIGGY.address, ...world.transport });
  assert.equal(r.status, "ok");
  return { ...r.read, supplyCap: { block: r.read.block, capRaw: "1000000000000", suppliedRaw: "0" }, exitLiquidity: { block: r.read.block, availableRaw: "100000000000" } };
}
async function started() {
  const world = forkWorld();
  const storage = createJourneyMemoryStorage();
  const r0 = await readLanePreAction({ profile: MAINNET, piggyAddress: LPIGGY.address, ...world.transport });
  const decision = decideLane({ profile: MAINNET, piggy: LPIGGY, amountRaw: AMOUNT, returnAnswer: "right_back", read: r0.read, readStatus: r0.status, eventId: "evt-a883", selectionSource: "app_ui_jit_answer", nowMs: NOW_MS, nowIso: NOW_ISO });
  assert.equal(decision.decision, "match");
  const { preview } = buildLanePermissionPreview({ profile: MAINNET, piggy: LPIGGY, amountRaw: AMOUNT, decision });
  const envelope = issuePermission({ intent: preview.intent, auth: { method: "passkey", verified: true, verifiedAt: NOW_MS - 1000 }, nonce: preview.nonce, nowMs: NOW_MS }).envelope;
  const consumedNonces = new Set();
  const s = startLaneIntent({ profile: MAINNET, piggy: LPIGGY, preview, envelope, signerContext: signerContext(), consumedNonces, before: { usdcRaw: r0.read.piggy.usdcRaw, aTokenRaw: r0.read.piggy.aTokenRaw, block: r0.read.block }, storage, nowMs: NOW_MS, nowIso: NOW_ISO });
  assert.equal(s.error, null);
  return { world, storage, preview, envelope, consumedNonces };
}
const stepArgs = (ctx, read, step, over = {}) => ({
  profile: MAINNET, piggy: LPIGGY, intent: loadLaneIntent(ctx.storage, MAINNET, LPIGGY).intent, preview: ctx.preview, envelope: ctx.envelope,
  signerContext: signerContext(), consumedNonces: ctx.consumedNonces, read, quote: QUOTE[step], caps: CAPS, executor: ctx.world.executor,
  storage: ctx.storage, nowMs: NOW_MS, nowIso: NOW_ISO, ...over,
});
async function roundTrip(evidence) {
  const ctx = await started();
  const outs = [];
  for (const step of ["approve", "supply", "withdraw"]) outs.push(await advanceAaveLaneGuarded(stepArgs(ctx, await freshRead(ctx.world), step, evidence ? { evidence } : {})));
  return { ctx, outs };
}

await check("L1 guarded fork round trip: results / stored errand / sends identical; FORK_SIM hashes reported, never written", async () => {
  const base = await roundTrip(null);
  const ev = evStore(143);
  const sink = reportSink();
  const got = await roundTrip({ store: ev.store, onReport: sink.onReport });
  assert.equal(norm(got.outs), norm(base.outs));
  assert.equal(norm(got.ctx.storage), norm(base.ctx.storage));
  assert.equal(got.ctx.world.sent.length, 3);
  assert.equal(loadLaneIntent(got.ctx.storage, MAINNET, LPIGGY).intent.stage, LANE_STAGE.RETURNED);
  assert.equal(ev.calls.append, 0, "a fork hash has no seed: nothing is appended");
  assert.equal(sink.reports.length, 3);
  const last = sink.reports[2];
  assert.deepEqual(last.staged.map((i) => [i.step, i.readEligible, i.seed, i.readRequest]), [["approve", false, null, null], ["supply", false, null, null], ["withdraw", false, null, null]]);
  assert.equal(last.refused.filter((r) => r.reason === "fork_simulation_hash_not_read").length, 3);
  assert.deepEqual(last.stored, []);
  assertNoAuthority(last);
});

await check("L2 read-only reconcile and the guarded Receipt: results identical; Receipt hashes reported as fork, never stored", async () => {
  const { ctx } = await roundTrip(null);
  const ev = evStore(143);
  const sink = reportSink();
  const recBase = await reconcileAaveLaneReadOnly({ profile: MAINNET, piggy: LPIGGY, executor: ctx.world.executor, storage: ctx.storage, nowIso: NOW_ISO });
  const rec = await reconcileAaveLaneReadOnly({ profile: MAINNET, piggy: LPIGGY, executor: ctx.world.executor, storage: ctx.storage, nowIso: NOW_ISO, evidence: { store: ev.store, onReport: sink.onReport } });
  assert.deepEqual(rec, recBase);
  const intent = loadLaneIntent(ctx.storage, MAINNET, LPIGGY).intent;
  const after = { usdcRaw: "5000000", aTokenRaw: "0", allowanceRaw: "0", block: 108999821 };
  const a = buildAaveGuardedReceipt({ profile: MAINNET, piggy: LPIGGY, intent, after, nowIso: NOW_ISO, quotes: {} });
  const b = buildAaveGuardedReceipt({ profile: MAINNET, piggy: LPIGGY, intent, after, nowIso: NOW_ISO, quotes: {}, evidence: { store: ev.store, onReport: sink.onReport } });
  assert.deepEqual(b, a);
  assert.ok(a.record);
  assert.equal(ev.calls.append, 0);
  const receiptReport = sink.reports.at(-1);
  assert.deepEqual(receiptReport.staged.map((i) => [i.source, i.step, i.readEligible]), [["second.lane_receipt", "approve", false], ["second.lane_receipt", "supply", false], ["second.lane_receipt", "withdraw", false]]);
  // a throwing store on the receipt builder changes nothing
  assert.deepEqual(buildAaveGuardedReceipt({ profile: MAINNET, piggy: LPIGGY, intent, after, nowIso: NOW_ISO, quotes: {}, evidence: { store: { append() { throw new Error("x"); } } } }), a);
});

// ═══ D · decisions = state_observation only ═════════════════════════════════════════════════════════════════
await check("D1 decision receipts go to onReport as state_observation only; the store is never touched; decisions identical", async () => {
  const ev = evStore(143);
  const sink = reportSink();
  const args = { profile: MAINNET, piggy: LPIGGY, amountRaw: AMOUNT, returnAnswer: "right_back", read: null, readStatus: "reader_unconfigured", eventId: "evt-d1", selectionSource: "app_ui_jit_answer", nowMs: NOW_MS, nowIso: NOW_ISO };
  const base = decideLane(args);
  const got = decideLane({ ...args, evidence: { store: ev.store, onReport: sink.onReport } });
  assert.deepEqual(got, base);
  assert.equal(base.decision, "unknown");
  assert.ok(base.receipt);
  const scope = { accountId: LPIGGY.address, chainId: "monad-mainnet" };
  const rows = { candidates: [{ id: "aave-usdc", status: "read_failed", reason: "no_rpc", read: null }, { id: "kintsu-smon", status: "read_failed", reason: "no_rpc", read: null }] };
  const cBase = decideCurrentCandidates({ currentRead: rows, scope, eventId: "evt-d2", nowMs: NOW_MS, nowIso: NOW_ISO });
  const cGot = decideCurrentCandidates({ currentRead: rows, scope, eventId: "evt-d2", nowMs: NOW_MS, nowIso: NOW_ISO, evidence: { store: ev.store, onReport: sink.onReport } });
  assert.deepEqual(cGot, cBase);
  assert.equal(ev.calls.append, 0, "a state observation never reaches a store");
  assert.equal(sink.reports.length, 3);
  for (const r of sink.reports) {
    assert.deepEqual([r.staged.length, r.stored.length, r.stateObservations.length, r.evidenceErrors.length], [0, 0, 1, 0]);
    const o = r.stateObservations[0];
    assert.equal(o.kind, "state_observation");
    assert.equal(o.txExecuted, false);
    for (const k of ["txHash", "evidenceKey", "readRequest", "seed"]) assert.equal(k in o, false, k);
    assertNoAuthority(r);
  }
  // throwing onReport / hostile config: decision unchanged, no throw
  assert.deepEqual(decideLane({ ...args, evidence: { onReport() { throw new Error("x"); } } }), base);
  assert.deepEqual(decideLane({ ...args, evidence: new Proxy({}, { get() { throw new Error("x"); } }) }), base);
});

// ═══ G · Gift ═══════════════════════════════════════════════════════════════════════════════════════════════
const GSCOPE = "monad-mainnet";
const UNITS = Object.freeze({ commitClaim: 120000n, claim: 90000n, fundingTransfer: 21000n });
const FEES = Object.freeze({ baseFeePerGasWei: 100_000_000_000n, priorityFeePerGasWei: 0n, source: "a883 fixture" });
const SENDER = "0x00000000000000000000000000000000000000d1";
const ESCROW = "0x00000000000000000000000000000000000000e5";
const GPIGGY = privateKeyToAccount(`0x${crypto.createHash("sha256").update("a883/piggy").digest("hex")}`);
const lower = (a) => String(a || "").toLowerCase();
const FIXED_SALT = new Uint8Array(32).fill(7);

// Full commit -> claim chain (stopAtCommit=true reproduces the a858 shape: delivery only, then COMMIT_FAILED).
function giftChain({ stopAtCommit = false } = {}) {
  const balances = new Map();
  const txs = new Map();
  const commits = new Map();
  let claimed = false;
  let head = 1000n;
  const mine = (t) => { head += 1n; txs.set(t.hash, { ...t, blockNumber: head }); return head; };
  const chain = {
    chain: { id: 143 },
    async getBalance({ address }) { return balances.get(lower(address)) ?? 0n; },
    async getTransactionCount() { return 0; },
    async sendRawTransaction({ serializedTransaction }) {
      if (stopAtCommit) throw new Error("test chain stops at commit");
      const tx = parseTransaction(serializedTransaction);
      const d = decodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, data: tx.data });
      const hash = keccak256(serializedTransaction);
      const block = mine({ hash, from: GPIGGY.address, to: tx.to, value: 0n, input: tx.data });
      if (d.functionName === "commitClaim") commits.set(lower(d.args[0]), [d.args[1], block]);
      if (d.functionName === "claim") claimed = true;
      return hash;
    },
    async waitForTransactionReceipt({ hash }) { const t = txs.get(hash); if (!t) throw new Error("unknown tx"); return { status: "success", blockNumber: t.blockNumber }; },
    async getTransaction({ hash }) { const t = txs.get(hash); if (!t) throw new Error("unknown tx"); return { from: t.from, to: t.to, value: t.value, input: t.input }; },
    async readContract({ functionName, args }) {
      if (functionName === "commits") return commits.get(lower(args[0])) ?? [`0x${"00".repeat(32)}`, 0n];
      if (functionName === "gifts") return [SENDER, ESCROW, 1n, 0n, claimed, `0x${"00".repeat(32)}`];
      throw new Error(functionName);
    },
    async getBlockNumber() { head += 1n; return head; },
  };
  // [A-895 P-B] The submitter now accepts ONLY a createGiftGasClientDelivery() object (A-887 R1). `gas` is the fake SERVER (same deliver(req)
  // body as before, still counting calls); `delivery` is the A-884-client-shaped wrapper that is handed to the submitter.
  // pre-A-895 baseline: `gasDelivery: gas` (the bare fake). The server echoes the fee-derived bound (bufferBps 0).
  const SERVER_WEI = (UNITS.commitClaim + UNITS.claim) * FEES.baseFeePerGasWei;
  const gas = {
    calls: 0,
    async deliver(req) {
      this.calls += 1;
      const hash = keccak256(stringToHex(`delivery:${req.to}:${req.valueWei}`));
      mine({ hash, from: SENDER, to: req.to, value: req.valueWei, input: "0x" });
      balances.set(lower(req.to), (balances.get(lower(req.to)) ?? 0n) + req.valueWei);
      return { txHash: hash };
    },
  };
  // [A-895 P-B F1] a REAL createGiftGasClient() over a fake fetch (the adapter accepts only branded clients).
  const delivery = createGiftGasClientDelivery(createGiftGasClient({
    transport: "https", endpoint: "https://relay.example/gift-gas",
    fetch: async (url, init) => {
      const { giftId, to } = JSON.parse(init.body);
      const r = await gas.deliver({ allowanceRef: giftId, to, valueWei: SERVER_WEI });
      const body = JSON.stringify({ ok: true, state: "SENT", giftId, to, valueWei: String(SERVER_WEI), txHash: r.txHash });
      return { status: 200, url, redirected: false, type: "basic", headers: { get: () => "application/json" }, text: async () => body };
    },
  }));
  return { chain, gas, delivery };
}
const GIFT_ID = `0x${"5a".repeat(32)}`;
async function makeGift() {
  const made = createClaimLink({ giftId: GIFT_ID, senderAddress: SENDER, chainId: GSCOPE, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z" });
  const value = buildGiftValueBinding({ chainScope: GSCOPE, presetLabel: 20 }).value;
  const sealed = await sealClaimLink(attachGiftValue(made.record, value).record, made.token);
  return { token: made.token, record: { ...sealed, status: CLAIM_STATUS.CLAIMED, recipientAddress: GPIGGY.address, claimedAt: "2026-10-02T00:00:00.000Z" } };
}
const bindFor = (token) => {
  const b = bindGiftToNewPiggy({ intent: { giftId: GIFT_ID, token }, piggy: { id: "p-1", address: GPIGGY.address, sequence: 1 }, preExistingAddresses: new Set(), signerAddress: GPIGGY.address, requireSequence: true });
  assert.equal(b.ok, true);
  return b.binding;
};
const ledgerFor = (store) => createGiftGasLedger({ store, deviceId: "dev-A", now: () => "2026-10-07T00:00:00.000Z" });
let SHARED_GIFT = null; // one Gift (one claim token) for every run, so base and sidecar runs are byte-comparable
async function giftRun({ stopAtCommit = false, evidence } = {}) {
  const { chain, gas, delivery } = giftChain({ stopAtCommit });
  const ledgerStore = createMemoryGiftGasStore();
  let ledger = ledgerFor(ledgerStore);
  let evCfg = evidence;
  if (typeof evidence === "function") ({ ledger, evidence: evCfg } = evidence(ledger)); // G3: the caller wraps the real ledger
  const sub = createGiftClaimSubmitter({
    chain, gasDelivery: delivery, chainScope: GSCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 },
    readFeeInputs: async () => FEES, sleep: async () => {}, maxPolls: 3, randomBytes: () => FIXED_SALT, giftGasLedger: ledger,
    ...(evidence === undefined ? {} : { evidence: evCfg }),
  });
  assert.ok(sub, "submitter built");
  const g = SHARED_GIFT || (SHARED_GIFT = await makeGift());
  const out = await sub.submit({ binding: bindFor(g.token), record: g.record, token: g.token, account: GPIGGY });
  return { out, gas, ledgerSnap: ledgerStore.snapshot(), sub, token: g.token };
}

await check("G1 value transferred: delivery / commit / claim rows keyed per tx (never giftId); result, ledger and deliveries identical", async () => {
  const base = await giftRun();
  assert.equal(base.out.status, GS.VALUE_TRANSFERRED);
  const ev = evStore(143);
  const sink = reportSink();
  const got = await giftRun({ evidence: { store: ev.store, onReport: sink.onReport, now: "2026-10-07T00:00:00.000Z" } });
  assert.equal(norm(got.out), norm(base.out));
  assert.deepEqual(got.ledgerSnap, base.ledgerSnap, "giftId gas ledger byte-identical");
  assert.equal(got.gas.calls, 1);
  const rows = ev.store.readAll().active;
  assert.deepEqual(rows.map((r) => [r.txHash, r.journey, r.source]), [
    [lower(got.out.txHashes.delivery), "gift.delivery", "gift.submit_result"],
    [lower(got.out.txHashes.commit), "gift.commit", "gift.submit_result"],
    [lower(got.out.txHashes.claim), "gift.claim", "gift.submit_result"],
  ]);
  assert.ok(rows.every((r) => !r.evidenceKey.includes(GIFT_ID.slice(2))), "evidence key is per tx, never the giftId");
  const rep = sink.reports[0];
  assert.equal(rep.ledgerBoundary, "gift_gas_ledger_separate");
  assert.deepEqual(rep.evidenceErrors, []);
  const text = JSON.stringify(rep, big);
  assert.equal(text.includes(got.token), false, "no claim token in the report");
  assert.equal(text.includes(Buffer.from(FIXED_SALT).toString("hex")), false, "no salt in the report");
  assert.equal(/PENDING|CONFIRMED|reserve|markSent|deviceId/.test(text), false, "no ledger state in evidence");
  assertNoAuthority(rep);
});

await check("G2 delivery only (commit failed): one gift.delivery row; COMMIT_FAILED result unchanged", async () => {
  const base = await giftRun({ stopAtCommit: true });
  const ev = evStore(143);
  const got = await giftRun({ stopAtCommit: true, evidence: { store: ev.store } });
  assert.equal(got.out.status, GS.COMMIT_FAILED);
  assert.deepEqual(got.out, base.out);
  assert.deepEqual(got.ledgerSnap, base.ledgerSnap);
  assert.deepEqual(ev.store.readAll().active.map((r) => r.journey), ["gift.delivery"]);
});

await check("G3 the ledger is never an evidence store: a store === ledger is refused, the ledger is not appended to, results identical", async () => {
  const base = await giftRun();
  const sink = reportSink();
  let appendOnLedger = 0;
  const got = await giftRun({ evidence: (real) => {
    const ledger = Object.create(real); // the ledger's own methods, plus an append so it LOOKS like an evidence store
    ledger.append = () => { appendOnLedger += 1; return { ok: true }; };
    return { ledger, evidence: { store: ledger, onReport: sink.onReport } };
  } });
  assert.equal(norm(got.out), norm(base.out));
  assert.deepEqual(got.ledgerSnap, base.ledgerSnap);
  assert.equal(appendOnLedger, 0);
  assert.ok(sink.reports.at(-1).evidenceErrors.some((e) => e.reason === "evidence_store_is_gift_gas_ledger"));
});

await check("G3b [A-883 I1 / A-895 P-B] a store that WRAPS the ledger (own object, ledger mutators exposed) is refused too; the ledger is never written through it", async () => {
  const base = await giftRun();
  const sink = reportSink();
  let appended = 0;
  let mutated = 0;
  const got = await giftRun({ evidence: (real) => {
    const wrapper = { append: () => { appended += 1; return { ok: true }; }, reserve: (...a) => { mutated += 1; return real.reserve(...a); }, markSent: real.markSent, confirm: real.confirm, markUnknown: real.markUnknown, reconcile: real.reconcile };
    return { ledger: real, evidence: { store: wrapper, onReport: sink.onReport } };
  } });
  assert.equal(norm(got.out), norm(base.out));
  assert.deepEqual(got.ledgerSnap, base.ledgerSnap);
  assert.equal(appended, 0, "append never called on a ledger-shaped store");
  assert.equal(mutated, 0, "the sidecar never called a ledger mutator on the wrapper");
  assert.ok(sink.reports.at(-1).evidenceErrors.some((e) => e.reason === "evidence_store_is_gift_gas_ledger"));
  // a plain evidence store (append/readAll only) is still accepted
  const ev = evStore(143);
  const ok = await giftRun({ evidence: { store: ev.store, onReport: reportSink().onReport } });
  assert.equal(ev.store.readAll().active.length, 3);
  assert.equal(norm(ok.out), norm(base.out));
});

await check("G5 [A-883 R1 / A-895 P-B] ACCEPTED_RESIDUAL pin: an `evidence` getter that throws makes createGiftClaimSubmitter throw at entry (0 sends, 0 writes): the same class as any other throwing config key, only the caller can cause it, and the protected submitter body is not widened for it", async () => {
  const chainFx = giftChain();
  const { chain, delivery } = chainFx;
  const store = createMemoryGiftGasStore();
  const cfg = { chain, gasDelivery: delivery, chainScope: GSCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 }, readFeeInputs: async () => FEES, giftGasLedger: ledgerFor(store) };
  Object.defineProperty(cfg, "evidence", { enumerable: true, get() { throw new Error("hostile getter"); } });
  let threw = false;
  try { createGiftClaimSubmitter(cfg); } catch { threw = true; }
  assert.equal(threw, true, "documents the residual: entry throws instead of returning null");
  assert.equal(store.snapshot(), null, "0 ledger writes");
  assert.equal(chainFx.gas.calls, 0, "0 deliveries"); // [F6] the SAME fake that backs `delivery`, not a fresh object
  // a throwing getter on any OTHER config key behaves the same (pre-A-883 behaviour), so R1 introduced no new class
  const cfg2 = { chain, gasDelivery: delivery, chainScope: GSCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 }, readFeeInputs: async () => FEES, giftGasLedger: ledgerFor(store) };
  Object.defineProperty(cfg2, "maxPolls", { enumerable: true, get() { throw new Error("hostile getter"); } });
  let threw2 = false;
  try { createGiftClaimSubmitter(cfg2); } catch { threw2 = true; }
  assert.equal(threw2, true);
});

await check("F2 Gift failure isolation: throwing / refusing / async / wrong-chain stores, throwing onReport, hostile config => result identical", async () => {
  const base = await giftRun();
  const cases = [
    [{ store: { append() { throw new Error("boom"); } } }, "evidence_store_threw"],
    [{ store: { append: () => ({ ok: false, reason: "store_full" }) } }, "store_full"],
    [{ store: { append: () => Promise.reject(new Error("async")) } }, "evidence_store_async_unconfirmed"],
    [{ store: evStore(10143).store }, "chain_mismatch"],
    [{ store: evStore(143).store, chainId: 10143 }, "chain_mismatch"],
  ];
  for (const [cfg, reason] of cases) {
    const sink = reportSink();
    const got = await giftRun({ evidence: { ...cfg, onReport: sink.onReport } });
    assert.equal(norm(got.out), norm(base.out), reason);
    assert.deepEqual(got.ledgerSnap, base.ledgerSnap, reason);
    assert.ok(sink.reports[0].evidenceErrors.some((e) => e.reason === reason), `${reason}: ${JSON.stringify(sink.reports[0].evidenceErrors)}`);
  }
  for (const evidence of [{ store: evStore(143).store, onReport() { throw new Error("x"); } }, { onReport: () => Promise.reject(new Error("x")) }, new Proxy({}, { get() { throw new Error("x"); } })]) {
    const got = await giftRun({ evidence });
    assert.equal(norm(got.out), norm(base.out));
  }
  // a rejection from submit itself passes through untouched (null args => the same TypeError as without a sidecar)
  const { sub } = await giftRun({ evidence: { store: evStore(143).store } });
  const { sub: plain } = await giftRun();
  const e1 = await sub.submit(null).catch((e) => e);
  const e2 = await plain.submit(null).catch((e) => e);
  assert.equal(e1?.constructor, e2?.constructor);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(unhandled.length, 0, "no unhandled rejection from the evidence layer");
});

await check("G4 default none: without evidence the submitter is the original frozen object with the original async submit", async () => {
  const { sub } = await giftRun();
  assert.equal(sub.submit.constructor.name, "AsyncFunction");
  assert.ok(Object.isFrozen(sub));
  const { sub: s2 } = await giftRun({ evidence: {} });
  assert.equal(s2.submit.constructor.name, "AsyncFunction", "an evidence object with neither store nor onReport is none");
  const { sub: s3 } = await giftRun({ evidence: { store: evStore(143).store } });
  assert.equal(Object.isFrozen(s3), true);
});

// ═══ X · source boundaries ══════════════════════════════════════════════════════════════════════════════════
await check("X1 sources: tx evidence store writes only in the adapter / Gift sidecars; the lane holds no store; Gift sidecar never calls the ledger", () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const lane = strip(SRC("mainnet-job-lane.js"));
  assert.equal(/\.append\(|createEvidenceStore|receipt-evidence-store/.test(lane), false, "lane never writes evidence");
  assert.match(SRC("mainnet-job-lane.js"), /import \{ mapSecondStateObservation \} from "\.\/receipt-evidence-second\.js";/);
  assert.match(SRC("second-execution-adapter.js"), /import \{ mapSecondEvidence \} from "\.\/receipt-evidence-second\.js";/);
  assert.match(SRC("gift-claim-entry.js"), /import \{ mapGiftEvidence \} from "\.\/receipt-evidence-gift\.js";/);
  const gift = SRC("gift-claim-entry.js");
  const side = strip(gift.slice(gift.indexOf("// ── [A-883] Gift receipt evidence sidecar")));
  assert.ok(side.length > 1000);
  assert.equal(/\.(reserve|markSent|confirm|markUnknown|reconcile)\(|gasDelivery|signTransaction|sendRawTransaction/.test(side), false);
  for (const f of ["second-execution-adapter.js", "mainnet-job-lane.js", "gift-claim-entry.js"]) {
    const code = strip(SRC(f));
    assert.equal(/receipt-evidence-(reader|store)\.js|readTxEvidence|createEvidenceStore|localStorage/.test(code), false, `${f}: no reader / store / storage import`);
  }
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
