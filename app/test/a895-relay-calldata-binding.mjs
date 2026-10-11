// [A-895 P-A] Relay calldata binding (A-886 F1-F4, A-877 N1/N2). Node-only, no network (fetch tripwire), no keys, no tx.
//
// Self-contained fixture: it does NOT need the private A-886 harness, so it also runs in a public clone. The
// private /chains snapshot, when present, is used only to cross-check the pinned constant.
// Every attack below must end `plan_rejected` (never READY); the one valid fixture must reach READY_FOR_CONFIRMATION.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, decodeFunctionData, parseAbi, toFunctionSelector, getAddress } from "viem";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("A-895 test: network forbidden"); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FE = await import("../src/funding-entry.js");
const BR = await import("../src/funding-intent-bridge.js");
const RR = await import("../src/funding-rail-relay.js");
const ES = await import("../src/execution-safety.js");
const { startFunding, FUNDING_METHOD, FUNDING_RAIL, FUNDING_PLAN_STATE, planFundingRoute } = FE;
const { planRelayFunding, relayQuoteRequestForFunding, relayCalldataHash } = BR;
const { MONAD_USDC_ADDRESS, RELAY_PINNED_CHAINS, RELAY_QUOTE_V2_PATH, RELAY_API_BASE, decodeRelayDepositCalldata, decodeRelayApproveCalldata,
  buildRelayQuoteRequest, requestRelayQuote, verifyRelayDepositBinding } = RR;

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

const ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)",
  "function depositNative(address depositor, bytes32 id) payable",
]);
const lab = (n) => getAddress("0x" + createHash("sha256").update("a895/" + n).digest("hex").slice(0, 40)); // label-derived, no key
const PAYER = lab("payer"), RECIP = lab("piggy"), ATTACKER = lab("attacker"), OTHER_TOKEN = lab("foreign-token");
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEP = "0x4cd00e387622c35bddb9b4c962c136462338bc31"; // /chains 8453 protocol.v2.depository (A-885 / A-886 raw/relay-chains.json)
const INPUT = 20000000n;
const ORDER_ID = "0x" + createHash("sha256").update("a895/order").digest("hex");
const NOW_MS = 1_791_366_000_000;
const DEADLINE = 1_791_374_400;
const apData = (spender, amt) => encodeFunctionData({ abi: ABI, functionName: "approve", args: [spender, amt] });
const depData = (depositor = PAYER, token = BASE_USDC, amt = INPUT, id = ORDER_ID) => encodeFunctionData({ abi: ABI, functionName: "depositErc20", args: [depositor, token, amt, id] });
const natData = (depositor = PAYER, id = ORDER_ID) => encodeFunctionData({ abi: ABI, functionName: "depositNative", args: [depositor, id] });

// [A-909] pre-A-909 baseline: orderData was the flat { deadline: DEADLINE } (legacy synthetic shape). Now live-shaped: deadline lives in output.deadline; output/inputs are bound.
const ORDER_DATA = () => ({ output: { chainId: "monad", payments: [{ recipient: RECIP.toLowerCase(), currency: MONAD_USDC_ADDRESS.toLowerCase() }], deadline: DEADLINE }, inputs: [{ payment: { chainId: "base" }, refunds: [{ chainId: "base", recipient: PAYER.toLowerCase(), deadline: DEADLINE }, { chainId: "monad", recipient: RECIP.toLowerCase(), deadline: DEADLINE }] }] });
const fixture = () => ({
  requestId: "0x" + "11".repeat(32),
  steps: [
    { id: "approve", kind: "transaction", requestId: "0x" + "11".repeat(32), items: [{ data: { from: PAYER, to: BASE_USDC, data: apData(DEP, INPUT), value: "0", chainId: 8453 } }] },
    { id: "deposit", kind: "transaction", requestId: "0x" + "11".repeat(32), items: [{ data: { from: PAYER, to: DEP, data: depData(), value: "0", chainId: 8453 } }] },
  ],
  fees: {},
  details: {
    sender: PAYER, recipient: RECIP,
    currencyIn: { currency: { chainId: 8453, address: BASE_USDC.toLowerCase(), decimals: 6 }, amount: INPUT.toString() },
    currencyOut: { currency: { chainId: 143, address: MONAD_USDC_ADDRESS.toLowerCase(), decimals: 6 }, amount: "19977610", minimumAmount: "19578107" },
    totalImpact: { usd: "-0.02239", percent: "-0.11" }, timeEstimate: 1,
  },
  protocol: { v2: { orderId: ORDER_ID, hubType: "onchain", orderData: ORDER_DATA(), paymentDetails: { chainId: "base", depository: DEP, currency: BASE_USDC.toLowerCase(), amount: INPUT.toString() } } },
});

