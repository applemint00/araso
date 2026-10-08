// [A-499 Lane S] 실행 안전 런타임 게이트 — 결정론 테스트. 네트워크 0 · 체인 0 · 제공자 0.
//   node app/test/execution-safety.mjs
//
// A-497 §15 의 24행 표를 그대로 따라간다. 임계값은 **전부 이 파일의 fixture 정책**에서 온다 —
// 소스에 제품 상수로 박힌 슬리피지·가격영향이 있으면 마지막 검사에서 걸린다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DECISION,
  ERROR_CLASS,
  ROUTE_CLASS,
  comparePostconditions,
  diffMaterialChange,
  evaluateExecution,
  invalidateReadiness,
  missingMaterialFields,
  normalizeProviderError,
  onUnknownOutcome,
  rankRoutes,
  residualAllowance,
  validatePolicy,
  widenSlippage,
} from "../src/execution-safety.js";

const SRC = readFileSync(new URL("../src/execution-safety.js", import.meta.url), "utf8");

const NOW = 1_800_000_000_000;
const USDC = "0x00000000000000000000000000000000000000c1";
const FAKE_USDC = "0x00000000000000000000000000000000000000c2";
const WMON = "0x00000000000000000000000000000000000000d1";
const DEST = "0x00000000000000000000000000000000000000a1";
const SPENDER = "0x00000000000000000000000000000000000000e1";
const EVIL = "0x00000000000000000000000000000000000000ff";

// **경로/자산군별 명시 정책.** 제품 상수가 아니라 이 테스트의 입력이다.
const policy = (over = {}) => ({
  routeClass: ROUTE_CLASS.SAME_CHAIN_SWAP,
  assetClass: "stable_to_stable",
  maxPriceImpactPct: 0.3,
  maxSlippagePct: 0.5,
  quoteMaxAgeMs: 60_000,
  requireSimulation: true,
  allowUnlimitedAllowance: false,
  materialOutputDeteriorationPct: 0.5,
  ...over,
});

const post = () => ({ piggyDelta: "-10", outAssetDelta: "+9.98", otherPiggiesChanged: "false", homeChanged: "false" });

const fields = (over = {}) => ({
  intentId: "intent-1",
  piggyId: "honeybun",
  action: "swap",
  sourceChainId: 143,
  destinationChainId: 143,
  inputAsset: { identity: "Circle USDC", symbol: "USDC", address: USDC, decimals: 6 },
  outputAsset: { identity: "Wrapped MON", symbol: "WMON", address: WMON, decimals: 18 },
  inputAmount: "10",
  expectedOut: "9.98",
  minOut: "9.93",
  priceImpactPct: 0.05,
  slippagePct: 0.2,
  totalEffectiveCost: "0.07",
  effectiveOutput: "9.93",
  quoteTimestamp: NOW - 5_000,
  quoteExpiry: NOW + 55_000,
  routeClass: ROUTE_CLASS.SAME_CHAIN_SWAP,
  liquidityStatus: "deep",
  simulationStatus: "ok",
  expectedPostconditions: post(),
  simulatedPostconditions: post(),
  destination: DEST,
  destinationIdentitySource: "piggy_registry",
  spender: SPENDER,
  allowance: "10",
  allowanceBound: "10",
  ...over,
});

const expected = (over = {}) => ({
  sourceChainId: 143,
  destinationChainId: 143,
  inputAsset: { symbol: "USDC", address: USDC, decimals: 6 },
  outputAsset: { symbol: "WMON", address: WMON },
  inputAmount: "10",
  destination: DEST,
  allowedDestinationSources: ["piggy_registry", "user_typed"],
  allowedSpenders: [SPENDER],
  ...over,
});

const run = (f = {}, extra = {}) =>
  evaluateExecution({ fields: fields(f), policy: policy(extra.policy), expected: expected(extra.expected), nowMs: NOW, ...extra.opts });

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }
const has = (r, code) => r.reasons.includes(code);

