// [A-494 Lane C → A-510 Stream D-core] 돈이 모자랄 때 **원래 하려던 일을 잃지 않는다.**
//
// 상황: Honeybun 이 어떤 일에 $50 이 필요한데, **Honeybun 자기 돈 중 안 나간 부분(at home)** 이 $20 뿐이다.
// 잘못된 처리: "MY MONEY 로 가서 충전하세요" 라며 **하던 일에서 쫓아내기**.
// 맞는 처리: **$30 이 더 필요하다**고 그 자리에서 말하고, **같은 충전 원시동작**을 **바로 그 Piggy 를 받는 곳으로** 연다.
// 충전이 확인되면 **원래 하려던 Honeybun 흐름으로 돌아온다.**
//
// 이력: A-494 는 이 계산을 "Honeybun 에게 주려는데 **집(Home)** 에 $20" 으로 썼다(`checkGiveIntent`/`homeAvailable`).
// A-508 에서 Home 은 돈을 갖지 않게 됐다 — 기준은 이제 **그 Piggy 자신의 가용 돈**이다.
//
// 중요한 경계: **충전 확인은 권한이 아니다.**
// 그 Piggy 에 돈이 생겼다는 것과, 그 돈으로 무엇을 해도 된다는 것은 **다른 일**이다(Birth ≠ Funding ≠ Job Permission).
// 원래 행동은 여전히 자기 권한(Face ID/passkey)과 Receipt 를 따로 받는다.

import { FUNDING_STATE } from "./funding-entry.js";

const AMOUNT = /^\d+(\.\d+)?$/;

