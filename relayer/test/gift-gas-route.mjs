// [A-874] POST /gift-gas route contract + /grant regression. Node only: no port bind, no network, no RPC, no env, no keys.
// The HTTP handler is driven directly with in-memory req/res objects (server.listeners("request")[0]).
// node relayer/test/gift-gas-route.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createRelayServer, GIFT_GAS_MAX_BODY_BYTES, GIFT_GAS_AUTH_TIMEOUT_MS, GIFT_GAS_BODY_TIMEOUT_MS } from "../src/server.mjs";
import { openLedger } from "../src/ledger.mjs";
import { createGrantPolicy, CHAIN_ID } from "../src/policy.mjs";
import { openGiftGasLedger } from "../src/gift-gas-ledger.mjs";
import { createGiftGasPolicy } from "../src/gift-gas-policy.mjs";
import { createGiftGasService } from "../src/gift-gas-service.mjs";

const SERVER_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "a874-"));
let n = 0;
// gift ledger creates its own 0700 dir; the /grant ledger expects an existing dir => flat path
const fresh = (tag = "l") => (tag === "grant" ? path.join(dir, `grant${n++}.json`) : path.join(dir, `d${n}`, `${tag}${n++}.json`));
const gid = (i) => `0x${i.toString(16).padStart(64, "0")}`;
const E18 = 10n ** 18n;
// in-memory throwaway key (never from env/disk)
const ACCOUNT = privateKeyToAccount(generatePrivateKey());
const RELAYER = ACCOUNT.address.toLowerCase();
const SENDER = "0x00000000000000000000000000000000000000c3";
const TO = "0x00000000000000000000000000000000000000a1";
const TO2 = "0x00000000000000000000000000000000000000a2";
const CFG = { valueWei: E18 / 100n, minGiftWei: E18 / 10n, perSenderMaxCount: 3, perSenderMaxWei: E18 / 20n, globalMaxCount: 5, globalMaxWei: E18 / 10n,
  relayerMinBalanceWei: E18, maxGasPriceWei: 200n * 10n ** 9n, chainId: 10143, relayerAddress: RELAYER };
const POLICY = createGiftGasPolicy(CFG);
const ALLOW = () => true;
const GOOD_ORIGIN = "https://araso.example";
let pass = 0;
const test = async (label, fn) => { await fn(); console.log(`PASS  ${label}`); pass += 1; };

// ---------- fakes (same shape as A-869 tests) ----------
function fakeChain() {
  const c = {
    gifts: new Map(), balance: 10n * E18, pendingNonce: 5n, latestNonce: 5n, gasPrice: 50n * 10n ** 9n,
    broadcasts: [], receipts: new Map(), giftLookups: 0, calls: 0,
    async getGift(id) { c.calls += 1; c.giftLookups += 1; return c.gifts.get(id) ?? { exists: false }; },
    async getBalance() { c.calls += 1; return c.balance; },
    async getPendingNonce() { c.calls += 1; return c.pendingNonce; },
    async getLatestNonce() { c.calls += 1; return c.latestNonce; },
    async getGasPrice() { c.calls += 1; return c.gasPrice; },
    async broadcast(raw) { c.calls += 1; c.broadcasts.push(raw); return keccak256(raw); },
    async getReceipt(h) { c.calls += 1; return c.receipts.get(h) ?? null; },
    addGift(i, over = {}) { c.gifts.set(gid(i), { exists: true, claimed: false, refunded: false, expired: false, sender: SENDER, amountWei: E18, ...over }); },
  };
  return c;
}
function fakeSigner() {
  const s = { calls: [],
    async signNativeTransfer({ to, valueWei, nonce, gasLimit, gasPrice, chainId }) {
      s.calls.push({ to, nonce });
      const rawTx = await ACCOUNT.signTransaction({ type: "legacy", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, gasPrice });
      return { rawTx, txHash: keccak256(rawTx) };
    } };
  return s;
}
function fakeSubmitter({ fail = false } = {}) {
  const sent = [];
  return { sent, getBalance: async () => 5n * E18, send: async ({ to, valueWei }) => { sent.push({ to, valueWei }); if (fail) throw new Error("fake"); return `0x${"a".repeat(64)}`; } };
}

