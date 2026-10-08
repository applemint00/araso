// A-884 · Gift gas client adapter (app/src/gift-gas-client.js): strict {giftId,to}, injected fetch only,
// HTTPS/same-origin policy, timeout, state/status parsing, fail closed, no resend authority, no fallback,
// nothing persisted/logged. No network: every fetch is a fake; the bridge cases drive the real A-874 route
// handler (relayer/src/server.mjs createGiftGasRoute) in-process with fake req/res objects (no port).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  GIFT_GAS_CLIENT_OUTCOME as O, GIFT_GAS_TRANSPORT as T, createGiftGasClient, parseGiftGasResponse,
  resolveGiftGasEndpoint, validateGiftGasClientRequest,
} from "../src/gift-gas-client.js";
import { createGiftGasRoute } from "../../relayer/src/server.mjs";

const SRC = readFileSync(new URL("../src/gift-gas-client.js", import.meta.url), "utf8");
const CODE = SRC.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n"); // code lines only
let n = 0;
const ok = (name) => { n++; console.log("PASS", name); };

const GID = "0x" + "ab".repeat(32);
const GID2 = "0x" + "cd".repeat(32);
const TO_MIXED = "0x" + "AbCdEf0123".repeat(4);
const TO = TO_MIXED.toLowerCase();
const TX = "0x" + "12".repeat(32);
const ENDPOINT = "https://relay.example/gift-gas";
const JSON_CT = "application/json";

function fakeResponse(status, text, { ct = JSON_CT, url, redirected = false, type = "basic", textImpl } = {}) {
  return {
    status, url: url ?? ENDPOINT, redirected, type,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? ct : null) },
    text: textImpl ?? (async () => text),
  };
}
const record = (state, txHash, extra = {}) => JSON.stringify({ ok: true, state, giftId: GID, to: TO, valueWei: "50000000000000000", txHash, ...extra });

function mkFetch(responder) {
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return Promise.resolve().then(() => responder(url, init, calls.length)); };
  f.calls = calls;
  return f;
}
function client(fetch, extra = {}) {
  return createGiftGasClient({ fetch, transport: T.HTTPS, endpoint: ENDPOINT, ...extra });
}
function noAuthority(out) {
  assert.ok(Object.isFrozen(out));
  assert.equal(out.authority, "observation_only");
  assert.equal(out.localDelivery, false);
  for (const k of Object.keys(out)) assert.ok(!/resend|retry|canSend|permission|executable|signer|token|credential|secret/i.test(k), `forbidden key ${k}`);
}

// ── 1. strict request {giftId,to} ────────────────────────────────────────────────────────────────────────
{
  const good = validateGiftGasClientRequest({ giftId: GID, to: TO_MIXED });
  assert.deepEqual({ ...good }, { ok: true, giftId: GID, to: TO });
  const bad = [
    null, undefined, "x", 1, [], [GID, TO],
    {}, { giftId: GID }, { to: TO },
    { giftId: GID, to: TO, amount: "1" }, { giftId: GID, to: TO, token: "t" }, { giftId: GID, to: TO, valueWei: "1" },
    { giftId: GID.toUpperCase().replace("0X", "0x"), to: TO }, { giftId: GID.slice(0, 65), to: TO }, { giftId: GID + "00", to: TO },
    { giftId: GID.slice(2), to: TO }, { giftId: 1, to: TO }, { giftId: GID, to: TO.slice(0, 41) }, { giftId: GID, to: "0x" + "0".repeat(40) },
    { giftId: GID, to: "0x" + "g".repeat(40) }, { giftId: GID, to: null },
    Object.create({ giftId: GID, to: TO }),
    new (class X { constructor() { this.giftId = GID; this.to = TO; } })(),
    Object.defineProperty({ to: TO }, "giftId", { enumerable: true, get: () => GID }),
    Object.assign({ giftId: GID, to: TO }, { [Symbol("x")]: 1 }),
    Object.defineProperty({ giftId: GID, to: TO }, "hidden", { enumerable: false, value: 1 }),
  ];
  for (const b of bad) assert.equal(validateGiftGasClientRequest(b).ok, false, `accepted ${String(b && JSON.stringify(b))}`);
  const nullProto = Object.assign(Object.create(null), { giftId: GID, to: TO });
  assert.equal(validateGiftGasClientRequest(nullProto).ok, true);

  const f = mkFetch(() => fakeResponse(200, record("CONFIRMED", TX)));
  const c = client(f);
  for (const b of bad) {
    const out = await c.request(b);
    assert.equal(out.outcome, O.INVALID_REQUEST); assert.equal(out.ok, false); assert.equal(out.reachedServer, "no"); noAuthority(out);
  }
  assert.equal(f.calls.length, 0, "invalid request must never reach fetch");
  ok("strict request: exactly {giftId,to}, lowercase bytes32, non-zero address, data props only; invalid => 0 fetch");
}

