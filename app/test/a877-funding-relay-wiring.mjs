// [A-877] Add Money Relay runtime wiring — validated funding plan only. No UI, no network, no wallet/sign/send.
// Fixtures only. globalThis.fetch is replaced by a tripwire for the whole run.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("A-877 test: network forbidden"); };

const {
  startFunding, FUNDING_METHOD, FUNDING_RAIL, FUNDING_PLAN_STATE, planFundingRoute, gasTopupAllowed,
} = await import("../src/funding-entry.js");
const { planRelayFunding, relayQuoteRequestForFunding, RELAY_FUNDING_RAIL_ID } = await import("../src/funding-intent-bridge.js");
const { MONAD_USDC_ADDRESS } = await import("../src/funding-rail-relay.js");

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };

const USER = "0x1111111111111111111111111111111111111111";
const RECIP = "0x2222222222222222222222222222222222222222";
const OTHER = "0x4444444444444444444444444444444444444444";
// [A-895 P-A] the deposit target/spender is the PINNED /chains depository for origin 8453 (was an opaque 0x3333… + 0xdeadbeef).
const ROUTER = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
const ORDER_ID = "0x" + "a1".repeat(32);
const DEPOSIT = (depositor = USER, token = BASE_USDC, amt = 20000000n, id = ORDER_ID) => "0xe8017952" + depositor.slice(2).toLowerCase().padStart(64, "0") + token.slice(2).toLowerCase().padStart(64, "0") + amt.toString(16).padStart(64, "0") + id.slice(2);
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NOW = 1_800_000_000_000;

const AP = (amt, spender = ROUTER) => "0x095ea7b3" + spender.slice(2).toLowerCase().padStart(64, "0") + amt.toString(16).padStart(64, "0");
const XFER = (to, amt) => "0xa9059cbb" + to.slice(2).toLowerCase().padStart(64, "0") + amt.toString(16).padStart(64, "0");
const fixture = () => ({
  steps: [
    { id: "approve", kind: "transaction", requestId: "0xabc123", items: [{ data: { chainId: 8453, to: BASE_USDC, value: "0", data: AP(20000000n) } }] },
    { id: "deposit", kind: "transaction", requestId: "0xabc123", items: [{ data: { chainId: 8453, to: ROUTER, value: "0", data: DEPOSIT() } }] },
  ],
  fees: {},
  // pre-A-909 baseline: orderData was { deadline } only; now also a live-shaped output + inputs (flat deadline kept).
  protocol: { v2: { orderId: ORDER_ID, orderData: { deadline: 1_900_000_000, output: { chainId: "monad", payments: [{ recipient: RECIP.toLowerCase(), currency: MONAD_USDC_ADDRESS.toLowerCase() }], deadline: 1_900_000_000 }, inputs: [{ payment: { chainId: "base" }, refunds: [{ chainId: "base", recipient: USER.toLowerCase(), deadline: 1_900_000_000 }, { chainId: "monad", recipient: RECIP.toLowerCase(), deadline: 1_900_000_000 }] }] }, paymentDetails: { depository: ROUTER, currency: BASE_USDC.toLowerCase(), amount: "20000000" } } },
  details: {
    recipient: RECIP,
    currencyIn: { currency: { chainId: 8453, address: BASE_USDC, decimals: 6 }, amount: "20000000" },
    currencyOut: { currency: { chainId: 143, address: MONAD_USDC_ADDRESS.toLowerCase(), decimals: 6 }, amount: "19977610", minimumAmount: "19578107" },
    timeEstimate: 1,
    totalImpact: { usd: "-0.02", percent: "-0.11" },
  },
});

