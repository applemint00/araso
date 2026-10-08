// [A-628] HOME/HISTORY FULL-RENDER INVARIANT + CLOSED-FOCUS — focused regression test.
// [A-786 RE-PIN] Home paper is drawn x1.10 (style.css --homePaperK) so its measured width is 282 (256.338*1.1=281.97), and HISTORY derives its width from the live paper rect (main.js alignRecordsCardToHomePaper) = 282. Intended size change only. 
//   node app/test/a628-home-history-render-invariant.mjs
//
// Part 1 (no browser): source contracts.
//   A every full render() normalizes the transient HISTORY state (recordsCardVisible=false,
//     recordsDetailIndex=null, align loop stopped) BEFORE teardownScene()/new markup, through ONE
//     helper that setScene() shares; the no-render HISTORY paths (open/detail/list) still never
//     call render()/setScene().
//   B chog-home.js draw(): the Home pad is inert exactly while fully folded (progress 0 and
//     target 0); #chogHomeHit is a sibling outside the pad.
// Part 2 (LIVE, real Vite dev + headless Chrome over CDP, Honeybun/Mochi fixture with the persisted
//   Second-closed key):
//   1440 — HISTORY open → list/detail/back and Mochi identity switch stay open (no render); then the
//          existing +Piggy failure path (real pointer tap → beginAddPiggy() rejects → render()) leaves
//          a coherent closed Home: HISTORY hidden, Chog live, a Chog tap opens the full paper.
//   390  — same full render forced from an open HISTORY (programmatic +Piggy click; the mobile HOME is
//          inert while HISTORY is open) → HISTORY hidden, HOME/Chog live again.
//   closed paper (390 + 1440) — records / money stamp / flap / +Piggy cannot take focus and Enter does
//          nothing; #chogHomeHit takes focus; Enter on it opens the paper and the paper controls are
//          focusable again; Enter on records then opens a full-size HISTORY.
// Credential requests fail in this authenticator-less Chrome; nothing is created, no tx.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, markBornPiggyIssuance, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
const VITE_PORT = 5638;
const CDP_PORT = 9638;
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

// ═══ Part 1 ═════════════════════════════════════════════════════════════════════════════════
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = stripComments(readFileSync(path.join(APP_DIR, "src/main.js"), "utf8"));
const chog = stripComments(readFileSync(path.join(APP_DIR, "src/chog-home.js"), "utf8"));
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

const helper = fnBody(code, "resetRecordsForFullRender");
check("A: one shared helper closes HISTORY state + stops the align loop",
  /state\.recordsCardVisible = false;\s*state\.recordsDetailIndex = null;\s*stopRecordsAlignLoop\(\);/.test(helper), true);
