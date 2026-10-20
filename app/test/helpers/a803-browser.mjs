// [A-803] shared browser scaffold for the idle-Piggy sleep proofs (a803-idle-piggy-sleep.mjs + the geometry measurer).
// Same seeding as A-790 (a172-local dev server + virtual passkey, offline context), split into seedSolo() / seedMulti().
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { FORK_MODE_ENV, FORK_MODE_INIT, FORK_MODE_OFF, FORK_SCOPE, forkKey, forkRpcStub } from "./fork-mode.mjs"; // [A-974] + forkRpcStub
import { privatePath } from "./private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
export { FORK_MODE_ENV, FORK_MODE_INIT };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..", "..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
export const harnessPresent = () => existsSync(privatePath("ops/harness/package.json"));

// [A-950] fork-profile mode (STALE_TESTS.md class (a)): launch({ forkMode: true }) boots the local dev server with the dummy fork config and stores
// journey "2" before the app loads (helpers/fork-mode.mjs), so the Second UI can open (A-948: level >= 2 AND fork profile). Default off = the
// unchanged testnet dev server. On the fork profile the storage scope is "monad-fork" and the testnet legacy receipts are not read.
// [A-1435 · 10-20 고아 vite 40] a test that dies mid-run (exit · SIGINT · SIGTERM) takes the vite launch() spawned with it; the signal is
// raised again after, so the process still ends the way that signal says. close() and the A803_BASE_URL reuse path (no server) are unchanged.
const LIVE_SERVERS = new Set();
let serverGuardOn = false;
function guardServer(server) {
  LIVE_SERVERS.add(server);
  server.once("exit", () => LIVE_SERVERS.delete(server));
  if (serverGuardOn) return;
  serverGuardOn = true;
  const killAll = () => { for (const s of LIVE_SERVERS) { try { s.kill("SIGKILL"); } catch {} } };
  process.once("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { killAll(); process.kill(process.pid, sig); });
}
export async function launch({ forkMode = false, recordVideo } = {}) {
  if (FORK_MODE_OFF) forkMode = false; // A950_FORK_MODE=0: the forkMode-off regression run (helpers/fork-mode.mjs)
  const { chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright");
  let server = null, BASE = process.env.A803_BASE_URL || "";
  // A reused server (A803_BASE_URL) must say it carries the fork env (A803_BASE_FORK=1, set by the suite that spawned it with FORK_MODE_ENV).
  if (forkMode && BASE && process.env.A803_BASE_FORK !== "1") throw new Error("launch({forkMode:true}) cannot reuse A803_BASE_URL without A803_BASE_FORK=1: the fork env must be on the server that serves the page");
  if (!BASE) {
    const port = await freePort();
    server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__", ...(forkMode ? FORK_MODE_ENV : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    guardServer(server);
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); });
    BASE = `http://localhost:${port}/`;
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(recordVideo ? { recordVideo } : {}) });
  // [A-1289] these browser tests were written for the envelope entry; keep it unless a test asks for the Chog entry (the rehearsal covers that)
  if (process.env.ARASO_TEST_ENTRY_CHOG !== "1") await context.addInitScript(() => { try { localStorage.setItem("araso.entryEnvelope.v1", "1"); } catch {} });
  if (forkMode) await context.addInitScript(FORK_MODE_INIT);
  await context.route("**/*", (route) => { const u = new URL(route.request().url()); if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort(); return route.continue(); });
  if (forkMode) await forkRpcStub(context); // [A-974] fork RPC reads + the fork entry status answered locally (registered after the catch-all: the later route wins). pre-A-974: none
  const p = await context.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 160)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => { const s = document.querySelector("[data-scene]"); const v = s?.dataset.scene ?? null; return v === "return" && s.querySelector(".secondJourney__mockTag") ? "secondReturn" : v; });
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null; for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) { const x = b.left + b.width / 2 + sx * dx, y = b.top + b.height / 2 + sy * dy; if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y }; } return null; }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); } throw new Error(`${label}: ${sel} not reachable`); };
  const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
  const openHomePaper = async () => { for (let i = 0; i < 5; i += 1) { if (await paperOpen()) return true; if (!(await p.locator("#chogHomeHit").count())) return false; await p.locator("#chogHomeHit").click({ force: true }); await sleep(1600); } return paperOpen(); };
  const recOpen = () => p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); return !!a && !a.hidden && a.getBoundingClientRect().width > 1; });
  const closeRecords = async () => { if (!(await recOpen())) return; await p.evaluate(() => document.querySelector("#recordsCardClose")?.click()); await sleep(1000); };
  const unlock = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const atWidth = async (w, h) => { await p.setViewportSize({ width: w, height: h }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock(); await waitScene(["sendstay"], 9000); await sleep(4000); };
  const addPiggy = async (name) => {
    await closeRecords(); await atWidth(1440, 900); await openHomePaper(); await sleep(800);
    const idx = await p.evaluate(() => [...document.querySelectorAll(".homePlusPiggyTab")].findIndex((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0));
    assert.ok(idx >= 0, "+Piggy visible");
    await mustTap(".homePlusPiggyTab", "+Piggy", idx);
    assert.equal(await waitScene(["name"], 15000), "name"); await sleep(1200);
    for (let t0 = Date.now(); Date.now() - t0 < 20000;) { const v = await p.evaluate(() => !!document.querySelector("#piggyNameInput") && document.querySelector("#piggyNameInput").getBoundingClientRect().width > 0); if (v) break; if (await p.locator(".nameCard__okBtn").count()) await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(700); }
    await p.locator("#piggyNameInput").fill(name); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    assert.equal(await waitScene(["sendstay"], 8000), "sendstay"); await sleep(4000);
  };
  // birth + naming -> a single-Piggy Home (sendstay)
  const seedSolo = async (name = "Honeybun", { stay = true } = {}) => {
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
    await p.locator("#piggyNameInput").fill(name); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000); await sleep(4500);
    if (stay && await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }
  };
  // closed First + confirmed Second so "+ Piggy" is offered, then a second Piggy -> 2 real Piggies
  const seedMulti = async (second = "Mochi") => {
    // [A-950] fork profile: the legacy testnet receipt / tripClosed seed below is not read there (main.js LEGACY_TESTNET_PATH), so "First done"
    // is reached the way a943's level-2 control does: the DEV return jump → tap through → filed → Home (goHomeFromFilebox) → quiet Home → cue.
    if (forkMode) {
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock(); await waitScene(["sendstay"], 9000);
      await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
      for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
        const v = await p.evaluate(() => ({ home: document.querySelector("[data-scene]")?.dataset.scene === "sendstay", tap: (() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; })(), open: (() => { const e = document.getElementById("returnOpen"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; })() }));
        if (v.home) break;
        if (v.tap) { await realClick("#returnTap"); await sleep(1200); continue; }
        await sleep(150);
      }
      await waitScene(["sendstay"], 9000);
    } else {
    await p.evaluate(() => { const a = localStorage.getItem("araso.address"); const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a803f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa803-dep", redeemTxHash: "0xa803-red", grantTxHash: "0xa803-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock();
    }
    // [A-891 CG-04/05] pre-A-891 baseline: await waitScene(["explore"], 9000) (Explore opened by itself after First). Now: quiet Home ~8 s →
    // "tap me!" → Chog tap → intro → Explore (Owner 2026-10-08).
    // [A-895 P-D] pre-A-895 baseline: the loop ended silently when Explore had already opened (or no cue ever came) and waitScene's TIMEOUT string was ignored,
    // so a regression back to the 1.2 s auto-Explore still passed. Now exploreViaTapMe THROWS if Explore opens before/without the Chog tap, if no cue shows, or if the tap does not reach Explore.
    const exploreViaTapMe = async (ms = 16000) => {
      for (let t0 = Date.now(); Date.now() - t0 < ms && !(await p.locator(".chogHome__tapCue").count());) {
        if ((await scene()) === "explore") throw new Error("exploreViaTapMe: Explore opened WITHOUT the Chog tap (auto-Explore regression)");
        await sleep(200);
      }
      if (!(await p.locator(".chogHome__tapCue").count())) throw new Error(`exploreViaTapMe: no "tap me!" cue (scene=${await scene()})`);
      await mustTap("#chogHomeHit", "Chog (tap me!)");
      const sc = await waitScene(["explore"], 5000);
      if (sc !== "explore") throw new Error(`exploreViaTapMe: tap did not open Explore (${sc})`);
      return sc;
    };
    await exploreViaTapMe();
    await realClick("#stayButton"); await waitScene(["sendstay"], 4000); await sleep(3000);
    await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(1900);
    const step = () => p.evaluate(() => document.querySelector("#exploreForm") ? "interests" : document.querySelector(".secondJourney__jitBtn") ? "jit" : document.querySelector("#secondSendButton") ? "readiness" : document.querySelector(".secondJourney__pick") ? "candidates" : null);
    let st = await step();
    if (st === "interests") { await realClick(".secondJourney__item", 0); await sleep(250); await realClick("#exploreSaveButton"); await sleep(2400); st = await step(); }
    if (st === "candidates") {
      const first = await p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].find((b) => !b.disabled && !b.hidden)?.dataset.destinationId);
      await realClick(`.secondJourney__pick[data-destination-id="${first}"]`); await sleep(400);
      await realClick("#secondOkButton"); await sleep(900);
      if ((await step()) === "jit") { await realClick(".secondJourney__jitBtn", 0); await sleep(900); }
    }
    if (await p.locator("#secondAmount").count()) { await p.locator("#secondAmount").fill("1"); await sleep(400); }
    await mustTap("#secondSendButton", "second send");
    await waitScene(["secondAway"], 6000); await waitScene(["secondReturn"], 45000);
    for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
      if ((await scene()) !== "secondReturn") break;
      const v = await p.evaluate(() => { const ok = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; }; return { open: ok("returnOpen"), tap: ok("returnTap") }; });
      if (v.open) { if ((await realClick("#returnOpen")) !== "pointer") await p.evaluate(() => document.getElementById("returnOpen").click()); await sleep(900); continue; }
      if (v.tap) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
      await sleep(250);
    }
    await waitScene(["sendstay"], 15000); await sleep(4500);
    await addPiggy(second);
  };
  const close = async () => { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } };
  // [A-950] the chain scope this page boots on, and the storage name of a Second key there (boot-profile.js scopedSecondKey: testnet = the bare key).
  const scope = forkMode ? FORK_SCOPE : "monad-testnet";
  const secondKey = (base) => (forkMode ? forkKey(base) : base);
  return { p, context, BASE, errors, forkMode, scope, secondKey, scene, waitScene, realClick, mustTap, atWidth, unlock, seedSolo, seedMulti, openHomePaper, paperOpen, closeRecords, close };
}

