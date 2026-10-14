// [A-882] /api/grant predeploy hardening — offline. Network 0, real key 0, tx 0.
//
// Proves:
//   R  route surface: the A-870 contract lives in api/_lib/ (Vercel does not turn `_`-prefixed paths into functions);
//      api/grant-store-contract.js is gone; every non-underscore api/**/*.js is a handler with a default export;
//      api/grant.js and the a870/a875 suites import the contract from api/_lib/; vercel.json `functions` keys exist
//   O  own properties: normalizeGrantPolicy reads epoch / allowlist / globalCap only as own properties —
//      a polluted Object.prototype (or an inherited policy object) cannot raise the cap, pick the epoch or add an allowlist
//   H  handler: under prototype pollution the reserve call still carries the own-property cap/epoch, and a policy
//      with no own cap/allowlist still fails closed (503, no reserve, 0 RPC)
//   D  default-off: production default export (enabled, no backend) → 503 "grant store unavailable", 0 RPC —
//      also with a polluted prototype and with ARASO_GRANT_STORE naming an inherited key

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p) => path.join(ROOT, p);

// ---- network: none. Any fetch is a failure (and counted). --------------------------------------------
process.env.MONAD_RPC_URL = "http://a882-no-network.invalid";
let netCalls = 0;
globalThis.fetch = async (url) => {
  netCalls += 1;
  throw new Error(`a882: unexpected network call to ${url}`);
};

const mod = await import("../../api/grant.js");
const { createGrantHandler, normalizeGrantPolicy, acceptProductionGrantStoreBuild, resolveProductionGrantStore,
  GRANT_STORE_CONTRACT, GRANT_DEFAULT_EPOCH, GRANT_ENABLE_ENV, GRANT_STORE_ENV } = mod;
const C = await import("../../api/_lib/grant-store-contract.js");

let passed = 0;
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
const HEADERS = Object.freeze({ "content-type": "application/json", origin: "https://arasoo.vercel.app", "sec-fetch-site": "same-origin" });
const responses = [];
async function call(h, address) {
  const res = makeRes();
  await h({ method: "POST", headers: HEADERS, body: { address }, async *[Symbol.asyncIterator]() {} }, res);
  responses.push(res);
  return res;
}
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;

const POLLUTED = ["globalCap", "epoch", "allowlist"];
/** Pollutes Object.prototype only for the duration of fn (non-enumerable, so unrelated for-in code is undisturbed). */
async function withPollution(values, fn) {
  const before = POLLUTED.map((k) => [k, Object.getOwnPropertyDescriptor(Object.prototype, k)]);
  for (const [k, v] of Object.entries(values)) {
    Object.defineProperty(Object.prototype, k, { value: v, writable: true, configurable: true, enumerable: false });
  }
  try {
    return await fn();
  } finally {
    for (const [k, d] of before) {
      if (d) Object.defineProperty(Object.prototype, k, d);
      else delete Object.prototype[k];
    }
  }
}
const ATTACK = () => ({ globalCap: 1000, epoch: "polluted", allowlist: [fresh()] });

const KEY_NAME = ["RELAYER", "PRIVATE", "KEY"].join("_");
process.env[KEY_NAME] = generatePrivateKey();
delete process.env[GRANT_STORE_ENV];
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;
process.env[GRANT_ENABLE_ENV] = "1";