const adapters = [{ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: FUNDING_RAIL.INTERNAL_ROUTE }];
const mkIntent = (over = {}) => startFunding({
  method: FUNDING_METHOD.FROM_ANOTHER_WALLET, amount: "20", arrival: { chain: "monad-mainnet", asset: "USDC" },
  target: RECIP, targetPiggyId: "piggy-1", adapters, expectedChain: "monad-mainnet", ...over,
}).intent;
const INTENT = mkIntent();
const binding = (over = {}) => ({
  source: { chainId: 8453, token: BASE_USDC, decimals: 6 },
  destination: { chainId: 143, token: MONAD_USDC_ADDRESS, decimals: 6 },
  recipient: RECIP,
  inputAmountUnits: "20000000",
  ...over,
});
const policy = () => ({
  routeClass: "intent_liquidity", assetClass: "stable", maxPriceImpactPct: 1, maxSlippagePct: 3, quoteMaxAgeMs: 30000,
  requireSimulation: false, allowUnlimitedAllowance: false, materialOutputDeteriorationPct: 1,
});
const safety = (over = {}) => ({
  policy: policy(), nowMs: NOW, allowedSpenders: [ROUTER], allowedStepTargets: [ROUTER],
  destinationRecords: [{ address: RECIP, source: "piggy_registry" }], ...over,
});
const run = (o = {}) => planRelayFunding({
  intent: INTENT, binding: binding(), rawQuote: fixture(), payer: USER, receivedAtMs: NOW - 1000, expiresAtMs: NOW + 30000, safety: safety(), ...o,
});
const runQ = (mut, o = {}) => { const q = fixture(); mut(q); return run({ rawQuote: q, ...o }); };
const rejected = (r, code) => r.state === FUNDING_PLAN_STATE.REJECTED && r.ok === false && r.plan === null && (!code || r.reasons.includes(code));
const blocked = (r, code) => r.state === FUNDING_PLAN_STATE.BLOCKED && r.ok === false && r.plan === null && (!code || r.reasons.includes(code));

// ── entry wiring ─────────────────────────────────────────────────────────────
t("intent opens on the provider-neutral rail", INTENT && INTENT.railId === RELAY_FUNDING_RAIL_ID && INTENT.target === RECIP);

// ── happy path: READY_FOR_CONFIRMATION only after the safety gate said DO ─────
const ok = run();
t("ready", ok.state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION && ok.ok === true && ok.decision === "DO");
t("safety gate ran (DO, no reasons)", ok.safety && ok.safety.gate && ok.safety.gate.decision === "DO" && ok.safety.gate.findings !== undefined && ok.safety.reasons.length === 0);
t("gate saw provenance from records", ok.safety.gate.destinationProvenance.status === "known" && ok.safety.gate.destinationProvenance.destinationFirstSeen === false);
const P = ok.plan;
t("plan binding explicit", P.binding.source.chainId === 8453 && P.binding.source.token === BASE_USDC && P.binding.destination.chainId === 143
  && P.binding.destination.token === MONAD_USDC_ADDRESS && P.binding.recipient === RECIP && P.binding.inputAmountUnits === "20000000");
t("plan arrival", P.arrival.expectedUnits === "19977610" && P.arrival.minimumUnits === "19578107" && P.arrival.minimum === "19.578107");
t("plan topup off", P.topupGas.requested === false && P.topupGas.deductedUnits === "0");
t("plan intent", P.intent.targetPiggyId === "piggy-1" && P.intent.targetChain === "monad-mainnet" && P.intent.targetAsset === "USDC");
t("plan key binds quote", P.planKey.includes("0xabc123") && P.planKey.includes(RECIP.toLowerCase()) && P.quoteId === "0xabc123");

// ── no execution authority ───────────────────────────────────────────────────
t("execute false", P.execute === false && P.executionAuthority === false && P.permissionGranted === false && P.requiresConfirmation === true);
t("result carries no authority", ok.executionAuthority === false && ok.permissionGranted === false);
const deepFrozenNoFns = (x) => {
  if (typeof x === "function") return false;
  if (x === null || typeof x !== "object") return true;
  if (!Object.isFrozen(x)) return false;
  return Object.values(x).every(deepFrozenNoFns);
};
t("plan deep-frozen data, no functions", deepFrozenNoFns(P));
t("no signer/wallet fields", !/sign|wallet|privateKey|send/i.test(Object.keys(P).join(",")));

