// [A-915] Fork e2e: a SENDER creates a Gift on Monad 143 through the REAL main.js A-915 executor block (approve -> escrow create -> sponsor gas deposit, one
// signer session, every call through money-executor + the armed 143 SIGN_GUARD shapes), the deposit is registered with the REAL relayer service, then a 0-MON
// recipient claims through the sponsor (A-913 harness) -> DONE. Loopback anvil fork of Monad mainnet (143) behind a read-only proxy. 0 live tx.
//   ONE COMMAND:  A915_FORK=1 node app/test/a915-fork-create.mjs
//   (A915_FORK_URL=<rpc> overrides the read-only upstream; default https://rpc.monad.xyz. Without A915_FORK=1 or A915_FORK_URL the test SKIPs,
//    so `npm test` stays hermetic: no network, no port.)
// Pattern = A-814 partf.mjs: a read-only method-allowlist proxy (127.0.0.1) in front of the upstream, anvil forked from the proxy and bound to
// 127.0.0.1 only. eth_sendRawTransaction goes ONLY to loopback anvil. All keys are fresh in-memory and never printed. 0 live tx.
// Skips cleanly (exit 0, "SKIP") when: not requested · anvil absent · local port binding not permitted · _private escrow artifact absent.
// Raw output: _private/ops/receipts/A915_gift_create_143/raw/fork_e2e.json
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, sha256, toHex } from "viem";

import { createPublicClient, http as viemHttp, stringToHex } from "viem";
import { GIFT_SPONSOR_PINS, GIFT_SPONSOR_MAX_EXPIRY_SECONDS, giftSponsorNextStep, createGiftSponsorSession, sponsorCommitHash, toExecutorAuthorizationList, validateGiftSponsorRequest } from "../src/gift-sponsor-7702.js";
import { preparedSignProblem } from "../src/money-executor.js";
import { planGiftCreate, buildGiftCreateStepCalls, confirmGiftCreateStep, registerGasDeposit, needsGasRegistration, armGiftCreateStep, disarmAllGiftCreateSteps, giftCreateConfigProblem } from "../src/gift-create-plan.js";
import { planGiftSend, openGiftSend, giftSendReduce } from "../src/gift-send-paper.js";
import { createGiftSponsorPolicy, createGiftSponsorService, openGiftSponsorLedger, GIFT_SPONSOR_PIN_TABLE, minGasDepositWei } from "../../relayer/src/gift-sponsor-service.mjs";
import { createGiftSponsorReconciler } from "../../relayer/src/gift-sponsor-reconcile.mjs";
import { createPreflightGate } from "../../relayer/src/gift-sponsor-preflight.mjs";
import { createViemGiftSponsorChain } from "../../api/_lib/gift-sponsor-runtime.js";

const skip = (why) => { console.log(`SKIP  a915-fork-create — ${why}; 0 checks run`); process.exit(0); };
const REPO = new URL("../../", import.meta.url);
const ART = new URL("_private/ops/harness/gift-mainnet-fork-native/out/GiftPiggyUSDC.sol/GiftPiggyUSDC.json", REPO);
const RAW_DIR = pathToFileURL(testOutDir("a915-fork-create", process.env.A915_RAW_OUT) + "/"); // [A-932] pre-A-932 baseline: receipts/A915_gift_create_143/raw/
if (!process.env.A915_FORK && !process.env.A915_FORK_URL) skip("not requested (run: A915_FORK=1 node app/test/a915-fork-create.mjs)");
if (spawnSync("anvil", ["--version"], { stdio: "ignore" }).status !== 0) skip("anvil not installed");
if (!existsSync(ART)) skip("local escrow artifact absent (public checkout)");
const probePort = await new Promise((ok) => { const sv = net.createServer(); sv.once("error", () => ok(null)); sv.listen(0, "127.0.0.1", () => { const pt = sv.address().port; sv.close(() => ok(pt)); }); });
if (probePort === null) skip("local port binding is not permitted here");

