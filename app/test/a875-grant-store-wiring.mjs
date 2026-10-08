// [A-875] /api/grant ↔ A-870 grant store contract wiring — offline. Network 0, real key 0, tx 0.
// globalThis.fetch is replaced by an in-memory JSON-RPC stub BEFORE api/grant.js is imported (a785/a792 pattern).
// The store is the A-870 synthetic atomic adapter (api/_lib/grant-store-contract.js, testOnly): several handler
// instances share ONE synthetic "remote", which stands in for a durable backend with server-side atomic CAS.
//
// Proves:
//   D  default-off: production default export (enabled) → 503 grant store unavailable, 0 RPC; registry empty+frozen;
//      production build acceptance requires the full A-870 shape (reserve/settle/release/reconcile) and refuses testOnly
//   E  epoch: reserve+settle carry policy.epoch; same address once per epoch; a new epoch is code-only (re-arm);
//      invalid epoch → 503 with 0 RPC
//   C  cap: explicit cap race across instances; default cap = allowlist size (dedup); cap is per epoch
//   R  race: N concurrent duplicates across instances → exactly one 200 + one broadcast, rest legacy 403
//   P  public path: release/reconcile never called by the handler; body cannot carry epoch/release/reconcile (400);
//      source has no release/reconcile call
//   S  settle evidence: post-send outcomes carry broadcast:true → A-870 decideRelease refuses release;
//      pre-send abort stays releasable only through the operator (store) path, never the handler
//   L  legacy compatibility: duplicate → exact 403 {ok:false,error:"already funded"}; balance-based 403 unchanged;
//      A-792 v1 local test store still works (epoch "default" passed); 0.1 MON unchanged

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";

// ---- RPC stub ----------------------------------------------------------------------------------------
const STUB_RPC = "http://a875-stub-rpc.invalid";
process.env.MONAD_RPC_URL = STUB_RPC;
const KEY = generatePrivateKey();
const RELAYER = privateKeyToAccount(KEY).address;

const rpcLog = [];
const balances = new Map();
balances.set(RELAYER.toLowerCase(), 10n ** 21n);
const receipts = new Map();
let nonce = 0;
let failSend = false;
let failBalance = false;
const hex = (n) => `0x${BigInt(n).toString(16)}`;

globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(STUB_RPC)) throw new Error(`a875: unexpected network call to ${url}`);
  const payload = JSON.parse(init.body);
  const one = (req) => {
    try {
      return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? []) };
    } catch (e) {
      return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: String(e.message) } };
    }
  };
  const out = Array.isArray(payload) ? payload.map(one) : one(payload);
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

let grantWei = 0n;
function answer(method, params) {
  rpcLog.push(method);
  if (failBalance && method === "eth_getBalance") throw new Error("stub: balance read down");
  switch (method) {
    case "eth_chainId": return hex(10143);
    case "eth_getBalance": return hex(balances.get(params[0].toLowerCase()) ?? 0n);
    case "eth_getTransactionCount": return hex(nonce);
    case "eth_blockNumber": return hex(100);
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas": return hex(1_000_000_000);
    case "eth_estimateGas": return hex(21000);
    case "eth_getBlockByNumber":
      return { number: hex(100), hash: `0x${"ab".repeat(32)}`, baseFeePerGas: hex(1_000_000_000), timestamp: hex(1), transactions: [], gasLimit: hex(30_000_000), gasUsed: "0x0" };
    case "eth_sendRawTransaction": {
      if (failSend) throw new Error("stub: send rejected");
      const tx = parseTransaction(params[0]);
      const to = tx.to.toLowerCase();
      const hash = keccak256(params[0]);
      nonce += 1;
      balances.set(to, (balances.get(to) ?? 0n) + grantWei);
      receipts.set(hash, to);
      return hash;
    }
    case "eth_getTransactionReceipt": {
      const hash = params[0];
      if (!receipts.has(hash)) return null;
      return {
        transactionHash: hash, status: "0x1", blockNumber: hex(100), blockHash: `0x${"ab".repeat(32)}`, transactionIndex: "0x0",
        from: RELAYER, to: receipts.get(hash), cumulativeGasUsed: hex(21000), gasUsed: hex(21000), effectiveGasPrice: hex(1), logs: [],
        logsBloom: `0x${"00".repeat(256)}`, type: "0x2", contractAddress: null,
      };
    }
    case "eth_getTransactionByHash": return null;
    default: throw new Error(`a875 stub: unhandled ${method}`);
  }
}