const adapters = [{ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: FUNDING_RAIL.INTERNAL_ROUTE }];
const INTENT = startFunding({ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, amount: "20", arrival: { chain: "monad-mainnet", asset: "USDC" }, target: RECIP, targetPiggyId: "piggy-a895", adapters, expectedChain: "monad-mainnet" }).intent;
const binding = (over = {}) => ({ source: { chainId: 8453, token: BASE_USDC, decimals: 6 }, destination: { chainId: 143, token: MONAD_USDC_ADDRESS, decimals: 6 }, recipient: RECIP, inputAmountUnits: INPUT.toString(), ...over });
const POLICY = { routeClass: "intent_liquidity", assetClass: "stable", maxPriceImpactPct: 1, maxSlippagePct: 3, quoteMaxAgeMs: 30000, requireSimulation: false, allowUnlimitedAllowance: false, materialOutputDeteriorationPct: 1 };
const safety = (over = {}, pol = {}) => ({ policy: { ...POLICY, ...pol }, nowMs: NOW_MS, allowedSpenders: [DEP], allowedStepTargets: [DEP], destinationRecords: [{ address: RECIP, source: "piggy_registry" }], ...over });
const run = (o = {}) => planRelayFunding({ intent: INTENT, binding: binding(), rawQuote: fixture(), payer: PAYER, receivedAtMs: NOW_MS - 1000, expiresAtMs: NOW_MS + 30000, safety: safety(), ...o });
const runQ = (mut, o = {}) => { const q = fixture(); mut(q); return run({ rawQuote: q, ...o }); };
const READY = FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION;
const rejWith = (r, code) => r.state === FUNDING_PLAN_STATE.REJECTED && r.ok === false && r.plan === null && r.executionAuthority === false && r.reasons.some((x) => x === code || x === `relay_${code}`);
const dep = (q) => q.steps[1].items[0].data;
const apr = (q) => q.steps[0].items[0].data;

// ── 1. pure ABI decode (cross-checked against viem) ──────────────────────────────────────────────
t("selectors match the ABI (depositErc20 / depositNative)", RR.RELAY_DEPOSIT_ERC20_SELECTOR === toFunctionSelector(ABI[1]) && RR.RELAY_DEPOSIT_NATIVE_SELECTOR === toFunctionSelector(ABI[2]));
const d1 = decodeRelayDepositCalldata(depData());
t("decode depositErc20 == viem", d1 && d1.fn === "depositErc20" && d1.depositor === PAYER.toLowerCase() && d1.token === BASE_USDC.toLowerCase() && d1.amount === INPUT && d1.id === ORDER_ID);
const v1 = decodeFunctionData({ abi: ABI, data: depData() });
t("viem agrees on the same bytes", v1.functionName === "depositErc20" && v1.args[0] === PAYER && v1.args[2] === INPUT && v1.args[3] === ORDER_ID);
const d2 = decodeRelayDepositCalldata(natData());
t("decode depositNative", d2 && d2.fn === "depositNative" && d2.depositor === PAYER.toLowerCase() && d2.id === ORDER_ID);
t("decode approve", (() => { const a = decodeRelayApproveCalldata(apData(DEP, INPUT)); return a && a.spender === DEP && a.amount === INPUT; })());
t("decode refuses trailing byte / short / odd / non-string / other selector", [depData() + "00", depData().slice(0, -2), depData().slice(0, -1), null, undefined, 5, "0x", "0xdeadbeef", apData(DEP, 1n)].every((x) => decodeRelayDepositCalldata(x) === null));
t("decode refuses a non-canonical address word (dirty upper bytes)", decodeRelayDepositCalldata(depData().replace(/^(0x[0-9a-f]{8})0{24}/i, "$1" + "ff".repeat(12))) === null);
t("decode accepts upper-case hex", decodeRelayDepositCalldata("0x" + depData().slice(2).toUpperCase().replace(/^E8017952/, "e8017952")) !== null);