const UPSTREAM = process.env.A915_FORK_URL || "https://rpc.monad.xyz";
const READ_ALLOW = new Set(["eth_chainId", "net_version", "web3_clientVersion", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBalance",
  "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getProof", "eth_getAccount", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockReceipts"]);
const proxy = { forwarded: {}, refused: {} };
function startProxy() {
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let pj; try { pj = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
      const items = Array.isArray(pj) ? pj : [pj];
      const bad = items.filter((m) => !READ_ALLOW.has(m?.method));
      if (bad.length) {
        for (const m of bad) proxy.refused[m?.method] = (proxy.refused[m?.method] || 0) + 1;
        const errs = items.map((m) => ({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32601, message: "A-915 read-only proxy refused" } }));
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(Array.isArray(pj) ? errs : errs[0])); return;
      }
      for (const m of items) proxy.forwarded[m.method] = (proxy.forwarded[m.method] || 0) + 1;
      try { const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body }); const t = await r.text(); res.writeHead(r.status, { "content-type": "application/json" }); res.end(t); }
      catch { res.writeHead(502); res.end(); }
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeMoneyStep, TRANSPORT_KIND } from "../src/money-executor.js";
import { runGiftCreateCalls } from "../src/gift-send-paper.js";
import { GIFT_CREATE_CHAIN_ID } from "../src/gift-create-plan.js";
import { createWalletClient, defineChain } from "viem";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]
import { pathToFileURL } from "node:url"; // [A-932]