// ── 0. 기준선 ───────────────────────────────────────────────────────────────────
check("a fully known, in-policy, current quote passes the gate as DO", () => {
  const r = run();
  assert.equal(r.decision, DECISION.DO, JSON.stringify(r.reasons));
  assert.equal(r.action, 1);
  assert.equal(r.executionReady, true);
  assert.deepEqual(r.reasons, []);
});

// ── 1. 정책이 없으면 임계값을 지어내지 않는다 ────────────────────────────────────
check("no explicit policy means UNKNOWN and action 0, never an invented threshold", () => {
  const r = evaluateExecution({ fields: fields(), policy: null, expected: expected(), nowMs: NOW });
  assert.equal(r.decision, DECISION.UNKNOWN);
  assert.equal(r.action, 0);
  assert(has(r, "policy_missing"));
  const partial = validatePolicy({ routeClass: ROUTE_CLASS.SAME_CHAIN_SWAP });
  assert.equal(partial.ok, false);
  assert(partial.missing.includes("maxSlippagePct"));
});

check("a policy written for another route class does not carry over", () => {
  const r = run({}, { policy: { routeClass: ROUTE_CLASS.TOKEN_BRIDGE } });
  assert.equal(r.decision, DECISION.UNKNOWN);
  assert(has(r, "policy_route_class_mismatch"));
});

// ── §15-1 잘못된 체인 ────────────────────────────────────────────────────────────
check("wrong source or destination chain is refused", () => {
  assert.equal(run({ sourceChainId: 1 }).decision, DECISION.NAH);
  assert(has(run({ sourceChainId: 1 }), "wrong_source_chain"));
  assert(has(run({ destinationChainId: 10143 }), "wrong_destination_chain"));
});

// ── §15-2 같은 심볼 다른 주소 ────────────────────────────────────────────────────
check("same symbol, different address is refused — the symbol is never the evidence", () => {
  const r = run({ inputAsset: { identity: "USDC", symbol: "USDC", address: FAKE_USDC, decimals: 6 } });
  assert.equal(r.decision, DECISION.NAH);
  assert(has(r, "input_asset_address_mismatch"));
  const finding = r.findings.find((f) => f.code === "input_asset_address_mismatch");
  assert.equal(finding.detail.sameSymbol, true);
});

// ── §15-3 / §15-11 경로 자산 치환 ────────────────────────────────────────────────
check("a substituted output asset is refused unless the product disclosed the conversion", () => {
  const swapped = { outputAsset: { identity: "Bridged WMON", symbol: "WMON", address: EVIL, decimals: 18 } };
  assert(has(run(swapped), "output_asset_substituted"));
  assert.equal(run(swapped).decision, DECISION.NAH);
  const disclosed = run({ ...swapped, assetSubstitutionDisclosed: true }, { expected: { allowDisclosedSubstitution: true } });
  assert.equal(disclosed.decision, DECISION.ASK);
});

// ── §15-3/4 목적지 ───────────────────────────────────────────────────────────────
check("a changed destination is refused; history alone can never name one", () => {
  assert(has(run({ destination: EVIL }), "destination_mismatch"));
  const hist = run({ destinationIdentitySource: "history" });
  assert.equal(hist.decision, DECISION.NAH);
  assert(has(hist, "destination_from_history_only"));
  assert(has(run({ destinationIdentitySource: "clipboard" }), "destination_source_not_trusted"));
});

check("a first-seen or lookalike destination asks harder instead of passing quietly", () => {
  const r = run({ destinationFirstSeen: true });
  assert.equal(r.decision, DECISION.ASK);
  assert.equal(r.action, 0);
  assert(has(r, "destination_needs_strong_confirmation"));
});

// ── §15-5/6 spender · allowance ─────────────────────────────────────────────────
check("an unverified spender, an unlimited allowance, or an allowance past its bound is refused", () => {
  assert(has(run({ spender: EVIL }), "spender_not_verified"));
  assert(has(run({ allowanceUnlimited: true }), "unlimited_allowance_refused"));
  const over = run({ allowance: "1000", allowanceBound: "10" });
  assert.equal(over.decision, DECISION.NAH);
  assert(has(over, "allowance_exceeds_bound"));
});

