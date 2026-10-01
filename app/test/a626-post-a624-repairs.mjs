// [A-626] POST-A624 SMALL PRODUCT REPAIRS — focused regression test.
//   node app/test/a626-post-a624-repairs.mjs
//
// Part 1 (no browser): A cue hold timing (pure TAP_CUE_TIMING) + reveal wiring; B additional-Piggy
//   Name-it enters the existing "name" phase with an EMPTY value (no new copy, first-Piggy path
//   unchanged); C secondCompletedThisSession follows the confirmed completion (persistNow) like
//   secondJourneyCompletedOnce; D Chog hit inert while HISTORY open at every width, HOME mount inert
//   still mobile-only; E +Piggy activation (the single onAdd owner) is a no-op unless the Home paper
//   is visibly open.
// Part 2 (LIVE, real Vite dev + headless Chrome over CDP, Honeybun/Mochi fixture with the persisted
//   Second-closed key): web 1440 HISTORY + Chog pointer/Enter/Space = no-op, identity switch via
//   Mochi records still works, close restores Chog; closed Home paper: +Piggy keyboard Enter starts
//   NO credential request; open paper: +Piggy pointer still starts exactly one (positive control —
//   the request fails in this authenticator-less Chrome; nothing is created, no tx).
// Real taps = Input.dispatchMouseEvent at elementFromPoint-verified points. No WebAuthn created.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";
import { TAP_CUE_TIMING, tapCueFrame } from "../src/chog-home.js";
import { nameCardMarkup } from "../src/name-card.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
const VITE_PORT = 5626;
const CDP_PORT = 9626;
const APP_URL = `http://127.0.0.1:${VITE_PORT}/`;
const HARD_TIMEOUT_MS = 120_000;

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  return ok;
}

