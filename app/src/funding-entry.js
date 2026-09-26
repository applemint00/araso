// [A-494 Lane A] Add money 는 **하나의 사용자 행동**이고, 그 아래에 **여러 레일**이 붙는다.
//
// 제품 전제: **사용자가 이미 암호지갑을 갖고 있다고 가정하지 않는다.**
// 첫 기술 증명이 "다른 지갑에서 보내기" 라는 사실이 제품을 그렇게 정의하지 않는다.
//
// 이 파일이 하는 일:
//   · 방법(method)을 **사용자 말**로 묶고, 제공자별 사정은 **어댑터 뒤에** 둔다.
//   · **지원되지 않는 방법은 정직하게 unavailable** 로 남긴다 — 숨기지도, 있는 척하지도 않는다.
//   · 도착 자산 기본값은 **Monad 의 USDC**. **조용한 자산 대체 0**, **스테이블=$1 가정 0**.
//
// 하지 않는 일: 온램프/브리지 제공자 선택(이 칸 범위 밖) · 가스 후원을 충전으로 취급.

import { FUNDING_KIND, NOT_ADD_MONEY } from "./add-money.js";

// 사용자에게 보이는 말. 내부 레일 이름을 사용자에게 들이대지 않는다.
export const FUNDING_METHOD = Object.freeze({
  BANK_CARD_APPLE_PAY: "bank_card_apple_pay",  // "은행 · 카드 · Apple Pay"
  FROM_ANOTHER_WALLET: "from_another_wallet",  // "다른 지갑에서"
  OTHER: "other_options",                      // "다른 방법"
});

// 내부 레일. 사용자는 이 이름을 볼 일이 없다.
export const FUNDING_RAIL = Object.freeze({
  ONRAMP_PROVIDER: "onramp_provider",
  DIRECT_WALLET_TRANSFER: "direct_wallet_transfer",
  INTERNAL_ROUTE: "internal_route",   // 브리지/CCTP 등 — 제공자 미정
});

export const FUNDING_STATE = Object.freeze({
  UNAVAILABLE: "unavailable",
  CHOOSING: "choosing",
  AWAITING_EXTERNAL_ACTION: "awaiting_external_action",
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
});

// 기본 도착 자산. **바꾸려면 명시적으로 말해야 한다.**
export const DEFAULT_ARRIVAL = Object.freeze({ chain: "monad-mainnet", asset: "USDC" });

/**
 * 방법 목록. **지원 여부와 이유를 함께** 돌려준다 —
 * 화면이 "아직 안 돼요" 를 정직하게 말할 수 있게.
 */
export function listFundingMethods({ adapters = [] } = {}) {
  const byMethod = new Map();
  for (const a of adapters) {
    if (!a || !a.method) continue;
    const prev = byMethod.get(a.method);
    // 하나라도 쓸 수 있으면 그 방법은 사용 가능하다.
    if (!prev || (a.available === true && prev.available !== true)) byMethod.set(a.method, a);
  }
  return Object.values(FUNDING_METHOD).map((method) => {
    const a = byMethod.get(method);
    return {
      method,
      available: a?.available === true,
      railId: a?.available === true ? a.railId : null,
      // 왜 안 되는지 — "제공자 미선정" 인지 "일시 장애" 인지 구분된다.
      unavailableReason: a?.available === true ? null : (a?.unavailableReason || "no_provider_selected"),
    };
  });
}

/** Add money 라는 **행동 자체**는 방법이 하나도 없어도 사라지지 않는다. */
export function isAddMoneyPrimitiveVisible() {
  return true;
}

/** 지금 실제로 쓸 수 있는 방법이 하나라도 있나. */
export function hasUsableMethod({ adapters = [] } = {}) {
  return listFundingMethods({ adapters }).some((m) => m.available);
}

function fail(state, reason, extra = {}) {
  return { state, ok: false, reason, ...extra };
}

/**
 * 충전 의도. **모르는 값이 있으면 열리지 않는다.**
 * 도착 자산을 바꾸라는 요청은 **조용히 받아들이지 않는다** — 명시적으로 확인해야 한다.
 */
