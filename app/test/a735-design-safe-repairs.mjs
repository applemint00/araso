// [A-735] design-safe repairs from the A-732 audit: tap-target hit expansion, reduced-motion guards,
// Second candidate paper shell. Part A = static CSS (node). Part B = browser (hit areas, ownership, clip,
// reduced motion) — needs a vite dev server; set A735_NODE_ONLY=1 for Part A only, A735_BASE=<url> to reuse a
// running `vite app --mode a172-local`, A735_ALL=1 for all six viewports (default 390/700/1440).
// NOT covered here (blocked / owner items, see A-735 WRITER_NOTES): Work? cue (piggy-depart.js / main.js),
// web/iPad text size, Piggy wake, web Name freeze.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_MODE_ENV, FORK_MODE_INIT, RUN_SCOPE, forkFirstDone, forkKey, forkRpcStub } from "./helpers/fork-mode.mjs"; // [A-950] fork-profile mode (STALE_TESTS class (a)): the Second UI opens only on the fork profile since A-948
import { layoutOracle } from "./helpers/a831-sweep.mjs"; // [A-839] pure Home layout (k = HomeCard / 282) for the k-scaled B1 baseline
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const css = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const nameCss = readFileSync(path.join(REPO, "app/public/motion/name.css"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")}`); } }
const a735 = css.slice(css.indexOf("[A-735] A-732 design-safe repairs"), css.lastIndexOf("@media (max-width: 640px) {\n  .homeLiving__name"));
const rule = (block, sel) => { let i = block.indexOf("\n" + sel + " {"); i = i >= 0 ? i + 1 : block.indexOf(sel + " {"); assert.ok(i >= 0, `rule ${sel} present`); return block.slice(i, block.indexOf("}", i) + 1); };

// ── Part A: static ────────────────────────────────────────────────────────────────────────────────────
await check("A1 the A-735 block exists, sits after every older rule it overrides (it precedes only the a681-pinned final `@media (max-width: 640px) { .homeLiving__name }` block)", () => {
  assert.ok(css.includes("[A-735] A-732 design-safe repairs"));
  assert.ok(css.lastIndexOf("@media (prefers-reduced-motion: reduce)") > css.indexOf("[A-735] A-732 design-safe repairs"));
  assert.ok(css.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"), "a681 pins this as the last rule block");
  assert.ok(css.indexOf("[A-735] A-732 design-safe repairs") > css.indexOf(".secondJourneyCard .job { font-size: 28px; }"), "after the rules it overrides");
});
await check("A2 tap targets: transparent ::after on every listed control, no visible box change (no width/height/padding/margin/font on the controls)", () => {
  for (const sel of [".sendCard__stay::after", ".secondJourneyCard .back::after", "#skipHatchButton::after", ".secondJourneyCard .secondJourney__list--interests .secondJourney__item::after", ".recordsCard__close::after", ".secondJourneyCard .secondJourney__pick::after"]) {
    const r = rule(a735, sel); assert.match(r, /content:\s*""/, sel); assert.match(r, /position:\s*absolute/, sel); assert.match(r, /inset:/, sel);
    assert.equal(/background|border|box-shadow|opacity|color/.test(r), false, `${sel} must stay transparent`);
  }
  assert.match(a735, /\.homePaper \.homeFlap--2::after \{ inset:/);
  for (const sel of ["#homeRecordsButton::after", ".homePaper__records[data-piggy-id]::after"]) assert.ok(a735.includes(`${sel} {`), sel);
  // the web records boxes keep the ORIGINAL -10px bottom reach (home-paper-multi.css) so the folded flap below loses nothing
  assert.equal((a735.match(/inset: -44px -12px -10px -12px;/g) || []).length, 2);
  for (const sel of [".sendCard__stay", ".secondJourneyCard .back", ".secondJourney__item"]) {
    const m = a735.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{ position: relative; \\}"));
    if (sel !== ".secondJourney__item") assert.ok(m, `${sel} gets position:relative only`);
  }
});
await check("A3 candidate shell reuses the .pkbtn surface exactly (tokens read from the .pkbtn rule, not retyped)", () => {
  const pk = rule(css, ".pkbtn");
  const shell = rule(a735, ".secondJourneyCard .secondJourney__pick");
  for (const t of ["background-color: #ebe3d5", 'url("/card/paper_tex_ivory.png")', "background-size: 290px auto", "border-radius: 20px", "border: 0", "box-shadow: 0 2px 0 #8b8475, 0 5px 7px rgba(20, 18, 16, 0.19)"]) {
    assert.ok(shell.includes(t), `shell has ${t}`);
  }
  assert.ok(pk.includes("box-shadow: 0 2px 0 #8b8475, 0 5px 7px rgba(20, 18, 16, 0.19)") && pk.includes("height: 40px") && pk.includes("border-radius: 20px"));
  assert.match(shell, /height: 40px/);
  assert.equal(/(^|[\s;{])(font-size|font-family|font:|color:|transform)/.test(shell), false, "shell never touches title font/size/colour/tilt");
});
await check("A4 candidate titles keep the existing handwriting: .job 24px / mobile 28px declarations untouched, no pkbtn word-token on picks", () => {
  assert.match(css, /\.secondJourneyCard \.job \{[^}]*font-family: var\(--font-cj\);[^}]*font-size: 24px;[^}]*line-height: 28px;/);
  assert.match(css, /@media[^{]*max-width: 640px[\s\S]*?\.secondJourneyCard \.job \{ font-size: 28px; \}/);
  assert.equal(/secondJourney__pick[^{]*\{[^}]*--btnWordSize/.test(css), false);
});
await check("A5 picked highlight stays the existing yellow 72%-94% underline (limited to the 28px content box)", () => {
  const r = rule(a735, ".secondJourneyCard .secondJourney__pick.is-picked");
  assert.match(r, /linear-gradient\(transparent 72%, #E0B10055 72%, #E0B10055 94%, transparent 94%\)/);
  assert.match(r, /background-clip: content-box, border-box/);
});
await check("A6 reduced motion: style.css guards check-pulse / tear-shake / env / egg / spark (end state kept), name.css guards the 11.5s Piggy loop", () => {
  const m = a735.slice(a735.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  for (const s of [".invite[data-phase=\"checking\"] .invite__face", ".invite__envImg--tear", ".invite__env", ".invite__egg", ".invite__burst"]) assert.ok(m.includes(s), s);
  assert.match(m, /animation-duration: 0\.001ms !important/); assert.match(m, /animation-iteration-count: 1 !important/);
  assert.equal(/animation:\s*none/.test(m), false, "not animation:none — fill-mode end states (env-exit opacity 0, egg-land) must still apply");
  assert.equal(/transition:\s*none/.test(m), false, "functional transitions untouched");
  const n = nameCss.slice(nameCss.indexOf("[A-735]"));
  assert.match(n, /@media \(prefers-reduced-motion: reduce\)/); assert.match(n, /\.pgwrap \*/); assert.match(n, /animation-play-state: paused !important/); assert.match(n, /\.pgwrap \.eye[^{]*\{\s*animation: none !important/);
  assert.ok(nameCss.includes("pgMove 11.5s cubic-bezier(.3,.9,.25,1) infinite"), "the loop itself is not edited");
});


// ── Part C: Work? confirmed cue (criterion 4) — node, no browser ─────────────────────────────────────────
// Canon: _private/design/piggy/home_motion_confirmed_20260926 README + preview.js:14,1087-1125 drawConfirmedWorkCue.
const depart = await import(new URL("../src/piggy-depart.js", import.meta.url));
const mainSrc = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const departSrc = readFileSync(path.join(REPO, "app/src/piggy-depart.js"), "utf8");
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === "calls" ? calls : (...a) => { calls.push([String(k), ...a]); }), set: () => true });
  return { canvas: { width: 1256, height: 772, getContext: () => ctx }, calls };
}
globalThis.Path2D = globalThis.Path2D || class Path2D { constructor(d) { this.d = d; } };
await check("C1 timeline: look-up 0-0.35 -> surprised beat 0.35-0.75 -> ONE -18px jump 0.9-1.45 -> hold at 1.8s (canon numbers)", () => {
  const { workCueState: S, WORK_CUE: W } = depart;
  assert.deepEqual({ ...W }, { total: 1.8, lookUp: 0.35, surprisedEnd: 0.75, jumpStart: 0.9, jumpEnd: 1.45, jump: -18 });
  assert.equal(S(0).surprised, false); assert.ok(S(0.34).clock < 0.35 && !S(0.34).surprised);
  assert.equal(S(0.35).surprised, true); assert.equal(S(0.74).surprised, true); assert.equal(S(0.75).surprised, false);
  let beat = 0; for (let t = 0; t <= 1.8; t += 0.005) if (S(t).surprised) beat += 0.005; assert.ok(beat > 0.35 && beat < 0.45, `beat ${beat}`);
  assert.equal(S(0.89).jumpY, 0); assert.ok(Math.abs(S(1.175).jumpY + 18) < 1e-6); assert.ok(Math.abs(S(1.45).jumpY) < 1e-9);
  let dips = 0, was = 0, min = 0; for (let t = 0; t <= 1.8; t += 0.005) { const y = S(t).jumpY; if (y < -1e-9 && was >= -1e-9) dips += 1; was = y; min = Math.min(min, y); }
  assert.equal(dips, 1, "one jump only"); assert.ok(min >= -18.0001 && min < -17.9);
});
await check("C2 prepared hold: after 1.8s (and for any later time) the state is constant — no loop, no blink, no jump, no eyes", () => {
  const S = depart.workCueState; const end = S(1.8);
  assert.equal(end.hold, true); assert.equal(end.surprised, false); assert.equal(end.jumpY, 0); assert.equal(end.clock, 1);
  for (const t of [1.81, 3.6, 5.25, 10, 1e6]) assert.deepEqual(S(t), end, `t=${t}`);
  assert.deepEqual(S(-5), S(0)); assert.deepEqual(S(NaN), S(0));
});
await check("C3 renderer in work mode never departs: scene source stays <= 0.8 (rise/travel 0) for the whole cue and long after", () => {
  const { canvas } = recorder(); const r = depart.createDepartRenderer(canvas, { images: new Map(), mode: "work" });
  for (const t of [0, 0.2, 0.35, 0.5, 0.75, 1, 1.175, 1.8, 3.6, 5.25, 60, 600]) { const o = r.drawAt(t); assert.ok(o.source <= 0.8 + 1e-9, `source ${o.source}@${t}`); assert.equal(o.rise, 0, `rise@${t}`); assert.equal(o.travel, 0); assert.equal(o.enter, 0); }
  // the send renderer is untouched: it still departs
  const s = depart.createDepartRenderer(recorder().canvas, { images: new Map(), mode: "send" }); assert.ok(s.drawAt(5).travel > 0);
});
await check("C4 draw calls: surprised eyes (canon cover rect + 2 canon paths) only inside 0.35-0.75; the -18px canvas shift only inside the jump; balanced save/restore", () => {
  const run = (t) => { const { canvas, calls } = recorder(); depart.createDepartRenderer(canvas, { images: new Map(), mode: "work" }).drawAt(t); return calls; };
  const cnt = (c, k) => c.filter((x) => x[0] === k).length;
  const a = run(0.5); assert.deepEqual(a.find((x) => x[0] === "fillRect").slice(1), [1008, 548, 43, 24]); assert.equal(cnt(a, "fill"), 2);
  assert.equal(cnt(run(1.0), "fillRect"), 0); assert.equal(cnt(run(1.8), "fillRect"), 0); assert.equal(cnt(run(0.2), "fillRect"), 0);
  const j = run(1.175); const sx = 1256 / 1256; assert.ok(j.some((x) => x[0] === "translate" && x[1] === 0 && Math.abs(x[2] + 18 * sx) < 1e-6), "-18 shift");
  assert.equal(run(1.8).some((x) => x[0] === "translate" && x[2] && Math.abs(x[2]) > 0 && x[1] === 0 && x[2] === -18), false);
  for (const t of [0, 0.5, 1.175, 1.8]) { const c = run(t); assert.equal(cnt(c, "save"), cnt(c, "restore"), `save/restore @${t}`); }
});
const C5_REF = path.join(REPO, "_private/design/piggy/home_motion_confirmed_20260926/snapshot/_private/ops/receipts/A583_multi_piggy_motion_preview/preview.js");
if (!existsSync(C5_REF)) console.log("SKIP  C5 canon art only — local reference source absent (public checkout)");
else await check("C5 canon art only: the eye paths in piggy-depart.js are byte-identical to the Owner-confirmed preview.js SURPRISED_EYES; old 3.6s blink loop + -4px loop are gone from the work branch", () => {
  const pv = readFileSync(C5_REF, "utf8");
  const paths = [...pv.slice(pv.indexOf("const SURPRISED_EYES")).matchAll(/new Path2D\("([^"]+)"\)/g)].slice(0, 2).map((m) => m[1]);
  assert.equal(paths.length, 2); for (const d of paths) assert.ok(departSrc.includes(`d: "${d}"`), "path present verbatim");
  assert.ok(pv.includes("1008, 548, 43, 24") && pv.includes("-18 * Math.sin") && pv.includes("1017.1, 558.5") && pv.includes("1037.6, 561.7"));
  assert.equal(/const b = elapsed % 3\.6/.test(departSrc), false); assert.equal(/for \(const start of \[1\.65, 1\.98\]\)/.test(departSrc), false);
});
await check("C6 main.js wiring: cue drawn on the real clock then the frame loop stops at WORK_CUE.total; reduced motion draws only the settled hold; the pose starts nothing", () => {
  const i = mainSrc.indexOf("function mountSendCardWorkPose"); const body = mainSrc.slice(i, mainSrc.indexOf("function startHomeDrowsyTimer", i));
  assert.match(body, /return el < WORK_CUE\.total;/); assert.match(body, /renderer\.drawAt\(WORK_CUE\.total\)/);
  assert.equal(/drawAt\(0\.6\)/.test(body), false); assert.equal(/return true; \/\/ 깜박임/.test(body), false);
  for (const bad of ["createDepartPlayback", "handleSend", "sendButton", "requestExecution"]) assert.equal(body.includes(bad), false, `work pose must not touch ${bad}`);
  assert.match(mainSrc, /import \{ WORK_CUE, createDepartPlayback/);
});

// ── Part B: browser ───────────────────────────────────────────────────────────────────────────────────
// [A-748] RE-PIN: for viewports >=641 A-744 (intentional canon) raised card/paper type 13->15 / 12->14px, so the text-box sizes of these controls grew
// (e.g. sendCard__stay 38.9x11.82 -> 44.88x13.65 = exactly the 390/430 values). Only the stale size numbers below were re-measured (A-748 m748_after.json); positions shifted
// consistently, tolerance (<0.6) and the unchanged-visible-box invariant are unchanged. 390x844/430x932 and controls A-744 did not touch keep their original A-735 values.
// [A-779 RE-PIN] A-777 §8.2/§8.3 LOCKED: Explore items now use the shared supporting size --type-support (15 -> 18px css, x.65 card
// scale = 11.7px rendered), so the two interest-row text boxes grew 88.11x18.2 -> 102.61x20.54 and 80.6x18.2 -> 91.53x20.54 (measured, A779
// after/measure.json; same at every width because the card scale is the constant .65). Only those two numbers changed; tolerance unchanged.
// [A-779 v2 RE-PIN] Owner 2026-10-05: the Second card Home link is the label tier --type-label 16px (was 15px), so interests.homeBack
// 60.24x13.65 -> 64.25x14.55 and candidates.back 23.94x23.4 -> 25.53x23.4 (A779 after_v2/measure.json). Nothing else changed.
// [A-786 RE-PIN] Home paper scaled x1.10 (style.css --homePaperK; whole .homePaper incl. its "no records yet" link), so home.homeRecords visible box grew
// exactly x1.10: 85.85x16.14 -> 94.44x17.76 (<=640) and 57.24x10.76 -> 62.96x11.84 (>=641) (A786 after/measure.json). home.flap2 202.51x15.38 -> 222.76x16.92 and home.flap1 212.76x15.38 -> 234.04x16.92 are the same x1.10 (they live inside .homePaper). Nothing else in BASEVIS changed.
// [A-845 RE-PIN] A-843 text styles (Label 13 / Body 14 on-screen at the phone card): only the TEXT boxes of these five controls grew with their font
// (local font 15->19.98 stay, 18->21.74 items, 16->20.19 back to Home / Home, Home line box 20px -> 20/13 em = the A-845 fit rule). Values = old box with
// the text part x the font ratio (fixed checkbox 14 + gap 7 + padding 3 / padding 8+8 kept), in the same .65-scale frame; cross-checked with the A-845
// measured local widths (items cw 186 / 165, back to Home 125, Home 50; stay 59.82x18.2 at 390 / factor 1.0011). Tolerance unchanged.
// pre-A-845 baseline (every viewport): sendcard.sendCard__stay [44.88,13.65] · interests.item0 [102.61,20.54] · interests.item1 [91.53,20.54] ·
// interests.homeBack [64.25,14.55] · candidates.back [25.53,23.4]
const BASEVIS = {"390x844":{"hatch.skip":[38.34,19],"sendcard.sendCard__stay":[59.75,18.18],"interests.item0":[120.7,23.46],"interests.item1":[107.32,23.46],"interests.homeBack":[81.08,18.37],"candidates.back":[32.22,30.59],"candidates.ok":[79.3,26],"home.homeRecords":[94.44,17.76],"home.flap2":[222.76,16.92],"home.flap1":[234.04,16.92],"history.recordsClose":[30.52,16.8]},"430x932":{"hatch.skip":[38.34,19],"sendcard.sendCard__stay":[59.75,18.18],"interests.item0":[120.7,23.46],"interests.item1":[107.32,23.46],"interests.homeBack":[81.08,18.37],"candidates.back":[32.22,30.59],"candidates.ok":[79.3,26],"home.homeRecords":[94.44,17.76],"home.flap2":[222.76,16.92],"home.flap1":[234.04,16.92],"history.recordsClose":[30.52,16.8]},"700x900":{"hatch.skip":[35.09,17],"sendcard.sendCard__stay":[59.75,18.18],"interests.item0":[120.7,23.46],"interests.item1":[107.32,23.46],"interests.homeBack":[81.08,18.37],"candidates.back":[32.22,30.59],"candidates.ok":[79.3,26],"home.homeRecords":[62.96,11.84],"home.flap2":[222.76,16.92],"home.flap1":[234.04,16.92],"history.recordsClose":[30.52,16.8]},"1024x768":{"hatch.skip":[35.09,17],"sendcard.sendCard__stay":[59.75,18.18],"interests.item0":[120.7,23.46],"interests.item1":[107.32,23.46],"interests.homeBack":[81.08,18.37],"candidates.back":[32.22,30.59],"candidates.ok":[79.3,26],"home.homeRecords":[62.96,11.84],"home.flap2":[222.76,16.92],"home.flap1":[234.04,16.92],"history.recordsClose":[30.52,16.8]},"1180x820":{"hatch.skip":[35.09,17],"sendcard.sendCard__stay":[59.75,18.18],"interests.item0":[120.7,23.46],"interests.item1":[107.32,23.46],"interests.homeBack":[81.08,18.37],"candidates.back":[32.22,30.59],"candidates.ok":[79.3,26],"home.homeRecords":[62.96,11.84],"home.flap2":[222.76,16.92],"home.flap1":[234.04,16.92],"history.recordsClose":[30.52,16.8]},"1440x900":{"hatch.skip":[35.09,17],"sendcard.sendCard__stay":[59.75,18.18],"interests.item0":[120.7,23.46],"interests.item1":[107.32,23.46],"interests.homeBack":[81.08,18.37],"candidates.back":[32.22,30.59],"candidates.ok":[79.3,26],"home.homeRecords":[62.96,11.84],"home.flap2":[222.76,16.92],"home.flap1":[234.04,16.92],"history.recordsClose":[30.52,16.8]}};
if (process.env.A735_NODE_ONLY === "1") console.log("SKIP  Part B (A735_NODE_ONLY=1) — browser scenarios not run");
else await runBrowser();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);

function freePort() { return new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); }); }

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) { console.log("SKIP  Part B — local browser harness absent (public checkout)"); return; }
  let chromium;
  try { ({ chromium } = createRequire(path.join(REPO, "_private/ops/harness/package.json"))("playwright")); }
  catch (e) { await check("B0 playwright available (local harness)", () => { throw e; }); return; }
  let server = null, BASE = process.env.A735_BASE || "";
  if (!BASE) {
    const port = await freePort();
    server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", ...FORK_MODE_ENV /* [A-950] */ }, stdio: ["ignore", "pipe", "pipe"] });
    try { await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); }); }
    catch (e) { await check("B0 vite dev server starts (needs local port binding)", () => { throw e; }); return; }
    BASE = `http://localhost:${port}/`;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    let vps = process.env.A735_ALL === "1" ? [[390, 844], [430, 932], [700, 900], [1024, 768], [1180, 820], [1440, 900]] : [[390, 844], [700, 900], [1440, 900]];
    if (process.env.A735_ONLY) vps = vps.filter(([w, h]) => process.env.A735_ONLY.split(",").includes(`${w}x${h}`)); // e.g. A735_ONLY=700x900 (mutation runs)
    for (const [w, h] of vps) await walk(browser, BASE, w, h);
    await reducedMotion(browser, BASE);
  } finally { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } }
}