// ---- load ------------------------------------------------------------------------------------------
const mod = await import("../../api/grant.js");
const {
  createGrantHandler, normalizeGrantPolicy, acceptProductionGrantStoreBuild, resolveProductionGrantStore,
  GRANT_STORE_CONTRACT, GRANT_DEFAULT_EPOCH, GRANT_ENABLE_ENV, GRANT_STORE_ENV, DURABLE_GRANT_STORE_BACKENDS,
} = mod;
const C = await import("../../api/_lib/grant-store-contract.js");
const { GRANT_WEI } = await import("../../relayer/src/policy.mjs");
grantWei = GRANT_WEI;
const { createLocalTestGrantStore } = await import("./helpers/grant-local-test-store.mjs");

let passed = 0;
const allResponses = [];
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}
function makeRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(p) { this.body = p ? JSON.parse(p) : null; },
  };
}
const ARASO_HEADERS = Object.freeze({
  "content-type": "application/json",
  origin: "https://arasoo.vercel.app",
  "sec-fetch-site": "same-origin",
  host: "arasoo.vercel.app",
});
async function callWith(h, { headers = ARASO_HEADERS, body } = {}) {
  const res = makeRes();
  await h({ method: "POST", headers, body, async *[Symbol.asyncIterator]() {} }, res);
  allResponses.push(res);
  return res;
}
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const sends = (from) => rpcLog.slice(from).filter((m) => m === "eth_sendRawTransaction").length;

// Spy wrapper: counts every store method the handler calls. release/reconcile must stay at 0.
const calls = { reserve: [], settle: [], release: 0, reconcile: 0 };
function spied(inst) {
  return {
    contract: inst.contract,
    testOnly: inst.testOnly,
    async reserve(a) { calls.reserve.push(a); return inst.reserve(a); },
    async settle(a) { calls.settle.push(a); return inst.settle(a); },
    async release(a) { calls.release += 1; return inst.release(a); },
    async reconcile(a) { calls.reconcile += 1; return inst.reconcile(a); },
  };
}
// N handler instances over ONE shared synthetic remote (= one durable backend, many serverless instances).
// `operator` is a separate store instance on the same remote: the only place release() is ever called.
function cluster(n, policy, { yieldMs = 0 } = {}) {
  const remote = C.createSyntheticRemote();
  const handlers = Array.from({ length: n }, () => createGrantHandler({ store: spied(C.createSyntheticStoreInstance(remote, { yieldMs })), policy }));
  return { remote, handlers, operator: C.createSyntheticStoreInstance(remote) };
}
const row = (remote, epoch, address) => remote.rows.get(`${epoch}\u0000${address.toLowerCase()}`) ?? null;

process.env.RELAYER_PRIVATE_KEY = KEY;
delete process.env[GRANT_STORE_ENV];
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;
process.env[GRANT_ENABLE_ENV] = "1";

