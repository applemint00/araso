// [A-719] Second Journey product UI close — Explore shows the Second lane candidates (max 3 shown, whole universe
// decided), a pick (ok) records only an action-0 decision Receipt (A-727: a Home leave records none), Send stays disabled, Home stays quiet.
//   node app/test/a719-second-product-ui.mjs
//
// Part N (node, always): the lane rows (A-710 decisions × readiness family table × A-715 descriptor view), the
//   view mapping (max-3 presentation cut, UNKNOWN/NAH only), the action card markup, and the ACTUAL main.js
//   lane functions cut out of main.js and run against the real modules with a memory store.
// Part B (real browser, default ON when the local harness exists): Playwright + CDP virtual authenticator on a
//   local Vite dev server (127.0.0.1, free port, --strictPort). Real clicks through Explore → candidates →
//   leave / pick → ok → action card → reload/reopen → Home; DEV-preview completion → quiet Home; 390/430/700/1440.
//   Env: A719_SHOTS=<dir> saves PNGs; A719_NODE_ONLY=1 skips Part B (prints SKIP; not a PASS).
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FORK_MODE_ENV, FORK_MODE_INIT, RUN_SCOPE, forkFirstDone, forkKey, forkRpcStub } from "./helpers/fork-mode.mjs"; // [A-950] fork-profile mode (STALE_TESTS class (a)): the Second UI opens only on the fork profile since A-948

