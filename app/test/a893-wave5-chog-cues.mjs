// A-893 UI Wave 5 — Chog cues: CG-01 first Send, CG-02 away on app open, CG-05 current picks, CG-06 verify-only.
// Copy = _private/STUDY/94_VISUAL_DIRECTION.md §[2026-10-08 Owner] "Chog copy locked", exactly.
// Part N (node): locked copy only; CG-05 derivation for 1 / 2 / all / changed picks; CG-01 once-only wiring; CG-02 open/return
//   trigger (no timer, max two per Away, never during departure, never over the money-truth line); protected bodies and
//   money-truth strings byte-identical; CG-06 Return skip preserved, Third+ compact not implemented.
// Part B (browser, local vite + Playwright from the local harness; A893_NODE_ONLY=1 skips it, the runner sets it unless
//   ARASO_TEST_BROWSER=1): B1 CG-01 at 390/810/1440, B2 CG-02, B3 CG-05, B4 reduced motion.
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}
function fnBody(name, src = MAIN) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The A-893 block: from its banner to the end of armAwayOpenCue().
const BLOCK_START = MAIN.indexOf("// ── [A-893] Wave 5 Chog cues");
const BLOCK = BLOCK_START >= 0 ? MAIN.slice(BLOCK_START, MAIN.indexOf(fnBody("armAwayOpenLine")) + fnBody("armAwayOpenLine").length) : "";

// Minimal DOM: #chogHome with its .chogHome__hit, an optional #awayRestoreLine, and visibilitychange listeners.
function sandbox({ scene = "away", awayRestore = null, sendCardVisible = false, busy = false, appLock = null, departureArrival = false, display = [], cueRect = { left: 0, right: 100, top: 0, bottom: 20, width: 100 } } = {}) {
  const lines = [];
  const observers = [];
  const teardowns = [];
  const restoreCalls = [];
  const hit = { className: "chogHome__hit" };
  const root = {
    querySelector: (sel) => (sel === ".chogHome__hit" ? hit : lines.find((l) => `#${l.id}` === sel) || null),
    insertBefore: (node) => { lines.push(node); },
  };
  const listeners = [];
  const doc = {
    visibilityState: "visible",
    restoreLine: null,
    querySelector: (sel) => (sel === "#chogHome" ? root : sel === "#awayRestoreLine" ? doc.restoreLine : lines.find((l) => `#${l.id}` === sel) || null),
    createElement: () => { const el = { className: "", id: "", style: {}, textContent: "", getBoundingClientRect: () => cueRect, remove: () => { const i = lines.indexOf(el); if (i >= 0) lines.splice(i, 1); } }; return el; },
  };
  const state = { scene, awayRestore, sendCardVisible, appLock, departureArrival };
  const timers = [];
  const api = new Function(
    "document", "state", "sendBusy", "sceneListener", "secondPickedErrandIds", "computeExploreDisplayErrands", "setTimeout", "setInterval", "MutationObserver", "onSceneTeardown", "showAwayRestore",
    `${fnBody("awayRestoreLineMarkup")}\n${BLOCK}\nreturn { exploreChogConfirmLine, insertChogCueLine, sayFirstSendCue, armAwayOpenLine, awayRestoreLineMarkup, noteAwayLocked,
      count: () => awayOpenCount };`,
  )(
    doc, state, () => busy,
    (target, type, handler) => listeners.push({ target, type, handler }),
    (sj) => sj?.selectedIds || [],
    () => display.map((id) => ({ id })),
    (...a) => { timers.push(a); }, (...a) => { timers.push(a); },
    class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.off = true; } },
    (fn) => teardowns.push(fn),
    (kind) => { restoreCalls.push(kind); state.awayRestore = kind; if (doc.restoreLine) doc.restoreLine.textContent = api.awayRestoreLineMarkup(kind); },
  );
  const fireVisible = () => { for (const l of listeners) if (l.type === "visibilitychange") l.handler(); };
  const text = (id) => lines.find((l) => l.id === id)?.textContent ?? null;
  const mutate = () => { for (const o of observers) if (!o.off) o.cb([]); };
  return { api, doc, state, lines, listeners, timers, fireVisible, text, observers, teardowns, mutate, restoreCalls };
}

// ═══ Part N ═══
await check("N0 the A-893 block exists, outside every protected body; no timer, interval, storage or money/auth call in it", () => {
  assert.ok(BLOCK.length > 0, "A-893 block present");
  const code = stripComments(BLOCK);
  assert.equal(/setTimeout|setInterval|sceneTimeout|requestAnimationFrame|localStorage|sessionStorage/.test(code), false, "no clock, no storage");
  assert.equal(/sendPiggy|reserveSend|requestPrf|activateSigningSession|reconcileSendPending|classifySendPending|readSendTxReceipt|finishTrip|fetch\(|publicClient|walletClient/.test(code), false, "no money/auth/decision path");
  // [A-893b] the only money-display call: showAwayRestore("pending") — the same kind again, never another kind
  assert.deepEqual([...code.matchAll(/showAwayRestore\(([^)]*)\)/g)].map((m) => m[1]), ['"pending"', '"pending"']); // visibility return + [F1] unlock mount
  assert.equal(/MutationObserver|getBoundingClientRect|AWAY_OPEN_CUE_LINES|awayOpenCue\b/.test(code), false, "the separate CG-02 speech / observer / overlap path is gone");
  for (const pinned of ["render", "chogHomeMarkupForAway", "awayRestoreLineMarkup", "showAwayRestore", "renderSendStay", "arasoBrandMarkup"]) {
    assert.equal(/sayFirstSendCue|armAwayOpenLine|exploreChogConfirmLine|insertChogCueLine/.test(fnBody(pinned)), false, `${pinned} carries no A-893 call`);
  }
});

