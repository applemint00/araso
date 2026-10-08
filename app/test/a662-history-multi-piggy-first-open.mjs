// [A-662 HISTORY RESPONSIVE STACK — prewrite review Condition 4] LIVE browser test — real Vite +
// headless Chrome over CDP, same pattern as a623/a624/a626 (no test hooks in the app, real
// localStorage seed, real Input.dispatchMouseEvent taps at elementFromPoint-verified points).
//
// Scope: the ONE prewrite gap named explicitly BLOCKING-for-condition (not blocking for
// prewrite itself) — row 18 "multi-Piggy HISTORY first-open-before-align-loop race": does
// computeHistoryFitMode()/alignRecordsCardToHomePaper() read a correct, already-current
// `.homePaper` rect the very FIRST time HISTORY opens with 2+ Piggy residents already present
// (home-paper-multi.js mountResidentPaper() sets `.homePaper`'s own height dynamically on
// fold/open — M2_CODE_MAP.md row 18), or does the first tick race a stale/zero rect before the
// per-frame align loop (startRecordsAlignLoop()) has had a chance to correct it.
//
// Also re-proves, LIVE (not just the source-cut/pure-formula tests in a621), that
// computeHistoryFitMode() picks side-by-side at a wide width and stacked at a narrow-web width
// on the real rendered `.homePaper`/character geometry — the actual pixels, not a re-implemented
// formula.
//
//   node app/test/a662-history-multi-piggy-first-open.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { layoutOracle } from "./helpers/a831-sweep.mjs";

import { admitSequencedPiggy, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
// [A-833] test-side placement oracle (computeHistoryPlacement() in a vm on the pure keyframe layout): the v10 rule decides the mode,
// not the old live whitespace rect-math (641..~570 px at 900 tall are "fan" now, stacked only below ~574).
const A833_MAIN = readFileSync(path.join(REPO_ROOT, "app/src/main.js"), "utf8");
const A833_LAYOUT = layoutOracle(A833_MAIN);
const A833_PLACE = (() => {
  const layout = A833_LAYOUT; const ctx = { Math, __layout: layout }; vm.createContext(ctx);
  const i = A833_MAIN.indexOf("function computeHistoryPlacement("); const j = A833_MAIN.indexOf("\n}\n", i);
  vm.runInContext(["function desktopFormat(vw, vh) { const L = __layout(vw, vh, 0); return { s: L.s, L }; }", A833_MAIN.slice(i, j + 3), "globalThis.__P = computeHistoryPlacement;"].join("\n"), ctx);
  return ctx.__P;
})();
const VITE_PORT = 5662;
const CDP_PORT = 9662;
const APP_URL = `http://127.0.0.1:${VITE_PORT}/`;
const HARD_TIMEOUT_MS = 90_000;

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  return ok;
}
const near = (a, b, tol = 0.6) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

const CHAIN = "monad-testnet";
const AT = "2026-10-01T06:00:00.000Z";
const makeAddr = (seed) => "0x" + seed.toString(16).padStart(40, "0");
const SELF_ADDR = makeAddr(0xa662100);
const MOCHI_ADDR = makeAddr(0xa662200);
const honeybunId = `legacy-${SELF_ADDR.toLowerCase()}`;
const mochiId = `piggy-${MOCHI_ADDR.toLowerCase()}`;

function stagingStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

async function buildFixture() {
  const idx = stagingStorage();
  const cred = { credentialId: Buffer.from("root-cred-a662").toString("base64url") };
  const r1 = registerControlledPiggy(idx, CHAIN, { id: honeybunId, name: "Honeybun", address: SELF_ADDR, signerAddress: SELF_ADDR, locator: cred, at: AT });
  if (!r1.ok) throw new Error(`registerControlledPiggy: ${r1.reason}`);
  const r2 = await admitSequencedPiggy({
    storage: idx, chainId: CHAIN, sequence: 1, rootCredential: cred,
    requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }),
    deriveAddress: () => MOCHI_ADDR, now: () => AT,
  });
  if (!r2.ok) throw new Error(`admitSequencedPiggy: ${r2.reason}`);
  renameIndexedPiggy(idx, CHAIN, { id: mochiId, name: "Mochi" });
  const indexKey = `araso.myPiggiesIndex.v1.${CHAIN}`;
  const first = migrateSinglePiggy({ address: SELF_ADDR, name: "Honeybun", createdAt: AT });
  const born = createPiggy({ piggies: [first.piggy], newPiggy: { id: mochiId, name: null, address: MOCHI_ADDR }, at: AT });
  if (!born.ok) throw new Error(`createPiggy: ${born.reason}`);
  const reg = stagingStorage();
  const scope = { accountId: SELF_ADDR, chainId: CHAIN };
  saveRegistry(reg, scope, { piggies: born.piggies });
  return {
    "araso.address": SELF_ADDR,
    "araso.passkey": JSON.stringify(cred),
    "araso.piggyName": "Honeybun",
    "araso.birthPlayed": "1",
    "araso.piggyReceived": "1",
    "araso.secondJourneyClosed": "1",
    [indexKey]: idx.getItem(indexKey),
    [piggyRegistryKey(scope)]: reg.getItem(piggyRegistryKey(scope)),
  };
}

