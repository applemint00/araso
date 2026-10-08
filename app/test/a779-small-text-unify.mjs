// [A-779] Small-text typography unify + First Send cleanup (A-777 COWORK_FRAME_REVIEW §8.2/§8.3 LOCKED).
//   Part A (node): removals, one-time guard untouched (A-756), supporting-size token + use sites, Chog label sizes, OK gating markup.
//   Part B (browser, 390x844 + 430x932): visible removals, computed font-size equality, candidate chrome, OK disabled->enabled,
//   Chog label rendered size, card/paper/character boxes vs the pre-A-779 baseline (+-1px).
// Env: A779_NODE_ONLY=1 skip Part B | A779_BASE=<url> reuse a running `vite app --mode a172-local`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const CHOG = readFileSync(path.join(REPO, "app/src/chog-home.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e && e.message || e).split("\n").slice(0, 4).join("\n      ")}`); } }
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
function fnBody(src, name) { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, name); const o = src.indexOf("{", src.indexOf(")", i)); let d = 1, j = o + 1; while (d) { if (src[j] === "{") d += 1; else if (src[j] === "}") d -= 1; j += 1; } return src.slice(i, j); }
const sha16 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const CSSNC = stripCss(CSS);
const A779 = CSSNC.slice(CSSNC.indexOf(":root { --type-support:"));

