// [A-786] Home scale x1.10 + Second candidate hierarchy. Browser test (390x844, 430x932, 1440x900) against the pre-A-786 baseline
// (A786 receipts before/measure.json, tree after A-763/A-779). Needs local port binding + _private/ops/harness playwright; SKIPs otherwise.
//   Node part: allowed-surface checks. Browser: paper scale ~1.10 w/ text, centre kept, no overlap/clip, Piggy/Chog +-1px,
//   no new scroll, candidates (>18px css, plain text, no chrome), OK disabled->enabled on pick, Home strings unchanged.
import assert from "node:assert/strict";
// [A-779] before/after capture — real headless Chromium (playwright from _private/ops/harness), vite --mode a172-local.
//   node _private/ops/receipts/A786_small_text_unify/capture.mjs <outDir>
// Walks: Name -> (tap me! cue) -> First Send card -> Home -> coming-home probe -> Explore -> Second candidates (before/after pick).
// Records bounding boxes of card / paper / character elements and computed font-sizes of every text role involved,
// plus a screenshot per scene. The coming-home line is a DOM probe: the real `#returnArrivalAlarm` markup
// (main.js chogHomeMarkupForReturn — same span/class/id, same parent #chogHome before .chogHome__hit) inserted on Home,
// because reaching it for real needs a funded on-chain First Send. Read-only otherwise: no tx (all non-local hosts aborted).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_MODE_ENV, FORK_MODE_INIT, RUN_SCOPE, forkFirstDone, forkKey, forkRpcStub } from "./helpers/fork-mode.mjs"; // [A-950] fork-profile mode (STALE_TESTS class (a)): the Second UI opens only on the fork profile since A-948
import { layoutOracle } from "./helpers/a831-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = process.env.TMPDIR ? path.join(process.env.TMPDIR, "a786shots") : path.join(REPO, "node_modules/.cache/a786shots");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = (process.env.A786_VPS || "390x844,430x932,1440x900").split(",").map((s) => s.split("x").map(Number));
const { chromium } = existsSync(path.join(REPO, "_private/ops/harness/package.json")) ? createRequire(path.join(REPO, "_private/ops/harness/package.json"))("playwright") : {}; // [A-888] public-clone guard: harness absent → browser part SKIPs below

function freePort() { return new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); }); }

const GEOM = ["#sendCard", "#sendCardAnchor", ".cardAnchor", "#secondJourneyCard", "#homeBoard", "#homeChar", "#homeSeat", "#chogHome", "#chogHomeHit", "#chogHomeStack", "#homePaper"];
const TEXT = [
  "#sendCard .sendCard__titleText", "#sendCard .sendCard__termLabel", "#sendCard .sendCard__message", "#sendCard .sendCard__detail",
  "#sendCard #stayButton", "#sendCard #sendButton", "#sendCard #sendButton .pkbtn__word", "#exploreSaveButton .pkbtn__word",
  ".secondJourney__exploreText", ".secondJourney__list--interests .secondJourney__item", ".secondJourney__list--interests .secondJourney__label",
  ".secondJourney__pick", "#secondOkButton", "#secondOkButton .pkbtn__word", "#secondJourneyCard #stayButton", "#exploreChogSay",
  ".chogHome__tapCue", "#returnArrivalAlarm", "#awayRestoreLine",
];

