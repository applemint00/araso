// [A-886] Relay funding local proof: quote validation → safety gate → plan → step/calldata checks,
// over a SYNTHETIC quote fixture (no captured quote with steps exists; quote/v2 needs an API key).
// Node-only, no network (globalThis.fetch is a tripwire), deterministic over the stored fixture and the
// stored read-only simulation record. Never executes, signs or sends anything.
//
// Private inputs (absent in a public clone → the suite prints SKIP and exits 0):
//   _private/ops/harness/a886-relay-funding-sim/{lib.mjs, fixture.json, provenance.json}
//   _private/ops/receipts/A886_relay_funding_sim/{raw/relay-chains.json, sim/run.json}
//
// Policy values below are TEST-ONLY PLACEHOLDERS (lib TEST_ONLY_POLICY): Owner gate G2 is open; they
// are not recommendations.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("A-886 test: network forbidden"); };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const H = path.join(ROOT, "_private/ops/harness/a886-relay-funding-sim");
const R = path.join(ROOT, "_private/ops/receipts/A886_relay_funding_sim");
const need = [path.join(H, "lib.mjs"), path.join(H, "fixture.json"), path.join(H, "provenance.json"), path.join(R, "raw/relay-chains.json")];
if (!need.every((p) => existsSync(p))) {
  console.log("SKIP a886: private A-886 fixture not present (public clone)");
  process.exit(0);
}

const lib = await import(path.join(H, "lib.mjs"));
const { startFunding, FUNDING_METHOD, FUNDING_RAIL, FUNDING_PLAN_STATE, planFundingRoute } = await import("../src/funding-entry.js");
const { planRelayFunding, relayCalldataHash, RELAY_FUNDING_RAIL_ID } = await import("../src/funding-intent-bridge.js");
const { validateRelayQuote, buildRelayQuoteRequest, MONAD_USDC_ADDRESS, RELAY_API_BASE, RELAY_QUOTE_V2_PATH, RELAY_PINNED_CHAINS } = await import("../src/funding-rail-relay.js");

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));

const fixtureText = readFileSync(path.join(H, "fixture.json"), "utf8");
const FX = JSON.parse(fixtureText);
// [A-909 R1] pre-A-909 baseline: the synthetic orderData carried only a flat `deadline` (private fixture.json, sha-pinned, unchanged).
// Re-pin in the test: add a live-shaped output + inputs (same deadline). The flat deadline stays because the private harness lib reads it.
{ const od = FX.protocol.v2.orderData, dl = od.deadline, rc = (c, r) => ({ chainId: c, recipient: r.toLowerCase(), deadline: dl });
  od.output = { chainId: "monad", payments: [{ recipient: FX.details.recipient.toLowerCase(), currency: "0x754704bc059f8c67012fed69bc8a327a5aafb603" }], deadline: dl };
  od.inputs = [{ payment: { chainId: "base" }, refunds: [rc("base", FX.details.sender ?? "0x" + "00".repeat(20)), rc("monad", FX.details.recipient)] }]; }
const PROV = JSON.parse(readFileSync(path.join(H, "provenance.json"), "utf8"));
const chainsBuf = readFileSync(path.join(R, "raw/relay-chains.json"));
const CH = lib.chainsSubset(JSON.parse(chainsBuf));
const DEP = CH[8453].v2Depository;
const APPROVAL_PROXY = CH[8453].contracts.approvalProxy;
const { PAYER, RECIPIENT, ATTACKER, BASE_USDC, INPUT_UNITS, TEST_ONLY_POLICY } = lib;
const NOW_MS = 1_791_366_000_000; // fixed clock (2026-10-07T09:40Z) — before the synthetic orderData deadline
const NOW_SEC = NOW_MS / 1000;

