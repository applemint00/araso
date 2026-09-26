// [A-494 Lane A/C → A-510 Stream D-core] 충전 진입 계약 + 의도 보존 — 네트워크 0 · 체인 0.
// 이력: A-494 는 받는 곳을 Home(`creditsHome`/`homeAvailable`)으로 썼다. A-508 이후 받는 곳은 **고른 Piggy** 다.
//   node app/test/funding-entry.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_ARRIVAL, FUNDING_METHOD, FUNDING_RAIL, FUNDING_STATE,
  applyFundingResult, fundingEvidenceKey, hasUsableMethod, isAddMoneyPrimitiveVisible,
  isFundingMethod, listFundingMethods, startFunding,
} from "../src/funding-entry.js";
import { checkIntentFunding, fundingRequestForShortfall, resumeAfterFunding } from "../src/funding-intent-bridge.js";

const SRC = readFileSync(new URL("../src/funding-entry.js", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("../src/funding-intent-bridge.js", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const PIGGY_ADDR = "0x4386A2237DF924453A14575238Ad0565eB39D4C6"; // 받을 Piggy(Honeybun) 주소
const walletAdapter = { method: FUNDING_METHOD.FROM_ANOTHER_WALLET, railId: FUNDING_RAIL.DIRECT_WALLET_TRANSFER, available: true, sourceContext: "external_wallet" };
const base = { method: FUNDING_METHOD.FROM_ANOTHER_WALLET, amount: "30", target: PIGGY_ADDR, targetPiggyId: "honeybun", adapters: [walletAdapter] };

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 하나의 행동, 여러 레일 ───────────────────────────────────────────────────
check("Add money stays visible even when no method works yet", () => {
  assert.equal(isAddMoneyPrimitiveVisible(), true);
  assert.equal(hasUsableMethod({ adapters: [] }), false);
  const methods = listFundingMethods({ adapters: [] });
  assert.equal(methods.length, 3);
  assert.equal(methods.every((m) => m.available === false), true);
});

check("unsupported methods say why, they are not hidden or faked", () => {
  const methods = listFundingMethods({ adapters: [walletAdapter] });
  const bank = methods.find((m) => m.method === FUNDING_METHOD.BANK_CARD_APPLE_PAY);
  assert.equal(bank.available, false);
  assert.equal(bank.reason ?? bank.unavailableReason, "no_provider_selected");
  assert.equal(bank.railId, null);
  const wallet = methods.find((m) => m.method === FUNDING_METHOD.FROM_ANOTHER_WALLET);
  assert.equal(wallet.available, true);
});

check("choosing an unavailable method fails closed, not silently", () => {
  const out = startFunding({ ...base, method: FUNDING_METHOD.BANK_CARD_APPLE_PAY });
  assert.equal(out.ok, false);
  assert.equal(out.state, FUNDING_STATE.UNAVAILABLE);
  assert.equal(out.reason, "no_provider_selected");
});

check("provider detail stays behind the adapter, not in the contract", () => {
  const out = startFunding(base);
  assert.equal(out.intent.railId, FUNDING_RAIL.DIRECT_WALLET_TRANSFER);
  // 계약에는 제공자 고유 필드가 없다
  assert.equal("apiKey" in out.intent, false);
  assert.equal("providerConfig" in out.intent, false);
});

// ── 2. 도착 자산 — 조용한 대체 금지 ─────────────────────────────────────────────
check("the default arrival is USDC on Monad", () => {
  assert.deepEqual(DEFAULT_ARRIVAL, { chain: "monad-mainnet", asset: "USDC" });
  assert.equal(startFunding(base).intent.targetAsset, "USDC");
});

check("a different asset or chain needs explicit acknowledgement", () => {
  const swap = startFunding({ ...base, arrival: { chain: "monad-mainnet", asset: "AUSD" } });
  assert.equal(swap.ok, false);
  assert.equal(swap.reason, "asset_change_not_acknowledged");
  const ok = startFunding({ ...base, arrival: { chain: "monad-mainnet", asset: "AUSD" }, assetChangeAcknowledged: true });
  assert.equal(ok.ok, true);
});

check("no stable=$1 assumption exists in the module", () => {
  assert.equal(/usd\s*[:=]\s*(amount|1\b)/i.test(SRC), false);
  assert.equal(SRC.includes("toFixed(2)"), false);
});

// ── 3. 확인된 뒤에만 받을 Piggy 가 늘어난다 ───────────────────────────────────────────
check("pending or unknown never credits the target Piggy", () => {
  const { intent } = startFunding(base);
  for (const status of [FUNDING_STATE.PENDING, FUNDING_STATE.UNKNOWN, FUNDING_STATE.FAILED, FUNDING_STATE.CANCELLED]) {
    const out = applyFundingResult(intent, { status });
    assert.equal(out.creditsTarget, false, `${status} must not credit the Piggy`);
  }
});

check("an unknown outcome refuses to retry and demands reconciliation", () => {
  const { intent } = startFunding(base);
  const out = applyFundingResult(intent, { status: FUNDING_STATE.UNKNOWN });
  assert.equal(out.retry, false);
  assert.equal(out.reason, "unknown_outcome_must_reconcile");
});

check("a confirmed arrival on the wrong chain, asset or target fails closed", () => {
  const { intent } = startFunding(base);
  const good = { status: FUNDING_STATE.CONFIRMED, chain: "monad-mainnet", asset: "USDC", target: PIGGY_ADDR, amount: "30", txHash: "0xabc" };
  assert.equal(applyFundingResult(intent, good).creditsTarget, true);
  assert.equal(applyFundingResult(intent, { ...good, chain: "monad-testnet" }).reason, "wrong_chain");
  assert.equal(applyFundingResult(intent, { ...good, asset: "AUSD" }).reason, "wrong_asset");
  assert.equal(applyFundingResult(intent, { ...good, target: "0x0000000000000000000000000000000000000001" }).reason, "wrong_target");
  assert.equal(applyFundingResult(intent, { ...good, txHash: null }).reason, "missing_evidence");
});

check("the target Piggy is credited with what actually arrived, not what was requested", () => {
  const { intent } = startFunding(base);
  const out = applyFundingResult(intent, { status: FUNDING_STATE.CONFIRMED, chain: "monad-mainnet", asset: "USDC", target: PIGGY_ADDR, amount: "29.5", txHash: "0xabc", at: "t" });
  assert.equal(out.credited.amount, "29.5");
  assert.equal(out.intent.requestedAmount, "30");
  assert.equal(out.intent.resolvedAmount, "29.5");
  assert.equal(out.receipt.action, "add_money");
});

check("the same deposit yields the same evidence key, so it cannot double-credit", () => {
  const r = { chain: "monad-mainnet", asset: "USDC", target: PIGGY_ADDR, txHash: "0xabc" };
  assert.equal(fundingEvidenceKey(r), fundingEvidenceKey({ ...r }));
  assert.notEqual(fundingEvidenceKey(r), fundingEvidenceKey({ ...r, txHash: "0xdef" }));
});

// ── 4. 가스 후원은 충전 방법이 아니다 ───────────────────────────────────────────
check("the gas grant can never be registered as a funding method", () => {
  assert.equal(isFundingMethod("api-grant"), false);
  assert.equal(isFundingMethod("local-relayer-grant"), false);
  assert.equal(isFundingMethod(FUNDING_RAIL.DIRECT_WALLET_TRANSFER), true);
});

// ── 5. 의도 보존 — 하던 일에서 쫓아내지 않는다 ──────────────────────────────────
check("a Piggy short of its own at-home money reports exactly how much more is needed", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  assert.equal(c.sufficient, false);
  assert.equal(c.shortfall, "30");
  assert.equal(c.intent.piggyId, "honeybun");
  assert.equal(c.intent.amount, "50");
});

check("enough money means no funding detour at all", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "10", asset: "USDC", decimals: 6, available: "20" });
  assert.equal(c.sufficient, true);
  assert.equal(fundingRequestForShortfall(c), null);
});

