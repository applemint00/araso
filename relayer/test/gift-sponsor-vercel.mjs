// [A-913 G/H] Vercel shape: KV store contract (conditional atomic writes + lease), in-process handler, Cron recovery, env/runtime wiring.
// Node only: a FAKE Upstash REST endpoint (in-memory), a stateful fake chain, throwaway keys. No network, no port.
// node relayer/test/gift-sponsor-vercel.mjs
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createVercelKvGiftSponsorStore } from "../../api/_lib/gift-sponsor-kv-store.js";
import { SPONSOR_FUNCTION_MAX_DURATION_SECONDS, buildGiftSponsorRuntime, getGiftSponsorRuntime, readGiftSponsorEnv, resetGiftSponsorRuntimeCache } from "../../api/_lib/gift-sponsor-runtime.js";
import { createGiftSponsorHandler } from "../../api/gift-sponsor.js";
import { createGiftSponsorReconcileHandler } from "../../api/gift-sponsor-reconcile.js";
import { createGiftSponsorService } from "../src/gift-sponsor-service.mjs";
import { createGiftSponsorReconciler } from "../src/gift-sponsor-reconcile.mjs";
import { ESCROW, POLICY, build, gasTxOf, gid, makeWorld, piggy, sponsorAcct, wire } from "./_a913-fixtures.mjs";
const reg = (r, b) => r.store.registerGasTx(b.giftId, gasTxOf(b.giftId));

let pass = 0;
const test = async (label, fn) => { await fn(); console.log(`PASS  ${label}`); pass += 1; };
const B = (i) => gid(i);
const ESC = "0x00000000000000000000000000000000000000e5";
const ENV = (o = {}) => ({ GIFT_SPONSOR_PRIVATE_KEY: "0xabc", MONAD_RPC_URL: "http://127.0.0.1:1", GIFT_SPONSOR_ESCROW_ADDRESS: ESC, GIFT_SPONSOR_GAS_UNITS: "46429,174887,46382,100000", GIFT_SPONSOR_GAS_BUFFER_BPS: "1000", GIFT_SPONSOR_LEASE_SECONDS: "90", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "tok", ...o });


// ── fake Upstash REST (GET SET[NX,PX] DEL SADD SREM SMEMBERS EVAL(renew|release)) with an injectable clock ──
function fakeKv() {
  const db = new Map(); const sets = new Map(); const exp = new Map(); const clock = { t: 1_000_000 }; const calls = [];
  const alive = (k) => { if (exp.has(k) && exp.get(k) <= clock.t) { db.delete(k); exp.delete(k); } return db.has(k); };
  const run = (a) => {
    const [c, ...r] = a;
    if (c === "GET") return alive(r[0]) ? db.get(r[0]) : null;
    if (c === "SET") {
      const [k, v, ...o] = r; const nx = o.includes("NX"); const px = o.includes("PX") ? Number(o[o.indexOf("PX") + 1]) : null;
      if (nx && alive(k)) return null;
      db.set(k, v); if (px) exp.set(k, clock.t + px); else exp.delete(k); return "OK";
    }
    if (c === "DEL") { const had = alive(r[0]); db.delete(r[0]); exp.delete(r[0]); return had ? 1 : 0; }
    if (c === "SADD") { const s = sets.get(r[0]) ?? new Set(); s.add(r[1]); sets.set(r[0], s); return 1; }
    if (c === "SREM") { sets.get(r[0])?.delete(r[1]); return 1; }
    if (c === "SMEMBERS") return [...(sets.get(r[0]) ?? [])];
    if (c === "EVAL") {
      const script = r[0]; const nk = Number(r[1]); const keys = r.slice(2, 2 + nk); const argv = r.slice(2 + nk);
      if (script.includes("sadd")) {                                             // RESERVE
        if (alive(keys[0])) return 0;
        if (argv[1] !== "") { const o = alive(keys[2]) ? db.get(keys[2]) : null; if (o && o !== argv[2]) return -1; if (!o) db.set(keys[2], argv[2]); }
        db.set(keys[0], argv[0]); const st = sets.get(keys[1]) ?? new Set(); st.add(argv[2]); sets.set(keys[1], st); return 1;
      }
      if (script.includes("return 4")) {                                         // REGISTER
        const cur = alive(keys[0]) ? db.get(keys[0]) : null; if (cur) return cur === argv[0] ? 2 : 3;
        const o = alive(keys[1]) ? db.get(keys[1]) : null; if (o && o !== argv[1]) return 4; if (!o) db.set(keys[1], argv[1]); db.set(keys[0], argv[0]); return 1;
      }
      if (script.includes("incr")) { const n = (alive(keys[0]) ? Number(db.get(keys[0])) : 0) + 1; db.set(keys[0], String(n)); if (n === 1) exp.set(keys[0], clock.t + Number(argv[0]) * 1000); return n; }
      const key = keys[0]; const owner = argv[0];
      if (!alive(key) || db.get(key) !== owner) return 0;
      if (script.includes("pexpire")) { exp.set(key, clock.t + Number(argv[1])); return 1; }
      if (script.includes("del")) { db.delete(key); exp.delete(key); return 1; }
    }
    throw new Error(`fake KV: unsupported ${c}`);
  };
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, "POST"); assert.match(init.headers.authorization, /^Bearer /);
    const body = JSON.parse(init.body); calls.push(body[0]);
    return { status: 200, text: async () => JSON.stringify({ result: run(body) }) };
  };
  return { fetchImpl, clock, db, calls };
}
const mkStore = (kv, prefix = "t") => createVercelKvGiftSponsorStore({ url: "https://kv.example", token: "tok", fetchImpl: kv.fetchImpl, prefix });