// ── 1. quote provenance ──────────────────────────────────────────────────────────────────────
t("fixture is labelled SYNTHETIC", /^SYNTHETIC/.test(FX._synthetic) && /SYNTHETIC/.test(PROV.label) && /CAPTURED_DATA_ONLY/.test(PROV.label));
t("fixture sha256 pinned in provenance", sha(fixtureText) === PROV.fixtureSha256);
t("/chains snapshot sha256 pinned in provenance", sha(chainsBuf) === PROV.sources.chains.sha256);
t("fixture regenerates byte-identically from the /chains snapshot (deterministic)", `${JSON.stringify(lib.buildSyntheticQuote(CH), null, 2)}\n` === fixtureText);
t("depository = /chains 8453 protocol.v2.depository", lib.sameAddr(DEP, "0x4cd00e387622c35bddb9b4c962c136462338bc31") && lib.sameAddr(FX.protocol.v2.paymentDetails.depository, DEP));
t("origin + destination pinned (Base USDC → Monad native USDC)", FX.details.currencyIn.currency.chainId === 8453 && lib.sameAddr(FX.details.currencyIn.currency.address, BASE_USDC)
  && FX.details.currencyOut.currency.chainId === 143 && lib.sameAddr(FX.details.currencyOut.currency.address, MONAD_USDC_ADDRESS) && lib.sameAddr(CH[143].usdc, MONAD_USDC_ADDRESS));
t("OpenAPI facts recorded: orderData untyped, x-api-key header documented", PROV.openapiFacts.orderDataTyped === false && PROV.openapiFacts.xApiKeyParam?.name === "x-api-key");

t("pinned depository constant in app/src == /chains snapshot 8453 (and the sha256 of the snapshot is the one pinned)", lib.sameAddr(RELAY_PINNED_CHAINS[8453].v2Depository, DEP) && RELAY_PINNED_CHAINS[8453].snapshot.includes(sha(chainsBuf)));

// ── 2. quote validation (A-872 adapter) ──────────────────────────────────────────────────────
const binding = (over = {}) => ({
  source: { chainId: 8453, token: BASE_USDC, decimals: 6 },
  destination: { chainId: 143, token: MONAD_USDC_ADDRESS, decimals: 6 },
  recipient: RECIPIENT, inputAmountUnits: INPUT_UNITS.toString(), ...over,
});
const v = validateRelayQuote(FX, { recipient: RECIPIENT, originChainId: 8453, originCurrency: BASE_USDC, amount: INPUT_UNITS.toString(), topupGas: false });
t("validateRelayQuote ok", v.ok === true && v.reasons.length === 0);
t("validated quote numbers", v.quote.netUsdc === "19.97761" && v.quote.minOutUsdc === "19.578107" && v.quote.timeEstimateSeconds === 1 && v.quote.topupGas.requested === false);
t("adapter plan execute:false", v.plan.execute === false && v.plan.steps.length === 2);

