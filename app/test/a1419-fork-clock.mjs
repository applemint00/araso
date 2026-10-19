// Stale fork blocks must not expire a freshly signed Gift delegation during install.
import { hashClaimToken } from "../src/gift-piggy-claim-link.js";
import { buildGiftSponsorForkRuntime, giftSponsorForkChainDef } from "../../api/_lib/gift-sponsor-runtime.js";
import { createForkGiftController } from "../../relayer/src/fork-gift-worker.mjs";
import { bindGiftToNewPiggy, createGiftSponsorClaimSubmitter } from "../src/gift-claim-entry.js";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, toHex } from "viem";

import { createPublicClient, http as viemHttp } from "viem";
import { planGiftCreate, buildGiftCreateStepCalls, confirmGiftCreateStep, registerGasDeposit } from "../src/gift-create-plan.js";
import { openGiftSponsorLedger } from "../../relayer/src/gift-sponsor-service.mjs";

const skip = (why) => { console.log(`SKIP  a1419-fork-clock — ${why}; 0 checks run`); process.exit(0); };
const ART = privatePath("ops/receipts/A935_gift_mainnet_deploy/creation_bytecode.hex");
const RAW_DIR = pathToFileURL(testOutDir("a1419-fork-clock", process.env.A1419_RAW_OUT) + "/");
if (!process.env.A913_FORK && !process.env.A913_FORK_URL) skip("not requested (run: A913_FORK=1 node app/test/a1419-fork-clock.mjs)");
if (spawnSync("anvil", ["--version"], { stdio: "ignore" }).status !== 0) skip("anvil not installed");
if (!existsSync(ART)) skip("local escrow artifact absent (public checkout)");
const probePort = await new Promise((ok) => { const sv = net.createServer(); sv.once("error", () => ok(null)); sv.listen(0, "127.0.0.1", () => { const pt = sv.address().port; sv.close(() => ok(pt)); }); });
if (probePort === null) skip("local port binding is not permitted here");

const UPSTREAM = process.env.A913_FORK_URL || "https://rpc.monad.xyz";
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
        const errs = items.map((m) => ({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32601, message: "A-913 read-only proxy refused" } }));
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(Array.isArray(pj) ? errs : errs[0])); return;
      }
      for (const m of items) proxy.forwarded[m.method] = (proxy.forwarded[m.method] || 0) + 1;
      try { const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body }); const t = await r.text(); res.writeHead(r.status, { "content-type": "application/json" }); res.end(t); }
      catch { res.writeHead(502); res.end(); }
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}
import { testOutDir } from "./helpers/test-out.mjs";
import { pathToFileURL } from "node:url";
import { privatePath } from "./helpers/private-base.mjs";