await test("KV store: bad url/token => null; reserve is create-if-absent; one deposit tx per giftId (same giftId may retry); forward-only states", async () => {
  assert.equal(createVercelKvGiftSponsorStore({ url: "http://x", token: "t" }), null); assert.equal(createVercelKvGiftSponsorStore({ url: "https://x", token: "" }), null);
  const kv = fakeKv(); const a = mkStore(kv); const b = mkStore(kv);           // two "instances" over the same KV
  await a.reserve(B(1), { depositTx: B(900), commitHash: B(5) });
  await assert.rejects(b.reserve(B(1), {}), /ALREADY_RESERVED/);
  await assert.rejects(b.reserve(B(2), { depositTx: B(900) }), /DEPOSIT_ALREADY_USED/);
  assert.equal(await b.get(B(2)), null);                                            // the failed reserve left nothing behind
  assert.equal(await b.depositUsedBy(B(900)), B(1));
  await a.update(B(1), "INSTALLED", { installTx: B(7) }); await b.update(B(1), "COMMITTED");
  await assert.rejects(a.update(B(1), "INSTALLED"), /BAD_TRANSITION/);
  assert.equal((await b.get(B(1))).installTx, B(7));
  await a.release(B(1)); assert.ok(await a.get(B(1)));                              // release only frees a RESERVED, never-sent entry
  await a.archive(B(1), "test"); assert.equal(await a.get(B(1)), null); assert.deepEqual(await a.list(), []);
  await a.reserve(B(1), { depositTx: B(900) });                                      // same giftId + same deposit may retry after archive
  assert.equal((await b.list()).length, 1);
});
await test("KV store: sponsor lease = one driver across instances; renew/release only by the owner; expiry frees it (a dead function cannot wedge the sponsor)", async () => {
  const kv = fakeKv(); const a = mkStore(kv); const b = mkStore(kv);
  assert.equal(await a.acquireLease("A", 90_000), true); assert.equal(await b.acquireLease("B", 90_000), false);
  assert.equal(await b.renewLease("B", 90_000), false); assert.equal(await a.renewLease("A", 90_000), true);
  await b.releaseLease("B"); assert.equal(await b.acquireLease("B", 90_000), false);          // not B's to release
  kv.clock.t += 91_000; assert.equal(await b.acquireLease("B", 90_000), true);                  // A's lease expired
  assert.equal(await a.renewLease("A", 90_000), false);                                         // A is fenced out
  await b.releaseLease("B"); assert.equal(await a.acquireLease("A", 1000), true);
});