// ── 3. plan through planRelayFunding → planFundingRoute with TEST-ONLY placeholder policy ────
const adapters = [{ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: FUNDING_RAIL.INTERNAL_ROUTE }];
const INTENT = startFunding({ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, amount: "20", arrival: { chain: "monad-mainnet", asset: "USDC" }, target: RECIPIENT, targetPiggyId: "piggy-a886", adapters, expectedChain: "monad-mainnet" }).intent;
const safety = (over = {}, pol = {}) => ({
  policy: { ...TEST_ONLY_POLICY, ...pol }, nowMs: NOW_MS, allowedSpenders: [DEP], allowedStepTargets: [DEP],
  destinationRecords: [{ address: RECIPIENT, source: "piggy_registry" }], ...over,
});
const runR = (o = {}) => planRelayFunding({ intent: INTENT, binding: binding(), rawQuote: FX, payer: PAYER, receivedAtMs: NOW_MS - 1000, expiresAtMs: NOW_MS + 30000, safety: safety(), ...o });
const runQ = (mut, o = {}) => { const q = clone(FX); mut(q); return runR({ rawQuote: q, ...o }); };
const ok = runR();
t("plan READY_FOR_CONFIRMATION with TEST-ONLY policy", ok.state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION && ok.decision === "DO" && ok.safety.gate.decision === "DO");
const P = ok.plan;
t("plan carries no authority", P.execute === false && P.executionAuthority === false && P.permissionGranted === false && P.requiresConfirmation === true && ok.executionAuthority === false);
t("plan steps == fixture steps (to, value, data)", P.steps.length === 2 && P.steps.every((s, i) => { const d = FX.steps[i].items[0].data; return s.to === d.to && s.value === "0" && s.data === d.data && s.chainId === 8453; }));
t("plan binding + arrival", P.binding.recipient === RECIPIENT && P.binding.inputAmountUnits === "20000000" && P.arrival.expectedUnits === "19977610" && P.arrival.minimumUnits === "19578107" && P.topupGas.requested === false);
t("plan key binds the synthetic requestId", P.quoteId === FX.requestId && P.planKey.includes(FX.requestId));
t("gate saw spender = depository, allowance = input", ok.safety.gate.findings !== undefined && ok.safety.reasons.length === 0);
t("RAIL id", INTENT.railId === RELAY_FUNDING_RAIL_ID);

// G1 sensitivity: the spender list is load-bearing
t("spender list = approvalProxy only → BLOCKED spender_not_verified", (() => { const r = runR({ safety: safety({ allowedSpenders: [APPROVAL_PROXY] }) }); return r.state === FUNDING_PLAN_STATE.BLOCKED && r.reasons.includes("spender_not_verified"); })());
t("no step-target list → BLOCKED step_targets_unverified", (() => { const r = runR({ safety: safety({ allowedStepTargets: [] }) }); return r.state === FUNDING_PLAN_STATE.BLOCKED && r.reasons.includes("step_targets_unverified"); })());
t("no policy → BLOCKED policy_missing (no invented thresholds)", (() => { const r = runR({ safety: { ...safety(), policy: null } }); return r.state === FUNDING_PLAN_STATE.BLOCKED && r.reasons.includes("policy_missing"); })());
t("expired quote → BLOCKED quote_expired", (() => { const r = runR({ expiresAtMs: NOW_MS - 1 }); return r.state === FUNDING_PLAN_STATE.BLOCKED && r.reasons.includes("quote_expired"); })());

// Exact unsupported point: the bridge has no simulation input slot.
const reqSim = runR({ safety: safety({}, { requireSimulation: true }) });
t("requireSimulation:true via planRelayFunding → BLOCKED simulation_incomplete (bridge cannot carry a sim result)", reqSim.state === FUNDING_PLAN_STATE.BLOCKED && reqSim.reasons.includes("simulation_incomplete"));
// Direct boundary with an origin-only simulation record: destination postconditions cannot be met on Base.
const railQuote = (sim) => ({
  railId: RELAY_FUNDING_RAIL_ID, validated: true, quoteId: FX.requestId, sourceChainId: 8453, sourceToken: BASE_USDC, sourceDecimals: 6, inputAmountUnits: "20000000",
  destinationChainId: 143, destinationToken: MONAD_USDC_ADDRESS, destinationDecimals: 6, recipient: RECIPIENT,
  expectedOutUnits: "19977610", minOutUnits: "19578107", timeEstimateSeconds: 1, priceImpactPct: 0.11, totalEffectiveCost: "0.02239",
  topupGas: { requested: false, deductedUnits: "0" }, routeClass: "intent_liquidity", liquidityStatus: "quoted",
  receivedAtMs: NOW_MS - 1000, expiresAtMs: NOW_MS + 30000, simulation: sim,
  steps: FX.steps.map((s) => ({ chainId: 8453, to: s.items[0].data.to, value: "0", data: s.items[0].data.data, kind: s.kind })),
});
const direct = (sim) => planFundingRoute({ intent: INTENT, binding: binding(), railQuote: railQuote(sim), safety: safety({}, { requireSimulation: true }) });
const originOnly = direct({ status: "ok", postconditions: { originDebitedUnits: "20000000", depositoryCreditedUnits: "20000000" } });
t("origin-only sim postconditions → BLOCKED postcondition_mismatch (destination leg unprovable)", originOnly.state === FUNDING_PLAN_STATE.BLOCKED && originOnly.reasons.includes("postcondition_mismatch"));
const asserted = direct({ status: "ok", postconditions: { recipient: RECIPIENT.toLowerCase(), destinationChainId: 143, destinationToken: MONAD_USDC_ADDRESS.toLowerCase(), minimumArrivalUnits: "19578107" } });
t("RESIDUAL (provider-neutral boundary, not the Relay bridge): caller-asserted destination postconditions on a railQuote are accepted by planFundingRoute → READY", asserted.state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);