// ── Part A: node ─────────────────────────────────────────────────────────────────────────────────────
await check("A1 First Send terms = [$5] only; 'Ask me every time' / 'One-time' are gone from the live code (comments aside)", () => {
  const body = stripJs(fnBody(MAIN, "renderSendStay"));
  assert.match(body, /terms: \[FIRST_SEND_USD_LABEL\],/);
  assert.equal(/Ask me every time/.test(stripJs(MAIN)), false);
  assert.equal(/["'`]One-time["'`]/.test(stripJs(MAIN)), false);
});
const { sendCardMarkup } = await import(new URL("../src/send-card.js", import.meta.url));
await check("A2 rendered card markup: one term row ($5), message + 0.001 MON test detail + Send present; stay home hidden by CSS on #sendCard only", () => {
  const html = sendCardMarkup({ message: "Piggy is home.", detail: "0.001 MON test", terms: ["$5"] });
  assert.deepEqual([...html.matchAll(/class="sendCard__termLabel">([^<]*)</g)].map((m) => m[1]), ["$5"]);
  assert.ok(html.includes('class="sendCard__message">Piggy is home.<') && html.includes('class="sendCard__detail">0.001 MON test<') && html.includes('id="sendButton"'));
  assert.match(A779, /#sendCard \.sendCard__stay \{ visibility: hidden; \}/);
  assert.equal(/\.secondJourney[^{]*\.sendCard__stay[^{]*\{[^}]*visibility/.test(CSSNC), false, "Explore 'back to Home' is not hidden");
});
await check("A3 one-time (A-756) guard byte-identical to the pre-A-779 tree: firstTripClosedShared / reserveSend / promoteSendReservation / stayHome bodies unchanged", () => {
  assert.equal(sha16(fnBody(MAIN, "firstTripClosedShared")), "1079ba6542288dc8");
  assert.equal(sha16(fnBody(MAIN, "reserveSend")), "2038458e47b1f86e");
  assert.equal(sha16(fnBody(MAIN, "promoteSendReservation")), "0847167f74d7cbc9");
  assert.equal(sha16(fnBody(MAIN, "stayHome")), "771268ad28fba625");
  assert.ok(MAIN.includes('document.querySelector("#stayButton")?.addEventListener("click", stayHome);'), "stayHome wiring kept");
});
await check("A4 one-time behaviour: a closed First (tripClosed='1' or legacy txHash) is refused by reserveSend ('trip_closed'); read failure = closed", () => {
  const mk = (store, throws = false) => ({ getItem: (k) => { if (throws) throw new Error("x"); return Object.hasOwn(store, k) ? store[k] : null; }, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } });
  const run = (store, opts = {}) => new Function("localStorage", "state", "TRIP_CLOSED_KEY", "sendLocksCapable", "sendTabLockHeld", "readSendPending", "sendTabId", "randomHexId", "SEND_RESERVE_KEY_PREFIX",
    `${fnBody(MAIN, "firstTripClosedShared")}\n${fnBody(MAIN, "clearOwnSendTabReservation")}\nlet sendReservation = null;\n${fnBody(MAIN, "reserveSend")}\nreturn { closed: firstTripClosedShared(), r: reserveSend() };`)(
    mk(store, opts.throws), { tripClosed: false }, "araso.tripClosed", () => true, true, () => null, () => "t1", () => "abcd", "araso.sendReserve.");
  assert.deepEqual(run({ "araso.tripClosed": "1" }), { closed: true, r: { ok: false, reason: "trip_closed" } });
  assert.deepEqual(run({ "araso.txHash": "0xabc" }), { closed: true, r: { ok: false, reason: "trip_closed" } });
  const open = run({}); assert.equal(open.closed, false); assert.equal(open.r.ok, true, "an open First still reserves");
  assert.equal(run({}, { throws: true }).closed, true, "fail-closed on read error");
});
await check("A5 one supporting-size token: --type-support 18px drives the First Send message, Explore items and Second candidates; it beats every earlier declaration", () => {
  assert.match(A779, /^:root \{ --type-support: 18px; --type-label: 16px; \}/);
  assert.match(A779, /\.sendCard__message,\n\.secondJourneyCard \.secondJourney__list--interests \.secondJourney__item,\n\.secondJourneyCard \.secondJourney__pick,\n#sendCard \.sendCard__termLabel \{ font-size: var\(--type-support\); \}/);
  const at = CSSNC.indexOf(":root { --type-support:");
  for (const old of [".sendCard__message { font-size: 15px; }", ".secondJourneyCard .secondJourney__list--interests .secondJourney__item { font-size: 15px; }", ".secondJourneyCard .job { font-size: 28px; }"]) assert.ok(CSSNC.lastIndexOf(old) < at, `${old} precedes the token rule`);
  assert.ok(CSS.trimEnd().endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}"), "a681 final block kept last");
});
await check("A6 titles / technical line untouched: send? 41, places to explore? 41, 0.001 MON test 14 (< 18)", () => {
  for (const d of [".sendCard__titleText { font-size: 41px; }", ".secondJourney__exploreText { font-size: 41px; }", ".sendCard__detail { font-size: 14px; }"]) assert.equal((CSSNC.match(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 2, d);
  assert.equal(/(titleText|exploreText|sendCard__detail)/.test(A779.slice(0, A779.indexOf("#returnArrivalAlarm"))), false, "A-779 block never touches them");
});
await check("A6b [v2 Owner] $5 = --type-support (message size); label tier --type-label 16px = the Second card Home link; action words (send/ok, --btnWordSize) untouched", () => {
  assert.match(A779, /^:root \{ --type-support: 18px; --type-label: 16px; \}/);
  assert.match(A779, /\n#secondJourneyCard #stayButton \{ font-size: var\(--type-label\); \}/);
  assert.equal(/btnWordSize|pkbtn__word|#sendButton|#secondOkButton/.test(A779), false);
  assert.match(A779, /\n#secondSendReason \{ font-size: var\(--type-support\); \}/, "action-card status line (checking…) = supporting tier");
  assert.equal(/\.secondJourney__note--paper|\.secondJourney__reason \{/.test(A779), false, "Explore paper note untouched");
});
await check("A9 [v2] copy: First Send card maps the resting state.message 'Piggy is home.' to \"Piggy's first job?\" at render only; every setScene string unchanged", () => {
  const body = fnBody(MAIN, "renderSendStay");
  assert.ok(body.includes(`message: blocked ? "Not from here." : !state.message || state.message === "Piggy is home." ? "Piggy's first job?" : state.message,`));
  assert.equal((stripJs(MAIN).match(/setScene\([^)]*"Piggy is home\."/g) || []).length, 11, "the 11 setScene(..., \"Piggy is home.\", ...) call sites of HEAD 95823b5 unchanged");
  assert.equal((stripJs(MAIN).match(/Piggy's first job\?/g) || []).length, 1, "the new line exists only in renderSendStay");
});
await check("A7 Chog: only 'tap me!' (18 screen px) and #returnArrivalAlarm change; shared .chogCheckLine base 24px / mobile 28px unchanged", () => {
  assert.match(CHOG, /const TAP_CUE_SCREEN_PX = 18;/);
  assert.equal([...A779.matchAll(/#returnArrivalAlarm \{([^}]*)\}/g)].map((m) => m[1].trim()).join(" | "), "font-size: 33px; top: 225.2px; max-width: none; | font-size: 49px; top: 210.8px;");
  assert.ok(/\.chogCheckLine \{ font-size: 28px; \}/.test(CSSNC));
  assert.equal(/chogCheckLine|exploreChogSay|awayRestoreLine/.test(A779), false);
});
const SJV = await import(new URL("../src/second-journey-view.js", import.meta.url));
await check("A8 Second candidates markup: OK (#secondOkButton) disabled until a pick, enabled with one; rows keep their button role", () => {
  const dests = [{ id: "d1", errandIds: ["market"] }, { id: "d2", errandIds: ["order"] }];
  const none = SJV.secondJourneyCardMarkup({ step: "candidates", destinations: dests, pickedCandidateId: null });
  const one = SJV.secondJourneyCardMarkup({ step: "candidates", destinations: dests, pickedCandidateId: "d2" });
  assert.match(none, /id="secondOkButton"[^>]* disabled>/);
  assert.equal(/id="secondOkButton"[^>]* disabled>/.test(one), false);
  assert.equal((one.match(/class="job secondJourney__pick/g) || []).length, 2);
});

// ── Part B: browser ──────────────────────────────────────────────────────────────────────────────────
// Pre-A-779 boxes (A779 receipts before/measure.json, HEAD 95823b5 tree): [x, y, w, h] CSS px.
const BASE_GEOM = {"390x844":{"firstSend":{"#sendCard":[20.01,192,284.99,364],".cardAnchor":[20,192,285,364],"#homeSeat":[252.99,661.41,117,122.09],"#chogHome":[29.17,589.57,461.66,283.76],"#chogHomeHit":[158.19,691.02,72.41,92.26]},"explore":{".cardAnchor":[20.5,192,285,364],"#secondJourneyCard":[20.51,192,284.99,364],"#homeSeat":[252.99,661.41,117,122.09],"#chogHome":[29.17,589.57,461.66,283.76],"#chogHomeHit":[158.19,691.02,72.41,92.26]},"candidates":{".cardAnchor":[20.5,192,285,364],"#secondJourneyCard":[39.5,192,247,364],"#homeSeat":[252.99,661.41,117,122.09],"#chogHome":[29.17,589.57,461.66,283.76],"#chogHomeHit":[158.19,691.02,72.41,92.26]}},"430x932":{"firstSend":{"#sendCard":[24.01,236,284.99,364],".cardAnchor":[24,236,285,364],"#homeSeat":[288.99,749.41,117,122.09],"#chogHome":[65.17,677.57,461.66,283.76],"#chogHomeHit":[194.19,779.02,72.41,92.26]},"explore":{".cardAnchor":[40.5,236,285,364],"#secondJourneyCard":[40.51,236,284.99,364],"#homeSeat":[288.99,749.41,117,122.09],"#chogHome":[65.17,677.57,461.66,283.76],"#chogHomeHit":[194.19,779.02,72.41,92.26]},"candidates":{".cardAnchor":[40.5,236,285,364],"#secondJourneyCard":[59.5,236,247,364],"#homeSeat":[288.99,749.41,117,122.09],"#chogHome":[65.17,677.57,461.66,283.76],"#chogHomeHit":[194.19,779.02,72.41,92.26]}}};

if (process.env.A779_NODE_ONLY === "1") console.log("SKIP  Part B (A779_NODE_ONLY=1) — browser scenarios not run");
else await runBrowser();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);

function freePort() { return new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); }); }

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) { console.log("SKIP  Part B — local browser harness absent (public checkout)"); return; }
  let chromium;
  try { ({ chromium } = createRequire(path.join(REPO, "_private/ops/harness/package.json"))("playwright")); }
  catch (e) { await check("B0 playwright available (local harness)", () => { throw e; }); return; }
  let server = null, BASE = process.env.A779_BASE || "";
  if (!BASE) {
    const port = await freePort();
    server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__" }, stdio: ["ignore", "pipe", "pipe"] });
    try { await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); }); }
    catch (e) { await check("B0 vite dev server starts (needs local port binding)", () => { throw e; }); return; }
    BASE = `http://localhost:${port}/`;
  }
  const browser = await chromium.launch({ headless: true });
  try { for (const [w, h] of [[390, 844], [430, 932]]) await walk(browser, BASE, w, h); }
  finally { await browser.close().catch(() => {}); if (server) { try { server.kill("SIGTERM"); } catch {} await sleep(300); try { server.kill("SIGKILL"); } catch {} } }
}

function SNAP() {
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 100) / 100); };
  const scaleOf = (e) => { let k = 1; for (let a = e; a && a !== document.body; a = a.parentElement) { const t = getComputedStyle(a).transform; if (t && t !== "none") { const m = new DOMMatrix(t); k *= Math.hypot(m.a, m.b); } } return k; };
  const geom = {}; for (const s of ["#sendCard", ".cardAnchor", "#secondJourneyCard", "#homeSeat", "#chogHome", "#chogHomeHit"]) { const e = document.querySelector(s); if (e) geom[s] = box(e); }
  const role = (s) => [...document.querySelectorAll(s)].map((e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2; const t = document.elementFromPoint(cx, cy);
    return { text: e.textContent.trim().replace(/\s+/g, " "), fs: cs.fontSize, rendered: Math.round(parseFloat(cs.fontSize) * scaleOf(e) * 100) / 100, vis: cs.visibility, hit: !!t && (t === e || e.contains(t)), shadow: cs.boxShadow, bgi: cs.backgroundImage, radius: cs.borderRadius, disabled: e.disabled ?? null }; });
  const out = { geom, cardText: document.querySelector("#sendCard")?.innerText ?? null };
  for (const [k, s] of Object.entries({ title: "#sendCard .sendCard__titleText", term: "#sendCard .sendCard__termLabel", message: "#sendCard .sendCard__message", detail: "#sendCard .sendCard__detail", stay: "#sendCard #stayButton", send: "#sendCard #sendButton", explore: ".secondJourney__exploreText", item: ".secondJourney__list--interests .secondJourney__item", back: "#secondJourneyCard #stayButton", pick: ".secondJourney__pick", ok: "#secondOkButton", word: "#sendCard #sendButton .pkbtn__word", okword: "#secondOkButton .pkbtn__word", tap: ".chogHome__tapCue", alarm: "#returnArrivalAlarm", say: "#exploreChogSay" })) out[k] = role(s);
  return out;
}

async function walk(browser, BASE, w, h) {
  const vp = `${w}x${h}`;
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.route("**/*", (route) => { const u = new URL(route.request().url()); if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort(); return route.continue(); });
  const p = await context.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const snap = () => p.evaluate(SNAP);
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 1) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) { const x = b.left + b.width / 2 + sx * dx, y = b.top + b.height / 2 + sy * dy; if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y }; } return null; }, [sel, idx]);
  const mustTap = async (sel, lab, idx = 0) => { for (let i = 0; i < 8; i += 1) { const r = await pointAt(sel, idx); if (r) { await p.mouse.click(r.x, r.y); return; } await sleep(500); } throw new Error(`${lab}: ${sel} unreachable`); };
  // [A-891 CG-04/05] pre-A-891 baseline: after a reload with First done / Second not done, Explore opened by itself (~1.2 s, waitScene(["explore"])).
  // Now (Owner 2026-10-08): quiet Home ~8 s → "tap me!" → the user taps Chog → intro → Explore. forgetIntro() drops the once-per-user intro fact
  // before a reload so a later reopen takes the same product path (Cowork 2026-10-08: before the intro the cue returns on every reload).
  const forgetIntro = () => p.evaluate(() => localStorage.removeItem("araso.secondIntroSeen"));
  const exploreViaTapMe = async (ms = 16000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms && !(await p.locator(".chogHome__tapCue").count())) { if ((await scene()) === "explore") return "explore"; await sleep(200); }
    if (!(await p.locator(".chogHome__tapCue").count())) return `NOCUE:${await scene()}`;
    await mustTap("#chogHomeHit", "Chog (tap me!)");
    return waitScene(["explore"], 5000);
  };
  const unlock = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const S = {};
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
    for (let t0 = Date.now(); Date.now() - t0 < 8000;) { if (await p.locator(".chogHome__tapCue").count()) break; await sleep(60); }
    await sleep(200); S.tap = await snap();
    for (let t0 = Date.now(); Date.now() - t0 < 15000;) { if (await p.locator("#sendCard #sendButton").count()) break; await sleep(200); }
    await sleep(3500); S.first = await snap();
    await p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500);
    await p.evaluate(() => { const root = document.querySelector("#chogHome"); const hit = root?.querySelector(".chogHome__hit"); const s = document.createElement("span"); s.className = "chogCheckLine"; s.id = "returnArrivalAlarm"; s.textContent = "Honeybun is coming home"; root.insertBefore(s, hit); });
    await sleep(150); S.alarm = await snap(); await p.evaluate(() => document.querySelector("#returnArrivalAlarm")?.remove());
    await p.evaluate(() => { const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a779f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa779-dep", redeemTxHash: "0xa779-red", grantTxHash: "0xa779-grant", status: "success", at: Date.parse("2026-10-05T00:00:00Z") }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(800); await unlock();
    // [A-891] the only "tap me!" is now the post-file / revisit cue (First Home stays quiet, Owner 2026-10-08): B5 measures it here, fully visible
    // (entrance 1870 ms). pre-A-891 baseline: S.tap = the first-arrival cue snapshot taken after Name → Home (above; it now finds no label).
    for (let t0 = Date.now(); Date.now() - t0 < 16000 && !(await p.locator(".chogHome__tapCue").count());) await sleep(200);
    await sleep(2100); S.tap = await snap();
    S.reentry = await exploreViaTapMe(); await sleep(2500); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000)
    S.explore = await snap();
    await mustTap("#exploreSaveButton", "save none"); await sleep(900);
    const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
    for (const want of ["grow", "asset-piece"]) { const i = ids.indexOf(want); if (i >= 0) { await mustTap(".secondJourney__item", want, i); await sleep(200); } }
    await mustTap("#exploreSaveButton", "save"); await sleep(3000);
    S.cand = await snap();
    await mustTap(".secondJourney__pick", "pick", 1); await sleep(500);
    S.picked = await snap();
  } catch (e) { await check(`B1 [${vp}] reach every measured scene`, () => { throw e; }); await context.close(); return; }
  await context.close();

  await check(`B1 [${vp}] First Send shows $5, "Piggy's first job?", 0.001 MON test and Send — no 'Ask me every time', no 'One-time', no visible/tappable 'stay home'`, () => {
    assert.deepEqual(S.first.term.map((t) => t.text), ["$5"]);
    assert.deepEqual(S.first.message.map((t) => t.text), ["Piggy's first job?"], "[v2] Owner-approved resting line on the First Send card");
    assert.equal(S.first.message.length, 1); assert.equal(S.first.message[0].vis, "visible");
    assert.ok(S.first.detail[0].text.endsWith("0.001 MON test"));
    assert.equal(S.first.send[0].vis, "visible"); assert.equal(S.first.send[0].hit, true, "Send tappable");
    assert.equal(S.first.stay[0].vis, "hidden"); assert.equal(S.first.stay[0].hit, false, "stay home owns no hit point");
    for (const gone of ["Ask me every time", "One-time", "stay home"]) assert.equal(S.first.cardText.includes(gone), false, `card innerText has no '${gone}'`);
  });
  await check(`B2 [${vp}] one-time unchanged: with the First closed, a reload never shows the First Send card again (explore re-entry)`, () => {
    assert.equal(S.reentry, "explore"); assert.equal(S.explore.send.length, 0, "no First Send button after the First is closed");
  });
  await check(`B3 [${vp}] tiers: Explore items == Second candidates == First Send supporting (18px css); titles 41px; $5 = supporting; Home links 16px; send/ok words unchanged; technical 14px < supporting`, () => {
    // [A-845 RE-PIN] A-843 text styles: the tiers are now ON-SCREEN phone px (Title 26 · Choice 18 · Button 16 · Body 14 · Label 13), each card converting
    // with its own phone scale (Send .65 x 282.3239 / 282, Second .65 x 282.3239 / 285) -> css px = style / K at every width (Send Body measured "21.5138px").
    // Same-tier css px now differ between the two cards (different K); the same-tier invariant moves to the rendered size (equal on screen).
    // css compared to the computed value within the 4-decimal serialisation (1e-4).
    // pre-A-845 baseline: support 18px (message == explore items == $5); candidates 28px; titles 41px; Home links 16px; send / ok words 23px.
    const KS = (0.65 * 282.3239) / 282, K2 = (0.65 * 282.3239) / 285;
    const css = (o, want, m) => assert.ok(Math.abs(parseFloat(o.fs) - want) < 1e-4, `${m}: ${o.fs} vs ${want.toFixed(4)}px`);
    const sup = S.first.message[0].fs; css(S.first.message[0], 14 / KS, "First Send message = Body");
    for (const it of S.explore.item) css(it, 14 / K2, `explore ${it.text} = Body`);
    // [A-786 RE-PIN] the Second candidate choices are no longer the supporting tier (Choice, larger than the Body support text).
    for (const c of S.cand.pick) { css(c, 18 / K2, `candidate ${c.text} = Choice`); assert.ok(c.rendered > S.first.message[0].rendered, "choice > support on screen"); }
    assert.equal(S.first.message[0].rendered, S.explore.item[0].rendered); assert.ok(S.cand.pick[0].rendered > S.first.message[0].rendered, "candidates larger on screen than the support line");
    css(S.first.title[0], 26 / KS, "send? = Title"); css(S.explore.explore[0], 26 / K2, "places to explore? = Title");
    assert.equal(S.first.term[0].fs, sup, "$5 = message size (Body)"); css(S.explore.back[0], 13 / K2, "back to Home = Label"); css(S.cand.back[0], 13 / K2, "Home = Label");
    css(S.first.word[0], 16 / KS, "send word = Button"); css(S.cand.okword[0], 16 / K2, "ok word = Button");
    assert.ok(parseFloat(S.first.detail[0].fs) < parseFloat(sup), "technical smaller");
  });
  await check(`B4 [${vp}] Second candidates: text lines (no shadow / paper / radius); OK disabled until a pick, enabled after; Home still there`, () => {
    for (const c of S.cand.pick) { assert.equal(c.shadow, "none"); assert.equal(/paper_tex_ivory/.test(c.bgi), false); assert.equal(c.radius, "0px"); }
    assert.equal(S.cand.ok[0].disabled, true); assert.equal(S.picked.ok[0].disabled, false);
    assert.equal(S.picked.pick.filter((c) => /linear-gradient/.test(c.bgi)).length, 1, "one picked mark");
    assert.equal(S.cand.back[0].vis, "visible");
  });
  await check(`B5 [${vp}] Chog: 'tap me!' renders 18px, '… is coming home' ≈18px (was 15 / 10.3); Explore say unchanged (28px css)`, () => {
    // [A-845 RE-PIN] A-843 item 6: Chog text = Choice 18 at the phone stage, scaled with the character stage (stage width / 211; 430 -> x1.0497 = 18.89),
    // one local size 18 / (211 / 271.375 x HOME_SCALE) = 49.1267 css for every Chog line incl. the Explore say. Tolerances unchanged.
    // pre-A-845 baseline: tap 18 and alarm ~18 screen px at every width; Explore say "28px" css.
    const stage = layoutOracle(MAIN)(w, h).stageW / 211;
    assert.ok(Math.abs(S.tap.tap[0].rendered - 18 * stage) < 0.05, `tap ${S.tap.tap[0].rendered} vs ${(18 * stage).toFixed(2)}`);
    assert.ok(Math.abs(S.alarm.alarm[0].rendered - 18 * stage) < 0.2, `alarm ${S.alarm.alarm[0].rendered} vs ${(18 * stage).toFixed(2)}`);
    if (S.cand.say.length) assert.equal(S.cand.say[0].fs, "49.1267px");
  });
  await check(`B6 [${vp}] geometry frozen: card / paper / character boxes == pre-A-779 baseline (±1px)`, () => {
    for (const [sc, key] of [["firstSend", "first"], ["explore", "explore"], ["candidates", "cand"]]) for (const [sel, want] of Object.entries(BASE_GEOM[vp][sc])) {
      const got = S[key].geom[sel]; assert.ok(got, `${sc} ${sel} present`);
      got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 1, `${sc} ${sel} ${want} -> ${got}`));
    }
  });
  await check(`B7 [${vp}] no page errors`, () => assert.deepEqual(errors, []));
}
