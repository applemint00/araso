// [A-987 P1] Signed-HTTPS fork Admin client (Admin remote path A). Node only, network 0 (global fetch trapped; transports are fakes).
// Rows:
//   1 signTopup known vector (computed independently with shasum + openssl dgst -hmac) · signing string shape · bad inputs = null
//     · [r2] host / path / method bound: a different one = a different sig
//   2 env: none = null · partial signed = null · mixed signed + loopback = null · bad URL (http / path / query / userinfo) = null
//     · short secret = null · full signed = signed client · loopback-only = loopback client (unchanged)
//   3 signed topup: exactly one POST to https://<host>/araso-admin/v1/topup · body bytes sent = bytes hashed · headers verify with signTopup
//     · fresh crypto nonce per call · no bearer · redirect: "error" · 3xx answer is not followed (1 call, topup_failed)
//   4 signed instance: araso_guardInfo on the Guard origin, no secret headers · missing forkStartBlock / wrong guard name = admin_bad_instance
//   5 secret never appears in: thrown/returned values, console output, util.inspect of the client, request URL, any header but the sig
//   6 loopback mode regression: same request shape as pre-A-987 (bearer, /admin/topup, 127.0.0.1)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import util from "node:util";
import {
  FORK_ADMIN_HMAC_SECRET_ENV, FORK_ADMIN_TOKEN_ENV, FORK_ADMIN_URL_ENV, FORK_GUARD_URL_ENV,
  createForkAdminClient, createSignedForkAdminClient, forkAdminClientFromEnv, guardHost, guardOrigin, signTopup,
} from "../../api/_lib/fork-grant-client.js";
import { FORK_GUARD_NAME } from "../src/chain-profile.js";

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-987 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };

// test-only values, not real secrets
const SECRET = "test-vector-secret-not-real-0123456789";
const RUN_SECRET = `run-${crypto.randomBytes(24).toString("hex")}`; // a value no source file contains
const LOOP_TOKEN = "admin-token-0123456789abcdef";
const GUARD = "https://fork-guard.example.test";
const PIGGY = "0x1111111111111111111111111111111111111111";
const FORK_ID = "fork-143-110874000-20261011t000000z-a987a987";
const VECTOR = {
  body: '{"piggyAddress":"0x1111111111111111111111111111111111111111","asset":"USDC","grantVersion":"g1"}',
  ts: 1760140800, nonce: "00112233445566778899aabbccddeeff",
  bodySha256: "773685b0180b38b4dcdfe15ac9ba2580d6dc604e086574f3c9af9b8eaade9f29",
  host: "fork-guard.example.test",
  sig: "8039059d9b9ea18724eafda0d353010f94dc5bcf5dc3899b79907eee3218ca9b", // [r2] pre-r2 (no scheme/method/host/path): 07be9845…502a
};

function recorder(answer) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const [status, json, extraHeaders] = answer(url, init);
    return { status, headers: new Map(Object.entries(extraHeaders || {})), async json() { if (json === undefined) throw new Error("no json"); return json; } };
  };
  return { calls, fetchImpl };
}
const okTopup = (url, init) => {
  const b = JSON.parse(Buffer.from(init.body).toString("utf8"));
  return [200, { noop: false, key: `${FORK_ID}|${b.piggyAddress.toLowerCase()}|${b.asset}|${b.grantVersion}`, record: { forkInstanceId: FORK_ID, amountRaw: "10000000" } }];
};
const hdr = (init, k) => { const h = init.headers || {}; const hit = Object.keys(h).find((x) => x.toLowerCase() === k); return hit ? h[hit] : undefined; };

