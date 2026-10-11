// [A-792] /api/grant durable-store boundary — offline. Network 0, real key 0, tx 0.
// globalThis.fetch is replaced by an in-memory JSON-RPC stub BEFORE api/grant.js is imported (same pattern as a785),
// so viem can only reach the stub. The relayer key is a fresh random key.
//
// Proves:
//   C  the TEST-ONLY local adapter honours the store contract under races (direct reserve() calls)
//   X  exactly-once: N concurrent duplicate requests for one address through the handler → exactly one 200 + one broadcast
//   K  global cap: Promise.all of N > cap distinct addresses → exactly cap 200s / broadcasts, rest 503 grant cap reached
//   A  allowlist (when enabled) denies non-members with 403 before reserve and before any RPC; off = everyone eligible
//   F  fail-closed: production default export / unknown backend / invalid store / invalid policy / throwing or garbage
//      reserve / test store under production markers → 503 with zero RPC and zero broadcast
//   O  ordering: reserve precedes the first RPC; A-785 gates (415/403/400) and the disabled gate consume no reservation
//   S  reservation-on-failure policy: send failure / pre-send abort keep the slot (no automatic re-grant); settle is
//      record-only and a failing settle does not change the response
//   N  Cache-Control: no-store on every response here; the relayer key never appears in a body
// Does NOT prove: durability or cross-instance atomicity of any real backend (none exists — DURABLE_GRANT_STORE_BACKENDS
// is empty by design; vendor choice = OPS/Owner).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";

// ---- RPC stub (installed before the handler module loads) --------------------------------------------
const STUB_RPC = "http://a792-stub-rpc.invalid";
process.env.MONAD_RPC_URL = STUB_RPC;
const KEY = generatePrivateKey();
const RELAYER = privateKeyToAccount(KEY).address;

const rpcLog = []; // every JSON-RPC method, in order
const sentTo = []; // lowercase recipient of every eth_sendRawTransaction
const balances = new Map();
balances.set(RELAYER.toLowerCase(), 10n ** 21n);
const receipts = new Map();
let nonce = 0;
let failSend = false;
let failBalance = false;
const hex = (n) => `0x${BigInt(n).toString(16)}`;

globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(STUB_RPC)) throw new Error(`a792: unexpected network call to ${url}`);
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
    case "eth_chainId":
      return hex(10143);
    case "eth_getBalance":
      return hex(balances.get(params[0].toLowerCase()) ?? 0n);
    case "eth_getTransactionCount":
      return hex(nonce);
    case "eth_blockNumber":
      return hex(100);
    case "eth_gasPrice":
    case "eth_maxPriorityFeePerGas":
      return hex(1_000_000_000);
    case "eth_estimateGas":
      return hex(21000);
    case "eth_getBlockByNumber":
      return { number: hex(100), hash: `0x${"ab".repeat(32)}`, baseFeePerGas: hex(1_000_000_000), timestamp: hex(1), transactions: [], gasLimit: hex(30_000_000), gasUsed: "0x0" };
    case "eth_sendRawTransaction": {
      if (failSend) throw new Error("stub: send rejected");
      const tx = parseTransaction(params[0]);
      const to = tx.to.toLowerCase();
      const hash = keccak256(params[0]);
      nonce += 1;
      sentTo.push(to);
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
    case "eth_getTransactionByHash":
      return null;
    default:
      throw new Error(`a792 stub: unhandled ${method}`);
  }
}

