// [A-493 Lane A] Add money — **계약만 있고 레일은 아직 없다.**
//
// 조사 결과(이 저장소 전수): 사용자의 **바깥 돈**을 앱 잔액으로 바꾸는 코드 경로가 **하나도 없다**.
// 있는 것은 `/api/grant` 뿐인데 그건 **가스 후원**이다 — 프로젝트가 자기 돈으로 고정 0.1 MON 을
// 주소 하나당 한 번 보내 주는 것이고, 기본값은 **503 으로 닫혀 있다**.
// **그것을 Add money 라고 부르지 않는다.** 사용자가 낸 돈이 아니기 때문이다.
//
// 그래서 이 파일이 하는 일은 하나다: **계약을 정의하고, 레일이 없으면 닫는다.**
// 가짜 버튼을 만들지 않는다. 금액/자산/체인/목적지를 모르면 **열리지 않는다**.

import { findSecretLikeKey } from "./piggy-registry.js";
import { sha256Sync } from "./piggy-session.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// [A-646 phase A] 한 번의 Add money 를 **여러 Piggy 에 나눠 넣는 계획** — 모델만. 화면 0.
//
// 근거: A-645 NEXT_APP_INPUT S2·S4·S5 (바깥 → 여러 Piggy, 받는 곳마다 한 줄).
// 이 층이 하는 일: 금액↔퍼센트 계산 · 계획(plan) 만들기 · planId/planHash · 지난 나눔 기억(미리 채우기만).
// 하지 않는 일: 보내기 · 서명 · WebAuthn · tx · 레일 선택. Home 은 돈·서명자·보관을 갖지 않는다 —
// 계획은 **받는 Piggy 마다 단일 목적지 한 줄**일 뿐이고, 중간 주소·라우터·묶음 계약이 없다.
// 금액은 **정수 최소 단위 문자열**(BigInt)이다. 퍼센트는 **표시용**(basis points)이고 진실은 금액이다.
// 특정 Piggy 이름/역할을 특별 취급하지 않는다 — 모든 Piggy 는 같은 한 줄이다.

export const ALLOCATION_PLAN_VERSION = 1;
export const BPS_TOTAL = 10000;
const UNITS_RE = /^(0|[1-9]\d{0,77})$/;
const PLAN_ID_RE = /^plan_[0-9a-f]{32}$/;
const PIGGY_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;
const SCOPE_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;
// 행(row)이 가질 수 있는 필드. 주소를 **입력으로 받지 않는다** — 목적지는 레지스트리에서만 온다.
const ROW_FIELDS = Object.freeze(["piggyId", "amount"]);
const ADDRESS_LIKE_ROW_KEYS = Object.freeze(["address", "target", "destination", "to", "recipient"]);

function toUnits(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value !== "string" || !UNITS_RE.test(value)) return null;
  return BigInt(value);
}

/** 금액 → 퍼센트(bps, 표시용). 반올림은 반올림-반올림(half-up). 모르면 null. */
export function percentBpsFromAmount(amount, total) {
  const a = toUnits(amount);
  const t = toUnits(total);
  if (a === null || t === null || t === 0n || a > t) return null;
  return Number((a * BigInt(BPS_TOTAL) * 2n + t) / (2n * t));
}

/** 퍼센트(bps) → 금액(정수 최소 단위 문자열). 내림 — 남는 조각을 **조용히 어디에도 붙이지 않는다**. */
export function amountFromPercentBps(bps, total) {
  const t = toUnits(total);
  if (t === null || !Number.isInteger(bps) || bps < 0 || bps > BPS_TOTAL) return null;
  if (bps === BPS_TOTAL) return t.toString();
  return ((t * BigInt(bps)) / BigInt(BPS_TOTAL)).toString();
}

/** Σ 행 금액 vs 총액. `balanced` 가 아니면 확인(confirm)은 막힌다 — 남는 돈을 몰래 떠넘기지 않는다. */
export function allocationSum(rows, total) {
  const t = toUnits(total);
  if (t === null || t === 0n || !Array.isArray(rows)) return { ok: false, balanced: false, sum: null, remainder: null, reason: "invalid_total_or_rows" };
  let sum = 0n;
  for (const row of rows) {
    const a = toUnits(row?.amount);
    if (a === null) return { ok: false, balanced: false, sum: null, remainder: null, reason: "invalid_amount" };
    sum += a;
  }
  return { ok: true, balanced: sum === t, sum: sum.toString(), remainder: (t - sum).toString(), reason: sum === t ? null : "sum_mismatch" };
}

