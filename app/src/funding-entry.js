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

import { FUNDING_KIND, NOT_ADD_MONEY, checkPlanApproval } from "./add-money.js";
import { unitsToQuantity } from "./piggy-registry.js";
import { scopeForChainId, FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "./funding-context.js";
import { evaluateDestinationBoundExecution, DECISION, DESTINATION_SOURCE, hasOwnSafe } from "./execution-safety.js";

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
  // [A-898] a direct deposit (Funding Paper crypto row) may have no amount yet: openAmount:true lets amount be null.
  openAmount = false,
} = {}) {
  if (!Object.values(FUNDING_METHOD).includes(method)) return fail(FUNDING_STATE.FAILED, "unknown_method");
  const openDeposit = openAmount === true && amount === null;
  if (!openDeposit && (typeof amount !== "string" || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0)) {
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

/**
 * [A-646 phase A] 나눔 계획의 다리 하나 → **보통의 단일 목적지 `startFunding` 의도 하나**.
 * 받는 곳 = 그 다리의 `targetPiggyId` + 계획을 만들 때 레지스트리에서 풀어 둔 그 Piggy 의 `target`.
 * 라우터 · 묶음 계약 · 중간 주소 없음. 승인(planId + planHash)이 지금 계획과 맞지 않으면 열지 않는다.
 * 레일이 0 이면 `startFunding` 이 정직하게 unavailable 을 돌려준다 — 아무것도 보내지 않는다.
 */
export function planLegIntent(plan, leg, { approval, method, adapters = [], assetChangeAcknowledged = false } = {}) {
  const check = checkPlanApproval(plan, approval);
  if (!check.ok) return fail(FUNDING_STATE.FAILED, check.reason, { piggyId: leg?.piggyId ?? null });
  const own = (plan.legs || []).find((l) => l.piggyId === leg?.piggyId);
  if (!own || own.target !== leg.target || own.amount !== leg.amount) return fail(FUNDING_STATE.FAILED, "leg_not_in_plan", { piggyId: leg?.piggyId ?? null });
  let amount;
  try {
    amount = unitsToQuantity(BigInt(own.amount), plan.asset.decimals);
  } catch {
    return fail(FUNDING_STATE.FAILED, "invalid_amount", { piggyId: own.piggyId });
  }
  const started = startFunding({
    method,
    amount,
    arrival: { chain: plan.chainId, asset: plan.asset.symbol },
    target: own.target,
    targetPiggyId: own.piggyId,
    adapters,
    assetChangeAcknowledged,
    expectedChain: plan.chainId,
  });
  return { ...started, piggyId: own.piggyId, idempotencyKey: own.idempotencyKey };
}

/** 계획 전체 → 다리마다 단일 목적지 의도 하나(계획 순서 = piggyId 순). 보내는 것은 호출자가 한 번에 하나씩. */
export function expandPlanToLegIntents(plan, opts = {}) {
  return (plan?.legs || []).map((leg) => planLegIntent(plan, leg, opts));
}

/** 가스 후원을 충전 방법으로 올리려는 시도를 막는다. */
export function isFundingMethod(pathId) {
  const sponsored = NOT_ADD_MONEY.find((r) => r.id === pathId && r.kind === FUNDING_KIND.GAS_SPONSORSHIP);
  return !sponsored && Object.values(FUNDING_RAIL).includes(pathId);
}

// ─────────────────────────────────────────────────────────────────────────────
// [A-877] 레일 견적 → **검증된 충전 계획**. 제공자 중립 경계. 화면 0 · 보내기 0 · 서명 0.
//
// 이 경계가 하는 일:
//   · 레일 어댑터가 이미 자기 규칙으로 검증한 견적(정규화된 `railQuote`)을 받는다. 어댑터는 이 파일 밖에
//     있고(제공자별 사정은 어댑터 뒤), 여기서는 제공자 이름으로 분기하지 않는다.
//   · 호출자가 **명시적으로 묶은** 출발 체인·토큰 / 도착 체인·토큰 / 받는 주소 / 입력 수량(`binding`)을
//     충전 의도(`startFunding` 결과)와 대조하고, 견적의 같은 칸과 **한 칸씩** 대조한다. 하나라도 다르면
//     PLAN_REJECTED — 계획 객체를 만들지 않는다.
//   · 그다음 실행 안전 게이트(execution-safety `evaluateDestinationBoundExecution`)를 돌린다. 게이트가 DO 가
//     아니면 PLAN_BLOCKED. **DO 일 때만** READY_FOR_CONFIRMATION.
//   · 가스 top-up 은 **꺼져 있다.** 켜는 길은 명시적 `fundingPolicy.gasTopup.enabled === true` 하나뿐이고,
//     지금 그 값을 넘기는 호출자는 없다. 견적의 top-up 상태가 정책과 다르면 거절한다.
//
// 이 경계가 하지 않는 일:
//   · 지갑·서명·전송·브로드캐스트·네트워크. 이 파일에는 그런 함수가 없다.
//   · 권한을 만들지 않는다. READY_FOR_CONFIRMATION ≠ 승인. 계획은 언제나 `execute:false`,
//     `executionAuthority:false`, `permissionGranted:false` 다. 확인·서명은 별도의 미래 칸이다.
//   · 임계값을 지어내지 않는다. 정책(`safety.policy`)이 없으면 게이트가 UNKNOWN 으로 멈춘다.

export const FUNDING_PLAN_STATE = Object.freeze({
  REJECTED: "plan_rejected",                        // 묶음/견적 불일치 · 모양 오류 — 계획 없음
  BLOCKED: "plan_blocked",                          // 실행 안전 게이트가 DO 가 아님 — 계획 없음
  READY_FOR_CONFIRMATION: "ready_for_confirmation", // 게이트 DO. 사용자 확인 대기. 실행 권한 아님.
});

const PLAN_ADDR = /^0x[0-9a-fA-F]{40}$/;
const PLAN_UINT = /^\d+$/;
const NATIVE_TOKEN = /^0x0{40}$/i;
const ERC20_APPROVE = "0x095ea7b3";
const UINT256_MAX = (1n << 256n) - 1n;
// [A-877 R2 · L1] approve 금액이 2^255 이상이면 "무제한" 으로 본다(흔한 MAX/2 류 포함).
const APPROVE_UNLIMITED_FLOOR = 1n << 255n;
const MAX_STEPS = 64;
// [A-895 P-A · N1] 허용 목록 · 목적지 기록 길이 상한. 초과 = 입력을 읽을 수 없음(거절). 멈춤만 가능한 입력을 막는다.
const MAX_ALLOWLIST = 64;
const MAX_DEST_RECORDS = 256;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isChainId = (n) => Number.isInteger(n) && n > 0;
const sameAddr = (a, b) => typeof a === "string" && typeof b === "string" && PLAN_ADDR.test(a) && PLAN_ADDR.test(b) && a.toLowerCase() === b.toLowerCase();
const isUnits = (s) => typeof s === "string" && PLAN_UINT.test(s) && BigInt(s) <= UINT256_MAX;

// ── [A-877 R2 · F2/L2] 입력 스냅샷 ─────────────────────────────────────────────
// 경계는 입력을 **한 번만** 읽는다: 자기 속성(own property)만, 값은 평범한 원시값으로 굳힌다.
// 그 뒤의 검증·게이트·계획은 전부 이 스냅샷에서만 만든다 — getter/Proxy 가 두 번째 읽기에서
// 다른 답을 주어도 판정과 계획이 갈라질 수 없다. 읽다가 던지면 `input_unreadable` 로 거절한다.
const own = (o, k) => (o !== null && typeof o === "object" && hasOwnSafe(o, k) ? o[k] : undefined);
const str = (v) => (typeof v === "string" ? v : null);
const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const prim = (v) => (typeof v === "string" || typeof v === "boolean" || num(v) !== null ? v : null);

function plainCopy(v, depth = 4) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v !== "object" || depth <= 0) return null;
  if (Array.isArray(v)) {
    const n = Math.min(Number(v.length) || 0, MAX_STEPS);
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(hasOwnSafe(v, i) ? plainCopy(v[i], depth - 1) : null);
    return out;
  }
  const out = {};
  for (const k of Object.keys(v)) out[k] = plainCopy(v[k], depth - 1);
  return out;
}

