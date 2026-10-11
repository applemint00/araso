// [A-977] Job 10 on the shared fork: Explore errand line → Job → executor → calldata byte-equal to the A-951 / A-787 / A-808 fork harness
// encoding → Receipt fields (PASS_APP_FORK_E2E · fork_simulation · chain 31337143 · forkOf 143) → the Second receipt bridge accepts it.
// Plus: Aave fork lane (isAaveLaneProfile admits the fork, 143 unchanged), 143 / testnet run nothing, live gates still refuse,
// Kintsu / aBIL have no fork row, main.js carries exactly one [A-977] block (outside it == the pre copy when present).
// Node only, no network (fetch throws), no real tx (an injected local_fork executor records what would be sent).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeFunctionData, keccak256, maxUint256, parseAbi, parseAbiParameters, serializeTransaction, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveChainProfile } from "../src/chain-profile.js";
import { EVIDENCE_LABEL, FORK_JOB_ROWS, listForkJobFamilies, listVisibleJobFamilies } from "../src/second-job-readiness.js";
import * as L from "../src/mainnet-job-lane.js";
import { isAaveLaneProfile, LANE_AMOUNT_CAP_RAW } from "../src/mainnet-job-aave.js";
import * as AAVE from "../src/mainnet-job-aave.js";
const isAaveForkProfile = (p) => (typeof AAVE.isAaveForkProfile === "function" ? AAVE.isAaveForkProfile(p) : isAaveLaneProfile(p)); // pre-r2 code has no separate fork gate
import { TRANSPORT_KIND } from "../src/money-executor.js";
import { classifySecondReceipt } from "../src/second-journey-receipt-bridge.js";
import { SECOND_ACTION_TITLES_EN, exploreCandidateDestinations, secondActionTitle } from "../src/second-journey-view.js";
import { LP_ERRAND_COPY } from "../src/job-feed.js";
import { EULER_FORK_EVIDENCE, eulerExecutionGate } from "../src/mainnet-job-euler.js";
import { UPSHIFT_FORK_EVIDENCE } from "../src/mainnet-job-upshift.js";
import { CURVANCE_FORK_EVIDENCE, CURVANCE_FORK_SHARES_RAW } from "../src/mainnet-job-curvance.js";
import { NEVERLAND_FORK_EVIDENCE } from "../src/mainnet-job-neverland.js";
import { SHMON_FORK_EVIDENCE, SHMON_FORK_SHARES_RAW } from "../src/mainnet-job-shmon.js";
import { KURU_FORK_EVIDENCE } from "../src/mainnet-job-kuru.js";
import { LP_FORK_EVIDENCE } from "../src/mainnet-job-lp.js";
import { REVOKE_FORK_EVIDENCE } from "../src/mainnet-job-revoke.js";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-977 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(path.join(HERE, "..", "src", f), "utf8");

// pre-A-977 r4: const PIGGY = "0xb701520e24343cbd399a6d7bbd2a5634a7c542e6"; // harness USER fixture (lowercase)
// [A-977 RE-PIN r4] the run now recovers the signer from the signed bytes, so the test Piggy needs a real key: the public anvil/hardhat
// test key #0 (well-known, never funded anywhere real). Every calldata expectation below is computed from PIGGY, so harness equality holds.
const PIGGY_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PIGGY = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil test key #1
const FORK = resolveChainProfile("monad-fork", { rpcUrl: "https://fork.a977.test/rpc", forkInstanceId: "a977-node" });
const MAINNET = resolveChainProfile("monad-mainnet");
const TESTNET = resolveChainProfile(undefined);
const FORK_ID = 31337143;
const USDC = FORK.usdc.address;
const AAVE_POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";

// Harness ABI strings (copied verbatim from the A-951 / A-939 / A-757 tests: a787-laneA/B-run.mjs, a808-lp-fork.mjs, Aave lab) — the harness encoding.
const H_ERC20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const H_AAVE = parseAbi(["function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)", "function withdraw(address asset,uint256 amount,address to) returns (uint256)"]);
const H_4626 = parseAbi(["function deposit(uint256 assets,address receiver) returns (uint256)", "function redeem(uint256 shares,address receiver,address owner) returns (uint256)"]);
const H_UP = parseAbi(["function deposit(address,uint256,address)", "function instantRedeem(uint256,address)"]);
const H_SHMON = [{ name: "deposit", type: "function", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] }];
const H_OB = parseAbi([
  "function addBuyOrder(uint32 _price,uint96 size,bool _postOnly)",
  "function batchCancelOrders(uint40[] _orderIds)",
  "function placeAndExecuteMarketBuy(uint96 _quoteSize,uint256 _minAmountOut,bool _isMargin,bool _isFillOrKill) payable returns (uint256)",
  "function placeAndExecuteMarketSell(uint96 _size,uint256 _minAmountOut,bool _isMargin,bool _isFillOrKill) payable returns (uint256)",
]);
const H_MA = parseAbi(["function deposit(address _user,address _token,uint256 _amount) payable", "function withdraw(uint256 _amount,address _token)"]);
const H_ADD = parseAbi(["function add_liquidity(uint256[] amounts,uint256 min_mint_amount,address receiver) returns (uint256)"]);
const H_RM1 = parseAbi(["function remove_liquidity_one_coin(uint256 burn,int128 i,uint256 min_received,address receiver) returns (uint256)"]);
const enc = (abi, functionName, args) => encodeFunctionData({ abi, functionName, args });

