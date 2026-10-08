// [A-499 Lane S] 실행 안전 런타임 게이트 — A-497 정본(`WEB3_EXECUTION_SAFETY_20260921.md`)의 코드판.
//
// 이 파일이 **하는 것**: 이미 정규화된 §3 필드 묶음을 받아 `DO / ASK / NAH / UNKNOWN` 하나를 돌려준다.
// 이 파일이 **하지 않는 것**:
//  · 네트워크를 부르지 않는다. 견적도, RPC 도, 제공자 SDK 도 없다. 순수 함수뿐이다.
//  · **제공자를 고르지 않는다.** Relay·LI.FI·Across·CCTP 어느 이름도 분기 조건이 아니다.
//  · **보편 임계값을 갖지 않는다.** 슬리피지·가격영향·견적 수명은 전부 `policy` 인자로 들어온다.
//    정책이 없으면 임계값을 지어내지 않고 `UNKNOWN` 으로 멈춘다(§7 "보편 임계값은 지금 만들지 않는다").
//  · **"안전" 이라고 말하지 않는다.** 점수도 만들지 않는다. 말할 수 있는 건
//    "현재 게이트를 통과했다(DO)" · "물어본다(ASK)" · "막혔다(NAH)" · "모른다(UNKNOWN)" 뿐이다(§14).
//
// UNKNOWN 과 NAH 는 다르다 — 하나는 "모른다", 하나는 "안다, 그래서 안 한다"(§1). 둘 다 행동은 0 이다.

export const DECISION = Object.freeze({
  DO: "DO",
  ASK: "ASK",
  NAH: "NAH",
  UNKNOWN: "UNKNOWN",
});

// 경로 분류(§8). 섞지 않는다 — swap 류인지 아닌지가 필수 필드 집합을 바꾼다.
export const ROUTE_CLASS = Object.freeze({
  ISSUER_NATIVE: "issuer_native",
  TOKEN_BRIDGE: "token_bridge",
  INTENT_LIQUIDITY: "intent_liquidity",
  AGGREGATOR: "aggregator",
  SAME_CHAIN_SWAP: "same_chain_swap",
});

// 출력이 견적으로 정해지는 경로 = `expectedOut` + `minOut` 없이는 실행 금지(§7).
const SWAP_LIKE = new Set([
  ROUTE_CLASS.SAME_CHAIN_SWAP,
  ROUTE_CLASS.AGGREGATOR,
  ROUTE_CLASS.INTENT_LIQUIDITY,
]);

// 제공자 오류는 **일반 클래스로만** 정규화한다. 제공자 이름이 화면에 나가지 않는다(§17-6).
export const ERROR_CLASS = Object.freeze({
  INSUFFICIENT_LIQUIDITY: "insufficient_liquidity",
  HIGH_PRICE_IMPACT: "high_price_impact",
  NO_ROUTE: "no_route",
  INVALID_SLIPPAGE: "invalid_slippage",
  COMPLIANCE_BLOCKED: "compliance_blocked",
  DESTINATION_TX_FAILED: "destination_tx_failed",
  PERMIT_FAILED: "permit_failed",
  UNCLASSIFIED: "unclassified",
});

// 클래스 → 결정. 제재/컴플라이언스는 **정책을 느슨하게 해서 통과시키지 않는다**(§2-18).
const ERROR_DECISION = Object.freeze({
  [ERROR_CLASS.INSUFFICIENT_LIQUIDITY]: DECISION.NAH,
  [ERROR_CLASS.HIGH_PRICE_IMPACT]: DECISION.NAH,
  [ERROR_CLASS.NO_ROUTE]: DECISION.NAH,
  [ERROR_CLASS.INVALID_SLIPPAGE]: DECISION.NAH,
  [ERROR_CLASS.COMPLIANCE_BLOCKED]: DECISION.NAH,
  [ERROR_CLASS.DESTINATION_TX_FAILED]: DECISION.NAH,
  [ERROR_CLASS.PERMIT_FAILED]: DECISION.NAH,
  // 분류되지 않은 오류는 **아는 척하지 않는다** — 모름이다(§0 UNKNOWN).
  [ERROR_CLASS.UNCLASSIFIED]: DECISION.UNKNOWN,
});

// 제공자별 문자열이 아니라 **뜻**으로 잡는다. 새 제공자가 와도 표를 고치지 않게.
const ERROR_PATTERNS = [
  [/insufficient[_\s-]*liquidity|not[_\s-]*enough[_\s-]*liquidity/i, ERROR_CLASS.INSUFFICIENT_LIQUIDITY],
  [/impact[_\s-]*too[_\s-]*high|high[_\s-]*price[_\s-]*impact|price[_\s-]*impact[_\s-]*exceed/i, ERROR_CLASS.HIGH_PRICE_IMPACT],
  [/no[_\s-]*(route|quote|path)|route[_\s-]*not[_\s-]*found|unsupported[_\s-]*route/i, ERROR_CLASS.NO_ROUTE],
  [/invalid[_\s-]*slippage|slippage[_\s-]*tolerance/i, ERROR_CLASS.INVALID_SLIPPAGE],
  [/sanction|blocked[_\s-]*address|compliance|ofac|restricted[_\s-]*(address|currency|jurisdiction)/i, ERROR_CLASS.COMPLIANCE_BLOCKED],
  [/destination[_\s-]*(tx|transaction)[_\s-]*(fail|revert)|fill[_\s-]*fail/i, ERROR_CLASS.DESTINATION_TX_FAILED],
  [/permit[_\s-]*(fail|invalid|expired)|signature[_\s-]*(invalid|expired)/i, ERROR_CLASS.PERMIT_FAILED],
];