// ── 2. pinned depository table ───────────────────────────────────────────────────────────────────
t("pinned table: frozen, origin 8453 only, depository == A-885/A-886 /chains value", Object.isFrozen(RELAY_PINNED_CHAINS) && Object.isFrozen(RELAY_PINNED_CHAINS[8453]) && Object.keys(RELAY_PINNED_CHAINS).join() === "8453" && RELAY_PINNED_CHAINS[8453].v2Depository === DEP);
const snap = privatePath("ops/receipts/A886_relay_funding_sim/raw/relay-chains.json");
if (existsSync(snap)) {
  const buf = readFileSync(snap);
  const base = JSON.parse(buf).chains.find((c) => c.id === 8453);
  t("pinned depository == private /chains snapshot (sha256 pinned)", base.protocol.v2.depository === RELAY_PINNED_CHAINS[8453].v2Depository && RELAY_PINNED_CHAINS[8453].snapshot.includes(createHash("sha256").update(buf).digest("hex")));
} else console.log("SKIP a895 snapshot cross-check: private /chains snapshot not present");

// ── 3. the valid fixture reaches READY (and only it) ─────────────────────────────────────────────
const ok = run();
t("VALID fixture → READY_FOR_CONFIRMATION, gate DO, no authority", ok.state === READY && ok.ok === true && ok.decision === "DO" && ok.plan.execute === false && ok.plan.executionAuthority === false && ok.plan.permissionGranted === false && ok.plan.requiresConfirmation === true);
t("valid plan steps == verified calldata (to/data/value)", ok.plan.steps.length === 2 && ok.plan.steps[0].data === apData(DEP, INPUT) && ok.plan.steps[0].to.toLowerCase() === BASE_USDC.toLowerCase() && ok.plan.steps[1].to.toLowerCase() === DEP && ok.plan.steps[1].data === depData() && ok.plan.steps.every((x) => x.value === "0"));
const bound = verifyRelayDepositBinding(fixture(), { originChainId: 8453, payer: PAYER, refundTo: PAYER, /* pre-A-909 baseline: no refundTo (fixture had no refunds) */ sourceToken: BASE_USDC, inputAmountUnits: INPUT, nowMs: NOW_MS });
t("verifyRelayDepositBinding ok + frozen binding", bound.ok && Object.isFrozen(bound.binding) && bound.binding.depository === DEP && bound.binding.orderId === ORDER_ID && bound.binding.deadlineSec === DEADLINE);