// ── a local fork stand-in: reads by (address, function) in order (the last value repeats); sends recorded; every receipt = success ──
const ORDER_ID = 119614971n;
const orderLog = (owner) => ({
  address: KURU_FORK_EVIDENCE.market,
  topics: [toEventSelector("OrderCreated(uint40,address,uint96,uint32,bool)")],
  data: encodeAbiParameters(parseAbiParameters("uint40,address,uint96,uint32,bool"), [ORDER_ID, owner, 2000000000000n, 3172500, true]),
});
// [A-977 r2] the run takes ONLY the strict sign-before-send transport: a prepare that returns the chain id the wallet is on, a signer that
// records what it signs, a raw send that returns keccak(raw). `sent` = what was signed and broadcast, in order. sendLane = executor.send calls.
// [A-977 r3] the signer returns real eip1559 bytes (a fixed dummy signature) because the run now decodes the signed tx before it is sent;
// rawEdit(tx) → the tx actually serialized (a signer that signs something else); prepared(tx) → what prepare returns (getter tests).
// pre-A-977 r4: dummy signature (DUMMY_SIG) — [A-977 r4] real signatures: by PIGGY_KEY unless signKey names another key.
const eip1559 = (tx) => ({ type: "eip1559", chainId: tx.chainId, nonce: tx.nonce, gas: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, to: tx.to, data: tx.data, value: tx.value });
const serializeSigned = (tx, key = PIGGY_KEY) => privateKeyToAccount(key).signTransaction(eip1559(tx));
void serializeTransaction;
function fakeFork(reads, { walletChain = FORK_ID, rpcChain = FORK_ID, executorChain = FORK_ID, signer = PIGGY, rawEdit = null, prepared = null, signKey = PIGGY_KEY } = {}) {
  const seq = new Map(Object.entries(reads).map(([k, v]) => [k.toLowerCase(), [...v]]));
  const take = (k) => { const q = seq.get(k.toLowerCase()); if (!q || !q.length) throw new Error(`no read ${k}`); return q.length > 1 ? q.shift() : q[0]; };
  const sent = [];
  const signed = [];
  const byHash = new Map();
  let nonce = 0;
  const lane = { sends: 0 };
  const executor = {
    kind: "local_fork", chainId: executorChain, forkBlock: 4242,
    send: async () => { lane.sends += 1; return { hash: `0x${"ab".repeat(32)}` }; },
    receipt: async (hash) => {
      const tx = byHash.get(hash);
      return { status: "success", gasUsed: 50000, blockNumber: 4242 + sent.length, logs: tx && tx.data.startsWith("0xa09e9040") ? [orderLog(PIGGY)] : [], gasCostWei: "1000" };
    },
  };
  const account = {
    address: signer,
    signTransaction: async (tx) => { const t = rawEdit ? rawEdit({ ...tx }) : tx; signed.push(t); return serializeSigned(t, signKey); },
  };
  const walletClient = {
    prepareTransactionRequest: async ({ to, data, value }) => { const tx = { chainId: walletChain, type: "eip1559", nonce: nonce++, gas: 300000n, maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 1n, to, data, value: value ?? 0n }; return prepared ? prepared(tx) : tx; },
  };
  const publicClient = {
    getChainId: async () => rpcChain,
    sendRawTransaction: async ({ serializedTransaction }) => {
      const hash = keccak256(serializedTransaction);
      const tx = signed[signed.length - 1];
      sent.push(tx); byHash.set(hash, tx);
      return hash;
    },
  };
  const transport = { kind: TRANSPORT_KIND.VIEM_RAW, walletClient, publicClient, account };
  const read = {
    call: async ({ to, functionName }) => take(`${to}:${functionName}`),
    native: async () => take("native"),
  };
  return { executor, read, sent, signed, transport, lane };
}
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }
const PIGGY_ROW = { id: "piggy-a977", address: PIGGY };
async function run(jobKey, reads, extra = {}) {
  const f = fakeFork(reads);
  const storage = memStorage();
  const out = await L.runForkJob({ profile: FORK, piggy: PIGGY_ROW, jobKey, executor: f.executor, transport: f.transport, read: f.read, storage, eventId: `ev:${jobKey}`, nowIso: "2026-10-11T09:00:00.000Z", entryCheck: async () => true, ...extra });
  return { ...out, sent: f.sent, storage };
}
const bal = (token) => `${token}:balanceOf`;
const SCOPE = { accountId: PIGGY, chainId: FORK.scope };
async function receiptOk(out, { steps, asset, deltaRaw }) {
  assert.equal(out.status, "returned", `${out.status} ${out.reason}`);
  assert.deepEqual(out.calls.map((c) => c.step), steps);
  for (const tx of out.sent) assert.equal(tx.chainId, FORK_ID); // every signed tx names the fork's own chain id
  const r = out.receipt;
  assert.equal(r.outcome, "done");
  assert.equal(r.evidenceClass, EVIDENCE_LABEL.APP_FORK_E2E);
  assert.equal(r.executionMode, "fork_simulation");
  assert.equal(r.chainId, FORK_ID);
  assert.equal(r.forkOf, 143);
  assert.equal(r.forkBlock, 4242);
  assert.equal(r.asset, asset);
  if (deltaRaw !== undefined) assert.equal(r.deltaRaw, deltaRaw);
  assert.deepEqual(Object.keys(r.txs), steps);
  const cand = L.forkJobReceiptCandidate(r, SCOPE);
  assert.equal(cand.at, "2026-10-11T09:00:00.000Z");
  const v = classifySecondReceipt(cand, { scope: SCOPE });
  assert.equal(v.persistable, true, v.reason);
  assert.equal(v.receipt.destinationId, r.jobKey);
  assert.equal(v.receipt.txHash, r.lastTx);
}