/**
 * 제공자 오류를 **일반 클래스**로 정규화한다. 원문은 내부 증거로만 보존하고
 * 화면 문구는 클래스에서만 나온다 — 제공자 전용 UI 를 만들지 않는다.
 */
export function normalizeProviderError(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = typeof raw === "string" ? raw : [raw.code, raw.message, raw.reason].filter(Boolean).join(" ");
  if (!text.trim()) return { class: ERROR_CLASS.UNCLASSIFIED, decision: DECISION.UNKNOWN, evidence: raw };
  for (const [pattern, cls] of ERROR_PATTERNS) {
    if (pattern.test(text)) return { class: cls, decision: ERROR_DECISION[cls], evidence: raw };
  }
  return { class: ERROR_CLASS.UNCLASSIFIED, decision: DECISION.UNKNOWN, evidence: raw };
}

// ── 정책 ────────────────────────────────────────────────────────────────────────
// 정책은 **경로/자산군마다 명시적으로 주어진다.** 기본값을 여기 두면 그 순간
// "제공자 기본값이 초보자 정책이 되는" 실패가 된다(§7, LI.FI maxPriceImpact 10%).
const REQUIRED_POLICY_FIELDS = [
  "routeClass",
  "assetClass",
  "maxPriceImpactPct",
  "maxSlippagePct",
  "quoteMaxAgeMs",
  "requireSimulation",
  "allowUnlimitedAllowance",
  "materialOutputDeteriorationPct",
];

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") return { ok: false, missing: REQUIRED_POLICY_FIELDS.slice() };
  const missing = REQUIRED_POLICY_FIELDS.filter((k) => policy[k] === undefined || policy[k] === null);
  const bad = [];
  for (const k of ["maxPriceImpactPct", "maxSlippagePct", "quoteMaxAgeMs", "materialOutputDeteriorationPct"]) {
    if (policy[k] !== undefined && policy[k] !== null && !(typeof policy[k] === "number" && Number.isFinite(policy[k]) && policy[k] >= 0)) bad.push(k);
  }
  return { ok: missing.length === 0 && bad.length === 0, missing, invalid: bad };
}

// ── 필수 필드(§3) ───────────────────────────────────────────────────────────────
const BASE_MATERIAL_FIELDS = [
  "intentId", "piggyId", "action",
  "sourceChainId", "destinationChainId",
  "inputAsset", "outputAsset", "inputAmount",
  "totalEffectiveCost", "effectiveOutput",
  "quoteTimestamp", "quoteExpiry",
  "routeClass", "liquidityStatus",
  "simulationStatus", "expectedPostconditions",
  "destination", "destinationIdentitySource",
];

const SWAP_MATERIAL_FIELDS = ["expectedOut", "minOut", "priceImpactPct", "slippagePct"];

function present(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "number" && !Number.isFinite(v)) return false;
  return true;
}

function assetComplete(a) {
  return !!a && present(a.address) && present(a.decimals) && present(a.identity ?? a.symbol);
}

/** 이 필드 묶음에서 **비어 있는 필수 칸**을 센다. 빈칸 = UNKNOWN = 행동 0(§3). */
export function missingMaterialFields(fields = {}) {
  const required = BASE_MATERIAL_FIELDS.slice();
  if (SWAP_LIKE.has(fields.routeClass)) required.push(...SWAP_MATERIAL_FIELDS);
  const missing = [];
  for (const key of required) {
    if (key === "inputAsset" || key === "outputAsset") {
      if (!assetComplete(fields[key])) missing.push(key);
      continue;
    }
    if (!present(fields[key])) missing.push(key);
  }
  // 목적지에서 tx 가 필요하다고 했으면 **가스 요구/대납 주체**는 필수다(§2-12).
  if (fields.destinationTxRequired === true && !present(fields.destinationGasCostOrRequirement)) {
    missing.push("destinationGasCostOrRequirement");
  }
  return missing;
}

const sameAddress = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.length === b.length && a.toLowerCase() === b.toLowerCase();

// ── 결정 누적기 ─────────────────────────────────────────────────────────────────
// 가장 무거운 결정이 이긴다. **ASK 가 NAH 를 덮지 못하고, 어떤 것도 UNKNOWN 을 DO 로 못 만든다.**
const RANK = { [DECISION.DO]: 0, [DECISION.ASK]: 1, [DECISION.UNKNOWN]: 2, [DECISION.NAH]: 3 };