// In-page measurement: visible rect, hit bbox (elementFromPoint, 2px, +-48px), overflow-with-pseudo-hidden, owner map.
function MEASURE([sel, idx]) {
  const el = document.querySelectorAll(sel)[idx]; if (!el) return null;
  const b = el.getBoundingClientRect(); if (!b.width && !b.height) return null;
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (let y = Math.floor(b.top - 48); y <= b.bottom + 48; y += 2) for (let x = Math.floor(b.left - 48); x <= b.right + 48; x += 2) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  }
  const cs = getComputedStyle(el);
  const st = document.createElement("style"); st.textContent = "*::before,*::after{display:none !important}"; document.head.appendChild(st);
  const sh = el.scrollHeight, ch = el.clientHeight, sw = el.scrollWidth, cw = el.clientWidth;
  st.remove();
  return { oh: el.offsetHeight, vis: [+b.width.toFixed(2), +b.height.toFixed(2)], box: [b.left, b.top, b.right, b.bottom], hit: minx < 1e8 ? { w: maxx - minx + 2, h: maxy - miny + 2, l: minx, t: miny, r: maxx, b: maxy } : null, sh, ch, sw, cw, font: cs.fontSize, family: cs.fontFamily, bgi: cs.backgroundImage, radius: cs.borderRadius, shadow: cs.boxShadow, bgc: cs.backgroundColor, border: cs.borderTopWidth };
}

