// [A-623] MOBILE HOME/RECORDS CODE-VERIFIED CLOSE — focused regression test.
//   node app/test/a623-mobile-records-close.mjs
//
// Part 1 (source contract, no browser): one owner (syncRecordsViewportState) for the
//   viewport-dependent "Records open" state (web two-card shift / mobile HOME inert), re-run by
//   every alignRecordsCardToHomePaper(); mobile close-only guard in handleHomePaperMountClick();
//   mobile-only CSS (resident records size/hit, flap pointer-events, secondary-line contrast);
//   web base rules unchanged.
// Part 2 (LIVE browser, real Vite + headless Chrome over CDP, no test hooks in the app): the
//   Honeybun/Mochi fixture built with the REAL product functions exactly like
//   multi-piggy-browser-reopen.mjs (A-552), seeded into the real window.localStorage. Every tap is
//   a real Input.dispatchMouseEvent at a point where elementFromPoint hits the target (no
//   el.click()). Covers: pointer reachability + ≥44px hits for both resident records entries at
//   390/430, Honeybun → HISTORY → background Mochi records inert to pointer AND keyboard (no
//   replay, no identity change), a LIVE 640px breakpoint transition while open (390 → 1440 →
//   641 → 640 → 390: shift class/inert/HOME rect follow the current width), close restores
//   HOME, Mochi opens the same single HISTORY surface with Mochi rows.
// No WebAuthn ceremony anywhere (0 create/get). Hard timeout 120s; Chrome + Vite always killed.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
const VITE_PORT = 5623;
const CDP_PORT = 9623;
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
const near = (a, b, tol = 0.6) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

// ═══ Part 1 — source contract ═══════════════════════════════════════════════════════════════
const MAIN = readFileSync(path.join(APP_DIR, "src/main.js"), "utf8");
const CSS = readFileSync(path.join(APP_DIR, "src/style.css"), "utf8");
const MULTI_CSS = readFileSync(path.join(APP_DIR, "src/home-paper-multi.css"), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}
const code = stripComments(MAIN);
const sync = fnBody(code, "syncRecordsViewportState");
check("syncRecordsViewportState() exists", sync.length > 0, true);
// [A-662] "mobile" → "stackedMode", literal `window.innerWidth <= 640` → the one shared
// geometry-fit decision (computeHistoryFitMode()) — same shift/inert contract, geometry-derived
// trigger instead of a flat 640 cutoff (A-651/A-662 OWNER RESPONSIVE DECISION).
check("sync: shift = open && !stackedMode, inert = open && stackedMode (computeHistoryFitMode())",
  /const stackedMode = computeHistoryFitMode\(\) === "stacked";/.test(sync) && /const shift = open && !stackedMode;/.test(sync) &&
  /setHomeTwoCardShift\(shift\)/.test(sync) && /const background = open && stackedMode;/.test(sync) && /mount\.inert = background/.test(sync), true);
check("alignRecordsCardToHomePaper() re-syncs BEFORE measuring (per-frame loop + resize both call it)",
  /syncRecordsViewportState\(\);[\s\S]*?if \(computeHistoryFitMode\(\) === "stacked"\)/.test(fnBody(code, "alignRecordsCardToHomePaper")), true);
check("openRecordsCard(): no one-shot `innerWidth > 640 → setHomeTwoCardShift(true)` left",
  /setHomeTwoCardShift\(true\)/.test(fnBody(code, "openRecordsCard")), false);
check("openRecordsCard() syncs before the anchor is un-hidden",
  fnBody(code, "openRecordsCard").indexOf("syncRecordsViewportState()") < fnBody(code, "openRecordsCard").indexOf("anchor.hidden = false"), true);
check("closeRecordsCard() syncs (shift off + HOME live immediately), no bare setHomeTwoCardShift(false)",
  /syncRecordsViewportState\(\)/.test(fnBody(code, "closeRecordsCard")) && !/setHomeTwoCardShift\(false\)/.test(fnBody(code, "closeRecordsCard")), true);