function makeGate() {
  const findings = [];
  let decision = DECISION.DO;
  return {
    add(next, code, detail) {
      findings.push({ decision: next, code, detail: detail ?? null });
      if (RANK[next] > RANK[decision]) decision = next;
    },
    result(extra = {}) {
      const blocked = decision !== DECISION.DO;
      return Object.freeze({
        decision,
        // **행동 0**: DO 가 아니면 어떤 수량도 나가지 않는다.
        action: decision === DECISION.DO ? 1 : 0,
        // 실행 준비 상태는 게이트가 통과했을 때만 생긴다. READY ≠ 승인 — 권한 봉투는 별도다.
        executionReady: decision === DECISION.DO,
        reasons: findings.filter((f) => f.decision !== DECISION.DO).map((f) => f.code),
        findings: Object.freeze(findings.map((f) => Object.freeze(f))),
        blocked,
        ...extra,
      });
    },
  };
}

/**
 * 실행 직전 게이트. **이 함수 하나가 §15 표 전체를 본다.**
 *
 * @param {object} p
 * @param {object} p.fields    A-497 §3 정규화 필드. 이 함수는 이 값을 **받기만** 한다.
 * @param {object} p.policy    경로/자산군별 **명시 정책**. 없으면 UNKNOWN.
 * @param {object} p.expected  정본 기대값 — chain/token/destination/spender 출처.
 * @param {number} p.nowMs
 * @param {Set}    p.consumedIntents  이미 실행 준비/소비된 intentId (재생 차단).
 * @param {object} p.priorReadiness   이전에 통과한 게이트 결과(있으면 변동 대조).
 */