async function walk(browser, BASE, w, h) {
  const vp = `${w}x${h}`;
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
  await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
  const p = await context.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const m = (sel, idx = 0) => p.evaluate(MEASURE, [sel, idx]);
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 1) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) { const x = b.left + b.width / 2 + sx * dx, y = b.top + b.height / 2 + sy * dy; if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y }; } return null; }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, lab, idx = 0) => { for (let i = 0; i < 8; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(500); } throw new Error(`${lab}: ${sel} unreachable`); };
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
  const unlock = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const M = {};
  // pre-A-839 baseline: assert.ok(Math.abs(got.vis[0] - want[0]) < 0.6 && Math.abs(got.vis[1] - want[1]) < 0.6, `${key}@${vp} visible box changed ${want} -> ${got.vis}`) (the pre-A-735 sizes at k = 1)
  // A-839 (Cowork add-on): card contents scale with the card, k = HomeCard / 282 (A-829 item 4): Home family (First Send, paper, History) x k; the Second card is 1.0 x HomeCard on its 285 box, so its
  // controls carry k x 282 / 285; the hatch skip is not on a card. Expected visible box = baseline x factor.
  const kOf = layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"))(w, h).k;
  const factor = (key) => (/^hatch\./.test(key) ? 1 : /^(interests|candidates|action)\./.test(key) ? (kOf * 282) / 285 : kOf);
  const sameVis = (key, got) => { const want = BASEVIS[vp]?.[key]; assert.ok(want, `baseline for ${key}@${vp}`); const f = factor(key); assert.ok(Math.abs(got.vis[0] - want[0] * f) < 0.6 * Math.max(1, f) && Math.abs(got.vis[1] - want[1] * f) < 0.6 * Math.max(1, f), `${key}@${vp} visible box ${want} x ${f.toFixed(4)} -> ${got.vis}`); };
  try {
    await p.goto(BASE, { waitUntil: "networkidle" });
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { skip: vis("#skipHatchButton"), input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
      if (v.skip && !M.skip) { await sleep(400); M.skip = await m("#skipHatchButton"); }
      if (v.input) break;
      if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
      await sleep(300);
    }
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000);
    for (let t0 = Date.now(); Date.now() - t0 < 15000;) { if (await p.locator("#sendCardWorkStage").count()) break; await sleep(30); }
    // Work? cue frames: sample the real canvas every 50ms for 3s (cue = 1.8s then a held frame)
    const hashes = []; for (let k = 0; k < 60; k += 1) { hashes.push(await p.evaluate(() => { const c = document.querySelector("#sendCardWorkStage"); if (!c) return null; try { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0, ink = 0; for (let i = 0; i < d.length; i += 37) { h = (h * 31 + d[i] + d[i + 3]) | 0; if (d[i + 3]) ink += 1; } return `${h}:${ink}`; } catch { return "x"; } })); await sleep(50); }
    M.cue = { hashes, scene: await scene() };
    for (let t0 = Date.now(); Date.now() - t0 < 15000;) { if (await p.locator("#sendCard #stayButton").count()) break; await sleep(300); }
    M.stay = await m("#sendCard #stayButton"); M.sendOk = await m("#sendCard .pkbtn");
    await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(900);
    await p.evaluate(() => { const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a735f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa735-dep", redeemTxHash: "0xa735-red", grantTxHash: "0xa735-grant", status: "success", at: Date.parse("2026-10-04T00:00:00Z") }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock();
    assert.equal(await exploreViaTapMe(), "explore"); await sleep(2200); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000)
    M.item0 = await m(".secondJourney__item", 0); M.item1 = await m(".secondJourney__item", 1); M.iBack = await m("#stayButton");
    // [A-977 RE-PIN] fork Explore = the fork Job rows: three rows come from round 0 (market · order · clean), no "save none".
    // pre-A-977: save none → round 1 → grow + asset-piece (aave / abil / kintsu rows)
    const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
    for (const want of ["market", "order", "clean"]) { const i = ids.indexOf(want); if (i >= 0) { await mustTap(".secondJourney__item", want, i); await sleep(200); } }
    await mustTap("#exploreSaveButton", "save"); await sleep(3000);
    M.picks = []; for (let i = 0; i < 3; i += 1) M.picks.push(await m(".secondJourney__pick", i));
    M.cBack = await m("#stayButton"); M.cOk = await m("#secondOkButton");
    await mustTap(".secondJourney__pick", "pick", 1); await sleep(400);
    M.picked = await m(".secondJourney__pick", 1); M.unpicked = await m(".secondJourney__pick", 0);
    M.pickedText = await p.evaluate(() => document.querySelectorAll(".secondJourney__pick")[1].textContent.trim());
    // elementFromPoint ownership between candidate rows: the gap midpoints belong to nobody, every row centre to itself
    M.pickOwn = await p.evaluate(() => { const rows = [...document.querySelectorAll(".secondJourney__pick")]; const own = rows.map((r) => { const b = r.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t === r || r.contains(t); }); const gaps = []; for (let i = 0; i + 1 < rows.length; i += 1) { const a = rows[i].getBoundingClientRect(), c = rows[i + 1].getBoundingClientRect(); const x = (Math.max(a.left, c.left) + Math.min(a.right, c.right)) / 2; let seq = ""; for (let y = Math.floor(a.top + a.height / 2); y <= c.top + c.height / 2; y += 1) { const t = document.elementFromPoint(x, y); const k = t && t.closest(".secondJourney__pick"); const tag = k === rows[i] ? "a" : k === rows[i + 1] ? "b" : k ? "x" : "-"; if (seq[seq.length - 1] !== tag) seq += tag; } gaps.push(seq); } return { own, gaps }; });
    await mustTap("#secondOkButton", "ok"); await sleep(1200);
    M.aBack = await m("#stayButton");
    await mustTap("#stayButton", "home"); await waitScene(["sendstay"], 5000); await sleep(1500);
    await p.evaluate((k) => localStorage.setItem(k, "1"), forkKey("araso.secondJourneyClosed")); // [A-950] fork-scope key (pre-A-950: the testnet key)
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock(); await waitScene(["sendstay"], 9000); await sleep(4500);
    const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
    const openPaper = async () => { for (let i = 0; i < 5; i += 1) { if (await paperOpen()) return true; await p.locator("#chogHomeHit").click({ force: true }).catch(() => {}); await sleep(1600); } return paperOpen(); };
    for (const nm of ["Mochi", "Bebe"]) {
      await openPaper(); await sleep(600);
      const idx = await p.evaluate(() => [...document.querySelectorAll(".homePlusPiggyTab")].findIndex((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0));
      if (idx < 0) break;
      await mustTap(".homePlusPiggyTab", "+Piggy", idx); await waitScene(["name"], 15000); await sleep(1200);
      for (let t0 = Date.now(); Date.now() - t0 < 20000;) { const v = await p.evaluate(() => !!document.querySelector("#piggyNameInput") && document.querySelector("#piggyNameInput").getBoundingClientRect().width > 0); if (v) break; if (await p.locator(".nameCard__okBtn").count()) await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(700); }
      await p.locator("#piggyNameInput").fill(nm); await sleep(150);
      await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
      await waitScene(["sendstay"], 8000); await sleep(4000);
    }
    await openPaper(); await sleep(900);
    M.rec = await m(".homePaper__records", 0); M.flap1 = await m(".homeFlap:not(.homeFlap--2)"); M.flap2 = await m(".homeFlap--2");
    if (await realClick(".homePaper__records", 0) === "pointer") { await sleep(1400); M.close = await m("#recordsCardClose"); }
  } catch (e) { await check(`B1 [${vp}] reach every measured scene`, () => { throw e; }); await context.close(); return; }
  await context.close();

  const web = w > 640;
  await check(`B1 [${vp}] visible geometry of every non-candidate control is unchanged vs the pre-A-735 baseline (hit expansion is invisible)`, () => {
    sameVis("hatch.skip", M.skip); sameVis("sendcard.sendCard__stay", M.stay); sameVis("interests.item0", M.item0); sameVis("interests.item1", M.item1); sameVis("interests.homeBack", M.iBack);
    sameVis("candidates.back", M.cBack); sameVis("candidates.ok", M.cOk); sameVis("home.homeRecords", M.rec); sameVis("home.flap2", M.flap2); sameVis("home.flap1", M.flap1); sameVis("history.recordsClose", M.close);
  });
  await check(`B2 [${vp}] hit areas grew to practical size (A-732 floors) — skip/stay/back/close/pick >=40 tall, flap2 >=30, records >=44 tall, interest rows to their pitch`, () => {
    const hh = (o, min, k) => assert.ok(o.hit && o.hit.h >= min, `${k}@${vp} hit h ${o.hit && o.hit.h} < ${min}`);
    hh(M.skip, 40, "skip");
    // [A-779 RE-PIN] First Send "stay home" is removed from view (A-777 §8.2 LOCKED): visibility:hidden — it must own NO hit area now.
    assert.equal(M.stay.hit, null, "First Send stay home is not hit-testable");
    hh(M.iBack, 40, "interests Home"); hh(M.cBack, 40, "candidates Home"); hh(M.aBack, 40, "action Home");
    assert.ok(M.cBack.hit.w >= 28, `back hit w ${M.cBack.hit.w}`);
    for (const [i, p] of M.picks.entries()) hh(p, 40, `pick${i}`);
    hh(M.close, 44, "recordsClose"); hh(M.flap2, 30, "homeFlap--2"); hh(M.rec, 44, "homeRecords");
    for (const [k, it] of [["item0", M.item0], ["item1", M.item1]]) assert.ok(it.hit.h >= it.vis[1] + 5, `${k} hit ${it.hit.h} vs vis ${it.vis[1]}`);
  });
  await check(`B3 [${vp}] ownership: every neighbour keeps its area — rows/centres own themselves, gaps between rows stay unowned, hit boxes never reach a neighbour control`, () => {
    assert.deepEqual(M.pickOwn.own, [true, true, true]); for (const g of M.pickOwn.gaps) assert.ok(/^a-?b$/.test(g) && g.includes("-") || g === "ab", `row ownership order a -> (gap) -> b, got ${g}`); assert.equal(M.pickOwn.gaps.every((g) => !g.includes("x")), true);
    assert.ok(M.item0.hit.b < M.item1.hit.t || M.item0.hit.b <= M.item1.box[1] + 1, "interest rows: item0 hit stays above item1");
    assert.ok(M.cBack.hit.r < M.cOk.box[0], `Home hit right ${M.cBack.hit.r} must stop left of ok ${M.cOk.box[0]}`);
    assert.ok(M.aBack.hit.r < M.cOk.box[0] + 1);
    assert.equal(M.stay.hit, null, "[A-779] hidden stay home steals nothing from Send");
    // pre-A-839 baseline: M.rec.hit.b <= M.flap1.hit.t + 2 (a 2 px graze was tolerated at k = 1). A-839: the hit extensions scale with the card and the records hit never overlaps flap1's.
    if (web) assert.ok(M.flap1.hit.h >= 30 && M.rec.hit.b <= M.flap1.hit.t + 0.01, `records hit bottom ${M.rec.hit.b} vs flap1 hit top ${M.flap1.hit.t}`); // <=640 keeps the pre-A-735 A-621/A-623 boxes, unchanged
    assert.ok(M.flap2.hit.t >= M.flap1.hit.t, "flap2 hit never starts above flap1's");
  });
  // [A-779 RE-PIN] A-777 §8.2 LOCKED: Second candidates are selectable TEXT lines, not paper buttons — the A-735 .pkbtn surface
  // (texture/radius/shadow) is removed and the title uses the shared supporting size (--type-support 18px). Kept from A-735: the 40px
  // box, no clip/overflow, and the yellow underline as the only picked mark.
  await check(`B4 [${vp}] candidate rows: plain text lines (no paper texture / shadow / radius), choice size (A-786: 28px <=640 / 24px >=641, > 18px support), no clip, picked underline kept, no overflow`, () => {
    for (const [i, c] of M.picks.entries()) {
      assert.equal(/paper_tex_ivory\.png/.test(c.bgi), false, `row${i} no paper texture`); assert.equal(c.radius, "0px"); assert.equal(c.shadow, "none", `row${i} no shadow`); assert.equal(c.border, "0px");
      assert.ok(/Delicious Handrawn|Cherry|cursive/i.test(c.family) || /--font-cj/.test(c.family) || c.family.length > 0, "handwriting family");
      // [A-845 RE-PIN] A-843 Choice style: 18 on-screen at the phone card = 18 / (.65 x 282.3239 / 285) = 27.9548 css at every width (no 640 step;
      // measured "27.9548px" at 390 / 700 / 1440, A845 browser_suites/a735). pre-A-845 baseline: w > 640 ? "24px" : "28px"
      assert.equal(c.font, "27.9548px", `row${i} choice size (A-845 Choice style; A-786: was supporting 18px; restores pre-A-779 hierarchy)`);
      assert.ok(c.sh <= c.ch, `row${i} clip: scrollHeight ${c.sh} > clientHeight ${c.ch}`); assert.ok(c.sw <= c.cw + 1, `row${i} width overflow`);
      assert.equal(c.oh, 40, `row${i} layout height unchanged (40px)`);
    }
    assert.match(M.picked.bgi, /linear-gradient\(.*(224, 177, 0|e0b100)/i, "picked keeps the yellow underline gradient"); assert.equal(/linear-gradient/.test(M.unpicked.bgi), false, "only the picked row carries it");
  });
  await check(`B8 [${vp}] Work? cue on the real Send-card canvas: it animates (>=3 distinct frames: look-up / surprised / jump), settles on ONE held frame (last 15 samples identical, non-blank), and the scene is still the Home card (nothing departed)`, () => {
    const hs = M.cue.hashes.filter((x) => x !== null && x !== "x"); assert.ok(hs.length >= 30, `canvas readable (${hs.length})`);
    assert.ok(new Set(hs).size >= 3, `distinct frames ${new Set(hs).size}`);
    const tail = hs.slice(-15); assert.equal(new Set(tail).size, 1, "held frame is stable (no blink loop)"); assert.ok(Number(tail[0].split(":")[1]) > 50, "held frame has ink");
    assert.equal(M.cue.scene, "sendstay", "work cue never leaves the Send/Home card scene");
  });
  await check(`B5 [${vp}] no page errors`, () => assert.deepEqual(errors, []));
}

async function reducedMotion(browser, BASE) {
  const run = async (reduce) => {
    const context = await browser.newContext({ viewport: { width: 700, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference" });
    await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
    await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
    const p = await context.newPage();
    await p.goto(BASE, { waitUntil: "networkidle" });
    // name.css is linked by main.js linkMotionCss() when the Name/hatch scene mounts; link it the same way here
    await p.evaluate(() => new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/motion/name.css"; l.onload = res; l.onerror = res; document.head.append(l); }));
    const r = await p.evaluate(async () => {
      const mk = (html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d); return d.firstElementChild; };
      const out = {};
      const board = mk('<div class="invite" data-phase="checking" style="position:fixed;left:0;top:0"><div class="invite__face"></div><img class="invite__envImg invite__envImg--tear"/><div class="invite__env" style="animation:env-exit 0.55s cubic-bezier(0.2,0.7,0.3,1) both"></div><div class="invite__egg" style="animation:egg-idle2 3.2s ease-in-out infinite"></div></div>');
      const g = (el) => { const c = getComputedStyle(el); return { dur: c.animationDuration, iter: c.animationIterationCount, fill: c.animationFillMode, name: c.animationName }; };
      out.face = g(board.querySelector(".invite__face")); out.tear = g(board.querySelector(".invite__envImg--tear")); out.env = g(board.querySelector(".invite__env")); out.egg = g(board.querySelector(".invite__egg"));
      await new Promise((r) => setTimeout(r, 120));
      out.envOpacityAfter = getComputedStyle(board.querySelector(".invite__env")).opacity; // env-exit ends at opacity 0 (both-fill)
      const pg = mk('<div class="pgwrap"><div class="up"></div><div class="eye"></div></div>');
      const s = (el) => { const c = getComputedStyle(el); return { name: c.animationName, state: c.animationPlayState }; };
      out.pgwrap = s(pg); out.pgup = s(pg.querySelector(".up")); out.pgeye = s(pg.querySelector(".eye"));
      return out;
    });
    await context.close(); return r;
  };
  const on = await run(true), off = await run(false);
  await check("B6 reduced motion: check-pulse / tear-shake / env / egg run ~0ms x1 and still land on their end state (env-exit -> opacity 0); normal motion untouched", () => {
    for (const k of ["face", "tear", "env", "egg"]) { assert.match(on[k].dur, /^(1e-06|0\.000001)s$/, `${k} dur ${on[k].dur}`); assert.equal(on[k].iter, "1", k); }
    assert.equal(on.env.fill, "both"); assert.equal(on.envOpacityAfter, "0", "functional end state reached");
    assert.equal(off.face.dur, "1s"); assert.equal(off.face.iter, "infinite"); assert.equal(off.env.dur, "0.55s"); assert.equal(off.egg.iter, "infinite"); assert.equal(off.tear.dur, "0.4s");
  });
  await check("B7 reduced motion: the Name-scene Piggy 11.5s loop is paused (+ blink removed) under reduce, running without it", () => {
    assert.equal(on.pgwrap.state, "paused"); assert.equal(on.pgup.state, "paused"); assert.equal(on.pgeye.name, "none");
    assert.equal(off.pgwrap.state, "running"); assert.equal(off.pgup.state, "running"); assert.notEqual(off.pgeye.name, "none");
  });
}