// Per-Piggy sleep observation (observable attributes only; no visual).
export const SEAT = '.homeLiving[data-seat="1"]';
export const COMP = '.homeLiving:not([data-seat="1"])';
export const phaseOf = (p, sel, idx = 0) => p.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; return e ? { motion: e.dataset.motionState, phase: e.dataset.sleepPhase || null, vis: getComputedStyle(e).visibility } : null; }, [sel, idx]);

// Pixel masks: "who is drawn where", by differencing full-viewport shots of the CURRENT frame (hide Chog + layer = empty baseline;
// then only the `only` residents / only the `others` residents / only Chog). Pairs: sleeper∩Chog, sleeper∩others, others∩Chog.
// overlapPx = pixels drawn by both; minGapPx = nearest ink-to-ink distance (chamfer, px; null when one side draws nothing).
export async function pixelEvidence(p, only = SEAT, others = null) {
  const setVis = (sel, hidden) => p.evaluate(([s, h]) => { document.querySelectorAll(s).forEach((e) => { if (h) e.style.setProperty("visibility", "hidden", "important"); else e.style.removeProperty("visibility"); }); }, [sel, hidden]);
  const shot = async () => (await p.screenshot({ type: "png" })).toString("base64");
  const only_ = (sel) => (sel === SEAT ? `.homeLiving:not([data-seat="1"])` : `.homeLiving:not(${sel})`);
  await setVis("#chogHome", true); await setVis(".homeLivingLayer", true);
  const empty = await shot();
  await setVis(".homeLivingLayer", false);
  const withOnly = async (sel) => { await setVis(only_(sel), true); const s = await shot(); await setVis(only_(sel), false); return s; };
  const S = await withOnly(only);
  const O = others ? await withOnly(others) : null;
  await setVis(".homeLivingLayer", true); await setVis("#chogHome", false);
  const C = await shot();
  await setVis(".homeLivingLayer", false);
  return p.evaluate(async ({ empty, S, O, C }) => {
    const load = async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u], { type: "image/png" })); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
    const E = await load(empty);
    const W = E.width, H = E.height;
    const mask = async (b64) => { if (!b64) return null; const A = await load(b64); const m = new Uint8Array(W * H); let n = 0; for (let i = 0; i < W * H; i += 1) { const d = Math.abs(A.data[i * 4] - E.data[i * 4]) + Math.abs(A.data[i * 4 + 1] - E.data[i * 4 + 1]) + Math.abs(A.data[i * 4 + 2] - E.data[i * 4 + 2]); if (d > 24) { m[i] = 1; n += 1; } } return { m, n }; };
    const [ms, mo, mc] = [await mask(S), await mask(O), await mask(C)];
    const bbox = (m) => { if (!m) return null; let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (m.m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]; };
    const INF = 1e9;
    const dist = (B) => { const d = new Float32Array(W * H); for (let i = 0; i < W * H; i += 1) d[i] = B.m[i] ? 0 : INF; for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = y * W + x; let v = d[i]; if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 1.414); } d[i] = v; } for (let y = H - 1; y >= 0; y -= 1) for (let x = W - 1; x >= 0; x -= 1) { const i = y * W + x; let v = d[i]; if (x < W - 1) v = Math.min(v, d[i + 1] + 1); if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 1.414); if (x > 0) v = Math.min(v, d[i + W - 1] + 1.414); } d[i] = v; } return d; };
    const pair = (A, B) => { if (!A || !B || !A.n || !B.n) return { overlapPx: 0, minGapPx: null }; let ov = 0; const d = dist(B); let g = INF; for (let i = 0; i < W * H; i += 1) if (A.m[i]) { if (B.m[i]) ov += 1; if (d[i] < g) g = d[i]; } return { overlapPx: ov, minGapPx: g >= INF ? null : Math.round(g * 10) / 10 }; };
    return { vw: W, vh: H, sleeperPx: ms.n, sleeperInk: bbox(ms), chogInk: bbox(mc), othersInk: bbox(mo), vsChog: pair(ms, mc), vsOthers: pair(ms, mo), othersVsChog: pair(mo, mc) };
  }, { empty, S, O, C });
}

