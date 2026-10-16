// A-849 Wave 3 rest — UI-20 Second scrollbar, UI-24 empty candidates card, UI-11 centred card + keyboard.
// Part N (node, source/markup): no fake "checking…", "wait." + picked line + footer markup, two Chog lines, helper outside pinned fns.
// Part B (browser, local vite on a free port, Playwright from the local harness; A849_NODE_ONLY=1 skips it):
//   B1 Second first card: body scrollHeight <= clientHeight at 390/810/1440, no visible scrollbar, long content still scrolls
//   B2 candidates card: same size + footer position with 0 / 1 / 3 candidates (+-0.5 px); picked line; "wait." + exact Chog lines; no "nah."
//   B3 centred cards: no lift without an obstruction; lift = covered + 16 with a simulated visualViewport shrink; returns on release; reduced motion instant
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_MODE_ENV, FORK_MODE_INIT, RUN_SCOPE, forkFirstDone, forkKey, forkRpcStub } from "./helpers/fork-mode.mjs"; // [A-950] fork-profile mode (STALE_TESTS class (a)): the Second UI opens only on the fork profile since A-948
import { secondJourneyCardMarkup, exploreCandidateDestinations } from "../src/second-journey-view.js";
import { exploreCandidateRows } from "../src/mainnet-job-lane.js";
import { listVisibleJobFamilies } from "../src/second-job-readiness.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LABELS = { grow: "put some money to work", "asset-piece": "pick up a piece of an asset", market: "go to the market", order: "leave an order", clean: "tidy the wallet" };
const rowsAll = exploreCandidateRows({ decisions: [], families: listVisibleJobFamilies() }).rows;
const dest = (ids) => exploreCandidateDestinations(rowsAll, { selectedErrandIds: ids });