export function evaluateExecution({
  fields = {},
  policy = null,
  expected = {},
  nowMs = Date.now(),
  consumedIntents = null,
  priorReadiness = null,
  providerError = null,
} = {}) {
  const gate = makeGate();

  // 0) 정책이 없으면 임계값을 지어내지 않는다. 멈춘다.
  const pol = validatePolicy(policy);
  if (!pol.ok) {
    gate.add(DECISION.UNKNOWN, "policy_missing", { missing: pol.missing, invalid: pol.invalid });
    return gate.result({ missingFields: [], errorClass: null });
  }
  // 정책은 **이 경로**의 것이어야 한다. 다른 경로의 정책을 끌어오지 않는다.
  if (present(fields.routeClass) && policy.routeClass !== fields.routeClass) {
    gate.add(DECISION.UNKNOWN, "policy_route_class_mismatch", { policy: policy.routeClass, route: fields.routeClass });
  }

  // 1) 재생/중복 — 같은 intent 로 두 번 준비되지 않는다(§2-16, §15-20).
  if (consumedIntents && present(fields.intentId) && consumedIntents.has(fields.intentId)) {
    gate.add(DECISION.NAH, "replay_intent_already_used", { intentId: fields.intentId });
  }

  // 2) 제공자 오류가 있으면 그걸로 끝난다 — 정책을 느슨하게 해서 경로를 만들지 않는다.
  const err = normalizeProviderError(providerError);
  if (err) gate.add(err.decision, `provider_${err.class}`, { evidence: err.evidence });

  // 3) 빈칸 = UNKNOWN. 여기서 멈춰야 아래 검사들이 없는 값을 "통과" 시키지 않는다.
  const missing = missingMaterialFields(fields);
  if (missing.length > 0) {
    gate.add(DECISION.UNKNOWN, "missing_material_fields", { missing });
    return gate.result({ missingFields: missing, errorClass: err?.class ?? null });
  }

  // 4) 체인 — testnet 값을 mainnet 에 쓰지 않는다(§2-2).
  if (present(expected.sourceChainId) && fields.sourceChainId !== expected.sourceChainId) {
    gate.add(DECISION.NAH, "wrong_source_chain", { got: fields.sourceChainId, want: expected.sourceChainId });
  }
  if (present(expected.destinationChainId) && fields.destinationChainId !== expected.destinationChainId) {
    gate.add(DECISION.NAH, "wrong_destination_chain", { got: fields.destinationChainId, want: expected.destinationChainId });
  }

  // 5) 토큰 정체성 — **심볼은 증거가 아니다. 주소가 증거다**(§4). 같은 심볼 다른 주소 = 거절.
  if (expected.inputAsset) {
    if (!sameAddress(fields.inputAsset.address, expected.inputAsset.address)) {
      gate.add(DECISION.NAH, "input_asset_address_mismatch", {
        got: fields.inputAsset.address, want: expected.inputAsset.address,
        sameSymbol: (fields.inputAsset.symbol ?? null) === (expected.inputAsset.symbol ?? null),
      });
    } else if (present(expected.inputAsset.decimals) && fields.inputAsset.decimals !== expected.inputAsset.decimals) {
      gate.add(DECISION.NAH, "input_asset_decimals_mismatch", { got: fields.inputAsset.decimals });
    }
  }
  if (expected.outputAsset) {
    // 경로 치환 — 같은 이름의 **다른(래핑/브리지드) 토큰**이 도착하는 것(§2-11).
    if (!sameAddress(fields.outputAsset.address, expected.outputAsset.address)) {
      const disclosed = fields.assetSubstitutionDisclosed === true && expected.allowDisclosedSubstitution === true;
      gate.add(disclosed ? DECISION.ASK : DECISION.NAH, "output_asset_substituted", {
        got: fields.outputAsset.address, want: expected.outputAsset.address,
        sameSymbol: (fields.outputAsset.symbol ?? null) === (expected.outputAsset.symbol ?? null),
      });
    }
  }
  // 정확한 입력 수량. `all` 류는 게이트에 오기 전에 풀려 있어야 한다(A-492 와 같은 말).
  if (present(expected.inputAmount) && String(fields.inputAmount) !== String(expected.inputAmount)) {
    gate.add(DECISION.NAH, "input_amount_mismatch", { got: fields.inputAmount, want: expected.inputAmount });
  }

  // 6) 목적지 + **그 출처**(§5). 이력만으로 외부 목적지를 채우지 않는다 — 절대.
  if (present(expected.destination) && !sameAddress(fields.destination, expected.destination)) {
    gate.add(DECISION.NAH, "destination_mismatch", { got: fields.destination, want: expected.destination });
  }
  const sources = Array.isArray(expected.allowedDestinationSources) ? expected.allowedDestinationSources : null;
  if (sources && !sources.includes(fields.destinationIdentitySource)) {
    gate.add(DECISION.NAH, "destination_source_not_trusted", { source: fields.destinationIdentitySource });
  }
  if (fields.destinationIdentitySource === "history") {
    gate.add(DECISION.NAH, "destination_from_history_only", null);
  }
  // 첫 목적지·유사 주소는 막지 않고 **더 강하게 묻는다**(§15-4).
  if (fields.destinationFirstSeen === true || fields.destinationLookalike === true) {
    gate.add(DECISION.ASK, "destination_needs_strong_confirmation", {
      firstSeen: fields.destinationFirstSeen === true, lookalike: fields.destinationLookalike === true,
    });
  }
  // [A-763] 출처 생산자가 "모른다"(null)고 말했으면 모름이다 — false 로 읽어 통과시키지 않는다.
  if (fields.destinationFirstSeen === null || fields.destinationLookalike === null || present(fields.destinationProvenanceUnknown)) {
    gate.add(DECISION.UNKNOWN, "destination_provenance_unknown", { reason: fields.destinationProvenanceUnknown ?? null });
  }

  // 7) 승인/permit 경계(§6).
  if (present(fields.spender)) {
    const allow = Array.isArray(expected.allowedSpenders) ? expected.allowedSpenders : null;
    if (!allow || !allow.some((s) => sameAddress(s, fields.spender))) {
      gate.add(DECISION.NAH, "spender_not_verified", { spender: fields.spender });
    }
    if (fields.allowanceUnlimited === true && policy.allowUnlimitedAllowance !== true) {
      gate.add(DECISION.NAH, "unlimited_allowance_refused", null);
    }
    // allowance 는 **정확·유계**여야 한다. 이번 행동에 필요한 값을 넘으면 거절.
    if (present(fields.allowance) && present(fields.allowanceBound) && Number(fields.allowance) > Number(fields.allowanceBound)) {
      gate.add(DECISION.NAH, "allowance_exceeds_bound", { allowance: fields.allowance, bound: fields.allowanceBound });
    }
  }
  if (fields.permit) {
    const p = fields.permit;
    // spender/domain/amount/expiry 중 **하나라도 모르면 행동 0**(§2-5).
    if (!present(p.spender) || !present(p.chainId) || !present(p.amount) || !present(p.deadline) || !present(p.verifyingContract)) {
      gate.add(DECISION.UNKNOWN, "permit_fields_incomplete", null);
    } else {
      if (p.chainId !== fields.sourceChainId) gate.add(DECISION.NAH, "permit_wrong_chain", { got: p.chainId });
      if (Number(p.deadline) <= nowMs) gate.add(DECISION.NAH, "permit_expired", { deadline: p.deadline });
      if (present(fields.spender) && !sameAddress(p.spender, fields.spender)) gate.add(DECISION.NAH, "permit_spender_mismatch", null);
    }
  }

  // 8) 견적 신선도(§2-8). 만료 = 재견적. 정책이 준 수명 외의 기준은 쓰지 않는다.
  if (Number(fields.quoteExpiry) <= nowMs) {
    gate.add(DECISION.NAH, "quote_expired", { quoteExpiry: fields.quoteExpiry, requote: true });
  } else if (Number(fields.quoteTimestamp) > nowMs) {
    // [A-895 N2] 미래 시각의 견적은 "방금 받은 신선한 견적"이 아니다 — 나이가 음수라 stale 검사를 영원히 통과한다. 거절한다.
    gate.add(DECISION.NAH, "quote_timestamp_in_future", { quoteTimestamp: fields.quoteTimestamp, nowMs, requote: true });
  } else if (nowMs - Number(fields.quoteTimestamp) > policy.quoteMaxAgeMs) {
    gate.add(DECISION.NAH, "quote_stale", { ageMs: nowMs - Number(fields.quoteTimestamp), requote: true });
  }

  // 9) 가격영향 · 슬리피지(§7). **둘은 다른 것이고, 임계값은 정책에서만 온다.**
  if (SWAP_LIKE.has(fields.routeClass)) {
    if (Number(fields.minOut) <= 0) gate.add(DECISION.NAH, "min_out_not_positive", null);
    if (Number(fields.minOut) > Number(fields.expectedOut)) gate.add(DECISION.NAH, "min_out_above_expected_out", null);
    if (Number(fields.priceImpactPct) > policy.maxPriceImpactPct) {
      gate.add(DECISION.NAH, "price_impact_over_policy", { got: fields.priceImpactPct, policy: policy.maxPriceImpactPct });
    }
    if (Number(fields.slippagePct) > policy.maxSlippagePct) {
      gate.add(DECISION.NAH, "slippage_over_policy", { got: fields.slippagePct, policy: policy.maxSlippagePct });
    }
    // 유동성 상태가 나쁘면 숫자가 예뻐도 통과시키지 않는다.
    if (fields.liquidityStatus === "thin" || fields.liquidityStatus === "low") {
      gate.add(DECISION.ASK, "liquidity_thin", { liquidityStatus: fields.liquidityStatus });
    } else if (fields.liquidityStatus === "unknown") {
      gate.add(DECISION.UNKNOWN, "liquidity_unknown", null);
    }
  }

  // 10) 목적지 가스(§2-12). 도착만 하고 아무것도 못 하는 상태를 실행이라 부르지 않는다.
  if (fields.destinationTxRequired === true) {
    const covered = fields.destinationGasSponsor === true || fields.destinationGasDelivered === true;
    if (!covered) gate.add(DECISION.NAH, "destination_gas_not_covered", null);
  }

  // 11) 시뮬레이션 + 사후조건(§10). **조용한 전송 금지.**
  if (policy.requireSimulation === true) {
    if (fields.simulationStatus === "fail") gate.add(DECISION.NAH, "simulation_failed", null);
    else if (fields.simulationStatus === "incomplete" || fields.simulationStatus === "unavailable") {
      gate.add(DECISION.UNKNOWN, "simulation_incomplete", { simulationStatus: fields.simulationStatus });
    } else if (fields.simulationStatus !== "ok") {
      gate.add(DECISION.UNKNOWN, "simulation_status_unrecognized", { simulationStatus: fields.simulationStatus });
    }
  }
  const post = comparePostconditions(fields.expectedPostconditions, fields.simulatedPostconditions);
  if (post.checked && !post.match) {
    gate.add(DECISION.NAH, "postcondition_mismatch", { differences: post.differences });
  }

  // 12) 비용(§9). 총비용이 도착액을 먹으면 실행이 아니다.
  if (Number(fields.effectiveOutput) <= 0) gate.add(DECISION.NAH, "effective_output_not_positive", null);
  if (present(expected.maxTotalEffectiveCost) && Number(fields.totalEffectiveCost) > Number(expected.maxTotalEffectiveCost)) {
    gate.add(DECISION.ASK, "total_cost_above_agreed", { got: fields.totalEffectiveCost, agreed: expected.maxTotalEffectiveCost });
  }

  // 13) 이전 준비 상태와 비교 — **실질 변동은 기존 권한을 무효로 만든다**(§12).
  const drift = priorReadiness ? diffMaterialChange(priorReadiness.fields ?? priorReadiness, fields, policy) : { changed: false, changes: [] };
  if (drift.changed) {
    gate.add(drift.deteriorated ? DECISION.NAH : DECISION.ASK, drift.deteriorated ? "material_deterioration_revokes_permission" : "material_change_needs_reconsent", { changes: drift.changes });
  }

  // 14) 상태가 pending/unknown 이면 새 실행이 아니라 **대조**가 먼저다(§12).
  if (fields.lifecycleState === "pending") gate.add(DECISION.ASK, "prior_action_pending", null);
  if (fields.lifecycleState === "unknown") gate.add(DECISION.UNKNOWN, "prior_outcome_unknown_reconcile_first", null);

  return gate.result({
    missingFields: [],
    errorClass: err?.class ?? null,
    priorPermissionInvalidated: drift.changed === true,
  });
}

