// [A-960] Upstash one store — LOCAL adapters only. Node only, network 0: a FAKE Upstash REST endpoint (helpers/a960-fake-upstash.mjs) and a
// JSON-RPC stub, both in process. No real Upstash resource, no real env (process.env values below are set in this process only and removed).
// Rows (card item 6): env names both accepted / none = 503 · grant store = A-870 conformance over the fake KV · two concurrent requests ·
// cap exceeded · invite expiry · other Piggy binding refused · raw token never logged or stored · fork ledger store contract · Gift KV
// store untouched · item 7 defaults.
import assert from "node:assert/strict";
import { createHash } from "node:crypto"; // [A-983] was execFileSync (git show HEAD), now a sha256 pin
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, parseTransaction } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FAKE_KV_TOKEN, FAKE_KV_URL, fakeUpstash } from "./helpers/a960-fake-upstash.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// ---- network: fake KV + RPC stub only; anything else counts as a network call and fails ------------------------------
const STUB_RPC = "http://a960-stub-rpc.invalid";
process.env.MONAD_RPC_URL = STUB_RPC;
const KEY = generatePrivateKey();
const RELAYER = privateKeyToAccount(KEY).address;
let netCalls = 0;
let kvRoute = null; // the fake KV currently answering FAKE_KV_URL
const rpcLog = [];
const balances = new Map([[RELAYER.toLowerCase(), 10n ** 21n]]);
const receipts = new Map();
let nonce = 0;
const hex = (n) => `0x${BigInt(n).toString(16)}`;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === FAKE_KV_URL && kvRoute) return kvRoute.fetchImpl(u, init);
  if (!u.startsWith(STUB_RPC)) { netCalls += 1; throw new Error(`a960: network forbidden (${u})`); }
  const payload = JSON.parse(init.body);
  const one = (req) => { try { return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? []) }; } catch (e) { return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: String(e.message) } }; } };
  return new Response(JSON.stringify(Array.isArray(payload) ? payload.map(one) : one(payload)), { status: 200, headers: { "content-type": "application/json" } });
};
let grantWei = 0n;
function answer(method, params) {
  rpcLog.push(method);
  switch (method) {
    case "eth_chainId": return hex(10143);
    case "eth_getBalance": return hex(balances.get(params[0].toLowerCase()) ?? 0n);
    case "eth_getTransactionCount": return hex(nonce);
    case "eth_blockNumber": return hex(100);
    case "eth_gasPrice": case "eth_maxPriorityFeePerGas": return hex(1_000_000_000);
    case "eth_estimateGas": return hex(21000);
    case "eth_getBlockByNumber": return { number: hex(100), hash: `0x${"ab".repeat(32)}`, baseFeePerGas: hex(1_000_000_000), timestamp: hex(1), transactions: [], gasLimit: hex(30_000_000), gasUsed: "0x0" };
    case "eth_sendRawTransaction": {
      const tx = parseTransaction(params[0]); const to = tx.to.toLowerCase(); const hash = keccak256(params[0]);
      nonce += 1; balances.set(to, (balances.get(to) ?? 0n) + grantWei); receipts.set(hash, to); return hash;
    }
    case "eth_getTransactionReceipt": {
      const hash = params[0]; if (!receipts.has(hash)) return null;
      return { transactionHash: hash, status: "0x1", blockNumber: hex(100), blockHash: `0x${"ab".repeat(32)}`, transactionIndex: "0x0", from: RELAYER, to: receipts.get(hash), cumulativeGasUsed: hex(21000), gasUsed: hex(21000), effectiveGasPrice: hex(1), logs: [], logsBloom: `0x${"00".repeat(256)}`, type: "0x2", contractAddress: null };
    }
    case "eth_getTransactionByHash": return null;
    default: throw new Error(`a960 stub: unhandled ${method}`);
  }
}

