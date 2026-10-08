// [A-790] Home sleep/wake canon (Owner decision lock 2026-10-05 (B)): ONLY the active/main Piggy sleeps, after 90 s of no
// meaningful interaction; companions never sleep; any meaningful interaction wakes it with the existing reverse-Flop; Chog's 60 s untouched.
//   Part N (node, fake timers, always): clock 89s/90s, interaction resets, wake phases (piggyWakePhase), companions never slept by
//   assignHomeAmbient over many ticks/seeds, Chog constants/behaviour unchanged, main.js wiring (seat-only, reduced guard).
//   Part B (browser, needs local port + _private/ops/harness playwright; SKIPs otherwise): 2 real Piggies; seat sleeps/wakes, companion never.
//   Env: A790_REAL90=0 skips the one real-time 90 s wait · A790_VPS=1440x900,390x844
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CHOG = readFileSync(path.join(REPO, "app/src/chog-home.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = (process.env.A790_VPS || "1440x900,390x844").split(",").map((s) => s.split("x").map(Number));
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const fnBody = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} missing`); const j = src.indexOf("\n}\n", i); return src.slice(i, j + 3); };

// fake timers + clock: advance(ms) runs due timers in order
function fakeTime() {
  let t = 0, id = 0; const q = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { id += 1; q.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (i) => { q.delete(i); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let best = null;
        for (const [k, v] of q) if (v.at <= end && (!best || v.at < best[1].at)) best = [k, v];
        if (!best) break;
        q.delete(best[0]); t = best[1].at; best[1].fn();
      }
      t = end;
    },
    pending: () => q.size,
  };
}

// ═══ Part N (always) ═════════════════════════════════════════════════════════════════════════════
const M = await import("../src/piggy-motion-state.js");

await check("N1 clock: 89.9 s awake, 90.0 s asleep (active Piggy); default afterMs = 90000", () => {
  assert.equal(M.ACTIVE_SLEEP_AFTER_MS, 90000);
  const f = fakeTime(); const c = M.createActiveSleepClock({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  c.arm();
  f.advance(89000); assert.equal(c.snapshot().mode, "awake");
  f.advance(900); assert.equal(c.snapshot().mode, "awake", "89.9 s");
  f.advance(100); assert.equal(c.snapshot().mode, "sleeping", "90.0 s");
  assert.equal(c.snapshot().slept, true);
  f.advance(30000); assert.equal(c.snapshot().elapsedS, 30, "sleep elapsed counts from the sleep start");
});

await check("N2 clock: every meaningful interaction restarts the 90 s count (no sleep at 60+89.9, sleep at 60+90)", () => {
  const f = fakeTime(); const c = M.createActiveSleepClock({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  c.arm(); f.advance(60000); assert.equal(c.interact(), false);
  f.advance(89900); assert.equal(c.snapshot().mode, "awake");
  f.advance(100); assert.equal(c.snapshot().mode, "sleeping");
  assert.deepEqual([...M.ACTIVE_SLEEP_INTERACTION_EVENTS], ["pointerdown", "keydown"]);
});

await check("N3 wake: interact while sleeping -> reverse-Flop phase 'waking' via piggyWakePhase, then awake; inactivity counts again (re-sleep 90 s after wake end)", () => {
  const f = fakeTime(); const c = M.createActiveSleepClock({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  const D = M.PIGGY_WAKE.durationS;
  c.arm(); f.advance(90000); f.advance(30000); // deep sleep, 30 s in
  assert.equal(c.interact(), true);
  const at = () => { const s = c.snapshot(); return M.piggyWakePhase(s.elapsedS, false, s.mode === "sleeping" ? null : s.wakeStartS); };
  assert.equal(c.snapshot().mode, "waking");
  assert.equal(at().phase, "waking"); assert.equal(at().forwardT, D, "deep sleep -> reverse starts at the canonical deep-sleep frame");
  f.advance(5000); assert.equal(c.snapshot().mode, "waking"); assert.equal(at().phase, "waking"); near(at().forwardT, D - 5);
  assert.equal(c.interact(), false, "a second interaction during the wake does not restart it");
  f.advance(5100); assert.equal(c.snapshot().mode, "awake"); assert.equal(at().phase, "awake"); assert.equal(at().forwardT, 0, "awake = Flop frame 0 (seated idle)");
  f.advance(89900); assert.equal(c.snapshot().mode, "awake");
  f.advance(100); assert.equal(c.snapshot().mode, "sleeping", "next sleep 90 s after the wake finished");
  assert.equal(c.snapshot().elapsedS, 0, "fresh sleep starts at Flop frame 0");
});
function near(a, b, tol = 0.002) { assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`); }

