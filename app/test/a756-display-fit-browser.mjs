// [A-756] TESTNET $5 display — browser fit at the supported viewports (390x844, 700x900, 1024x768, 1440x900).
//   node app/test/a756-display-fit-browser.mjs        (needs local vite + headless Chrome on local ports; run-all marks it SKIP unless ARASO_TEST_BROWSER=1)
//   A756_SHOTS=<dir>  also write PNG screenshots of the pre-send card and the HISTORY Receipt detail per viewport.
// Real app, real main.js/send-card.js/style.css. Card: fresh-device birth walk on http://localhost (local-dev entry + CDP virtual authenticator, as a735).
// Receipt: fixture seeded through localStorage on 127.0.0.1 (same technique as a628): one First receipt with the
// fixed 0.001 MON (Honeybun) and one non-First amount (Mochi, 0.1 MON). Network: localhost only. No tx, no real keys (virtual authenticator only).
// Checks: pre-send card shows "$5" as the term amount and "0.001 MON test" only in the faint detail line, inside the card, above the footer,
// no clipping; Receipt "Sent" shows "$5" + faint "0.001 MON" inside the panel without overflow; non-First receipt stays MON-only; no page h-scroll.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, markBornPiggyIssuance, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
const VITE_PORT = 5756;
const CDP_PORT = 9756;
const APP_URL = `http://localhost:${VITE_PORT}/`;
const RECEIPT_URL = `http://127.0.0.1:${VITE_PORT}/`;
const HARD_TIMEOUT_MS = 240_000;
const SHOTS = process.env.A756_SHOTS || "";
const VIEWPORTS = [[390, 844], [700, 900], [1024, 768], [1440, 900]];

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})`}`);
  return ok;
}

function stagingStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const CHAIN = "monad-testnet";
const AT = "2026-10-05T06:00:00.000Z";
const AT_MS = Date.parse(AT);
const makeAddr = (seed) => "0x" + seed.toString(16).padStart(40, "0");
const SELF_ADDR = makeAddr(0xa756100);
const MOCHI_ADDR = makeAddr(0xa756200);
const honeybunId = `legacy-${SELF_ADDR.toLowerCase()}`;
const mochiId = `piggy-${MOCHI_ADDR.toLowerCase()}`;
async function buildFixture() {
  const idx = stagingStorage();
  const cred = { credentialId: Buffer.from("root-cred").toString("base64url") };
  const r1 = registerControlledPiggy(idx, CHAIN, { id: honeybunId, name: "Honeybun", address: SELF_ADDR, signerAddress: SELF_ADDR, locator: cred, at: AT });
  if (!r1.ok) throw new Error(`registerControlledPiggy: ${r1.reason}`);
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
  const mk = ({ piggyId, at, txHash, sent, after }) => ({ before: "500000000000000000", after, gas: "1000000000000", sent, txHash, depositTxHash: `${txHash}-dep`, redeemTxHash: `${txHash}-red`, grantTxHash: "", status: "success", at, piggyId, redeemBlockNumber: "101" });
  return {
    "araso.address": SELF_ADDR, "araso.passkey": JSON.stringify(cred), "araso.piggyName": "Honeybun", "araso.birthPlayed": "1", "araso.piggyReceived": "1", "araso.secondJourneyClosed": "1",
    "araso.receipts": JSON.stringify([
      mk({ piggyId: honeybunId, at: AT_MS + 60_000, txHash: "0xa756f1", sent: "1000000000000000", after: "498999000000000000" }),
      mk({ piggyId: mochiId, at: AT_MS + 120_000, txHash: "0xa756m1", sent: "100000000000000000", after: "399999000000000000" }),
    ]),
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
    viewport: (width, height) => s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 641 }),
    async tapAt(x, y) { await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); },
    s,
    async shot(file) { const r = await s("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.data, "base64")); },
    close: async () => { await send("Target.closeTarget", { targetId }); ws.close(); },
  };
}

