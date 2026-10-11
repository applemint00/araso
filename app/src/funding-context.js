// [funding context] FundingContext — 충전 한 건이 도착할 **정확한 체인·자산·목적지**를 하나로 묶는다.
//
// 문제: funding-entry.js 의 DEFAULT_ARRIVAL 과 funding-intent-bridge.js 의 열려-있는 리터럴이
// 둘 다 `monad-mainnet` 을 도착 체인으로 가정했다 — 그런데 지금 이 앱의 실행 체인은
// `secondJourneyScope().chainId` = `monad-testnet` 이다. 그 둘이 같지 않을 때 **말없이 섞이지
// 않는다**: 이 파일이 하는 일은 "지금 실행 중인 체인" 을 명시적으로 받아, 요청된 체인과
// 그 한 값이 같을 때만 컨텍스트를 만드는 것이다.
//
// 여기서 하지 않는 일: 제공자/레일 선택. 그건 이 파일의 범위가 아니다(별도 조사 대상).

// [Lane A §2] 이미 이 저장소에서 실측/확인된 체인별 USDC 신원만 허용한다. 다른 자산·체인을
// 조용히 만들어내지 않는다 — 여기 없으면 `asset_id_chain_mismatch`.
const TOKEN_ALLOWLIST = Object.freeze({
  "monad-testnet": Object.freeze({
    USDC: Object.freeze({ assetId: "0x534b2f3A21130d7a60830c2Df862319e593943A3", decimals: 6 }),
  }),
  "monad-mainnet": Object.freeze({
    USDC: Object.freeze({ assetId: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }),
  }),
  // [A-946] The shared mainnet fork (Journey 2). Same contract address as mainnet USDC (the fork copies mainnet state), but its own
  // scope: a fork record never matches a 143 record, because every lookup is keyed by scope first.
  "monad-fork": Object.freeze({
    USDC: Object.freeze({ assetId: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }),
  }),
});

// [A-946] The one place the fork chain identity is written. Numeric id = the value the A-945 fork run used (anvil --chain-id); never 143 or
// 10143, so nothing signed or recorded on the fork can be replayed on, or mistaken for, Monad mainnet or testnet.
export const FORK_CHAIN_ID = 31337143;
export const FORK_SCOPE = "monad-fork";

// 뷰어/client 의 숫자 체인 id(viem `chain.id`) → 이 앱이 쓰는 문자열 scope. 모르는 숫자는
// null 이다 — 추측한 이름을 붙이지 않는다.
export const CHAIN_SCOPE_BY_NUMERIC_ID = Object.freeze({
  10143: "monad-testnet",
  143: "monad-mainnet",
  [FORK_CHAIN_ID]: FORK_SCOPE, // [A-946]
});

export function scopeForChainId(numericId) {
  if (numericId === null || numericId === undefined) return null;
  return CHAIN_SCOPE_BY_NUMERIC_ID[numericId] ?? null;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fail(reason, extra = {}) {
  return { context: null, error: reason, ...extra };
}

/**
 * FundingContext 를 만든다. **chainId 는 반드시 지금 실행 중인 scope 와 같아야 한다** —
 * 그 값은 호출자가 `runtimeChainId` 로 명시해서 넘긴다(숨은 기본값 0).
 * 같지 않으면 `chain_scope_mismatch` — 이건 ack 로 넘어갈 수 있는 문이 아니다(자산 종류가
 * 아니라 "다른 네트워크" 이야기이기 때문).
 */
export function buildFundingContext({
  chainId, runtimeChainId, assetSymbol = "USDC", targetPiggyId, targetAddress,
} = {}) {
  const chain = cleanString(chainId);
  const runtime = cleanString(runtimeChainId);
  if (!chain) return fail("missing_chain_id");
  if (!runtime) return fail("missing_runtime_chain_id");
  if (chain !== runtime) return fail("chain_scope_mismatch", { requested: chain, runtime });

  const symbol = cleanString(assetSymbol);
  if (!symbol) return fail("missing_asset_symbol");
  const allowed = TOKEN_ALLOWLIST[chain]?.[symbol];
  if (!allowed) return fail("asset_id_chain_mismatch", { chainId: chain, assetSymbol: symbol });

  const piggyId = cleanString(targetPiggyId);
  if (!piggyId) return fail("missing_target_piggy");
  const address = cleanString(targetAddress);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return fail("missing_target_address");

  return {
    context: {
      chainId: chain,
      assetSymbol: symbol,
      assetId: allowed.assetId,
      decimals: allowed.decimals,
      targetPiggyId: piggyId,
      targetAddress: address,
    },
    error: null,
  };
}

/**
 * 이미 만들어진(혹은 어딘가 저장돼 있던) FundingContext 가 **지금** 실행 중인 scope/allowlist 와
 * 여전히 맞는지 다시 본다. 시간이 지나 런타임 체인이 바뀌었거나, 값이 손을 탔을 수 있어서다.
 */
export function validateFundingContext(context, { runtimeChainId } = {}) {
  if (!context || typeof context !== "object") return { ok: false, error: "missing_context" };
  const runtime = cleanString(runtimeChainId);
  if (!runtime) return { ok: false, error: "missing_runtime_chain_id" };
  if (context.chainId !== runtime) return { ok: false, error: "chain_scope_mismatch" };

  const allowed = TOKEN_ALLOWLIST[context.chainId]?.[context.assetSymbol];
  if (!allowed || allowed.assetId !== context.assetId || allowed.decimals !== context.decimals) {
    return { ok: false, error: "asset_id_chain_mismatch" };
  }
  if (typeof context.targetPiggyId !== "string" || context.targetPiggyId.trim() === "") {
    return { ok: false, error: "missing_target_piggy" };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(context.targetAddress || "")) {
    return { ok: false, error: "missing_target_address" };
  }
  return { ok: true, error: null };
}

export const FUNDING_CONTEXT_TOKEN_ALLOWLIST = TOKEN_ALLOWLIST;