// ---- capture every log line (raw token must never appear) ----------------------------------------------------------------
const logLines = [];
for (const k of ["log", "error", "warn", "info"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { const line = a.map(String).join(" "); logLines.push(line); if (k !== "log" || !/^(grant|invite) /.test(line)) orig(...a); };
}

const G = await import("../../api/grant.js");
const { GRANT_WEI } = await import("../../relayer/src/policy.mjs");
grantWei = GRANT_WEI;
const R = await import("../../api/_lib/grant-redis-store.js");
const I = await import("../../api/_lib/invite-redis-store.js");
const F = await import("../../api/_lib/fork-ledger-redis-store.js");
const A = await import("../../api/_lib/fork-auth.js");
const { runGrantStoreConformance, GRANT_STORE_CONTRACT_V1 } = await import("../../api/_lib/grant-store-contract.js");
const { createMemoryForkLedgerStore, isForkLedgerStore } = await import("../../api/_lib/fork-ledger-store-contract.js");
const { evidenceRecord, rewardKey, stampRecord } = await import("../../api/_lib/fork-ledger-contract.js");

let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.info(`PASS  ${n}`); } catch (e) { fail += 1; console.info(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };

const APP = "https://arasoo.vercel.app";
const HEADERS = Object.freeze({ "content-type": "application/json", origin: APP, "sec-fetch-site": "same-origin", host: "arasoo.vercel.app" });
function makeRes() { return { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(p) { this.body = p ? JSON.parse(p) : null; } }; }
async function call(h, body, { headers = HEADERS, invite } = {}) {
  const res = makeRes();
  const hh = invite === undefined ? headers : { ...headers, "x-araso-invite": invite };
  await h({ method: "POST", headers: hh, body, async *[Symbol.asyncIterator]() {} }, res);
  return res;
}
const piggyKey = () => privateKeyToAccount(generatePrivateKey());
const cmdOf = (kv) => R.createUpstashRest({ url: kv.url, token: kv.token, fetchImpl: kv.fetchImpl });
const parts = (kv, o = {}) => {
  const cmd = cmdOf(kv);
  return {
    cmd,
    grant: R.createUpstashGrantStore({ cmd, ...(o.grant || {}) }),
    invites: I.createUpstashInviteStore({ cmd, now: () => kv.clock.t, ...(o.invites || {}) }),
    challenges: A.createRedisChallengeStore({ cmd }),
  };
};
const issued = []; // every raw token issued in this run (for the never-logged / never-stored rows)
async function issue(p) { const r = await p.invites.issue(); if (r.ok) issued.push(r.token); return r; }
// the app's side of binding, done by hand: challenge → sign → bind
async function bindVia(h, token, acct) {
  const piggy = acct.address.toLowerCase();
  const c = await call(h, { action: "invite_challenge", piggyAddress: piggy }, { invite: token });
  if (c.statusCode !== 200) return c;
  const signature = await acct.signMessage({ message: c.body.message });
  return call(h, { action: "invite_bind", nonce: c.body.nonce, signature, piggyAddress: piggy }, { invite: token });
}
const env = (o) => { for (const [k, v] of Object.entries(o)) process.env[k] = v; return () => { for (const k of Object.keys(o)) delete process.env[k]; }; };

// ==== 4) env names: both pairs accepted; halves never mixed; none = no store =================================================
await check("4 env: KV_REST_API_* and UPSTASH_REDIS_REST_* both accepted (complete pair, KV first); halves never mixed; inherited ignored", () => {
  const kv = { KV_REST_API_URL: "https://a.upstash.io", KV_REST_API_TOKEN: "t1" };
  const up = { UPSTASH_REDIS_REST_URL: "https://b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t2" };
  assert.deepEqual(R.readUpstashEnv(kv), { url: kv.KV_REST_API_URL, token: "t1", source: "KV_REST_API_URL" });
  assert.deepEqual(R.readUpstashEnv(up), { url: up.UPSTASH_REDIS_REST_URL, token: "t2", source: "UPSTASH_REDIS_REST_URL" });
  assert.equal(R.readUpstashEnv({ ...kv, ...up }).source, "KV_REST_API_URL");
  assert.equal(R.readUpstashEnv({ KV_REST_API_URL: kv.KV_REST_API_URL, UPSTASH_REDIS_REST_TOKEN: "t2" }), null, "mixed halves");
  assert.equal(R.readUpstashEnv({ KV_REST_API_URL: "http://a.upstash.io", KV_REST_API_TOKEN: "t" }), null, "http refused");
  assert.equal(R.readUpstashEnv({}), null);
  assert.equal(R.readUpstashEnv(Object.create(kv)), null, "inherited");
  assert.equal(R.UPSTASH_ENV_PAIRS.some((p) => /^VITE_/.test(p.url) || /^VITE_/.test(p.token)), false);
});
await check("4 registry: upstash backend; ARASO_GRANT_STORE=upstash without env = init failed; with either pair = full A-870 store + cap 20 policy", () => {
  assert.deepEqual(Object.keys(G.DURABLE_GRANT_STORE_BACKENDS), ["upstash"]);
  assert.equal(Object.isFrozen(G.DURABLE_GRANT_STORE_BACKENDS), true);
  assert.deepEqual(G.resolveProductionGrantStore({ ARASO_GRANT_STORE: "upstash" }), { ok: false, reason: "grant store init failed" });
  assert.deepEqual(G.resolveProductionGrantStore({ KV_REST_API_URL: FAKE_KV_URL, KV_REST_API_TOKEN: "x" }), { ok: false, reason: "grant store not configured" });
  for (const pair of [{ KV_REST_API_URL: FAKE_KV_URL, KV_REST_API_TOKEN: "x" }, { UPSTASH_REDIS_REST_URL: FAKE_KV_URL, UPSTASH_REDIS_REST_TOKEN: "x" }]) {
    const r = G.resolveProductionGrantStore({ ARASO_GRANT_STORE: "upstash", ...pair });
    assert.equal(r.ok, true); assert.equal(r.store.kind, "upstash"); assert.equal(r.store.contract, GRANT_STORE_CONTRACT_V1);
    assert.equal(r.store.requireBinding, true); assert.equal(r.store.testOnly, undefined);
    assert.equal(r.policy.globalCap, 20); assert.equal(r.policy.epoch, "default"); assert.equal(r.policy.allowlist, null);
  }
  assert.equal(G.resolveProductionInvite({ KV_REST_API_URL: FAKE_KV_URL, KV_REST_API_TOKEN: "x" }).ok, false, "invite path needs ARASO_GRANT_STORE=upstash too");
  assert.equal(G.resolveProductionInvite({ ARASO_GRANT_STORE: "upstash" }).ok, false);
  assert.equal(G.resolveProductionInvite({ ARASO_GRANT_STORE: "upstash", UPSTASH_REDIS_REST_URL: FAKE_KV_URL, UPSTASH_REDIS_REST_TOKEN: "x" }).ok, true);
});
await check("4/6 env missing: grant enabled + ARASO_GRANT_STORE=upstash but no Upstash env → grant 503 and invite actions 503 (no KV call, no RPC)", async () => {
  const off = env({ ARASO_GRANT_ENABLED: "1", ARASO_GRANT_STORE: "upstash", RELAYER_PRIVATE_KEY: KEY });
  try {
    const h = G.createGrantHandler();
    const rpc0 = rpcLog.length;
    const g = await call(h, { address: piggyKey().address });
    assert.equal(g.statusCode, 503); assert.equal(g.body.error, "grant store unavailable");
    const c = await call(h, { action: "invite_challenge", piggyAddress: piggyKey().address.toLowerCase() }, { invite: "x".repeat(43) });
    assert.equal(c.statusCode, 503); assert.equal(c.body.error, "invite store unavailable");
    assert.equal(rpcLog.length, rpc0);
  } finally { off(); }
  const h = G.createGrantHandler(); // launch gate off (default) = 503 before anything
  assert.equal((await call(h, { action: "invite_challenge", piggyAddress: piggyKey().address })).statusCode, 503);
});

// ==== 1) grant store: A-870 conformance over the fake KV (several instances, one KV) ===========================================
await check("1 grant store passes the A-870 conformance harness over the fake Upstash (cross-instance races, release/reconcile rules)", async () => {
  const results = await runGrantStoreConformance(async (n = 2) => {
    const kv = fakeUpstash();
    return Array.from({ length: n }, () => R.createUpstashGrantStore({ cmd: cmdOf(kv), requireBinding: false }));
  });
  const bad = results.filter((r) => !r.pass);
  assert.equal(bad.length, 0, bad.map((b) => `${b.name}: ${b.detail}`).join(" | "));
  assert.ok(results.length >= 25);
});
await check("1 reserve is ONE EVAL (binding + once + cap + insert); not bound = not_allowlisted without using a slot", async () => {
  const kv = fakeUpstash(); const p = parts(kv, { grant: {} });
  const a = piggyKey().address.toLowerCase();
  kv.evals.length = 0;
  assert.deepEqual(await p.grant.reserve({ identity: a, globalCap: 1 }), { ok: false, reason: "not_allowlisted" });
  assert.deepEqual(kv.evals, ["grant.reserve"]);
  const t = await issue(p); await p.invites.bind({ token: t.token, piggyAddress: a });
  kv.evals.length = 0;
  const r = await p.grant.reserve({ identity: a, globalCap: 1 });
  assert.equal(r.ok, true); assert.deepEqual(kv.evals, ["grant.reserve"]);
  assert.match(R.GRANT_RESERVE_LUA, /exists',KEYS\[3\]\)==0 then return -2[\s\S]*exists',KEYS\[1\]\)==1 then return 0[\s\S]*>=tonumber\(ARGV\[1\]\) then return -1[\s\S]*'set',KEYS\[1\][\s\S]*'incr',KEYS\[2\]/);
  assert.doesNotMatch(R.GRANT_RESERVE_LUA + R.GRANT_CAS_LUA + R.GRANT_RELEASE_LUA + I.INVITE_ISSUE_LUA + I.INVITE_BIND_LUA + F.FORK_PUT_IF_ABSENT_LUA + A.CHALLENGE_TAKE_LUA, /cjson|redis\.pcall|KEYS\[\d\]\.\./, "strings only, declared keys only");
});