function stringList(v) {
  if (!Array.isArray(v)) return null;
  const n = Number(v.length) || 0;
  if (n > MAX_ALLOWLIST) throw new Error("input_too_large");
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const x = hasOwnSafe(v, i) ? v[i] : null;
    if (typeof x === "string") out.push(x);
  }
  return out;
}

function snapEnd(e) {
  return isObj(e) ? { chainId: int(own(e, "chainId")), token: str(own(e, "token")), decimals: int(own(e, "decimals")) } : null;
}

function snapStep(s) {
  if (!isObj(s)) return null;
  return { chainId: int(own(s, "chainId")), to: str(own(s, "to")), value: str(own(s, "value")), data: str(own(s, "data")), kind: str(own(s, "kind")) };
}

function snapQuote(q) {
  if (!isObj(q)) return null;
  const rawSteps = own(q, "steps");
  let steps = null;
  let tooMany = false;
  if (Array.isArray(rawSteps)) {
    const n = Number(rawSteps.length) || 0;
    tooMany = n > MAX_STEPS;
    steps = [];
    for (let i = 0; i < Math.min(n, MAX_STEPS); i += 1) steps.push(snapStep(hasOwnSafe(rawSteps, i) ? rawSteps[i] : null));
  }
  const tg = own(q, "topupGas");
  const sim = own(q, "simulation");
  return {
    validated: own(q, "validated") === true,
    railId: str(own(q, "railId")),
    quoteId: str(own(q, "quoteId")),
    sourceChainId: int(own(q, "sourceChainId")),
    sourceToken: str(own(q, "sourceToken")),
    sourceDecimals: int(own(q, "sourceDecimals")),
    inputAmountUnits: str(own(q, "inputAmountUnits")),
    destinationChainId: int(own(q, "destinationChainId")),
    destinationToken: str(own(q, "destinationToken")),
    destinationDecimals: int(own(q, "destinationDecimals")),
    recipient: str(own(q, "recipient")),
    expectedOutUnits: str(own(q, "expectedOutUnits")),
    minOutUnits: str(own(q, "minOutUnits")),
    timeEstimateSeconds: num(own(q, "timeEstimateSeconds")),
    priceImpactPct: num(own(q, "priceImpactPct")),
    totalEffectiveCost: str(own(q, "totalEffectiveCost")),
    topupGas: isObj(tg) ? { requested: typeof own(tg, "requested") === "boolean" ? own(tg, "requested") : null, deductedUnits: str(own(tg, "deductedUnits")) } : null,
    routeClass: str(own(q, "routeClass")),
    liquidityStatus: str(own(q, "liquidityStatus")),
    receivedAtMs: num(own(q, "receivedAtMs")),
    expiresAtMs: num(own(q, "expiresAtMs")),
    simulation: isObj(sim) ? { status: str(own(sim, "status")), postconditions: plainCopy(own(sim, "postconditions")) } : null,
    steps,
    tooManySteps: tooMany,
  };
}

