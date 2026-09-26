// [A-484 Lane B] Third Journey 를 위한 **최소** 다중 Piggy 레지스트리.
//
// 이것은 **투영(projection)이지 금융 진실이 아니다.** 잔액의 진실은 온체인에 있고,
// 여기 있는 것은 화면과 이력을 위한 정체성·상태·마지막으로 읽은 값이다.
//
// 저장하지 않는 것(계약): 개인키 · PRF 출력 · passkey 비밀 · 세션 승인 토큰.
// 그런 냄새가 나는 필드는 **거부한다**(조용히 지우는 게 아니라 저장 자체를 거부).
//
// 기존 `second-journey-state.js` 의 scope/버전/fail-closed 패턴을 그대로 따른다.

import { normalizeLocator } from "./piggy-session.js";

const REGISTRY_VERSION = 1;
const REGISTRY_PREFIX = "araso.piggyRegistry";

// 위치 상태. 'unknown' 은 실패가 아니라 **아직 모른다**는 정직한 값이다.
export const PIGGY_LOCATION = Object.freeze({
  HOME: "home",
  AWAY: "away",
  PENDING: "pending",
  UNKNOWN: "unknown",
});
const LOCATIONS = Object.freeze(Object.values(PIGGY_LOCATION));

// 비밀값으로 의심되는 키 이름. 하나라도 있으면 그 레코드는 저장되지 않는다.
const SECRET_LIKE = Object.freeze([
  "privatekey", "private_key", "prf", "prfoutput", "secret", "seed", "mnemonic",
  "passkeysecret", "credentialsecret", "sessionkey", "sessionsecret", "authorization",
  "signingkey", "keymaterial",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanScope(scope = {}) {
  return {
    accountId: typeof scope.accountId === "string" ? scope.accountId.trim() : "",
    chainId: typeof scope.chainId === "string" ? scope.chainId.trim() : "",
  };
}

export function piggyRegistryKey(scope = {}) {
  const clean = cleanScope(scope);
  return `${REGISTRY_PREFIX}.${clean.chainId}.${clean.accountId}`;
}

// 비밀값 탐지는 **깊이 전체**를 본다 — 중첩 객체에 숨겨도 걸린다.
function findSecretLikeKey(value, depth = 0) {
  if (depth > 6 || !isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_LIKE.includes(key.toLowerCase().replace(/[^a-z_]/g, ""))) return key;
    const nested = findSecretLikeKey(child, depth + 1);
    if (nested) return nested;
  }
  return null;
}

// 자산 한 줄. **수량은 문자열**로 둔다 — 부동소수로 금액을 뭉개지 않기 위해서다.
function normalizeAsset(input) {
  if (!isPlainObject(input)) return null;
  const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  const quantity = typeof input.quantity === "string" ? input.quantity.trim() : "";
  if (!symbol || !quantity || !/^\d+(\.\d+)?$/.test(quantity)) return null;
  const decimals = Number.isInteger(input.decimals) && input.decimals >= 0 && input.decimals <= 36 ? input.decimals : null;
  if (decimals === null) return null;
  const assetId = typeof input.assetId === "string" && input.assetId.trim() !== "" ? input.assetId.trim() : null;
  const sourceTimestamp = typeof input.sourceTimestamp === "string" && input.sourceTimestamp.trim() !== "" ? input.sourceTimestamp.trim() : null;
  if (!sourceTimestamp) return null; // 언제 읽은 값인지 모르면 투영으로 쓰지 않는다
  // [A-553 Lane C] 측정된 온체인 잔액 한 줄임을 나타내는 선택 필드 — 있으면 그대로 지나간다
  // (additive, REGISTRY_VERSION 은 그대로 1). 없던 자리는 예전처럼 비어 있다.
  const source = typeof input.source === "string" && input.source.trim() !== "" ? input.source.trim() : null;
  const blockNumber = typeof input.blockNumber === "string" && input.blockNumber.trim() !== "" ? input.blockNumber.trim() : null;
  return {
    assetId, symbol, quantity, decimals, sourceTimestamp,
    ...(source ? { source } : {}),
    ...(blockNumber ? { blockNumber } : {}),
  };
}

// USD 평가는 **원천과 시각이 둘 다 있을 때만** 만들어진다.
// 스테이블이라고 $1 로 가정하지 않는다 — 그런 요청이 와도 거부한다.
function normalizeValuation(input) {
  if (!isPlainObject(input)) return null;
  const usd = typeof input.usd === "string" ? input.usd.trim() : "";
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const at = typeof input.at === "string" ? input.at.trim() : "";
  if (!usd || !source || !at) return null;
  if (!/^\d+(\.\d+)?$/.test(usd)) return null;
  return { usd, source, at };
}

export function normalizePiggy(input) {
  if (!isPlainObject(input)) return { piggy: null, error: "invalid_piggy" };
  const secret = findSecretLikeKey(input);
  if (secret) return { piggy: null, error: `secret_like_field:${secret}` };

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) return { piggy: null, error: "missing_id" };
  const name = typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim() : null;
  const location = LOCATIONS.includes(input.location) ? input.location : PIGGY_LOCATION.UNKNOWN;
  // 주소는 공개값이므로 담아도 되지만, 형식이 맞을 때만 담는다.
  const address = typeof input.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(input.address.trim())
    ? input.address.trim()
    : null;
  const assets = Array.isArray(input.assets)
    ? input.assets.map(normalizeAsset).filter(Boolean)
    : [];
  const valuation = normalizeValuation(input.valuation);
  const createdAt = typeof input.createdAt === "string" && input.createdAt.trim() !== "" ? input.createdAt.trim() : null;
  // [A-512] 다시 열 때 필요한 **비밀 아닌** 위치 정보(credentialId · transports · prfSalt).
  // 형식이 틀리면 **담지 않는다** — 틀린 locator 로 다른 패스키를 묻는 일을 만들지 않는다.
  const locator = input.locator ? normalizeLocator(input.locator).locator : null;
  return {
    piggy: {
      id, name, address, location, assets, valuation, createdAt,
      ...(locator ? { locator } : {}),
      // 이력은 piggyId 로 묶는다 — 레코드가 이력을 품지 않는다(교차 오염 방지).
      historyKey: `${REGISTRY_PREFIX}.history.${id}`,
    },
    error: null,
  };
}