await check("N1 copy: only the Owner-locked lines, each defined once in code", () => {
  const code = stripComments(MAIN);
  for (const line of ["wanna let Piggy try one?", "still out working.", "not back yet."]) {
    assert.equal(code.split(line).length - 1, 1, `${line} appears once`);
  }
  assert.equal(code.split('"all of them?"').length - 1, 1, "all of them? once (CG-05 derivation)");
  assert.equal(code.split('"these two?"').length - 1, 1, "these two? once (CG-05 derivation)");
  const strings = [...stripComments(BLOCK).matchAll(/"([^"\\]*[a-z][^"\\]*)"/g)].map((m) => m[1]);
  const allowed = new Set(["wanna let Piggy try one?", "still out working.", "not back yet.", "all of them?", "these two?",
    "#chogHome", ".chogHome__hit", "span", "chogCheckLine", "translateX(-50%)", "firstSendChogCue", "awayOpenCue", "sendstay", "away",
    "visibilitychange", "visible", "pending"]);
  for (const s of strings) assert.ok(allowed.has(s), `unexpected string in the A-893 block: ${JSON.stringify(s)}`);
});

await check("N2 CG-05: the bubble follows the CURRENT picks — 1 = none, 2 = these two?, all shown = all of them?, changed picks re-derive", () => {
  const S = sandbox({ display: ["a", "b", "c"] });
  const say = (selectedIds, exploreOfferedIds) => S.api.exploreChogConfirmLine({ selectedIds, exploreOfferedIds });
  assert.equal(say(["a"], ["a", "b", "c"]), null, "one pick: no locked wording (UNKNOWN), no line");
  assert.equal(say(["a", "b"], ["a", "b", "c"]), "these two?");
  assert.equal(say(["a", "b", "c"], ["a", "b", "c"]), "all of them?");
  assert.equal(say(["a", "b"], ["a", "b"]), "all of them?", "both of a two-item set = all (same rule as the pre-A-893 save-time value)");
  // change picks: same state object, picks edited, no save-time value consulted
  const sj = { selectedIds: ["a", "b", "c"], exploreOfferedIds: ["a", "b", "c"] };
  assert.equal(S.api.exploreChogConfirmLine(sj), "all of them?");
  sj.selectedIds = ["a", "c"]; assert.equal(S.api.exploreChogConfirmLine(sj), "these two?");
  sj.selectedIds = ["c"]; assert.equal(S.api.exploreChogConfirmLine(sj), null);
  assert.equal(S.api.exploreChogConfirmLine({ selectedIds: [] }), null, "0 picks: no bubble (A-849 back-to-interests path untouched)");
  // a later visit (no saved offer set) derives the set the edit card would show
  assert.equal(say(["a", "b"], null), "these two?");
  assert.equal(say(["a", "b", "c"], null), "all of them?");
});

await check("N3 CG-05 wiring: chogHomeMarkupForExplore reads the derivation at render (no stored value); A-849 wait lines first; save keeps only the offered set", () => {
  const f = fnBody("chogHomeMarkupForExplore");
  assert.match(f, /secondPickedErrandIds\(sj\)\.length > 0/, "A-849 wait branch kept");
  assert.ok(f.indexOf("oh… no jobs to go.") < f.indexOf("exploreChogConfirmLine(sj)"), "wait lines win over the confirmation");
  assert.equal(/sj\.chogSay/.test(stripComments(f)), false, "the bubble no longer reads the save-time value");
  assert.match(f, /escapeHtml\(confirmLine\)/);
  const save = fnBody("handleExploreSave");
  assert.match(save, /sj\.exploreOfferedIds = displayedIds;\s*sj\.chogSay = exploreChogConfirmLine\(sj\);/);
  assert.ok(save.indexOf("sj.selectedIds = selection.errandIds;") < save.indexOf("exploreChogConfirmLine(sj)"), "derived after the picks are stored");
  assert.match(fnBody("openSecondJourneyExplore"), /sj\.exploreOfferedIds = null;/);
});