import { readSecondCurrent } from "../src/second-current-reader.js";
import { decideCurrentCandidate, decideCurrentCandidates, exploreCandidateRows, MAINNET_LANE_CONFIG } from "../src/mainnet-job-lane.js";
import { listVisibleJobFamilies } from "../src/second-job-readiness.js";
import { exploreCandidateDestinations, secondJourneyCardMarkup, paperStatusCopy } from "../src/second-journey-view.js";
import {
  createMemoryStorage,
  createSecondJourneyState,
  saveSecondJourneyState,
  loadSecondJourneyState,
  reopenSecondJourneyDecisionReceipts,
  applyExploreSelection,
} from "../src/second-journey-state.js";
import { resolveChainProfile } from "../src/chain-profile.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const MAIN = readFileSync(path.join(SRC_DIR, "main.js"), "utf8");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
function constDecl(name) {
  const start = MAIN.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const missing: ${name}`);
  return MAIN.slice(start, MAIN.indexOf(";\n", start) + 1);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SCOPE = { accountId: ADDRESS, chainId: "monad-testnet" };
const TESTNET = resolveChainProfile(undefined);
const NOW = "2026-10-04T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const BASELINES = ["aave-usdc", "kintsu-smon", "protect-revoke-allowance", "abil-spot"];
const READY_WORDS = /JOB_READY|Send this one\?/;

// A reader row for the decision core, in the reader's own shape (second-current-reader.js row()).
function okRow(id, read = {}) {
  const status = { "aave-usdc": "aave_buildable", "neverland-usdc": "neverland_derived_assumed", "curvance-usdc": "curvance_erc4626", "protect-revoke-allowance": "protect_caller_supplied", "kintsu-smon": "kintsu_observation" }[id];
  return {
    id, status, reason: "fixture", read: {
      source: "read-only rpc eth_call @100", observedAt: NOW, chainId: 143, block: 100, codePresent: true,
      holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" }, allowanceRaw: "5", exitFeeBips: 10, ...read,
    },
  };
}
const rule = (candidateId, field, comparator, expected, eventId) => ({ kind: "agreed_rule", agreedBy: "user", eventId, candidateId, field, comparator, expected });

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════════════════

await check("N1 universe: the real reader (product: no reader config) reports 9 rows, every row is decided unknown/action 0, 4 family rows exist, none runnable", async () => {
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched += 1; throw new Error("no network in this test"); };
  try {
    const currentRead = await readSecondCurrent({ profile: TESTNET, piggyAddress: ADDRESS });
    assert.equal(fetched, 0, "nothing is read without a reader config");
    assert.equal(currentRead.candidates.length, 9);
    const decisions = decideCurrentCandidates({ currentRead, scope: SCOPE, eventId: "e1", selectionSource: "app_ui_explore_candidates", nowMs: NOW_MS, nowIso: NOW });
    assert.equal(decisions.length, 9, "every reader row is decided (universe preserved)");
    for (const d of decisions) {
      assert.equal(d.decision, "unknown"); assert.equal(d.action, "none"); assert.equal(d.executionPermission, false);
      assert.ok(d.receipt, `${d.candidateId} has an action-0 Receipt`);
    }
    const out = exploreCandidateRows({ decisions, families: listVisibleJobFamilies() });
    assert.equal(out.universe, 9);
    assert.deepEqual(out.rows.map((r) => r.candidateId), BASELINES);
    for (const r of out.rows) {
      assert.equal(r.status, "unknown"); assert.equal(r.runnable, false); assert.equal(r.executionPermission, false); assert.equal(r.liveExecution, false);
      assert.ok(Object.isFrozen(r));
      assert.equal(Object.keys(r).some((k) => /ready/i.test(k)), false);
    }
    assert.deepEqual([...out.rows[0].alternatives].sort(), ["curvance-usdc", "neverland-usdc"], "alternatives stay in the universe, not shown");
    assert.equal(MAINNET_LANE_CONFIG.liveExecution, false); assert.equal(MAINNET_LANE_CONFIG.reader, null);
  } finally { globalThis.fetch = realFetch; }
});

await check("N2 stale / missing / conflicting / unsupported → UNKNOWN; even a matching agreed rule stays UNKNOWN (never READY); only an evidenced breach is NAH", async () => {
  const ev = "e2";
  const cases = [
    ["stale", { candidates: [okRow("aave-usdc", { stale: true })] }, "aave-usdc", rule("aave-usdc", "piggyUsdcRaw", "gte", "1", ev)],
    ["expiry without clock", { candidates: [okRow("aave-usdc", { expiresAtMs: NOW_MS + 1000 })] }, "aave-usdc", rule("aave-usdc", "piggyUsdcRaw", "gte", "1", ev)],
    ["missing", { candidates: [{ id: "protect-revoke-allowance", status: "target_missing", reason: "protect_target_not_supplied", read: null }] }, "protect-revoke-allowance", rule("protect-revoke-allowance", "allowanceRaw", "eq", "0", ev)],
    ["conflicting chain", { candidates: [okRow("aave-usdc", { chainId: 10143 })] }, "aave-usdc", rule("aave-usdc", "piggyUsdcRaw", "gte", "1", ev)],
    ["conflict flag", { candidates: [okRow("kintsu-smon", { conflict: true })] }, "kintsu-smon", null],
    ["unsupported (aBIL quote)", { candidates: [{ id: "abil-spot", status: "unknown", reason: "unsupported:unreadable_result", read: null, unknownClass: "unsupported" }] }, "abil-spot", null],
    ["match", { candidates: [okRow("aave-usdc")] }, "aave-usdc", rule("aave-usdc", "piggyUsdcRaw", "gte", "1", ev)],
  ];
  for (const [label, currentRead, id, r] of cases) {
    const decisions = decideCurrentCandidates({ currentRead, agreedRules: r ? { [id]: r } : {}, scope: SCOPE, eventId: ev, nowIso: NOW });
    const rows = exploreCandidateRows({ decisions, families: listVisibleJobFamilies() }).rows;
    const row = rows.find((x) => x.candidateId === id);
    assert.equal(row.status, "unknown", label);
    const dest = exploreCandidateDestinations(rows, { selectedErrandIds: ["grow", "clean", "asset-piece"], max: 9 });
    for (const d of dest) assert.ok(["UNKNOWN", "NAH"].includes(d.derivedStatus), label);
    assert.equal(READY_WORDS.test(JSON.stringify(dest)), false, label);
  }
  // an evidenced breach of the rule agreed for this event → nah (the only way a row can be NAH)
  const breach = decideCurrentCandidates({ currentRead: { candidates: [okRow("aave-usdc", { holdings: { usdcRaw: "100", receiptRaw: "0", allowanceToPoolRaw: "0" } })] }, agreedRules: { "aave-usdc": rule("aave-usdc", "piggyUsdcRaw", "gte", "500", ev) }, scope: SCOPE, eventId: ev, nowIso: NOW });
  assert.equal(breach[0].decision, "nah");
  const nahRows = exploreCandidateRows({ decisions: breach, families: listVisibleJobFamilies() }).rows;
  assert.equal(nahRows[0].status, "nah");
  assert.equal(exploreCandidateDestinations(nahRows, { selectedErrandIds: ["grow"] })[0].derivedStatus, "NAH");
  // a preference or a permission-shaped object is never an agreed rule → unknown
  const pref = decideCurrentCandidates({ currentRead: { candidates: [okRow("aave-usdc")] }, agreedRules: { "aave-usdc": { kind: "preference", liquidity: 0.5 } }, scope: SCOPE, eventId: ev, nowIso: NOW });
  assert.equal(exploreCandidateRows({ decisions: pref, families: listVisibleJobFamilies() }).rows[0].status, "unknown");
});

await check("N3 max-3 is presentation only: 4 eligible families → 3 shown; picks follow the Explore errands; universe and alternatives are not cut", () => {
  const rows = exploreCandidateRows({ decisions: [], families: listVisibleJobFamilies() }).rows;
  const all3 = exploreCandidateDestinations(rows, { selectedErrandIds: ["grow", "clean", "asset-piece"], max: 3 });
  assert.equal(all3.length, 3);
  // [A-727 re-pin: L2 fixed] pass 1 = one row per selected lane (Grow, Protect, Own), so abil-spot is no longer hidden behind a second Grow
  assert.deepEqual(all3.map((d) => d.id), ["aave-usdc", "protect-revoke-allowance", "abil-spot"]);
  assert.equal(exploreCandidateDestinations(rows, { selectedErrandIds: ["grow", "clean", "asset-piece"], max: 9 }).length, 4, "the 4th is still eligible, only not shown");
  assert.deepEqual(exploreCandidateDestinations(rows, { selectedErrandIds: ["grow"] }).map((d) => d.id), ["aave-usdc", "kintsu-smon"]);
  assert.deepEqual(exploreCandidateDestinations(rows, { selectedErrandIds: ["asset-piece", "grow"] }).map((d) => d.id), ["aave-usdc", "abil-spot", "kintsu-smon"]); // [A-727 re-pin: pass order grow_stable, own_rwa, then grow_delayed]
  assert.deepEqual(exploreCandidateDestinations(rows, { selectedErrandIds: ["clean"] }).map((d) => d.id), ["protect-revoke-allowance"]);
  assert.equal(exploreCandidateDestinations(rows, { selectedErrandIds: ["market", "order", "claim"] }).length, 0, "no family → no invented row");
  for (const d of all3) { assert.equal(d.laneCandidate, true); assert.equal(d.errandIds.length, 1); assert.equal(d.derivedStatus, "UNKNOWN"); }
  // MAX shown in main.js is the existing Explore display limit (3), not a new number
  assert.match(fnBody("secondLaneDestinations"), /max: MAX_EXPLORE_VISIBLE/);
  assert.match(MAIN, /const MAX_EXPLORE_VISIBLE = 3;/);
});

await check("N4 view: candidates card reuses the existing pick rows + checking… heading; the action card for a lane candidate has no amount field, a disabled Send and the Paper status only", () => {
  const rows = exploreCandidateRows({ decisions: [], families: listVisibleJobFamilies() }).rows;
  const destinations = exploreCandidateDestinations(rows, { selectedErrandIds: ["asset-piece", "grow"] });
  const cand = secondJourneyCardMarkup({ step: "candidates", destinations, pickedCandidateId: null, reading: true });
  assert.equal((cand.match(/class="job secondJourney__pick/g) || []).length, 3);
  // pre-A-849 baseline: assert.match(cand, /checking…/) on markup built with no read state (the heading always said "checking…")
  // [A-849 re-pin] "checking…" only while a read is in flight (reading: true); idle markup does not say it.
  assert.match(cand, /checking…/);
  assert.equal(/checking…/.test(secondJourneyCardMarkup({ step: "candidates", destinations, pickedCandidateId: null })), false, "[A-849] no read in flight -> no checking…");
  // [A-723] family titles, not the shared "grow" errand title; Explore interest wording stays on the interests step
  assert.deepEqual([...cand.matchAll(/class="job secondJourney__pick[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]), ["a quick trip", "try the stock market", "stay out a little longer"]); // [A-727 re-pin: pass order]
  assert.equal(/put some money to work|pick up a piece of an asset/.test(cand), false);
  assert.equal(READY_WORDS.test(cand), false);
  assert.match(cand, /id="secondOkButton"[^>]*disabled/);
  const nah = secondJourneyCardMarkup({ step: "candidates", destinations: [{ ...destinations[0], derivedStatus: "NAH" }] });
  assert.match(nah, /aria-pressed="false" disabled/);
  for (const status of ["UNKNOWN", "NAH"]) {
    const chosen = { ...destinations[0], derivedStatus: status };
    const html = secondJourneyCardMarkup({ step: "readiness", chosen, preflight: { status, executionPermission: false }, canSend: false, sendReason: paperStatusCopy(status), devPreview: false });
    assert.match(html, /<h1 class="job">a quick trip<\/h1>/);
    assert.equal(/id="secondAmount"|class="receive"|to bring home/.test(html), false, "no amount/claim field");
    assert.match(html, /id="secondSendButton"[^>]*disabled/);
    assert.match(html, new RegExp(`id="secondSendReason">${status === "NAH" ? "nah\\." : "checking…"}<`));
    assert.equal(READY_WORDS.test(html), false);
  }
  // the old fixture action card is unchanged (amount field still drawn there)
  const fixture = secondJourneyCardMarkup({ step: "readiness", chosen: { id: "aave-like-grow-supply", laneId: "grow", errandIds: ["grow"] }, preflight: { status: "JOB_OPEN" }, canSend: false, sendReason: "x", devPreview: false });
  assert.match(fixture, /id="secondAmount"/);
});

// ── the ACTUAL main.js lane functions, cut out and run against the real modules ──────────────────────────
// [A-791 harness wiring] refreshSecondLaneCandidates now also routes the same read through the A-762 surface as evidence
// (secondLaneRouteEvidence); the real function and its real imports are added to this cut.
const LANE_FUNCTIONS = ["secondLaneMode", "secondLaneRows", "secondLaneDestinations", "keepSecondLaneDraftIfValid", "secondLaneRouteEvidence", "refreshSecondLaneCandidates", "recordSecondLaneDecision"];
async function loadLane() {
  const url = (f) => pathToFileURL(path.join(SRC_DIR, f)).href;
  const body = LANE_FUNCTIONS.map(fnBody).join("\n\n").replaceAll("import.meta.env.DEV", "__env.DEV");
  const code = `
import { readSecondCurrent, routeSecondCurrentRead } from ${JSON.stringify(url("second-current-reader.js"))};
import { routeSecondMainnetExecution, SECOND_MAINNET_DESCRIPTORS } from ${JSON.stringify(url("second-execution-adapter.js"))};
import { decideCurrentCandidate, decideCurrentCandidates, exploreCandidateRows } from ${JSON.stringify(url("mainnet-job-lane.js"))};
import { listVisibleJobFamilies } from ${JSON.stringify(url("second-job-readiness.js"))};
import { exploreCandidateDestinations } from ${JSON.stringify(url("second-journey-view.js"))};
import { validatePersistenceScope, recordSecondJourneyDecisionReceiptDurably } from ${JSON.stringify(url("second-journey-state.js"))};
import { resolveChainProfile } from ${JSON.stringify(url("chain-profile.js"))};
export const __env = { DEV: false };
export const __io = { store: null, renders: 0 };
const CHAIN_PROFILE = resolveChainProfile(undefined);
const MAX_EXPLORE_VISIBLE = 3;
export const state = { address: "", scene: "explore", secondJourney: null };
function secondJourneyScope() { return { accountId: state.address || "", chainId: "monad-testnet" }; }
function safeLocalStorage() { return __io.store; }
function render() { __io.renders += 1; }
${constDecl("SECOND_LANE_SELECTION_SOURCE")}
${constDecl("SECOND_ROUTE_LOCKS")}
${body}
export { ${LANE_FUNCTIONS.join(", ")} };
`;
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
}
function freshSj(over = {}) {
  return { step: "candidates", selectedIds: ["asset-piece", "grow"], devPreview: false, decisionEventSeq: 0, laneEventId: null, laneRead: null, laneDecisions: [], pickedCandidateId: null, chosenDestinationId: null, jitAnswer: null, amount: "", candidatesRevealed: true, domainState: null, ...over };
}
const storedDecisions = (store) => reopenSecondJourneyDecisionReceipts(store, SCOPE).receipts;

await check("N5 main.js refresh: reads with no reader config (0 network), decides the whole universe, shows ≤3 family rows, all UNKNOWN", async () => {
  const lane = await loadLane();
  lane.__io.store = createMemoryStorage();
  lane.state.address = ADDRESS;
  lane.state.secondJourney = freshSj();
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched += 1; throw new Error("no network"); };
  try { await lane.refreshSecondLaneCandidates(); } finally { globalThis.fetch = realFetch; }
  const sj = lane.state.secondJourney;
  assert.equal(fetched, 0);
  assert.equal(sj.laneDecisions.length, 9, "universe decided");
  assert.ok(sj.laneEventId.startsWith("explore-lane:"));
  assert.equal(sj.laneEventId.startsWith("explore-none-"), false, "never counted as an Explore round");
  const shown = lane.secondLaneDestinations(sj);
  assert.deepEqual(shown.map((d) => d.id), ["aave-usdc", "abil-spot", "kintsu-smon"]); // [A-727 re-pin: pass order]
  assert.ok(shown.every((d) => d.derivedStatus === "UNKNOWN"));
  assert.equal(lane.__io.renders, 0, "nothing changed on screen → no extra render");
  assert.equal(storedDecisions(lane.__io.store).length, 0, "showing candidates records nothing");
});

await check("N6 main.js try (home records nothing) → durable action-0 decision Receipts in the existing grammar; duplicate is verified, not rewritten; preference/interests untouched", async () => {
  const lane = await loadLane();
  const store = createMemoryStorage();
  lane.__io.store = store;
  lane.state.address = ADDRESS;
  // a stored learning state: interests + preference must survive the decision records unchanged
  let st = createSecondJourneyState(SCOPE);
  st = applyExploreSelection(st, { kind: "multi", errandIds: ["grow", "asset-piece"], errands: [{ id: "grow", label: "g", lane: "Grow" }, { id: "asset-piece", label: "a", lane: "Own" }] }, { preference: { ...st.preference, yield: 0.2 } }, { eventId: "explore-save-1-grow", now: NOW }).state;
  assert.ok(saveSecondJourneyState(store, SCOPE, st).saved);
  const before = loadSecondJourneyState(store, SCOPE).state;
  lane.state.secondJourney = freshSj();
  await lane.refreshSecondLaneCandidates();
  const sj = lane.state.secondJourney;

  assert.equal(lane.recordSecondLaneDecision(["aave-usdc"], "tryIt").saved, 1);
  let rows = storedDecisions(store);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.schema, "second_journey_decision_receipt_v1");
  assert.equal(r.destinationId, "aave-usdc"); assert.equal(r.decision, "unknown");
  assert.equal(r.did, "nothing"); assert.equal(r.action, "none"); assert.equal(r.actionCount, 0); assert.equal(r.txExecuted, false);
  assert.equal(r.executionContext.executable, false); assert.equal(r.executionContext.runtimeChain, "monad-testnet");
  assert.equal(r.selection.source, "app_ui_candidate_ok"); assert.equal(r.selection.createsPermission, false); assert.equal(r.selection.ownerFinancialChoice, false);
  assert.equal(r.evidence.readStatus, "read_failed"); assert.equal(r.evidence.readReason, "no_rpc");
  assert.equal(/permission"\s*:\s*true|"ready"|JOB_READY|txHash/i.test(JSON.stringify(r)), false);

  // same event twice → duplicate, still one row
  assert.equal(lane.recordSecondLaneDecision(["aave-usdc"], "tryIt").saved, 1);
  assert.equal(storedDecisions(store).length, 1);

  // [A-727 re-pin: supersedes A-719 L3] leaving via Home manufactures no Receipt for merely-shown rows
  assert.equal(lane.recordSecondLaneDecision(lane.secondLaneDestinations(sj).map((d) => d.id), "home").saved, 0);
  rows = storedDecisions(store);
  assert.equal(rows.length, 1);
  assert.equal(rows.filter((x) => x.selection.source === "app_ui_candidates_home").length, 0);

  // a fresh load (reopen) sees the same Receipts; learning state is byte-identical
  const after = loadSecondJourneyState(store, SCOPE).state;
  assert.deepEqual(after.interests, before.interests);
  assert.deepEqual(after.preference, before.preference);
  assert.deepEqual(after.preferenceEvents, before.preferenceEvents);
  assert.equal(after.processedEventIds.filter((id) => id.startsWith("explore-none-")).length, 0);
  assert.equal(sj.domainState.receipts.length, 1, "the verified merged state is adopted");
  // an unknown action word records nothing
  assert.equal(lane.recordSecondLaneDecision(["aave-usdc"], "send").saved, 0);
});

await check("N7 main.js boundaries: DEV preview fixture and an unauthenticated scope record nothing; a restored draft keeps only a visible lane candidate", async () => {
  const lane = await loadLane();
  const store = createMemoryStorage();
  lane.__io.store = store;
  lane.state.address = ADDRESS;
  lane.__env.DEV = true;
  lane.state.secondJourney = freshSj({ devPreview: true });
  assert.equal(lane.secondLaneMode(lane.state.secondJourney), false);
  assert.equal(lane.recordSecondLaneDecision(["aave-usdc"], "tryIt").saved, 0);
  lane.__env.DEV = false;
  lane.state.address = "";
  lane.state.secondJourney = freshSj();
  assert.equal(lane.recordSecondLaneDecision(["aave-usdc"], "tryIt").saved, 0);
  assert.equal(Object.keys(store.dump()).length, 0);

  const a = freshSj({ step: "readiness", chosenDestinationId: "aave-like-grow-supply", pickedCandidateId: "aave-like-grow-supply", jitAnswer: "few_days", amount: "3" });
  lane.keepSecondLaneDraftIfValid(a);
  assert.equal(a.step, "candidates"); assert.equal(a.chosenDestinationId, null); assert.equal(a.pickedCandidateId, null);
  assert.equal(a.jitAnswer, null); assert.equal(a.amount, "");
  const b = freshSj({ step: "readiness", chosenDestinationId: "kintsu-smon", pickedCandidateId: "kintsu-smon" });
  lane.keepSecondLaneDraftIfValid(b);
  assert.equal(b.step, "readiness"); assert.equal(b.chosenDestinationId, "kintsu-smon");
  const c = freshSj({ step: "readiness", selectedIds: ["clean"], chosenDestinationId: "kintsu-smon" });
  lane.keepSecondLaneDraftIfValid(c);
  assert.equal(c.chosenDestinationId, null, "not visible for the restored selection → dropped");
});

await check("N8 static: lane UI paths never reach permission / executor / lane intent / Send; canSend refuses lane mode; reader gets no config", () => {
  const lanePaths = [...LANE_FUNCTIONS, "handleSecondLaneTry"].map((n) => stripComments(fnBody(n))).join("\n");
  assert.equal(/advanceLaneIntent|startLaneIntent|buildLanePermissionPreview|executeMoneyStep|issuePermission|authorize\(|consume\(|requestGrant|sendTransaction|signDigest|handleSecondSend|setScene\("secondAway"|outcome\s*=|executionPermission:\s*true|permission\s*=\s*true/.test(lanePaths), false);
  // [A-938 RE-PIN] the reader now gets the profile rpcUrl + fetch + clock, read-only (testnet/blocked profile has no rpcUrl = no_rpc); the URL may come ONLY from CHAIN_PROFILE.rpcUrl.
  // pre-A-938: the exact call without config, and no rpcUrl / fetchImpl (/ transport) word in the function at all.
  assert.match(stripComments(fnBody("refreshSecondLaneCandidates")), /readSecondCurrent\(\{ profile: CHAIN_PROFILE, piggyAddress: state\.address \|\| "", rpcUrl: CHAIN_PROFILE\.rpcUrl, fetchImpl: fetch, now: \(\) => new Date\(\)\.toISOString\(\) \}\)/);
  assert.deepEqual([...stripComments(fnBody("refreshSecondLaneCandidates")).matchAll(/rpcUrl:\s*([^,}]+)/g)].map((m) => m[1].trim()), ["CHAIN_PROFILE.rpcUrl"]);
  assert.equal(/transport/.test(stripComments(fnBody("refreshSecondLaneCandidates"))), false);
  const vm = stripComments(fnBody("buildSecondJourneyViewModel"));
  assert.match(vm, /const canSend =\s*!laneMode &&\s*devPreview &&/);
  assert.match(vm, /laneMode \? \(chosen \? \{ status: chosen\.derivedStatus, executionPermission: false \} : null\)/);
  assert.match(vm, /jitQuestion: laneMode \? null/);
  // handleSecondSend still requires the DEV preview fixture + READY + exact permission (unchanged gate)
  assert.match(stripComments(fnBody("handleSecondSend")), /const canSend =\s*devPreview &&\s*preflight\?\.status === "JOB_READY" &&\s*preflight\?\.executionPermission === true/);
  // ok on a lane candidate goes to the lane path, never to the fixture check/JIT path
  const ok = stripComments(fnBody("handleCandidateOk"));
  assert.ok(ok.indexOf("handleSecondLaneTry") > 0 && ok.indexOf("handleSecondLaneTry") < ok.indexOf("handleCandidateCheck"));
  // completion still persists only from the Return "Home" with a confirmed outcome, and lands on quiet Home
  const ret = fnBody("mountSecondReturn");
  assert.match(ret, /const persistNow = persist && confirmed;/);
  assert.match(ret, /setScene\("sendstay", "Piggy is home\.", "Second errand filed\. \(preview\)"\);/);
  assert.match(fnBody("goHomeFromFilebox"), /state\.homeQuietForExplore = !state\.secondJourneyCompletedOnce;/);
  // no user-visible rule step: the candidates card only has pick rows + Home + ok
  assert.equal(/rule|agreed/i.test(secondJourneyCardMarkup({ step: "candidates", destinations: exploreCandidateDestinations(exploreCandidateRows({ families: listVisibleJobFamilies() }).rows, { selectedErrandIds: ["grow"] }) })), false);
});

// ═══ Part B — real browser ══════════════════════════════════════════════════════════════════════════════════
if (process.env.A719_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A719_NODE_ONLY=1) — browser scenarios not run");
} else {
  await runBrowser();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  let chromium;
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await check("B0 playwright available (local harness)", () => { throw e; });
    return;
  }
  const port = await freePort();
  const server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
    cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", ...FORK_MODE_ENV /* [A-950] */ }, stdio: ["ignore", "pipe", "pipe"], detached: false,
  });
  let browser = null;
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    const shots = process.env.A719_SHOTS || "";
    if (shots) mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    await browserRun(browser, `http://localhost:${port}/`, shots);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.kill("SIGTERM"); } catch {}
    await sleep(300);
    try { server.kill("SIGKILL"); } catch {}
  }
}

