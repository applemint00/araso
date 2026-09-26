// [A-492 Lane B] `SEND_MONEY` — 고른 Piggy 가 **자기 자유 잔액**을 외부 주소로 보낸다.
//
// 이것은 **Piggy 를 넘기는 일이 아니다.** 정체성·주소·통제권은 **그대로 주인에게 남는다.**
// 바뀌는 건 **그 Piggy 의 자유 잔액뿐**이다.
//
// 지키는 것:
//  · `send some` / `send all` 은 **자유(유동) 잔액**만 가리킨다.
//  · **프로토콜 포지션이나 대기 중인 돈을 조용히 청산하지 않는다.**
//    일하는 중/대기 중/잠긴 돈은 **그 Piggy 에 그대로 남는다.**
//  · 목적지는 실행 전에 **권한 봉투에 묶인다**(이 파일은 그 값을 만들어 줄 뿐이다).

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

export const SEND_MONEY_ACTION = "send_money";

export const ADDRESS_STATUS = Object.freeze({
  OK: "ok",
  MALFORMED: "malformed",
  EMPTY: "empty",
  SELF: "self_send",           // 그 Piggy 자신에게 보내는 것
  OWN_OTHER_PIGGY: "own_other_piggy", // 내 다른 Piggy 주소
  // [A-510 Stream A] `HOME: "home_address"` 는 걷어냈다 — Home 은 주소도 돈도 갖지 않는다(A-508).
});

/**
 * 목적지 검사. **틀린 주소를 조용히 고치지 않는다.**
 * 내 주소들과 겹치면 **막지는 않되 무엇인지 정확히 말해 준다** — 화면이 다르게 물어볼 수 있게.
 */
export function checkDestination(input, { selfAddress = null, otherPiggyAddresses = [] } = {}) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw === "") return { status: ADDRESS_STATUS.EMPTY, address: null };
  if (!ADDR.test(raw)) return { status: ADDRESS_STATUS.MALFORMED, address: null };
  const lower = raw.toLowerCase();
  if (selfAddress && lower === String(selfAddress).toLowerCase()) return { status: ADDRESS_STATUS.SELF, address: raw };
  const match = (otherPiggyAddresses || []).find((a) => a && String(a).toLowerCase() === lower);
  if (match) return { status: ADDRESS_STATUS.OWN_OTHER_PIGGY, address: raw };
  return { status: ADDRESS_STATUS.OK, address: raw };
}

/** 이 주소로 실제로 보낼 수 있나. 자기 자신에게 보내는 건 의미가 없어 막는다. */
export function canSendTo(check) {
  return check?.status === ADDRESS_STATUS.OK || check?.status === ADDRESS_STATUS.OWN_OTHER_PIGGY;
}

/**
 * 이 Piggy 가 **지금 보낼 수 있는 돈**. 자유 잔액만 센다.
 * 일하는 중/대기/잠김은 **빼고**, 그 사실을 함께 돌려준다 — 화면이 설명할 수 있게.
 */
export function freeBalance(piggy, symbol) {
  const assets = Array.isArray(piggy?.assets) ? piggy.assets : [];
  const row = assets.find((a) => a && a.symbol === symbol) || null;
  const quantity = row && AMOUNT.test(String(row.quantity)) ? String(row.quantity) : "0";
  // 위치가 home 이 아니면 그 돈은 **자유롭지 않다**. 보낼 수 있는 건 0 이다.
  const liquid = piggy?.location === "home";
  return {
    symbol,
    decimals: row?.decimals ?? null,
    assetId: row?.assetId ?? null,
    quantity: liquid ? quantity : "0",
    heldButNotFree: liquid ? "0" : quantity,
    reason: liquid ? null : (piggy?.location === "pending" ? "funds_pending" : "funds_away_working"),
  };
}

/**
 * `all` 을 **정확한 수량으로 푼다.** 봉투에는 정확한 값만 들어간다.
 * 자유 잔액이 없으면 보낼 수 없다 — **포지션을 풀어서 채우지 않는다.**
 */
