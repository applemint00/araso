// [A-788] Home visible-Piggy cap: Main + at most 2 companions (display-only). Browser test against the A-788 pre-change baseline
// ($ARASO_PRIVATE_BASE/ops/receipts/A788_home_visible_piggy_cap/before/measure.json). Needs local port binding + $ARASO_PRIVATE_BASE/ops/harness playwright; SKIPs otherwise.
//   Node part: the cap is a visibility rule in main.js only (planHomeSlots / Piggy index / registry / money untouched).
//   Browser: seeds REAL Piggies (birth + closed First + confirmed Second + `+ Piggy` x5); per logical count (3,4,6) and viewport
//   (390x844, 430x932, 1200x900, 1440x900): visible <= 3, companions left of the paper/HISTORY footprint, no overlap with Chog/paper,
//   Main stays the seat, ALL logical Piggies still reachable (paper cards = index count = 6; each per-Piggy HISTORY button opens),
//   A-786 paper scale + text sizes unchanged vs baseline, no new horizontal overflow.
//   Env: A788_COUNTS (default 3,4,6) · A788_VPS · A788_SHOTS=<dir>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const SHOTS = process.env.A788_SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const BEFORE_JSON = privatePath("ops/receipts/A788_home_visible_piggy_cap/before/measure.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = (process.env.A788_VPS || "390x844,430x932,1200x900,1440x900").split(",").map((s) => s.split("x").map(Number));
const COUNTS = (process.env.A788_COUNTS || "3,4,6").split(",").map(Number);
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
const touch = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;

// ═══ Part N (always) ═════════════════════════════════════════════════════════════════════════════
await check("N1 cap is a main.js visibility rule: HOME_VISIBLE_COMPANION_CAP = 2, applied in planHomeAmbient via capHomeVisibleSlots", () => {
  assert.match(MAIN, /const HOME_VISIBLE_COMPANION_CAP = 2;/);
  assert.match(MAIN, /function capHomeVisibleSlots\(/);
  const m = MAIN.match(/function planHomeAmbient\([\s\S]*?\n\}\n/);
  assert.ok(m && /capHomeVisibleSlots\(/.test(m[0]), "planHomeAmbient applies the cap");
});
await check("N2 cap code never touches the Piggy index / registry / selection / money (visual only)", () => {
  const m = MAIN.match(/function capHomeVisibleSlots\([\s\S]*?\n\}\n/);
  assert.ok(m, "capHomeVisibleSlots present");
  const body = m[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const re of [/localStorage|saveRegistry|saveMyPiggiesIndex|registerControlledPiggy|renameIndexedPiggy|admitModelAPiggy/, /state\./, /requestPrf|sendTransaction|writeContract|signMessage/]) assert.equal(re.test(body), false, String(re));
});
await check("N3 logical capacity data path untouched: indexedResidents() still reads the full index; piggy-index.js has no visible-cap symbol", () => {
  assert.match(MAIN, /function indexedResidents\(\) \{\n  try \{ return loadMyPiggiesIndex\(safeLocalStorage\(\), secondJourneyScope\(\)\.chainId\)\.index\.piggies; \}/);
  const idx = readFileSync(path.join(REPO, "app/src/piggy-index.js"), "utf8");
  assert.equal(/HOME_VISIBLE|visibleCap|VISIBLE_COMPANION/.test(idx), false);
});

// ═══ Part B (browser) ═══════════════════════════════════════════════════════════════════════════
function SNAP() {
  const r2 = (n) => Math.round(n * 100) / 100;
  const box = (e) => { const b = e.getBoundingClientRect(); return { x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height), r: r2(b.right), b: r2(b.bottom) }; };
  const L = document.querySelector(".homeLivingLayer");
  const hit = document.querySelector("#chogHomeHit");
  const paper = document.querySelector("#homePaper");
  const kk = (e) => { let k = 1; for (let a = e; a && a !== document.body; a = a.parentElement) { const tr = getComputedStyle(a).transform; if (tr && tr !== "none") { const m = new DOMMatrix(tr); k *= Math.hypot(m.a, m.b); } } return k; };
  const out = {
    layer: L ? { cap: Number(L.dataset.capacity), off: Number(L.dataset.offstage), band: L.dataset.band } : null,
    res: [...document.querySelectorAll(".homeLiving")].map((e) => ({ id: e.dataset.piggyId, slot: e.dataset.slot, seat: e.dataset.seat === "1", shown: e.style.visibility !== "hidden", ...box(e) })),
    seat: document.querySelector("#homeSeat") ? box(document.querySelector("#homeSeat")) : null,
    chog: hit ? box(hit) : null,
    paper: paper && paper.getBoundingClientRect().width > 100 ? box(paper) : null,
    sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight,
    paperCards: [...document.querySelectorAll(".homePaper__card--piggy[data-piggy-id]")].map((c) => c.dataset.piggyId),
    recordsButtons: [...document.querySelectorAll(".homePaper__records[data-piggy-id]")].map((c) => c.dataset.piggyId),
    indexCount: (() => { let n = 0; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (/piggies|piggy.?index/i.test(k)) { try { const j = JSON.parse(localStorage.getItem(k)); const arr = j?.piggies || j?.index?.piggies || (Array.isArray(j) ? j : null); if (arr) n = Math.max(n, arr.length); } catch {} } } return n; })(),
  };
  if (paper) {
    const seen = new Set(); out.paperTexts = [];
    const w = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent.trim(); const e = n.parentElement; if (!t || !e || seen.has(e)) continue; seen.add(e); const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); if (cs.display === "none" || cs.visibility === "hidden" || !b.width) continue; out.paperTexts.push({ sel: e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : ""), text: t.slice(0, 30), rendered: r2(parseFloat(cs.fontSize) * kk(e)) }); }
  }
  return out;
}

