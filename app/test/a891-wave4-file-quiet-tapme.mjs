// [A-891] UI Wave 4 · File → quiet Home → tap me → Second intro (CG-03 · CG-04 · CG-05 intro · UI-19) + UI-26 verify (source).
//   node app/test/a891-wave4-file-quiet-tapme.mjs                       (Part N: source + vm-run contracts, no browser)
//   ARASO_TEST_BROWSER=1 node app/test/a891-wave4-file-quiet-tapme.mjs  (+ Part B: time series at 390 / 810 / 1440, normal + reduced)
// Canon: 94_VISUAL_DIRECTION §[2026-10-08 Owner] Chog copy locked; A-777 COWORK_FRAME_REVIEW §9.2 rows 4/10/11/12, §9.3 H1–H8, §9.5.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { TAP_CUE_TIMING } from "../src/chog-home.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
const RV = rd("app/src/return-view.js");
const PRET = rd("app/src/piggy-return.js");
const RECEIPTS = path.join(REPO, "_private/ops/receipts/A891_wave4_file_quiet_tapme");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const cutFn = (src, name) => { const i = src.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, st = false; for (let j = src.indexOf("{", i); j < src.length; j += 1) { if (src[j] === "{") { d += 1; st = true; } else if (src[j] === "}") { d -= 1; if (st && d === 0) return src.slice(i, j + 1); } } return null; };
// top-level function text up to the next top-level declaration (mountHome's first "{" is its parameter destructuring).
const topFn = (src, name) => { const i = src.indexOf(`\nfunction ${name}(`); if (i < 0) return null; const j = src.slice(i + 1).search(/\n(?:async )?function |\nconst |\nlet /); return src.slice(i + 1, j < 0 ? undefined : i + 1 + j); };
const BLOCK = (() => { const a = MAIN.indexOf("// ── [A-891] UI Wave 4"); const b = MAIN.indexOf("// ── [/A-891]"); return a >= 0 && b > a ? MAIN.slice(a, b) : ""; })();
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); pass += 1; } catch (e) { console.log(`FAIL  ${name}\n      ${String(e && e.message).split("\n").slice(0, 3).join(" | ").slice(0, 500)}`); fail += 1; }
}

// ── Part N ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
await check("N1 copy: the locked lines appear verbatim, exactly once each, only inside the A-891 block; no other Chog line is added", () => {
  assert.ok(BLOCK.length > 0, "A-891 block delimited");
  for (const line of ["I'll keep it here.", "I found a few things.", "wanna see a few more?"]) {
    assert.equal(strip(MAIN).split(line).length - 1, 1, `${line} once in main.js code`);
    assert.ok(BLOCK.includes(`"${line}"`), `${line} inside the block`);
  }
  // every string literal in the block's code is one of: the locked lines, ids/selectors/keys/class names, or DOM vocabulary.
  const lits = [...strip(BLOCK).matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
  const allowed = new Set(["I'll keep it here.", "I found a few things.", "wanna see a few more?", "araso.secondIntroSeen", "./chog-home.js",
    ".chogHome__hit", "role", "status", "chogCheckLine chogCheckLine--two", "translateX(-50%)", "span", "chogCheckLine__line", "chogCheckLine",
    "#returnChogHop #chogHome", "returnKeepLine", "return", "sendstay", "1", '.stage[data-scene="sendstay"] #chogHome', "secondIntroLine",
    "explore", '.stage[data-scene="explore"] #chogHome', "filebox", "#fileboxPaper", "keydown", "Enter", " ", "undefined", "click"]);
  const extra = lits.filter((l) => !allowed.has(l));
  assert.deepEqual(extra, [], "no other string literal (no new copy)");
  assert.equal(/tap me!/.test(BLOCK.replace(/\/\/.*$/gm, "")), false, "the cue wording stays in chog-home.js (existing startTapCue)");
});

await check("N2 ~8 s is one named constant with the Owner comment; First Send timing constant untouched", () => {
  assert.match(MAIN, /const POST_FILE_QUIET_HOME_MS = 8000; \/\/ Owner 2026-10-08 ~8 s, tune on device/);
  // pre-A-904 baseline: counted the whole file (2). The [A-904] jar guide reuses the same beat, so its block is cut out first; the A-891 count itself is unchanged.
  const MAIN_NO_A904 = MAIN.replace(/\/\/ ── \[A-904\] One-time guide[\s\S]*?\/\/ ── \[\/A-904\][^\n]*\n/, "");
  assert.equal((MAIN_NO_A904.match(/POST_FILE_QUIET_HOME_MS/g) || []).length, 2, "declared + used once (the post-file arm)");
  assert.match(MAIN, /const HOME_FIRST_JOURNEY_CARD_MS = 1200;/);
  assert.match(cutFn(MAIN, "a891ArmPostFileQuietHome"), /sceneTimeout\(arm, POST_FILE_QUIET_HOME_MS\);/);
});

await check("N3 First Home stays quiet: no startTapCue on first arrival; the silent hold keeps the First Send reveal = max(1200, readyMs) normal / 1200 reduced", () => {
  const home = topFn(MAIN, "mountHome");
  assert.equal(/startTapCue/.test(strip(home)), false, "mountHome never starts the cue");
  assert.match(home, /if \(isFirstArrival && !state\.sendCardVisible\) a891StartFirstArrivalHold\(\);/);
  assert.match(home, /const quietWait = a891FirstArrivalHoldRemainingMs\(\);[^\n]*\n\s*if \(quietWait > 0\) \{ sceneTimeout\(revealSendCard, Math\.max\(50, quietWait\)\); return; \}\s*const cueWait = homeChog\?\.tapCueHoldRemainingMs \|\| 0;/);
  assert.match(home, /sceneTimeout\(revealSendCard, HOME_FIRST_JOURNEY_CARD_MS\);\s*\}/, "first reveal still at HOME_FIRST_JOURNEY_CARD_MS");
  const holdFn = cutFn(MAIN, "a891StartFirstArrivalHold");
  assert.match(holdFn, /if \(prefersReducedMotion\(\)\) return;/, "reduced = 0 (as the reduced cue)");
  assert.match(holdFn, /const dt = last && !document\.hidden \? Math\.min\(now - last, 50\) : 0;/, "same dt rule as chog-home tapCue.t");
  assert.match(rd("app/src/chog-home.js"), /const dt = last && !document\.hidden \? Math\.min\(now - last, 50\) : 0;/);
  assert.equal(TAP_CUE_TIMING.readyMs, 3370);
  // pure replay of the hold clock: 60 fps frames → remaining time hits 0 at readyMs
  const ctx = vm.createContext({ Math, document: { hidden: false }, A891_TAP_CUE_TIMING: TAP_CUE_TIMING, frames: [], teardown: [] });
  vm.runInContext(`let a891FirstArrivalHold = null; const prefersReducedMotion = () => false;
    const runSceneFrames = (f) => frames.push(f); const onSceneTeardown = (f) => teardown.push(f);
    ${holdFn}\n${cutFn(MAIN, "a891FirstArrivalHoldRemainingMs")}
    globalThis.start = a891StartFirstArrivalHold; globalThis.rem = a891FirstArrivalHoldRemainingMs;`, ctx);
  ctx.start();
  const step = ctx.frames[0];
  let now = 1000; step(now);
  const seen = [];
  for (let k = 0; k < 400; k += 1) { now += 1000 / 60; if (step(now) === false) break; if (k === 71) seen.push(Math.round(ctx.rem())); }
  assert.equal(Math.round(ctx.rem()), 0);
  assert.ok(Math.abs(seen[0] - (3370 - 1200)) <= 17, `remaining at 1.2 s ≈ 2170 (got ${seen[0]})`);
});

