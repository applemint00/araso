// [A-646 phase B] Money placement UI — Add money entry (S1), allocation preview (S2), remembered-split
// prefill in the UI (S4/T3), per-Piggy at home / working with readout (S8), rails = 0 truthful (S9).
//   node app/test/a646-money-placement-ui.mjs
//
// Part N (node, always): home-paper.js markup contracts + main.js source contracts.
// Part B (real browser, default ON): Playwright headless Chromium + CDP virtual authenticator on a local
//   Vite dev server (127.0.0.1, rpId localhost — same harness as A-644 Part B). Every tap is a REAL mouse
//   click at a point where elementFromPoint hits the element (page.mouse.click), never element.click();
//   typing goes through page.keyboard after a real tap on the field. tx 0 (eth_send* / grant POST aborted
//   and counted); navigator.credentials.get/create counted per step (WebAuthn Δ0 on every Add money step).
//   Env: A646_BASE_URL=http://127.0.0.1:5667/ reuses a running server (else this spawns one on 127.0.0.1:5667
//        and kills it); A646_WIDTHS=390,430,700,1440 (default 390); A646_SHOTS=<dir> saves PNGs;
//        A646_NODE_ONLY=1 skips Part B (prints SKIP; not a PASS).
// On the pre-A-646 tree the Add money markup helpers do not exist → Part N fails → exit 1.
// pre-A-911 baseline: addMoneyEntryAllowed() text pinned below is unchanged; [A-911] reassigns it at runtime to also allow while the Money screen is open (a911-own-screens.mjs G1). The allocation markup (with %) stays pinned; the screen shows amounts only.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const MAIN = readFileSync(path.join(SRC_DIR, "main.js"), "utf8");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const NUDGE = /recommend|suggest|best|default|popular|araso suggests|like last time|keep everything|all in one/i;
const YIELD = /\b(apy|yield|venue)\b|["'`>](safe|instant)\b/i;

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════
let HP = null;
await check("N0 home-paper.js exports the Add money / Piggy state markup helpers (pre-A-646: absent)", async () => {
  HP = await import("../src/home-paper.js");
  for (const n of ["addMoneyEntryMarkup", "addMoneySingleMarkup", "addMoneyAllocationMarkup", "addMoneyPlanMarkup", "piggyMoneyStateMarkup"]) {
    assert.equal(typeof HP[n], "function", `${n} missing`);
  }
});

await check("N1 S1 entry = one existing-canon label `Add money`, real-pointer reachable, ≥36px tap height", () => {
  const html = HP.addMoneyEntryMarkup();
  assert.match(html, /id="homeAddMoney"/);
  assert.match(html, />&gt; Add money</);
  assert.match(html, /pointer-events:auto/);
  assert.match(html, /min-height:36px/);
});

await check("N2 S2/T10/Q2 allocation markup: one row per Piggy with names, amount+percent fields, nothing pre-selected, no address, no nudge words", () => {
  const html = HP.addMoneyAllocationMarkup({ total: "", unit: "USDC", rows: [
    { piggyId: "p1", name: "Honeybun", amount: "", percent: "" },
    { piggyId: "p2", name: "Mochi", amount: "", percent: "" },
  ], canConfirm: false });
  assert.equal((html.match(/data-add-money-row=/g) || []).length, 2);
  assert.match(html, />Honeybun</); assert.match(html, />Mochi</);
  for (const id of ["p1", "p2"]) { assert.match(html, new RegExp(`id="homeAddMoneyAmount--${id}"`)); assert.match(html, new RegExp(`id="homeAddMoneyPercent--${id}"`)); }
  assert.equal(/0x[0-9a-fA-F]{40}/.test(html), false, "no address rendered");
  assert.equal(/--on|aria-pressed="true"|checked|aria-current/.test(html), false, "no pre-selected row");
  assert.equal(/value="[^"]+"/.test(html), false, "first allocation: every field empty");
  assert.equal(NUDGE.test(html.replace(/<[^>]+>/g, " ")), false, "no recommended/default wording");
  assert.match(html, /id="homeAddMoneyOk"[^>]*disabled/, "ok disabled while Σ≠total");
  assert.equal((html.match(/pointer-events:auto/g) || []).length >= 6, true, "back + total + 2×2 fields + ok reachable");
  assert.equal(/<input[^>]*type="(range|checkbox|radio)"/.test(html), false, "no slider / toggle");
});

await check("N3 S2 ok enabled only when told the plan balances; prefilled values render as plain editable numbers", () => {
  const html = HP.addMoneyAllocationMarkup({ total: "100", unit: "USDC", rows: [{ piggyId: "p1", name: "H", amount: "60", percent: "60" }, { piggyId: "p2", name: "M", amount: "40", percent: "40" }], canConfirm: true });
  assert.equal(/id="homeAddMoneyOk"[^>]*disabled/.test(html), false);
  assert.match(html, /id="homeAddMoneyPercent--p1"[^>]*value="60"/);
  assert.equal(/readonly|disabled(?![^<]*homeAddMoneyOk)/.test(html.replace(/<button[\s\S]*?<\/button>/g, "")), false, "prefill is editable");
});

await check("N4 S9 single + plan views reuse fundingMethodsMarkup; rails 0 → every method disabled; plan shows names + amounts only", () => {
  const methods = HP.fundingMethodsMarkup([{ method: "bank_card_apple_pay", available: false, unavailableReason: "no_provider_selected" }, { method: "from_another_wallet", available: false }]);
  const single = HP.addMoneySingleMarkup({ name: "Honeybun", methodsMarkup: methods });
  assert.match(single, />Honeybun</);
  assert.equal(/%|homeAddMoneyPercent|homeAddMoneyAmount/.test(single), false, "one Piggy: no percent / multi-row UI");
  assert.equal((single.match(/<button class="homePaper__records" type="button" disabled>/g) || []).length, 2);
  const plan = HP.addMoneyPlanMarkup({ unit: "USDC", legs: [{ piggyId: "p1", name: "Honeybun", amount: "60" }, { piggyId: "p2", name: "Mochi", amount: "40" }], methodsMarkup: methods });
  assert.match(plan, />Honeybun</); assert.match(plan, />60</); assert.equal(/0x[0-9a-fA-F]{40}|<input/.test(plan), false);
});

await check("N5 S8/T7 at home unknown ≠ $0; working with only when real; returning never rendered; no yield words", () => {
  const unknown = HP.piggyMoneyStateMarkup({ atHomeValue: null, workingWithValue: null });
  assert.match(unknown, /at home[\s\S]*unknown/);
  assert.equal(/\$0/.test(unknown), false);
  assert.equal(/working with|returning/.test(unknown), false);
  const home = HP.piggyMoneyStateMarkup({ atHomeValue: "$12.00", workingWithValue: null });
  assert.match(home, /\$12\.00/); assert.equal(/working with/.test(home), false);
  const away = HP.piggyMoneyStateMarkup({ atHomeValue: null, workingWithValue: "$20.00" });
  assert.match(away, /at home[\s\S]*unknown[\s\S]*working with[\s\S]*\$20\.00/, "working never folded into at home");
  const src = HP.piggyMoneyStateMarkup.toString() + HP.addMoneyAllocationMarkup.toString() + HP.addMoneyPlanMarkup.toString() + HP.addMoneySingleMarkup.toString();
  assert.equal(YIELD.test(stripComments(src)), false);
  assert.equal(/returning/.test(stripComments(src)), false);
});

await check("N6 main.js S1 gate: entry only after confirmed Second, on quiet Home, in MY MONEY; state dies off the MY MONEY face (Q4)", () => {
  assert.match(fnBody("addMoneyEntryAllowed"), /state\.secondJourneyCompletedOnce === true && state\.scene === "sendstay" && state\.homePaperMode === "money"/);
  // pre-A-905 baseline: /const addMoneyEntry = addMoneyEntryAllowed\(\) \? addMoneyEntryMarkup\(\) : "";/ — the entry moved to the honey jar -> Money tab (A-905); MY MONEY renders no Add money line.
  assert.match(MAIN, /const addMoneyEntry = ""; \/\/ \[A-905\]/);
  assert.match(fnBody("homePadMarkup"), /if \(mode !== "money"\) state\.addMoney = null;/);
  assert.match(fnBody("openAddMoney"), /if \(piggies\.length <= 1\)/, "one Piggy → picker skip");
});

await check("N7 T8 Add money code paths call no WebAuthn / signer / tx / funding-open / proof", () => {
  const bodies = ["openAddMoney", "recomputeAddMoney", "addMoneyPlanRows", "confirmAddMoney", "addMoneyBodyMarkup", "handleAddMoneyInput", "piggyMoneyStateMarkupFor", "addMoneyPiggies", "a898OpenFundingPaper"].map((n) => stripComments(fnBody(n))).join("\n");
  for (const re of [/requestPrf|requestMoneyPermission|activateSigningSession|proveFundingTargetControl|beginFundingForPiggy|settleFunding|startFunding|planLegIntent/, /navigator\.credentials|signMessage|sendTransaction|writeContract|fetch\(/, /localStorage\.setItem/, /\bcash\b/i]) {
    assert.equal(re.test(bodies), false, String(re));
  }
  // pre-A-898 baseline: T8 said Add money calls no WebAuthn / proof anywhere. A-898 (Cowork C2 -> (c), 2026-10-08): the entry and the Funding Paper's
  // FIRST screen still use 0 WebAuthn; the ONLY exception is choosing the crypto row, which runs the A-555 destination proof before the Piggy address is shown.
  assert.equal(/a898ProveDestination|proveFundingTargetControl/.test(bodies), false, "entry / first screen: no proof (the opener only builds the paper)");
  const act = stripComments(MAIN.slice(MAIN.indexOf("async function a898Act("), MAIN.indexOf("// ── [A-898] end ──")));
  assert.equal((act.match(/a898ProveDestination\(/g) || []).length, 1, "exactly one proof call site");
  assert.ok(act.indexOf("arg === \"crypto\"") > -1 && act.indexOf("arg === \"crypto\"") < act.indexOf("a898ProveDestination("), "the proof sits inside the crypto-row branch only");
  assert.match(MAIN, /const FUNDING_ADAPTERS = \[\];/, "rails stay 0");
  assert.match(fnBody("confirmAddMoney"), /saveLastSplit\(safeLocalStorage\(\), scope, approved\.plan, approval\)/, "only ratios are remembered, via the closed store");
});

await check("N8 T10 no `cash` identifier special-cased anywhere in app/src (*.js)", () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const hits = walk(SRC_DIR).filter((f) => f.endsWith(".js")).flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l]).filter(([, , l]) => /\bcash\b/i.test(l)));
  assert.deepEqual(hits.map(([f, n]) => `${path.relative(SRC_DIR, f)}:${n}`), []);
});

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEIGHT = { 390: 844, 430: 932, 700: 900, 1440: 900 };
const INIT = `(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials;
  if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`;
