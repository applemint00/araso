// [A-728] iPad 3-Piggy Home mid-band slot repair — existing canon slot WA1 as mid-band FALLBACK.
//   node app/test/a728-ipad-three-piggy-home.mjs
//
// Part N (node, always): planHomeSlots() at 1024×768 / 1180×820 = SEAT,WN1,WA1 (WA1 formula =
//   the web band's own `at(foot.x - gap - w, seat.y)`), and every OTHER plan is byte-identical to the
//   pre-A-728 function. "Before" = the CURRENT source with the A-728 additions mechanically stripped
//   (the WA1 mid candidate + the `opt?.fallback` skip), evaluated side-by-side as a second module.
// Part B (real browser, local harness): Playwright + CDP virtual authenticator on a vite dev server
//   (a172-local, localhost:5815). Seeds 3 Piggies and, at 1024×768 and 1180×820, asserts drawn =
//   SEAT+WN1+WA1, offstage 0, WN1/WA1 touch neither Chog, the open Paper nor open HISTORY. The SEAT's
//   ear graze on open HISTORY is a PRE-EXISTING A-722 finding: it is MEASURED and RECORDED, never
//   asserted away. Env: A728_BASE_URL reuses a server; A728_SHOTS=<dir> screenshots;
//   A728_OUT=<file.json> measurements; A728_NODE_ONLY=1 skips Part B (SKIP, not a PASS).
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_PATH = path.join(REPO, "app/src/piggy-motion-state.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
async function check(label, fn) {
  try { if (await fn() === "SKIP") { console.log(`SKIP  ${label}`); return; } console.log(`PASS  ${label}`); pass += 1; } // [A-888] "SKIP" return = not counted as PASS
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════
const M = await import("../src/piggy-motion-state.js");
const R = (x, y, r, b) => M.rect(x, y, r, b);
let B = null; // pre-A-728 module (A-728 additions stripped)
function stripA728(src) {
  let out = src;
  out = out.replace(/\n\s*\/\/ \[A-728 4:3 mid-band coverage\][\s\S]*?\["WA1", at\(foot\.x - gap - w, seat\.y\), \{ fallback: true \}\],/, "");
  out = out.replace("for (const [name, r, opt] of candidates) {\n    if (opt?.fallback && !rejected.length) continue;", "for (const [name, r] of candidates) {");
  return out;
}
function planWith(mod, vw, vh, seat, chog, brand) {
  const pw = 256.338, px = vw / 2 - 32 - pw / 2, py = vh / 2 - 48 - 182;
  const mobile = vw <= 640;
  const foot = mobile ? R(px, py, px + 536.676, py + 467.8) : R(px - 46, py, px - 46 + 536.676, py + 456.9);
  const safe = mobile ? R(16, 14, vw - 16, vh - 20) : R(16, 16, vw - 16, vh - 16);
  return mod.planHomeSlots({ width: vw, seat, chog, foot, paper: R(px, py, px + pw, py + 364), brand, safe });
}
const BRAND = R(140, 32, 190.2, 44);
// live-measured seat/chog anchors (a654 N4 + A-722/A-728 live inputs)
const CASES = [
  [390, 844, R(290.3, 622.49, 368.3, 715.09), R(222.4, 642.19, 286.3, 708.59)],
  [430, 900, R(323.5, 669.18, 401.5, 761.78), R(255.5, 688.88, 319.5, 755.28)],
  [700, 900, R(538.5, 508.9, 622.0, 608.3), R(465.6, 530.1, 534.2, 601.3)],
  [900, 900, R(692.3, 525.8, 799.8, 653.5), R(598.7, 553.0, 686.8, 644.5)],
  [1024, 768, R(787.7, 512.9, 910.0, 658.3), R(688.7, 543.8, 764.5, 640.6)],
  [1180, 820, R(907.7, 536.9, 1048.6, 704.4), R(793.6, 572.5, 881.0, 684.0)],
  [1200, 900, R(923.0, 551.0, 1066.4, 721.3), R(798.3, 587.3, 915.8, 709.3)],
  [1366, 1024, R(1030.0, 600.0, 1190.0, 790.0), R(880.0, 650.0, 1010.0, 780.0)],
  [1440, 900, R(1107.7, 571.2, 1279.6, 775.6), R(957.9, 614.7, 1098.9, 761.2)],
];
await check("N0 reference module = the pre-A-831 piggy-motion-state.js (pre/ copy) loads; the A-831 cluster is present in the current source", async () => {
  const src = readFileSync(SRC_PATH, "utf8");
  // [A-831 RE-PIN, Cowork Q-A] the mid/web candidate lists (WN1..3 + the A-728 WA1 fallback, W2..W4, WA1/WA2) were replaced by the lower-left companion cluster, so the
  // "pre-A-728 module = current source with the A-728 additions stripped" derivation no longer exists. pre-A-831 baseline:
  //   assert.ok(src.includes("{ fallback: true }") && src.includes("opt?.fallback"), "A-728 fallback present in source"); const before = stripA728(src); assert.ok(!/fallback: true|opt\?\.fallback|A-728 4:3/.test(before), ...); B = import(before)
  assert.ok(src.includes("A-831 · A-829 / A-682 item 1"), "A-831 companion cluster present in source");
  // Round 3: B = the pre-A-831 module (receipt pre-copy), imported through a temp .mjs copy; used only for the widths the cluster does not touch (<= 640, mobile band).
  if (!existsSync(privatePath("ops/receipts/A831_home_keyframe_layout/pre/piggy-motion-state.js"))) { console.log("INFO  N0 pre-A-831 reference module — private pre-copy absent (public checkout); source assertion passed"); return "SKIP"; } // [A-888] public-clone guard
  const pre = readFileSync(privatePath("ops/receipts/A831_home_keyframe_layout/pre/piggy-motion-state.js"), "utf8");
  const dir = mkdtempSync(path.join(tmpdir(), "a728-"));
  const f = path.join(dir, "piggy-motion-state.pre-a831.mjs");
  writeFileSync(f, pre);
  B = await import(pathToFileURL(f).href);
  assert.equal(typeof B.planHomeSlots, "function");
});
await check("N1 1024×768 and 1180×820 = SEAT,WN1,WN2 (A-831 lower-left companion cluster: on the Main floor line, left of Chog, below the footprint, shrunk to fit)", () => {
  // pre-A-831 baseline: = SEAT,WN1,WA1; WN2/WN3 still rejected (viewport-margin); WA1 = web-band formula at seat.y, approved size (WA1 shares WN1's x; WA1.y = seat.y; WA1 keeps the approved size)
  for (const [vw, vh, seat, chog] of CASES.filter((c) => c[0] === 1024 || c[0] === 1180)) {
    const p = planWith(M, vw, vh, seat, chog, BRAND);
    assert.deepEqual(p.slots.map((s) => s.name), ["SEAT", "WN1", "WN2"], `${vw}: ${JSON.stringify(p.rejected.map((r) => [r.name, r.why]))}`);
    const a = p.slots.find((s) => s.name === "WN1").rect, b2 = p.slots.find((s) => s.name === "WN2").rect;
    assert.ok(a.b <= seat.b + 0.01 && Math.abs(a.b - seat.b) < 0.01, "WN1 sits on the Main floor line");
    assert.ok(a.r <= chog.x - p.gap + 0.01 && b2.r <= a.x + 0.01, "cluster is left of Chog, WN2 left of WN1");
    assert.equal(M.rectsTouch(a, b2, 0), false, "WN1/WN2 do not touch");
  }
});
await check("N2 700×900: the plan is deterministic, SEAT first, never more than the two companion slots (mid band changed by A-831; no pre/ comparison)", () => {
  // pre-A-831 baseline: first four mid candidates + order unchanged (SEAT,WN1,WN2,WN3), plan byte-identical to pre-A-728 (no WA1 at tall mid)
  const [vw, vh, seat, chog] = CASES.find((c) => c[0] === 700);
  const a = planWith(M, vw, vh, seat, chog, BRAND), a2 = planWith(M, vw, vh, seat, chog, BRAND);
  assert.ok(a.slots.length <= 3 && a.slots[0].name === "SEAT");
  assert.equal(JSON.stringify(a), JSON.stringify(a2));
});
if (!B) console.log("SKIP  N3 — pre-A-831 reference module absent (public checkout)"); else // [A-888] public-clone guard
await check("N3 mobile band (<= 640) is byte-identical to the pre-A-831 module at 390 / 430 (incl. mobile caps 0/1/2) and a width×height sweep of non-4:3 inputs", () => {
  // pre-A-831 baseline: the same check at 390, 430, 700, 900, 1200, 1366, 1440 and vw up to 1920 (web/mid bands were then untouched; A-831 replaced their candidate lists)
  for (const [vw, vh, seat, chog] of CASES.filter((c) => c[0] <= 640)) {
    assert.equal(JSON.stringify(planWith(M, vw, vh, seat, chog, BRAND)), JSON.stringify(planWith(B, vw, vh, seat, chog, BRAND)), `${vw}×${vh}`);
  }
  // web + mobile bands: unchanged for every height (the candidate lists were not touched)
  for (const vw of [320, 390, 430, 640]) for (let vh = 600; vh <= 1200; vh += 50) {
    const seat = R(vw * 0.74, vh * 0.62, vw * 0.74 + 140, vh * 0.62 + 160), chog = R(vw * 0.65, vh * 0.65, vw * 0.65 + 120, vh * 0.65 + 110);
    assert.equal(JSON.stringify(planWith(M, vw, vh, seat, chog, BRAND)), JSON.stringify(planWith(B, vw, vh, seat, chog, BRAND)), `${vw}×${vh}`);
  }
  for (const cap of [0, 1, 2]) for (const [vw, vh, seat, chog] of CASES.filter((c) => c[0] <= 430)) {
    const mk = (mod) => { const pw = 256.338, px = vw / 2 - 32 - pw / 2, py = vh / 2 - 48 - 182; return mod.planHomeSlots({ width: vw, seat, chog, foot: R(px, py, px + 536.676, py + 467.8), paper: R(px, py, px + pw, py + 364), brand: BRAND, safe: R(16, 14, vw - 16, vh - 20), mobileVisibleCap: cap }); };
    assert.equal(JSON.stringify(mk(M)), JSON.stringify(mk(B)), `${vw} cap${cap}`);
  }
});
await check("N4 mid/web band: the A-831 cluster is at most two companions on the Main floor line, left of Chog, never touching the footprint, each other or Chog (sweep)", () => {
  // pre-A-831 baseline: "mid band: the fallback fires ONLY after a WN candidate was rejected (when every WN fits, WA1 is never planned)" (compared against the stripped pre-A-728 module)
  for (let vh = 640; vh <= 1100; vh += 20) for (const vw of [700, 800, 900, 1024, 1180, 1199, 1200, 1440]) {
    const seat = R(vw * 0.77, vh * 0.66, vw * 0.77 + 122, vh * 0.66 + 145), chog = R(vw * 0.67, vh * 0.7, vw * 0.67 + 76, vh * 0.7 + 97);
    const pw = 256.338, px = vw / 2 - 32 - pw / 2, py = vh / 2 - 48 - 182, foot = R(px - 46, py, px - 46 + 536.676, py + 456.9);
    const p = M.planHomeSlots({ width: vw, seat, chog, foot, paper: R(px, py, px + pw, py + 364), brand: BRAND, safe: R(16, 16, vw - 16, vh - 16) });
    const comp = p.slots.filter((s) => !s.seat);
    assert.ok(comp.length <= 2, `${vw}×${vh} companions ${comp.length}`);
    for (const c of comp) {
      assert.ok(Math.abs(c.rect.b - seat.b) < 0.01 || c.rect.b <= seat.b, `${vw}×${vh} ${c.name} on/above the Main floor line`);
      assert.equal(M.rectsTouch(c.rect, foot, 0), false, `${vw}×${vh} ${c.name} vs footprint`);
      assert.equal(M.rectsTouch(c.rect, chog, 0), false, `${vw}×${vh} ${c.name} vs Chog`);
    }
    if (comp.length === 2) assert.equal(M.rectsTouch(comp[0].rect, comp[1].rect, 0), false, `${vw}×${vh} cluster slots`);
  }
});

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════════
const INIT = `(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials;
  if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`;
const PORT = 5815;
if (process.env.A728_NODE_ONLY === "1") console.log("SKIP  Part B (A728_NODE_ONLY=1) — browser scenarios not run");
else await runBrowser();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);

async function runBrowser() {
  if (!existsSync(privatePath())) { console.log("SKIP  Part B — local browser harness absent (public checkout)"); return; }
  let chromium;
  try { ({ chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright")); }
  catch (e) { await check("B0 playwright available (local harness)", () => { throw e; }); return; }
  let server = null;
  let BASE = process.env.A728_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("vite start timeout")), 25000);
        server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
        server.stderr.on("data", (d) => { if (/EPERM|EADDRINUSE|listen/i.test(String(d))) { clearTimeout(t); reject(new Error(String(d).trim().slice(0, 200))); } });
        server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
      });
    } catch (e) { await check("B0 vite a172-local on 5815", () => { throw e; }); if (server) server.kill("SIGTERM"); return; }
    BASE = `http://localhost:${PORT}/`;
  }
  const shots = process.env.A728_SHOTS || "";
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try { await browserRun(browser, BASE, shots); }
  finally { await browser.close(); if (server) server.kill("SIGTERM"); }
}