function SNAP([geom, text]) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const vis = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0; };
  const out = { scene: document.querySelector("[data-scene]")?.dataset.scene ?? null, geom: {}, text: {} };
  for (const s of geom) { const e = document.querySelector(s); if (!e) continue; const b = e.getBoundingClientRect(); out.geom[s] = { x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) }; }
  for (const s of text) {
    const els = [...document.querySelectorAll(s)]; if (!els.length) continue;
    out.text[s] = els.map((e) => {
      const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
      // effective on-screen scale = product of ancestor transforms, measured as rect/offset of the nearest transformed box
      let k = 1; for (let a = e; a && a !== document.body; a = a.parentElement) { const t = getComputedStyle(a).transform; if (t && t !== "none") { const m = new DOMMatrix(t); k *= Math.hypot(m.a, m.b); } }
      return { text: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60), fontSize: cs.fontSize, family: cs.fontFamily.split(",")[0], weight: cs.fontWeight, rendered: r2(parseFloat(cs.fontSize) * k), visible: vis(e), box: { x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) }, shadow: cs.boxShadow, bg: cs.backgroundImage.slice(0, 80), bgc: cs.backgroundColor, radius: cs.borderRadius, disabled: e.disabled ?? null, sw: e.scrollWidth, cw: e.clientWidth };
    });
  }
  // every visible text-bearing element inside the Second card (leaf text nodes' parents)
  const card = document.querySelector("#secondJourneyCard");
  if (card) {
    const seen = new Set(); out.cardTexts = [];
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.trim(); const e = n.parentElement; if (!t || !e || seen.has(e)) continue;
      const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); if (cs.display === "none" || cs.visibility === "hidden" || e.closest("[hidden]") || !b.width) continue;
      seen.add(e); let k = 1; for (let a = e; a && a !== document.body; a = a.parentElement) { const tr = getComputedStyle(a).transform; if (tr && tr !== "none") { const m = new DOMMatrix(tr); k *= Math.hypot(m.a, m.b); } }
      out.cardTexts.push({ sel: e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""), text: e.textContent.trim().replace(/\s+/g, " ").slice(0, 50), fontSize: cs.fontSize, rendered: r2(parseFloat(cs.fontSize) * k) });
    }
  }
  out.chogSay = document.querySelector("#exploreChogSay")?.textContent ?? null;
  out.scroll = { docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, bodyH: document.body.scrollHeight, innerH: innerHeight, innerW: innerWidth, stageSH: document.querySelector(".stage")?.scrollHeight ?? null, stageCH: document.querySelector(".stage")?.clientHeight ?? null };
  const paper = document.querySelector("#homePaper");
  if (paper) {
    const kk = (e) => { let k = 1; for (let a = e; a && a !== document.body; a = a.parentElement) { const tr = getComputedStyle(a).transform; if (tr && tr !== "none") { const m = new DOMMatrix(tr); k *= Math.hypot(m.a, m.b); } } return k; };
    const seen = new Set(); out.paperTexts = [];
    const w = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.trim(); const e = n.parentElement; if (!t || !e || seen.has(e)) continue; seen.add(e);
      const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); if (cs.display === "none" || cs.visibility === "hidden" || !b.width) continue;
      out.paperTexts.push({ sel: e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""), text: t.slice(0, 40), fontSize: cs.fontSize, rendered: r2(parseFloat(cs.fontSize) * kk(e)), box: { x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) }, clipX: e.scrollWidth > e.clientWidth + 1 });
    }
    out.paperCards = [...paper.querySelectorAll(".homePaper__card, .homeFlap, .homePlusPiggyTab, .homePaper__records, .homePaper__markButton")].map((e) => { const b = e.getBoundingClientRect(); return { sel: e.className.toString().trim().split(/\s+/)[0], x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) }; });
  }
  out.chars = [...document.querySelectorAll("#homeChar img, #homeChar canvas, #homeChar svg, #chogHome img, #chogHome canvas")].map((e) => { const b = e.getBoundingClientRect(); return { sel: e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + "." + String(e.className?.baseVal ?? e.className).trim().split(/\s+/)[0], x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) }; }).filter((c) => c.w > 20);
  return out;
}