/**
 * 기대 사후조건 대조(§10). 어느 쪽이 없으면 **검사하지 않았다**고 정직하게 말한다.
 * 무관한 Piggy/Home 이 변하지 않았다는 것도 여기서 본다.
 */
export function comparePostconditions(expectedPost, simulatedPost) {
  if (!expectedPost || !simulatedPost) return { checked: false, match: false, differences: [] };
  const differences = [];
  const walk = (a, b, path) => {
    if (a && typeof a === "object" && !Array.isArray(a)) {
      for (const k of Object.keys(a)) walk(a[k], b ? b[k] : undefined, path ? `${path}.${k}` : k);
      return;
    }
    if (String(a) !== String(b)) differences.push({ path, expected: a ?? null, simulated: b ?? null });
  };
  walk(expectedPost, simulatedPost, "");
  return { checked: true, match: differences.length === 0, differences };
}

/**
 * 견적이 **실질적으로 바뀌었는가**. 바뀌었으면 이전 실행 준비는 무효다.
 * 나빠졌으면(출력↓ 비용↑ 목적지/자산/체인 변경) **기존 권한 자체를 무효로** 본다(§12).
 */
export function diffMaterialChange(before = {}, after = {}, policy = null) {
  const changes = [];
  let deteriorated = false;
  const hard = ["sourceChainId", "destinationChainId", "destination", "inputAmount", "routeClass", "spender"];
  for (const k of hard) {
    if (present(before[k]) && String(before[k]) !== String(after[k])) {
      changes.push({ field: k, before: before[k], after: after[k] });
      deteriorated = true;
    }
  }
  for (const k of ["inputAsset", "outputAsset"]) {
    if (before[k]?.address && !sameAddress(before[k].address, after[k]?.address)) {
      changes.push({ field: `${k}.address`, before: before[k].address, after: after[k]?.address ?? null });
      deteriorated = true;
    }
  }
  const pct = (b, a) => (Number(b) === 0 ? 0 : ((Number(b) - Number(a)) / Number(b)) * 100);
  const threshold = policy && Number.isFinite(policy.materialOutputDeteriorationPct) ? policy.materialOutputDeteriorationPct : null;
  if (present(before.effectiveOutput) && present(after.effectiveOutput) && String(before.effectiveOutput) !== String(after.effectiveOutput)) {
    const drop = pct(before.effectiveOutput, after.effectiveOutput);
    changes.push({ field: "effectiveOutput", before: before.effectiveOutput, after: after.effectiveOutput, dropPct: drop });
    // 임계값이 없으면 "실질적인지" 를 판단할 근거가 없다 → 변동으로만 올리고 악화 단정은 하지 않는다.
    if (threshold !== null && drop > threshold) deteriorated = true;
  }
  if (present(before.totalEffectiveCost) && present(after.totalEffectiveCost) && Number(after.totalEffectiveCost) > Number(before.totalEffectiveCost)) {
    const rise = -pct(before.totalEffectiveCost, after.totalEffectiveCost);
    changes.push({ field: "totalEffectiveCost", before: before.totalEffectiveCost, after: after.totalEffectiveCost, risePct: rise });
    if (threshold !== null && rise > threshold) deteriorated = true;
  }
  return { changed: changes.length > 0, deteriorated, changes };
}