// ==== handler wiring (injected parts on the fake KV) ========================================================================
const offMain = env({ ARASO_GRANT_ENABLED: "1", RELAYER_PRIVATE_KEY: KEY });
const sends = (from) => rpcLog.slice(from).filter((m) => m === "eth_sendRawTransaction").length;
const handlerOn = (p, policy = { globalCap: 20 }) => G.createGrantHandler({ store: p.grant, policy, invite: { invites: p.invites, challenges: p.challenges, appOrigin: APP, now: () => Date.now() } });

await check("5/6 invite → bind (Piggy signature, A-956 challenge purpose invite-bind) → grant 200 → again 403 already funded; not bound → 403 not allowlisted", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const h = handlerOn(p);
  const acct = piggyKey(); const t = await issue(p);
  const r0 = rpcLog.length;
  const pre = await call(h, { address: acct.address });
  assert.equal(pre.statusCode, 403); assert.equal(pre.body.error, "not allowlisted"); assert.equal(sends(r0), 0);
  const b = await bindVia(h, t.token, acct);
  assert.equal(b.statusCode, 200, JSON.stringify(b.body)); assert.equal(b.body.bound, true);
  const g = await call(h, { address: acct.address });
  assert.equal(g.statusCode, 200, JSON.stringify(g.body)); assert.equal(sends(r0), 1);
  assert.equal((await call(h, { address: acct.address })).body.error, "already funded");
  assert.equal(sends(r0), 1);
  const again = await bindVia(h, t.token, acct); // re-visit: same Piggy signature again = ok (idempotent)
  assert.equal(again.statusCode, 200);
});
await check("6 two concurrent grant requests for one bound address → exactly one reservation, one broadcast", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const h = handlerOn(p);
  const acct = piggyKey(); const t = await issue(p);
  assert.equal((await bindVia(h, t.token, acct)).statusCode, 200);
  const r0 = rpcLog.length;
  const [x, y] = await Promise.all([call(h, { address: acct.address }), call(h, { address: acct.address })]);
  assert.deepEqual([x.statusCode, y.statusCode].sort(), [200, 403]);
  assert.equal(sends(r0), 1);
});
await check("6 cap exceeded: cap 1, two bound addresses concurrently → one 200, one 503 grant cap reached; 30 concurrent reserves over 3 instances, cap 20 → exactly 20", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const h = handlerOn(p, { globalCap: 1 });
  const a = piggyKey(); const b = piggyKey();
  for (const acct of [a, b]) { const t = await issue(p); assert.equal((await bindVia(h, t.token, acct)).statusCode, 200); }
  const r0 = rpcLog.length;
  const rs = await Promise.all([call(h, { address: a.address }), call(h, { address: b.address })]);
  assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 503]);
  assert.equal(rs.find((r) => r.statusCode === 503).body.error, "grant cap reached"); assert.equal(sends(r0), 1);
  const kv2 = fakeUpstash();
  const inst = [0, 1, 2].map(() => parts(kv2, { invites: { maxInvites: 40 } }));
  const ids = [];
  for (let i = 0; i < 30; i += 1) { const id = piggyKey().address.toLowerCase(); const t = await issue(inst[0]); await inst[i % 3].invites.bind({ token: t.token, piggyAddress: id }); ids.push(id); }
  const out = await Promise.all(ids.map((id, i) => inst[i % 3].grant.reserve({ identity: id, globalCap: R.UPSTASH_GRANT_DEFAULTS.globalCap })));
  assert.equal(out.filter((r) => r.ok).length, 20); assert.equal(out.filter((r) => r.reason === "cap_reached").length, 10);
});
await check("6 invite expiry: unbound invite past 7 days → not invited (challenge 401) and bind refused; a bound invite does not expire", async () => {
  const kv = fakeUpstash(); const p = parts(kv);
  const h = G.createGrantHandler({ store: p.grant, policy: { globalCap: 20 }, invite: { invites: p.invites, challenges: p.challenges, appOrigin: APP, now: () => Date.now() } });
  const t1 = await issue(p); const t2 = await issue(p);
  assert.equal(t1.expiresAt - kv.clock.t, I.INVITE_DEFAULTS.ttlMs);
  const bound = piggyKey(); assert.equal((await bindVia(h, t2.token, bound)).statusCode, 200);
  kv.clock.t += I.INVITE_DEFAULTS.ttlMs + 1;
  assert.equal(await p.invites.testerFor(t1.token), null);
  const c = await call(h, { action: "invite_challenge", piggyAddress: piggyKey().address.toLowerCase() }, { invite: t1.token });
  assert.equal(c.statusCode, 401); assert.equal(c.body.error, "not invited");
  assert.deepEqual(await p.invites.bind({ token: t1.token, piggyAddress: piggyKey().address }), { ok: false, status: "not_invited" }); // the key itself expired
  const kv3 = fakeUpstash(); const p3 = parts(kv3); const t3 = await issue(p3);
  kv3.clock.t = t3.expiresAt; // exactly at expiry, key not yet gone in the store: the script's own clock check refuses
  const tokKey = `araso:v1:invite:tok:${I.inviteTokenDigest(t3.token)}`;
  assert.equal(kv3.ttlOf(tokKey), 0);
  assert.equal(typeof (await p3.invites.testerFor(t3.token)), "object"); // gone at ttl 0 in the fake = null
  assert.ok(await p.invites.testerFor(t2.token), "bound invite still answers after 7 days");
});
await check("6 other Piggy: an invite bound to Piggy A refuses Piggy B; a Piggy bound to tester 1 refuses tester 2's invite; signature by another key refused", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const h = handlerOn(p);
  const a = piggyKey(); const b = piggyKey(); const t1 = await issue(p); const t2 = await issue(p);
  assert.equal((await bindVia(h, t1.token, a)).statusCode, 200);
  const rb = await bindVia(h, t1.token, b);
  assert.equal(rb.statusCode, 403); assert.equal(rb.body.error, "invite_bound_to_other_piggy");
  const r2 = await bindVia(h, t2.token, a);
  assert.equal(r2.statusCode, 403); assert.equal(r2.body.error, "piggy_bound_to_other_tester");
  // B (never bound) still cannot be granted
  assert.equal((await call(h, { address: b.address })).body.error, "not allowlisted");
  // a challenge for A signed by B's key
  const c = await call(h, { action: "invite_challenge", piggyAddress: a.address.toLowerCase() }, { invite: t2.token });
  const sig = await b.signMessage({ message: c.body.message });
  const r = await call(h, { action: "invite_bind", nonce: c.body.nonce, signature: sig, piggyAddress: a.address.toLowerCase() }, { invite: t2.token });
  assert.equal(r.statusCode, 403); assert.equal(r.body.error, "signer_not_piggy");
  // replay of a consumed nonce
  const c2 = await call(h, { action: "invite_challenge", piggyAddress: b.address.toLowerCase() }, { invite: t2.token });
  const s2 = await b.signMessage({ message: c2.body.message });
  const ok = await call(h, { action: "invite_bind", nonce: c2.body.nonce, signature: s2, piggyAddress: b.address.toLowerCase() }, { invite: t2.token });
  assert.equal(ok.statusCode, 200);
  const replay = await call(h, { action: "invite_bind", nonce: c2.body.nonce, signature: s2, piggyAddress: b.address.toLowerCase() }, { invite: t2.token });
  assert.equal(replay.body.error, "unknown_or_used_nonce");
});
await check("5 CSRF/Origin + shape on invite actions: cross-site 403 · foreign Origin 403 · text/plain 415 · extra field 400 · bad address 400 · no token 401", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const h = handlerOn(p); const t = await issue(p);
  const piggy = piggyKey().address.toLowerCase();
  const body = { action: "invite_challenge", piggyAddress: piggy };
  assert.equal((await call(h, body, { headers: { ...HEADERS, "sec-fetch-site": "cross-site" }, invite: t.token })).statusCode, 403);
  assert.equal((await call(h, body, { headers: { ...HEADERS, origin: "https://evil.example" }, invite: t.token })).statusCode, 403);
  assert.equal((await call(h, body, { headers: { ...HEADERS, "content-type": "text/plain" }, invite: t.token })).statusCode, 415);
  assert.equal((await call(h, { ...body, testerId: "tester-x" }, { invite: t.token })).statusCode, 400);
  assert.equal((await call(h, { action: "invite_challenge", piggyAddress: "0x0000000000000000000000000000000000000000" }, { invite: t.token })).statusCode, 400);
  assert.equal((await call(h, body)).statusCode, 401);
  assert.equal((await call(h, { action: "nope", address: piggy })).statusCode, 400, "unknown action = old grant path = 400 unexpected fields");
});
await check("A-956 challenge reuse: purposes cannot cross (fork-entry record ≠ invite-bind); fork-entry message byte-identical to before", async () => {
  const mem = A.createMemoryChallengeStore();
  const acct = piggyKey(); const piggy = acct.address.toLowerCase();
  const f = A.issueChallenge({ store: mem, uri: APP, chainId: 31337143, testerId: "tester-1", piggyAddress: piggy, forkInstanceId: "fork-1", now: 1000, randomHex: () => "a".repeat(32) });
  assert.equal(f.message, ["Araso Journey 2 entry", `uri: ${APP}`, "chainId: 31337143", `piggy: ${piggy}`, "tester: tester-1", "fork: fork-1", `nonce: ${"a".repeat(32)}`, `expires: ${new Date(1000 + A.FORK_CHALLENGE_TTL_MS).toISOString()}`].join("\n"));
  const sig = await acct.signMessage({ message: f.message });
  assert.equal((await A.verifyChallenge({ store: mem, nonce: f.nonce, signature: sig, testerId: "tester-1", piggyAddress: piggy, purpose: "invite-bind", now: 1001 })).reason, "purpose_mismatch");
  const kv = fakeUpstash(); const rs = A.createRedisChallengeStore({ cmd: cmdOf(kv) });
  const i = await A.issueChallengeAsync({ store: rs, purpose: "invite-bind", uri: APP, chainId: 10143, testerId: "tester-2", piggyAddress: piggy, now: 1000 });
  assert.equal(i.message.split("\n")[0], "Araso invite bind"); assert.equal(i.message.split("\n").length, 7);
  const s2 = await acct.signMessage({ message: i.message });
  assert.equal((await A.verifyChallenge({ store: rs, nonce: i.nonce, signature: s2, testerId: "tester-2", piggyAddress: piggy, now: 1001 })).reason, "purpose_mismatch", "invite text never passes as fork entry");
  const i2 = await A.issueChallengeAsync({ store: rs, purpose: "invite-bind", uri: APP, chainId: 10143, testerId: "tester-2", piggyAddress: piggy, now: 1000 });
  const s3 = await acct.signMessage({ message: i2.message });
  assert.equal((await A.verifyChallenge({ store: rs, nonce: i2.nonce, signature: s3, testerId: "tester-2", piggyAddress: piggy, purpose: "invite-bind", now: 1000 + A.FORK_CHALLENGE_TTL_MS })).reason, "challenge_expired");
  const ttl = kv.ttlOf(`araso:v1:challenge:${i.nonce}`);
  assert.equal(ttl, null, "consumed nonce is gone");
});

