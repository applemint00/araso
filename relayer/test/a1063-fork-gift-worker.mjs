import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createPublicClient, encodeAbiParameters, http as rpcHttp } from "viem";
import { forkGiftWorkerEnv, createForkGiftController, forkJournalInspector, createForkGiftHttpHandler, forkGiftRpcTransport } from "../src/fork-gift-worker.mjs";
import { auditForkJournal } from "../src/fork-gift-state.mjs";
import { createForkGiftProxy, drainForkBeforeSnapshot } from "../src/fork-gift-front.mjs";

const escrow = `0x${"12".repeat(20)}`, instanceId = "fork-143-test";
assert.throws(() => forkGiftWorkerEnv({ GIFT_SPONSOR_PRIVATE_KEY: "forbidden" }, "/data", instanceId), /MAINNET_KEY_FORBIDDEN/);
const env = forkGiftWorkerEnv({ PATH: "/bin", ADMIN_TOKEN: "not-in-worker", ADMIN_HMAC_SECRET: "not-in-worker", GIFT_SPONSOR_FORK_RPC_URL: "https://wrong", GIFT_SPONSOR_FORK_INSTANCE_ID: "wrong" }, "/data", instanceId);
assert.equal(env.ADMIN_TOKEN, undefined); assert.equal(env.ADMIN_HMAC_SECRET, undefined);
assert.equal(env.GIFT_SPONSOR_FORK_INSTANCE_ID, instanceId); assert.equal(env.GIFT_SPONSOR_FORK_RPC_URL, "http://127.0.0.1:18549");
const calls = [], events = []; let sameInstance = true, onTick, release;
const runtime = { policy: { escrow }, preflight: async () => true, store: { close: () => events.push("closed") }, service: {
  register: async (body) => { calls.push(["register", body]); return { status: 200, body: { ok: true } }; },
  handle: async (body) => { calls.push(["claim-revoke", body]); return { status: 200, body: { ok: true } }; },
  runExclusive: async (fn) => { events.push("queue"); return fn(); },
}, reconciler: { run: async () => { calls.push(["reconcile"]); if (release !== undefined) await new Promise((r) => { release = r; }); return { results: [], remaining: [] }; } } };
const controller = createForkGiftController({ runtime, instanceId, identityCheck: async () => sameInstance, intervalMs: 1000,
  setTimer: (fn) => { onTick = fn; return { unref() {} }; }, clearTimer: () => events.push("timer-stopped") });
const meta = { forkInstanceId: instanceId, escrowAddress: escrow };
const claim = { ...meta, authorization: { chainId: 31337143 }, revokeAuthorization: { chainId: 31337143 } };
assert.equal((await controller.handle({ ...meta, action: "register_gas_tx" })).status, 200);
assert.equal((await controller.handle(claim)).status, 200);
assert.equal(calls[0][1].forkInstanceId, undefined); assert.equal(calls[1][1].escrowAddress, undefined);
for (const patch of [{ escrowAddress: `0x${"13".repeat(20)}` }, { forkInstanceId: "other" }, { authorization: { chainId: 143 } }, { revokeAuthorization: { chainId: 0 } }]) assert.equal((await controller.handle({ ...claim, ...patch })).status, 400);
assert.equal(calls.length, 2);
controller.start(); await onTick(); await new Promise(setImmediate);
assert.equal(calls[2][0], "reconcile");

