// [A-485 Lane C] 평가 경계 계약 — 네트워크 0 · 브라우저 0 · 키 0.
//   node app/test/valuation-source.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BASE_CURRENCY_UNIT,
  DEFAULT_MAX_AGE_MS,
  FRESHNESS,
  VALUATION_SOURCE,
  aggregateUsd,
  explainMissingTotal,
  makeQuote,
  quoteFreshness,
  valueAsset,
} from "../src/valuation-source.js";

const SRC = readFileSync(new URL("../src/valuation-source.js", import.meta.url), "utf8");
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const ABIL = "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f";
const NOW = Date.parse("2026-09-21T04:00:00Z");
const FRESH_AT = "2026-09-21T03:59:00Z";
const OLD_AT = "2026-09-21T03:00:00Z";
// 실측값: Aave 오라클이 돌려준 USDC 가격(1e8 기준). **$1 이 아니다.**
const USDC_RAW = "99988155";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 스테이블을 $1 로 치는 지름길이 없다 ──────────────────────────────────────
check("the measured USDC quote is not 1.00", () => {
  const q = makeQuote({ assetId: USDC, symbol: "USDC", rawPrice: USDC_RAW, observedAt: FRESH_AT });
  assert.equal(q.value, "0.99988155");
  assert.notEqual(q.value, "1.00000000");
  assert.equal(q.quoteCurrency, "USD");
  assert.equal(q.source, VALUATION_SOURCE.AAVE_ORACLE);
});

check("no hardcoded stable=1 shortcut exists in the source", () => {
  // 심볼로 가격을 단정하는 코드가 없어야 한다
  assert.equal(/USDC.*=.*1(\.0+)?\b/.test(SRC), false);
  assert.equal(/stable.*\?\s*1/i.test(SRC), false);
  assert.equal(/isStable/i.test(SRC), false);
});

check("a $5 USDC position is not valued at exactly $5", () => {
  const q = makeQuote({ assetId: USDC, symbol: "USDC", rawPrice: USDC_RAW, observedAt: FRESH_AT });
  const v = valueAsset({ quantity: "5", decimals: 6, quote: q, nowMs: NOW });
  assert.equal(v.usd, "5.00"); // 반올림 뒤에는 같아 보일 수 있으나…
  // …원가격은 1 이 아니며, 더 큰 수량에서는 차이가 드러난다
  const big = valueAsset({ quantity: "100000", decimals: 6, quote: q, nowMs: NOW });
  assert.equal(big.usd, "99988.15");
  assert.notEqual(big.usd, "100000.00");
});

// ── 2. 원천/시각이 없으면 값이 없다 ─────────────────────────────────────────────
check("a quote without a price, asset or timestamp is refused", () => {
  assert.equal(makeQuote({ assetId: USDC, rawPrice: "0", observedAt: FRESH_AT }), null);      // 0 은 가격이 아니다
  assert.equal(makeQuote({ assetId: USDC, rawPrice: "abc", observedAt: FRESH_AT }), null);
  assert.equal(makeQuote({ assetId: USDC, rawPrice: USDC_RAW }), null);                        // 시각 없음
  assert.equal(makeQuote({ rawPrice: USDC_RAW, observedAt: FRESH_AT }), null);                 // 자산 없음
});

check("a missing quote gives no USD and says why", () => {
  const v = valueAsset({ quantity: "5", decimals: 6, quote: null, nowMs: NOW });
  assert.equal(v.usd, null);
  assert.equal(v.reason, "no_quote");
});

// ── 3. 신선도 정책 ──────────────────────────────────────────────────────────────
check("a stale quote does not produce a value", () => {
  const stale = makeQuote({ assetId: USDC, rawPrice: USDC_RAW, observedAt: OLD_AT });
  assert.equal(quoteFreshness(stale, NOW), FRESHNESS.STALE);
  const v = valueAsset({ quantity: "5", decimals: 6, quote: stale, nowMs: NOW });
  assert.equal(v.usd, null);
  assert.equal(v.reason, "stale_quote");
});

check("a fresh quote inside the window is usable", () => {
  const fresh = makeQuote({ assetId: USDC, rawPrice: USDC_RAW, observedAt: FRESH_AT });
  assert.equal(quoteFreshness(fresh, NOW), FRESHNESS.FRESH);
  assert.ok(Number(valueAsset({ quantity: "1", decimals: 6, quote: fresh, nowMs: NOW }).usd) > 0);
});

check("a future timestamp is not trusted", () => {
  const future = makeQuote({ assetId: USDC, rawPrice: USDC_RAW, observedAt: "2026-09-21T05:00:00Z" });
  assert.equal(quoteFreshness(future, NOW), FRESHNESS.UNKNOWN);
  assert.equal(valueAsset({ quantity: "1", decimals: 6, quote: future, nowMs: NOW }).usd, null);
});