// ═══ Part N ═══
await check("N1 candidates markup: heading follows the read state; wait. only with picks and 0 rows; picked line under the title with existing labels", () => {
  const d3 = dest(["asset-piece", "grow"]);
  const reading = secondJourneyCardMarkup({ step: "candidates", destinations: d3, selectedIds: ["grow"], errandLabelById: LABELS, reading: true });
  assert.match(reading, /secondJourney__exploreText">checking…</);
  const idle = secondJourneyCardMarkup({ step: "candidates", destinations: d3, selectedIds: ["asset-piece", "grow"], errandLabelById: LABELS });
  assert.equal(/checking…|wait\.|nah\./.test(idle), false, "idle with rows: no checking…/wait./nah.");
  // [A-1305 ⑤ RE-PIN · Owner 06:2x] pre-A-1305: the picked line sat between the title and the rows. Now with rows up the names are on
  // the rows only (no small line above); with 0 rows ("wait.") the picked line stays under the title (asserted on `wait` below).
  assert.equal(/id="secondPickedLine"/.test(idle), false, "rows up: no picked line above them");
  const wait = secondJourneyCardMarkup({ step: "candidates", destinations: [], selectedIds: ["market"], errandLabelById: LABELS });
  assert.match(wait, /secondJourney__exploreText">wait\.</);
  assert.match(wait, /id="secondPickedLine">go to the market</);
  assert.ok(wait.indexOf("secondCandidatesHeading") < wait.indexOf("secondPickedLine"), "0 rows: picked line under the title");
  assert.equal(/nah\./.test(wait), false, "no-match is wait., never nah.");
  assert.match(wait, /secondJourneyCard--candidates/);
  assert.match(wait, /id="stayButton"[^>]*>Home</);
  assert.match(wait, /id="secondOkButton"[^>]*disabled/);
  const noPicks = secondJourneyCardMarkup({ step: "candidates", destinations: [], selectedIds: [], errandLabelById: LABELS });
  assert.equal(/wait\./.test(noPicks), false, "empty picks (resume) is not a wait. state");
});
await check("N2 no fake checking: the reveal delay can never start from the save path; the read flag is set only around the real read", () => {
  const save = fnBody("handleExploreSave");
  assert.match(save, /sj\.candidatesRevealed = true;/);
  assert.equal(/candidatesRevealed = false/.test(MAIN), false, "nothing arms the 1500 ms reveal any more");
  const refresh = fnBody("refreshSecondLaneCandidates");
  assert.ok(refresh.indexOf("sj.laneReading = true") < refresh.indexOf("await readSecondCurrent") && refresh.indexOf("await readSecondCurrent") < refresh.indexOf("sj.laneReading = false"));
});
await check("N2b heading and Chog wait lines share one picks helper; nothing assigns candidatesRevealed = false", () => {
  assert.match(fnBody("secondPickedErrandIds"), /buildVisibleLaneChoices/);
  assert.match(fnBody("buildSecondJourneyViewModel"), /pickedErrandIds: secondPickedErrandIds\(sj\)/);
  assert.match(fnBody("chogHomeMarkupForExplore"), /secondPickedErrandIds\(sj\)\.length > 0/);
  assert.equal(/candidatesRevealed\s*=\s*false/.test(MAIN), false, "the dead reveal block in render() can never re-activate");
});
await check("N3 two Chog lines exactly, stacked spans, in the existing exploreChogSay mechanism", () => {
  const f = fnBody("chogHomeMarkupForExplore");
  // [A-1281] the same two lines, stacked, said one at a time (the second joins after the first is read); pre-A-1281: both literal spans at once
  assert.ok(f.includes('${chogLinesMarkup("exploreWait", ["oh… no jobs to go.", "wait for the next bell?"])}'));
  assert.match(MAIN, /function chogLinesMarkup\(key, lines\) \{[\s\S]*?class="chogCheckLine__line\$\{/);
  assert.ok(f.includes('id="exploreChogSay"'));
});
await check("N4 shared centred-card helper: measured only (visualViewport), 16px gap, outside the hash-pinned functions, CSS ~0.2s + reduced motion", () => {
  assert.match(MAIN, /const CENTER_CARD_GAP_PX = 16;/);
  assert.match(fnBody("centeredCardLiftFor"), /covered > 0 \? covered \+ CENTER_CARD_GAP_PX : 0/);
  for (const pinned of ["render", "renderAuthCard", "loginCheckingMarkup"]) assert.equal(/centerCardLift|applyCenteredCardLift/.test(fnBody(pinned)), false, `${pinned} untouched`);
  assert.match(CSS, /translate: 0 calc\(var\(--centerCardLift, 0px\) \* -1\);\s*transition: translate \.2s ease-out;/);
  assert.match(CSS, /prefers-reduced-motion: reduce\) \{\s*\.nameScene__pad,[\s\S]*?transition: none;/);
  assert.match(CSS, /\.secondJourney__body::-webkit-scrollbar \{ display: none;/);
  assert.match(CSS, /\.secondJourney__body \{ scrollbar-width: none;/);
});

// ═══ Part B ═══
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function runBrowser() {
  if (!existsSync(privatePath())) { console.log("SKIP  Part B — local browser harness absent; browser scenarios not run"); return; }
  let chromium;
  try {
    const req = createRequire(privatePath("ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) { await check("B0 playwright available (local harness)", () => { throw e; }); return; }
  const port = await freePort();
  const server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
    cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", ...FORK_MODE_ENV /* [A-950] */ }, stdio: ["ignore", "pipe", "pipe"], detached: false,
  });
  let browser = null;
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    const shots = process.env.A849_SHOTS || "";
    if (shots) mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    await browserRun(browser, `http://localhost:${port}/`, shots);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.kill("SIGTERM"); } catch {}
    await sleep(300);
    try { server.kill("SIGKILL"); } catch {}
  }
}

async function browserRun(browser, BASE, shots) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
  await context.route("**/*", async (route) => {
    const body = route.request().postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) return route.abort();
    return route.continue();
  });
  await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a849_${name}.png`) }); };
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
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
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { const r = await pointAt(sel, idx); if (r) { await p.mouse.click(r.x, r.y); return; } await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
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
  const step = () => p.evaluate(() => document.querySelector("#exploreForm") ? "interests" : document.querySelector("#secondSendButton") ? "readiness" : document.querySelector("#secondOkButton") ? "candidates" : document.querySelector("#secondJourneyCard") ? "note" : null);
  const bodyMetrics = () => p.evaluate(() => { const b = document.querySelector(".secondJourney__body"); const cs = getComputedStyle(b); return { sh: b.scrollHeight, ch: b.clientHeight, ow: b.offsetWidth, cw: b.clientWidth, sbw: cs.scrollbarWidth, ov: cs.overflowY }; });
  const candGeometry = () => p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
    const h2 = document.querySelector("#secondCandidatesHeading");
    return { card: r("#secondJourneyCard"), footer: r(".secondJourneyCard .footer"), home: r("#stayButton"), ok: r("#secondOkButton"), heading: h2?.innerText?.trim(), state: h2?.dataset.state, picked: document.querySelector("#secondPickedLine")?.innerText ?? null, chog: [...document.querySelectorAll("#exploreChogSay .chogCheckLine__line")].map((e) => e.textContent), chogRaw: document.querySelector("#exploreChogSay")?.textContent ?? null, rows: document.querySelectorAll(".secondJourney__pick").length, text: document.querySelector("#secondJourneyCard").innerText, bodySh: document.querySelector(".secondJourney__body").scrollHeight, bodyCh: document.querySelector(".secondJourney__body").clientHeight };
  });
  const centre = (g) => [g[0] + g[2] / 2, g[1] + g[3] / 2];

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
    await sleep(1500);

    // ── UI-11 centred cards: Name it / Got Piggy pad, plus injected Couldn't-find / Checking surfaces ───────────
    const fakeVv = (h, offsetTop = 0) => p.evaluate(([hh, ot]) => {
      const vv = Object.assign(new EventTarget(), { height: hh, width: innerWidth, offsetTop: ot, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
      window.dispatchEvent(new Event("resize"));
      vv.dispatchEvent(new Event("resize"));
    }, [h, offsetTop]);
    const clearVv = () => p.evaluate(() => { delete window.visualViewport; window.dispatchEvent(new Event("resize")); });
    const padRect = () => p.evaluate(() => { const b = document.querySelector(".nameScene__pad").getBoundingClientRect(); const cs = getComputedStyle(document.querySelector(".nameScene__pad")); return { top: b.top, bottom: b.bottom, h: b.height, tdur: cs.transitionDuration, tr: cs.transitionProperty, lift: document.querySelector(".nameScene__pad").style.getPropertyValue("--centerCardLift") }; });

    for (const [w, h] of [[390, 844], [1440, 900]]) {
      await check(`B3 Name/Got Piggy card ${w}x${h}: no lift without an obstruction; lift = covered + 16 for a simulated visualViewport shrink; returns on release`, async () => {
        await p.setViewportSize({ width: w, height: h }); await sleep(700);
        await clearVv(); await sleep(400);
        const rest = await padRect();
        assert.ok(["", "0px"].includes(rest.lift), `no pre-emptive lift (${rest.lift})`);
        const keyboard = Math.round(h * 0.45);
        await fakeVv(h - keyboard);
        await sleep(450);
        const lifted = await padRect();
        const covered = Math.max(0, rest.bottom - (h - keyboard));
        const want = covered > 0 ? covered + 16 : 0;
        assert.ok(Math.abs((rest.bottom - lifted.bottom) - want) <= 1, `lift ${rest.bottom - lifted.bottom} vs covered+16 ${want} (covered ${covered})`);
        if (want === 0) assert.ok(rest.bottom <= h - keyboard, "an uncovered card does not move (no 16px gap added)");
        await shot(`name_lift_${w}`);
        await clearVv(); await sleep(450);
        const back = await padRect();
        assert.ok(Math.abs(back.bottom - rest.bottom) <= 0.5, `returns to centre ${back.bottom} vs ${rest.bottom}`);
      });
    }
    await check("B3 a shrink that does not reach the card does not move it; an obstruction exactly at the edge covers nothing, 10 px covered lifts 26", async () => {
      await p.setViewportSize({ width: 1440, height: 900 }); await sleep(600);
      await clearVv(); await sleep(400);
      const rest = await padRect();
      await fakeVv(Math.ceil(rest.bottom) + 40); await sleep(400);
      assert.ok(Math.abs((await padRect()).bottom - rest.bottom) <= 0.5, "obstruction below the card: no move");
      await fakeVv(rest.bottom); await sleep(400);
      assert.ok(Math.abs((await padRect()).bottom - rest.bottom) <= 0.5, "obstruction exactly at the card edge covers nothing: no move");
      await fakeVv(rest.bottom - 10); await sleep(400);
      assert.ok(Math.abs((rest.bottom - (await padRect()).bottom) - 26) <= 1, "covered 10 + 16 gap");
      await clearVv(); await sleep(400);
    });
    await check("B3 reduced motion: the lift is instant (transition none); normal motion = 0.2s translate", async () => {
      await p.emulateMedia({ reducedMotion: "no-preference" }); await sleep(200);
      const normal = await padRect();
      assert.equal(normal.tdur, "0.2s"); assert.match(normal.tr, /translate/);
      await p.emulateMedia({ reducedMotion: "reduce" }); await sleep(200);
      const reduced = await padRect();
      assert.ok(reduced.tdur === "0s" || reduced.tr === "none", `reduced: ${reduced.tdur}/${reduced.tr}`);
      await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
      const r0 = await padRect();
      await fakeVv(844 - 380); await sleep(60);
      assert.ok(r0.bottom - (await padRect()).bottom > 10, "instant: already lifted 60 ms after the shrink");
      await clearVv(); await sleep(100);
      await p.emulateMedia({ reducedMotion: "no-preference" });
    });
    await check("B3 Couldn't-find / Checking surfaces (authCard paper + app-lock checking block) use the same helper", async () => {
      await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
      const res = await p.evaluate(async () => {
        const app = document.querySelector("#app");
        const holder = document.createElement("div");
        holder.id = "a849Probe";
        holder.innerHTML = `<div class="authCard" style="position:fixed;left:0;right:0;top:300px;z-index:99999"><div class="authCard__paper"></div></div><section class="stage--loginCheck" data-app-lock="checking" style="position:fixed;left:0;right:0;top:620px;height:200px;z-index:99998"><button class="loginCheck__face" type="button" style="display:block;height:40px">face</button><h1 class="loginCheck__title" style="margin:0;height:40px">c</h1><p class="loginCheck__body" style="margin:0;height:30px">d</p></section>`;
        app.appendChild(holder);
        await new Promise((r) => setTimeout(r, 100));
        const get = () => ({ paper: document.querySelector("#a849Probe .authCard__paper").getBoundingClientRect().bottom, face: document.querySelector("#a849Probe section > button").getBoundingClientRect().bottom, body: document.querySelector("#a849Probe section > p").getBoundingClientRect().bottom, v: document.querySelector("#a849Probe .authCard__paper").style.getPropertyValue("--centerCardLift") });
        const rest = get();
        const vv = Object.assign(new EventTarget(), { height: 520, width: 390, offsetTop: 0, scale: 1 });
        Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
        window.dispatchEvent(new Event("resize"));
        await new Promise((r) => setTimeout(r, 450));
        const lifted = get();
        delete window.visualViewport; window.dispatchEvent(new Event("resize"));
        await new Promise((r) => setTimeout(r, 450));
        const back = get();
        holder.remove();
        return { rest, lifted, back };
      });
      assert.ok(res.rest.paper <= 600 + 1 && res.rest.paper > 520, "probe card (bottom 600) is covered by a 520 px viewport");
      assert.ok(Math.abs((res.rest.paper - res.lifted.paper) - (res.rest.paper - 520 + 16)) <= 1, `authCard paper lift ${res.rest.paper - res.lifted.paper}`);
      const gBottom = res.rest.body; // checking group bottom = the <p>
      assert.ok(Math.abs((res.rest.body - res.lifted.body) - (gBottom - 520 + 16)) <= 1, `checking group lift ${res.rest.body - res.lifted.body}`);
      assert.ok(Math.abs(res.back.paper - res.rest.paper) <= 0.5 && Math.abs(res.back.body - res.rest.body) <= 0.5, "both return");
    });

    // ── finish birth; closed First; reload into Second ───────────────────────────────────────────────────
    await p.setViewportSize({ width: 1440, height: 900 }); await sleep(500);
    await p.locator("#piggyNameInput").fill("Waitbun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000); await sleep(4500);
    if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }
    await p.evaluate(() => {
      const a = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a849f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa849-dep", redeemTxHash: "0xa849-red", grantTxHash: "0xa849-grant", status: "success", at: Date.parse("2026-10-04T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    const freshExplore = async (w, h) => {
      await p.setViewportSize({ width: w, height: h });
      await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^araso\.secondJourney(\.|Draft|Picks)/.test(k)) localStorage.removeItem(k); });
      await forgetIntro(); // [A-891]
      await p.reload({ waitUntil: "networkidle" }); await sleep(600);
      await unlockIfLocked();
      assert.equal(await exploreViaTapMe(), "explore"); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 15000)
      for (let t0 = Date.now(); Date.now() - t0 < 6000 && (await step()) !== "interests";) await sleep(200);
      assert.equal(await step(), "interests");
      await sleep(2200);
    };
    const pickAndSave = async (wanted) => {
      for (let round = 0; round < 6; round += 1) {
        const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
        const hits = wanted.filter((id) => ids.includes(id));
        for (const id of hits) { await mustTap(".secondJourney__item", id, ids.indexOf(id)); await sleep(200); }
        await mustTap("#exploreSaveButton", "save"); await sleep(500);
        if (hits.length) return hits;
        assert.equal(await step(), "interests", "none rotates to the next round");
      }
      throw new Error(`none of ${wanted} offered`);
    };

    // ── UI-20: first card has no overflow cause, no visible scrollbar, still scrolls ──────────────────────
    for (const [w, h] of [[390, 844], [810, 1080], [1440, 810]]) {
      await check(`B1 Second first card ${w}x${h}: scrollHeight <= clientHeight, no scrollbar drawn; long content still scrolls`, async () => {
        await freshExplore(w, h);
        const m = await bodyMetrics();
        const culprits = await p.evaluate(() => { const b = document.querySelector(".secondJourney__body"); const bt = b.getBoundingClientRect().top; return [...b.querySelectorAll("*")].map((e) => [e.tagName + "." + (e.getAttribute("class") || "").slice(0, 40), Math.round((e.getBoundingClientRect().bottom - bt + b.scrollTop) * 10) / 10]).sort((a, c) => c[1] - a[1]).slice(0, 4); });
        assert.ok(m.sh <= m.ch, `scrollHeight ${m.sh} > clientHeight ${m.ch}; lowest: ${JSON.stringify(culprits)}`);
        assert.equal(m.ow, m.cw, "no scrollbar gutter");
        assert.equal(m.sbw, "none"); assert.equal(m.ov, "auto");
        await shot(`first_${w}`);
        const long = await p.evaluate(() => { const b = document.querySelector(".secondJourney__body"); const d = document.createElement("div"); d.id = "a849Long"; d.style.height = "900px"; b.appendChild(d); b.scrollTop = 80; const r = { sh: b.scrollHeight, ch: b.clientHeight, st: b.scrollTop, ow: b.offsetWidth, cw: b.clientWidth }; d.remove(); return r; });
        assert.ok(long.sh > long.ch && long.st > 0, "genuinely long content scrolls");
        assert.equal(long.ow, long.cw, "and still draws no scrollbar");
      });
    }

    // ── UI-24: 3 / 1 / 0 candidates keep one card ──────────────────────────────────────────────────────────
    for (const [w, h] of [[390, 844], [810, 1080], [1440, 810]]) {
      await check(`B2 candidates card ${w}x${h}: same size + footer with 3 / 1 / 0 candidates (+-0.5 px); picked line; wait. + two Chog lines only for 0; no checking… without a read; never nah.`, async () => {
        const out = {};
        // [A-977 RE-PIN] fork Explore = the fork Job rows (one per errand line; claim / asset-piece have none). pre-A-977:
        // [["three", ["grow", "asset-piece"], 3], ["one", ["clean"], 1], ["zero", ["market", "order", "claim"], 0]]
        for (const [name, want, rows] of [["three", ["market", "order", "clean"], 3], ["one", ["clean"], 1], ["zero", ["claim", "asset-piece"], 0]]) {
          await freshExplore(w, h);
          const hits = await pickAndSave(want);
          assert.equal(await step(), "candidates", `${name}: candidates step`);
          await sleep(900);
          const g = await candGeometry();
          assert.equal(g.rows, rows, `${name}: rows ${g.rows}`);
          assert.equal(/checking…/.test(g.text), false, `${name}: no checking… with no read in flight`);
          assert.equal(/nah\./.test(g.text) || /nah\./.test(g.chogRaw || ""), false, `${name}: never nah.`);
          assert.ok(g.bodySh <= g.bodyCh, `${name}: body does not overflow ${g.bodySh}>${g.bodyCh}`);
          // [A-1305 ⑤ RE-PIN] pre-A-1305: the picked line showed with every row count. Now only with 0 rows.
          if (rows === 0) assert.ok(g.picked && g.picked.split(" · ").length === hits.length && g.picked.split(" · ").every((x) => Object.values(LABELS).includes(x) || x.length > 2), `${name}: picked line ${g.picked}`);
          else assert.equal(g.picked, null, `${name}: rows up, no picked line above them (${g.picked})`);
          if (rows === 0) {
            assert.equal(g.heading, "wait."); assert.equal(g.state, "wait");
            assert.deepEqual(g.chog, ["oh… no jobs to go.", "wait for the next bell?"]);
            assert.equal(await p.evaluate(() => document.querySelector("#secondOkButton").disabled), true);
            assert.equal(await p.locator("#stayButton").count(), 1, "Home button stays");
          } else {
            assert.notEqual(g.heading, "wait."); assert.equal(g.chog.length, 0, "no wait lines with rows");
          }
          await shot(`cand_${name}_${w}`);
          out[name] = g;
        }
        const near = (a, b, label) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 0.5, `${label}[${i}] ${v} vs ${b[i]}`));
        for (const k of ["card", "footer", "home", "ok"]) { near(out.one[k], out.three[k], `one~three ${k}`); near(out.zero[k], out.three[k], `zero~three ${k}`); }
      });
    }
    await check("B4 no page error", () => assert.deepEqual(errors, []));
  } finally {
    await context.close().catch(() => {});
  }
}

if (process.env.A849_NODE_ONLY === "1") console.log("SKIP  Part B (A849_NODE_ONLY=1) — browser scenarios not run");
else await runBrowser();
console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
