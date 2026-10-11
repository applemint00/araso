// [A-727] Second candidate diversity + receipt integrity (existing UI only).
//   node app/test/a727-second-candidate-integrity.mjs
// Part N (node): pass-order diversity of exploreCandidateDestinations (pass 1 = one row per selected lane in row
//   order, pass 2 = remaining rows in row order, max-3 is the last cut), Home records 0 decision Receipts,
//   explicit ok records exactly one action-0 Receipt, reopen adds none, Preference != Permission != READY.
// Part B (real browser, Playwright + CDP virtual authenticator, Vite --mode a172-local --strictPort on 5813):
//   Home -> 0 Receipts, ok -> exactly 1, reload -> still 1, at 390/430/700/1440.
//   Env: A727_SHOTS=<dir>; A727_NODE_ONLY=1 skips Part B (prints SKIP; not a PASS).
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

const ROWS = () => exploreCandidateRows({ decisions: [], families: listVisibleJobFamilies() }).rows;
const ids = (sel, max = 3) => exploreCandidateDestinations(ROWS(), { selectedErrandIds: sel, max }).map((d) => d.id);
const AAVE = "aave-usdc", KINTSU = "kintsu-smon", PROTECT = "protect-revoke-allowance", ABIL = "abil-spot";

await check("O1 ordering table: pass 1 = one row per selected lane (row order), pass 2 fills the rest (row order); output = pass order", () => {
  const table = [
    [["grow", "asset-piece"], 3, [AAVE, ABIL, KINTSU]],                 // card example: grow_stable + own_rwa + grow_delayed
    [["asset-piece", "grow"], 3, [AAVE, ABIL, KINTSU]],                 // selection order does not matter
    [["grow", "clean", "asset-piece"], 3, [AAVE, PROTECT, ABIL]],       // card example: one Grow + Protect + Own before a second Grow
    [["asset-piece", "clean", "grow"], 3, [AAVE, PROTECT, ABIL]],
    [["grow", "clean"], 3, [AAVE, PROTECT, KINTSU]],
    [["clean", "asset-piece"], 3, [PROTECT, ABIL]],
    [["grow"], 3, [AAVE, KINTSU]],
    [["clean"], 3, [PROTECT]],
    [["asset-piece"], 3, [ABIL]],
    [["grow", "clean", "asset-piece"], 2, [AAVE, PROTECT]],             // fewer slots: still one per lane first
    [["grow", "clean", "asset-piece"], 1, [AAVE]],
    [["grow", "clean", "asset-piece"], 9, [AAVE, PROTECT, ABIL, KINTSU]], // universe intact, pass order
    [["grow", "clean", "asset-piece"], 0, []],
    [["market", "order", "claim"], 3, []],
    [[], 3, []],
  ];
  for (const [sel, max, want] of table) assert.deepEqual(ids(sel, max), want, `${sel.join("+")} max ${max}`);
  // determinism: same input twice, same output; input rows are not reordered
  const rows = ROWS(); const before = rows.map((r) => r.candidateId).join();
  const a = exploreCandidateDestinations(rows, { selectedErrandIds: ["grow", "clean", "asset-piece"] }).map((d) => d.id).join();
  const b = exploreCandidateDestinations(rows, { selectedErrandIds: ["grow", "clean", "asset-piece"] }).map((d) => d.id).join();
  assert.equal(a, b); assert.equal(rows.map((r) => r.candidateId).join(), before);
});

await check("O2 grow + clean + asset-piece shows one Grow + Protect + Own: the second Grow (kintsu) does not take a slot from Own", () => {
  const out = exploreCandidateDestinations(ROWS(), { selectedErrandIds: ["grow", "clean", "asset-piece"], max: 3 });
  assert.deepEqual(out.map((d) => d.laneId), ["grow", "protect", "own"]);
  assert.equal(out.some((d) => d.id === KINTSU), false);
  assert.equal(out.every((d) => d.laneCandidate === true && d.derivedStatus === "UNKNOWN" && d.errandIds.length === 1), true);
});