async function attach(port) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 1;
  const pending = new Map();
  const handlers = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) (handlers.get(msg.method) || []).forEach((h) => h(msg.params));
  };
  const send = (method, params = {}, sessionId) => {
    const id = seq++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  };
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  const pageErrors = [];
  (handlers.get("Runtime.exceptionThrown") || handlers.set("Runtime.exceptionThrown", []).get("Runtime.exceptionThrown"))
    .push((p) => pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  const on = (m, h) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(h); };
  return {
    pageErrors,
    async navigate(url) {
      const loaded = new Promise((r) => on("Page.loadEventFired", r));
      await s("Page.navigate", { url });
      await loaded;
    },
    async evaluate(expression) {
      const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error("evaluate: " + JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
    viewport: (width, height) => s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }),
    async tapAt(x, y) {
      await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    close: async () => { await send("Target.closeTarget", { targetId }); ws.close(); },
  };
}

const PAGE = `window.__a662 = {
  reach(sel) {
    const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); if (!r.width) return { hit: null };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let pick = null;
    for (let y = Math.floor(cy - 60); y <= cy + 60 && !pick; y++) for (let x = Math.floor(cx - 90); x <= cx + 90; x++) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y);
      if (t && t.closest(sel) === el) { pick = { x, y }; break; }
    }
    return { pick };
  },
  geom() {
    const a = document.querySelector("#recordsCardAnchor");
    const hp = document.querySelector("#homePaper");
    const ar = a && a.getBoundingClientRect();
    const hr = hp && hp.getBoundingClientRect();
    return {
      vw: innerWidth,
      open: !!a && !a.hidden,
      homeW: hr ? Math.round(hr.width * 100) / 100 : null,
      homeH: hr ? Math.round(hr.height * 100) / 100 : null,
      homeTop: hr ? Math.round(hr.top * 100) / 100 : null,
      anchorW: ar ? Math.round(ar.width * 100) / 100 : null,
      anchorH: ar ? Math.round(ar.height * 100) / 100 : null,
      anchorTop: ar ? Math.round(ar.top * 100) / 100 : null,
      anchorRight: ar ? Math.round(ar.right * 100) / 100 : null,
      residentCards: document.querySelectorAll(".homePaper__card--piggy").length,
    };
  },
  // [coordinator browser regression, 2026-10-01] position-only checks (rect equality) missed a
  // real bug: at web "stacked" widths (641-~710), the geometry was correct but HOME painted
  // OVER HISTORY (z-order), so HISTORY's own title text was actually unreadable/covered even
  // though its rect matched HOME's. This checks the ACTUAL topmost element at HISTORY's own
  // center point AND near its title/identity text (top-left of the card, under the 18px
  // padding) resolves to something INSIDE #recordsCardAnchor, not HOME/the board underneath.
  stackOrder() {
    const a = document.querySelector("#recordsCardAnchor");
    if (!a || a.hidden) return null;
    const r = a.getBoundingClientRect();
    const centerPt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const titlePt = { x: r.left + 24, y: r.top + 26 };
    const topmost = (pt) => {
      const el = document.elementFromPoint(pt.x, pt.y);
      return !!el && !!el.closest("#recordsCardAnchor");
    };
    return { centerIsHistory: topmost(centerPt), titleIsHistory: topmost(titlePt) };
  },
}; true`;