await check("N4 wake before deep sleep reverses from the CURRENT forward time (no snap): wake at e=3.0/4.0/9.0 s -> first wake frame forwardT == e, ends at 0 after e s", () => {
  for (const e of [0.3, 1.0, 3.0, 4.0, 9.0]) {
    const f = fakeTime(); const c = M.createActiveSleepClock({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
    c.arm(); f.advance(90000); f.advance(Math.round(e * 1000));
    assert.equal(c.interact(), true);
    const s = c.snapshot(); const p0 = M.piggyWakePhase(s.elapsedS, false, s.wakeStartS);
    assert.equal(p0.phase, "waking"); near(p0.forwardT, e);
    f.advance(Math.round(e * 1000) - 20); assert.equal(c.snapshot().mode, "waking");
    f.advance(40); assert.equal(c.snapshot().mode, "awake");
  }
});

await check("N5 each trigger starts the reverse-Flop: pointerdown and keydown are wired to clock.interact(); leaving Home (Work/Away/Return scene) resets the clock", () => {
  const body = strip(MAIN);
  assert.match(body, /for \(const type of ACTIVE_SLEEP_INTERACTION_EVENTS\) sceneListener\(window, type, \(\) => \{ clock\.interact\(instant\); \}, \{ passive: true \}\);/);
  assert.match(body, /if \(!HOME_LIFE_SCENES\.includes\(state\.scene\)\) clock\.reset\(\);/);
  assert.match(body, /if \(!HOME_LIFE_SCENES\.includes\(state\.scene\)\) \{ homeActiveSleep\?\.reset\(\); return; \}/);
  // [A-803 RE-PIN] the seat-only guard `if (!seatArt)` became "no sleeper art at all" (sleepers are every plain-idle Piggy now)
  assert.match(body, /if \(!sleepArts\.length \|\| !assets\.text\.rollRight\) \{\s*homeActiveSleep\?\.reset\(\);/, "no sleeper art (Work takeover / art failure) = no sleep state");
  assert.equal((body.match(/piggyWakePhase\(/g) || []).length, 1, "the ONE existing reverse-Flop path");
  assert.match(body, /flop\.draw\(snap\.elapsedS, reduced, snap\.mode === "sleeping" \? null : snap\.wakeStartS\)/);
});

await check("N5b reduced motion: sleeper = piggyWakePhase stable still pose (never wakes by itself); interact({instant}) = awake at once, no reverse-Flop, inactivity counts again", () => {
  const r = M.piggyWakePhase(500, true, 12); assert.equal(r.phase, "asleep"); assert.equal(r.forwardT, 77.1 * 0.5);
  const f = fakeTime(); const c = M.createActiveSleepClock({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  c.arm(); f.advance(90000); assert.equal(c.snapshot().mode, "sleeping");
  assert.equal(c.interact({ instant: true }), true);
  assert.equal(c.snapshot().mode, "awake"); assert.equal(c.snapshot().slept, false);
  f.advance(89900); assert.equal(c.snapshot().mode, "awake"); f.advance(100); assert.equal(c.snapshot().mode, "sleeping");
});

await check("N6 companions never slept by assignHomeAmbient: 4000 seeds x 1..6 residents (also with an all-true eligible)", () => {
  let n = 0;
  for (let k = 1; k <= 6; k += 1) {
    const ids = Array.from({ length: k }, (_, i) => `p${i}x${k}`);
    for (let s = 0; s < 4000 / 6; s += 1) {
      for (const el of [null, () => true]) {
        const a = M.assignHomeAmbient(ids, `seed-${k}-${s}`, { eligible: el });
        for (const [, v] of a) { assert.notEqual(v.state, "flop-sleep"); n += 1; }
      }
    }
  }
  assert.ok(n > 10000, `sampled ${n}`);
  assert.equal(M.AMBIENT_WEIGHTS["flop-sleep"], 5, "model constants unchanged (only the draw is removed)");
});

await check("N7 only the ACTIVE (seat) Piggy can mount the sleep art: flop-sleep art is built only inside makeSeatSleeper; ambient assignment never feeds it; reduced motion = stable still pose, instant wake (no animation)", () => {
  const body = strip(MAIN);
  assert.equal((body.match(/buildAmbientArt\(PIGGY_MOTION_STATE\.FLOP_SLEEP/g) || []).length, 1);
  assert.ok(fnBody(body, "makeSeatSleeper").includes("buildAmbientArt(PIGGY_MOTION_STATE.FLOP_SLEEP"));
  // [A-803 RE-PIN] "only the seat mounts the sleep art" is SUPERSEDED: every entry flagged `sleepable` (resolved plain IDLE, planHomeSleepers) gets one sleeper;
  // the flop art is still built only inside makeSeatSleeper and never from the ambient assignment.
  assert.match(body, /const sl = sleepers\.get\(a\);\s*if \(sl\) sl\.draw\(elapsed\(a\), reduced\);/);
  assert.match(body, /if \(!sleepArts\.length \|\| !assets\.text\.rollRight\) \{/);
  assert.match(body, /\.\.\.\(entries\.some\(\(e\) => e\.sleepable\) \? \[PIGGY_MOTION_STATE\.FLOP_SLEEP\] : \[\]\)/);
  assert.match(body, /const instant = \{ instant: reduced \};/);
});

await check("N8 Chog 60 s is untouched: SLEEP_IDLE_MS = 60000 drives Chog's idle timer; no 90 s / active-sleep symbol in chog-home.js; Home drowsy constant still 60000", () => {
  assert.match(CHOG, /export const SLEEP_IDLE_MS = 60000;/);
  assert.match(CHOG, /idleTimer = setTimeout\(sit, SLEEP_IDLE_MS\);/);
  assert.equal(/90000|ACTIVE_SLEEP|createActiveSleepClock/.test(CHOG), false);
  assert.match(MAIN, /const HOME_DROWSY_MS = 60000;/);
  assert.equal(M.ACTIVE_SLEEP_AFTER_MS === 60000, false);
  if (process.env.A790_CHOG_SHA) assert.equal(createHash("sha256").update(CHOG).digest("hex"), process.env.A790_CHOG_SHA);
});

await check("N9 visual-only: the sleep wiring touches no money/auth/storage/selection path", () => {
  const body = strip(fnBody(MAIN, "makeSeatSleeper") + fnBody(MAIN, "homeActiveSleepClock"));
  assert.equal(/localStorage|sessionStorage|saveRegistry|requestPrf|sendTransaction|writeContract|signMessage|state\./.test(body), false);
  const pm = strip(readFileSync(path.join(REPO, "app/src/piggy-motion-state.js"), "utf8"));
  assert.equal(/localStorage|sessionStorage|document\.|window\./.test(pm), false);
});

// ═══ Part B (browser) ═══════════════════════════════════════════════════════════════════════════
if (!existsSync(path.join(REPO, "_private/ops/harness/package.json"))) {
  console.log("SKIP  Part B — local harness absent; browser scenarios not run");
} else {
  await runBrowser();
}

async function runBrowser() {
  const { chromium } = createRequire(path.join(REPO, "_private/ops/harness/package.json"))("playwright");
    let server = null, BASE = process.env.A790_BASE_URL || "";
  if (!BASE) {
    const port = await freePort();
    server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__" }, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); });
    BASE = `http://localhost:${port}/`;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", (route) => { const u = new URL(route.request().url()); if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort(); return route.continue(); });
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
    // ── seed: birth + closed First + confirmed Second ──
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
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000); await sleep(4500);
    if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }
    await p.evaluate(() => { const a = localStorage.getItem("araso.address"); const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a790f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa790-dep", redeemTxHash: "0xa790-red", grantTxHash: "0xa790-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock();
    await waitScene(["explore"], 9000);
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
    await addPiggy("Mochi");

    // ── A-790 browser proof: 2 real Piggies (Main seat + 1 companion) ──
    // [A-803 RE-PIN] sleep is now by resolved behavior (plain idle), not by role: pin the seat to idle and the companion to a non-idle
    // ambient action (dev-server-only seam __a803AmbientForce) so the A-790 seat/companion proofs stay deterministic.
    await context.addInitScript(() => { globalThis.__a803AmbientForce = { seat: "idle", companion: "drink" }; });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock();
    const SEAT = '.homeLiving[data-seat="1"]', COMP = '.homeLiving:not([data-seat="1"])';
    const phase = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? { motion: e.dataset.motionState, phase: e.dataset.sleepPhase || null } : null; }, sel);
    const seatTouchBox = () => p.evaluate(() => { const e = document.querySelector('.homeLiving[data-seat="1"]'); const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; });
    const R = {};
    // real 90 s (no seam): awake before, asleep after
    if (process.env.A790_REAL90 !== "0") {
      await atWidth(1440, 900);
      const t0 = Date.now();
      await sleep(Math.max(0, 80000 - (Date.now() - t0)));
      R.at80 = await phase(SEAT);
      await sleep(Math.max(0, 94000 - (Date.now() - t0)));
      R.at94 = await phase(SEAT); R.comp94 = await phase(COMP);
      await check("B1 [real 90 s, 1440x900] seat awake at ~80 s, asleep (flop-sleep, phase sleeping) at ~94 s of no interaction; companion never asleep", () => {
        assert.ok(R.at80 && R.at80.phase === null && R.at80.motion !== "flop-sleep", JSON.stringify(R.at80));
        assert.ok(R.at94 && R.at94.motion === "flop-sleep" && R.at94.phase === "sleeping", JSON.stringify(R.at94));
        assert.ok(R.comp94 && R.comp94.motion !== "flop-sleep", JSON.stringify(R.comp94));
      });
    }
    // fast seam (dev-server only): 3 s
    await context.addInitScript(() => { globalThis.__a790SleepAfterMs = 12000; });
    for (const [w, h] of VPS) {
      await p.setViewportSize({ width: w, height: h }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock();
      let seen = 0; let early = null;
      for (let i = 0; i < 400 && !seen; i += 1) { early = await phase(SEAT); if (early) seen = Date.now(); else await sleep(100); }
      let slept = null, tSleep = 0;
      for (let i = 0; i < 400; i += 1) { slept = await phase(SEAT); if (slept && slept.phase === "sleeping") { tSleep = Date.now(); break; } await sleep(100); }
      const comp1 = await phase(COMP);
      const compSeen = new Set(); for (let i = 0; i < 6; i += 1) { compSeen.add((await phase(COMP)).motion); await sleep(300); }
      await check(`B2 [12 s seam ${w}x${h}] seat awake when first drawn, asleep ~12 s later (6-13.5 s after first seen); companion never flop-sleep`, () => {
        assert.ok(early && early.phase === null && early.motion !== "flop-sleep", JSON.stringify(early));
        assert.ok(slept && slept.motion === "flop-sleep" && slept.phase === "sleeping", JSON.stringify(slept));
        const d = (tSleep - seen) / 1000; assert.ok(d >= 6 && d <= 13.5, `slept ${d}s after first seen`);
        assert.ok(comp1 && comp1.motion !== "flop-sleep");
        assert.equal(compSeen.has("flop-sleep"), false, [...compSeen].join());
      });
      // wake by tap on empty Home (pointerdown) -> waking (reverse-Flop) -> awake
      await p.mouse.click(8, 8); await sleep(400);
      const w1 = await phase(SEAT);
      await sleep(11500);
      const w2 = await phase(SEAT);
      await check(`B3 [${w}x${h}] pointerdown on Home wakes the sleeper: phase waking (reverse-Flop) then awake idle (no snap-back to sleep)`, () => {
        assert.ok(w1 && w1.phase === "waking" && w1.motion === "flop-sleep", JSON.stringify(w1));
        assert.ok(w2 && w2.phase === "awake", JSON.stringify(w2));
      });
      // sleeps again 3 s after waking finished, then keydown wakes
      await sleep(13200);
      const s2 = await phase(SEAT);
      await p.keyboard.press("Shift"); await sleep(400);
      const k1 = await phase(SEAT);
      await check(`B4 [${w}x${h}] re-sleeps after the next inactivity window; keydown wakes it too`, () => {
        assert.ok(s2 && s2.phase === "sleeping", JSON.stringify(s2));
        assert.ok(k1 && k1.phase === "waking", JSON.stringify(k1));
      });
    }
    // reduced motion: stable still sleeper, instant wake, nothing animates
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.setViewportSize({ width: 1440, height: 900 }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlock();
    let rs = null; for (let i = 0; i < 400; i += 1) { rs = await phase(SEAT); if (rs && rs.phase === "sleeping") break; await sleep(100); }
    const shotA = await p.locator(SEAT).screenshot(); await sleep(2500); const shotB = await p.locator(SEAT).screenshot();
    await p.mouse.click(8, 8); await sleep(300);
    const rw = await phase(SEAT);
    await check("B6 [reduced motion] seat sleeps into ONE stable still pose (identical 2.5 s apart), a tap makes it awake at once (no waking phase, no animation)", () => {
      assert.ok(rs && rs.phase === "sleeping" && rs.motion === "flop-sleep", JSON.stringify(rs));
      assert.ok(shotA.equals(shotB), "still pose changed between frames");
      assert.ok(rw && rw.phase === null && rw.motion !== "flop-sleep", JSON.stringify(rw));
    });
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await check("B5 no page errors during the run", () => assert.deepEqual(errors, []));
  } finally { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } }
}
console.log(`\nA-790: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