// ── 4. exact allowance / value / recipient / token checks ───────────────────────────────────
const X = lib.exactChecks(FX, { binding: binding(), spender: DEP });
t("exactChecks ok", X.ok === true && X.reasons.length === 0);
t("allowance == input exactly (20000000)", X.approve.amount === "20000000" && X.approve.amount === INPUT_UNITS.toString());
t("approve token = Base USDC, spender = /chains depository", lib.sameAddr(X.approve.token, BASE_USDC) && lib.sameAddr(X.approve.spender, DEP));
t("every step value == 0 (ERC20 origin)", X.values.length === 2 && X.values.every((x) => x.value === "0"));
t("deposit: to = depository, token = Base USDC, amount = input, depositor = payer", lib.sameAddr(X.deposit.to, DEP) && lib.sameAddr(X.deposit.token, BASE_USDC) && X.deposit.amount === "20000000" && lib.sameAddr(X.deposit.depositor, PAYER));
t("recipient = binding (Piggy)", lib.sameAddr(FX.details.recipient, RECIPIENT) && lib.sameAddr(P.binding.recipient, RECIPIENT));

const AP = (spender, amt) => "0x095ea7b3" + spender.slice(2).toLowerCase().padStart(64, "0") + amt.toString(16).padStart(64, "0");
const rej = (r, code) => r.state === FUNDING_PLAN_STATE.REJECTED && r.plan === null && (!code || r.reasons.some((x) => x.includes(code)));
const blk = (r, code) => r.state === FUNDING_PLAN_STATE.BLOCKED && r.plan === null && r.reasons.includes(code);
// [A-895 P-A · F2] the verified simulation slot: shape-checked, bound to the same calldata hash, origin leg only.
const HASH = relayCalldataHash(FX.steps.map((st) => ({ chainId: 8453, to: st.items[0].data.to, value: "0", data: st.items[0].data.data })));
const SIM_OK = () => ({ status: "ok", calldataHash: HASH, chainId: 8453, blockNumber: 52288754, origin: { payerDebitedUnits: "20000000", depositoryCreditedUnits: "20000000" } });
const reqPol = { requireSimulation: true };
t("sim slot: bound ok record + requireSimulation:true → READY", runR({ safety: safety({}, reqPol), simulation: SIM_OK() }).state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);
t("sim slot: hash = sha256 of the A-886 step bytes (stable)", /^[0-9a-f]{64}$/.test(HASH) && HASH === relayCalldataHash(P.steps));
t("sim slot: record for other bytes (hash mismatch) → plan_rejected simulation_not_bound_to_calldata", rej(runR({ safety: safety({}, reqPol), simulation: { ...SIM_OK(), calldataHash: "0".repeat(64) } }), "simulation_not_bound_to_calldata"));
t("sim slot: a record for the old bytes does not bind a re-quoted (otherwise valid) order with another id", (() => { const nid = "0x" + "cd".repeat(32); const r = runQ((q) => { q.protocol.v2.orderId = nid; q.steps[1].items[0].data.data = FX.steps[1].items[0].data.data.slice(0, 10 + 64 * 3) + nid.slice(2); }, { safety: safety({}, reqPol), simulation: SIM_OK() }); return rej(r, "simulation_not_bound_to_calldata"); })());
t("sim slot: status fail → plan_rejected (even when policy does not require simulation)", rej(runR({ simulation: { ...SIM_OK(), status: "fail" } }), "simulation_failed"));
t("sim slot: status incomplete + requireSimulation:true → BLOCKED simulation_incomplete", blk(runR({ safety: safety({}, reqPol), simulation: { ...SIM_OK(), status: "incomplete", origin: undefined } }), "simulation_incomplete"));
t("sim slot: wrong chain → plan_rejected", rej(runR({ safety: safety({}, reqPol), simulation: { ...SIM_OK(), chainId: 1 } }), "simulation_chain_mismatch"));
t("sim slot: origin postcondition below input → plan_rejected", rej(runR({ safety: safety({}, reqPol), simulation: { ...SIM_OK(), origin: { payerDebitedUnits: "20000000", depositoryCreditedUnits: "19999999" } } }), "simulation_postcondition_mismatch"));
t("sim slot: unknown key / caller-asserted destination postconditions are not forwarded → plan_rejected", rej(runR({ safety: safety({}, reqPol), simulation: { ...SIM_OK(), postconditions: { recipient: RECIPIENT.toLowerCase(), destinationChainId: 143, destinationToken: MONAD_USDC_ADDRESS.toLowerCase(), minimumArrivalUnits: "19578107" } } }), "simulation_malformed"));
t("sim slot: malformed (not an object / bad hash / bad block) → plan_rejected", ["x", 5, [], { ...SIM_OK(), calldataHash: "xyz" }, { ...SIM_OK(), blockNumber: 0 }, { ...SIM_OK(), status: "OK" }].every((sm) => rej(runR({ safety: safety({}, reqPol), simulation: sm }), "simulation_malformed")));
t("allowance input+1 → REJECTED", rej(runQ((q) => { q.steps[0].items[0].data.data = AP(DEP, INPUT_UNITS + 1n); }), "approve_exceeds_input"));
t("allowance input+1 → exactChecks fail", (() => { const q = clone(FX); q.steps[0].items[0].data.data = AP(DEP, INPUT_UNITS + 1n); return lib.exactChecks(q, { binding: binding(), spender: DEP }).reasons.includes("allowance_not_exact_input"); })());
t("unlimited allowance → REJECTED", rej(runQ((q) => { q.steps[0].items[0].data.data = AP(DEP, (1n << 256n) - 1n); })));
// [A-895 P-A] flipped from "FINDING: allowance below input passes the plan" (A-886 F3): the deposit path now needs approve == input.
t("allowance below input → REJECTED (F3 closed; exactChecks agrees)", (() => { const q = clone(FX); q.steps[0].items[0].data.data = AP(DEP, INPUT_UNITS - 1n); return rej(runR({ rawQuote: q }), "approve_amount_not_input") && lib.exactChecks(q, { binding: binding(), spender: DEP }).reasons.includes("allowance_not_exact_input"); })());
// [A-895 P-A] now refused one layer earlier (the calldata binding), before the caller-supplied spender list is even consulted.
t("attacker spender → REJECTED approve_spender_not_depository", rej(runQ((q) => { q.steps[0].items[0].data.data = AP(ATTACKER, INPUT_UNITS); }), "approve_spender_not_depository"));
t("deposit to attacker → REJECTED deposit_target_not_depository (pinned /chains depository)", rej(runQ((q) => { q.steps[1].items[0].data.to = ATTACKER; }), "deposit_target_not_depository"));
t("caller-supplied allowlists cannot widen the pinned depository (attacker in allowedStepTargets + allowedSpenders)", rej(runQ((q) => { q.steps[1].items[0].data.to = ATTACKER; q.steps[0].items[0].data.data = AP(ATTACKER, INPUT_UNITS); }, { safety: safety({ allowedSpenders: [ATTACKER], allowedStepTargets: [ATTACKER] }) }), "deposit_target_not_depository"));
t("nonzero value → REJECTED", rej(runQ((q) => { q.steps[1].items[0].data.value = "1"; })));
t("recipient swapped → REJECTED", rej(runQ((q) => { q.details.recipient = ATTACKER; })));
t("dest token swapped → REJECTED", rej(runQ((q) => { q.details.currencyOut.currency.address = BASE_USDC; })));
t("origin token swapped → REJECTED", rej(runQ((q) => { q.details.currencyIn.currency.address = ATTACKER; })));
t("step on another chain → REJECTED", rej(runQ((q) => { q.steps[1].items[0].data.chainId = 1; })));
t("unrequested gas top-up → REJECTED", rej(runQ((q) => { q.details.currencyGasTopup = { currency: { chainId: 143, address: lib.ZERO, decimals: 18 }, amount: "1", amountUsd: "1" }; })));

