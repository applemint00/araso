// [valuation boundary] 평가(valuation) 경계.
//
// 결정: **Aave v3 on Monad 의 온체인 오라클**을 유일한 평가 원천으로 둔다.
//   이유 — 키가 필요 없고, 유료 API 가 아니고, 지갑 연결이 필요 없고, 같은 블록에서 같은 값이 나온다.
//   우리는 이미 Aave 를 쓰고 있어 새 의존을 만들지 않는다.
//
// 이 파일은 **숫자를 만들어내지 않는다.** 원천이 준 값만 옮기고, 없으면 UNKNOWN 으로 둔다.
//
// 지켜야 할 세 줄:
//  1. **스테이블이라고 $1 로 치지 않는다.** (실측: USDC = $0.99988155)
//  2. **프로토콜 APR 을 가격으로 쓰지 않는다.**
//  3. **값을 매길 수 없는 자산은 UNKNOWN 으로 남긴다.** 빼고 합치지 않는다.

export const VALUATION_SOURCE = Object.freeze({
  AAVE_ORACLE: "aave-v3-monad-oracle",
});

// 오라클이 base currency USD 를 1e8 로 표현한다(BASE_CURRENCY_UNIT 실측).
export const BASE_CURRENCY_UNIT = 100000000n;

export const FRESHNESS = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  UNKNOWN: "unknown",
});

// 기본 신선도 한계. 금융 표시값이 조용히 늙지 않게 한다.
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function isPositiveIntString(value) {
  return typeof value === "string" && /^\d+$/.test(value) && value !== "0";
}

/**
 * 오라클이 돌려준 원시값 → 하나의 quote.
 * 값이 0 이거나 형식이 아니면 **quote 를 만들지 않는다**(0 을 가격으로 쓰지 않는다).
 */
export function makeQuote({ assetId, symbol, rawPrice, observedAt, source = VALUATION_SOURCE.AAVE_ORACLE, blockNumber = null } = {}) {
  if (typeof assetId !== "string" || assetId.trim() === "") return null;
  if (!isPositiveIntString(rawPrice)) return null;
  if (typeof observedAt !== "string" || observedAt.trim() === "") return null;
  const units = BigInt(rawPrice);
  // 문자열로 유지한다 — 부동소수로 가격을 뭉개지 않는다.
  const whole = units / BASE_CURRENCY_UNIT;
  const frac = (units % BASE_CURRENCY_UNIT).toString().padStart(8, "0");
  return {
    assetId: assetId.trim(),
    symbol: typeof symbol === "string" && symbol.trim() !== "" ? symbol.trim() : null,
    quoteCurrency: "USD",
    value: `${whole}.${frac}`,
    rawPrice,
    source,
    observedAt: observedAt.trim(),
    blockNumber,
  };
}

/** 이 quote 를 지금 써도 되나. 시각이 없거나 너무 오래됐으면 쓰지 않는다. */
export function quoteFreshness(quote, nowMs, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!quote || typeof quote.observedAt !== "string") return FRESHNESS.UNKNOWN;
  const observed = Date.parse(quote.observedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(nowMs)) return FRESHNESS.UNKNOWN;
  if (observed > nowMs) return FRESHNESS.UNKNOWN;       // 미래 시각은 믿지 않는다
  return nowMs - observed <= maxAgeMs ? FRESHNESS.FRESH : FRESHNESS.STALE;
}

/**
 * 자산 수량 × quote → USD. **수량이 진실이고 USD 는 투영이다.**
 * quote 가 없거나 신선하지 않으면 `{ usd: null, reason }` 을 돌려준다.
 */
export function valueAsset({ quantity, decimals, quote, nowMs, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (typeof quantity !== "string" || !/^\d+(\.\d+)?$/.test(quantity)) return { usd: null, reason: "invalid_quantity" };
  if (!Number.isInteger(decimals) || decimals < 0) return { usd: null, reason: "invalid_decimals" };
  if (!quote) return { usd: null, reason: "no_quote" };
  const freshness = quoteFreshness(quote, nowMs, maxAgeMs);
  if (freshness !== FRESHNESS.FRESH) return { usd: null, reason: freshness === FRESHNESS.STALE ? "stale_quote" : "unknown_freshness" };
  const qty = Number(quantity);
  const price = Number(quote.value);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return { usd: null, reason: "invalid_number" };
  return { usd: (qty * price).toFixed(2), reason: null, source: quote.source, observedAt: quote.observedAt };
}

/**
 * 여러 자산의 합계. **하나라도 값을 모르면 합계를 만들지 않는다.**
 * 조용히 빼고 더하지 않는다 — 무엇을 모르는지 목록으로 돌려준다.
 */
export function aggregateUsd(entries = [], { nowMs, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) return { totalUsd: null, reason: "no_assets", unpriced: [] };
  const unpriced = [];
  let sum = 0;
  const sources = new Set();
  let oldest = null;
  for (const entry of rows) {
    const valued = valueAsset({ ...entry, nowMs, maxAgeMs });
    if (valued.usd === null) {
      unpriced.push({ assetId: entry?.quote?.assetId ?? entry?.assetId ?? null, symbol: entry?.symbol ?? null, reason: valued.reason });
      continue;
    }
    sum += Number(valued.usd);
    sources.add(valued.source);
    if (!oldest || valued.observedAt < oldest) oldest = valued.observedAt;
  }
  if (unpriced.length > 0) {
    // 정책: **가려서 더하지 않는다.** 모르는 게 있으면 총액이 없다.
    return { totalUsd: null, reason: "unpriced_assets_present", unpriced };
  }
  return { totalUsd: sum.toFixed(2), reason: null, unpriced: [], sources: [...sources], observedOldestAt: oldest };
}

/** 값을 못 매긴 이유를 사람 말로. 숫자를 지어내는 대신 이걸 보여준다. */
export function explainMissingTotal(result) {
  if (!result || result.totalUsd) return "";
  if (result.reason === "no_assets") return "";
  if (result.reason === "unpriced_assets_present") {
    const names = result.unpriced.map((u) => u.symbol || u.assetId || "?").join(", ");
    return `값을 아직 못 읽은 게 있어: ${names}`;
  }
  return "";
}