// [A-510 Stream D-core] 충전은 **받을 Piggy 하나**에 묶인다 — `targetPiggyId` + 그 Piggy 의 `target` 주소.
// Home 이 따로 받는 돈은 없다(A-508). 여러 Piggy 중 누구인지는 **호출자가 정한다**
// (한 마리면 그 Piggy, 여럿이면 나중에 Stream B 의 selectedPiggy). 여기서 두 번째 선택 상태를 만들지 않는다.
// [A-553 Lane A] `expectedChain` — 이 요청이 맞다고 볼 기준 체인. 안 주면(옛 호출부 호환)
// 지금까지처럼 DEFAULT_ARRIVAL.chain 과 비교한다. **제품 경로는 반드시 넘긴다** —
// beginFundingForPiggy 가 FundingContext.chainId(지금 실행 중인 체인)를 준다. 그래야
// "지금 런타임이 testnet 인데 기본값은 mainnet" 같은 숨은 불일치가 매번 asset_change 확인창을
// 강제로 띄우지 않는다(Lane A AUDIT §3 funding-entry.js:104-106).
export function startFunding({
  method, amount, arrival = DEFAULT_ARRIVAL, target, targetPiggyId, adapters = [], assetChangeAcknowledged = false,
  expectedChain,
} = {}) {
  if (!Object.values(FUNDING_METHOD).includes(method)) return fail(FUNDING_STATE.FAILED, "unknown_method");
  if (typeof amount !== "string" || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    return fail(FUNDING_STATE.FAILED, "invalid_amount");
  }
  if (typeof target !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(target)) {
    return fail(FUNDING_STATE.FAILED, "invalid_target");
  }
  const piggyId = typeof targetPiggyId === "string" ? targetPiggyId.trim() : "";
  if (!piggyId) return fail(FUNDING_STATE.FAILED, "missing_target_piggy");
  const chain = typeof arrival?.chain === "string" ? arrival.chain.trim() : "";
  const asset = typeof arrival?.asset === "string" ? arrival.asset.trim() : "";
  if (!chain || !asset) return fail(FUNDING_STATE.FAILED, "invalid_arrival");
  // **조용한 자산 대체 금지** — 기본값(또는 호출자가 명시한 기대 체인)이 아니면 사용자가
  // 알고 있어야 한다.
  const expected = typeof expectedChain === "string" && expectedChain.trim() !== "" ? expectedChain.trim() : DEFAULT_ARRIVAL.chain;
  if ((asset !== DEFAULT_ARRIVAL.asset || chain !== expected) && assetChangeAcknowledged !== true) {
    return fail(FUNDING_STATE.FAILED, "asset_change_not_acknowledged", { requested: { chain, asset }, default: { chain: expected, asset: DEFAULT_ARRIVAL.asset } });
  }

  const adapter = adapters.find((a) => a && a.method === method && a.available === true);
  if (!adapter) {
    const listed = listFundingMethods({ adapters }).find((m) => m.method === method);
    return fail(FUNDING_STATE.UNAVAILABLE, listed?.unavailableReason || "no_provider_selected", { method });
  }

  return {
    state: FUNDING_STATE.AWAITING_EXTERNAL_ACTION,
    ok: true,
    reason: null,
    intent: {
      method,
      railId: adapter.railId,
      sourceContext: adapter.sourceContext ?? null,
      targetChain: chain,
      targetAsset: asset,
      requestedAmount: amount,
      resolvedAmount: null,     // 실제로 들어온 금액은 확인 뒤에 채워진다
      target,
      targetPiggyId: piggyId,
      startedAt: null,
      confirmedAt: null,
      evidence: null,
      errorCode: null,
    },
  };
}

/**
 * 결과 반영. **확인된 뒤에만** 받을 Piggy 의 투영이 늘어난다(`creditsTarget`).
 * (이력: A-494 는 이 필드를 `creditsHome` 이라 불렀다 — Home 이 따로 받던 옛 모델. A-510 에서 개명.)
 * `pending` 이나 `unknown` 으로는 절대 늘리지 않는다.
 */