// ── 5. A-885 input-validation (orderId / depository) over protocol.v2 ───────────────────────
const ivArgs = { chains: CH, originChainId: 8453, expectedPayer: PAYER, sourceToken: BASE_USDC, inputUnits: INPUT_UNITS, nowSec: NOW_SEC };
const iv = lib.inputValidationCheck(FX, ivArgs);
t("input-validation ok (depository from /chains, id == orderId, depositor == payer, depositErc20 for ERC20)", iv.ok === true && iv.depositoryFrom === "GET /chains snapshot");
t("orderId recomputation reported NOT run (bounded)", iv.orderIdRecomputed === false && iv.notes.some((n) => n.startsWith("orderId_recompute_not_run")));
const ivQ = (mut, a = {}) => { const q = clone(FX); mut(q); return lib.inputValidationCheck(q, { ...ivArgs, ...a }); };
const depId = (id) => FX.steps[1].items[0].data.data.slice(0, 10 + 64 * 3) + id.slice(2);
t("deposit id != orderId → fail", ivQ((q) => { q.steps[1].items[0].data.data = depId("0x" + "ab".repeat(32)); }).reasons.includes("deposit_id_not_order_id"));
t("quote's paymentDetails.depository is NOT trusted (attacker depository + target) → fail", (() => { const r = ivQ((q) => { q.protocol.v2.paymentDetails.depository = ATTACKER; q.steps[1].items[0].data.to = ATTACKER; }); return r.reasons.includes("payment_details_depository_not_chains") && r.reasons.includes("deposit_target_not_chains_depository"); })());
t("depositor != payer → fail", ivQ(() => {}, { expectedPayer: ATTACKER }).reasons.includes("deposit_depositor_not_payer"));
t("orderData deadline passed → fail", ivQ(() => {}, { nowSec: 1791374400 }).reasons.includes("order_expired"));
t("native payment function on ERC20 origin → fail", ivQ((q) => { q.steps[1].items[0].data.data = "0x49290c1c" + PAYER.slice(2).toLowerCase().padStart(64, "0") + FX.protocol.v2.orderId.slice(2); }).reasons.some((x) => x === "payment_function_mismatch" || x === "deposit_undecodable"));
t("no protocol.v2 → fail closed", ivQ((q) => { delete q.protocol; }).reasons.includes("protocol_v2_missing"));
// The app runtime does not perform this check yet (documented gap, not fixed here — app/src read-only).
// [A-886 review C1] F1 is wider than the id: the app decodes no deposit calldata at all.
const depArgs = (depositor, token, amount) => "0xe8017952" + depositor.slice(2).toLowerCase().padStart(64, "0") + token.slice(2).toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0") + FX.protocol.v2.orderId.slice(2);
const readyWithDeposit = (data) => runQ((q) => { q.steps[1].items[0].data.data = data; }).state === FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION;
// [A-895 P-A] FLIPPED (A-886 I1): these four were asserted as CURRENT STATE (reaching READY). They must now end plan_rejected,
// while the harness reference check (lib.inputValidationCheck) still flags the same defect — both agree.
const flagged = (data, code) => lib.inputValidationCheck((() => { const q = clone(FX); q.steps[1].items[0].data.data = data; return q; })(), ivArgs).reasons.includes(code);
const rejectedWith = (data, code) => rej(runQ((q) => { q.steps[1].items[0].data.data = data; }), code);
t("F1 closed: deposit depositor = attacker → plan_rejected", rejectedWith(depArgs(ATTACKER, BASE_USDC, INPUT_UNITS), "deposit_depositor_not_payer") && flagged(depArgs(ATTACKER, BASE_USDC, INPUT_UNITS), "deposit_depositor_not_payer"));
t("F1 closed: deposit amount = half the input → plan_rejected", rejectedWith(depArgs(PAYER, BASE_USDC, INPUT_UNITS / 2n), "deposit_amount_not_input") && flagged(depArgs(PAYER, BASE_USDC, INPUT_UNITS / 2n), "deposit_amount_not_input"));
t("F1 closed: deposit token = arbitrary address → plan_rejected", rejectedWith(depArgs(PAYER, ATTACKER, INPUT_UNITS), "deposit_token_not_source") && flagged(depArgs(PAYER, ATTACKER, INPUT_UNITS), "deposit_token_not_source"));
// [A-886 review C2] unknown deadline fails closed
t("orderData deadline missing → fail closed", ivQ((q) => { delete q.protocol.v2.orderData.deadline; }).reasons.includes("order_deadline_unknown"));
t("orderData deadline non-numeric → fail closed", ivQ((q) => { q.protocol.v2.orderData.deadline = "1791374400"; }).reasons.includes("order_deadline_unknown"));
t("F1 closed: deposit id != orderId → plan_rejected", rej(runQ((q) => { q.steps[1].items[0].data.data = depId("0x" + "ab".repeat(32)); }), "deposit_id_not_order_id"));
// [A-895 P-A] the same deadline rules now hold at the plan boundary, not only in the harness
t("plan: orderData deadline missing → plan_rejected", rej(runQ((q) => { delete q.protocol.v2.orderData.deadline; delete q.protocol.v2.orderData.output.deadline; }), "order_deadline_unknown"));
t("plan: orderData deadline string → plan_rejected", rej(runQ((q) => { q.protocol.v2.orderData.deadline = "1791374400"; q.protocol.v2.orderData.output.deadline = "1791374400"; }), "order_deadline_unknown"));
// [A-909] pre-A-909 baseline: no output -> was accepted (flat deadline only); now refused.
t("A-909 plan: orderData.output missing -> plan_rejected (order_output_missing)", rej(runQ((q) => { delete q.protocol.v2.orderData.output; }), "order_output_missing"));
t("plan: orderData deadline expired → plan_rejected", rej(runQ((q) => {}, { safety: safety({ nowMs: 1791374400 * 1000 }), receivedAtMs: 1791374400 * 1000 - 1000, expiresAtMs: 1791374400 * 1000 + 30000 }), "order_expired"));
t("plan: wrong depository (paymentDetails + step target both attacker) → plan_rejected", rej(runQ((q) => { q.protocol.v2.paymentDetails.depository = ATTACKER; q.steps[1].items[0].data.to = ATTACKER; }), "deposit_target_not_depository"));

