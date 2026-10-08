// [A-579 Lane E] main.js handleJitAnswer → action-0 decision Receipt, wired through the existing
// Second Journey storage path. No network, no browser, no tx.
//   node app/test/second-journey-decision-wiring.mjs
//
// The behaviour checks run the ACTUAL main.js Second Journey functions: their source is cut out
// of main.js by name and evaluated as a module against the real app/src modules, with a memory
// localStorage and a counting render() stub. Nothing is re-implemented here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMemoryStorage, loadSecondJourneyState, readSecondJourneyDecisionReceipts, secondJourneyStorageKey } from "../src/second-journey-state.js";
import { secondJourneyCardMarkup, secondJourneySendReason } from "../src/second-journey-view.js";

const SRC_DIR = new URL("../src/", import.meta.url);
const MAIN = readFileSync(new URL("main.js", SRC_DIR), "utf8");
const ADDRESS = "0x00000000000000000000000000000000000000a1";
const KINTSU_DEST = "kintsu-like-grow-delayed-return";

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

function cutFunction(name) {
  const re = new RegExp(`\\n(async )?function ${name}\\(`);
  const m = re.exec(MAIN);
  assert.ok(m, `main.js function ${name} not found`);
  const start = m.index + 1;
  const end = MAIN.indexOf("\n}\n", start);
  assert.ok(end > start, `main.js function ${name} has no end`);
  return MAIN.slice(start, end + 2);
}
function cutConst(name) {
  const m = new RegExp(`\\nconst ${name} = [^\\n]*;\\n`).exec(MAIN);
  assert.ok(m, `main.js const ${name} not found`);
  return m[0].trim();
}

const FUNCTIONS = [
  "createEmptySecondJourney", "secondJourneyScope", "currentSecondDraft", "persistSecondDraft", "safeLocalStorage",
  "ensureSecondJourneyDomainState", "persistSecondJourneyDomainState", "buildDevPreviewOverrides", "buildDevPreviewEvidence",
  "recomputeSecondJourneyFlow", "handleCandidateCheck", "handleJitAnswer", "recordSecondJourneyDecisionForAnswer", "handleReadinessBack",
  // [A-629] LOCAL_ONLY harness hooks; inert here because LOCAL_DEV_ENTRY is false in this module.
  "localTestReturnReadConfig", "localTestJobBindings",
];

// Builds a module from the real main.js text. `readConfig` replaces the null config only when a
// test wants the configured-reader path (fake fetch); product source keeps null.
async function loadMainSecondJourney({ readConfig = null } = {}) {
  const url = (file) => new URL(file, SRC_DIR).href;
  let consts = [cutConst("SECOND_DECISION_SELECTION_SOURCE"), cutConst("RETURN_EVIDENCE_READ_CONFIG"),
    cutConst("LOCAL_TEST_RETURN_READ_HOOK"), cutConst("LOCAL_TEST_JOB_BINDINGS_HOOK"), "const LOCAL_DEV_ENTRY = false;"].join("\n");
  // pre-A-859 baseline: the product const was null here and was replaced only when readConfig was given.
  // Now the product const is the finalized mainnet config, so the harness rebinds it: null by default, readConfig when given.
  consts = consts.replace(/const RETURN_EVIDENCE_READ_CONFIG = [^\n]*;/, `const RETURN_EVIDENCE_READ_CONFIG = ${readConfig ? JSON.stringify(readConfig) : "null"};`);
  const body = FUNCTIONS.map(cutFunction).join("\n\n").replaceAll("import.meta.env.DEV", "__env.DEV");
  const code = `
import { runSecondJourney } from ${JSON.stringify(url("job-feed.js"))};
import { readReturnObservation } from ${JSON.stringify(url("second-job-readiness.js"))};
import { createSecondJourneyState, loadSecondJourneyState, saveSecondJourneyState, validatePersistenceScope, saveSecondJourneyDraft, recordSecondJourneyDecisionReceipt } from ${JSON.stringify(url("second-journey-state.js"))};
import { validateSecondAmount } from ${JSON.stringify(url("second-journey-view.js"))};
export const __env = { DEV: false };
export const __io = { store: null, renders: 0, fetch: null };
const window = { get localStorage() { return __io.store; } };
const localStorage = new Proxy({}, { get: (_, k) => { const v = __io.store[k]; return typeof v === "function" ? v.bind(__io.store) : v; } });
const fetch = (...args) => __io.fetch(...args);
function render() { __io.renders += 1; }
export const state = { address: "", receipts: [], secondJourney: null };
${consts}
${body}
state.secondJourney = createEmptySecondJourney();
export { createEmptySecondJourney, handleCandidateCheck, handleJitAnswer, handleReadinessBack, recordSecondJourneyDecisionForAnswer, recomputeSecondJourneyFlow };
`;
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
}