// ── 2. injected fetch only / transport policy / timeout bounds ───────────────────────────────────────────
{
  let globalHits = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = () => { globalHits++; return Promise.reject(new Error("global fetch must not be used")); };
  try {
    for (const fetch of [undefined, null, "fetch", {}, 1]) {
      const c = createGiftGasClient({ fetch, transport: T.HTTPS, endpoint: ENDPOINT });
      assert.equal(c.configError, "no_fetch");
      const out = await c.request({ giftId: GID, to: TO });
      assert.equal(out.outcome, O.INVALID_CONFIG); assert.equal(out.reachedServer, "no"); noAuthority(out);
    }
    assert.equal(createGiftGasClient().configError, "no_fetch");
  } finally { globalThis.fetch = saved; }
  assert.equal(globalHits, 0);
  ok("no global fetch fallback: missing fetch => invalid_config, global fetch 0 calls");

  const R = (o) => resolveGiftGasEndpoint(o);
  assert.deepEqual({ ...R({ transport: T.HTTPS, endpoint: ENDPOINT }) }, { ok: true, url: ENDPOINT, mode: "cors" });
  assert.deepEqual({ ...R({ transport: T.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: "https://arasoo.vercel.app" }) },
    { ok: true, url: "https://arasoo.vercel.app/gift-gas", mode: "same-origin" });
  assert.equal(R({ transport: T.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: "http://localhost:5173" }).ok, true);
  const refusedEndpoints = [
    [{ transport: T.HTTPS, endpoint: "http://relay.example/gift-gas" }, "not_https"],
    [{ transport: T.HTTPS, endpoint: "/gift-gas" }, "not_https"],
    [{ transport: T.HTTPS, endpoint: "//relay.example/gift-gas" }, "not_https"],
    [{ transport: T.HTTPS, endpoint: "https://relay.example/grant" }, "wrong_path"],
    [{ transport: T.HTTPS, endpoint: "https://relay.example/gift-gas/" }, "wrong_path"],
    [{ transport: T.HTTPS, endpoint: "https://relay.example/x/../gift-gas/x" }, "wrong_path"],
    [{ transport: T.HTTPS, endpoint: "https://relay.example/gift-gas?x=1" }, "query_or_fragment"],
    [{ transport: T.HTTPS, endpoint: "https://relay.example/gift-gas?" }, "query_or_fragment"],
    [{ transport: T.HTTPS, endpoint: "https://relay.example/gift-gas#a" }, "query_or_fragment"],
    [{ transport: T.HTTPS, endpoint: ["https://u", "p@relay.example/gift-gas"].join(":") }, "credentials_in_url"],
    [{ transport: T.HTTPS, endpoint: "https://u@relay.example/gift-gas" }, "credentials_in_url"],
    [{ transport: T.HTTPS, endpoint: " https://relay.example/gift-gas" }, "bad_endpoint"],
    [{ transport: T.HTTPS, endpoint: "" }, "bad_endpoint"],
    [{ transport: T.HTTPS, endpoint: 5 }, "bad_endpoint"],
    [{ transport: "http", endpoint: ENDPOINT }, "bad_transport"],
    [{ endpoint: ENDPOINT }, "bad_transport"],
    [{ transport: T.SAME_ORIGIN, endpoint: "/gift-gas" }, "no_page_origin"],
    [{ transport: T.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: "https://a.example/" }, "bad_page_origin"],
    [{ transport: T.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: "null" }, "bad_endpoint"],
    [{ transport: T.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: "file:///x" }, "bad_page_origin"],
    [{ transport: T.SAME_ORIGIN, endpoint: "https://evil.example/gift-gas", pageOrigin: "https://a.example" }, "cross_origin"],
    [{ transport: T.SAME_ORIGIN, endpoint: "//evil.example/gift-gas", pageOrigin: "https://a.example" }, "cross_origin"],
    [{ transport: T.SAME_ORIGIN, endpoint: "/grant", pageOrigin: "https://a.example" }, "wrong_path"],
  ];
  for (const [cfg, reason] of refusedEndpoints) {
    const r = R(cfg);
    assert.equal(r.ok, false, JSON.stringify(cfg)); assert.equal(r.reason, reason, JSON.stringify(cfg));
    const f = mkFetch(() => fakeResponse(200, record("CONFIRMED", TX)));
    const c = createGiftGasClient({ fetch: f, ...cfg });
    assert.equal((await c.request({ giftId: GID, to: TO })).outcome, O.INVALID_CONFIG);
    assert.equal(f.calls.length, 0);
  }
  for (const timeoutMs of [0, 999, 60001, 1.5, "15000", NaN, null]) {
    assert.equal(client(mkFetch(() => null), { timeoutMs }).configError, "bad_timeout", String(timeoutMs));
  }
  assert.equal(client(mkFetch(() => null), { timeoutMs: 1000 }).configError, null);
  ok("transport policy: https only or exact same-origin; path exactly /gift-gas; no query/fragment/userinfo; timeout bounds");
}