// ── 6. stored read-only simulation record (eth_simulateV1 on Base) ──────────────────────────
const simPath = path.join(R, "sim/run.json");
if (existsSync(simPath)) {
  const S = JSON.parse(readFileSync(simPath, "utf8"));
  t("sim record is SIM_ONLY, not LIVE", /^SIM_ONLY/.test(S.label) && S.label.includes("not LIVE"));
  t("sim ran over THIS fixture (sha256)", S.fixtureSha256 === PROV.fixtureSha256);
  t("sim pinned block + RPC recorded", S.network.pinnedBlock.number > 0 && /^0x[0-9a-f]{64}$/.test(S.network.pinnedBlock.hash) && S.network.remoteRpc === "https://mainnet.base.org");
  t("sim used read-only methods only", S.rpcMethodsUsed.every((m) => ["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_simulateV1"].includes(m)));
  t("sim all checks true", S.ok === true && Object.values(S.checks).length >= 11 && Object.values(S.checks).every(Boolean));
  t("sim: allowance 0 → 20000000 → 0", S.happy.allowancePre === "0" && S.happy.allowanceAfterApprove === "20000000" && S.happy.allowanceAfterDeposit === "0");
  t("sim: payer −20000000, depository +20000000", S.happy.payerAfter === "0" && S.happy.depositoryDelta === "20000000");
  t("sim step calldata == fixture calldata", S.happy.approve.dataSha256 === sha(FX.steps[0].items[0].data.data) && S.happy.deposit.dataSha256 === sha(FX.steps[1].items[0].data.data));
  const ev = S.happy.depositoryEvent;
  const word = (i) => ev.data.slice(2 + 64 * i, 2 + 64 * (i + 1));
  t("depository event data = (payer, Base USDC, 20000000, orderId)", ev && lib.sameAddr("0x" + word(0).slice(24), PAYER) && lib.sameAddr("0x" + word(1).slice(24), BASE_USDC) && BigInt("0x" + word(2)) === INPUT_UNITS && "0x" + word(3) === FX.protocol.v2.orderId.toLowerCase());
  t("sim negatives: no approve / over-allowance / third party → revert TransferFromFailed()", ["N1_deposit_without_approve", "N2_deposit_above_exact_allowance", "N3_third_party_deposit_naming_payer"].every((k) => S.negatives[k].status === 0 && S.negatives[k].error?.data === "0x7939f424"));
  t("sim: third party cannot spend payer allowance (pulls from msg.sender)", S.negatives.N3_third_party_deposit_naming_payer.pulledFromPayer === false && S.negatives.N3_third_party_deposit_naming_payer.payerAfter === "20000000");
} else {
  console.log("SKIP a886 sim-record checks: sim/run.json not present");
}

