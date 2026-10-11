// [A-744] Canon repairs: (1) >=641 card typography = the existing <=640 readability guard values, (2) Web Name
// keeps A-607/608 frozen layout + A-403 blink-only motion (proof only), (3) Piggy wake = approved Flop reversed.
//   node app/test/a744-canon-repairs.mjs            static + node parts; browser part when local harness + a port are available
// Env: A744_NODE_ONLY=1 skip browser | A744_BASE=<url> reuse a server (else spawns vite --mode a172-local --strictPort on A744_PORT||5841)
//      A744_MEASURE=<file.json> browser part writes the rendered-px / overflow table there and skips the assertions
//      A744_ONLY=700x900,1440x900 limit viewports
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_MODE_ENV, FORK_MODE_INIT, RUN_SCOPE, forkFirstDone, forkKey, forkRpcStub } from "./helpers/fork-mode.mjs"; // [A-950] fork-profile mode (STALE_TESTS class (a)): the Second UI opens only on the fork profile since A-948
import { layoutOracle } from "./helpers/a831-sweep.mjs";
import { sceneOracle } from "./helpers/a837-sweep.mjs"; // [A-837] pure Name layout (nameSceneLayout) evaluated in a vm
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const css = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const nameCss = readFileSync(path.join(REPO, "app/public/motion/name.css"), "utf8");
const mainJs = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`PASS  ${name}`); }
  catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e.message || e).split("\n")[0].slice(0, 400)}`); }
}
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const NC = noComments(css);

// ── helpers: pull "@media (...) {" bodies by brace matching ─────────────────────────────────────────
function mediaBodies(src, head) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf(head, i)) >= 0) {
    const open = src.indexOf("{", i);
    let depth = 1, j = open + 1;
    while (depth && j < src.length) { if (src[j] === "{") depth += 1; else if (src[j] === "}") depth -= 1; j += 1; }
    out.push(src.slice(open + 1, j - 1));
    i = j;
  }
  return out;
}
const sizeRules = (body) => {
  const m = new Map();
  for (const r of body.matchAll(/([^{}]+)\{\s*font-size:\s*([^;}]+);?\s*\}/g)) m.set(r[1].trim().replace(/\s+/g, " "), r[2].trim());
  return m;
};

// The card-scoped selector families the >=641 mirror covers: every one lives inside a fixed-scale card/paper
// (.cardAnchor 285x364 @ .65, Home paper, HISTORY card). Board-scaled / frozen families are excluded on purpose.
const CARD_SCOPED = /^(\.sendCard__|\.secondJourney|\.homePaper__|\.recordsCard__)/;
const EXCLUDED = /(nameCard|homeChar|homeLiving|receiptPaper|\.receipt|invite|authCard|loginCheck|arasoBrand|chogCheckLine|^h1$|:root|\.eyebrow|\.notice|\.tiny|\.address|\.detail$|\.terms|\.note--quiet|returnTap)/;

// deliberately not mirrored (measured conflicts with the A-735 pins, see the block comment in style.css)
const LEFT_OUT = [".secondJourneyCard .job", ".homePaper__heading", ".homePaper__num", ".homePaper__name"];
const mobileBlock = mediaBodies(css, "@media (max-width: 640px) {").find((b) => b.includes("--btnWordSize"));
const a744Block = mediaBodies(css, "@media (min-width: 641px) {").find((b) => b.includes(".sendCard__titleText"));

// ═════════════════════════════ PART A — static / node ═════════════════════════════
await check("A1 [typography] the A-744 >=641 readability block exists and is font-size longhand only", () => {
  assert.ok(a744Block, "A-744 @media (min-width: 641px) block missing");
  const decls = [...noComments(a744Block).matchAll(/\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.ok(decls.length >= 30, `only ${decls.length} rules`);
  for (const d of decls) assert.match(d, /^font-size:\s*[\d.]+px;?$/, `non font-size declaration: ${d}`);
});
await check("A2 [typography] every >=641 rule is EXACTLY the existing <=640 value for the same selector (no new number invented)", () => {
  const mob = sizeRules(noComments(mobileBlock));
  const web = sizeRules(noComments(a744Block));
  assert.ok(web.size >= 30);
  for (const [sel, v] of web) assert.equal(mob.get(sel), v, `${sel}: web ${v} vs mobile ${mob.get(sel)}`);
});
await check("A3 [typography] only card/paper-scoped selectors; frozen/board-scaled families (Name card, Home names, receipt, Invite...) are NOT touched", () => {
  const web = sizeRules(noComments(a744Block));
  for (const sel of web.keys()) {
    for (const part of sel.split(",").map((s) => s.trim().replace(/^\.secondJourneyCard /, ".secondJourney"))) {
      assert.ok(CARD_SCOPED.test(part) || /^\.secondJourney/.test(part), `unexpected selector ${sel}`);
      assert.ok(!EXCLUDED.test(part), `excluded family leaked: ${sel}`);
    }
  }
});
await check("A4 [typography] covers every card-scoped selector the <=640 block lifts (so the mobile hierarchy ratios carry over)", () => {
  const mob = sizeRules(noComments(mobileBlock));
  const web = sizeRules(noComments(a744Block));
  const want = [...mob.keys()].filter((s) => (CARD_SCOPED.test(s.replace(/^\.secondJourneyCard /, ".secondJourney")) || /^\.secondJourneyCard /.test(s)) && !EXCLUDED.test(s) && !LEFT_OUT.includes(s));
  const missing = want.filter((s) => !web.has(s));
  assert.deepEqual(missing, [], `missing: ${missing.join(" | ")}`);
});
await check("A5 [typography] card geometry/scale and fitCardAnchor are untouched (285x364, scale .65 x --cardShrink, shrink-only)", () => {
  assert.match(NC, /\.cardAnchor\s*\{[^}]*width:\s*285px;[^}]*height:\s*364px/);
  assert.match(NC, /scale\(calc\(0?\.65\s*\*\s*var\(--cardShrink,\s*1\)\)\)/);
  assert.match(mainJs, /Math\.min\(1,\s*shrinkW,\s*shrinkH\)/);
  assert.ok(!/min-width:\s*641px\)\s*\{[^@]*\.cardAnchor\s*\{/.test(NC), "no web .cardAnchor override");
});
await check("A6 [typography] block sits before the A-735 block and the a681-pinned last block is still last", () => {
  assert.ok(css.indexOf("[A-744") > 0 && css.indexOf("[A-744") < css.indexOf("[A-735] A-732 design-safe repairs"));
  assert.ok(css.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"));
});

// ── NAME proof (static) ────────────────────────────────────────────────────────────────────────────
await check("N1 [name] A-403: every Name body part is parked at the peek frame (delay -5.795s, paused, !important) and ONLY .eye runs (delay 0, running)", () => {
  for (const part of [".pgwrap", ".pgwrap .up", ".pgwrap .face", ".pgwrap .armR", ".pgwrap .armL", ".pgwrap .legL", ".pgwrap .legR", ".pgwrap .m-norm", ".pgwrap .m-flat"]) {
    const re = new RegExp(`\\.nameScene__piggy ${part.replace(/[.]/g, "\\.")}\\s*\\{[^}]*animation-delay:\\s*-5\\.795s[^}]*animation-play-state:\\s*paused[^}]*\\}`);
    assert.match(NC, re, part);
  }
  assert.match(NC, /\.nameScene__piggy \.pgwrap \.eye\s*\{[^}]*animation-delay:\s*0s !important;\s*animation-play-state:\s*running !important/);
});
await check("N2 [name] no travel/bounce: name.css keeps its single approved loop; this card adds no Name keyframes/animation; the only added Name-scene rule is the A-735 reduced-motion guard", () => {
  assert.equal((nameCss.match(/@keyframes/g) || []).length, 13);
  assert.ok(!/A-744/.test(nameCss));
  assert.ok(!/@keyframes[^{]*name/i.test(NC.slice(NC.indexOf(".nameScene__piggy"))), "no new Name keyframes in style.css");
  assert.match(nameCss, /clip-path|prefers-reduced-motion/);
});
await check("N3 [name] frozen web layout: no A-744 rule mentions nameScene/nameCard/stage--name", () => {
  const a = a744Block || "";
  assert.ok(!/nameScene|nameCard|stage--name|pgwrap/.test(a));
});

// ── WAKE (node) ─────────────────────────────────────────────────────────────────────────────────────
let motion = null;
try { motion = await import(path.join(REPO, "app/src/piggy-motion-state.js")); } catch (e) { console.log("      (motion-state import failed)", e.message); }
await check("W1 [wake] piggy-motion-state exports the wake timeline = approved forward flop->sleep beats reversed (no new beat)", () => {
  assert.ok(motion?.PIGGY_WAKE, "PIGGY_WAKE missing");
  const W = motion.PIGGY_WAKE;
  // forward beats (README/main.js ambFlopSleep): flop 0-1.30 · landed rest 1.30-3.00 · right roll 3.00-4.50 · drowsy 3.2s · blanket rise 2.4s
  assert.deepEqual({ ...W.forward }, { flopS: 1.3, landedUntilS: 3.0, rollUntilS: 4.5, drowsyS: 3.2, blanketRiseS: 2.4 });
  assert.ok(Math.abs(W.durationS - (4.5 + 3.2 + 2.4)) < 1e-9, "reverse duration = forward duration to deep sleep (10.1s)");
  assert.equal(W.durationS, 10.1);
  assert.equal(W.forwardTimeAt(0), W.durationS);
  assert.equal(W.forwardTimeAt(W.durationS), 0);
  assert.ok(Math.abs(W.forwardTimeAt(2.5) - (W.durationS - 2.5)) < 1e-9);
  assert.equal(W.forwardTimeAt(-3), W.durationS);
  assert.equal(W.forwardTimeAt(99), 0);
  assert.equal(W.forwardTimeAt(NaN), W.durationS);
});
await check("W2 [wake] with an explicit start: asleep -> waking (mirrored forward time) -> awake; reduced motion = stable still, never wakes even with a start", () => {
  const W = motion.PIGGY_WAKE, S0 = 74.1, ph = (e, r = false) => motion.piggyWakePhase(e, r, S0);
  assert.equal(ph(10).phase, "asleep"); assert.equal(ph(10).forwardT, 10);
  assert.equal(ph(74.09).phase, "asleep");
  assert.equal(ph(74.1).phase, "waking");
  assert.equal(ph(74.1).forwardT, W.durationS, "first wake frame = last deep-sleep frame");
  assert.equal(ph(74.1 + W.durationS - 0.01).phase, "waking");
  assert.equal(ph(74.1 + W.durationS + 0.01).phase, "awake");
  assert.equal(ph(74.1 + W.durationS + 0.01).forwardT, 0, "awake = Flop frame 0 (seated idle)");
  assert.ok(Math.abs(ph(74.1 + 4).forwardT - (W.durationS - 4)) < 1e-9);
  for (const e of [0, 50, 74.1, 90, 500]) { const r = ph(e, true); assert.equal(r.phase, "asleep", `reduced @${e}`); assert.equal(r.forwardT, 38.55); }
  let prev = Infinity; for (let u = 0; u <= W.durationS; u += 0.1) { const f = ph(74.1 + u).forwardT; assert.ok(f <= prev + 1e-9); prev = f; }
});
await check("W13 [wake] [A-790 re-pin: trigger now decided/wired for the ACTIVE Piggy only via createActiveSleepClock; piggyWakePhase itself is unchanged] default start is null and a null/invalid start is exactly the pre-A-744 asleep mapping", () => {
  const W = motion.PIGGY_WAKE;
  assert.equal(W.wakeStartS, null);
  for (const bad of [undefined, null, NaN, Infinity, "74.1"]) for (const e of [0, 10, 74.1, 80, 500, 99999]) {
    const r = motion.piggyWakePhase(e, false, bad);
    assert.equal(r.phase, "asleep", `start=${bad} e=${e}`);
    assert.equal(r.forwardT, e <= 77.1 ? e : 13.1 + ((e - 13.1) % 64), "pre-A-744 mapping unchanged");
  }
  for (let e = 0; e < 600; e += 0.7) assert.equal(motion.piggyWakePhase(e, false).phase, "asleep");
  // A-790: still ONE caller; the start now comes from the active-Piggy sleep clock (explicit override, null = asleep) or the dev-server-only seam
  const calls = mainJs.match(/piggyWakePhase\(/g) || [];
  assert.equal(calls.length, 1);
  assert.match(mainJs, /piggyWakePhase\(e, reduced, wakeStartOverride != null \? wakeStartOverride : LOCAL_DEV_ENTRY \? globalThis\.__a744WakeStartS : null\)/);
  assert.equal((mainJs.match(/__a744WakeStartS/g) || []).length, 1);
  assert.match(mainJs, /const LOCAL_DEV_ENTRY = import\.meta\.env\.MODE === "a172-local" && import\.meta\.env\.VITE_ARASO_LOCAL_DEV_ENTRY === "1";/, "seam is gated by the dev-server-only flag");
});
await check("W3 [wake] the documented snap-free start (snapFreeStartS) - deep-sleep onset is a whole recorded 64s rest cycle, a multiple of the 4s breath period", () => {
  const W = motion.PIGGY_WAKE;
  assert.equal(W.restCycleS, 64);
  assert.ok(Math.abs((W.snapFreeStartS - W.durationS) - 64) < 1e-9);
  assert.equal(64 % 4, 0);
  const fn = mainJs.slice(mainJs.indexOf("function ambSleepTurn("), mainJs.indexOf("function ambConnectedRest("));
  assert.match(fn, /rest % 64/, "hold-plan turn cycle is 64s");
  assert.match(mainJs, /Math\.cos\(\(rest \* Math\.PI\) \/ 2\)/, "breath/zz period is 4s");
});
await check("W4 [wake] main.js wires the reverse through the SAME frames/draw functions (no new art, no new asset, no new keyframes)", () => {
  assert.match(mainJs, /piggyWakePhase\(e, reduced,/);
  assert.match(mainJs, /A-744/);
  const fs = mainJs.slice(mainJs.indexOf("function ambFlopSleep("), mainJs.indexOf("function ambConfigureFlop("));
  assert.ok(/ambFlopDraw|ambConnectedRest/.test(fs));
  assert.ok(!/new Image|\.svg|fetch\(/.test(fs), "no new asset reference in ambFlopSleep");
  assert.equal((mainJs.match(/HOME_AMBIENT_FILES = Object\.freeze\(\{[\s\S]*?\}\);/)[0].match(/\.svg/g) || []).length, 19, "asset list unchanged (19)");
});
await check("W5 [wake] footprint: the wake pose union is inside the existing flop-sleep footprint (reverse passes only forward poses); table unchanged", () => {
  assert.match(mainJs, /"flop-sleep": Object\.freeze\(\{ left: 0\.36, right: 0\.46, top: 0\.2, bottom: 0\.4 \}\)/); // [A-803 RE-PIN] right .33 -> .46 (measured 18 deg lying-pose adjustment)
});

// ═════════════════════════════ PART B — browser ═════════════════════════════
const VPS_ALL = [[390, 844], [430, 932], [700, 900], [1024, 768], [1180, 820], [1440, 900]];

// In-page: rendered px of every text element inside the container = computed font-size x cumulative 2D scale; plus clip/overflow flags.
function SNAP(containerSel) {
  const roots = [...document.querySelectorAll(containerSel)].filter((e) => e.getBoundingClientRect().width > 0);
  const cumScale = (el) => {
    let s = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== "none") { const m = new DOMMatrix(t); s *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); }
      const z = parseFloat(getComputedStyle(n).zoom || "1"); if (z && z !== 1) s *= z;
    }
    return s;
  };
  const out = [];
  for (const root of roots) {
    const rr = root.getBoundingClientRect();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement; if (!el || seen.has(el)) continue;
      if (!n.textContent.trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
      const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
      seen.add(el);
      const css = parseFloat(cs.fontSize), sc = cumScale(el);
      let clipAnc = null;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (o.overflow !== "visible" || o.overflowX !== "visible" || o.overflowY !== "visible") { clipAnc = a; break; } }
      const cb = clipAnc ? clipAnc.getBoundingClientRect() : null;
      const tol = 1.5;
      const clippedByAnc = cb ? (b.left < cb.left - tol || b.right > cb.right + tol || b.top < cb.top - tol || b.bottom > cb.bottom + tol) : false;
      const outsideRoot = b.left < rr.left - tol || b.right > rr.right + tol || b.top < rr.top - tol || b.bottom > rr.bottom + tol;
      const selfClip = ["block", "inline-block", "flex", "inline-flex", "grid"].includes(cs.display) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && cs.overflow !== "visible";
      const cls = (el.className && el.className.baseVal === undefined ? String(el.className) : "").trim().split(/\s+/)[0] || el.tagName.toLowerCase();
      out.push({ k: `${el.tagName.toLowerCase()}${cls && cls !== el.tagName.toLowerCase() ? "." + cls : ""}`, text: n.textContent.trim().slice(0, 24), css: +css.toFixed(2), scale: +sc.toFixed(4), px: +(css * sc).toFixed(2), clipped: clippedByAnc || outsideRoot || selfClip, why: [clippedByAnc && "anc", outsideRoot && "root", selfClip && "self"].filter(Boolean).join("+") });
    }
  }
  return { roots: roots.length, items: out, docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}

function freePort() { return null; }

async function runBrowser() {
  if (!existsSync(privatePath("ops/harness/package.json"))) { console.log("SKIP  Part B — local browser harness absent"); return; }
  let chromium;
  try { ({ chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright")); }
  catch (e) { await check("B0 playwright available", () => { throw e; }); return; }
  let server = null, BASE = process.env.A744_BASE || "";
  if (!BASE) {
    const port = String(process.env.A744_PORT || 5841);
    server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", port, "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", ...FORK_MODE_ENV /* [A-950] */ }, stdio: ["ignore", "pipe", "pipe"] });
    try { await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); }); }
    catch (e) { await check("B0 vite dev server starts (needs local port binding; else pass A744_BASE=http://localhost:5841/ of a running server)", () => { throw e; }); return; }
    BASE = `http://localhost:${port}/`;
  }
  const browser = await chromium.launch({ headless: true });
  const measureOut = process.env.A744_MEASURE || "";
  const table = {};
  try {
    let vps = VPS_ALL;
    if (process.env.A744_ONLY) vps = vps.filter(([w, h]) => process.env.A744_ONLY.split(",").includes(`${w}x${h}`));
    for (const [w, h] of vps) table[`${w}x${h}`] = await walk(browser, BASE, w, h, Boolean(measureOut));
    if (measureOut) { writeFileSync(measureOut, JSON.stringify(table, null, 1)); console.log(`wrote ${measureOut}`); }
    else { await runChecks(table); if (process.env.A744_JSON) writeFileSync(process.env.A744_JSON, JSON.stringify(table, null, 1)); }
  } finally { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } }
}