// ── 3. request bytes: no invented auth, no cookies, no redirects ────────────────────────────────────────
{
  const f = mkFetch(() => fakeResponse(200, record("CONFIRMED", TX)));
  const out = await client(f).request({ giftId: GID, to: TO_MIXED });
  assert.equal(out.outcome, O.CONFIRMED);
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.equal(init.mode, "cors");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.deepEqual(init.headers, { "content-type": "application/json" });
  assert.equal(init.body, JSON.stringify({ giftId: GID, to: TO }));
  assert.deepEqual(Object.keys(JSON.parse(init.body)), ["giftId", "to"]);
  assert.ok(Buffer.byteLength(init.body) <= 256);
  assert.ok(init.signal && typeof init.signal.aborted === "boolean");
  assert.deepEqual(Object.keys(init).sort(), ["body", "cache", "credentials", "headers", "method", "mode", "redirect", "referrerPolicy", "signal"]);

  const f2 = mkFetch(() => fakeResponse(200, record("CONFIRMED", TX), { url: "https://a.example/gift-gas" }));
  const so = createGiftGasClient({ fetch: f2, transport: T.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: "https://a.example" });
  assert.equal((await so.request({ giftId: GID, to: TO })).outcome, O.CONFIRMED);
  assert.equal(f2.calls[0].url, "https://a.example/gift-gas");
  assert.equal(f2.calls[0].init.mode, "same-origin");
  assert.equal(f2.calls[0].init.credentials, "omit");
  ok("request bytes: POST exact {giftId,to}, only content-type header, credentials omit, redirect error, no-store");
}

// ── 4. 200 ledger states ────────────────────────────────────────────────────────────────────────────────
{
  const cases = [
    ["CONFIRMED", TX, O.CONFIRMED, true, true],
    ["SENT", TX, O.SENT, true, false],
    ["PENDING", null, O.PENDING, true, false],
    ["UNKNOWN", null, O.UNKNOWN, false, false],
    ["UNKNOWN", TX, O.UNKNOWN, false, false],
  ];
  for (const [state, tx, want, wantOk, settled] of cases) {
    const f = mkFetch(() => fakeResponse(200, record(state, tx)));
    const out = await client(f).request({ giftId: GID, to: TO });
    assert.equal(out.outcome, want); assert.equal(out.state, state); assert.equal(out.ok, wantOk); assert.equal(out.settled, settled);
    assert.equal(out.reachedServer, "yes"); assert.equal(out.httpStatus, 200);
    assert.equal(out.giftId, GID); assert.equal(out.to, TO); assert.equal(out.txHash, tx); assert.equal(out.valueWei, "50000000000000000");
    noAuthority(out);
  }
  ok("200 states: CONFIRMED settled; SENT/PENDING not settled; UNKNOWN ok:false; all observation_only");
}

// ── 5. HTTP refusals ────────────────────────────────────────────────────────────────────────────────────
{
  const table = [
    [400, "bad_request", O.BAD_REQUEST], [401, "unauthorized", O.UNAUTHORIZED], [403, "forbidden", O.FORBIDDEN],
    [404, "not found", O.NOT_FOUND], [405, "method not allowed", O.METHOD_NOT_ALLOWED], [409, "not_available", O.NOT_AVAILABLE],
    [413, "payload too large", O.PAYLOAD_TOO_LARGE], [415, "unsupported media type", O.UNSUPPORTED_MEDIA_TYPE], [503, "unavailable", O.UNAVAILABLE],
  ];
  for (const [status, error, want] of table) {
    const f = mkFetch(() => fakeResponse(status, JSON.stringify({ ok: false, error })));
    const out = await client(f).request({ giftId: GID, to: TO });
    assert.equal(out.outcome, want, String(status)); assert.equal(out.ok, false); assert.equal(out.settled, false);
    assert.equal(out.httpStatus, status); assert.equal(out.reachedServer, "yes"); noAuthority(out);
    assert.equal(f.calls.length, 1, "no retry after a refusal");
    // the same status with another error body is ambiguous -> malformed
    const wrong = table.find((r) => r[1] !== error)[1];
    const f2 = mkFetch(() => fakeResponse(status, JSON.stringify({ ok: false, error: wrong })));
    assert.equal((await client(f2).request({ giftId: GID, to: TO })).outcome, O.MALFORMED_RESPONSE, `${status} with ${wrong}`);
  }
  // 401/403 never trigger any client-side auth attempt: one call, no headers added
  const f = mkFetch(() => fakeResponse(401, JSON.stringify({ ok: false, error: "unauthorized" })));
  const c = client(f);
  await c.request({ giftId: GID, to: TO });
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].init.headers, { "content-type": "application/json" });
  ok("HTTP 400/401/403/404/405/409/413/415/503 classified by exact server body; no retry; no auth invented");
}