// ---------- in-memory HTTP driver (no listen) ----------
function call(server, { method = "POST", url = "/gift-gas", headers = {}, body, chunks } = {}) {
  const handler = server.listeners("request")[0];
  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = method; req.url = url;
    req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    let status = null; let hdrs = null; let destroyed = false;
    const origDestroy = req.destroy.bind(req);
    req.destroy = (...a) => { destroyed = true; return origDestroy(...a); };
    const res = {
      headersSent: false, writableEnded: false,
      writeHead(s, h) { status = s; hdrs = { ...h }; this.headersSent = true; return this; },
      end(data) { this.writableEnded = true; resolve({ status, headers: hdrs, raw: String(data ?? ""), json: data ? JSON.parse(String(data)) : null, destroyed: () => destroyed }); },
    };
    handler(req, res);
    const parts = chunks ?? (body === undefined ? [] : [typeof body === "string" ? body : JSON.stringify(body)]);
    for (const p of parts) req.write(p);
    req.end();
  });
}
const J = { "content-type": "application/json" };
const post = (server, body, headers = J) => call(server, { body, headers });

function mkGift({ authorize = ALLOW, allowedOrigins, omit = [], policy = POLICY, extra = {} } = {}) {
  const ledger = openGiftGasLedger(fresh("g"), {});
  const chain = fakeChain(); const signer = fakeSigner(); const logs = [];
  const giftGas = { ledger, policy, chain, signer, authorize, allowedOrigins, log: (m) => logs.push(m), ...extra };
  for (const k of omit) delete giftGas[k];
  const grantLedger = openLedger(fresh("grant"));
  const server = createRelayServer({ submitter: fakeSubmitter(), ledger: grantLedger, chainId: CHAIN_ID, policy: null, giftGas });
  return { server, ledger, chain, signer, logs, close: () => { ledger.close(); grantLedger.close(); } };
}
const NO_CORS = (r) => Object.keys(r.headers ?? {}).every((k) => !k.toLowerCase().startsWith("access-control-"));

// ---------- fail closed ----------
await test("F1. no giftGas configured (default server, as main() builds it) => 503 for every POST, nothing read/signed", async () => {
  const grantLedger = openLedger(fresh("grant"));
  const server = createRelayServer({ submitter: fakeSubmitter(), ledger: grantLedger, chainId: CHAIN_ID, policy: null });
  let r = await post(server, { giftId: gid(1), to: TO });
  assert.equal(r.status, 503); assert.deepEqual(r.json, { ok: false, error: "unavailable" });
  assert.equal(r.headers["cache-control"], "no-store"); assert.ok(NO_CORS(r));
  r = await call(server, { method: "GET" }); assert.equal(r.status, 405);
  r = await call(server, { method: "OPTIONS" }); assert.equal(r.status, 405); assert.ok(NO_CORS(r));
  grantLedger.close();
});
await test("F2. missing signer / chain / ledger / policy (or policy null, or signer without signNativeTransfer) => 503, chain+signer untouched", async () => {
  for (const omit of [["signer"], ["chain"], ["ledger"], ["policy"]]) {
    const g = mkGift({ omit }); g.chain.addGift(1);
    const r = await post(g.server, { giftId: gid(1), to: TO });
    assert.equal(r.status, 503, omit.join()); assert.equal(g.chain.calls, 0); assert.equal(g.signer.calls.length, 0);
    g.close();
  }
  const g = mkGift({ policy: null }); g.chain.addGift(1);
  assert.equal((await post(g.server, { giftId: gid(1), to: TO })).status, 503); g.close();
  const ledger = openGiftGasLedger(fresh("g"), {}); const chain = fakeChain(); chain.addGift(1); const gl = openLedger(fresh("grant"));
  const server = createRelayServer({ submitter: fakeSubmitter(), ledger: gl, giftGas: { ledger, policy: POLICY, chain, signer: {}, authorize: ALLOW } });
  assert.equal((await post(server, { giftId: gid(1), to: TO })).status, 503); assert.equal(chain.calls, 0);
  ledger.close(); gl.close();
});