// ═══ Part 1 ═════════════════════════════════════════════════════════════════════════════════
const MAIN = readFileSync(path.join(APP_DIR, "src/main.js"), "utf8");
const CHOG = readFileSync(path.join(APP_DIR, "src/chog-home.js"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = stripComments(MAIN);
const chog = stripComments(CHOG);
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

// A — cue hold
check("A: hold = 1200ms, ready = entrance 1870 + 1200 = 3070ms", [TAP_CUE_TIMING.holdMs, TAP_CUE_TIMING.readyMs], [1200, 3070]);
check("A: wave keys/entrance unchanged from A-624", [TAP_CUE_TIMING.entranceMs, TAP_CUE_TIMING.waveKeys], [1870, [[0, 0], [350, -7], [550, -4], [770, -8], [960, -4], [1320, 0]]]);
check("A: label stays full opacity through the hold (1870…3070)", [tapCueFrame(1870).labelOpacity, tapCueFrame(2500).labelOpacity, tapCueFrame(3069).labelOpacity], [1, 1, 1]);
check("A: tapCueHoldRemainingMs getter = 0 for reduced/hidden/none, readyMs − t otherwise",
  /get tapCueHoldRemainingMs\(\) \{\s*if \(!tapCue \|\| tapCue\.hidden \|\| reduced\) return 0;\s*return Math\.max\(0, TAP_CUE_TIMING\.readyMs - tapCue\.t\);/.test(chog), true);
check("A: cue clock only advances with painted-frame dt (hidden tab dt 0)", /const dt = last && !document\.hidden \? Math\.min\(now - last, 50\) : 0;/.test(chog) && /tapCue\.t \+= dt;/.test(chog), true);

// B — additional Piggy Name-it
const renderName = fnBody(code, "renderName");
check("B: pendingNamePiggyId → { phase: \"name\", name: \"\" }; first Piggy keeps nameResumed/readPiggyName",
  /state\.pendingNamePiggyId\s*\?\s*\{ phase: "name", name: "" \}\s*:\s*\{ phase: state\.nameResumed \? "name" : "arrival", name: readPiggyName\(\) \}/.test(renderName), true);
{
  const t = document_free(nameCardMarkup({ phase: "name", name: "" }));
  check("B: name-phase markup = data-phase name, empty value, existing 'name it?' title, no new copy",
    [t.includes('data-phase="name"'), /id="piggyNameInput"[^>]*value=""/.test(t), t.includes("name it?")], [true, true, true]);
}
function document_free(s) { return String(s); }
check("B: save for an added Piggy still renames only that Piggy and returns Home (unchanged branch)",
  /if \(state\.pendingNamePiggyId\) \{\s*const id = state\.pendingNamePiggyId;\s*state\.pendingNamePiggyId = null;\s*try \{ renameIndexedPiggy\(safeLocalStorage\(\), secondJourneyScope\(\)\.chainId, \{ id, name \}\); \} catch \{\}\s*setScene\("sendstay", "", ""\);/.test(code), true);

// C — Journey number
{
  const fs = code.indexOf("const finishSecondJourney = ({ persist = false } = {}) => {");
  const fin = code.slice(fs, code.indexOf("\n  };", fs));
  check("C: secondCompletedThisSession set only when persistNow (never unconditionally)",
    /if \(persistNow\) state\.secondCompletedThisSession = true;/.test(fin) && !/\n\s*state\.secondCompletedThisSession = true;/.test(fin), true);
  check("C: journeyNumber formula unchanged", /const journeyNumber = 1 \+ \(state\.tripClosed \? 1 : 0\) \+ \(state\.secondCompletedThisSession \? 1 : 0\);/.test(code), true);
}

// D — Chog hit inert at every width while HISTORY open
// [A-662] "mobile" → "stackedMode" (geometry-fit decision, computeHistoryFitMode()), same contract.
const sync = fnBody(code, "syncRecordsViewportState");
check("D: chogHit.inert = open (all widths); HOME mount inert = open && stackedMode (side-by-side Home live)",
  /if \(chogHit && chogHit\.inert !== open\) chogHit\.inert = open;/.test(sync) && /const background = open && stackedMode;/.test(sync), true);

// E — +Piggy activation only with a visibly open Home paper
check("E: onAdd returns early unless homePaperVisiblyOpen()",
  /onAdd: \(\) => \{\s*if \(!homePaperVisiblyOpen\(\)\) return;\s*beginAddPiggy\(\)/.test(code), true);
check("E: homePaperVisiblyOpen() reads chog-home progress ≥ 0.99", /const progress = homeChog\?\.state\?\.progress;\s*return typeof progress === "number" && progress >= 0\.99;/.test(fnBody(code, "homePaperVisiblyOpen")), true);
check("E: no CSS change needed for pointer (all-width +Piggy pointer-events rule from A-624 kept)",
  /\.homePaper \.homePlusPiggyTab \{\n  pointer-events: auto;\n\}/.test(stripComments(readFileSync(path.join(APP_DIR, "src/style.css"), "utf8"))), true);

// ═══ Part 2 — live ══════════════════════════════════════════════════════════════════════════
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
async function buildFixture() {
  const idx = stagingStorage();
  const cred = { credentialId: Buffer.from("root-cred").toString("base64url") };
  const r1 = registerControlledPiggy(idx, CHAIN, { id: honeybunId, name: "Honeybun", address: SELF_ADDR, signerAddress: SELF_ADDR, locator: cred, at: AT });
  if (!r1.ok) throw new Error(`registerControlledPiggy: ${r1.reason}`);
  const r2 = await admitSequencedPiggy({ storage: idx, chainId: CHAIN, sequence: 1, rootCredential: cred, requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }), deriveAddress: () => MOCHI_ADDR, now: () => AT });
  if (!r2.ok) throw new Error(`admitSequencedPiggy: ${r2.reason}`);
  renameIndexedPiggy(idx, CHAIN, { id: mochiId, name: "Mochi" });
  const indexKey = `araso.myPiggiesIndex.v1.${CHAIN}`;
  const first = migrateSinglePiggy({ address: SELF_ADDR, name: "Honeybun", createdAt: AT });
  const born = createPiggy({ piggies: [first.piggy], newPiggy: { id: mochiId, name: null, address: MOCHI_ADDR }, at: AT });
  const reg = stagingStorage();
  const scope = { accountId: SELF_ADDR, chainId: CHAIN };
  saveRegistry(reg, scope, { piggies: born.piggies });
  const mk = ({ piggyId, at, txHash }) => ({ before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash, depositTxHash: `${txHash}-dep`, redeemTxHash: `${txHash}-red`, grantTxHash: `${txHash}-grant`, status: "success", at, piggyId });
  return {
    "araso.address": SELF_ADDR, "araso.passkey": JSON.stringify(cred), "araso.piggyName": "Honeybun", "araso.birthPlayed": "1", "araso.piggyReceived": "1", "araso.secondJourneyClosed": "1",
    "araso.receipts": JSON.stringify([mk({ piggyId: honeybunId, at: AT_MS + 60_000, txHash: "0xhoneybun1" }), mk({ piggyId: mochiId, at: AT_MS + 120_000, txHash: "0xmochi1" })]),
    [indexKey]: idx.getItem(indexKey), [piggyRegistryKey(scope)]: reg.getItem(piggyRegistryKey(scope)),
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
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result); }
    else if (msg.method) (handlers.get(msg.method) || []).forEach((h) => h(msg.params));
  };
  const send = (method, params = {}, sessionId) => { const id = seq++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); };
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
    async navigate(url) { const loaded = new Promise((r) => on("Page.loadEventFired", r)); await s("Page.navigate", { url }); await loaded; },
    async evaluate(expression) { const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("evaluate: " + JSON.stringify(r.exceptionDetails)); return r.result.value; },
    viewport: (width, height) => s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }),
    async tapAt(x, y) { await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); },
    async key(key, code, keyCode, text) { await s("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) }); await s("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode }); },
    close: async () => { await send("Target.closeTarget", { targetId }); ws.close(); },
  };
}