// ── §15-7 permit ────────────────────────────────────────────────────────────────
check("permit metadata that is expired, off-chain-id, or incomplete stops the action", () => {
  const base = { spender: SPENDER, chainId: 143, amount: "10", deadline: NOW + 60_000, verifyingContract: USDC };
  assert.equal(run({ permit: base }).decision, DECISION.DO);
  assert(has(run({ permit: { ...base, deadline: NOW - 1 } }), "permit_expired"));
  assert(has(run({ permit: { ...base, chainId: 1 } }), "permit_wrong_chain"));
  const incomplete = run({ permit: { ...base, deadline: null } });
  assert.equal(incomplete.decision, DECISION.UNKNOWN);
  assert(has(incomplete, "permit_fields_incomplete"));
});

// ── §15-8 유동성 / 가격영향 ─────────────────────────────────────────────────────
check("thin liquidity asks, unknown liquidity is UNKNOWN, price impact over policy is refused", () => {
  assert.equal(run({ liquidityStatus: "thin" }).decision, DECISION.ASK);
  assert.equal(run({ liquidityStatus: "unknown" }).decision, DECISION.UNKNOWN);
  const impact = run({ priceImpactPct: 4.0 });
  assert.equal(impact.decision, DECISION.NAH);
  assert(has(impact, "price_impact_over_policy"));
  // 같은 숫자라도 **정책이 다르면 결과가 다르다** — 임계값이 제품 상수가 아님의 증거.
  const loose = run({ priceImpactPct: 4.0 }, { policy: { maxPriceImpactPct: 10 } });
  assert.equal(loose.decision, DECISION.DO);
});

// ── §15-9/10 슬리피지, 자동 확대 금지 ────────────────────────────────────────────
check("slippage over policy is refused and is never fixed by widening the tolerance", () => {
  const r = run({ slippagePct: 3.0 });
  assert.equal(r.decision, DECISION.NAH);
  assert(has(r, "slippage_over_policy"));
  const widen = widenSlippage({ from: 0.5, to: 3.0 });
  assert.equal(widen.allowed, false);
  assert.equal(widen.decision, DECISION.NAH);
  // 넓힌 값을 다시 밀어 넣어도 결정은 그대로다.
  assert.equal(run({ slippagePct: 3.0 }).decision, DECISION.NAH);
});

// ── §15-11 낡은 견적 ─────────────────────────────────────────────────────────────
check("an expired or stale quote forces a re-quote", () => {
  const expiredQ = run({ quoteExpiry: NOW - 1 });
  assert.equal(expiredQ.decision, DECISION.NAH);
  assert.equal(expiredQ.findings.find((f) => f.code === "quote_expired").detail.requote, true);
  const stale = run({ quoteTimestamp: NOW - 600_000 });
  assert(has(stale, "quote_stale"));
});

// [A-895 N2] A quote stamped in the future is not "fresh": its age is negative, so it used to pass the stale check forever.
check("a quote timestamped in the future is refused (quote_timestamp_in_future)", () => {
  const future = run({ quoteTimestamp: NOW + 1 });
  assert.equal(future.decision, DECISION.NAH);
  assert(has(future, "quote_timestamp_in_future"));
  assert.equal(future.findings.find((f) => f.code === "quote_timestamp_in_future").detail.requote, true);
  assert(has(run({ quoteTimestamp: NOW + 86_400_000 * 365 }), "quote_timestamp_in_future"));
  // boundary: stamped exactly now is fine
  assert.equal(has(run({ quoteTimestamp: NOW }), "quote_timestamp_in_future"), false);
  assert.equal(has(run({ quoteTimestamp: NOW - 1 }), "quote_timestamp_in_future"), false);
});