await check("N4 post-file path: revealExplorePaper (1.2 s auto-Explore) is gone; settle() arms the quiet Home; homeQuietForExplore setters unchanged", () => {
  const home = topFn(MAIN, "mountHome");
  assert.equal(/revealExplorePaper/.test(strip(MAIN)), false);
  assert.match(home, /if \(state\.scene === "sendstay" && state\.homeQuietForExplore\) \{\s*state\.homeQuietForExplore = false;\s*a891ArmPostFileQuietHome\(\);\s*\}/);
  assert.equal(/openSecondJourneyExplore\(\)/.test(strip(home)), false, "mountHome never opens Explore by itself");
  assert.match(MAIN, /state\.homeQuietForExplore = state\.scene === "sendstay" && state\.tripClosed && !state\.secondJourneyCompletedOnce;/);
  assert.match(cutFn(MAIN, "goHomeFromFilebox"), /markResultMotionSeen\(\);[\s\S]*state\.homeQuietForExplore = !state\.secondJourneyCompletedOnce;\s*setScene\("sendstay", "Piggy is home\.", ""\);/);
  assert.match(home, /onTap: \(\) => a891HomeChogTap\(\),/);
});

// vm harness for the block's state machine (stubs only; the real functions run).
function makeWorld({ seen = false, secondDone = false, records = false, pinned = false, scene = "sendstay" } = {}) {
  const timers = [];
  const store = new Map(seen ? [["araso.secondIntroSeen", "1"]] : []);
  const calls = { startTapCue: 0, closeCard: 0, explore: 0, home: 0 };
  const said = [];
  const mkRoot = (tag) => ({ tag, kids: [], querySelector(sel) { if (sel === ".chogHome__hit") return { hit: true }; if (sel.startsWith("#")) return this.kids.find((k) => `#${k.id}` === sel) || null; return null; }, insertBefore(el) { this.kids.push(el); said.push({ where: tag, id: el.id, text: el.lines.length ? el.lines : [el.textContent] }); } });
  const roots = { sendstay: mkRoot("home"), explore: mkRoot("explore"), ret: mkRoot("return") };
  const mkEl = () => ({ id: "", className: "", textContent: "", style: {}, lines: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(c) { this.lines.push(c.textContent); }, remove() { this.removed = true; } });
  const homeChog = { state: { pinned }, startTapCue() { calls.startTapCue += 1; return true; }, closeCard() { calls.closeCard += 1; } };
  const state = { scene, secondJourneyCompletedOnce: secondDone, recordsCardVisible: records, sendCardVisible: false, resultMotionSeen: false };
  const ctx = vm.createContext({
    Math, String, JSON, state, homeChog, timers, calls,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    document: {
      createElement: () => mkEl(),
      querySelector: (sel) => (sel.includes('data-scene="sendstay"') ? roots.sendstay : sel.includes('data-scene="explore"') ? roots.explore : sel === "#returnChogHop #chogHome" ? roots.ret : null),
    },
    sceneTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    openSecondJourneyExplore: () => { calls.explore += 1; state.scene = "explore"; },
    goHomeFromFilebox: () => { calls.home += 1; state.scene = "sendstay"; },
    runSceneFrames: (f) => { ctx.frame = f; },
    A891_TAP_CUE_TIMING: TAP_CUE_TIMING, HOME_FIRST_JOURNEY_CARD_MS: 1200,
  });
  const decl = BLOCK.split("\n").filter((l) => /^const (POST_FILE_QUIET_HOME_MS|A891_FILED_LINE|A891_SECOND_INTRO_LINES|A891_FILED_LINE_HOLD_MS|A891_SECOND_INTRO_TO_PAPER_MS|SECOND_INTRO_SEEN_KEY)\b/.test(l)).join("\n");
  vm.runInContext(`${decl}\nlet a891FirstArrivalHold = null; let a891CueChog = null;\n${["a891SecondIntroSeen", "a891ChogSay", "a891AfterFiling", "a891ArmPostFileQuietHome", "a891HomeChogTap"].map((n) => cutFn(MAIN, n)).join("\n")}
    globalThis.arm = a891ArmPostFileQuietHome; globalThis.tap = a891HomeChogTap; globalThis.afterFiling = a891AfterFiling; globalThis.seenFn = a891SecondIntroSeen;`, ctx);
  const runTimer = (i = 0) => { const t = timers.splice(i, 1)[0]; t.fn(); return t; };
  return { ctx, timers, calls, said, state, store, homeChog, runTimer };
}