// ── topupGas off unless explicit future policy input ─────────────────────────
t("gasTopupAllowed default false", gasTopupAllowed(null) === false && gasTopupAllowed({}) === false && gasTopupAllowed({ gasTopup: { enabled: "true" } }) === false && gasTopupAllowed({ gasTopup: true }) === false);
const rq = relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: USER });
t("request topup false by default", rq.ok && rq.request.topupGas === false && !("topupGasAmount" in rq.request));
const rqJunk = relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: USER, fundingPolicy: { gasTopup: { enabled: 1, amountUnits: "1000000" } } });
t("request truthy-not-true policy stays off", rqJunk.ok && rqJunk.request.topupGas === false);
const rqCaller = relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: USER, topupGas: true, topupGasAmount: "1000000" });
t("caller topup flag ignored", rqCaller.ok && rqCaller.request.topupGas === false);
const rqOn = relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: USER, fundingPolicy: { gasTopup: { enabled: true, amountUnits: "1000000" } } });
t("explicit policy turns topup on", rqOn.ok && rqOn.request.topupGas === true && rqOn.request.topupGasAmount === "1000000");
t("request dest pinned + recipient bound", rq.request.destinationChainId === 143 && rq.request.destinationCurrency === MONAD_USDC_ADDRESS && rq.request.recipient === RECIP);
t("request recipient != intent rejected", !relayQuoteRequestForFunding({ intent: INTENT, binding: binding({ recipient: OTHER }), user: USER }).ok);
const topupQuote = (q) => { q.details.currencyGasTopup = { currency: { chainId: 143, address: "0x0000000000000000000000000000000000000000", decimals: 18 }, amount: "50000000000000000", amountUsd: "1" }; };
t("unrequested topup in quote rejected", rejected(runQ(topupQuote)));
t("policy on, quote without topup rejected", rejected(run({ fundingPolicy: { gasTopup: { enabled: true, amountUnits: "1000000" } } })));

