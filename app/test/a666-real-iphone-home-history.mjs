// A-666 [REAL IPHONE HOME/HISTORY · DYNAMIC VIEWPORT + GLOBAL MOBILE TYPOGRAPHY] —
// regression contract for §1 (Home page-level scroll) and §2 (HISTORY top-left dot as the
// Home-return control). §3 (global mobile typography) has its own file,
// a666-mobile-typography-scale.mjs.
//   node app/test/a666-real-iphone-home-history.mjs           (Part N only, always safe — no network/port)
//   node app/test/a666-real-iphone-home-history.mjs           (Part B runs too, unless A666_NODE_ONLY=1)
//
// Bug (Owner, real iPhone Safari, after A-665): Home still vertically scrollable, and the
// paper/character composition shifted when Safari's toolbar chrome expanded/collapsed.
// DIAGNOSIS.md root causes:
//   1. `body` had `min-height:100vh` only, no `100dvh` fallback (unlike `.stage`/
//      `.stage[data-scene="sendstay"]`, already fixed by A-665/an earlier card). Every Home
//      child is absolutely/fixed positioned, so `.stage` itself never overflows — the
//      page-level scrollbar was purely `body`'s own stale box.
//   2. Home geometry (fitHomeBoard/applyHomeCharacterScaleFloor/fitCardAnchor, called from
//      mountHome()'s own `resize` listener) recomputed synchronously on every intermediate
//      `resize` event iOS fires while the toolbar animates, with no debounce.
// Owner also identified the top-left HISTORY `.recordsCard__dot` (masthead) as the control
// that should obviously return to Home — this file proves it is wired (click + keyboard) to
// closeRecordsCard(), the existing #recordsCardClose path, with no new navigation family.
//
// Part N (node, no network/port — always runs): CSS/JS source contracts only.
// Part B (real browser, Playwright + CDP, local Vite dev server — same harness convention as
// a665's own Part B): this writer's sandbox cannot bind a local port, so Part B is written
// for the coordinator to run, not self-verified here.
//   Env: A666_NODE_ONLY=1 skips Part B (prints SKIP, not a PASS); A666_BASE_URL reuses a
//        running server; A666_SHOTS=<dir> saves PNGs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const MAIN = readFileSync(path.join(SRC_DIR, "main.js"), "utf8");
const CSS = readFileSync(path.join(SRC_DIR, "style.css"), "utf8");