// ── 4. attacks → plan_rejected ───────────────────────────────────────────────────────────────────
const ATT = [
  ["F1 wrong id", (q) => { dep(q).data = depData(PAYER, BASE_USDC, INPUT, "0x" + "ab".repeat(32)); }, "deposit_id_not_order_id"],
  ["F1 attacker depositor", (q) => { dep(q).data = depData(ATTACKER); }, "deposit_depositor_not_payer"],
  ["F1 half amount", (q) => { dep(q).data = depData(PAYER, BASE_USDC, INPUT / 2n); }, "deposit_amount_not_input"],
  ["F1 amount + 1", (q) => { dep(q).data = depData(PAYER, BASE_USDC, INPUT + 1n); }, "deposit_amount_not_input"],
  ["F1 foreign token", (q) => { dep(q).data = depData(PAYER, OTHER_TOKEN); }, "deposit_token_not_source"],
  ["deadline missing", (q) => { delete q.protocol.v2.orderData.output.deadline; }, "order_deadline_unknown"],
  ["orderData missing", (q) => { delete q.protocol.v2.orderData; }, "order_deadline_unknown"],
  ["deadline string", (q) => { q.protocol.v2.orderData.output.deadline = String(DEADLINE); }, "order_deadline_unknown"],
  ["deadline null", (q) => { q.protocol.v2.orderData.output.deadline = null; }, "order_deadline_unknown"],
  ["deadline float", (q) => { q.protocol.v2.orderData.output.deadline = DEADLINE + 0.5; }, "order_deadline_unknown"],
  ["deadline in milliseconds (unit unproven)", (q) => { q.protocol.v2.orderData.output.deadline = DEADLINE * 1000; }, "order_deadline_unknown"],
  ["deadline expired", (q) => { q.protocol.v2.orderData.output.deadline = NOW_MS / 1000 - 1; }, "order_expired"],
  ["deadline == now (not strictly later)", (q) => { q.protocol.v2.orderData.output.deadline = NOW_MS / 1000; }, "order_expired"],
  ["wrong depository (step target = attacker)", (q) => { dep(q).to = ATTACKER; }, "deposit_target_not_depository"],
  ["wrong depository (quote paymentDetails AND target = attacker)", (q) => { q.protocol.v2.paymentDetails.depository = ATTACKER.toLowerCase(); dep(q).to = ATTACKER; }, "deposit_target_not_depository"],
  ["paymentDetails depository forged only", (q) => { q.protocol.v2.paymentDetails.depository = ATTACKER.toLowerCase(); }, "payment_details_mismatch"],
  ["paymentDetails currency forged", (q) => { q.protocol.v2.paymentDetails.currency = OTHER_TOKEN.toLowerCase(); }, "payment_details_mismatch"],
  ["paymentDetails amount forged", (q) => { q.protocol.v2.paymentDetails.amount = "1"; }, "payment_details_mismatch"],
  ["allowance below input", (q) => { apr(q).data = apData(DEP, INPUT - 1n); }, "approve_amount_not_input"],
  ["allowance above input", (q) => { apr(q).data = apData(DEP, INPUT + 1n); }, "approve_exceeds_input"],
  ["allowance zero", (q) => { apr(q).data = apData(DEP, 0n); }, "approve_amount_not_input"],
  ["allowance unlimited", (q) => { apr(q).data = apData(DEP, (1n << 256n) - 1n); }, "approve_exceeds_input"],
  ["spender = attacker", (q) => { apr(q).data = apData(ATTACKER, INPUT); }, "approve_spender_not_depository"],
  ["spender = approvalProxy (not the v2 deposit path)", (q) => { apr(q).data = apData("0xccc88a9d1b4ed6b0eaba998850414b24f1c315be", INPUT); }, "approve_spender_not_depository"],
  ["approve missing", (q) => { q.steps.splice(0, 1); }, "approve_count"],
  ["two approves", (q) => { q.steps.unshift(clone(q.steps[0])); }, "approve_count"],
  ["approve after deposit", (q) => { q.steps.reverse(); }, "approve_after_deposit"],
  ["approve on a foreign token", (q) => { apr(q).to = OTHER_TOKEN; }, "step_to_mismatch"],
  ["deposit step missing", (q) => { q.steps.splice(1, 1); }, "deposit_step_count"],
  ["two deposit steps", (q) => { q.steps.push(clone(q.steps[1])); }, "deposit_step_count"],
  ["native fn on an ERC20 source", (q) => { dep(q).data = natData(); }, "deposit_function_mismatch"],
  ["deposit carries value on an ERC20 source", (q) => { dep(q).value = "1"; }, "step_value_nonzero"],
  ["deposit on another chain", (q) => { dep(q).chainId = 1; }, "step_chain_mismatch"],
  ["undecodable deposit (truncated)", (q) => { dep(q).data = depData().slice(0, -2); }, "deposit_undecodable"],
  ["unexpected extra call (opaque bytes)", (q) => { q.steps.push({ id: "x", kind: "transaction", requestId: q.steps[0].requestId, items: [{ data: { to: DEP, data: "0xdeadbeef", value: "0", chainId: 8453 } }] }); }, "step_unexpected_call"],
  ["step from != payer", (q) => { dep(q).from = ATTACKER; }, "sender_not_payer"],
  ["details.sender != payer", (q) => { q.details.sender = ATTACKER; }, "sender_not_payer"],
  ["no protocol.v2 (includeProtocolData missing)", (q) => { delete q.protocol; }, "protocol_v2_missing"],
  ["orderId malformed", (q) => { q.protocol.v2.orderId = "0x1234"; }, "protocol_v2_missing"],
  ["too many steps", (q) => { for (let i = 0; i < 20; i++) q.steps.push(clone(q.steps[0])); }, "steps_too_many"],
];
for (const [name, mut, code] of ATT) {
  const r = runQ(mut);
  t(`ATTACK ${name} → plan_rejected (${code})`, rejWith(r, code) && r.state !== READY);
}
t("origin chain not pinned (binding on chain 10) → plan_rejected", (() => {
  const r = runQ((q) => { q.details.currencyIn.currency.chainId = 10; q.steps.forEach((s) => { s.items[0].data.chainId = 10; }); }, { binding: binding({ source: { chainId: 10, token: BASE_USDC, decimals: 6 } }) });
  return rejWith(r, "origin_chain_not_pinned");
})());
t("payer missing / malformed / array → plan_rejected", [undefined, null, "0x12", [PAYER], 5].every((p) => rejWith(run({ payer: p }), "payer_invalid")));
t("payer is another account than the quote's depositor → plan_rejected", rejWith(run({ payer: ATTACKER }), "deposit_depositor_not_payer"));
t("caller allowlists cannot widen the pinned depository", rejWith(runQ((q) => { dep(q).to = ATTACKER; apr(q).data = apData(ATTACKER, INPUT); }, { safety: safety({ allowedSpenders: [ATTACKER], allowedStepTargets: [ATTACKER] }) }), "deposit_target_not_depository"));
t("validate{} cannot loosen the binding", rejWith(runQ((q) => { dep(q).data = depData(ATTACKER); }, { validate: { recipient: ATTACKER, originCurrency: OTHER_TOKEN, amount: "1" } }), "deposit_depositor_not_payer"));
t("no attack in the table reached READY (count)", ATT.every(([, mut]) => runQ(mut).state !== READY));

