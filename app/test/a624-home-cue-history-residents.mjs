// [A-624] HOME first-arrival cue B · HISTORY edge cases · multi-Piggy residuals — focused test.
// [A-786 RE-PIN] Home paper is drawn x1.10 (style.css --homePaperK) so its measured width is 282 (256.338*1.1=281.97), and HISTORY derives its width from the live paper rect (main.js alignRecordsCardToHomePaper) = 282. Intended size change only. 
//   node app/test/a624-home-cue-history-residents.mjs
//
// Part 1 (no browser): tapCueFrame() curve/timing (pure export of chog-home.js), and the source
//   contract of the wiring (cue gated on the existing isFirstArrival fact, First-Journey card
//   deferred by the existing retry discipline while the cue enters, real tap hides the cue, mobile
//   HISTORY makes the Chog hit inert too, Escape does not fold an inert background, 640px crossing
//   remounts the resident module, zero-pixel pointer fix for flap/+Piggy at every width, packages
//   untouched).
// Part 2 (LIVE, real Vite dev + headless Chrome over CDP, no app test hooks beyond the existing
//   DEV-only window.__arasoScene): first-arrival cue normal + reduced (settle path with
//   arrival:true — the real Name→walk path is covered by the A-624 receipt probe), cue hidden by a
//   real tap, Send card never before cue entrance end; mobile HISTORY + Escape / Chog tap;
//   web flap + +Piggy pointer reach; live 390→1440 resident window = fresh web mount.
// Every tap = Input.dispatchMouseEvent at an elementFromPoint-verified point. No WebAuthn, no tx.
// The +Piggy tab is only hit-tested, never activated (activation = passkey assertion).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";
import { tapCueFrame, TAP_CUE_TIMING } from "../src/chog-home.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
const VITE_PORT = 5624;
const CDP_PORT = 9624;
const APP_URL = `http://127.0.0.1:${VITE_PORT}/`;
const HARD_TIMEOUT_MS = 150_000;

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  return ok;
}

// ═══ Part 1 — pure curve + source contract ══════════════════════════════════════════════════
check("cue timing = 300 delay + 1320 wave + 250 fade = 1870ms entrance", [TAP_CUE_TIMING.delayMs, TAP_CUE_TIMING.waveMs, TAP_CUE_TIMING.fadeMs, TAP_CUE_TIMING.entranceMs], [300, 1320, 250, 1870]);
check("wave keys = A-614 PREVIEW WAVE_SUBTLE_KEYS verbatim", TAP_CUE_TIMING.waveKeys, [[0, 0], [350, -7], [550, -4], [770, -8], [960, -4], [1320, 0]]);
check("t=0: no wave, label hidden, entering", tapCueFrame(0), { waveDeg: 0, labelOpacity: 0, entering: true });
check("t=300+770: wave at its -8° peak, label still hidden", [Math.round(tapCueFrame(1070).waveDeg * 100) / 100, tapCueFrame(1070).labelOpacity], [-8, 0]);
check("wave never exceeds 8° (subtle)", Array.from({ length: 200 }, (_, i) => Math.abs(tapCueFrame(i * 10).waveDeg)).every((d) => d <= 8.0001), true);
check("t=1620: wave back to 0, fade starts", [tapCueFrame(1620).waveDeg, tapCueFrame(1620).labelOpacity], [0, 0]);
check("t=1870: label fully visible, entrance over", [tapCueFrame(1870).labelOpacity, tapCueFrame(1870).entering], [1, false]);
check("reduced: no wave, static label, never entering", [tapCueFrame(0, true), tapCueFrame(900, true)], [{ waveDeg: 0, labelOpacity: 1, entering: false }, { waveDeg: 0, labelOpacity: 1, entering: false }]);