/**
 * 견적 만료·실질 변동은 **이전 실행 준비를 무효로 만든다.** 조용히 이어가지 않는다.
 */
export function invalidateReadiness(priorReadiness, fields, { nowMs = Date.now(), policy = null } = {}) {
  if (!priorReadiness || priorReadiness.executionReady !== true) {
    return { valid: false, reason: "no_prior_readiness", mustReEvaluate: true };
  }
  if (present(fields?.quoteExpiry) && Number(fields.quoteExpiry) <= nowMs) {
    return { valid: false, reason: "quote_expired", mustReEvaluate: true };
  }
  const drift = diffMaterialChange(priorReadiness.fields ?? {}, fields ?? {}, policy);
  if (drift.changed) {
    return { valid: false, reason: drift.deteriorated ? "material_deterioration" : "material_change", mustReEvaluate: true, changes: drift.changes };
  }
  return { valid: true, reason: null, mustReEvaluate: false };
}

/**
 * **슬리피지를 넓혀 실패한 경로를 고치지 않는다**(§7). 이 함수는 항상 거절한다 —
 * 호출부가 "한 번만 넓히면 되는데" 라고 말할 자리를 코드에서 없애기 위해서다.
 */
export function widenSlippage() {
  return Object.freeze({
    allowed: false,
    decision: DECISION.NAH,
    reason: "auto_widen_slippage_refused",
  });
}

/**
 * 경로 비교(§7). **헤드라인 수수료로 고르지 않는다** — `effectiveOutput` 과
 * `totalEffectiveCost` 로만 고른다. 필드가 빠진 후보는 순위에 넣지 않고 UNKNOWN 으로 뺀다.
 */
export function rankRoutes(routes = []) {
  const comparable = [];
  const unrankable = [];
  for (const r of routes) {
    if (!present(r?.effectiveOutput) || !present(r?.totalEffectiveCost)) {
      unrankable.push({ id: r?.id ?? null, decision: DECISION.UNKNOWN, reason: "missing_cost_fields" });
      continue;
    }
    comparable.push(r);
  }
  const ranked = comparable.slice().sort((a, b) => {
    const d = Number(b.effectiveOutput) - Number(a.effectiveOutput);
    if (d !== 0) return d;
    return Number(a.totalEffectiveCost) - Number(b.totalEffectiveCost);
  });
  const byHeadline = comparable.slice().sort((a, b) => Number(a.headlineFee ?? Infinity) - Number(b.headlineFee ?? Infinity));
  return {
    ranked,
    best: ranked[0] ?? null,
    unrankable,
    // 헤드라인이 실제로 진 경우를 **기록으로 남긴다** — 화면이 아니라 영수증을 위해.
    headlineCheapest: byHeadline[0] ?? null,
    headlineLost: !!(ranked[0] && byHeadline[0] && ranked[0].id !== byHeadline[0].id),
  };
}

