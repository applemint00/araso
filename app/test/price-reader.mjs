// [A-486 Lane A] 시세 읽기 계약 — 실제 네트워크 0(가짜 fetch), 키 0, 상태변경 RPC 0.
//   node app/test/price-reader.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AAVE_ORACLE_ADDRESS, createQuoteCache, fetchQuote, readAssetPrice } from "../src/price-reader.js";
import { FRESHNESS, aggregateUsd, explainMissingTotal } from "../src/valuation-source.js";

const SRC = readFileSync(new URL("../src/price-reader.js", import.meta.url), "utf8");
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const ABIL = "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f";
const RPC = "http://127.0.0.1:8545";
// 실측값(A-485): USDC = 99988155 (1e8 기준) → $0.99988155
const USDC_HEX = "0x0000000000000000000000000000000000000000000000000000000005f5b2bb";

let pass = 0;
function check(label, fn) { return fn().then(() => { console.log(`PASS  ${label}`); pass += 1; }); }
const checks = [];
const at = (iso) => () => iso;

// 호출을 기록하는 가짜 RPC
function fakeRpc(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const res = handler(body);
    if (res instanceof Error) throw res;
    return { json: async () => res };
  };
  fn.calls = calls;
  return fn;
}

// ── 1. 정상 경로 ────────────────────────────────────────────────────────────────
checks.push(check("a live read produces a quote with source, asset and timestamp", async () => {
  const fetchImpl = fakeRpc(() => ({ jsonrpc: "2.0", id: 1, result: USDC_HEX }));
  const { quote, error } = await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl, now: at("2026-09-21T04:00:00Z") });
  assert.equal(error, null);
  assert.equal(quote.value, "0.99988155");          // 오라클 값 그대로 — 1 이 아니다
  assert.equal(quote.assetId, USDC);
  assert.equal(quote.quoteCurrency, "USD");
  assert.equal(quote.observedAt, "2026-09-21T04:00:00Z");
  assert.ok(quote.source);
}));

checks.push(check("only eth_call is ever sent, to the chosen oracle", async () => {
  const fetchImpl = fakeRpc(() => ({ result: USDC_HEX }));
  await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl, now: at("2026-09-21T04:00:00Z") });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].method, "eth_call");
  assert.equal(fetchImpl.calls[0].params[0].to, AAVE_ORACLE_ADDRESS);
  assert.match(fetchImpl.calls[0].params[0].data, /^0xb3596f07/);
}));

// ── 2. 실패는 값을 지어내지 않고 닫힌다 ─────────────────────────────────────────
checks.push(check("a reverting (unsupported) asset yields UNKNOWN, never zero", async () => {
  const fetchImpl = fakeRpc(() => ({ error: { code: 3, message: "execution reverted" } }));
  const { quote, error } = await fetchQuote({ rpcUrl: RPC, assetAddress: ABIL, symbol: "aBIL", fetchImpl });
  assert.equal(quote, null);
  assert.equal(error, "asset_not_supported");
}));

checks.push(check("a zero price is refused rather than used", async () => {
  const fetchImpl = fakeRpc(() => ({ result: "0x0000000000000000000000000000000000000000000000000000000000000000" }));
  assert.equal((await readAssetPrice({ rpcUrl: RPC, assetAddress: USDC, fetchImpl })).error, "non_positive_price");
}));

checks.push(check("an unreachable RPC fails closed", async () => {
  const boom = fakeRpc(() => new Error("network down"));
  const { quote, error } = await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, fetchImpl: boom });
  assert.equal(quote, null);
  assert.equal(error, "rpc_unreachable");
}));

checks.push(check("a malformed result fails closed", async () => {
  for (const [result, expected] of [["0x", "empty_result"], ["not-hex", "empty_result"], [undefined, "empty_result"]]) {
    const fetchImpl = fakeRpc(() => ({ result }));
    assert.equal((await readAssetPrice({ rpcUrl: RPC, assetAddress: USDC, fetchImpl })).error, expected);
  }
}));

checks.push(check("missing rpc, fetch or a bad address is refused before any call", async () => {
  assert.equal((await readAssetPrice({ assetAddress: USDC, fetchImpl: fakeRpc(() => ({})) })).error, "no_rpc");
  assert.equal((await readAssetPrice({ rpcUrl: RPC, assetAddress: "0x123", fetchImpl: fakeRpc(() => ({})) })).error, "invalid_asset_address");
  assert.equal((await readAssetPrice({ rpcUrl: RPC, assetAddress: USDC, fetchImpl: null })).error, "no_fetch");
}));

