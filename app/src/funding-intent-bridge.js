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

import { FUNDING_STATE, fundingEvidenceKey } from "./funding-entry.js";
import { checkPlanApproval } from "./add-money.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// [A-646 phase A] 나눔 계획의 **다리별 부분 성공** 상태 — 모델만. 화면 0 · 보내기 0.
//
// 다리:  planned → pending → confirmed / failed / unknown
// 계획:  draft · approved · in_progress · complete · partial(실패 있음, 미지 없음) · needs_attention(미지 있음)
// 규칙(위 단일 충전 경로와 같은 fail-closed):
//   · 한 번에 한 다리만 나간다(순차). 확인된 다리는 **다시 보내지 않는다**.
//   · unknown 은 **자동으로 다시 보내지 않는다** — 먼저 대조(확정 결과)해야 한다. 미지가 남아 있으면 아무 다리도 나가지 않는다.
//   · 재시도는 **실패한 다리만**, 명시적 요청으로, **같은 planId** · 같은 멱등 키 `planId:piggyId` 로.
//   · 다리마다 자기 결과 · 자기 Receipt 키. 한 장으로 섞은 Receipt 는 없다.
//   · 승인(planId + planHash)이 지금 계획과 맞지 않으면 어떤 다리도 움직이지 않는다.

export const LEG_STATE = Object.freeze({
  PLANNED: "planned",
  PENDING: "pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  UNKNOWN: "unknown",
});

export const PLAN_STATE = Object.freeze({
  DRAFT: "draft",
  APPROVED: "approved",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
  PARTIAL: "partial",
  NEEDS_ATTENTION: "needs_attention",
});

/** 다리 상태들 → 계획 상태. 저장된 state 가 아니라 다리에서 **다시 센다**. */
export function derivePlanState(plan) {
  if (!plan || !plan.approval) return PLAN_STATE.DRAFT;
  const legs = plan.legs || [];
  const has = (s) => legs.some((l) => l.state === s);
  if (has(LEG_STATE.UNKNOWN)) return PLAN_STATE.NEEDS_ATTENTION;
  if (legs.length > 0 && legs.every((l) => l.state === LEG_STATE.CONFIRMED)) return PLAN_STATE.COMPLETE;
  if (legs.every((l) => l.state === LEG_STATE.PLANNED)) return PLAN_STATE.APPROVED;
  if (has(LEG_STATE.PENDING) || has(LEG_STATE.PLANNED)) return PLAN_STATE.IN_PROGRESS;
  return PLAN_STATE.PARTIAL;
}

function withLegs(plan, legs) {
  const next = { ...plan, legs };
  next.state = derivePlanState(next);
  return next;
}

function approvalMatches(plan, approval) {
  const check = checkPlanApproval(plan, approval);
  if (!check.ok) return check;
  if (!plan.approval || plan.approval.planId !== approval.planId || plan.approval.planHash !== approval.planHash) {
    return { ok: false, reason: "not_the_approved_plan" };
  }
  return { ok: true, reason: null };
}

/** 초안 → approved. 승인이 지금 계획의 planId/planHash 와 맞을 때만. 권한을 주지 않는다. */
export function markPlanApproved(plan, approval) {
  if (!plan) return { ok: false, reason: "no_plan", plan: null };
  if (plan.approval) return { ok: false, reason: "already_approved", plan };
  const check = checkPlanApproval(plan, approval);
  if (!check.ok) return { ok: false, reason: check.reason, plan };
  const next = withLegs({ ...plan, approval: { planId: approval.planId, planHash: approval.planHash } }, plan.legs.map((l) => ({ ...l })));
  return { ok: true, reason: null, plan: next, permissionGranted: false };
}

/**
 * 다음에 나갈 다리 하나(순차). 미지가 있으면 없음. 누가 pending 이면 없음.
 * planned 다리가 먼저. 실패한 다리는 `retry: true` 로 **명시적으로** 요청할 때만.
 */
export function nextLegToSend(plan, approval, { retry = false } = {}) {
  const ok = approvalMatches(plan, approval);
  if (!ok.ok) return { leg: null, reason: ok.reason };
  const legs = plan.legs || [];
  if (legs.some((l) => l.state === LEG_STATE.UNKNOWN)) return { leg: null, reason: "reconcile_unknown_first" };
  if (legs.some((l) => l.state === LEG_STATE.PENDING)) return { leg: null, reason: "one_leg_at_a_time" };
  const planned = legs.find((l) => l.state === LEG_STATE.PLANNED);
  if (planned) return { leg: { ...planned }, reason: null };
  const failed = legs.find((l) => l.state === LEG_STATE.FAILED);
  if (failed && retry === true) return { leg: { ...failed }, reason: null };
  if (failed) return { leg: null, reason: "retry_needs_explicit_request" };
  return { leg: null, reason: "nothing_to_send" };
}

/** planned(또는 명시적 재시도의 failed) → pending. 확인된 다리 · 미지 다리 · 동시 두 다리는 거부. */
export function markLegPending(plan, piggyId, approval, { retry = false } = {}) {
  const ok = approvalMatches(plan, approval);
  if (!ok.ok) return { ok: false, reason: ok.reason, plan };
  const legs = plan.legs || [];
  const leg = legs.find((l) => l.piggyId === piggyId);
  if (!leg) return { ok: false, reason: "leg_not_in_plan", plan };
  if (leg.state === LEG_STATE.CONFIRMED) return { ok: false, reason: "leg_already_confirmed", plan };
  if (legs.some((l) => l.state === LEG_STATE.UNKNOWN)) return { ok: false, reason: "reconcile_unknown_first", plan };
  if (legs.some((l) => l.state === LEG_STATE.PENDING)) return { ok: false, reason: "one_leg_at_a_time", plan };
  if (leg.state === LEG_STATE.FAILED && retry !== true) return { ok: false, reason: "retry_needs_explicit_request", plan };
  if (leg.state !== LEG_STATE.PLANNED && leg.state !== LEG_STATE.FAILED) return { ok: false, reason: "leg_not_sendable", plan };
  const next = withLegs(plan, legs.map((l) => (l.piggyId === piggyId
    ? { ...l, state: LEG_STATE.PENDING, attempts: (l.attempts || 0) + 1 }
    : { ...l })));
  return { ok: true, reason: null, plan: next, idempotencyKey: leg.idempotencyKey, planId: plan.planId };
}

