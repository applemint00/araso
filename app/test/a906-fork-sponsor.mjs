// [A-906 D] Fork e2e: a 0-MON Piggy claims a Gift through the REAL app plan (gift-sponsor-7702.js, real pins, real on-chain
// MetaMask v1.3.0 code) AND the REAL relayer service (relayer/src/gift-sponsor-service.mjs) on a loopback anvil fork of Monad mainnet (143).
//   ONE COMMAND:  A906_FORK=1 node app/test/a906-fork-sponsor.mjs
//   (A906_FORK_URL=<rpc> overrides the read-only upstream; default https://rpc.monad.xyz. Without A906_FORK=1 or A906_FORK_URL the test SKIPs,
//    so `npm test` stays hermetic: no network, no port.)
// Pattern = A-814 partf.mjs: a read-only method-allowlist proxy (127.0.0.1) in front of the upstream, anvil forked from the proxy and bound to
// 127.0.0.1 only. eth_sendRawTransaction goes ONLY to loopback anvil. All keys are fresh in-memory and never printed. 0 live tx.
// Skips cleanly (exit 0, "SKIP") when: not requested · anvil absent · local port binding not permitted · _private escrow artifact absent.
// Raw output: _private/ops/receipts/A906_gift_sponsor_adopt/raw/fork_e2e.json
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, sha256, toHex } from "viem";

import { GIFT_SPONSOR_PINS, giftSponsorRedeemData, buildExactExecutionTerms, buildTimestampTerms, createGiftSponsorSession, sponsorCommitHash, toExecutorAuthorizationList, validateGiftSponsorRequest } from "../src/gift-sponsor-7702.js";
import { preparedSignProblem } from "../src/money-executor.js";
import { createGiftSponsorPolicy, createGiftSponsorService, openGiftSponsorLedger } from "../../relayer/src/gift-sponsor-service.mjs";

const skip = (why) => { console.log(`SKIP  a906-fork-sponsor — ${why}; 0 checks run`); process.exit(0); };
const REPO = new URL("../../", import.meta.url);
const ART = new URL("_private/ops/harness/gift-mainnet-fork-native/out/GiftPiggyUSDC.sol/GiftPiggyUSDC.json", REPO);
const RAW_DIR = new URL("_private/ops/receipts/A906_gift_sponsor_adopt/raw/", REPO);
if (!process.env.A906_FORK && !process.env.A906_FORK_URL) skip("not requested (run: A906_FORK=1 node app/test/a906-fork-sponsor.mjs)");
if (spawnSync("anvil", ["--version"], { stdio: "ignore" }).status !== 0) skip("anvil not installed");
if (!existsSync(ART)) skip("local escrow artifact absent (public checkout)");
const probePort = await new Promise((ok) => { const sv = net.createServer(); sv.once("error", () => ok(null)); sv.listen(0, "127.0.0.1", () => { const pt = sv.address().port; sv.close(() => ok(pt)); }); });
if (probePort === null) skip("local port binding is not permitted here");