check("the shortfall opens the SAME funding primitive, carrying the original intent", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  // [A-553 Lane A] 도착 체인은 호출자가 명시한다 — 지금 이 세션의 실제 실행 체인(예: testnet)이다.
  const req = fundingRequestForShortfall(c, { target: PIGGY_ADDR, chain: "monad-testnet" });
  assert.equal(req.amount, "30");
  assert.equal(req.arrival.asset, "USDC");           // 주려던 자산 그대로
  assert.equal(req.arrival.chain, "monad-testnet");  // 숨은 mainnet 리터럴이 아니라 넘긴 체인 그대로
  assert.deepEqual(req.resumeAfter, { piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6 });
  assert.equal(req.targetPiggyId, "honeybun");          // 받는 곳 = 돈이 필요한 바로 그 Piggy
  // 이 요청은 funding-entry 의 startFunding 이 그대로 받는다 — 두 번째 구현 없음. expectedChain 도
  // 같은 값을 넘겨야 DEFAULT_ARRIVAL(mainnet) 과 다르다는 이유로 조용히 막히지 않는다.
  const started = startFunding({ ...base, amount: req.amount, arrival: req.arrival, target: PIGGY_ADDR, targetPiggyId: req.targetPiggyId, expectedChain: "monad-testnet" });
  assert.equal(started.intent.targetPiggyId, "honeybun");
  assert.equal(started.intent.targetChain, "monad-testnet");
  assert.equal(started.ok, true);
});

