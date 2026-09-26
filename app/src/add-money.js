// [A-493 Lane A] Add money — **계약만 있고 레일은 아직 없다.**
//
// 조사 결과(이 저장소 전수): 사용자의 **바깥 돈**을 앱 잔액으로 바꾸는 코드 경로가 **하나도 없다**.
// 있는 것은 `/api/grant` 뿐인데 그건 **가스 후원**이다 — 프로젝트가 자기 돈으로 고정 0.1 MON 을
// 주소 하나당 한 번 보내 주는 것이고, 기본값은 **503 으로 닫혀 있다**.
// **그것을 Add money 라고 부르지 않는다.** 사용자가 낸 돈이 아니기 때문이다.
//
// 그래서 이 파일이 하는 일은 하나다: **계약을 정의하고, 레일이 없으면 닫는다.**
// 가짜 버튼을 만들지 않는다. 금액/자산/체인/목적지를 모르면 **열리지 않는다**.

export const ADD_MONEY_STATUS = Object.freeze({
  NO_RAIL: "no_rail",               // 쓸 수 있는 충전 경로가 없다 — 현재 상태
  INVALID: "invalid_request",
  READY: "ready",                   // 레일이 생겼고 요청이 유효하다
});

// 후원과 사용자 돈은 **다른 것**이다. 섞어 부르지 않기 위해 이름으로 못 박는다.
export const FUNDING_KIND = Object.freeze({
  GAS_SPONSORSHIP: "gas_sponsorship", // 프로젝트가 내는 가스. **Add money 가 아니다.**
  USER_FUNDS: "user_funds",           // 사용자가 실제로 넣는 돈
});

/**
 * 지금 이 저장소에 등록된 충전 경로.
 * **비어 있다.** 무언가를 여기 넣으려면 실제로 동작하는 코드가 먼저 있어야 한다.
 */
export const REGISTERED_RAILS = Object.freeze([]);

/**
 * 후원 경로를 **Add money 로 승격하지 못하게** 하는 명시적 목록.
 * 이름을 적어 두는 이유: 나중에 누군가 "grant 있으니 되네" 라고 착각하기 쉬워서다.
 */
export const NOT_ADD_MONEY = Object.freeze([
  Object.freeze({
    id: "api-grant",
    kind: FUNDING_KIND.GAS_SPONSORSHIP,
    reason: "프로젝트가 내는 고정 0.1 MON 가스 후원. 주소당 1회, 기본 503 닫힘, 사용자 돈이 아니다.",
  }),
  Object.freeze({
    id: "local-relayer-grant",
    kind: FUNDING_KIND.GAS_SPONSORSHIP,
    reason: "같은 후원의 로컬 개발용 쌍둥이. allowlist 제한, 배포 경로 아님.",
  }),
  Object.freeze({
    id: "shmon-deposit",
    kind: FUNDING_KIND.USER_FUNDS,
    reason: "이미 지갑 안에 있는 돈을 shMON 으로 바꾸는 것. **바깥에서 들어오는 게 아니다** — 방향이 반대다.",
  }),
  Object.freeze({
    id: "owner-prefunded-harness",
    kind: FUNDING_KIND.USER_FUNDS,
    reason: "사람이 저장소 밖에서 직접 보낸 testnet 자금. 코드 경로가 아니다.",
  }),
]);

const AMOUNT = /^\d+(\.\d+)?$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;

function closed(reason, extra = {}) {
  return { status: ADD_MONEY_STATUS.NO_RAIL, ok: false, reason, rail: null, ...extra };
}

/**
 * 충전 요청. **레일이 없으면 요청이 아무리 정확해도 열리지 않는다.**
 *
 * 요청이 담아야 하는 것(계약): asset · amount · chain · source · destination · 그리고 결과의 receipt.
 * 하나라도 모르면 **닫는다** — 모르는 채로 진행하지 않는다.
 */
export function requestAddMoney({ asset, amount, chain, source, destination } = {}, { rails = REGISTERED_RAILS } = {}) {
  // 먼저 요청 자체가 말이 되는지 본다. 그래야 "레일이 없어서" 인지 "요청이 이상해서" 인지 갈린다.
  const bad = [];
  if (typeof asset !== "string" || asset.trim() === "") bad.push("asset");
  if (typeof amount !== "string" || !AMOUNT.test(amount) || Number(amount) <= 0) bad.push("amount");
  if (typeof chain !== "string" || chain.trim() === "") bad.push("chain");
  if (typeof source !== "string" || source.trim() === "") bad.push("source");
  if (typeof destination !== "string" || !ADDR.test(destination)) bad.push("destination");
  if (bad.length > 0) {
    return { status: ADD_MONEY_STATUS.INVALID, ok: false, reason: `missing_or_invalid:${bad.join(",")}`, rail: null };
  }

  // **스테이블이라고 $1 로 치지 않는다.** 이 층은 금액을 자산 그대로 다루고 USD 로 바꾸지 않는다.
  const usable = (rails || []).filter((r) => r && r.kind === FUNDING_KIND.USER_FUNDS && r.enabled === true);
  if (usable.length === 0) {
    return closed("no_user_funding_rail_registered", {
      request: { asset: asset.trim(), amount, chain: chain.trim(), source: source.trim(), destination: destination.trim() },
      // 왜 후원이 답이 아닌지를 함께 돌려준다 — 호출부가 착각하지 않도록.
      notAddMoney: NOT_ADD_MONEY.map((r) => ({ id: r.id, kind: r.kind })),
    });
  }

  return {
    status: ADD_MONEY_STATUS.READY, ok: true, reason: null, rail: usable[0].id,
    request: { asset: asset.trim(), amount, chain: chain.trim(), source: source.trim(), destination: destination.trim() },
  };
}

/** 화면이 `Add money` 를 보여도 되는가. **레일이 실제로 있을 때만.** */
export function isAddMoneyAvailable({ rails = REGISTERED_RAILS } = {}) {
  return (rails || []).some((r) => r && r.kind === FUNDING_KIND.USER_FUNDS && r.enabled === true);
}

/** 후원을 Add money 로 부르려는 시도를 막는다. */
export function classifyFundingPath(id) {
  const known = NOT_ADD_MONEY.find((r) => r.id === id);
  if (known) return { id, isAddMoney: false, kind: known.kind, reason: known.reason };
  const rail = REGISTERED_RAILS.find((r) => r.id === id);
  if (rail) return { id, isAddMoney: rail.kind === FUNDING_KIND.USER_FUNDS, kind: rail.kind, reason: null };
  return { id, isAddMoney: false, kind: null, reason: "unknown_path" };
}

/**
 * 충전이 실제로 일어났을 때 남겨야 할 Receipt 모양.
 * **레일이 생기기 전까지는 이 함수가 쓰일 일이 없다** — 모양만 먼저 정해 둔다.
 */
export const ADD_MONEY_RECEIPT_FIELDS = Object.freeze([
  "railId", "asset", "assetId", "amount", "chain",
  "source", "destination", "txHash", "status", "at",
]);