export function createRegistry(scope = {}) {
  const clean = cleanScope(scope);
  return {
    version: REGISTRY_VERSION,
    accountId: clean.accountId,
    chainId: clean.chainId,
    piggies: [],
  };
}

export function normalizeRegistry(input, scope = {}) {
  const clean = cleanScope(scope);
  if (!isPlainObject(input)) return { registry: createRegistry(clean), error: "invalid_registry" };
  if (input.version !== REGISTRY_VERSION) return { registry: createRegistry(clean), error: "version_mismatch" };
  if (clean.accountId && input.accountId !== clean.accountId) return { registry: createRegistry(clean), error: "account_mismatch" };
  if (clean.chainId && input.chainId !== clean.chainId) return { registry: createRegistry(clean), error: "chain_mismatch" };
  const rows = Array.isArray(input.piggies) ? input.piggies : [];
  const seen = new Set();
  const piggies = [];
  for (const row of rows) {
    const { piggy, error } = normalizePiggy(row);
    if (error || !piggy) continue;          // 나쁜 줄 하나가 전체를 무너뜨리지 않는다
    if (seen.has(piggy.id)) continue;       // id 중복은 뒤엣것을 버린다(덮어쓰기 방지)
    seen.add(piggy.id);
    piggies.push(piggy);
  }
  return { registry: { version: REGISTRY_VERSION, accountId: input.accountId, chainId: input.chainId, piggies }, error: null };
}