// ── service over the KV store ──
function rigKv(i, { kv = fakeKv(), world = null, leaseSeconds = 90, preflight = async () => true } = {}) {
  const w = world ?? makeWorld(i); const store = mkStore(kv); const logs = [];
  const service = createGiftSponsorService({ ledger: store, policy: POLICY, chain: w, sponsor: w.sponsor, preflight, log: (m) => logs.push(m), leaseSeconds });
  const reconciler = createGiftSponsorReconciler({ ledger: store, policy: POLICY, chain: w, steps: service.steps, runExclusive: service.runExclusive, log: (m) => logs.push(m), inflightGraceSeconds: 300, nowMs: () => kv.clock.t });
  return { kv, world: w, store, service, reconciler, logs };
}
const mkReq = (body, over = {}) => { const text = typeof body === "string" ? body : JSON.stringify(body); return { method: "POST", url: "/api/gift-sponsor", headers: { host: "araso.example", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(over.headers ?? {}) }, body: text, ...(over.method ? { method: over.method } : {}) }; };
const mkRes = () => { const r = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b; } }; return r; };
const call = async (handler, req) => { const res = mkRes(); await handler(req, res); return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers }; };

await test("in-process handler over KV: same-origin POST -> install, commit, revoke (type-4 to 0x0), claim; ledger CLAIMED in the store; no secret header anywhere", async () => {
  const r = rigKv(90); const b = await build(90); r.world.commitHash = b.commitHash; await reg(r, b);
  const h = createGiftSponsorHandler({ getRuntime: () => ({ service: r.service }) });
  const out = await call(h, mkReq(wire(b)));
  assert.equal(out.status, 200, JSON.stringify(out.json)); assert.equal(out.json.state, "CLAIMED"); assert.equal(out.json.revoke, "done");
  assert.deepEqual(r.world.sends.map((s) => s.kind), ["install", "redeem", "revoke", "claim"]);
  const rev = r.world.sends[2]; assert.equal(rev.to.toLowerCase(), piggy.address.toLowerCase()); assert.equal(rev.authorizationList[0].address, "0x0000000000000000000000000000000000000000"); assert.equal(rev.authorizationList[0].nonce, 1);
  assert.equal((await r.store.get(b.giftId)).state, "CLAIMED"); assert.equal(await r.store.acquireLease("x", 1000), true);          // lease released after the flow
  assert.ok(!Object.keys(out.headers).some((k) => k.toLowerCase().startsWith("access-control")));
  assert.ok(r.world.sends.every((s) => s.value === 0n));
});
await test("handler: OFF / misconfigured => 503 unavailable_not_sent; 4-key / unknown shape => 400; GET => 405; cross-site => 403; > 8 KB => 413", async () => {
  const b = await build(91);
  const off = createGiftSponsorHandler({ getRuntime: () => null }); const bad = createGiftSponsorHandler({ getRuntime: () => { throw new Error("MISSING_X"); } });
  assert.deepEqual((await call(off, mkReq(wire(b)))).json, { ok: false, error: "unavailable_not_sent" });
  assert.equal((await call(bad, mkReq(wire(b)))).status, 503);
  const r = rigKv(91); const h = createGiftSponsorHandler({ getRuntime: () => ({ service: r.service }) });
  const four = { giftId: b.giftId, authorization: b.authorization, delegation: b.delegation, claim: b.claim };
  assert.equal((await call(h, mkReq(four))).status, 400); assert.equal((await call(h, mkReq({ ...wire(b), x: 1 }))).status, 400);
  assert.equal((await call(h, mkReq("{nope"))).status, 400); assert.equal((await call(h, mkReq(wire(b), { method: "GET" }))).status, 405);
  assert.equal((await call(h, mkReq(wire(b), { headers: { origin: "https://evil.example" } }))).status, 403);
  assert.equal((await call(h, mkReq("x".repeat(9000)))).status, 413);
  assert.equal(r.world.sends.length, 0);
});
await test("two instances at once: ONE drives (lease), the other answers 503 unavailable_not_sent and reserves nothing; then the second succeeds", async () => {
  const kv = fakeKv(); const w1 = makeWorld(92); const w2 = makeWorld(93);
  const a = rigKv(92, { kv, world: w1 }); const c = rigKv(93, { kv, world: w2 });
  const b1 = await build(92); w1.commitHash = b1.commitHash; const b2 = await build(93); w2.commitHash = b2.commitHash; await reg(a, b1); await reg(c, b2);
  let release; const gate = new Promise((res) => { release = res; });
  // instance A holds the lease while it works: the gate sits in the first redeem simulation, which runs INSIDE the lease
  const oSim = w1.simulate.bind(w1); let n = 0; w1.simulate = async (x) => { n += 1; if (n === 1) await gate; return oSim(x); };
  const first = a.service.handle(wire(b1));
  await new Promise((res) => setTimeout(res, 30));
  const second = await c.service.handle(wire(b2));
  assert.equal(second.status, 503); assert.equal(second.body.error, "unavailable_not_sent"); assert.equal(await c.store.get(b2.giftId), null); assert.equal(w2.sends.length, 0);
  release(); assert.equal((await first).status, 200);
  const third = await c.service.handle(wire(b2)); assert.equal(third.status, 200);
});
await test("function dies mid-flow (lease left behind): lease expiry + the Cron route finish it from chain truth - one install/commit/claim each, revoke done", async () => {
  const kv = fakeKv(); const r = rigKv(94, { kv }); const b = await build(94); r.world.commitHash = b.commitHash; await reg(r, b);
  r.world.script = { kind: "redeem", mode: "applied_then_throw" };
  const first = await r.service.handle(wire(b)); assert.equal(first.status, 503);           // commit landed, the function lost the answer -> UNKNOWN + inflight
  // simulate a hard kill: put a stale lease owned by a dead driver
  await r.store.acquireLease("dead-driver", 90_000);
  const cron = createGiftSponsorReconcileHandler({ getRuntime: () => ({ service: r.service, reconciler: r.reconciler }), env: { CRON_SECRET: "c".repeat(24) } });
  const ctl = (extra = {}) => ({ method: "GET", headers: { authorization: `Bearer ${"c".repeat(24)}` }, ...extra });
  assert.equal((await call(cron, ctl())).json.state, "busy");                                  // still held: nothing runs, nothing resent
  assert.equal(r.world.sends.length, 2);
  kv.clock.t += 91_000;                                                                         // lease expired
  const out = await call(cron, ctl()); assert.equal(out.status, 200); assert.equal(out.json.state, "ran"); assert.equal(out.json.remaining, 0); assert.equal(out.json.health.ok, true);
  assert.equal((await r.store.get(b.giftId)).state, "CLAIMED");
  assert.deepEqual(Object.values(r.world.effects), [1, 1, 1, 1]);
});
await test("Cron route: GET only, accepts ONLY Authorization: Bearer CRON_SECRET (unset/short secret => everything 401), OFF => state off", async () => {
  const rt = () => ({ service: { ready: true, health: async () => ({ ok: true }) }, reconciler: { run: async () => ({ results: [], remaining: [] }) } });
  const S = "s".repeat(20);
  const h = createGiftSponsorReconcileHandler({ getRuntime: rt, env: { CRON_SECRET: S } });
  assert.equal((await call(h, { method: "POST", headers: { authorization: `Bearer ${S}` } })).status, 405);
  for (const hd of [{}, { authorization: S }, { authorization: "Bearer wrong" }, { authorization: `bearer ${S}` }, { "x-araso-sponsor": S }]) assert.equal((await call(h, { method: "GET", headers: hd })).status, 401);
  assert.equal((await call(createGiftSponsorReconcileHandler({ getRuntime: rt, env: {} }), { method: "GET", headers: { authorization: "Bearer " } })).status, 401);
  assert.equal((await call(createGiftSponsorReconcileHandler({ getRuntime: rt, env: { CRON_SECRET: "short" } }), { method: "GET", headers: { authorization: "Bearer short" } })).status, 401);
  assert.equal((await call(h, { method: "GET", headers: { authorization: `Bearer ${S}` } })).json.state, "ran");
  assert.equal((await call(createGiftSponsorReconcileHandler({ getRuntime: () => null, env: { CRON_SECRET: S } }), { method: "GET", headers: { authorization: `Bearer ${S}` } })).json.state, "off");
});

