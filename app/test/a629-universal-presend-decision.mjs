// [A-629] Universal pre-Send decision contract across >=2 studied Job families.
//   node app/test/a629-universal-presend-decision.mjs
// No network, no browser, no tx. Observations below are FAKE test inputs (labelled as such);
// the real-browser proof with a real read-only read lives in the A-629 VERIFY receipt.
//
// Contract under test (98 §19.7 / FINANCE ref §6 item 7):
//   material ambiguity (no agreed meaning yet) -> ask, action 0   — for ANY bound Job family
//   clear agreed-meaning mismatch + fresh evidence -> nah, action 0 + Receipt
//   missing / stale / null-config / no-read-plan / unpublished duration -> unknown, action 0, never nah
//   match -> still no execution: action none, no permission, no Receipt, not READY
//   Receipt-only small change -> NOT_IMPLEMENTED (no code path; not fabricated)
//   decisions never touch preference / dislike
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ACTION, RESULT } from "../src/rule-decision.js";
import { STATUS, buildDestinationFixtures, deriveDestinationStatus, runSecondJourney } from "../src/job-feed.js";
import {
  createMemoryStorage, createSecondJourneyState, loadSecondJourneyState, readSecondJourneyDecisionReceipts,
  recordSecondJourneyDecisionReceipt, validateDecisionReceipt,
} from "../src/second-journey-state.js";