await check("N5 CG-04 quiet Home: exactly one 8000 ms timer, nothing shown before it; then startTapCue (wave + 'tap me!'); History open / pinned pad defer by 1200 ms", () => {
  const w = makeWorld();
  w.ctx.arm();
  assert.deepEqual(w.timers.map((t) => t.ms), [8000]);
  assert.equal(w.calls.startTapCue + w.calls.explore + w.said.length, 0, "bare quiet Home before the timer");
  w.runTimer();
  assert.equal(w.calls.startTapCue, 1);
  assert.equal(w.calls.explore, 0, "no auto-advance after the cue (Cowork answer)");
  assert.equal(w.timers.length, 0, "no further timer after the cue");
  const r = makeWorld({ records: true }); r.ctx.arm(); r.runTimer();
  assert.deepEqual([r.calls.startTapCue, r.timers.map((t) => t.ms)], [0, [1200]]);
  r.state.recordsCardVisible = false; r.runTimer(); assert.equal(r.calls.startTapCue, 1);
  const pn = makeWorld({ pinned: true }); pn.ctx.arm(); pn.runTimer(); assert.deepEqual([pn.calls.startTapCue, pn.timers.map((t) => t.ms)], [0, [1200]]);
});

await check("N6 once per user: intro seen → no timer, no cue; Second completed → no timer (A-411-n §2); leaving Home before 8 s → no cue", () => {
  for (const opt of [{ seen: true }, { secondDone: true }]) { const w = makeWorld(opt); w.ctx.arm(); assert.equal(w.timers.length, 0, JSON.stringify(opt)); }
  const w = makeWorld(); w.ctx.arm(); w.state.scene = "explore"; w.runTimer(); assert.equal(w.calls.startTapCue, 0);
});

await check("N7 CG-05 intro: the tap on the cue → seen stored, Home pad closed, the two locked lines over Chog, Explore Paper after 1200 ms with the lines kept; one tap only", () => {
  const w = makeWorld(); w.ctx.arm(); w.runTimer();
  w.ctx.tap();
  assert.equal(w.store.get("araso.secondIntroSeen"), "1");
  assert.equal(w.calls.closeCard, 1);
  assert.deepEqual(w.said, [{ where: "home", id: "secondIntroLine", text: ["I found a few things.", "wanna see a few more?"] }]);
  assert.deepEqual(w.timers.map((t) => t.ms), [1200]);
  assert.equal(w.calls.explore, 0, "Paper only after the line");
  w.ctx.tap(); assert.equal(w.timers.length, 1, "a second tap does nothing");
  w.runTimer();
  assert.equal(w.calls.explore, 1);
  assert.deepEqual(w.said.map((s) => s.where), ["home", "explore"]);
  assert.equal(w.ctx.seenFn(), true);
  const n = makeWorld(); n.ctx.tap(); assert.deepEqual([n.timers.length, n.said.length, n.store.size], [0, 0, 0], "a Chog tap without the post-file cue = the existing Home pad only");
});

await check("N8 CG-03 filing: the line only AFTER filed (never before), once; Home settles after the reading hold; later Returns: no line, same settle", () => {
  const w = makeWorld({ scene: "return" });
  const view = { filed: false };
  w.ctx.afterFiling(view, () => true);
  assert.equal(w.ctx.frame(), true, "keeps polling before filed");
  assert.equal(w.said.length, 0, "no line before filing completes");
  view.filed = true;
  assert.equal(w.ctx.frame(), false);
  assert.deepEqual(w.said, [{ where: "return", id: "returnKeepLine", text: ["I'll keep it here."] }]);
  assert.deepEqual(w.timers.map((t) => t.ms), [TAP_CUE_TIMING.holdMs]);
  w.runTimer(); assert.equal(w.calls.home, 1);
  const later = makeWorld({ scene: "return" }); later.state.resultMotionSeen = true;
  const v2 = { filed: true }; later.ctx.afterFiling(v2, () => true); later.ctx.frame();
  assert.equal(later.said.length, 0); later.runTimer(); assert.equal(later.calls.home, 1);
  const left = makeWorld({ scene: "return" }); const v3 = { filed: true }; left.ctx.afterFiling(v3, () => true); left.ctx.frame(); left.state.scene = "filebox"; left.runTimer();
  assert.equal(left.calls.home, 0, "folder tapped during the hold → the stored Receipt stays open");
  assert.match(MAIN, /endReturnArrivalAlarmWhenFiled\(hadAlarm, returnView, valid\);\n  a891AfterFiling\(returnView, valid\);/);
  assert.equal(/a891AfterFiling/.test(cutFn(MAIN, "mountSecondReturn")), false, "Second Return unchanged");
});