// ==== 2) invite store ====================================================================================================
// pre-A-1115: label "256-bit token" and token /^[A-Za-z0-9_-]{43}$/ decoding to 32 bytes. A-1115 (Owner "1번"): 128-bit, 22 chars, 16 bytes.
await check("2 invites: 128-bit token shown once · only its SHA-256 digest is a key · testerId = server random (not from the token) · 20 max · 7 days", async () => {
  const kv = fakeUpstash(); const p = parts(kv);
  const all = [];
  for (let i = 0; i < 20; i += 1) { const r = await issue(p); assert.equal(r.ok, true); all.push(r); }
  assert.deepEqual(await p.invites.issue(), { ok: false, reason: "max_reached" });
  for (const r of all) {
    assert.match(r.token, /^[A-Za-z0-9_-]{22}$/); assert.equal(Buffer.from(r.token, "base64url").length, 16);
    assert.match(r.testerId, /^tester-[0-9a-f]{16}$/);
    assert.equal(await p.invites.testerFor(r.token), r.testerId);
    assert.equal(kv.ttlOf(`araso:v1:invite:tok:${I.inviteTokenDigest(r.token)}`), I.INVITE_DEFAULTS.ttlMs);
  }
  assert.equal(new Set(all.map((r) => r.testerId)).size, 20);
  const dump = kv.dump();
  for (const r of all) assert.equal(dump.includes(r.token), false);
  assert.deepEqual(I.INVITE_DEFAULTS, { maxInvites: 20, ttlMs: 604800000 });
  assert.equal(await p.invites.testerFor("not-a-real-token-0000"), null);
});
await check("2 bind: once, atomically, to the first Piggy (concurrent binds of one token to 5 Piggies → exactly 1); bound row loses its TTL", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const t = await issue(p);
  const ps = Array.from({ length: 5 }, () => piggyKey().address);
  const rs = await Promise.all(ps.map((a) => p.invites.bind({ token: t.token, piggyAddress: a })));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.equal(rs.filter((r) => r.status === "invite_bound_to_other_piggy").length, 4);
  assert.equal(kv.ttlOf(`araso:v1:invite:tok:${I.inviteTokenDigest(t.token)}`), null);
  const winner = ps[rs.findIndex((r) => r.ok)].toLowerCase();
  assert.deepEqual(await p.invites.bind({ token: t.token, piggyAddress: winner }), { ok: true, status: "already_bound" });
});