// ── 1 · errand line → Job (canon copy, existing titles) ───────────────────────────────────────────────────────────────────────────
await check("1a fork rows: 5 errand lines, 10 Jobs wired (shMON held for the MY MONEY question), every row Job has an executor", () => {
  assert.deepEqual(FORK_JOB_ROWS.map((r) => r.errandId), ["market", "order", "clean", "grow", "lp"]);
  const all = FORK_JOB_ROWS.flatMap((r) => r.jobs);
  assert.equal(all.length, 10);
  assert.deepEqual([...all].sort(), [...L.FORK_JOB_KEYS].sort());
  assert.deepEqual(Object.keys(L.FORK_JOB_HELD), ["fastlane-shmon"]);
  assert.deepEqual(listForkJobFamilies().map((f) => f.baseline), ["kuru-swap", "kuru-limit", "usdc-allowance-revoke", "euler-k3-weth", "curve-ausd-usdc-usdt0-lp"]);
});
const LINE = { market: "go to the market", order: "leave an order", clean: "tidy the wallet", grow: "put some money to work", lp: "help with trades" };
const ERRAND_LABEL = { ...SECOND_ACTION_TITLES_EN, lp: LP_ERRAND_COPY.label };
await check("1b Explore line → candidate → Job: market=Kuru swap · order=Kuru limit · clean=revoke · grow=Euler first · LP=Curve LP; titles = existing copy", () => {
  for (const [errand, line] of Object.entries(LINE)) assert.equal(ERRAND_LABEL[errand], line, errand);
  const want = { market: "kuru-swap", order: "kuru-limit", clean: "usdc-allowance-revoke", grow: "euler-k3-weth", lp: "curve-ausd-usdc-usdt0-lp" };
  for (const [errand, job] of Object.entries(want)) {
    const d = exploreCandidateDestinations(L.forkExploreRows(), { selectedErrandIds: [errand], max: 3 });
    assert.equal(d.length, 1, errand);
    assert.equal(d[0].id, job);
    assert.deepEqual(d[0].errandIds, [errand]);
    const title = secondActionTitle(d[0]) || ERRAND_LABEL[d[0].errandIds[0]];
    // grow keeps its existing family title (A-723 "a quick trip"); the others show their errand line
    assert.equal(title, errand === "grow" ? "a quick trip" : LINE[errand]);
  }
});
await check("1c grow line: the next Grow Job not yet returned (Euler → Upshift → Aave → Neverland → Curvance), shMON skipped while held", () => {
  const order = [];
  const done = [];
  for (let i = 0; i < 5; i += 1) { const k = L.forkJobForErrand("grow", { doneJobKeys: done }); order.push(k); done.push(k); }
  assert.deepEqual(order, ["euler-k3-weth", "upshift-earnausd", "aave-usdc", "neverland-usdc", "curvance-usdc"]);
  assert.equal(L.forkJobForErrand("grow", { doneJobKeys: done }), "euler-k3-weth");
});
await check("1d Kintsu / aBIL: no fork row; picking the asset-piece line on the fork gives no candidate; testnet family table unchanged", () => {
  const ids = L.forkExploreRows().map((r) => r.candidateId);
  assert.equal(ids.some((id) => /kintsu|abil/.test(id)), false);
  assert.deepEqual(exploreCandidateDestinations(L.forkExploreRows(), { selectedErrandIds: ["asset-piece", "claim", "move", "stay"], max: 3 }), []);
  assert.deepEqual(listVisibleJobFamilies().map((f) => f.baseline), ["aave-usdc", "kintsu-smon", "protect-revoke-allowance", "abil-spot"]);
});

// ── 2 · profiles: only the fork runs; 143 / testnet / blocked = refused, nothing sent ──────────────────────────────────────────────
await check("2a forkJobProfile: fork → a frozen copy naming the Job (liveExecution false, forkOf 143); mainnet / testnet / blocked / forged → null", () => {
  const jp = L.forkJobProfile(FORK, "euler-k3-weth");
  assert.equal(jp.jobId, "euler-k3-weth");
  assert.equal(jp.liveExecution, false);
  assert.equal(jp.numericChainId, FORK_ID);
  assert.ok(Object.isFrozen(jp));
  assert.equal(L.forkJobProfile(MAINNET, "aave-usdc"), null);
  assert.equal(L.forkJobProfile(TESTNET, "aave-usdc"), null);
  assert.equal(L.forkJobProfile(resolveChainProfile("monad-fork"), "aave-usdc"), null);
  assert.equal(L.forkJobProfile({ ...FORK, forkOf: 10143 }, "aave-usdc"), null);
  assert.equal(L.forkJobProfile({ ...FORK, liveExecution: true }, "aave-usdc"), null);
});
await check("2b 143 / testnet: runForkJob refuses every Job before any read or send (143 tx 0)", async () => {
  for (const profile of [MAINNET, TESTNET]) {
    for (const k of L.FORK_JOB_KEYS) {
      const f = fakeFork({});
      const out = await L.runForkJob({ profile, piggy: PIGGY_ROW, jobKey: k, executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "e", nowIso: "t", entryCheck: async () => true });
      assert.equal(out.status, "refused");
      assert.equal(out.reason, "profile_not_fork");
      assert.equal(f.sent.length, 0);
    }
  }
});
await check("2c executor boundary: a non-fork executor kind / wrong chain / no block is refused before any send", async () => {
  for (const bad of [{ kind: "live" }, { chainId: 10143 }, { forkBlock: "1" }]) {
    const f = fakeFork({});
    const ex = { ...f.executor, ...bad };
    const out = await L.runForkJob({ profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: ex, transport: f.transport, read: f.read, storage: memStorage(), eventId: "e", nowIso: "t", entryCheck: async () => true });
    assert.equal(out.status, "refused");
    assert.equal(f.sent.length, 0);
  }
});