const goodRailForR6 = () => ({
  railId: RELAY_FUNDING_RAIL_ID, validated: true, quoteId: "0xabc123",
  sourceChainId: 8453, sourceToken: BASE_USDC, sourceDecimals: 6, inputAmountUnits: "20000000",
  destinationChainId: 143, destinationToken: MONAD_USDC_ADDRESS, destinationDecimals: 6, recipient: RECIP,
  expectedOutUnits: "19977610", minOutUnits: "19578107", timeEstimateSeconds: 1, priceImpactPct: 0.11, totalEffectiveCost: "0.02",
  topupGas: { requested: false, deductedUnits: "0" }, routeClass: "intent_liquidity", liquidityStatus: "quoted",
  receivedAtMs: NOW - 1000, expiresAtMs: NOW + 30000,
  steps: [{ chainId: 8453, to: BASE_USDC, value: "0", data: AP(20000000n) }, { chainId: 8453, to: ROUTER, value: "0", data: DEPOSIT() }],
});
// ── mismatched quote can never produce a confirmable plan ────────────────────
t("dest chain mismatch", rejected(runQ((q) => { q.details.currencyOut.currency.chainId = 10143; })));
t("dest token mismatch", rejected(runQ((q) => { q.details.currencyOut.currency.address = BASE_USDC; })));
t("dest decimals mismatch", rejected(runQ((q) => { q.details.currencyOut.currency.decimals = 18; })));
t("recipient mismatch", rejected(runQ((q) => { q.details.recipient = OTHER; })));
t("source chain mismatch", rejected(runQ((q) => { q.details.currencyIn.currency.chainId = 1; })));
t("source token mismatch", rejected(runQ((q) => { q.details.currencyIn.currency.address = OTHER; })));
t("source decimals mismatch", rejected(runQ((q) => { q.details.currencyIn.currency.decimals = 18; }), "quote_source_token_mismatch"));
t("input amount mismatch", rejected(runQ((q) => { q.details.currencyIn.amount = "20000001"; })));
t("step chain mismatch", rejected(runQ((q) => { q.steps[1].items[0].data.chainId = 1; })));
t("transfer on source token rejected (R6)", rejected(runQ((q) => { q.steps.push({ id: "x", kind: "transaction", requestId: "0xabc123", items: [{ data: { chainId: 8453, to: BASE_USDC, value: "0", data: XFER(OTHER, 1n) } }] }); }), "relay_step_unexpected_call"));
// [A-895 P-A] the same transfer is still refused by the provider-neutral boundary on its own (defence in depth)
t("transfer on source token rejected at the direct boundary (R6)", rejected(planFundingRoute({ intent: INTENT, binding: binding(), railQuote: (() => { const r = goodRailForR6(); r.steps.push({ chainId: 8453, to: BASE_USDC, value: "0", data: XFER(OTHER, 1n) }); return r; })(), safety: safety() }), "source_token_call_not_approve"));
// [A-895 P-A] payer is required; refundTo + includeProtocolData in the request body
t("payer missing → rejected (no calldata binding without a payer)", rejected(run({ payer: undefined }), "relay_payer_invalid"));
t("request body: refundTo defaults to the payer EXPLICITLY, includeProtocolData:true", rq.request.refundTo === USER && rq.request.includeProtocolData === true);
t("request body: explicit refundTo kept", relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: USER, refundTo: OTHER }).request.refundTo === OTHER);
t("request body: malformed refundTo → no request", relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: USER, refundTo: "0x12" }).ok === false);
// pre-A-909 baseline: a quote with no orderData.output was accepted; now refused.
t("A-909 no orderData.output -> rejected (relay_order_output_missing)", rejected(run({ rawQuote: (() => { const q = fixture(); delete q.protocol.v2.orderData.output; return q; })() }), "relay_order_output_missing"));
t("binding recipient != intent target", rejected(run({ binding: binding({ recipient: OTHER }), rawQuote: (() => { const q = fixture(); q.details.recipient = OTHER; q.protocol.v2.orderData.output.payments[0].recipient = OTHER; q.protocol.v2.orderData.inputs[0].refunds[1].recipient = OTHER /* pre-A-909 baseline: no output to keep in step */; return q; })() }), "binding_recipient_not_intent"));
t("binding dest not relay-supported", rejected(run({ binding: binding({ destination: { chainId: 10143, token: "0x534b2f3A21130d7a60830c2Df862319e593943A3", decimals: 6 } }) }), "binding_destination_not_supported_by_rail"));
const testnetIntent = mkIntent({ arrival: { chain: "monad-testnet", asset: "USDC" }, expectedChain: "monad-testnet" });
t("testnet intent vs mainnet binding rejected", rejected(run({ intent: testnetIntent }), "binding_destination_chain_not_intent"));
t("binding missing", rejected(run({ binding: undefined })));
t("binding source incomplete", rejected(run({ binding: binding({ source: { chainId: 8453, token: BASE_USDC } }) })));
t("validate cannot override binding", rejected(runQ((q) => { q.details.recipient = OTHER; }, { validate: { recipient: OTHER } })));
t("bad quote shape", rejected(run({ rawQuote: null })));
t("wrong rail intent", rejected(run({ intent: { ...INTENT, railId: FUNDING_RAIL.ONRAMP_PROVIDER } })));