// ---------- auth boundary ----------
await test("A1. auth hook absent => default deny 401; chain/signer/ledger untouched", async () => {
  const g = mkGift({ omit: ["authorize"] }); g.chain.addGift(1);
  const r = await post(g.server, { giftId: gid(1), to: TO });
  assert.equal(r.status, 401); assert.deepEqual(r.json, { ok: false, error: "unauthorized" });
  assert.equal(g.chain.calls, 0); assert.equal(g.signer.calls.length, 0); assert.equal(g.ledger.get(gid(1)), null);
  g.close();
});
await test("A2. only an exact `true` passes: truthy non-true, false, throw, async reject => 401; async true => passes", async () => {
  for (const authorize of [() => 1, () => "true", () => ({}), () => false, () => { throw new Error("x"); }, async () => { throw new Error("y"); }, async () => "yes", "not-a-fn"]) {
    const g = mkGift({ authorize }); g.chain.addGift(1);
    const r = await post(g.server, { giftId: gid(1), to: TO });
    assert.equal(r.status, 401); assert.equal(g.signer.calls.length, 0); assert.equal(g.chain.calls, 0);
    g.close();
  }
  const g = mkGift({ authorize: async () => true }); g.chain.addGift(1);
  assert.equal((await post(g.server, { giftId: gid(1), to: TO })).status, 200); g.close();
});
await test("A3. auth hook sees headers only (frozen copy), runs before the body is read, cannot mutate the request", async () => {
  let seen = null;
  const g = mkGift({ authorize: (ctx) => { seen = ctx; try { ctx.headers.authorization = "x"; } catch { /* frozen */ } return ctx.headers["x-test-auth"] === "ok"; } });
  g.chain.addGift(1);
  let r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, "x-test-auth": "no" } });
  assert.equal(r.status, 401);
  assert.deepEqual(Object.keys(seen).sort(), ["headers", "method", "url"]); assert.ok(Object.isFrozen(seen) && Object.isFrozen(seen.headers));
  assert.equal(seen.headers.authorization, undefined);
  r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, "x-test-auth": "ok" } });
  assert.equal(r.status, 200);
  g.close();
});

// ---------- origin / content-type / size ----------
await test("O1. Origin: not allowlisted / 'null' => 403; allowlisted => passes; absent => auth decides; cross/same-site fetch without Origin => 403; no CORS headers", async () => {
  const g = mkGift({ allowedOrigins: [GOOD_ORIGIN, "bad origin", 7] }); g.chain.addGift(1); g.chain.addGift(2); g.chain.addGift(3);
  for (const origin of ["https://evil.example", "null", "https://araso.example.evil", "http://araso.example", ""]) {
    const r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, origin } });
    assert.equal(r.status, 403, origin); assert.ok(NO_CORS(r));
  }
  for (const site of ["cross-site", "same-site"]) {
    const r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, "sec-fetch-site": site } });
    assert.equal(r.status, 403, site);
  }
  assert.equal(g.signer.calls.length, 0); assert.equal(g.chain.calls, 0);
  let r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, origin: GOOD_ORIGIN, "sec-fetch-site": "same-origin" } });
  assert.equal(r.status, 200); assert.ok(NO_CORS(r));
  r = await call(g.server, { body: { giftId: gid(2), to: TO }, headers: J }); assert.equal(r.status, 200);
  g.close();
  const g2 = mkGift(); g2.chain.addGift(1); // default: no origins allowed at all
  r = await call(g2.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, origin: GOOD_ORIGIN } }); assert.equal(r.status, 403);
  g2.close();
});
await test("C1. Content-Type must be application/json (charset=utf-8 ok); others => 415, nothing read", async () => {
  const g = mkGift(); g.chain.addGift(1);
  for (const ct of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/json; charset=latin1", "application/jsonx"]) {
    const headers = ct === undefined ? {} : { "content-type": ct };
    const r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers });
    assert.equal(r.status, 415, String(ct));
  }
  assert.equal(g.chain.calls, 0);
  const r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { "content-type": "application/json; charset=UTF-8" } });
  assert.equal(r.status, 200);
  g.close();
});
await test(`S1. body size: Content-Length > ${GIFT_GAS_MAX_BODY_BYTES} => 413 before auth; streamed oversize => 413 + destroy; bad Content-Length => 400`, async () => {
  let authCalls = 0;
  const g = mkGift({ authorize: () => { authCalls += 1; return true; } }); g.chain.addGift(1);
  let r = await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, "content-length": String(GIFT_GAS_MAX_BODY_BYTES + 1) } });
  assert.equal(r.status, 413); assert.equal(authCalls, 0);
  for (const cl of ["abc", "-1", "1e3", "9999999"]) {
    r = await call(g.server, { body: "{}", headers: { ...J, "content-length": cl } });
    assert.ok(r.status === 400 || r.status === 413, cl);
  }
  const big = JSON.stringify({ giftId: gid(1), to: TO, pad: "x".repeat(GIFT_GAS_MAX_BODY_BYTES) });
  r = await call(g.server, { chunks: [big.slice(0, 100), big.slice(100)], headers: J });
  assert.equal(r.status, 413); assert.ok(r.destroyed());
  // multibyte: counted in bytes, not string length
  r = await call(g.server, { chunks: ["é".repeat(GIFT_GAS_MAX_BODY_BYTES / 2 + 1)], headers: J });
  assert.equal(r.status, 413);
  assert.equal(g.signer.calls.length, 0); assert.equal(g.chain.calls, 0);
  g.close();
});