// ── 3. 늙은 값이 현재인 척하지 못한다 ───────────────────────────────────────────
checks.push(check("a stale cached quote is never handed out as current", async () => {
  const fetchImpl = fakeRpc(() => ({ result: USDC_HEX }));
  const { quote } = await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl, now: at("2026-09-21T03:00:00Z") });
  const cache = createQuoteCache();
  cache.put(USDC, quote);

  const fresh = cache.get(USDC, Date.parse("2026-09-21T03:01:00Z"));
  assert.equal(fresh.freshness, FRESHNESS.FRESH);
  assert.ok(fresh.quote);

  const later = cache.get(USDC, Date.parse("2026-09-21T04:00:00Z"));
  assert.equal(later.freshness, FRESHNESS.STALE);
  assert.equal(later.quote, null);        // 현재 값으로 내주지 않는다
  assert.ok(later.staleQuote);            // 있었다는 사실은 남는다
}));

checks.push(check("an empty cache is unknown, not zero", async () => {
  const cache = createQuoteCache();
  const got = cache.get(USDC, Date.now());
  assert.equal(got.quote, null);
  assert.equal(got.staleQuote, null);
  assert.equal(got.freshness, FRESHNESS.UNKNOWN);
}));

// ── 4. 화면까지: 하나라도 모르면 총액이 없다 ────────────────────────────────────
checks.push(check("a live USDC quote reaches the money projection", async () => {
  const fetchImpl = fakeRpc(() => ({ result: USDC_HEX }));
  const { quote } = await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl, now: at("2026-09-21T04:00:00Z") });
  const total = aggregateUsd([{ quantity: "10", decimals: 6, symbol: "USDC", quote }], { nowMs: Date.parse("2026-09-21T04:01:00Z") });
  assert.equal(total.totalUsd, "10.00");
}));

checks.push(check("one unsupported asset suppresses the total and names it", async () => {
  const ok = fakeRpc(() => ({ result: USDC_HEX }));
  const bad = fakeRpc(() => ({ error: { code: 3, message: "reverted" } }));
  const usdc = (await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl: ok, now: at("2026-09-21T04:00:00Z") })).quote;
  const abil = (await fetchQuote({ rpcUrl: RPC, assetAddress: ABIL, symbol: "aBIL", fetchImpl: bad })).quote;
  const total = aggregateUsd([
    { quantity: "10", decimals: 6, symbol: "USDC", quote: usdc },
    { quantity: "0.05", decimals: 18, symbol: "aBIL", quote: abil },
  ], { nowMs: Date.parse("2026-09-21T04:01:00Z") });
  assert.equal(total.totalUsd, null);
  assert.match(explainMissingTotal(total), /aBIL/);
}));

checks.push(check("a stale quote suppresses the total", async () => {
  const fetchImpl = fakeRpc(() => ({ result: USDC_HEX }));
  const { quote } = await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl, now: at("2026-09-21T03:00:00Z") });
  const total = aggregateUsd([{ quantity: "10", decimals: 6, symbol: "USDC", quote }], { nowMs: Date.parse("2026-09-21T04:00:00Z") });
  assert.equal(total.totalUsd, null);
}));

checks.push(check("an RPC failure suppresses the total instead of showing 0", async () => {
  const boom = fakeRpc(() => new Error("down"));
  const { quote } = await fetchQuote({ rpcUrl: RPC, assetAddress: USDC, symbol: "USDC", fetchImpl: boom });
  const total = aggregateUsd([{ quantity: "10", decimals: 6, symbol: "USDC", quote }], { nowMs: Date.now() });
  assert.equal(total.totalUsd, null);
  assert.notEqual(total.totalUsd, "0.00");
}));

// ── 5. 키도 지갑도 상태변경도 없다 ──────────────────────────────────────────────
checks.push(check("the reader needs no key or wallet and sends no state-changing RPC", async () => {
  for (const banned of ["apiKey", "Authorization", "writeContract", "sendTransaction", "eth_sendTransaction", "eth_sendRawTransaction", "personal_sign", "connectWallet", "privateKey"]) {
    assert.equal(SRC.includes(banned), false, `price reader must not reference ${banned}`);
  }
  // 이 파일이 보내는 method 는 eth_call 하나뿐이다
  const methods = [...SRC.matchAll(/method:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(methods)], ["eth_call"]);
}));

await Promise.all(checks);
console.log(`\n${pass}/${pass} PASS`);