async function browserRun(browser, BASE, shots) {
  const net = { tx: 0, rpcLane: 0 };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
  await context.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) { net.tx += 1; return route.abort(); }
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && req.method() === "POST" && /grant/i.test(u.pathname)) { net.tx += 1; return route.abort(); }
    // the lane reader must read nothing (no reader config): any mainnet-pinned read would show up as these
    if (/getReserveData|convertToAssets|0x35ea6a75|0x07a2d13a/.test(body)) net.rpcLane += 1;
    return route.continue();
  });
  await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });

  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a719_${name}.png`) }); };
  const scene = () => p.evaluate(() => { const s = document.querySelector("[data-scene]"); const v = s?.dataset.scene ?? null; return v === "return" && s.querySelector(".secondJourney__mockTag") ? "secondReturn" : v; });
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
      const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
    }
    return null;
  }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
  // [A-891 CG-04/05] pre-A-891 baseline: after a reload with First done / Second not done, Explore opened by itself (~1.2 s, waitScene(["explore"])).
  // Now (Owner 2026-10-08): quiet Home ~8 s → "tap me!" → the user taps Chog → intro → Explore. forgetIntro() drops the once-per-user intro fact
  // before a reload so a later reopen takes the same product path (Cowork 2026-10-08: before the intro the cue returns on every reload).
  const forgetIntro = () => p.evaluate((k) => localStorage.removeItem(k), forkKey("araso.secondIntroSeen")); // [A-950] fork-scope key (pre-A-950: the testnet key)
  const exploreViaTapMe = async (ms = 16000) => {
    if ((await scene()) === "sendstay") await forkFirstDone(p); // [A-950] fork profile: the cue arms only after a filing (DEV return jump); a reload / the testnet First-done seed does not arm it there — RECEIPT (iii)-1
    const t0 = Date.now();
    while (Date.now() - t0 < ms && !(await p.locator(".chogHome__tapCue").count())) { if ((await scene()) === "explore") return "explore"; await sleep(200); }
    if (!(await p.locator(".chogHome__tapCue").count())) return `NOCUE:${await scene()}`;
    await mustTap("#chogHomeHit", "Chog (tap me!)");
    return waitScene(["explore"], 5000);
  };
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const step = () => p.evaluate(() => document.querySelector("#exploreForm") ? "interests" : document.querySelector(".secondJourney__jitBtn") ? "jit" : document.querySelector("#secondSendButton") ? "readiness" : document.querySelector("#secondOkButton") ? "candidates" : document.querySelector("#secondJourneyCard") ? "note" : null);
  const decisionRows = () => p.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k.startsWith("araso.secondJourney.")) continue;
      try { for (const r of JSON.parse(localStorage.getItem(k)).receipts || []) if (r.schema === "second_journey_decision_receipt_v1") out.push(r); } catch {}
    }
    return out;
  });
  const picks = () => p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].map((b) => ({ id: b.dataset.destinationId, text: b.textContent.trim(), disabled: b.disabled, hidden: b.hidden, picked: b.classList.contains("is-picked"), fits: b.scrollWidth <= b.clientWidth + 1 })));
  const layout = () => p.evaluate(() => {
    const card = document.querySelector("#secondJourneyCard")?.getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, card: card ? [card.left, card.top, card.right, card.bottom] : null };
  });
  const noOverflow = async (label) => {
    const l = await layout();
    assert.ok(l.sw <= l.iw + 1, `${label}: horizontal page overflow ${l.sw} > ${l.iw}`);
    assert.ok(l.card, `${label}: card present`);
    assert.ok(l.card[0] >= -1 && l.card[2] <= l.iw + 1, `${label}: card inside the viewport horizontally ${JSON.stringify(l.card)}`);
    assert.ok(l.card[1] >= -1 && l.card[3] <= l.ih + 1, `${label}: card inside the viewport vertically ${JSON.stringify(l.card)}`);
  };
  const reopenAt = async (w, h, wantStep) => {
    await p.setViewportSize({ width: w, height: h });
    await forgetIntro(); // [A-891]
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
    const sc = await exploreViaTapMe(); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 15000)
    assert.equal(sc, "explore", `${w}: Explore reopens (First done, Second not done)`);
    for (let t0 = Date.now(); Date.now() - t0 < 6000;) { if ((await step()) === wantStep) break; await sleep(200); }
    assert.equal(await step(), wantStep, `${w}: reopens at ${wantStep}`);
    await sleep(2200);
  };
  const quietFor = async (ms, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const s = await scene(); assert.notEqual(s, "explore", `${label}: Explore re-opened by itself`); await sleep(250); }
    assert.equal(await scene(), "sendstay", `${label}: quiet Home`);
  };
  const WIDTHS = [[390, 844], [430, 932], [700, 900], [1440, 900]];

  try {
    // ── birth + named Piggy + a closed First (same harness as A-654/A-644 Part B) ─────────────────────────
    await p.goto(BASE, { waitUntil: "networkidle" });
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
      if (v.input) break;
      if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
      await sleep(300);
    }
    await p.locator("#piggyNameInput").fill("Lanebun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000); await sleep(4500);
    if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }
    await p.evaluate(() => {
      const a = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a719f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa719-dep", redeemTxHash: "0xa719-red", grantTxHash: "0xa719-grant", status: "success", at: Date.parse("2026-10-04T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();

    await check("B1 product Explore opens by itself after First (no DEV preview): interests Paper, 3 errands, no rule-check step", async () => {
      assert.equal(await exploreViaTapMe(), "explore"); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000) (opened by itself)
      assert.equal(await step(), "interests");
      const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
      assert.ok(ids.length > 0 && ids.length <= 3, `errands ${ids}`);
      const text = await p.evaluate(() => document.querySelector("#secondJourneyCard").innerText);
      assert.match(text, /places to explore\?/);
      assert.equal(/rule|agree|permission/i.test(text), false);
      await shot("1440_interests_round0");
    });

    await check("B2 none → next round (existing okay. one more.); pick grow + asset-piece → candidates: checking… then ≤3 lane rows, all UNKNOWN, ok disabled until a pick", async () => {
      await mustTap("#exploreSaveButton", "save none"); await sleep(900);
      assert.equal(await step(), "interests");
      assert.match(await p.evaluate(() => document.querySelector("#secondJourneyCard").innerText), /okay\. one more\./);
      const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
      for (const want of ["grow", "asset-piece"]) {
        const idx = ids.indexOf(want); assert.ok(idx >= 0, `${want} on round 1 (${ids})`);
        await mustTap(".secondJourney__item", want, idx); await sleep(200);
      }
      await mustTap("#exploreSaveButton", "save"); await sleep(300);
      assert.equal(await step(), "candidates");
      // pre-A-849 baseline: assert.match(h2.innerText, /checking…/) — the heading faked "checking…" for CANDIDATES_REVEAL_MS with no read in flight
      // [A-849 re-pin] the product read settles at once, so after the save no read is in flight: no "checking…", rows already visible.
      assert.equal(/checking…/.test(await p.evaluate(() => document.querySelector("#secondJourneyCard h2").innerText)), false, "[A-849] no fake checking…");
      await sleep(2200);
      const rows = await picks();
      assert.deepEqual(rows.map((r) => r.id), ["aave-usdc", "abil-spot", "kintsu-smon"]); // [A-727 re-pin: pass order]
      assert.ok(rows.length <= 3 && rows.every((r) => !r.hidden && !r.disabled && !r.picked && r.fits));
      assert.deepEqual(rows.map((r) => r.text), ["a quick trip", "try the stock market", "stay out a little longer"]); // [A-727 re-pin: pass order]
      assert.equal(new Set(rows.map((r) => r.text)).size, rows.length, "[A-723] visible candidate titles are unique in one card");
      assert.equal(await p.evaluate(() => document.querySelector("#secondOkButton").disabled), true);
      assert.equal(/Send this one\?/.test(await p.evaluate(() => document.querySelector("#secondJourneyCard").innerText)), false);
      assert.equal((await decisionRows()).length, 0, "showing candidates records nothing");
      await shot("1440_candidates");
    });

    await check("B3 leave (Home on the candidates card) → 0 decision Receipts for merely-shown rows [A-727 re-pin]; quiet Home, no Explore loop", async () => {
      await mustTap("#stayButton", "Home");
      assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
      const rows = await decisionRows();
      assert.equal(rows.length, 0, "Home records nothing for rows that were only shown");
      await quietFor(7000, "after leave");
    });

    await check("B4 reopen after reload: Explore returns (Second not done) with the picked errands kept; still 0 Receipts [A-727 re-pin]", async () => {
      await reopenAt(1440, 900, "interests");
      const checked = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input:checked")].map((e) => e.dataset.errandId).sort());
      assert.deepEqual(checked, ["asset-piece", "grow"]);
      assert.equal((await decisionRows()).length, 0);
    });

    await check("B5 mobile/desktop: interests Paper at 390/430/700/1440 — no overflow, save reachable", async () => {
      for (const [w, h] of WIDTHS) {
        await reopenAt(w, h, "interests");
        await noOverflow(`interests@${w}`);
        assert.ok(await pointAt("#exploreSaveButton"), `save reachable @${w}`);
        assert.ok(await pointAt("#stayButton"), `back to Home reachable @${w}`);
        await shot(`${w}_interests`);
      }
    });

    await check("B6 pick a candidate (draft keeps it across reload) at 390/430/700/1440 — no overflow, rows/ok/Home reachable", async () => {
      await mustTap("#exploreSaveButton", "save again"); await sleep(2600);
      assert.equal(await step(), "candidates");
      await mustTap('.secondJourney__pick[data-destination-id="aave-usdc"]', "pick aave"); await sleep(500);
      assert.equal(await p.evaluate(() => document.querySelector("#secondOkButton").disabled), false);
      for (const [w, h] of WIDTHS) {
        await reopenAt(w, h, "candidates");
        const rows = await picks();
        assert.ok(rows.length === 3 && rows.every((r) => r.fits), `rows @${w}`);
        assert.equal(rows.find((r) => r.picked)?.id, "aave-usdc", `pick restored @${w}`);
        await noOverflow(`candidates@${w}`);
        for (let i = 0; i < rows.length; i += 1) assert.ok(await pointAt(".secondJourney__pick", i), `row ${i} reachable @${w}`);
        assert.ok(await pointAt("#secondOkButton"), `ok reachable @${w}`);
        assert.ok(await pointAt("#stayButton"), `Home reachable @${w}`);
        await shot(`${w}_candidates_picked`);
      }
    });

    await check("B7 ok (try) → action card: chosen action, no amount, Send disabled, Paper status checking…; one try Receipt; Send cannot be forced", async () => {
      await mustTap("#secondOkButton", "ok"); await sleep(900);
      assert.equal(await step(), "readiness");
      const v = await p.evaluate(() => ({
        job: document.querySelector("#secondJourneyCard h1.job")?.innerText, amount: !!document.querySelector("#secondAmount"), jit: !!document.querySelector(".secondJourney__jitBtn"),
        send: document.querySelector("#secondSendButton").disabled, reason: document.querySelector("#secondSendReason")?.innerText, text: document.querySelector("#secondJourneyCard").innerText,
      }));
      assert.equal(v.job, "a quick trip"); assert.equal(v.amount, false); assert.equal(v.jit, false);
      assert.equal(v.send, true); assert.equal(v.reason, "checking…");
      assert.equal(/Send this one\?|permission|rule/i.test(v.text), false);
      const tries = (await decisionRows()).filter((r) => r.selection.source === "app_ui_candidate_ok");
      assert.equal(tries.length, 1); assert.equal(tries[0].destinationId, "aave-usdc"); assert.equal(tries[0].decision, "unknown");
      // force the disabled button: the Send handler's own gate still refuses (no DEV preview, nothing READY)
      await p.evaluate(() => { const b = document.querySelector("#secondSendButton"); b.disabled = false; b.click(); });
      await sleep(1200);
      assert.equal(await scene(), "explore"); assert.equal(await step(), "readiness");
      await shot("1440_action_card");
    });

    await check("B8 action card at 390/430/700/1440 after reload (reopen keeps the chosen candidate, Receipts not duplicated) — no overflow, Home reachable, Send disabled", async () => {
      for (const [w, h] of WIDTHS) {
        await reopenAt(w, h, "readiness");
        assert.equal(await p.evaluate(() => document.querySelector("#secondJourneyCard h1.job")?.innerText), "a quick trip");
        assert.equal(await p.evaluate(() => document.querySelector("#secondSendButton").disabled), true);
        await noOverflow(`action@${w}`);
        assert.ok(await pointAt("#stayButton"), `Home reachable @${w}`);
        await shot(`${w}_action_card`);
      }
      const rows = await decisionRows();
      assert.equal(rows.length, 1, "1 try; Home recorded none; reloads add none [A-727 re-pin]");
    });

    await check("B9 Home from the action card → quiet Home, no Explore loop, no new Receipt", async () => {
      await mustTap("#stayButton", "Home from action card");
      assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
      await quietFor(7000, "after action card");
      assert.equal((await decisionRows()).length, 1); // [A-727 re-pin: Home recorded none]
    });

    await check("B10 Second completion (DEV preview fixture, the only Send path) → quiet Home, no Explore loop, also after reload", async () => {
      // start the DEV preview from a clean Explore (the DEV hook only flips devPreview on the current in-memory card):
      // drop the lane draft, reopen, leave, then switch the preview on — same order as A-654/A-644 Part B.
      await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.secondJourneyDraft.")) localStorage.removeItem(k); });
      await forgetIntro(); // [A-891]
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
      assert.equal(await exploreViaTapMe(), "explore"); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000)
      await mustTap("#stayButton", "leave interests"); await waitScene(["sendstay"], 4000); await sleep(2500);
      await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(1900);
      let st = await step();
      if (st === "interests") { await realClick(".secondJourney__item", 0); await sleep(250); await realClick("#exploreSaveButton"); await sleep(2400); st = await step(); }
      if (st === "candidates") {
        const first = await p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].find((b) => !b.disabled && !b.hidden)?.dataset.destinationId);
        assert.ok(first && !["aave-usdc", "kintsu-smon", "abil-spot", "protect-revoke-allowance"].includes(first), "DEV preview keeps the fixture rows");
        await realClick(`.secondJourney__pick[data-destination-id="${first}"]`); await sleep(400);
        await realClick("#secondOkButton"); await sleep(900);
        if ((await step()) === "jit") { await realClick(".secondJourney__jitBtn", 0); await sleep(900); }
      }
      if (await p.locator("#secondAmount").count()) { await p.locator("#secondAmount").fill("1"); await sleep(400); }
      const pre = await p.evaluate(() => ({ step: document.querySelector("#secondAmount") ? "amount" : null, send: document.querySelector("#secondSendButton")?.disabled, text: document.querySelector("#secondJourneyCard")?.innerText }));
      await shot("1440_dev_preview_before_send");
      assert.equal(pre.send, false, `DEV preview Send enabled: ${JSON.stringify(pre)}`);
      await mustTap("#secondSendButton", "second send (DEV preview)");
      assert.equal(await waitScene(["secondAway"], 4000), "secondAway");
      assert.equal(await waitScene(["secondReturn"], 45000), "secondReturn");
      for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
        if ((await scene()) !== "secondReturn") break;
        const v = await p.evaluate(() => { const ok = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; }; return { open: ok("returnOpen"), tap: ok("returnTap") }; });
        if (v.open) { if ((await realClick("#returnOpen")) !== "pointer") await p.evaluate(() => document.getElementById("returnOpen").click()); await sleep(900); continue; }
        if (v.tap) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
        await sleep(250);
      }
      assert.equal(await waitScene(["sendstay"], 6000), "sendstay");
      await quietFor(7000, "after completion");
      await shot("1440_quiet_home_after_completion");
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
      assert.equal(await waitScene(["sendstay"], 9000), "sendstay");
      await quietFor(9000, "after completion + reload");
      assert.equal((await decisionRows()).length, 1, "the DEV preview fixture records no decision Receipt");
    });

    await check("B11 no tx, no lane read, no page error", async () => {
      assert.equal(net.tx, 0); assert.equal(net.rpcLane, 0);
      assert.deepEqual(errors, []);
    });
  } finally {
    await context.close().catch(() => {});
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