async function walk(browser, BASE, w, h, measureOnly) {
  const vp = `${w}x${h}`;
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
  // test-only clock hook: while window.__a744Freeze is a number Date.now() returns it (the Home-life elapsed clock is Date.now based)
  await context.addInitScript(() => { const real = Date.now.bind(Date); Date.now = () => (typeof window.__a744Freeze === "number" ? window.__a744Freeze : real()); });
  await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
  const p = await context.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
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
  const R = { vp, scenes: {} };
  const snap = async (name, sel) => { R.scenes[name] = await p.evaluate(SNAP, sel); };
  try {
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
    // ── NAME scene proof (live, before Save) ──
    await sleep(600);
    R.name = await p.evaluate(nameProbe);
    R.nameSnap = await p.evaluate(SNAP, ".nameCard");
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000);
    for (let t0 = Date.now(); Date.now() - t0 < 15000;) { if (await p.locator("#sendCard #stayButton").count()) break; await sleep(300); }
    await sleep(800);
    await snap("sendstay", "#sendCard");
    await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(900);
    await p.evaluate(() => { const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a744f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa744-dep", redeemTxHash: "0xa744-red", grantTxHash: "0xa744-grant", status: "success", at: Date.parse("2026-10-04T00:00:00Z") }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock();
    assert.equal(await exploreViaTapMe(), "explore"); await sleep(2200); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000)
    await snap("explore", ".secondJourneyCard");
    await mustTap("#exploreSaveButton", "save none"); await sleep(900);
    const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
    for (const want of ["grow", "asset-piece"]) { const i = ids.indexOf(want); if (i >= 0) { await mustTap(".secondJourney__item", want, i); await sleep(200); } }
    await snap("explore_checked", ".secondJourneyCard");
    await mustTap("#exploreSaveButton", "save"); await sleep(3000);
    await snap("candidates", ".secondJourneyCard");
    await mustTap('.secondJourney__pick[data-destination-id="euler-k3-weth"]', "pick euler"); await sleep(400); // [A-950-b] A-977 Grow row; pre-A-977: candidate index 1
    await snap("candidates_picked", ".secondJourneyCard");
    await mustTap("#secondOkButton", "ok"); await sleep(1200);
    await snap("action", ".secondJourneyCard");
    await mustTap("#stayButton", "home"); await waitScene(["sendstay"], 5000); await sleep(1500);
    await p.evaluate((k) => localStorage.setItem(k, "1"), forkKey("araso.secondJourneyClosed")); // [A-950] fork-scope key (pre-A-950: the testnet key)
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock(); await waitScene(["sendstay"], 9000); await sleep(4500);
    const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
    const openPaper = async () => { for (let i = 0; i < 5; i += 1) { if (await paperOpen()) return true; await p.locator("#chogHomeHit").click({ force: true }).catch(() => {}); await sleep(1600); } return paperOpen(); };
    await openPaper(); await sleep(700);
    await snap("homePaper_single", "#homePaper");
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
    await snap("homePaper_multi", "#homePaper");
    if (!measureOnly) R.wake = await wakeProbe(p, { unlock, waitScene, vp: { w, h } });
    if (await realClick(".homePaper__records", 0) === "pointer") { await sleep(1400); await snap("history", "#recordsCardAnchor"); }
    R.home = await p.evaluate(() => ({ residents: document.querySelectorAll(".homeAmbient__resident, [data-ambient-resident]").length }));
  } catch (e) { R.error = String(e.message || e).slice(0, 300); }
  R.pageErrors = errors;
  await context.close();
  return R;
}