// native source (depositNative): value == input, no approve
const NAT_IN = 10_000_000_000_000_000n;
const natQ = () => { const q = fixture(); q.steps = [{ id: "deposit", kind: "transaction", requestId: q.requestId, items: [{ data: { from: PAYER, to: DEP, data: natData(), value: NAT_IN.toString(), chainId: 8453 } }] }];
  q.details.currencyIn = { currency: { chainId: 8453, address: ZERO, decimals: 18 }, amount: NAT_IN.toString() }; q.protocol.v2.paymentDetails.currency = ZERO; q.protocol.v2.paymentDetails.amount = NAT_IN.toString(); return q; };
const natB = binding({ source: { chainId: 8453, token: ZERO, decimals: 18 }, inputAmountUnits: NAT_IN.toString() });
const natRun = (mut) => { const q = natQ(); if (mut) mut(q); return run({ rawQuote: q, binding: natB }); };
t("native source: depositNative with value == input → READY", natRun().state === READY);
t("native source: value != input → plan_rejected", rejWith(natRun((q) => { q.steps[0].items[0].data.value = (NAT_IN - 1n).toString(); }), "deposit_amount_not_input"));
t("native source: depositErc20 on a native source → plan_rejected", rejWith(natRun((q) => { q.steps[0].items[0].data.data = depData(); }), "deposit_function_mismatch"));
t("native source: an approve step is refused", rejWith(natRun((q) => { q.steps.unshift(fixture().steps[0]); }), "step_to_mismatch"));

// ── 5. deposit-path approve amount = input; sim slot (more in a886) ─────────────────────────────
t("approve == input is accepted, nothing else is", run().state === READY && [INPUT - 1n, INPUT + 1n, 0n].every((a) => runQ((q) => { apr(q).data = apData(DEP, a); }).state === FUNDING_PLAN_STATE.REJECTED));
const steps = ok.plan.steps.map((s) => ({ chainId: s.chainId, to: s.to, value: s.value, data: s.data }));
const HASH = relayCalldataHash(steps);
const SIM = (o = {}) => ({ status: "ok", calldataHash: HASH, chainId: 8453, blockNumber: 52288754, origin: { payerDebitedUnits: INPUT.toString(), depositoryCreditedUnits: INPUT.toString() }, ...o });
const REQ = { requireSimulation: true };
t("sim slot: no record + requireSimulation → BLOCKED simulation_incomplete", (() => { const r = run({ safety: safety({}, REQ) }); return r.state === FUNDING_PLAN_STATE.BLOCKED && r.reasons.includes("simulation_incomplete"); })());
t("sim slot: bound ok record + requireSimulation → READY", run({ safety: safety({}, REQ), simulation: SIM() }).state === READY);
t("sim slot: another calldata hash → plan_rejected", rejWith(run({ safety: safety({}, REQ), simulation: SIM({ calldataHash: "f".repeat(64) }) }), "simulation_not_bound_to_calldata"));
t("sim slot: uppercase / short hash → plan_rejected (malformed)", [HASH.toUpperCase(), HASH.slice(2)].every((h) => rejWith(run({ safety: safety({}, REQ), simulation: SIM({ calldataHash: h }) }), "simulation_malformed")));
t("sim slot: status ok with a shortfall → plan_rejected", rejWith(run({ safety: safety({}, REQ), simulation: SIM({ origin: { payerDebitedUnits: INPUT.toString(), depositoryCreditedUnits: (INPUT - 1n).toString() } }) }), "simulation_postcondition_mismatch"));
t("sim slot: prototype-polluted / extra keys are refused", rejWith(run({ safety: safety({}, REQ), simulation: JSON.parse('{"__proto__":{"status":"ok"},"status":"ok"}') }), "simulation_malformed"));
t("relayCalldataHash is order- and byte-sensitive, null on junk", relayCalldataHash(steps) !== relayCalldataHash([...steps].reverse()) && relayCalldataHash([]) === null && relayCalldataHash([{ chainId: 1, to: DEP, value: 0, data: "0x" }]) === null);

