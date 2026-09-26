// [A-579 Lane E] Decision-time read seam, chain honesty, few_days/no_rush, deep Receipt validator.
// No network (fake fetch only), no browser, no tx.
//   node app/test/e-decision-time-read.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTION, RESULT, decideSemanticReturnRule } from "../src/rule-decision.js";
import { STATUS, buildDestinationFixtures, deriveDestinationStatus, runSecondJourney } from "../src/job-feed.js";
import { evaluateReadinessEvidence, readDestinationReturnEvidence, readReturnObservation, RETURN_READ_METHODS } from "../src/second-job-readiness.js";
import { createSecondJourneyState, recordSecondJourneyDecisionReceipt, validateDecisionReceipt } from "../src/second-journey-state.js";

const ADDRESS = "0x00000000000000000000000000000000000000a1";
const SCOPE = { accountId: ADDRESS, chainId: "monad-testnet" };
const KINTSU_DEST = "kintsu-like-grow-delayed-return";
const NOW = () => "2026-09-25T04:40:00.000Z";

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

function fakeRpc({ block = 107600000, chainHex = "0x8f", fee = 10, code = "0x6080604052", fail = false, error = false, status200 = true } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const req = JSON.parse(init.body);
    calls.push({ url, ...req });
    if (fail) throw new Error("offline");
    if (!status200) return { ok: false, json: async () => ({}) };
    if (error) return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "x" } }) };
    const result = { eth_chainId: chainHex, eth_blockNumber: `0x${block.toString(16)}`, eth_getCode: code, eth_call: `0x${fee.toString(16).padStart(64, "0")}` }[req.method];
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
  return { impl, calls };
}
const RPC = "https://read.invalid/rpc";

// ── reader ────────────────────────────────────────────────────────────────────
await check("reader fails closed without plan / rpc / transport / clock, never throws", async () => {
  assert.equal((await readReturnObservation("nope", { rpcUrl: RPC, fetchImpl: fakeRpc().impl, now: NOW })).status, "no_read_plan");
  assert.equal((await readReturnObservation("aave-usdc", { rpcUrl: RPC, fetchImpl: fakeRpc().impl, now: NOW })).status, "no_read_plan");
  assert.equal((await readReturnObservation("kintsu-smon", { fetchImpl: fakeRpc().impl, now: NOW })).status, "no_rpc");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: "http://plain.invalid", fetchImpl: fakeRpc().impl, now: NOW })).status, "no_rpc");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, now: NOW })).status, "no_transport");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: fakeRpc().impl })).status, "no_transport");
  assert.equal((await readReturnObservation("kintsu-smon")).observation, null);
});

await check("reader: read-only methods only, every state read pinned to one head block", async () => {
  const rpc = fakeRpc({ block: 107600123 });
  const out = await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: rpc.impl, now: NOW });
  assert.equal(out.status, "ok");
  assert.ok(rpc.calls.every((c) => RETURN_READ_METHODS.includes(c.method)));
  assert.deepEqual(rpc.calls.map((c) => c.method), ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"]);
  const tag = `0x${(107600123).toString(16)}`;
  assert.equal(rpc.calls[2].params[1], tag);
  assert.equal(rpc.calls[3].params[1], tag);
  assert.equal(rpc.calls[3].params[0].data, "0xfde73f7d");
  assert.deepEqual(
    { block: out.observation.block, chainId: out.observation.chainId, codePresent: out.observation.codePresent, exitFeeBips: out.observation.exitFeeBips, observedAt: out.observation.observedAt },
    { block: 107600123, chainId: 143, codePresent: true, exitFeeBips: 10, observedAt: NOW() },
  );
  assert.doesNotMatch(out.observation.source, /read\.invalid/, "the RPC URL is not copied into the Receipt source");
});

await check("reader: transport / rpc-error / garbage map to statuses, observation null", async () => {
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: fakeRpc({ fail: true }).impl, now: NOW })).status, "rpc_unreachable");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: fakeRpc({ status200: false }).impl, now: NOW })).status, "rpc_unreachable");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: fakeRpc({ error: true }).impl, now: NOW })).status, "unreadable_result");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: fakeRpc({ code: "nothex" }).impl, now: NOW })).status, "unreadable_result");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: fakeRpc().impl, now: () => "not a date" })).status, "unreadable_result");
  assert.equal((await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: async () => { throw new TypeError("x"); }, now: NOW })).status, "rpc_unreachable");
});