// ── 7. bounded external legs / app request gaps (asserted as current state, not fixed) ──────
const relaySrc = readFileSync(path.join(ROOT, "app/src/funding-rail-relay.js"), "utf8");
// [A-895 P-A] FLIPPED (A-886 F4): quote/v2, explicit refundTo, includeProtocolData:true.
const relayCode = relaySrc.replace(/\/\/.*$/gm, "");
t("F4 closed: request path is /quote/v2, never /quote", relayCode.includes('fetchImpl(RELAY_API_BASE,') && RELAY_QUOTE_V2_PATH === "/quote/v2" && !/RELAY_API_BASE \+ "\/quote"/.test(relayCode) && RELAY_API_BASE === "/api/relay-quote" /* [A-901] re-pinned; pre-A-901 baseline: RELAY_API_BASE + RELAY_QUOTE_V2_PATH, "https://api.relay.link" */);
t("F4 closed: request body carries refundTo + includeProtocolData:true", (() => { const r = buildRelayQuoteRequest({ user: PAYER, recipient: RECIPIENT, refundTo: PAYER, originChainId: 8453, originCurrency: BASE_USDC, amount: INPUT_UNITS.toString() }); return r.ok && r.request.refundTo === PAYER && r.request.includeProtocolData === true; })());

t("no network used", fetchCalls === 0);
console.log(`a886 relay funding sim: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