// ==== 3) fork ledger store =================================================================================================
const h64 = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const PIG = "0x" + "ab".repeat(20);
const ev = (n) => { const r = evidenceRecord({ forkInstanceId: "fork-1", journeyId: "j1", journeyVersion: 1, piggyAddress: PIG, stepId: `s${n}`, txHash: h64(n), blockNumber: 100 + n, chainId: 31337143, status: "success" }); if (!r.ok) throw new Error(`fixture ${r.reason}`); return r; };
await check("3 fork ledger store: A-952 contract shape · putIfAbsent = one EVAL (SET NX + index) · 10 concurrent same key → 1 created · same answers as the memory store", async () => {
  const kv = fakeUpstash(); const cmd = cmdOf(kv);
  const s1 = F.createUpstashForkLedgerStore({ cmd }); const s2 = F.createUpstashForkLedgerStore({ cmd: cmdOf(kv) });
  const mem = createMemoryForkLedgerStore();
  assert.equal(isForkLedgerStore(s1), true); assert.equal(s1.testOnly, undefined);
  const e = ev(1);
  kv.evals.length = 0;
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => [s1, s2][i % 2].putIfAbsent("evidence", e.key, e.record)));
  assert.equal(rs.filter((r) => r.ok && r.created).length, 1);
  assert.equal(rs.filter((r) => !r.ok && r.reason === "exists").length, 9);
  assert.deepEqual(rs.find((r) => !r.ok).existing, e.record);
  assert.ok(kv.evals.every((x) => x === "fork.putIfAbsent"));
  await mem.putIfAbsent("evidence", e.key, e.record);
  for (const n of [5, 3, 9, 2]) { const x = ev(n); await s1.putIfAbsent("evidence", x.key, x.record); await mem.putIfAbsent("evidence", x.key, x.record); }
  assert.deepEqual(await s2.list("evidence"), await mem.list("evidence"));
  const got = await s2.get("evidence", e.key);
  assert.deepEqual(got, await mem.get("evidence", e.key)); assert.equal(Object.isFrozen(got), true);
  assert.equal(await s1.get("evidence", "fork-evidence|nope"), null); assert.equal(await s1.get("nope", e.key), null);
  assert.deepEqual(await s1.list("nope"), []);
  // validation identical to the memory adapter (no write on refusal)
  const rk = rewardKey({ campaignVersion: "c1", piggyAddress: PIG }); const st = stampRecord({ forkInstanceId: "fork-1", piggyAddress: PIG, journeyId: "j1", journeyVersion: "v1" });
  const bads = [["nope", e.key, e.record], ["rewards", e.key, e.record], ["evidence", e.key + " ", e.record], ["evidence", e.key, { ...e.record, stepId: "S1" }]];
  if (st.ok) bads.push(["evidence", st.key, st.record]);
  if (rk.ok) bads.push(["payouts", rk.key, { kind: "x", key: rk.key }]);
  const before = kv.bodies.length;
  for (const [c, k, v] of bads) assert.deepEqual(await s1.putIfAbsent(c, k, v), await mem.putIfAbsent(c, k, v), `${c} ${k}`);
  assert.equal(kv.bodies.length, before, "refusals never reach the store");
  assert.equal(F.forkLedgerStoreFromEnv({}), null);
  assert.equal(F.forkLedgerStoreFromEnv({ UPSTASH_REDIS_REST_URL: FAKE_KV_URL, UPSTASH_REDIS_REST_TOKEN: FAKE_KV_TOKEN }).kind, "upstash");
  assert.equal(I.inviteStoreFromEnv({}), null);
});
await check("fail-closed on store trouble: KV down → grant 503 / invite 503; KV error reply → throws (no partial answer)", async () => {
  const kv = fakeUpstash(); const p = parts(kv); const h = handlerOn(p); const t = await issue(p);
  kv.setDown(true);
  const r0 = rpcLog.length;
  assert.equal((await call(h, { address: piggyKey().address })).body.error, "grant store unavailable");
  assert.equal((await call(h, { action: "invite_challenge", piggyAddress: piggyKey().address.toLowerCase() }, { invite: t.token })).body.error, "invite store unavailable");
  assert.equal(sends(r0), 0);
  kv.setDown(false);
  const bad = R.createUpstashRest({ url: FAKE_KV_URL, token: "wrong", fetchImpl: kv.fetchImpl });
  await assert.rejects(() => bad("GET", "k"), /KV_HTTP/);
  assert.equal(R.createUpstashRest({ url: "http://x.io", token: "t" }), null);
});