check("the shortfall funding request fails closed without an explicit runtime chain — no hidden mainnet default", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  assert.equal(fundingRequestForShortfall(c, { target: PIGGY_ADDR }), null);
  assert.equal(fundingRequestForShortfall(c, { target: PIGGY_ADDR, chain: "" }), null);
});

check("startFunding's asset-change gate compares against an explicit expectedChain when one is given, not always the mainnet default", () => {
  const testnetArrival = { chain: "monad-testnet", asset: "USDC" };
  // 아무 expectedChain 없이 부르면(옛 호출부) 지금까지처럼 mainnet 기본값과 비교 -> ack 필요
  const withoutExpected = startFunding({ ...base, arrival: testnetArrival });
  assert.equal(withoutExpected.ok, false);
  assert.equal(withoutExpected.reason, "asset_change_not_acknowledged");
  // 실제 런타임 체인을 명시하면(제품 경로) 같은 체인/자산은 ack 없이 그대로 열린다
  const withExpected = startFunding({ ...base, arrival: testnetArrival, expectedChain: "monad-testnet" });
  assert.equal(withExpected.ok, true);
  assert.equal(withExpected.intent.targetChain, "monad-testnet");
});

check("there is no second Add money implementation", () => {
  // bridge 는 자기 상태기계를 만들지 않고 funding-entry 의 상태를 읽는다
  assert.match(BRIDGE, /from "\.\/funding-entry\.js"/);
  assert.equal(/FUNDING_STATE = Object\.freeze/.test(BRIDGE), false);
});

check("cancelling returns safely without touching balances", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  const out = resumeAfterFunding({ state: FUNDING_STATE.CANCELLED }, c.intent);
  assert.equal(out.resume, true);
  assert.equal(out.funded, false);
  assert.equal(out.mutated, false);
  assert.deepEqual(out.intent.piggyId, "honeybun");
});

check("confirmed funding resumes the original intent", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  const out = resumeAfterFunding({ state: FUNDING_STATE.CONFIRMED, creditsTarget: true, credited: { piggyId: "honeybun" } }, c.intent, { available: "50", decimals: 6 });
  assert.equal(out.resume, true);
  assert.equal(out.funded, true);
  assert.equal(out.stillShort, null);
  assert.equal(out.intent.amount, "50");
  assert.equal(out.nextStep, "ask_permission_for_action");
});