if (!existsSync(privatePath("ops/harness/package.json"))) {
  console.log("SKIP  Part B — local harness absent; browser scenarios not run");
} else {
  await runBrowser();
}

async function runBrowser() {
  const { chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright");
  const base = existsSync(BEFORE_JSON) ? JSON.parse(readFileSync(BEFORE_JSON, "utf8")) : null;
  let server = null, BASE = process.env.A788_BASE_URL || "";
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
    await p.evaluate(() => { const a = localStorage.getItem("araso.address"); const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a788f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa788-dep", redeemTxHash: "0xa788-red", grantTxHash: "0xa788-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
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

    const names = ["Honeybun", "Mochi", "Bebe", "Dumpling", "Pudding", "Biscuit"];
    let have = 1;
    const baseKey = (n, vp) => base?.[n]?.[vp] || null;
    for (const n of COUNTS) {
      while (have < n) { await addPiggy(names[have]); have += 1; }
      for (const [w, h] of VPS) {
        const vp = `${w}x${h}`;
        // baseline vp key may differ for 1200 (before captured 1200x800 and 1200x900); 430x932 / 390x844 / 1440x900 identical.
        const B = baseKey(n, vp);
        let C = null, O = null;
        await closeRecords(); await atWidth(w, h);
        C = await p.evaluate(SNAP); if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `n${n}_${vp}_home.png`) });
        assert.equal(await openHomePaper(), true, "paper opens"); await sleep(900);
        O = await p.evaluate(SNAP); if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `n${n}_${vp}_home_open.png`) });
        await check(`B1 [n=${n} ${vp}] visible Piggies <= 3: exactly Main + min(2, n-1) companions, all shown, one seat`, () => {
          assert.ok(C.layer, "living layer mounted");
          const shown = C.res.filter((r) => r.shown);
          assert.ok(C.res.length <= 3, `drawn ${C.res.length}`);
          assert.ok(shown.length <= 3, `shown ${shown.length}`);
          assert.equal(C.res.filter((r) => r.seat).length, 1, "exactly one Main seat resident");
          assert.equal(C.res.filter((r) => !r.seat).length, Math.min(2, n - 1), `companions ${JSON.stringify(C.res.map((r) => r.slot))}`);
          assert.equal(shown.length, C.res.length, "every drawn resident visible");
          assert.equal(new Set(C.res.map((r) => r.id)).size, C.res.length, "distinct Piggies");
          assert.ok(C.layer.cap <= 3, `plan capacity ${C.layer.cap}`);
        });
        await check(`B2 [n=${n} ${vp}] companions sit in the left supporting area, clear of Main, Chog and the enlarged paper`, () => {
          const comp = O.res.filter((r) => !r.seat), seat = O.res.find((r) => r.seat);
          assert.ok(seat, "seat resident");
          for (const c of comp) {
            assert.ok(c.x + c.w / 2 < seat.x + 0.5 || w <= 640, `${c.slot} not left of Main (cx ${c.x + c.w / 2} vs seat.x ${seat.x})`);
            assert.equal(touch(c, O.chog), false, `${c.slot} vs Chog`);
            assert.equal(touch(c, O.paper), false, `${c.slot} vs paper`);
            assert.equal(touch(c, seat), false, `${c.slot} vs Main`);
            // [A-831 RE-PIN, Cowork Q-A] the companions form ONE lower-left cluster on the floor line, left of Chog and BELOW the Home card (never over it): left of the paper OR below it. pre-A-831 baseline: if (w > 640) assert.ok(c.r <= O.paper.x + 0.5, `${c.slot} right edge ${c.r} beyond paper left ${O.paper.x} (left-side only)`);
            if (w > 640) assert.ok(c.r <= O.paper.x + 0.5 || c.y >= O.paper.y + O.paper.h - 0.5, `${c.slot} (right ${c.r}, top ${c.y}) neither left of the paper (${O.paper.x}) nor below it (${O.paper.y + O.paper.h})`);
            else assert.ok(c.x < 120, `${c.slot} mobile left cluster x ${c.x}`);
          }
        });
        await check(`B3 [n=${n} ${vp}] Main Piggy + Chog + paper unchanged vs pre-A-788 (placement/visibility only)`, () => {
          if (!B) return console.log("      (no baseline for this vp/count: skipped)");
          // [A-827 RE-PIN, desktop widths >= 1100 other than 1440x900 only] the desktop format scales Home by s = min(vw/1440, 1.33, vh/612) from the 1440x900 reference:
          // board scale k = (s*1440/1256) / old fit, foot gap = (900 - 750.7) * s from the viewport bottom, Home paper size x s about a centre moved from (vw/2-32, vh/2-48)
          // to (vw/2-32s, vh/2-48s). pre-A-827 baseline: near(C.seat[k], B.closed.seat[k], 1) / near(C.chog[k], B.closed.chog[k], 1) / near(O.paper[k], B.open.paper[k], 1) for every k.
          const fs827 = w >= 1100 ? Math.min(w / 1440, 1.33, h / 612) : 1;
          // [A-831 RE-PIN, every width] the A-829 keyframe rule (helpers/a831-sweep.mjs layoutOracle) places the Main Piggy / Chog group and the Home paper:
          // seat right edge = vw - margin, seat foot = vh - bottom margin, seat width = 150 x group scale, paper = baseline paper x k about the layout card centre.
          // pre-A-831 baseline: the A-827 block above (fs827 / kk / Lold / Lnew / seatBottom = h - (900 - 750.7) * fs827 / pc = paper centre + 32 (1 - fs827), 48 (1 - fs827)).
          const KL = layoutOracle(MAIN)(w, h);
          near(C.seat.x + C.seat.w, w - KL.M, 1, "seat right edge"); near(C.seat.w, 150 * KL.S, 1, "seat.w"); near(C.seat.y + C.seat.h, KL.floorY, 1, "seat foot");
          near(C.seat.h / C.seat.w, B.closed.seat.h / B.closed.seat.w, 0.01, "seat aspect unchanged");
          near(C.chog.w / C.seat.w, B.closed.chog.w / B.closed.seat.w, 0.02, "Chog:Piggy size relation unchanged"); near(C.chog.h / C.seat.w, B.closed.chog.h / B.closed.seat.w, 0.02, "Chog:Piggy height relation unchanged");
          near((C.chog.y - (C.seat.y + C.seat.h)) / C.seat.w, (B.closed.chog.y - (B.closed.seat.y + B.closed.seat.h)) / B.closed.seat.w, 0.02, "Chog foot offset relation unchanged");
          near((C.seat.x - C.chog.x) / C.seat.w, (B.closed.seat.x - B.closed.chog.x) / B.closed.seat.w, 0.02, "Chog:Piggy gap relation unchanged");
          near(O.paper.w, B.open.paper.w * KL.k, 1, "paper.w"); near(O.paper.h, B.open.paper.h * KL.k, 1, "paper.h");
          // the measured bbox of #homePaper can sit off the card centre by a board-local amount (flaps / tabs in the multi-Piggy state): that offset, taken from the baseline against the old dock centre (vw/2-32, vh/2-48), scales with k.
          const offX = B.open.paper.x + B.open.paper.w / 2 - (w / 2 - 32), offY = B.open.paper.y + B.open.paper.h / 2 - (h / 2 - 48);
          near(O.paper.x + O.paper.w / 2, KL.cx + offX * KL.k, 1, "paper.cx"); near(O.paper.y + O.paper.h / 2, KL.cy + offY * KL.k, 1, "paper.cy"); // pre-A-831 baseline: near(.., KL.cx, 1, "paper.cx"); near(.., KL.cy, 1, "paper.cy")
        });
        await check(`B4 [n=${n} ${vp}] A-786 hierarchy intact: paper rendered text sizes identical, no new horizontal/vertical scroll`, () => {
          if (!B) return console.log("      (no baseline: skipped)");
          assert.equal(O.paperTexts.length, B.open.paperTexts.length, "same text roles");
          const key = (t) => `${t.sel}|${t.text}`;
          const bm = new Map(B.open.paperTexts.map((t) => [key(t), t.rendered]));
          let compared = 0;
          // [A-827 RE-PIN] desktop widths (>= 1100): the Home paper text scales with s (1 at 1440x900). pre-A-827 baseline: near(t.rendered, bm.get(key(t)), 0.05, key(t))
          const s827 = w >= 1100 ? Math.min(w / 1440, 1.33, h / 612) : 1;
          // [A-831 RE-PIN] the paper text scales with k = card width / 282 at every width. pre-A-831 baseline: near(t.rendered, bm.get(key(t)) * s827, 0.05, key(t))
          const k831 = layoutOracle(MAIN)(w, h).k;
          for (const t of O.paperTexts) { if (!bm.has(key(t))) continue; near(t.rendered, bm.get(key(t)) * k831, 0.05, key(t)); compared += 1; }
          assert.ok(compared >= 5, `compared ${compared}`);
          assert.ok(C.sw <= C.iw, `overflow-x ${C.sw}>${C.iw}`);
          assert.ok(O.sh <= Math.max(B.open.scroll.docH, O.ih) + 1, `doc scrollHeight ${O.sh} vs baseline ${B.open.scroll.docH}`);
        });
        await check(`B5 [n=${n} ${vp}] logical Piggies unchanged: index=${n}, paper lists all ${n}, per-Piggy HISTORY buttons for all ${n}`, () => {
          assert.equal(O.indexCount, n, `index ${O.indexCount}`);
          assert.equal(new Set(O.paperCards).size, n, `paper cards ${JSON.stringify(O.paperCards)}`);
          assert.equal(new Set(O.recordsButtons).size, n, `history buttons ${JSON.stringify(O.recordsButtons)}`);
          const drawn = new Set(O.res.map((r) => r.id));
          assert.ok([...drawn].every((id) => O.paperCards.includes(id)), "drawn ⊂ logical");
          if (n > 3) assert.equal(O.paperCards.filter((id) => !drawn.has(id)).length, n - drawn.size, "hidden Piggies = logical − drawn");
        });
        if (n === Math.max(...COUNTS) && n > 3 && (w === 1440 || w === 390)) {
          await check(`B6 [n=${n} ${vp}] every Piggy not drawn on Home is still reachable: its HISTORY button opens its own records card`, async () => {
            const drawn = new Set(O.res.map((r) => r.id));
            const hidden = O.recordsButtons.filter((id) => !drawn.has(id));
            assert.ok(hidden.length >= n - 3, `hidden ${hidden.length}`);
            for (const id of hidden) {
              await closeRecords();
              if (!(await paperOpen())) await openHomePaper();
              const ok = await p.evaluate((pid) => { const b = document.querySelector(`.homePaper__records[data-piggy-id="${pid}"]`); if (!b) return false; b.click(); return true; }, id);
              assert.equal(ok, true, `history button ${id}`);
              await sleep(1400);
              assert.equal(await recOpen(), true, `records card opens for hidden Piggy ${id}`);
            }
            await closeRecords();
          });
        }
      }
    }
    await check("B7 no page errors during the run", () => assert.deepEqual(errors, []));
  } finally { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } }
}
console.log(`\nA-788: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