// ==== production path end-to-end with env (in this process only) on the fake KV ==========================================
await check("production path: ARASO_GRANT_ENABLED + ARASO_GRANT_STORE=upstash + UPSTASH_REDIS_REST_* (fake KV) → invite bind → grant → duplicate", async () => {
  const kv = fakeUpstash(); kvRoute = kv;
  const off = env({ ARASO_GRANT_STORE: "upstash", UPSTASH_REDIS_REST_URL: FAKE_KV_URL, UPSTASH_REDIS_REST_TOKEN: FAKE_KV_TOKEN });
  try {
    const h = G.createGrantHandler();
    const op = I.createUpstashInviteStore({ cmd: cmdOf(kv) }); // the operator's issue step (same store)
    const t = await op.issue(); issued.push(t.token);
    const acct = piggyKey(); const r0 = rpcLog.length;
    assert.equal((await call(h, { address: acct.address })).body.error, "not allowlisted");
    assert.equal((await bindVia(h, t.token, acct)).statusCode, 200);
    const g = await call(h, { address: acct.address });
    assert.equal(g.statusCode, 200, JSON.stringify(g.body));
    assert.equal((await call(h, { address: acct.address })).body.error, "already funded");
    assert.equal(sends(r0), 1);
    assert.ok(kv.evals.includes("grant.reserve") && kv.evals.includes("grant.cas") && kv.evals.includes("invite.bind") && kv.evals.includes("challenge.take"));
  } finally { off(); kvRoute = null; }
});