// Freeze the page clock (Date.now) at sleepStart + T s so every shot of one sample is the SAME frame (deterministic geometry).
export const freezeAt = async (p, sleepStartMs, T) => {
  await p.evaluate(([s, t]) => { if (!window.__a803Real) { window.__a803Real = Date.now.bind(Date); Date.now = () => (window.__a803Fz == null ? window.__a803Real() : window.__a803Fz); } window.__a803Fz = s + t * 1000; }, [sleepStartMs, T]);
  await sleep(160);
};
export const sleepStartOf = (p) => p.evaluate(() => { const e = document.querySelector('.homeLiving[data-seat="1"][data-sleep-phase]'); return e ? Number(e.dataset.sleepStartMs) : null; });
export const SAMPLE_TS = [0, 0.5, 1, 1.3, 1.6, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 25, 30, 40, 50, 60, 77, 90];

// Sweep the whole Flop→roll→drowsy→sleep sequence for the seat sleeper. Returns per-T rows + worst-case summary.
export async function sweepSeat(p, { others = null, Ts = SAMPLE_TS, onSample = null, waitMs = 130000 } = {}) {
  let st = null;
  for (let t0 = Date.now(); Date.now() - t0 < waitMs && st == null;) { st = await sleepStartOf(p); if (st == null) await sleep(100); }
  if (st == null) return { error: "seat never slept" };
  const rows = [];
  for (const T of Ts) { await freezeAt(p, st, T); rows.push({ T, ...(await pixelEvidence(p, SEAT, others)) }); if (onSample) await onSample(T); }
  const worst = (f, init, pick) => rows.reduce((a, r) => pick(a, f(r)), init);
  const gaps = rows.map((r) => r.vsChog.minGapPx).filter((g) => g != null);
  const union = (k) => { const b = rows.map((r) => r[k]).filter(Boolean); return b.length ? [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])), Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))] : null; };
  const worstOthers = rows.map((r) => r.vsOthers.minGapPx).filter((g) => g != null);
  return {
    rows,
    summary: {
      samples: rows.length,
      maxOverlapChogPx: worst((r) => r.vsChog.overlapPx, 0, Math.max),
      minGapChogPx: gaps.length ? Math.min(...gaps) : null,
      maxOverlapOthersPx: worst((r) => r.vsOthers.overlapPx, 0, Math.max),
      minGapOthersPx: worstOthers.length ? Math.min(...worstOthers) : null,
      maxOverlapOthersChogPx: worst((r) => r.othersVsChog.overlapPx, 0, Math.max),
      minGapOthersChogPx: (() => { const g = rows.map((r) => r.othersVsChog.minGapPx).filter((x) => x != null); return g.length ? Math.min(...g) : null; })(),
      sleeperInkUnion: union("sleeperInk"),
      chogInkUnion: union("chogInk"),
      othersInkUnion: union("othersInk"),
      vw: rows[0].vw, vh: rows[0].vh,
    },
  };
}