await check("reader source: no send/sign/wallet method, no clock or time constant", () => {
  const src = readFileSync(new URL("../src/second-job-readiness.js", import.meta.url), "utf8");
  const section = src.slice(src.indexOf("[A-579] Decision-time read-only observation"));
  assert.ok(section.length > 200);
  assert.doesNotMatch(section, /eth_send|eth_sign|personal_|wallet_|signTypedData/);
  assert.doesNotMatch(section, /Date\.now\(|setTimeout|AbortSignal\.timeout/);
  assert.doesNotMatch(section, /\d+\s*\*\s*60\b|\b(3600|86400|3600000|86400000)\b/);
  assert.doesNotMatch(section, /https:\/\/[a-z]/i, "no RPC URL literal in the reader");
});

// ── decision-time evidence ───────────────────────────────────────────────────
const RIGHT_BACK = { id: "return_semantic", field: "returnSemantic", expected: "right_back", agreed: true };
const OK_OBS = { source: "read-only rpc", observedAt: "2026-09-25T04:40:00.000Z", block: 107600000, chainId: 143, codePresent: true, exitFeeBips: 10 };

await check("requireObservation: no read → fresh_read_missing → unknown, never nah", () => {
  const ev = readDestinationReturnEvidence("kintsu-smon", { requireObservation: true });
  assert.equal(ev.evidenceMode, "fresh_read_missing");
  assert.equal(ev.source, null);
  assert.equal(ev.block, null);
  const d = decideSemanticReturnRule(RIGHT_BACK, ev);
  assert.equal(d.result, RESULT.UNKNOWN);
  assert.equal(d.reason, "missing_evidence");
  // the A-576 recorded mode is unchanged for callers that do not ask for decision-time mode
  assert.equal(decideSemanticReturnRule(RIGHT_BACK, readDestinationReturnEvidence("kintsu-smon")).result, RESULT.NAH);
});

await check("requireObservation: read without an integer block is incomplete → unknown", () => {
  const ev = readDestinationReturnEvidence("kintsu-smon", { requireObservation: true, observation: { ...OK_OBS, block: undefined } });
  assert.equal(ev.evidenceMode, "observation_incomplete");
  assert.equal(ev.block, null);
  assert.equal(decideSemanticReturnRule(RIGHT_BACK, ev).result, RESULT.UNKNOWN);
});

await check("observation dated before the recorded read is stale → unknown (A-576 NOTE-1)", () => {
  const ev = readDestinationReturnEvidence("kintsu-smon", { requireObservation: true, observation: { ...OK_OBS, observedAt: "1999-01-01" } });
  assert.equal(ev.evidenceMode, "observation_stale");
  assert.equal(decideSemanticReturnRule(RIGHT_BACK, ev).reason, "stale_evidence");
  const noBlock = readDestinationReturnEvidence("kintsu-smon", { observation: { source: "s", observedAt: "1999-01-01" } });
  assert.equal(decideSemanticReturnRule(RIGHT_BACK, noBlock).result, RESULT.UNKNOWN, "the A-576 probe that gave nah now gives unknown");
});

await check("exit fee / chain / code mismatch on the read → conflict → unknown", () => {
  for (const bad of [{ exitFeeBips: 25 }, { chainId: 10143 }, { codePresent: false }]) {
    const ev = readDestinationReturnEvidence("kintsu-smon", { requireObservation: true, observation: { ...OK_OBS, ...bad } });
    assert.equal(ev.conflict, true, JSON.stringify(bad));
    assert.equal(decideSemanticReturnRule(RIGHT_BACK, ev).reason, "source_conflict");
  }
});

await check("a complete decision-time read → nah with that read's block", () => {
  const ev = readDestinationReturnEvidence("kintsu-smon", { requireObservation: true, observation: OK_OBS });
  assert.equal(ev.evidenceMode, "live_observation");
  assert.equal(ev.block, 107600000);
  assert.equal(decideSemanticReturnRule(RIGHT_BACK, ev).result, RESULT.NAH);
});

// ── few_days / no_rush ───────────────────────────────────────────────────────
await check("few_days / no_rush on a delayed Job with unpublished duration → unknown; stated duration → ask", () => {
  const ev = readDestinationReturnEvidence("kintsu-smon", { requireObservation: true, observation: OK_OBS });
  assert.equal(ev.durationKnown, false);
  for (const expected of ["few_days", "no_rush"]) {
    const rule = { ...RIGHT_BACK, expected };
    const unknown = decideSemanticReturnRule(rule, ev);
    assert.equal(unknown.result, RESULT.UNKNOWN);
    assert.equal(unknown.reason, "return_duration_unknown");
    assert.equal(unknown.action, ACTION.NONE);
    const ask = decideSemanticReturnRule(rule, { ...ev, durationKnown: true });
    assert.equal(ask.result, RESULT.ASK);
    assert.equal(ask.reason, "semantic_return_duration_confirm");
    assert.equal(decideSemanticReturnRule(rule, { ...ev, returnClass: "immediate" }).result, RESULT.DO_IT);
    assert.equal(decideSemanticReturnRule({ ...rule, agreed: false }, ev).reason, "rule_not_agreed");
  }
});

await check("unbound delayed destination: old placeholder right_back→nah path is gone", () => {
  const [, kintsu] = buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" });
  const unbound = { ...kintsu, boundJobId: undefined, returnEvidence: undefined };
  for (const answer of ["right_back", "few_days", "no_rush", null]) {
    const d = deriveDestinationStatus(unbound, { returnTolerance: answer });
    assert.equal(d.status, STATUS.JOB_OPEN, String(answer));
    assert.equal(d.reasonCode, "return_evidence_unbound");
    assert.equal(d.action, ACTION.NONE);
  }
  // the bound destination still asks the JIT question before an answer
  assert.equal(deriveDestinationStatus(kintsu, {}).action, ACTION.ASK);
  const src = readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /return_waiting_accepted/);
});