// direct boundary: a forged / mismatched normalized rail quote cannot pass either
const goodRail = () => ({
  railId: RELAY_FUNDING_RAIL_ID, validated: true, quoteId: "0xabc123",
  sourceChainId: 8453, sourceToken: BASE_USDC, sourceDecimals: 6, inputAmountUnits: "20000000",
  destinationChainId: 143, destinationToken: MONAD_USDC_ADDRESS, destinationDecimals: 6, recipient: RECIP,
  expectedOutUnits: "19977610", minOutUnits: "19578107", timeEstimateSeconds: 1, priceImpactPct: 0.11, totalEffectiveCost: "0.02",
  topupGas: { requested: false, deductedUnits: "0" }, routeClass: "intent_liquidity", liquidityStatus: "quoted",
  receivedAtMs: NOW - 1000, expiresAtMs: NOW + 30000,
  steps: [{ chainId: 8453, to: BASE_USDC, value: "0", data: AP(20000000n) }, { chainId: 8453, to: ROUTER, value: "0", data: "0xdeadbeef" }],
});
const direct = (mut, o = {}) => { const r = goodRail(); mut(r); return planFundingRoute({ intent: INTENT, binding: binding(), railQuote: r, safety: safety(), ...o }); };
t("direct good rail ready", direct(() => {}).state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);
t("direct unvalidated rejected", rejected(direct((r) => { r.validated = false; }), "quote_not_validated_by_rail"));
t("direct validated:'true' rejected", rejected(direct((r) => { r.validated = "true"; })));
t("direct dest chain string rejected", rejected(direct((r) => { r.destinationChainId = "143"; }), "quote_destination_chain_mismatch"));
t("direct dest token", rejected(direct((r) => { r.destinationToken = BASE_USDC; }), "quote_destination_token_mismatch"));
t("direct recipient", rejected(direct((r) => { r.recipient = OTHER; }), "quote_recipient_mismatch"));
t("direct source chain", rejected(direct((r) => { r.sourceChainId = 1; }), "quote_source_chain_mismatch"));
t("direct source token", rejected(direct((r) => { r.sourceToken = OTHER; }), "quote_source_token_mismatch"));
t("direct amount", rejected(direct((r) => { r.inputAmountUnits = "1"; }), "quote_input_amount_mismatch"));
t("direct minOut 0", rejected(direct((r) => { r.minOutUnits = "0"; }), "quote_min_out_not_positive"));
t("direct minOut > out", rejected(direct((r) => { r.minOutUnits = "29977610"; }), "quote_min_out_above_out"));
t("direct rail mismatch", rejected(direct((r) => { r.railId = FUNDING_RAIL.ONRAMP_PROVIDER; }), "quote_rail_not_intent"));
t("direct topup without policy", rejected(direct((r) => { r.topupGas = { requested: true, deductedUnits: "1000000" }; }), "topup_not_allowed_by_policy"));
t("direct hidden topup deduction", rejected(direct((r) => { r.topupGas = { requested: false, deductedUnits: "1" }; }), "topup_not_allowed_by_policy"));
t("direct topup unreadable", rejected(direct((r) => { delete r.topupGas; }), "topup_state_unreadable"));
t("direct approve > input", rejected(direct((r) => { r.steps[0].data = AP(20000001n); }), "approve_exceeds_input"));
t("direct approve unlimited", rejected(direct((r) => { r.steps[0].data = AP((1n << 256n) - 1n); }), "approve_exceeds_input"));
t("direct approve on other token", rejected(direct((r) => { r.steps[0].to = OTHER; }), "approve_not_on_source_token"));
t("direct two approvals", rejected(direct((r) => { r.steps.unshift({ chainId: 8453, to: BASE_USDC, value: "0", data: AP(1n) }); }), "multiple_approvals"));
t("direct value on erc20", rejected(direct((r) => { r.steps[1].value = "1"; }), "step_value_nonzero"));
t("direct no steps", rejected(direct((r) => { r.steps = []; }), "steps_missing"));

// ── [R2 · F1] native source: total step value bounded by input ──────────────
const NATIVE = "0x0000000000000000000000000000000000000000";
const nativeBinding = binding({ source: { chainId: 8453, token: NATIVE, decimals: 18 } });
const nativeRail = (values) => ({ ...goodRail(), sourceToken: NATIVE, sourceDecimals: 18, steps: values.map((v) => ({ chainId: 8453, to: ROUTER, value: v, data: "0xdeadbeef" })) });
const nat = (values) => planFundingRoute({ intent: INTENT, binding: nativeBinding, railQuote: nativeRail(values), safety: safety() });
t("F1 native one step = input ready", nat(["20000000"]).state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);
t("F1 native two steps each = input rejected", rejected(nat(["20000000", "20000000"]), "step_value_total_exceeds_input"));
t("F1 native split within input ready", nat(["10000000", "10000000"]).state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);
t("F1 native split over input by 1 rejected", rejected(nat(["10000000", "10000001"]), "step_value_total_exceeds_input"));