export function applyFundingResult(intent, result = {}) {
  if (!intent) return fail(FUNDING_STATE.FAILED, "no_intent");
  const status = result.status;

  if (status === FUNDING_STATE.UNKNOWN) {
    // 모르면 **재시도하지 않는다** — 먼저 대조한다.
    return { state: FUNDING_STATE.UNKNOWN, ok: false, reason: "unknown_outcome_must_reconcile", retry: false, creditsTarget: false, intent };
  }
  if (status === FUNDING_STATE.CANCELLED) {
    return { state: FUNDING_STATE.CANCELLED, ok: false, reason: "cancelled", creditsTarget: false, mutated: false, intent };
  }
  if (status === FUNDING_STATE.FAILED) {
    return { state: FUNDING_STATE.FAILED, ok: false, reason: result.errorCode || "failed", creditsTarget: false, mutated: false, intent };
  }
  if (status === FUNDING_STATE.PENDING) {
    // 아직이다. **돈이 들어온 것처럼 보이면 안 된다.**
    return { state: FUNDING_STATE.PENDING, ok: false, reason: "still_pending", creditsTarget: false, intent };
  }
  if (status !== FUNDING_STATE.CONFIRMED) return fail(FUNDING_STATE.FAILED, "unknown_status");

  // 확인됐다 — 그래도 **도착한 것이 요청한 그것인지** 본다.
  if (result.chain !== intent.targetChain) return fail(FUNDING_STATE.FAILED, "wrong_chain", { creditsTarget: false });
  if (result.asset !== intent.targetAsset) return fail(FUNDING_STATE.FAILED, "wrong_asset", { creditsTarget: false });
  if (typeof result.target !== "string" || result.target.toLowerCase() !== intent.target.toLowerCase()) {
    return fail(FUNDING_STATE.FAILED, "wrong_target", { creditsTarget: false });
  }
  const arrived = typeof result.amount === "string" ? result.amount.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(arrived) || Number(arrived) <= 0) return fail(FUNDING_STATE.FAILED, "invalid_arrived_amount", { creditsTarget: false });
  if (!result.txHash) return fail(FUNDING_STATE.FAILED, "missing_evidence", { creditsTarget: false });

  if (typeof intent.targetPiggyId !== "string" || intent.targetPiggyId === "") {
    return fail(FUNDING_STATE.FAILED, "missing_target_piggy", { creditsTarget: false });
  }

  return {
    state: FUNDING_STATE.CONFIRMED,
    ok: true,
    reason: null,
    creditsTarget: true,
    // **요청한 금액이 아니라 실제로 도착한 금액**을 쓴다.
    credited: { piggyId: intent.targetPiggyId, target: intent.target, asset: intent.targetAsset, chain: intent.targetChain, amount: arrived },
    intent: { ...intent, resolvedAmount: arrived, confirmedAt: result.at ?? null, evidence: result.txHash },
    receipt: {
      action: "add_money",
      method: intent.method,
      railId: intent.railId,
      asset: intent.targetAsset,
      chain: intent.targetChain,
      requestedAmount: intent.requestedAmount,
      resolvedAmount: arrived,
      target: intent.target,
      piggyId: intent.targetPiggyId,
      txHash: result.txHash,
      status: "confirmed",
      at: result.at ?? null,
    },
  };
}

/** 같은 충전이 두 번 반영되지 않게 하는 키. */
export function fundingEvidenceKey(result) {
  return [result?.chain || "", result?.asset || "", result?.target || "", result?.txHash || ""].join("|");
}

/** 가스 후원을 충전 방법으로 올리려는 시도를 막는다. */
export function isFundingMethod(pathId) {
  const sponsored = NOT_ADD_MONEY.find((r) => r.id === pathId && r.kind === FUNDING_KIND.GAS_SPONSORSHIP);
  return !sponsored && Object.values(FUNDING_RAIL).includes(pathId);
}