await check("N9 UI-19 return-view: no visible 'open the file' (template empty, text cleared, aria-label kept); #returnOpen id/click kept; Second 'Home' label kept; folder rect = piggy-return.js literal", () => {
  assert.match(RV, /<button class="tiny returnOpen" id="returnOpen" type="button" hidden><\/button>/);
  assert.equal(/>open the file</.test(RV), false);
  assert.match(RV, /if \(folderOpen\) \{\s*openBtn\.textContent = "";\s*openBtn\.setAttribute\("aria-label", openFileLabel\);\s*openBtn\.classList\.add\("returnOpen--folder"\);\s*\} else \{\s*openBtn\.textContent = openFileLabel;/);
  assert.match(RV, /if \(openBtn\) listen\(openBtn, "click", \(\) => onOpenFilebox\(\)\);/);
  assert.match(RV, /const FOLDER_STAGE_RECT = \[580, 632, 130, 100\];/);
  assert.match(PRET, /const folderRect = \[580, 632, 130, 100\];/);
  assert.match(MAIN, /openFileLabel: "Home",/, "Second Return passes its own label (unchanged)");
  assert.match(CSS, /\.returnOpen\.returnOpen--folder \{\s*position: fixed;\s*bottom: auto;\s*transform: none;\s*padding: 0;\s*font-size: 0;\s*\}/);
});

await check("N10 UI-19 filebox: the STORED Receipt (no synthesis) opens centred; tapping it closes to Home; 'home' floor label kept (H5)", () => {
  const fb = cutFn(MAIN, "renderFileBox");
  assert.match(fb, /const receipt = state\.receipts\[state\.receiptIndex\] \?\? null;\s*if \(!receipt\) \{\s*queueMicrotask\(\(\) => setScene\("sendstay", "Piggy is home\.", ""\)\);/);
  assert.match(fb, /<div class="filebox__paper" id="fileboxPaper" role="button" tabindex="0" aria-label="Receipt">\$\{paperMarkup\}<\/div>/);
  assert.match(fb, /<button class="tiny home" id="fileboxHomeButton" type="button">home<\/button>/);
  assert.match(CSS, /\.stage\[data-scene="filebox"\] \.filebox \{\s*position: fixed;\s*left: 50%;\s*top: 50%;\s*width: auto;\s*height: auto;\s*transform: translate\(-50%, -50%\);\s*\}/);
  assert.match(CSS, /\.stage\[data-scene="filebox"\] \.filebox__paper \{[^}]*transform: scale\(0\.82\);\s*transform-origin: center center;/);
  const close = cutFn(MAIN, "a891FileboxPaperClose");
  assert.match(close, /if \(state\.scene !== "filebox" \|\| !e\.target\?\.closest\?\.\("#fileboxPaper"\)\) return;/);
  assert.match(close, /goHomeFromFilebox\(\);/);
});

await check("N11 protected bodies byte-identical to the A-891 pre-copy (render 866133cf…, arasoBrandMarkup, money/auth, a734 Invite); chog-home.js untouched", () => {
  const preP = path.join(RECEIPTS, "pre_copies/app/src/main.js");
  assert.equal(sha(cutFn(MAIN, "render")).slice(0, 16), "866133cf60711093", "render() pin");
  if (!existsSync(preP)) return;
  const PRE = readFileSync(preP, "utf8");
  for (const f of ["render", "arasoBrandMarkup", "sendPiggyOnce", "requestPrf", "touchAppSession", "reconcileSendPending", "classifySendPending", "reconciledSendReceipt",
    "commitSendSuccess", "finishTrip", "readSendPending", "firstTripClosedShared", "reserveSend", "promoteSendReservation", "activateSigningSession", "appLockSurface",
    "awayRestoreLineMarkup", "beginAddPiggy", "chogHomeMarkupForAway", "confirmSendReservation", "endActiveSession", "firstSendAmountSecondary", "lockAppAfterIdle",
    "loginCheckingMarkup", "mountInviteChog", "readSendTxReceipt", "renderAuthCard", "sendPiggy", "sentRowValue", "settleUnlock", "showAwayRestore", "stayHome", "unlockApp",
    "openInvite", "setInvitePhase", "chogHomeMarkupForExplore", "openSecondJourneyExplore", "mountSecondReturn", "beginReturnArrivalAlarm", "endReturnArrivalAlarmWhenFiled"]) {
    // [A-893 merge] chogHomeMarkupForExplore / openSecondJourneyExplore are A-893-owned edits (Wave 5 CG-05, Cowork pre-answer):
    // pre-A-893 baseline: compared to the A-891 pre-copy; now compared to the A-893 post body (receipts/A893_wave5_chog_cues/post_main.js) — A-891 still must not touch them.
    const A893_OWNED = new Set(["chogHomeMarkupForExplore", "openSecondJourneyExplore"]);
    const P893 = path.join(REPO, "_private/ops/receipts/A893_wave5_chog_cues/post_main.js");
    if (A893_OWNED.has(f) && existsSync(P893)) { assert.equal(cutFn(MAIN, f), cutFn(readFileSync(P893, "utf8"), f), `${f} == A-893 post body`); continue; }
    // [A-896 re-pin, named reason: 99e M-L-2 60 s signer margin] sendPiggyOnce (one entry check) is A-896-owned: pinned by sha256 of this file's cutFn() text.
    // pre-A-896 baseline: cutFn(sendPiggyOnce) f1a3d8dea0104b4d2f62780b22e6c1e556485d557a389ee1862305d6ac028fdd (== the A-891 pre-copy body). [A-896 R1 re-pin: + monotonic performance.now stamp/check; prior A-896 value was the old pin]
    // (activateSigningSession gets one stamp line in A-896; this cutFn() stops at its `{ persistAddress }` parameter brace, so that name still compares unchanged below.)
    const A896_PINS = { sendPiggyOnce: "3878d322b0f886098fb04ee85dd0113302bf771b7df0f81c74b177cf8abfefc2" };
    if (A896_PINS[f]) { assert.equal(sha(cutFn(MAIN, f)), A896_PINS[f], `${f} == post-A-896 body`); continue; }
    // [A-893b re-pin · Owner via Cowork 2026-10-08 "체킹 다음에 나오는걸로"] awayRestoreLineMarkup is A-893b-owned (Away-slot pending wording only:
    // "still out." → "still out working." / "not back yet."; kinds and decisions unchanged): pinned by sha256 of this file's cutFn() text.
    // pre-A-893b baseline: awayRestoreLineMarkup == the A-891 pre-copy body (sha256 027535c3b9c99afbbf8d75f2e994d81a64c469c9b6bcd25859fb6d02758bcc89)
    const A893B_PINS = { awayRestoreLineMarkup: "960d811270c73c0d653e0615cb228530581336e9f57137d3168e9c6ac9467e38" };
    if (A893B_PINS[f]) { assert.equal(sha(cutFn(MAIN, f)), A893B_PINS[f], `${f} == post-A-893b body`); continue; }
    // [A-902 re-pin, named reason: Cowork answer "질문 · A-902" — frame-aligned bell/toss] pre-A-902 baseline: mountSecondReturn == the A-891 pre-copy body.
    // The only difference allowed is the single one-line hook below (the function body lives in the delimited [A-902] block).
    const A902_HOOK = "  a902WatchReturn(returnView, valid); // [A-902] bell + toss sounds\n";
    assert.equal(cutFn(MAIN, f).replace(A902_HOOK, ""), cutFn(PRE, f), `${f} unchanged`);
  }
  // pre-A-912 baseline: sha(chog-home.js) == sha(pre_copies/app/src/chog-home.js) (chog-home.js untouched by A-891). [A-912 re-pin, hash pin -> new sha256]
  // A-912 adds settleChogOneLine() + one MutationObserver block (one speech line at a time) to chog-home.js; nothing else changes.
  assert.equal(sha(rd("app/src/chog-home.js")), "a9b1702853d2adfd60dac4e748ed185bc878487fe9d3c09975e5675b3c9a2ca8", "chog-home.js == post-A-912");
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"), "final 640 block still last");
});

await check("N12 UI-26 verify-only (source): A-833 close lifecycle present — close 240 / exit 260, side = reversed preset-C then hide, stacked = 240 ms CSS, reduced = immediate, Home controls live at once", () => {
  const close = cutFn(MAIN, "closeRecordsCard");
  assert.match(MAIN, /const RECORDS_EXIT_MS = 260;/); assert.match(MAIN, /const RECORDS_CLOSE_MS = 240;/); assert.match(MAIN, /const RECORDS_OPEN_MS = 320;/);
  assert.match(close, /state\.recordsCardVisible = false;/);
  assert.match(close, /computeHistoryFitMode\(\) === "stacked" && !anchor\.hidden && !prefersReducedMotion\(\)/);
  assert.match(close, /computeHistoryFitMode\(\) === "side-by-side" && !anchor\.hidden && !prefersReducedMotion\(\) && animateRecordsCard\(anchor, false\)/);
  assert.match(close, /\} else \{\s*anchor\.hidden = true;/, "reduced motion / no WAAPI = immediate hide");
  assert.match(close, /syncRecordsViewportState\(\);\s*\}$/, "Home background controls re-enabled immediately");
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\.homePaperMount,[\s\S]*?transition: none !important;/);
});