await test("KV store: gasTx registry - created / same hash no-op / different hash conflict / hash of another gift reused; survives across instances", async () => {
  const kv = fakeKv(); const a = mkStore(kv); const b = mkStore(kv);
  assert.equal(await a.gasTxOf(B(1)), null);
  assert.equal(await a.registerGasTx(B(1), B(700)), "created"); assert.equal(await b.registerGasTx(B(1), B(700)), "same");
  assert.equal(await b.registerGasTx(B(1), B(701)), "conflict"); assert.equal(await b.registerGasTx(B(2), B(700)), "reused");
  assert.equal(await b.gasTxOf(B(2)), null); assert.equal(await a.gasTxOf(B(1)), B(700)); assert.equal(await a.depositUsedBy(B(700)), B(1));
});
await test("handler: registration action over KV (no secret hop, no send): created -> repeat is a no-op -> different hash 409; then the recipient claim needs NO gasTx", async () => {
  const r = rigKv(95); const b = await build(95); r.world.commitHash = b.commitHash;
  const h = createGiftSponsorHandler({ getRuntime: () => ({ service: r.service }) });
  const R = { action: "register_gas_tx", giftId: b.giftId, gasTx: gasTxOf(b.giftId) };
  const miss = { ...wire(b) }; delete miss.gasTx;
  const early = await call(h, mkReq(miss)); assert.equal(early.status, 409); assert.equal(r.world.sends.length, 0);              // not registered => fail closed
  const a1 = await call(h, mkReq(R)); assert.equal(a1.status, 200); assert.equal(a1.json.already, false); assert.equal(r.world.sends.length, 0);
  assert.equal((await call(h, mkReq(R))).json.already, true);
  assert.equal((await call(h, mkReq({ ...R, gasTx: B(777) }))).status, 409);
  assert.equal((await call(h, mkReq({ ...R, extra: 1 }))).status, 400); assert.equal((await call(h, mkReq({ action: "register_gas_tx", giftId: b.giftId }))).status, 400);
  const out = await call(h, mkReq(miss)); assert.equal(out.status, 200, JSON.stringify(out.json)); assert.equal(out.json.state, "CLAIMED");
});