// ==== token never logged / stored ========================================================================================
await check("6 raw invite token: never in any log line, never in any stored key/value, never in any KV request body", () => {
  assert.ok(issued.length > 20);
  const logs = logLines.join("\n");
  for (const t of issued) assert.equal(logs.includes(t), false, "log");
  assert.ok(logLines.some((l) => l.startsWith("invite ")), "invite paths did log (reason codes)");
  const src = ["api/_lib/grant-redis-store.js", "api/_lib/invite-redis-store.js", "api/_lib/fork-ledger-redis-store.js"].map((f) => readFileSync(path.join(REPO, f), "utf8")).join("\n");
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /console\./, "adapters never log");
  const grantSrc = readFileSync(path.join(REPO, "api/grant.js"), "utf8");
  const inviteLogs = grantSrc.split("\n").filter((l) => /console\.(log|error)\(`invite/.test(l));
  assert.ok(inviteLogs.length > 0 && inviteLogs.every((l) => !/token|raw|headers/.test(l)), "invite log lines carry reason + short address only");
});
await check("7 defaults (Owner 확정 대기): invites 20 · 7 days · grant cap 20 · grant amount 0.1 MON unchanged", () => {
  assert.equal(I.INVITE_DEFAULTS.maxInvites, 20); assert.equal(I.INVITE_DEFAULTS.ttlMs, 7 * 86400000);
  assert.equal(R.UPSTASH_GRANT_DEFAULTS.globalCap, 20); assert.equal(GRANT_WEI, 100_000_000_000_000_000n);
});
await check("Gift KV store matches the accepted metadata baseline (sha256)", () => {
  // The fixed digest keeps the intentional letter metadata and rejects later byte drift in a clone.
  const BASE_KV_STORE_SHA256 = "057537840c9fd716e0cf64196527ab2d7e2c5e5da4d9cb45d9cbfc5872aff4dd";
  assert.equal(createHash("sha256").update(readFileSync(path.join(REPO, "api/_lib/gift-sponsor-kv-store.js"), "utf8")).digest("hex"), BASE_KV_STORE_SHA256);
});
// A1160: real grant handler and real durable adapter, fake RPC/Redis only.
await check("A1160 public grant200 -> duplicate; public cap independent of invited20", async () => {
  const kv = fakeUpstash(), p = parts(kv, { grant: { publicEntry: { enabled: true, cap: 1 } } }), h = handlerOn(p);
  const a = piggyKey(), b = piggyKey(), invited = piggyKey();
  assert.equal((await call(h, { address: a.address })).statusCode, 200);
  assert.equal((await call(h, { address: a.address })).body.error, "already funded");
  assert.equal((await call(h, { address: b.address })).body.error, "grant cap reached");
  const t = await issue(p); assert.equal((await bindVia(h, t.token, invited)).statusCode, 200);
  assert.equal((await call(h, { address: invited.address })).statusCode, 200);
  // Binding an already public-funded address cannot create another grant row.
  const t2 = await issue(p); await bindVia(h, t2.token, a);
  assert.equal((await call(h, { address: a.address })).body.error, "already funded");
});
await check("A1160 public cap concurrent workers, closed/invalid config and budget-correct release", async () => {
  const { publicEntryConfig } = await import('../../api/_lib/public-entry.js');
  for (const raw of [undefined, '', '0', '-1', '1.5', '1e3', '9007199254740992']) assert.equal(publicEntryConfig({ ARASO_PUBLIC_ENTRY:'1', ARASO_PUBLIC_GRANT_CAP:raw }).cap, 0);
  assert.equal(publicEntryConfig(Object.create({ ARASO_PUBLIC_ENTRY:'1' })).enabled, false);
  const kv = fakeUpstash(), conf = { publicEntry: { enabled: true, cap: 2 } };
  const stores = [parts(kv, { grant:conf }).grant, parts(kv, { grant:conf }).grant];
  const addresses = Array.from({length:10}, () => piggyKey().address.toLowerCase());
  const out = await Promise.all(addresses.map((identity,i) => stores[i%2].reserve({ identity, globalCap:20 })));
  assert.equal(out.filter(r=>r.ok).length, 2);
  const i = out.findIndex(r=>r.ok), req = { identity:addresses[i], reservationId:out[i].reservationId };
  await stores[0].settle({...req,outcome:'aborted_before_send'});
  assert.equal((await stores[0].release(req)).ok,true);
  assert.equal((await stores[1].reserve({identity:piggyKey().address.toLowerCase(),globalCap:20})).ok,true);
  assert.equal((await stores[0].reserve({identity:addresses[i],globalCap:20})).reason,'duplicate');
  const closed=parts(fakeUpstash(),{grant:{publicEntry:{enabled:true,cap:0}}});
  assert.equal((await closed.grant.reserve({identity:addresses[0],globalCap:20})).reason,'not_allowlisted');
});
offMain();
await check("network 0", () => { assert.equal(netCalls, 0); });
console.info(`\nA-960 upstash local: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