// ── 6. request builder: quote/v2, refundTo, includeProtocolData (data only) ──────────────────────
const rq = relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: PAYER });
t("request: refundTo explicit (= payer) and includeProtocolData:true", rq.ok && rq.request.refundTo === PAYER && rq.request.includeProtocolData === true && rq.request.user === PAYER);
t("request: caller refundTo is kept; malformed refundTo → no request", relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: PAYER, refundTo: RECIP }).request.refundTo === RECIP && relayQuoteRequestForFunding({ intent: INTENT, binding: binding(), user: PAYER, refundTo: "0x1" }).request === null);
t("request: builder without refundTo → not ok", buildRelayQuoteRequest({ user: PAYER, recipient: RECIP, originChainId: 8453, originCurrency: BASE_USDC, amount: "1" }).ok === false);
t("request path is /quote/v2 (constant + source), never /quote", RELAY_QUOTE_V2_PATH === "/quote/v2" && RELAY_API_BASE === "/api/relay-quote" /* [A-901] re-pinned; pre-A-901 baseline "https://api.relay.link" */ && !/RELAY_API_BASE \+ "\/quote"/.test(readFileSync(path.join(ROOT, "app/src/funding-rail-relay.js"), "utf8").replace(/\/\/.*$/gm, "")));
const sent = [];
const viaFake = await requestRelayQuote({ user: PAYER, recipient: RECIP, refundTo: PAYER, originChainId: 8453, originCurrency: BASE_USDC, amount: INPUT.toString() },
  { fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => fixture() }; }, validate: { nowMs: NOW_MS } });
t("requestRelayQuote (injected fake fetch): one POST to /quote/v2 with refundTo + includeProtocolData, result binds", sent.length === 1 && sent[0].url === "/api/relay-quote" /* [A-901] re-pinned; pre-A-901 baseline "https://api.relay.link/quote/v2" */ && sent[0].body.includeProtocolData === true && sent[0].body.refundTo === PAYER && viaFake.ok);