/**
 * 다리 하나의 결과 반영. `applied` = funding-entry.js `applyFundingResult` 의 결과(그 다리의 의도로 만든 것).
 * 다른 Piggy/주소/금액/자산/체인의 결과는 거부한다(아무것도 안 바뀜). 확인된 다리는 절대 바뀌지 않는다.
 * unknown 다리는 확정 결과(confirmed/failed)로만 빠져나온다 — 그게 대조(reconcile)다.
 */
export function applyLegResult(plan, piggyId, applied) {
  const legs = plan?.legs || [];
  const leg = legs.find((l) => l.piggyId === piggyId);
  if (!leg) return { ok: false, reason: "leg_not_in_plan", plan };
  if (leg.state === LEG_STATE.CONFIRMED) return { ok: false, reason: "leg_already_confirmed", plan };
  if (leg.state !== LEG_STATE.PENDING && leg.state !== LEG_STATE.UNKNOWN) return { ok: false, reason: "leg_not_in_flight", plan };
  const intent = applied?.intent;
  let expectedAmount = null;
  try {
    expectedAmount = format(BigInt(leg.amount), plan.asset.decimals);
  } catch {
    return { ok: false, reason: "invalid_leg", plan };
  }
  if (!intent || intent.targetPiggyId !== piggyId
    || typeof intent.target !== "string" || intent.target.toLowerCase() !== String(leg.target).toLowerCase()
    || intent.requestedAmount !== expectedAmount
    || intent.targetAsset !== plan.asset.symbol || intent.targetChain !== plan.chainId) {
    return { ok: false, reason: "leg_mismatch", plan };
  }

  let patch;
  switch (applied.state) {
    case FUNDING_STATE.CONFIRMED: {
      if (applied.ok !== true || applied.creditsTarget !== true || applied.credited?.piggyId !== piggyId) {
        return { ok: false, reason: "leg_mismatch", plan };
      }
      const evidenceKey = fundingEvidenceKey({ chain: applied.credited.chain, asset: applied.credited.asset, target: applied.credited.target, txHash: applied.receipt?.txHash });
      // 같은 증거(또는 같은 체인의 같은 tx)를 두 다리가 나눠 쓸 수 없다 — 한 번 도착한 돈을 두 번 세지 않는다.
      const txHash = applied.receipt?.txHash;
      if (legs.some((l) => l.piggyId !== piggyId && (l.evidenceKey === evidenceKey
        || (l.receipt && l.receipt.chain === applied.credited.chain && l.receipt.txHash === txHash)))) {
        return { ok: false, reason: "duplicate_evidence", plan };
      }
      patch = {
        state: LEG_STATE.CONFIRMED,
        result: { state: LEG_STATE.CONFIRMED, reason: null },
        evidenceKey,
        // 이 다리 한 장. 계획 id 로 묶이지만 다른 다리와 섞이지 않는다.
        receipt: { ...applied.receipt, planId: plan.planId, idempotencyKey: leg.idempotencyKey },
      };
      break;
    }
    case FUNDING_STATE.FAILED:
    case FUNDING_STATE.CANCELLED:
      patch = { state: LEG_STATE.FAILED, result: { state: LEG_STATE.FAILED, reason: applied.reason ?? applied.state } };
      break;
    case FUNDING_STATE.UNKNOWN:
      patch = { state: LEG_STATE.UNKNOWN, result: { state: LEG_STATE.UNKNOWN, reason: "unknown_outcome_must_reconcile" } };
      break;
    case FUNDING_STATE.PENDING:
      // 아직이다. unknown 이던 다리는 unknown 으로 남는다(확정 결과로만 빠져나온다).
      patch = leg.state === LEG_STATE.UNKNOWN ? {} : { state: LEG_STATE.PENDING, result: { state: LEG_STATE.PENDING, reason: "still_pending" } };
      break;
    default:
      return { ok: false, reason: "unrecognized_result", plan };
  }
  const next = withLegs(plan, legs.map((l) => (l.piggyId === piggyId ? { ...l, ...patch } : { ...l })));
  return { ok: true, reason: null, plan: next, retry: false, permissionGranted: false };
}

/** 확인된 다리마다 한 장 — 키 = `planId:piggyId`. 섞은 한 장은 만들지 않는다. */
export function planLegReceipts(plan) {
  return (plan?.legs || [])
    .filter((l) => l.state === LEG_STATE.CONFIRMED && l.receipt)
    .map((l) => ({ key: l.idempotencyKey, piggyId: l.piggyId, evidenceKey: l.evidenceKey, receipt: { ...l.receipt } }));
}

/** "N 중 M 놓임, K 확인 필요" 의 **숫자만**(문구는 OWNER). */
export function planProgress(plan) {
  const legs = plan?.legs || [];
  const count = (s) => legs.filter((l) => l.state === s).length;
  return {
    legs: legs.length,
    placed: count(LEG_STATE.CONFIRMED),
    failed: count(LEG_STATE.FAILED),
    needsAttention: count(LEG_STATE.UNKNOWN),
    pending: count(LEG_STATE.PENDING),
    state: derivePlanState(plan),
  };
}