console.log(`\nPart N: ${pass}/${pass + fail} PASS`);
if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  Part B - set ARASO_TEST_BROWSER=1 (headless Chrome + local port)"); process.exit(fail ? 1 : 0); }

// ── Part B (browser; coordinator-run) ────────────────────────────────────────────────────────────────────────────────────
// Time series per viewport (390x844 / 810x1080 / 1440x900) and per motion mode. Seeds a real First receipt (same shape as the A-845 / A-803
// seeds), then: DEV return jump → tap through → filed → line → Home → quiet ≥ 8 s → cue (+ wave) → tap → intro → Explore; reload = no
// repeat; folder tap → stored Receipt centred → tap closes; First arrival = no cue + First Send reveal ≈ settle + readyMs (normal) / 1200 (reduced).
const { launch, sleep } = await import("./helpers/a803-browser.mjs");
const OUT = path.join(RECEIPTS, "browser");
mkdirSync(OUT, { recursive: true });
const series = {};
for (const reduced of [false, true]) {
  for (const [W, H] of [[390, 844], [810, 1080], [1440, 900]]) {
    const tag = `${W}x${H}${reduced ? "R" : ""}`;
    const B = await launch();
    const { p } = B;
    try {
      await p.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await p.setViewportSize({ width: W, height: H });
      await B.seedSolo("Honeybun");
      const seed = async () => p.evaluate(() => { const a = localStorage.getItem("araso.address"); const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a891f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa891-dep", redeemTxHash: "0xa891-red", grantTxHash: "0xa891-grant", status: "success", at: Date.parse("2026-10-08T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); localStorage.removeItem("araso.secondIntroSeen"); localStorage.removeItem("araso.resultMotionSeen"); localStorage.removeItem("araso.secondJourneyClosed"); });
      await seed();
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await B.unlock();
      // recorder: every rAF + every mutation, wall-clock ms
      await p.evaluate(() => {
        const R = { ev: [] }; window.__a891 = R; const t0 = performance.now(); const log = (k, x) => R.ev.push({ t: Math.round(performance.now() - t0), k, ...(x || {}) });
        const st = () => document.querySelector("[data-scene]")?.dataset.scene || null;
        let last = {};
        const tick = () => {
          const cue = document.querySelector(".chogHome__tapCue"); const arm = /rotate\((-?[\d.e-]+)deg\)/.exec(document.querySelector('[data-part="home-near-arm"]')?.style.transform || "");
          const now = { scene: st(), keep: !!document.querySelector("#returnKeepLine"), cue: !!cue, intro: !!document.querySelector("#secondIntroLine"), card: !!document.querySelector("#sendCardAnchor, #secondJourneyCard"), open: !!document.getElementById("returnOpen") && !document.getElementById("returnOpen").hidden, openText: document.getElementById("returnOpen")?.textContent ?? null };
          for (const k of Object.keys(now)) if (now[k] !== last[k]) log(k, { v: now[k] });
          if (arm && Number(arm[1]) < -1) log("wave", { v: Number(arm[1]) });
          last = now; requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // revisit with First done: the initial scene path is the same quiet Home → cue (no auto-Explore)
      await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
      for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
        const v = await p.evaluate(() => ({ open: !!document.getElementById("returnOpen") && !document.getElementById("returnOpen").hidden, tap: (() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; })() }));
        if (v.open) break;
        if (v.tap) { await B.realClick("#returnTap"); await sleep(1200); continue; }
        await sleep(150);
      }
      const atFiled = await p.evaluate(() => ({ text: document.getElementById("returnOpen").textContent, aria: document.getElementById("returnOpen").getAttribute("aria-label"), r: (() => { const b = document.getElementById("returnOpen").getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })() }));
      assert.equal(atFiled.text, "", `${tag}: no visible "open the file" text`);
      assert.ok(atFiled.r[2] > 10 && atFiled.r[3] > 10, `${tag}: folder hit has a real box ${JSON.stringify(atFiled.r)}`);
      assert.equal(await B.waitScene(["sendstay"], 5000), "sendstay", `${tag}: Home settles by itself after the line`);
      await sleep(11000);
      const cueShown = await p.evaluate(() => !!document.querySelector(".chogHome__tapCue"));
      assert.equal(cueShown, true, `${tag}: "tap me!" after the quiet Home`);
      await sleep(TAP_CUE_TIMING.readyMs);
      await B.mustTap("#chogHomeHit", "Chog");
      assert.equal(await B.waitScene(["explore"], 4000), "explore", `${tag}: intro → Explore Paper`);
      await sleep(600);
      const ev = await p.evaluate(() => window.__a891.ev);
      const first = (k, v = true) => ev.find((e) => e.k === k && e.v === v)?.t ?? null;
      const leave = (k) => ev.find((e) => e.k === k && e.v === false && e.t > (first(k) ?? Infinity))?.t ?? null;
      const tFiledOpen = first("open"), tKeep = first("keep"), tHome = ev.find((e) => e.k === "scene" && e.v === "sendstay" && e.t > (tKeep ?? 0))?.t ?? null;
      const tCue = first("cue"), tIntro = first("intro"), tExplore = ev.find((e) => e.k === "scene" && e.v === "explore")?.t ?? null;
      const cardsInQuiet = ev.filter((e) => e.t > (tHome ?? 0) && e.t < (tCue ?? 0) && ((e.k === "card" && e.v) || (e.k === "cue" && e.v) || (e.k === "intro" && e.v))).length;
      const waves = ev.filter((e) => e.k === "wave" && e.t >= (tCue ?? Infinity) && e.t < (tIntro ?? Infinity)).map((e) => e.v);
      series[tag] = { tFiledOpen, tKeep, keepGone: leave("keep"), tHome, tCue, quietMs: tCue != null && tHome != null ? tCue - tHome : null, tIntro, tExplore, introToPaperMs: tExplore != null && tIntro != null ? tExplore - tIntro : null, cardsInQuiet, minWave: waves.length ? Math.min(...waves) : 0 };
      const s = series[tag];
      assert.ok(s.tKeep != null && s.tFiledOpen != null && s.tKeep >= s.tFiledOpen - 20, `${tag}: "I'll keep it here." only after filing completes ${JSON.stringify(s)}`);
      // tHome / tCue are first-rAF observations: the Home render (timer start) can precede its first observed frame by up to one frame,
      // so the observed gap may read up to 1 frame under the 8000 ms timer (coordinator run r2: 810x1080 = 7998). The bound allows that 1 frame.
      assert.ok(s.quietMs != null && s.quietMs >= 8000 - 17 && s.quietMs <= 8600, `${tag}: quiet Home ${s.quietMs} ms (≥ 8 s timer, ±1 frame observation, no card/cue)`);
      assert.equal(s.cardsInQuiet, 0, `${tag}: nothing shown during the quiet Home`);
      if (reduced) assert.equal(s.minWave, 0, `${tag}: reduced = no wave`); else assert.ok(s.minWave <= -5, `${tag}: small wave ${s.minWave}`);
      assert.ok(s.tIntro != null && s.tExplore != null && s.tExplore > s.tIntro, `${tag}: intro line before the Paper`);
      const introText = await p.evaluate(() => [...document.querySelectorAll("#secondIntroLine .chogCheckLine__line")].map((e) => e.textContent));
      assert.deepEqual(introText, ["I found a few things.", "wanna see a few more?"], `${tag}: intro lines kept over Chog on the Paper's first view`);
      // [A-891 same-class sweep] em tap areas (back to Home / interest rows) : local css hit >= 44, first card body <= its box, nothing past it.
      const sj = await p.evaluate(() => {
        const local = (el) => { const cs = getComputedStyle(el, "::after"); const n = (v) => parseFloat(v) || 0; return { h: el.offsetHeight - n(cs.top) - n(cs.bottom), w: el.offsetWidth - n(cs.left) - n(cs.right), inset: [cs.top, cs.right, cs.bottom, cs.left] }; };
        const body = document.querySelector(".secondJourney__body");
        return { sh: body?.scrollHeight, ch: body?.clientHeight, stay: document.querySelector("#secondJourneyCard #stayButton") ? local(document.querySelector("#secondJourneyCard #stayButton")) : null,
          items: [...document.querySelectorAll("#secondJourneyCard .secondJourney__list--interests .secondJourney__item")].map(local) };
      });
      series[tag].secondFirstCard = sj;
      assert.ok(sj.sh <= sj.ch, `${tag}: Second first card body ${sj.sh} <= ${sj.ch}`);
      assert.ok(sj.stay && sj.stay.h >= 44 && sj.stay.w >= 44, `${tag}: back to Home hit ${JSON.stringify(sj.stay)} >= 44 css`);
      for (const it of sj.items) assert.ok(it.h >= 44 && it.w >= 44, `${tag}: interest row hit ${JSON.stringify(it)} >= 44 css`);
      assert.deepEqual(sj.stay.inset.map((v) => Math.round(parseFloat(v))), [-24, -5, -18, -10], `${tag}: stay insets = the phone-reference px at every width`);
      // [A-891] candidates step: the picked-interest line's glyphs stay clear of the "places to explore?" glyphs (ink overlap 0).
      // Ink = baseline ± the font's actual glyph ascent/descent (canvas measureText with the computed font), scaled by the card.
      await B.realClick("#secondJourneyCard .secondJourney__item", 0); await sleep(250);
      await B.mustTap("#exploreSaveButton", "save one pick"); await sleep(1500);
      const ov = await p.evaluate(() => {
        const ink = (el) => {
          if (!el) return null;
          const probe = document.createElement("span"); probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
          el.appendChild(probe); const base = probe.getBoundingClientRect().top; probe.remove();
          const cs = getComputedStyle(el); const k = el.getBoundingClientRect().height / (el.offsetHeight || 1);
          const g = document.createElement("canvas").getContext("2d"); g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const m = g.measureText(el.textContent || "");
          return { top: base - m.actualBoundingBoxAscent * k, bottom: base + m.actualBoundingBoxDescent * k };
        };
        const title = ink(document.querySelector("#secondJourneyCard .secondJourney__exploreText"));
        const picked = ink(document.querySelector("#secondPickedLine"));
        const body = document.querySelector(".secondJourney__body");
        return { title, picked, gap: title && picked ? picked.top - title.bottom : null, sh: body?.scrollHeight, ch: body?.clientHeight };
      });
      series[tag].pickedOverlap = ov;
      assert.ok(ov.gap != null && ov.gap >= 0, `${tag}: title x picked-line ink overlap 0 (gap ${ov.gap})`);
      // reload: no repeat (intro seen), no auto-Explore
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await B.unlock();
      await sleep(10500);
      assert.deepEqual(await p.evaluate(() => [document.querySelector("[data-scene]")?.dataset.scene, !!document.querySelector(".chogHome__tapCue")]), ["sendstay", false], `${tag}: reload = no repeat`);
      // UI-19 folder → stored Receipt centred → tap closes
      await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
      for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
        const v = await p.evaluate(() => ({ open: !!document.getElementById("returnOpen") && !document.getElementById("returnOpen").hidden, tap: (() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; })() }));
        if (v.open) break;
        if (v.tap) { await B.realClick("#returnTap"); await sleep(1200); continue; }
        await sleep(150);
      }
      // Diagnostic (coordinator run 810x1080: "folder: #returnOpen not reachable"): what sits on top of the folder hit at its centre,
      // which scene, and whether the app lock / auto-Home already took over. Recorded in the series and in the failure text.
      const folderProbe = () => p.evaluate(() => {
        const o = document.getElementById("returnOpen"); const sc = document.querySelector("[data-scene]")?.dataset.scene ?? null;
        if (!o) return { scene: sc, open: null };
        const b = o.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const top = document.elementFromPoint(cx, cy); const d = (e) => (e ? `${e.tagName}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.trim().replace(/\s+/g, ".") : ""}` : null);
        return { scene: sc, hidden: o.hidden, rect: [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10), vw: innerWidth, vh: innerHeight, top: d(top), topIsOpen: !!top && (top === o || o.contains(top)), lock: !!document.querySelector("#loginChogButton") };
      });
      const probe0 = await folderProbe();
      series[tag].folderProbe = probe0;
      try { await B.mustTap("#returnOpen", "folder"); } catch (e) { throw new Error(`${e.message} · probe at filed ${JSON.stringify(probe0)} · now ${JSON.stringify(await folderProbe())}`); }
      assert.equal(await B.waitScene(["filebox"], 3000), "filebox", `${tag}: folder tap opens the stored Receipt`);
      await sleep(500);
      const c = await p.evaluate(() => { const b = document.querySelector("#fileboxPaper .receiptPaper").getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, vw: innerWidth, vh: innerHeight, tx: document.querySelector("#fileboxPaper .receiptPaper__row")?.textContent || "" }; });
      assert.ok(Math.abs(c.cx - c.vw / 2) <= 2 && Math.abs(c.cy - c.vh / 2) <= 2, `${tag}: Receipt centred ${JSON.stringify(c)}`);
      await B.mustTap("#fileboxPaper", "open Receipt");
      assert.equal(await B.waitScene(["sendstay"], 3000), "sendstay", `${tag}: second tap closes`);
      // First arrival: no cue, First Send reveal ≈ settle + readyMs (normal) / 1200 (reduced)
      const fa = await p.evaluate(async (red) => {
        localStorage.removeItem("araso.tripClosed");
        let tSettle = null, tCard = null, cue = 0; const t0 = performance.now();
        const host = () => document.querySelector("#homeChar");
        const tick = () => { if (tSettle == null && host()?.dataset.arrival === "0") tSettle = performance.now() - t0; if (document.querySelector(".chogHome__tapCue")) cue += 1; if (tCard == null && document.querySelector("#sendCardAnchor")) tCard = performance.now() - t0; if (performance.now() - t0 < 12000 && tCard == null) requestAnimationFrame(tick); };
        window.__arasoScene("sendstay", { arrival: true }); requestAnimationFrame(tick);
        await new Promise((r) => setTimeout(r, 12500));
        // [A-891 same-class sweep] Send date stack + day-of-month: boxes in order, nothing clipped, dom clear of the date/title text.
        const R = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const hit = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        const card = document.querySelector("#sendCard");
        const date = { day: R("#sendCard .sendCard__day"), weekday: R("#sendCard .sendCard__weekday"), dom: R("#sendCard .sendCard__dom"), title: R("#sendCard .sendCard__titleText"),
          cardClip: card ? [...card.querySelectorAll(".sendCard__day, .sendCard__weekday, .sendCard__dom")].some((e) => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflow !== "visible") : null };
        date.domHitsTitle = hit(date.dom, date.title); date.domHitsDay = hit(date.dom, date.day);
        return { tSettle, tCard, cue, red, date };
      }, reduced);
      series[tag].firstArrival = fa;
      assert.equal(fa.cue, 0, `${tag}: First Home arrival shows no "tap me!"`);
      if (fa.date?.day && fa.date?.weekday) assert.ok(fa.date.weekday.t > fa.date.day.t, `${tag}: weekday below day ${JSON.stringify(fa.date)}`);
      assert.equal(fa.date?.cardClip, false, `${tag}: date texts not clipped`);
      assert.deepEqual([fa.date?.domHitsTitle, fa.date?.domHitsDay], [false, false], `${tag}: .sendCard__dom clear of title/day`);
      if (fa.tSettle != null && fa.tCard != null) {
        const want = reduced ? 1200 : TAP_CUE_TIMING.readyMs;
        assert.ok(Math.abs(fa.tCard - fa.tSettle - want) <= 200, `${tag}: First Send reveal ${Math.round(fa.tCard - fa.tSettle)} ms after settle vs ${want}`);
      }
      assert.deepEqual(B.errors, [], `${tag}: page errors`);
      console.log(`PASS  B ${tag} ${JSON.stringify(series[tag])}`); pass += 1;
    } catch (e) {
      console.log(`FAIL  B ${tag}\n      ${String(e && e.message).slice(0, 600)}`); fail += 1;
      await p.screenshot({ path: path.join(OUT, `fail_${tag}.png`) }).catch(() => {});
    } finally {
      await B.close();
    }
  }
}
writeFileSync(path.join(OUT, "a891_series.json"), JSON.stringify(series, null, 1));
console.log(`\nPart N+B: ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