// ── 6. malformed / ambiguous => fail closed ────────────────────────────────────────────────────────────
{
  const req = { giftId: GID, to: TO };
  const P = (status, text, opts = {}) => parseGiftGasResponse({ status, contentType: "ct" in opts ? opts.ct : JSON_CT, text, redirected: opts.redirected }, req);
  const malformed = [
    ["unexpected 200 ok:false", P(200, JSON.stringify({ ok: false, error: "unavailable" }))],
    ["extra key", P(200, record("CONFIRMED", TX, { canSend: true }))],
    ["missing txHash key", P(200, JSON.stringify({ ok: true, state: "CONFIRMED", giftId: GID, to: TO, valueWei: "1" }))],
    ["duplicate key", P(200, record("PENDING", null).replace('"state":"PENDING"', '"state":"CONFIRMED","state":"PENDING"'))],
    ["duplicate error key", P(409, '{"ok":false,"error":"unavailable","error":"not_available"}')],
    ["whitespace padding", P(200, " " + record("CONFIRMED", TX))],
    ["pretty JSON", P(200, JSON.stringify(JSON.parse(record("CONFIRMED", TX)), null, 2))],
    ["unicode escape", P(409, '{"ok":false,"error":"not\\u005favailable"}')],
    ["giftId echo mismatch", P(200, record("CONFIRMED", TX, { giftId: GID2 }))],
    ["giftId echo uppercase", P(200, record("CONFIRMED", TX, { giftId: GID.toUpperCase().replace("0X", "0x") }))],
    ["to echo mismatch", P(200, record("CONFIRMED", TX, { to: "0x" + "11".repeat(20) }))],
    ["to echo mixed case", P(200, record("CONFIRMED", TX, { to: TO_MIXED }))],
    ["valueWei number", P(200, record("CONFIRMED", TX, { valueWei: 5 }))],
    ["valueWei zero", P(200, record("CONFIRMED", TX, { valueWei: "0" }))],
    ["valueWei leading zero", P(200, record("CONFIRMED", TX, { valueWei: "05" }))],
    ["valueWei negative", P(200, record("CONFIRMED", TX, { valueWei: "-5" }))],
    ["txHash short", P(200, record("CONFIRMED", TX.slice(0, 60)))],
    ["txHash uppercase", P(200, record("CONFIRMED", TX.toUpperCase().replace("0X", "0x").replace(/12/g, "AB")))],
    ["PENDING with txHash", P(200, record("PENDING", TX))],
    ["SENT without txHash", P(200, record("SENT", null))],
    ["CONFIRMED without txHash", P(200, record("CONFIRMED", null))],
    ["lowercase state", P(200, record("confirmed", TX))],
    ["invented state", P(200, record("DONE", TX))],
    ["state proto key", P(200, record("toString", TX))],
    ["ok string", P(200, record("CONFIRMED", TX, { ok: "true" }))],
    ["array body", P(200, "[1]")],
    ["null body", P(200, "null")],
    ["empty body", P(200, "")],
    ["not json", P(200, "<html>ok</html>")],
    ["html 404", P(404, "<html>404</html>")],
    ["oversize", P(200, record("CONFIRMED", TX) + " ".repeat(2000))],
    ["text/html ct", P(200, record("CONFIRMED", TX), { ct: "text/html" })],
    ["missing ct", P(200, record("CONFIRMED", TX), { ct: null })],
    ["json charset other", P(200, record("CONFIRMED", TX), { ct: "application/json; charset=latin1" })],
    ["redirected", P(200, record("CONFIRMED", TX), { redirected: true })],
    ["201", P(201, record("CONFIRMED", TX))],
    ["204", P(204, "")],
    ["302", P(302, JSON.stringify({ ok: false, error: "x" }))],
    ["429", P(429, JSON.stringify({ ok: false, error: "too many" }))],
    ["500", P(500, JSON.stringify({ ok: false, error: "unavailable" }))],
    ["502", P(502, JSON.stringify({ ok: false, error: "unavailable" }))],
    ["status string", P("200", record("CONFIRMED", TX))],
    ["error extra key", P(503, JSON.stringify({ ok: false, error: "unavailable", retryAfter: 1 }))],
    ["error ok true", P(409, JSON.stringify({ ok: true, error: "not_available" }))],
    ["no reply", parseGiftGasResponse(null, req)],
    ["no request", parseGiftGasResponse({ status: 200, contentType: JSON_CT, text: record("CONFIRMED", TX) }, null)],
  ];
  for (const [name, out] of malformed) {
    assert.equal(out.outcome, O.MALFORMED_RESPONSE, name); assert.equal(out.ok, false, name); assert.equal(out.settled, false, name);
    noAuthority(out);
  }
  assert.equal(P(200, record("CONFIRMED", TX), { ct: "application/json; charset=utf-8" }).outcome, O.CONFIRMED);

  // response-object level faults through the client
  const objFaults = [
    ["null response", () => null],
    ["no text()", () => ({ status: 200, headers: { get: () => JSON_CT } })],
    ["no headers", () => ({ status: 200, text: async () => record("CONFIRMED", TX), url: ENDPOINT })],
    ["headers.get throws", () => ({ status: 200, headers: { get: () => { throw new Error("x"); } }, text: async () => record("CONFIRMED", TX) })],
    ["text() rejects", () => fakeResponse(200, "", { textImpl: () => Promise.reject(new Error("x")) })],
    ["redirected flag", () => fakeResponse(200, record("CONFIRMED", TX), { redirected: true })],
    ["opaqueredirect", () => fakeResponse(0, "", { type: "opaqueredirect" })],
    ["final url differs", () => fakeResponse(200, record("CONFIRMED", TX), { url: "https://other.example/gift-gas" })],
  ];
  for (const [name, mk] of objFaults) {
    const f = mkFetch(mk);
    const out = await client(f).request({ giftId: GID, to: TO });
    assert.equal(out.outcome, O.MALFORMED_RESPONSE, name); assert.equal(out.ok, false); assert.equal(f.calls.length, 1, name);
  }
  ok(`malformed/ambiguous replies fail closed (${malformed.length} parser cases + ${objFaults.length} response-object cases)`);
}