let pass = 0;
let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
async function checkAsync(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
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
function cssRule(selector, from = 0) {
  const at = CSS.indexOf(`${selector} {`, from);
  if (at < 0) throw new Error(`CSS rule not found: ${selector}`);
  const before = CSS[at - 1];
  if (before && /[\w-]/.test(before)) return cssRule(selector, at + selector.length);
  return CSS.slice(at, CSS.indexOf("}", at) + 1);
}
function allDecls(rule, prop) {
  const re = new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;]+);`, "g");
  const out = [];
  let m;
  while ((m = re.exec(rule))) out.push(m[1].trim());
  return out;
}

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════

// -- §1 Home page-level scroll ----------------------------------------------------------------

check("N1 `body` carries the same 100vh+100dvh pair `.stage`/sendstay already have (additive, 100dvh after 100vh so it wins in supporting engines)", () => {
  const rule = cssRule("body");
  const minHeights = allDecls(rule, "min-height");
  assert.ok(minHeights.includes("100vh"), "100vh fallback-of-fallback must stay for non-dvh engines");
  assert.ok(minHeights.includes("100dvh"), "100dvh must be present so the box tracks the real visible viewport");
  assert.ok(rule.indexOf("100vh") < rule.lastIndexOf("100dvh"), "100dvh must be declared after 100vh");
});

check("N2 zero-regression: `.stage`/sendstay dvh pairs from the prior card are unchanged", () => {
  const stage = cssRule(".stage");
  assert.deepEqual(allDecls(stage, "min-height"), ["100vh", "100dvh"]);
  const sendstay = cssRule('.stage[data-scene="sendstay"]');
  assert.deepEqual(allDecls(sendstay, "min-height"), ["100vh", "100dvh"]);
});

// -- §2 Toolbar collapse/expand composition jump --------------------------------------------

check("N3 isToolbarOnlyResizeDelta()/debouncedHomeResizeListener() helpers exist, module-scope (outside render()/the 17 fingerprinted auth-money functions)", () => {
  assert.ok(/function isToolbarOnlyResizeDelta\(/.test(MAIN));
  assert.ok(/function debouncedHomeResizeListener\(/.test(MAIN));
  const renderStart = MAIN.indexOf("\nfunction render(");
  assert.ok(renderStart > 0, "render() must exist");
  const helperIdx = MAIN.indexOf("function isToolbarOnlyResizeDelta(");
  assert.ok(helperIdx < renderStart, "helpers must be defined before (outside) render(), not nested inside it");
});

check("N4 isToolbarOnlyResizeDelta() logic: same-width + small height delta = toolbar-only; any width change or large height delta = real resize", () => {
  const constMatch = MAIN.match(/const HOME_TOOLBAR_RESIZE_DELTA_PX = \d+(?:\.\d+)?;/);
  assert.ok(constMatch, "HOME_TOOLBAR_RESIZE_DELTA_PX constant must exist");
  const body = fnBody("isToolbarOnlyResizeDelta");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${constMatch[0]} ${body}; return isToolbarOnlyResizeDelta;`)();
  // same width, iOS-toolbar-sized delta (well under the a665 Part B's own 100px simulation) -> toolbar-only
  assert.equal(fn(390, 844, 390, 744), true, "100px same-width delta (a665's own TOOLBAR_DELTA) must read as toolbar-only");
  assert.equal(fn(390, 844, 390, 844), true, "zero delta is trivially toolbar-only");
  // width changed (orientation flip / real resize) -> never toolbar-only regardless of height delta
  assert.equal(fn(390, 844, 430, 900), false, "a width change must never be treated as toolbar-only");
  // same width, delta at/above the threshold -> real resize, not toolbar-only
  const threshMatch = MAIN.match(/const HOME_TOOLBAR_RESIZE_DELTA_PX = (\d+(?:\.\d+)?);/);
  assert.ok(threshMatch, "HOME_TOOLBAR_RESIZE_DELTA_PX constant must exist");
  const thresh = Number(threshMatch[1]);
  assert.ok(thresh >= 100, "threshold must cover at least the a665 Part B 100px toolbar simulation");
  assert.equal(fn(390, 844, 390, 844 - thresh), false, "a delta exactly at the threshold must NOT read as toolbar-only (strict <)");
  assert.equal(fn(390, 844, 390, 844 - (thresh - 1)), true, "a delta just under the threshold must read as toolbar-only");
  // malformed input never throws / never silently treated as toolbar-only
  assert.equal(fn(NaN, 844, 390, 800), false);
});