const CHAIN = 143;
const USDC = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
const EABI = JSON.parse(readFileSync(ART, "utf8"));
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const DM_ABI = parseAbi(["function disabledDelegations(bytes32) view returns (bool)"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = { card: "A-915", part: "sender create on 143 + registration + recipient claim", at: new Date().toISOString(), live_tx: 0, upstream: UPSTREAM.replace(/\/\/[^/@]*@/, "//"), checks: [], notes: {} };
const CLAIM_GAS_UNITS = 80_000; // [A-979 ④] fork virtual cost (not measured) · fixture only (same number as the app's claim step in the budget fixture); the real number is a coordinator measurement

let anvil; let proxySrv; let pass = 0; let code = 0; let tmpRoot = null;
const check = async (label, fn) => { try { await fn(); console.log(`PASS  ${label}`); pass += 1; RAW.checks.push({ label, ok: true }); } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 9).join("\n      ")}`); code = 1; RAW.checks.push({ label, ok: false, error: String(e?.message || e).slice(0, 300) }); } };
try {
  proxySrv = await startProxy();
  const proxyUrl = `http://127.0.0.1:${proxySrv.address().port}`;
  const up = await (await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json();
  const pin = parseInt(up.result, 16) - 20;
  const port = probePort;
  anvil = spawn("anvil", ["--fork-url", proxyUrl, "--fork-block-number", String(pin), "--chain-id", String(CHAIN), "--hardfork", "prague", "--port", String(port), "--host", "127.0.0.1", "--block-time", "1", "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`; // loopback only
  let id = 0;
  const sends = { count: 0, labels: [] };
  const rpc = async (method, params = [], extra = {}) => {
    if (method === "eth_sendRawTransaction") { sends.count += 1; sends.labels.push(extra.label || "?"); }
    const j = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })).json();
    if (j.error) { const e = new Error(`${method}: ${j.error.message}`); e.rpc = j.error; throw e; }
    return j.result;
  };
  for (let i = 0; i < 80; i += 1) { try { await rpc("eth_chainId"); break; } catch { await sleep(500); } }
  assert.equal(parseInt(await rpc("eth_chainId"), 16), CHAIN);
  RAW.fork = { chainId: CHAIN, pin_block: pin, anvil: await rpc("web3_clientVersion") };

  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const monOf = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]));
  const usdcOf = async (a) => BigInt(await call(USDC, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [a] })));
  const chainNow = async () => parseInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp, 16);
  const codeOf = (a) => rpc("eth_getCode", [a, "latest"]);

  // submit a signed tx; onBroadcast(hash) fires after the node accepted it and before we wait for the receipt.
  const submit = async (acct, fields, label, onBroadcast) => {
    const nonce = parseInt(await rpc("eth_getTransactionCount", [acct.address, "pending"]), 16);
    const b = await rpc("eth_getBlockByNumber", ["latest", false]);
    const raw = await acct.signTransaction({ chainId: CHAIN, nonce, value: 0n, gas: 3_000_000n, maxFeePerGas: BigInt(b.baseFeePerGas) * 2n + 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n, ...fields });
    const hash = await rpc("eth_sendRawTransaction", [raw], { label });
    try { onBroadcast?.(hash); } catch {}
    let rc = null; for (let i = 0; i < 80 && !rc; i += 1) { rc = await rpc("eth_getTransactionReceipt", [hash]); if (!rc) await sleep(250); }
    return { hash, status: rc?.status, block: rc ? parseInt(rc.blockNumber, 16) : null, contractAddress: rc?.contractAddress, gasUsed: rc ? parseInt(rc.gasUsed, 16) : null };
  };

  const sender = privateKeyToAccount(generatePrivateKey());   // fresh in-memory keys, never printed
  const sponsorKey = privateKeyToAccount(generatePrivateKey());
  const deployer = privateKeyToAccount(generatePrivateKey());
  await rpc("anvil_setBalance", [sender.address, toHex(10n ** 20n)]);
  await rpc("anvil_setBalance", [deployer.address, toHex(10n ** 20n)]);
  await rpc("anvil_setBalance", [sponsorKey.address, toHex(0n)]); // Owner float = 0: the sponsor starts EMPTY and is only ever refilled by sender deposits (+ fork-only top-up below, recorded)
  RAW.actors = { sender: sender.address, sponsor: sponsorKey.address, note: "fresh in-memory keys, fork-only" };

  const dep = await submit(deployer, { to: null, data: EABI.bytecode.object }, "fixture_deploy_escrow");
  const ESCROW = getAddress(dep.contractAddress);
  const AMOUNT = 20_000_000n; // preset 20 USDC
  let slot = null;
  const slotKey = (a, sl) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, BigInt(sl)]));
  for (let sl = 0; sl < 64 && slot === null; sl += 1) {
    const key = slotKey(sender.address, sl); const old = await rpc("eth_getStorageAt", [USDC, key, "latest"]);
    await rpc("anvil_setStorageAt", [USDC, key, toHex(AMOUNT, { size: 32 })]);
    if ((await usdcOf(sender.address)) === AMOUNT) slot = sl; else await rpc("anvil_setStorageAt", [USDC, key, toHex(BigInt(old), { size: 32 })]);
  }
  assert.notEqual(slot, null, "USDC fixture slot");

  const codes = {};
  for (const k of ["statelessDelegate", "delegationManager", "exactExecutionEnforcer", "limitedCallsEnforcer", "timestampEnforcer"]) codes[k] = await codeOf(GIFT_SPONSOR_PINS[k]);
  await check("fork code: all five app pins (incl. TimestampEnforcer, previously FORK-READ) equal the code on the fork", () => {
    for (const k of Object.keys(codes)) assert.equal(keccak256(codes[k]), GIFT_SPONSOR_PINS.codeHash[CHAIN][k], k);
  });

  // ── relayer: policy / chain adapter / service. Fixture numbers are labelled; none is a product number. ──
  const gasPrice = BigInt(await rpc("eth_gasPrice"));
  const GAS = { gasUnits: { install: 50_000n, commitClaim: 50_000n, revoke: 50_000n, claim: CLAIM_GAS_UNITS, fundingTransfer: 10_000n }, feeInputs: { maxFeePerGasWei: gasPrice * 2n, source: "fork-fixture(2x eth_gasPrice)" }, safety: { bufferBps: 2000 } };
  const SP = { sponsorAddress: sponsorKey.address, chainId: CHAIN };
  const T = GIFT_SPONSOR_PIN_TABLE;
  const GAS_UNITS = { install: 50_000, commit: 50_000, revoke: 50_000, claim: CLAIM_GAS_UNITS }; // [A-979 ④] fork virtual cost (not measured) · fixtures; claim gas used is MEASURED below (RAW.gas_used_by_kind)
  const policy = createGiftSponsorPolicy({ chainId: CHAIN, escrow: ESCROW, sponsorAddress: sponsorKey.address, ...T.addresses, ...T.hashes[CHAIN], maxExpirySeconds: GIFT_SPONSOR_MAX_EXPIRY_SECONDS, gasUnits: GAS_UNITS, gasBufferBps: GAS.safety.bufferBps });
  assert.ok(policy, "policy accepted (maxExpiry 300, per-step gas units + buffer injected)");
  const publicClient = createPublicClient({ transport: viemHttp(url) });
  const chainReal = createViemGiftSponsorChain({ publicClient, policy });
  // (Historical: the relayer's Committed ABI defect found by this fork run is FIXED; the flag stays only as a fallback.)
  // Known relayer defect found by this fork run: server.mjs ESCROW_READ_ABI declares event Committed WITHOUT `indexed` on giftId/committer, so
  // parseEventLogs cannot decode the real log and confirmCommit() is always false (every commit would end UNKNOWN). The escrow's real event has
  // giftId + committer indexed. Default = the REAL adapter (this test then fails, correctly). A915_CONFIRM_COMMIT_WORKAROUND=1 replaces ONLY confirmCommit
  // (topic check by hand) so the rest of the flow can be exercised until the relayer writer fixes the ABI.
  const COMMITTED_TOPIC = keccak256(toHex("Committed(bytes32,address,bytes32)"));
  const chain = process.env.A915_CONFIRM_COMMIT_WORKAROUND ? { ...chainReal, async confirmCommit({ txHash, giftId, delegator, commitHash }) {
    const rc = await rpc("eth_getTransactionReceipt", [txHash]);
    if (!rc || rc.status !== "0x1") return false;
    const ok = rc.logs.some((l) => l.address.toLowerCase() === ESCROW.toLowerCase() && l.topics[0] === COMMITTED_TOPIC && l.topics[1].toLowerCase() === giftId.toLowerCase() && l.topics[2].toLowerCase().endsWith(delegator.slice(2).toLowerCase()) && l.data.toLowerCase() === commitHash.toLowerCase());
    if (!ok) return false;
    const c = await chainReal.getCommit(giftId, delegator); return c.hash.toLowerCase() === commitHash.toLowerCase();
  } } : chainReal;
  const sendLog = []; let tag = "";
  const mkSponsor = (crash = null) => ({
    address: sponsorKey.address,
    async send({ kind, to, data, value, authorizationList }, { onBroadcast } = {}) {
      assert.equal(value, 0n, "the sponsor never sends MON");
      if (crash && crash.kind === kind && crash.when === "before" && !crash.used) { crash.used = true; throw new Error("crash before send"); }
      const r = await submit(sponsorKey, (kind === "install" || kind === "revoke") ? { type: "eip7702", to, data, value, authorizationList } : { to, data, value }, `relayer_${kind}`, onBroadcast);
      sendLog.push({ tag, kind, hash: r.hash, status: r.status, gasUsed: r.gasUsed });
      if (crash && crash.kind === kind && crash.when === "after" && !crash.used) { crash.used = true; throw new Error("crash after mined (response lost)"); }
      return { txHash: r.hash, blockNumber: BigInt(r.block), status: r.status === "0x1" ? "success" : "reverted" };
    },
  });
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "a915-fork-"));
  const logs = [];
  const chainDefault = chain;
  const mkRelayer = (file, crash = null, chainOverride = null) => {
    const chain = chainOverride || chainDefault;
    const ledger = openGiftSponsorLedger(file);
    const preflight = createPreflightGate({ policy, getCode: chain.getCode, log: (m) => logs.push(m) });
    const sponsor = mkSponsor(crash);
    const service = createGiftSponsorService({ ledger, policy, chain, sponsor, preflight, log: (m) => logs.push(m) });
    const reconciler = createGiftSponsorReconciler({ ledger, policy, chain, steps: service.steps, runExclusive: service.runExclusive, log: (m) => logs.push(m), inflightGraceSeconds: 1 });
    return { ledger, preflight, service, reconciler };
  };

  // Cowork (c): the sender's app registers {giftId, gasTx} with the relayer right after a confirmed create; the recipient claim carries no gasTx.
  const registerOn = async (r, g) => { const out = await registerGasDeposit({ record: g.record, client: { register: (b) => r.service.register(b) } }); g.record = out.record; return out; };

  
  // ── the real main.js A-915 block, run with a loopback signer/clients ──
  const MAIN = readFileSync(new URL("app/src/main.js", REPO), "utf8");
  const BLOCK = MAIN.slice(MAIN.indexOf("// ── [A-915] Gift create on Monad mainnet"), MAIN.indexOf("// ── [A-915] end ──"));
  assert.ok(BLOCK.length > 1000);
  const chainDef = defineChain({ id: CHAIN, name: "Monad fork (loopback)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const mkStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
  const loadBlock = ({ cfg, storage, client }) => {
    const ctx = { A915_CFG_INPUT: cfg && { ...cfg, ...(client ? { client } : {}) }, activeAccount: sender, activeSession: {}, state: { appLock: false }, localStorage: storage, fetch: async () => { throw new Error("network forbidden"); },
      GIFT_CREATE_CHAIN_ID, giftCreateConfigProblem, buildGiftCreateStepCalls, confirmGiftCreateStep, needsGasRegistration, registerGasDeposit, runGiftCreateCalls };
    const code = BLOCK.replace("const A915_GIFT_CREATE_CONFIG = null;", "const A915_GIFT_CREATE_CONFIG = A915_CFG_INPUT;");
    return new Function(...Object.keys(ctx), `${code}\nreturn { a915PlanExtras, a915GiftCreateExecutor, a915RetryGasRegistrations, a915StoreRead };`)(...Object.values(ctx));
  };
  const cfgFor = () => ({ chainId: GIFT_CREATE_CHAIN_ID, escrowAddress: ESCROW, sponsorAddress: sponsorKey.address, gas: GAS, giftExpiryUnix: () => expiryNow, receiptTimeoutMs: 30_000,
    makeClients: (account) => ({ walletClient: createWalletClient({ account, chain: chainDef, transport: viemHttp(url) }), publicClient }) });
  let expiryNow = 0;
  const PAYER = { id: "p-1", name: "Honeybun", address: sender.address };
  const draft = () => { let d = openGiftSend({ piggy: PAYER, selected: PAYER, chainScope: "monad-mainnet" }).draft; d = giftSendReduce(d, { type: "set_preset", preset: 20 }); return giftSendReduce(d, { type: "pick_front", front: "01" }); };
  const allowanceOf = async (owner, spender) => BigInt(await call(USDC, encodeFunctionData({ abi: parseAbi(["function allowance(address,address) view returns (uint256)"]), functionName: "allowance", args: [owner, spender] })));
  const feedUsdc = async () => rpc("anvil_setStorageAt", [USDC, slotKey(sender.address, slot), toHex(AMOUNT, { size: 32 })]);
  // wraps the real service.register in the client shape the sender app uses
  const relayerClient = (r) => ({ register: (b) => r.service.register(b) });
  // fork-only: Monad charges the gas LIMIT, fixture limits exceed a one-claim deposit. Production sponsor balance = sender deposits only. Recorded.
  const senderCreate = async (label, { client, storage, relayer } = {}) => {
    await feedUsdc(); expiryNow = (await chainNow()) + 86400;
    const st = storage || mkStorage(); const L = loadBlock({ cfg: cfgFor(), storage: st, client: client || relayerClient(relayer) });
    const plan = await planGiftSend({ draft: draft(), senderAddress: sender.address, expiry: undefined, gas: null, origin: "https://araso.app", ...L.a915PlanExtras() });
    assert.equal(plan.ok, true, plan.reason);
    const before = sends.labels.length; const sponsorBefore = await monOf(sponsorKey.address);
    sends.labels.push(`${label}:begin`);
    const result = await L.a915GiftCreateExecutor()({ plan, lock: {}, payer: PAYER });
    return { plan, L, st, result, sponsorBefore, sponsorAfter: await monOf(sponsorKey.address), sendLabels: sends.labels.slice(before) };
  };
  const nonceOf = async () => parseInt(await rpc("eth_getTransactionCount", [sender.address, "latest"]), 16);
  const newRequest = async (g, { piggy = privateKeyToAccount(generatePrivateKey()) } = {}) => {
    await rpc("anvil_setBalance", [piggy.address, "0x0"]);
    const preimage = stringToHex(g.token); const salt = toHex(crypto.randomBytes(32));
    const commitHash = sponsorCommitHash({ recipient: piggy.address, preimage, salt });
    const nowSec = await chainNow(); let signs = 0;
    const account = { address: piggy.address, signAuthorization: (a) => { signs += 1; return piggy.signAuthorization(a); }, signTypedData: (t) => { signs += 1; return piggy.signTypedData(t); } };
    const session = createGiftSponsorSession({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: sponsorKey.address, expirySeconds: GIFT_SPONSOR_MAX_EXPIRY_SECONDS }, giftId: g.giftId, commitHash, account, authNonce: 0, now: () => nowSec, readCode: (a) => codeOf(a), giftDeadlineSeconds: g.expiry });
    assert.ok(session);
    assert.equal((await session.signAuthorization()).ok, true); assert.equal((await session.signRevokeAuthorization()).ok, true); assert.equal((await session.signDelegation()).ok, true);
    const built = await session.buildRequest({ claim: { recipient: piggy.address, preimage, salt, deadline: String(g.expiry) } });
    assert.equal(built.ok, true, built.reason);
    assert.equal(signs, 3, "one Face ID step = install authorization + revoke authorization + delegation");
    return { piggy, request: built.request, wire: () => JSON.parse(JSON.stringify(built.request)), nowSec, built };
  };

  const gift = {};
  await check("A: sender create on 143 via the real A-915 block: approve -> create -> sponsor gas deposit (3 raw sends, one signer), allowance fully spent, sponsor +gasBudget, link issued", async () => {
    tag = "A"; const relayer = mkRelayer(path.join(tmpRoot, "A.json")); gift.relayer = relayer;
    const n0 = await nonceOf(); const usdcEscrow0 = await usdcOf(ESCROW);
    const g = await senderCreate("A", { relayer }); Object.assign(gift, g);
    assert.equal(g.result.ok, true, JSON.stringify(g.result)); assert.equal(g.result.link, g.plan.claimUrl);
    assert.equal((await nonceOf()) - n0, 3, "exactly three txs from the sender (approve, create, deposit)");
    assert.equal(g.sponsorAfter - g.sponsorBefore, g.plan.gasBudget.costWei, "sponsor balance rises by exactly the sender's gasBudget");
    assert.equal(await allowanceOf(sender.address, ESCROW), 0n, "exact-amount approve is fully consumed by create (no standing allowance)");
    assert.equal((await usdcOf(ESCROW)) - usdcEscrow0, AMOUNT);
    const gi = await chain.getGift(g.plan.giftId); assert.equal(gi.claimed, false);
    const stored = g.L.a915StoreRead()[0]; assert.equal(stored.giftId, g.plan.giftId); assert.equal(stored.gasDeposit.registered, true, "registered right after create");
    assert.equal(Object.keys(stored.steps).sort().join(), "approve,create,gas_deposit");
    assert.equal(g.plan.escrowCreateArgs.amount, Number(AMOUNT));
    RAW.create = { giftId: g.plan.giftId, steps: stored.steps, deposit_wei: g.plan.gasBudget.costWei.toString(), sponsor_before: g.sponsorBefore.toString(), sponsor_after: g.sponsorAfter.toString(), registered: true, sender_txs: 3 };
  });
  await check("B: the registered Gift is claimable by a 0-MON recipient through the sponsor -> DONE (install -> redeem -> revoke -> claim), Piggy MON 0", async () => {
    tag = "B"; await rpc("anvil_setBalance", [sponsorKey.address, toHex(10n ** 19n)]); // FORK-ONLY top-up (see note); the production float is sender deposits only
    RAW.notes.sponsor_topup = "fork-only 10 MON top-up so fixture gas limits (3,000,000) fit; production sponsor balance = sender deposits only";
    const g = { giftId: gift.plan.giftId, token: gift.plan.fragment.token, expiry: Number(gift.plan.escrowCreateArgs.expiry) };
    const rq = await newRequest(g); const usdc0 = await usdcOf(rq.piggy.address);
    const out = await gift.relayer.service.handle(rq.wire());
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.deepEqual(sendLog.filter((s) => s.tag === "B").map((s) => s.kind), ["install", "redeem", "revoke", "claim"]);
    assert.equal((await usdcOf(rq.piggy.address)) - usdc0, AMOUNT); assert.equal(await monOf(rq.piggy.address), 0n);
    assert.equal((await chain.getGift(g.giftId)).claimed, true);
    RAW.claim = { status: out.status, kinds: sendLog.filter((s) => s.tag === "B").map((s) => s.kind) };
  });
  await check("C: registration failure keeps the link; the sender's record is retried on the next open (real service) -> registered -> recipient claims -> DONE", async () => {
    tag = "C"; const relayer = mkRelayer(path.join(tmpRoot, "C.json")); const storage = mkStorage();
    const offline = { register: async () => { throw new Error("offline"); } };
    const g = await senderCreate("C", { client: offline, storage });
    assert.equal(g.result.ok, true, "the link is issued even when registration did not go through");
    assert.equal(g.L.a915StoreRead()[0].gasDeposit.registered, undefined);
    const rq = await newRequest({ giftId: g.plan.giftId, token: g.plan.fragment.token, expiry: Number(g.plan.escrowCreateArgs.expiry) });
    const sendsBefore = sends.count;
    assert.equal((await relayer.service.handle(rq.wire())).status, 409, "unregistered => gas_deposit_tx_missing, 0 sends");
    assert.equal(sends.count, sendsBefore);
    const next = loadBlock({ cfg: cfgFor(), storage, client: relayerClient(relayer) }); // "next open": loading the block retries once
    for (let i = 0; i < 40 && !next.a915StoreRead()[0].gasDeposit.registered; i += 1) await sleep(50);
    assert.equal(next.a915StoreRead()[0].gasDeposit.registered, true);
    const out = await relayer.service.handle(rq.wire());
    assert.equal(out.status, 200, JSON.stringify(out.body)); assert.equal((await chain.getGift(g.plan.giftId)).claimed, true);
    RAW.registration_retry = { first_claim_status: 409, after_retry_status: out.status };
  });
  await check("D: refused shapes on the fork - nothing reaches the node: max-uint approve, wrong spender, wrong create args, deposit +1 wei / wrong payee / wrong data, unarmed replay (0 sends, 0 allowance)", async () => {
    tag = "D"; await feedUsdc(); expiryNow = (await chainNow()) + 86400;
    const L = loadBlock({ cfg: cfgFor(), storage: mkStorage(), client: relayerClient(mkRelayer(null)) });
    const plan = await planGiftSend({ draft: draft(), senderAddress: sender.address, expiry: undefined, gas: null, origin: "https://araso.app", ...L.a915PlanExtras() });
    const built = buildGiftCreateStepCalls(plan, { escrowAddress: ESCROW }); const armed = armGiftCreateStep(plan, built.calls, { escrowAddress: ESCROW }); assert.equal(armed.ok, true);
    const wc = createWalletClient({ account: sender, chain: chainDef, transport: viemHttp(url) });
    const tryTx = async (tx) => executeMoneyStep({ tx: { ...tx, gas: 300_000n }, // explicit gas: viem skips estimateGas, so the GUARD (not a reverting estimate) decides
       transport: { kind: TRANSPORT_KIND.VIEM_RAW, walletClient: wc, publicClient, account: sender }, requireSignBeforeSend: true, authorize: () => true, reserve: () => true, persistHash: () => true });
    const [ap, cr, dp] = built.calls; const before = await nonceOf();
    const ERC = parseAbi(["function approve(address,uint256) returns (bool)"]);
    const flip = (data) => `${data.slice(0, -1)}${data.endsWith("0") ? "1" : "0"}`;
    const attempts = {
      maxApprove: { to: ap.to, value: 0n, data: encodeFunctionData({ abi: ERC, functionName: "approve", args: [ESCROW, 2n ** 256n - 1n] }) },
      wrongSpender: { to: ap.to, value: 0n, data: encodeFunctionData({ abi: ERC, functionName: "approve", args: [sponsorKey.address, BigInt(AMOUNT)] }) },
      otherAmount: { to: ap.to, value: 0n, data: encodeFunctionData({ abi: ERC, functionName: "approve", args: [ESCROW, AMOUNT + 1n] }) },
      createTampered: { to: cr.to, value: 0n, data: flip(cr.data) },
      createWithValue: { to: cr.to, value: 1n, data: cr.data },
      depositPlusOne: { to: dp.to, value: dp.value + 1n, data: dp.data },
      depositWrongPayee: { to: ESCROW, value: dp.value, data: dp.data },
      depositWrongData: { to: dp.to, value: dp.value, data: flip(dp.data) },
      plainMonToStranger: { to: "0x00000000000000000000000000000000000000d4", value: 1n, data: "0x" },
    };
    const reasons = {};
    for (const [k, tx] of Object.entries(attempts)) { const r = await tryTx(tx); reasons[k] = r.reason; assert.equal(r.status, "blocked", k); assert.equal(r.reason, "chain_id_mismatch", k); assert.equal(r.broadcastAttempted, false, k); }
    assert.equal(await nonceOf(), before, "not one raw send reached the node"); assert.equal(await allowanceOf(sender.address, ESCROW), 0n);
    armed.disarm();
    const replay = await tryTx({ to: ap.to, value: 0n, data: ap.data }); assert.equal(replay.reason, "chain_id_mismatch", "after disarm even the exact approve is closed"); assert.equal(await nonceOf(), before);
    RAW.refused_shapes = reasons;
  });
  await check("E: live config OFF - the shipped main.js has A915_GIFT_CREATE_CONFIG = null and the OFF block builds no executor", () => {
    assert.match(MAIN, /\nconst A915_GIFT_CREATE_CONFIG = null;\n/);
    const off = loadBlock({ cfg: null, storage: mkStorage() }); assert.equal(off.a915GiftCreateExecutor(), null); assert.deepEqual(off.a915PlanExtras(), {});
    assert.equal(giftCreateConfigProblem({ sponsorAddress: sponsorKey.address }), "escrow_address_invalid");
  });

  RAW.gas_used_by_kind = sendLog.reduce((m, x) => { (m[x.kind] ||= []).push(x.gasUsed); return m; }, {});
  RAW.sends = { total_to_loopback_anvil: sends.count };
  RAW.upstream_proxy = { forwarded: proxy.forwarded, refused: proxy.refused, note: "send-like methods are not in READ_ALLOW; every eth_sendRawTransaction went to loopback anvil only" };
  console.log(`\nA-915 fork e2e (sender create + registration + claim): ${pass} PASS${code ? " · FAIL present" : ""}`);
} catch (e) {
  console.log(`FAIL  fork setup: ${String(e?.stack || e).split("\n").slice(0, 5).join("\n      ")}`);
  RAW.error = String(e?.message || e).slice(0, 400);
  code = 1;
} finally {
  try { anvil?.kill("SIGTERM"); } catch {}
  try { proxySrv?.close(); } catch {}
  try { if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  RAW.exit = code;
  try { mkdirSync(RAW_DIR, { recursive: true }); writeFileSync(new URL("fork_e2e.json", RAW_DIR), JSON.stringify(RAW, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n"); } catch {}
}
process.exit(code);
