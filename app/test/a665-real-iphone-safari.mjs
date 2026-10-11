// A-665 [REAL IPHONE SAFARI · INVITE STAGE + REENTRY CHECKING REPAIR] — regression contract.
//   node app/test/a665-real-iphone-safari.mjs           (Part N only, always safe — no network/port)
//   node app/test/a665-real-iphone-safari.mjs            (Part B runs too, unless A665_NODE_ONLY=1)
//
// Bug (Owner, real iPhone Safari, 2026-10-01): Invite/Received showed a detached lower black slab
// below the notebook stage, and after refresh LOGIN_CHECKING's Chog tap target was pushed/cropped
// near the bottom of what was actually visible. Root cause (DIAGNOSIS.md):
//   1. The shared `.stage` base rule only had `min-height:100vh` (no `100dvh` fallback), unlike
//      `.stage[data-scene="sendstay"]` / `.stage--hatch,.stage--name`, which already got the same
//      fallback in an earlier card. iOS Safari's `100vh` can exceed the real visible area while the
//      toolbar is shown.
//   2. Coordinator's Chromium measurement (before/result.json) additionally found `.stage--invite`
//      overflowing the *shrunk* viewport by up to 96px even with a `min-height` fix, because
//      `.invite`'s own layout box is a fixed 420×840 and `fitInvite()`'s `transform:scale()` does
//      not change layout size — the grid's implicit row sizes to that 840px content height. Only
//      `.stage--invite` needed an explicit `height` (not just `min-height`) to actually cap it.
//   3. `body { background-attachment:fixed }` is a known-unreliable iOS Safari repaint pattern
//      during dynamic-toolbar resize — a compounding factor, changed to `scroll` (the default).
//
// Part N (node, no network/port — always runs): CSS/JS source contracts for the three changes
// above, confirms no visual-design coordinates were touched (V4 in a642's own test already pins
// the exact LOGIN_CHECKING px values; this file does not re-litigate those, it only confirms the
// box-height/background changes and that tap-to-unlock wiring is untouched), and that the already
// -fixed selectors (sendstay/hatch/name) are unchanged (zero-regression byte check).
//
// Part B (real browser, Playwright + CDP virtual authenticator, local Vite dev server — same
// harness convention as a646-money-placement-ui.mjs Part B): this writer's sandbox cannot bind a
// local port, so Part B is written for the coordinator to run, not self-verified here. It
// reproduces 390x844 and 430x900 with a ±100px height resize (toolbar shown/hidden simulation) and
// asserts: (a) on Invite, `.stage`'s bottom edge tracks the visible bottom (no overflow, no gap);
// (b) on LOGIN_CHECKING (stored credential + reload), #loginChogButton's rect is fully inside
// window.visualViewport; (c) one real click on it drives exactly one navigator.credentials.get
// call; (d) desktop 700/1440 Invite/Home rects are unchanged from the pre-repair baseline captured
// in a665_prep/before/result.json.
//   Env: A665_NODE_ONLY=1 skips Part B (prints SKIP, not a PASS); A665_BASE_URL reuses a running
//        server; A665_SHOTS=<dir> saves PNGs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

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
// First CSS rule block whose selector text (not just a prefix match) exactly equals `selector`.
function cssRule(selector, from = 0) {
  const at = CSS.indexOf(`${selector} {`, from);
  if (at < 0) throw new Error(`CSS rule not found: ${selector}`);
  // guard against matching a longer selector that happens to start the same (e.g. `.stage` vs `.stage--invite`)
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

check("N1 shared base `.stage` rule carries both the 100vh value and a 100dvh fallback (same pattern as sendstay/hatch/name)", () => {
  const rule = cssRule(".stage");
  const minHeights = allDecls(rule, "min-height");
  assert.ok(minHeights.includes("100vh"), "100vh fallback-of-fallback must stay for non-dvh engines");
  assert.ok(minHeights.includes("100dvh"), "100dvh must be present so the box tracks the real visible viewport");
  // the 100dvh declaration must come after 100vh so it wins in supporting engines (cascade order)
  assert.ok(rule.indexOf("100vh") < rule.lastIndexOf("100dvh"), "100dvh must be declared after 100vh");
});

check("N2 `.stage--invite` does NOT rely on min-height alone — it has an explicit height cap (100vh/100dvh) so a fixed-size child (the 420x840 invite board) cannot force the box taller than the real viewport", () => {
  const rule = cssRule(".stage--invite");
  const heights = allDecls(rule, "height");
  assert.ok(heights.includes("100vh"), "explicit height fallback must stay for non-dvh engines");
  assert.ok(heights.includes("100dvh"), "explicit height must track the real visible viewport");
  assert.match(rule, /overflow:\s*hidden;/, "overflow:hidden must remain so any residual overflow is clipped, not scrollable");
  // must NOT itself declare a bare, unfallbacked min-height that could reintroduce the old bug
  const bareMinHeightVh = /min-height:\s*100vh;(?!\s*\n\s*min-height:\s*100dvh;)/.test(rule.replace(/height:\s*100vh;\s*\n\s*height:\s*100dvh;/, ""));
  assert.equal(bareMinHeightVh, false, ".stage--invite must not add its own unfallbacked min-height:100vh");
});

check("N3 `.stage--loginCheck` has no selector-level min-height/height override of its own — it must inherit the shared base `.stage` fix, not a stale per-scene rule", () => {
  const idx = CSS.indexOf(".stage--loginCheck");
  assert.ok(idx > 0, ".stage--loginCheck selectors must exist");
  // scan every top-level ".stage--loginCheck ..." rule (not just the first) for a bare own min-height/height
  const re = /\.stage--loginCheck[^{}\n]*\{[^}]*\}/g;
  let m;
  let found = false;
  while ((m = re.exec(CSS))) {
    if (/(?:^|[\s;{])(min-)?height:/.test(m[0]) && !/\.loginCheck__face\b/.test(m[0])) found = true;
  }
  // the one exception is .loginCheck__face itself, whose own width/height (202.4x243.2) is the
  // approved tap-target size from the reentry preview (a642 V4 test pins these px values) — that is
  // not a stage-level height override and must stay untouched.
  assert.equal(found, false, "no stray .stage--loginCheck-level height rule should exist outside .loginCheck__face");
});

check("N4 body background-attachment is no longer `fixed` (known iOS Safari repaint/seam pattern during dynamic-toolbar resize)", () => {
  const rule = cssRule("body");
  assert.equal(/background-attachment:\s*fixed;/.test(rule), false, "fixed attachment must be gone");
  assert.match(rule, /background-attachment:\s*scroll;/, "explicit scroll (the default) documents the decision instead of silently relying on the initial value");
});

check("N5 zero-regression: the already-fixed selectors from the prior card keep their exact dvh pair, byte-for-byte", () => {
  const sendstay = cssRule('.stage[data-scene="sendstay"]');
  assert.deepEqual(allDecls(sendstay, "min-height"), ["100vh", "100dvh"], "sendstay must be unchanged");
  const hatchNameAt = CSS.indexOf(".stage--hatch,\n.stage--name {");
  assert.ok(hatchNameAt > 0, ".stage--hatch,.stage--name combined rule must still exist verbatim");
  const hatchName = CSS.slice(hatchNameAt, CSS.indexOf("}", hatchNameAt) + 1);
  assert.deepEqual(allDecls(hatchName, "min-height"), ["100vh", "100dvh"], "hatch/name must be unchanged");
});

check("N6 tap-to-unlock wiring is untouched: unlockApp is still bound only to a real click on #loginChogButton, no auto-call anywhere in renderAppLock", () => {
  const rAL = fnBody("renderAppLock");
  assert.ok(rAL.includes('document.querySelector("#loginChogButton")?.addEventListener("click", unlockApp);'), "click wiring must be present");
  assert.equal(rAL.includes("unlockApp()"), false, "renderAppLock must never call unlockApp() directly — only pass it as a click listener reference");
  assert.equal((rAL.match(/\bunlockApp\b/g) || []).length, 2, "unlockApp must appear exactly twice: the waiting-branch Chog tap and the failed-branch Try again tap (A-667: #unlockRetryButton, was #checkButton), both as listener references");
  for (const bad of ["setTimeout(", "requestAnimationFrame(", "await ", ".then("]) {
    assert.equal(rAL.includes(bad), false, `renderAppLock must not gain an async/auto-call path (${bad})`);
  }
});

check("N7 loginCheckingMarkup source untouched by this repair (layout fix must be CSS-only, not markup)", () => {
  const body = fnBody("loginCheckingMarkup");
  assert.equal(body.includes('<button class="loginCheck__face" id="loginChogButton" type="button" aria-label="Face ID">${chogInviteMarkup()}</button>'), true);
  assert.equal(body.includes("${arasoBrandMarkup()}"), true);
  assert.equal(body.includes('<h1 class="loginCheck__title">Checking…</h1>'), true);
  assert.equal(body.includes('<p class="loginCheck__body">Face ID may appear once.</p>'), true);
});

check("N8 no forbidden auth-weakening tokens were introduced anywhere in main.js by this card (grep guard); getRpId/PRODUCTION_RP_ID still present and untouched", () => {
  for (const bad of ["mockCredential", "fakePrf", "bypassWebAuthn"]) {
    assert.equal(MAIN.includes(bad), false, `forbidden token present: ${bad}`);
  }
  assert.ok(MAIN.includes("function getRpId("), "getRpId must still exist (unchanged function, not removed)");
  assert.ok(MAIN.includes("PRODUCTION_RP_ID"), "PRODUCTION_RP_ID must still exist (unchanged, not removed)");
});

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════════
const HEIGHT = { 390: 844, 430: 900, 700: 900, 1440: 900 };
const TOOLBAR_DELTA = 100;

if (process.env.A665_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A665_NODE_ONLY=1) — browser scenarios not run");
  finish();
} else {
  await runBrowser();
  finish();
}