const PAGE = `window.__a756 = {
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
  rect(el) { if (!el) return null; const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(2), t: +b.top.toFixed(2), r: +b.right.toFixed(2), b: +b.bottom.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; },
  alpha(c) { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return 1; const p = m[1].split(",").map((x) => parseFloat(x)); return p.length > 3 ? p[3] : 1; },
  card() {
    const card = document.querySelector("#sendCard"); if (!card) return null;
    const terms = [...card.querySelectorAll(".sendCard__termLabel")];
    const det = card.querySelector(".sendCard__detail");
    const foot = card.querySelector(".sendCard__footer");
    const fit = card.closest(".cardAnchor__fit") || card;
    const cs = (e) => (e ? getComputedStyle(e) : null);
    return {
      terms: terms.map((t) => t.textContent.trim()), detail: det ? det.textContent.trim() : null,
      cardR: this.rect(card), termR: this.rect(terms[0]), detR: this.rect(det), footR: this.rect(foot), fitR: this.rect(fit),
      detOverflow: det ? [det.scrollWidth, det.clientWidth, det.scrollHeight, det.clientHeight] : null,
      termFont: cs(terms[0])?.fontSize, detFont: cs(det)?.fontSize, detStyle: cs(det)?.fontStyle, detAlpha: det ? this.alpha(cs(det).color) : null, termAlpha: terms[0] ? this.alpha(cs(terms[0]).color) : null,
      msg: card.querySelector(".sendCard__message")?.textContent.trim() ?? null,
      docW: document.documentElement.scrollWidth, vw: innerWidth,
    };
  },
  receipt() {
    const rows = [...document.querySelectorAll("#recordsCardBody .recordsCard__detailRows .receipt-row")];
    const sent = rows.find((r) => r.querySelector(".label")?.textContent.trim() === "Sent"); if (!sent) return null;
    const val = sent.querySelector(".value"), sub = sent.querySelector(".receipt-sub");
    const panel = sent.closest(".recordsCard__panel") || sent.parentElement;
    const cost = rows.find((r) => r.querySelector(".label")?.textContent.trim() === "Cost")?.querySelector(".value");
    const cs = (e) => (e ? getComputedStyle(e) : null);
    return {
      text: val.textContent.replace(/\\s+/g, " ").trim(), subText: sub ? sub.textContent.trim() : null,
      rowR: this.rect(sent), valR: this.rect(val), subR: this.rect(sub), panelR: this.rect(panel),
      valOverflow: [val.scrollWidth, val.clientWidth], rowOverflow: [sent.scrollWidth, sent.clientWidth], panelOverflow: [panel.scrollWidth, panel.clientWidth],
      valFont: cs(val).fontSize, subFont: cs(sub)?.fontSize, valAlpha: this.alpha(cs(val).color), subAlpha: sub ? this.alpha(cs(sub).color) : null,
      costText: cost ? cost.textContent.trim() : null, docW: document.documentElement.scrollWidth, vw: innerWidth,
    };
  },
}; true`;

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
const inside = (a, b, tol = 0.5) => !!a && !!b && a.l >= b.l - tol && a.r <= b.r + tol && a.t >= b.t - tol && a.b <= b.b + tol;