await test("F-4 KV reserve is ONE atomic EVAL (entry + deposit ownership + index together): no partial state, listed immediately, dup / reused deposit rejected without residue", async () => {
  const kv = fakeKv(); const st = mkStore(kv);
  kv.calls.length = 0; await st.reserve(B(1), { depositTx: B(900) });
  assert.deepEqual(kv.calls, ["EVAL"]);                                                       // a single command: nothing to crash between
  assert.deepEqual((await st.list()).map((e) => e.giftId), [B(1)]);
  await assert.rejects(st.reserve(B(1), {}), /ALREADY_RESERVED/); await assert.rejects(st.reserve(B(2), { depositTx: B(900) }), /DEPOSIT_ALREADY_USED/);
  assert.equal(await st.get(B(2)), null); assert.equal((await st.list()).length, 1);
  kv.calls.length = 0; assert.equal(await st.registerGasTx(B(3), B(901)), "created"); assert.deepEqual(kv.calls, ["EVAL"]);   // registry is atomic too
  // transport failure of the single command leaves nothing behind
  const bad = createVercelKvGiftSponsorStore({ url: "https://kv.example", token: "t", fetchImpl: async () => { throw new Error("net"); }, prefix: "t2" });
  await assert.rejects(bad.reserve(B(4), {}), /net/); assert.equal(await mkStore(kv, "t2").get(B(4)), null);
});
await test("F-6 content-type must be application/json (else 415, nothing read or sent); rate limit: per-IP and per-gift fixed windows with INJECTED numbers, disabled when absent, fail closed when the store cannot count", async () => {
  const r = rigKv(97); const b = await build(97); r.world.commitHash = b.commitHash;
  const h = createGiftSponsorHandler({ getRuntime: () => ({ service: r.service }) });
  for (const ct of [undefined, "text/plain", "application/x-www-form-urlencoded", "application/jsonp", "multipart/form-data"]) { const rq = mkReq(wire(b)); if (ct === undefined) delete rq.headers["content-type"]; else rq.headers["content-type"] = ct; assert.equal((await call(h, rq)).status, 415); }
  assert.equal(r.world.sends.length, 0);
  const okq = mkReq({ action: "register_gas_tx", giftId: b.giftId, gasTx: gasTxOf(b.giftId) }); okq.headers["content-type"] = "application/json; charset=utf-8"; assert.equal((await call(h, okq)).status, 200);
  // limiter over the real KV store counter
  const kv = fakeKv(); const store = mkStore(kv);
  const mk = (rate) => { const cfg = readGiftSponsorEnv(ENV(rate)); return buildGiftSponsorRuntime(cfg, { account: privateKeyToAccount(generatePrivateKey()), publicClient: {}, store, chain: makeWorld(1), sponsor: { address: "0x" + "00".repeat(20), send: async () => {} } }); };
  assert.equal(mk({}).rateLimit, null);                                                          // unset => disabled
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_RATE_PER_IP: "5" })), /BAD_GIFT_SPONSOR_RATE_LIMIT/);                    // limit without a window
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_RATE_WINDOW_SECONDS: "60" })), /BAD_GIFT_SPONSOR_RATE_LIMIT/);            // window without a limit
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_RATE_PER_IP: "0", GIFT_SPONSOR_RATE_WINDOW_SECONDS: "60" })), /BAD_GIFT_SPONSOR_RATE_LIMIT/);
  const rt = mk({ GIFT_SPONSOR_RATE_PER_IP: "4", GIFT_SPONSOR_RATE_PER_GIFT: "2", GIFT_SPONSOR_RATE_WINDOW_SECONDS: "60" });
  const rh = createGiftSponsorHandler({ getRuntime: () => ({ service: r.service, rateLimit: rt.rateLimit }) });
  const reg = (gift, ip) => { const q = mkReq({ action: "register_gas_tx", giftId: gift, gasTx: gasTxOf(b.giftId) }); q.headers["x-forwarded-for"] = ip; return call(rh, q); };
  assert.notEqual((await reg(b.giftId, "9.9.9.9")).status, 429); assert.notEqual((await reg(b.giftId, "9.9.9.9")).status, 429);
  assert.equal((await reg(b.giftId, "9.9.9.9")).status, 429);                                      // per-gift: 3rd hit on the same giftId
  assert.notEqual((await reg(B(11), "9.9.9.9")).status, 429); assert.equal((await reg(B(12), "9.9.9.9")).status, 429);   // per-IP: 5th hit from the same IP
  assert.notEqual((await reg(B(13), "8.8.8.8")).status, 429);                                       // other IP unaffected
  kv.clock.t += 61_000; assert.notEqual((await reg(b.giftId, "9.9.9.9")).status, 429);               // window rolled over
  const noHit = createGiftSponsorHandler({ getRuntime: () => ({ service: r.service, rateLimit: async () => { throw new Error("RATE_LIMIT_STORE_UNSUPPORTED"); } }) });
  assert.equal((await call(noHit, mkReq(wire(b)))).status, 503);
});