// ── §15-12 출력 악화 = 기존 권한 무효 ────────────────────────────────────────────
check("a material fee or output deterioration invalidates the earlier execution readiness", () => {
  const before = fields();
  const ready = evaluateExecution({ fields: before, policy: policy(), expected: expected(), nowMs: NOW });
  assert.equal(ready.executionReady, true);
  const worse = fields({ effectiveOutput: "9.10", totalEffectiveCost: "0.90" });
  const r = evaluateExecution({
    fields: worse, policy: policy(), expected: expected(), nowMs: NOW,
    priorReadiness: { ...ready, fields: before },
  });
  assert.equal(r.decision, DECISION.NAH);
  assert(has(r, "material_deterioration_revokes_permission"));
  assert.equal(r.priorPermissionInvalidated, true);

  const inv = invalidateReadiness({ ...ready, fields: before }, worse, { nowMs: NOW, policy: policy() });
  assert.equal(inv.valid, false);
  assert.equal(inv.mustReEvaluate, true);
});

check("quote expiry alone already invalidates a prior readiness", () => {
  const before = fields();
  const ready = evaluateExecution({ fields: before, policy: policy(), expected: expected(), nowMs: NOW });
  const inv = invalidateReadiness({ ...ready, fields: before }, fields({ quoteExpiry: NOW - 1 }), { nowMs: NOW, policy: policy() });
  assert.equal(inv.valid, false);
  assert.equal(inv.reason, "quote_expired");
});

// ── §15-13 minOut ────────────────────────────────────────────────────────────────
check("a swap-like route without minOut is UNKNOWN and does not execute", () => {
  const r = run({ minOut: null });
  assert.equal(r.decision, DECISION.UNKNOWN);
  assert.equal(r.action, 0);
  assert(r.missingFields.includes("minOut"));
  assert(has(run({ minOut: "0" }), "min_out_not_positive"));
  assert(has(run({ minOut: "11" }), "min_out_above_expected_out"));
  // 발행자 네이티브 경로는 minOut 을 요구하지 않는다 — 분류를 섞지 않는다.
  assert(!missingMaterialFields({ ...fields({ routeClass: ROUTE_CLASS.ISSUER_NATIVE }), minOut: null }).includes("minOut"));
});

// ── §15-14 제공자 오류 정규화 ────────────────────────────────────────────────────
check("provider errors normalize to generic classes with no provider-specific wording", () => {
  const cases = [
    ["INSUFFICIENT_LIQUIDITY", ERROR_CLASS.INSUFFICIENT_LIQUIDITY, DECISION.NAH],
    ["SWAP_IMPACT_TOO_HIGH", ERROR_CLASS.HIGH_PRICE_IMPACT, DECISION.NAH],
    ["NO_QUOTES", ERROR_CLASS.NO_ROUTE, DECISION.NAH],
    ["INVALID_SLIPPAGE_TOLERANCE", ERROR_CLASS.INVALID_SLIPPAGE, DECISION.NAH],
    ["sanctioned address", ERROR_CLASS.COMPLIANCE_BLOCKED, DECISION.NAH],
    ["destination tx reverted", ERROR_CLASS.DESTINATION_TX_FAILED, DECISION.NAH],
    ["permit invalid", ERROR_CLASS.PERMIT_FAILED, DECISION.NAH],
    ["kaboom 0x12", ERROR_CLASS.UNCLASSIFIED, DECISION.UNKNOWN],
  ];
  for (const [raw, cls, dec] of cases) {
    const n = normalizeProviderError(raw);
    assert.equal(n.class, cls, raw);
    assert.equal(n.decision, dec, raw);
    const r = evaluateExecution({ fields: fields(), policy: policy(), expected: expected(), nowMs: NOW, providerError: raw });
    assert.equal(r.decision, dec, raw);
    assert.equal(r.errorClass, cls, raw);
  }
  assert.equal(normalizeProviderError(null), null);
});