function randomHex16(randomBytes) {
  const bytes = new Uint8Array(16);
  if (typeof randomBytes === "function") randomBytes(bytes);
  else globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 미리보기 하나마다 새 planId. 같은 내용이라도 미리보기가 다르면 id 가 다르다. */
export function newPlanId({ randomBytes } = {}) {
  return `plan_${randomHex16(randomBytes)}`;
}

function planAsset(asset) {
  const symbol = typeof asset?.symbol === "string" ? asset.symbol.trim() : "";
  const decimals = asset?.decimals;
  if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  return { symbol, decimals };
}

// 해시 입력 — 필드 순서 고정, 다리(leg)는 piggyId 순으로 정렬. 이름은 표시용이라 넣지 않는다.
// asset 에 decimals 를 함께 묶는다: 정수 최소 단위 금액의 뜻이 decimals 에 달려 있기 때문이다.
// 주소는 소문자로 — 대소문자(체크섬 표기)만 다른 것은 같은 목적지다.
export function canonicalPlanJson(plan) {
  const legs = [...(plan?.legs || [])]
    .sort((x, y) => (x.piggyId < y.piggyId ? -1 : x.piggyId > y.piggyId ? 1 : 0))
    .map((l) => [l.piggyId, String(l.target).toLowerCase(), l.amount]);
  return JSON.stringify({
    version: plan?.version,
    chainId: plan?.chainId,
    accountId: plan?.accountId,
    asset: [plan?.asset?.symbol, plan?.asset?.decimals],
    total: plan?.total,
    legs,
  });
}

/** sha256(canonical JSON) 소문자 hex. */
export function computePlanHash(plan) {
  const digest = sha256Sync(new TextEncoder().encode(canonicalPlanJson(plan)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 계획 하나(draft). **보내지 않는다.**
 * rows = [{ piggyId, amount }] — 주소 필드가 있으면 거부한다. piggies = 레지스트리 스냅샷 행({ id, name, address }).
 * Σ ≠ total 이면 계획이 서지 않는다(`sum_mismatch`). 0 인 다리는 버린다. 다리 순서 = piggyId 순(해시와 같은 순서).
 */
export function buildAllocationPlan({ planId, chainId, accountId, asset, total, rows, piggies } = {}) {
  const bad = (reason, extra = {}) => ({ ok: false, reason, plan: null, ...extra });
  if (typeof planId !== "string" || !PLAN_ID_RE.test(planId)) return bad("invalid_plan_id");
  const chain = typeof chainId === "string" ? chainId.trim() : "";
  const account = typeof accountId === "string" ? accountId.trim() : "";
  if (!SCOPE_ID_RE.test(chain) || !SCOPE_ID_RE.test(account)) return bad("invalid_scope");
  const cleanAsset = planAsset(asset);
  if (!cleanAsset) return bad("invalid_asset");
  const t = toUnits(total);
  if (t === null || t === 0n) return bad("invalid_total");
  if (!Array.isArray(rows) || rows.length === 0) return bad("no_rows");
  if (!Array.isArray(piggies)) return bad("no_registry");

  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return bad("invalid_row");
    const keys = Object.keys(row);
    if (keys.some((k) => ADDRESS_LIKE_ROW_KEYS.includes(k))) return bad("address_input_forbidden");
    if (keys.some((k) => !ROW_FIELDS.includes(k))) return bad("unknown_row_field");
    if (typeof row.piggyId !== "string" || !PIGGY_ID_RE.test(row.piggyId)) return bad("invalid_piggy_id");
    if (seen.has(row.piggyId)) return bad("duplicate_piggy");
    seen.add(row.piggyId);
  }
  const sum = allocationSum(rows, total);
  if (!sum.ok) return bad(sum.reason);
  if (!sum.balanced) return bad("sum_mismatch", { sum: sum.sum, remainder: sum.remainder });

  const legs = [];
  for (const row of rows) {
    const units = toUnits(row.amount);
    if (units === 0n) continue; // 0 인 다리는 계획에 들어가지 않는다
    const piggy = piggies.find((p) => p && p.id === row.piggyId);
    if (!piggy) return bad("unknown_piggy");
    if (typeof piggy.address !== "string" || !ADDR.test(piggy.address)) return bad("piggy_address_missing");
    legs.push({
      piggyId: row.piggyId,
      name: typeof piggy.name === "string" ? piggy.name : "",
      target: piggy.address,
      amount: units.toString(),
    });
  }
  if (legs.length === 0) return bad("no_legs");
  legs.sort((x, y) => (x.piggyId < y.piggyId ? -1 : x.piggyId > y.piggyId ? 1 : 0));

  const plan = {
    version: ALLOCATION_PLAN_VERSION,
    planId,
    chainId: chain,
    accountId: account,
    asset: cleanAsset,
    total: t.toString(),
    state: "draft",
    approval: null,
    legs: legs.map((l) => ({
      ...l,
      state: "planned",
      idempotencyKey: `${planId}:${l.piggyId}`,
      attempts: 0,
      result: null,
      receipt: null,
      evidenceKey: null,
    })),
  };
  plan.planHash = computePlanHash(plan);
  return { ok: true, reason: null, plan };
}

/** 확인 한 번 = 이 planId + 이 planHash 하나. 권한이 아니다 — 실제 레일이 생기면 그 뒤에 Face ID/passkey 가 따로 온다. */
export function approvalForPlan(plan) {
  if (!plan || typeof plan.planId !== "string" || !PLAN_ID_RE.test(plan.planId)) return { ok: false, reason: "invalid_plan", approval: null };
  return { ok: true, reason: null, approval: { planId: plan.planId, planHash: computePlanHash(plan) } };
}

/**
 * 승인이 **지금의** 계획에 맞는가. 저장된 planHash 를 믿지 않고 **다시 계산한다**.
 * 금액·목적지·자산·체인·총액 중 하나라도 바뀌면 해시가 달라지고, 옛 승인은 거부된다.
 */
export function checkPlanApproval(plan, approval) {
  if (!plan || !approval || typeof approval !== "object") return { ok: false, reason: "no_approval" };
  if (typeof approval.planId !== "string" || approval.planId !== plan.planId) return { ok: false, reason: "plan_id_mismatch" };
  const now = computePlanHash(plan);
  if (plan.planHash !== now) return { ok: false, reason: "plan_changed" };
  if (typeof approval.planHash !== "string" || approval.planHash !== now) return { ok: false, reason: "plan_hash_mismatch" };
  return { ok: true, reason: null };
}

// ── 지난 나눔 기억 — **미리 채우기(prefill)만**. 실행·확인 생략·권한·추천 0. ────────────────
// 키 = `araso.lastSplit.<chainId>.<accountId>`. 기록 = 닫힌 필드 목록, 비밀 아님, 버전 있음.
// 담는 것 = piggyId 별 비율(bps)뿐. 주소·금액·권한·승인 필드를 담지 않는다.
// 읽다가 조금이라도 이상하면(여분 필드 · 권한 필드 · 버전 · 범위 · 비율 합) **미리 채우지 않는다**. 던지지 않는다.

export const LAST_SPLIT_VERSION = 1;
const LAST_SPLIT_PREFIX = "araso.lastSplit";
const LAST_SPLIT_FIELDS = Object.freeze(["version", "chainId", "accountId", "ratios", "updatedAt"]);
const RATIO_FIELDS = Object.freeze(["piggyId", "bps"]);

function splitScope(scope = {}) {
  const s = scope && typeof scope === "object" ? scope : {};
  const chainId = typeof s.chainId === "string" ? s.chainId.trim() : "";
  const accountId = typeof s.accountId === "string" ? s.accountId.trim() : "";
  return SCOPE_ID_RE.test(chainId) && SCOPE_ID_RE.test(accountId) ? { chainId, accountId } : null;
}

export function lastSplitKey(scope = {}) {
  const clean = splitScope(scope);
  return clean ? `${LAST_SPLIT_PREFIX}.${clean.chainId}.${clean.accountId}` : null;
}

/** 계획 → piggyId 별 bps. 최대 나머지 방식으로 합을 정확히 10000 으로 맞춘다. */
export function ratiosFromPlan(plan) {
  const t = toUnits(plan?.total);
  if (t === null || t === 0n || !Array.isArray(plan?.legs) || plan.legs.length === 0) return null;
  const parts = plan.legs.map((l) => {
    const a = toUnits(l.amount);
    const scaled = a === null ? null : a * BigInt(BPS_TOTAL);
    return { piggyId: l.piggyId, floor: scaled === null ? null : scaled / t, rem: scaled === null ? null : scaled % t };
  });
  if (parts.some((p) => p.floor === null)) return null;
  let left = BigInt(BPS_TOTAL) - parts.reduce((s, p) => s + p.floor, 0n);
  const order = [...parts].sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.piggyId < y.piggyId ? -1 : 1));
  for (const p of order) {
    if (left <= 0n) break;
    p.floor += 1n;
    left -= 1n;
  }
  return parts
    .map((p) => ({ piggyId: p.piggyId, bps: Number(p.floor) }))
    .filter((r) => r.bps > 0)
    .sort((x, y) => (x.piggyId < y.piggyId ? -1 : 1));
}

function validRatios(ratios) {
  if (!Array.isArray(ratios) || ratios.length === 0) return false;
  const ids = new Set();
  let sum = 0;
  for (const r of ratios) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return false;
    if (Object.keys(r).some((k) => !RATIO_FIELDS.includes(k))) return false;
    if (typeof r.piggyId !== "string" || !PIGGY_ID_RE.test(r.piggyId) || ids.has(r.piggyId)) return false;
    if (!Number.isInteger(r.bps) || r.bps <= 0 || r.bps > BPS_TOTAL) return false;
    ids.add(r.piggyId);
    sum += r.bps;
  }
  return sum === BPS_TOTAL;
}