// ── 3 · Aave fork lane ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// [A-977 r2] Owner ③: fork acceptance ONLY on the fork-job path (isAaveForkProfile); the mainnet lane gate isAaveLaneProfile refuses the fork.
await check("3 Aave gates: isAaveLaneProfile = mainnet only (fork refused) · isAaveForkProfile = fork only · testnet / blocked / other Job refused · cap 5 USDC unchanged", () => {
  assert.equal(isAaveLaneProfile(MAINNET), true);
  assert.equal(isAaveLaneProfile({ ...MAINNET, jobId: null }), false);
  assert.equal(isAaveLaneProfile(FORK), false);
  assert.equal(isAaveLaneProfile(L.forkJobProfile(FORK, "aave-usdc")), false);
  assert.equal(isAaveForkProfile(FORK), true);
  assert.equal(isAaveForkProfile(L.forkJobProfile(FORK, "aave-usdc")), true);
  assert.equal(isAaveForkProfile(L.forkJobProfile(FORK, "euler-k3-weth")), false);
  assert.equal(isAaveForkProfile(MAINNET), false);
  assert.equal(isAaveLaneProfile(TESTNET), false);
  assert.equal(isAaveForkProfile(TESTNET), false);
  assert.equal(isAaveForkProfile(resolveChainProfile("monad-fork")), false);
  assert.equal(LANE_AMOUNT_CAP_RAW, "5000000");
  assert.equal(MAINNET.liveExecution, false);
  assert.deepEqual({ ...L.MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
});

// ── 4 · each of the 10 Jobs: calldata == harness, Receipt fields ───────────────────────────────────────────────────────────────────
await check("J1 aave-usdc (grow): approve · supply · withdraw(max) == harness; USDC delta measured", async () => {
  const out = await run("aave-usdc", { [bal(USDC)]: ["10000000", "9999999"] });
  await receiptOk(out, { steps: ["approve", "supply", "withdraw"], asset: "USDC", deltaRaw: "-1" });
  assert.deepEqual(out.sent.map((t) => t.to), [USDC, AAVE_POOL, AAVE_POOL]);
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [AAVE_POOL, 5000000n]));
  assert.equal(out.sent[1].data, enc(H_AAVE, "supply", [USDC, 5000000n, PIGGY, 0]));
  assert.equal(out.sent[2].data, enc(H_AAVE, "withdraw", [USDC, maxUint256, PIGGY]));
});
await check("J2 neverland-usdc (grow): approve · supply · withdraw(whole) == harness", async () => {
  const E = NEVERLAND_FORK_EVIDENCE;
  const out = await run("neverland-usdc", { [bal(USDC)]: ["10000000", "9999999"] });
  await receiptOk(out, { steps: ["approve", "supply", "withdraw"], asset: "USDC", deltaRaw: "-1" });
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.pool, 5000000n]));
  assert.equal(out.sent[1].data, enc(H_AAVE, "supply", [E.asset.address, 5000000n, PIGGY, 0]));
  assert.equal(out.sent[2].data, enc(H_AAVE, "withdraw", [E.asset.address, maxUint256, PIGGY]));
});
await check("J3 curvance-usdc (grow): approve · deposit · redeem(measured shares) == harness", async () => {
  const E = CURVANCE_FORK_EVIDENCE;
  const out = await run("curvance-usdc", { [bal(USDC)]: ["10000000", "9999998"], [bal(E.share.address)]: [CURVANCE_FORK_SHARES_RAW] });
  await receiptOk(out, { steps: ["approve", "deposit", "redeem"], asset: "USDC", deltaRaw: "-2" });
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.vault, 5000000n]));
  assert.equal(out.sent[1].data, enc(H_4626, "deposit", [5000000n, PIGGY]));
  assert.equal(out.sent[2].data, enc(H_4626, "redeem", [BigInt(CURVANCE_FORK_SHARES_RAW), PIGGY, PIGGY]));
});
await check("J4 euler-k3-weth (grow): approve · deposit · redeem(measured shares) == harness (A-787 lane A)", async () => {
  const E = EULER_FORK_EVIDENCE;
  const SH = E.measured.realizedSharesRaw;
  const out = await run("euler-k3-weth", { [bal(E.asset.address)]: ["1500000000000000000", "1499999999999999999"], [bal(E.vault)]: [SH] });
  await receiptOk(out, { steps: ["approve", "deposit", "redeem"], asset: "WETH", deltaRaw: "-1" });
  assert.equal(out.sent[0].to, E.asset.address);
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.vault, 10n ** 18n]));
  assert.equal(out.sent[1].data, enc(H_4626, "deposit", [10n ** 18n, PIGGY]));
  assert.equal(out.sent[2].data, enc(H_4626, "redeem", [BigInt(SH), PIGGY, PIGGY]));
});
await check("J5 upshift-earnausd (grow): approve · deposit · instantRedeem(measured shares) == harness (A-787 lane A)", async () => {
  const E = UPSHIFT_FORK_EVIDENCE;
  const SH = E.measured.realizedSharesRaw;
  const out = await run("upshift-earnausd", { [bal(E.asset.address)]: ["150000000", "149990000"], [bal(E.shareToken.address)]: [SH] });
  await receiptOk(out, { steps: ["approve", "deposit", "instantRedeem"], asset: "AUSD", deltaRaw: "-10000" });
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.vault, 100000000n]));
  assert.equal(out.sent[1].data, enc(H_UP, "deposit", [E.asset.address, 100000000n, PIGGY]));
  assert.equal(out.sent[2].data, enc(H_UP, "instantRedeem", [BigInt(SH), PIGGY]));
});
await check("J6 fastlane-shmon (grow, held from Explore): deposit(value 1 MON) · redeem(measured shares) == harness (lane D)", async () => {
  const E = SHMON_FORK_EVIDENCE;
  const out = await run("fastlane-shmon", { native: ["5000000000000000000", "4999999000000000000"], [bal(E.vault)]: [SHMON_FORK_SHARES_RAW] });
  await receiptOk(out, { steps: ["deposit", "redeem"], asset: "MON", deltaRaw: "-1000000000000" });
  assert.equal(out.sent[0].value, 10n ** 18n);
  assert.equal(out.sent[0].data, enc(H_SHMON, "deposit", [10n ** 18n, PIGGY]));
  assert.equal(out.sent[1].data, enc(H_4626, "redeem", [BigInt(SHMON_FORK_SHARES_RAW), PIGGY, PIGGY]));
});
await check("J7 kuru-swap (go to the market): approve 5 · buy(quote×0.995) · revoke · sell back(measured MON, quote×0.995) == harness (lane B)", async () => {
  const E = KURU_FORK_EVIDENCE;
  const q = BigInt(E.buy.quoteMonWei);
  const got = BigInt(E.buy.monReceivedWei);
  const qs = 4999000n;
  const out = await run("kuru-swap", {
    [bal(USDC)]: ["20000000", "19999000"],
    [`${E.market}:placeAndExecuteMarketBuy`]: [q],
    [`${E.market}:placeAndExecuteMarketSell`]: [qs],
    native: [(10n ** 19n).toString(), (10n ** 19n + got - 1000n).toString()],
  });
  await receiptOk(out, { steps: ["approveMarket", "buyMon", "revokeMarket", "sellBack"], asset: "USDC", deltaRaw: "-1000" });
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.market, 5000000n]));
  assert.equal(out.sent[1].data, enc(H_OB, "placeAndExecuteMarketBuy", [5n * BigInt(E.marketParams.pricePrecision), (q * 995n) / 1000n, false, true]));
  assert.equal(out.sent[2].data, enc(H_ERC20, "approve", [E.market, 0n]));
  const size = (got * BigInt(E.marketParams.sizePrecision)) / 10n ** 18n;
  assert.equal(out.sent[3].data, enc(H_OB, "placeAndExecuteMarketSell", [size, (qs * 995n) / 1000n, false, true]));
  assert.equal(out.sent[3].value, (size * 10n ** 18n) / BigInt(E.marketParams.sizePrecision));
});
await check("J8 kuru-limit (leave an order): approve 8 · deposit · addBuyOrder(bid×0.99, min size, post-only) · cancel own order · withdraw · revoke == harness", async () => {
  const E = KURU_FORK_EVIDENCE;
  const out = await run("kuru-limit", {
    [bal(USDC)]: ["20000000", "20000000"],
    [`${E.market}:bestBidAsk`]: [[BigInt(E.bestBidAskAtPin.bid), BigInt(E.bestBidAskAtPin.ask)]],
    [`${E.marginAccount}:getBalance`]: ["8000000"],
  });
  await receiptOk(out, { steps: ["approveMargin", "depositMargin", "placeLimit", "cancelLimit", "withdrawMargin", "revokeMargin"], asset: "USDC", deltaRaw: "0" });
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.marginAccount, 8000000n]));
  assert.equal(out.sent[1].data, enc(H_MA, "deposit", [PIGGY, USDC, 8000000n]));
  assert.equal(out.sent[2].data, enc(H_OB, "addBuyOrder", [3172500, 2000000000000n, true]));
  assert.equal(out.sent[3].data, enc(H_OB, "batchCancelOrders", [[ORDER_ID]]));
  assert.equal(out.sent[4].data, enc(H_MA, "withdraw", [8000000n, USDC]));
  assert.equal(out.sent[5].data, enc(H_ERC20, "approve", [E.marginAccount, 0n]));
});
await check("J9 usdc-allowance-revoke (tidy the wallet): approve(spender with a measured allowance, 0) == harness; allowance 5 → 0; none = refused, nothing sent", async () => {
  const usdc = REVOKE_FORK_EVIDENCE.token.address;
  const out = await run("usdc-allowance-revoke", { [`${usdc}:allowance`]: ["5000000", "5000000", "0"] });
  await receiptOk(out, { steps: ["revoke"], asset: "USDC", deltaRaw: "-5000000" });
  assert.equal(out.sent[0].to, usdc);
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [AAVE_POOL, 0n]));
  const none = await run("usdc-allowance-revoke", { [`${usdc}:allowance`]: ["0"] });
  assert.equal(none.status, "refused");
  assert.equal(none.reason, "allowance_already_zero");
  assert.equal(none.sent.length, 0);
});
await check("J10 curve LP (help with trades): approve · add_liquidity([0,10,0], preview×0.999) · exit half · exit rest · revoke == harness (A-808)", async () => {
  const E = LP_FORK_EVIDENCE;
  const P = BigInt(E.measured.realizedLpRaw);
  const prevLp = BigInt(E.measured.previewLpRaw);
  const prevU = BigInt(E.measured.partialExitUsdcRaw);
  const out = await run("curve-ausd-usdc-usdt0-lp", {
    [bal(USDC)]: ["20000000", "19999506"],
    [`${E.pool}:calc_token_amount`]: [prevLp],
    [`${E.pool}:calc_withdraw_one_coin`]: [prevU],
    [bal(E.lpToken.address)]: [P, P - P / 2n],
  });
  await receiptOk(out, { steps: ["approve", "addLiquidity", "exitHalf", "exitRest", "revoke"], asset: "USDC", deltaRaw: "-494" });
  assert.equal(out.sent[0].data, enc(H_ERC20, "approve", [E.pool, 10000000n]));
  assert.equal(out.sent[1].data, enc(H_ADD, "add_liquidity", [[0n, 10000000n, 0n], (prevLp * 999n) / 1000n, PIGGY]));
  assert.equal(out.sent[2].data, enc(H_RM1, "remove_liquidity_one_coin", [P / 2n, 1n, (prevU * 999n) / 1000n, PIGGY]));
  assert.equal(out.sent[3].data, enc(H_RM1, "remove_liquidity_one_coin", [P - P / 2n, 1n, (prevU * 999n) / 1000n, PIGGY]));
  assert.equal(out.sent[4].data, enc(H_ERC20, "approve", [E.pool, 0n]));
});

