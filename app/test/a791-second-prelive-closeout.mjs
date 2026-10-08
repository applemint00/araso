// [A-791] Second pre-live safety + main wiring closeout. Local only: no network, no browser, no real tx.
//   node app/test/a791-second-prelive-closeout.mjs
//
//   V  money-executor VIEM_SEND compat path: the A-774 signing copy + A-768 preparedSignProblem run BEFORE sendTransaction
//      (viem signs inside sendTransaction), and the checked copy is exactly what is sent (no re-fill)
//   K  Kintsu refuses explicitly unless profile.liveExecution === true
//   H  Safari-safe own-property helper: native Object.hasOwn path and the hasOwnProperty fallback path behave the same
//   E  A-758 review hardening: an envelope without a finite numeric lifetime (or outside it) is refused at the Aave boundary
//   R  A-758 review: the Aave reconcile hands the lane a receipt-only reader (no send method)
//   M  main.js consumes the A-762 route (evidence only, dropped if it ever claims anything) and the A-763 destination producer
//      at the authorize boundary (refuse-only: never turns a refusal into ok)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { createWalletClient, custom, keccak256, parseEther, parseGwei, parseTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { executeMoneyStep, preparedSignProblem, signingCopy, TRANSPORT_KIND } from "../src/money-executor.js";
import { KINTSU_JOB_ID, KINTSU_STEPS, kintsuExecutionGate, kintsuReadiness } from "../src/mainnet-job-kintsu.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import * as SAFETY from "../src/execution-safety.js";
import { revalidateAaveEnvelope, runSecondPlumbingProof, readSecondSendPending, SECOND_MAINNET_DESCRIPTORS, routeSecondMainnetExecution } from "../src/second-execution-adapter.js";
import { issuePermission } from "../src/permission-envelope.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { readSecondCurrent, routeSecondCurrentRead } from "../src/second-current-reader.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(HERE, "../src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const MAIN = SRC("main.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${String(e && e.stack ? e.stack : e).split("\n").slice(0, 6).join("\n      ")}`);
    fail += 1;
  }
}

function fnBody(name, src = MAIN) {
  const m = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(src);
  assert.ok(m, `${name} not found`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`${name}: end not found`);
}
function constDecl(name) {
  const start = MAIN.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `const ${name} missing`);
  return MAIN.slice(start, MAIN.indexOf(";\n", start) + 1);
}

// ═══ V · VIEM_SEND pre-sign parity ════════════════════════════════════════════════════════════════════════════
const MONAD_TESTNET = { id: 10143, name: "Monad Testnet", nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" }, rpcUrls: { default: { http: ["http://stub"] } } };
const TO = "0x3a98250F98Dd388C211206983453837C8365BDc1";
const TX = { to: TO, value: parseEther("0.001"), data: "0x1234" };
const OKP = Object.freeze({ type: "eip1559", chainId: 10143, nonce: 3, gas: 120000n, maxFeePerGas: parseGwei("122"), maxPriorityFeePerGas: parseGwei("2") });

// A stub RPC (same shape as a768's): `fill` = the node answers eth_fillTransaction with these fields; `noFill` = honest node without it.
function stubRpc({ fill = null, noFill = false } = {}) {
  const log = [];
  const raws = [];
  const transport = custom({
    async request({ method, params }) {
      log.push(method);
      if (method === "eth_fillTransaction") {
        if (noFill) throw Object.assign(new Error("the method eth_fillTransaction does not exist/is not available"), { code: -32601 });
        const t = params[0];
        return { raw: "0x", tx: { ...t, chainId: "0x1", gas: "0x1c9c380", maxFeePerGas: toHex(parseGwei("120000")), maxPriorityFeePerGas: toHex(parseGwei("50000")), nonce: "0x5", type: "0x2", from: t.from, to: t.to, value: t.value || "0x0", input: t.data || t.input || "0x", ...(fill || {}) } };
      }
      if (method === "eth_chainId") return "0x279f";
      if (method === "eth_getTransactionCount") return "0x5";
      if (method === "eth_estimateGas") return "0x30000";
      if (method === "eth_gasPrice") return toHex(parseGwei("102"));
      if (method === "eth_maxPriorityFeePerGas") return toHex(parseGwei("2"));
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: toHex(parseGwei("100")), number: "0x10", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), timestamp: "0x1", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x0", miner: "0x" + "00".repeat(20), difficulty: "0x0", nonce: "0x0000000000000000", sha3Uncles: "0x" + "33".repeat(32), logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x" + "44".repeat(32), stateRoot: "0x" + "55".repeat(32), receiptsRoot: "0x" + "66".repeat(32), extraData: "0x", size: "0x1", uncles: [], totalDifficulty: "0x0", mixHash: "0x" + "77".repeat(32) };
      if (method === "eth_sendRawTransaction") { raws.push(params[0]); return keccak256(params[0]); }
      throw Object.assign(new Error(`method ${method} not found`), { code: -32601 });
    },
  });
  return { transport, log, raws };
}
function spyAccount() {
  const account = privateKeyToAccount(`0x${"07".repeat(32)}`);
  const spy = { signed: 0 };
  const sign = account.signTransaction.bind(account);
  account.signTransaction = async (...a) => { spy.signed += 1; return sign(...a); };
  return { account, spy };
}
// Real viem wallet client; sendTransaction is wrapped only to count calls and capture the request it received.
function realViemSend(rpcOpts) {
  const rpc = stubRpc(rpcOpts);
  const { account, spy } = spyAccount();
  const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: rpc.transport });
  const seen = { sendCalls: 0, sendArg: null, logAtSend: null };
  const realSend = wc.sendTransaction.bind(wc);
  const walletClient = {
    prepareTransactionRequest: (...a) => wc.prepareTransactionRequest(...a),
    async sendTransaction(arg) { seen.sendCalls += 1; seen.sendArg = arg; seen.logAtSend = rpc.log.length; return realSend(arg); },
  };
  return { rpc, spy, seen, account, transport: { kind: TRANSPORT_KIND.VIEM_SEND, walletClient, account } };
}
function hooks() {
  const log = [];
  return {
    log,
    authorize: () => { log.push("authorize"); return true; },
    reserve: () => { log.push("reserve"); return true; },
    persistHash: () => { log.push("persist_hash"); return true; },
  };
}
// Fake prepare (no viem) for the field-level cases: returns exactly `prepared`, counts sends.
function fakeViemSend(prepared, { prepareThrows = false } = {}) {
  const seen = { sendCalls: 0, sendArg: null, prepared: null };
  const account = { address: "0x" + "b".repeat(40) };
  const walletClient = {
    async prepareTransactionRequest(t) { if (prepareThrows) throw new Error("rpc down"); seen.prepared = { ...t, ...prepared }; return seen.prepared; },
    async sendTransaction(arg) { seen.sendCalls += 1; seen.sendArg = arg; return `0x${"ab".repeat(32)}`; },
  };
  return { seen, account, transport: { kind: TRANSPORT_KIND.VIEM_SEND, walletClient, account } };
}

await check("V1 hostile RPC (eth_fillTransaction -> chainId 1 / 120000 gwei / 30M gas) on VIEM_SEND: blocked at 'sign' BEFORE sendTransaction; nothing signed, broadcast or persisted", async () => {
  const r = realViemSend();
  const h = hooks();
  const out = await executeMoneyStep({ tx: TX, transport: r.transport, authorize: h.authorize, reserve: h.reserve, persistHash: h.persistHash });
  assert.deepEqual([out.ok, out.status, out.phase, out.reason], [false, "blocked", "sign", "chain_id_mismatch"]);
  assert.equal(out.broadcastAttempted, false);
  assert.deepEqual(out.order, ["authorize", "reserve", "sign"]);
  assert.deepEqual(h.log, ["authorize", "reserve"]);
  assert.equal(r.seen.sendCalls, 0, "sendTransaction (which would sign) never called");
  assert.equal(r.spy.signed, 0);
  assert.equal(r.rpc.raws.length, 0);
  assert.ok(r.rpc.log.includes("eth_fillTransaction"), "the hostile fill really happened");
});

await check("V2 honest RPC control: the checked copy is what sendTransaction gets, and viem signs/sends exactly it (one eth_sendRawTransaction, no re-fill RPC during the send)", async () => {
  const r = realViemSend({ noFill: true });
  const h = hooks();
  const out = await executeMoneyStep({ tx: TX, transport: r.transport, authorize: h.authorize, reserve: h.reserve, persistHash: h.persistHash });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.order, ["authorize", "reserve", "sign", "broadcast", "persist_hash"]);
  assert.equal(r.seen.sendCalls, 1); assert.equal(r.spy.signed, 1); assert.equal(r.rpc.raws.length, 1);
  const { account: acct, ...sentReq } = r.seen.sendArg;
  assert.equal(acct, r.account);
  assert.equal(preparedSignProblem(sentReq), null, "the request handed to sendTransaction passes the pre-sign assertion");
  assert.deepEqual(r.rpc.log.slice(r.seen.logAtSend), ["eth_sendRawTransaction"], "no eth_fillTransaction / estimate / nonce read after the check");
  const parsed = parseTransaction(r.rpc.raws[0]);
  for (const k of ["chainId", "type", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "to", "value", "data"]) {
    assert.equal(String(parsed[k]).toLowerCase(), String(sentReq[k]).toLowerCase(), k);
  }
  assert.equal(out.hash, keccak256(r.rpc.raws[0]));
});

await check("V3 A-774 parity: eip1559 + both max fees + echoed gasPrice -> the SAME signing copy (no gasPrice) is checked and sent; the prepared object is not mutated", async () => {
  const f = fakeViemSend({ ...OKP, gasPrice: parseGwei("146") });
  const h = hooks();
  const out = await executeMoneyStep({ tx: TX, transport: f.transport, authorize: h.authorize, reserve: h.reserve, persistHash: h.persistHash });
  assert.equal(out.ok, true, JSON.stringify(out, (k, v) => (typeof v === "bigint" ? `${v}` : v)));
  assert.equal(f.seen.sendCalls, 1);
  assert.equal("gasPrice" in f.seen.sendArg, false);
  assert.equal(f.seen.prepared.gasPrice, parseGwei("146"), "original prepared keeps gasPrice");
  const { gasPrice: _g, account: _a, ...expected } = f.seen.prepared;
  const { account: sentAcct, ...sentRest } = f.seen.sendArg;
  assert.equal(sentAcct, f.account);
  assert.deepEqual(sentRest, expected);
  assert.deepEqual(signingCopy(f.seen.prepared), expected);
});

await check("V4 every off-contract prepared request is refused on VIEM_SEND before sendTransaction (fee-incomplete + gasPrice, legacy/7702 type, 7702 list, accessList, caps, value)", async () => {
  const cases = [
    [{ ...OKP, maxPriorityFeePerGas: undefined, gasPrice: 1n }, "unexpected_field"],
    [{ ...OKP, maxFeePerGas: null, gasPrice: 1n }, "unexpected_field"],
    [{ ...OKP, type: "legacy", gasPrice: 1n }, "tx_type_unexpected"],
    [{ ...OKP, type: "eip7702" }, "tx_type_unexpected"],
    [{ ...OKP, authorizationList: [] }, "authorization_list_present"],
    [{ ...OKP, accessList: [{ address: TO, storageKeys: [] }] }, "access_list_present"],
    [{ ...OKP, chainId: 143 }, "chain_id_mismatch"],
    [{ ...OKP, gas: 30_000_000n }, "gas_out_of_bounds"],
    [{ ...OKP, maxFeePerGas: parseGwei("120000") }, "fee_out_of_bounds"],
    [{ ...OKP, maxPriorityFeePerGas: parseGwei("500") }, "fee_out_of_bounds"],
    [{ ...OKP, gas: 2_000_000n, maxFeePerGas: parseGwei("60") }, "fee_out_of_bounds"],
    [{ ...OKP, nonce: -1 }, "nonce_invalid"],
    [{ ...OKP, value: -1n }, "value_invalid"],
  ];
  for (const [prepared, reason] of cases) {
    const f = fakeViemSend(prepared);
    const h = hooks();
    const out = await executeMoneyStep({ tx: { to: TO, data: "0x" }, transport: f.transport, authorize: h.authorize, reserve: h.reserve, persistHash: h.persistHash });
    assert.deepEqual([out.status, out.phase, out.reason], ["blocked", "sign", reason], reason);
    assert.equal(f.seen.sendCalls, 0, reason);
    assert.equal(h.log.includes("persist_hash"), false);
  }
});

await check("V5 no prepare function -> transport_incomplete before any hook; a prepare that throws -> blocked at 'sign', nothing sent; requireSignBeforeSend still refuses VIEM_SEND", async () => {
  const send = { calls: 0 };
  const noPrep = { kind: TRANSPORT_KIND.VIEM_SEND, account: { address: "0x" + "b".repeat(40) }, walletClient: { async sendTransaction() { send.calls += 1; return `0x${"ab".repeat(32)}`; } } };
  const h0 = hooks();
  const out0 = await executeMoneyStep({ tx: TX, transport: noPrep, authorize: h0.authorize, reserve: h0.reserve, persistHash: h0.persistHash });
  assert.deepEqual([out0.status, out0.reason, h0.log.length, send.calls], ["blocked", "transport_incomplete", 0, 0]);
  const f = fakeViemSend(OKP, { prepareThrows: true });
  const h = hooks();
  const out = await executeMoneyStep({ tx: TX, transport: f.transport, authorize: h.authorize, reserve: h.reserve, persistHash: h.persistHash });
  assert.deepEqual([out.status, out.phase, out.reason, f.seen.sendCalls], ["blocked", "sign", "sign_failed", 0]);
  const g = fakeViemSend(OKP);
  const out2 = await executeMoneyStep({ tx: TX, transport: g.transport, ...hooks(), requireSignBeforeSend: true });
  assert.deepEqual([out2.status, out2.reason, g.seen.sendCalls], ["blocked", "sign_before_send_unavailable", 0]);
});

await check("V6 source order in executeMoneyStep: VIEM_SEND prepare < signingCopy < preparedSignProblem < refusal return < sendTransaction(viemSendRequest); one shared strip; strict path unchanged", () => {
  const ex = strip(SRC("money-executor.js"));
  const block = ex.slice(ex.indexOf("let viemSendRequest = null;"), ex.indexOf("if (typeof hash !== \"string\""));
  const at = (s) => { const i = block.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("const toSign = signingCopy(await transport.walletClient.prepareTransactionRequest(") < at("preparedSignProblem(toSign)")
    && at("preparedSignProblem(toSign)") < at('if (signProblem) return blocked("sign", signProblem);')
    && at('if (signProblem) return blocked("sign", signProblem);') < at("sendTransaction("));
  assert.match(block, /sendTransaction\(\{ \.\.\.viemSendRequest, account: transport\.account \}\)/);
  assert.match(block, /if \(!viemSendRequest\) return blocked\("sign", "presign_check_missing"\);/);
  assert.equal((block.match(/sendTransaction\(/g) || []).length, 1);
  assert.equal((ex.match(/delete [a-zA-Z.]*gasPrice/g) || []).length, 1);
  const strict = ex.slice(ex.indexOf("if (strict) {"), ex.indexOf("let viemSendRequest = null;"));
  assert.ok(strict.indexOf("const toSign = signingCopy(prepared);") < strict.indexOf("preparedSignProblem(toSign)") && strict.indexOf("preparedSignProblem(toSign)") < strict.indexOf("account.signTransaction(toSign)"));
});

await check("V7 Second plumbing lane (the VIEM_SEND user): a hostile prepare blocks the deposit before any send; reserved record stays (no hash, reconcile owns it), no redeem", async () => {
  const storage = createMemoryStorage();
  const sent = [];
  const walletClient = {
    async prepareTransactionRequest(t) { return { ...t, ...OKP, chainId: 1 }; },
    async sendTransaction(tx) { sent.push(tx); return `0x${"12".repeat(32)}`; },
  };
  const publicClient = { async waitForTransactionReceipt() { return { status: "success", blockNumber: 1n }; }, async readContract() { return 0n; } };
  const held = new Set();
  const withMoneyLock = async (name, body) => { if (held.has(name)) return undefined; held.add(name); try { return await body(); } finally { held.delete(name); } };
  const scope = { accountId: "0x1111111111111111111111111111111111111111", chainId: "monad-testnet" };
  const out = await runSecondPlumbingProof({ storage, scope, piggyId: "piggy-1", amountWei: "1000", confirm: true, account: { address: "0x" + "b".repeat(40) },
    walletClient, publicClient, signDigest: async () => ({}), isAppLocked: () => false, withMoneyLock });
  assert.deepEqual([out.outcome, out.reason], ["blocked", "chain_id_mismatch"]);
  assert.equal(sent.length, 0);
  const pending = readSecondSendPending(storage, scope, "piggy-1");
  assert.equal(pending?.stage, "deposit-sending");
  assert.equal(pending?.depositTxHash ?? null, null);
});

// ═══ K · Kintsu explicit live gate ════════════════════════════════════════════════════════════════════════════
const MAINNET = resolveChainProfile("monad-mainnet");
const PIGGY = { id: "piggy-1", address: "0x1111111111111111111111111111111111111111" };
const FORK_EXECUTOR = { kind: "local_fork", chainId: 143, forkBlock: 108999816, send: async () => { throw new Error("no send"); }, receipt: async () => null };
const PROVEN = Object.keys(KINTSU_STEPS).filter((k) => KINTSU_STEPS[k].proof === "proven_fork");

await check("K1 a Kintsu profile whose liveExecution is anything but exactly true is refused live_execution_disabled (false/undefined/null/'true'/1/{}), for every proven step and executor", () => {
  assert.equal(MAINNET.liveExecution, false);
  for (const live of [false, undefined, null, "true", 1, {}, [true]]) {
    const profile = { ...MAINNET, jobId: KINTSU_JOB_ID, liveExecution: live };
    for (const step of PROVEN) for (const executor of [null, FORK_EXECUTOR, { ...FORK_EXECUTOR, kind: "live" }]) {
      const g = kintsuExecutionGate({ profile, piggy: PIGGY, executor, step });
      assert.deepEqual([g.allowed, g.reason, g.liveExecution, g.executionPermission], [false, "live_execution_disabled", false, false], `${String(live)}/${step}`);
    }
  }
  const { liveExecution: _drop, ...noLive } = MAINNET;
  assert.equal(kintsuExecutionGate({ profile: { ...noLive, jobId: KINTSU_JOB_ID }, piggy: PIGGY, executor: FORK_EXECUTOR, step: "deposit" }).reason, "live_execution_disabled");
  assert.ok(kintsuReadiness({ profile: { ...MAINNET, jobId: KINTSU_JOB_ID }, piggy: PIGGY, executor: FORK_EXECUTOR }).blockedBy.includes("live_execution_disabled"));
});

await check("K2 only liveExecution === true gets past the live gate — and it still refuses (binding, then kintsu_lane_not_wired); allowed is never true", () => {
  const g = kintsuExecutionGate({ profile: { ...MAINNET, jobId: KINTSU_JOB_ID, liveExecution: true }, piggy: PIGGY, executor: FORK_EXECUTOR, step: "deposit" });
  assert.deepEqual([g.allowed, g.reason], [false, "asset_not_in_profile"]);
  const gate = strip(SRC("mainnet-job-kintsu.js"));
  const body = gate.slice(gate.indexOf("export function kintsuExecutionGate"), gate.indexOf("export function kintsuReadiness"));
  const live = body.indexOf('if (profile.liveExecution !== true) return refuse("live_execution_disabled");');
  assert.ok(live > 0, "explicit live check present");
  assert.ok(live < body.indexOf("bindRecordToProfile(") && live < body.indexOf("executorRefusal("), "live check precedes binding and executor");
});

// ═══ H · Safari-safe own-property ═════════════════════════════════════════════════════════════════════════════
const PROTO_RECORD = Object.create({ address: "0x" + "ab".repeat(20), source: "piggy_registry" });
const DEST_A = "0x" + "ab".repeat(20);
function ownTruthTable(hasOwnSafe) {
  const proto = { inherited: 1 };
  const o = Object.create(proto);
  o.own = 2;
  assert.equal(hasOwnSafe(o, "own"), true);
  assert.equal(hasOwnSafe(o, "inherited"), false);
  assert.equal(hasOwnSafe(o, "toString"), false);
  assert.equal(hasOwnSafe(Object.create(null), "x"), false);
  const bare = Object.create(null); bare.x = 1;
  assert.equal(hasOwnSafe(bare, "x"), true, "null-prototype object");
  assert.equal(hasOwnSafe([5], 0), true); assert.equal(hasOwnSafe([5], 1), false);
  // eslint-disable-next-line no-sparse-arrays
  assert.equal(hasOwnSafe([, 1], 0), false, "sparse slot");
  assert.equal(hasOwnSafe(null, "x"), false); assert.equal(hasOwnSafe(undefined, "x"), false);
  assert.equal(hasOwnSafe({ hasOwnProperty: () => true }, "nope"), false, "a shadowing hasOwnProperty is not consulted");
}
function producerBehaviour(mod) {
  const known = mod.deriveDestinationProvenance({ destination: DEST_A, records: [{ address: DEST_A, source: "piggy_registry" }] });
  assert.deepEqual([known.status, known.destinationFirstSeen, known.destinationLookalike], ["known", false, false]);
  const inherited = mod.deriveDestinationProvenance({ destination: DEST_A, records: [PROTO_RECORD] });
  assert.deepEqual([inherited.status, inherited.reason], ["UNKNOWN", "provenance_unreadable"], "an inherited address/source never vouches");
  const inheritedInput = mod.deriveDestinationProvenance(Object.create({ destination: DEST_A, records: [{ address: DEST_A, source: "piggy_registry" }] }));
  assert.equal(inheritedInput.status, "UNKNOWN");
  // eslint-disable-next-line no-sparse-arrays
  const sparse = mod.deriveDestinationProvenance({ destination: DEST_A, records: [, { address: DEST_A, source: "piggy_registry" }] });
  assert.deepEqual([sparse.status, sparse.ignoredRecords], ["known", 1]);
}

await check("H1 native path (Object.hasOwn present): HAS_OWN_PATH 'native', own-only truth table, producer refuses inherited records", () => {
  assert.equal(typeof Object.hasOwn, "function");
  assert.equal(SAFETY.HAS_OWN_PATH, "native");
  ownTruthTable(SAFETY.hasOwnSafe);
  producerBehaviour(SAFETY);
});

await check("H2 fallback path (Object.hasOwn ABSENT, as on Safari < 15.4): module loads, HAS_OWN_PATH 'fallback', identical truth table and producer behaviour (no throw -> no false UNKNOWN)", async () => {
  const saved = Object.getOwnPropertyDescriptor(Object, "hasOwn");
  let mod;
  try {
    delete Object.hasOwn;
    assert.equal(typeof Object.hasOwn, "undefined");
    mod = await import(`${pathToFileURL(path.join(SRC_DIR, "execution-safety.js")).href}?a791-fallback`);
    assert.equal(mod.HAS_OWN_PATH, "fallback");
    ownTruthTable(mod.hasOwnSafe);
    producerBehaviour(mod);
  } finally {
    Object.defineProperty(Object, "hasOwn", saved);
  }
  assert.equal(typeof Object.hasOwn, "function");
});

await check("H3 the helper is captured at load: replacing Object.hasOwn or Object.prototype.hasOwnProperty afterwards does not change its answers", () => {
  const savedOwn = Object.getOwnPropertyDescriptor(Object, "hasOwn");
  const savedProto = Object.getOwnPropertyDescriptor(Object.prototype, "hasOwnProperty");
  try {
    Object.defineProperty(Object, "hasOwn", { value: () => true, configurable: true, writable: true });
    Object.defineProperty(Object.prototype, "hasOwnProperty", { value: () => true, configurable: true, writable: true });
    assert.equal(SAFETY.hasOwnSafe(Object.create({ a: 1 }), "a"), false);
    producerBehaviour(SAFETY);
  } finally {
    Object.defineProperty(Object, "hasOwn", savedOwn);
    Object.defineProperty(Object.prototype, "hasOwnProperty", savedProto);
  }
});

await check("H4 source: execution-safety.js calls Object.hasOwn nowhere except the guarded capture; every own-property read goes through hasOwnSafe", () => {
  const s = strip(SRC("execution-safety.js"));
  assert.deepEqual(s.match(/Object\.hasOwn\b[^\n]*/g), ['Object.hasOwn === "function" ? Object.hasOwn : null;']);
  assert.ok((s.match(/hasOwnSafe\(/g) || []).length >= 5);
});

// ═══ E · A-758 review: envelope lifetime at the Aave boundary ════════════════════════════════════════════════
const ENV_NOW = 1_800_000_000_000;
function envFor(over = {}) {
  return Object.freeze({ state: "permitted", nonce: "n-1", issuedAt: ENV_NOW - 1000, expiresAt: ENV_NOW + 60_000, signerAddress: PIGGY.address, piggyId: PIGGY.id, ...over });
}
const E_ARGS = { intent: { nonce: "n-1" }, consumedNonces: new Set(["n-1"]), signerContext: null, nowMs: ENV_NOW };

await check("E1 a sealed envelope with no / string / NaN / non-finite expiresAt or issuedAt, or issuedAt > expiresAt, is refused envelope_lifetime_malformed (it used to pass authorize forever)", () => {
  const { expiresAt: _e, ...noExp } = envFor();
  const { issuedAt: _i, ...noIss } = envFor();
  for (const env of [Object.freeze(noExp), Object.freeze(noIss), envFor({ expiresAt: String(ENV_NOW + 60_000) }), envFor({ expiresAt: Number.NaN }),
    envFor({ expiresAt: Number.POSITIVE_INFINITY }), envFor({ issuedAt: "0" }), envFor({ issuedAt: ENV_NOW + 70_000 })]) {
    assert.equal(revalidateAaveEnvelope({ ...E_ARGS, envelope: env }), "envelope_lifetime_malformed", JSON.stringify(env));
  }
});

await check("E2 lifetime window: nowMs before issuedAt -> envelope_not_yet_valid; nowMs == expiresAt or later -> permission_expired; non-permitted state -> no_permission (authorize); a well-formed lifetime proceeds to the existing checks", () => {
  assert.equal(revalidateAaveEnvelope({ ...E_ARGS, envelope: envFor({ issuedAt: ENV_NOW + 1 }) }), "envelope_not_yet_valid");
  assert.equal(revalidateAaveEnvelope({ ...E_ARGS, envelope: envFor({ expiresAt: ENV_NOW }) }), "permission_expired");
  assert.equal(revalidateAaveEnvelope({ ...E_ARGS, envelope: envFor({ expiresAt: ENV_NOW - 1 }) }), "permission_expired");
  // a non-permitted state is still refused (by authorize, after the lifetime checks)
  for (const state of ["consumed", "cancelled", undefined, "PERMITTED"]) assert.equal(revalidateAaveEnvelope({ ...E_ARGS, envelope: envFor({ state }) }), "no_permission", String(state));
  // well-formed lifetime: the next refusal is the pre-existing one (no selection context here), not a lifetime reason
  assert.equal(revalidateAaveEnvelope({ ...E_ARGS, envelope: envFor() }), "no_selection_context");
  // a real issuer envelope has exactly this shape (finite numbers, issuedAt <= expiresAt)
  const { envelope } = issuePermission({ intent: { piggyId: PIGGY.id, signerAddress: PIGGY.address, action: "supply", asset: "USDC", amount: "1", chain: "monad-mainnet", destination: PIGGY.address, destinationRequired: true },
    auth: { method: "passkey", verified: true, verifiedAt: ENV_NOW, credentialId: "c" }, nonce: "n-real", nowMs: ENV_NOW });
  assert.ok(envelope && Number.isFinite(envelope.issuedAt) && Number.isFinite(envelope.expiresAt) && envelope.issuedAt <= envelope.expiresAt && envelope.state === "permitted");
});

// ═══ R · A-758 review: reconcile wrapper has no send ═════════════════════════════════════════════════════════
await check("R1 reconcileAaveLaneReadOnly hands the lane a frozen receipt-only reader (no send), never the caller's executor", () => {
  const ad = strip(SRC("second-execution-adapter.js"));
  const body = ad.slice(ad.indexOf("export async function reconcileAaveLaneReadOnly("), ad.indexOf("export function buildAaveGuardedReceipt("));
  assert.match(body, /const txReceiptReader = executor && typeof executor\.receipt === "function" \? Object\.freeze\(\{ receipt: \(hash\) => executor\.receipt\(hash\) \}\) : null;/);
  assert.match(body, /reconcileLaneIntent\(\{ profile, piggy, intent: stored\.intent, executor: txReceiptReader, storage, nowIso \}\)/);
  assert.equal(/executor: executor\b|\.send\b/.test(body), false);
  assert.equal((body.match(/reconcileLaneIntent\(/g) || []).length, 1, "the lane is reached exactly once, with the reader");
});

// ═══ M · main.js wiring ═══════════════════════════════════════════════════════════════════════════════════════
// M-a: secondLaneRouteEvidence, the real function cut from main.js, run against the real modules (or a forged route function).
function loadRouteEvidence(routeFn = routeSecondMainnetExecution) {
  const ctx = { CHAIN_PROFILE: MAINNET, routeSecondCurrentRead, routeSecondMainnetExecution: routeFn, SECOND_MAINNET_DESCRIPTORS, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(`${constDecl("SECOND_ROUTE_LOCKS")}\n${fnBody("secondLaneRouteEvidence")}\nthis.__f = secondLaneRouteEvidence;`, ctx);
  return ctx.__f;
}

await check("M1 main routes the product's (unconfigured) read through the A-762 surface: one frozen evidence row per protocol, every one a refusal on the closed live gate, nothing allowed", async () => {
  const read = await readSecondCurrent({ profile: MAINNET, piggyAddress: PIGGY.address });
  const ev = loadRouteEvidence()(read);
  assert.ok(ev && Object.isFrozen(ev) && Object.isFrozen(ev.routes));
  assert.equal(ev.kind, "second_lane_route_evidence");
  assert.deepEqual([...ev.routes].map((r) => r.jobId), Object.keys(SECOND_MAINNET_DESCRIPTORS));
  for (const r of ev.routes) {
    assert.equal(r.step, SECOND_MAINNET_DESCRIPTORS[r.jobId].steps[0]);
    assert.ok(r.blockedBy.includes("merge_route_has_no_execution_path") && r.blockedBy.includes("live_gate_closed"), r.jobId);
    assert.equal(r.readerEvidence, "unknown");
    assert.equal(Object.keys(r).some((k) => /allowed|permission|ready|executable|live/i.test(k)), false, "evidence rows carry no permission-shaped key");
  }
  for (const id of ["neverland-usdc", "curvance-usdc", "abil-spot", "kintsu-smon"]) assert.ok(ev.routes.find((r) => r.jobId === id).blockedBy.includes("lane_not_bound"), id);
});

await check("M2 evidence never becomes permission: if the route ever claims allowed/ready/executable/permission/live/sent or an action, main DROPS the whole evidence (null); a throw is null too", async () => {
  const read = await readSecondCurrent({ profile: MAINNET, piggyAddress: PIGGY.address });
  const claims = [{ allowed: true }, { ready: true }, { executable: true }, { executionPermission: true }, { createsPermission: true }, { liveExecution: true }, { sent: true },
    { actionCount: 1 }, { action: "send" }, { allowed: undefined }, { liveExecution: "false" }];
  for (const claim of claims) {
    let n = 0;
    const forged = (input) => { n += 1; const real = routeSecondMainnetExecution(input); return n === 3 ? { ...real, ...claim } : real; };
    assert.equal(loadRouteEvidence(forged)(read), null, JSON.stringify(claim));
  }
  assert.equal(loadRouteEvidence(() => { throw new Error("boom"); })(read), null);
  assert.equal(loadRouteEvidence(() => null)(read), null);
  // and the route function main calls is the real one: given the product inputs it always answers not-allowed
  for (const jobId of Object.keys(SECOND_MAINNET_DESCRIPTORS)) {
    const out = routeSecondMainnetExecution({ jobId, step: SECOND_MAINNET_DESCRIPTORS[jobId].steps[0], route: null, profile: { ...MAINNET, liveExecution: true }, piggy: null, executor: FORK_EXECUTOR });
    assert.deepEqual([out.allowed, out.executionPermission, out.liveExecution, out.sent], [false, false, false, false]);
  }
});

await check("M3 refresh wiring: refreshSecondLaneCandidates assigns sj.laneRoutes from the SAME read; decisions are built without it; permission/send paths never name it", () => {
  const refresh = strip(fnBody("refreshSecondLaneCandidates"));
  assert.ok(refresh.indexOf("sj.laneRead = currentRead;") < refresh.indexOf("sj.laneRoutes = secondLaneRouteEvidence(currentRead);"));
  const decide = refresh.slice(refresh.indexOf("decideCurrentCandidates({"), refresh.indexOf("});", refresh.indexOf("decideCurrentCandidates({")));
  assert.equal(/laneRoutes/.test(decide), false);
  for (const name of ["requestMoneyPermission", "authorizeMoneyAction", "handleSecondSend", "handleSecondLaneTry", "recordSecondLaneDecision", "sendPiggyOnce", "runLocalSecondPlumbingProofIfHarnessed"]) {
    assert.equal(/laneRoutes|secondLaneRouteEvidence|routeSecondMainnetExecution/.test(fnBody(name)), false, name);
  }
});

// M-b: authorizeMoneyAction + the destination producer, cut from main.js and run with stubs for authorize / the Piggy snapshot.
const REG_A = "0x" + "a1".repeat(20);
const REG_B = "0x" + "b2".repeat(20);
function loadAuthorize({ authorizeResult = { ok: true, reason: null, nonce: "n" }, piggies = [{ id: "a", address: REG_A }, { id: "b", address: REG_B }], snapshotThrows = false, destination = null } = {}) {
  const calls = { authorize: 0 };
  const ctx = {
    Date, Array,
    state: { moneyIntent: { permission: destination === undefined ? {} : { destination } }, selectedPiggy: { id: "a", address: REG_A }, activeSignerAddress: REG_A },
    activeAccount: null, consumedPermissionNonces: new Set(),
    authorize: () => { calls.authorize += 1; return authorizeResult; },
    selectionContext: () => ({}),
    moneyPiggiesSnapshot: () => { if (snapshotThrows) throw new Error("index unreadable"); return { piggies }; },
    deriveDestinationProvenance: SAFETY.deriveDestinationProvenance, DESTINATION_SOURCE: SAFETY.DESTINATION_SOURCE,
  };
  vm.createContext(ctx);
  vm.runInContext(`${fnBody("authorizeMoneyAction")}\n${fnBody("moneyDestinationRecords")}\n${fnBody("moneyDestinationRefusal")}\nthis.__f = authorizeMoneyAction;`, ctx);
  return { f: ctx.__f, calls };
}

await check("M4 destination producer at the authorize boundary: no destination -> authorize's own result object; a destination vouched by this device's Piggy records -> that same object", () => {
  for (const destination of [null, undefined, ""]) {
    const res = { ok: true, reason: null, nonce: "n" };
    const { f } = loadAuthorize({ authorizeResult: res, destination });
    assert.equal(f({}), res, String(destination));
  }
  const res = { ok: true, reason: null, nonce: "n" };
  assert.equal(loadAuthorize({ authorizeResult: res, destination: REG_B }).f({}), res);
  assert.equal(loadAuthorize({ authorizeResult: res, destination: REG_B.toUpperCase().replace("0X", "0x") }).f({}), res, "case-insensitive full-address identity");
});

await check("M5 refuse-only: first-seen / lookalike -> destination_needs_strong_confirmation; unreadable records / bad destination -> destination_provenance_unknown; never ok:true", () => {
  const ok = { ok: true, reason: null, nonce: "n" };
  const look = "0x" + "a1a1" + "00".repeat(16) + "a1a1";
  const cases = [
    [{ destination: "0x" + "cc".repeat(20) }, "destination_needs_strong_confirmation"],
    // vouched (exact Piggy record) BUT a second record shares its visible edges: lookalike alone must still refuse
    [{ destination: REG_A, piggies: [{ id: "a", address: REG_A }, { id: "x", address: look }] }, "destination_needs_strong_confirmation"],
    [{ destination: look }, "destination_needs_strong_confirmation"],
    [{ destination: REG_A, piggies: [] }, "destination_needs_strong_confirmation"],
    [{ destination: REG_A, snapshotThrows: true }, "destination_provenance_unknown"],
    [{ destination: REG_A, piggies: "nope" }, "destination_provenance_unknown"],
    [{ destination: "0x1234" }, "destination_provenance_unknown"],
    [{ destination: REG_A + "\n" }, "destination_provenance_unknown"],
  ];
  for (const [opts, reason] of cases) {
    const out = loadAuthorize({ authorizeResult: ok, ...opts }).f({});
    assert.deepEqual({ ...out }, { ok: false, reason }, JSON.stringify(opts));
  }
});

await check("M6 evidence never turns a refusal into a pass: an authorize refusal is returned as the very same object, whatever the destination provenance", () => {
  for (const destination of [null, REG_B, "0x" + "cc".repeat(20)]) {
    const refused = { ok: false, reason: "amount_mismatch" };
    const { f, calls } = loadAuthorize({ authorizeResult: refused, destination });
    assert.equal(f({}), refused);
    assert.equal(calls.authorize, 1);
  }
  const body = strip(fnBody("moneyDestinationRefusal"));
  assert.equal(/ok:\s*true|issuePermission|consume\(|authorize\(/.test(body), false);
  assert.match(strip(fnBody("moneyDestinationRecords")), /source: DESTINATION_SOURCE\.PIGGY_REGISTRY/);
  assert.equal(/USER_TYPED|PROTOCOL_REGISTRY|HISTORY|user_typed|protocol_registry|history/.test(strip(fnBody("moneyDestinationRecords"))), false, "main vouches only with its own Piggy records");
});

await check("M7 all live paths stay closed: every chain profile liveExecution:false, lane config off, main names no executor / lane module / live-true", () => {
  for (const id of ["monad-mainnet", "monad-testnet", "143", "10143", undefined]) assert.notEqual(resolveChainProfile(id)?.liveExecution, true, String(id));
  const code = strip(MAIN);
  assert.equal(/mainnet-job-(neverland|curvance|abil|kintsu)/.test(MAIN), false);
  assert.equal(/advanceAaveLaneGuarded|advanceLaneIntent|startLaneIntent|executeMoneyStep|liveExecution\s*:\s*true|lanes\s*:/.test(code), false);
});

console.log(`\nA-791: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