/**
 * 확인된 계획의 비율을 기억한다. **유효한 승인이 있을 때만** — 확인 전 초안은 기억하지 않는다.
 * 돌려주는 것 = { saved, error }. 던지지 않는다.
 */
export function saveLastSplit(storage, scope, plan, approval, { at = null } = {}) {
  const clean = splitScope(scope);
  if (!clean) return { saved: false, error: "bad_scope" };
  if (!plan || plan.chainId !== clean.chainId || plan.accountId !== clean.accountId) return { saved: false, error: "scope_mismatch" };
  if (!checkPlanApproval(plan, approval).ok) return { saved: false, error: "not_approved" };
  const ratios = ratiosFromPlan(plan);
  if (!validRatios(ratios)) return { saved: false, error: "invalid_ratios" };
  const record = {
    version: LAST_SPLIT_VERSION,
    chainId: clean.chainId,
    accountId: clean.accountId,
    ratios,
    updatedAt: typeof at === "string" && at ? at : new Date().toISOString(),
  };
  try {
    storage.setItem(lastSplitKey(clean), JSON.stringify(record));
  } catch {
    return { saved: false, error: "storage_unavailable" };
  }
  return { saved: true, error: null };
}

/** 기억 읽기. 이상하면 { ratios: null, error }. 처음 쓰는 사람 = { ratios: null, error: null } (기본값 없음). */
export function loadLastSplit(storage, scope = {}) {
  const clean = splitScope(scope);
  if (!clean) return { ratios: null, error: "bad_scope" };
  let raw = null;
  try {
    raw = storage ? storage.getItem(lastSplitKey(clean)) : null;
  } catch {
    return { ratios: null, error: "storage_unavailable" };
  }
  if (raw === null || raw === undefined) return { ratios: null, error: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ratios: null, error: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ratios: null, error: "corrupt" };
  if (findSecretLikeKey(parsed)) return { ratios: null, error: "secret_like_field" };
  if (Object.keys(parsed).some((k) => !LAST_SPLIT_FIELDS.includes(k))) return { ratios: null, error: "unknown_field" };
  if (parsed.version !== LAST_SPLIT_VERSION) return { ratios: null, error: "version_mismatch" };
  if (parsed.chainId !== clean.chainId || parsed.accountId !== clean.accountId) return { ratios: null, error: "scope_mismatch" };
  if (!validRatios(parsed.ratios)) return { ratios: null, error: "invalid_ratios" };
  return { ratios: parsed.ratios.map((r) => ({ piggyId: r.piggyId, bps: r.bps })), error: null };
}

