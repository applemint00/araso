// [A-785] /api/grant min-cost hardening — offline. Network 0, real key 0, tx 0.
// globalThis.fetch is replaced by an in-memory JSON-RPC stub BEFORE api/grant.js is imported, so viem's http
// transport can only ever reach the stub. Any non-stub URL throws. The relayer key is a fresh random key.
//
// Proves:
//   R1 wrong / missing Content-Type → 415, zero RPC
//   R2 mismatched Origin / Sec-Fetch-Site cross-site|same-site|none → 403, zero RPC
//   R3 invalid / bad-checksum / zero / relayer-self address → 400, zero RPC (validation before funding)
//   P  valid Araso JSON request (same as main.js requestGrant) → 200 + txHash, exactly one broadcast
//   N  Cache-Control: no-store on every response observed in this file
//   D  disabled default → 503, zero RPC
//   I  GRANT_WEI ≥ GRANT_SKIP_BALANCE_WEI and an immediate sequential regrant → 403 already funded, no 2nd broadcast
// Does NOT prove (and must not be read as): exact-once, concurrency safety, a global cap. See WRITER_NOTES.

import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";

// ---- RPC stub (installed before the handler module loads) --------------------------------------------
const STUB_RPC = "http://a785-stub-rpc.invalid";
process.env.MONAD_RPC_URL = STUB_RPC;
const KEY = generatePrivateKey();
const RELAYER = privateKeyToAccount(KEY).address;

const rpcLog = []; // every JSON-RPC method the handler triggered, in order
const balances = new Map(); // lowercase address → bigint
balances.set(RELAYER.toLowerCase(), 10n ** 21n); // stub relayer holds 1000 MON (in-memory only)
const receipts = new Map();
let nonce = 0;
const hex = (n) => `0x${BigInt(n).toString(16)}`;

globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(STUB_RPC)) throw new Error(`a785: unexpected network call to ${url}`);
  const payload = JSON.parse(init.body);
  const one = (req) => ({ jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? []) });
  const out = Array.isArray(payload) ? payload.map(one) : one(payload);
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};

let failBalance = false;
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
      const hash = keccak256(params[0]);
      nonce += 1;
      // Chain effect of the grant: the recipient now holds GRANT_WEI more (recorded by the test via lastTo).
      if (lastTo) balances.set(lastTo, (balances.get(lastTo) ?? 0n) + grantWei);
      receipts.set(hash, true);
      return hash;
    }
    case "eth_getTransactionReceipt": {
      const hash = params[0];
      if (!receipts.has(hash)) return null;
      return {
        transactionHash: hash, status: "0x1", blockNumber: hex(100), blockHash: `0x${"ab".repeat(32)}`, transactionIndex: "0x0",
        from: RELAYER, to: lastTo, cumulativeGasUsed: hex(21000), gasUsed: hex(21000), effectiveGasPrice: hex(1), logs: [],
        logsBloom: `0x${"00".repeat(256)}`, type: "0x2", contractAddress: null,
      };
    }
    case "eth_getTransactionByHash":
      return null;
    default:
      throw new Error(`a785 stub: unhandled ${method}`);
  }
}

// ---- load the handler ------------------------------------------------------------------------------
const mod = await import("../../api/grant.js");
// [A-792] The production default export now refuses (503) while no durable grant store is configured, so the A-785
// gate/happy-path checks run against createGrantHandler() with the TEST-ONLY local store injected (large cap, no
// allowlist). Every A-785 gate (405/503/415/403/400) sits before the store step, so they are exercised unchanged.
// The default export's fail-closed behaviour is asserted at the end of this file and in a792-grant-durable-boundary.
const { createLocalTestGrantStore } = await import("./helpers/grant-local-test-store.mjs");
const handler = mod.createGrantHandler({
  store: createLocalTestGrantStore({ contract: mod.GRANT_STORE_CONTRACT }),
  policy: { globalCap: 1_000_000 },
});
const { GRANT_ENABLE_ENV, GRANT_SKIP_BALANCE_WEI, GRANT_ALLOWED_ORIGINS } = mod;
const { GRANT_WEI } = await import("../../relayer/src/policy.mjs");
const grantWei = GRANT_WEI;
let lastTo = null;

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
  // exactly what app/src/main.js requestGrant sends, plus what a modern browser adds on a same-origin fetch
  "content-type": "application/json",
  origin: "https://arasoo.vercel.app",
  "sec-fetch-site": "same-origin",
  host: "arasoo.vercel.app",
});