check("the freshness window is explicit, not hidden", () => {
  assert.equal(DEFAULT_MAX_AGE_MS, 5 * 60 * 1000);
  const q = makeQuote({ assetId: USDC, rawPrice: USDC_RAW, observedAt: OLD_AT });
  assert.equal(quoteFreshness(q, NOW, 2 * 60 * 60 * 1000), FRESHNESS.FRESH); // 창을 넓히면 통과
});

// ── 4. 모르는 자산이 하나라도 있으면 총액이 없다 ────────────────────────────────
check("a portfolio with one unpriceable asset yields no total, and names it", () => {
  const usdcQuote = makeQuote({ assetId: USDC, symbol: "USDC", rawPrice: USDC_RAW, observedAt: FRESH_AT });
  const result = aggregateUsd([
    { quantity: "200", decimals: 6, symbol: "USDC", quote: usdcQuote },
    // aBIL 은 오라클이 revert 한다 — quote 가 아예 없다
    { quantity: "0.0544", decimals: 18, symbol: "aBIL", quote: null, assetId: ABIL },
  ], { nowMs: NOW });
  assert.equal(result.totalUsd, null);
  assert.equal(result.reason, "unpriced_assets_present");
  assert.deepEqual(result.unpriced.map((u) => u.symbol), ["aBIL"]);
  assert.match(explainMissingTotal(result), /aBIL/);
});

check("unpriced assets are never silently dropped from the sum", () => {
  const usdcQuote = makeQuote({ assetId: USDC, symbol: "USDC", rawPrice: USDC_RAW, observedAt: FRESH_AT });
  const withUnknown = aggregateUsd([
    { quantity: "200", decimals: 6, symbol: "USDC", quote: usdcQuote },
    { quantity: "1", decimals: 18, symbol: "???", quote: null },
  ], { nowMs: NOW });
  // 200 짜리만 더해서 총액을 내놓으면 안 된다
  assert.equal(withUnknown.totalUsd, null);
});

check("a fully priced portfolio produces a total with its sources and oldest read", () => {
  const q1 = makeQuote({ assetId: USDC, symbol: "USDC", rawPrice: USDC_RAW, observedAt: FRESH_AT });
  const q2 = makeQuote({ assetId: USDC, symbol: "USDC", rawPrice: USDC_RAW, observedAt: "2026-09-21T03:58:00Z" });
  const result = aggregateUsd([
    { quantity: "100", decimals: 6, quote: q1 },
    { quantity: "50", decimals: 6, quote: q2 },
  ], { nowMs: NOW });
  assert.equal(result.totalUsd, "149.98");
  assert.deepEqual(result.sources, [VALUATION_SOURCE.AAVE_ORACLE]);
  assert.equal(result.observedOldestAt, "2026-09-21T03:58:00Z");
});

check("an empty portfolio has no total and no fake zero", () => {
  const result = aggregateUsd([], { nowMs: NOW });
  assert.equal(result.totalUsd, null);
  assert.equal(result.reason, "no_assets");
  assert.equal(explainMissingTotal(result), "");
});

// ── 5. 수량이 진실이고 USD 는 투영이다 ──────────────────────────────────────────
check("exact quantity survives regardless of whether USD could be computed", () => {
  const entry = { quantity: "0.054395975433531538", decimals: 18, symbol: "aBIL", quote: null };
  const v = valueAsset({ ...entry, nowMs: NOW });
  assert.equal(v.usd, null);
  // 원본 수량은 이 함수가 손대지 않는다
  assert.equal(entry.quantity, "0.054395975433531538");
});

check("an invalid quantity or decimals is refused rather than coerced", () => {
  const q = makeQuote({ assetId: USDC, rawPrice: USDC_RAW, observedAt: FRESH_AT });
  assert.equal(valueAsset({ quantity: "abc", decimals: 6, quote: q, nowMs: NOW }).reason, "invalid_quantity");
  assert.equal(valueAsset({ quantity: "5", decimals: -1, quote: q, nowMs: NOW }).reason, "invalid_decimals");
});

// ── 6. APR 을 가격으로 쓰지 않는다 · 키가 없다 ──────────────────────────────────
check("the source needs no api key, no wallet, and never uses APR as a price", () => {
  for (const banned of ["apiKey", "api_key", "Authorization", "apr", "APY", "connectWallet"]) {
    assert.equal(SRC.includes(banned), false, `valuation source must not reference ${banned}`);
  }
  assert.equal(BASE_CURRENCY_UNIT, 100000000n);
});

console.log(`\n${pass}/${pass} PASS`);