// ── 7. N2 future timestamps / N1 length caps ─────────────────────────────────────────────────────
const blocked = (r, code) => r.state === FUNDING_PLAN_STATE.BLOCKED && r.plan === null && r.reasons.includes(code);
t("N2: receivedAtMs in the future → BLOCKED quote_timestamp_in_future", blocked(run({ receivedAtMs: NOW_MS + 1 }), "quote_timestamp_in_future") && blocked(run({ receivedAtMs: NOW_MS + 10 * 86400000, expiresAtMs: NOW_MS + 20 * 86400000 }), "quote_timestamp_in_future"));
t("N2: receivedAtMs == now is fine; one ms before is fine", run({ receivedAtMs: NOW_MS }).state === READY && run({ receivedAtMs: NOW_MS - 1 }).state === READY);
t("N2: execution-safety gate direct (quoteTimestamp > nowMs → NAH)", (() => {
  const fields = { intentId: "i", piggyId: "p", action: "add_money", sourceChainId: 1, destinationChainId: 2, inputAsset: { address: BASE_USDC, decimals: 6, identity: "a" }, outputAsset: { address: BASE_USDC, decimals: 6, identity: "b" }, inputAmount: "1", totalEffectiveCost: "0", effectiveOutput: "1", expectedOut: "1", minOut: "1", priceImpactPct: 0, slippagePct: 0, quoteTimestamp: NOW_MS + 5, quoteExpiry: NOW_MS + 60000, routeClass: "intent_liquidity", liquidityStatus: "quoted", simulationStatus: "ok", expectedPostconditions: {}, destination: RECIP, destinationIdentitySource: "piggy_registry" };
  const g = ES.evaluateExecution({ fields, policy: POLICY, expected: {}, nowMs: NOW_MS });
  const ctl = ES.evaluateExecution({ fields: { ...fields, quoteTimestamp: NOW_MS - 1 }, policy: POLICY, expected: {}, nowMs: NOW_MS });
  return g.decision === "NAH" && g.reasons.includes("quote_timestamp_in_future") && !ctl.reasons.includes("quote_timestamp_in_future");
})());
const longList = (n) => Array.from({ length: n }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));
t("N1: allowedStepTargets / allowedSpenders at the cap (64) still plan", run({ safety: safety({ allowedStepTargets: [DEP, ...longList(63)], allowedSpenders: [DEP, ...longList(63)] }) }).state === READY);
t("N1: allowedStepTargets over the cap (65) → plan_rejected input_too_large", (() => { const r = run({ safety: safety({ allowedStepTargets: [DEP, ...longList(64)] }) }); return r.state === FUNDING_PLAN_STATE.REJECTED && r.reasons.includes("input_too_large"); })());
t("N1: allowedSpenders over the cap → plan_rejected input_too_large", run({ safety: safety({ allowedSpenders: [DEP, ...longList(64)] }) }).reasons.includes("input_too_large"));
t("N1: a huge sparse allowlist is refused without iterating it", (() => { const a = []; a.length = 4_000_000_000; const t0 = Date.now(); const r = run({ safety: safety({ allowedStepTargets: a }) }); return r.reasons.includes("input_too_large") && Date.now() - t0 < 2000; })());
t("N1: destinationRecords at the cap (256) plan; over the cap → plan_rejected input_too_large", (() => {
  const recs = (n) => [{ address: RECIP, source: "piggy_registry" }, ...Array.from({ length: n - 1 }, (_, i) => ({ address: longList(300)[i % 300], source: "piggy_registry" }))];
  return run({ safety: safety({ destinationRecords: recs(256) }) }).state === READY && run({ safety: safety({ destinationRecords: recs(257) }) }).reasons.includes("input_too_large");
})());
t("N1: oversized quote JSON → plan_rejected relay_quote_unreadable (size cap, not parsed further)", (() => { const q = fixture(); q.pad = "x".repeat(300000); return rejWith(run({ rawQuote: q }), "quote_unreadable"); })());

// ── 8. single read of the untrusted quote (getter / Proxy cannot make verified != planned) ───────
t("getter that flips on the 2nd read: plan and verification come from ONE snapshot", (() => {
  const good = fixture(); const evil = fixture(); dep(evil).data = depData(ATTACKER);
  let n = 0; const q = { ...good }; Object.defineProperty(q, "steps", { enumerable: true, get() { n += 1; return n === 1 ? good.steps : evil.steps; } });
  const r = run({ rawQuote: q });
  return n === 1 && r.state === READY && r.plan.steps[1].data === depData();
})());
t("Proxy that throws → plan_rejected, never a throw", (() => { const p = new Proxy({}, { get() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } }); let r; try { r = run({ rawQuote: p }); } catch { return false; } return r.state === FUNDING_PLAN_STATE.REJECTED; })());
t("bridge reads the clock once: safety.nowMs getter flip cannot desync the deadline and the gate", (() => {
  let n = 0; const sf = safety(); Object.defineProperty(sf, "nowMs", { enumerable: true, get() { n += 1; return n === 1 ? NOW_MS : DEADLINE * 1000 + 1; } });
  const r = run({ safety: sf }); return r.state === READY && n === 1;
})());