// ── F-1: the REAL sender over a recording transport ──
await test("F-1 real sender: signs locally and sends raw; NO eth_fillTransaction / eth_estimateGas / eth_call ever carries an authorizationList; explicit gas / fees / nonce; type-4 only for install+revoke", async () => {
  const { createPublicClient, custom, parseTransaction, defineChain, keccak256 } = await import("viem");
  const { createViemGiftSponsorSender } = await import("../../api/_lib/gift-sponsor-runtime.js");
  const acct = privateKeyToAccount(generatePrivateKey()); const rec = []; const raws = [];
  const transport = custom({ async request({ method, params }) {
    rec.push({ method, params: JSON.parse(JSON.stringify(params ?? [], (k, v) => (typeof v === "bigint" ? v.toString() : v))) });
    if (method === "eth_chainId") return "0x8f"; if (method === "eth_getTransactionCount") return "0x7"; if (method === "eth_gasPrice") return "0x64";
    if (method === "eth_sendRawTransaction") { raws.push(params[0]); return keccak256(params[0]); }
    if (method === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0xa", transactionHash: params[0], blockHash: "0x" + "bb".repeat(32), transactionIndex: "0x0", from: acct.address, to: null, cumulativeGasUsed: "0x1", gasUsed: "0x1", logs: [], logsBloom: "0x" + "00".repeat(256), type: "0x4", effectiveGasPrice: "0x64" };
    if (method === "eth_blockNumber") return "0xb";
    throw new Error(`recording transport: unexpected ${method}`);
  } });
  const pc = createPublicClient({ chain: defineChain({ id: 143, name: "t", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["http://x.invalid"] } } }), transport });
  const sender = createViemGiftSponsorSender({ publicClient: pc, account: acct, policy: POLICY });
  const b = await build(96); const { buildSponsorCalls } = await import("../src/gift-sponsor-service.mjs");
  const plan = { giftId: b.giftId, authorization: b.authorization, revokeAuthorization: b.revokeAuthorization, delegation: { ...b.delegation, caveats: b.delegation.caveats.map((c) => ({ ...c, enforcer: c.enforcer.toLowerCase() })) }, claim: b.claim };
  const calls = buildSponsorCalls(POLICY, plan);
  const R = { install: await sender.send({ kind: "install", to: calls.delegator, data: "0x", value: 0n, authorizationList: calls.authList }),
    redeem: await sender.send({ kind: "redeem", to: POLICY.delegationManager, data: calls.redeemData, value: 0n }),
    revoke: await sender.send({ kind: "revoke", to: calls.delegator, data: "0x", value: 0n, authorizationList: calls.revokeAuthList }),
    claim: await sender.send({ kind: "claim", to: ESCROW, data: calls.claimData, value: 0n }) };
  assert.ok(Object.values(R).every((x) => x.status === "success"));
  const methods = rec.map((x) => x.method);
  for (const m of ["eth_fillTransaction", "eth_estimateGas", "eth_call", "eth_signTransaction", "eth_sendTransaction"]) assert.ok(!methods.includes(m), `${m} must not be called`);
  assert.ok(!rec.filter((x) => x.method !== "eth_sendRawTransaction").some((x) => /authorizationList|"r":|yParity/i.test(JSON.stringify(x.params))), "no authorization material outside eth_sendRawTransaction");
  assert.equal(raws.length, 4);
  const parsed = raws.map((r) => parseTransaction(r));
  assert.deepEqual(parsed.map((t) => t.type), ["eip7702", "eip1559", "eip7702", "eip1559"]);
  assert.deepEqual(parsed.map((t) => t.nonce), [7, 7, 7, 7]);                                             // the sponsor's pending count, explicit
  assert.ok(parsed.every((t) => t.maxFeePerGas === 200n && t.maxPriorityFeePerGas === 0 || t.maxPriorityFeePerGas === undefined));
  const u = POLICY.gasUnits; const lim = (x) => (x * 11000n + 9999n) / 10000n;                                // gasBufferBps 1000
  assert.deepEqual(parsed.map((t) => t.gas), [lim(u.install), lim(u.commit), lim(u.revoke), lim(u.claim)]);
  assert.equal(parsed[0].authorizationList.length, 1); assert.equal(parsed[2].authorizationList[0].address, "0x0000000000000000000000000000000000000000"); assert.equal(parsed[2].authorizationList[0].nonce, 1);
  assert.ok(parsed.every((t) => (t.value ?? 0n) === 0n));
  await assert.rejects(sender.send({ kind: "claim", to: ESCROW, data: "0x", value: 1n }), /VALUE_NONZERO/);
  await assert.rejects(sender.send({ kind: "install", to: calls.delegator, data: "0x", value: 0n }), /AUTHORIZATION_SHAPE/);
});