// ---- D: default-off ----------------------------------------------------------------------------------
await check("D production default export, enabled, no backend → 503 grant store unavailable, 0 RPC", async () => {
  const m = rpcLog.length;
  const res = await callWith(mod.default, { body: { address: fresh() } });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: "grant store unavailable" });
  assert.equal(rpcLog.length, m);
});
await check("D backend registry empty + frozen; every ARASO_GRANT_STORE value (incl. synthetic/memory/__proto__) → 503, 0 RPC", async () => {
  assert.equal(Object.keys(DURABLE_GRANT_STORE_BACKENDS).length, 0);
  assert.equal(Object.isFrozen(DURABLE_GRANT_STORE_BACKENDS), true);
  const m = rpcLog.length;
  try {
    for (const v of ["synthetic", "memory", "local-test-memory", "__proto__", "constructor", "default"]) {
      process.env[GRANT_STORE_ENV] = v;
      assert.equal(resolveProductionGrantStore(process.env).ok, false, v);
      const res = await callWith(mod.default, { body: { address: fresh() } });
      assert.equal(res.statusCode, 503, v);
      assert.equal(res.body.error, "grant store unavailable", v);
    }
  } finally { delete process.env[GRANT_STORE_ENV]; }
  assert.equal(rpcLog.length, m);
});
await check("D production build acceptance: full A-870 shape required, testOnly refused, invalid policy refused", async () => {
  const synth = C.createSyntheticStoreInstance(C.createSyntheticRemote());
  const full = { ...synth, testOnly: false };
  const v1Only = { contract: GRANT_STORE_CONTRACT, reserve: synth.reserve, settle: synth.settle };
  const okPolicy = { globalCap: 3 };
  assert.equal(acceptProductionGrantStoreBuild({ store: full, policy: okPolicy }).ok, true);
  assert.equal(acceptProductionGrantStoreBuild({ store: synth, policy: okPolicy }).ok, false, "testOnly");
  assert.equal(acceptProductionGrantStoreBuild({ store: v1Only, policy: okPolicy }).ok, false, "v1 reserve/settle only");
  assert.equal(acceptProductionGrantStoreBuild({ store: { ...full, release: undefined }, policy: okPolicy }).ok, false, "no release");
  assert.equal(acceptProductionGrantStoreBuild({ store: { ...full, reconcile: 1 }, policy: okPolicy }).ok, false, "no reconcile");
  assert.equal(acceptProductionGrantStoreBuild({ store: { ...full, contract: "araso.grant-store/v0" }, policy: okPolicy }).ok, false, "wrong contract");
  assert.equal(acceptProductionGrantStoreBuild({ store: full, policy: {} }).ok, false, "no cap, no allowlist");
  assert.equal(acceptProductionGrantStoreBuild({ store: full, policy: { globalCap: 3, epoch: "bad epoch!" } }).ok, false, "bad epoch");
  assert.equal(acceptProductionGrantStoreBuild(null).ok, false);
  assert.equal(acceptProductionGrantStoreBuild(undefined).ok, false);
  const a = acceptProductionGrantStoreBuild({ store: full, policy: { allowlist: [fresh(), fresh()], epoch: "t1" } });
  assert.equal(a.ok, true);
  assert.equal(a.policy.globalCap, 2);
  assert.equal(a.policy.capSource, "allowlist_size");
  assert.equal(a.policy.epoch, "t1");
});

// ---- policy: epoch + default cap hooks ---------------------------------------------------------------
await check("E/C normalizeGrantPolicy: epoch default/valid/invalid; default cap = allowlist size (dedup, any case); no silent cap", async () => {
  const a = fresh(), b = fresh();
  const p0 = normalizeGrantPolicy({ globalCap: 5 });
  assert.equal(GRANT_DEFAULT_EPOCH, "default");
  assert.equal(p0.epoch, GRANT_DEFAULT_EPOCH);
  assert.equal(p0.globalCap, 5);
  assert.equal(p0.capSource, "explicit");
  const p1 = normalizeGrantPolicy({ allowlist: [a, a.toLowerCase(), b], epoch: "test-2026-10.a:1" });
  assert.equal(p1.globalCap, 2);
  assert.equal(p1.capSource, "allowlist_size");
  assert.equal(p1.epoch, "test-2026-10.a:1");
  assert.equal(normalizeGrantPolicy({ globalCap: 7, allowlist: [a] }).globalCap, 7, "explicit cap kept (A-792 compatible)");
  for (const [p, label] of [
    [{}, "no cap, no allowlist"],
    [{ allowlist: null }, "allowlist off, no cap"],
    [{ allowlist: [] }, "empty allowlist → default cap 0"],
    [{ allowlist: [a, "0xnope"] }, "bad allowlist entry"],
    [{ globalCap: 5, epoch: "" }, "empty epoch"],
    [{ globalCap: 5, epoch: "bad epoch!" }, "space in epoch"],
    [{ globalCap: 5, epoch: "x".repeat(65) }, "epoch too long"],
    [{ globalCap: 5, epoch: 1 }, "numeric epoch"],
    [{ globalCap: 5, epoch: null }, "null epoch"],
    [{ globalCap: 0, allowlist: [a] }, "explicit cap 0"],
    [{ globalCap: null, allowlist: [a] }, "explicit null cap is not 'absent'"],
  ]) assert.equal(normalizeGrantPolicy(p), null, label);
});
await check("E invalid epoch / empty-allowlist default cap / no cap injected → 503 grant store unavailable, 0 RPC, no reserve", async () => {
  for (const policy of [{ globalCap: 5, epoch: "bad epoch!" }, { allowlist: [] }, {}]) {
    const { handlers } = cluster(1, policy);
    const before = calls.reserve.length;
    const m = rpcLog.length;
    const res = await callWith(handlers[0], { body: { address: fresh() } });
    assert.equal(res.statusCode, 503, JSON.stringify(policy));
    assert.equal(res.body.error, "grant store unavailable");
    assert.equal(rpcLog.length, m);
    assert.equal(calls.reserve.length, before);
  }
});