if (process.env.A646_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A646_NODE_ONLY=1) — browser scenarios not run");
} else {
  await runBrowser();
}

async function runBrowser() {
  let chromium;
  // Public checkout: Part B runs on the local-only browser harness. Without it, say so (SKIP, not a PASS).
  if (!existsSync(path.join(REPO, "_private"))) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await check("B0 playwright available (_private/ops/harness)", () => { throw e; });
    return;
  }
  let server = null;
  let BASE = process.env.A646_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", "5667", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = "http://localhost:5667/";
  }
  const widths = (process.env.A646_WIDTHS || "390").split(",").map(Number);
  const shots = process.env.A646_SHOTS || "";
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const w of widths) await browserWidth(browser, BASE, w, shots);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

async function browserWidth(browser, BASE, w, shots) {
  const T = `[${w}]`;
  const net = { tx: 0 };
  const context = await browser.newContext({ viewport: { width: w, height: HEIGHT[w] || 900 } });
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

  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a646_w${w}_${name}.png`) }); };
  const scene = () => p.evaluate(() => { const s = document.querySelector("[data-scene]"); const v = s?.dataset.scene ?? null; return v === "return" && s.querySelector(".secondJourney__mockTag") ? "secondReturn" : v; });
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
      const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y, h: b.height, w: b.width };
    }
    return null;
  }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, label, idx = 0) => {
    for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); }
    // [A-898] probe: name what sits at the toggle centre so the next run identifies the cover (assertion unchanged: still throws)
    const cover = await p.evaluate(([s, i]) => {
      const el = document.querySelectorAll(s)[i]; if (!el) return "target missing";
      const b = el.getBoundingClientRect(); const x = b.left + b.width / 2; const y = b.top + b.height / 2;
      const t = document.elementFromPoint(x, y); if (!t) return `rect=${[b.left, b.top, b.width, b.height].map(Math.round)} elementFromPoint=null`;
      const c = t.closest("section, article, [class*=card], [class*=Card], [id]");
      return `rect=${[b.left, b.top, b.width, b.height].map(Math.round)} at=(${Math.round(x)},${Math.round(y)}) vp=${innerWidth}x${innerHeight} elementFromPoint=<${t.tagName.toLowerCase()} id="${t.id}" class="${String(t.className).slice(0, 80)}"> closest=<${c ? c.tagName.toLowerCase() : "none"} id="${c ? c.id : ""}" class="${c ? String(c.className).slice(0, 80) : ""}">`;
    }, [sel, idx]).catch(() => "probe failed");
    throw new Error(`${label}: ${sel} not pointer-reachable | ${cover}`);
  };
  // [A-905] Add money is reached the new way: tap the honey jar -> Money tab -> `> Move money` (default `in`). pre-A-905 baseline: mustTap("#homeAddMoney").
  // [A-911] pre-A-911 baseline: the Money tab and Move money were faces of the Home paper. They are now own full screens (.a911-screen[data-a911="money"|"move"]); the way out is the back sticker (.a911-back).
  const viaJar = async () => { await mustTap("#a905Jar", "honey jar"); await sleep(700); await mustTap("#a905MoveMoney", "Move money"); await sleep(700); };
  const closeScreens = async () => { for (let i = 0; i < 4 && (await p.locator(".a911-screen").count()); i += 1) { await mustTap(".a911-back", "back sticker"); await sleep(700); } };
  const blurField = async () => { await p.evaluate(() => document.activeElement?.blur?.()); await sleep(500); }; // typing mode hides ok until the field is left
  const moveFacts = () => p.evaluate(() => { const m = document.querySelector(".a911-move"); return { dir: m?.dataset.a905Dir ?? null, step: m?.dataset.a905Step ?? null, text: m?.innerText ?? "", inputs: [...document.querySelectorAll(".a911-move input")].map((i) => i.value) }; });
  // real tap on a field, select its content, then type through the keyboard.
  const typeInto = async (sel, text) => {
    await mustTap(sel, `field ${sel}`);
    await p.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await p.keyboard.press("Backspace");
    if (text) await p.keyboard.type(text, { delay: 15 });
    await sleep(120);
  };
  const val = (sel) => p.evaluate((s) => document.querySelector(s)?.value ?? null, sel);
  const okDisabled = () => p.evaluate(() => document.querySelector("#homeAddMoneyOk")?.disabled ?? null);
  const paperMode = () => p.evaluate(() => document.querySelector("#homePaper")?.dataset.paperMode ?? null);
  const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
  const openHomePaper = async () => { for (let i = 0; i < 4; i += 1) { if (await paperOpen()) return true; if (!(await p.locator("#chogHomeHit").count())) return false; await p.locator("#chogHomeHit").click({ force: true }); await sleep(1500); } return paperOpen(); };
  const recOpen = () => p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); return !!a && !a.hidden && a.getBoundingClientRect().width > 1; });
  const closeRecords = async () => { if (!(await recOpen())) return; await mustTap("#recordsCardClose", "HISTORY close"); await sleep(900); };
  const waitMoneyRead = async () => { for (let i = 0; i < 30; i += 1) { const t = await p.evaluate(() => document.querySelector("#homePaper")?.innerText || ""); if (!/checking/i.test(t)) return; await sleep(500); } };
  // [A-905 follow-up] the Money tab (opened via the honey jar) is a different face of mode "money"; the steps that mean the old MY MONEY face first leave it through the
  // stamp (homePadMarkup resets the tab off the money face), then open MY MONEY the usual way. pre-A-905 baseline: no tab existed.
  const leaveMoneyTab = async () => { if ((await paperMode()) === "money" && (await p.locator(".a905-money").count())) { await mustTap("#homePaperMoneyToggle", "stamp back"); await sleep(900); } };
  const toMoney = async () => { await closeScreens(); await closeRecords(); await openHomePaper(); await sleep(800); await leaveMoneyTab(); if ((await paperMode()) === "home") { await mustTap("#homePaperMoneyToggle", "stamp"); await sleep(1500); } await waitMoneyRead(); };
  const toHomeFace = async () => { await closeScreens(); await closeRecords(); if ((await paperMode()) !== "home") { await mustTap("#homePaperMoneyToggle", "stamp back"); await sleep(900); } };
  const unlockIfLocked = async () => { for (let i = 0; i < 3; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const allocationLeft = () => p.evaluate(() => ({
    inputs: document.querySelectorAll('#homePaper input, [id^="homeAddMoneyAmount--"], [id^="homeAddMoneyPercent--"], #homeAddMoneyTotal').length,
    addMoneyBox: document.querySelectorAll(".homePaper__addMoney").length,
    percentText: /\d%/.test(document.querySelector("#homePaper")?.innerText || ""),
    slider: document.querySelectorAll('input[type="range"]').length,
  }));
  const counters = async () => ({ wa: await p.evaluate(() => ({ ...window.__wa })), tx: net.tx });
  const delta = (a, b) => ({ webauthn: b.wa.get - a.wa.get + b.wa.create - a.wa.create, tx: b.tx - a.tx });
  const addr = () => p.evaluate(() => localStorage.getItem("araso.address"));
  const splitKey = async () => `araso.lastSplit.monad-testnet.${await addr()}`;

  try {
    // ── birth + closed First (same harness as A-644 Part B) ──────────────────────────────────
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
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a646f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa646-dep", redeemTxHash: "0xa646-red", grantTxHash: "0xa646-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
    await waitScene(["explore"], 9000);
    await realClick("#stayButton"); await waitScene(["sendstay"], 4000); await sleep(3000);

    await check(`B1 ${T} T1 pre-Second: MY MONEY shows no Add money entry`, async () => {
      assert.equal(await p.evaluate(() => localStorage.getItem("araso.secondJourneyClosed")), null);
      // [A-905 follow-up] Pre-Second the paper can stay closed (the Send card owns the shared slot, or the collapsed stamp is a 2x2 target under Chog's own hit area: this
      // predates A-905, it showed in the A-898 runs before the jar existed). A closed paper has no MY MONEY face at all, so there is no entry to find: assert exactly that.
      // pre-A-905 baseline: await toMoney(); assert.equal(await paperMode(), "money");
      await closeRecords();
      if (!(await openHomePaper())) {
        assert.equal(await paperOpen(), false);
        assert.equal(await p.locator("#homeAddMoney").count(), 0); assert.equal(await p.locator("#a905Jar").count(), 0);
        await shot("T1_preSecond_closed");
        return;
      }
      await toMoney();
      assert.equal(await paperMode(), "money");
      // pre-A-905 baseline: #homeAddMoney count 0. Same meaning: before Second there is no money entry at all (no jar, no old line).
      assert.equal(await p.locator("#homeAddMoney").count(), 0); assert.equal(await p.locator("#a905Jar").count(), 0);
      await shot("T1_preSecond_money");
      await toHomeFace();
    });

    // ── confirmed Second (DEV preview flow, real pointer) ─────────────────────────────────────
    await check(`B2 ${T} confirmed Second → quiet Home, closed key "1"`, async () => {
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
      await waitScene(["secondAway"], 4000);
      assert.equal(await waitScene(["secondReturn"], 45000), "secondReturn");
      for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
        if ((await scene()) !== "secondReturn") break;
        const v = await p.evaluate(() => { const ok = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; }; return { open: ok("returnOpen"), tap: ok("returnTap") }; });
        if (v.open) { if ((await realClick("#returnOpen")) !== "pointer") await p.evaluate(() => document.getElementById("returnOpen").click()); await sleep(900); continue; }
        if (v.tap) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
        await sleep(250);
      }
      assert.equal(await p.evaluate(() => localStorage.getItem("araso.secondJourneyClosed")), "1");
      await sleep(4500);
      assert.equal(await scene(), "sendstay");
    });

    await check(`B3 ${T} T1/T8 one Piggy: entry → 1 tap → Funding Paper first screen: that Piggy named, 3 rows (card/bank disabled), no percent/multi-row UI; WebAuthn Δ0 tx Δ0`, async () => {
      // pre-A-898 baseline: kind "single" + every method disabled via #homeAddMoneyBack. A-898: single Piggy → the Funding Paper (data-add-money="a898-funding"); the first screen
      // uses 0 WebAuthn (only choosing the crypto row may run the A-555 destination proof, exercised in a898-funding-gift-browser.mjs).
      await toMoney();
      const box = await pointAt("#a905Jar"); // pre-A-905 baseline: pointAt("#homeAddMoney")
      assert.ok(box, "entry pointer-reachable");
      assert.ok(box.h >= 20, `entry tap height ${box.h}`);
      await shot("T1_1piggy_money_entry");
      const c0 = await counters();
      await mustTap("#a905Jar", "honey jar"); await sleep(700);
      // pre-A-911 baseline: the Piggy was named inside the Funding Paper. A-911: the Money tab screen names it (Piggy row), the Move money screen below carries the rows.
      assert.match(await p.evaluate(() => document.querySelector('.a911-screen[data-a911="money"]')?.innerText ?? ""), /Honeybun/);
      await mustTap("#a905MoveMoney", "Move money"); await sleep(700);
      const v = await p.evaluate(() => ({
        dir: document.querySelector(".a911-move")?.dataset.a905Dir ?? null,
        step: document.querySelector(".a911-move")?.dataset.a905Step ?? null,
        percentFields: document.querySelectorAll('[id^="homeAddMoneyPercent--"]').length,
        rows: document.querySelectorAll("[data-add-money-row]").length,
        paperRows: [...document.querySelectorAll("[data-a898-row]")].map((b) => ({ id: b.dataset.a898Row, disabled: Boolean(b.disabled) || b.getAttribute("aria-disabled") === "true" })),
      }));
      assert.equal(v.dir, "in"); assert.equal(v.step, "rows");
      assert.equal(v.percentFields, 0); assert.equal(v.rows, 0);
      // [A-924 RE-PIN · A-920 item 5] crypto first (mock order). pre-A-924 baseline: card · bank · crypto
      assert.deepEqual(v.paperRows, [{ id: "crypto", disabled: false }, { id: "card", disabled: true }, { id: "bank", disabled: true }]);
      assert.deepEqual(delta(c0, await counters()), { webauthn: 0, tx: 0 });
      await shot("T1_1piggy_single");
      await closeScreens();
      assert.deepEqual(await allocationLeft(), { inputs: 0, addMoneyBox: 0, percentText: false, slider: 0 });
      assert.equal(await p.locator("#a905Jar").count(), 1, "entry back in place"); // pre-A-905 baseline: #homeAddMoney count 1 (the entry is now the honey jar)
      await toMoney(); // B4 expects the old MY MONEY face (the Money tab is left through the stamp)
    });

    await check(`B4 ${T} T12 A-644 Slice 1 unchanged: one-Piggy detail still shows the 3 control labels; S8 at home row present, no returning`, async () => {
      await mustTap("#homePaperMoneyRow", "single row"); await sleep(900);
      assert.equal(await paperMode(), "piggyDetail");
      const s = await p.evaluate(() => ({ labels: [...document.querySelectorAll('[id^="homeControlMode--"]')].map((b) => b.textContent), text: document.querySelector("#homePaper")?.innerText || "", state: document.querySelector("[data-piggy-state]")?.innerText || "" }));
      assert.deepEqual(s.labels, ["Piggy decides", "Ask me", "I'll manage"]);
      assert.match(s.state, /at home/);
      assert.equal(/returning/i.test(s.text), false);
      assert.equal(YIELD.test(s.text), false);
      await shot("T7_1piggy_detail_state");
      await mustTap("#homePiggyDetailBack", "detail back"); await sleep(600);
      await toHomeFace();
    });

    // ── +Piggy → Mochi ───────────────────────────────────────────────────────────────────────
    let ids = {};
    await check(`B5 ${T} +Piggy (real pointer) → Mochi; MY MONEY 2 rows + one Add money entry`, async () => {
      await openHomePaper(); await sleep(800);
      const idx = await p.evaluate(() => [...document.querySelectorAll(".homePlusPiggyTab")].findIndex((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0));
      assert.ok(idx >= 0, "+Piggy visible post-Second");
      await mustTap(".homePlusPiggyTab", "+Piggy", idx);
      assert.equal(await waitScene(["name"], 15000), "name"); await sleep(1200);
      for (let t0 = Date.now(); Date.now() - t0 < 20000;) { const v = await p.evaluate(() => !!document.querySelector("#piggyNameInput") && document.querySelector("#piggyNameInput").getBoundingClientRect().width > 0); if (v) break; if (await p.locator(".nameCard__okBtn").count()) await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(700); }
      await p.locator("#piggyNameInput").fill("Mochi"); await sleep(150);
      await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
      await waitScene(["sendstay"], 8000); await sleep(3000);
      await toMoney();
      const rows = await p.evaluate(() => [...document.querySelectorAll('[id^="homeMoneyPiggyRow--"]')].map((e) => ({ id: e.id.slice("homeMoneyPiggyRow--".length), text: e.textContent.replace(/\s+/g, " ").trim() })));
      assert.equal(rows.length, 2);
      ids = { honey: rows.find((r) => r.text.startsWith("Honeybun")).id, mochi: rows.find((r) => r.text.startsWith("Mochi")).id };
      assert.equal(await p.locator("#a905Jar").count(), 1);
      await shot("T2_2piggies_money_entry");
    });

    await check(`B6 ${T} T2/T10/Q2 first allocation: one screen, a row per Piggy (names, no address), nothing pre-filled/selected, ok disabled`, async () => {
      assert.equal(await p.evaluate((k) => localStorage.getItem(k), await splitKey()), null, "no memory yet");
      const c0 = await counters();
      await viaJar(); // pre-A-905 baseline: await mustTap("#homeAddMoney", "Add money"); await sleep(700);
      // pre-A-911 baseline: kind "allocation" inside .homePaper__addMoney with amount + percent fields. A-911: the Move money screen, step "split", amount fields only (Owner answer 5: no %).
      const v = await p.evaluate(() => ({
        kind: document.querySelector(".a911-move")?.dataset.a905Step === "split" ? "allocation" : (document.querySelector(".a911-move")?.dataset.a905Step ?? null),
        rows: [...document.querySelectorAll("[data-add-money-row]")].map((r) => r.querySelector("span").textContent),
        values: [...document.querySelectorAll(".a911-move input")].map((i) => i.value),
        text: document.querySelector(".a911-move")?.innerText ?? "",
        html: document.querySelector(".a911-move")?.innerHTML ?? "",
      }));
      assert.equal(v.kind, "allocation");
      assert.deepEqual(v.rows.sort(), ["Honeybun", "Mochi"]);
      assert.ok(v.values.every((x) => x === ""), `all empty: ${v.values}`);
      // piggyIds may embed an address (existing id format, e.g. homeMoneyPiggyRow--…) — no address is SHOWN or typed.
      assert.equal(/0x[0-9a-fA-F]{40}/.test(v.text), false, "no address shown");
      assert.equal(/value="0x|placeholder="0x|name="(address|to|destination)"/.test(v.html), false, "no address input");
      assert.equal(NUDGE.test(v.text), false, "no nudge wording");
      assert.equal(await okDisabled(), true);
      assert.equal(/%/.test(v.text), false, "amounts only, no percent");
      assert.deepEqual(delta(c0, await counters()), { webauthn: 0, tx: 0 });
      await shot("T2_allocation_empty");
    });

    // pre-A-911 baseline: B7 also typed the percent field and pinned amount -> percent -> amount both ways. The % input is not rendered on the screen (Owner answer 5); the ratio maths stays
    // pinned in a646-money-placement-model.mjs and by the remembered-split ratios in B8/B10. Here: amounts via real taps + keyboard, Σ != total blocks ok, tap targets on screen.
    await check(`B7 ${T} T2 amounts via real taps + keyboard; Σ≠total blocks ok; tap targets ≥ 20px on screen`, async () => {
      const c0 = await counters();
      for (const sel of ["#homeAddMoneyTotal", `[id="homeAddMoneyAmount--${ids.honey}"]`, `[id="homeAddMoneyAmount--${ids.mochi}"]`, "#homeAddMoneyOk", ".a911-back"]) {
        const b = await pointAt(sel); assert.ok(b, `${sel} reachable`); assert.ok(b.h >= 20, `${sel} tap height ${b.h}`);
      }
      await typeInto("#homeAddMoneyTotal", "100");
      // the fields are really visible (not just present): text color, size, box.
      const look = await p.evaluate(() => [...document.querySelectorAll(".a911-move input")].map((i) => {
        const cs = getComputedStyle(i); const b = i.getBoundingClientRect();
        return { id: i.id, color: cs.color, fill: cs.webkitTextFillColor, fs: cs.fontSize, vis: cs.visibility, op: cs.opacity, w: Math.round(b.width), h: Math.round(b.height), disp: cs.display };
      }));
      for (const l of look) {
        const alpha = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return 1; const parts = m[1].split(",").map((s) => s.trim()); return parts.length === 4 ? Number(parts[3]) : 1; };
        assert.ok(l.vis === "visible" && Number(l.op) > 0.5 && alpha(l.color) > 0.5 && alpha(l.fill) > 0.5 && parseFloat(l.fs) >= 12 && l.w > 10 && l.h > 10 && l.disp !== "none", `field not visible: ${JSON.stringify(l)}`);
        // ink on paper: the field's text must be dark (the page's light default ink is invisible on ivory paper).
        const rgb = String(l.color).match(/\d+/g).slice(0, 3).map(Number);
        assert.ok(rgb[0] + rgb[1] + rgb[2] < 200, `field ink too light on paper: ${l.color}`);
      }
      await typeInto(`[id="homeAddMoneyAmount--${ids.honey}"]`, "60");
      assert.equal(await okDisabled(), true, "Σ 60 ≠ 100");
      await typeInto(`[id="homeAddMoneyAmount--${ids.mochi}"]`, "40");
      assert.equal(await okDisabled(), false, "Σ = total");
      await typeInto(`[id="homeAddMoneyAmount--${ids.mochi}"]`, "30");
      assert.equal(await okDisabled(), true, "Σ 90 ≠ 100 → blocked, no remainder dump");
      await typeInto(`[id="homeAddMoneyAmount--${ids.mochi}"]`, "40");
      assert.equal(await okDisabled(), false);
      await typeInto("#homeAddMoneyTotal", "200");
      assert.equal(await val(`[id="homeAddMoneyAmount--${ids.honey}"]`), "60", "total change keeps typed amounts");
      assert.equal(await okDisabled(), true);
      await typeInto("#homeAddMoneyTotal", "100");
      assert.equal(await okDisabled(), false);
      assert.deepEqual(delta(c0, await counters()), { webauthn: 0, tx: 0 });
      assert.equal(await scene(), "sendstay");
      await shot("T2_allocation_balanced");
    });

    await check(`B8 ${T} T8/T9 ok = ONE tap → plan (names + amounts) + truthful unavailable methods; nothing sent; memory = ratios only`, async () => {
      const c0 = await counters();
      await blurField(); // pre-A-911 baseline: ok was always visible; A-911 hides it while typing
      await mustTap("#homeAddMoneyOk", "ok"); await sleep(700);
      const v = await p.evaluate(() => ({
        kind: document.querySelector(".a911-move")?.dataset.a905Step === "rows" && document.querySelector("[data-add-money-leg]") ? "plan" : (document.querySelector(".a911-move")?.dataset.a905Step ?? null),
        legs: [...document.querySelectorAll("[data-add-money-leg]")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
        methods: [...document.querySelectorAll(".homePaper__choices--funding button")].map((b) => b.disabled),
        fundingRows: [...document.querySelectorAll("[data-a898-row]")].map((b) => ({ id: b.dataset.a898Row, label: (b.querySelector("span")?.textContent || b.textContent).replace(/^[>\s]+/, "").trim(), disabled: Boolean(b.disabled) || b.getAttribute("aria-disabled") === "true", plan: b.dataset.a905Act === "plan-fund" })),
        inputs: document.querySelectorAll(".a911-move input").length,
      }));
      assert.equal(v.kind, "plan");
      assert.equal(v.legs.length, 2);
      assert.ok(v.legs.some((l) => /^Honeybun\s*60\s*USDC$/.test(l)) && v.legs.some((l) => /^Mochi\s*40\s*USDC$/.test(l)), v.legs.join(" | "));
      // pre-A-905 baseline: assert.ok(v.methods.length >= 1 && v.methods.every(Boolean), "rails 0 → all disabled") over `.homePaper__choices--funding button`.
      // A-905 (Cowork decision): 2+ `in` goes allocation → the Funding rows (Card / Bank transfer / Crypto); card/bank are disabled and crypto enabled INSIDE the Funding Paper
      // that a row tap opens (a898-funding-gift-browser pins that). Here, before any row is tapped, the plan offers exactly the three rows and nothing was sent.
      // pre-A-911 baseline: three plan-fund buttons. A-911: card + bank are always dim ("Not ready yet", not a button), crypto is the one enabled plan-fund row.
      // [A-924 RE-PIN · A-920 item 5] crypto first (mock order). pre-A-924 baseline: card · bank · crypto
      assert.deepEqual(v.fundingRows, [{ id: "crypto", label: "Pay with crypto", disabled: false, plan: true }, { id: "card", label: "Pay with card", disabled: true, plan: false }, { id: "bank", label: "Bank transfer", disabled: true, plan: false }]);
      assert.equal(v.methods.length, 0, "the old methods list is gone");
      assert.equal(v.inputs, 0);
      assert.deepEqual(delta(c0, await counters()), { webauthn: 0, tx: 0 });
      const raw = await p.evaluate((k) => localStorage.getItem(k), await splitKey());
      const rec = JSON.parse(raw);
      assert.deepEqual(Object.keys(rec).sort(), ["accountId", "chainId", "ratios", "updatedAt", "version"]);
      assert.deepEqual(rec.ratios, [{ piggyId: ids.honey, bps: 6000 }, { piggyId: ids.mochi, bps: 4000 }].sort((a, b) => (a.piggyId < b.piggyId ? -1 : 1)));
      assert.ok(rec.ratios.every((r) => JSON.stringify(Object.keys(r).sort()) === '["bps","piggyId"]'), "ratio entries = piggyId + bps only");
      assert.equal(/"(amount|total|address|target|permission|planHash|planId|approval)"/i.test(raw), false);
      await shot("T8_plan_unavailable");
    });

    await check(`B9 ${T} T9/Q4 after close: no allocation element in MY MONEY or Home; re-entering MY MONEY shows rows + entry only`, async () => {
      await mustTap(".a911-back", "back sticker"); await sleep(700);
      // pre-A-911 baseline: back landed on the Money tab (.a905-money__piggy rows). Now one back sticker tap leaves the plan; the Money tab screen lists the 2 Piggies (.a911-piggy), the Move money screen is gone.
      await closeScreens();
      assert.deepEqual(await allocationLeft(), { inputs: 0, addMoneyBox: 0, percentText: false, slider: 0 });
      // pre-A-905 baseline: the old MY MONEY face (2 × homeMoneyPiggyRow--) was shown after back. A-905: back lands on the Money tab (2 Piggy rows in its list); the old face follows via toMoney() below.
      await mustTap("#a905Jar", "honey jar"); await sleep(700);
      assert.equal(await p.locator('.a911-screen[data-a911="money"] .a911-piggy').count(), 2);
      await closeScreens();
      await toHomeFace();
      assert.deepEqual(await allocationLeft(), { inputs: 0, addMoneyBox: 0, percentText: false, slider: 0 });
      await shot("T9_home_after_close");
      await toMoney();
      assert.deepEqual(await allocationLeft(), { inputs: 0, addMoneyBox: 0, percentText: false, slider: 0 });
      assert.equal(await p.locator("#a905Jar").count(), 1);
    });

    await check(`B10 ${T} T3 remembered split: next Add money prefills the same ratios as plain numbers; nothing runs until ok`, async () => {
      const c0 = await counters();
      await viaJar(); // pre-A-905 baseline: await mustTap("#homeAddMoney", "Add money"); await sleep(700);
      // pre-A-911 baseline: the remembered 60 / 40 showed as percent numbers. The % field is not rendered now; the remembered ratio shows as the amounts it makes once this deposit's total is typed.
      assert.deepEqual((await moveFacts()).inputs, ["", "", ""], "nothing pre-filled before this deposit's total");
      assert.equal(await okDisabled(), true, "prefill never skips confirm");
      const text = (await moveFacts()).text;
      assert.equal(NUDGE.test(text), false, "no recommended / like-last-time wording");
      await typeInto("#homeAddMoneyTotal", "250");
      assert.equal(await val(`[id="homeAddMoneyAmount--${ids.honey}"]`), "150");
      assert.equal(await val(`[id="homeAddMoneyAmount--${ids.mochi}"]`), "100");
      assert.equal(await okDisabled(), false);
      assert.equal((await moveFacts()).step, "split", "still a preview");
      assert.deepEqual(delta(c0, await counters()), { webauthn: 0, tx: 0 });
      await shot("T3_prefilled");
      // 100% to one Piggy in minimal taps: Honeybun = the whole total, Mochi cleared.
      await typeInto(`[id="homeAddMoneyAmount--${ids.honey}"]`, "250");
      await typeInto(`[id="homeAddMoneyAmount--${ids.mochi}"]`, "");
      assert.equal(await val(`[id="homeAddMoneyAmount--${ids.honey}"]`), "250");
      assert.equal(await okDisabled(), false, "100% to one Piggy is a valid plan");
      await closeScreens();
    });

    await check(`B11 ${T} T3 tampered memory (permission field / bad version) → no prefill`, async () => {
      const k = await splitKey();
      const good = await p.evaluate((kk) => localStorage.getItem(kk), k);
      for (const bad of [{ ...JSON.parse(good), permission: { auto: true } }, { ...JSON.parse(good), version: 2 }]) {
        await p.evaluate(([kk, v]) => localStorage.setItem(kk, v), [k, JSON.stringify(bad)]);
        await viaJar(); // pre-A-905 baseline: await mustTap("#homeAddMoney", "Add money"); await sleep(600);
        assert.ok((await moveFacts()).inputs.every((x) => x === ""), `no prefill: ${(await moveFacts()).inputs}`);
        // stronger than the pre-A-911 check (empty % fields): with a tampered memory a typed total must NOT spread into remembered amounts
        await typeInto("#homeAddMoneyTotal", "100");
        const after = (await moveFacts()).inputs;
        assert.deepEqual(after.slice(1), ["", ""], `no prefill after the total: ${after}`);
        await closeScreens();
      }
      await p.evaluate(([kk, v]) => localStorage.setItem(kk, v), [k, good]);
    });

    await check(`B12 ${T} T7/S8 selected Piggy shows at home (verified value or unknown, never invented $0), no returning; Slice 1 selector intact`, async () => {
      await toMoney(); // [A-905] back to the old MY MONEY face (the Money tab is left through the stamp). pre-A-905 baseline: already there.
      const reg = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("araso.piggyRegistry.")); return k ? JSON.parse(localStorage.getItem(k)) : null; });
      for (const [name, id] of [["Mochi", ids.mochi], ["Honeybun", ids.honey]]) {
        await mustTap(`[id="homeMoneyPiggyRow--${id}"]`, `${name} row`); await sleep(1500);
        await closeRecords();
        const s = await p.evaluate(() => ({ state: document.querySelector("[data-piggy-state]")?.innerText.replace(/\s+/g, " ").trim() ?? null, text: document.querySelector("#homePaper")?.innerText || "", sel: document.querySelector(".homePaper__choices--control")?.dataset.controlPiggyId ?? null }));
        assert.equal(s.sel, id, `${name}: control-depth selector for the selected row (T12)`);
        const piggy = reg?.piggies?.find((x) => x.id === id) || null;
        const usd = piggy?.valuation?.usd;
        const want = piggy?.location === "home" && typeof usd === "string" ? `at home $${usd}` : "at home unknown";
        assert.ok(s.state?.startsWith(want), `${name}: "${s.state}" should start with "${want}"`);
        if (piggy?.location !== "away") assert.equal(/working with/.test(s.state), false);
        assert.equal(/returning/i.test(s.text), false);
        assert.equal(YIELD.test(s.text), false);
        await shot(`T7_${name}_selected_state`);
      }
      assert.equal(await p.locator("#a905Jar").count(), 1, "entry still there alongside the selection");
    });

    await check(`B13 ${T} whole run: tx 0, pageerror 0, credentials.create 0 since the last reload`, async () => {
      assert.equal(net.tx, 0);
      assert.deepEqual(errors, []);
      assert.equal((await p.evaluate(() => window.__wa)).create, 0);
    });
  } catch (e) {
    await check(`B! ${T} browser run`, () => { throw e; });
  } finally {
    await context.close();
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