function freshApp(mod, { address = ADDRESS, store = createMemoryStorage(), dev = false } = {}) {
  mod.__io.store = store;
  mod.__io.renders = 0;
  mod.__env.DEV = dev;
  mod.state.address = address;
  mod.state.secondJourney = mod.createEmptySecondJourney();
  mod.state.secondJourney.selectedIds = ["grow"];
  mod.state.secondJourney.step = "candidates";
  mod.recomputeSecondJourneyFlow();
  return store;
}

const SCOPE = { accountId: ADDRESS, chainId: "monad-testnet" };
const storedDecisions = (store) => readSecondJourneyDecisionReceipts(loadSecondJourneyState(store, SCOPE).state);
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Fake read-only JSON-RPC (no network). `mode` picks the answer shape.
function fakeRpc({ block = 107600000, chainHex = "0x8f", fee = 10, fail = false } = {}) {
  const calls = [];
  const impl = async (_url, init) => {
    const req = JSON.parse(init.body);
    calls.push(req);
    if (fail) throw new Error("offline");
    const result = {
      eth_chainId: chainHex,
      eth_blockNumber: `0x${block.toString(16)}`,
      eth_getCode: "0x6080604052",
      eth_call: `0x${fee.toString(16).padStart(64, "0")}`,
    }[req.method];
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
  return { impl, calls };
}

// ── 1. source contract ─────────────────────────────────────────────────────────
await check("main.js decision-time reader config is the A-859 finalized config (was null pre-A-859); single RPC literal", () => {
  // pre-A-859 baseline: assert.match(MAIN, /\nconst RETURN_EVIDENCE_READ_CONFIG = null;\n/);
  // pre-A-859 baseline: assert.doesNotMatch(MAIN, /https:\/\/rpc\.monad\.xyz/);
  assert.match(MAIN, /\nconst RETURN_EVIDENCE_READ_CONFIG = Object\.freeze\(\{ rpcUrl: "https:\/\/rpc\.monad\.xyz", finality: "finalized" \}\);\n/);
  assert.equal((MAIN.match(/https:\/\/rpc\.monad\.xyz/g) || []).length, 1);
  assert.doesNotMatch(MAIN, /["'`]https?:\/\/[^"'`]*monad[^"'`]*mainnet/i);
});

await check("handleJitAnswer keeps its 4 visible steps and adds only the record call", () => {
  const fn = cutFunction("handleJitAnswer");
  assert.match(fn, /jitAnswer = value;\s*\n\s*persistSecondDraft\(\);[^\n]*\n\s*recomputeSecondJourneyFlow\(\);\s*\n\s*render\(\);\s*\n\s*recordSecondJourneyDecisionForAnswer\(\)\.catch\(/);
});

await check("the record path never renders, never signs/sends, never grants permission", () => {
  const fn = cutFunction("recordSecondJourneyDecisionForAnswer");
  assert.doesNotMatch(fn, /render\(|setScene\(|innerHTML/);
  assert.doesNotMatch(fn, /eth_send|eth_sign|personal_|wallet_|sendTransaction|signTypedData/);
  assert.doesNotMatch(fn, /permission\s*=|executionPermission|recordSecondJourneyReceipt\(/);
  assert.match(fn, /recordSecondJourneyDecisionReceipt\(ensureSecondJourneyDomainState\(\), receipt\)/);
  assert.match(fn, /persistSecondJourneyDomainState\(\)/);
  assert.match(fn, /__env\.DEV|import\.meta\.env\.DEV/);
});

await check("the decision reads only for the current event (per-event freshness by construction)", () => {
  const fn = cutFunction("recomputeSecondJourneyFlow");
  assert.match(fn, /sj\.returnRead\.eventId === sj\.decisionEventId && sj\.returnRead\.answer === sj\.jitAnswer/);
  assert.match(fn, /requireFreshReturnObservation: true/);
  assert.match(fn, /selectionSource: SECOND_DECISION_SELECTION_SOURCE/);
  assert.match(cutFunction("handleCandidateCheck"), /sj\.decisionEventId = `check:/);
});

// ── 2. behaviour: actual main.js functions, memory localStorage ────────────────
const app = await loadMainSecondJourney();

await check("right_back on Kintsu (reader unconfigured) records ONE unknown action-0 Receipt in the existing key", async () => {
  const store = freshApp(app);
  app.handleCandidateCheck(KINTSU_DEST);
  const rendersBefore = app.__io.renders;
  app.handleJitAnswer("right_back");
  await settle();
  assert.equal(app.__io.renders - rendersBefore, 1, "handleJitAnswer renders exactly once, the record path adds none");
  const keys = Object.keys(store.dump());
  assert.ok(keys.includes(secondJourneyStorageKey(SCOPE)), "same Second Journey key");
  assert.equal(keys.filter((k) => k.startsWith("araso.secondJourney.")).length, 1, "no sidecar key");
  const rows = storedDecisions(store);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.decision, "unknown");
  assert.equal(r.reason, "missing_evidence");
  assert.equal(r.action, "none");
  assert.equal(r.actionCount, 0);
  assert.equal(r.txExecuted, false);
  assert.equal(r.evidence.readStatus, "reader_unconfigured");
  assert.equal(r.evidence.evidenceMode, "fresh_read_missing");
  assert.equal(r.evidence.block, null);
  assert.deepEqual(r.executionContext, { runtimeChain: "monad-testnet", jobChain: "monad-mainnet", executable: false, role: "evidence_only_other_chain" });
  assert.equal(r.selection.source, "app_ui_jit_answer");
  assert.equal(r.selection.ownerFinancialChoice, false);
  assert.equal(r.selection.createsPermission, false);
  assert.match(r.eventId, /^decision:check:kintsu-like-grow-delayed-return:/);
});

await check("same event + same answer again dedupes; a different answer is its own Receipt", async () => {
  const store = freshApp(app);
  app.handleCandidateCheck(KINTSU_DEST);
  app.handleJitAnswer("right_back");
  await settle();
  app.handleReadinessBack();   // clears the answer, stays on this check event
  app.handleJitAnswer("right_back");
  await settle();
  assert.equal(storedDecisions(store).length, 1);
  app.handleReadinessBack();
  app.handleJitAnswer("few_days");
  await settle();
  const rows = storedDecisions(store);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.expected).sort(), ["few_days", "right_back"]);
  assert.ok(rows.every((r) => r.decision === "unknown" && r.actionCount === 0));
});