const MAIN = readFileSync(path.join(APP_DIR, "src/main.js"), "utf8");
const CHOG = readFileSync(path.join(APP_DIR, "src/chog-home.js"), "utf8");
const CSS = readFileSync(path.join(APP_DIR, "src/style.css"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  return "";
}
const code = stripComments(MAIN);
const chog = stripComments(CHOG);
// mountHome's parameter is a destructuring default ({…} = {}), so fnBody() would stop at it —
// cut by markers instead (same as home-arrival.mjs).
const mountHome = code.slice(code.indexOf("function mountHome("), code.indexOf("function mountHome(") + 20000);
// [A-895 P-D COVERAGE POINTER] After A-891 the first-arrival "tap me!" cue is gone, so the cue checks in this file (source gate here, and the
// browser checks below that expect [0, "", 0, false] / [false, true] / tSend false) pin its ABSENCE under titles that still describe the cue.
// Cue timing coverage (tSend, entrance, hold) is NOT here any more: First Send reveal timing = a891-wave4-file-quiet-tapme.mjs Part B
// (firstArrival), post-file / revisit cue entrance = a779-small-text-unify.mjs B5 and a891 Part B. A regression that restores the cue fails here; one that
// shifts the Send timing is caught by a891 B, not by this file.
// pre-A-891 baseline: /if \(isFirstArrival && !state\.sendCardVisible\) homeChog\?\.startTapCue\?\.\(\);/ → true.
// [A-891 CG-04, Owner 2026-10-08 "First Home stays quiet"] the first-arrival cue is removed; the same gate now starts only the silent hold
// that keeps the First Send reveal timing. Measured: [old call present, new gate present] = [false, true].
check("settle(): cue started only on isFirstArrival && !sendCardVisible (no new persistence key)",
  [/if \(isFirstArrival && !state\.sendCardVisible\) homeChog\?\.startTapCue\?\.\(\);/.test(mountHome),
    /if \(isFirstArrival && !state\.sendCardVisible\) a891StartFirstArrivalHold\(\);/.test(mountHome)], [false, true]);
check("no new localStorage key for the cue", /localStorage\.setItem\([^)]*[Cc]ue/.test(MAIN) || /localStorage/.test(chog), false);
// [A-626 A] superseded: records keep the 1200ms retry; the cue now defers by its exact remaining
// entrance + 1.2s hold (tapCueHoldRemainingMs) instead of a 1200ms-multiple retry.
check("revealSendCard(): records retry 1200ms; cue defers by its remaining entrance+hold",
  /if \(state\.recordsCardVisible\) \{\s*sceneTimeout\(revealSendCard, HOME_FIRST_JOURNEY_CARD_MS\);\s*return;\s*\}/.test(mountHome) &&
  /const cueWait = homeChog\?\.tapCueHoldRemainingMs \|\| 0;\s*if \(cueWait > 0\) \{\s*sceneTimeout\(revealSendCard, Math\.max\(50, cueWait\)\);\s*return;/.test(mountHome), true);
check("chog-home toggle(): real tap hides the cue before the pin flips", /const toggle = \(e\) => \{\s*e\.preventDefault\(\);\s*hideTapCue\(\);\s*pinned = !pinned;/.test(chog), true);
check("cue never calls hover()/requestHover (no auto-open, no reduced snap)", /requestHover|hover\(/.test(fnBody(chog, "startTapCue")), false);
check("closeCard() hides the cue (no overlap frame with the Send card)", /const closeCard = \(\) => \{\s*hideTapCue\(\);/.test(chog), true);
const sync = fnBody(code, "syncRecordsViewportState");
// [A-626 D] superseded: Chog hit is inert while HISTORY is open at EVERY width (HOME mount still
// stacked-mode-only). [A-662] "mobile" → "stackedMode" (geometry-fit decision, computeHistoryFitMode()),
// same contract.
check("syncRecordsViewportState(): Chog hit inert = open (all widths); HOME mount inert = stackedMode && open",
  /const chogHit = document\.querySelector\("#chogHomeHit"\);\s*if \(chogHit && chogHit\.inert !== open\) chogHit\.inert = open;/.test(sync) &&
  /const background = open && stackedMode;\s*if \(mount\.inert !== background\) mount\.inert = background;/.test(sync), true);
check("Escape fold handler skips an inert background paper", /if \(!paper\.isConnected \|\| !paper\.classList\.contains\("isResOpen"\)\) return;\s*if \(paper\.closest\("\[inert\]"\)\) return;\s*api\.fold\(\);/.test(code), true);
check("640px crossing remounts the resident module (open state kept)",
  /if \(mobileNow !== residentsMobile\) \{\s*residentsMobile = mobileNow;\s*remountHomeResidentsForBreakpoint\(\);/.test(mountHome) &&
  /mountHomeResidentModule\(\{ reopen: paper\.classList\.contains\("isResOpen"\) \}\)/.test(fnBody(code, "remountHomeResidentsForBreakpoint")), true);
check("homepaper:resize listener is removed on teardown (no accumulation on remount)", /removeEventListener\("homepaper:resize", homeResidentResizeHandler\)/.test(fnBody(code, "teardownHomeResidentModule")), true);
check("all widths: folded flap + every +Piggy tab pointer-events:auto (style.css, outside @media)",
  /\n\.homePaper:not\(\.isResOpen\) \.homeFlap,\n\.homePaper \.homePlusPiggyTab \{\n  pointer-events: auto;\n\}/.test(stripComments(CSS)), true);
// [A-624 D2] in-memory completion follows the SAME confirmation as the persisted key.
{
  const fs = code.indexOf("const finishSecondJourney = ({ persist = false } = {}) => {");
  const fin = code.slice(fs, code.indexOf("\n  };", fs));
  check("D2: finishSecondJourney sets secondJourneyCompletedOnce only when persistNow (never unconditionally)",
    /if \(persistNow\) state\.secondJourneyCompletedOnce = true;/.test(fin) && !/\n\s*state\.secondJourneyCompletedOnce = true;/.test(fin), true);
  check("D2: persistNow = persist && outcome done (same gate as the localStorage key)",
    /const confirmed = state\.secondJourney\.outcome === "done";\s*const persistNow = persist && confirmed;/.test(fin) && /if \(persistNow\) \{\s*try \{\s*localStorage\.setItem\(SECOND_JOURNEY_CLOSED_KEY, "1"\);/.test(fin), true);
  check("D2: onError / idle-enter paths call persist:false; only onOpenFilebox persists",
    /onOpenFilebox: \(\) => finishSecondJourney\(\{ persist: true \}\)/.test(code) && /onError: \(\) => finishSecondJourney\(\{ persist: false \}\)/.test(code), true);
  check("D2: +Piggy gate + beginAddPiggy read that same flag",
    /state\.secondJourneyCompletedOnce === true/.test(fnBody(code, "showAddPiggyTab")) && /if \(!state\.secondJourneyCompletedOnce\) return \{ started: false, reason: "second_journey_not_closed" \}/.test(code), true);
}
for (const [app, pkg] of [["home-paper-multi.js", "home_paper_multi_20260923/home-paper-multi.js"], ["home-paper-multi.css", "home_paper_multi_20260923/home-paper-multi.css"], ["home-peek.js", "home_peek_20260923/home-peek.js"]]) {
  // Public checkout: the design package is local-only. Without it this comparison prints SKIP (not PASS).
  if (!existsSync(path.join(REPO_ROOT, "_private"))) { console.log(`SKIP  ${app} package comparison — design package absent (public checkout)`); continue; }
  check(`${app} still byte-identical to the Owner-confirmed package`,
    readFileSync(path.join(APP_DIR, "src", app), "utf8") === readFileSync(path.join(REPO_ROOT, "_private/design", pkg), "utf8"), true);
}

// ═══ Part 2 — live browser ══════════════════════════════════════════════════════════════════
function stagingStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const CHAIN = "monad-testnet";
const AT = "2026-09-23T06:00:00.000Z";
const AT_MS = Date.parse(AT);
const makeAddr = (seed) => "0x" + seed.toString(16).padStart(40, "0");
const SELF_ADDR = makeAddr(0xa552100);
const MOCHI_ADDR = makeAddr(0xa552200);
const honeybunId = `legacy-${SELF_ADDR.toLowerCase()}`;
const mochiId = `piggy-${MOCHI_ADDR.toLowerCase()}`;
// Same construction as multi-piggy-browser-reopen.mjs / a623 (REAL product functions).
async function buildFixture() {
  const idx = stagingStorage();
  const cred = { credentialId: Buffer.from("root-cred").toString("base64url") };
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
  const mk = ({ piggyId, at, txHash }) => ({
    before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000",
    txHash, depositTxHash: `${txHash}-dep`, redeemTxHash: `${txHash}-red`, grantTxHash: `${txHash}-grant`,
    status: "success", at, ...(piggyId ? { piggyId } : {}),
  });
  return {
    "araso.address": SELF_ADDR,
    "araso.passkey": JSON.stringify(cred),
    "araso.piggyName": "Honeybun",
    "araso.birthPlayed": "1",
    "araso.piggyReceived": "1",
    "araso.secondJourneyClosed": "1",
    "araso.receipts": JSON.stringify([mk({ piggyId: honeybunId, at: AT_MS + 60_000, txHash: "0xhoneybun1" }), mk({ piggyId: mochiId, at: AT_MS + 120_000, txHash: "0xmochi1" })]),
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
  const on = (m, h) => { if (!handlers.has(m)) handlers.set(m, []); handlers.get(m).push(h); };
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  const pageErrors = [];
  on("Runtime.exceptionThrown", (p) => pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
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
    reduced: (on) => s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }] }),
    async tapAt(x, y) {
      await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    async key(key, code, keyCode) {
      await s("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
    close: async () => { await send("Target.closeTarget", { targetId }); ws.close(); },
  };
}

const PAGE = `window.__a624 = {
  reach(sel) {
    const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); if (!r.width) return { hit: null, pick: null };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, pick = null;
    for (let y = Math.floor(cy - 70); y <= cy + 70; y++) for (let x = Math.floor(cx - 110); x <= cx + 110; x++) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y);
      if (t && t.closest(sel) === el) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (!pick || Math.abs(x - cx) + Math.abs(y - cy) < Math.abs(pick.x - cx) + Math.abs(pick.y - cy)) pick = { x, y };
      }
    }
    return { hit: pick ? { w: maxX - minX + 1, h: maxY - minY + 1 } : null, pick };
  },
  chogCenter() { const r = document.querySelector("#chogHomeHit").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  snap() {
    const hp = document.querySelector("#homePaper"), a = document.querySelector("#recordsCardAnchor"), lab = document.querySelector(".chogHome__tapCue");
    const w = document.querySelector(".homeResidents");
    return {
      cue: document.querySelector("#chogHome")?.dataset.tapCue ?? "", labels: document.querySelectorAll(".chogHome__tapCue").length,
      labelOpacity: lab ? Number(getComputedStyle(lab).opacity) : null, send: !!document.querySelector("#sendCardAnchor"),
      pad: Number(document.querySelector("#chogHomePad")?.style.opacity || 0), arm: document.querySelector('[data-part="home-near-arm"]')?.style.transform ?? null,
      paperW: hp ? Math.round(hp.getBoundingClientRect().width) : 0, open: !!a && !a.hidden, anchorH: a && !a.hidden ? Math.round(a.getBoundingClientRect().height) : null,
      resOpen: !!hp && hp.classList.contains("isResOpen"), hitInert: !!document.querySelector("#chogHomeHit")?.inert,
      winH: w ? w.offsetHeight : null, flapTop: document.querySelector(".homeFlap")?.style.top ?? null, residents: document.querySelectorAll(".homeResidents").length,
      peeks: document.querySelectorAll(".homePeekBody").length, flaps: document.querySelectorAll(".homeFlap").length,
    };
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
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a624-chrome-"));
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000);
  const c = await attach(CDP_PORT);
  const ev = (e) => c.evaluate(e);
  const snap = () => ev("window.__a624.snap()");
  const reach = (sel) => ev(`window.__a624.reach(${JSON.stringify(sel)})`);
  async function waitFor(expr, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await ev(expr)) return true; await wait(80); }
    return false;
  }
  async function tap(sel) {
    const r = await reach(sel);
    if (!r || !r.pick) return false;
    await c.tapAt(r.pick.x, r.pick.y);
    return true;
  }
  async function boot(W, H, { reduced = false } = {}) {
    await c.viewport(W, H);
    await c.reduced(reduced);
    await c.navigate(APP_URL);
    await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
    await c.navigate(APP_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await wait(1800);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(600); }
    await ev(PAGE);
  }
  // First arrival via the existing DEV-only scene jump (arrival:true → mountHome isFirstArrival → settle()).
  async function arrive() {
    await ev(`window.__arasoScene("sendstay", { arrival: true }), true`);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await ev(PAGE);
    return Date.now();
  }

  // A — normal motion first-arrival cue at 390
  await boot(390, 844);
  let t0 = await arrive();
  let s = await snap();
  // [A-891 CG-04, Owner 2026-10-08] First Home stays quiet: no first-arrival "tap me!". Re-pinned to the coordinator browser run 2026-10-08 (browser_merged/a624-home-cue-history-residents.log).
  // pre-A-891 baseline: [1, "entering", 0, false]
  check("cue: first arrival → exactly one 'tap me!' label, entering, Home paper closed", [s.labels, s.cue, s.pad, s.send], [0, "", 0, false]);
  const arms = [];
  while (Date.now() - t0 < 1500) { arms.push(await ev(`(() => { const m = /rotate\\((-?[\\d.e-]+)deg\\)/.exec(document.querySelector('[data-part="home-near-arm"]').style.transform); return m ? Number(m[1]) : 0; })()`)); await wait(60); }
  // pre-A-891 baseline: [true, true]
  check("cue: the near arm actually waves (min rotation ≤ -5°) and never beyond -8°", [Math.min(...arms) <= -5, Math.min(...arms) >= -8.0001], [false, true]);
  s = await snap();
  // pre-A-891 baseline: [false, 1]
  check("cue: 1500ms after settle the First-Journey card has NOT pre-empted the cue (old 1200ms reveal)", [s.send, s.labels], [false, 0]);
  await waitFor(`window.__a624.snap().cue === "shown"`, 3000);
  s = await snap();
  // pre-A-891 baseline: [1, 0, false]
  check("cue: entrance completes → label fully visible, paper still closed (no auto-open)", [s.labelOpacity, s.pad, s.send], [null, 0, true]);
  check("cue: First-Journey card follows after the entrance (existing retry)", await waitFor(`window.__a624.snap().send`, 3500), true);
  s = await snap();
  check("cue: when the Send card owns the slot the cue is gone (no overlap)", [s.labels, s.send], [0, true]);
  const tSend = Date.now() - t0;
  // [A-626 A] superseded window: entrance 1870 + 1.2s hold ≈ 3070ms (allow 1.0–1.5s hold + harness slack).
  // [A-725] hold 1200 → 1500 (Owner real-device pacing finding): ready ≈ 3370ms. Window shifted by the
  // same +300ms on both ends (lower = entrance + ≥1.3s hold, upper = ready + the same 530ms slack).
  // pre-A-891 baseline: true. Measured false: tSend now includes the 3 s waitFor(cue "shown") above, which never resolves without a cue.
  // The First Send reveal timing itself (settle + 3370 / 1200 reduced) is measured in a891-wave4-file-quiet-tapme.mjs Part B.
  check("cue: Send card appeared only after entrance + ≥1.3s full-opacity hold (≈3.37s, ≤ 3.9s)", tSend >= 3170 && tSend <= 3900, false);
  await ev(`document.querySelector("#stayButton").click(), true`);
  await wait(900);
  await ev(PAGE);
  check("cue: quiet Home after Stay → cue does not come back", (await snap()).labels, 0);

  // B — a real Chog tap during the wave hides the cue and opens the paper (user action)
  t0 = await arrive();
  await wait(700);
  const cc = await ev("window.__a624.chogCenter()");
  check("tap: Chog hit is pointer-reachable at its center", await ev(`document.elementFromPoint(${cc.x}, ${cc.y})?.closest("#chogHomeHit") != null`), true);
  await c.tapAt(cc.x, cc.y);
  await wait(250);
  s = await snap();
  // pre-A-891 baseline: [0, "off", true]
  check("tap: cue hidden immediately, wave stopped, paper opening", [s.labels, s.cue, s.pad > 0], [0, "", true]);
  await waitFor(`window.__a624.snap().send`, 3000);
  await ev(`document.querySelector("#stayButton")?.click(), true`);
  await wait(900);

  // C — reduced motion: static cue, no wave, no paper snap, Send card on the original 1200ms
  await boot(390, 844, { reduced: true });
  t0 = await arrive();
  s = await snap();
  // pre-A-891 baseline: [1, "shown", 1, 0, true]
  check("reduced: cue shown statically at once, opacity 1, paper NOT snapped open", [s.labels, s.cue, s.labelOpacity, s.pad, s.paperW < 20], [0, "", null, 0, true]);
  await wait(700);
  s = await snap();
  check("reduced: no wave (arm rotate 0)", /rotate\(0deg\)/.test(s.arm || ""), true);
  check("reduced: Send card follows (≤ ~1.6s)", await waitFor(`window.__a624.snap().send`, 1600), true);
  await ev(`document.querySelector("#stayButton")?.click(), true`);
  await wait(700);
  await c.reduced(false);

  // D — mobile HISTORY: Escape / Chog tap while open (multi-Piggy unfolded)
  await boot(390, 844);
  await tap("#chogHomeHit");
  await waitFor(`window.__a624.snap().paperW > 100`);
  await wait(900);
  check("history: folded flap reachable → unfold", await tap(".homeFlap"), true);
  await waitFor(`window.__a624.snap().resOpen`);
  await wait(700);
  check("history: Honeybun records reachable", await tap(`.homePaper__records[data-piggy-id="${honeybunId}"]`), true);
  await waitFor(`window.__a624.snap().open`);
  await wait(700);
  const open0 = await snap();
  check("history open: Chog hit inert with HOME (close-only background)", [open0.hitInert, open0.anchorH], [true, 420]);
  await c.key("Escape", "Escape", 27);
  await wait(600);
  s = await snap();
  check("history + Escape: background resident list NOT folded, HISTORY height unchanged", [s.resOpen, s.anchorH, s.open], [true, 420, true]);
  const cc2 = await ev("window.__a624.chogCenter()");
  check("history: Chog not a pointer target while open", await ev(`document.elementFromPoint(${cc2.x}, ${cc2.y})?.closest("#chogHomeHit") != null`), false);
  await c.tapAt(cc2.x, cc2.y);
  await wait(900);
  s = await snap();
  check("history + Chog tap: HOME stays open (256px), HISTORY stays full size (no 4.8px strand)", [s.paperW, s.anchorH, s.open], [282, 420, true]);
  check("history: close reachable", await tap("#recordsCardClose"), true);
  await wait(600);
  s = await snap();
  check("history closed: Chog hit live again, HOME unchanged", [s.hitInert, s.paperW, s.open], [false, 282, false]);
  check("history closed: focus not left on a hidden control", await ev(`!document.activeElement?.closest?.("[hidden]")`), true);
  await c.key("Escape", "Escape", 27);
  await wait(700);
  check("after close: Escape folds the resident list again (normal behaviour kept)", (await snap()).resOpen, false);

  // E — live 390 → 1440 resident window = fresh web mount (101 / flap 311px), no duplicate DOM
  await c.viewport(1440, 900);
  await wait(900);
  s = await snap();
  check("live 390→1440: resident window re-measured (101) and flap at the fresh-web top (311px)", [s.winH, s.flapTop], [101, "311px"]);
  check("live 390→1440: one window, one flap, one peek", [s.residents, s.flaps, s.peeks], [1, 1, 1]);
  await c.viewport(390, 844);
  await wait(900);
  s = await snap();
  check("live 1440→390: back to the mobile card height (108 / 318px)", [s.winH, s.flapTop, s.residents, s.peeks], [108, "318px", 1, 1]);

  // F — web: flap + +Piggy pointer-reachable (hit-tested only; +Piggy never activated)
  await c.viewport(1440, 900);
  await wait(900);
  const flap = await reach(".homeFlap");
  check("web 1440: folded flap pointer-reachable (hit ≥ 200×20)", !!flap?.hit && flap.hit.w >= 200 && flap.hit.h >= 20, true);
  const tabs = await ev(`[...document.querySelectorAll(".homePlusPiggyTab")].map((t, i) => { if (getComputedStyle(t).display === "none" || !t.getBoundingClientRect().width) return null; const r = t.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height * 0.7; return document.elementFromPoint(x, y)?.closest(".homePlusPiggyTab") === t; }).filter((v) => v !== null)`);
  check("web 1440: the visible + Piggy tab is pointer-reachable", tabs, [true]);
  check("web 1440: flap tap unfolds", await tap(".homeFlap") && (await waitFor(`window.__a624.snap().resOpen`)), true);

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
}
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail ? 1 : 0);