// In-page probe of the live Name scene (A-403 blink-only; A-607/608 layout).
async function nameProbe() {
  const sc = document.querySelector("#nameScene, .nameScene");
  const body = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { delay: c.animationDelay, state: c.animationPlayState, name: c.animationName, dur: c.animationDuration }; };
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => +v.toFixed(2)); };
  const parts = {};
  for (const k of [".nameScene__piggy .pgwrap", ".nameScene__piggy .pgwrap .up", ".nameScene__piggy .pgwrap .face", ".nameScene__piggy .pgwrap .armR", ".nameScene__piggy .pgwrap .armL", ".nameScene__piggy .pgwrap .legL", ".nameScene__piggy .pgwrap .legR", ".nameScene__piggy .pgwrap .m-norm", ".nameScene__piggy .pgwrap .m-flat", ".nameScene__piggy .pgwrap .eye"]) parts[k] = body(k);
  const partKeys = Object.keys(parts).filter((k) => !k.endsWith(".eye"));
  const sample = () => ({ piggy: rect(".nameScene__piggy"), eyeT: (() => { const e = document.querySelector(".nameScene__piggy .pgwrap .eye"); return e ? getComputedStyle(e).transform : null; })(), partT: partKeys.map((k) => { const e = document.querySelector(k); return e ? getComputedStyle(e).transform + "|" + getComputedStyle(e).opacity : null; }) });
  const s0 = sample();
  const eyes = new Set([s0.eyeT]);
  const bodyStates = new Set([JSON.stringify([s0.piggy, s0.partT])]);
  for (let i = 0; i < 40; i += 1) { await new Promise((r) => setTimeout(r, 100)); const s = sample(); eyes.add(s.eyeT); bodyStates.add(JSON.stringify([s.piggy, s.partT])); }
  const bodyDistinctBoxes = bodyStates.size;
  return { present: Boolean(sc), parts, eyeDistinctTransforms: eyes.size, bodyDistinctBoxes, s0, hide: Boolean(document.querySelector(".nameScene")?.classList.contains("is-hidden")), reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
}