async function live() {
  const fx = await buildFixture();
  // Same local-dev entry as a735 (mode a172-local + rpId localhost): on a non-allowed origin the card renders its BLOCKED variant
  // ("Piggy can only go out from the real app.", no amount) — the real pre-send card needs the allowed local rpId.
  viteProc = spawn(path.join(REPO_ROOT, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: REPO_ROOT, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 30_000);
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a756-chrome-"));
  chromeProc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20_000);
  const c = await attach(CDP_PORT);
  const ev = (e) => c.evaluate(e);
  await c.s("WebAuthn.enable");
  async function waitFor(expr, timeoutMs = 8000) { const d = Date.now() + timeoutMs; while (Date.now() < d) { if (await ev(expr)) return true; await wait(80); } return false; }
  async function tap(sel, idx = 0) { const r = await ev(`window.__a756.reach(${JSON.stringify(sel)}, ${idx})`); if (!r || !r.pick) return false; await c.tapAt(r.pick.x, r.pick.y); return true; }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const measurements = {};

  for (const [w, h] of VIEWPORTS) {
    const vp = `${w}x${h}`;
    await c.viewport(w, h);
    // ── Phase A: pre-send card. The app opens it only on the FIRST Home arrival right after a name is saved (main.js saveName ->
    // state.homeArrival -> revealSendCard), and only on an allowed rpId origin (elsewhere it renders the BLOCKED variant without an amount).
    // So: fresh device on http://localhost (local-dev entry, rpId localhost) + a CDP virtual authenticator, invite -> hatch -> name -> card,
    // the same walk as a735. No seeded storage here. A fresh authenticator per viewport so find-first recovery never short-cuts the birth.
    const { authenticatorId } = await c.s("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
    await c.navigate(APP_URL);
    await ev(`(() => { localStorage.clear(); sessionStorage.clear(); return true; })()`);
    await c.navigate(APP_URL);
    const sceneNow = () => ev(`document.querySelector("[data-scene]")?.dataset.scene ?? null`);
    for (let a = 0; a < 4; a += 1) {
      await ev(`(document.querySelector("#inviteFaceButton")?.click(), true)`);
      await waitFor(`["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || !!document.querySelector("#authTryAgainButton")`, 25000);
      if (["hatch", "name"].includes(await sceneNow())) break;
      await ev(`(document.querySelector("#authTryAgainButton")?.click(), true)`); await wait(800);
    }
    let named = false;
    for (let t0 = Date.now(); Date.now() - t0 < 40000;) {
      const v = await ev(`(() => { const vis = (q) => { const e = document.querySelector(q); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; })()`);
      if (v.input) { named = true; break; }
      if (v.ok) { await ev(`(document.querySelector(".nameCard__okBtn")?.click(), true)`); await wait(900); continue; }
      await wait(300);
    }
    check(`[${vp}] name scene reached (fresh-device birth walk)`, named, named ? "" : await ev(`JSON.stringify({ scene: document.querySelector("[data-scene]")?.dataset.scene ?? null, ids: [...document.querySelectorAll("button[id]")].map((b) => b.id) })`));
    if (named) {
      await ev(`(() => { const i = document.querySelector("#piggyNameInput"); i.value = "Honeybun"; i.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#nameForm").requestSubmit(); return true; })()`);
    }
    const cardUp = await waitFor(`!!document.querySelector("#sendCard #stayButton")`, 25000);
    await ev(PAGE);
    check(`[${vp}] pre-send card is up`, cardUp);
    await wait(1200);
    const card = cardUp ? await ev("window.__a756.card()") : null;
    measurements[vp] = { card };
    if (card) {
      check(`[${vp}] card: first term row is exactly "$5" (main amount, USD-first)`, card.terms[0] === "$5", card.terms);
      check(`[${vp}] card: no 'limit'/'up to' in terms`, !/limit|up to/i.test(card.terms.join("|")), card.terms);
      check(`[${vp}] card: MON appears only in the faint detail line ("0.001 MON test")`, (card.detail || "").endsWith("0.001 MON test") && !card.terms.join("|").includes("MON") && !(card.msg || "").includes("MON"), card.detail);
      check(`[${vp}] card: detail is secondary (smaller than the term label, italic, fainter)`, parseFloat(card.detFont) < parseFloat(card.termFont) && card.detStyle === "italic" && card.detAlpha < card.termAlpha, [card.detFont, card.termFont, card.detStyle, card.detAlpha, card.termAlpha]);
      check(`[${vp}] card: "$5" term and detail inside the card box`, inside(card.termR, card.cardR) && inside(card.detR, card.cardR), [card.termR, card.detR, card.cardR]);
      check(`[${vp}] card: detail ends above the footer (no overlap with stay/send)`, card.detR.b <= card.footR.t + 0.5, [card.detR, card.footR]);
      check(`[${vp}] card: detail not clipped (scroll <= client)`, card.detOverflow[0] <= card.detOverflow[1] && card.detOverflow[2] <= card.detOverflow[3], card.detOverflow);
      check(`[${vp}] card: card inside the viewport, no page horizontal scroll`, card.cardR.l >= -0.5 && card.cardR.r <= w + 0.5 && card.docW <= w, [card.cardR, card.docW]);
    }
    if (SHOTS) await c.shot(path.join(SHOTS, `a756_card_${vp}.png`));
    await c.s("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    // ── Phase B: Receipt (HISTORY detail: Sent/Cost/Left rows from receiptRows). Seeded fixture (a628 technique) on the 127.0.0.1 origin:
    // HISTORY + receipts render there without an app-lock/passkey ceremony; receiptRows output does not depend on the origin.
    await c.navigate(RECEIPT_URL);
    await ev(`(() => { localStorage.clear(); const kv = ${JSON.stringify(fx)}; for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); return true; })()`);
    await c.navigate(RECEIPT_URL);
    await waitFor(`!!document.querySelector("#chogHomeHit")`, 10000);
    await wait(1800);
    if (await ev(`!!document.querySelector("#stayButton")`)) { await ev(`document.querySelector("#stayButton").click(), true`); await wait(900); }
    await ev(PAGE);
    const cp = await ev("window.__a756.chog()"); await c.tapAt(cp.x, cp.y);
    await waitFor(`(document.querySelector("#homePaper")?.getBoundingClientRect().width || 0) > 200`); await wait(800);
    if (await tap(".homeFlap")) await wait(900);
    let opened = false;
    for (let i = 0; i < 3 && !opened; i += 1) {
      if (await tap(`.homePaper__records[data-piggy-id="${honeybunId}"]`)) opened = await waitFor(`!!document.querySelector("#recordsCardAnchor") && !document.querySelector("#recordsCardAnchor").hidden`, 4000);
      if (!opened) await wait(600);
    }
    check(`[${vp}] HISTORY opens for the First Piggy`, opened);
    await wait(800);
    const rowTapped = opened && (await tap(".recordsCard__row")) && (await waitFor(`!!document.querySelector("#recordsCardBody .recordsCard__detailRows")`, 4000));
    check(`[${vp}] Receipt detail opens`, !!rowTapped);
    await wait(600);
    const rc = rowTapped ? await ev("window.__a756.receipt()") : null;
    measurements[vp].receipt = rc;
    if (rc) {
      check(`[${vp}] Receipt Sent = "$5 0.001 MON" ($5 first, MON as .receipt-sub)`, rc.text === "$5 0.001 MON" && rc.subText === "0.001 MON", rc.text);
      check(`[${vp}] Receipt MON detail is secondary (smaller + fainter than the $5 value)`, parseFloat(rc.subFont) < parseFloat(rc.valFont) && rc.subAlpha < rc.valAlpha, [rc.subFont, rc.valFont, rc.subAlpha, rc.valAlpha]);
      check(`[${vp}] Receipt Sent row fits: value + sub inside the row and panel, no clipping`, inside(rc.subR, rc.panelR) && inside(rc.valR, rc.panelR) && rc.valOverflow[0] <= rc.valOverflow[1] && rc.rowOverflow[0] <= rc.rowOverflow[1] && rc.panelOverflow[0] <= rc.panelOverflow[1], [rc.valR, rc.subR, rc.panelR, rc.valOverflow, rc.rowOverflow, rc.panelOverflow]);
      check(`[${vp}] Receipt Cost stays exact MON`, /MON$/.test(rc.costText || "") && !(rc.costText || "").includes("$"), rc.costText);
      check(`[${vp}] no page horizontal scroll`, rc.docW <= w, rc.docW);
    }
    if (SHOTS) await c.shot(path.join(SHOTS, `a756_receipt_${vp}.png`));
  }
  check("no page errors", c.pageErrors.length === 0, c.pageErrors.slice(0, 3));
  if (SHOTS) writeFileSync(path.join(SHOTS, "a756_measurements.json"), JSON.stringify(measurements, null, 1));
  await c.close();
}

const timeout = setTimeout(() => { console.error("FAIL  hard timeout"); cleanup(); process.exit(1); }, HARD_TIMEOUT_MS);
timeout.unref?.();
try { await live(); } catch (err) { fail += 1; console.error("FAIL  uncaught:", err && err.stack ? err.stack : err); } finally { clearTimeout(timeout); cleanup(); }
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail ? 1 : 0);