const POLICY_KEYS = ["routeClass", "assetClass", "maxPriceImpactPct", "maxSlippagePct", "quoteMaxAgeMs", "requireSimulation", "allowUnlimitedAllowance", "materialOutputDeteriorationPct"];

function snapSafety(sf) {
  const pol = own(sf, "policy");
  let policy = null;
  if (isObj(pol)) {
    policy = {};
    for (const k of POLICY_KEYS) policy[k] = prim(own(pol, k));
  }
  const recs = own(sf, "destinationRecords");
  let records;
  if (Array.isArray(recs)) {
    records = [];
    const n = Number(recs.length) || 0;
    if (n > MAX_DEST_RECORDS) throw new Error("input_too_large");
    for (let i = 0; i < n; i += 1) {
      const r = hasOwnSafe(recs, i) ? recs[i] : null;
      records.push(isObj(r) ? { address: str(own(r, "address")), source: str(own(r, "source")) } : null);
    }
  }
  const prior = own(sf, "priorReadiness");
  const priorFields = isObj(prior) ? (isObj(own(prior, "fields")) ? own(prior, "fields") : prior) : null;
  return {
    policy,
    nowMs: num(own(sf, "nowMs")),
    allowedSpenders: stringList(own(sf, "allowedSpenders")),
    allowedStepTargets: stringList(own(sf, "allowedStepTargets")),
    destinationRecords: records,
    consumedIntents: own(sf, "consumedIntents"),
    priorReadiness: priorFields ? { fields: plainCopy(priorFields) } : null,
    lifecycleState: str(own(sf, "lifecycleState")),
    intentId: str(own(sf, "intentId")),
  };
}