await check("preference, interests and knowledge are untouched by recording", async () => {
  const store = freshApp(app);
  const before = JSON.parse(JSON.stringify(app.state.secondJourney.domainState || loadSecondJourneyState(store, SCOPE).state));
  app.handleCandidateCheck(KINTSU_DEST);
  app.handleJitAnswer("right_back");
  await settle();
  const after = loadSecondJourneyState(store, SCOPE).state;
  assert.deepEqual(after.preference, before.preference);
  assert.deepEqual(after.interests, before.interests);
  assert.deepEqual(after.knowledgeState, before.knowledgeState);
});

await check("unauthenticated scope and DEV preview persist nothing", async () => {
  const anon = freshApp(app, { address: "" });
  app.handleCandidateCheck(KINTSU_DEST);
  app.handleJitAnswer("right_back");
  await settle();
  assert.deepEqual(Object.keys(anon.dump()).filter((k) => k.startsWith("araso.secondJourney.")), []);
  const dev = freshApp(app, { dev: true });
  app.state.secondJourney.devPreview = true;
  app.handleCandidateCheck(KINTSU_DEST);
  app.handleJitAnswer("right_back");
  await settle();
  assert.deepEqual(Object.keys(dev.dump()).filter((k) => k.startsWith("araso.secondJourney.")), []);
});

await check("a destination not bound to a real Job records nothing", async () => {
  const store = freshApp(app);
  app.handleCandidateCheck("aave-like-grow-supply");
  app.handleJitAnswer("right_back");
  await settle();
  assert.equal(storedDecisions(store).length, 0);
});

// ── 3. configured reader (fake fetch): the seam main.js would use once a config exists ──
const configured = await loadMainSecondJourney({ readConfig: { rpcUrl: "https://read.invalid/rpc" } });

await check("configured reader: right_back → nah with the decision-time block; pinned read-only calls", async () => {
  const rpc = fakeRpc({ block: 107600001 });
  const store = freshApp(configured);
  configured.__io.fetch = rpc.impl;
  configured.handleCandidateCheck(KINTSU_DEST);
  const rendersBefore = configured.__io.renders;
  configured.handleJitAnswer("right_back");
  await settle(); await settle();
  assert.equal(configured.__io.renders - rendersBefore, 1);
  const [r] = storedDecisions(store);
  assert.equal(r.decision, "nah");
  assert.equal(r.reason, "semantic_return_mismatch");
  assert.equal(r.category, "rule_nah");
  assert.equal(r.evidence.block, 107600001);
  assert.equal(r.evidence.readStatus, "ok");
  assert.equal(r.evidence.evidenceMode, "live_observation");
  assert.equal(r.actionCount, 0);
  assert.deepEqual([...new Set(rpc.calls.map((c) => c.method))].sort(), ["eth_blockNumber", "eth_call", "eth_chainId", "eth_getCode"]);
  const tags = rpc.calls.filter((c) => c.method === "eth_getCode" || c.method === "eth_call").map((c) => c.params[1]);
  assert.ok(tags.length >= 2 && tags.every((t) => t === `0x${(107600001).toString(16)}`), "every state read pinned to the one head block");
});