await check("1a signTopup = independent vector (shasum + openssl hmac)", () => {
  const s = signTopup({ secret: SECRET, host: VECTOR.host, ts: VECTOR.ts, nonce: VECTOR.nonce, body: VECTOR.body });
  assert.equal(s.bodySha256, VECTOR.bodySha256);
  assert.equal(s.signingString, `araso-admin-v1\nPOST\nfork-guard.example.test\n/araso-admin/v1/topup\n1760140800\n${VECTOR.nonce}\n${VECTOR.bodySha256}`);
  assert.equal(s.sig, VECTOR.sig);
  assert.equal(s.ts, "1760140800");
  assert.equal(signTopup({ secret: SECRET, host: VECTOR.host, method: "POST", path: "/araso-admin/v1/topup", ts: "1760140800", nonce: VECTOR.nonce, body: Buffer.from(VECTOR.body) }).sig, VECTOR.sig, "string ts / byte body = same");
  assert.ok(!JSON.stringify(s).includes(SECRET));
});
await check("1b signTopup: 1 body byte / ts / nonce change = different sig", () => {
  const v = { secret: SECRET, host: VECTOR.host, ts: VECTOR.ts, nonce: VECTOR.nonce, body: VECTOR.body };
  const base = signTopup(v).sig;
  assert.notEqual(signTopup({ ...v, body: VECTOR.body.replace("g1", "g2") }).sig, base);
  assert.notEqual(signTopup({ ...v, ts: VECTOR.ts + 1 }).sig, base);
  assert.notEqual(signTopup({ ...v, nonce: "f".repeat(32) }).sig, base);
  assert.notEqual(signTopup({ ...v, secret: `${SECRET}x` }).sig, base);
});
await check("1b2 [r2] different host / port / path / method = different sig (cross-host / cross-route replay)", () => {
  const v = { secret: SECRET, host: VECTOR.host, ts: VECTOR.ts, nonce: VECTOR.nonce, body: VECTOR.body };
  const base = signTopup(v).sig;
  const others = [
    signTopup({ ...v, host: "staging-guard.example.test" }).sig,
    signTopup({ ...v, host: "fork-guard.example.test:8443" }).sig,
    signTopup({ ...v, path: "/araso-admin/v1/reset" }).sig,
    signTopup({ ...v, path: "/admin/topup" }).sig,
    signTopup({ ...v, method: "PUT" }).sig,
  ];
  for (const o of others) assert.notEqual(o, base);
  assert.equal(new Set(others).size, others.length);
  assert.equal(guardHost("https://Fork-Guard.EXAMPLE.test:443/"), "fork-guard.example.test", "default port dropped, lowercase");
  assert.equal(guardHost("https://fork-guard.example.test:8443"), "fork-guard.example.test:8443");
});
await check("1c signTopup bad inputs = null (short secret · ts sign/leading zero/float · nonce case/length · non-bytes body)", () => {
  const ok = { secret: SECRET, host: VECTOR.host, ts: VECTOR.ts, nonce: VECTOR.nonce, body: VECTOR.body };
  for (const bad of [{ host: undefined }, { host: "Fork-Guard.example.test" }, { host: "a\nb" }, { host: "h:0" }, { path: "araso" }, { path: "/a\nb" }, { method: "post" }, { secret: "short" }, { secret: undefined }, { ts: -1 }, { ts: "0123" }, { ts: 1.5 }, { ts: "+1" }, { nonce: VECTOR.nonce.toUpperCase() }, { nonce: "00" }, { body: { a: 1 } }, { body: null }]) {
    assert.equal(signTopup({ ...ok, ...bad }), null, JSON.stringify(Object.keys(bad)));
  }
});