// ── job-feed decision-time mode ──────────────────────────────────────────────
function flow(extra = {}) {
  return runSecondJourney({ scope: SCOPE, selectionKind: "one", selectedErrandIds: ["grow"], preferredDestinationId: KINTSU_DEST, requireFreshReturnObservation: true, selectionSource: "app_ui_jit_answer", decisionEventId: "check:k:1", ...extra });
}

await check("decision-time mode: no read → unknown Receipt, readStatus carried, event id is the caller's", () => {
  const f = flow({ jitAnswer: "right_back", returnReadStatus: "reader_unconfigured", decisionAt: NOW() });
  const r = f.decisionReceipt;
  assert.equal(r.decision, "unknown");
  assert.equal(r.eventId, "decision:check:k:1:kintsu-like-grow-delayed-return:right_back");
  assert.equal(r.evidence.readStatus, "reader_unconfigured");
  assert.equal(r.recordedAt, NOW());
  assert.deepEqual(r.executionContext, { runtimeChain: "monad-testnet", jobChain: "monad-mainnet", executable: false, role: "evidence_only_other_chain" });
  assert.equal(validateDecisionReceipt(r, createSecondJourneyState(SCOPE)).error, null);
});

await check("decision-time mode: read for this event → nah, block N from the read, validates and records", () => {
  const f = flow({ jitAnswer: "right_back", returnObservations: { "kintsu-smon": OK_OBS }, returnReadStatus: "ok" });
  const r = f.decisionReceipt;
  assert.equal(r.decision, "nah");
  assert.equal(r.evidence.block, 107600000);
  assert.equal(r.evidence.readStatus, "ok");
  const out = recordSecondJourneyDecisionReceipt(createSecondJourneyState(SCOPE), r);
  assert.equal(out.recorded, true);
  assert.deepEqual(out.state.receipts[0].executionContext, r.executionContext);
});

await check("decision-time mode only touches the checked destination (candidate rows keep A-576 behaviour)", () => {
  const unchecked = runSecondJourney({ scope: SCOPE, selectedErrandIds: ["grow"], jitAnswer: "right_back", requireFreshReturnObservation: true });
  const kintsu = unchecked.destinations.find((d) => d.id === KINTSU_DEST);
  assert.equal(kintsu.derivedStatus, STATUS.NAH, "no checked destination → no decision-time mode → same row state as before");
  const checked = flow({ jitAnswer: "right_back" });
  assert.equal(checked.destinations.find((d) => d.id === KINTSU_DEST).decision.semantic.evidenceMode, "fresh_read_missing");
});

await check("Preference ≠ Permission ≠ Agreed Rule on the live path", () => {
  const f = flow({ jitAnswer: "right_back", returnObservations: { "kintsu-smon": OK_OBS } });
  assert.equal(f.preflight.executionPermission, false);
  assert.equal(f.preferenceState.executionPermission, false);
  assert.equal(f.preferenceState.agreedRule, null);
  assert.equal(f.decisionReceipt.selection.createsPermission, false);
  assert.equal(f.decisionReceipt.selection.semanticScope, "this_selection_event_only");
  const hinted = flow({ jitAnswer: undefined, returnObservations: { "kintsu-smon": OK_OBS }, preference: { liquidity: 0.6, reasonDislike: { delayed: 0.35 } } });
  assert.equal(hinted.decisionReceipt, null, "a preference alone never produces a decision");
  assert.notEqual(hinted.destinations.find((d) => d.id === KINTSU_DEST).derivedStatus, STATUS.NAH);
});