// ── 5 · run safety ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
await check("5a a missing read stops before that step (nothing invented); a run whose outcome is unknown blocks the next run", async () => {
  const E = EULER_FORK_EVIDENCE;
  const out = await run("euler-k3-weth", { [bal(E.asset.address)]: ["1500000000000000000"] }); // no share read
  assert.equal(out.status, "stopped");
  assert.equal(out.sent.length, 2);
  assert.equal(out.receipt.outcome, "failed");
  const f = fakeFork({ [bal(USDC)]: ["10000000"] });
  f.executor.receipt = async () => null;
  const storage = memStorage();
  const args = { profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage, nowIso: "t", entryCheck: async () => true };
  const u = await L.runForkJob({ ...args, eventId: "u1" });
  assert.equal(u.status, "unknown");
  const again = await L.runForkJob({ ...args, eventId: "u2" });
  assert.equal(again.status, "refused");
  assert.equal(again.reason, "errand_in_flight");
  assert.equal(f.sent.length, 1);
});
await check("5b live gates unchanged: the Job module gate still refuses under the fork Job profile (liveExecution false form, A-962 (c))", () => {
  const g = eulerExecutionGate({ profile: L.forkJobProfile(FORK, "euler-k3-weth"), piggy: PIGGY_ROW, executor: { kind: "local_fork", chainId: FORK_ID, forkBlock: 1, send() {}, receipt() {} }, step: "approve" });
  assert.equal(g.allowed, false);
  assert.match(SRC("mainnet-job-euler.js"), /if \(profile\.liveExecution !== false\) return refuse\("live_execution_disabled"\);/);
});