await check("2a env: none / empty values = null (fail closed, as before)", () => {
  assert.equal(forkAdminClientFromEnv({}), null);
  assert.equal(forkAdminClientFromEnv({ [FORK_GUARD_URL_ENV]: "", [FORK_ADMIN_HMAC_SECRET_ENV]: "  " }), null);
});
await check("2b env: partial signed (URL only / secret only) = null", () => {
  assert.equal(forkAdminClientFromEnv({ [FORK_GUARD_URL_ENV]: GUARD }), null);
  assert.equal(forkAdminClientFromEnv({ [FORK_ADMIN_HMAC_SECRET_ENV]: SECRET }), null);
});
await check("2c env: mixed signed + loopback (any var of each) = null", () => {
  const loop = { [FORK_ADMIN_URL_ENV]: "http://127.0.0.1:18550", [FORK_ADMIN_TOKEN_ENV]: LOOP_TOKEN };
  const signed = { [FORK_GUARD_URL_ENV]: GUARD, [FORK_ADMIN_HMAC_SECRET_ENV]: SECRET };
  assert.equal(forkAdminClientFromEnv({ ...loop, ...signed }), null);
  assert.equal(forkAdminClientFromEnv({ ...loop, [FORK_ADMIN_HMAC_SECRET_ENV]: SECRET }), null);
  assert.equal(forkAdminClientFromEnv({ ...signed, [FORK_ADMIN_TOKEN_ENV]: LOOP_TOKEN }), null);
  assert.equal(forkAdminClientFromEnv({ ...signed, [FORK_ADMIN_URL_ENV]: "http://127.0.0.1:18550" }), null);
});
await check("2d env: bad Guard URL / short secret = null; inherited props ignored", () => {
  for (const u of ["http://fork-guard.example.test", "https://fork-guard.example.test/rpc", "https://fork-guard.example.test/?a=1", "https://u:p@fork-guard.example.test", "https://fork-guard.example.test#x", "ftp://fork-guard.example.test", "https://", "fork-guard.example.test",
    "https://127.0.0.1", "https://127.0.0.1:8443", "https://[::1]", "https://[::1]:8443", "https://localhost", "https://0.0.0.0", "https://fork-guard.example.test:0",
    " https://fork-guard.example.test", "https://fork-guard.example.test ", "https://fork-guard.example.test\n"]) {
    assert.equal(guardOrigin(u), null, u);
    assert.equal(forkAdminClientFromEnv({ [FORK_GUARD_URL_ENV]: u, [FORK_ADMIN_HMAC_SECRET_ENV]: SECRET }), null, u);
  }
  assert.equal(forkAdminClientFromEnv({ [FORK_GUARD_URL_ENV]: GUARD, [FORK_ADMIN_HMAC_SECRET_ENV]: "x".repeat(31) }), null);
  assert.equal(forkAdminClientFromEnv(Object.create({ [FORK_GUARD_URL_ENV]: GUARD, [FORK_ADMIN_HMAC_SECRET_ENV]: SECRET })), null);
  assert.equal(guardOrigin("https://Fork-Guard.example.test:8443/"), "https://fork-guard.example.test:8443");
});
await check("2e env: full signed = signed client; loopback-only = loopback client (unchanged)", async () => {
  const r = recorder(okTopup);
  const c = forkAdminClientFromEnv({ [FORK_GUARD_URL_ENV]: `${GUARD}/`, [FORK_ADMIN_HMAC_SECRET_ENV]: SECRET }, r.fetchImpl);
  assert.ok(c);
  await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" });
  assert.equal(r.calls[0].url, `${GUARD}/araso-admin/v1/topup`);
  const l = recorder(okTopup);
  const lc = forkAdminClientFromEnv({ [FORK_ADMIN_URL_ENV]: "http://127.0.0.1:18550", [FORK_ADMIN_TOKEN_ENV]: LOOP_TOKEN }, l.fetchImpl);
  await lc.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" });
  assert.equal(l.calls[0].url, "http://127.0.0.1:18550/admin/topup");
});