await check("configured reader: a read never carries over to a new check event", async () => {
  const store = freshApp(configured);
  configured.__io.fetch = fakeRpc({ block: 107600002 }).impl;
  configured.handleCandidateCheck(KINTSU_DEST);
  configured.handleJitAnswer("right_back");
  await settle(); await settle();
  configured.handleReadinessBack();   // back to the answer screen
  configured.handleReadinessBack();   // back to candidates: this check event ends
  configured.__io.fetch = fakeRpc({ fail: true }).impl;
  configured.handleCandidateCheck(KINTSU_DEST);
  configured.handleJitAnswer("right_back");
  await settle(); await settle();
  const rows = storedDecisions(store);
  assert.equal(rows.length, 2);
  const latest = rows[0];
  assert.equal(latest.decision, "unknown");
  assert.equal(latest.evidence.readStatus, "rpc_unreachable");
  assert.equal(latest.evidence.block, null);
});

await check("configured reader: user moved on before the read returned → nothing recorded", async () => {
  const store = freshApp(configured);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const rpc = fakeRpc();
  configured.__io.fetch = async (...args) => { await gate; return rpc.impl(...args); };
  configured.handleCandidateCheck(KINTSU_DEST);
  configured.handleJitAnswer("right_back");
  configured.handleReadinessBack();
  configured.handleReadinessBack();
  release();
  for (let i = 0; i < 6; i += 1) await settle();
  assert.equal(storedDecisions(store).length, 0);
});

await check("configured reader: exit-fee changed on chain → unknown (conflict), never nah", async () => {
  const store = freshApp(configured);
  configured.__io.fetch = fakeRpc({ fee: 25 }).impl;
  configured.handleCandidateCheck(KINTSU_DEST);
  configured.handleJitAnswer("right_back");
  await settle(); await settle();
  const [r] = storedDecisions(store);
  assert.equal(r.decision, "unknown");
  assert.equal(r.reason, "source_conflict");
});

// ── 4. no visible change: the readiness / candidates markup does not depend on the read ──
function viewModel(sj, flow) {
  const chosen = (flow?.destinations || []).find((d) => d.id === sj.chosenDestinationId) || null;
  const preflight = flow?.preflight || null;
  return {
    journeyNumber: 2, step: sj.step, errands: [], selectedIds: sj.selectedIds, note: null,
    destinations: flow?.destinations || [], pickedCandidateId: sj.pickedCandidateId, errandLabelById: {},
    chosen, decision: chosen?.decision || null, jitQuestion: flow?.jitQuestions?.[0] || null, jitAnswer: sj.jitAnswer,
    preflight, permission: false, amount: "", amountError: null, canSend: false,
    sendReason: secondJourneySendReason(preflight, false), devPreview: false,
    balanceLine: null, failureLine: preflight?.status === "JOB_ELIGIBLE_NEEDS_FUNDING" ? "> cannot go · needs funding" : null,
    costLine: null, returnEstimate: null, claimValue: null,
  };
}

await check("readiness markup is byte-identical before the read, with no reader, with a nah read, and with a failed read", async () => {
  const markups = [];
  for (const [mod, fetchImpl] of [[app, null], [configured, fakeRpc().impl], [configured, fakeRpc({ fail: true }).impl]]) {
    freshApp(mod);
    mod.__io.fetch = fetchImpl;
    mod.handleCandidateCheck(KINTSU_DEST);
    mod.handleJitAnswer("right_back");
    const sj = mod.state.secondJourney;
    markups.push(secondJourneyCardMarkup(viewModel(sj, sj.flow)));   // what render() drew
    await settle(); await settle();
    markups.push(secondJourneyCardMarkup(viewModel(sj, sj.flow)));   // what the next render would draw
  }
  assert.ok(markups.every((m) => m === markups[0]), "readiness markup changed with the decision-time read");
  assert.match(markups[0], /id="secondSendButton"[^>]*disabled/);
});

console.log(`\n${pass}/${pass} PASS`);