// ---- load ------------------------------------------------------------------------------------------
const mod = await import("../../api/grant.js");
const { createGrantHandler, GRANT_STORE_CONTRACT, GRANT_ENABLE_ENV, GRANT_STORE_ENV, DURABLE_GRANT_STORE_BACKENDS, GRANT_SETTLE_OUTCOMES } = mod;
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
async function callWith(h, { method = "POST", headers = ARASO_HEADERS, body } = {}) {
  const res = makeRes();
  await h({ method, headers, body, async *[Symbol.asyncIterator]() {} }, res);
  allResponses.push(res);
  return res;
}
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const newStore = (opts = {}) => createLocalTestGrantStore({ contract: GRANT_STORE_CONTRACT, ...opts });
// Interleave arrivals deterministically: request i waits (i * 7) % 5 microtasks before its critical section.
const SHUFFLE = (i) => (i * 7) % 5;
const countSends = (from) => rpcLog.slice(from).filter((m) => m === "eth_sendRawTransaction").length;

process.env.RELAYER_PRIVATE_KEY = KEY;
delete process.env[GRANT_STORE_ENV];
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;

// ---- C: adapter contract under direct races ----------------------------------------------------------
await check("C local adapter carries the contract id, testOnly=true, and passes isGrantStore", async () => {
  const s = newStore();
  assert.equal(mod.isGrantStore(s), true);
  assert.equal(s.testOnly, true);
  assert.equal(mod.isGrantStore({ ...s, contract: "other" }), false);
  assert.equal(mod.isGrantStore({ contract: GRANT_STORE_CONTRACT, reserve() {} }), false);
});
await check("C direct race: 50 concurrent reserve() of one identity → exactly 1 ok, 49 duplicate", async () => {
  const s = newStore({ yields: SHUFFLE });
  const id = fresh().toLowerCase();
  const out = await Promise.all(Array.from({ length: 50 }, () => s.reserve({ identity: id, globalCap: 1000 })));
  assert.equal(out.filter((r) => r.ok).length, 1);
  assert.equal(out.filter((r) => !r.ok && r.reason === "duplicate").length, 49);
  assert.equal(s.size(), 1);
});
await check("C direct race: 40 distinct identities, cap 7 → exactly 7 ok, 33 cap_reached, size never above cap", async () => {
  const s = newStore({ yields: SHUFFLE });
  const out = await Promise.all(Array.from({ length: 40 }, () => s.reserve({ identity: fresh().toLowerCase(), globalCap: 7 })));
  assert.equal(out.filter((r) => r.ok).length, 7);
  assert.equal(out.filter((r) => r.reason === "cap_reached").length, 33);
  assert.equal(s.size(), 7);
  assert.equal(new Set(out.filter((r) => r.ok).map((r) => r.reservationId)).size, 7);
});

process.env[GRANT_ENABLE_ENV] = "1";

// ---- X: exactly-once through the handler -----------------------------------------------------------
await check("X 12 concurrent duplicate requests for one address → exactly one 200, 11× 403 already funded, one broadcast", async () => {
  const store = newStore({ yields: SHUFFLE });
  const h = createGrantHandler({ store, policy: { globalCap: 1000 } });
  const a = fresh();
  const m = rpcLog.length;
  const sentBefore = sentTo.length;
  // Mixed spellings of the same recipient are one identity.
  const bodies = Array.from({ length: 12 }, (_, i) => ({ address: i % 2 ? a.toLowerCase() : a }));
  const out = await Promise.all(bodies.map((body) => callWith(h, { body })));
  const ok = out.filter((r) => r.statusCode === 200);
  assert.equal(ok.length, 1, JSON.stringify(out.map((r) => [r.statusCode, r.body.error])));
  assert.equal(out.filter((r) => r.statusCode === 403 && r.body.error === "already funded").length, 11);
  assert.equal(countSends(m), 1);
  assert.deepEqual(sentTo.slice(sentBefore), [a.toLowerCase()]);
  assert.equal(store.size(), 1);
  assert.equal(store.reserveCalls().length, 12, "all 12 reached the atomic reserve concurrently");
});
await check("X sequential retry after success → 403 already funded from the store, zero RPC (reserve precedes balance read)", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 1000 } });
  const a = fresh();
  assert.equal((await callWith(h, { body: { address: a } })).statusCode, 200);
  const m = rpcLog.length;
  const res = await callWith(h, { body: { address: a } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "already funded");
  assert.deepEqual(rpcLog.slice(m), []);
});