// ---- R: race through the handler over a shared synthetic remote --------------------------------------
for (const yieldMs of [0, 1]) {
  await check(`R 20 concurrent requests for one address across 4 instances (yield ${yieldMs}ms) → exactly one 200, 19× legacy 403, one broadcast`, async () => {
    const { remote, handlers } = cluster(4, { globalCap: 100, epoch: "r1" }, { yieldMs });
    const addr = fresh();
    const m = rpcLog.length;
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => callWith(handlers[i % 4], { body: { address: addr } })));
    assert.equal(out.filter((r) => r.statusCode === 200).length, 1);
    const dups = out.filter((r) => r.statusCode === 403);
    assert.equal(dups.length, 19);
    for (const r of dups) assert.deepEqual(r.body, { ok: false, error: "already funded" });
    assert.equal(sends(m), 1);
    const r = row(remote, "r1", addr);
    assert.equal(r.outcome, "confirmed");
    assert.equal(r.broadcast, true);
    assert.match(r.txHash, /^0x[0-9a-f]{64}$/);
  });
}

// ---- C: cap ----------------------------------------------------------------------------------------
await check("C explicit cap race: 12 distinct addresses across 3 instances, cap 4 → exactly 4× 200 / 4 broadcasts, 8× 503 grant cap reached", async () => {
  const { handlers } = cluster(3, { globalCap: 4, epoch: "c1" }, { yieldMs: 1 });
  const m = rpcLog.length;
  const out = await Promise.all(Array.from({ length: 12 }, (_, i) => callWith(handlers[i % 3], { body: { address: fresh() } })));
  assert.equal(out.filter((r) => r.statusCode === 200).length, 4);
  const capped = out.filter((r) => r.statusCode === 503);
  assert.equal(capped.length, 8);
  for (const r of capped) assert.deepEqual(r.body, { ok: false, error: "grant cap reached" });
  assert.equal(sends(m), 4);
});
await check("C default cap = allowlist size: 3 members (one listed twice, mixed case) → cap 3; members race with dup copies → 3 grants; outsider 403 not allowlisted, 0 RPC", async () => {
  const [a, b, c] = [fresh(), fresh(), fresh()];
  const { remote, handlers } = cluster(3, { allowlist: [a, a.toLowerCase(), b, c], epoch: "c2" }, { yieldMs: 1 });
  const m = rpcLog.length;
  const out = await Promise.all([a, b, c, a, b, c, a].map((x, i) => callWith(handlers[i % 3], { body: { address: x } })));
  assert.equal(out.filter((r) => r.statusCode === 200).length, 3);
  assert.equal(out.filter((r) => r.statusCode === 403 && r.body.error === "already funded").length, 4);
  assert.equal(sends(m), 3);
  let n = 0;
  for (const r of remote.rows.values()) if (r.epoch === "c2") n += 1;
  assert.equal(n, 3);
  const m2 = rpcLog.length;
  const outsider = await callWith(handlers[0], { body: { address: fresh() } });
  assert.deepEqual([outsider.statusCode, outsider.body.error], [403, "not allowlisted"]);
  assert.equal(rpcLog.length, m2);
});
await check("C explicit cap below allowlist size binds: allowlist 3, cap 2 → third member 503 grant cap reached", async () => {
  const [a, b, c] = [fresh(), fresh(), fresh()];
  const { handlers } = cluster(2, { globalCap: 2, allowlist: [a, b, c], epoch: "c3" });
  assert.equal((await callWith(handlers[0], { body: { address: a } })).statusCode, 200);
  assert.equal((await callWith(handlers[1], { body: { address: b } })).statusCode, 200);
  const r3 = await callWith(handlers[0], { body: { address: c } });
  assert.deepEqual([r3.statusCode, r3.body.error], [503, "grant cap reached"]);
});
await check("C cap is per epoch: e1 cap 2 full → e1 503; code-built handler on epoch e2 (operator re-arm) has its own cap 2", async () => {
  const remote = C.createSyntheticRemote();
  const h = (epoch) => createGrantHandler({ store: spied(C.createSyntheticStoreInstance(remote)), policy: { globalCap: 2, epoch } });
  const e1 = h("e1");
  assert.equal((await callWith(e1, { body: { address: fresh() } })).statusCode, 200);
  assert.equal((await callWith(e1, { body: { address: fresh() } })).statusCode, 200);
  assert.equal((await callWith(e1, { body: { address: fresh() } })).body.error, "grant cap reached");
  const e2 = h("e2");
  assert.equal((await callWith(e2, { body: { address: fresh() } })).statusCode, 200);
  assert.equal((await callWith(e2, { body: { address: fresh() } })).statusCode, 200);
  assert.equal((await callWith(e2, { body: { address: fresh() } })).body.error, "grant cap reached");
});