await check("3a signed topup: 1 POST, body bytes = hashed bytes, headers verify, no bearer, redirect error", async () => {
  const r = recorder(okTopup);
  const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl, nowMs: () => 1760140800123 });
  const t = await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" });
  assert.deepEqual(t, { ok: true, noop: false, key: `${FORK_ID}|${PIGGY}|USDC|g1`, amountRaw: "10000000", forkInstanceId: FORK_ID });
  assert.equal(r.calls.length, 1);
  const { url, init } = r.calls[0];
  assert.equal(url, "https://fork-guard.example.test/araso-admin/v1/topup");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.ok(init.body instanceof Uint8Array);
  assert.equal(Buffer.from(init.body).toString("utf8"), VECTOR.body, "body = canonical JSON");
  assert.equal(hdr(init, "x-araso-ts"), "1760140800");
  const nonce = hdr(init, "x-araso-nonce");
  assert.match(nonce, /^[0-9a-f]{32}$/);
  const expect = signTopup({ secret: SECRET, host: "fork-guard.example.test", ts: "1760140800", nonce, body: init.body }).sig;
  assert.equal(hdr(init, "x-araso-sig"), expect);
  assert.equal(hdr(init, "authorization"), undefined);
  assert.equal(hdr(init, "content-type"), "application/json");
});
await check("3b nonce = crypto random, fresh per call (100 calls, 100 distinct)", async () => {
  const r = recorder(okTopup);
  const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl });
  for (let k = 0; k < 100; k += 1) await c.topup({ piggyAddress: PIGGY, asset: "MON", grantVersion: "g1" });
  assert.equal(new Set(r.calls.map((x) => hdr(x.init, "x-araso-nonce"))).size, 100);
});
await check("3c 3xx answer not followed (1 call, topup_failed); 401 = admin_unauthorized; transport error = topup_failed", async () => {
  const r = recorder(() => [302, undefined, { location: "https://evil.example.test/araso-admin/v1/topup" }]);
  const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl });
  assert.deepEqual(await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" }), { ok: false, reason: "topup_failed" });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].init.redirect, "error");
  const u = recorder(() => [401, { error: "unauthorized" }]);
  assert.deepEqual(await createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: u.fetchImpl }).topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" }), { ok: false, reason: "admin_unauthorized" });
  const e = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: async () => { throw new TypeError(`redirect mode is set to error ${SECRET}`); } });
  assert.deepEqual(await e.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" }), { ok: false, reason: "topup_failed" });
});
await check("3d bad args refused before any call (bad piggy / asset off the table / grantVersion)", async () => {
  const r = recorder(okTopup);
  const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl });
  assert.equal((await c.topup({ piggyAddress: "0x12", asset: "USDC", grantVersion: "g1" })).reason, "bad_piggy");
  assert.equal((await c.topup({ piggyAddress: PIGGY, asset: "DOGE", grantVersion: "g1" })).reason, "bad_asset");
  assert.equal((await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g 1" })).reason, "bad_grant_version");
  assert.equal(r.calls.length, 0);
});
await check("3d2 [A-987 P2 r2] grantVersion lower-case only, same shape as the container's GRANT_VERSION (^[a-z0-9][a-z0-9._-]{0,31}$), both modes", async () => {
  const r = recorder(okTopup);
  const signedC = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl });
  const loopC = createForkAdminClient({ url: "http://127.0.0.1:47999", token: "admin-token-0123456789abcdef", fetchImpl: r.fetchImpl });
  for (const c of [signedC, loopC]) {
    for (const gv of ["G1", "A956-g1", "a987-G1", "-g1", ".g1", "_g1", "x".repeat(33)]) assert.equal((await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: gv })).reason, "bad_grant_version", gv);
  }
  assert.equal(r.calls.length, 0);
  for (const gv of ["g1", "a956-g1", "a987.int_1", "x".repeat(32)]) assert.equal((await signedC.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: gv })).ok, true, gv);
});
await check("3e timeout aborts (like the loopback client) = topup_failed", async () => {
  const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, timeoutMs: 20, fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
  assert.deepEqual(await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" }), { ok: false, reason: "topup_failed" });
});

await check("4a signed instance = public araso_guardInfo, no secret headers", async () => {
  const r = recorder(() => [200, { jsonrpc: "2.0", id: 1, result: { guard: FORK_GUARD_NAME, chainId: 31337143, forkInstanceId: FORK_ID, forkStartBlock: 110874000 } }]);
  const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl });
  assert.deepEqual(await c.instance(), { ok: true, forkInstanceId: FORK_ID, chainId: 31337143, forkStartBlock: 110874000 });
  const { url, init } = r.calls[0];
  assert.equal(url, `${GUARD}/`);
  assert.equal(JSON.parse(Buffer.from(init.body).toString()).method, "araso_guardInfo");
  assert.equal(init.redirect, "error");
  for (const k of ["x-araso-sig", "x-araso-nonce", "x-araso-ts", "authorization"]) assert.equal(hdr(init, k), undefined, k);
});
await check("4b signed instance: no forkStartBlock / wrong guard / bad id = admin_bad_instance; error / non-200 = admin_unavailable", async () => {
  const base = { guard: FORK_GUARD_NAME, chainId: 31337143, forkInstanceId: FORK_ID, forkStartBlock: 110874000 };
  for (const result of [{ ...base, forkStartBlock: undefined }, { ...base, forkStartBlock: -1 }, { ...base, guard: "other" }, { ...base, forkInstanceId: "BAD ID" }]) {
    const r = recorder(() => [200, { jsonrpc: "2.0", id: 1, result }]);
    assert.equal((await createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: r.fetchImpl }).instance()).reason, "admin_bad_instance");
  }
  const e = recorder(() => [200, { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "The fork is restarting." } }]);
  assert.equal((await createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: e.fetchImpl }).instance()).reason, "admin_unavailable");
  const n = recorder(() => [429, { error: "guard_closed" }]);
  assert.equal((await createSignedForkAdminClient({ guardUrl: GUARD, secret: SECRET, fetchImpl: n.fetchImpl }).instance()).reason, "admin_unavailable");
});