// ---- K: global cap under race ----------------------------------------------------------------------
await check("K Promise.all of 9 distinct addresses with globalCap 3 → exactly 3× 200 and 3 broadcasts, 6× 503 grant cap reached", async () => {
  const store = newStore({ yields: SHUFFLE });
  const h = createGrantHandler({ store, policy: { globalCap: 3 } });
  const addrs = Array.from({ length: 9 }, fresh);
  const m = rpcLog.length;
  const out = await Promise.all(addrs.map((address) => callWith(h, { body: { address } })));
  assert.equal(out.filter((r) => r.statusCode === 200).length, 3, JSON.stringify(out.map((r) => r.statusCode)));
  assert.equal(out.filter((r) => r.statusCode === 503 && r.body.error === "grant cap reached").length, 6);
  assert.equal(countSends(m), 3);
  assert.equal(store.size(), 3);
});
await check("K cap race with duplicates mixed in (3 addresses × 4 copies, cap 2) → 2 grants, never more than cap, never twice per address", async () => {
  const store = newStore({ yields: SHUFFLE });
  const h = createGrantHandler({ store, policy: { globalCap: 2 } });
  const addrs = Array.from({ length: 3 }, fresh);
  const m = rpcLog.length;
  const sentBefore = sentTo.length;
  const out = await Promise.all(addrs.flatMap((a) => [a, a, a, a]).map((address) => callWith(h, { body: { address } })));
  assert.equal(out.filter((r) => r.statusCode === 200).length, 2);
  assert.equal(countSends(m), 2);
  const sent = sentTo.slice(sentBefore);
  assert.equal(new Set(sent).size, 2);
});
await check("K cap is cumulative across waves: cap 2, then a later wave of 5 new addresses → 0 more grants", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 2 } });
  await Promise.all([fresh(), fresh()].map((address) => callWith(h, { body: { address } })));
  const m = rpcLog.length;
  const out = await Promise.all(Array.from({ length: 5 }, fresh).map((address) => callWith(h, { body: { address } })));
  assert.ok(out.every((r) => r.statusCode === 503 && r.body.error === "grant cap reached"));
  assert.deepEqual(rpcLog.slice(m), []);
});