// ── env / runtime wiring ──
await test("env: default OFF (no key => null); every required value missing/invalid fails closed; lease must outlive the function; inflight grace defaults to 300 (expiry reused)", () => {
  assert.equal(readGiftSponsorEnv({}), null); resetGiftSponsorRuntimeCache(); assert.equal(getGiftSponsorRuntime({}, { noCache: true }), null);
  for (const k of ["MONAD_RPC_URL", "GIFT_SPONSOR_ESCROW_ADDRESS", "GIFT_SPONSOR_GAS_UNITS", "GIFT_SPONSOR_GAS_BUFFER_BPS", "GIFT_SPONSOR_LEASE_SECONDS"]) { const e = ENV(); delete e[k]; assert.throws(() => readGiftSponsorEnv(e), new RegExp(`MISSING_${k}`)); }
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_GAS_UNITS: "1,2,3" })), /BAD_GIFT_SPONSOR_GAS_UNITS/);
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_GAS_UNITS: "1,2,0,4" })), /BAD_GIFT_SPONSOR_GAS_UNITS/);
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_GAS_BUFFER_BPS: "x" })), /BAD_GIFT_SPONSOR_GAS_BUFFER_BPS/);
  assert.throws(() => readGiftSponsorEnv(ENV({ GIFT_SPONSOR_LEASE_SECONDS: String(SPONSOR_FUNCTION_MAX_DURATION_SECONDS) })), /BAD_GIFT_SPONSOR_LEASE_SECONDS/);
  const c = readGiftSponsorEnv(ENV()); assert.equal(c.inflightGraceSeconds, 300); assert.equal(c.leaseSeconds, 90);
  assert.equal(readGiftSponsorEnv(ENV({ GIFT_SPONSOR_INFLIGHT_GRACE_SECONDS: "120" })).inflightGraceSeconds, 120);
});
await test("runtime: built from env with the REAL 143 pin table; buffer > 5000 / escrow garbage / no store => throws (never half-running)", () => {
  const acct = privateKeyToAccount(generatePrivateKey()); const kv = fakeKv();
  const mk = (o, d = {}) => buildGiftSponsorRuntime(readGiftSponsorEnv(ENV(o)), { account: acct, publicClient: {}, walletClient: {}, fetchImpl: kv.fetchImpl, ...d });
  const rt = mk({}); assert.equal(rt.policy.chainId, 143); assert.equal(rt.policy.maxExpirySeconds, 300n); assert.equal(rt.policy.gasUnits.claim, 100000n); assert.equal(rt.store.kind, "vercel-kv"); assert.equal(rt.service.ready, true);
  assert.throws(() => mk({ GIFT_SPONSOR_GAS_BUFFER_BPS: "5001" }), /POLICY_INVALID/);
  assert.throws(() => mk({ GIFT_SPONSOR_ESCROW_ADDRESS: "0x123" }), /POLICY_INVALID/);
  assert.throws(() => mk({ KV_REST_API_URL: "", KV_REST_API_TOKEN: "" }), /MISSING_GIFT_SPONSOR_STORE/);
});
await test("vercel.json: both sponsor functions carry maxDuration (lease > it) + relayer/src files; the Cron points at the reconcile route", async () => {
  const { readFileSync } = await import("node:fs");
  const j = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  for (const f of ["api/gift-sponsor.js", "api/gift-sponsor-reconcile.js"]) { assert.equal(j.functions[f].maxDuration, SPONSOR_FUNCTION_MAX_DURATION_SECONDS); assert.match(j.functions[f].includeFiles, /relayer\/src/); }
  assert.ok(j.crons.some((c) => c.path === "/api/gift-sponsor-reconcile" && typeof c.schedule === "string"));
});

await test("tool: --sponsor plan/apply fails closed (no env / apply without key) before any network", async () => {
  const { sponsorReconcile } = await import("../tools/gift-gas-reconcile.mjs");
  await assert.rejects(sponsorReconcile({ env: {} }), /MISSING_/);
  await assert.rejects(sponsorReconcile({ env: ENV({ GIFT_SPONSOR_PRIVATE_KEY: "" }), apply: true }), /MISSING_GIFT_SPONSOR_PRIVATE_KEY/);
  await assert.rejects(sponsorReconcile({ env: ENV({ GIFT_SPONSOR_PRIVATE_KEY: "" }) }), /MISSING_SPONSOR_ADDRESS/);
});

console.log(`\nPASS ${pass}  FAIL 0`);