await check("5 secret never in results / console / inspect / URL / non-sig headers / thrown text", async () => {
  const out = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(saved)) console[k] = (...a) => out.push(util.format(...a));
  const seen = [];
  try {
    const answers = [okTopup, () => [401, {}], () => [302, undefined], () => [500, { error: RUN_SECRET.slice(0, 3) }]];
    for (const ans of answers) {
      const r = recorder(ans);
      const c = createSignedForkAdminClient({ guardUrl: GUARD, secret: RUN_SECRET, fetchImpl: r.fetchImpl });
      seen.push(util.inspect(c, { depth: 5, showHidden: true }), JSON.stringify(c));
      seen.push(JSON.stringify(await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" })));
      seen.push(JSON.stringify(await c.instance()));
      for (const { url, init } of r.calls) {
        seen.push(url, Buffer.from(init.body).toString());
        for (const [k, v] of Object.entries(init.headers)) if (k !== "x-araso-sig") seen.push(`${k}:${v}`);
      }
    }
    const thrower = createSignedForkAdminClient({ guardUrl: GUARD, secret: RUN_SECRET, fetchImpl: async () => { throw new Error("boom"); } });
    seen.push(JSON.stringify(await thrower.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" })));
    seen.push(String(forkAdminClientFromEnv({ [FORK_GUARD_URL_ENV]: "http://bad", [FORK_ADMIN_HMAC_SECRET_ENV]: RUN_SECRET })));
  } finally { Object.assign(console, saved); }
  assert.equal(out.length, 0, "client wrote to console");
  for (const s of seen) assert.ok(!String(s).includes(RUN_SECRET), "secret leaked");
});

await check("6 loopback mode regression: bearer, 127.0.0.1, /admin/topup, no signature headers", async () => {
  const r = recorder(okTopup);
  const c = forkAdminClientFromEnv({ [FORK_ADMIN_URL_ENV]: "http://127.0.0.1:18550/", [FORK_ADMIN_TOKEN_ENV]: LOOP_TOKEN }, async (url, init) => {
    init = { ...init, body: Buffer.from(init.body) };
    return r.fetchImpl(url, init);
  });
  const t = await c.topup({ piggyAddress: PIGGY, asset: "USDC", grantVersion: "g1" });
  assert.equal(t.ok, true);
  const { url, init } = r.calls[0];
  assert.equal(url, "http://127.0.0.1:18550/admin/topup");
  assert.equal(hdr(init, "authorization"), `Bearer ${LOOP_TOKEN}`);
  assert.equal(init.redirect, "error");
  for (const k of ["x-araso-sig", "x-araso-nonce", "x-araso-ts"]) assert.equal(hdr(init, k), undefined, k);
  assert.equal(forkAdminClientFromEnv({ [FORK_ADMIN_URL_ENV]: "https://fork-guard.example.test", [FORK_ADMIN_TOKEN_ENV]: LOOP_TOKEN }), null, "loopback var still loopback-only");
});

assert.equal(netCalls, 0);
console.log(`\nA-987 signed admin client: ${pass} PASS / ${fail} FAIL (network calls ${netCalls})`);
process.exit(fail ? 1 : 0);