// ---------- [A-895 P-C] deadlines (A-874 R1 body-read, R2 auth hook) ----------
// Driver that leaves the request stream open (a slow / stalled client) so a deadline is the only way out.
function stalled(server, { headers = J, write = [] } = {}) {
  const handler = server.listeners("request")[0];
  return new Promise((resolve) => {
    const req = new PassThrough();
    req.method = "POST"; req.url = "/gift-gas"; req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    let status = null; let destroyed = false;
    const od = req.destroy.bind(req); req.destroy = (...a) => { destroyed = true; return od(...a); };
    const res = { headersSent: false, writableEnded: false,
      writeHead(s) { status = s; this.headersSent = true; return this; },
      end(data) { this.writableEnded = true; resolve({ status, json: data ? JSON.parse(String(data)) : null, destroyed: () => destroyed }); } };
    handler(req, res);
    for (const w of write) req.write(w);
    // never req.end(): the client stalls
  });
}
await test("T1. auth hook that never settles => 401 at the auth deadline, 0 chain / 0 sign; the hook's late `true` is ignored", async () => {
  assert.ok(GIFT_GAS_AUTH_TIMEOUT_MS >= 1 && GIFT_GAS_AUTH_TIMEOUT_MS <= 60000);
  let release; const gate = new Promise((r) => { release = r; });
  const g = mkGift({ authorize: () => gate, extra: { authTimeoutMs: 40 } }); g.chain.addGift(1);
  const t0 = Date.now();
  const r = await post(g.server, { giftId: gid(1), to: TO });
  assert.equal(r.status, 401); assert.deepEqual(r.json, { ok: false, error: "unauthorized" });
  assert.ok(Date.now() - t0 < 2000);
  release(true); await new Promise((x) => setTimeout(x, 20));
  assert.equal(g.signer.calls.length, 0); assert.equal(g.chain.calls, 0); assert.equal(g.ledger.get(gid(1)), null);
  g.close();
});
await test("T2. out-of-range / non-integer auth+body timeouts fall back to the defaults; a fast hook is not delayed", async () => {
  for (const bad of [0, -5, 1.5, NaN, "40", 10 ** 9, null]) {
    const g = mkGift({ extra: { authTimeoutMs: bad, bodyTimeoutMs: bad } }); g.chain.addGift(1);
    assert.equal((await post(g.server, { giftId: gid(1), to: TO })).status, 200); g.close();
  }
  assert.ok(GIFT_GAS_BODY_TIMEOUT_MS >= 1 && GIFT_GAS_BODY_TIMEOUT_MS <= 60000);
});
await test("T3. body never completes (slowloris) => 408 at the body deadline + destroy, service never called (0 chain / 0 sign / no ledger entry)", async () => {
  const g = mkGift({ extra: { bodyTimeoutMs: 40 } }); g.chain.addGift(1);
  const r = await stalled(g.server, { write: ['{"giftId":"', gid(1).slice(0, 20)] });
  assert.equal(r.status, 408); assert.deepEqual(r.json, { ok: false, error: "request timeout" }); assert.ok(r.destroyed());
  assert.equal(g.signer.calls.length, 0); assert.equal(g.chain.calls, 0); assert.equal(g.ledger.get(gid(1)), null);
  g.close();
});
await test("T4. a complete body inside the deadline is unaffected; the deadline timer does not fire after completion", async () => {
  const g = mkGift({ extra: { bodyTimeoutMs: 60 } }); g.chain.addGift(1);
  const r = await post(g.server, { giftId: gid(1), to: TO });
  assert.equal(r.status, 200);
  await new Promise((x) => setTimeout(x, 120)); // timer would have fired by now; no second response / no throw
  assert.equal(g.signer.calls.length, 1);
  g.close();
});