const worker = http.createServer(createForkGiftHttpHandler(controller, { perMinute: 5 }));
worker.listen(0, "127.0.0.1"); await once(worker, "listening");
let ready = true;
const front = http.createServer(createForkGiftProxy({ ready: () => ready, port: worker.address().port }));
front.listen(0, "127.0.0.1"); await once(front, "listening");
const base = `http://127.0.0.1:${front.address().port}`;
const ask = (pathname = "/gift-sponsor", options = {}) => fetch(base + pathname, { method: "POST", headers: { origin: "https://arasoo.vercel.app", "content-type": "application/json" }, body: JSON.stringify(claim), ...options });
try {
  assert.equal((await ask()).status, 200);
  let r = await ask("/gift-sponsor", { method: "OPTIONS", body: undefined });
  assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "https://arasoo.vercel.app");
  for (const origin of ["https://evil.example", "http://localhost:3000", "null", ""]) {
    r = await ask("/gift-sponsor", { headers: { origin } }); assert.equal(r.status, 403); assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
  assert.equal((await ask("/gift-sponsor?x=1")).status, 404);
  assert.equal((await ask("/gift-sponsor", { method: "GET", body: undefined })).status, 405);
  assert.equal((await ask("/gift-sponsor", { headers: { origin: "https://arasoo.vercel.app", "content-type": "text/plain" } })).status, 415);
  assert.equal((await ask("/gift-sponsor", { body: "x".repeat(16385) })).status, 413);
  ready = false; assert.equal((await ask()).status, 503); ready = true;
  for (let i = 0; i < 4; i++) assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 429);
} finally { front.closeAllConnections(); worker.closeAllConnections(); await Promise.all([new Promise((r) => front.close(r)), new Promise((r) => worker.close(r))]); }

release = null;
const recovering = controller.recover(); await new Promise(setImmediate);
const n = calls.length; await controller.recover(); assert.equal(calls.length, n); // no overlapping timer jobs
const draining = controller.drain(); await new Promise(setImmediate);
assert.equal(events.includes("closed"), false); assert.equal((await controller.handle(claim)).status, 503);
release(); await recovering; await draining;
assert.deepEqual(events.slice(-3), ["timer-stopped", "queue", "closed"]);
const order = [];
assert.equal(await drainForkBeforeSnapshot({ drain: async () => order.push("drain-close"), snapshot: async () => order.push("snapshot"), failClosed: async () => order.push("fail") }), true);
assert.deepEqual(order, ["drain-close", "snapshot"]);
order.length = 0;
assert.equal(await drainForkBeforeSnapshot({ drain: async () => { throw new Error("crashed"); }, snapshot: async () => order.push("snapshot"), failClosed: async () => order.push("fail") }), false);
assert.deepEqual(order, ["fail"]);
const off = createForkGiftController({ runtime, instanceId, identityCheck: async () => false, intervalMs: 1000 });
assert.equal((await off.handle(claim)).status, 503); assert.equal(off.status().needsHuman, true);
const human = createForkGiftController({ runtime: { ...runtime, reconciler: { run: async () => ({ results: [{ step: "HUMAN" }], remaining: [] }) } }, instanceId, identityCheck: async () => true, intervalMs: 1000 });
await human.recover(); assert.equal(human.status().needsHuman, true); assert.equal((await human.handle(claim)).status, 503);

let absent = false, claimed = true, receiptStatus = "success", commitHash = "matching", code = "0x";
const inspector = forkJournalInspector({
  getCode: async () => code,
  getTransactionReceipt: async () => { if (absent) throw Object.assign(new Error(), { name: "TransactionReceiptNotFoundError" }); return { blockNumber: 9n, blockHash: "canonical", status: receiptStatus }; },
  getBlock: async () => ({ hash: "canonical" }), readContract: async ({ functionName }) => functionName === "commits" ? [commitHash, 9n] : [null, null, null, null, claimed],
}, escrow);
const row = { giftId: "fixture", state: "CLAIMED", plan: {}, claimTx: "tx" };
assert.equal(await inspector(row), "ok"); claimed = false; assert.equal(await inspector(row), "unknown");
absent = true; assert.equal(await inspector(row), "absent");
assert.equal(await inspector({ state: "UNKNOWN", plan: {}, inflight: { txHash: null } }), "unknown");
absent = false; receiptStatus = "reverted";
assert.equal(await inspector({ registrationTx: "tx" }), "unknown");
receiptStatus = "success"; claimed = false;
const committed = { state: "COMMITTED", commitTx: "tx", plan: { delegation: { delegator: escrow }, commitHash: "matching" } };
assert.equal(await inspector(committed), "ok"); commitHash = "absent-effect";
assert.equal(await inspector(committed), "unknown");
const installed = { state: "INSTALLED", installTx: "tx", plan: { delegation: { delegator: escrow }, authorization: { address: escrow } } };
assert.equal(await inspector(installed), "unknown"); code = `0xef0100${escrow.slice(2)}`;
assert.equal(await inspector(installed), "ok");
assert.equal(await inspector({ ...installed, state: "REVOKED" }), "unknown"); code = "0x";
assert.equal(await inspector({ ...installed, state: "REVOKED" }), "ok");
console.log("PASS a1063 worker: same runtime routing, metadata binding, 143/0 refusal, periodic recovery, drain ordering, HTTP/CORS/OPTIONS/rate/body bounds, restored terminal receipt");