// ── 7. timeout / network / abort => reachedServer unknown, no retry ─────────────────────────────────────
{
  function fakeTimers() {
    const pending = new Map(); let id = 0;
    return {
      setTimeout: (fn, ms) => { id++; pending.set(id, { fn, ms }); return id; },
      clearTimeout: (h) => { pending.delete(h); },
      fire: () => { for (const [k, t] of [...pending]) { pending.delete(k); t.fn(); } },
      pending,
    };
  }
  // fetch never settles -> timer fires -> timeout
  {
    const tm = fakeTimers();
    let seenSignal = null;
    const f = mkFetch((_u, init) => { seenSignal = init.signal; return new Promise(() => {}); });
    const p = client(f, { timers: tm, timeoutMs: 5000 }).request({ giftId: GID, to: TO });
    await new Promise((r) => setImmediate(r));
    assert.equal([...tm.pending.values()][0].ms, 5000);
    tm.fire();
    const out = await p;
    assert.equal(out.outcome, O.TIMEOUT); assert.equal(out.reachedServer, "unknown"); assert.equal(out.ok, false); noAuthority(out);
    assert.equal(seenSignal.aborted, true, "fetch signal aborted on timeout");
    assert.equal(f.calls.length, 1);
  }
  // headers arrive, body hangs -> timeout
  {
    const tm = fakeTimers();
    const f = mkFetch(() => fakeResponse(200, "", { textImpl: () => new Promise(() => {}) }));
    const p = client(f, { timers: tm }).request({ giftId: GID, to: TO });
    await new Promise((r) => setImmediate(r));
    tm.fire();
    const out = await p;
    assert.equal(out.outcome, O.TIMEOUT); assert.equal(out.reachedServer, "unknown"); assert.equal(out.httpStatus, 200);
  }
  // timer cleared after a normal reply
  {
    const tm = fakeTimers();
    const out = await client(mkFetch(() => fakeResponse(200, record("SENT", TX))), { timers: tm }).request({ giftId: GID, to: TO });
    assert.equal(out.outcome, O.SENT); assert.equal(tm.pending.size, 0);
  }
  // network error
  {
    const f = mkFetch(() => { throw new TypeError("Failed to fetch"); });
    const out = await client(f).request({ giftId: GID, to: TO });
    assert.equal(out.outcome, O.NETWORK_ERROR); assert.equal(out.reachedServer, "unknown"); assert.equal(f.calls.length, 1);
    const f2 = (() => { const c = []; const g = (u, i) => { c.push(u); throw new Error("sync throw"); }; g.calls = c; return g; })();
    const out2 = await client(f2).request({ giftId: GID, to: TO });
    assert.equal(out2.outcome, O.NETWORK_ERROR); assert.equal(f2.calls.length, 1);
  }
  // caller abort: before (no fetch) and during (unknown)
  {
    const f = mkFetch(() => new Promise(() => {}));
    const pre = new AbortController(); pre.abort();
    const out0 = await client(f).request({ giftId: GID, to: TO }, { signal: pre.signal });
    assert.equal(out0.outcome, O.ABORTED); assert.equal(out0.reachedServer, "no"); assert.equal(f.calls.length, 0);
    const ac = new AbortController();
    const tm = fakeTimers();
    const p = client(f, { timers: tm }).request({ giftId: GID, to: TO }, { signal: ac.signal });
    await new Promise((r) => setImmediate(r));
    ac.abort();
    const out1 = await p;
    assert.equal(out1.outcome, O.ABORTED); assert.equal(out1.reachedServer, "unknown"); assert.equal(f.calls.length, 1);
    assert.equal(tm.pending.size, 0, "timer cleared after abort");
    const out2 = await client(f).request({ giftId: GID, to: TO }, { signal: { aborted: "no" } });
    assert.equal(out2.outcome, O.INVALID_REQUEST);
  }
  ok("timeout (fetch and body), network error, caller abort => ok:false, reachedServer unknown, 1 fetch, timer cleared");
}