// ── §15-15 목적지 가스 ───────────────────────────────────────────────────────────
check("a route needing a destination tx does not execute until gas is actually covered", () => {
  const needs = { routeClass: ROUTE_CLASS.TOKEN_BRIDGE, destinationChainId: 143, destinationTxRequired: true };
  const missing = evaluateExecution({
    fields: fields({ ...needs, destinationGasCostOrRequirement: null }),
    policy: policy({ routeClass: ROUTE_CLASS.TOKEN_BRIDGE }), expected: expected(), nowMs: NOW,
  });
  assert.equal(missing.decision, DECISION.UNKNOWN);
  assert(missing.missingFields.includes("destinationGasCostOrRequirement"));

  const uncovered = evaluateExecution({
    fields: fields({ ...needs, destinationGasCostOrRequirement: "0.002" }),
    policy: policy({ routeClass: ROUTE_CLASS.TOKEN_BRIDGE }), expected: expected(), nowMs: NOW,
  });
  assert.equal(uncovered.decision, DECISION.NAH);
  assert(has(uncovered, "destination_gas_not_covered"));

  const sponsored = evaluateExecution({
    fields: fields({ ...needs, destinationGasCostOrRequirement: "0.002", destinationGasSponsor: true }),
    policy: policy({ routeClass: ROUTE_CLASS.TOKEN_BRIDGE }), expected: expected(), nowMs: NOW,
  });
  assert.equal(sponsored.decision, DECISION.DO, JSON.stringify(sponsored.reasons));
});

// ── §15-17 시뮬레이션 ────────────────────────────────────────────────────────────
check("an incomplete simulation is UNKNOWN and a failed one is refused — no quiet send", () => {
  assert.equal(run({ simulationStatus: "incomplete" }).decision, DECISION.UNKNOWN);
  assert.equal(run({ simulationStatus: "unavailable" }).decision, DECISION.UNKNOWN);
  const failed = run({ simulationStatus: "fail" });
  assert.equal(failed.decision, DECISION.NAH);
  assert(has(failed, "simulation_failed"));
});

// ── §15-18/23 사후조건 ───────────────────────────────────────────────────────────
check("postcondition mismatch is refused, including an untouched-piggy claim that did not hold", () => {
  const r = run({ simulatedPostconditions: { ...post(), otherPiggiesChanged: "true" } });
  assert.equal(r.decision, DECISION.NAH);
  assert(has(r, "postcondition_mismatch"));
  const cmp = comparePostconditions(post(), { ...post(), homeChanged: "true" });
  assert.equal(cmp.match, false);
  assert.equal(cmp.differences[0].path, "homeChanged");
  // 시뮬레이션 결과가 아예 없으면 "맞다" 고 하지 않는다 — 검사하지 않았다고 한다.
  assert.deepEqual(comparePostconditions(post(), null), { checked: false, match: false, differences: [] });
});

// ── §15-19 헤드라인 최저가가 총비용에서 진다 ─────────────────────────────────────
check("the cheapest headline fee loses once every known cost is counted", () => {
  const routes = [
    { id: "headline", headlineFee: "0.01", effectiveOutput: "9.60", totalEffectiveCost: "0.40" },
    { id: "honest", headlineFee: "0.05", effectiveOutput: "9.91", totalEffectiveCost: "0.09" },
    { id: "blind", headlineFee: "0.00" },
  ];
  const r = rankRoutes(routes);
  assert.equal(r.headlineCheapest.id, "headline");
  assert.equal(r.best.id, "honest");
  assert.equal(r.headlineLost, true);
  assert.equal(r.unrankable[0].id, "blind");
  assert.equal(r.unrankable[0].decision, DECISION.UNKNOWN);
});

// ── §15-20 재생/중복 ────────────────────────────────────────────────────────────
check("the same intent cannot be made execution-ready twice", () => {
  const used = new Set(["intent-1"]);
  const r = evaluateExecution({ fields: fields(), policy: policy(), expected: expected(), nowMs: NOW, consumedIntents: used });
  assert.equal(r.decision, DECISION.NAH);
  assert.equal(r.executionReady, false);
  assert(has(r, "replay_intent_already_used"));
});

// ── §15-21/22 unknown · pending ─────────────────────────────────────────────────
check("an unknown outcome reconciles first and never auto-retries; pending is not success", () => {
  const u = onUnknownOutcome({ intentId: "intent-1", txId: "0xabc", orderId: "ord-9" });
  assert.equal(u.retry, false);
  assert.equal(u.next, "reconcile_first");
  assert.equal(u.action, 0);
  assert.deepEqual([...u.lookups], ["0xabc", "ord-9"]);
  const unk = run({ lifecycleState: "unknown" });
  assert.equal(unk.decision, DECISION.UNKNOWN);
  assert(has(unk, "prior_outcome_unknown_reconcile_first"));
  const pend = run({ lifecycleState: "pending" });
  assert.equal(pend.decision, DECISION.ASK);
  assert.equal(pend.action, 0);
});