async function walk(browser, BASE, w, h) {
  const vp = `${w}x${h}`;
  const R = { vp };
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
  await context.route("**/*", (route) => { const u = new URL(route.request().url()); if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort(); return route.continue(); });
  await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
  const p = await context.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const snap = () => p.evaluate(SNAP, [GEOM, TEXT]);
  const shot = (name) => p.screenshot({ path: path.join(OUT, `${vp}_${name}.png`) });
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 1) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) { const x = b.left + b.width / 2 + sx * dx, y = b.top + b.height / 2 + sy * dy; if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y }; } return null; }, [sel, idx]);
  const mustTap = async (sel, lab, idx = 0) => { for (let i = 0; i < 8; i += 1) { const r = await pointAt(sel, idx); if (r) { await p.mouse.click(r.x, r.y); return; } await sleep(500); } throw new Error(`${lab}: ${sel} unreachable`); };
  // [A-891 CG-04/05] pre-A-891 baseline: after a reload with First done / Second not done, Explore opened by itself (~1.2 s, waitScene(["explore"])).
  // Now (Owner 2026-10-08): quiet Home ~8 s → "tap me!" → the user taps Chog → intro → Explore. forgetIntro() drops the once-per-user intro fact
  // before a reload so a later reopen takes the same product path (Cowork 2026-10-08: before the intro the cue returns on every reload).
  const forgetIntro = () => p.evaluate((k) => localStorage.removeItem(k), forkKey("araso.secondIntroSeen")); // [A-950] fork-scope key (pre-A-950: the testnet key)
  const exploreViaTapMe = async (ms = 16000) => {
    if ((await scene()) === "sendstay") await forkFirstDone(p); // [A-950] fork profile: the cue arms only after a filing (DEV return jump); a reload / the testnet First-done seed does not arm it there — RECEIPT (iii)-1
    const t0 = Date.now();
    while (Date.now() - t0 < ms && !(await p.locator(".chogHome__tapCue").count())) { if ((await scene()) === "explore") return "explore"; await sleep(200); }
    if (!(await p.locator(".chogHome__tapCue").count())) return `NOCUE:${await scene()}`;
    await mustTap("#chogHomeHit", "Chog (tap me!)");
    return waitScene(["explore"], 5000);
  };
  const unlock = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  try {
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
    await waitScene(["sendstay"], 10000);
    // tap me! cue: first Home arrival, before the First Send card. Sample it at full opacity.
    for (let t0 = Date.now(); Date.now() - t0 < 8000;) {
      const op = await p.evaluate(() => { const e = document.querySelector(".chogHome__tapCue"); return e ? Number(e.style.opacity || getComputedStyle(e).opacity) : -1; });
      if (op >= 0.99) break; await sleep(60);
    }
    R.tapCue = await snap(); await shot("home_tapcue");
    for (let t0 = Date.now(); Date.now() - t0 < 15000;) { if (await p.locator("#sendCard #sendButton").count()) break; await sleep(200); }
    await sleep(3500); // Work? cue settles (1.8s) + hold
    R.firstSend = await snap(); await shot("first_send");
    R.firstSend2 = await snap(); // noise check
    // dismiss the card the same way the existing suites do (programmatic click on #stayButton, stayHome path)
    await p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500);
    R.home = await snap(); await shot("home");
    // [A-786] open the Home paper the way a735 does (tap Chog), measure, then close it again by reload-free tap
    for (let i = 0; i < 6; i += 1) { if (await p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; })) break; await p.locator("#chogHomeHit").click({ force: true }).catch(() => {}); await sleep(1800); }
    await sleep(1200);
    R.homeOpen = await snap(); await shot("home_open");
    R.homeOpen2 = await snap();
    await p.evaluate(() => { const root = document.querySelector("#chogHome"); const hit = root?.querySelector(".chogHome__hit"); if (!root || !hit) return; const s = document.createElement("span"); s.className = "chogCheckLine"; s.id = "returnArrivalAlarm"; s.textContent = "Honeybun is coming home"; root.insertBefore(s, hit); });
    await sleep(200);
    R.comingHome = await snap(); await shot("home_cominghome_probe");
    await p.evaluate(() => document.querySelector("#returnArrivalAlarm")?.remove());
    await p.evaluate(() => { const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a779f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa779-dep", redeemTxHash: "0xa779-red", grantTxHash: "0xa779-grant", status: "success", at: Date.parse("2026-10-05T00:00:00Z") }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock();
    R.exploreScene = await exploreViaTapMe(); await sleep(2500); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000)
    if (process.env.A786_SWEEP_N) {
      // Chog say vs Explore selection: save none (rotate to set B), tick the first N shown errands, save; read #exploreChogSay
      // before any candidate pick and after picking each candidate in turn.
      const n = Number(process.env.A786_SWEEP_N);
      await mustTap("#exploreSaveButton", "save none"); await sleep(900);
      const shown = await p.evaluate(() => document.querySelectorAll("#exploreForm input[data-errand-id]").length);
      for (let i = 0; i < n; i += 1) { await mustTap(".secondJourney__item", "tick", i); await sleep(200); }
      await mustTap("#exploreSaveButton", "save"); await sleep(3200);
      const before = await snap(); const k = await p.evaluate(() => document.querySelectorAll(".secondJourney__pick").length);
      const after = []; for (let i = 0; i < k; i += 1) { await mustTap(".secondJourney__pick", "p", i); await sleep(400); after.push(await p.evaluate(() => document.querySelector("#exploreChogSay")?.textContent ?? null)); }
      await shot(`saysweep_n${n}`);
      R.sweep = { ticked: n, shown, scene: before.scene, sayBeforePick: before.chogSay, candidates: k, sayAfterEachPick: after };
      throw new Error("SWEEP_DONE");
    }
    R.explore = await snap(); await shot("explore");
    await mustTap("#exploreSaveButton", "save none"); await sleep(900);
    const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
    for (const want of ["grow", "asset-piece"]) { const i = ids.indexOf(want); if (i >= 0) { await mustTap(".secondJourney__item", want, i); await sleep(200); } }
    R.exploreChecked = await snap(); await shot("explore_checked");
    await mustTap("#exploreSaveButton", "save"); await sleep(3000);
    R.candidates = await snap(); await shot("second_candidates");
    await mustTap(".secondJourney__pick", "pick", 1); await sleep(500);
    R.candidatesPicked = await snap(); await shot("second_candidates_picked");
    await mustTap(".secondJourney__pick", "pick0", 0); await sleep(500);
    R.candidatesPicked0 = await snap(); await shot("second_candidates_picked_other");
    await mustTap("#secondOkButton", "ok"); await sleep(2500);
    R.readiness = await snap(); await shot("second_after_ok_2s");
    await sleep(6000); R.readiness8 = await snap(); await shot("second_after_ok_8s");
  } catch (e) { R.error = String(e && e.stack || e).slice(0, 600); await shot("error").catch(() => {}); }
  R.errors = errors;
  await context.close();
  return R;
}