// ── [R2 · F2] snapshot once: getter / Proxy flips cannot split check from plan ──
const ATTACKER = "0x5555555555555555555555555555555555555555";
const flipAfter = (obj, key, good, evil, n = 1) => { let reads = 0; Object.defineProperty(obj, key, { enumerable: true, configurable: true, get: () => (reads++ < n ? good : evil) }); return obj; };
// Strict: one read per field means the flip is never seen, so the result must be READY *and* carry the checked values.
const isReadyWithGood = (r, check) => r.state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION && check(r.plan);
const directRaw = (rail) => planFundingRoute({ intent: INTENT, binding: binding(), railQuote: rail, safety: safety() });
{
  const r = goodRail(); const goodSteps = r.steps;
  const evilSteps = [...goodSteps, { chainId: 8453, to: BASE_USDC, value: "0", data: XFER(ATTACKER, 20000000n) }];
  flipAfter(r, "steps", goodSteps, evilSteps);
  const out = directRaw(r);
  t("F2 steps getter flip: plan = checked steps", isReadyWithGood(out, (p) => p.steps.length === 2 && !p.steps.some((s) => s.data.startsWith("0xa9059cbb"))));
}
{
  const r = goodRail(); flipAfter(r.steps[1], "to", ROUTER, ATTACKER);
  const out = directRaw(r);
  t("F2 step.to getter flip: plan to = checked", isReadyWithGood(out, (p) => p.steps[1].to === ROUTER));
}
{
  const r = goodRail(); flipAfter(r.steps[1], "value", "0", "999999999");
  const out = directRaw(r);
  t("F2 step.value getter flip: plan value = checked", isReadyWithGood(out, (p) => p.steps[1].value === "0"));
}
{
  const r = goodRail(); flipAfter(r, "minOutUnits", "19578107", "1");
  const out = directRaw(r);
  t("F2 minOutUnits getter flip: plan min = checked", isReadyWithGood(out, (p) => p.arrival.minimumUnits === "19578107"));
}
{
  const r = goodRail(); flipAfter(r.steps[0], "data", AP(20000000n), AP(20000000n, ATTACKER));
  const out = directRaw(r);
  t("F2 step.data getter flip: plan data = checked", isReadyWithGood(out, (p) => p.steps[0].data === AP(20000000n)));
}
{
  // Proxy on the steps array: index 1 turns evil after its first read.
  const base = goodRail(); const arr = base.steps; let reads = 0;
  base.steps = new Proxy(arr, { get(tg, k, rc) { if (k === "1") return reads++ < 1 ? tg[1] : { chainId: 8453, to: ATTACKER, value: "0", data: "0xdeadbeef" }; return Reflect.get(tg, k, rc); } });
  const out = directRaw(base);
  t("F2 Proxy steps flip: plan = checked", isReadyWithGood(out, (p) => p.steps[1].to === ROUTER));
}
{
  // Proxy on the whole quote: minOutUnits and recipient flip after first read.
  const counts = {}; const flips = { minOutUnits: "1", recipient: ATTACKER };
  const prox = new Proxy(goodRail(), { get(tg, k, rc) { if (k in flips) { counts[k] = (counts[k] || 0) + 1; if (counts[k] > 1) return flips[k]; } return Reflect.get(tg, k, rc); } });
  const out = directRaw(prox);
  t("F2 Proxy quote flip: plan = checked", isReadyWithGood(out, (p) => p.arrival.minimumUnits === "19578107" && p.binding.recipient === RECIP));
  t("F2 Proxy quote: each field read once", Object.values(counts).every((n) => n === 1));
}
{
  const r = goodRail(); Object.defineProperty(r, "minOutUnits", { enumerable: true, get() { throw new Error("boom"); } });
  t("F2 throwing getter -> input_unreadable", rejected(directRaw(r), "input_unreadable"));
}
{
  const r = goodRail(); const inherited = Object.create({ minOutUnits: "19578107" }); Object.assign(inherited, r); delete inherited.minOutUnits;
  t("F2 inherited quote field not read", rejected(directRaw(inherited), "quote_out_invalid"));
}