// ── §15-24 잔여 allowance ───────────────────────────────────────────────────────
check("a leftover allowance becomes a revoke candidate instead of being ignored", () => {
  assert.equal(residualAllowance({ remaining: "5", stillNeeded: false, spender: SPENDER }).revokeCandidate, true);
  assert.equal(residualAllowance({ remaining: "5", stillNeeded: true }).revokeCandidate, false);
  assert.equal(residualAllowance({ remaining: "0" }).hasResidual, false);
});

// ── 빈칸 = UNKNOWN ──────────────────────────────────────────────────────────────
check("any missing material field is UNKNOWN with action 0, never a guess", () => {
  for (const key of ["intentId", "sourceChainId", "expectedOut", "totalEffectiveCost", "quoteExpiry", "expectedPostconditions"]) {
    const r = run({ [key]: null });
    assert.equal(r.decision, DECISION.UNKNOWN, key);
    assert.equal(r.action, 0, key);
    assert(r.missingFields.includes(key), key);
  }
  // 주소만 있고 decimals 가 없는 자산은 **정체성이 확인된 자산이 아니다**.
  const half = run({ inputAsset: { symbol: "USDC", address: USDC } });
  assert.equal(half.decision, DECISION.UNKNOWN);
  assert(half.missingFields.includes("inputAsset"));
});

// ── 결정 서열 ───────────────────────────────────────────────────────────────────
check("the heaviest decision wins — ASK never covers a NAH, nothing turns UNKNOWN into DO", () => {
  const r = run({ destinationFirstSeen: true, slippagePct: 9 });
  assert.equal(r.decision, DECISION.NAH);
  const u = run({ destinationFirstSeen: true, simulationStatus: "incomplete" });
  assert.equal(u.decision, DECISION.UNKNOWN);
});

// ── 변동 대조 ───────────────────────────────────────────────────────────────────
check("a changed destination or asset counts as deterioration, not a quiet update", () => {
  const d = diffMaterialChange(fields(), fields({ destination: EVIL }), policy());
  assert.equal(d.changed, true);
  assert.equal(d.deteriorated, true);
  const same = diffMaterialChange(fields(), fields(), policy());
  assert.equal(same.changed, false);
});

// ── 언어·순수성 계약 ────────────────────────────────────────────────────────────
check("the module states no safety and keeps no universal threshold constant", () => {
  const code = SRC.replace(/\/\/.*$/gm, "");
  assert.equal(/safeScore|safetyScore|riskScore|isSafe|\bsafe\b/i.test(code), false, "no safe wording or score in code");
  // 임계값 비교는 항상 policy.* 를 상대로 한다 — 벌거벗은 퍼센트 리터럴이 없어야 한다.
  assert.equal(/(maxPriceImpactPct|maxSlippagePct|quoteMaxAgeMs)\s*[:=]\s*\d/.test(code), false, "no default threshold value");
  assert.equal(/\b\d+(\.\d+)?\s*\/\*\s*pct/i.test(code), false);
});

check("the module is pure — no network, no timers, no provider branching", () => {
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|axios|WebSocket|require\(|import\s+.*from\s+["']node:/.test(SRC), false);
  // 주석은 정본을 인용하므로 제공자 이름이 나올 수 있다. **실행 코드**에 나오면 안 된다.
  const code = SRC.replace(/\/\/.*$/gm, "");
  assert.equal(/relay|li\.fi|lifi|across|debridge|socket\.tech|jumper|cctp|wormhole|stargate/i.test(code), false, "no provider is branched on here");
});

console.log(`\n${pass} checks passed — PASS_SAFETY_RUNTIME_CORE (pure gate only; not route integration, not live protection)`);