// ---- E: epoch semantics through the handler ----------------------------------------------------------
await check("E reserve and settle carry the policy epoch; same address in the same epoch → legacy 403 with 0 RPC", async () => {
  const { remote, handlers } = cluster(1, { globalCap: 5, epoch: "e-a" });
  const addr = fresh();
  const r0 = calls.reserve.length, s0 = calls.settle.length;
  assert.equal((await callWith(handlers[0], { body: { address: addr } })).statusCode, 200);
  assert.deepEqual(calls.reserve[r0], { identity: addr.toLowerCase(), globalCap: 5, epoch: "e-a" });
  assert.equal(calls.settle[s0].epoch, "e-a");
  assert.equal(calls.settle[s0].broadcast, true);
  assert.equal(row(remote, "e-a", addr).outcome, "confirmed");
  const m = rpcLog.length;
  const again = await callWith(handlers[0], { body: { address: addr } });
  assert.deepEqual([again.statusCode, again.body], [403, { ok: false, error: "already funded" }]);
  assert.equal(rpcLog.length, m, "duplicate decided by the store before any RPC");
});
await check("E new epoch (code-only re-arm): same address reserves again; still holding gas → legacy balance 403 (aborted_before_send); once spent → 200", async () => {
  const remote = C.createSyntheticRemote();
  const h = (epoch) => createGrantHandler({ store: spied(C.createSyntheticStoreInstance(remote)), policy: { globalCap: 5, epoch } });
  const addr = fresh();
  assert.equal((await callWith(h("ep1"), { body: { address: addr } })).statusCode, 200);
  const m = rpcLog.length;
  const held = await callWith(h("ep2"), { body: { address: addr } });
  assert.deepEqual([held.statusCode, held.body], [403, { ok: false, error: "already funded" }]);
  assert.equal(sends(m), 0);
  assert.equal(row(remote, "ep2", addr).outcome, "aborted_before_send");
  balances.set(addr.toLowerCase(), 0n); // recipient spent the grant
  const m2 = rpcLog.length;
  assert.equal((await callWith(h("ep3"), { body: { address: addr } })).statusCode, 200);
  assert.equal(sends(m2), 1);
  assert.equal((await callWith(h("ep3"), { body: { address: addr } })).statusCode, 403);
});