/**
 * 결과를 모를 때(§12, A-492 와 같은 말). **맹목 재시도 금지.** 먼저 대조한다.
 */
export function onUnknownOutcome(fields = {}) {
  return Object.freeze({
    decision: DECISION.UNKNOWN,
    action: 0,
    retry: false,
    next: "reconcile_first",
    reason: "unknown_outcome_must_reconcile",
    intentId: fields.intentId ?? null,
    lookups: Object.freeze([fields.txId ?? null, fields.messageId ?? null, fields.orderId ?? null].filter(Boolean)),
  });
}

/**
 * 행동 뒤 남은 allowance(§22). **조용히 무시하지 않는다** — 필요 없으면 회수 후보로 올린다.
 */
export function residualAllowance({ remaining = "0", stillNeeded = false, spender = null } = {}) {
  const left = Number(remaining) > 0;
  return Object.freeze({
    hasResidual: left,
    revokeCandidate: left && stillNeeded !== true,
    spender,
    remaining: String(remaining),
  });
}

// ── [A-763] 목적지 출처 생산자(§3·§5) ─────────────────────────────────────────────
// 첫 목적지 / 유사 주소 플래그를 **호출자의 주장**이 아니라 실제 출처 기록에서 만든다.
// 기록(records)은 "이 주소를 어디서 알았나" 의 목록이다: { address, source }.
//  · 기록 자체가 없으면(배열이 아님) 판단 근거가 없다 → 두 플래그 모두 null = UNKNOWN. false 가 아니다.
//  · 목적지가 완전한 주소가 아니면 → UNKNOWN.
//  · 정체성은 **전체 주소 동일성**으로만 본다. 앞뒤 몇 글자는 정체성 근거가 아니고, 유사 주소 탐지에만 쓴다.
//  · 이력(history)은 목적지를 보증하지 못한다: 이력에만 있는 주소는 여전히 "처음" 이다(오염 공격은 이력에 심는다).
//  · 이 생산자는 권한·READY·실행을 만들지 않는다. 출력은 게이트의 입력일 뿐이다.
export const DESTINATION_SOURCE = Object.freeze({
  PIGGY_REGISTRY: "piggy_registry",
  PROTOCOL_REGISTRY: "protocol_registry",
  USER_TYPED: "user_typed",
  HISTORY: "history",
});
const VOUCHING_SOURCES = new Set([DESTINATION_SOURCE.PIGGY_REGISTRY, DESTINATION_SOURCE.PROTOCOL_REGISTRY, DESTINATION_SOURCE.USER_TYPED]);
const REGISTRY_SOURCES = new Set([DESTINATION_SOURCE.PIGGY_REGISTRY, DESTINATION_SOURCE.PROTOCOL_REGISTRY]);
const KNOWN_SOURCES = new Set(Object.values(DESTINATION_SOURCE));
const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// 오염 주소가 흉내 내는 보이는 끝자리 폭(앞 4 · 뒤 4 hex). 탐지 전용 — 통과 기준이 아니다.
const LOOKALIKE_EDGE = 4;

function edgesMatch(a, b) {
  const x = a.slice(2).toLowerCase();
  const y = b.slice(2).toLowerCase();
  return x !== y && x.slice(0, LOOKALIKE_EDGE) === y.slice(0, LOOKALIKE_EDGE) && x.slice(-LOOKALIKE_EDGE) === y.slice(-LOOKALIKE_EDGE);
}

function unknownProvenance(reason, ignored = 0) {
  return Object.freeze({
    kind: "destination_provenance",
    status: DECISION.UNKNOWN,
    reason,
    destinationFirstSeen: null,
    destinationLookalike: null,
    vouchedBy: null,
    lookalikeOf: Object.freeze([]),
    ignoredRecords: ignored,
    createsPermission: false,
  });
}

// 실제 출처 기록 → { destinationFirstSeen, destinationLookalike } (모르면 null). 순수 함수, 던지지 않는다.
// 기록 필드는 **자기 속성(own property)** 만 읽는다 — 프로토타입에서 물려받은 address/source 는 출처가 아니다.
// 입력의 getter 가 던지면 그 입력은 읽을 수 없는 것이다 → UNKNOWN (fail closed).
// [A-791] Safari-safe own-property check. `Object.hasOwn` is ES2022 (Safari 15.4+) and the build does not polyfill it, so an
// older engine would throw "Object.hasOwn is not a function" here. Use it when the engine has it, otherwise the equivalent
// `Object.prototype.hasOwnProperty.call` (captured at load, so a later reassignment of either cannot change the answer).
// Same semantics on both paths: own properties only, inherited/prototype keys are false.
const NATIVE_HAS_OWN = typeof Object.hasOwn === "function" ? Object.hasOwn : null;
const PROTO_HAS_OWN = Object.prototype.hasOwnProperty;
export function hasOwnSafe(o, k) {
  if (o === null || o === undefined) return false;
  return NATIVE_HAS_OWN ? NATIVE_HAS_OWN(o, k) : PROTO_HAS_OWN.call(o, k);
}
/** Which path hasOwnSafe took when this module loaded ("native" | "fallback"). For tests and diagnostics only. */
export const HAS_OWN_PATH = NATIVE_HAS_OWN ? "native" : "fallback";
const ownString = (o, k) => (hasOwnSafe(o, k) && typeof o[k] === "string" ? o[k] : null);