// ── 9. [A-895 review C1] polluted Object.prototype must not fill a missing field ─────────────────
const polluted = (key, value, mut) => {
  const q = fixture(); mut(q);
  const had = Object.prototype.hasOwnProperty.call(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true, enumerable: false });
  try {
    const viaPlan = run({ rawQuote: q });
    const direct = verifyRelayDepositBinding(q, { originChainId: 8453, payer: PAYER, sourceToken: BASE_USDC, inputAmountUnits: INPUT, nowMs: NOW_MS });
    return { viaPlan, direct };
  } finally { if (!had) delete Object.prototype[key]; }
};
{
  const good = fixture();
  const a = polluted("protocol", good.protocol, (q) => { delete q.protocol; });
  t("POLLUTION missing protocol.v2 (Object.prototype.protocol) → plan_rejected, direct verifier also refuses", rejWith(a.viaPlan, "protocol_v2_missing") && a.direct.ok === false);
  const b = polluted("deadline", DEADLINE, (q) => { delete q.protocol.v2.orderData.output.deadline; });
  t("POLLUTION missing orderData.deadline (Object.prototype.deadline) → plan_rejected, direct verifier also refuses", rejWith(b.viaPlan, "order_deadline_unknown") && b.direct.ok === false);
  const c = polluted("paymentDetails", good.protocol.v2.paymentDetails, (q) => { delete q.protocol.v2.paymentDetails; });
  t("POLLUTION missing paymentDetails (Object.prototype.paymentDetails) → plan_rejected, direct verifier also refuses", rejWith(c.viaPlan, "payment_details_mismatch") && c.direct.ok === false);
  t("pollution probes leave Object.prototype clean", !("protocol" in {}) && !("deadline" in {}) && !("paymentDetails" in {}));
  const snapq = RR.snapshotRelayJson(fixture());
  t("snapshotRelayJson: null-prototype copy, readable once, size-capped", Object.getPrototypeOf(snapq) === null && Object.getPrototypeOf(snapq.details) === null && RR.snapshotRelayJson({ x: "y".repeat(100) }, 50) === undefined && RR.snapshotRelayJson(() => 1) === undefined);
  let reads = 0; const once = await requestRelayQuote({ user: PAYER, recipient: RECIP, refundTo: PAYER, originChainId: 8453, originCurrency: BASE_USDC, amount: INPUT.toString() },
    { fetchImpl: async () => ({ ok: true, json: async () => { const q = fixture(); Object.defineProperty(q, "protocol", { enumerable: true, get() { reads += 1; return fixture().protocol; } }); return q; } }), validate: { nowMs: NOW_MS } });
  t("I1: requestRelayQuote snapshots res.json() once (getter read once)", reads === 1 && once.ok);
}

{
  // [A-895 R1] object-valued id / kind / paymentDetails.amount must not throw (String(null-proto object) used to)
  const objCases = [["step id", (q) => { q.steps[0].id = { a: 1 }; }], ["step kind", (q) => { q.steps[1].kind = { a: 1 }; }], ["paymentDetails.amount", (q) => { q.protocol.v2.paymentDetails.amount = { a: 1 }; }]];
  for (const [name, mut] of objCases) {
    let r = null, threw = false;
    try { r = runQ(mut); } catch { threw = true; }
    t(`R1 object-valued ${name} → no throw, plan_rejected`, !threw && r.state === FUNDING_PLAN_STATE.REJECTED && r.plan === null);
  }
}
// ── [A-909 R1] orderData.output / inputs[].payment bound to our request (plan level). pre-A-909 baseline: the fixtures above carry only a flat orderData.deadline (legacy shape, unbound). ──
{
  const withOut = (outMut, inMut) => (q) => {
    q.protocol.v2.orderData = ORDER_DATA();
    if (outMut) outMut(q.protocol.v2.orderData.output);
    if (inMut) inMut(q.protocol.v2.orderData.inputs[0]);
  };
  t("A-909 output-bound fixture (correct output + input chain) → READY_FOR_CONFIRMATION", runQ(withOut()).state === READY);
  const cases = [
    ["no orderData.output at all (legacy flat deadline only)", (q) => { q.protocol.v2.orderData = { deadline: DEADLINE }; }, "order_output_missing"],
    ["output recipient = attacker", withOut((o) => { o.payments[0].recipient = ATTACKER.toLowerCase(); }), "order_output_recipient_mismatch"],
    ["output chainId = arbitrum", withOut((o) => { o.chainId = "arbitrum"; }), "order_output_chain_mismatch"],
    ["output currency = Base USDC", withOut((o) => { o.payments[0].currency = BASE_USDC.toLowerCase(); }), "order_output_currency_mismatch"],
    ["output payments empty", withOut((o) => { o.payments = []; }), "order_output_missing"],
    ["input payment chain = arbitrum", withOut(null, (i) => { i.payment.chainId = "arbitrum"; }), "order_input_chain_mismatch"],
    ["input payment missing", withOut(null, (i) => { delete i.payment; }), "order_input_chain_mismatch"],
  ];
  for (const [name, mut, code] of cases) t(`A-909 R1 ${name} → plan_rejected (${code})`, rejWith(runQ(mut), code));
}
t("no network used (0 fetch)", fetchCalls === 0);
console.log(`a895 relay calldata binding: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