await check("N4 CG-01: said once, right after the first-arrival revealSendCard render; gated on the card actually showing; DOM-only (next render clears it)", () => {
  const home = fnBody("mountHome");
  assert.match(home, /state\.sendCardVisible = true;\s*render\(\);\s*sayFirstSendCue\(\); \/\/ \[A-893 CG-01\]/);
  assert.equal((stripComments(MAIN).match(/(?<!function )sayFirstSendCue\(\)/g) || []).length, 1, "one call site only (first arrival)");
  assert.match(home, /if \(isFirstArrival && !state\.sendCardVisible\) \{\s*const revealSendCard/);
  const ok = sandbox({ scene: "sendstay", sendCardVisible: true });
  assert.equal(ok.api.sayFirstSendCue(), true);
  assert.equal(ok.text("firstSendChogCue"), "wanna let Piggy try one?");
  assert.equal(ok.lines.length, 1);
  assert.equal(ok.lines[0].className, "chogCheckLine", "reuses the existing Chog line style");
  for (const [why, opts] of [["card not shown", { scene: "sendstay", sendCardVisible: false }], ["busy", { scene: "sendstay", sendCardVisible: true, busy: true }], ["locked", { scene: "sendstay", sendCardVisible: true, appLock: { phase: "waiting" } }], ["other scene", { scene: "explore", sendCardVisible: true }]]) {
    const s = sandbox(opts);
    assert.equal(s.api.sayFirstSendCue(), false, why);
    assert.equal(s.lines.length, 0, why);
  }
  assert.equal(sandbox().timers.length, 0);
});

await check("N5 CG-02 (A-893b): the Away slot's PENDING word is the cue — first open still out working., later opens not back yet.; unknown / checking unchanged", () => {
  // pre-A-893 baseline: awayRestoreLineMarkup("pending") === "still out." (A-633)
  const S = sandbox({ scene: "away", awayRestore: "pending" });
  const f = S.api.awayRestoreLineMarkup;
  assert.equal(f("pending"), "still out working.", "first open");
  assert.equal(f("unknown"), "can't tell yet.", "unknown unchanged");
  assert.equal(f("checking"), "checking…", "checking unchanged");
  assert.equal(f(undefined), "checking…", "any other kind unchanged");
  // cut-out harness (no counter in scope): the pending word is the first-open word, no ReferenceError
  const bare = new Function(`${fnBody("awayRestoreLineMarkup")}\nreturn awayRestoreLineMarkup;`)();
  assert.equal(bare("pending"), "still out working.");
  // the other "still out." strings (trip details, sendFailureCopy) are not this slot and stay
  const fail = fnBody("sendFailureCopy");
  assert.ok(fail.split('"still out."').length - 1 >= 1, "trip-detail still out. kept");
});

await check("N6b CG-02 (A-893b F1): an idle-lock unlock inside the same Away is the next open — pending shows not back yet., counted once, no timer; boot lock / non-pending not counted", () => {
  // pre-F1 baseline: an unlock never moved the count (stayed 1 -> "still out working.").
  const S = sandbox({ scene: "away", awayRestore: "pending" });
  S.doc.restoreLine = { id: "awayRestoreLine", textContent: "still out working." };
  S.api.armAwayOpenLine();                                  // first Away mount = open 1
  assert.equal(S.api.count(), 1);
  S.state.appLock = { phase: "waiting" }; S.api.noteAwayLocked();   // idle lock while Away (renderAppLock)
  S.state.appLock = null; S.api.armAwayOpenLine();          // unlock -> render -> mountAway
  assert.equal(S.api.count(), 2, "counted once");
  assert.deepEqual(S.restoreCalls, ["pending"]);
  assert.equal(S.doc.restoreLine.textContent, "not back yet.");
  S.api.armAwayOpenLine();                                  // a plain re-mount is not another open
  assert.equal(S.api.count(), 2, "not counted again");
  assert.equal(S.timers.length, 0, "no timer"); assert.equal(S.observers.length, 0);
  // checking at unlock: counted, nothing re-said; the later pending word is not back yet.
  const C = sandbox({ scene: "away", awayRestore: "checking" }); C.api.armAwayOpenLine();
  C.state.appLock = {}; C.api.noteAwayLocked(); C.state.appLock = null; C.api.armAwayOpenLine();
  assert.equal(C.api.count(), 2); assert.equal(C.restoreCalls.length, 0); assert.equal(C.api.awayRestoreLineMarkup("pending"), "not back yet.");
  // boot lock (no Away mounted yet) is not an open
  const B = sandbox({ scene: "away", awayRestore: "pending" });
  B.state.appLock = {}; B.api.noteAwayLocked(); B.state.appLock = null; B.api.armAwayOpenLine();
  assert.equal(B.api.count(), 1, "boot unlock = the first open, not a later one");
  // a new departure resets the Away
  const D = sandbox({ scene: "away", awayRestore: "pending" }); D.api.armAwayOpenLine();
  D.state.appLock = {}; D.api.noteAwayLocked(); D.state.appLock = null; D.state.departureArrival = true; D.api.armAwayOpenLine();
  assert.equal(D.api.count(), 1);
});

await check("N6 CG-02 (A-893b): a return to the page while the slot says pending re-says it as not back yet.; same kind, no timer; other states untouched", () => {
  const S = sandbox({ scene: "away", awayRestore: "pending" });
  S.doc.restoreLine = { id: "awayRestoreLine", textContent: "still out working." };
  S.api.armAwayOpenLine();
  assert.equal(S.listeners.filter((l) => l.type === "visibilitychange").length, 1, "one listener per Away mount (sceneListener)");
  assert.equal(S.restoreCalls.length, 0, "the mount itself re-says nothing");
  S.fireVisible();
  assert.deepEqual(S.restoreCalls, ["pending"], "same kind again");
  assert.equal(S.doc.restoreLine.textContent, "not back yet.");
  S.fireVisible(); assert.equal(S.doc.restoreLine.textContent, "not back yet.", "stays not back yet.");
  S.doc.visibilityState = "hidden"; const n = S.restoreCalls.length; S.fireVisible(); assert.equal(S.restoreCalls.length, n, "hidden is not an open");
  assert.equal(S.timers.length, 0, "no timer");
  assert.equal(S.observers.length, 0, "no observer");
  assert.equal(S.lines.length, 0, "no second line anywhere");
  for (const kind of ["checking", "unknown", null]) {
    const T = sandbox({ scene: "away", awayRestore: kind });
    T.doc.restoreLine = kind ? { id: "awayRestoreLine", textContent: T.api.awayRestoreLineMarkup(kind) } : null;
    T.api.armAwayOpenLine(); T.fireVisible();
    assert.equal(T.restoreCalls.length, 0, `awayRestore=${kind}: returns do nothing (no word change, no count)`);
    assert.equal(T.lines.length, 0);
  }
  const L = sandbox({ scene: "away", awayRestore: "pending", appLock: { phase: "waiting" } }); L.api.armAwayOpenLine(); L.fireVisible(); assert.equal(L.restoreCalls.length, 0, "locked");
  const O = sandbox({ scene: "sendstay", awayRestore: "pending" }); O.api.armAwayOpenLine(); O.fireVisible(); assert.equal(O.restoreCalls.length, 0, "not away");
});

await check("N7 CG-02 (A-893b): a fresh departure is a new Away (count back to the first-open word); a re-mount of the same Away keeps it", () => {
  const S = sandbox({ scene: "away", awayRestore: "pending" });
  S.api.armAwayOpenLine(); S.fireVisible();
  assert.equal(S.api.awayRestoreLineMarkup("pending"), "not back yet.");
  S.state.departureArrival = false; S.api.armAwayOpenLine();
  assert.equal(S.api.awayRestoreLineMarkup("pending"), "not back yet.", "same Away re-mount keeps the count");
  S.state.departureArrival = true; S.api.armAwayOpenLine();
  assert.equal(S.api.awayRestoreLineMarkup("pending"), "still out working.", "new departure = new Away");
});

await check("N8 mountAway wiring: armAwayOpenLine before any early return; the old departure-playback hook is gone", () => {
  const away = fnBody("mountAway");
  const arm = away.indexOf("armAwayOpenLine(); // [A-893b CG-02]");
  assert.ok(arm > 0 && arm < away.indexOf('const canvas = document.querySelector("#departStage");'), "armed before the canvas / departureArrival returns");
  assert.ok(away.indexOf("applyHomeFloorToChogOnly(boardFit);") < arm, "after the Chog mount");
  assert.equal(/awayDepartPlayback|armAwayOpenCue/.test(away), false);
});

// Protected bodies: sha256 of each body (function keyword .. closing brace) on the post-A-845 tree = HASH_BEFORE of A-893.
// [A-896 re-pin, named reason: 99e M-L-2 60 s signer margin] two bodies re-pinned by name: sendPiggyOnce (one entry check) and activateSigningSession (one signerSince stamp line).
// pre-A-896 baseline: sendPiggyOnce 01ee727da9fc2def3d057d939c42b9cf69a95ace97f4c9af81500bd3fef9646b · activateSigningSession dbd2063392a1068b001f63a2c2f2235b42432349d0138152731cb316bd91a327 [A-896 R1 re-pin: + monotonic performance.now stamp/check; prior A-896 value was the old pin]
// [A-893b re-pin · Owner via Cowork 2026-10-08 "체킹 다음에 나오는걸로"] awayRestoreLineMarkup: pending wording only.
// pre-A-893 baseline: awayRestoreLineMarkup 027535c3b9c99afbbf8d75f2e994d81a64c469c9b6bcd25859fb6d02758bcc89 ("still out.")
const PROTECTED = {"activateSigningSession":"0bd365c9a1183cb414ddf826b70fc863d56b7d9fa5f20501742a6ff3441df805","appLockSurface":"8c31689ea48cf8aaead4c067bc2a6ac850ff8cc3b491e866334aaad338ae5d4c","arasoBrandMarkup":"2916af023287cf7fb4bbd633bbb52048003762c9beede74205ded7b6d02db256","awayRestoreLineMarkup":"960d811270c73c0d653e0615cb228530581336e9f57137d3168e9c6ac9467e38","beginAddPiggy":"2850f629cff4bf470ff482dbb70a9280b7bd0c2bf033dd885b680a84d18e718e","chogHomeMarkupForAway":"08905344aad1c51ca193aeaf020b5cdf4f32cb8f11869ac92df375f8a0fa4b1e","classifySendPending":"2389cf76d2658fd6126690983ce8ccfc8234cb41a1aa881bbcc07c651b45b674","commitSendSuccess":"9d3ac854b6df8ff39c2fb410191c3e7e9815bbee6410b7c76088decf5c469a7d","confirmSendReservation":"9d53949f862b5fbd93c7840907612ef3b5fd759a117a828d8ab3b9bc3e3ea3cb","endActiveSession":"9cfc316632c9cea8a87cf5a20dce069fc3ec3bec5e69ada9968823560210e74f","finishTrip":"60edd8708e77d53173f9b5607fa9e94828d1031c9c2d4c982ba3bd9c564ca28e","firstSendAmountSecondary":"bf6d03dead508b518e6d773505e5a6b3e021cdc8be07c23cf98876d74da8da64","firstTripClosedShared":"1079ba6542288dc88ba44db5f86f188eaf4e5d6b2585173d55269a671cb1f4e7","lockAppAfterIdle":"e4ef41131c978a256f4d9efba7962e89ec3d18f8c2d76f70cb91491ac0104ab8","loginCheckingMarkup":"dcec88389ae4385ad03e7d4645cd77046eb95b7762695d2d59e96a8844772f91","mountInviteChog":"f894db5c8e334665460c900a86930f47302695023009b5a6451ffe214038ef37","promoteSendReservation":"0847167f74d7cbc9840a19fce23b18a97f91be006ae2e99c17e67dc63d43ea48","readSendPending":"065bbae2d4bb516e0ffbc379e9b1d5cc98cde134160917f5feedfdee5d360b86","readSendTxReceipt":"482a1cdc9025ff9f88743ad43bb94fb60441378e426b2c230923dbc36d4b359d","reconcileSendPending":"1caf49b6a16b09df1f76fbe1e03483a6b72e7cdbfcab7d9c32b71938f5105348","reconciledSendReceipt":"1de55c29816852f795f91849e87dd28cc2f5e30a8ea1b27e309418ff79c3edf2","render":"866133cf607110939b5ce2b05ad9ff253ee7ab77f8448b3977faa974a9d3e27c","renderAuthCard":"6f1694a9613c18901b5b2c73df71acca96f500bdc4c991ef7992d6126595997c","requestPrf":"766fc57ed63b6009feb116105bdc73cc0c2cebff74ea614c02c48df6b935a321","reserveSend":"2038458e47b1f86e9ebff480c0404e3c1b052f06af660cff52bb71d11e2c24f6","sendPiggy":"08e971de9099462a27c833333b4a3cae3ba431572ff78611afc7bee63ccb9c1f","sendPiggyOnce":"0120bd9896880837c5fbb0e10a47b73efedeff3b9077f9877cbaae82b4e7955e","sentRowValue":"e88b42121dfca241fc2b0c5f23c762bfe0a53b3b67c10bd7238f3014b71ce816","settleUnlock":"b43e5a32b4bf055d003378f93b4a1c76c8862dcb810a3c1fbaf1e4049cb6b9e9","showAwayRestore":"70ee359576d43fd1b13d8f936516e362b7e67c0f13d4aadb5a94c73edaacb39d","stayHome":"771268ad28fba625abe87b8f86b99da08628e727fa8aaf3e0a161c2d94494de0","touchAppSession":"cd44c821c678149230601f7cf578f793e0fa441c9d4402f0bba4057f0c508136","unlockApp":"6ecb373c36ec657f5c44dec36588992d7ee178dacf1dbb99335a2a32e22ac467"};
await check("N9 protected bodies (PROTECTED_PINS_MAP_20261007, incl. render / money-truth / auth) byte-identical to the A-893 HASH_BEFORE", () => {
  for (const [name, h] of Object.entries(PROTECTED)) assert.equal(sha(fnBody(name)), h, name);
  assert.ok(fnBody("renderSendStay").includes(`message: blocked ? "Not from here." : !state.message || state.message === "Piggy is home." ? "Piggy's first job?" : state.message,`), "First Send card line (A-779) kept");
});

await check("N10 CG-06 verify-only: Return skip still offered only after the first result motion; return-view.js / send-card.js untouched; no Third+ compact", () => {
  const rv = readFileSync(path.join(REPO, "app/src/return-view.js"), "utf8");
  // pre-A-891-merge baseline: return-view.js == A-893 HASH_BEFORE c44d28669d32c10f2515326b12d6458eb601957febc9d95a3570955ae5004ac6 (A-891 UI-19 edited it; A-893 still must not)
  assert.equal(sha(rv), "c01be5d750dadf0fdc787a02f1ff328205b4818013d3f6df924c435671b47605", "return-view.js == post-A-891 (A-893 untouched)");
  assert.match(rv, /if \(skipBtn && allowSkip\) \{/);
  assert.equal((MAIN.match(/allowSkip: state\.resultMotionSeen === true,/g) || []).length, 2, "First + Second Return pass the same first-result gate");
  assert.equal(sha(readFileSync(path.join(REPO, "app/src/send-card.js"), "utf8")), "975f2b6d791ba05fdb7be901304e7303d4bcc87f3f90b25bcb614b476ce2add3", "send-card.js (First Send card copy) untouched");
  assert.equal(/compact|third/i.test(stripComments(BLOCK)), false, "A-893 adds no Third+ / compact behaviour (undefined, not implemented)");
});

// ═══ Part B ═══
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) { console.log("SKIP  Part B — local browser harness absent"); return; }
  let chromium;
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) { await check("B0 playwright available (local harness)", () => { throw e; }); return; }
  const port = await freePort();
  const server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
    cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let browser = null;
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    const shots = process.env.A893_SHOTS || "";
    if (shots) mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) await browserRun(browser, `http://localhost:${port}/`, shots, w, h, false);
    await browserRun(browser, `http://localhost:${port}/`, shots, 390, 844, true);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.kill("SIGTERM"); } catch {}
    await sleep(300);
    try { server.kill("SIGKILL"); } catch {}
  }
}