export function saveRegistry(storage, scope, registry) {
  if (!storage) return { saved: false, error: "no_storage" };
  const clean = cleanScope(scope);
  if (!clean.accountId || !clean.chainId) return { saved: false, error: "invalid_scope" };
  const candidate = { ...registry, version: REGISTRY_VERSION, accountId: clean.accountId, chainId: clean.chainId };
  // 저장 전에 비밀값을 다시 훑는다 — 한 줄이라도 걸리면 **전부 거부**한다.
  for (const row of candidate.piggies || []) {
    const secret = findSecretLikeKey(row);
    if (secret) return { saved: false, error: `secret_like_field:${secret}` };
  }
  const { registry: normalized, error } = normalizeRegistry(candidate, clean);
  if (error) return { saved: false, error };
  try {
    storage.setItem(piggyRegistryKey(clean), JSON.stringify(normalized));
    return { saved: true, error: null };
  } catch {
    return { saved: false, error: "storage_write_failed" };
  }
}

export function loadRegistry(storage, scope = {}) {
  const clean = cleanScope(scope);
  if (!storage) return { registry: createRegistry(clean), error: "no_storage" };
  let raw = null;
  try {
    raw = storage.getItem(piggyRegistryKey(clean));
  } catch {
    return { registry: createRegistry(clean), error: "storage_read_failed" };
  }
  if (!raw) return { registry: createRegistry(clean), error: "absent" };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 손상된 값은 **버리되 조용히 잔액을 지어내지 않는다** — 빈 레지스트리로 fail-closed.
    return { registry: createRegistry(clean), error: "corrupt" };
  }
  return normalizeRegistry(parsed, clean);
}