const renderSrc = fnBody(code, "render");
check("A: render() normalizes FIRST — before teardownScene() and the new markup",
  /^function render\(\) \{\s*resetRecordsForFullRender\(\);\s*teardownScene\(\);/.test(renderSrc), true);
const setSceneSrc = fnBody(code, "setScene");
check("A: setScene() uses the same helper (equivalent: still before homePaperMode/scene/render)",
  /resetRecordsForFullRender\(\);\s*state\.homePaperMode = "home";\s*state\.scene = scene;\s*state\.message = message;\s*state\.detail = detail;\s*render\(\);/.test(setSceneSrc), true);
check("A: the helper is the only writer of the full-render reset (no per-call-site copies at +Piggy)",
  (code.match(/beginAddPiggy\(\)\.then\(\(\) => render\(\)\)\.catch\(\(\) => render\(\)\);/g) || []).length, 2);
check("A: no-render HISTORY paths still never call render()/setScene()",
  ["openRecordsCard", "showRecordDetail", "showRecordsList", "renderRecordsCardBody"].map((n) => /\brender\(\)|setScene\(/.test(fnBody(code, n))),
  [false, false, false, false]);

check("B: pad inert exactly while fully folded (progress 0 and target 0), set only on change",
  /const folded = progress === 0 && target === 0;\s*if \(pad\.inert !== folded\) pad\.inert = folded;/.test(chog), true);
check("B: #chogHomeHit stays a sibling after the pad (not inside the inert subtree)",
  /<div class="chogHome__padWrap" id="chogHomePad">\$\{padMarkup \|\| `<img src="\$\{DIR\}\/notepad\.png" alt="" \/>`\}<\/div>\s*<div class="chogHome__hit" id="chogHomeHit" role="button" tabindex="0" aria-label="Chog"><\/div>/.test(chog), true);

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
  // [A-705 follow-up] fixture re-seed: A-695 provenance. The real birth path (main.js indexControlledPiggy) stamps provenance;
  // node-seeding the first Piggy must do the same or checkOriginDeviceIndex refuses +Piggy before PRF.
  const rb = markBornPiggyIssuance(idx, CHAIN, { address: SELF_ADDR });
  if (!rb.ok) throw new Error(`markBornPiggyIssuance: ${rb.reason}`);
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

const PAGE = `window.__a628 = {
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
      detail: !!document.querySelector("#recordsCardBody .recordsCard__detailRows"),
      identity: document.querySelector(".recordsCard__identityName")?.textContent.trim() ?? null, hitInert: !!document.querySelector("#chogHomeHit")?.inert,
      mountInert: !!document.querySelector(".homePaperMount")?.inert, padInert: !!document.querySelector("#chogHomePad")?.inert,
      gets: window.__gets ?? null, scene: document.querySelector("[data-scene]")?.dataset.scene ?? null };
  },
  focusable(sel) {
    const els = [...document.querySelectorAll(sel)].filter((x) => getComputedStyle(x).display !== "none");
    if (!els.length) return null;
    return els.map((e) => { e.focus(); const ok = document.activeElement === e; e.blur(); return ok; });
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
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a628-chrome-"));
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000);
  const c = await attach(CDP_PORT);
  const ev = (e) => c.evaluate(e);
  const snap = () => ev("window.__a628.snap()");
  async function waitFor(expr, timeoutMs = 8000) { const d = Date.now() + timeoutMs; while (Date.now() < d) { if (await ev(expr)) return true; await wait(80); } return false; }
  async function tap(sel, idx = 0) { const r = await ev(`window.__a628.reach(${JSON.stringify(sel)}, ${idx})`); if (!r || !r.pick) return false; await c.tapAt(r.pick.x, r.pick.y); return true; }
  async function home(w, h) {
    await c.viewport(w, h);
    await c.navigate(APP_URL);
    await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
    await c.navigate(APP_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await wait(1800);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(700); }
    await ev(PAGE);
  }
  async function chogTapOpens() { const cp = await ev("window.__a628.chog()"); await c.tapAt(cp.x, cp.y); const ok = await waitFor(`window.__a628.snap().paperW > 200`); await wait(800); return ok; }
  const visiblePlus = `[...document.querySelectorAll(".homePlusPiggyTab")].findIndex((t) => getComputedStyle(t).display !== "none" && t.getBoundingClientRect().width > 20)`;

  // ── 1440: no-render HISTORY behaviour, then a real full render from an open HISTORY ──
  await home(1440, 900);
  check("1440: Chog tap opens the Home paper", await chogTapOpens(), true);
  check("1440: flap unfolds the residents", (await tap(".homeFlap")) && (await waitFor(`document.querySelector("#homePaper").classList.contains("isResOpen")`)), true);
  await wait(700);
  check("1440: Honeybun records opens HISTORY", (await tap(`.homePaper__records[data-piggy-id="${honeybunId}"]`)) && (await waitFor(`window.__a628.snap().open`)), true);
  await wait(800);
  let s = await snap();
  check("1440 open: HISTORY 256 beside a 256 Home paper, Chog inert", [s.open, s.paperW, s.anchorW, s.hitInert], [true, 376, 376, true]); // pre-A-833 baseline: [true, 282, 282, true] (v10 card at 1440x900 = 376)
  check("1440 no-render: row → detail stays open", (await tap(".recordsCard__row")) && (await waitFor(`window.__a628.snap().detail`)) && (await snap()).open, true);
  check("1440 no-render: back → list stays open", (await tap("#recordsCardBack")) && (await waitFor(`!window.__a628.snap().detail`)) && (await snap()).open, true);
  check("1440 no-render: Mochi records switches identity, HISTORY stays open", (await tap(`.homePaper__records[data-piggy-id="${mochiId}"]`)) && (await waitFor(`window.__a628.snap().identity === "Mochi"`)) && (await snap()).open, true);
  check("1440 no-render: detail again before the full render", (await tap(".recordsCard__row")) && (await waitFor(`window.__a628.snap().detail`)), true);
  s = await snap();
  check("1440 no-render: Home paper still 256 after list/detail/identity (no remount)", [s.paperW, s.open], [376, true]); // pre-A-833 baseline: [282, true]
  const g0 = s.gets;
  const pi = await ev(visiblePlus);
  check("1440: visible +Piggy is pointer-reachable while HISTORY is open (web HOME live)", await tap(".homePlusPiggyTab", Math.max(0, pi)), true);
  await wait(1500);
  s = await snap();
  check("1440 full render (+Piggy failure path) actually ran: 1 credential request, still Home", [s.gets - g0, s.scene], [1, "sendstay"]);
  check("1440 after full render: HISTORY closed (no hand-size HISTORY), no detail left", [s.open, s.anchorW, s.detail], [false, null, false]);
  check("1440 after full render: coherent closed Home — folded paper, Chog live, HOME not inert", [s.paperW < 20, s.hitInert, s.mountInert, s.padInert], [true, false, false, true]);
  check("1440 after full render: a Chog tap opens the full paper; HISTORY stays closed", [await chogTapOpens(), (await snap()).open], [true, false]);

  // ── 390: forced full render from an open HISTORY (mobile HOME is inert while open) ──
  await home(390, 844);
  check("390: Chog tap opens the Home paper", await chogTapOpens(), true);
  let hb = await tap(`.homePaper__records[data-piggy-id="${honeybunId}"]`);
  if (!hb) { await tap(".homeFlap"); await wait(800); hb = await tap(`.homePaper__records[data-piggy-id="${honeybunId}"]`); }
  check("390: Honeybun records opens HISTORY", hb && (await waitFor(`window.__a628.snap().open`)), true);
  await wait(800);
  check("390 no-render: row → detail stays open", (await tap(".recordsCard__row")) && (await waitFor(`window.__a628.snap().detail`)) && (await snap()).open, true);
  s = await snap();
  check("390 open: HOME + Chog inert (close-only, A-623/A-624)", [s.open, s.mountInert, s.hitInert], [true, true, true]);
  const g1 = s.gets;
  const pi2 = await ev(visiblePlus);
  await ev(`document.querySelectorAll(".homePlusPiggyTab")[${Math.max(0, pi2)}].click(), true`);
  await wait(1500);
  s = await snap();
  check("390 forced full render ran (1 credential request)", s.gets - g1, 1);
  check("390 after full render: HISTORY closed, no detail; HOME and Chog live; paper folded", [s.open, s.detail, s.mountInert, s.hitInert, s.paperW < 20], [false, false, false, false, true]);
  check("390 after full render: a Chog tap opens the full paper; HISTORY stays closed", [await chogTapOpens(), (await snap()).open], [true, false]);

  // ── closed paper keyboard surface (390 + 1440) and open-paper positive controls ──
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await home(w, h);
    s = await snap();
    check(`${w} closed: paper folded, pad inert, HISTORY closed`, [s.paperW < 20, s.padInert, s.open], [true, true, false]);
    const fz = {};
    for (const sel of [".homePaper__records", "#homePaperMoneyToggle", ".homeFlap", ".homePlusPiggyTab"]) fz[sel] = await ev(`window.__a628.focusable(${JSON.stringify(sel)})`);
    check(`${w} closed: records / money stamp / flap / +Piggy take no focus`, Object.values(fz).map((v) => (v || []).some(Boolean)), [false, false, false, false]);
    await ev(`document.querySelector('.homePaper__records[data-piggy-id="${honeybunId}"]').focus(), true`);
    await c.key("Enter", "Enter", 13, "\r");
    await wait(700);
    s = await snap();
    check(`${w} closed: Enter after focusing hidden records opens nothing (no hand-size HISTORY)`, [s.open, s.gets, (await ev(`document.querySelector("#homePaper").dataset.paperMode`))], [false, 0, "home"]);
    check(`${w} closed: #chogHomeHit takes focus`, await ev(`(() => { const h = document.querySelector("#chogHomeHit"); h.focus(); return document.activeElement === h; })()`), true);
    await c.key("Enter", "Enter", 13, "\r");
    check(`${w}: Enter on Chog opens the paper`, await waitFor(`window.__a628.snap().paperW > 200`), true);
    await wait(700);
    s = await snap();
    check(`${w} open: pad live, paper controls focusable again`, [s.padInert, (await ev(`window.__a628.focusable(".homePaper__records")`) || []).some(Boolean), (await ev(`window.__a628.focusable("#homePaperMoneyToggle")`) || []).some(Boolean)], [false, true, true]);
    let rf = await ev(`(() => { const e = document.querySelector('.homePaper__records[data-piggy-id="${honeybunId}"]'); if (!e || !e.getBoundingClientRect().width) return false; e.focus(); return document.activeElement === e; })()`);
    if (!rf) { await tap(".homeFlap"); await wait(800); rf = await ev(`(() => { const e = document.querySelector('.homePaper__records[data-piggy-id="${honeybunId}"]'); e.focus(); return document.activeElement === e; })()`); }
    await c.key("Enter", "Enter", 13, "\r");
    await waitFor(`window.__a628.snap().open`);
    await wait(700);
    s = await snap();
    check(`${w} open: keyboard Enter on records opens a full-size HISTORY`, [rf, s.open, s.anchorW, s.paperW], w === 1440 ? [true, true, 376, 376] : [true, true, 282, 282]); // pre-A-833 baseline: [true, true, 282, 282] at both widths (v10 card: 1440x900 = 376, 390x844 = 283)
    check(`${w}: HISTORY close still reachable`, await tap("#recordsCardClose"), true);
    await wait(600);
    s = await snap();
    check(`${w}: after close → HISTORY closed, Chog live`, [s.open, s.hitInert], [false, false]);
  }

  check("page errors = 0", c.pageErrors, []);
  await c.close();
}

const timeout = setTimeout(() => { console.error("FAIL  hard timeout"); cleanup(); process.exit(1); }, HARD_TIMEOUT_MS);
timeout.unref?.();
try { await live(); } catch (err) { fail += 1; console.error("FAIL  uncaught:", err && err.stack ? err.stack : err); } finally { clearTimeout(timeout); cleanup(); }
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail ? 1 : 0);