// ── 8. duplicate / already-sent never grants resend authority ───────────────────────────────────────────
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = mkFetch(async () => { await gate; return fakeResponse(200, record("SENT", TX)); });
  const c = client(f);
  const a = c.request({ giftId: GID, to: TO });
  const b = c.request({ giftId: GID, to: TO_MIXED }); // same destination, other case
  const conflict = await c.request({ giftId: GID, to: "0x" + "22".repeat(20) });
  assert.equal(conflict.outcome, O.IN_FLIGHT_CONFLICT); assert.equal(conflict.reachedServer, "no");
  // pre-A-895 baseline: assert.equal(a, b) (same promise object). A-895 P-B L3: each caller has its own promise
  // (so a joiner's abort is its own); the SHARED thing is the single fetch and its one result object (checked below).
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, rb); assert.equal(ra.outcome, O.SENT);
  assert.equal(f.calls.length, 1, "duplicate concurrent calls => exactly one fetch");
  noAuthority(ra);
  // after a SENT/UNKNOWN/not_available reply, the client does nothing on its own
  for (const body of [record("SENT", TX), record("UNKNOWN", null), record("PENDING", null)]) {
    const g = mkFetch(() => fakeResponse(200, body));
    await client(g).request({ giftId: GID, to: TO });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(g.calls.length, 1, "no automatic follow-up / resend");
  }
  // in-flight slot released after settle: a later explicit call is a fresh single status call
  const h = mkFetch(() => fakeResponse(409, JSON.stringify({ ok: false, error: "not_available" })));
  const ch = client(h);
  await ch.request({ giftId: GID, to: TO }); await ch.request({ giftId: GID, to: TO });
  assert.equal(h.calls.length, 2);
  // the module exposes only request(); no send/resend/sign API
  assert.deepEqual(Object.keys(c).sort(), ["configError", "request"]);
  ok("duplicate/already-sent: 1 shared fetch, conflict refused locally, no auto-resend, outcome carries no authority");
}

// ── 9. bridge to the real A-874 route handler (in-process, no port) ─────────────────────────────────────
{
  function routeFetch(route) {
    const f = (url, init) => new Promise((resolve) => {
      const req = new EventEmitter();
      req.method = init.method; req.url = new URL(url).pathname; req.destroy = () => {};
      req.headers = { ...Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])), "content-length": String(Buffer.byteLength(init.body)) };
      const res = {
        headersSent: false, writableEnded: false, status: 0, hdrs: {},
        writeHead(s, h) { this.status = s; this.hdrs = h; this.headersSent = true; },
        end(b) { this.writableEnded = true; resolve({ status: this.status, url, redirected: false, type: "basic", headers: { get: (k) => this.hdrs[k.toLowerCase()] ?? null }, text: async () => b }); },
      };
      route(req, res);
      setImmediate(() => { req.emit("data", Buffer.from(init.body)); req.emit("end"); });
    });
    return f;
  }
  // unconfigured route (what main() ships today) => 503 unavailable
  const out503 = await client(routeFetch(createGiftGasRoute(null))).request({ giftId: GID, to: TO });
  assert.equal(out503.outcome, O.UNAVAILABLE); assert.equal(out503.httpStatus, 503);

  const policy = { relayerAddress: "0x" + "99".repeat(20) };
  const entries = new Map();
  const ledger = { get: (g) => entries.get(g) ?? null, isFailStopped: () => false, list: () => [...entries.values()] };
  const chain = { getReceipt: async () => null, getLatestNonce: async () => 0n, broadcast: async () => TX };
  const signer = { signNativeTransfer: async () => { throw new Error("must not sign in this test"); } };
  // default authorize = deny => 401 (client adds nothing to "fix" it)
  const denied = await client(routeFetch(createGiftGasRoute({ ledger, policy, chain, signer }))).request({ giftId: GID, to: TO });
  assert.equal(denied.outcome, O.UNAUTHORIZED);

  const route = createGiftGasRoute({ ledger, policy, chain, signer, authorize: () => true });
  const c = client(routeFetch(route));
  for (const [state, txHash, want] of [["CONFIRMED", TX, O.CONFIRMED], ["SENT", TX, O.SENT], ["PENDING", null, O.PENDING], ["UNKNOWN", null, O.UNKNOWN]]) {
    entries.set(GID, { giftId: GID, to: TO, valueWei: "50000000000000000", state, nonce: txHash ? "1" : null, rawTx: txHash ? "0x00" : null, txHash });
    const out = await c.request({ giftId: GID, to: TO_MIXED });
    assert.equal(out.outcome, want, `route ${state}`); assert.equal(out.txHash, txHash); assert.equal(out.reachedServer, "yes");
  }
  // existing entry bound to another destination => 409 not_available
  entries.set(GID, { giftId: GID, to: "0x" + "33".repeat(20), valueWei: "1", state: "CONFIRMED", nonce: "1", rawTx: "0x00", txHash: TX });
  assert.equal((await c.request({ giftId: GID, to: TO })).outcome, O.NOT_AVAILABLE);
  // route Origin gate => 403 (client never sends Origin itself; the browser does)
  const originRoute = createGiftGasRoute({ ledger, policy, chain, signer, authorize: () => true });
  const withOrigin = (u, i) => routeFetch((req, res) => { req.headers.origin = "https://evil.example"; return originRoute(req, res); })(u, i);
  assert.equal((await client(withOrigin).request({ giftId: GID, to: TO })).outcome, O.FORBIDDEN);
  ok("bridge: real createGiftGasRoute bytes parse as 503/401/403/409 and CONFIRMED/SENT/PENDING/UNKNOWN");
}