async function browserRun(browser, BASE, shots, W, H, reduced) {
  const tag = `${W}x${H}${reduced ? " reduced" : ""}`;
  const context = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await context.route("**/*", async (route) => {
    const body = route.request().postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) return route.abort();
    return route.continue();
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a893_${W}_${reduced ? "rm_" : ""}${name}.png`) }); };
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  // on-screen box + font size of a Chog line; legible = inside the viewport and >= 12 px on screen (A-843 minimum)
  const lineBox = (sel) => p.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    let k = 1; for (let n = e; n && n !== document.body; n = n.parentElement) { const m = getComputedStyle(n).transform; if (m && m !== "none") { const v = new DOMMatrixReadOnly(m); k *= Math.hypot(v.a, v.b); } }
    return { text: e.textContent, x: b.left, y: b.top, w: b.width, h: b.height, screenPx: parseFloat(cs.fontSize) * k, vis: cs.visibility, disp: cs.display, iw: innerWidth, ih: innerHeight };
  }, sel);
  const legible = (b, label) => {
    assert.ok(b, `${label}: present`);
    assert.ok(b.w > 0 && b.h > 0 && b.vis !== "hidden" && b.disp !== "none", `${label}: drawn`);
    assert.ok(b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= b.iw + 0.5 && b.y + b.h <= b.ih + 0.5, `${label}: inside the viewport ${JSON.stringify(b)}`);
    assert.ok(b.screenPx >= 12, `${label}: ${b.screenPx.toFixed(1)} px on screen (>= 12)`);
  };
  // pointer-reachable tap (same helper as a849): the element must be the hit target at the tapped point
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
      const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
    }
    return null;
  }, [sel, idx]);
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { const r = await pointAt(sel, idx); if (r) { await p.mouse.click(r.x, r.y); return; } await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
  // [A-891 CG-04/05] after a reload with First done / Second not done: quiet Home ~8 s → "tap me!" → the user taps Chog → intro → Explore
  // (once per user: forgetIntro() drops araso.secondIntroSeen before a reload so a reopen takes the same product path).
  const forgetIntro = () => p.evaluate(() => localStorage.removeItem("araso.secondIntroSeen"));
  // [r5] deterministic: chog-home.js toggle() calls onTap only on the tap that PINS the Home pad, and A-891 opens the intro only when that
  // tap lands on the Chog instance that is showing the cue. A tap that unpins an already-pinned pad, or lands after a re-mount, opens
  // nothing — a user simply taps again. So: tap up to 3 times (each logged), and if the cue path is gone, take the same product path
  // again (forget the intro fact, reload). Every retry is printed as INFO so a flaky path stays visible.
  const exploreViaTapMe = async (ms = 16000) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms && !(await p.locator(".chogHome__tapCue").count())) { if ((await scene()) === "explore") return "explore"; await sleep(200); }
      if (!(await p.locator(".chogHome__tapCue").count())) return `NOCUE:${await scene()}`;
      for (let tap = 0; tap < 3; tap += 1) {
        await mustTap("#chogHomeHit", "Chog (tap me!)");
        if ((await waitScene(["explore"], 5000)) === "explore") {
          if (attempt || tap) console.log(`INFO  [${tag}] tap-me reached Explore on attempt ${attempt + 1}, tap ${tap + 1}`);
          return "explore";
        }
        const st = await p.evaluate(() => ({ scene: document.querySelector("[data-scene]")?.dataset.scene ?? null, cue: !!document.querySelector(".chogHome__tapCue"), intro: !!document.querySelector("#secondIntroLine"), sendCard: !!document.querySelector("#sendCard"), pad: Math.round(document.querySelector("#homePaper")?.getBoundingClientRect().width || 0) })).catch(() => null);
        console.log(`INFO  [${tag}] tap-me attempt ${attempt + 1} tap ${tap + 1} did not open Explore: ${JSON.stringify(st)}`);
        if (st?.intro) { if ((await waitScene(["explore"], 4000)) === "explore") return "explore"; }
      }
      await forgetIntro();
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
    }
    return `TIMEOUT:${await scene()}`;
  };
  const setVisible = (v) => p.evaluate((vis) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => vis !== "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, v);
  try {
    // ── B1 CG-01 ─────────────────────────────────────────────────────────────────────────────────────
    await p.goto(BASE, { waitUntil: "networkidle" });
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    if ((await scene()) === "hatch" && (await p.locator("#skipHatchButton").count())) await p.locator("#skipHatchButton").click().catch(() => {});
    await waitScene(["name"], 30000);
    // The Name scene opens on the "you've got the one piggy !" pad; the input is shown only after its ok (same loop as a849 / a786).
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
      if (v.input) break;
      if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
      await sleep(300);
    }
    await sleep(1500);
    await p.locator("#piggyNameInput").fill("Cuebun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000);
    let cueSeenBeforeCard = false;
    for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
      const st = await p.evaluate(() => ({ card: !!document.querySelector("#sendCard"), cue: !!document.querySelector("#firstSendChogCue") }));
      if (st.cue && !st.card) cueSeenBeforeCard = true;
      if (st.card) break;
      await sleep(100);
    }
    await sleep(400);
    await check(`B1 [${tag}] CG-01 "wanna let Piggy try one?" appears with the first First Send card; card copy unchanged; legible`, async () => {
      assert.equal(cueSeenBeforeCard, false, "never before the card");
      assert.ok(await p.locator("#sendCard").count(), "First Send card shown");
      const b = await lineBox("#firstSendChogCue");
      assert.equal(b?.text, "wanna let Piggy try one?");
      legible(b, "CG-01 line");
      const msg = await p.evaluate(() => document.querySelector("#sendCard .sendCard__message")?.textContent?.trim());
      assert.equal(msg, "Piggy's first job?", "A-779 card line kept");
      assert.equal(await p.locator(".chogCheckLine").count(), 1, "one Chog line only");
      await shot("cg01_first_send");
    });
    await check(`B1 [${tag}] CG-01 never on revisits: Home/stay, reopening the card, reload`, async () => {
      if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(900); }
      assert.equal(await p.locator("#firstSendChogCue").count(), 0, "gone after the card leaves");
      await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlockIfLocked(); await sleep(2500);
      assert.equal(await p.locator("#firstSendChogCue").count(), 0, "not after reload");
      for (let i = 0; i < 6 && !(await p.locator("#sendCard").count()); i += 1) {
        await p.locator("#chogHomeHit").click({ force: true }).catch(() => {}); await sleep(1500);
        await p.evaluate(() => document.querySelector("[data-home-send], #homeSendButton, .homePaper__send")?.click()).catch(() => {}); await sleep(1200);
      }
      assert.equal(await p.locator("#firstSendChogCue").count(), 0, "not on a card revisit");
    });

    // ── B2 CG-02 (DEV scene jump: departure plays, then the page is hidden / shown) ────────────────────────
    // [A-893b · Owner via Cowork 2026-10-08 "체킹 다음에 나오는걸로"] CG-02 has no line of its own any more: an in-session Away (no restore slot)
    // stays silent on returns; on a cold open the existing slot says checking… then, for PENDING, "still out working." / later "not back yet."
    await check(`B2 [${tag}] CG-02 in-session Away (no restore slot): returns add no Chog line anywhere; no timer`, async () => {
      await p.evaluate(() => window.__arasoScene("away", { arrival: true }));
      await sleep(300);
      await setVisible("hidden"); await setVisible("visible"); await sleep(150);
      await sleep(reduced ? 2000 : 14000);
      for (let i = 0; i < 3; i += 1) { await setVisible("hidden"); await setVisible("visible"); await sleep(300); }
      assert.equal(await p.locator("#chogHome .chogCheckLine").count(), 0, "no Chog line in Away without the restore slot");
      assert.equal(await p.locator("#awayOpenCue, #awayRestoreLine").count(), 0);
    });
    await setVisible("visible");
    // Real cold open (F5): a First Send record left behind → boot to Away with the restore slot → reconcileSendPending decides the kind.
    // PENDING: the deposit hash's receipt is answered "not mined yet" (JSON-RPC result null → viem TransactionReceiptNotFoundError → pending),
    // routed in this page only; nothing is sent. UNKNOWN: stage "deposit-sending" (no broadcast hash) → can't tell yet. with no RPC.
    const coldOpen = async (record, label) => {
      const samples = [];
      await p.evaluate((rec) => { const a = localStorage.getItem("araso.address"); localStorage.setItem("araso.sendPending", JSON.stringify({ ...rec, address: a, at: Date.now() })); }, record);
      await p.reload({ waitUntil: "domcontentloaded" });
      for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
        if (await p.locator("#loginChogButton").count()) { await p.locator("#loginChogButton").click().catch(() => {}); await sleep(1500); continue; }
        const s = await p.evaluate(() => ({ scene: document.querySelector("[data-scene]")?.dataset.scene ?? null, slot: document.querySelector("#awayRestoreLine")?.textContent ?? null, lines: document.querySelectorAll("#chogHome .chogCheckLine").length })).catch(() => null);
        if (!s) { await sleep(100); continue; }
        samples.push(s);
        if (s.slot && s.slot !== "checking…" && samples.filter((x) => x.slot === s.slot).length > 30) break;
        await sleep(50);
      }
      const away = samples.filter((x) => x.scene === "away" && x.slot);
      assert.ok(away.length > 0, `${label}: boot went to Away with the restore slot (${JSON.stringify(samples.slice(-3))})`);
      assert.equal(away.some((x) => x.lines > 1), false, `${label}: never a second Chog line`);
      return away;
    };
    const PENDING_HASH = "0x" + "a893b".padEnd(64, "0");
    const answerReceiptNotMined = async (route) => {
      const body = route.request().postData() || "";
      if (!/eth_getTransactionReceipt/.test(body) || !body.includes(PENDING_HASH.slice(2, 10))) return route.fallback();
      let req; try { req = JSON.parse(body); } catch { return route.fallback(); }
      if (!Array.isArray(req)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result: null }) });
      const res = await route.fetch(); const out = await res.json();
      const ids = new Set(req.filter((r) => r.method === "eth_getTransactionReceipt").map((r) => r.id));
      return route.fulfill({ response: res, body: JSON.stringify(out.map((r) => (ids.has(r.id) ? { jsonrpc: "2.0", id: r.id, result: null } : r))) });
    };
    await check(`B2 [${tag}] CG-02 real cold open, PENDING: the slot says checking… then "still out working." (never "still out."); a return says "not back yet."; one line only`, async () => {
      await p.route("**/*", answerReceiptNotMined);
      try {
        const away = await coldOpen({ stage: "deposit-broadcast", depositTxHash: PENDING_HASH }, "pending");
        for (const x of away) assert.ok(["checking…", "still out working.", "not back yet."].includes(x.slot), `slot word: ${x.slot}`);
        assert.equal(away[away.length - 1].slot, "still out working.", "first open of this Away");
        legible(await lineBox("#awayRestoreLine"), "CG-02 slot word");
        await shot("cg02_cold_pending");
        await setVisible("hidden"); await setVisible("visible"); await sleep(200);
        assert.equal(await p.evaluate(() => document.querySelector("#awayRestoreLine")?.textContent), "not back yet.", "a later open in the same Away");
        await setVisible("hidden"); await setVisible("visible"); await sleep(200);
        assert.equal(await p.evaluate(() => document.querySelector("#awayRestoreLine")?.textContent), "not back yet.");
        assert.equal(await p.locator("#chogHome .chogCheckLine").count(), 1, "the restore slot is the only Chog line");
        const t1 = await p.evaluate(() => document.querySelector("#awayRestoreLine")?.textContent); await sleep(3000);
        assert.equal(await p.evaluate(() => document.querySelector("#awayRestoreLine")?.textContent), t1, "no rotation / timer");
        assert.equal(await p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene), "away", "still Away: the kind (decision) did not change");
      } finally {
        await p.unroute("**/*", answerReceiptNotMined);
        await p.evaluate(() => localStorage.removeItem("araso.sendPending"));
        await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
      }
    });
    await check(`B2 [${tag}] CG-02 real cold open, UNKNOWN: the slot says can't tell yet. exactly as before; returns change nothing`, async () => {
      try {
        const away = await coldOpen({ stage: "deposit-sending" }, "unknown");
        for (const x of away) assert.ok(["checking…", "can't tell yet."].includes(x.slot), `slot word: ${x.slot}`);
        assert.equal(away[away.length - 1].slot, "can't tell yet.");
        await setVisible("hidden"); await setVisible("visible"); await sleep(200);
        assert.equal(await p.evaluate(() => document.querySelector("#awayRestoreLine")?.textContent), "can't tell yet.");
        assert.equal(await p.locator("#chogHome .chogCheckLine").count(), 1);
      } finally {
        await p.evaluate(() => localStorage.removeItem("araso.sendPending"));
        await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
      }
    });

    // ── B3 CG-05 ───────────────────────────────────────────────────────────────────────────────────────
    await p.evaluate(() => {
      const a = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a893f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa893-dep", redeemTxHash: "0xa893-red", grantTxHash: "0xa893-grant", status: "success", at: Date.parse("2026-10-08T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
      for (const k of Object.keys(localStorage)) if (/^araso\.secondJourney(\.|Draft|Picks)/.test(k)) localStorage.removeItem(k);
    });
    await forgetIntro();
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
    await check(`B3 [${tag}] CG-05 bubble follows the current picks: 2 = these two?, 1 = none, all = all of them?, changed back to 2 = these two?; candidate taps keep it`, async () => {
      assert.equal(await exploreViaTapMe(), "explore");
      for (let t0 = Date.now(); Date.now() - t0 < 6000 && !(await p.locator("#exploreForm").count());) await sleep(200);
      await sleep(1500);
      // Pick by errand id. Only clean / asset-piece / grow have a candidate family (exploreCandidateDestinations); picks with no
      // candidate are the A-849 WAIT state, whose two lines rightly win over the confirmation — so every set here includes one of them.
      const GOES = ["clean", "asset-piece", "grow"];
      const shownIds = () => p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
      // [r5] set the boxes and press save in ONE page task (no render can slip in between and redraw the form with other boxes),
      // then wait for the candidates card to show exactly these picks (the picked line) before reading Chog.
      const tickIds = async (ids) => {
        const done = await p.evaluate((want) => {
          const boxes = [...document.querySelectorAll("#exploreForm input[data-errand-id]")];
          if (!boxes.length || !document.querySelector("#exploreSaveButton")) return false;
          for (const b of boxes) b.checked = want.includes(b.dataset.errandId);
          document.querySelector("#exploreSaveButton").click();
          return true;
        }, ids);
        assert.ok(done, "interests form present for the save");
        let picked = null;
        for (let t0 = Date.now(); Date.now() - t0 < 6000;) {
          picked = await p.evaluate(() => (document.querySelector("#secondOkButton") ? document.querySelector("#secondPickedLine")?.textContent ?? "" : null)).catch(() => null);
          if (picked !== null && picked.split(" · ").filter(Boolean).length === ids.length) break;
          await sleep(150);
        }
        assert.ok(picked !== null && picked.split(" · ").filter(Boolean).length === ids.length, `candidates card shows the ${ids.length} saved picks (got ${JSON.stringify(picked)})`);
        await sleep(400);
      };
      const pickSet = async (kind) => {
        const ids = await shownIds();
        const go = ids.find((id) => GOES.includes(id));
        assert.ok(go, `a candidate-bearing errand is offered (${ids.join(",")})`);
        if (kind === "one") return [go];
        if (kind === "all") return ids;
        return [go, ids.find((id) => id !== go)];
      };
      const tick = async (kind) => tickIds(await pickSet(kind));
      const notWait = async () => assert.equal(await p.evaluate(() => document.querySelectorAll("#exploreChogSay .chogCheckLine__line").length), 0, "not the A-849 wait state");
      const say = () => p.evaluate(() => document.querySelector("#exploreChogSay")?.textContent ?? null);
      const shown = await p.evaluate(() => document.querySelectorAll("#exploreForm input[type=checkbox]").length);
      // Changing picks in the product: the candidates card has no "edit interests" button (#exploreEditButton is not rendered); a new
      // Explore visit opens the interests card with the saved picks checked. Reopen = the A-891 path (quiet Home → tap me → Chog), after
      // dropping only the unfinished-card draft (araso.secondJourneyDraft.*) so the visit starts at interests instead of resuming the
      // candidates card; the learned interests (araso.secondJourney.*) stay.
      const edit = async () => {
        await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.secondJourneyDraft")) localStorage.removeItem(k); localStorage.removeItem("araso.secondIntroSeen"); });
        await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
        assert.equal(await exploreViaTapMe(), "explore", "reopen Explore");
        for (let t0 = Date.now(); Date.now() - t0 < 6000 && !(await p.locator("#exploreForm").count());) await sleep(200);
        assert.ok(await p.locator("#exploreForm").count(), "the interests card opens with the saved picks");
        await sleep(1200);
      };
      await tick("two"); await notWait(); const two = await say();
      assert.equal(two, shown === 2 ? "all of them?" : "these two?");
      if (two) legible(await lineBox("#exploreChogSay"), "CG-05 line");
      await shot("cg05_two");
      if (await p.locator(".secondJourney__pick").count()) { await p.locator(".secondJourney__pick").first().click({ force: true }); await sleep(500); assert.equal(await say(), two, "a candidate tap is not an interest pick"); }
      await edit(); await tick("one"); await notWait(); assert.equal(await say(), null, "one pick: no line");
      await edit(); const all = (await shownIds()).length; await tick("all"); await notWait();
      assert.equal(await say(), all > 1 ? "all of them?" : null); await shot("cg05_all");
      await edit(); await tick("two"); await notWait(); assert.equal(await say(), all === 2 ? "all of them?" : "these two?", "changed picks re-derive");
      await forgetIntro();
      await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlockIfLocked();
      assert.equal(await exploreViaTapMe(), "explore", "reopen reaches Explore through the same tap-me path");
      await sleep(2500);
      const resumed = await p.evaluate(() => ({ step: document.querySelector("#secondOkButton") ? "candidates" : document.querySelector("#exploreForm") ? "interests" : null, say: document.querySelector("#exploreChogSay")?.textContent ?? null, picked: document.querySelector("#secondPickedLine")?.textContent ?? "" }));
      if (resumed.step === "candidates") {
        const n = resumed.picked.split(" · ").filter(Boolean).length;
        assert.equal(resumed.say, n === 2 ? (all === 2 ? "all of them?" : "these two?") : n < 2 ? null : resumed.say, `resume (${n} picks): bubble matches the restored picks`);
      }
    });
    await check(`B4 [${tag}] no page errors`, () => { assert.deepEqual(errors, []); });
  } catch (e) {
    await check(`B [${tag}] flow`, () => { throw e; });
  } finally {
    await context.close();
  }
}

if (process.env.A893_NODE_ONLY === "1") console.log("SKIP  Part B (A893_NODE_ONLY=1; run with ARASO_TEST_BROWSER=1)");
else await runBrowser();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