export function resolveAmount(requested, free) {
  const available = free?.quantity ?? "0";
  if (Number(available) <= 0) {
    return { amount: null, reason: free?.reason || "no_free_balance" };
  }
  if (requested === "all") return { amount: available, reason: null, wasAll: true };
  const want = typeof requested === "string" ? requested.trim() : "";
  if (!AMOUNT.test(want) || Number(want) <= 0) return { amount: null, reason: "invalid_amount" };
  if (Number(want) > Number(available)) return { amount: null, reason: "exceeds_free_balance" };
  return { amount: want, reason: null, wasAll: false };
}

/**
 * 승인 직전에 사용자가 봐야 할 것들. **네트워크·정확한 자산·수수료**를 숨기지 않는다.
 * 수수료를 모르면 **모른다고 말한다** — 지어내지 않는다.
 */
export function buildSendPreview({ piggy, symbol, requested, destinationCheck, chain, feeEstimate = null } = {}) {
  const free = freeBalance(piggy, symbol);
  const resolved = resolveAmount(requested, free);
  const ready = resolved.amount !== null && canSendTo(destinationCheck);
  return {
    piggyId: piggy?.id ?? null,
    action: SEND_MONEY_ACTION,
    chain: chain ?? null,
    asset: symbol,
    assetId: free.assetId,
    amount: resolved.amount,
    wasAll: resolved.wasAll === true,
    destination: destinationCheck?.address ?? null,
    destinationStatus: destinationCheck?.status ?? ADDRESS_STATUS.EMPTY,
    // 모르면 null 이고, 화면은 그걸 "모름"으로 보여준다.
    feeEstimate: feeEstimate ?? null,
    // 보낼 수 없는 돈이 있으면 **그대로 남는다**고 알린다.
    stays: free.heldButNotFree !== "0" ? { quantity: free.heldButNotFree, reason: free.reason } : null,
    blocked: ready ? null : (resolved.reason || `destination_${destinationCheck?.status ?? "empty"}`),
    ready,
  };
}

/**
 * 실행 결과를 원장/Receipt 에 반영한다. **성공한 뒤에만 부른다.**
 * 이 함수는 체인을 부르지 않는다 — 결과를 받아 적을 뿐이다.
 */
export function applySendResult({ piggy, preview, txHash, status, at }) {
  if (status !== "success") {
    // 실패하면 **아무것도 바꾸지 않는다.**
    return { ok: false, reason: `tx_${status || "unknown"}`, piggy: null, receipt: null };
  }
  const assets = Array.isArray(piggy?.assets) ? piggy.assets : [];
  const row = assets.find((a) => a && a.symbol === preview.asset);
  if (!row) return { ok: false, reason: "asset_missing", piggy: null, receipt: null };
  const before = String(row.quantity);
  const decimals = row.decimals ?? 0;
  const unit = (v) => {
    const [w, f = ""] = String(v).split(".");
    return BigInt(w + f.padEnd(decimals, "0").slice(0, decimals));
  };
  const after = unit(before) - unit(preview.amount);
  if (after < 0n) return { ok: false, reason: "would_go_negative", piggy: null, receipt: null };
  const fmt = (u) => {
    const s = u.toString().padStart(decimals + 1, "0");
    const w = s.slice(0, s.length - decimals);
    const f = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
    return f ? `${w}.${f}` : w;
  };
  const afterStr = fmt(after);
  const nextAssets = afterStr === "0"
    ? assets.filter((a) => a.symbol !== preview.asset)
    : assets.map((a) => (a.symbol === preview.asset ? { ...a, quantity: afterStr } : a));

  return {
    ok: true,
    reason: null,
    // **정체성·주소·통제권은 건드리지 않는다.** 잔액만 바뀐다.
    piggy: { ...piggy, assets: nextAssets },
    receipt: {
      action: SEND_MONEY_ACTION,
      piggyId: piggy.id,
      asset: preview.asset,
      assetId: preview.assetId,
      amount: preview.amount,
      destination: preview.destination,
      chain: preview.chain,
      piggyBefore: before,
      piggyAfter: afterStr,
      txHash: txHash ?? null,
      status: "success",
      at: at ?? null,
    },
  };
}