// ── 10. static boundary: no fallback, no storage, no logging, no imports ────────────────────────────────
{
  assert.ok(!/^\s*import\b/m.test(SRC), "module has no imports");
  assert.ok(!/\bimport\s*\(/.test(CODE), "no dynamic import");
  const forbidden = [
    /localStorage/, /sessionStorage/, /indexedDB/i, /document\.cookie/, /caches\./, /\bconsole\b/, /\blog\s*\(/,
    /globalThis\.fetch/, /window\.fetch/, /self\.fetch/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/,
    /\/grant\b/, /\bgrant\b/i, /authorization/i, /bearer/i, /x-api-key/i, /\bcookie\b/i,
    /privateKey|mnemonic|seed/i, /signNativeTransfer|signTransaction|sendTransaction|eth_send/i, /walletClient|createWalletClient/,
    /\bsetInterval\b/, /\bretry\s*\(/i,
  ];
  for (const re of forbidden) assert.ok(!re.test(CODE), `forbidden in code: ${re}`);
  // the only path literal is /gift-gas
  const paths = [...SRC.matchAll(/["'`](\/[a-z][\w-]*)["'`]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(paths)], ["/gift-gas"]);
  // fetch is only ever the injected one
  assert.equal((CODE.match(/\bfetch\s*\(/g) ?? []).length, 0, "no bare fetch( call");
  assert.ok(/fetchFn\.call\(undefined,/.test(CODE));
  // pre-A-895 baseline: /typeof c\.fetch === "function" \? c\.fetch : null/ (plain read). A-895 P-B L1: own-data read only.
  assert.ok(/typeof pick\(c, "fetch"\) === "function" \? pick\(c, "fetch"\) : null/.test(CODE));
  ok("static: no imports, no storage/cookie/console/global fetch/grant route/auth header/signing in code; only path /gift-gas");
}


// ── 11. [A-895 P-B] definite-refusal bodies · A-884 L1 own-props · L2 re-entrant fetch · L3 per-joiner abort ──
{
  // 408 (relayer body deadline) and the two 503 bodies are exact; everything else keeps failing closed
  const body = (error) => JSON.stringify({ ok: false, error });
  const c = (status, text) => parseGiftGasResponse({ status, contentType: JSON_CT, text }, { giftId: GID, to: TO });
  const r408 = c(408, body("request timeout"));
  assert.equal(r408.outcome, O.REQUEST_TIMEOUT); assert.equal(r408.httpStatus, 408); assert.equal(r408.reachedServer, "yes"); assert.equal(r408.ok, false);
  assert.equal(c(408, body("bad_request")).outcome, O.MALFORMED_RESPONSE);
  assert.equal(c(408, JSON.stringify({ ok: false, error: "request timeout", x: 1 })).outcome, O.MALFORMED_RESPONSE);
  const r503n = c(503, body("unavailable_not_sent"));
  assert.equal(r503n.outcome, O.UNAVAILABLE_NOT_SENT); assert.equal(r503n.httpStatus, 503);
  assert.equal(c(503, body("unavailable")).outcome, O.UNAVAILABLE);
  assert.equal(c(503, body("unavailable_not_sent ")).outcome, O.MALFORMED_RESPONSE);
  assert.equal(c(503, body("unavailable_NOT_sent")).outcome, O.MALFORMED_RESPONSE);
  assert.equal(c(409, body("unavailable_not_sent")).outcome, O.MALFORMED_RESPONSE, "the not-sent body is only valid with 503");
  assert.equal(c(400, body("unavailable_not_sent")).outcome, O.MALFORMED_RESPONSE);
  assert.equal(c(502, body("unavailable_not_sent")).outcome, O.MALFORMED_RESPONSE);
  noAuthority(r408); noAuthority(r503n);
  // L1: a polluted Object.prototype cannot supply fetch / transport / endpoint / timers / signal / timeoutMs
  const saved = {};
  const keys = ["fetch", "transport", "endpoint", "pageOrigin", "timers", "timeoutMs", "signal"];
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(Object.prototype, k);
  let polluted = 0;
  try {
    const pf = mkFetch(() => { polluted += 1; return fakeResponse(200, record("CONFIRMED", TX)); });
    Object.assign(Object.prototype, { fetch: pf, transport: T.HTTPS, endpoint: ENDPOINT, timers: { setTimeout: () => 0, clearTimeout: () => {} }, timeoutMs: 1000 });
    const bare = createGiftGasClient();
    assert.equal(bare.configError, "no_fetch"); assert.equal((await bare.request({ giftId: GID, to: TO })).outcome, O.INVALID_CONFIG);
    const partial = createGiftGasClient({ fetch: mkFetch(() => fakeResponse(200, record("CONFIRMED", TX))) });
    assert.equal(partial.configError, "bad_endpoint", "transport/endpoint are NOT taken from the prototype");
    // an own fetch + own endpoint with a polluted timers must still use the real timers (timeout fires)
    const hang = mkFetch(() => new Promise(() => {}));
    const real = createGiftGasClient({ fetch: hang, transport: T.HTTPS, endpoint: ENDPOINT, timeoutMs: 1000 });
    const out = await Promise.race([real.request({ giftId: GID, to: TO }), new Promise((r) => setTimeout(() => r("STILL_PENDING"), 1600))]);
    assert.equal(out.outcome, O.TIMEOUT, "polluted timers did not neuter the timeout");
    // a polluted opts.signal is ignored
    Object.prototype.signal = { aborted: true, addEventListener() {} };
    const ok2 = await client(mkFetch(() => fakeResponse(200, record("CONFIRMED", TX)))).request({ giftId: GID, to: TO }, {});
    assert.equal(ok2.outcome, O.CONFIRMED, "inherited signal ignored");
    assert.equal(polluted, 0, "the polluted fetch was never called");
  } finally {
    for (const k of keys) { delete Object.prototype[k]; if (saved[k]) Object.defineProperty(Object.prototype, k, saved[k]); }
  }
  // accessor properties on cfg are treated as missing (not invoked for their value)
  let getterRuns = 0;
  const acc = createGiftGasClient({ transport: T.HTTPS, endpoint: ENDPOINT, get fetch() { getterRuns += 1; return () => {}; } });
  assert.equal(acc.configError, "no_fetch");
  // L2: a fetch that re-enters request() synchronously joins the registered entry: 1 fetch, conflict for another destination
  {
    let inner = null; let innerConflict = null; let c2;
    const f = mkFetch(() => {
      inner = c2.request({ giftId: GID, to: TO });
      innerConflict = c2.request({ giftId: GID, to: "0x" + "22".repeat(20) });
      return Promise.resolve(fakeResponse(200, record("CONFIRMED", TX)));
    });
    c2 = client(f);
    const outer = await c2.request({ giftId: GID, to: TO });
    assert.equal(outer.outcome, O.CONFIRMED);
    assert.equal(f.calls.length, 1, "re-entrant request joined the in-flight entry: 0 extra fetch");
    assert.equal((await inner).outcome, O.CONFIRMED);
    const cf = await innerConflict;
    assert.equal(cf.outcome, O.IN_FLIGHT_CONFLICT); assert.equal(cf.reachedServer, "no");
    // a throwing synchronous fetch still clears the entry
    const g = mkFetch(() => { throw new Error("sync"); });
    const c3 = client(g);
    assert.equal((await c3.request({ giftId: GID, to: TO })).outcome, O.NETWORK_ERROR);
    assert.equal((await c3.request({ giftId: GID, to: TO })).outcome, O.NETWORK_ERROR);
    assert.equal(g.calls.length, 2, "slot released after settle");
  }
  // L3: a joiner's own signal aborts only that joiner; the shared fetch is aborted only when ALL attached callers abort
  {
    let release; const gate = new Promise((r) => { release = r; });
    let fetchSignal = null;
    const f = mkFetch(async (_u, init) => { fetchSignal = init.signal; await gate; return fakeResponse(200, record("SENT", TX)); });
    const c4 = client(f);
    const a = new AbortController(); const b = new AbortController();
    const pa = c4.request({ giftId: GID, to: TO }, { signal: a.signal });
    const pb = c4.request({ giftId: GID, to: TO }, { signal: b.signal });
    const pn = c4.request({ giftId: GID, to: TO }); // joiner without a signal
    await new Promise((r) => setImmediate(r));
    a.abort();
    const ra = await pa;
    assert.equal(ra.outcome, O.ABORTED); assert.equal(ra.reachedServer, "unknown");
    assert.equal(fetchSignal.aborted, false, "one aborting joiner does not abort the shared fetch");
    b.abort();
    assert.equal((await pb).outcome, O.ABORTED);
    assert.equal(fetchSignal.aborted, false, "the signal-less joiner still waits");
    release();
    const rn = await pn;
    assert.equal(rn.outcome, O.SENT, "the un-aborted joiner receives the real result");
    assert.equal(f.calls.length, 1);
    // all callers abort => the shared fetch is aborted, every caller gets aborted/unknown
    const hang = mkFetch((_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    const c5 = client(hang);
    const x = new AbortController(); const y = new AbortController();
    const px = c5.request({ giftId: GID, to: TO }, { signal: x.signal });
    const py = c5.request({ giftId: GID, to: TO }, { signal: y.signal });
    await new Promise((r) => setImmediate(r));
    x.abort(); y.abort();
    const [rx, ry] = await Promise.all([px, py]);
    assert.equal(rx.outcome, O.ABORTED); assert.equal(ry.outcome, O.ABORTED);
    assert.equal(hang.calls[0].init.signal.aborted, true);
    assert.equal(hang.calls.length, 1);
    // a joiner that arrives already aborted never touches the shared fetch
    const f6 = mkFetch(async () => { await gate; return fakeResponse(200, record("SENT", TX)); });
    const c6 = client(f6);
    const p0 = c6.request({ giftId: GID, to: TO });
    const dead = new AbortController(); dead.abort();
    const rd = await c6.request({ giftId: GID, to: TO }, { signal: dead.signal });
    assert.equal(rd.outcome, O.ABORTED); assert.equal(rd.reachedServer, "no");
    assert.equal((await p0).outcome, O.SENT);
  }
  ok("A-895 P-B: 408 + 503 not-sent bodies are exact; L1 own-property config/opts; L2 re-entrant fetch joins the registered entry; L3 per-joiner abort");
}

console.log(`a884 gift gas client: ${n} groups PASS`);
