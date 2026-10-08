// [A-872] Relay funding adapter — fake fetch fixtures only. No network, no keys, no tx.
import {
  MONAD_USDC_ADDRESS, MONAD_CHAIN_ID, RELAY_REASON as R,
  buildRelayQuoteRequest, validateRelayQuote, requestRelayQuote, formatUnits, parseUnits,
} from "../src/funding-rail-relay.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("FAIL", name); } };

const USER = "0x1111111111111111111111111111111111111111";
const RECIP = "0x2222222222222222222222222222222222222222";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const AP = (amt) => "0x095ea7b3" + "3".repeat(40).padStart(64, "0") + amt.toString(16).padStart(64, "0");
const fixture = () => ({
  steps: [
    { id: "approve", kind: "transaction", requestId: "0xabc123", items: [{ data: { chainId: 8453, to: BASE_USDC, value: "0", data: AP(20000000n) } }] },
    { id: "deposit", kind: "transaction", requestId: "0xabc123", items: [{ data: { chainId: 8453, to: "0x3333333333333333333333333333333333333333", value: "0", data: "0xdeadbeef" } }] },
  ],
  fees: {},
  details: {
    recipient: RECIP,
    currencyIn: { currency: { chainId: 8453, address: BASE_USDC, decimals: 6 }, amount: "20000000" },
    currencyOut: { currency: { chainId: 143, address: MONAD_USDC_ADDRESS.toLowerCase(), decimals: 6 }, amount: "19977610", minimumAmount: "19578107" },
    timeEstimate: 1,
    totalImpact: { usd: "-0.02", percent: "-0.11" },
  },
});
const exp = { recipient: RECIP, originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000" };
const mut = (fn) => { const q = fixture(); fn(q); return validateRelayQuote(q, exp); };

// constants
t("monad usdc address", MONAD_USDC_ADDRESS === "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" && MONAD_CHAIN_ID === 143);
t("units", formatUnits(19977610n) === "19.97761" && parseUnits("1.5") === 1500000n && parseUnits("1.1234567") === null);

// request: topup off by default
const rq = buildRelayQuoteRequest({ user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000" });
t("request ok", rq.ok && rq.request.topupGas === false && !("topupGasAmount" in rq.request));
// [A-895 P-A F4] quote/v2 body: explicit refundTo + includeProtocolData:true; refundTo is required (no hidden default)
t("request carries refundTo + includeProtocolData:true", rq.request.refundTo === USER && rq.request.includeProtocolData === true);
t("refundTo missing rejected (no default)", !buildRelayQuoteRequest({ user: USER, recipient: RECIP, originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000" }).ok);
t("refundTo malformed rejected", !buildRelayQuoteRequest({ user: USER, recipient: RECIP, refundTo: "0x12", originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000" }).ok);
t("request dest pinned", rq.request.destinationChainId === 143 && rq.request.destinationCurrency === MONAD_USDC_ADDRESS);
const rqOn = buildRelayQuoteRequest({ user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000", topupGas: true, topupGasAmount: "1000000" });
t("topup explicit", rqOn.ok && rqOn.request.topupGas === true && rqOn.request.topupGasAmount === "1000000");
t("topup true w/o amount rejected", !buildRelayQuoteRequest({ user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "1", topupGas: true }).ok);
t("topup truthy non-bool rejected", !buildRelayQuoteRequest({ user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "1", topupGas: "yes" }).ok);
t("bad recipient rejected", !buildRelayQuoteRequest({ user: USER, recipient: "0x12", refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "1" }).ok);
t("zero amount rejected", !buildRelayQuoteRequest({ user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "0" }).ok);

// happy path
const good = validateRelayQuote(fixture(), exp);
t("good ok", good.ok && good.reasons.length === 0);
t("good net==gross w/o topup", good.quote.netUsdc === "19.97761" && good.quote.grossUsdcApprox === "19.97761" && good.quote.topupGas.requested === false);
t("good minOut/eta/impact", good.quote.minOutUsdc === "19.578107" && good.quote.timeEstimateSeconds === 1 && good.quote.totalImpact.percent === -0.11);
t("plan build-only", good.plan.execute === false && good.plan.steps.length === 2 && good.plan.requestId === "0xabc123" && Object.isFrozen(good.plan));
t("no universal impact threshold", validateRelayQuote(Object.assign(fixture(), {}), exp).ok && mut((q) => { q.details.totalImpact.percent = "-9.9"; }).ok);

// fail closed
const has = (r, code) => !r.ok && r.plan === null && r.quote === null && r.reasons.includes(code);
t("wrong dest chain", has(mut((q) => { q.details.currencyOut.currency.chainId = 8453; }), R.DEST_CHAIN_MISMATCH));
t("wrong dest token", has(mut((q) => { q.details.currencyOut.currency.address = BASE_USDC; }), R.DEST_TOKEN_MISMATCH));
t("wrong dest token (MON native)", has(mut((q) => { q.details.currencyOut.currency.address = "0x0000000000000000000000000000000000000000"; }), R.DEST_TOKEN_MISMATCH));
t("wrong decimals", has(mut((q) => { q.details.currencyOut.currency.decimals = 18; }), R.DEST_TOKEN_MISMATCH));
t("wrong recipient", has(mut((q) => { q.details.recipient = USER; }), R.RECIPIENT_MISMATCH));
t("missing recipient", has(mut((q) => { delete q.details.recipient; }), R.RECIPIENT_MISMATCH));
t("origin chain mismatch", has(mut((q) => { q.details.currencyIn.currency.chainId = 1; }), R.ORIGIN_MISMATCH));
t("origin amount mismatch", has(mut((q) => { q.details.currencyIn.amount = "20000001"; }), R.ORIGIN_MISMATCH));
t("missing minOut", has(mut((q) => { delete q.details.currencyOut.minimumAmount; }), R.MISSING_MIN_OUT));
t("minOut above out", has(mut((q) => { q.details.currencyOut.minimumAmount = "30000000"; }), R.MIN_OUT_ABOVE_OUT));
t("missing eta", has(mut((q) => { delete q.details.timeEstimate; }), R.MISSING_ETA));
t("missing impact", has(mut((q) => { delete q.details.totalImpact; }), R.MISSING_IMPACT));
t("missing requestId", has(mut((q) => { q.steps.forEach((s) => delete s.requestId); }), R.MISSING_REQUEST_ID));
t("no steps", has(mut((q) => { q.steps = []; }), R.NO_STEPS));
t("step chain mismatch", has(mut((q) => { q.steps[1].items[0].data.chainId = 1; }), R.STEP_CHAIN_MISMATCH));
t("garbage", !validateRelayQuote(null, exp).ok && !validateRelayQuote({}, exp).ok && !validateRelayQuote([], exp).ok);
t("no expected recipient", !validateRelayQuote(fixture(), {}).ok);
t("caller thresholds", has(validateRelayQuote(fixture(), { ...exp, maxEtaSeconds: 0 }), R.ETA_TOO_LONG)
  && has(validateRelayQuote(fixture(), { ...exp, maxImpactPercent: 0.05 }), R.IMPACT_TOO_HIGH)
  && has(validateRelayQuote(fixture(), { ...exp, minOutFloor: "19999999" }), R.MIN_OUT_TOO_LOW));
t("positive impact never flagged", validateRelayQuote(Object.assign(fixture(), { details: { ...fixture().details, totalImpact: { usd: "0.01", percent: "0.05" } } }), { ...exp, maxImpactPercent: 0.01 }).ok);

// gas top-up boundary (documented field: details.currencyGasTopup)
const GT = (o = {}) => ({ currency: { chainId: 143, address: "0x0000000000000000000000000000000000000000", decimals: 18, symbol: "MON" }, amount: "35088900000000000000", amountUsd: "1.000000", ...o });
t("unrequested legacy topup fails", has(mut((q) => { q.gasTopup = { amount: "1" }; }), R.TOPUP_NOT_REQUESTED));
t("unrequested currencyGasTopup nonzero fails", has(mut((q) => { q.details.currencyGasTopup = GT(); }), R.TOPUP_NOT_REQUESTED));
t("unrequested currencyGasTopup garbage amount fails", has(mut((q) => { q.details.currencyGasTopup = GT({ amount: "x" }); }), R.TOPUP_NOT_REQUESTED));
t("unrequested currencyGasTopup zero ok", mut((q) => { q.details.currencyGasTopup = GT({ amount: "0" }); }).ok);
const qt = (fn) => { const q = fixture(); q.details.currencyOut.amount = "18976343"; q.details.currencyOut.minimumAmount = "18600000"; q.details.currencyGasTopup = GT(); if (fn) fn(q); return q; };
const topExp = { ...exp, topupGas: true, topupGasAmount: "1000000" };
const withTopup = validateRelayQuote(qt(), topExp);
t("topup gross(approx) vs net separate", withTopup.ok && withTopup.quote.netUsdc === "18.976343" && withTopup.quote.grossUsdcApprox === "19.976343" && withTopup.quote.topupGas.usdcDeducted === "1");
t("topup display shows net", withTopup.plan.display.netUsdc === "18.976343");
t("topup requested but field missing fails", has(validateRelayQuote(qt((q) => { delete q.details.currencyGasTopup; }), topExp), R.TOPUP_MISSING));
t("topup wrong chain fails", has(validateRelayQuote(qt((q) => { q.details.currencyGasTopup.currency.chainId = 8453; }), topExp), R.TOPUP_MISMATCH));
t("topup non-native fails", has(validateRelayQuote(qt((q) => { q.details.currencyGasTopup.currency.address = MONAD_USDC_ADDRESS; }), topExp), R.TOPUP_MISMATCH));
t("topup zero amount fails", has(validateRelayQuote(qt((q) => { q.details.currencyGasTopup.amount = "0"; }), topExp), R.TOPUP_MISMATCH));
t("topup requested without amount fails", has(validateRelayQuote(qt(), { ...exp, topupGas: true }), R.TOPUP_AMOUNT_INVALID));

// R2 impact percent
for (const [n, v] of [["null", null], ["empty", ""], ["blank", "  "], ["nonnumeric", "abc"], ["NaN", NaN]]) {
  t("impact percent " + n + " fails", has(mut((q) => { q.details.totalImpact.percent = v; }), R.MISSING_IMPACT));
}
t("impact percent 0 string ok", mut((q) => { q.details.totalImpact.percent = "0"; }).ok);

// R3 steps
t("originChainId required", !validateRelayQuote(fixture(), { recipient: RECIP }).ok);
t("step chainId string fails", has(mut((q) => { q.steps[1].items[0].data.chainId = "8453"; }), R.STEP_CHAIN_MISMATCH));
t("step chainId missing fails", has(mut((q) => { delete q.steps[1].items[0].data.chainId; }), R.STEP_CHAIN_MISMATCH));
t("requestIds differ", has(mut((q) => { q.steps[1].requestId = "0xother"; }), R.REQUEST_ID_MISMATCH));
t("one step lacks requestId", has(mut((q) => { delete q.steps[1].requestId; }), R.MISSING_REQUEST_ID));
t("step item without data rejected", has(mut((q) => { q.steps[1].items.push({}); }), R.STEP_NO_DATA));
t("step with empty items rejected", has(mut((q) => { q.steps[1].items = []; }), R.STEP_NO_DATA));
t("step calldata missing rejected", has(mut((q) => { delete q.steps[1].items[0].data.data; }), R.STEP_NO_DATA));
t("attacker deposit nonzero value", has(mut((q) => { q.steps[1].items[0].data.value = "1000000000000000000"; }), R.STEP_VALUE_NONZERO));
t("garbage value rejected", has(mut((q) => { q.steps[1].items[0].data.value = "abc"; }), R.STEP_VALUE_NONZERO));
const approveData = AP;
t("approve == input ok", mut((q) => { q.steps[0].items[0].data.data = approveData(20000000n); }).ok);
t("approve < input ok", mut((q) => { q.steps[0].items[0].data.data = approveData(1n); }).ok);
t("approve input+1 fails", has(mut((q) => { q.steps[0].items[0].data.data = approveData(20000001n); }), R.APPROVE_EXCEEDS_INPUT));
t("unlimited approve fails", has(mut((q) => { q.steps[0].items[0].data.data = approveData(2n ** 256n - 1n); }), R.APPROVE_EXCEEDS_INPUT));
t("malformed approve fails", has(mut((q) => { q.steps[0].items[0].data.data = "0x095ea7b3" + "00"; }), R.APPROVE_MALFORMED));
t("approve on wrong token fails", has(mut((q) => { q.steps[0].items[0].data.to = "0x4444444444444444444444444444444444444444"; q.steps[0].items[0].data.data = approveData(1n); }), R.STEP_TO_MISMATCH));

// R5 decimals exact
t("decimals missing fails", has(mut((q) => { delete q.details.currencyOut.currency.decimals; }), R.DEST_TOKEN_MISMATCH));

// request via fake fetch ([A-895 P-A] quote/v2 only; the response must also pass the deposit-calldata binding)
const DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
const ORDER_ID = "0x" + "a1".repeat(32);
const w = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const boundFixture = () => {
  const q = fixture();
  // pre-A-909 baseline: orderData was { deadline } only; now also a live-shaped output + inputs (flat deadline kept).
  q.protocol = { v2: { orderId: ORDER_ID, orderData: { deadline: 4000000000, output: { chainId: "monad", payments: [{ recipient: RECIP.toLowerCase(), currency: MONAD_USDC_ADDRESS.toLowerCase() }], deadline: 4000000000 }, inputs: [{ payment: { chainId: "base" }, refunds: [{ chainId: "base", recipient: USER.toLowerCase(), deadline: 4000000000 }, { chainId: "monad", recipient: RECIP.toLowerCase(), deadline: 4000000000 }] }] }, paymentDetails: { depository: DEPOSITORY, currency: BASE_USDC.toLowerCase(), amount: "20000000" } } };
  q.steps[0].items[0].data.data = "0x095ea7b3" + w(DEPOSITORY) + (20000000n).toString(16).padStart(64, "0");
  q.steps[1].items[0].data.to = DEPOSITORY;
  q.steps[1].items[0].data.data = "0xe8017952" + w(USER) + w(BASE_USDC) + (20000000n).toString(16).padStart(64, "0") + ORDER_ID.slice(2);
  return q;
};
const calls = [];
const okFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => boundFixture() }; };
const input = { user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000" };
const viaFetch = await requestRelayQuote(input, { fetchImpl: okFetch, validate: { nowMs: 1_791_366_000_000 } });
// [A-901] re-pinned: pre-A-901 baseline URL was "https://api.relay.link/quote/v2"; now the same-origin proxy (which forwards to quote/v2).
// pre-A-909 baseline: no orderData.output was accepted; now refused.
const noOut = await requestRelayQuote({ user: USER, recipient: RECIP, refundTo: USER, originChainId: 8453, originCurrency: BASE_USDC, amount: "20000000" }, { fetchImpl: async () => ({ ok: true, json: async () => { const q = boundFixture(); delete q.protocol.v2.orderData.output; return q; } }), validate: { nowMs: 1_791_366_000_000 } });
t("A-909 no orderData.output -> refused (order_output_missing)", noOut.ok === false && noOut.reasons.includes("order_output_missing"));
t("fetch path ok (bound fixture)", viaFetch.ok && calls.length === 1 && calls[0].url === "/api/relay-quote");
t("no request path posts to /quote", !/\/quote["'`]/.test(readFileSync(new URL("../src/funding-rail-relay.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "")));
t("fetch body topup off + refundTo + includeProtocolData", (() => { const b = JSON.parse(calls[0].init.body); return b.topupGas === false && b.refundTo === USER && b.includeProtocolData === true; })());
t("fetch without refundTo → no request sent", await (async () => { const n = calls.length; const r = await requestRelayQuote({ ...input, refundTo: undefined }, { fetchImpl: okFetch }); return !r.ok && calls.length === n; })());
t("fetch required", !(await requestRelayQuote(input, {})).ok);
t("http error", (await requestRelayQuote(input, { fetchImpl: async () => ({ ok: false, status: 400 }) })).reasons[0] === R.HTTP_ERROR);
t("throw", (await requestRelayQuote(input, { fetchImpl: async () => { throw new Error("x"); } })).reasons[0] === R.FETCH_FAILED);
t("bad json", (await requestRelayQuote(input, { fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("x"); } }) })).reasons[0] === R.BAD_QUOTE_SHAPE);
const mism = boundFixture(); mism.details.recipient = USER;
t("fetch mismatch fails closed", !(await requestRelayQuote(input, { fetchImpl: async () => ({ ok: true, json: async () => mism }) })).ok);
t("fetch: a quote without protocol.v2 / with an opaque deposit fails closed", (await requestRelayQuote(input, { fetchImpl: async () => ({ ok: true, json: async () => fixture() }), validate: { nowMs: 1_791_366_000_000 } })).reasons.includes(R.PROTOCOL_V2_MISSING));
const attackerDeposit = boundFixture(); attackerDeposit.steps[1].items[0].data.data = "0xe8017952" + w(RECIP) + w(BASE_USDC) + (20000000n).toString(16).padStart(64, "0") + ORDER_ID.slice(2);
t("fetch: depositor != payer fails closed", (await requestRelayQuote(input, { fetchImpl: async () => ({ ok: true, json: async () => attackerDeposit }), validate: { nowMs: 1_791_366_000_000 } })).reasons.includes(R.DEPOSIT_DEPOSITOR_NOT_PAYER));

// isolation: no wiring, no network/signing primitives in source
const src = readFileSync(new URL("../src/funding-rail-relay.js", import.meta.url), "utf8");
t("no global fetch use", !/[^\w.]fetch\(/.test(src) && !/globalThis\.fetch/.test(src));
t("no signing/sending", !/sendTransaction|signMessage|eth_sendRawTransaction|privateKey/.test(src));
for (const f of ["main.js", "funding-entry.js", "add-money.js"]) {
  t("not wired into " + f, !readFileSync(new URL("../src/" + f, import.meta.url), "utf8").includes("funding-rail-relay"));
}

console.log(`a872: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