// ---- P: release / reconcile / re-arm unreachable from the public request path ------------------------
await check("P body cannot carry epoch / release / reconcile / reservationId / outcome / cap / allowlist → 400 unexpected fields, no store call, 0 RPC", async () => {
  const { handlers } = cluster(1, { globalCap: 5, epoch: "p1" });
  const addr = fresh();
  const r0 = calls.reserve.length, s0 = calls.settle.length;
  const m = rpcLog.length;
  for (const extra of [
    { epoch: "attacker" }, { release: true }, { reconcile: true }, { op: "release" }, { action: "reconcile" },
    { reservationId: "r1", outcome: "aborted_before_send" }, { rearm: true }, { globalCap: 999 }, { allowlist: [addr] },
  ]) {
    const res = await callWith(handlers[0], { body: { address: addr, ...extra } });
    assert.deepEqual([res.statusCode, res.body.error], [400, "unexpected fields"], JSON.stringify(extra));
  }
  const proto = await callWith(handlers[0], { body: JSON.parse(`{"address":"${addr}","__proto__":{"epoch":"x"}}`) });
  assert.equal(proto.statusCode, 400);
  const raw = await callWith(handlers[0], { body: JSON.stringify({ address: addr, epoch: "x" }) });
  assert.equal(raw.statusCode, 400);
  assert.equal(calls.reserve.length, r0);
  assert.equal(calls.settle.length, s0);
  assert.equal(rpcLog.length, m);
});
await check("P structural: api/grant.js never calls release/reconcile and imports no test code", async () => {
  const src = readFileSync(new URL("../../api/grant.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/\.release\s*\(/.test(code), false);
  assert.equal(/\.reconcile\s*\(/.test(code), false);
  assert.equal(/\[\s*["'`](release|reconcile)["'`]\s*\]/.test(code), false);
  assert.equal(/from\s+["'][^"']*app\/test/.test(src), false);
  assert.equal(src.includes("createSyntheticStoreInstance"), false);
  assert.equal(src.includes("createSyntheticRemote"), false);
  assert.equal(src.match(/res\.end\(/g)?.length, 1);
});

// ---- S: settle evidence + operator-only release ------------------------------------------------------
await check("S send failure → 502, settle send_failed with broadcast evidence; operator release refused (broadcast_evidence); retry 403; slot still counted", async () => {
  const { remote, handlers, operator } = cluster(1, { globalCap: 1, epoch: "s1" });
  const addr = fresh();
  failSend = true;
  try {
    assert.equal((await callWith(handlers[0], { body: { address: addr } })).statusCode, 502);
  } finally { failSend = false; }
  const r = row(remote, "s1", addr);
  assert.equal(r.outcome, "send_failed");
  assert.equal(r.broadcast, true);
  assert.deepEqual(await operator.release({ identity: addr.toLowerCase(), epoch: "s1", reservationId: r.reservationId }), { ok: false, reason: "broadcast_evidence" });
  const m = rpcLog.length;
  const again = await callWith(handlers[0], { body: { address: addr } });
  assert.deepEqual([again.statusCode, again.body], [403, { ok: false, error: "already funded" }]);
  assert.equal(sends(m), 0);
  assert.equal((await callWith(handlers[0], { body: { address: fresh() } })).body.error, "grant cap reached");
});
await check("S pre-send abort → settle aborted_before_send without evidence; no auto release; operator store path releases; same address same epoch stays 403", async () => {
  const { remote, handlers, operator } = cluster(1, { globalCap: 1, epoch: "s2" });
  const addr = fresh();
  failBalance = true;
  try {
    assert.equal((await callWith(handlers[0], { body: { address: addr } })).statusCode, 502);
  } finally { failBalance = false; }
  const r = row(remote, "s2", addr);
  assert.equal(r.outcome, "aborted_before_send");
  assert.equal(r.broadcast, undefined);
  assert.equal(r.txHash, undefined);
  const other = fresh();
  assert.equal((await callWith(handlers[0], { body: { address: other } })).body.error, "grant cap reached", "no auto release");
  assert.deepEqual(await operator.release({ identity: addr.toLowerCase(), epoch: "s2", reservationId: r.reservationId }), { ok: true });
  assert.equal((await callWith(handlers[0], { body: { address: other } })).statusCode, 200, "freed slot used by another identity");
  assert.equal((await callWith(handlers[0], { body: { address: addr } })).statusCode, 403, "no automatic re-grant in the same epoch");
});

// ---- L: legacy compatibility -------------------------------------------------------------------------
await check("L A-792 v1 local test store (reserve/settle only) still works; reserve receives epoch \"default\"; duplicate → exact legacy 403", async () => {
  const inner = createLocalTestGrantStore({ contract: GRANT_STORE_CONTRACT });
  const seen = [];
  const store = { ...inner, async reserve(a) { seen.push(a); return inner.reserve(a); } };
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const addr = fresh();
  assert.equal((await callWith(h, { body: { address: addr } })).statusCode, 200);
  assert.deepEqual(seen[0], { identity: addr.toLowerCase(), globalCap: 5, epoch: "default" });
  const dup = await callWith(h, { body: { address: addr } });
  assert.deepEqual([dup.statusCode, dup.body], [403, { ok: false, error: "already funded" }]);
  assert.equal(inner.settles()[0].outcome, "confirmed");
});
await check("L contract id and settle outcomes match A-870; GRANT_WEI 0.1 MON and skip 0.05 MON unchanged", async () => {
  assert.equal(GRANT_STORE_CONTRACT, C.GRANT_STORE_CONTRACT_V1);
  assert.equal(GRANT_STORE_CONTRACT, "araso.grant-store/v1");
  assert.deepEqual([...mod.GRANT_SETTLE_OUTCOMES], [...C.GRANT_SETTLE_OUTCOMES]);
  assert.equal(GRANT_WEI, 100_000_000_000_000_000n);
  assert.equal(mod.GRANT_SKIP_BALANCE_WEI, 50_000_000_000_000_000n);
});
await check("L disabled gate still wins with a synthetic store: ARASO_GRANT_ENABLED unset → 503 grant disabled, no reserve, 0 RPC", async () => {
  const { handlers } = cluster(1, { globalCap: 5 });
  delete process.env[GRANT_ENABLE_ENV];
  const r0 = calls.reserve.length, m = rpcLog.length;
  try {
    const res = await callWith(handlers[0], { body: { address: fresh() } });
    assert.deepEqual([res.statusCode, res.body], [503, { ok: false, error: "grant disabled" }]);
  } finally { process.env[GRANT_ENABLE_ENV] = "1"; }
  assert.equal(calls.reserve.length, r0);
  assert.equal(rpcLog.length, m);
});
await check("L synthetic (testOnly) store refused under production markers → 503, 0 RPC", async () => {
  for (const [k, v] of [["VERCEL", "1"], ["VERCEL_ENV", "production"], ["NODE_ENV", "production"]]) {
    const { handlers } = cluster(1, { globalCap: 5 });
    process.env[k] = v;
    const m = rpcLog.length;
    try {
      assert.equal((await callWith(handlers[0], { body: { address: fresh() } })).statusCode, 503, k);
    } finally { delete process.env[k]; }
    assert.equal(rpcLog.length, m);
  }
});
await check("P handler-originated release/reconcile calls = 0 across the whole suite", async () => {
  assert.equal(calls.release, 0);
  assert.equal(calls.reconcile, 0);
});

// ---- N ---------------------------------------------------------------------------------------------
await check(`N Cache-Control: no-store on all ${allResponses.length} responses; key never in a body`, async () => {
  for (const r of allResponses) {
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(JSON.stringify(r.body).includes(KEY.slice(2)), false);
  }
});

console.log(`\nSUMMARY a875-grant-store-wiring: ${passed} checks passed · broadcasts=${rpcLog.filter((x) => x === "eth_sendRawTransaction").length} (stub only, network 0)`);