const PAGE = `window.__a626 = {
  reach(sel, idx = 0) {
    const el = document.querySelectorAll(sel)[idx]; if (!el) return null;
    const r = el.getBoundingClientRect(); if (!r.width) return { pick: null };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2; let pick = null;
    for (let y = Math.floor(r.top); y <= r.bottom; y++) for (let x = Math.floor(r.left); x <= r.right; x++) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y);
      if (t && t.closest(sel) === el && (!pick || Math.abs(x - cx) + Math.abs(y - cy) < Math.abs(pick.x - cx) + Math.abs(pick.y - cy))) pick = { x, y };
    }
    return { pick };
  },
  chog() { const r = document.querySelector("#chogHomeHit").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  snap() {
    const hp = document.querySelector("#homePaper"), a = document.querySelector("#recordsCardAnchor");
    return { paperW: hp ? Math.round(hp.getBoundingClientRect().width) : 0, open: !!a && !a.hidden, anchorW: a && !a.hidden ? Math.round(a.getBoundingClientRect().width) : null,
      identity: document.querySelector(".recordsCard__identityName")?.textContent.trim() ?? null, hitInert: !!document.querySelector("#chogHomeHit")?.inert,
      mountInert: !!document.querySelector(".homePaperMount")?.inert, gets: window.__gets ?? null, scene: document.querySelector("[data-scene]")?.dataset.scene ?? null };
  },
}; (() => { if (!window.__getsWrapped && navigator.credentials) { window.__gets = 0; const og = navigator.credentials.get.bind(navigator.credentials); navigator.credentials.get = (o) => { window.__gets++; return og(o); }; window.__getsWrapped = true; } })(); true`;