// ── 7 · [A-977 r2] Owner-mandated run safety (RED on the pre-r2 code, GREEN after) ─────────────────────────────────────────────────
const GOOD_READS = () => ({ [bal(USDC)]: ["10000000", "9999999"] });
async function runWith(fakeOpts, extra = {}) {
  const f = fakeFork(GOOD_READS(), fakeOpts);
  const out = await L.runForkJob({ profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "r2", nowIso: "t", entryCheck: async () => true, ...extra });
  return { out, f };
}
await check("7a wrong chain → 0 sends: executor chain 143 / 10143 · RPC answers 143 / 10143 · wallet prepares a 10143 / 143 tx", async () => {
  for (const o of [{ executorChain: 143 }, { executorChain: 10143 }, { rpcChain: 143 }, { rpcChain: 10143 }, { walletChain: 10143 }, { walletChain: 143 }]) {
    const { out, f } = await runWith(o);
    assert.notEqual(out.status, "returned", JSON.stringify(o));
    assert.equal(f.sent.length, 0, `sent ${JSON.stringify(o)}`);
    assert.equal(f.signed.length, 0, `signed ${JSON.stringify(o)}`);
    assert.equal(f.lane.sends, 0);
  }
});
await check("7b approval missing → 0 sends: entryCheck omitted / false / throws; requireSignBeforeSend:false is ignored; a refusal before step 2 stops after step 1", async () => {
  for (const extra of [{ entryCheck: undefined }, { entryCheck: async () => false }, { entryCheck: async () => { throw new Error("down"); } }, { entryCheck: async () => "yes" }]) {
    const { out, f } = await runWith({}, extra);
    assert.equal(out.status, "refused");
    assert.equal(f.sent.length, 0);
  }
  let asks = 0;
  const { out, f } = await runWith({}, { entryCheck: async () => { asks += 1; return asks <= 2; } }); // yes at start + step 1, no at step 2
  assert.equal(f.sent.length, 1);
  assert.equal(out.status, "stopped");
  assert.equal(out.reason, "fork_entry_refused");
  const off = await runWith({}, { requireSignBeforeSend: false });
  assert.equal(off.out.status, "returned");
  assert.equal(off.f.signed.length, 3, "signed before every send even when the caller asked otherwise");
});
await check("7c a different executor / transport is refused: LANE_EXECUTOR (executor.send never called) · viem_send · custom kind · signer ≠ Piggy", async () => {
  const f = fakeFork(GOOD_READS());
  for (const transport of [{ kind: TRANSPORT_KIND.LANE_EXECUTOR, executor: f.executor }, { ...f.transport, kind: TRANSPORT_KIND.VIEM_SEND }, { kind: "custom", send: async () => ({}) }, null]) {
    const out = await L.runForkJob({ profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport, read: f.read, storage: memStorage(), eventId: "c", nowIso: "t", entryCheck: async () => true, requireSignBeforeSend: false });
    assert.equal(out.status, "refused");
  }
  assert.equal(f.lane.sends, 0);
  assert.equal(f.sent.length, 0);
  const other = await runWith({ signer: "0x024b1756906435a5eae53bb84dc8a8fb37c4d450" });
  assert.equal(other.out.status, "refused");
  assert.equal(other.f.sent.length, 0);
});
await check("7d Aave mainnet lane regression: its functions refuse the fork profile; with the mainnet profile they behave as before; isAaveLaneProfile source == pre-card", async () => {
  const forkP = L.forkJobProfile(FORK, "aave-usdc");
  for (const prof of [FORK, forkP]) {
    assert.equal(L.laneIntentKey(prof, "p1"), null);
    assert.equal((await L.readLanePreAction({ profile: prof, piggyAddress: PIGGY })).status, "profile_not_mainnet_lane");
    assert.equal(L.buildLanePermissionPreview({ profile: prof, piggy: PIGGY_ROW, amountRaw: "5000000", decision: { result: "do_it" } }).error, "profile_not_mainnet_lane");
    assert.equal(L.startLaneIntent({ profile: prof, piggy: PIGGY_ROW }).error, "profile_not_mainnet_lane");
    assert.equal((await L.advanceLaneIntent({ profile: prof, piggy: PIGGY_ROW, intent: {}, executor: { kind: "local_fork", chainId: FORK_ID, forkBlock: 1, send() {}, receipt() {} } })).reason, "profile_not_mainnet_lane");
    assert.equal(L.buildLaneReceipt({ profile: prof, piggy: PIGGY_ROW, intent: {} }).reason, "profile_not_mainnet_lane");
  }
  assert.equal(L.laneIntentKey(MAINNET, "p1"), "araso.mainnetLane.v1.monad-mainnet.p1");
  assert.equal(L.buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY_ROW, amountRaw: "5000000", decision: null }).error, "no_match_decision");
  assert.equal((await L.readLanePreAction({ profile: MAINNET, piggyAddress: PIGGY })).status !== "profile_not_mainnet_lane", true);
  const pre = path.join(HERE, "..", "..", "pre", "mainnet-job-aave.js");
  if (existsSync(pre)) {
    const fn = (src) => src.slice(src.indexOf("/** The running profile is the mainnet profile"), src.indexOf("\n}\n", src.indexOf("export function isAaveLaneProfile")) + 3);
    assert.equal(fn(SRC("mainnet-job-aave.js")), fn(readFileSync(pre, "utf8")));
  } else console.log("      (pre copy absent: source equality not checked here)");
});