async function runBrowser() {
  let chromium;
  if (!existsSync(privatePath())) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  try {
    const req = createRequire(privatePath("ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await checkAsync("B0 playwright available (private harness)", () => { throw e; });
    return;
  }
  let server = null;
  let BASE = process.env.A665_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", "5668", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = "http://localhost:5668/";
  }
  const shots = process.env.A665_SHOTS || "";
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

async function mobileWidth(browser, BASE, w, shots) {
  const T = `[${w}]`;
  const h = HEIGHT[w];
  const INIT = `(() => { const wa = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials;
    if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { wa.create++; return oc(o); }; c.get = (o) => { wa.get++; return og(o); }; } })();`;
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.addInitScript(INIT);
  const p = await context.newPage();
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a665_w${w}_${name}.png`) }); };

  await checkAsync(`B1 ${T} Invite: .stage bottom tracks the visible bottom at full height and at toolbar-shown (-${TOOLBAR_DELTA}px), no overflow/gap either way`, async () => {
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.waitForSelector(".stage--invite", { timeout: 15000 });
    const read = () => p.evaluate(() => {
      const s = document.querySelector(".stage--invite");
      const r = s.getBoundingClientRect();
      return { bottom: r.bottom, vvHeight: window.visualViewport ? window.visualViewport.height : window.innerHeight, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight };
    });
    const full = await read();
    assert.ok(Math.abs(full.bottom - full.vvHeight) < 2, `full-height stage bottom (${full.bottom}) must equal visible bottom (${full.vvHeight})`);
    assert.ok(full.scrollHeight - full.clientHeight < 2, "page must not be made scrollable by the stage at full height");
    await shot("1_invite_full");

    await p.setViewportSize({ width: w, height: h - TOOLBAR_DELTA });
    await p.waitForTimeout(150);
    const shrunk = await read();
    assert.ok(Math.abs(shrunk.bottom - shrunk.vvHeight) < 2, `toolbar-shown stage bottom (${shrunk.bottom}) must equal visible bottom (${shrunk.vvHeight}) — no detached slab, no overflow`);
    assert.ok(shrunk.scrollHeight - shrunk.clientHeight < 2, "page must not become scrollable when the toolbar is shown");
    await shot("2_invite_toolbarShown");

    await p.setViewportSize({ width: w, height: h });
  });

  await checkAsync(`B2 ${T} LOGIN_CHECKING: seeded credential + reload lands in the waiting state with #loginChogButton fully inside visualViewport at full height and at toolbar-shown`, async () => {
    // seed exactly like a real returning user: an address + a stored passkey marker, then reload.
    await p.evaluate(() => {
      localStorage.setItem("araso.address", "0x1111111111111111111111111111111111111111");
      localStorage.setItem("araso.mark", "1");
    });
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForSelector("#loginChogButton", { timeout: 15000 }).catch(() => {});
    const rect = async () => p.evaluate(() => {
      const b = document.querySelector("#loginChogButton");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      const vw = vv ? vv.width : window.innerWidth;
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw, vh };
    });
    const full = await rect();
    if (full) {
      assert.ok(full.top >= 0 && full.left >= 0 && full.bottom <= full.vh && full.right <= full.vw, `button rect ${JSON.stringify(full)} must sit fully inside the visible viewport at full height`);
    }
    await shot("3_loginCheck_full");

    await p.setViewportSize({ width: w, height: h - TOOLBAR_DELTA });
    await p.waitForTimeout(150);
    const shrunk = await rect();
    if (shrunk) {
      assert.ok(shrunk.top >= 0 && shrunk.left >= 0 && shrunk.bottom <= shrunk.vh && shrunk.right <= shrunk.vw, `button rect ${JSON.stringify(shrunk)} must sit fully inside the visible viewport at toolbar-shown`);
    }
    await shot("4_loginCheck_toolbarShown");
    await p.setViewportSize({ width: w, height: h });
  });

  await checkAsync(`B3 ${T} one real tap on #loginChogButton drives exactly one navigator.credentials.get call (fail-closed cancel path still allowed to end in the failed card)`, async () => {
    const before = await p.evaluate(() => ({ ...window.__wa }));
    const btn = p.locator("#loginChogButton");
    if (await btn.count()) {
      const box = await btn.boundingBox();
      if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForTimeout(1500);
    }
    const after = await p.evaluate(() => ({ ...window.__wa }));
    assert.equal(after.create - before.create, 0, "no credential CREATE must happen on reentry tap");
    assert.ok(after.get - before.get <= 1, "at most one credentials.get path per tap");
  });

  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => {});
  await context.close();
}

async function desktopWidth(browser, BASE, w, shots) {
  const T = `[${w}]`;
  const h = HEIGHT[w];
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await context.newPage();
  await checkAsync(`B4 ${T} desktop Invite/Home rects unchanged vs the pre-A-665 baseline (a665_prep/before/result.json)`, async () => {
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.waitForSelector(".stage--invite", { timeout: 15000 });
    const stageRect = await p.evaluate(() => document.querySelector(".stage--invite").getBoundingClientRect().toJSON());
    assert.ok(Math.abs(stageRect.height - h) < 2, `desktop ${w}: .stage--invite height (${stageRect.height}) must equal the viewport height (${h}), same as the pre-repair baseline`);
    assert.ok(Math.abs(stageRect.top - 0) < 2 && Math.abs(stageRect.bottom - h) < 2, "desktop stage must still span the full viewport top..bottom, unchanged");
  });
  await context.close();
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
