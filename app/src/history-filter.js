// [history filter] HISTORY 를 **어느 Piggy 의 기록인가**로 거르는 순수 함수들.
//
// 규율:
//  · 원래 인덱스를 잃지 않는다 — 상세 보기가 `state.receipts` 인덱스를 쓰기 때문이다.
//    걸러진 목록은 `{ receipt, index }` 쌍으로 돌려준다.
//  · **주인을 모르는 기록을 추측해서 배정하지 않는다.** piggyId 가 없는 옛 기록은
//    전체(legacy) 경로에서만 보이고, 특정 Piggy 의 목록에는 **절대 섞이지 않는다**.
//  · 교차 유출 0 — A 를 고르면 A 것만 나온다.

export const HISTORY_SCOPE = Object.freeze({
  ALL: "all",        // HOME 의 `records · n` — 지금까지의 동작 그대로
  PIGGY: "piggy",    // MY MONEY 의 Piggy 행에서 고른 하나
});

/** 이 기록의 주인. 알 수 없으면 **null** 이다(빈 문자열을 주인으로 치지 않는다). */
export function receiptOwnerId(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  const raw = receipt.piggyId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * @param {Array} receipts  `state.receipts` 전체
 * @param {string|null} piggyId  null 이면 전체(legacy) 동작
 * @returns {{ scope, piggyId, rows: Array<{receipt, index}>, ownerUnknownCount }}
 */
export function filterHistory(receipts = [], piggyId = null) {
  const all = Array.isArray(receipts) ? receipts : [];
  const indexed = all.map((receipt, index) => ({ receipt, index }));
  const id = typeof piggyId === "string" && piggyId.trim() !== "" ? piggyId.trim() : null;

  if (!id) {
    // 전체 경로 — 주인이 있든 없든 **전부** 보인다. 지금까지의 동작이다.
    return {
      scope: HISTORY_SCOPE.ALL,
      piggyId: null,
      rows: indexed,
      ownerUnknownCount: indexed.filter((r) => receiptOwnerId(r.receipt) === null).length,
    };
  }

  // 한 Piggy 경로 — **정확히 일치하는 것만**. 주인 없는 기록은 들어오지 않는다.
  const rows = indexed.filter((r) => receiptOwnerId(r.receipt) === id);
  return {
    scope: HISTORY_SCOPE.PIGGY,
    piggyId: id,
    rows,
    ownerUnknownCount: 0, // 이 경로에는 주인 미상이 섞일 수 없다
  };
}

/** 오른쪽 종이 머리글에 쓸 정체성. 이름을 모르면 **지어내지 않는다**. */
export function historyIdentityLabel({ piggyId = null, piggies = [], fallbackName = "" } = {}) {
  if (!piggyId) return fallbackName || "";
  const match = (Array.isArray(piggies) ? piggies : []).find((p) => p && p.id === piggyId);
  if (match && typeof match.name === "string" && match.name.trim() !== "") return match.name.trim();
  // 레지스트리에 이름이 없으면 id 를 그대로 보여준다 — 다른 Piggy 이름을 빌려오지 않는다.
  return piggyId;
}

/**
 * 고른 Piggy 가 더 이상 없을 때(삭제·scope 변경) **조용히 다른 Piggy 를 보여주지 않는다**.
 * 전체 경로로 되돌린다.
 */
export function resolveHistorySelection(piggyId, piggies = []) {
  const id = typeof piggyId === "string" && piggyId.trim() !== "" ? piggyId.trim() : null;
  if (!id) return null;
  const known = (Array.isArray(piggies) ? piggies : []).some((p) => p && p.id === id);
  return known ? id : null;
}