let viteProc = null;
let chromeProc = null;
let profileDir = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch { /* retry */ }
    await wait(200);
  }
  throw new Error(`timed out waiting for ${url}`);
}
function cleanup() {
  for (const p of [chromeProc, viteProc]) { try { if (p && !p.killed) p.kill("SIGKILL"); } catch { /* best effort */ } }
  try { if (profileDir) rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

async function live() {
  const fx = await buildFixture();
  viteProc = spawn(path.join(REPO_ROOT, "node_modules/.bin/vite"), ["--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(APP_URL, 20_000);
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a662-chrome-"));
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000);
  const c = await attach(CDP_PORT);
  const ev = (e) => c.evaluate(e);
  const reach = (sel) => ev(`window.__a662.reach(${JSON.stringify(sel)})`);
  const geom = () => ev("window.__a662.geom()");
  async function waitFor(expr, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await ev(expr)) return true; await wait(100); }
    return false;
  }
  async function tap(sel) {
    const r = await reach(sel);
    if (!r || !r.pick) return false;
    await c.tapAt(r.pick.x, r.pick.y);
    return true;
  }
  const rec = (id) => `.homePaper__records[data-piggy-id="${id}"]`;

  // ── Condition 4 — first-open-before-align-loop race, 2 Piggy residents ──
  // [coordinator feedback 2026-10-01] The original version here waited only a flat 400ms after
  // tapping Chog, then immediately tapped Honeybun's records. That conflates TWO different
  // things: (a) the actual row-18 race condition 4 names — the align function's ONE-TIME
  // geometry read must already reflect `.homePaper`'s CURRENT fold/open height, not a stale one
  // — with (b) Chog's own hand-to-full-size paper DOCKING transition (a continuous, chog-home.js
  // -driven animation, unrelated to HISTORY/records at all) simply not having finished yet. (b)
  // is not what this test is supposed to probe, and a flat 400ms guess raced it on some runs.
  // Now explicitly wait for `.homePaper`'s width to stop changing (two reads 120ms apart, equal)
  // before ever tapping a records button — isolating condition 4's actual race from (b).
  async function waitForPaperWidthStable(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let prev = null;
    while (Date.now() < deadline) {
      const w = await ev(`document.querySelector("#homePaper")?.getBoundingClientRect().width ?? 0`);
      if (w > 100 && prev !== null && Math.abs(w - prev) < 0.05) return true;
      prev = w;
      await wait(120);
    }
    return false;
  }
  for (const [label, W, H] of [["side-by-side width", 900, 900], ["stacked-web width", 660, 900]]) {
    await c.viewport(W, H);
    await c.navigate(APP_URL);
    await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
    await c.navigate(APP_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await wait(400);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(300); }
    await ev(PAGE);
    const opened = await tap("#chogHomeHit");
    check(`${label}: Chog tap reachable on first paint`, opened, true);
    const homeReady = await waitFor(`document.querySelectorAll(".homePaper__card--piggy").length === 2 && document.querySelector("#homePaper").getBoundingClientRect().width > 100`, 6000);
    check(`${label}: 2 Piggy residents present before HISTORY opens`, homeReady, true);
    // Row-18's own race is "HISTORY's first align must reflect the CURRENT (already fold/open-
    // settled) `.homePaper` height" — so settle the hand-to-paper docking animation FIRST (unrelated
    // to HISTORY), THEN test HISTORY's own first-open alignment against that now-stable paper.
    check(`${label}: .homePaper width settles before HISTORY is asked to open`, await waitForPaperWidthStable(), true);
    const tapped = await tap(rec(honeybunId));
    check(`${label}: Honeybun records reachable immediately after first open`, tapped, true);
    await waitFor(`!document.querySelector("#recordsCardAnchor").hidden`, 6000);
    // No extra settle wait here on purpose — read geometry on the FIRST frame HISTORY reports open.
    const g0 = await geom();
    check(`${label}: HISTORY anchor is open on the very first readable frame (no stale hidden state)`, g0.open, true);
    check(`${label}: HISTORY anchor width == live HOME width on first frame (no stale/zero rect)`, near(g0.anchorW, g0.homeW, 1), true);
    check(`${label}: HISTORY anchor top == live HOME top on first frame`, near(g0.anchorTop, g0.homeTop, 1), true);
    await wait(500); // let the per-frame align loop run a few more ticks
    const g1 = await geom();
    check(`${label}: still aligned a few frames later (loop keeps matching, not just the first tick)`, near(g1.anchorW, g1.homeW, 1) && near(g1.anchorTop, g1.homeTop, 1), true);
    if (label === "side-by-side width") {
      // side-by-side: HISTORY sits to HOME's right; confirm real whitespace past its own right
      // edge is still ≥ RECORDS_CARD_GAP(24) — i.e. this width genuinely landed in side-by-side,
      // not a mode the implementation picked for the wrong reason.
      // pre-A-833 baseline: g1.vw - g1.anchorRight >= 24 - 0.6 (History right edge >= 24 px from the viewport). A-833: right end of the free span (pair/fan).
      check(`${label}: History right edge on the placement rule and inside the right margin line (anchorRight <= vw - M + 0.6)`, near(g1.anchorRight, A833_PLACE(W, H).histLeft + A833_PLACE(W, H).cardW, 1.5) && g1.anchorRight <= g1.vw - A833_LAYOUT(W, H, 0).M + 0.6, true);
    } else {
      // stacked: HISTORY takes HOME's exact size/top (already asserted above) and its right edge
      // sits on/near the viewport's own right safe rail, not out past it.
      check(`${label}: HISTORY right edge stays within the viewport (stacked, no overflow)`, g1.anchorRight <= g1.vw + 0.6, true);
    }
    await tap("#recordsCardClose");
    await wait(300);
  }

  // ── Stacking-order check (coordinator browser regression, 2026-10-01) ──
  // Position-only checks (rect equality, above) missed this: at web "stacked" widths (641-700,
  // the exact widths the real-browser diagnosis named), the geometry was correct but HOME
  // painted OVER HISTORY — Owner's own text ("HISTORY slides/overlaps from viewer-right ABOVE
  // HOME · z-order above HOME") was violated purely visually, with no rect-level symptom. This
  // checks the ACTUAL topmost element at HISTORY's own center and title-text point via
  // elementFromPoint — 641/700 must land inside #recordsCardAnchor (fixed); 800/1440 are
  // side-by-side controls where HOME/HISTORY never overlap, confirming this probe itself isn't
  // just trivially true everywhere.
  // A-833: expected modes are HARD-CODED from the v10 pictures at 900 tall (not from the implementation): 641 / 700 / 800 = fan (picture 04 shows 640x900 fan), 1440 = pair; stacked only below ~574. expectStacked=false for all four.
  // pre-A-833 baseline: [["641 stacked", 641, true], ["700 stacked", 700, true], ["800 side-by-side", 800, false], ["1440 side-by-side", 1440, false]] (v10: 641 / 700 x 900 = fan)
  for (const [label, W, expectStacked] of [["641 fan", 641, false], ["700 fan", 700, false], ["800 fan", 800, false], ["1440 pair", 1440, false]]) {
    // [coordinator feedback 2026-10-01] a stale `recordsCardAnchor--stackedMode` surfaced
    // specifically on the width right after a stacked one, in a loop that repeatedly
    // `Page.navigate`s to the exact SAME URL — main.js's own class-sync is unconditional on
    // every call (verified by reading alignRecordsCardToHomePaper()/stackMobileRecordsOverHome()
    // source directly: the side-by-side branch clears the class before any early-return guard,
    // every single call, no code path skips it). Repeated same-URL navigations in headless
    // Chrome can restore from bfcache instead of a true fresh load, which would explain reused
    // DOM/class state the app code itself never leaves stale. Navigating through "about:blank"
    // first forces a real fresh document each iteration, removing that ambiguity from the test
    // itself rather than loosening what it asserts.
    await c.viewport(W, 900);
    await c.navigate("about:blank");
    await c.navigate(APP_URL);
    await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
    await c.navigate("about:blank");
    await c.navigate(APP_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await wait(400);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(300); }
    await ev(PAGE);
    await tap("#chogHomeHit");
    await waitFor(`document.querySelector("#homePaper")?.getBoundingClientRect().width > 100`, 6000);
    await waitForPaperWidthStable();
    await tap(rec(honeybunId));
    await waitFor(`!document.querySelector("#recordsCardAnchor").hidden`, 6000);
    // [coordinator feedback 2026-10-01] the previous `vw - anchorRight < 24` heuristic was WRONG,
    // not the app: stacked mode's own mobile-safe-rail formula (`innerWidth - inset - width`,
    // inset defaults to 24) ALSO leaves ~24px of whitespace past the anchor's right edge by
    // construction — coincidentally the same ballpark as the whitespace THRESHOLD, so the
    // heuristic couldn't tell stacked from side-by-side at all. Read the mechanism's own ground
    // truth instead: `stackMobileRecordsOverHome()` is the only place that sets
    // `recordsCardAnchor--stackedMode`, and `alignRecordsCardToHomePaper()`'s side-by-side branch
    // is the only place that clears it — so the class IS the mode. Poll (not a fixed wait) for it
    // to reach the EXPECTED state within a generous timeout — accommodates genuine align-loop
    // convergence timing without weakening what's finally asserted (a real, persistent mismatch
    // still times out and fails).
    const classExpr = `document.querySelector("#recordsCardAnchor")?.classList.contains("recordsCardAnchor--stackedMode") ?? false`;
    await waitFor(expectStacked ? classExpr : `!(${classExpr})`, 4000);
    const stackedModeClass = await ev(classExpr);
    check(`${label}: geometry mode is ${expectStacked ? "stacked" : "side-by-side"} as expected`, stackedModeClass, expectStacked);
    if (expectStacked) {
      const order = await ev("window.__a662.stackOrder()");
      check(`${label}: HISTORY center point is topmost (not covered by HOME)`, order && order.centerIsHistory, true);
      check(`${label}: HISTORY title-text point is topmost (not covered by HOME)`, order && order.titleIsHistory, true);
    }
    await tap("#recordsCardClose");
    await wait(300);
  }

  // ── Same-page LIVE resize (coordinator independent real-browser diagnosis, 2026-10-01) ──
  // The loop above always re-navigates per width, which never actually exercised a live resize
  // while HISTORY stays open — exactly the gap the coordinator's own direct test found: open at
  // 700 (stacked, correct), resize to 800 with NO new navigation, and the mode stayed frozen at
  // "stacked" even 1.2s later (and resizing back to 700 afterward also stayed frozen) — a NON-640
  // crossing (641-700 vs 720+), unlike a623's existing 390→1440 live-crossing coverage, which
  // only ever crosses the old 640 boundary and so never caught this. Single page load, no
  // re-navigation anywhere in this block, matching the coordinator's own repro exactly.
  {
    // pre-A-833 baseline: opened at 700 (stacked) -> 800 -> 700. v10: 700x900 is fan; stacked at 900 tall only below 574 -> 560 -> 800 -> 560.
    await c.viewport(560, 900);
    await c.navigate("about:blank");
    await c.navigate(APP_URL);
    await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
    await c.navigate("about:blank");
    await c.navigate(APP_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await wait(400);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(300); }
    await ev(PAGE);
    await tap("#chogHomeHit");
    await waitFor(`document.querySelector("#homePaper")?.getBoundingClientRect().width > 100`, 6000);
    await waitForPaperWidthStable();
    await tap(rec(honeybunId));
    await waitFor(`!document.querySelector("#recordsCardAnchor").hidden`, 6000);
    const classExpr2 = `document.querySelector("#recordsCardAnchor")?.classList.contains("recordsCardAnchor--stackedMode") ?? false`;
    const mountInertExpr = `document.querySelector(".homePaperMount")?.inert ?? null`;
    await waitFor(classExpr2, 4000);
    check("same-page resize: opened at 560 → stacked, HOME inert (pre-A-833: 700)", [await ev(classExpr2), await ev(mountInertExpr)], [true, true]);

    // Live resize to 800, NO re-navigation — this is the exact scenario that froze.
    await c.viewport(800, 900);
    await waitFor(`!(${classExpr2})`, 4000);
    check("same-page resize: 560→800 (no reload) → side-by-side, HOME live (pre-A-833: 700→800)", [await ev(classExpr2), await ev(mountInertExpr)], [false, false]);

    // Back down to 700, still no re-navigation.
    await c.viewport(560, 900);
    await waitFor(classExpr2, 4000);
    check("same-page resize: 800→560 (no reload) → stacked again, HOME inert again (pre-A-833: 800→700)", [await ev(classExpr2), await ev(mountInertExpr)], [true, true]);

    await tap("#recordsCardClose");
    await wait(300);
  }

  check("page errors = 0", c.pageErrors, []);
  await c.close();
}

const timeout = setTimeout(() => { console.error("FAIL  hard timeout"); cleanup(); process.exit(1); }, HARD_TIMEOUT_MS);
timeout.unref?.();
try {
  await live();
} catch (err) {
  fail += 1;
  console.error("FAIL  uncaught:", err && err.stack ? err.stack : err);
} finally {
  clearTimeout(timeout);
  cleanup();
  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exitCode = 1;
}
