// [A-486 Lane A] 시세를 **읽기만** 하는 얇은 층.
//
// 원천은 A-485 에서 고른 Aave v3 Monad 온체인 오라클이다. 키도 지갑도 필요 없다.
// 여기서 하는 일은 딱 하나: `getAssetPrice(asset)` 를 **eth_call 로 읽어** quote 로 바꾼다.
//
// 절대 하지 않는 것: 서명 · 컨트랙트 쓰기 · 트랜잭션 전송 · 상태를 바꾸는 어떤 RPC 도.
// 실패하면 **값을 지어내지 않고 UNKNOWN 으로 닫는다.**

import { FRESHNESS, VALUATION_SOURCE, makeQuote, quoteFreshness } from "./valuation-source.js";

// A-485 에서 PoolAddressesProvider 로부터 읽어 확인한 주소.
export const AAVE_ORACLE_ADDRESS = "0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf";

// getAssetPrice(address) 셀렉터. 추측이 아니라 고정된 4바이트다.
const GET_ASSET_PRICE_SELECTOR = "0xb3596f07";

function encodeAddressArg(address) {
  const clean = String(address || "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) return null;
  return clean.padStart(64, "0");
}

/** eth_call 한 번. **읽기 전용이다.** 실패는 예외가 아니라 값으로 돌아온다. */
export async function readAssetPrice({ rpcUrl, assetAddress, oracle = AAVE_ORACLE_ADDRESS, fetchImpl = globalThis.fetch } = {}) {
  const arg = encodeAddressArg(assetAddress);
  if (!arg) return { rawPrice: null, error: "invalid_asset_address" };
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") return { rawPrice: null, error: "no_rpc" };
  if (typeof fetchImpl !== "function") return { rawPrice: null, error: "no_fetch" };

  let payload;
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        // eth_call 은 상태를 바꾸지 않는다. 이 파일에 다른 method 는 없다.
        method: "eth_call",
        params: [{ to: oracle, data: `${GET_ASSET_PRICE_SELECTOR}${arg}` }, "latest"],
      }),
    });
    payload = await res.json();
  } catch {
    return { rawPrice: null, error: "rpc_unreachable" };
  }
  // 오라클이 revert 하면(값을 매길 수 없는 자산) 여기로 온다 — **0 으로 바꾸지 않는다.**
  if (!payload || payload.error) return { rawPrice: null, error: "asset_not_supported" };
  const hex = typeof payload.result === "string" ? payload.result : "";
  if (!/^0x[0-9a-fA-F]+$/.test(hex) || hex === "0x") return { rawPrice: null, error: "empty_result" };
  let value;
  try {
    value = BigInt(hex);
  } catch {
    return { rawPrice: null, error: "unreadable_result" };
  }
  if (value <= 0n) return { rawPrice: null, error: "non_positive_price" }; // 0 은 가격이 아니다
  return { rawPrice: value.toString(), error: null };
}

/**
 * 자산 하나의 현재 quote. 못 읽으면 **quote 없이 이유만** 돌려준다.
 */
export async function fetchQuote({ rpcUrl, assetAddress, symbol, oracle, fetchImpl, now = () => new Date().toISOString() } = {}) {
  const { rawPrice, error } = await readAssetPrice({ rpcUrl, assetAddress, oracle, fetchImpl });
  if (error) return { quote: null, error };
  const quote = makeQuote({
    assetId: assetAddress,
    symbol,
    rawPrice,
    observedAt: now(),
    source: VALUATION_SOURCE.AAVE_ORACLE,
  });
  return quote ? { quote, error: null } : { quote: null, error: "quote_rejected" };
}

/**
 * 아주 작은 캐시. **오래된 값이 현재인 척하지 못하게** 신선도를 늘 함께 돌려준다.
 * 만료된 값은 `quote` 로 주지 않고 `staleQuote` 로만 준다 — 화면이 실수로 쓰지 못한다.
 */
export function createQuoteCache({ maxAgeMs } = {}) {
  const store = new Map();
  return {
    put(assetId, quote) {
      if (quote) store.set(assetId, quote);
    },
    get(assetId, nowMs) {
      const cached = store.get(assetId);
      if (!cached) return { quote: null, staleQuote: null, freshness: FRESHNESS.UNKNOWN };
      const freshness = quoteFreshness(cached, nowMs, maxAgeMs);
      if (freshness === FRESHNESS.FRESH) return { quote: cached, staleQuote: null, freshness };
      // 늙은 값은 **현재 값으로 내보내지 않는다.**
      return { quote: null, staleQuote: cached, freshness };
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}