// [A-662] same guard, now asking the shared geometry-fit decision instead of a flat 640 cutoff
// (kept consistent with syncRecordsViewportState()'s own inert condition above).
check("handleHomePaperMountClick(): stacked+open guard precedes every records/money branch",
  (() => {
    const b = fnBody(code, "handleHomePaperMountClick");
    const g = b.indexOf('if (state.recordsCardVisible && computeHistoryFitMode() === "stacked") return;');
    return g > 0 && g < b.indexOf("homeAmountChoice--") && g < b.indexOf("#homeRecordsButton") && g < b.indexOf(".homePaper__records[data-piggy-id]");
  })(), true);
check("openRecordsCard() itself has no blanket already-open return (web identity switch stays legit)",
  /if \(state\.recordsCardVisible\) return;/.test(fnBody(code, "openRecordsCard")), false);

const mobileBlocks = [...stripComments(CSS).matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
check("≤640: resident records share the 18px mobile size",
  /#homeRecordsButton,\s*\n\s*\.homePaper__records\[data-piggy-id\] \{\s*\n\s*font-size:\s*18px;/.test(mobileBlocks), true);
check("≤640: resident records hit grows up over its own card, down only into its 18px padding",
  /\.homePaper__records\[data-piggy-id\]::after \{\s*\n\s*inset:\s*-30px -12px -18px -12px;/.test(mobileBlocks), true);
check("≤640: time/state contrast .62, no size/weight change",
  /\.homePaper__time,\s*\n\s*\.homePaper__state \{\s*\n\s*color:\s*rgba\(20, 18, 16, 0\.62\);\s*\n\s*\}/.test(mobileBlocks), true);
check("web base: .homePaper__time 13px .55 unchanged", /\.homePaper__time \{\s*\n\s*font: italic 13px\/1\.2 Georgia, "Times New Roman", serif;\s*\n\s*color: rgba\(20, 18, 16, 0\.55\);/.test(CSS), true);
check("web base: .homePaper__state 13px .55 unchanged", /\.homePaper__state \{\s*\n\s*margin-top: 4px;\s*\n\s*font: italic 13px\/1\.2 Georgia, "Times New Roman", serif;\s*\n\s*color: rgba\(20, 18, 16, 0\.55\);/.test(CSS), true);
check("web base: .homePaper__records 12px unchanged", /\.homePaper__records \{[\s\S]*?font: italic 12px\/1\.2 Georgia/.test(CSS), true);
check("≤640 only: folded flap pointer-events:auto (in style.css, not the package CSS)",
  /\.homePaper:not\(\.isResOpen\) \.homeFlap \{\s*\n\s*pointer-events:\s*auto;/.test(mobileBlocks) &&
  (stripComments(CSS).match(/\.homeFlap \{/g) || []).length === 1, true);
check("home-paper-multi.css adds no pointer-events:auto (package file untouched)", /pointer-events:\s*auto/.test(stripComments(MULTI_CSS)), false);

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
  const receipts = [
    mk({ piggyId: honeybunId, at: AT_MS + 60_000, txHash: "0xhoneybun1" }),
    mk({ piggyId: mochiId, at: AT_MS + 120_000, txHash: "0xmochi1" }),
    mk({ at: AT_MS, txHash: "0xlegacy1" }),
    mk({ piggyId: mochiId, at: AT_MS + 180_000, txHash: "0xmochi2" }),
  ];
  return {
    "araso.address": SELF_ADDR,
    "araso.passkey": JSON.stringify(cred),
    "araso.piggyName": "Honeybun",
    "araso.birthPlayed": "1",
    "araso.piggyReceived": "1",
    "araso.secondJourneyClosed": "1",
    "araso.receipts": JSON.stringify(receipts),
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
    async key(key, code, keyCode) {
      await s("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
    close: async () => { await send("Target.closeTarget", { targetId }); ws.close(); },
  };
}

// in-page probe: pointer reachability (elementFromPoint scan around the element) + state snapshot
const PAGE = `window.__a623 = {
  reach(sel) {
    const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); if (!r.width) return { hit: null };
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
    const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
    return { hit: pick ? { w: maxX - minX + 1, h: maxY - minY + 1 } : null, pick, effPx: Math.round(parseFloat(getComputedStyle(el).fontSize) * scale * 100) / 100 };
  },
  snap() {
    const a = document.querySelector("#recordsCardAnchor"), m = document.querySelector(".homePaperMount"), hp = document.querySelector("#homePaper");
    const r = hp && hp.getBoundingClientRect();
    return {
      vw: innerWidth, open: !!a && !a.hidden, shift: !!m && m.classList.contains("homePaperMount--twoCardShift"), inert: !!m && m.inert,
      home: r ? { l: Math.round(r.left * 1000) / 1000, t: Math.round(r.top * 1000) / 1000, w: Math.round(r.width * 1000) / 1000 } : null,
      identity: document.querySelector(".recordsCard__identityName")?.textContent.trim() ?? null,
      rows: [...document.querySelectorAll(".recordsCard__row")].map((e) => e.dataset.receiptIndex),
      surfaces: document.querySelectorAll("#recordsCardAnchor").length, sw: document.documentElement.scrollWidth,
      openingAdds: window.__a623w ? window.__a623w.n : null,
    };
  },
  watch() {
    const a = document.querySelector("#recordsCardAnchor"); const w = { n: 0 }; let had = a.classList.contains("recordsCardAnchor--opening");
    new MutationObserver(() => { const now = a.classList.contains("recordsCardAnchor--opening"); if (now && !had) w.n++; had = now; }).observe(a, { attributes: true, attributeFilter: ["class"] });
    window.__a623w = w; return true;
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
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a623-chrome-"));
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000);
  const c = await attach(CDP_PORT);
  const ev = (e) => c.evaluate(e);
  const reach = (sel) => ev(`window.__a623.reach(${JSON.stringify(sel)})`);
  const snap = () => ev("window.__a623.snap()");
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

  await c.navigate(APP_URL);
  await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);

  for (const [W, H] of [[390, 844], [430, 900]]) {
    await c.viewport(W, H);
    await c.navigate(APP_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`);
    await wait(2500);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(600); }
    await ev(PAGE);
    check(`${W}: Chog tap reachable`, await tap("#chogHomeHit"), true);
    check(`${W}: Home paper opens with 2 resident cards`, await waitFor(`document.querySelectorAll(".homePaper__card--piggy").length === 2 && document.querySelector("#homePaper").getBoundingClientRect().width > 100`), true);
    await wait(900);
    const closedHome = (await snap()).home;

    // C — resident records: readable + ≥44 hit, flap reachable, Mochi reachable after unfold
    const hb = await reach(rec(honeybunId));
    check(`${W}: Honeybun records effective font ≥ 11px`, hb.effPx >= 11, true);
    check(`${W}: Honeybun records hit ≥ 44×44`, !!hb.hit && hb.hit.w >= 44 && hb.hit.h >= 44, true);
    check(`${W}: folded flap is pointer-reachable`, !!(await reach(".homeFlap"))?.pick, true);
    await tap(".homeFlap");
    check(`${W}: flap unfolds the resident list`, await waitFor(`document.querySelector("#homePaper").classList.contains("isResOpen")`), true);
    await wait(700);
    const mo = await reach(rec(mochiId));
    check(`${W}: Mochi records hit ≥ 44×44 when unfolded`, !!mo.hit && mo.hit.w >= 44 && mo.hit.h >= 44, true);
    const hb2 = await reach(rec(honeybunId));
    check(`${W}: Honeybun/Mochi hit areas do not overlap`, !!hb2.hit && !!mo.hit && hb2.pick.y < mo.pick.y, true);

    // Honeybun → HISTORY (same stacked surface), HOME background
    await tap(rec(honeybunId));
    await waitFor(`!document.querySelector("#recordsCardAnchor").hidden`);
    await wait(700);
    let s = await snap();
    check(`${W}: Honeybun HISTORY identity/rows`, [s.identity, s.rows], ["Honeybun", ["0"]]);
    check(`${W}: open on mobile → HOME inert, no web shift, one HISTORY surface`, [s.inert, s.shift, s.surfaces], [true, false, 1]);
    check(`${W}: HOME did not move on open`, s.home, closedHome);

    // A — background Mochi records: pointer + keyboard can't replay/switch
    await ev("window.__a623.watch()");
    check(`${W}: background Mochi records not pointer-reachable`, (await reach(rec(mochiId)))?.pick ?? null, null);
    check(`${W}: background Mochi records cannot take focus`, await ev(`(() => { const el = document.querySelector(${JSON.stringify(rec(mochiId))}); el.focus(); return document.activeElement === el; })()`), false);
    await c.key("Enter", "Enter", 13);
    await wait(400);
    await ev(`document.querySelector(${JSON.stringify(rec(mochiId))}).click(), true`); // synthetic click → handler guard
    await wait(400);
    s = await snap();
    check(`${W}: no replay / identity unchanged after background pointer+keyboard+synthetic`, [s.openingAdds, s.identity, s.rows, s.open], [0, "Honeybun", ["0"], true]);

    // B — LIVE breakpoint transition while open. [A-662] the stacked/side-by-side trigger is now
    // a live geometry decision (computeHistoryFitMode(), A-651/A-662 OWNER RESPONSIVE DECISION
    // "not a one-off viewport hack") — this asserts by the SAME rect-math the real function uses
    // (live `.homePaper` rect + RECORDS_CARD_GAP=24 whitespace), not a hardcoded 640/641 pixel
    // pair, so it stays correct if the paper size/gap ever changes the exact crossover.
    async function expectedStacked() {
      return ev(`(() => {
        const paper = document.querySelector(".homePaper");
        if (!paper) return true;
        const r = paper.getBoundingClientRect();
        if (!r.width || !r.height) return true;
        const candidateRight = r.right + 24 + r.width;
        return (window.innerWidth - candidateRight) < 24;
      })()`);
    }
    async function checkLiveCrossing(label, w, h) {
      await c.viewport(w, h);
      await wait(600);
      const stackedExpected = await expectedStacked();
      const snapped = await snap();
      check(`${label}: shift/inert follow live rect-math (computeHistoryFitMode(), stacked=${stackedExpected})`,
        [snapped.shift, snapped.inert], stackedExpected ? [false, true] : [true, false]);
      return snapped;
    }
    const webOpen = await checkLiveCrossing(`${W}→1440`, 1440, 900);
    await checkLiveCrossing("→900", 900, 900);
    await checkLiveCrossing("→660", 660, 900);
    s = await checkLiveCrossing(`→${W}`, W, H);
    check(`${W}: HOME back at its unshifted stacked rect, no h-scroll`,
      [near(s.home.l, closedHome.l) && near(s.home.t, closedHome.t), s.sw], [true, W]);
    check(`${W}: HISTORY stays open with same identity across the transitions`, [s.open, s.identity], [true, "Honeybun"]);

    // close → HOME controls live again; then web closed reference for the −46px shift
    check(`${W}: close reachable`, await tap("#recordsCardClose"), true);
    await wait(500);
    s = await snap();
    check(`${W}: after close → not open, HOME live, no shift`, [s.open, s.inert, s.shift], [false, false, false]);
    await c.viewport(1440, 900);
    await wait(600);
    const webClosed = (await snap()).home;
    check(`web two-card shift = −46px exactly when open (after a mobile→web crossing)`, near(webOpen.home.l, webClosed.l - 46, 0.6), true);
    await c.viewport(W, H);
    await wait(700);

    // Mochi → same surface with Mochi rows
    if (!(await ev(`document.querySelector("#homePaper").classList.contains("isResOpen")`))) { await tap(".homeFlap"); await wait(700); }
    check(`${W}: Mochi records reachable after close`, await tap(rec(mochiId)), true);
    await waitFor(`!document.querySelector("#recordsCardAnchor").hidden`);
    await wait(700);
    s = await snap();
    check(`${W}: Mochi HISTORY identity/rows, single surface`, [s.identity, [...s.rows].sort(), s.surfaces, s.inert], ["Mochi", ["1", "3"], 1, true]);
    await tap("#recordsCardClose");
    await wait(500);
    s = await snap();
    check(`${W}: final close → HOME live`, [s.open, s.inert], [false, false]);
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
}
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail ? 1 : 0);