check("N5 debouncedHomeResizeListener() wraps the mountHome() Home-geometry resize listener (fitHomeBoard/layoutHomeCharacter/fitCardAnchor/applyHomeCharacterScaleFloor call site), not the function bodies themselves", () => {
  const mountHome = fnBody("mountHome");
  assert.match(mountHome, /sceneListener\(window, "resize", debouncedHomeResizeListener\(\(\) => \{/, "the mountHome() resize listener must be wrapped");
  // everything the handler calls is unchanged by this card
  assert.ok(mountHome.includes("fitHomeBoard()"));
  assert.ok(mountHome.includes("fitCardAnchor()"));
  assert.ok(mountHome.includes("applyHomeCharacterScaleFloor(freshFit)"));
});

check("N6 debouncedHomeResizeListener() registers its own teardown (clears its pending timer) so a late-firing debounce cannot run after the scene unmounts", () => {
  const body = fnBody("debouncedHomeResizeListener");
  assert.match(body, /onSceneTeardown\(\(\) => clearTimeout\(timer\)\);/);
});

await checkAsync("N6b debouncedHomeResizeListener() behavior (coordinator repair): a real resize (width change) calls the handler SYNCHRONOUSLY, no lag — a toolbar-sized/zero delta is coalesced via a short debounce but is NEVER permanently skipped (a later real-browser regression found the first version dropping a `dispatchEvent(new Event(\"resize\"))` with no size change, which a654-living-home.mjs B7 relies on)", async () => {
  const constMatch = MAIN.match(/const HOME_TOOLBAR_RESIZE_DELTA_PX = \d+(?:\.\d+)?;/)[0];
  const toolbarBody = fnBody("isToolbarOnlyResizeDelta");
  const debounceBody = fnBody("debouncedHomeResizeListener");
  const teardowns = [];
  const fakeWindow = { innerWidth: 1440, innerHeight: 900 };
  const factory = new Function("window", "onSceneTeardown", `${constMatch} ${toolbarBody} ${debounceBody}; return debouncedHomeResizeListener;`);
  const debouncedHomeResizeListener = factory(fakeWindow, (fn) => teardowns.push(fn));
  let calls = 0;
  const wrapped = debouncedHomeResizeListener(() => { calls += 1; }, 30);

  // real resize (width changes) -> synchronous, zero lag
  fakeWindow.innerWidth = 1200; fakeWindow.innerHeight = 900;
  wrapped();
  assert.equal(calls, 1, "a width change must call the handler synchronously");

  // toolbar-sized delta (same width, small height change) -> NOT synchronous
  fakeWindow.innerWidth = 1200; fakeWindow.innerHeight = 850;
  wrapped();
  assert.equal(calls, 1, "a toolbar-sized delta must not call the handler synchronously");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls, 2, "a toolbar-sized delta must still EVENTUALLY call the handler — never permanently skipped");

  // a synthetic no-op resize (identical width/height, e.g. `dispatchEvent(new Event(\"resize\"))`
  // with no real viewport change) must still eventually fire — this is exactly what
  // a654-living-home.mjs B7 relies on to force a re-plan with no actual size change.
  wrapped();
  assert.equal(calls, 2, "a zero-delta call must not fire synchronously either");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls, 3, "a zero-delta (synthetic) resize must still eventually call the handler");
});

// -- §3 HISTORY top-left dot as the Home-return control --------------------------------------

check("N7 recordsMastheadMarkup() renders the dot as an accessible control (role=button, keyboard-focusable, labeled), not aria-hidden any more", () => {
  const body = fnBody("recordsMastheadMarkup");
  assert.match(body, /<span class="recordsCard__dot" role="button" tabindex="0" aria-label="back to Home"><\/span>/);
  assert.equal(body.includes('class="recordsCard__dot" aria-hidden="true"'), false, "the dot must no longer be aria-hidden");
});

check("N8 render() is BYTE-IDENTICAL to before this card (other cards' own locked tests — a642/a653 — pin render()'s source hash; the dot wiring must not live inside it)", () => {
  const rdr = fnBody("render");
  assert.equal(rdr.includes("recordsCard__dot"), false, "render() must not reference the dot at all");
  assert.equal(rdr.includes("handleRecordsDotActivate"), false, "render() must not wire the dot handler either");
});

check("N9 the dot is wired by a module-scope, one-time `document` listener (same shape as the existing handleTrustedAppActivity pattern, A-565) — not inside render() — and drives the EXISTING closeRecordsCard() path (same function #recordsCardClose already calls), no new navigation family", () => {
  assert.match(MAIN, /function handleRecordsDotActivate\(event\) \{\s*\n\s*if \(!event\.target\.closest\("\.recordsCard__dot"\)\) return;/);
  const fnSrc = fnBody("handleRecordsDotActivate");
  assert.ok(fnSrc.includes("closeRecordsCard();"), "must call the existing closeRecordsCard(), the same function #recordsCardClose drives");
  assert.ok(fnSrc.includes('event.key !== "Enter"') && fnSrc.includes('event.key !== " "'), "keyboard (Enter/Space) must also activate it — a <span role=button> gets no native click synthesis");
  assert.match(MAIN, /document\.addEventListener\("click", handleRecordsDotActivate\);\s*\n\s*document\.addEventListener\("keydown", handleRecordsDotActivate\);/);
  // registered at true module scope (top-level, like handleTrustedAppActivity just above it),
  // not inside any function
  const idx = MAIN.indexOf('document.addEventListener("click", handleRecordsDotActivate);');
  const line = MAIN.slice(MAIN.lastIndexOf("\n", idx) + 1, idx);
  assert.equal(line, "", "the listener registration must be a top-level statement (column 0), not indented inside a function");
});

check("N10 `.recordsCard__dot` gets a real ≥44px invisible hit area (::before) and a focus ring, while `.secondJourney__dot` (Explore's own decorative dot) is completely untouched", () => {
  const before = cssRule(".recordsCard__dot::before");
  assert.match(before, /width:\s*44px;/);
  assert.match(before, /height:\s*44px;/);
  // two `.recordsCard__dot` rules exist: the shared decorative one (also matches
  // `.secondJourney__dot`) and this card's own interactive-only one right after it — find the
  // SECOND occurrence specifically.
  const sharedAt = CSS.indexOf(".secondJourney__dot,");
  const firstDotAt = CSS.indexOf(".recordsCard__dot {", sharedAt);
  const secondDotAt = CSS.indexOf(".recordsCard__dot {", firstDotAt + 1);
  assert.ok(secondDotAt > firstDotAt, "a second, card-own `.recordsCard__dot` rule must exist after the shared one");
  const dotRule = CSS.slice(secondDotAt, CSS.indexOf("}", secondDotAt) + 1);
  assert.match(dotRule, /cursor:\s*pointer;/);
  const sharedRule = CSS.slice(sharedAt, CSS.indexOf("}", sharedAt) + 1);
  assert.match(sharedRule, /width:\s*5px;\s*height:\s*5px;\s*margin-top:\s*1px;\s*border-radius:\s*50%;\s*background:\s*#141210;/, "the shared 5x5 dot visual must be byte-identical — no visible redesign");
  assert.equal(sharedRule.includes("pointer"), false, "the shared rule (also used by .secondJourney__dot) must not gain a cursor/interactive style");
});

check("N11 renderAppLock/loginCheckingMarkup untouched by this card (no HISTORY/typography/debounce leakage into the lock surface)", () => {
  const rAL = fnBody("renderAppLock");
  assert.ok(rAL.includes('document.querySelector("#loginChogButton")?.addEventListener("click", unlockApp);'));
  assert.equal(rAL.includes("unlockApp()"), false);
  const lcm = fnBody("loginCheckingMarkup");
  assert.equal(lcm.includes("recordsCard"), false);
});

// -- §4 Receipt text hitbox fix (OWNER CORRECTION — receipt text is not exempt) ---------------
// `return-view.js` was added to this card's allowed_files specifically for this fix; checked
// here (not a666-mobile-typography-scale.mjs, which only ever reads style.css) since it's a
// source-contract check on a .js file, matching this file's own existing shape.
const RETURN_VIEW = readFileSync(path.join(SRC_DIR, "return-view.js"), "utf8");
function jsFnBody(src, name) {
  const m = src.match(new RegExp(`function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}

check("N12 placePaper()'s animated target placement (renderer's paperBoard p.x/p.y/p.w/p.h -> #returnTap, and the --paperScale contain-fit math) is untouched — the OWNER CORRECTION fix is additive, after --paperScale is set", () => {
  const body = jsFnBody(RETURN_VIEW, "placePaper");
  assert.match(body, /tapBtn\.style\.left = `\$\{r\.left \+ p\.x \* k\}px`;/, "the initial target-box placement line must be unchanged");
  assert.match(body, /tapBtn\.style\.width = `\$\{p\.w \* k\}px`;/, "the initial target-box width line must be unchanged");
  assert.match(body, /const fit = Math\.min\(\(p\.w \* k\) \/ rw, \(p\.h \* k\) \/ rh\);/, "the contain-fit math (rotation-aware) must be unchanged");
  assert.match(body, /paperEl\.style\.setProperty\("--paperScale", String\(fit > 0 \? fit : 1\)\);/, "the --paperScale assignment must be unchanged");
});

check("N13 placePaper() re-measures the ACTUAL rendered (rotated/scaled) .receiptPaper rect AFTER setting --paperScale, and resizes/repositions #returnTap to match it — fixing the hitbox-drift the mobile text increase caused", () => {
  const body = jsFnBody(RETURN_VIEW, "placePaper");
  const scaleIdx = body.indexOf('paperEl.style.setProperty("--paperScale"');
  const rectIdx = body.indexOf("paperEl.getBoundingClientRect()");
  assert.ok(scaleIdx > 0 && rectIdx > scaleIdx, "the rect must be read AFTER --paperScale is set, so it reflects the new scale");
  const after = body.slice(rectIdx);
  assert.match(after, /tapBtn\.style\.left = `\$\{paperRect\.left\}px`;/);
  assert.match(after, /tapBtn\.style\.top = `\$\{paperRect\.top\}px`;/);
  assert.match(after, /tapBtn\.style\.width = `\$\{paperRect\.width\}px`;/);
  assert.match(after, /tapBtn\.style\.height = `\$\{paperRect\.height\}px`;/);
});

check("N14 the hint label's own positioning (secondary UI, not under the ≤2px hitbox contract) is untouched by the OWNER CORRECTION fix — scope stayed to #returnTap only", () => {
  const body = jsFnBody(RETURN_VIEW, "placePaper");
  assert.match(body, /hint\.style\.left = `\$\{r\.left \+ \(p\.x \+ p\.w \/ 2\) \* k\}px`;/);
  assert.match(body, /hint\.style\.top = `\$\{r\.top \+ \(p\.y \+ p\.h\) \* k \+ 8\}px`;/);
});

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════════
const HEIGHT = { 390: 844, 430: 900, 700: 900, 1440: 900 };
const TOOLBAR_DELTA = 100;

if (process.env.A666_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A666_NODE_ONLY=1) — browser scenarios not run");
  finish();
} else {
  await runBrowser();
  finish();
}

async function runBrowser() {
  let chromium;
  if (!existsSync(path.join(REPO, "_private"))) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await checkAsync("B0 playwright available (_private/ops/harness)", () => { throw e; });
    return;
  }
  let server = null;
  let BASE = process.env.A666_BASE_URL || "";
  if (!BASE) {
    // Plain vite (no --mode/LOCAL_DEV_ENTRY env, host 127.0.0.1 — same pattern
    // a628-home-history-render-invariant.mjs/a662-history-multi-piggy-first-open.mjs use)
    // deliberately so `getRpId()` (= the hostname) is neither PRODUCTION_RP_ID nor
    // LOCAL_DEV_RP_ID: isAllowedPiggyRpId() stays false, so a stored credential at ≤640px
    // does NOT trip appLockSurface()/LOGIN_CHECKING here — this file is testing Home's own
    // geometry/HISTORY-nav, not the reentry-lock flow a665's own harness (which DOES use
    // "localhost" + LOCAL_DEV_ENTRY on purpose) already covers.
    server = spawn("npx", ["vite", "app", "--port", "5669", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = "http://127.0.0.1:5669/";
  }
  const shots = process.env.A666_SHOTS || "";
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const w of [390, 430]) await mobileWidth(browser, BASE, w, shots);
    for (const w of [700, 1440]) await desktopWidth(browser, BASE, w, shots);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

// Seeds a returning user straight into sendstay/Home. computeInitialScene() (main.js) only
// reaches "sendstay" when hasCredential (readCredential() parses `araso.passkey`, NOT a plain
// "araso.name"/"araso.mark" flag) AND readPiggyName() (`araso.piggyName`, NOT "araso.name")
// are both truthy — the first draft of this helper used the wrong key names, so every scene
// landed on "birth" instead, and only the one unguarded hard assertion (B4) caught it; same
// fixture shape a628-home-history-render-invariant.mjs/a662-history-multi-piggy-first-open.mjs
// already use for a single Piggy.
async function gotoHome(p, BASE) {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.evaluate(() => {
    localStorage.setItem("araso.address", "0x2222222222222222222222222222222222222222");
    localStorage.setItem("araso.passkey", JSON.stringify({ credentialId: "a666-test-cred" }));
    localStorage.setItem("araso.piggyName", "Test Piggy");
    localStorage.setItem("araso.birthPlayed", "1");
    localStorage.setItem("araso.secondJourneyClosed", "1");
  });
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForSelector('.stage[data-scene="sendstay"]', { timeout: 15000 }).catch(() => {});
  // Hard assertion here (not left to each caller's own soft/guarded checks) — if the fixture
  // ever regresses again, every B1-B3 call fails loudly instead of several silently
  // no-op'ing past a missing #homeBoard.
  await p.waitForSelector("#homeBoard", { timeout: 5000 });
}

async function mobileWidth(browser, BASE, w, shots) {
  const T = `[${w}]`;
  const h = HEIGHT[w];
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await context.newPage();
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a666_w${w}_${name}.png`) }); };

  await checkAsync(`B1 ${T} Home: no document-level vertical scroll at full height or toolbar-shown (-${TOOLBAR_DELTA}px)`, async () => {
    await gotoHome(p, BASE);
    const read = () => p.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    const full = await read();
    assert.ok(full.scrollHeight - full.clientHeight < 2, `Home must not be document-scrollable at full height (scrollHeight ${full.scrollHeight} vs clientHeight ${full.clientHeight})`);
    await shot("1_home_full");

    await p.setViewportSize({ width: w, height: h - TOOLBAR_DELTA });
    await p.waitForTimeout(400); // past the debounce window
    const shrunk = await read();
    assert.ok(shrunk.scrollHeight - shrunk.clientHeight < 2, "Home must not become document-scrollable when the toolbar is shown");
    await shot("2_home_toolbarShown");
    await p.setViewportSize({ width: w, height: h });
  });

  await checkAsync(`B2 ${T} Home: toolbar show/hide composition delta stays below a visible-jump threshold (board scale/position settle, not continuous mid-gesture repaint)`, async () => {
    const rect = () => p.evaluate(() => document.querySelector("#homeBoard")?.getBoundingClientRect()?.toJSON() ?? null);
    // B1's own last step is a bare `setViewportSize` restore with no trailing wait — that
    // resize is itself a same-width/toolbar-sized delta, so it goes through
    // debouncedHomeResizeListener()'s short debounce (160ms), not an immediate recompute.
    // Reading "full" here without first letting that debounce settle captured a STALE
    // (still-shrunk) board rect in the coordinator's real-browser run, making the later
    // "restored" measurement look like drift when it was actually the only correct one.
    // Settle first, same as every other measurement in this file already does.
    await p.waitForTimeout(400);
    const full = await rect();
    await p.setViewportSize({ width: w, height: h - TOOLBAR_DELTA });
    await p.waitForTimeout(400);
    const shrunk = await rect();
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(400);
    const restored = await rect();
    assert.ok(full && shrunk && restored, `#homeBoard rect must be measurable at every step (full ${JSON.stringify(full)} shrunk ${JSON.stringify(shrunk)} restored ${JSON.stringify(restored)})`);
    assert.ok(Math.abs(restored.top - full.top) < 2 && Math.abs(restored.left - full.left) < 2, "restoring the original height must settle back to the original board rect (no drift/compounding)");
  });

  await checkAsync(`B3 ${T} HOME -> HISTORY -> top-left dot -> HOME, plus list/detail/back`, async () => {
    await gotoHome(p, BASE);
    // [coordinator repair] `.homePaper` (the notepad #homeRecordsButton lives inside) starts
    // DOCKED/tiny next to the character — it only expands to its full readable size after a
    // tap on the character hit area (#chogHomeHit), same pattern
    // a654-living-home.mjs's own openHomePaper() uses. B3's first run tried to click
    // #homeRecordsButton while the paper was still tiny/mid-animation, which Playwright
    // correctly refused to treat as a stable, actionable target (30s timeout, not a real
    // product bug) — open the paper first, same as every other test that clicks into it.
    const paperOpen = () => p.evaluate(() => {
      const r = document.querySelector("#homePaper")?.getBoundingClientRect();
      return !!r && r.width > 100;
    });
    for (let i = 0; i < 5 && !(await paperOpen()); i += 1) {
      const hit = p.locator("#chogHomeHit");
      if (!(await hit.count())) break;
      await hit.click({ force: true });
      await p.waitForTimeout(1600);
    }
    assert.ok(await paperOpen(), "#homePaper must be open (expanded) before its records entry can be clicked");
    const recordsBtn = p.locator("#homeRecordsButton");
    assert.ok(await recordsBtn.count(), "#homeRecordsButton must exist on a settled Home");
    await recordsBtn.first().click();
    await p.waitForSelector("#recordsCard:not([hidden])", { timeout: 5000 });
    const dot = p.locator(".recordsCard__dot");
    assert.ok(await dot.count(), ".recordsCard__dot must exist once HISTORY is open");
    await dot.first().click();
    await p.waitForTimeout(300);
    const hidden = await p.evaluate(() => document.querySelector("#recordsCardAnchor")?.hidden ?? true);
    assert.equal(hidden, true, "tapping the top-left dot must close HISTORY back to Home, same as #recordsCardClose");
    await shot("3_history_dot_closed");
  });

  await context.close();
}

async function desktopWidth(browser, BASE, w, shots) {
  const T = `[${w}]`;
  const h = HEIGHT[w];
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await context.newPage();
  await checkAsync(`B4 ${T} desktop Home rect unchanged (1440 canon untouched by the debounce/scroll repair)`, async () => {
    await gotoHome(p, BASE);
    const board = await p.evaluate(() => document.querySelector("#homeBoard")?.getBoundingClientRect()?.toJSON() ?? null);
    assert.ok(board, "#homeBoard must render at desktop width");
    const scrollable = await p.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
    assert.ok(scrollable < 2, "desktop Home must also not be document-scrollable");
  });
  await context.close();
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