// ---------- strict body ----------
await test("B1. strict {giftId,to}: extra/missing fields, amount, uppercase id, bad json/utf8, arrays, __proto__ => 400, nothing sent", async () => {
  const g = mkGift(); g.chain.addGift(1);
  const bad = [
    { giftId: gid(1), to: TO, amount: "1" }, { giftId: gid(1), to: TO, valueWei: "1" }, { giftId: gid(1), to: TO, allowanceRef: gid(1) },
    { giftId: gid(1) }, { to: TO }, {}, [gid(1), TO], null, "x", 1,
    { giftId: `0x${"AB".repeat(32)}`, to: TO }, { giftId: gid(1), to: `0x${"0".repeat(40)}` }, { giftId: gid(1), to: "0x123" },
    { giftId: 1, to: TO },
  ];
  for (const b of bad) { const r = await post(g.server, b); assert.equal(r.status, 400, JSON.stringify(b)); }
  for (const raw of ["{", "", `{"giftId":"${gid(1)}","to":"${TO}","__proto__":{}}`]) {
    const r = await call(g.server, { chunks: raw ? [raw] : [], headers: J }); assert.equal(r.status, 400, raw);
  }
  const r = await call(g.server, { chunks: [Buffer.from([0x7b, 0xff, 0x7d])], headers: J }); assert.equal(r.status, 400);
  assert.equal(g.signer.calls.length, 0); assert.equal(g.chain.giftLookups, 0);
  g.close();
});