const CHAIN = 31337143;
const USDC = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
const creation = readFileSync(ART, "utf8").trim();
const EABI = { bytecode: { object: creation.startsWith("0x") ? creation : `0x${creation}` } };
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = { card: "A-1419", part: "stale fork clock", at: new Date().toISOString(), live_tx: 0, upstream: UPSTREAM.replace(/\/\/[^/@]*@/, "//"), checks: [], notes: {} };

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
  RAW.actors = { note: "fresh in-memory keys, fork-only; addresses omitted" };

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


  const publicClient = createPublicClient({ chain: giftSponsorForkChainDef(url), transport: viemHttp(url), cacheTime: 0 });
  const logs = [], sentKinds = [];
  const GAS = { gasUnits: { install: 120000n, commitClaim: 400000n, revoke: 120000n, claim: 250000n, fundingTransfer: 10000n }, feeInputs: { maxFeePerGasWei: BigInt(await rpc("eth_gasPrice")) * 2n, source: "local fork fixture" }, safety: { bufferBps: 2000 } };
  const gasUnits = { install: 120000, commit: 400000, revoke: 120000, claim: 250000 };
  const store = openGiftSponsorLedger(null);
  const sponsor = { address: sponsorKey.address, async send({ kind, to, data, value, authorizationList }, { onBroadcast } = {}) {
    assert.equal(value, 0n);
    const r = await submit(sponsorKey, { to, data, value, ...(["install", "revoke"].includes(kind) ? { type: "eip7702", authorizationList } : {}) }, kind, onBroadcast);
    sentKinds.push(kind);
    return { txHash: r.hash, blockNumber: BigInt(r.block), status: r.status === "0x1" ? "success" : "reverted" };
  } };
  const rt = buildGiftSponsorForkRuntime({ escrow: ESCROW, gasUnits, gasBufferBps: 2000, leaseSeconds: 120 }, {
    account: sponsorKey, publicClient, store, sponsor,
    log: (line) => { logs.push(line); console.log(line.replace(/0x[0-9a-f]+(?:…)?/gi, "[redacted]")); },
  });
  const instanceId = "a1419-local-only";
  const controller = createForkGiftController({ runtime: rt, instanceId, identityCheck: async () => await publicClient.getChainId() === CHAIN, intervalMs: 1000 });
  assert.equal(await rt.preflight(), true, "real fork runtime preflight");
  const expiry = (await chainNow()) + 86400;
  const plan = await planGiftCreate({ chainScope: "monad-fork", presetLabel: 20, senderAddress: sender.address, expiry, gas: GAS, sponsor: { sponsorAddress: sponsorKey.address, chainId: CHAIN } });
  assert.equal(plan.ok, true, plan.reason);
  const steps = buildGiftCreateStepCalls(plan, { escrowAddress: ESCROW });
  assert.equal(steps.ok, true, steps.reason);
  const results = [];
  for (const c of steps.calls) {
    const r = await submit(sender, { to: c.to, data: c.data, value: c.value }, "local_fixture_create");
    results.push({ status: r.status === "0x1" ? "success" : "reverted", hash: r.hash });
  }
  const confirmed = confirmGiftCreateStep(plan, results);
  assert.equal(confirmed.ok, true, confirmed.reason);
  const registration = await registerGasDeposit({ record: confirmed.record, client: { register: (body) => controller.handle({ ...body, forkInstanceId: instanceId, escrowAddress: ESCROW }) } });
  assert.equal(registration.ok, true, "real controller registration");
  await rpc("anvil_setBalance", [sponsorKey.address, toHex(10n ** 19n)]);
  const piggy = privateKeyToAccount(generatePrivateKey());
  const { binding } = bindGiftToNewPiggy({ intent: { giftId: plan.giftId, token: plan.fragment.token }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
  assert.ok(binding);
  const record = { ...confirmed.record, senderAddress: sender.address, claimTokenHash: await hashClaimToken(plan.fragment.token), expiresAt: new Date(expiry * 1000).toISOString() };
  let response;
  const signedNonces = [];
  const account = { address: piggy.address, signAuthorization: (a) => { signedNonces.push(Number(a.nonce)); return piggy.signAuthorization(a); }, signTypedData: (t) => piggy.signTypedData(t) };
  const app = createGiftSponsorClaimSubmitter({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: sponsorKey.address, expirySeconds: 300 }, chain: publicClient, chainScope: "monad-fork", sponsorClient: { submit: async (body) => {
    response = await controller.handle({ ...body, forkInstanceId: instanceId, escrowAddress: ESCROW });
    return response;
  } } });
  assert.ok(app);
  const latest = await chainNow();
  await rpc("evm_setNextBlockTimestamp", [latest + 600]);
  console.log(`CLOCK latest=${latest} pending=${Number((await rpc("eth_getBlockByNumber", ["pending", false])).timestamp)} gap=600`);
  await check("stale fork: real app -> real worker -> claim +20 USDC", async () => {
    const before = await usdcOf(piggy.address);
    const out = await app.submit({ binding, record, token: plan.fragment.token, account });
    await controller.recover();
    const gift = await rt.chain.getGift(plan.giftId);
    const delta = await usdcOf(piggy.address) - before;
    const nonce = await rt.chain.getNonce(piggy.address);
    const row = store.get(plan.giftId);
    console.log(`OBSERVED http=${response?.status ?? "none"} app=${out.status} sent=${sentKinds.join(",")} commit=${sentKinds.filter(k => k === "redeem").length} claimed=${gift.claimed} usdc_delta=${delta} nonce=${nonce} state=${row?.state ?? "none"}`);
    RAW.notes = { http: response?.status, app: out.status, sentKinds, delta: String(delta), claimed: gift.claimed, nonce: String(nonce), signedNonces };
    assert.equal(response?.status, 200, "stale fork claim must finish");
    assert.equal(gift.claimed, true);
    assert.equal(delta, AMOUNT);
    assert.deepEqual(sentKinds, ["install", "redeem", "revoke", "claim"]);
    assert.deepEqual(signedNonces, [0, 1]);
    assert.equal(nonce, 2n);
    assert.equal(await codeOf(piggy.address), "0x");
  });
  if (!code) await check("nonce 2: retry signs fresh authorizations; duplicate sends nothing", async () => {
    const sentBefore = sentKinds.length;
    await app.submit({ binding, record, token: plan.fragment.token, account });
    assert.deepEqual(signedNonces, [0, 1, 2, 3]);
    assert.equal(response.status, 409);
    assert.equal(sentKinds.length, sentBefore);
    assert.equal(await usdcOf(piggy.address), AMOUNT);
    console.log("NONCE retry=2 revoke=3 old_authorization_reuse=0 additional_sends=0");
  });
  await controller.drain();
  console.log(`A-1419 fork clock: ${pass} PASS ${code} FAIL; live_tx=0`);
} catch (e) {
  console.log(`FAIL setup: ${String(e?.message || e).replace(/0x[0-9a-f]+/gi, "[redacted]").slice(0, 500)}`);
  code = 1;
} finally {
  try { anvil?.kill("SIGTERM"); } catch {}
  try { proxySrv?.close(); } catch {}
  RAW.exit = code;
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(new URL("fork_e2e.json", RAW_DIR), JSON.stringify(RAW, (_k, v) => typeof v === "bigint" ? String(v) : v, 2));
}
process.exit(code);