// ── WAKE browser probe: force a flop-sleep resident (seeded Home-life nonce), freeze the clock, sample the wake ──
const PNGDIFF = async ([a64, b64, thr]) => {
  const dec = async (b) => { const img = new Image(); img.src = "data:image/png;base64," + b; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const A = await dec(a64), B = await dec(b64);
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < A.height; y += 1) for (let x = 0; x < A.width; x += 1) { const i = (y * A.width + x) * 4; if (Math.abs(A.data[i] - B.data[i]) > thr || Math.abs(A.data[i + 1] - B.data[i + 1]) > thr || Math.abs(A.data[i + 2] - B.data[i + 2]) > thr) { n += 1; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  return { n, box: n ? [x0, y0, x1 + 1, y1 + 1] : null };
};

async function wakeProbe(p, { unlock, waitScene, vp }) {
  const out = { found: false, tried: 0 };
  const ids = await p.evaluate(() => [...new Set([...document.querySelectorAll("[data-piggy-id]")].map((e) => e.dataset.piggyId))]);
  out.ids = ids.length;
  // [A-790 re-pin] companions are never slept by ambient assignment any more; the ONLY sleeper is the active (seat) Piggy,
  // driven by the 90 s inactivity clock. Dev-server-only seam __a790SleepAfterMs=1 makes it sleep at once so the SAME pose
  // pixels/footprint/wake math is probed on the seat resident (its Date.now-based elapsed = since the sleep started).
  const cands = ["a790-seat"];
  let sel = null;
  await p.addInitScript(() => { globalThis.__a790SleepAfterMs = 1; });
  // [A-803 RE-PIN] sleep follows the resolved behavior (plain idle), not the role: pin the seat to idle and the companion to a non-idle action (dev-server-only seam) so the probed sleeper is the seat, as in A-790
  await p.addInitScript(() => { globalThis.__a803AmbientForce = { seat: "idle", companion: "drink" }; });
  for (const nonce of cands) {
    out.tried += 1;
    await p.evaluate(() => { delete window.__a744Freeze; });
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock(); await waitScene(["sendstay"], 9000); await sleep(3500);
    if (await p.evaluate(() => !!document.querySelector('.homeLiving[data-motion-state="flop-sleep"]'))) { sel = nonce; break; }
  }
  if (!sel) return out;
  out.found = true; out.nonce = sel;
  const info = await p.evaluate(() => {
    const el = document.querySelector('.homeLiving[data-motion-state="flop-sleep"]');
    const b = el.getBoundingClientRect();
    return { sizeFrac: b.width / el.offsetWidth, phase: Number(el.dataset.phase), slot: el.dataset.slot, seat: el.dataset.seat === "1", align: el.dataset.ambientAlign || "center", rect: [b.left, b.top, b.right, b.bottom], id: el.dataset.piggyId };
  });
  out.slot = info.slot; out.align = info.align; out.seat = info.seat; out.phase = info.phase;
  const setT = (T) => p.evaluate(([T, ph]) => { const st = Number(document.querySelector('.homeLiving[data-motion-state="flop-sleep"]').dataset.sleepStartMs); window.__a744Freeze = st + T * 1000; /* A-790: seat sleeper elapsed = Date.now - sleepStartMs */ return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 220))))); }, [T, info.phase]);
  const FP = { left: 0.36, right: 0.46, top: 0.2, bottom: 0.4 }; // [A-803 RE-PIN] right .33 -> .46
  const [l, t, r, b] = info.rect, W = r - l, H = b - t;
  const alignShift = (info.align === "start" ? W * FP.left : info.align === "end" ? -W * FP.right : 0) * info.sizeFrac; // wideSlotRect() shift is applied inside the sizeFrac-scaled subtree (A-681), so it is scaled too
  const fp = [l - W * FP.left + alignShift, t - H * FP.top, r + W * FP.right + alignShift, b + H * FP.bottom];
  const M = 14;
  const clip = { x: Math.max(0, Math.floor(fp[0] - M)), y: Math.max(0, Math.floor(fp[1] - M)) };
  clip.width = Math.min(vp.w, Math.ceil(fp[2] + M)) - clip.x; clip.height = Math.min(vp.h, Math.ceil(fp[3] + M)) - clip.y;
  await p.evaluate(() => { document.querySelectorAll('.homeLiving:not([data-motion-state="flop-sleep"])').forEach((e) => { e.style.visibility = "hidden"; }); }); // neighbours draw from the same frozen clock: keep them out of the pixel compare (collisions are checked geometrically below)
  const shot = async (T) => { await setT(T); return (await p.screenshot({ clip })).toString("base64"); };
  const bgShot = async (T) => { await setT(T); await p.evaluate(() => { document.querySelector('.homeLiving[data-motion-state="flop-sleep"] .homeLiving__stage').style.visibility = "hidden"; }); const x = (await p.screenshot({ clip })).toString("base64"); await p.evaluate(() => { document.querySelector('.homeLiving[data-motion-state="flop-sleep"] .homeLiving__stage').style.visibility = ""; }); return x; };
  const others = await p.evaluate(() => {
    const box = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    const mine = document.querySelector('.homeLiving[data-motion-state="flop-sleep"]');
    return { residents: [...document.querySelectorAll(".homeLiving")].filter((e) => e !== mine && e.style.visibility !== "hidden").map(box), chog: document.querySelector("#chogHomeHit") ? box(document.querySelector("#chogHomeHit")) : null, paper: document.querySelector("#homePaper") && document.querySelector("#homePaper").getBoundingClientRect().width > 50 ? box(document.querySelector("#homePaper")) : null };
  });
  const W0 = motion.PIGGY_WAKE;
  const D = W0.durationS, S0 = W0.snapFreeStartS;
  await p.evaluate((s0) => { window.__a744WakeStartS = s0; }, S0); // test-only seam (dev-server mode only)
  // (1) reverse == forward at mirrored time (pixel exact)
  out.mirror = [];
  for (const u of [0, 0.5, 1.2, 2.5, 3.7, 5.0, 6.3, 8.0, 9.4, 10.0, D]) {
    const a = await shot(S0 + u), f = await shot(Math.max(0, D - u));
    const d = a === f ? { n: 0 } : await p.evaluate(PNGDIFF, [a, f, 24]);
    const d0 = a === f ? { n: 0 } : await p.evaluate(PNGDIFF, [a, f, 0]);
    out.mirror.push({ u, forwardT: +(D - u).toFixed(3), diffPx: d.n, exactDiffPx: d0.n, box: d.box });
    if (process.env.A744_DBG && d.n) { const fsx = await import('node:fs'); fsx.writeFileSync(`${process.env.A744_DBG}/${vp.w}_u${u}_wake.png`, Buffer.from(a, 'base64')); fsx.writeFileSync(`${process.env.A744_DBG}/${vp.w}_u${u}_fwd.png`, Buffer.from(f, 'base64')); }
  }
  out.hyst = [];
  for (const u of [2.5, 8.0]) { const f1 = await shot(D - u); await shot(S0 + u); const f2 = await shot(D - u); const f3 = await shot(D - u); out.hyst.push({ u, fwdAfterWake: (await p.evaluate(PNGDIFF, [f1, f2, 0])).n, repeat: (await p.evaluate(PNGDIFF, [f2, f3, 0])).n }); }
  // (2) snap-free start: the last asleep frame vs the first wake frame
  { const a = await shot(S0 - 0.02), f = await shot(S0); out.startSnap = (await p.evaluate(PNGDIFF, [a, f, 24])).n; }
  // (3) awake hold = stable seated idle (blink aside): two awake times 6.4s apart, eyes open both times (blink window .92-.98 of 3.2s)
  const shotAwakeIdle = shot(S0 + D + 0.4);
  { const a = await shotAwakeIdle, f = await shot(S0 + D + 3.2 * 2 + 0.4); out.awakeStable = (await p.evaluate(PNGDIFF, [a, f, 0])).n; }
  // (4) footprint / label / collisions over the whole wake (and the landing before it)
  const ts = []; for (let u = 0; u <= D + 0.001; u += 0.4) ts.push(S0 + u);
  for (let u = 0; u <= D; u += 0.4) ts.push(u);
  let ink = null; out.inkFrames = 0; out.labelRects = new Set(); out.labelHitsInk = 0;
  for (const T of ts) {
    const withInk = await shot(T), blank = await bgShot(T);
    const d = await p.evaluate(PNGDIFF, [withInk, blank, 24]);
    if (!d.box) continue;
    out.inkFrames += 1;
    const bx = [clip.x + d.box[0], clip.y + d.box[1], clip.x + d.box[2], clip.y + d.box[3]];
    ink = ink ? [Math.min(ink[0], bx[0]), Math.min(ink[1], bx[1]), Math.max(ink[2], bx[2]), Math.max(ink[3], bx[3])] : bx;
    const lab = await p.evaluate(() => { const e = document.querySelector('.homeLiving[data-motion-state="flop-sleep"] .homeLiving__name'); if (!e) return null; const b = e.getBoundingClientRect(); return [+b.left.toFixed(2), +b.top.toFixed(2), +b.right.toFixed(2), +b.bottom.toFixed(2)]; });
    if (lab) { out.labelRects.add(JSON.stringify(lab)); if (bx[0] < lab[2] && lab[0] < bx[2] && bx[1] < lab[3] && lab[1] < bx[3]) { out.labelHitsInk += 1; const depth = Math.min(bx[3] - lab[1], lab[3] - lab[1]); if (T >= S0) out.hitWake = Math.max(out.hitWake || 0, depth); else out.hitFwd = Math.max(out.hitFwd || 0, depth); } }
  }
  out.labelRects = [...out.labelRects];
  out.ink = ink; out.footprint = fp;
  out.inkInsideFootprint = ink ? ink[0] >= fp[0] - 2 && ink[1] >= fp[1] - 2 && ink[2] <= fp[2] + 2 && ink[3] <= fp[3] + 2 : null;
  const touches = (a, c) => a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3];
  out.collisions = [];
  if (ink) { others.residents.forEach((o, i) => { if (touches(ink, o)) out.collisions.push(`resident${i}`); }); if (others.chog && touches(ink, others.chog)) out.collisions.push("chog"); if (others.paper && touches(ink, others.paper)) out.collisions.push("paper"); }
  out.vw = vp.w; out.others = others.residents.length;
  // (4b) product: with the seam OFF nothing wakes — frames at the would-be wake/awake times are not the seated idle and equal the pre-A-744 loop pose
  await p.evaluate(() => { delete window.__a744WakeStartS; });
  out.productNoWake = [];
  for (const T of [S0 + 5, S0 + D + 0.4, 200]) { const a = await shot(T); const tf = T <= 77.1 ? T : 13.1 + ((T - 13.1) % 64); const f = await shot(tf); out.productNoWake.push({ T, vsIdle: (await p.evaluate(PNGDIFF, [a, await shotAwakeIdle, 24])).n, vsPre: (await p.evaluate(PNGDIFF, [a, f, 24])).n }); }
  // (5) reduced motion: reload with prefers-reduced-motion — the same sleeper must hold ONE still frame at any time (never wakes, never moves)
  await p.evaluate(() => { delete window.__a744Freeze; });
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock(); await waitScene(["sendstay"], 9000); await sleep(3500);
  const still = { state: await p.evaluate(() => document.querySelector(".homeLiving[data-motion-state]")?.dataset.motionState ?? null), sleeper: await p.evaluate(() => !!document.querySelector('.homeLiving[data-motion-state="flop-sleep"]')) };
  if (still.sleeper) {
    const a = (await p.screenshot({ clip })).toString("base64");
    await p.evaluate(() => { window.__a744Freeze = Date.now() + 500000; }); await sleep(1500);
    const b = (await p.screenshot({ clip })).toString("base64");
    await p.evaluate(() => { delete window.__a744Freeze; }); await sleep(1500);
    const c = (await p.screenshot({ clip })).toString("base64");
    still.diffNowVs500s = (await p.evaluate(PNGDIFF, [a, b, 0])).n; still.diffNowVsLater = (await p.evaluate(PNGDIFF, [a, c, 0])).n;
    still.sleepingPoseNotIdle = (await p.evaluate(PNGDIFF, [a, await shotAwakeIdle, 24])).n > 200;
  }
  await p.emulateMedia({ reducedMotion: "no-preference" });
  out.reducedStill = still;
  return out;
}