// ---------- A-869 semantics through the route ----------
await test("D1. happy path delegates to the A-869 service: 200 {ok,state,giftId,to,valueWei,txHash}, one sign, one broadcast", async () => {
  const g = mkGift(); g.chain.addGift(1);
  const r = await post(g.server, { giftId: gid(1), to: TO });
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), ["giftId", "ok", "state", "to", "txHash", "valueWei"]);
  assert.equal(r.json.state, "SENT"); assert.equal(r.json.to, TO); assert.equal(r.json.valueWei, String(CFG.valueWei));
  assert.equal(g.signer.calls.length, 1); assert.equal(g.chain.broadcasts.length, 1);
  assert.equal(r.json.txHash, keccak256(g.chain.broadcasts[0]));
  g.close();
});
await test("D2. duplicate same to => recorded entry, no new sign; different to => 409 not_available (same body as unknown gift)", async () => {
  const g = mkGift(); g.chain.addGift(1);
  const first = await post(g.server, { giftId: gid(1), to: TO });
  const again = await post(g.server, { giftId: gid(1), to: TO });
  assert.equal(again.status, 200); assert.equal(again.json.txHash, first.json.txHash);
  const other = await post(g.server, { giftId: gid(1), to: TO2 });
  const unknown = await post(g.server, { giftId: gid(9), to: TO });
  assert.equal(other.status, 409); assert.equal(other.raw, unknown.raw); assert.deepEqual(other.json, { ok: false, error: "not_available" });
  assert.equal(g.signer.calls.length, 1); assert.equal(g.chain.broadcasts.length, 1 + 1); // 2nd = same-bytes rebroadcast of SENT
  assert.equal(g.chain.broadcasts[1], g.chain.broadcasts[0]);
  g.close();
});
await test("D3. route output == direct A-869 service output for the same sequence (byte-equal bodies)", async () => {
  const g = mkGift(); g.chain.addGift(1); g.chain.addGift(2, { claimed: true });
  const ledger = openGiftGasLedger(fresh("g"), {}); const chain = fakeChain(); chain.addGift(1); chain.addGift(2, { claimed: true });
  const svc = createGiftGasService({ ledger, policy: POLICY, chain, signer: fakeSigner() });
  const seq = [{ giftId: gid(1), to: TO }, { giftId: gid(1), to: TO }, { giftId: gid(1), to: TO2 }, { giftId: gid(2), to: TO }, { giftId: gid(3), to: TO }, { giftId: gid(1), to: TO, x: 1 }];
  for (const b of seq) {
    const r = await post(g.server, b); const d = await svc.handle(b);
    assert.equal(r.status, d.status, JSON.stringify(b)); assert.equal(r.raw, JSON.stringify(d.body));
  }
  ledger.close(); g.close();
});
await test("D4. 20 concurrent authorized requests for one gift => exactly one sign", async () => {
  const g = mkGift(); g.chain.addGift(1);
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post(g.server, { giftId: gid(1), to: i % 2 ? TO : TO2 })));
  assert.equal(g.signer.calls.length, 1);
  const okTo = g.signer.calls[0].to;
  for (const r of rs) assert.ok(r.status === 200 ? r.json.to === okTo : r.status === 409);
  g.close();
});
await test("D5. fail-stopped ledger / relayer-wide failure => 503 from the service, nothing signed", async () => {
  const g = mkGift(); g.chain.addGift(1); g.chain.gasPrice = 10n ** 15n;
  let r = await post(g.server, { giftId: gid(1), to: TO }); assert.equal(r.status, 503); assert.equal(g.signer.calls.length, 0);
  g.close();
  const g2 = mkGift(); g2.chain.addGift(1); g2.ledger.isFailStopped = () => true;
  r = await post(g2.server, { giftId: gid(1), to: TO }); assert.equal(r.status, 503); assert.equal(g2.signer.calls.length, 0);
  g2.close();
});
await test("L1. route logs are fixed codes only (no headers, tokens, bodies, full giftId)", async () => {
  const g = mkGift({ authorize: (c) => c.headers.authorization === "Bearer SECRET-TOKEN" }); g.chain.addGift(1);
  await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, authorization: "Bearer WRONG-TOKEN" } });
  await call(g.server, { body: { giftId: gid(1), to: TO }, headers: { ...J, authorization: "Bearer SECRET-TOKEN" } });
  const all = g.logs.join("\n");
  assert.ok(!/TOKEN|Bearer|authorization/i.test(all)); assert.ok(!all.includes(gid(1))); assert.ok(!all.includes(TO));
  g.close();
});
await test("SRC1. route never touches ledger/chain/signer itself (only service.handle); main() wires no /gift-gas", async () => {
  const src = readFileSync(SERVER_SRC, "utf8");
  const a = src.indexOf("export function createGiftGasRoute"); const b = src.indexOf("export function createRelayServer");
  const route = src.slice(a, b);
  assert.ok(a > 0 && b > a);
  assert.ok(!/\.(signNativeTransfer|broadcast|getGift|reserve|recordSigned|confirm|markUnknown|getBalance)\s*\(/.test(route));
  assert.equal((route.match(/service\.handle\(/g) ?? []).length, 1);
  assert.ok(src.includes("createRelayServer({ submitter, ledger, ledgerError, log: console.log, chainId, policy });"));
  assert.ok(!/giftGas/.test(src.slice(src.indexOf("async function main()"))));
});

// ---------- /grant regression ----------
// sha256 of the pre-A-874 /health + /grant handler body (from `if (req.url === "/health")` up to listenLocal's doc comment)
// and of the submitter/main() tail, computed from server.mjs at git 082d410 (blob c34fccf7).
const PRE_GRANT_REGION_SHA256 = "e1903aa6199972557b32e6f6a57c4465342d1aabc87c1755a8907c1956ea9e5c";
const PRE_TAIL_SHA256 = "b9066e6c6b2448556893c5c46f45ff3c6f4eae01b63550800517694a896bba78";
await test("R1. /health + /grant handler source region and main() are byte-identical to pre-A-874", async () => {
  const src = readFileSync(SERVER_SRC, "utf8");
  const a = src.indexOf('    if (req.url === "/health") {'); const b = src.indexOf("/** [relayer safety] 실험 relayer 는 루프백에만 bind");
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  assert.equal(sha(src.slice(a, b)), PRE_GRANT_REGION_SHA256);
  assert.equal(sha(src.slice(src.indexOf("function createViemSubmitter"))), PRE_TAIL_SHA256);
  assert.ok(src.includes('function respond(res, status, body) {\n  res.writeHead(status, { "content-type": "application/json" });\n  res.end(JSON.stringify(body));\n}'));
});

const A1 = `0x${"1".repeat(40)}`; const A2 = `0x${"2".repeat(40)}`; const OUT = `0x${"3".repeat(40)}`;
async function grantMatrix(giftGasFactory) {
  const out = [];
  const run = async (opts, steps) => {
    const ledger = opts.ledger === null ? null : openLedger(fresh("grant"));
    const sub = fakeSubmitter({ fail: !!opts.fail });
    const gg = giftGasFactory();
    const server = createRelayServer({ submitter: sub, ledger, ledgerError: opts.ledgerError ?? null, chainId: "chainId" in opts ? opts.chainId : CHAIN_ID, policy: opts.policy ?? null, giftGas: gg?.cfg ?? null });
    for (const s of steps) {
      const r = await call(server, s);
      out.push({ s: `${s.method ?? "POST"} ${s.url} ${s.body === undefined ? "" : JSON.stringify(s.body)}`, status: r.status, headers: r.headers, raw: r.raw });
    }
    out.push({ sent: sub.sent.map((x) => ({ to: x.to, v: String(x.valueWei) })), entries: ledger ? [A1, A2, OUT].map((x) => ledger.get(x)?.status ?? null) : null });
    ledger?.close(); gg?.close();
  };
  const G = (body, extra = {}) => ({ url: "/grant", body, headers: J, ...extra });
  await run({ policy: createGrantPolicy(`${A1},${A2}`) }, [
    { method: "GET", url: "/health" }, { method: "POST", url: "/health", body: {} }, { method: "GET", url: "/grant" }, { method: "GET", url: "/nope" },
    { method: "GET", url: "/gift-gas/x" }, { method: "POST", url: "/grant?x=1", body: { address: A1 } },
    G({ address: "nope" }), G({ address: A1, amount: "9" }), G("{bad", {}), G({ address: OUT }),
    G({ address: A1 }), G({ address: A1 }), G({ address: A2 }), G({ address: A1 }, { headers: {} }),
  ]);
  await run({ policy: null, chainId: null }, [{ method: "GET", url: "/health" }, G({ address: A1 })]);
  await run({ ledger: null, ledgerError: "LEDGER_SCHEMA: x", policy: createGrantPolicy(A1) }, [G({ address: A1 })]);
  await run({ fail: true, policy: createGrantPolicy(A1) }, [G({ address: A1 }), G({ address: A1 })]);
  await run({ policy: createGrantPolicy(A1) }, [{ url: "/grant", chunks: ["x".repeat(2000)], headers: J }]);
  return out;
}
await test("R2. /grant + /health behavior identical with /gift-gas unconfigured vs fully configured (+ golden expectations)", async () => {
  const base = await grantMatrix(() => null);
  const withGift = await grantMatrix(() => { const g = mkGift(); g.chain.addGift(1); return { cfg: { ledger: g.ledger, policy: POLICY, chain: g.chain, signer: g.signer, authorize: ALLOW }, close: () => g.ledger.close() }; });
  // ledgers are opened per run, so drop the grant-ledger-specific fields: none are in responses. Compare everything.
  assert.deepEqual(withGift, base);
  const st = base.filter((x) => x.status !== undefined).map((x) => `${x.status} ${x.raw}`);
  const H = (o) => JSON.stringify(o);
  assert.deepEqual(st, [
    `200 ${H({ ok: true, chainId: 10143, grantPolicy: true })}`, `405 ${H({ ok: false, error: "method not allowed" })}`, `405 ${H({ ok: false, error: "method not allowed" })}`,
    `404 ${H({ ok: false, error: "not found" })}`, `404 ${H({ ok: false, error: "not found" })}`, `404 ${H({ ok: false, error: "not found" })}`,
    `400 ${H({ ok: false, error: "invalid address" })}`, `400 ${H({ ok: false, error: "unexpected fields" })}`, `400 ${H({ ok: false, error: "invalid json" })}`,
    `403 ${H({ ok: false, error: "address not allowed" })}`, `200 ${H({ ok: true, txHash: `0x${"a".repeat(64)}` })}`, `409 ${H({ ok: false, error: "already granted" })}`,
    `403 ${H({ ok: false, error: "total grant cap reached" })}`, `409 ${H({ ok: false, error: "already granted" })}`,
    `200 ${H({ ok: false, chainId: null, grantPolicy: false })}`, `403 ${H({ ok: false, error: "no grant policy" })}`,
    `500 ${H({ ok: false, error: "ledger unavailable: LEDGER_SCHEMA: x" })}`,
    `502 ${H({ ok: false, error: "grant failed" })}`, `409 ${H({ ok: false, error: "already granted" })}`,
    `413 ${H({ ok: false, error: "payload too large" })}`,
  ]);
  for (const x of base) if (x.headers) assert.deepEqual(x.headers, { "content-type": "application/json" });
  const sends = base.filter((x) => x.sent).map((x) => x.sent.length);
  assert.deepEqual(sends, [1, 0, 0, 1, 0]);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\nA-874 gift-gas route: ${pass} PASS, 0 FAIL`);