await check("7e main.js fork client: one eth_chainId == the fork chain id before anything else is read or sent (mismatch = throw, nothing shown) · method allowlist · entryCheck = the entry server", () => {
  const m = SRC("main.js");
  const b = m.slice(m.indexOf("// ── [A-977] Job 10 on the shared fork"), m.indexOf("// ── [A-977] end Job 10"));
  const req = b.slice(b.indexOf("async request({ method, params })"), b.indexOf("return post(method, params);"));
  assert.ok(req.length > 100, "fork client request() found");
  assert.match(req, /if \(!A977_RPC_METHODS\.includes\(method\)\) throw new Error\("fork_method_not_allowed"\);/);
  assert.match(req, /if \(!chainChecked\) \{\s*const id = await post\("eth_chainId", \[\]\);\s*if \([\s\S]*?BigInt\(id\) !== BigInt\(a974ForkChainId\)\) throw new Error\("fork_chain_mismatch"\);/);
  assert.match(b, /entryCheck: a956ForkMoneyAllowed/);
  assert.equal(/requireSignBeforeSend/.test(b), false, "the block cannot weaken the run");
});

// ── 7 r3 · [A-977 r3] independent opus re-check holes (RED on wt/a977d/pre/r3 sources, GREEN after) ──────────────────────────────────
const sentChains = (f) => f.sent.map((t) => t.chainId);
await check("7f getter flip: a prepared tx whose chainId reads 31337143 once then 10143 (and a getter on to) → refused, 0 signed, 0 sent", async () => {
  const flips = [
    (tx) => { let n = 0; const o = { ...tx }; delete o.chainId; Object.defineProperty(o, "chainId", { enumerable: true, get: () => (n++ === 0 ? FORK_ID : 10143) }); return o; },
    (tx) => { let n = 0; const o = { ...tx }; delete o.to; Object.defineProperty(o, "to", { enumerable: true, get: () => (n++ === 0 ? tx.to : "0x000000000000000000000000000000000000dEaD") }); return o; },
    (tx) => Object.setPrototypeOf({ ...tx, chainId: undefined }, { chainId: FORK_ID }),
  ];
  for (const [i, prepared] of flips.entries()) {
    const { out, f } = await runWith({ prepared });
    assert.equal(out.status, "refused", `flip ${i}: ${out.status} ${out.reason} chains ${sentChains(f)}`);
    assert.equal(f.signed.length, 0, `flip ${i} signed`);
    assert.equal(f.sent.length, 0, `flip ${i} sent`);
  }
});
await check("7g Object.prototype pollution: an inherited entryCheck / transport / executor never stands in for the caller's own (entryCheck omitted → refused, 0 sent)", async () => {
  const f0 = fakeFork(GOOD_READS());
  for (const [k, v] of [["entryCheck", async () => true], ["transport", f0.transport], ["executor", f0.executor]]) {
    const f = fakeFork(GOOD_READS());
    const own = { profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "pp", nowIso: "t", entryCheck: async () => true };
    delete own[k];
    Object.defineProperty(Object.prototype, k, { value: v, configurable: true, writable: true, enumerable: false });
    let out;
    try { out = await L.runForkJob(own); } finally { delete Object.prototype[k]; }
    assert.equal(out.status, "refused", `${k}: ${out.status} ${out.reason}`);
    assert.equal(f.sent.length + f0.sent.length, 0, `${k} sent`);
    assert.equal(f.lane.sends + f0.lane.sends, 0);
  }
  assert.equal(Object.prototype.entryCheck, undefined);
});
await check("7h prototype-supplied options: entryCheck / transport / executor / profile / piggy on the options' prototype, a getter option, a transport whose account / clients are inherited → refused, 0 sent", async () => {
  const keys = ["entryCheck", "transport", "executor", "profile", "piggy"];
  for (const k of keys) {
    const f = fakeFork(GOOD_READS());
    const all = { profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "ph", nowIso: "t", entryCheck: async () => true };
    const opts = Object.create({ [k]: all[k] });
    for (const [kk, vv] of Object.entries(all)) if (kk !== k) opts[kk] = vv;
    const out = await L.runForkJob(opts);
    assert.equal(out.status, "refused", `${k}: ${out.status} ${out.reason}`);
    assert.equal(f.sent.length, 0, `${k} sent`);
  }
  { // a getter for entryCheck on the options object itself
    const f = fakeFork(GOOD_READS());
    const opts = { profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "pg", nowIso: "t" };
    Object.defineProperty(opts, "entryCheck", { enumerable: true, get: () => async () => true });
    const out = await L.runForkJob(opts);
    assert.equal(out.status, "refused", `getter entryCheck: ${out.status}`);
    assert.equal(f.sent.length, 0);
  }
  for (const nest of ["account", "walletClient", "publicClient", "whole"]) {
    const f = fakeFork(GOOD_READS());
    const t = nest === "whole" ? Object.create(f.transport) : { ...f.transport, [nest]: Object.create(f.transport[nest]) };
    const out = await L.runForkJob({ profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: t, read: f.read, storage: memStorage(), eventId: "pn", nowIso: "t", entryCheck: async () => true });
    assert.equal(out.status, "refused", `inherited ${nest}: ${out.status} ${out.reason}`);
    assert.equal(f.sent.length, 0, `inherited ${nest} sent`);
  }
  { // a profile whose numericChainId is a getter (31337143 while checked, 10143 afterwards) with executor / RPC / wallet all on 10143
    const f = fakeFork(GOOD_READS(), { executorChain: 10143, rpcChain: 10143, walletChain: 10143 });
    let n = 0;
    const prof = { ...FORK }; delete prof.numericChainId;
    Object.defineProperty(prof, "numericChainId", { enumerable: true, get: () => (n++ < 3 ? FORK_ID : 10143) });
    const out = await L.runForkJob({ profile: prof, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "pf", nowIso: "t", entryCheck: async () => true });
    assert.equal(out.status, "refused", `profile getter: ${out.status} ${out.reason}`);
    assert.equal(f.sent.length, 0);
  }
});
await check("7i signer returns bytes signed for 10143 / 143 (prepared + checked tx was 31337143) → refused before broadcast, 0 sent", async () => {
  for (const chainId of [10143, 143, 1]) {
    const { out, f } = await runWith({ rawEdit: (tx) => ({ ...tx, chainId }) });
    assert.equal(out.status, "refused", `${chainId}: ${out.status} ${out.reason}`);
    assert.equal(out.reason, "signed_tx_not_fork_chain");
    assert.equal(f.sent.length, 0, `${chainId} sent`);
  }
});
await check("7j signer returns bytes with an altered to / data / value / nonce (chain still 31337143) or non-tx bytes → refused before broadcast, 0 sent", async () => {
  const edits = [
    (tx) => ({ ...tx, to: "0x000000000000000000000000000000000000dEaD" }),
    (tx) => ({ ...tx, data: `${tx.data}00` }),
    (tx) => ({ ...tx, value: 1n }),
    (tx) => ({ ...tx, nonce: tx.nonce + 7 }),
  ];
  for (const [i, rawEdit] of edits.entries()) {
    const { out, f } = await runWith({ rawEdit });
    assert.equal(out.status, "refused", `edit ${i}: ${out.status} ${out.reason}`);
    assert.equal(out.reason, "signed_tx_changed", `edit ${i}`);
    assert.equal(f.sent.length, 0, `edit ${i} sent`);
  }
  const f = fakeFork(GOOD_READS());
  const t = { ...f.transport, account: { ...f.transport.account, signTransaction: async () => `0x${Buffer.from("not a tx").toString("hex")}` } };
  const out = await L.runForkJob({ profile: FORK, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: t, read: f.read, storage: memStorage(), eventId: "pj", nowIso: "t", entryCheck: async () => true });
  assert.equal(out.status, "refused");
  assert.equal(f.sent.length, 0);
  const ok = await runWith({});
  assert.equal(ok.out.status, "returned");
  assert.deepEqual(sentChains(ok.f), [FORK_ID, FORK_ID, FORK_ID]);
});

// ── 7 r4 · [A-977 r4] signer key + nested profile fields (RED on wt/a977d/pre/r4 sources, GREEN after) ──────────────────────────────
await check("7k account.address = Piggy but signTransaction signs with another key (bytes otherwise exact, chain 31337143) → refused, 0 sent, nothing saved", async () => {
  const storage = memStorage();
  const { out, f } = await runWith({ signKey: OTHER_KEY }, { storage });
  assert.equal(out.status, "refused", `${out.status} ${out.reason} sent ${f.sent.length}`);
  assert.equal(out.reason, "signed_tx_not_piggy");
  assert.equal(f.sent.length, 0);
  assert.equal(f.lane.sends, 0);
  const rec = [...storage._m.values()].map((v) => JSON.parse(v));
  assert.equal(rec.some((r) => Object.values(r.steps || {}).some((x) => x && x.hash)), false, "no hash saved");
  const ok = await runWith({});
  assert.equal(ok.out.status, "returned");
});
await check("7l nested profile getter flip: usdc.address / assets.USDC.address read once as the real USDC then another token → refused, 0 sent; a plain nested copy still runs", async () => {
  const flipAt = (pathKeys) => {
    const prof = JSON.parse(JSON.stringify(FORK, (k, v) => (v === undefined ? null : v)));
    for (const k of Reflect.ownKeys(FORK)) if (FORK[k] === undefined) prof[k] = undefined;
    let o = prof; for (const k of pathKeys.slice(0, -1)) o = o[k];
    const last = pathKeys[pathKeys.length - 1]; const real = o[last]; let n = 0;
    delete o[last];
    Object.defineProperty(o, last, { enumerable: true, get: () => (n++ < 1 ? real : "0x000000000000000000000000000000000000dEaD") });
    return prof;
  };
  for (const pk of [["usdc", "address"], ["assets", "USDC", "address"]]) {
    const f = fakeFork(GOOD_READS());
    const out = await L.runForkJob({ profile: flipAt(pk), piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "pl", nowIso: "t", entryCheck: async () => true });
    assert.equal(out.status, "refused", `${pk.join(".")}: ${out.status} ${out.reason} to ${f.sent.map((t) => t.to)}`);
    assert.equal(f.sent.length, 0, `${pk.join(".")} sent`);
  }
  const f = fakeFork(GOOD_READS());
  const plain = JSON.parse(JSON.stringify(FORK, (k, v) => (v === undefined ? null : v)));
  for (const k of Reflect.ownKeys(FORK)) if (FORK[k] === undefined) plain[k] = undefined;
  const out = await L.runForkJob({ profile: plain, piggy: PIGGY_ROW, jobKey: "aave-usdc", executor: f.executor, transport: f.transport, read: f.read, storage: memStorage(), eventId: "pl2", nowIso: "t", entryCheck: async () => true });
  assert.equal(out.status, "returned", `${out.status} ${out.reason}`);
});

// ── 6 · source ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
await check("6a main.js: exactly one [A-977] block; card id only inside it; outside it == the worktree pre copy (when present)", () => {
  const main = SRC("main.js");
  const start = main.indexOf("// ── [A-977] Job 10 on the shared fork");
  const endMarker = "// ── [A-977] end Job 10 on the shared fork ──\n";
  const end = main.indexOf(endMarker);
  assert.ok(start > 0 && end > start);
  assert.equal(main.indexOf("// ── [A-977] Job 10", start + 1), -1);
  const outside = main.slice(0, start) + main.slice(end + endMarker.length);
  assert.equal(/A-977/.test(outside), false);
  const pre = path.join(HERE, "..", "..", "pre", "main.js");
  if (existsSync(pre)) assert.equal(outside, readFileSync(pre, "utf8"));
  else console.log("      (pre copy absent: outside-block equality not checked here)");
});
await check("6b no card id in the other edited product files; the fork section sends only through executeMoneyStep", () => {
  assert.equal(/\bA-\d{3}\b/.test(SRC("mainnet-job-lane.js").split("// ── [fork-job]")[1] || ""), false, "lane");
  const rd = SRC("second-job-readiness.js");
  const rs = rd.slice(rd.indexOf("// ── [fork-job]"), rd.indexOf("export function listForkProvenDestinations"));
  assert.ok(rs.length > 500);
  assert.equal(/\bA-\d{3}\b/.test(rs), false, "readiness");
  assert.equal(/\bA-977\b/.test(SRC("mainnet-job-aave.js")), false);
  const lane = SRC("mainnet-job-lane.js"); const fork = lane.slice(lane.indexOf("// ── [fork-job] Job 10 on the shared fork"), lane.indexOf("// ── [E1] current-reader output"));
  assert.ok(fork && fork.length > 5000);
  // pre-A-977 r3: assert.equal(/sendTransaction|sendRawTransaction|signTransaction|executor\.send\(|fetch\(|localStorage/.test(fork), false);
  // [A-977 RE-PIN r3] the run now wraps the caller's strict transport (prepare snapshot · decode the signed bytes · broadcast only those
  // bytes), so signTransaction / sendRawTransaction appear ONLY inside runForkJob's `strict` wrapper, each forwarding to the caller's
  // function after its check. Everything else in the section still never names them; no sendTransaction / executor.send( / fetch / localStorage.
  assert.equal(/sendTransaction\(|executor\.send\(|fetch\(|localStorage/.test(fork), false);
  const ws = fork.indexOf("const strict = Object.freeze({"); const we = fork.indexOf("\n  });\n", ws);
  assert.ok(ws > 0 && we > ws, "strict wrapper found");
  const outsideWrap = fork.slice(0, ws) + fork.slice(we);
  assert.equal(/sendRawTransaction|signTransaction/.test(outsideWrap.replace(/ownData\((?:acct|pc), "(?:signTransaction|sendRawTransaction)"\)/g, "")), false, "named outside the wrapper");
  assert.match(fork.slice(ws, we), /signedRawProblem\(raw, want\)/);
  assert.match(fork.slice(ws, we), /if \(!approvedRaw \|\| raw !== approvedRaw\) fail\("raw_not_approved"\);/);
  assert.match(fork, /executeMoneyStep\(\{/);
});
await check("6c network 0", () => assert.equal(fetchCalls, 0));

console.log(`\na977-job10-fork: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