let viteProc = null;
let chromeProc = null;
let profileDir = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch { /* retry */ } await wait(200); }
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
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a626-chrome-"));
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000);
  const c = await attach(CDP_PORT);
  const ev = (e) => c.evaluate(e);
  const snap = () => ev("window.__a626.snap()");
  async function waitFor(expr, timeoutMs = 8000) { const d = Date.now() + timeoutMs; while (Date.now() < d) { if (await ev(expr)) return true; await wait(80); } return false; }
  async function tap(sel, idx = 0) { const r = await ev(`window.__a626.reach(${JSON.stringify(sel)}, ${idx})`); if (!r || !r.pick) return false; await c.tapAt(r.pick.x, r.pick.y); return true; }

  await c.viewport(1440, 900);
  await c.navigate(APP_URL);
  await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
  await c.navigate(APP_URL);
  await waitFor(`!!document.querySelector("#chogHomeHit")`);
  await wait(1800);
  if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(600); }
  await ev(PAGE);

  // E — closed paper: keyboard Enter on the (invisible) +Piggy tab starts nothing
  let s = await snap();
  check("E: Home paper visually closed at start (hand-size)", s.paperW < 20, true);
  const focused = await ev(`(() => { const t = [...document.querySelectorAll(".homePlusPiggyTab")].find((x) => getComputedStyle(x).display !== "none"); t?.focus(); return document.activeElement === t; })()`);
  await c.key("Enter", "Enter", 13, "\r");
  await wait(900);
  s = await snap();
  check("E: closed paper → +Piggy keyboard Enter makes NO credential request, stays on Home", [focused ? s.gets : "tab-not-focusable", s.scene], [focused ? 0 : "tab-not-focusable", "sendstay"]);

  // open the paper with a real Chog tap (probe-level: unfold residents)
  const cp = await ev("window.__a626.chog()");
  await c.tapAt(cp.x, cp.y);
  check("paper opens on a real Chog tap", await waitFor(`window.__a626.snap().paperW > 200`), true);
  await wait(900);
  check("web: flap tap unfolds", await tap(".homeFlap") && (await waitFor(`document.querySelector("#homePaper").classList.contains("isResOpen")`)), true);
  await wait(700);

  // D — web HISTORY + Chog tap
  check("web: Honeybun records reachable", await tap(`.homePaper__records[data-piggy-id="${honeybunId}"]`), true);
  await waitFor(`window.__a626.snap().open`);
  await wait(800);
  const open0 = await snap();
  check("D web: HISTORY open → Chog hit inert, HOME mount NOT inert", [open0.hitInert, open0.mountInert, open0.paperW, open0.anchorW], [true, false, 256, 256]);
  const cp2 = await ev("window.__a626.chog()");
  check("D web: Chog center is not a pointer target while HISTORY is open", await ev(`document.elementFromPoint(${cp2.x}, ${cp2.y})?.closest("#chogHomeHit") != null`), false);
  await c.tapAt(cp2.x, cp2.y);
  await wait(1000);
  await ev(`document.querySelector("#chogHomeHit")?.focus(), true`);
  check("D web: Chog hit cannot take focus while open", await ev(`document.activeElement?.id === "chogHomeHit"`), false);
  await c.key("Enter", "Enter", 13, "\r");
  await wait(500);
  await c.key(" ", "Space", 32, " ");
  await wait(900);
  s = await snap();
  check("D web: after Chog pointer/Enter/Space → HOME 256, HISTORY 256, still open (no 10px collapse)", [s.paperW, s.anchorW, s.open], [256, 256, true]);
  check("D web: identity switch via Mochi records still works (HOME live)", await tap(`.homePaper__records[data-piggy-id="${mochiId}"]`) && (await waitFor(`window.__a626.snap().identity === "Mochi"`)), true);

  // D — close restores Chog immediately
  check("D web: HISTORY close reachable", await tap("#recordsCardClose"), true);
  await wait(600);
  s = await snap();
  check("D web: after close → Chog hit live again, HOME unchanged", [s.open, s.hitInert, s.paperW], [false, false, 256]);

  // positive control — the visible +Piggy with an OPEN paper (HISTORY closed) still starts the existing
  // path once. (Its failure in this authenticator-less Chrome re-renders Home; run last.)
  const g0 = (await snap()).gets;
  const idx = await ev(`[...document.querySelectorAll(".homePlusPiggyTab")].findIndex((t) => getComputedStyle(t).display !== "none")`);
  check("E: open paper → visible +Piggy is pointer-reachable", await tap(".homePlusPiggyTab", Math.max(0, idx)), true);
  await wait(1200);
  s = await snap();
  check("E: open paper → +Piggy starts exactly one credential request (existing path intact)", s.gets - g0, 1);

  check("page errors = 0", c.pageErrors, []);
  await c.close();
}

const timeout = setTimeout(() => { console.error("FAIL  hard timeout"); cleanup(); process.exit(1); }, HARD_TIMEOUT_MS);
timeout.unref?.();
try { await live(); } catch (err) { fail += 1; console.error("FAIL  uncaught:", err && err.stack ? err.stack : err); } finally { clearTimeout(timeout); cleanup(); }
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail ? 1 : 0);