function units(value, decimals) {
  const [w, f = ""] = String(value).split(".");
  return BigInt(w + f.padEnd(decimals, "0").slice(0, decimals));
}
function format(u, decimals) {
  const s = u.toString().padStart(decimals + 1, "0");
  const w = s.slice(0, s.length - decimals);
  const f = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

/**
 * 이 Piggy 가 하려던 일이 **그 Piggy 자기 가용 돈으로** 지금 가능한가.
 * 모자라면 **얼마나 모자란지** 정확히 말한다.
 *
 * @param {object} p
 * @param {string} p.piggyId    돈이 필요한 그 Piggy — 충전도 이 Piggy 로 간다
 * @param {string} p.action     하려던 행동(원래 의도로 돌아올 때 쓴다)
 * @param {string} p.available  그 Piggy 의 가용 수량(at home). Home 잔액이 아니다
 * @returns { sufficient, shortfall, intent }
 */
export function checkIntentFunding({ piggyId, action = null, amount, asset, decimals, available } = {}) {
  if (typeof piggyId !== "string" || piggyId.trim() === "") return { sufficient: false, error: "missing_piggy", intent: null };
  if (typeof amount !== "string" || !AMOUNT.test(amount) || Number(amount) <= 0) return { sufficient: false, error: "invalid_amount", intent: null };
  if (typeof asset !== "string" || asset.trim() === "") return { sufficient: false, error: "missing_asset", intent: null };
  if (!Number.isInteger(decimals) || decimals < 0) return { sufficient: false, error: "invalid_decimals", intent: null };
  if (typeof available !== "string" || !AMOUNT.test(available)) return { sufficient: false, error: "invalid_piggy_balance", intent: null };

  const want = units(amount, decimals);
  const have = units(available, decimals);
  // **원래 의도를 그대로 담아 둔다** — 충전이 끝나면 이걸로 돌아온다.
  const intent = { piggyId: piggyId.trim(), action: typeof action === "string" ? action : null, amount, asset: asset.trim(), decimals };
  if (have >= want) return { sufficient: true, shortfall: null, error: null, intent };
  return { sufficient: false, shortfall: format(want - have, decimals), error: null, intent };
}

/**
 * 모자랄 때 열 충전 요청. **같은 원시동작**을 쓴다 — 두 번째 Add money 구현을 만들지 않는다.
 * 요청 금액은 **모자란 만큼**, 받는 곳은 **돈이 필요한 바로 그 Piggy** 다.
 * 원래 의도는 `resumeAfter` 에 그대로 실려 간다.
 *
 * [A-553 Lane A] 도착 체인은 더 이상 여기 박힌 리터럴이 아니다 — **호출자가 지금 실행 중인
 * 체인을 명시적으로 넘긴다**(main.js beginFundingForPiggy 가 FundingContext.chainId 를 준다).
 * `chain` 이 없으면 **열지 않는다** — 숨은 기본값(옛 `monad-mainnet` 리터럴, 실제 런타임과
 * 다를 수 있었다)으로 조용히 채우지 않는다.
 */
export function fundingRequestForShortfall(check, { target, chain } = {}) {
  if (!check || check.sufficient || !check.shortfall) return null;
  const runtimeChain = typeof chain === "string" ? chain.trim() : "";
  if (!runtimeChain) return null;
  return {
    amount: check.shortfall,
    // 도착 자산은 그 일에 필요한 그 자산이다 — 조용히 바꾸지 않는다.
    arrival: { chain: runtimeChain, asset: check.intent.asset },
    target: target ?? null,
    targetPiggyId: check.intent.piggyId,
    resumeAfter: { ...check.intent },
  };
}

/**
 * 충전 결과를 받아 **원래 하려던 일로 돌아갈지** 정한다.
 * 확인된 충전이 **다른 Piggy** 로 갔다면 돌아가지 않는다.
 *
 * 돌아가더라도 **권한은 주지 않는다** — `permissionGranted` 는 언제나 false 다.
 */
export function resumeAfterFunding(fundingResult, resumeAfter, { available, decimals } = {}) {
  if (!resumeAfter) return { resume: false, reason: "no_saved_intent", permissionGranted: false };

  const state = fundingResult?.state;
  if (state === FUNDING_STATE.CANCELLED) {
    // 취소 — **잔액을 건드리지 않고** 원래 자리로 안전하게 돌아온다.
    return { resume: true, reason: "cancelled_without_funding", intent: { ...resumeAfter }, funded: false, mutated: false, permissionGranted: false };
  }
  if (state !== FUNDING_STATE.CONFIRMED || fundingResult?.creditsTarget !== true) {
    // 아직이거나 실패/미지 — **원래 의도는 잃지 않되 진행하지 않는다.**
    return { resume: false, reason: state === FUNDING_STATE.UNKNOWN ? "unknown_must_reconcile" : `not_confirmed:${state ?? "none"}`, intent: { ...resumeAfter }, funded: false, permissionGranted: false };
  }
  const creditedPiggy = fundingResult?.credited?.piggyId;
  if (creditedPiggy !== resumeAfter.piggyId) {
    // 돈이 다른 Piggy 로 갔다 — 이 의도는 채워지지 않았다.
    return { resume: false, reason: "funded_other_piggy", intent: { ...resumeAfter }, funded: false, permissionGranted: false };
  }

  // 확인됐다 — 이제 정말 충분한가 **다시 센다**(도착 금액이 요청보다 적을 수 있다).
  const d = Number.isInteger(decimals) ? decimals : resumeAfter.decimals;
  let stillShort = null;
  if (typeof available === "string" && AMOUNT.test(available)) {
    const have = units(available, d);
    const want = units(resumeAfter.amount, d);
    if (have < want) stillShort = format(want - have, d);
  }

  return {
    resume: true,
    reason: stillShort ? "funded_but_still_short" : "funded",
    intent: { ...resumeAfter },
    funded: true,
    stillShort,
    // **충전이 곧 권한은 아니다.** 원래 행동은 자기 권한을 따로 받아야 한다.
    permissionGranted: false,
    nextStep: stillShort ? "ask_more_funding" : "ask_permission_for_action",
  };
}