// ---- A: allowlist ----------------------------------------------------------------------------------
await check("A allowlist enabled: non-member → 403 not allowlisted, zero RPC, no reservation consumed; members (any case) → 200", async () => {
  const store = newStore();
  const member = fresh();
  const member2 = fresh();
  const h = createGrantHandler({ store, policy: { globalCap: 10, allowlist: [member.toLowerCase(), member2] } });
  const m = rpcLog.length;
  const outsider = await callWith(h, { body: { address: fresh() } });
  assert.equal(outsider.statusCode, 403);
  assert.equal(outsider.body.error, "not allowlisted");
  assert.deepEqual(rpcLog.slice(m), []);
  assert.equal(store.reserveCalls().length, 0);
  assert.equal((await callWith(h, { body: { address: member } })).statusCode, 200);
  assert.equal((await callWith(h, { body: { address: member2.toLowerCase() } })).statusCode, 200);
});
await check("A allowlist enabled under race: 6 non-members + 1 member concurrently → only the member is granted", async () => {
  const store = newStore({ yields: SHUFFLE });
  const member = fresh();
  const h = createGrantHandler({ store, policy: { globalCap: 10, allowlist: [member] } });
  const m = rpcLog.length;
  const out = await Promise.all([...Array.from({ length: 6 }, fresh), member].map((address) => callWith(h, { body: { address } })));
  assert.equal(out.filter((r) => r.statusCode === 403 && r.body.error === "not allowlisted").length, 6);
  assert.equal(out.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(countSends(m), 1);
});
await check("A empty allowlist array = enabled with zero members → everyone 403, zero RPC", async () => {
  const h = createGrantHandler({ store: newStore(), policy: { globalCap: 10, allowlist: [] } });
  const m = rpcLog.length;
  const res = await callWith(h, { body: { address: fresh() } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "not allowlisted");
  assert.deepEqual(rpcLog.slice(m), []);
});
await check("A allowlist off (null/absent) → any valid address is eligible", async () => {
  for (const policy of [{ globalCap: 10 }, { globalCap: 10, allowlist: null }]) {
    const h = createGrantHandler({ store: newStore(), policy });
    assert.equal((await callWith(h, { body: { address: fresh() } })).statusCode, 200);
  }
});

// ---- F: fail-closed --------------------------------------------------------------------------------
async function assertRefused(h, label, error = "grant store unavailable") {
  const m = rpcLog.length;
  const res = await callWith(h, { body: { address: fresh() } });
  assert.equal(res.statusCode, 503, `${label}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error, error, label);
  assert.equal("txHash" in res.body, false, label);
  assert.deepEqual(rpcLog.slice(m), [], `${label} must not reach RPC`);
}
await check("F production default export, enabled, no store configured → 503 grant store unavailable, zero RPC", async () => {
  await assertRefused(mod.default, "default export");
});
await check("F production registry is empty and frozen; any ARASO_GRANT_STORE value (incl. memory/local-test names) → 503, zero RPC", async () => {
  assert.equal(Object.isFrozen(DURABLE_GRANT_STORE_BACKENDS), true);
  assert.deepEqual(Object.keys(DURABLE_GRANT_STORE_BACKENDS), ["upstash"]); // [A-960 re-pin] pre-A-960: [] — one backend (Upstash), still 503 without its env pair
  assert.equal(GRANT_STORE_ENV.startsWith("VITE_"), false);
  for (const v of ["memory", "local-test-memory", "local-test", "redis", "kv", "toString", "__proto__", "constructor", " "]) {
    process.env[GRANT_STORE_ENV] = v;
    assert.equal(mod.resolveProductionGrantStore(process.env).ok, false, v);
    await assertRefused(mod.default, `ARASO_GRANT_STORE=${v}`);
  }
  delete process.env[GRANT_STORE_ENV];
  assert.equal(mod.resolveProductionGrantStore({}).ok, false);
  assert.equal(mod.resolveProductionGrantStore(undefined).ok, false);
});
await check("F injected store/policy invalid → 503, zero RPC (no silent default cap, no shape guessing)", async () => {
  const good = newStore();
  const cases = [
    [{ store: null, policy: { globalCap: 1 } }, "null store"],
    [{ store: { reserve: good.reserve, settle: good.settle }, policy: { globalCap: 1 } }, "no contract id"],
    [{ store: { ...good, contract: "araso.grant-store/v0" }, policy: { globalCap: 1 } }, "wrong contract id"],
    [{ store: good }, "no policy"],
    [{ store: good, policy: { globalCap: 0 } }, "cap 0"],
    [{ store: good, policy: { globalCap: -1 } }, "cap negative"],
    [{ store: good, policy: { globalCap: 1.5 } }, "cap fractional"],
    [{ store: good, policy: { globalCap: "5" } }, "cap string"],
    [{ store: good, policy: { globalCap: Infinity } }, "cap infinite"],
    [{ store: good, policy: { globalCap: 5, allowlist: "0x1111111111111111111111111111111111111111" } }, "allowlist not array"],
    [{ store: good, policy: { globalCap: 5, allowlist: ["0xnope"] } }, "allowlist bad entry"],
  ];
  for (const [opts, label] of cases) await assertRefused(createGrantHandler(opts), label);
  assert.equal(good.reserveCalls().length, 0);
});
await check("F reserve() throws / answers garbage / unknown reason → 503, zero RPC", async () => {
  const base = { contract: GRANT_STORE_CONTRACT, async settle() {} };
  const answers = [
    [async () => { throw new Error("backend down"); }, "throws"],
    [async () => undefined, "undefined"],
    [async () => ({ ok: true }), "ok without reservationId"],
    [async () => ({ ok: true, reservationId: "" }), "empty reservationId"],
    [async () => ({ ok: "yes", reservationId: "r1" }), "truthy non-true ok"],
    [async () => ({ ok: false, reason: "maybe" }), "unknown reason"],
  ];
  for (const [reserve, label] of answers) await assertRefused(createGrantHandler({ store: { ...base, reserve }, policy: { globalCap: 5 } }), label);
});
await check("F test-only store is refused when production markers are present (VERCEL / VERCEL_ENV / NODE_ENV=production)", async () => {
  for (const [k, v] of [["VERCEL", "1"], ["VERCEL_ENV", "production"], ["NODE_ENV", "production"]]) {
    const store = newStore();
    process.env[k] = v;
    try {
      await assertRefused(createGrantHandler({ store, policy: { globalCap: 5 } }), `${k}=${v}`);
    } finally {
      delete process.env[k];
    }
    assert.equal(store.reserveCalls().length, 0);
  }
});
await check("F disabled gate still wins: ARASO_GRANT_ENABLED unset → 503 grant disabled even with a valid injected store, no reserve", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  delete process.env[GRANT_ENABLE_ENV];
  try {
    const m = rpcLog.length;
    const res = await callWith(h, { body: { address: fresh() } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, "grant disabled");
    assert.deepEqual(rpcLog.slice(m), []);
  } finally {
    process.env[GRANT_ENABLE_ENV] = "1";
  }
  assert.equal(store.reserveCalls().length, 0);
});

// ---- O: ordering -----------------------------------------------------------------------------------
await check("O reserve() runs before the first RPC of the request", async () => {
  const inner = newStore();
  let rpcAtReserve = null;
  let mark = 0;
  const spy = { ...inner, async reserve(args) { rpcAtReserve = rpcLog.length - mark; return inner.reserve(args); } };
  const h = createGrantHandler({ store: spy, policy: { globalCap: 5 } });
  mark = rpcLog.length;
  const res = await callWith(h, { body: { address: fresh() } });
  assert.equal(res.statusCode, 200);
  assert.equal(rpcAtReserve, 0, "no RPC before reservation");
});
await check("O A-785 gates (415 / 403 origin / 400 invalid, zero, self) run before the store and consume nothing", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const m = rpcLog.length;
  const cases = [
    [{ headers: { ...ARASO_HEADERS, "content-type": "text/plain" }, body: { address: fresh() } }, 415],
    [{ headers: { ...ARASO_HEADERS, origin: "https://evil.example" }, body: { address: fresh() } }, 403],
    [{ headers: { ...ARASO_HEADERS, "sec-fetch-site": "cross-site" }, body: { address: fresh() } }, 403],
    [{ body: { address: "0xdeadbeef" } }, 400],
    [{ body: { address: "0x0000000000000000000000000000000000000000" } }, 400],
    [{ body: { address: RELAYER } }, 400],
    [{ method: "GET" }, 405],
  ];
  for (const [req, status] of cases) assert.equal((await callWith(h, req)).statusCode, status, JSON.stringify(req));
  assert.deepEqual(rpcLog.slice(m), []);
  assert.equal(store.reserveCalls().length, 0);
  assert.equal(store.size(), 0);
});

// ---- S: reservation-on-failure policy (no automatic re-grant) --------------------------------------
await check("S send failure → 502 grant failed, settle=send_failed, slot kept; retry → 403 already funded, no 2nd broadcast attempt", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const a = fresh();
  failSend = true;
  let res;
  try {
    res = await callWith(h, { body: { address: a } });
  } finally {
    failSend = false;
  }
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "grant failed");
  assert.equal(store.get(a.toLowerCase()).outcome, "send_failed");
  const m = rpcLog.length;
  const retry = await callWith(h, { body: { address: a } });
  assert.equal(retry.statusCode, 403);
  assert.equal(retry.body.error, "already funded");
  assert.deepEqual(rpcLog.slice(m), []);
  assert.equal(store.size(), 1, "failed reservation still counts against the cap");
});
await check("S pre-send abort (balance read down) → 502, settle=aborted_before_send, slot kept, no broadcast", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const a = fresh();
  const m = rpcLog.length;
  failBalance = true;
  let res;
  try {
    res = await callWith(h, { body: { address: a } });
  } finally {
    failBalance = false;
  }
  assert.equal(res.statusCode, 502);
  assert.equal(countSends(m), 0);
  assert.equal(store.get(a.toLowerCase()).outcome, "aborted_before_send");
  assert.equal((await callWith(h, { body: { address: a } })).statusCode, 403);
});
await check("S already-funded recipient (balance ≥ skip) → 403, settle=aborted_before_send, no broadcast", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const a = fresh();
  balances.set(a.toLowerCase(), mod.GRANT_SKIP_BALANCE_WEI);
  const m = rpcLog.length;
  const res = await callWith(h, { body: { address: a } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "already funded");
  assert.equal(countSends(m), 0);
  assert.equal(store.get(a.toLowerCase()).outcome, "aborted_before_send");
});
await check("S success → settle=confirmed with the txHash; outcomes are from GRANT_SETTLE_OUTCOMES", async () => {
  const store = newStore();
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const a = fresh();
  const res = await callWith(h, { body: { address: a } });
  assert.equal(res.statusCode, 200);
  const r = store.get(a.toLowerCase());
  assert.equal(r.outcome, "confirmed");
  assert.equal(r.txHash, res.body.txHash);
  for (const s of store.settles()) assert.ok(GRANT_SETTLE_OUTCOMES.includes(s.outcome));
});
await check("S failing settle() does not change a confirmed 200 (record-only)", async () => {
  const store = newStore();
  store.setFailSettle(true);
  const h = createGrantHandler({ store, policy: { globalCap: 5 } });
  const res = await callWith(h, { body: { address: fresh() } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

// ---- amount / structure ----------------------------------------------------------------------------
await check("amount unchanged: GRANT_WEI 0.1 MON, skip threshold 0.05 MON", async () => {
  assert.equal(GRANT_WEI, 100_000_000_000_000_000n);
  assert.equal(mod.GRANT_SKIP_BALANCE_WEI, 50_000_000_000_000_000n);
});
await check("structural: api/grant.js never imports test code or the local adapter; single respond() writer kept", async () => {
  const src = readFileSync(new URL("../../api/grant.js", import.meta.url), "utf8");
  assert.equal(/from\s+["'][^"']*app\/test/.test(src), false);
  assert.equal(src.includes("grant-local-test-store"), false);
  assert.equal(src.includes("createLocalTestGrantStore"), false);
  assert.equal(src.match(/res\.end\(/g)?.length, 1);
  assert.equal(src.match(/res\.statusCode\s*=/g)?.length, 1);
});

// ---- N ---------------------------------------------------------------------------------------------
await check(`N Cache-Control: no-store on all ${allResponses.length} responses (statuses: ${[...new Set(allResponses.map((r) => r.statusCode))].sort().join(",")})`, async () => {
  const statuses = new Set(allResponses.map((r) => r.statusCode));
  for (const s of [200, 400, 403, 405, 415, 502, 503]) assert.ok(statuses.has(s), `status ${s} exercised`);
  for (const r of allResponses) {
    assert.equal(r.headers["cache-control"], "no-store", `status ${r.statusCode}`);
    assert.equal(r.headers["content-type"], "application/json");
    assert.equal(JSON.stringify(r.body).includes(KEY.slice(2)), false);
  }
});

console.log(`\nSUMMARY a792-grant-durable-boundary: ${passed} checks passed · broadcasts=${rpcLog.filter((x) => x === "eth_sendRawTransaction").length} (stub only, network 0)`);