// ---- R: route surface --------------------------------------------------------------------------------
await check("R contract moved: api/_lib/grant-store-contract.js exists, api/grant-store-contract.js does not", async () => {
  assert.equal(existsSync(rel("api/_lib/grant-store-contract.js")), true);
  assert.equal(existsSync(rel("api/grant-store-contract.js")), false);
  assert.equal(C.GRANT_STORE_CONTRACT_V1, GRANT_STORE_CONTRACT);
  assert.equal(C.DEFAULT_EPOCH, GRANT_DEFAULT_EPOCH);
  assert.equal("default" in C, false, "_lib contract is a module, not a handler");
});
await check("R every non-underscore api/**/*.js is a handler (default export function); only api/grant.js today", async () => {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(rel(dir)).sort()) {
      if (name.startsWith("_") || name.startsWith(".")) continue; // Vercel: _-prefixed files/dirs are not functions
      const p = `${dir}/${name}`;
      if (statSync(rel(p)).isDirectory()) walk(p);
      else if (/\.(c|m)?[jt]sx?$/.test(name)) found.push(p);
    }
  };
  walk("api");
  assert.deepEqual(found, ["api/event.js", "api/fork-entry.js", "api/gift-sponsor-reconcile.js", "api/gift-sponsor.js", "api/grant.js", "api/relay-quote.js"]); // [A-1234] + same-origin enum-only api/event.js. [A-956 RE-PIN] + api/fork-entry.js (local-only Journey 2 entry route; refuses production markers). pre-A-956: the 4 routes after it. // [A-913] pre-A-913 baseline: ["api/grant.js", "api/relay-quote.js"] ([A-901] pre-A-901 baseline: ["api/grant.js"])
  for (const p of found) {
    const m = await import(pathToFileURL(rel(p)).href);
    assert.equal(typeof m.default, "function", p);
  }
});
await check("R imports point to api/_lib (grant.js, a870, a875); no reference to the old public path", async () => {
  assert.match(readFileSync(rel("api/grant.js"), "utf8"), /from\s+"\.\/_lib\/grant-store-contract\.js"/);
  for (const p of ["api/grant.js", "app/test/a870-grant-store-contract.mjs", "app/test/a875-grant-store-wiring.mjs"]) {
    const s = readFileSync(rel(p), "utf8");
    assert.equal(/api\/grant-store-contract\.js|["']\.\/grant-store-contract\.js["']/.test(s), false, p);
  }
  for (const p of ["app/test/a870-grant-store-contract.mjs", "app/test/a875-grant-store-wiring.mjs"]) {
    assert.match(readFileSync(rel(p), "utf8"), /api\/_lib\/grant-store-contract\.js/, p);
  }
});
await check("R vercel.json functions keys all exist and none is under _lib", async () => {
  const cfg = JSON.parse(readFileSync(rel("vercel.json"), "utf8"));
  for (const k of Object.keys(cfg.functions ?? {})) {
    assert.equal(existsSync(rel(k)), true, k);
    assert.equal(k.includes("/_"), false, k);
  }
  assert.equal(JSON.stringify(cfg).includes("grant-store-contract"), false);
});

// ---- O: own-property policy reads --------------------------------------------------------------------
await check("O polluted Object.prototype cannot alter cap, epoch or allowlist", async () => {
  const a = fresh(), b = fresh();
  await withPollution(ATTACK(), async () => {
    assert.equal(({}).globalCap, 1000, "pollution is active");
    const p1 = normalizeGrantPolicy({ allowlist: [a, b] });
    assert.equal(p1.globalCap, 2);
    assert.equal(p1.capSource, "allowlist_size");
    assert.equal(p1.epoch, GRANT_DEFAULT_EPOCH);
    const p2 = normalizeGrantPolicy({ globalCap: 3 });
    assert.equal(p2.globalCap, 3);
    assert.equal(p2.allowlist, null, "inherited allowlist ignored");
    assert.equal(p2.epoch, GRANT_DEFAULT_EPOCH);
    assert.equal(normalizeGrantPolicy({}), null, "no own cap/allowlist → fail-closed, not cap 1000");
    const p3 = normalizeGrantPolicy({ globalCap: 4, epoch: "own-e1" });
    assert.deepEqual([p3.globalCap, p3.epoch], [4, "own-e1"], "own values still win");
  });
});
await check("O inherited policy object (Object.create) is ignored; null-prototype object with own values works", async () => {
  assert.equal(normalizeGrantPolicy(Object.create({ globalCap: 5 })), null);
  const inh = normalizeGrantPolicy(Object.create({ globalCap: 5, epoch: "x" }, { allowlist: { value: [fresh()], enumerable: true } }));
  assert.deepEqual([inh.globalCap, inh.epoch, inh.capSource], [1, GRANT_DEFAULT_EPOCH, "allowlist_size"]);
  const np = Object.assign(Object.create(null), { globalCap: 2, epoch: "np" });
  const p = normalizeGrantPolicy(np);
  assert.deepEqual([p.globalCap, p.epoch, p.capSource], [2, "np", "explicit"]);
});
await check("O pollution cannot bypass production build acceptance (no own cap/allowlist → refused)", async () => {
  const synth = C.createSyntheticStoreInstance(C.createSyntheticRemote());
  const full = { ...synth, testOnly: false };
  await withPollution(ATTACK(), async () => {
    assert.equal(acceptProductionGrantStoreBuild({ store: full, policy: {} }).ok, false);
    const ok = acceptProductionGrantStoreBuild({ store: full, policy: { globalCap: 2 } });
    assert.deepEqual([ok.ok, ok.policy.globalCap, ok.policy.epoch, ok.policy.allowlist], [true, 2, GRANT_DEFAULT_EPOCH, null]);
  });
});
await check("O unpolluted semantics unchanged (A-870/A-875 policy rules)", async () => {
  const a = fresh();
  assert.deepEqual({ ...normalizeGrantPolicy({ globalCap: 5 }) }, { globalCap: 5, allowlist: null, epoch: "default", capSource: "explicit" });
  assert.equal(normalizeGrantPolicy({ allowlist: [a, a.toLowerCase()] }).globalCap, 1);
  assert.equal(normalizeGrantPolicy({ allowlist: [] }), null);
  assert.equal(normalizeGrantPolicy({ globalCap: 7, allowlist: [a] }).globalCap, 7);
  assert.equal(normalizeGrantPolicy({ globalCap: 1, epoch: "bad epoch!" }), null);
  assert.equal(normalizeGrantPolicy({ globalCap: 0 }), null);
  assert.equal(normalizeGrantPolicy({ allowlist: "x" }), null);
  assert.equal(normalizeGrantPolicy(null), null);
  assert.equal(Object.isFrozen(normalizeGrantPolicy({ globalCap: 1 })), true);
});

// ---- H: handler under pollution ----------------------------------------------------------------------
function spyStore() {
  const seen = [];
  return {
    seen,
    store: {
      contract: GRANT_STORE_CONTRACT,
      testOnly: true,
      async reserve(a) { seen.push(a); return { ok: false, reason: "duplicate" }; }, // stop before any RPC
      async settle() {},
    },
  };
}
await check("H polluted prototype: reserve carries own-property cap/epoch (allowlist size, \"default\"), 0 RPC", async () => {
  const a = fresh(), b = fresh();
  const { seen, store } = spyStore();
  const h = createGrantHandler({ store, policy: { allowlist: [a, b] } });
  const n0 = netCalls;
  const res = await withPollution(ATTACK(), () => call(h, a));
  assert.deepEqual([res.statusCode, res.body], [403, { ok: false, error: "already funded" }]);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { identity: a.toLowerCase(), globalCap: 2, epoch: "default" });
  assert.equal(netCalls, n0);
});
await check("H polluted prototype + policy without own cap/allowlist → 503 grant store unavailable, no reserve, 0 RPC", async () => {
  const { seen, store } = spyStore();
  const h = createGrantHandler({ store, policy: {} });
  const n0 = netCalls;
  const res = await withPollution(ATTACK(), () => call(h, fresh()));
  assert.deepEqual([res.statusCode, res.body], [503, { ok: false, error: "grant store unavailable" }]);
  assert.equal(seen.length, 0);
  assert.equal(netCalls, n0);
});

// ---- D: default-off ----------------------------------------------------------------------------------
await check("D production default export (enabled, no store) → 503, 0 RPC — clean, polluted, and inherited ARASO_GRANT_STORE name", async () => {
  const n0 = netCalls;
  const r1 = await call(mod.default, fresh());
  assert.deepEqual([r1.statusCode, r1.body], [503, { ok: false, error: "grant store unavailable" }]);
  const r2 = await withPollution(ATTACK(), () => call(mod.default, fresh()));
  assert.deepEqual([r2.statusCode, r2.body], [503, { ok: false, error: "grant store unavailable" }]);
  Object.defineProperty(Object.prototype, "a882evil", { value: () => ({ store: {}, policy: { globalCap: 1000 } }), configurable: true });
  process.env[GRANT_STORE_ENV] = "a882evil";
  try {
    assert.equal(resolveProductionGrantStore(process.env).ok, false);
    const r3 = await call(mod.default, fresh());
    assert.deepEqual([r3.statusCode, r3.body], [503, { ok: false, error: "grant store unavailable" }]);
  } finally {
    delete process.env[GRANT_STORE_ENV];
    delete Object.prototype.a882evil;
  }
  assert.equal(netCalls, n0);
});
await check("D disabled gate still first: ARASO_GRANT_ENABLED unset → 503 grant disabled", async () => {
  delete process.env[GRANT_ENABLE_ENV];
  try {
    const r = await call(mod.default, fresh());
    assert.deepEqual([r.statusCode, r.body], [503, { ok: false, error: "grant disabled" }]);
  } finally { process.env[GRANT_ENABLE_ENV] = "1"; }
});
// ---- [A-895 P-C] R1-R3 (A-882 REVIEW residuals) ------------------------------------------------------
await check("R1 sparse / extra-prop allowlist arrays are refused (null policy), even with Object.prototype[0] polluted", async () => {
  const a = fresh();
  assert.equal(normalizeGrantPolicy({ allowlist: [, a], globalCap: 2 }), null); // eslint-disable-line no-sparse-arrays
  const holey = [a]; holey.length = 2;
  assert.equal(normalizeGrantPolicy({ allowlist: holey, globalCap: 2 }), null);
  const extra = [a]; extra.x = 1;
  assert.equal(normalizeGrantPolicy({ allowlist: extra, globalCap: 1 }), null);
  const b = fresh();
  Object.defineProperty(Object.prototype, "0", { value: a, configurable: true });
  try { assert.equal(normalizeGrantPolicy({ allowlist: [, b], globalCap: 2 }), null); } // eslint-disable-line no-sparse-arrays
  finally { delete Object.prototype[0]; }
  assert.equal(normalizeGrantPolicy({ allowlist: [a], globalCap: 1 }).allowlist.size, 1); // dense still ok
  assert.equal(normalizeGrantPolicy({ allowlist: [], globalCap: 1 }).allowlist.size, 0);
});
await check("R2 env is read through own properties: polluted Object.prototype cannot enable the gate or pick a backend", async () => {
  const saved = process.env[GRANT_ENABLE_ENV];
  delete process.env[GRANT_ENABLE_ENV];
  Object.defineProperty(Object.prototype, GRANT_ENABLE_ENV, { value: "1", configurable: true });
  Object.defineProperty(Object.prototype, GRANT_STORE_ENV, { value: "x", configurable: true });
  try {
    assert.equal(mod.isGrantEnabled(process.env), false);
    assert.equal(mod.isGrantEnabled({}), false);
    assert.deepEqual(resolveProductionGrantStore({}), { ok: false, reason: "grant store not configured" });
    const r = await call(mod.default, fresh());
    assert.deepEqual([r.statusCode, r.body], [503, { ok: false, error: "grant disabled" }]);
    assert.equal(mod.isGrantEnabled({ [GRANT_ENABLE_ENV]: "true" }), true); // own value still works
  } finally {
    delete Object.prototype[GRANT_ENABLE_ENV]; delete Object.prototype[GRANT_STORE_ENV];
    if (saved !== undefined) process.env[GRANT_ENABLE_ENV] = saved;
  }
});
await check("R3 isGrantStore / acceptProductionGrantStoreBuild ignore Object.prototype pollution; class stores still pass", async () => {
  const fn = () => {};
  const full = (extra = {}) => Object.assign(Object.create(null), { reserve: fn, settle: fn, release: fn, reconcile: fn, ...extra });
  const good = full({ contract: GRANT_STORE_CONTRACT });
  assert.equal(mod.isGrantStore(good), true);
  // missing own contract, but a polluted prototype supplies it -> must be refused
  const noContract = { reserve: fn, settle: fn };
  Object.defineProperty(Object.prototype, "contract", { value: GRANT_STORE_CONTRACT, configurable: true });
  Object.defineProperty(Object.prototype, "release", { value: fn, configurable: true });
  Object.defineProperty(Object.prototype, "reconcile", { value: fn, configurable: true });
  try {
    assert.equal(mod.isGrantStore(noContract), false);
    assert.equal(acceptProductionGrantStoreBuild({ store: noContract, policy: { globalCap: 1 } }).ok, false);
    const partial = { contract: GRANT_STORE_CONTRACT, reserve: fn, settle: fn };
    assert.equal(acceptProductionGrantStoreBuild({ store: partial, policy: { globalCap: 1 } }).ok, false);
  } finally { for (const k of ["contract", "release", "reconcile"]) delete Object.prototype[k]; }
  // inherited testOnly:true must not hide (it is read as own/class only: Object.prototype is skipped) - but own testOnly refuses
  assert.equal(acceptProductionGrantStoreBuild({ store: { ...good, testOnly: true }, policy: { globalCap: 1 } }).ok, false);
  assert.equal(acceptProductionGrantStoreBuild({ store: good, policy: { globalCap: 1 } }).ok, true);
  class Cls { get contract() { return GRANT_STORE_CONTRACT; } reserve() {} settle() {} release() {} reconcile() {} }
  assert.equal(acceptProductionGrantStoreBuild({ store: new Cls(), policy: { globalCap: 1 } }).ok, true);
  // inherited built.store / built.policy are not honoured either
  Object.defineProperty(Object.prototype, "store", { value: good, configurable: true });
  Object.defineProperty(Object.prototype, "policy", { value: { globalCap: 9 }, configurable: true });
  try { assert.equal(acceptProductionGrantStoreBuild({}).ok, false); }
  finally { delete Object.prototype.store; delete Object.prototype.policy; }
});
await check(`N Cache-Control: no-store on all ${responses.length} responses; prototype clean; network 0`, async () => {
  for (const r of responses) assert.equal(r.headers["cache-control"], "no-store");
  for (const k of [...POLLUTED, "a882evil"]) assert.equal(Object.hasOwn(Object.prototype, k), false, k);
  assert.equal(netCalls, 0);
});

console.log(`\nSUMMARY a882-grant-predeploy-hardening: ${passed} checks passed · network 0`);