/**
 * 기억 → 미리보기 칸의 **숫자만**. 지금 있는 Piggy 마다 한 줄(기억에 없으면 "0").
 * 사라진 Piggy 는 그 다리가 빠진다(`dropped`). 그래서 Σ 가 총액과 다르면 확인은 막힌 채로 남는다 —
 * 빠진 몫을 다른 Piggy 에 몰래 얹지 않는다. 실행하지 않는다(`executes: false`). 추천 표시 없음.
 */
export function prefillFromLastSplit(ratios, piggies, total) {
  const t = toUnits(total);
  if (!validRatios(ratios) || !Array.isArray(piggies) || t === null || t === 0n) return { rows: null, dropped: [], executes: false };
  const present = piggies.filter((p) => p && typeof p.id === "string");
  const ids = new Set(present.map((p) => p.id));
  const dropped = ratios.filter((r) => !ids.has(r.piggyId)).map((r) => r.piggyId);
  // 모두 있으면 최대 나머지로 Σ = total 을 정확히 맞춘다. 하나라도 빠지면 빠진 채로 둔다.
  const kept = ratios.filter((r) => ids.has(r.piggyId));
  const parts = kept.map((r) => {
    const scaled = t * BigInt(r.bps);
    return { piggyId: r.piggyId, floor: scaled / BigInt(BPS_TOTAL), rem: scaled % BigInt(BPS_TOTAL) };
  });
  if (dropped.length === 0) {
    let left = t - parts.reduce((s, p) => s + p.floor, 0n);
    const order = [...parts].sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.piggyId < y.piggyId ? -1 : 1));
    for (const p of order) {
      if (left <= 0n) break;
      p.floor += 1n;
      left -= 1n;
    }
  }
  const byId = new Map(parts.map((p) => [p.piggyId, p.floor.toString()]));
  const rows = present.map((p) => ({ piggyId: p.id, amount: byId.get(p.id) ?? "0" }));
  return { rows, dropped, executes: false };
}