await check("O3 same-family alternatives (Aave/Curvance/Neverland) stay ONE slot: alternatives never become rows or ids in any selection", () => {
  const every = [["grow"], ["grow", "clean"], ["grow", "clean", "asset-piece"], ["asset-piece", "grow"]];
  for (const sel of every) for (const max of [1, 2, 3, 9]) {
    const got = ids(sel, max);
    assert.equal(got.some((id) => /curvance|neverland/.test(id)), false, `${sel} ${max}`);
    assert.equal(new Set(got).size, got.length);
  }
  const grow = ROWS().filter((r) => r.family === "grow_stable");
  assert.equal(grow.length, 1, "one row for the whole grow_stable family");
  assert.ok(Array.isArray(grow[0].alternatives) || grow[0].alternatives === undefined);
});

await check("O4 max-3 is display only: the decided universe stays whole (9 decisions) while 3 are shown", async () => {
  const lane = await loadLane();
  lane.__io.store = createMemoryStorage();
  lane.state.address = ADDRESS;
  lane.state.secondJourney = freshSj({ selectedIds: ["grow", "clean", "asset-piece"] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network"); };
  try { await lane.refreshSecondLaneCandidates(); } finally { globalThis.fetch = realFetch; }
  const sj = lane.state.secondJourney;
  assert.equal(sj.laneDecisions.length, 9);
  assert.deepEqual(lane.secondLaneDestinations(sj).map((d) => d.id), [AAVE, PROTECT, ABIL]);
  assert.match(fnBody("secondLaneDestinations"), /max: MAX_EXPLORE_VISIBLE/);
  assert.match(MAIN, /const MAX_EXPLORE_VISIBLE = 3;/);
  assert.equal(storedDecisions(lane.__io.store).length, 0, "showing candidates records nothing");
});

await check("R1 Home records 0 decision Receipts: no home source, no listener on the candidates card, recordSecondLaneDecision(..., home) saves nothing", async () => {
  assert.equal(/candidates_home/.test(MAIN), false);
  const src = constDecl("SECOND_LANE_SELECTION_SOURCE");
  assert.equal(/\bhome\s*:/.test(src), false);
  assert.match(src, /explore:/); assert.match(src, /tryIt:/);
  assert.equal(/recordSecondLaneDecision/.test(stripComments(fnBody("wireExploreCard"))), false, "the candidates card wiring records nothing");
  assert.equal(/\bstayHome\b/.test(stripComments(fnBody("wireExploreCard"))), false);
  const lane = await loadLane();
  const store = createMemoryStorage();
  lane.__io.store = store; lane.state.address = ADDRESS; lane.state.secondJourney = freshSj();
  await lane.refreshSecondLaneCandidates();
  const shown = lane.secondLaneDestinations(lane.state.secondJourney).map((d) => d.id);
  assert.equal(shown.length, 3);
  assert.equal(lane.recordSecondLaneDecision(shown, "home").saved, 0);
  assert.equal(storedDecisions(store).length, 0);
  // Home is not converted to nah / dislike: no decision of any kind exists, and no learning state was written
  assert.equal(Object.keys(store.dump()).length, 0);
});

await check("R2 explicit ok on one candidate = exactly one action-0 decision Receipt; repeat/reopen adds none; a different explicit ok is its own Receipt", async () => {
  const lane = await loadLane();
  const store = createMemoryStorage();
  lane.__io.store = store; lane.state.address = ADDRESS;
  let st = createSecondJourneyState(SCOPE);
  st = applyExploreSelection(st, { kind: "multi", errandIds: ["grow", "asset-piece"], errands: [{ id: "grow", label: "g", lane: "Grow" }, { id: "asset-piece", label: "a", lane: "Own" }] }, { preference: { ...st.preference, yield: 0.2 } }, { eventId: "explore-save-1-grow", now: NOW }).state;
  assert.ok(saveSecondJourneyState(store, SCOPE, st).saved);
  const before = loadSecondJourneyState(store, SCOPE).state;
  lane.state.secondJourney = freshSj();
  await lane.refreshSecondLaneCandidates();
  assert.equal(lane.recordSecondLaneDecision([AAVE], "tryIt").saved, 1);
  let rows = storedDecisions(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].destinationId, AAVE); assert.equal(rows[0].actionCount, 0); assert.equal(rows[0].action, "none"); assert.equal(rows[0].txExecuted, false);
  assert.equal(rows[0].selection.source, "app_ui_candidate_ok"); assert.equal(rows[0].selection.createsPermission, false);
  // same event again (reopen/re-tap) → verified duplicate, still one
  assert.equal(lane.recordSecondLaneDecision([AAVE], "tryIt").saved, 1);
  assert.equal(storedDecisions(store).length, 1);
  // a fresh module load on the same store (reload) and re-reading: still one
  const lane2 = await loadLane();
  lane2.__io.store = store; lane2.state.address = ADDRESS; lane2.state.secondJourney = freshSj();
  await lane2.refreshSecondLaneCandidates();
  assert.equal(storedDecisions(store).length, 1, "reload/refresh adds none");
  // Preference != Permission != Agreed Rule != READY
  const after = loadSecondJourneyState(store, SCOPE).state;
  assert.deepEqual(after.interests, before.interests); assert.deepEqual(after.preference, before.preference); assert.deepEqual(after.preferenceEvents, before.preferenceEvents);
  assert.equal(/permission"\s*:\s*true|"ready"|JOB_READY|txHash/i.test(JSON.stringify(rows[0])), false);
  // a second, different explicit ok in another event is its own explicit Receipt (distinct destination)
  lane2.state.secondJourney.laneEventId = lane2.state.secondJourney.laneEventId || "x";
  assert.equal(lane.recordSecondLaneDecision([ABIL], "tryIt").saved, 1);
  rows = storedDecisions(store);
  assert.deepEqual(rows.map((r) => r.destinationId).sort(), [ABIL, AAVE].sort());
});

await check("R3 static: handleSecondLaneTry records only tryIt for the single picked candidate; no other caller records a decision", () => {
  const body = stripComments(fnBody("handleSecondLaneTry"));
  assert.equal((body.match(/recordSecondLaneDecision\(/g) || []).length, 1);
  assert.match(body, /recordSecondLaneDecision\(\[[^\]]+\], "tryIt"\)/);
  const callers = [...stripComments(MAIN).matchAll(/recordSecondLaneDecision\(([^;]*?)\)/g)].map((m) => m[1]).filter((x) => !x.startsWith("candidateIds"));
  assert.equal(callers.every((c) => /"tryIt"/.test(c)), true, JSON.stringify(callers));
  assert.equal(/preference|agreedRule|permission|ready/i.test(body.replace(/createsPermission/g, "")), false);
});

// ═══ Part B — real browser ══════════════════════════════════════════════════════════════════════════════════
if (process.env.A727_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A727_NODE_ONLY=1) — browser scenarios not run");
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
  const port = 5813; // A-727: fixed port, --strictPort
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
    const shots = process.env.A727_SHOTS || "";
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

  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a727_${name}.png`) }); };
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
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
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
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a727f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa727-dep", redeemTxHash: "0xa727-red", grantTxHash: "0xa727-grant", status: "success", at: Date.parse("2026-10-04T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
    await exploreViaTapMe(); // [A-891] pre-A-891 baseline: none — B1's first mustTap relied on Explore opening by itself (~1.2 s) after this reload


    await check("B1 candidates card (grow + asset-piece) shows pass order aave, abil, kintsu with 0 Receipts; Home -> 0 Receipts, quiet Home", async () => {
      // [A-977 RE-PIN] fork Explore = the fork Job rows. Three rows on the fork come from round 0 (market · order · clean), so no "save none".
      // pre-A-977: save none → round 1 → grow + asset-piece → aave / abil / kintsu
      assert.equal(await step(), "interests");
      const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
      for (const want of ["market", "order", "clean"]) {
        const idx = ids.indexOf(want); assert.ok(idx >= 0, `${want} on round 1 (${ids})`);
        await mustTap(".secondJourney__item", want, idx); await sleep(200);
      }
      await mustTap("#exploreSaveButton", "save"); await sleep(300);
      assert.equal(await step(), "candidates");
      await sleep(2200);
      const rows = await picks();
      assert.deepEqual(rows.map((r) => r.id), ["kuru-swap", "kuru-limit", "usdc-allowance-revoke"]); // [A-977 RE-PIN] pre-A-977: aave / abil / kintsu
      assert.deepEqual(rows.map((r) => r.text), ["go to the market", "leave an order", "tidy the wallet"]); // [A-977 RE-PIN] pre-A-977: family titles
      assert.equal((await decisionRows()).length, 0);
      await mustTap("#stayButton", "Home");
      assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
      assert.equal((await decisionRows()).length, 0, "Home from the candidates card records 0 Receipts");
      await quietFor(5000, "after leave");
    });

    await check("B2 reopen at 390/430/700/1440: Explore returns (interests), still 0 Receipts; after a pick the draft reopens at candidates with stable pass order, rows reachable, 0 Receipts", async () => {
      await reopenAt(1440, 900, "interests");
      assert.equal((await decisionRows()).length, 0);
      await mustTap("#exploreSaveButton", "save again"); await sleep(2600);
      assert.equal(await step(), "candidates");
      // the lane draft (existing A-719 B6 semantics) is kept across reload once a row is picked; a pick records nothing
      await mustTap('.secondJourney__pick[data-destination-id="kuru-limit"]', "pick kuru-limit"); await sleep(500); // [A-977 RE-PIN] pre-A-977: abil-spot
      for (const [w, h] of WIDTHS) {
        await reopenAt(w, h, "candidates");
        const rows = await picks();
        assert.deepEqual(rows.map((r) => r.id), ["kuru-swap", "kuru-limit", "usdc-allowance-revoke"], `order @${w}`); // [A-977 RE-PIN] pre-A-977: aave / abil / kintsu
        assert.ok(rows.every((r) => r.fits), `rows fit @${w}`);
        assert.equal(rows.find((r) => r.picked)?.id, "kuru-limit", `pick restored @${w}`); // [A-977 RE-PIN] pre-A-977: abil-spot
        for (let i = 0; i < rows.length; i += 1) assert.ok(await pointAt(".secondJourney__pick", i), `row ${i} reachable @${w}`);
        await noOverflow(`candidates@${w}`);
        assert.ok(await pointAt("#stayButton"), `Home reachable @${w}`);
        assert.equal((await decisionRows()).length, 0, `0 Receipts @${w}`);
        await shot(`${w}_candidates`);
      }
    });

    await check("B3 explicit ok on one candidate -> exactly one action-0 decision Receipt; reload at 390/430/700/1440 keeps exactly one", async () => {
      await mustTap("#secondOkButton", "ok"); await sleep(900);
      assert.equal(await step(), "readiness");
      let rows = await decisionRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].destinationId, "kuru-limit"); assert.equal(rows[0].actionCount, 0); assert.equal(rows[0].txExecuted, false); // [A-977 RE-PIN] pre-A-977: abil-spot
      assert.equal(rows[0].selection.source, "app_ui_candidate_ok"); assert.equal(rows[0].selection.createsPermission, false);
      assert.equal(await p.evaluate(() => document.querySelector("#secondSendButton").disabled), false); // [A-977 RE-PIN] fork Job row: Send enabled (not clicked). pre-A-977: true
      for (const [w, h] of WIDTHS) {
        await reopenAt(w, h, "readiness");
        assert.equal((await decisionRows()).length, 1, `still exactly 1 @${w}`);
        await noOverflow(`action@${w}`);
        assert.equal(await p.evaluate(() => document.querySelector("#secondSendButton").disabled), false); // [A-977 RE-PIN] pre-A-977: true
        await shot(`${w}_action_card`);
      }
    });

    await check("B4 Home from the action card -> quiet Home, still exactly one Receipt; no tx, no lane read, no page error", async () => {
      await mustTap("#stayButton", "Home from action card");
      assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
      await quietFor(5000, "after action card");
      assert.equal((await decisionRows()).length, 1);
      assert.equal(net.tx, 0); assert.equal(net.rpcLane, 0);
      assert.deepEqual(errors, []);
    });

  } finally {
    await context.close().catch(() => {});
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