// ── [R2 · L1] uint256 cap + unlimited approve ────────────────────────────────
const MAX256 = (1n << 256n) - 1n;
t("L1 input > uint256 rejected", rejected(planFundingRoute({ intent: INTENT, binding: binding({ inputAmountUnits: (MAX256 + 1n).toString() }), railQuote: { ...goodRail(), inputAmountUnits: (MAX256 + 1n).toString() }, safety: safety() }), "binding_amount_invalid"));
{
  const huge = MAX256.toString();
  const r = { ...goodRail(), inputAmountUnits: huge, steps: [{ chainId: 8453, to: BASE_USDC, value: "0", data: AP(MAX256) }, goodRail().steps[1]] };
  t("L1 approve 2^256-1 with huge input rejected", rejected(planFundingRoute({ intent: INTENT, binding: binding({ inputAmountUnits: huge }), railQuote: r, safety: safety() }), "approve_unlimited"));
  const r2 = { ...goodRail(), inputAmountUnits: huge, steps: [{ chainId: 8453, to: BASE_USDC, value: "0", data: AP(1n << 255n) }, goodRail().steps[1]] };
  t("L1 approve 2^255 rejected", rejected(planFundingRoute({ intent: INTENT, binding: binding({ inputAmountUnits: huge }), railQuote: r2, safety: safety() }), "approve_unlimited"));
}

// ── [R2 · L2] prototype pollution does not reach the gate inputs ─────────────
{
  Object.prototype.allowedStepTargets = [ATTACKER];
  try {
    const out = directRaw({ ...goodRail(), steps: [goodRail().steps[0], { chainId: 8453, to: ATTACKER, value: "0", data: "0xdeadbeef" }] });
    const sf = safety(); delete sf.allowedStepTargets;
    const out2 = planFundingRoute({ intent: INTENT, binding: binding(), railQuote: { ...goodRail(), steps: [goodRail().steps[0], { chainId: 8453, to: ATTACKER, value: "0", data: "0xdeadbeef" }] }, safety: sf });
    t("L2 polluted allowedStepTargets ignored", blocked(out) && blocked(out2, "step_targets_unverified"));
  } finally { delete Object.prototype.allowedStepTargets; }
  Object.prototype.gasTopup = { enabled: true };
  try {
    t("L2 polluted gasTopup ignored", gasTopupAllowed({}) === false && rejected(direct((r) => { r.topupGas = { requested: true, deductedUnits: "0" }; }, { fundingPolicy: {} }), "topup_not_allowed_by_policy"));
  } finally { delete Object.prototype.gasTopup; }
  Object.prototype.policy = policy();
  try {
    const sf = safety(); delete sf.policy;
    t("L2 polluted policy ignored", blocked(planFundingRoute({ intent: INTENT, binding: binding(), railQuote: goodRail(), safety: sf }), "policy_missing"));
  } finally { delete Object.prototype.policy; }
}

// ── [R2 · L4] plan stays deep-frozen even with object-valued intent fields ───
{
  const out = planFundingRoute({ intent: { ...INTENT, method: { x: 1 }, requestedAmount: { y: 2 } }, binding: binding(), railQuote: { ...goodRail(), steps: goodRail().steps.map((s) => ({ ...s, kind: { z: 3 } })) }, safety: safety() });
  t("L4 non-string metadata coerced, plan deep-frozen", out.state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION && out.plan.intent.method === null && out.plan.steps[0].kind === null && deepFrozenNoFns(out.plan));
}