const SRC_DIR = new URL("../src/", import.meta.url);
const MAIN = readFileSync(new URL("main.js", SRC_DIR), "utf8");
const ADDRESS = "0x00000000000000000000000000000000000a6291";
const SCOPE = { accountId: ADDRESS, chainId: "monad-testnet" };
const KINTSU_DEST = "kintsu-like-grow-delayed-return";
const AAVE_DEST = "aave-like-grow-supply";
const BIND = { [AAVE_DEST]: "aave-usdc" };
// FAKE decision-time observations (test inputs only, not chain evidence).
const FAKE_KINTSU_OBS = { source: "fake test rpc @107700001", observedAt: "2026-09-29T01:00:00Z", block: 107700001, chainId: 143, codePresent: true, exitFeeBips: 10 };
const FAKE_AAVE_OBS = { source: "fake test rpc @107700002", observedAt: "2026-09-29T01:00:00Z", block: 107700002, chainId: 143, codePresent: true };

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (error) { console.log(`FAIL  ${label}\n      ${String(error?.message || error).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}
const byId = (list, id) => list.find((d) => d.id === id);

// ── A. binding a second family to its real studied Job record ────────────────────────
await check("A1 product default: only Kintsu is bound; the Aave-like fixture stays unbound", () => {
  const list = buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" });
  assert.equal(byId(list, KINTSU_DEST).boundJobId, "kintsu-smon");
  assert.equal(byId(list, AAVE_DEST).boundJobId, undefined);
  assert.equal(deriveDestinationStatus(byId(list, AAVE_DEST), { returnTolerance: "right_back" }).status, STATUS.JOB_ELIGIBLE_NEEDS_FUNDING);
});

await check("A2 grow_stable binding: Aave-like -> aave-usdc with provenance; no READY, no status promotion", () => {
  const list = buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" }, { jobBindings: BIND });
  const aave = byId(list, AAVE_DEST);
  assert.equal(aave.boundJobId, "aave-usdc");
  assert.equal(aave.jobChain, "monad-mainnet");
  assert.deepEqual(aave.executionContext, { runtimeChain: "monad-testnet", jobChain: "monad-mainnet", executable: false, role: "evidence_only_other_chain" });
  assert.equal(aave.returnEvidence.provenance.jobId, "aave-usdc");
  assert.equal(aave.returnEvidence.provenance.exitMode, "immediate");
  assert.deepEqual(aave.returnEvidence.provenance.forkEvidence, { label: "PASS_FORK_SIM", block: 106616273, note: "$5 -> 5.016499 recovered (fork-evidence 2026-09, 30-day time-warped fork simulation, not immediate/earned)" });
  assert.equal(aave.returnEvidence.provenance.liveRead, null, "no recorded live read is invented for aave-usdc");
  assert.equal(aave.returnEvidence.observedAt, null);
  assert.equal(aave.capabilityStatus, "qualified");
  assert.equal(aave.currentPiggyStatus, "NEEDS_FUNDING");
  assert.ok(aave.evidenceState.sourceTasks.includes("universal-presend-binding"));
  assert.equal(byId(list, KINTSU_DEST).boundJobId, "kintsu-smon");
});

await check("A3 refused bindings leave the fixture list unchanged (unknown Job, family mismatch, already bound, conditional)", () => {
  const base = JSON.stringify(buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" }));
  for (const jobBindings of [
    { [AAVE_DEST]: "kintsu-smon" },                  // delayed Job onto an immediate fixture
    { [AAVE_DEST]: "nope" },                         // not a studied Job
    { [KINTSU_DEST]: "aave-usdc" },                  // already bound
    { "monad-swap-like-trade": "aave-usdc" },        // conditional fixture ≠ immediate Job
    { "merkl-like-collect-claim": "protect-revoke-allowance" },
    [["aave-like-grow-supply", "aave-usdc"]],        // not a map
  ]) {
    assert.equal(JSON.stringify(buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" }, { jobBindings })), base, JSON.stringify(jobBindings));
  }
});

// ── B. ask is universal: any bound Job with no agreed meaning yet asks, action 0 ────────
await check("B1 ask before any answer, for BOTH families (grow_delayed Kintsu, grow_stable Aave)", () => {
  const list = buildDestinationFixtures({ address: ADDRESS, chain: "monad-testnet" }, { jobBindings: BIND });
  for (const id of [KINTSU_DEST, AAVE_DEST]) {
    const d = deriveDestinationStatus(byId(list, id), {});
    assert.deepEqual(d, { status: STATUS.JOB_OPEN, reasonCode: "return_tolerance_unknown", action: ACTION.ASK }, id);
  }
});

// ── C. matrix through the real Second Journey flow (runSecondJourney) ──────────────────
function flow(dest, answer, { obs = null, bind = true, seq = 1 } = {}) {
  const jobId = dest === KINTSU_DEST ? "kintsu-smon" : "aave-usdc";
  return runSecondJourney({
    selectionKind: "one", selectedErrandIds: ["grow"], scope: SCOPE, jitAnswer: answer, preferredDestinationId: dest,
    requireFreshReturnObservation: true, nowMs: Date.parse("2026-09-29T01:00:01Z"), decisionEventId: `check:${dest}:t:${seq}`,
    selectionSource: "app_ui_jit_answer", returnObservations: obs ? { [jobId]: obs } : undefined,
    returnReadStatus: obs ? "ok" : "reader_unconfigured", decisionAt: "2026-09-29T01:00:01Z", jobBindings: bind ? BIND : undefined,
  });
}
function assertAction0Receipt(f, want) {
  const r = f.decisionReceipt;
  assert.ok(r, "a decision Receipt exists");
  assert.equal(r.decision, want.decision);
  assert.equal(r.reason, want.reason);
  assert.equal(r.jobId, want.jobId);
  assert.equal(r.action, "none");
  assert.equal(r.actionCount, 0);
  assert.equal(r.txExecuted, false);
  assert.equal(r.executionContext.executable, false);
  assert.equal(r.selection.createsPermission, false);
  assert.equal(validateDecisionReceipt(r, SCOPE).error, null, "existing validator accepts it");
  assert.notEqual(f.preflight?.executionPermission, true);
  assert.notEqual(f.preflight?.status, "JOB_READY");
  return r;
}

await check("C1 nah (grow_delayed example row): right_back vs Kintsu delayed exit, fresh read -> nah, block named", () => {
  const r = assertAction0Receipt(flow(KINTSU_DEST, "right_back", { obs: FAKE_KINTSU_OBS }), { decision: "nah", reason: "semantic_return_mismatch", jobId: "kintsu-smon" });
  assert.equal(r.category, "rule_nah");
  assert.equal(r.evidence.block, FAKE_KINTSU_OBS.block);
  assert.equal(r.found, "delayed");
});

await check("C2 unknown, never nah: no decision-time read (null config) on Kintsu AND on bound Aave", () => {
  assertAction0Receipt(flow(KINTSU_DEST, "right_back"), { decision: "unknown", reason: "missing_evidence", jobId: "kintsu-smon" });
  const r = assertAction0Receipt(flow(AAVE_DEST, "right_back"), { decision: "unknown", reason: "missing_evidence", jobId: "aave-usdc" });
  assert.equal(r.evidence.block, null);
  assert.equal(r.evidence.provenance.jobId, "aave-usdc");
});

await check("C3 unknown, not ask/nah: few_days/no_rush on Kintsu with a fresh read — duration unpublished, none invented", () => {
  for (const a of ["few_days", "no_rush"]) {
    assertAction0Receipt(flow(KINTSU_DEST, a, { obs: FAKE_KINTSU_OBS }), { decision: "unknown", reason: "return_duration_unknown", jobId: "kintsu-smon" });
  }
});

await check("C4 match (module level, FAKE observation): Aave immediate vs right_back/few_days/no_rush -> no execution, no Receipt, no permission", () => {
  for (const a of ["right_back", "few_days", "no_rush"]) {
    const f = flow(AAVE_DEST, a, { obs: FAKE_AAVE_OBS });
    const d = byId(f.destinations, AAVE_DEST).decision;
    assert.equal(d.semantic.result, RESULT.DO_IT, a);
    assert.equal(d.action, ACTION.NONE);
    assert.equal(d.reasonCode, "return_semantic_match_capability_open");
    assert.equal(f.decisionReceipt, null, "a match is not an action-0 stop Receipt");
    assert.equal(f.preflight.executionPermission, false);
    assert.notEqual(f.preflight.status, "JOB_READY");
    assert.equal(f.txExecuted, false);
  }
});

await check("C5 unbound Aave (product default) produces no Receipt at all", () => {
  assert.equal(flow(AAVE_DEST, "right_back", { bind: false }).decisionReceipt, null);
});

await check("C6 recording nah/unknown for either family never touches preference, dislike, interests", () => {
  const seeded = { ...createSecondJourneyState(SCOPE) };
  seeded.preference = { ...seeded.preference, yield: 0.12, reasonDislike: { novelty: 0.08 } };
  seeded.interests = [{ errandId: "grow" }];
  let s = seeded;
  const before = JSON.stringify({ p: s.preference, i: s.interests, k: s.knowledgeState });
  for (const f of [flow(KINTSU_DEST, "right_back", { obs: FAKE_KINTSU_OBS, seq: 1 }), flow(KINTSU_DEST, "right_back", { seq: 2 }), flow(AAVE_DEST, "right_back", { seq: 3 })]) {
    const out = recordSecondJourneyDecisionReceipt(s, f.decisionReceipt);
    assert.equal(out.recorded, true, out.error || "");
    s = out.state;
  }
  assert.equal(JSON.stringify({ p: s.preference, i: s.interests, k: s.knowledgeState }), before);
  assert.equal(readSecondJourneyDecisionReceipts(s).length, 3);
  assert.deepEqual(readSecondJourneyDecisionReceipts(s).map((r) => r.decision).sort(), ["nah", "unknown", "unknown"]);
});

// ── D. main.js wiring: the LOCAL_ONLY hooks, cut from the real main.js ───────────────────
function cutFunction(name) {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(MAIN);
  assert.ok(m, `main.js function ${name} not found`);
  const start = m.index + 1;
  const end = MAIN.indexOf("\n}\n", start);
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
  "localTestReturnReadConfig", "localTestJobBindings",
];
let mainModule = null;
async function loadMain() {
  if (mainModule) return mainModule;
  const url = (file) => new URL(file, SRC_DIR).href;
  // pre-A-859 baseline: cutConst("RETURN_EVIDENCE_READ_CONFIG") was the null product config. The harness keeps testing
  // the unconfigured-reader path, so it rebinds the const to null here; the real product value is pinned in E1 below.
  const consts = [cutConst("SECOND_DECISION_SELECTION_SOURCE"), cutConst("RETURN_EVIDENCE_READ_CONFIG").replace(/^const RETURN_EVIDENCE_READ_CONFIG = .*;$/, "const RETURN_EVIDENCE_READ_CONFIG = null;"), cutConst("LOCAL_TEST_RETURN_READ_HOOK"), cutConst("LOCAL_TEST_JOB_BINDINGS_HOOK")].join("\n");
  const body = FUNCTIONS.map(cutFunction).join("\n\n").replaceAll("import.meta.env.DEV", "__env.DEV").replaceAll("LOCAL_DEV_ENTRY", "__env.LOCAL");
  const code = `
import { runSecondJourney } from ${JSON.stringify(url("job-feed.js"))};
import { readReturnObservation } from ${JSON.stringify(url("second-job-readiness.js"))};
import { createSecondJourneyState, loadSecondJourneyState, saveSecondJourneyState, validatePersistenceScope, saveSecondJourneyDraft, recordSecondJourneyDecisionReceipt } from ${JSON.stringify(url("second-journey-state.js"))};
import { validateSecondAmount } from ${JSON.stringify(url("second-journey-view.js"))};
export const __env = { DEV: false, LOCAL: false };
export const __io = { store: null, renders: 0, fetch: null, hooks: {} };
const window = new Proxy({}, { get: (_, k) => (k === "localStorage" ? __io.store : __io.hooks[k]) });
const localStorage = new Proxy({}, { get: (_, k) => { const v = __io.store[k]; return typeof v === "function" ? v.bind(__io.store) : v; } });
const fetch = (...args) => __io.fetch(...args);
function render() { __io.renders += 1; }
export const state = { address: "", receipts: [], secondJourney: null };
${consts}
${body}
state.secondJourney = createEmptySecondJourney();
export { createEmptySecondJourney, handleCandidateCheck, handleJitAnswer, recomputeSecondJourneyFlow };
`;
  mainModule = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return mainModule;
}
function fakeRpc({ block = 107700010, fee = 10 } = {}) {
  const calls = [];
  const impl = async (_url, init) => {
    const req = JSON.parse(init.body);
    calls.push({ url: _url, method: req.method });
    const result = { eth_chainId: "0x8f", eth_blockNumber: `0x${block.toString(16)}`, eth_getCode: "0x6080604052", eth_call: `0x${fee.toString(16).padStart(64, "0")}` }[req.method];
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
  return { impl, calls };
}
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };
async function answer(app, { local, hooks, dest, value, rpc }) {
  const store = createMemoryStorage();
  app.__io.store = store; app.__io.renders = 0; app.__env.LOCAL = local; app.__io.hooks = hooks; app.__io.fetch = rpc ? rpc.impl : async () => { throw new Error("no network in this test"); };
  app.state.address = ADDRESS;
  app.state.secondJourney = app.createEmptySecondJourney();
  app.state.secondJourney.selectedIds = ["grow"];
  app.state.secondJourney.step = "candidates";
  app.recomputeSecondJourneyFlow();
  app.handleCandidateCheck(dest);
  const asked = app.state.secondJourney.flow.destinations.find((d) => d.id === dest)?.decision;
  app.handleJitAnswer(value);
  await settle();
  return { asked, rows: readSecondJourneyDecisionReceipts(loadSecondJourneyState(store, SCOPE).state) };
}
const HOOKS = { __ARASO_LOCAL_TEST_RETURN_READ__: { rpcUrl: "https://read.invalid/rpc" }, __ARASO_LOCAL_TEST_JOB_BINDINGS__: { [AAVE_DEST]: "aave-usdc" } };

await check("D1 outside LOCAL_DEV_ENTRY the hooks are ignored: Kintsu stays reader_unconfigured, Aave stays unbound", async () => {
  const app = await loadMain();
  const k = await answer(app, { local: false, hooks: HOOKS, dest: KINTSU_DEST, value: "right_back", rpc: fakeRpc() });
  assert.equal(k.rows.length, 1);
  assert.equal(k.rows[0].decision, "unknown");
  assert.equal(k.rows[0].evidence.readStatus, "reader_unconfigured");
  const a = await answer(app, { local: false, hooks: HOOKS, dest: AAVE_DEST, value: "right_back", rpc: fakeRpc() });
  assert.equal(a.asked.action, ACTION.NONE, "unbound Aave never asks");
  assert.equal(a.rows.length, 0);
});

await check("D2 LOCAL harness: Kintsu right_back -> nah labelled local_test_reader:ok; Aave (bound) asks, then unknown no_read_plan", async () => {
  const app = await loadMain();
  const rpc = fakeRpc({ block: 107700011 });
  const k = await answer(app, { local: true, hooks: HOOKS, dest: KINTSU_DEST, value: "right_back", rpc });
  assert.equal(k.asked.action, ACTION.ASK);
  assert.equal(k.rows.length, 1);
  assert.equal(k.rows[0].decision, "nah");
  assert.equal(k.rows[0].evidence.readStatus, "local_test_reader:ok");
  assert.equal(k.rows[0].evidence.block, 107700011);
  assert.ok(rpc.calls.every((c) => c.url === "https://read.invalid/rpc" && ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"].includes(c.method)));
  const a = await answer(app, { local: true, hooks: HOOKS, dest: AAVE_DEST, value: "right_back", rpc: fakeRpc() });
  assert.equal(a.asked.action, ACTION.ASK, "bound Aave asks the one JIT question");
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].jobId, "aave-usdc");
  assert.equal(a.rows[0].decision, "unknown");
  assert.equal(a.rows[0].evidence.readStatus, "local_test_reader:no_read_plan");
});

await check("D3 malformed LOCAL hooks fail closed (http URL, array bindings, non-string Job)", async () => {
  const app = await loadMain();
  for (const hooks of [
    { __ARASO_LOCAL_TEST_RETURN_READ__: { rpcUrl: "http://read.invalid/rpc" }, __ARASO_LOCAL_TEST_JOB_BINDINGS__: [[AAVE_DEST, "aave-usdc"]] },
    { __ARASO_LOCAL_TEST_RETURN_READ__: "https://read.invalid/rpc", __ARASO_LOCAL_TEST_JOB_BINDINGS__: { [AAVE_DEST]: 7 } },
  ]) {
    const k = await answer(app, { local: true, hooks, dest: KINTSU_DEST, value: "right_back", rpc: fakeRpc() });
    assert.equal(k.rows[0].evidence.readStatus, "reader_unconfigured");
    const a = await answer(app, { local: true, hooks, dest: AAVE_DEST, value: "right_back", rpc: fakeRpc() });
    assert.equal(a.rows.length, 0);
  }
});

// ── E. source contract ─────────────────────────────────────────────────────────────
await check("E1 product reader config is the A-859 finalized config (was null pre-A-859); single RPC literal; hooks locked behind LOCAL_DEV_ENTRY", () => {
  // pre-A-859 baseline: assert.match(MAIN, /\nconst RETURN_EVIDENCE_READ_CONFIG = null;\n/);
  // pre-A-859 baseline: assert.doesNotMatch(MAIN, /https:\/\/rpc\.monad\.xyz/);
  assert.match(MAIN, /\nconst RETURN_EVIDENCE_READ_CONFIG = Object\.freeze\(\{ rpcUrl: "https:\/\/rpc\.monad\.xyz", finality: "finalized" \}\);\n/);
  assert.equal((MAIN.match(/https:\/\/rpc\.monad\.xyz/g) || []).length, 1, "exactly one mainnet RPC literal in main.js");
  assert.match(cutFunction("localTestReturnReadConfig"), /^function localTestReturnReadConfig\(\) \{\n  if \(!LOCAL_DEV_ENTRY\) return null;/);
  assert.match(cutFunction("localTestJobBindings"), /^function localTestJobBindings\(\) \{\n  if \(!LOCAL_DEV_ENTRY\) return undefined;/);
  assert.match(cutFunction("recordSecondJourneyDecisionForAnswer"), /RETURN_EVIDENCE_READ_CONFIG \? null : localTestReturnReadConfig\(\)/);
  assert.match(cutFunction("recordSecondJourneyDecisionForAnswer"), /`local_test_reader:\$\{read\.status\}`/);
});

await check("E2 Receipt-only small in-boundary change has no code path (NOT_IMPLEMENTED stays honest, nothing fabricated)", () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".js"));
  const hits = files.filter((f) => /receipt_only|receiptOnly|in_boundary_change|inBoundaryChange/.test(readFileSync(new URL(f, SRC_DIR), "utf8")));
  assert.deepEqual(hits, []);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