function snapshotInputs({ intent, binding, railQuote, safety, fundingPolicy }) {
  return {
    intent: isObj(intent) ? {
      method: str(own(intent, "method")),
      railId: str(own(intent, "railId")),
      target: str(own(intent, "target")),
      targetChain: str(own(intent, "targetChain")),
      targetAsset: str(own(intent, "targetAsset")),
      targetPiggyId: str(own(intent, "targetPiggyId")),
      requestedAmount: str(own(intent, "requestedAmount")),
    } : null,
    binding: isObj(binding) ? {
      source: snapEnd(own(binding, "source")),
      destination: snapEnd(own(binding, "destination")),
      recipient: str(own(binding, "recipient")),
      inputAmountUnits: str(own(binding, "inputAmountUnits")),
    } : null,
    quote: snapQuote(railQuote),
    safety: isObj(safety) ? snapSafety(safety) : snapSafety({}),
    gasTopupEnabled: gasTopupAllowed(fundingPolicy),
  };
}

function unitsText(units, decimals) {
  const s = units.toString().padStart(decimals + 1, "0");
  const w = s.slice(0, s.length - decimals);
  const f = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

function rejectPlan(reasons) {
  return Object.freeze({
    state: FUNDING_PLAN_STATE.REJECTED, ok: false, reasons: Object.freeze([...new Set(reasons)]),
    decision: null, safety: null, plan: null, executionAuthority: false, permissionGranted: false,
  });
}

/** 명시적 묶음 모양 검사(스냅샷). 빠진 칸은 기본값으로 채우지 않는다. */
function checkBindingShape(b) {
  if (!b) return ["binding_missing"];
  const r = [];
  const s = b.source;
  const d = b.destination;
  if (!s || !isChainId(s.chainId) || !PLAN_ADDR.test(s.token || "") || !Number.isInteger(s.decimals) || s.decimals < 0) r.push("binding_source_invalid");
  if (!d || !isChainId(d.chainId) || !PLAN_ADDR.test(d.token || "") || !Number.isInteger(d.decimals) || d.decimals < 0) r.push("binding_destination_invalid");
  if (!PLAN_ADDR.test(b.recipient || "")) r.push("binding_recipient_invalid");
  if (!isUnits(b.inputAmountUnits) || BigInt(b.inputAmountUnits) === 0n) r.push("binding_amount_invalid");
  return r;
}

/** 묶음 ↔ 충전 의도. 도착 체인/자산/받는 주소는 의도와 정확히 같아야 한다. */
function checkBindingAgainstIntent(b, intent) {
  const r = [];
  if (scopeForChainId(b.destination.chainId) !== intent.targetChain) r.push("binding_destination_chain_not_intent");
  const byChain = hasOwnSafe(FUNDING_CONTEXT_TOKEN_ALLOWLIST, intent.targetChain) ? FUNDING_CONTEXT_TOKEN_ALLOWLIST[intent.targetChain] : null;
  const allowed = byChain && hasOwnSafe(byChain, intent.targetAsset) ? byChain[intent.targetAsset] : null;
  if (!allowed || !sameAddr(b.destination.token, allowed.assetId) || b.destination.decimals !== allowed.decimals) {
    r.push("binding_destination_token_not_intent");
  }
  if (!sameAddr(b.recipient, intent.target)) r.push("binding_recipient_not_intent");
  return r;
}

/** 견적 ↔ 묶음(스냅샷끼리). 한 칸씩. 어댑터가 이미 봤어도 여기서 다시 본다(경계는 어댑터를 믿지 않는다). */
function checkQuoteAgainstBinding(q, b, intent) {
  if (!q) return ["quote_missing"];
  const r = [];
  if (q.validated !== true) r.push("quote_not_validated_by_rail");
  if (q.railId !== intent.railId) r.push("quote_rail_not_intent");
  if (!q.quoteId) r.push("quote_id_missing");
  if (q.sourceChainId !== b.source.chainId) r.push("quote_source_chain_mismatch");
  if (!sameAddr(q.sourceToken, b.source.token) || q.sourceDecimals !== b.source.decimals) r.push("quote_source_token_mismatch");
  if (q.inputAmountUnits !== b.inputAmountUnits) r.push("quote_input_amount_mismatch");
  if (q.destinationChainId !== b.destination.chainId) r.push("quote_destination_chain_mismatch");
  if (!sameAddr(q.destinationToken, b.destination.token) || q.destinationDecimals !== b.destination.decimals) r.push("quote_destination_token_mismatch");
  if (!sameAddr(q.recipient, b.recipient)) r.push("quote_recipient_mismatch");
  if (!isUnits(q.expectedOutUnits) || !isUnits(q.minOutUnits)) r.push("quote_out_invalid");
  else {
    if (BigInt(q.minOutUnits) === 0n) r.push("quote_min_out_not_positive");
    if (BigInt(q.minOutUnits) > BigInt(q.expectedOutUnits)) r.push("quote_min_out_above_out");
  }
  return r;
}

/**
 * 가스 top-up 은 명시적 미래 정책 입력(`{ gasTopup: { enabled: true } }`)이 있을 때만 허락된다.
 * 자기 속성만 읽는다(물려받은 `gasTopup` 은 정책이 아니다). 읽다가 던지면 꺼짐.
 */
export function gasTopupAllowed(fundingPolicy) {
  try {
    const g = own(fundingPolicy, "gasTopup");
    return isObj(fundingPolicy) && isObj(g) && own(g, "enabled") === true;
  } catch {
    return false;
  }
}
function checkTopup(q, enabled) {
  const t = q.topupGas;
  if (!t || typeof t.requested !== "boolean" || !isUnits(t.deductedUnits)) return ["topup_state_unreadable"];
  if (t.requested !== enabled) return [enabled ? "topup_policy_not_reflected" : "topup_not_allowed_by_policy"];
  if (!enabled && BigInt(t.deductedUnits) !== 0n) return ["topup_not_allowed_by_policy"];
  return [];
}

/** 빌드 단계는 **데이터**다(스냅샷). 모양·체인·value(합계 포함)·approve 를 묶음에 대조한다. */
function checkSteps(q, b) {
  if (q.tooManySteps) return { reasons: ["steps_too_many"], approvals: [] };
  const steps = q.steps || [];
  if (steps.length === 0) return { reasons: ["steps_missing"], approvals: [] };
  const r = [];
  const input = BigInt(b.inputAmountUnits);
  const nativeSource = NATIVE_TOKEN.test(b.source.token);
  const approvals = [];
  let valueTotal = 0n;
  for (const s of steps) {
    if (!s || s.chainId !== b.source.chainId) { r.push("step_chain_mismatch"); continue; }
    if (!PLAN_ADDR.test(s.to || "") || typeof s.data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(s.data) || s.data.length < 10) { r.push("step_malformed"); continue; }
    if (!isUnits(s.value)) { r.push("step_value_invalid"); continue; }
    const value = BigInt(s.value);
    valueTotal += value;
    if (!nativeSource && value !== 0n) r.push("step_value_nonzero");
    const selector = s.data.slice(0, 10).toLowerCase();
    if (selector === ERC20_APPROVE) {
      if (s.data.length !== 10 + 128 || !/^0{24}$/.test(s.data.slice(10, 34))) { r.push("approve_malformed"); continue; }
      const spender = "0x" + s.data.slice(34, 74);
      const amount = BigInt("0x" + s.data.slice(74));
      if (!sameAddr(s.to, b.source.token)) r.push("approve_not_on_source_token");
      if (amount >= APPROVE_UNLIMITED_FLOOR) r.push("approve_unlimited");
      if (amount > input) r.push("approve_exceeds_input");
      approvals.push({ spender, amountUnits: amount.toString(), unlimited: amount >= APPROVE_UNLIMITED_FLOOR });
    } else if (sameAddr(s.to, b.source.token)) {
      // 출발 토큰 위의 approve 아닌 호출(transfer 등) = 돈을 다른 곳으로 옮길 수 있다. 계획에 넣지 않는다.
      r.push("source_token_call_not_approve");
    }
  }
  // [A-877 R2 · F1] native 출발: 단계마다가 아니라 **모든 단계 value 의 합**이 입력 이하여야 한다.
  if (nativeSource && valueTotal > input) r.push("step_value_total_exceeds_input");
  if (approvals.length > 1) r.push("multiple_approvals");
  return { reasons: r, approvals };
}

/**
 * 레일 견적 → 검증된 충전 계획 하나(또는 거절/막힘). 순수 함수. 네트워크·서명·전송 0.
 * [A-877 R2] 입력은 맨 처음 **한 번** 스냅샷되고, 이후 모든 판단과 계획은 스냅샷에서만 나온다.
 *
 * @param {object} p
 * @param {object} p.intent          `startFunding(...).intent` — 받을 Piggy · 도착 체인/자산 · 받는 주소 · railId
 * @param {object} p.binding         { source:{chainId,token,decimals}, destination:{chainId,token,decimals}, recipient, inputAmountUnits }
 * @param {object} p.railQuote       레일 어댑터가 검증·정규화한 견적(제공자 중립 모양)
 * @param {object} p.safety          { policy, nowMs, allowedSpenders, allowedStepTargets, destinationRecords,
 *                                     consumedIntents?, priorReadiness?, lifecycleState?, intentId? }
 * @param {object} [p.fundingPolicy] `{ gasTopup:{ enabled:true } }` 만 top-up 을 허락한다. 기본(없음) = 꺼짐.
 */
export function planFundingRoute(input = {}) {
  let snap;
  try {
    const args = isObj(input) ? input : {};
    snap = snapshotInputs({
      intent: own(args, "intent"), binding: own(args, "binding"), railQuote: own(args, "railQuote"),
      safety: own(args, "safety"), fundingPolicy: own(args, "fundingPolicy"),
    });
  } catch (e) {
    // [A-895 N1] 상한 초과는 "읽을 수 없음"과 구분해 말한다(둘 다 계획 없음).
    return rejectPlan([e && e.message === "input_too_large" ? "input_too_large" : "input_unreadable"]);
  }
  const { intent, binding: b, quote: q, safety: sf } = snap;
  if (!intent || !intent.targetPiggyId || !PLAN_ADDR.test(intent.target || "") || !intent.targetChain || !intent.targetAsset || !intent.railId) {
    return rejectPlan(["intent_invalid"]);
  }
  const shape = checkBindingShape(b);
  if (shape.length) return rejectPlan(shape);
  const mismatch = [...checkBindingAgainstIntent(b, intent), ...checkQuoteAgainstBinding(q, b, intent)];
  if (mismatch.length) return rejectPlan(mismatch);
  const steps = checkSteps(q, b);
  const structural = [...checkTopup(q, snap.gasTopupEnabled), ...steps.reasons];
  if (structural.length) return rejectPlan(structural);

  // ── 실행 안전 게이트(정본 execution-safety). 계획이 READY 가 되기 **전에** 돈다. ─────────────
  const out = BigInt(q.expectedOutUnits);
  const min = BigInt(q.minOutUnits);
  const dDec = b.destination.decimals;
  const approval = steps.approvals[0] ?? null;
  const impact = q.priceImpactPct !== null && q.priceImpactPct >= 0 ? q.priceImpactPct : null;
  const intentId = sf.intentId || `${intent.targetPiggyId}:${intent.railId}:${q.quoteId}`;
  let consumed = null;
  try {
    const c = sf.consumedIntents;
    if (c !== null && c !== undefined) consumed = new Set(typeof c.has === "function" && c.has(intentId) === true ? [intentId] : []);
  } catch {
    return rejectPlan(["input_unreadable"]);
  }
  const fields = {
    intentId,
    piggyId: intent.targetPiggyId,
    action: "add_money",
    sourceChainId: q.sourceChainId,
    destinationChainId: q.destinationChainId,
    inputAsset: { address: q.sourceToken, decimals: q.sourceDecimals, identity: q.sourceToken.toLowerCase() },
    outputAsset: { address: q.destinationToken, decimals: q.destinationDecimals, identity: intent.targetAsset },
    inputAmount: q.inputAmountUnits,
    totalEffectiveCost: q.totalEffectiveCost !== null && /^\d+(\.\d+)?$/.test(q.totalEffectiveCost) ? q.totalEffectiveCost : null,
    effectiveOutput: unitsText(out, dDec),
    expectedOut: unitsText(out, dDec),
    minOut: unitsText(min, dDec),
    priceImpactPct: impact,
    // 견적이 허용하는 최대 하락 = (예상 − 최소) / 예상. 견적 숫자에서 계산한 값이다.
    slippagePct: out === 0n ? null : Number(((out - min) * 1000000n) / out) / 10000,
    quoteTimestamp: q.receivedAtMs,
    quoteExpiry: q.expiresAtMs,
    routeClass: q.routeClass,
    liquidityStatus: q.liquidityStatus,
    simulationStatus: q.simulation && q.simulation.status !== null ? q.simulation.status : "unavailable",
    simulatedPostconditions: q.simulation ? q.simulation.postconditions ?? null : null,
    expectedPostconditions: {
      recipient: b.recipient.toLowerCase(),
      destinationChainId: b.destination.chainId,
      destinationToken: b.destination.token.toLowerCase(),
      minimumArrivalUnits: q.minOutUnits,
    },
    destination: b.recipient,
    destinationIdentitySource: DESTINATION_SOURCE.PIGGY_REGISTRY,
    ...(approval ? { spender: approval.spender, allowance: approval.amountUnits, allowanceBound: b.inputAmountUnits, allowanceUnlimited: approval.unlimited } : {}),
    ...(sf.lifecycleState !== null ? { lifecycleState: sf.lifecycleState } : {}),
  };
  const expected = {
    sourceChainId: b.source.chainId,
    destinationChainId: b.destination.chainId,
    inputAsset: { address: b.source.token, decimals: b.source.decimals },
    outputAsset: { address: b.destination.token, decimals: b.destination.decimals },
    inputAmount: b.inputAmountUnits,
    destination: b.recipient,
    allowedDestinationSources: [DESTINATION_SOURCE.PIGGY_REGISTRY],
    allowedSpenders: sf.allowedSpenders ? sf.allowedSpenders.slice() : [],
  };
  const gate = evaluateDestinationBoundExecution({
    fields,
    policy: sf.policy,
    expected,
    // [L3 residual] nowMs 는 호출자 입력이다. 미래 확인/실행 호출자는 정본 시계에서 가져와야 한다.
    nowMs: sf.nowMs !== null ? sf.nowMs : Date.now(),
    consumedIntents: consumed,
    priorReadiness: sf.priorReadiness,
    destinationRecords: sf.destinationRecords,
  });

  // 빌드 단계의 호출 대상은 **명시된 목록**에 있어야 한다. 목록이 없으면 모름 = READY 아님.
  // (출발 토큰 위의 approve 는 대상이 출발 토큰 자신이고, spender 는 게이트의 allowedSpenders 가 본다.)
  const extra = [];
  const targets = sf.allowedStepTargets;
  if (!targets || targets.length === 0) extra.push({ decision: DECISION.UNKNOWN, code: "step_targets_unverified" });
  else {
    for (const s of q.steps) {
      const sourceApprove = sameAddr(s.to, b.source.token) && s.data.slice(0, 10).toLowerCase() === ERC20_APPROVE;
      if (!sourceApprove && !targets.some((t) => sameAddr(t, s.to))) extra.push({ decision: DECISION.NAH, code: "step_target_not_allowed" });
    }
  }

  const ready = gate.decision === DECISION.DO && extra.length === 0;
  const anyNah = gate.decision === DECISION.NAH || extra.some((e) => e.decision === DECISION.NAH);
  const decision = ready ? DECISION.DO : anyNah ? DECISION.NAH : gate.decision === DECISION.DO ? DECISION.UNKNOWN : gate.decision;
  const safetyOut = Object.freeze({
    decision,
    gateDecision: gate.decision,
    reasons: Object.freeze([...new Set([...gate.reasons, ...extra.map((e) => e.code)])]),
    gate,
  });
  if (!ready) {
    return Object.freeze({
      state: FUNDING_PLAN_STATE.BLOCKED, ok: false, reasons: safetyOut.reasons, decision,
      safety: safetyOut, plan: null, executionAuthority: false, permissionGranted: false,
    });
  }

  const planKey = [
    intent.railId, q.quoteId, intent.targetPiggyId,
    b.source.chainId, b.source.token.toLowerCase(), b.inputAmountUnits,
    b.destination.chainId, b.destination.token.toLowerCase(), b.recipient.toLowerCase(), q.minOutUnits,
  ].join("|");
  const plan = Object.freeze({
    kind: "funding_plan",
    version: 1,
    railId: intent.railId,
    quoteId: q.quoteId,
    planKey,
    intentId,
    // **실행 경계.** 이 객체는 데이터다. 보내는 함수도, 서명자도, 권한도 들어 있지 않다.
    execute: false,
    executionAuthority: false,
    permissionGranted: false,
    requiresConfirmation: true,
    intent: Object.freeze({
      method: intent.method, targetPiggyId: intent.targetPiggyId, target: intent.target,
      targetChain: intent.targetChain, targetAsset: intent.targetAsset, requestedAmount: intent.requestedAmount,
    }),
    binding: Object.freeze({
      source: Object.freeze({ ...b.source }),
      destination: Object.freeze({ ...b.destination }),
      recipient: b.recipient,
      inputAmountUnits: b.inputAmountUnits,
    }),
    arrival: Object.freeze({
      expectedUnits: q.expectedOutUnits,
      minimumUnits: q.minOutUnits,
      expected: unitsText(out, dDec),
      minimum: unitsText(min, dDec),
      timeEstimateSeconds: q.timeEstimateSeconds,
    }),
    topupGas: Object.freeze({ requested: q.topupGas.requested, deductedUnits: q.topupGas.deductedUnits }),
    quoteExpiry: q.expiresAtMs,
    steps: Object.freeze(q.steps.map((s) => Object.freeze({ chainId: s.chainId, to: s.to, value: s.value, data: s.data, kind: s.kind }))),
  });
  return Object.freeze({
    state: FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION, ok: true, reasons: Object.freeze([]), decision: DECISION.DO,
    safety: safetyOut, plan, executionAuthority: false, permissionGranted: false,
  });
}