// ── execution safety before READY ────────────────────────────────────────────
t("no policy -> blocked UNKNOWN", (() => { const r = run({ safety: safety({ policy: null }) }); return blocked(r, "policy_missing") && r.decision === "UNKNOWN"; })());
t("no destination records -> blocked", blocked(run({ safety: safety({ destinationRecords: undefined }) }), "destination_provenance_unknown"));
t("recipient only in history -> blocked", blocked(run({ safety: safety({ destinationRecords: [{ address: RECIP, source: "history" }] }) })));
t("spender not allowed -> NAH", (() => { const r = run({ safety: safety({ allowedSpenders: [OTHER] }) }); return blocked(r, "spender_not_verified") && r.decision === "NAH"; })());
t("step targets missing -> blocked", blocked(run({ safety: safety({ allowedStepTargets: undefined }) }), "step_targets_unverified"));
t("step target not allowed -> NAH", (() => { const r = run({ safety: safety({ allowedStepTargets: [OTHER] }) }); return blocked(r, "step_target_not_allowed") && r.decision === "NAH"; })());
t("expired quote -> blocked", blocked(run({ expiresAtMs: NOW - 1 }), "quote_expired"));
t("stale quote -> blocked", blocked(run({ receivedAtMs: NOW - 60000 }), "quote_stale"));
t("missing expiry -> blocked", blocked(run({ expiresAtMs: undefined }), "missing_material_fields"));
t("impact over policy -> blocked", blocked(runQ((q) => { q.details.totalImpact.percent = "-2.5"; }), "price_impact_over_policy"));
t("slippage over policy -> blocked", blocked(runQ((q) => { q.details.currencyOut.minimumAmount = "18000000"; }), "slippage_over_policy"));
t("unknown cost -> blocked", blocked(runQ((q) => { q.details.totalImpact.usd = null; }), "missing_material_fields"));
t("replayed intent -> blocked", blocked(run({ safety: safety({ consumedIntents: new Set([`piggy-1:${RELAY_FUNDING_RAIL_ID}:0xabc123`]) }) }), "replay_intent_already_used"));
t("simulation required but none -> blocked", blocked(run({ safety: safety({ policy: { ...policy(), requireSimulation: true } }) }), "simulation_incomplete"));
t("policy for other route -> blocked", blocked(run({ safety: safety({ policy: { ...policy(), routeClass: "token_bridge" } }) }), "policy_route_class_mismatch"));
t("prior pending -> blocked", blocked(run({ safety: safety({ lifecycleState: "pending" }) }), "prior_action_pending"));

// ── no live fetch, no execution path in source ───────────────────────────────
t("no fetch was called", fetchCalls === 0);
const ENTRY = readFileSync(new URL("../src/funding-entry.js", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("../src/funding-intent-bridge.js", import.meta.url), "utf8");
for (const [name, src] of [["funding-entry", ENTRY], ["funding-intent-bridge", BRIDGE]]) {
  t(`${name}: no network call`, !/[^\w.]fetch\(|globalThis\.fetch|XMLHttpRequest|WebSocket/.test(src));
  t(`${name}: no sign/send/broadcast`, !/sendTransaction|sendRawTransaction|signTransaction|signMessage|signTypedData|eth_send|writeContract|walletClient|privateKey|broadcast\(/.test(src));
}
t("bridge does not use requestRelayQuote (validate-override path)", !/requestRelayQuote\s*\(/.test(BRIDGE) && !/import\s*\{[^}]*requestRelayQuote[^}]*\}/.test(BRIDGE));
t("entry stays provider-neutral (no rail module import)", !ENTRY.includes("funding-rail-relay") && !/relay/i.test(ENTRY.split("[A-877]")[1] || ""));

// ── UI bytes unchanged ───────────────────────────────────────────────────────
const sha = (p) => createHash("sha256").update(readFileSync(new URL(p, import.meta.url))).digest("hex");
t("add-money.js bytes unchanged", sha("../src/add-money.js") === "a5f506a89b9e1e07d11de9a42c61e07fc5f6f64e06d2468ef0b56cec9eda2c8b");
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
t("no product UI caller", !/planRelayFunding|planFundingRoute|relayQuoteRequestForFunding/.test(MAIN));

console.log(`a877: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