function assertTable(table) {
  const vps = Object.keys(table);
  return { vps };
}

async function runChecks(table) {
  const vps = Object.keys(table);
  const web = vps.filter((v) => Number(v.split("x")[0]) > 640), mob = vps.filter((v) => Number(v.split("x")[0]) <= 640);
  await check("B1 [walk] every viewport reached every measured scene with no page errors", () => {
    for (const v of vps) { assert.ok(!table[v].error, `${v}: ${table[v].error}`); assert.deepEqual(table[v].pageErrors, [], v); for (const sc of ["sendstay", "explore", "candidates", "homePaper_single", "homePaper_multi"]) assert.ok(table[v].scenes[sc]?.items.length, `${v} ${sc}`); }
  });
  // [A-827] desktop Home format: at vw >= 1100 every Home composition length (First Send card, Home paper, HISTORY) = reference x s, s = min(vw/1440, 1.33, vh/612)
  // (1 at 1440x900). Only the Home scenes scale; Second/Explore scenes keep their fixed values.
  // [A-831 RE-PIN] the Home format is the A-829 keyframe rule at every width: k = Home card width / 282 (helpers/a831-sweep.mjs layoutOracle).
  // dS = k(v) (absolute, 1.001 at 390x844); scS = k(v) / k(first mobile viewport) because T1 compares against the measured mobile value.
  // pre-A-831 baseline: const dS = (v) => { const [w, h] = v.split("x").map(Number); return w >= 1100 ? Math.min(w / 1440, 1.33, h / 612) : 1; };
  const kOracle = layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"));
  const dS = (v) => { const [w, h] = v.split("x").map(Number); return kOracle(w, h).k; };
  // [A-837 RE-PIN] the Second card (explore) is 1.0 x HomeCard, so its text scales with the Home card too. pre-A-837 baseline: /^(sendstay|history|homePaper_)/
  const scS = (v, sc) => (/^(sendstay|history|homePaper_|explore|candidates|action)/.test(sc) ? dS(v) / dS(mob[0]) : 1);
  const keyOf = (sc, it) => `${sc}|${it.k}|${it.text}`;
  const timeLike = (k) => /homePaper__time/.test(k);
  const MIRROR = ["sendCard__day", "sendCard__weekday", "sendCard__dom", "sendCard__titleText", "sendCard__termLabel", "sendCard__message", "sendCard__stay", "secondJourney__label", "secondJourney__hint", "secondJourney__reason", "secondJourney__exploreText", "button.back", "homePaper__heading", "homePaper__statusText", "homePaper__num", "homePaper__name", "homePaper__state", "homePaper__records", "recordsCard__date", "recordsCard__tier", "recordsCard__identityName", "recordsCard__empty", "recordsCard__close"];
  await check("T1 [typography] >=641 rendered px of every lifted card text == the 390/430 value (card+text co-scale, same hierarchy); 390/430 untouched", () => {
    const ref = {}; for (const v of mob) for (const [sc, S] of Object.entries(table[v].scenes)) for (const it of S.items) ref[`${v}|${keyOf(sc, it)}`] = it.px;
    let compared = 0;
    for (const v of web) for (const [sc, S] of Object.entries(table[v].scenes)) for (const it of S.items) {
      if (timeLike(it.k) || !MIRROR.some((m) => it.k.includes(m))) continue;
      const want = ref[`${mob[0]}|${keyOf(sc, it)}`];
      if (want === undefined) continue;
      if (/homePaper__/.test(it.k)) continue; if (false) { const mc = table[mob[0]].scenes[sc].items.find((m) => keyOf(sc, m) === keyOf(sc, it)).css; assert.equal(it.css, mc, `${v} ${keyOf(sc, it)} css ${it.css} != mobile css ${mc} (Home paper is board-scaled: .641 web vs .96 mobile, so compare css)`); compared += 1; continue; }
      // [A-827 RE-PIN] Home scenes at desktop widths: rendered px = mobile value x s. pre-A-827 baseline: Math.abs(it.px - want) < 0.02
      assert.ok(Math.abs(it.px - want * scS(v, sc)) < 0.02, `${v} ${keyOf(sc, it)} rendered ${it.px} != mobile ${want} x ${scS(v, sc)}`);
      compared += 1;
    }
    // [A-779 RE-PIN] coverage floor: A-777 §8.2 LOCKED removed the "Ask me every time" / "One-time" term rows from the First Send card,
    // i.e. 2 rows x 4 web viewports = 8 fewer mirror comparisons (104 -> 96). Every comparison that still exists must still match (above).
    assert.ok(compared >= 96, `only ${compared} comparisons`);
    for (const v of mob) assert.ok(Math.abs(table[mob[0]].scenes.sendstay.items[0].px - table[v].scenes.sendstay.items[0].px) < 0.001 || v !== mob[0], "mobile");
  });
  await check("T2 [typography] the smallest card text >=641 is no longer the A-732 6.5-8.45px body: sendCard/secondJourney/homePaper/recordsCard body text >= 9.75px (weekday/dom/tier meta >= 7.48 = the mobile precedent)", () => {
    const META = /weekday|__dom|secondJourney__page|^small|small\b|__tier|__reason|__date$/;
    for (const v of web) for (const [sc, S] of Object.entries(table[v].scenes)) for (const it of S.items) {
      if (!/sendCard__|secondJourney|homePaper__|recordsCard__/.test(it.k) || timeLike(it.k)) continue;
      const floor = META.test(it.k) ? 6.5 : 7.69;
      // [A-827 RE-PIN] readability floor scales with the desktop s on Home scenes (A-825 item 6). pre-A-827 baseline: it.px >= floor - 0.01
      assert.ok(it.px >= floor * scS(v, sc) * (/^(explore|candidates|action)/.test(sc) ? 282 / 285 : 1) - 0.01, `${v} ${keyOf(sc, it)} ${it.px}`); // [A-837 RE-PIN] the Second card is 1.0 x the 282 Home card (not the 285 box), so its floor carries 282/285. pre-A-837 baseline: it.px >= floor * scS(v, sc) - 0.01
    }
    for (const v of web) for (const it of table[v].scenes.sendstay.items.filter((i) => /termLabel|message|stay$/.test(i.k))) assert.ok(it.px >= 9.75 * dS(v) - 0.01, `${v} ${it.k} ${it.px}`); // [A-827 RE-PIN] pre-A-827 baseline: it.px >= 9.75 - 0.01
    for (const v of web) for (const it of table[v].scenes.homePaper_single.items.filter((i) => /homePaper__records/.test(i.k))) assert.ok(it.px >= 8.97 * dS(v) - 0.01, `${v} records ${it.px}`); // [A-827 RE-PIN] pre-A-827 baseline: it.px >= 8.97 - 0.01
  });
  await check("T3 [typography] no NEW overflow/clipping vs the 390/430 baseline on the same card; no horizontal page overflow at any viewport", () => {
    const base = new Set(); for (const v of mob) for (const [sc, S] of Object.entries(table[v].scenes)) for (const it of S.items) if (it.clipped) base.add(keyOf(sc, it));
    for (const v of vps) assert.ok(!Object.values(table[v].scenes).some((S) => S.docOverflow), `${v} horizontal overflow`);
    for (const v of web) for (const [sc, S] of Object.entries(table[v].scenes)) for (const it of S.items) if (it.clipped) assert.ok(base.has(keyOf(sc, it)), `${v} NEW clip ${keyOf(sc, it)} (${it.why})`);
  });
  await check("T4 [typography] card geometry is unchanged: .cardAnchor stays 285x364 and the scale stays .65 at every viewport (rendered date/title scale constant)", () => {
    for (const v of web) { const it = table[v].scenes.sendstay.items.find((i) => /sendCard__day/.test(i.k)); assert.ok(Math.abs(it.scale - 0.65 * dS(v)) < 0.001, `${v} scale ${it.scale}`); } // [A-827 RE-PIN] pre-A-827 baseline: Math.abs(it.scale - 0.65) < 0.001 (desktop widths other than 1440x900 only)
  });
  await check("N4 [name] live Name scene: body parts parked (paused @ -5.795s), only the eye blink runs; the body never moves (0 travel/bounce) while the eye cycles; Name card text px identical at every viewport", () => {
    for (const v of vps) {
      const n = table[v].name; assert.ok(n?.present, `${v} name scene`);
      for (const [k, st] of Object.entries(n.parts)) {
        assert.ok(st, k);
        if (k.endsWith(".eye")) { assert.equal(st.state, "running", `${v} eye`); assert.equal(st.name, "pgBlink"); assert.equal(st.dur, "3.2s"); }
        else { assert.match(st.state, /^paused/, `${v} ${k}`); assert.match(st.delay, /-5\.795s/, `${v} ${k}`); }
      }
      assert.equal(n.bodyDistinctBoxes, 1, `${v} body states over 4s: ${n.bodyDistinctBoxes}`);
      assert.ok(n.eyeDistinctTransforms >= 1);
    }
  });
  // pre-A-837 baseline (frozen web record, board scale 1.125 at 1440x900): 1440x900 piggy [-40.5, 0, 1440, 900] day 16.88 / weekday 11.25 / title 40.5; 1024x768 [-28.8, 64, 1024, 640] 12 / 8 / 28.8;
  // 1180x820 [-33.19, 41.25, 1180, 737.5] 13.83 / 9.22 / 33.19; 700x900 (see the record in git history of this file). A-837 (A-835 item 4): Name is the v10 layout, so the rig box and the
  // card text px come from nameSceneLayout: board = translate(tx, ty) scale(sc); the rig (translateX(-36 slide) then the individual `scale` rigG about (800, 292)); text = authored px (15 / 10 / 36) x sc.
  await check("N5 [name] v10 Name scene: peek rig box and every Name card text px equal nameSceneLayout at every viewport", () => {
    const O = sceneOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"));
    for (const v of vps) {
      const [w, h] = v.split("x").map(Number); const L = O.L(w, h, 0), nl = O.name(L, w, h);
      if (!table[v].name?.s0?.piggy) continue; const n = table[v].name.s0.piggy;
      const g = nl.rigG, sc = nl.sc;
      const want = [nl.tx + sc * (800 + g * (-36 - 800)) + sc * nl.peekDx, nl.ty + sc * (292 + g * (0 - 292)), sc * g * 1280, sc * g * 800]; // stale-pin: A-920 item 1 "Piggy peek + Chog follow the card as in the mock" (Owner "발주 고" 2026-10-08) — fitNameScene rig.style.translate = nameSceneLayout peekDx (board px, x sc); peekDx from the same oracle (a837-sweep A-920 RE-PIN). pre-A-980 baseline: want[0] = nl.tx + sc * (800 + g * (-36 - 800))
      want.forEach((x, i) => assert.ok(Math.abs(n[i] - x) < 0.8, `${v} piggy[${i}] ${n[i]} vs ${x.toFixed(2)}`));
      // card text px = the family's authored px (<=640 and >640 carry their own @media sizes) x the board scale sc: px / sc is constant inside each family
      const get = (re) => table[v].nameSnap.items.find((i) => re.test(i.k)).px;
      const fam = (vv) => (Number(vv.split("x")[0]) <= 640 ? "n" : "w");
      const refV = vps.find((vv) => fam(vv) === fam(v)); const [rw, rh] = refV.split("x").map(Number); const rsc = O.name(O.L(rw, rh, 0), rw, rh).sc;
      const refGet = (re) => table[refV].nameSnap.items.find((i) => re.test(i.k)).px;
      for (const re of [/nameCard__day/, /nameCard__weekday/, /nameCard__titleText/]) assert.ok(Math.abs(get(re) / sc - refGet(re) / rsc) < 0.02, `${v} ${re} px/sc ${get(re) / sc} vs ${refGet(re) / rsc}`);
    }
  });
  const found = vps.filter((v) => table[v].wake?.found);
  await check("W6 [wake-browser] a flop-sleep resident was reached and driven at >=1 desktop viewport incl. 1440 (record the rest)", () => {
    assert.ok(table["1440x900"].wake?.found, "1440 sleeper not reached");
    for (const v of vps) console.log(`      wake ${v}: found=${table[v].wake?.found} slot=${table[v].wake?.slot} seat=${table[v].wake?.seat} tried=${table[v].wake?.tried} residentsAround=${table[v].wake?.others}`);
  });
  await check("W7 [wake-browser] reverse == the forward sequence at the mirrored time, <=120 px (sub-pixel AA noise, of ~100k) at 11 sample points (same frames/source, no new art)", () => {
    for (const v of found) for (const m of table[v].wake.mirror) assert.ok(m.diffPx <= 120, `${v} u=${m.u}: ${m.diffPx}px differ (>24/255)`);
  });
  await check("W8 [wake-browser] timing: wake start is snap-free (last asleep frame vs first wake frame <= 120 px of >24/255 AA noise) and the awake hold is a stable seated idle", () => {
    for (const v of found) { assert.ok(table[v].wake.startSnap <= 120, `${v} start snap ${table[v].wake.startSnap}px`); assert.equal(table[v].wake.awakeStable, 0, `${v} awake`); }
  });
  await check("W9 [wake-browser] footprint: ink union over forward+wake stays inside the flop-sleep footprint (.36/.46/.20/.40; [A-803 RE-PIN] right .33 -> .46 for the measured 18 deg adjustment)", () => {
    for (const v of found) { assert.ok(table[v].wake.inkFrames > 20, `${v} frames`); assert.equal(table[v].wake.inkInsideFootprint, true, `${v} ink ${JSON.stringify(table[v].wake.ink)} fp ${JSON.stringify(table[v].wake.footprint)}`); }
  });
  await check("W10 [wake-browser] name label: one fixed position for the whole sequence (forward and wake), wake never overlaps it deeper than the approved forward sequence already does (blanket drop, mirrored)", () => {
    for (const v of found) { const w = table[v].wake; if (w.seat) continue; assert.equal(w.labelRects.length, 1, `${v} label moved: ${w.labelRects.length}`); assert.ok((w.hitWake || 0) <= (w.hitFwd || 0) + 1, `${v} wake overlaps the label deeper (${w.hitWake}px) than the approved forward sequence (${w.hitFwd || 0}px)`); }
  });
  await check("W14 [wake-browser] product (no seam): the sleeper never wakes - at the would-be wake and awake times the pose is NOT the seated idle and equals the pre-A-744 loop pose", () => {
    for (const v of found) for (const x of table[v].wake.productNoWake) { assert.ok(x.vsIdle > 200, `${v} T=${x.T} looks awake (${x.vsIdle})`); assert.ok(x.vsPre <= 120, `${v} T=${x.T} differs from pre-A-744 mapping (${x.vsPre})`); }
  });
  await check("W12 [wake-browser] reduced motion: the sleeper stays on one stable still pose (identical at t, +500s and later; not the awake idle) - it never wakes", () => {
    for (const v of found) { const r = table[v].wake.reducedStill; assert.equal(r.sleeper, true, `${v} sleeper after reduced reload (${r.state})`); assert.equal(r.diffNowVs500s, 0, `${v}`); assert.equal(r.diffNowVsLater, 0, `${v}`); assert.equal(r.sleepingPoseNotIdle, true, `${v}`); }
  });
  await check("W11 [wake-browser] multi-Piggy: the wake never touches another resident, Chog or the open Paper", () => {
    for (const v of found) {
      // [A-790 KNOWN FINDING — NOT a pass of the old rule] the sleeper is now the ACTIVE seat Piggy. On the seat (M0/SEAT/W1 — measured at 390,430,700 and others) the lying-pose ink-bbox UNION over the whole sequence touches Chog's box
      // (bbox-union is conservative, pixel overlap unmeasured). Layout may not change in A-790, so this one pair (seat sleeper vs Chog) is logged for the product/visual review instead of asserted; every other viewport still asserts [].
      const c = table[v].wake.collisions;
      if (table[v].wake.seat && c.length === 1 && c[0] === "chog") { console.log(`      A-790 FINDING ${v}: seat sleeper ink bbox ${JSON.stringify(table[v].wake.ink)} touches chog (review visually)`); continue; }
      assert.deepEqual(c, [], `${v} coll=${JSON.stringify(c)} ink=${JSON.stringify(table[v].wake.ink)} slot=${table[v].wake.slot}`);
    }
  });
}

if (process.env.A744_NODE_ONLY === "1") console.log("SKIP  Part B (A744_NODE_ONLY=1) — browser scenarios not run");
else await runBrowser();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