async function browserRun(browser, BASE, shots) {
  const net = { tx: 0 };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT);
  await context.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) { net.tx += 1; return route.abort(); }
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && req.method() === "POST" && /grant/i.test(u.pathname)) { net.tx += 1; return route.abort(); }
    return route.continue();
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a728_${name}.png`) }); };
  const scene = () => p.evaluate(() => { const s = document.querySelector("[data-scene]"); const v = s?.dataset.scene ?? null; return v === "return" && s.querySelector(".secondJourney__mockTag") ? "secondReturn" : v; });
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
      const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
    }
    return null;
  }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
  const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
  const openHomePaper = async () => { for (let i = 0; i < 5; i += 1) { if (await paperOpen()) return true; if (!(await p.locator("#chogHomeHit").count())) return false; await p.locator("#chogHomeHit").click({ force: true }); await sleep(1600); } return paperOpen(); };
  const recOpen = () => p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); return !!a && !a.hidden && a.getBoundingClientRect().width > 1; });
  const closeRecords = async () => { if (!(await recOpen())) return; await mustTap("#recordsCardClose", "HISTORY close"); await sleep(1000); };
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const atWidth = async (w, h) => { await p.setViewportSize({ width: w, height: h }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked(); await waitScene(["sendstay"], 9000); await sleep(4500); };
  const snap = () => p.evaluate(() => {
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? [+b.left.toFixed(1), +b.top.toFixed(1), +b.right.toFixed(1), +b.bottom.toFixed(1)] : null; };
    const L = document.querySelector(".homeLivingLayer");
    const q = (s) => document.querySelector(s);
    return {
      vw: innerWidth, vh: innerHeight,
      layer: L ? { cap: Number(L.dataset.capacity), off: Number(L.dataset.offstage), band: L.dataset.band } : null,
      res: [...document.querySelectorAll(".homeLiving")].map((e) => ({ id: e.dataset.piggyId, slot: e.dataset.slot, seat: e.dataset.seat === "1", shown: e.style.visibility !== "hidden", r: box(e) })),
      seat: box(q("#homeSeat")), seatHidden: q("#homeChar")?.dataset.ambientSeat === "1",
      chog: box(q("#chogHomeHit")), paper: box(q("#homePaper")), history: box(q("#recordsCardAnchor")),
      sw: document.documentElement.scrollWidth,
    };
  });
  const overlap = (a, b) => { if (!a || !b) return 0; const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 0.5 && h > 0.5 ? +(w * h).toFixed(1) : 0; };
  const addPiggy = async (name) => {
    await closeRecords();
    await atWidth(1440, 900);
    await openHomePaper(); await sleep(800);
    const idx = await p.evaluate(() => [...document.querySelectorAll(".homePlusPiggyTab")].findIndex((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0));
    assert.ok(idx >= 0, "+Piggy visible");
    await mustTap(".homePlusPiggyTab", "+Piggy", idx);
    assert.equal(await waitScene(["name"], 15000), "name"); await sleep(1200);
    for (let t0 = Date.now(); Date.now() - t0 < 20000;) { const v = await p.evaluate(() => !!document.querySelector("#piggyNameInput") && document.querySelector("#piggyNameInput").getBoundingClientRect().width > 0); if (v) break; if (await p.locator(".nameCard__okBtn").count()) await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(700); }
    await p.locator("#piggyNameInput").fill(name); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    assert.equal(await waitScene(["sendstay"], 8000), "sendstay"); await sleep(4000);
  };
  const measurements = [];
  try {
    // ── seed: birth + closed First + confirmed Second (A-722 / a654 harness), then +2 Piggies ──
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
    await p.evaluate(() => {
      const a = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a728f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa728-dep", redeemTxHash: "0xa728-red", grantTxHash: "0xa728-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
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
    await waitScene(["secondAway"], 6000);
    await waitScene(["secondReturn"], 45000);
    for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
      if ((await scene()) !== "secondReturn") break;
      const v = await p.evaluate(() => { const ok = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; }; return { open: ok("returnOpen"), tap: ok("returnTap") }; });
      if (v.open) { if ((await realClick("#returnOpen")) !== "pointer") await p.evaluate(() => document.getElementById("returnOpen").click()); await sleep(900); continue; }
      if (v.tap) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
      await sleep(250);
    }
    await waitScene(["sendstay"], 15000); await sleep(4500);
    await addPiggy("Mochi");
    await addPiggy("Bebe");

    for (const [w, h] of [[1024, 768], [1180, 820]]) {
      const M3 = { vp: `${w}x${h}` };
      await check(`B1 [${w}×${h}] three Piggies draw as SEAT + WN1 + WN2 (A-831 cluster; pre-A-831 baseline: SEAT + WN1 + WA1), offstage 0, all shown, no horizontal overflow, Honeybun/Mochi/Bebe all present`, async () => {
        await closeRecords();
        await atWidth(w, h);
        const g = await snap(); M3.closed = g; await shot(`${w}x${h}_home_paper-closed`);
        assert.ok(g.layer, "living layer present");
        assert.equal(g.layer.off, 0, `offstage ${g.layer.off}`);
        assert.equal(g.layer.band, "mid");
        const companions = g.res.filter((r) => !r.seat);
        const names = ["SEAT", ...companions.map((r) => r.slot)].sort();
        assert.deepEqual(names, ["SEAT", "WN1", "WN2"], JSON.stringify(g.res)); // [A-831 RE-PIN] pre-A-831 baseline: ["SEAT", "WA1", "WN1"]
        assert.equal(g.res.filter((r) => r.shown).length, g.res.length, "every companion visible");
        assert.equal(g.seatHidden === true || g.res.some((r) => r.seat) || !!g.seat, true);
        assert.ok(g.sw <= g.vw, `scrollWidth ${g.sw} > ${g.vw}`);
        // 3 distinct Piggies drawn in total (seat resident + 2 companions)
        const ids = new Set(g.res.map((r) => r.id)); assert.ok(ids.size >= 2, "two companion Piggies by id");
      });
      await check(`B2 [${w}×${h}] WN1/WA1 overlap no Chog, no current Paper (open), no open HISTORY; SEAT-vs-HISTORY ear graze RECORDED (pre-existing A-722), not asserted away`, async () => {
        await atWidth(w, h);
        assert.equal(await openHomePaper(), true, "paper opens"); await sleep(900);
        const gp = await snap(); M3.paperOpen = gp; await shot(`${w}x${h}_paper-open`);
        const comp = (g) => g.res.filter((r) => !r.seat && (r.slot === "WN1" || r.slot === "WN2")); // [A-831 RE-PIN] pre-A-831 baseline: r.slot === "WN1" || r.slot === "WA1"
        assert.equal(comp(gp).length, 2);
        for (const c of comp(gp)) {
          assert.equal(overlap(c.r, gp.chog), 0, `${c.slot} vs Chog`);
          assert.equal(overlap(c.r, gp.paper), 0, `${c.slot} vs Paper`);
        }
        assert.equal(await p.locator(".homePaper__records").count() > 0, true, "HISTORY button present");
        const rc = await realClick(".homePaper__records", 0);
        if (rc !== "pointer") await p.locator(".homePaper__records").first().click({ force: true });
        await sleep(1800);
        assert.equal(await recOpen(), true, "HISTORY open");
        const gh = await snap(); M3.historyOpen = gh; await shot(`${w}x${h}_history-open`);
        assert.equal(gh.layer.off, 0, "offstage 0 with HISTORY open");
        for (const c of comp(gh)) {
          assert.equal(overlap(c.r, gh.history), 0, `${c.slot} vs HISTORY`);
          assert.equal(overlap(c.r, gh.chog), 0, `${c.slot} vs Chog (HISTORY open)`);
          assert.equal(overlap(c.r, gh.paper), 0, `${c.slot} vs Paper (HISTORY open)`);
        }
        // pre-existing finding (A-722): record only
        const seatBox = gh.seat;
        M3.seatGrazeHistoryPx2 = overlap(seatBox, gh.history);
        M3.seatGrazePaperPx2 = overlap(seatBox, gh.paper);
        console.log(`INFO  [${w}×${h}] SEAT-vs-HISTORY graze (pre-existing A-722, recorded not hidden): ${M3.seatGrazeHistoryPx2} px²`);
        await closeRecords();
      });
      measurements.push(M3);
    }
    await check("B9 whole run: pageerror 0, tx 0, credentials.create 0", async () => {
      assert.deepEqual(errors, []);
      assert.equal(net.tx, 0);
      assert.equal((await p.evaluate(() => window.__wa)).create, 0);
    });
  } catch (e) {
    await check("B! browser run", () => { throw e; });
  } finally {
    if (process.env.A728_OUT) writeFileSync(process.env.A728_OUT, JSON.stringify(measurements, null, 1));
    await context.close();
  }
}