export function clearRegistry(storage, scope = {}) {
  if (!storage) return { cleared: false };
  try {
    storage.removeItem(piggyRegistryKey(cleanScope(scope)));
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

// [A-484] 한 마리 Piggy 시절 사용자를 잃지 않기 위한 이주.
// 기존 저장값(주소·이름)만 읽어 **결정적인 기본 정체성 한 마리**를 만든다.
// 잔액을 지어내지 않는다 — assets 는 비어 있고 위치는 unknown 이다.
export function migrateSinglePiggy({ address = "", name = "", createdAt = null } = {}) {
  const addr = typeof address === "string" ? address.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return { piggy: null, error: "no_legacy_identity" };
  const { piggy, error } = normalizePiggy({
    id: `legacy-${addr.toLowerCase()}`,   // 같은 주소면 항상 같은 id — 결정적이다
    name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
    address: addr,
    location: PIGGY_LOCATION.UNKNOWN,
    assets: [],
    createdAt,
  });
  return { piggy, error };
}

// 화면용 합계. **모든 Piggy 의 평가가 알려져 있을 때만** 숫자를 만든다.
// 하나라도 모르면 합계를 **만들지 않는다**(가짜 총액 금지).
// [A-510 Stream C] **$0 은 모름이 아니다.** 평가가 `usd:"0"` 인 Piggy 는 알려진 0 이고
// 합계에 0 으로 들어간다 — 다른 Piggy 의 합계를 숨기지 않는다.
// 합계는 Piggy 총액을 **한 번씩만** 더한다. `at home`/`working with` 은 그 총액 안의 상태라 따로 더하지 않는다.
export function isKnownZeroValuation(valuation) {
  return !!valuation && typeof valuation.usd === "string" && /^0+(\.0+)?$/.test(valuation.usd);
}

export function projectRegistryTotals(registry) {
  const piggies = Array.isArray(registry?.piggies) ? registry.piggies : [];
  const withValuation = piggies.filter((p) => p.valuation);
  const complete = piggies.length > 0 && withValuation.length === piggies.length;
  if (!complete) {
    return {
      totalUsd: null,
      reason: piggies.length === 0 ? "no_piggies" : "incomplete_valuation",
      unknownCount: piggies.length - withValuation.length,
      perPiggy: piggies,
    };
  }
  const sum = withValuation.reduce((acc, p) => acc + Number(p.valuation.usd), 0);
  if (!Number.isFinite(sum)) return { totalUsd: null, reason: "invalid_valuation", unknownCount: 0, perPiggy: piggies };
  const sources = [...new Set(withValuation.map((p) => p.valuation.source))];
  const oldest = withValuation.map((p) => p.valuation.at).sort()[0];
  return {
    totalUsd: sum.toFixed(2), reason: null, unknownCount: 0,
    knownZeroCount: withValuation.filter((p) => isKnownZeroValuation(p.valuation)).length,
    valuationSources: sources, valuationOldestAt: oldest, perPiggy: piggies,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [A-510 Stream A] `+ Piggy` = **탄생만.** 돈을 떼어 오지 않는다(A-508: Birth ≠ Funding ≠ Job Permission).
//
// 이력: A-485 의 `applyMoneyAction`(CREATE/GIVE/BRING_SOME/BRING_ALL)은 **Home 이 따로 돈을 가진다**는
// 옛 모델의 투영 계산이었다. 그 제품 의미는 A-508 에서 역사가 됐고 여기서 걷어냈다.
// 증거(A-485/A-486 fork PASS)는 receipt 에 그대로 남아 있다.
// 남긴 원시동작: 정확한 정수 단위 환산 · 실패 시 무변경 · 중복 방지 키.
// ─────────────────────────────────────────────────────────────────────────────

export const PIGGY_BIRTH_ACTION = "create_piggy";

// 수량은 문자열이다. 소수 자릿수를 잃지 않으려고 **정수 단위(BigInt)로 환산**해 다룬다.
// 표현할 수 없는 정밀도는 **거부**한다(조용한 반올림 0).
export function quantityToUnits(quantity, decimals) {
  if (typeof quantity !== "string" || !/^\d+(\.\d+)?$/.test(quantity)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const [whole, frac = ""] = quantity.split(".");
  if (frac.length > decimals) return null;
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function unitsToQuantity(units, decimals) {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function birthError(reason) {
  return { ok: false, reason, piggy: null, piggies: null, receipt: null };
}

/**
 * 새 Piggy 하나. **자금 없이** 태어나고, 그래서 평가는 **알려진 $0** 이다.
 * 실패하면 **아무것도 바뀌지 않는다**. 용도/유형을 묻지 않는다.
 * 실제 잔액을 읽으면 그 값이 이 탄생 투영을 대신한다.
 */
export function createPiggy({ piggies = [], newPiggy = null, at = null } = {}) {
  const rows = Array.isArray(piggies) ? piggies.map((p) => ({ ...p, assets: [...(p.assets || [])] })) : [];
  const id = typeof newPiggy?.id === "string" ? newPiggy.id.trim() : "";
  if (!id) return birthError("missing_new_piggy_id");
  if (rows.some((p) => p.id === id)) return birthError("duplicate_piggy_id");
  const stamp = typeof at === "string" && at.trim() !== "" ? at.trim() : null;
  if (!stamp) return birthError("missing_time");
  const { piggy, error } = normalizePiggy({
    id,
    name: newPiggy?.name ?? null,
    address: newPiggy?.address ?? null,
    locator: newPiggy?.locator ?? null,
    location: PIGGY_LOCATION.HOME,
    assets: [],
    valuation: { usd: "0", source: "birth_unfunded", at: stamp },
    createdAt: newPiggy?.createdAt ?? stamp,
  });
  if (error) return birthError(error);
  rows.push(piggy);
  return {
    ok: true, reason: null, piggy, piggies: rows,
    receipt: { action: PIGGY_BIRTH_ACTION, piggyId: piggy.id, funded: false, at: stamp },
  };
}

/** 같은 행동이 두 번 들어와도 두 번 움직이지 않게 하는 키. */
export function moneyActionKey({ action, targetPiggyId, amount, asset, at }) {
  return [action, targetPiggyId || "", amount || "", asset || "", at || ""].join("|");
}