async function call({ method = "POST", headers = ARASO_HEADERS, body }) {
  const res = makeRes();
  const req = { method, headers, body, async *[Symbol.asyncIterator]() {} };
  await handler(req, res);
  allResponses.push(res);
  return res;
}

let addrSeq = 0x1000;
const freshAddr = () => `0x${(addrSeq++).toString(16).padStart(40, "0")}`;

function rpcSince(mark) {
  return rpcLog.slice(mark);
}

// ---- D: disabled default ---------------------------------------------------------------------------
delete process.env[GRANT_ENABLE_ENV];
process.env.RELAYER_PRIVATE_KEY = KEY;

await check("D disabled default: valid Araso request → 503 grant disabled, zero RPC", async () => {
  const m = rpcLog.length;
  const res = await call({ body: { address: freshAddr() } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "grant disabled");
  assert.deepEqual(rpcSince(m), []);
});
for (const raw of ["0", "false", "", "yes"]) {
  process.env[GRANT_ENABLE_ENV] = raw;
  const res = await call({ body: { address: freshAddr() } });
  assert.equal(res.statusCode, 503, `env=${JSON.stringify(raw)}`);
}
await check("D near-miss enable values stay 503", async () => {});
delete process.env[GRANT_ENABLE_ENV];

await check("D disabled: hostile content-type/origin still just 503 (gate is first), zero RPC", async () => {
  const m = rpcLog.length;
  const res = await call({ headers: { "content-type": "text/plain", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: '{"address":"0x0000000000000000000000000000000000000001"}' });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(rpcSince(m), []);
});

// ---- enable for the rest ---------------------------------------------------------------------------
process.env[GRANT_ENABLE_ENV] = "1";

await check("405 non-POST (no-store checked globally below)", async () => {
  const res = await call({ method: "GET" });
  assert.equal(res.statusCode, 405);
});

// ---- R1: Content-Type ------------------------------------------------------------------------------
const BAD_CT = [undefined, "", "text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonx", "text/json", "application/json-patch+json", ["application/json"]];
await check("R1 wrong/missing Content-Type → 415, zero RPC, zero broadcast (valid JSON body as string AND pre-parsed)", async () => {
  for (const ct of BAD_CT) {
    for (const body of [{ address: freshAddr() }, JSON.stringify({ address: freshAddr() })]) {
      const headers = { ...ARASO_HEADERS };
      if (ct === undefined) delete headers["content-type"];
      else headers["content-type"] = ct;
      const m = rpcLog.length;
      const res = await call({ headers, body });
      assert.equal(res.statusCode, 415, `ct=${JSON.stringify(ct)}`);
      assert.equal(res.body.ok, false);
      assert.deepEqual(rpcSince(m), [], `ct=${JSON.stringify(ct)} must not reach RPC`);
    }
  }
});
await check("R1 accepted Content-Type spellings: application/json; charset=utf-8 and APPLICATION/JSON", async () => {
  assert.equal(mod.isJsonContentType("application/json; charset=utf-8"), true);
  assert.equal(mod.isJsonContentType("APPLICATION/JSON"), true);
  assert.equal(mod.isJsonContentType(" application/json "), true);
  assert.equal(mod.isJsonContentType("text/plain"), false);
});

// ---- R2: Origin / Sec-Fetch-Site -------------------------------------------------------------------
assert.deepEqual([...GRANT_ALLOWED_ORIGINS], ["https://arasoo.vercel.app"]);
const BAD_ORIGIN = [
  { origin: "https://evil.example" },
  { origin: "https://arasoo.vercel.app.evil.example" },
  { origin: "http://arasoo.vercel.app" },
  { origin: "https://arasoo.vercel.app:8443" },
  { origin: "https://arasoo-git-preview.vercel.app" },
  { origin: "https://ARASOO.vercel.app" },
  { origin: "" },
  { "sec-fetch-site": "cross-site" },
  { "sec-fetch-site": "same-site" },
  { "sec-fetch-site": "none" },
  { "sec-fetch-site": "cross-site", origin: "https://arasoo.vercel.app" }, // header pair disagrees → reject
  { "sec-fetch-site": "cross-site", origin: "null" },
  { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
];
await check("R2 mismatched Origin / cross-site|same-site|none Sec-Fetch-Site → 403, zero RPC", async () => {
  for (const over of BAD_ORIGIN) {
    const headers = { "content-type": "application/json", ...over };
    const m = rpcLog.length;
    const res = await call({ headers, body: { address: freshAddr() } });
    assert.equal(res.statusCode, 403, JSON.stringify(over));
    assert.notEqual(res.body.error, "already funded", "must not look like the client's benign 403");
    assert.deepEqual(rpcSince(m), [], `${JSON.stringify(over)} must not reach RPC`);
  }
});

// ---- R3: address -----------------------------------------------------------------------------------
const checksummed = privateKeyToAccount(generatePrivateKey()).address;
const badChecksum = checksummed.slice(0, 2) + [...checksummed.slice(2)].map((c) => (/[a-f]/.test(c) ? c.toUpperCase() : /[A-F]/.test(c) ? c.toLowerCase() : c)).join("");
assert.notEqual(badChecksum, checksummed);
const BAD_ADDR = [
  "0x0000000000000000000000000000000000000000",
  RELAYER,
  RELAYER.toLowerCase(),
  badChecksum,
  "0xdeadbeef",
  "0xZZ00000000000000000000000000000000000000",
  "not-an-address",
];
await check("R3 zero / relayer-self / bad-checksum / malformed address → 400, zero RPC, zero broadcast", async () => {
  for (const address of BAD_ADDR) {
    const m = rpcLog.length;
    const res = await call({ body: { address } });
    assert.equal(res.statusCode, 400, address);
    assert.equal(res.body.error, "invalid address");
    assert.deepEqual(rpcSince(m), [], `${address} must not reach RPC`);
  }
});

// ---- P: preserved happy path -----------------------------------------------------------------------
async function happy(headers, body, to) {
  lastTo = to.toLowerCase();
  const m = rpcLog.length;
  const res = await call({ headers, body });
  const log = rpcSince(m);
  return { res, log };
}

await check("P valid Araso JSON request (checksummed address, pre-parsed body) → 200 txHash, exactly one broadcast after balance reads", async () => {
  const { res, log } = await happy(ARASO_HEADERS, { address: checksummed }, checksummed);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.match(res.body.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(log.filter((x) => x === "eth_sendRawTransaction").length, 1);
  const firstSend = log.indexOf("eth_sendRawTransaction");
  assert.ok(log.indexOf("eth_getBalance") >= 0 && log.indexOf("eth_getBalance") < firstSend, "balance gate precedes broadcast");
});

const variants = [
  ["string body + charset param", { ...ARASO_HEADERS, "content-type": "application/json; charset=utf-8" }, (a) => JSON.stringify({ address: a })],
  ["Origin: null + same-origin (no-referrer serialization)", { ...ARASO_HEADERS, origin: "null" }, (a) => ({ address: a })],
  ["no Origin, same-origin fetch metadata", { "content-type": "application/json", "sec-fetch-site": "same-origin" }, (a) => ({ address: a })],
  ["allowed Origin, no Sec-Fetch-Site (older browser)", { "content-type": "application/json", origin: "https://arasoo.vercel.app" }, (a) => ({ address: a })],
  ["non-browser caller: no Origin, no Sec-Fetch-Site (documented ALLOW)", { "content-type": "application/json" }, (a) => ({ address: a })],
  ["lowercase address", ARASO_HEADERS, (a) => ({ address: a.toLowerCase() })],
];
for (const [label, headers, mk] of variants) {
  await check(`P ${label} → 200, one broadcast`, async () => {
    const a = privateKeyToAccount(generatePrivateKey()).address;
    const { res, log } = await happy(headers, mk(a), a);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(log.filter((x) => x === "eth_sendRawTransaction").length, 1);
  });
}

// ---- I: grant / skip-threshold invariant (amount unchanged) ------------------------------------------
await check("I GRANT_WEI ≥ GRANT_SKIP_BALANCE_WEI (amount unchanged: 0.1 MON / 0.05 MON)", async () => {
  assert.equal(GRANT_WEI, 100_000_000_000_000_000n);
  assert.equal(GRANT_SKIP_BALANCE_WEI, 50_000_000_000_000_000n);
  assert.ok(GRANT_WEI >= GRANT_SKIP_BALANCE_WEI);
});
await check("I immediate sequential regrant to a freshly granted address → 403 already funded, no 2nd broadcast", async () => {
  const a = privateKeyToAccount(generatePrivateKey()).address;
  const first = await happy(ARASO_HEADERS, { address: a }, a);
  assert.equal(first.res.statusCode, 200);
  const second = await happy(ARASO_HEADERS, { address: a }, a);
  assert.equal(second.res.statusCode, 403);
  assert.equal(second.res.body.error, "already funded");
  assert.equal(second.log.includes("eth_sendRawTransaction"), false);
});

await check("502 balance-read failure → 502, no broadcast (exercises a 5xx path for no-store)", async () => {
  failBalance = true;
  try {
    const a = privateKeyToAccount(generatePrivateKey()).address;
    const { res, log } = await happy(ARASO_HEADERS, { address: a }, a);
    assert.equal(res.statusCode, 502);
    assert.equal(log.includes("eth_sendRawTransaction"), false);
  } finally {
    failBalance = false;
  }
});

await check("N structural: api/grant.js writes responses only through respond() (single res.end, single statusCode write)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../api/grant.js", import.meta.url), "utf8");
  assert.equal(src.match(/res\.end\(/g)?.length, 1);
  assert.equal(src.match(/res\.statusCode\s*=/g)?.length, 1);
  assert.equal(src.match(/res\.setHeader\(\s*"cache-control",\s*"no-store"\s*\)/g)?.length, 1);
});

// ---- N: no-store everywhere ------------------------------------------------------------------------
await check(`N Cache-Control: no-store on all ${allResponses.length} responses (statuses: ${[...new Set(allResponses.map((r) => r.statusCode))].sort().join(",")})`, async () => {
  const statuses = new Set(allResponses.map((r) => r.statusCode));
  for (const s of [200, 400, 403, 405, 415, 502, 503]) assert.ok(statuses.has(s), `status ${s} exercised`);
  for (const r of allResponses) {
    assert.equal(r.headers["cache-control"], "no-store", `status ${r.statusCode}`);
    assert.equal(r.headers["content-type"], "application/json");
  }
});

await check("[A-792] production default export, enabled + valid Araso request, no durable store → 503 grant store unavailable, zero RPC", async () => {
  const m = rpcLog.length;
  const res = makeRes();
  await mod.default({ method: "POST", headers: ARASO_HEADERS, body: { address: freshAddr() }, async *[Symbol.asyncIterator]() {} }, res);
  allResponses.push(res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "grant store unavailable");
  assert.deepEqual(rpcSince(m), []);
});

await check("no response body ever carries the relayer key", async () => {
  for (const r of allResponses) assert.equal(JSON.stringify(r.body).includes(KEY.slice(2)), false);
});

console.log(`\nSUMMARY a785-grant-hardening: ${passed} checks passed · broadcasts=${rpcLog.filter((x) => x === "eth_sendRawTransaction").length} (stub only, network 0)`);