// ── chain honesty at the Send gate ───────────────────────────────────────────
await check("Kintsu (mainnet Job) on the testnet runtime is never READY, even qualified with complete evidence", () => {
  const [, kintsu] = buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" });
  assert.equal(kintsu.jobChain, "monad-mainnet");
  assert.equal(kintsu.executionContext.executable, false);
  assert.equal(kintsu.executionContext.role, "evidence_only_other_chain");
  const qualified = { ...kintsu, capabilityStatus: "qualified" };
  const evidence = { source: "s", chain: "monad-testnet", address: ADDRESS, destinationId: KINTSU_DEST, block: 1, eligibility: "known", exit: "known", proof: "known", gas: "known", requiredAssets: ["gas"], availableAssets: ["gas"], missingNow: [], timestampMs: 900, expiresAtMs: 2000 };
  const r = evaluateReadinessEvidence(qualified, evidence, { nowMs: 1000 });
  assert.equal(r.status, "UNKNOWN");
  assert.equal(r.reason, "job_chain_not_runtime_chain");
  assert.equal(r.executionPermission, false);
  // DEV-preview override shape (chain monad-testnet-preview) is gated the same way
  const dev = { ...qualified, currentPiggyContext: { ...qualified.currentPiggyContext, chain: "monad-testnet-preview" } };
  assert.equal(evaluateReadinessEvidence(dev, { ...evidence, chain: "monad-testnet-preview" }, { nowMs: 1000 }).reason, "job_chain_not_runtime_chain");
  // on its own chain the generic readiness checks still apply
  const [, onMainnet] = buildDestinationFixtures({ address: ADDRESS, chain: "monad-mainnet" });
  assert.equal(onMainnet.executionContext.role, "same_chain_not_executed");
  assert.equal(evaluateReadinessEvidence({ ...onMainnet, capabilityStatus: "qualified" }, { ...evidence, chain: "monad-mainnet" }, { nowMs: 1000 }).status, "JOB_READY");
});

// ── deep validator (A-576 NOTE-3) ────────────────────────────────────────────
await check("deep validator rejects nested / cased forbidden fields, secret-shaped values, depth, size, chain overclaim", () => {
  const state = createSecondJourneyState(SCOPE);
  const base = flow({ jitAnswer: "right_back", returnObservations: { "kintsu-smon": OK_OBS } }).decisionReceipt;
  assert.equal(validateDecisionReceipt(base, state).error, null);
  const clone = () => JSON.parse(JSON.stringify(base));
  const cases = [
    ["nested txHash", (r) => { r.evidence.txHash = "0x1"; }, "forbidden_field_present"],
    ["cased Permission in selection", (r) => { r.selection.Permission = true; }, "forbidden_field_present"],
    ["executionPermission inside array", (r) => { r.evidence.provenance.extra = [{ ExecutionPermission: true }]; }, "forbidden_field_present"],
    ["32-byte hex anywhere", (r) => { r.why = `see 0x${"ab".repeat(32)}`; }, "secret_shaped_value"],
    ["too deep", (r) => { r.evidence.provenance.a = { b: { c: { d: { e: { f: 1 } } } } }; }, "receipt_too_complex"],
    ["array too long", (r) => { r.selection.errandIds = Array.from({ length: 65 }, (_, i) => `e${i}`); }, "receipt_too_complex"],
    ["nah without integer block", (r) => { r.evidence.block = null; }, "nah_without_block"],
    ["selection.source too long", (r) => { r.selection.source = "x".repeat(65); }, "selection_source_too_long"],
    ["missing executionContext", (r) => { delete r.executionContext; }, "missing_execution_context"],
    ["executable true", (r) => { r.executionContext.executable = true; }, "execution_context_overclaims"],
    ["runtime chain ≠ Receipt chain", (r) => { r.executionContext.runtimeChain = "monad-mainnet"; }, "execution_context_chain_mismatch"],
  ];
  for (const [label, mutate, expected] of cases) {
    const r = clone();
    mutate(r);
    assert.equal(validateDecisionReceipt(r, state).error, expected, label);
    assert.equal(recordSecondJourneyDecisionReceipt(state, r).recorded, false, label);
  }
});

console.log(`\n${pass}/${pass} PASS`);