// Real loopback HTTP + installed viem; virtual time makes 100-row quotas deterministic.
// No chain, signer, Guard config changes or spoofed client-IP headers.
let clock = 0, mode = "quota", attempts = [], rejected = 0;
const epoch = Date.UTC(2026, 9, 12), hash = `0x${"ab".repeat(32)}`;
const clockOptions = { now: () => clock, wallNow: () => epoch + clock, sleep: async (ms) => { clock += ms; } };
const giftResult = encodeAbiParameters([
  { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bytes32" },
], [escrow, escrow, 1n, 1n, true, hash]);
const guard = http.createServer(async (req, res) => {
  assert.equal(req.headers["cf-connecting-ip"], undefined);
  assert.equal(req.headers["x-forwarded-for"], undefined);
  let body = ""; for await (const chunk of req) body += chunk;
  const rpc = JSON.parse(body); attempts.push(clock);
  const second = attempts.filter((t) => Math.floor(t / 1000) === Math.floor(clock / 1000)).length;
  const minute = attempts.filter((t) => Math.floor(t / 60000) === Math.floor(clock / 60000)).length;
  const limited = mode === "always429" || mode === "long" || mode === "huge"
    || mode === "quota" && (second > 20 || minute > 600)
    || ["seconds", "date", "missing", "malformed", "zero"].includes(mode) && attempts.length <= 2;
  if (limited) {
    rejected++;
    const retry = { seconds: "2", date: new Date(epoch + clock + 2000).toUTCString(), long: "61", huge: "9".repeat(400), malformed: "invalid", zero: "0" }[mode] ?? "1";
    res.writeHead(429, { "content-type": "application/json", ...(mode === "missing" ? {} : { "retry-after": retry }) });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "quota" } })); return;
  }
  res.writeHead(mode === "500" ? 500 : 200, { "content-type": "application/json" });
  if (mode === "500") { res.end(JSON.stringify({ error: "upstream failure" })); return; }
  if (mode === "rpcError") { res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "execution error" } })); return; }
  const result = rpc.method === "eth_getTransactionReceipt" ? { blockNumber: "0x9", blockHash: hash, status: "0x1", logs: [], gasUsed: "0x1", cumulativeGasUsed: "0x1", type: "0x0" }
    : rpc.method === "eth_getBlockByNumber" ? { number: "0x9", hash, transactions: [] }
    : rpc.method === "eth_call" ? giftResult : "0x1de2977";
  res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
});
guard.listen(0, "127.0.0.1"); await once(guard, "listening");
const guardUrl = `http://127.0.0.1:${guard.address().port}`;
const checkpoint = { forkInstanceId: instanceId, block: 9, snapshotHash: "fixture" };
const rows = Array.from({ length: 100 }, (_, i) => ({ giftId: `0x${i.toString(16).padStart(64, "0")}`, state: "CLAIMED", plan: {}, installTx: hash, commitTx: hash, claimTx: hash }));
const journal = { entries: Object.fromEntries(rows.slice(0, 50).map((r) => [r.giftId, r])), archived: rows.slice(50), gasTxs: {}, forkCheckpoint: checkpoint };
const reset = (nextMode) => { clock = 0; attempts = []; rejected = 0; mode = nextMode; };
const paced = () => createPublicClient({ transport: forkGiftRpcTransport(guardUrl, clockOptions) });
try {
  const unpaced = createPublicClient({ transport: rpcHttp(guardUrl, { retryCount: 0 }) });
  assert.equal((await auditForkJournal(journal, checkpoint, forkJournalInspector(unpaced, escrow))).needsHuman, true);
  assert.ok(rejected > 0, "B1 reproduced without pacing");
  reset("quota");
  const audit = await auditForkJournal(journal, checkpoint, forkJournalInspector(paced(), escrow));
  assert.equal(audit.needsHuman, false); assert.deepEqual(audit.findings, []);
  // Three receipt+block pairs, CLAIMED receipt recheck, then gifts() = eight per row.
  assert.equal(attempts.length, 800); assert.equal(rejected, 0);
  assert.ok(clock > 60000, "minute quota is exercised too");
  for (let i = 1; i < attempts.length; i++) assert.ok(attempts[i] - attempts[i - 1] >= 110);
  reset("quota");
  const concurrent = paced(); await Promise.all(Array.from({ length: 30 }, () => concurrent.request({ method: "eth_chainId" })));
  assert.equal(attempts.length, 30); assert.equal(rejected, 0);
  for (let i = 1; i < attempts.length; i++) assert.ok(attempts[i] - attempts[i - 1] >= 110);
  for (const retryMode of ["seconds", "date", "missing", "malformed", "zero"]) {
    reset(retryMode); await paced().request({ method: "eth_chainId" });
    const wait = ["seconds", "date"].includes(retryMode) ? 2000 : retryMode === "zero" ? 110 : 1000;
    assert.deepEqual(attempts, [0, wait, 2 * wait]);
  }
  reset("always429");
  const failed = paced();
  const failedAudit = await auditForkJournal({ ...journal, entries: { one: rows[0] }, archived: [] }, checkpoint, forkJournalInspector(failed, escrow));
  assert.equal(failedAudit.needsHuman, true); assert.equal(failedAudit.findings[0].reason, "chain_read_unknown");
  assert.deepEqual(attempts, [0, 1000, 2000, 3000]); // initial + three retries only
  mode = "quota"; await failed.request({ method: "eth_chainId" }); // failed request does not poison queue
  for (const noRetry of ["long", "huge", "500", "rpcError"]) {
    reset(noRetry); await assert.rejects(paced().request({ method: "eth_sendRawTransaction", params: ["0x"] }));
    assert.equal(attempts.length, 1, `${noRetry}: no early retry / ambiguous send replay`);
  }
  let networkAttempts = 0;
  const disconnected = createPublicClient({ transport: forkGiftRpcTransport(guardUrl, { ...clockOptions, fetchFn: async () => { networkAttempts++; throw new Error("network lost"); } }) });
  await assert.rejects(disconnected.request({ method: "eth_sendRawTransaction", params: ["0x"] }));
  assert.equal(networkAttempts, 1);
  // Exercise the production monotonic clock + real timer as well as virtual quota time.
  const realStarts = [];
  const realClock = createPublicClient({ transport: forkGiftRpcTransport(guardUrl, { fetchFn: async (_url, options) => {
    realStarts.push(performance.now());
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(options.body).id, result: "0x1" }), { headers: { "content-type": "application/json" } });
  } }) });
  await Promise.all(Array.from({ length: 3 }, () => realClock.request({ method: "eth_chainId" })));
  assert.equal(realStarts.length, 3);
  for (let i = 1; i < realStarts.length; i++) assert.ok(realStarts[i] - realStarts[i - 1] >= 100, "real timer <=10 requests/s");
  assert.match(readFileSync(new URL("../src/fork-gift-worker.mjs", import.meta.url), "utf8"), /transport: forkGiftRpcTransport\(cfg\.rpcUrl\)/);
  console.log("PASS a1063 B1: unpaced RED; 100-row/800-RPC HTTP audit needsHuman=0, 20/s+600/min quotas, concurrent pacing, bounded 429 seconds/date/fallback, exhaustion OFF, non-429 sends not retried");
} finally { guard.closeAllConnections(); await new Promise((resolve) => guard.close(resolve)); }