const BASE0 = {"390x844": {"paper": {"x": 34.83, "y": 192, "w": 256.34, "h": 364}, "texts": {"HOME": 18.58, "> status \u00a0 1 in \u00a0 0 out": 12.5, "1": 22.43, "Honeybun": 15.38, "still in home": 9.61, "no records yet": 13.46}, "fixed": {"#homeBoard": {"x": 0, "y": 302.14, "w": 390, "h": 239.71}, "#homeChar": {"x": -500.59, "y": 277.84, "w": 979.68, "h": 602.16}, "#homeSeat": {"x": 252.99, "y": 661.41, "w": 117, "h": 122.09}, "#chogHome": {"x": 29.17, "y": 589.57, "w": 461.66, "h": 283.76}, "#chogHomeHit": {"x": 158.19, "y": 691.02, "w": 72.41, "h": 92.26}, "#chogHomeStack": {"x": 29.17, "y": 589.57, "w": 461.66, "h": 283.76}}, "chars": [{"sel": "img#homeWalk.homeChar__walk", "x": 244.45, "y": 655.17, "w": 130.41, "h": 135.01}, {"sel": "img#homeSeat.homeChar__seat", "x": 252.99, "y": 661.41, "w": 117, "h": 122.09}, {"sel": "img.chogHome__part", "x": 135.91, "y": 697.85, "w": 144.79, "h": 128.96}, {"sel": "img.chogHome__part", "x": 144.82, "y": 672.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 139.21, "y": 672.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 142.02, "y": 672.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 115.3, "y": 698.88, "w": 139.09, "h": 121.59}, {"sel": "img.chogHome__part", "x": 142.02, "y": 672.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 137.52, "y": 667.88, "w": 111.56, "h": 131.01}, {"sel": "img.chogHome__part", "x": 142.02, "y": 672.02, "w": 105.12, "h": 125.68}], "scroll": {"docH": 844, "docW": 390, "bodyH": 844, "innerH": 844, "innerW": 390, "stageSH": 880, "stageCH": 844}, "cardCand": {"x": 39.5, "y": 192, "w": 247, "h": 364}}, "430x932": {"paper": {"x": 54.83, "y": 236, "w": 256.34, "h": 364}, "texts": {"HOME": 18.58, "> status \u00a0 1 in \u00a0 0 out": 12.5, "1": 22.43, "Honeybun": 15.38, "still in home": 9.61, "no records yet": 13.46}, "fixed": {"#homeBoard": {"x": 0, "y": 333.85, "w": 430, "h": 264.3}, "#homeChar": {"x": -464.59, "y": 365.84, "w": 979.68, "h": 602.16}, "#homeSeat": {"x": 288.99, "y": 749.41, "w": 117, "h": 122.09}, "#chogHome": {"x": 65.17, "y": 677.57, "w": 461.66, "h": 283.76}, "#chogHomeHit": {"x": 194.19, "y": 779.02, "w": 72.41, "h": 92.26}, "#chogHomeStack": {"x": 65.17, "y": 677.57, "w": 461.66, "h": 283.76}}, "chars": [{"sel": "img#homeWalk.homeChar__walk", "x": 280.45, "y": 743.17, "w": 130.41, "h": 135.01}, {"sel": "img#homeSeat.homeChar__seat", "x": 288.99, "y": 749.41, "w": 117, "h": 122.09}, {"sel": "img.chogHome__part", "x": 171.91, "y": 785.85, "w": 144.79, "h": 128.96}, {"sel": "img.chogHome__part", "x": 180.82, "y": 760.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 175.21, "y": 760.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 178.02, "y": 760.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 151.3, "y": 786.88, "w": 139.09, "h": 121.59}, {"sel": "img.chogHome__part", "x": 178.02, "y": 760.02, "w": 105.12, "h": 125.68}, {"sel": "img.chogHome__part", "x": 173.52, "y": 755.88, "w": 111.56, "h": 131.01}, {"sel": "img.chogHome__part", "x": 178.02, "y": 760.02, "w": 105.12, "h": 125.68}], "scroll": {"docH": 932, "docW": 430, "bodyH": 932, "innerH": 932, "innerW": 430, "stageSH": 968, "stageCH": 932}, "cardCand": {"x": 59.5, "y": 236, "w": 247, "h": 364}}, "1440x900": {"paper": {"x": 559.83, "y": 220, "w": 256.34, "h": 364}, "texts": {"HOME": 16.02, "> status \u00a0 1 in \u00a0 0 out": 12.5, "1": 19.23, "Honeybun": 13.46, "still in home": 9.61, "no records yet": 8.97}, "fixed": {"#homeBoard": {"x": 0, "y": 7.45, "w": 1440, "h": 885.1}, "#homeChar": {"x": 0, "y": 7.45, "w": 1440, "h": 885.1}, "#homeSeat": {"x": 1107.66, "y": 571.24, "w": 171.97, "h": 179.46}, "#chogHome": {"x": 778.67, "y": 465.66, "w": 678.59, "h": 417.09}, "#chogHomeHit": {"x": 968.31, "y": 614.77, "w": 106.43, "h": 135.61}, "#chogHomeStack": {"x": 778.67, "y": 465.66, "w": 678.59, "h": 417.09}}, "chars": [{"sel": "img#homeWalk.homeChar__walk", "x": 1095.1, "y": 562.07, "w": 191.68, "h": 198.45}, {"sel": "img#homeSeat.homeChar__seat", "x": 1107.66, "y": 571.24, "w": 171.97, "h": 179.46}, {"sel": "img.chogHome__part", "x": 935.57, "y": 624.82, "w": 212.82, "h": 189.55}, {"sel": "img.chogHome__part", "x": 948.66, "y": 586.85, "w": 154.52, "h": 184.73}, {"sel": "img.chogHome__part", "x": 940.42, "y": 586.85, "w": 154.52, "h": 184.73}, {"sel": "img.chogHome__part", "x": 944.54, "y": 586.85, "w": 154.52, "h": 184.73}, {"sel": "img.chogHome__part", "x": 905.27, "y": 626.32, "w": 204.44, "h": 178.72}, {"sel": "img.chogHome__part", "x": 944.54, "y": 586.85, "w": 154.52, "h": 184.73}, {"sel": "img.chogHome__part", "x": 937.93, "y": 580.76, "w": 163.98, "h": 192.57}, {"sel": "img.chogHome__part", "x": 944.54, "y": 586.85, "w": 154.52, "h": 184.73}], "scroll": {"docH": 900, "docW": 1440, "bodyH": 900, "innerH": 900, "innerW": 1440, "stageSH": 900, "stageCH": 900}, "cardCand": {"x": 564.5, "y": 220, "w": 247, "h": 364}}};
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e && e.message || e).split("\n").slice(0, 4).join("\n      ")}`); } }
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
await check("A1 css: --homePaperK 1.1 on .homePaper (one step), centre-preserving translate, --type-choice 28/24 on candidates only", () => {
  assert.match(CSS, /--homePaperK: 1\.1;/); assert.match(CSS, /\.homePaper \{\s*transform:\s*translate\(calc\(55px - 200px \* 0\.275 \* var\(--homePaperK\)\)/);
  assert.match(CSS, /--type-choice: 28px;/); assert.match(CSS, /--type-choice: 24px;/); assert.match(CSS, /\.secondJourneyCard \.secondJourney__pick \{ font-size: var\(--type-choice\); \}/);
});
await check("A2 no copy change: Home paper / candidate strings are not touched by this card (style.css only)", () => { assert.equal(/content:\s*["'][^"']+["']/.test(CSS.slice(CSS.indexOf(":root { --homePaperK"))), false); });
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);
const ov = (p, c) => !(c.x >= p.x + p.w || c.x + c.w <= p.x || c.y >= p.y + p.h || c.y + c.h <= p.y);
if (!existsSync(path.join(REPO, "_private"))) console.log("SKIP  browser part — local harness absent");
else {
  let server = null, BASE = process.env.A786_BASE || "";
  if (!BASE) {
    const port = await freePort();
    server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", ...FORK_MODE_ENV /* [A-950] */, VITE_RELAYER_URL: "__HARNESS_NO_GRANT__" }, stdio: ["ignore", "pipe", "pipe"] });
    try { await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); }); }
    catch (e) { await check("B0 vite dev server starts", () => { throw e; }); server = null; BASE = "x"; }
    if (BASE !== "x") BASE = `http://localhost:${port}/`;
  }
  if (BASE !== "x") {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [w, h] of VPS) {
        const vp = `${w}x${h}`; const R = await walk(browser, BASE, w, h); const b = BASE0[vp];
        await check(`B1 [${vp}] reached every scene`, () => { assert.equal(R.error, undefined, R.error); assert.ok(R.homeOpen && R.candidates && R.candidatesPicked && R.readiness, "scenes"); });
        if (R.error) continue;
        const a = R.homeOpen, p = a.geom["#homePaper"];
        await check(`B2 [${vp}] Home paper scaled ~x1.10 about the same centre, inside viewport`, () => {
          // [A-831 RE-PIN] the paper is x1.10 (A-786) x k (card width / 282, A-829) about the layout card centre. pre-A-831 baseline:
          // near(p.w / b.paper.w, 1.1, 0.01, "w ratio"); near(p.h / b.paper.h, 1.1, 0.01, "h ratio"); near(p.x + p.w / 2, b.paper.x + b.paper.w / 2, 1, "cx"); near(p.y + p.h / 2, b.paper.y + b.paper.h / 2, 1, "cy");
          const KL = layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"))(w, h);
          near(p.w / b.paper.w, 1.1 * KL.k, 0.01, "w ratio"); near(p.h / b.paper.h, 1.1 * KL.k, 0.01, "h ratio");
          near(p.x + p.w / 2, KL.cx, 1, "cx"); near(p.y + p.h / 2, KL.cy, 1, "cy");
          assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= a.scroll.innerW && p.y + p.h <= a.scroll.innerH, "inside viewport");
        });
        await check(`B3 [${vp}] Home paper text scaled together (each x1.10), no new clipping`, () => {
          for (const t of a.paperTexts) { if (/^\d+:\d+/.test(t.text)) continue; const was = b.texts[t.text]; assert.ok(was, `string ${t.text} existed before`); near(t.rendered / was, 1.1 * layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"))(w, h).k, 0.01 * layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"))(w, h).k, t.text); /* [A-831 RE-PIN] pre-A-831 baseline: near(t.rendered / was, 1.1, 0.01, t.text) */ }
          assert.equal(a.paperTexts.filter((t) => !/^\d+:\d+/.test(t.text)).length, Object.keys(b.texts).length, "no string added/removed");
          for (const c of a.paperCards) assert.ok(c.x >= p.x - 0.5 && c.y >= p.y - 0.5 && c.x + c.w <= p.x + p.w + 0.5 && c.y + c.h <= p.y + p.h + 0.5, `${c.sel} inside paper`);
        });
        await check(`B4 [${vp}] Piggy/Chog boxes unchanged (+-1px), no overlap with paper, no new scroll`, () => {
          // [A-831 RE-PIN] the characters follow the A-829 keyframe stage, so absolute baseline positions no longer apply. Kept invariants: the board / seat sit where the rule puts them,
          // every other box keeps its pre-A-831 SIZE relation to the Piggy (uniform group scale, +-1 px + 1 %), nothing overlaps the paper.
          // pre-A-831 baseline: for (const [s, g] of Object.entries(b.fixed)) for (const k of ["x","y","w","h"]) near(a.geom[s][k], g[k], 1, `${s}.${k}`); chars: near(c[k], b.chars[i][k], 1, `char ${c.sel}.${k}`)
          const KL4 = layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"))(w, h);
          near(a.geom["#homeBoard"].x, KL4.boardLeft, 1, "#homeBoard.x"); near(a.geom["#homeBoard"].y, KL4.boardTop, 1, "#homeBoard.y"); near(a.geom["#homeBoard"].w, 1256 * KL4.S, 1.5, "#homeBoard.w");
          const kap = a.geom["#homeSeat"].w / b.fixed["#homeSeat"].w;
          for (const [s, g] of Object.entries(b.fixed)) if (s !== "#homeBoard") for (const k of ["w", "h"]) near(a.geom[s][k], g[k] * kap, 1 + 0.01 * g[k] * kap, `${s}.${k}`);
          // position inside the group (restored, round 3): every box keeps its pre-A-831 offset from the Main seat in seat-width units (the group scales uniformly)
          const as = a.geom["#homeSeat"], bs = b.fixed["#homeSeat"];
          for (const [s, g] of Object.entries(b.fixed)) if (s !== "#homeBoard") for (const k of ["x", "y"]) near((a.geom[s][k] - as[k]) / as.w, (g[k] - bs[k]) / bs.w, 0.02 + 1 / as.w, `${s}.${k} relative to the seat`);
          const ch = a.chars.filter((c) => !/homePaper/.test(c.sel)); assert.equal(ch.length, b.chars.length);
          ch.forEach((c, i) => { for (const k of ["x", "y"]) near((c[k] - as[k]) / as.w, (b.chars[i][k] - bs[k]) / bs.w, 0.02 + 1 / as.w, `char ${c.sel}.${k} relative to the seat`); });
          ch.forEach((c, i) => { for (const k of ["w", "h"]) near(c[k], b.chars[i][k] * kap, 1 + 0.01 * b.chars[i][k] * kap, `char ${c.sel}.${k}`); assert.equal(ov(p, c), false, `paper overlaps ${c.sel}`); });
          assert.ok(a.scroll.docH <= b.scroll.docH && a.scroll.docW <= b.scroll.docW && a.scroll.stageSH <= Math.max(b.scroll.stageSH, Math.ceil(KL4.boardTop + 772 * KL4.S) + 1), JSON.stringify(a.scroll)); // [A-831 RE-PIN] pre-A-831 baseline: a.scroll.stageSH <= b.scroll.stageSH (the keyframe board's transparent bottom margin extends below the viewport inside the clipped stage; the document itself never scrolls)
        });
        await check(`B5 [${vp}] candidates: choice css > 18px support, text lines (no shadow/radius/bg), no clip, card box unchanged`, () => {
          const picks = R.candidates.text[".secondJourney__pick"]; assert.equal(picks.length, 3);
          for (const c of picks) { assert.ok(parseFloat(c.fontSize) >= 24 && parseFloat(c.fontSize) > 18, c.fontSize); assert.equal(c.shadow, "none"); assert.equal(c.radius, "0px"); assert.equal(c.bg, "none"); assert.ok(c.sw <= c.cw + 1, "no clip"); }
          // [A-845 RE-PIN] A-843 Choice style, one local size at every width (measured 27.9548 at 390 / 430 / 1440). pre-A-845 baseline: w > 640 ? 24 : 28
          assert.equal(parseFloat(picks[0].fontSize), 27.9548);
          const sup = getComputedFontSupport(R); assert.ok(parseFloat(picks[0].fontSize) > sup, `choice > support ${sup}`);
          // pre-A-837 baseline: for (const k of ["x", "y", "w", "h"]) near(R.candidates.geom["#secondJourneyCard"][k], b.cardCand[k], 1, `card.${k}`); (the 285x364 box at the legacy card slot)
          // A-837 (A-835 items 1/3): the Second card is 1.0 x HomeCard wide (285:364 aspect), centred on the Home card centre.
          // the visible card is the 380 x .65 = 247 px wide sheet inside the 285 px anchor (width ratio 247/285), centred on the anchor, which is centred on the Home card centre
          { const KC = layoutOracle(readFileSync(path.join(REPO, "app/src/main.js"), "utf8"))(w, h), g = R.candidates.geom["#secondJourneyCard"], cw = KC.cardW /* [A-974 re-pin] A-920 item 2 (style.css: the candidates step keeps the base .sendCard box, 285 on a 390 phone). pre-A-974 baseline: cw = (KC.cardW * 247) / 285 */, ch = (KC.cardW * 364) / 285;
            near(g.w, cw, 1, "card.w"); assert.ok(g.h <= ch + 1, `card.h ${g.h} <= anchor ${ch}`); near(g.x + g.w / 2, KC.cx, 1.5, "card centre x"); near(g.y + g.h / 2, KC.cy, 1.5, "card centre y"); }
        });
        await check(`B6 [${vp}] OK gating unchanged: disabled before a pick, enabled after, one picked mark`, () => {
          assert.equal(R.candidates.text["#secondOkButton"][0].disabled, true); assert.equal(R.candidatesPicked.text["#secondOkButton"][0].disabled, false);
          assert.equal(R.candidatesPicked.text[".secondJourney__pick"].filter((c) => /linear-gradient/.test(c.bg)).length, 1);
        });
      }
    } finally { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } }
  }
}
function getComputedFontSupport() { return 18; }
console.log(`\nA-786: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