check("funding less than needed keeps the intent and says it is still short", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  const out = resumeAfterFunding({ state: FUNDING_STATE.CONFIRMED, creditsTarget: true, credited: { piggyId: "honeybun" } }, c.intent, { available: "40", decimals: 6 });
  assert.equal(out.stillShort, "10");
  assert.equal(out.nextStep, "ask_more_funding");
});

// ── 6. 충전 확인은 권한이 아니다 ────────────────────────────────────────────────
check("funding confirmation never grants permission to act", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  for (const state of [FUNDING_STATE.CONFIRMED, FUNDING_STATE.CANCELLED, FUNDING_STATE.PENDING]) {
    const out = resumeAfterFunding({ state, creditsTarget: state === FUNDING_STATE.CONFIRMED, credited: { piggyId: "honeybun" } }, c.intent, { available: "50", decimals: 6 });
    assert.equal(out.permissionGranted, false, `${state} must not grant permission`);
  }
  assert.equal(/executionPermission|permitted/.test(BRIDGE), false);
});

// ── 7. UI 는 **역량 상태**가 만든다 (A-495 에서 배선됨) ──────────────────────────
check("the UI reads capability state instead of hardcoding options", () => {
  // 방법 목록을 상수로 박지 않고 listFundingMethods() 결과를 그린다
  assert.match(MAIN, /listFundingMethods\(\{ adapters: FUNDING_ADAPTERS \}\)/);
  assert.match(MAIN, /fundingMethodsMarkup\(fundingMethods\(\)\)/);
  // 개수를 2/3 으로 못 박는 코드가 없다
  assert.equal(/slice\(0,\s*[23]\)/.test(MAIN), false);
});

check("no funding adapter is registered yet, so nothing is shown as available", () => {
  assert.match(MAIN, /const FUNDING_ADAPTERS = \[\]/);
});

// ── 8. [A-510 D-core] 받는 곳은 명시된 Piggy 하나다 ────────────────────────────
check("funding cannot start without an explicit target Piggy", () => {
  const out = startFunding({ ...base, targetPiggyId: undefined });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "missing_target_piggy");
  assert.equal(startFunding({ ...base, targetPiggyId: "  " }).reason, "missing_target_piggy");
});

check("a confirmed arrival credits exactly that Piggy (id + address) and nothing called Home", () => {
  const { intent } = startFunding(base);
  const out = applyFundingResult(intent, { status: FUNDING_STATE.CONFIRMED, chain: "monad-mainnet", asset: "USDC", target: PIGGY_ADDR, amount: "30", txHash: "0xabc" });
  assert.equal(out.creditsTarget, true);
  assert.equal(out.credited.piggyId, "honeybun");
  assert.equal(out.credited.target, PIGGY_ADDR);
  assert.equal(out.receipt.piggyId, "honeybun");
  assert.equal("creditsHome" in out, false);
});

check("funding that landed on another Piggy does not resume this intent", () => {
  const c = checkIntentFunding({ piggyId: "honeybun", action: "work", amount: "50", asset: "USDC", decimals: 6, available: "20" });
  const out = resumeAfterFunding({ state: FUNDING_STATE.CONFIRMED, creditsTarget: true, credited: { piggyId: "mochi" } }, c.intent, { available: "50", decimals: 6 });
  assert.equal(out.resume, false);
  assert.equal(out.reason, "funded_other_piggy");
  assert.equal(out.permissionGranted, false);
});

check("no Home-owned funding semantics remain in the live modules", () => {
  assert.equal(/creditsHome\s*:/.test(SRC), false);
  assert.equal(/homeAvailable|checkGiveIntent/.test(BRIDGE.split("이력:")[0] + BRIDGE.split("A-508 에서 Home 은 돈을 갖지 않게 됐다")[1]), false);
  assert.equal(/checkGiveIntent|homeAvailable|beginFundingForShortfall\(/.test(MAIN.replace(/이력: A-495 의 `beginFundingForShortfall`/, "")), false);
});

console.log(`\n${pass}/${pass} PASS`);