export function deriveDestinationProvenance(input = {}) {
  try {
    return deriveDestinationProvenanceUnguarded(input);
  } catch {
    return unknownProvenance("provenance_input_unreadable");
  }
}

function deriveDestinationProvenanceUnguarded(input) {
  if (!input || typeof input !== "object") return unknownProvenance("destination_unreadable");
  const destination = hasOwnSafe(input, "destination") ? input.destination : null;
  const records = hasOwnSafe(input, "records") ? input.records : undefined;
  if (typeof destination !== "string" || !FULL_ADDRESS.test(destination)) return unknownProvenance("destination_unreadable");
  if (!Array.isArray(records)) return unknownProvenance("provenance_unavailable");
  // 한 번만 읽어 평범한 값으로 굳힌다 — 두 번째 읽기에서 다른 답을 주는 getter 가 판정을 바꾸지 못하게.
  const usable = [];
  let ignored = 0;
  const total = records.length;
  for (let i = 0; i < total; i += 1) {
    const r = hasOwnSafe(records, i) ? records[i] : null;
    const address = r && typeof r === "object" ? ownString(r, "address") : null;
    const source = r && typeof r === "object" ? ownString(r, "source") : null;
    if (address && FULL_ADDRESS.test(address) && KNOWN_SOURCES.has(source)) usable.push({ address, source });
    else ignored += 1;
  }
  // 기록이 있었는데 하나도 읽을 수 없으면 "비어 있음" 이 아니라 "모름" 이다.
  if (total > 0 && usable.length === 0) return unknownProvenance("provenance_unreadable", ignored);
  const exact = usable.filter((r) => sameAddress(r.address, destination));
  const vouching = exact.filter((r) => VOUCHING_SOURCES.has(r.source));
  const lookalikeOf = [...new Set(usable.filter((r) => edgesMatch(r.address, destination)).map((r) => r.address.toLowerCase()))];
  return Object.freeze({
    kind: "destination_provenance",
    status: "known",
    reason: null,
    destinationFirstSeen: vouching.length === 0,
    destinationLookalike: lookalikeOf.length > 0,
    vouchedBy: vouching.length ? Object.freeze([...new Set(vouching.map((r) => r.source))]) : null,
    lookalikeOf: Object.freeze(lookalikeOf),
    ignoredRecords: ignored,
    createsPermission: false,
  });
}

// 출처에 묶인 실행 게이트. 첫 목적지·유사 플래그는 **호출자가 넣은 값을 버리고** 생산자 값으로 덮는다
// (호출자가 false 라고 주장해도 통과 근거가 되지 못한다). 레지스트리 출처를 주장했는데 그 레지스트리 기록에
// 정확히 같은 주소가 없으면 그 주장도 모름이다. 결과는 게이트 판정일 뿐 — 권한을 만들지 않는다.
// 입력을 읽다가 던지면 판정은 UNKNOWN 이다 — 예외가 호출자에게 새어 나가 "검사 없음" 이 되지 않는다.
export function evaluateDestinationBoundExecution(input = {}) {
  let args;
  let destinationRecords;
  let inFields;
  try {
    const { destinationRecords: recs, ...rest } = input && typeof input === "object" ? input : {};
    destinationRecords = recs;
    args = rest;
    inFields = args.fields && typeof args.fields === "object" ? { ...args.fields } : {};
  } catch {
    const prov = unknownProvenance("provenance_input_unreadable");
    const out = evaluateExecution({ fields: { destinationProvenanceUnknown: prov.reason } });
    return Object.freeze({ ...out, destinationProvenance: prov, createsPermission: false });
  }
  const prov = deriveDestinationProvenance({ destination: inFields.destination, records: destinationRecords });
  let unknownReason = prov.status === DECISION.UNKNOWN ? prov.reason : null;
  const claimed = inFields.destinationIdentitySource;
  if (!unknownReason && REGISTRY_SOURCES.has(claimed) && !(prov.vouchedBy || []).includes(claimed)) {
    unknownReason = "destination_source_claim_unbacked";
  }
  const fields = {
    ...inFields,
    destinationFirstSeen: prov.destinationFirstSeen,
    destinationLookalike: prov.destinationLookalike,
    destinationProvenanceUnknown: unknownReason,
  };
  try {
    const out = evaluateExecution({ ...args, fields });
    return Object.freeze({ ...out, destinationProvenance: prov, createsPermission: false });
  } catch {
    const out = evaluateExecution({ fields: { destinationProvenanceUnknown: "gate_input_unreadable" } });
    return Object.freeze({ ...out, destinationProvenance: prov, createsPermission: false });
  }
}