const UPSTREAM = process.env.A906_FORK_URL || "https://rpc.monad.xyz";
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
        const errs = items.map((m) => ({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32601, message: "A-906 read-only proxy refused" } }));
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(Array.isArray(pj) ? errs : errs[0])); return;
      }
      for (const m of items) proxy.forwarded[m.method] = (proxy.forwarded[m.method] || 0) + 1;
      try { const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body }); const t = await r.text(); res.writeHead(r.status, { "content-type": "application/json" }); res.end(t); }
      catch { res.writeHead(502); res.end(); }
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}
const CHAIN = 143;
const USDC = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
const EXPIRY_APP = 600; // fixtures only; the shipped modules have no default (Owner number UNKNOWN)
const EXPIRY_RELAYER_CAP = 3600;
const EABI = JSON.parse(readFileSync(ART, "utf8"));
const ERC20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const GIFTS_ABI = parseAbi(["function gifts(bytes32) view returns (address sender, address token, uint256 amount, uint64 expiry, bool claimed, bytes32 claimTokenHash)"]);
const TS_HOOK = parseAbi(["function beforeHook(bytes _terms, bytes _args, bytes32 _mode, bytes _executionCallData, bytes32 _delegationHash, address _delegator, address _redeemer)"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = { card: "A-906", part: "D app+relayer fork e2e", at: new Date().toISOString(), live_tx: 0, upstream: UPSTREAM.replace(/\/\/[^/@]*@/, "//"), checks: [] };

let anvil; let proxySrv; let pass = 0; let code = 0;
const check = async (label, fn) => { try { await fn(); console.log(`PASS  ${label}`); pass += 1; RAW.checks.push({ label, ok: true }); } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); code = 1; RAW.checks.push({ label, ok: false, error: String(e?.message || e).slice(0, 300) }); } };
try {
  proxySrv = await startProxy();
  const proxyUrl = `http://127.0.0.1:${proxySrv.address().port}`;
  const up = await (await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json();
  const pin = parseInt(up.result, 16) - 20;
  const port = probePort;
  anvil = spawn("anvil", ["--fork-url", proxyUrl, "--fork-block-number", String(pin), "--chain-id", String(CHAIN), "--hardfork", "prague", "--port", String(port), "--host", "127.0.0.1", "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`; // loopback only
  let id = 0;
  const sends = { count: 0, labels: [] };
  const rpc = async (method, params = [], extra = {}) => {
    if (method === "eth_sendRawTransaction") { sends.count += 1; sends.labels.push(extra.label || "?"); }
    const j = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })).json();
    if (j.error) { const e = new Error(`${method}: ${j.error.message}${j.error.data ? ` data=${String(typeof j.error.data === "string" ? j.error.data : JSON.stringify(j.error.data)).slice(0, 160)}` : ""}`); e.rpc = j.error; throw e; }
    return j.result;
  };
  for (let i = 0; i < 80; i += 1) { try { await rpc("eth_chainId"); break; } catch { await sleep(500); } }
  assert.equal(parseInt(await rpc("eth_chainId"), 16), CHAIN);
  RAW.fork = { chainId: CHAIN, pin_block: pin, anvil: await rpc("web3_clientVersion") };

  const piggy = privateKeyToAccount(generatePrivateKey());   // fresh in-memory, never printed
  const sponsorKey = privateKeyToAccount(generatePrivateKey());
  const giver = privateKeyToAccount(generatePrivateKey());
  await rpc("anvil_setBalance", [piggy.address, "0x0"]);
  await rpc("anvil_setBalance", [sponsorKey.address, toHex(10n ** 20n)]);
  await rpc("anvil_setBalance", [giver.address, toHex(10n ** 20n)]);
  RAW.actors = { piggy: piggy.address, sponsor: sponsorKey.address, gift_sender: giver.address, note: "fresh in-memory keys, fork-only; keys never persisted" };

  const sendTx = async (acct, fields, label) => {
    const nonce = parseInt(await rpc("eth_getTransactionCount", [acct.address, "pending"]), 16);
    const b = await rpc("eth_getBlockByNumber", ["latest", false]);
    const raw = await acct.signTransaction({ chainId: CHAIN, nonce, value: 0n, gas: 3_000_000n, maxFeePerGas: BigInt(b.baseFeePerGas) * 2n + 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n, ...fields });
    const hash = await rpc("eth_sendRawTransaction", [raw], { label });
    let rc = null; for (let i = 0; i < 40 && !rc; i += 1) { rc = await rpc("eth_getTransactionReceipt", [hash]); if (!rc) await sleep(250); }
    return { hash, status: rc?.status, block: rc ? parseInt(rc.blockNumber, 16) : null, contractAddress: rc?.contractAddress };
  };
  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const monOf = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]));
  const usdcOf = async (a) => BigInt(await call(USDC, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [a] })));
  const chainNow = async () => parseInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp, 16);

  // ── escrow + gift fixture (as A-814 Part F) ──
  const dep = await sendTx(giver, { to: null, data: EABI.bytecode.object }, "fixture_deploy_escrow");
  const ESCROW = getAddress(dep.contractAddress);
  const AMOUNT = 1_000_000n;
  let slot = null;
  for (let sl = 0; sl < 64 && slot === null; sl += 1) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [giver.address, BigInt(sl)]));
    const old = await rpc("eth_getStorageAt", [USDC, key, "latest"]);
    await rpc("anvil_setStorageAt", [USDC, key, toHex(AMOUNT, { size: 32 })]);
    if ((await usdcOf(giver.address)) === AMOUNT) slot = sl; else await rpc("anvil_setStorageAt", [USDC, key, toHex(BigInt(old), { size: 32 })]);
  }
  assert.notEqual(slot, null, "USDC fixture slot");
  const token = toHex(crypto.randomBytes(32));   // fork-only capability token
  const giftId = keccak256(toHex(crypto.randomBytes(32)));
  const t0 = await chainNow();
  const deadline = BigInt(t0 + 86400);
  await sendTx(giver, { to: USDC, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ESCROW, AMOUNT] }) }, "fixture_approve");
  const cr = await sendTx(giver, { to: ESCROW, data: encodeFunctionData({ abi: EABI.abi, functionName: "create", args: [giftId, USDC, AMOUNT, deadline, sha256(token)] }) }, "fixture_create_gift");
  assert.equal(cr.status, "0x1");
  RAW.escrow = { address: ESCROW, giftId, amount: AMOUNT.toString() };

  // ── real code on the fork + TimestampEnforcer evidence (layout assumption: packed uint128 after ‖ uint128 before) ──
  const codeOf = (a) => rpc("eth_getCode", [a, "latest"]);
  const codes = {};
  for (const k of ["statelessDelegate", "delegationManager", "exactExecutionEnforcer", "limitedCallsEnforcer", "timestampEnforcer"]) codes[k] = await codeOf(GIFT_SPONSOR_PINS[k]);
  RAW.fork_code = Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, { address: GIFT_SPONSOR_PINS[k], bytes: (v.length - 2) / 2, keccak: keccak256(v) }]));
  await check("fork code: the four app-pinned 143 hashes equal the code read from the fork", () => {
    for (const k of ["statelessDelegate", "delegationManager", "exactExecutionEnforcer", "limitedCallsEnforcer"]) assert.equal(keccak256(codes[k]), GIFT_SPONSOR_PINS.codeHash[CHAIN][k], k);
  });
  await check("TimestampEnforcer (fork-local evidence): packed uint128 after‖before is accepted/refused as assumed", async () => {
    const nowT = await chainNow();
    const hook = async (after, before) => {
      const data = encodeFunctionData({ abi: TS_HOOK, functionName: "beforeHook", args: [`0x${after.toString(16).padStart(32, "0")}${before.toString(16).padStart(32, "0")}`, "0x", GIFT_SPONSOR_PINS.mode, "0x", `0x${"00".repeat(32)}`, piggy.address, sponsorKey.address] });
      try { await rpc("eth_call", [{ from: GIFT_SPONSOR_PINS.delegationManager, to: GIFT_SPONSOR_PINS.timestampEnforcer, data }, "latest"]); return "OK"; } catch (e) { return `REVERT ${e.message.slice(0, 200)}`; }
    };
    const r = { future_before: await hook(0, nowT + 600), past_before: await hook(0, nowT - 100), future_after_only_swapped: await hook(nowT + 600, 0), after_past_before_future: await hook(nowT - 100, nowT + 600) };
    RAW.timestamp_enforcer = { bytes: RAW.fork_code.timestampEnforcer.bytes, keccak: RAW.fork_code.timestampEnforcer.keccak, probes: r };
    assert.equal(r.future_before, "OK");                       // (after=0, before=future): within window
    assert.match(r.past_before, /REVERT/);                      // before in the past: expired -> before is the SECOND uint128
    assert.match(r.future_after_only_swapped, /REVERT/);        // after in the future: not yet -> after is the FIRST uint128
    assert.equal(r.after_past_before_future, "OK");
    RAW.timestamp_enforcer.layout_matches_assumption = true;
  });

  // ── relayer service, fork-only injected config (pins = real 143 code read from the fork) ──
  const policy = createGiftSponsorPolicy({
    chainId: CHAIN, escrow: ESCROW, delegationManager: GIFT_SPONSOR_PINS.delegationManager, delegateImpl: GIFT_SPONSOR_PINS.statelessDelegate, sponsorAddress: sponsorKey.address,
    exactExecutionEnforcer: GIFT_SPONSOR_PINS.exactExecutionEnforcer, limitedCallsEnforcer: GIFT_SPONSOR_PINS.limitedCallsEnforcer, timestampEnforcer: GIFT_SPONSOR_PINS.timestampEnforcer,
    implCodeHash: keccak256(codes.statelessDelegate), delegationManagerCodeHash: keccak256(codes.delegationManager), exactExecutionCodeHash: keccak256(codes.exactExecutionEnforcer),
    limitedCallsCodeHash: keccak256(codes.limitedCallsEnforcer), timestampCodeHash: keccak256(codes.timestampEnforcer), maxExpirySeconds: Math.min(EXPIRY_RELAYER_CAP, 300), // pre-A-915 baseline: EXPIRY_RELAYER_CAP (3600); A-913 caps the policy at the A-556 5-minute cap
    // pre-A-915 baseline: the policy was built without gasUnits/gasBufferBps. [A-915 re-pin] A-913 made them required; FIXTURE numbers only (not measured, not product values). No assertion changed.
    gasUnits: { install: 50_000, commit: 50_000, revoke: 50_000, claim: 80_000 }, gasBufferBps: 2000,
  });
  assert.ok(policy, "policy accepted");
  const relayerChain = {
    async getGift(gid) { const g = await call(ESCROW, encodeFunctionData({ abi: GIFTS_ABI, functionName: "gifts", args: [gid] })); const [sender, , , expiry, claimed, hash] = decodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bytes32" }], g); return { exists: sender !== "0x0000000000000000000000000000000000000000", claimed, sender, expiry, claimTokenHash: hash }; },
    getCode: (a) => codeOf(a),
    async getNonce(a) { return BigInt(await rpc("eth_getTransactionCount", [a, "latest"])); },
    async getTimestamp() { return BigInt(await chainNow()); },
    async simulate({ from, to, data, value, stateOverride }) { const call0 = { from, to, data, value: toHex(value ?? 0n) }; const ov = stateOverride ? Object.fromEntries(Object.entries(stateOverride).map(([a, o]) => [a, o])) : undefined; return rpc("eth_call", ov ? [call0, "latest", ov] : [call0, "latest"]); },
    async waitBlockAfter(n) { await rpc("evm_mine"); for (let i = 0; i < 20; i += 1) { if (parseInt((await rpc("eth_getBlockByNumber", ["latest", false])).number, 16) > Number(n)) return; await rpc("evm_mine"); await sleep(100); } throw new Error("no block after"); },
  };
  const sponsor = {
    address: sponsorKey.address,
    async send({ kind, to, data, value, authorizationList }) {
      const r = await sendTx(sponsorKey, kind === "install" ? { type: "eip7702", to, data, value, authorizationList } : { to, data, value }, `relayer_${kind}`);
      return { txHash: r.hash, blockNumber: r.block, status: r.status === "0x1" ? "success" : "reverted" };
    },
  };
  const service = createGiftSponsorService({ ledger: openGiftSponsorLedger(null), policy, chain: relayerChain, sponsor });

  // ── app side: REAL session with REAL pins against the fork's on-chain code ──
  const salt = toHex(crypto.randomBytes(32));
  const commitHash = sponsorCommitHash({ recipient: piggy.address, preimage: token, salt });
  const CFG = { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: sponsorKey.address, expirySeconds: EXPIRY_APP };
  const nowSec = await chainNow();
  let signs = 0;
  const account = { address: piggy.address, signAuthorization: (a) => { signs += 1; return piggy.signAuthorization(a); }, signTypedData: (t) => { signs += 1; return piggy.signTypedData(t); } };
  const session = createGiftSponsorSession({ config: CFG, giftId, commitHash, account, authNonce: 0, now: () => nowSec, readCode: (address) => codeOf(address) });
  assert.ok(session);
  assert.equal((await session.signAuthorization()).ok, true, "pinned 143 code hashes match the fork");
  assert.equal((await session.signDelegation()).ok, true);
  const built = await session.buildRequest({ claim: { recipient: piggy.address, preimage: token, salt, deadline: deadline.toString(10) } });
  assert.equal(built.ok, true, built.reason);
  const wire = () => JSON.parse(JSON.stringify(built.request));
  const mon0 = await monOf(piggy.address); const usdc0 = await usdcOf(piggy.address); const sponsorMon0 = await monOf(sponsorKey.address);
  assert.equal(mon0, 0n);

  await check("app: Piggy signed exactly twice (one Face ID step) and holds 0 MON", () => { assert.equal(signs, 2); });
  await check("executor exception shape (A-913 B): the 143 brand passes SIGN_GUARD only on a 143 tx; on a 10143 tx it is refused", () => {
    const list = toExecutorAuthorizationList(built.request);
    const prepared = { chainId: 10143, type: "eip7702", nonce: 1, gas: 400_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, to: GIFT_SPONSOR_PINS.delegationManager, value: 0n, authorizationList: list };
    // pre-A-913 baseline: both were "chain_id_mismatch" (SIGN_GUARD 10143 only). A-913 B: the brand type-4 on 143 is allowed; 10143-tx with the 143 brand stays refused.
    assert.equal(preparedSignProblem(prepared), "chain_id_mismatch");
    assert.equal(preparedSignProblem({ ...prepared, chainId: 143, data: giftSponsorRedeemData(list) }), null);
  });

  // ── tampered requests: refused before ANY send (app guards and relayer service), counted on the anvil ──
  const ctx = { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: sponsorKey.address, expirySeconds: EXPIRY_APP, nowSeconds: nowSec, delegator: piggy.address, authNonce: 0, requireClaim: true };
  const mut = (f) => { const r = wire(); f(r); return r; };
  const tampers = [
    ["chainId 0", (r) => { r.authorization.chainId = 0; }],
    ["chainId 10143", (r) => { r.authorization.chainId = 10143; }],
    ["foreign delegate", (r) => { r.authorization.address = sponsorKey.address; }],
    ["delegate != sponsor", (r) => { r.delegation.delegate = giver.address; }],
    ["target (USDC instead of escrow)", (r) => { r.delegation.caveats[0].terms = buildExactExecutionTerms({ escrowAddress: USDC, giftId, commitHash }); }],
    ["calldata (other commitHash)", (r) => { r.delegation.caveats[0].terms = buildExactExecutionTerms({ escrowAddress: ESCROW, giftId, commitHash: `0x${"11".repeat(32)}` }); }],
    ["calldata (claim salt changed)", (r) => { r.claim.salt = `0x${"22".repeat(32)}`; }],
    ["expiry in the past", (r) => { r.delegation.caveats[2].terms = buildTimestampTerms({ beforeSeconds: nowSec - 5 }); }],
    ["expiry beyond cap", (r) => { r.delegation.caveats[2].terms = buildTimestampTerms({ beforeSeconds: nowSec + 10 * EXPIRY_RELAYER_CAP }); }],
    ["tampered signature", (r) => { r.delegation.signature = `0x${"1b".repeat(65)}`; }],
  ];
  await check("tampered chainId/delegate/target/calldata/expiry: refused by the app guards AND by the relayer service with 0 sends", async () => {
    const before = sends.count; const results = [];
    for (const [name, f] of tampers) {
      const appOk = (await validateGiftSponsorRequest(mut(f), ctx)).ok;
      const relay = await service.handle(mut(f));
      results.push({ name, app_refused: !appOk, relayer_status: relay.status });
      assert.equal(appOk, false, `app accepted: ${name}`);
      assert.notEqual(relay.status, 200, `relayer accepted: ${name}`);
      assert.ok([400, 409, 503].includes(relay.status), name);
    }
    RAW.tamper = { cases: results, sends_before: before, sends_after: sends.count };
    assert.equal(sends.count, before, "no send for any tampered request");
    assert.equal(await monOf(piggy.address), 0n);
  });

  // ── the happy path through the relayer service ──
  await check("e2e: 0-MON Piggy -> app guards -> relayer service -> redeemDelegations -> claim(): Piggy MON stays 0, Piggy USDC + gift", async () => {
    assert.equal((await validateGiftSponsorRequest(wire(), { ...ctx })).ok, true);
    const sendsBefore = sends.count;
    const out = await service.handle(wire());
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.state, "CLAIMED");
    const sentKinds = sends.labels.slice(sendsBefore);
    assert.deepEqual(sentKinds, ["relayer_install", "relayer_redeem", "relayer_claim"]);
    const mon1 = await monOf(piggy.address); const usdc1 = await usdcOf(piggy.address);
    assert.equal(mon1, 0n);
    assert.equal(usdc1 - usdc0, AMOUNT);
    const gift = await relayerChain.getGift(giftId);
    assert.equal(gift.claimed, true);
    RAW.e2e = { response: out.body, piggy_mon_before: mon0.toString(), piggy_mon_after: mon1.toString(), piggy_usdc_delta: (usdc1 - usdc0).toString(), sponsor_mon_spent_wei: (sponsorMon0 - await monOf(sponsorKey.address)).toString(), sends: sentKinds, piggy_code_after: await codeOf(piggy.address), signs };
  });
  await check("replay: the same request again is refused (ledger + claimed) with 0 further sends", async () => {
    const before = sends.count;
    const r = await service.handle(wire());
    assert.equal(r.status, 409);
    assert.equal(sends.count, before);
    RAW.replay = { status: r.status, sends_after: sends.count };
  });
  RAW.sends = { total_to_loopback_anvil: sends.count, labels: sends.labels };
  RAW.upstream_proxy = { forwarded: proxy.forwarded, refused: proxy.refused, note: "send-like methods are not in READ_ALLOW; every eth_sendRawTransaction went to loopback anvil only" };
  console.log(`\nA-906 fork e2e (app + relayer): ${pass} PASS${code ? " · FAIL present" : ""}`);
} catch (e) {
  console.log(`FAIL  fork setup: ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`);
  RAW.error = String(e?.message || e).slice(0, 400);
  code = 1;
} finally {
  try { anvil?.kill("SIGTERM"); } catch {}
  try { proxySrv?.close(); } catch {}
  RAW.exit = code;
  try { mkdirSync(RAW_DIR, { recursive: true }); writeFileSync(new URL("fork_e2e.json", RAW_DIR), JSON.stringify(RAW, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n"); } catch {}
}
process.exit(code);
