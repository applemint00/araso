// [A-851] Second: Home re-check + in-app bell when a candidate appears.
//   node app/test/a851-home-bell.mjs        (A851_NODE_ONLY=1 skips the browser part; printed as SKIP, not a PASS)
// Part N (node): the pure go-able rule (fail-closed) and source guards on the new main.js functions.
// Part B (real browser, LOCAL_DEV_ENTRY): Explore -> candidates -> Home (waiting) -> the test hook stands in for the product reader
//   (0 candidates, then 1) -> bell appears only after the candidate appears, once; tap -> candidates card shows it;
//   without the hook nothing rings and nothing errors.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_MODE_ENV, FORK_MODE_INIT, RUN_SCOPE, forkFirstDone, forkKey, forkRpcStub } from "./helpers/fork-mode.mjs"; // [A-950] fork-profile mode (STALE_TESTS class (a)): the Second UI opens only on the fork profile since A-948

import { decideCurrentCandidates } from "../src/mainnet-job-lane.js";
import { newlyGoableCandidateIds } from "../src/second-journey-state.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const STYLE = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ═══ Part N ═══════════════════════════════════════════════════════════════════════════════════════════════════
const NOW = "2026-10-03T00:00:00Z";
const BLOCK = 200000000;
const EVENT = "a851-event";
const SCOPE = { accountId: "acct-a851", chainId: "monad-testnet" };
const aaveRow = (status = "aave_buildable", read = {}) => ({ id: "aave-usdc", status, reason: "x", read: status === "read_failed" ? null : {
  source: `read-only rpc @${BLOCK}`, observedAt: NOW, chainId: 143, block: BLOCK, codePresent: true, receiptToken: { matchesRecorded: true },
  reserve: { active: true, frozen: false, paused: false }, holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" }, ...read } });
const rule = { kind: "agreed_rule", agreedBy: "user", eventId: EVENT, candidateId: "aave-usdc", field: "piggyUsdcRaw", comparator: "gte", expected: "1000000" };
const decide = (row, agreedRules) => decideCurrentCandidates({ currentRead: { candidates: [row] }, agreedRules, scope: SCOPE, eventId: EVENT, nowMs: Date.parse(NOW), nowIso: NOW });

const rowOf = (id, status = "kintsu_observation") => ({ id, status, reason: "x", read: { source: "r", observedAt: NOW, chainId: 143, block: BLOCK, codePresent: true } });
await check("N1 go-able = readable row + match; strict fail-closed: any unreadable picked-lane row = no candidate at all", () => {
  const ok = aaveRow();
  const read = { candidates: [ok] };
  const dec = decide(ok, { "aave-usdc": rule });
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: dec, visibleIds: ["aave-usdc"] }), ["aave-usdc"]);
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: decide(ok, {}), visibleIds: ["aave-usdc"] }), [], "no agreed rule = unknown");
  const nah = decide(ok, { "aave-usdc": { ...rule, expected: "999999999" } });
  assert.equal(nah[0].decision, "nah");
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: nah, visibleIds: ["aave-usdc"] }), []);
  const bad = aaveRow("read_failed");
  assert.deepEqual(newlyGoableCandidateIds({ read: { candidates: [bad] }, decisions: decide(bad, { "aave-usdc": rule }), visibleIds: ["aave-usdc"] }), []);
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: dec, visibleIds: [] }), [], "outside the picked lanes");
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: dec, visibleIds: ["aave-usdc"], rungIds: new Set(["aave-usdc"]) }), [], "once per id");
  assert.deepEqual(newlyGoableCandidateIds({}), []);
  assert.deepEqual(newlyGoableCandidateIds({ read: null, decisions: [{ candidateId: "aave-usdc", decision: "match", action: "ask", executionPermission: false }], visibleIds: ["aave-usdc"] }), [], "a decision without its readable row");
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: [{ candidateId: "aave-usdc", decision: "match", action: "ask", executionPermission: true }], visibleIds: ["aave-usdc"] }), [], "a permission-bearing decision is refused");
  // strict: a readable go-able row beside an unreadable / missing picked-lane row rings nothing
  const two = { candidates: [ok, rowOf("kintsu-smon", "read_failed")] };
  assert.deepEqual(newlyGoableCandidateIds({ read: two, decisions: dec, visibleIds: ["aave-usdc", "kintsu-smon"] }), []);
  assert.deepEqual(newlyGoableCandidateIds({ read, decisions: dec, visibleIds: ["aave-usdc", "kintsu-smon"] }), [], "missing row = unreadable");
  const allOk = { candidates: [ok, rowOf("kintsu-smon")] };
  assert.deepEqual(newlyGoableCandidateIds({ read: allOk, decisions: dec, visibleIds: ["aave-usdc", "kintsu-smon"] }), ["aave-usdc"]);
});

await check("N2 source: no timer / poll / OS notification / service worker / network in the new Home wait code; test hook is LOCAL_DEV_ENTRY-gated", () => {
  const names = ["markSecondWaitingForPlace", "secondHomeGoableIds", "secondHomeRecheckAllowed", "secondHomeRecheckRead", "recheckSecondCandidatesOnHome", "mountSecondHomeBell", "armSecondHomeWait"];
  const code = names.map((n) => stripComments(fnBody(n))).join("\n");
  assert.equal(/setInterval|setTimeout|sceneTimeout|requestAnimationFrame|Notification|serviceWorker|ServiceWorker|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|requestPrf|sendTransaction|signDigest|requestGrant|executeMoneyStep/.test(code), false);
  assert.equal(/openSecondJourneyExplore/.test(stripComments(fnBody("armSecondHomeWait")) + stripComments(fnBody("recheckSecondCandidatesOnHome"))), false, "re-check never opens Second by itself");
  assert.match(stripComments(fnBody("secondHomeRecheckRead")), /if \(LOCAL_DEV_ENTRY\) \{[\s\S]*LOCAL_TEST_SECOND_LANE_READ_HOOK/);
  assert.equal(/@DEV_ONLY/.test(code), false);
  assert.match(stripComments(fnBody("armSecondHomeWait")), /visibilitychange/);
  assert.match(stripComments(fnBody("armSecondHomeWait")), /if \(secondVisibilityArmed\) return;[\s\S]*sceneListener\(document, "visibilitychange"/, "visibility listener registered once per scene");
  assert.match(stripComments(fnBody("markSecondWaitingForPlace")), /secondBellRung\.add\(id\)/, "go-able at click time counts as already rung");
  // bell: aria-label "bell", the existing asset, no visible text
  const bell = stripComments(fnBody("mountSecondHomeBell"));
  assert.match(bell, /setAttribute\("aria-label", "bell"\)/);
  assert.match(bell, /\/card\/crayon-bell\.svg/);
  assert.equal(/textContent|innerText/.test(bell), false);
  assert.match(stripComments(fnBody("recheckSecondCandidatesOnHome")), /secondBellRung\.add\(/);
  assert.match(stripComments(fnBody("mountSecondHomeBell")), /openSecondJourneyExplore\(\)/);
  assert.match(STYLE, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.secondHomeBell \{ animation: secondHomeBellRing/);
  assert.equal(/animation:/.test(STYLE.match(/\n\.secondHomeBell \{[^}]*\}/)[0]), false, "base rule has no animation: reduced motion = still bell");
});

// ═══ Part B ═══════════════════════════════════════════════════════════════════════════════════════════════════
if (process.env.A851_NODE_ONLY === "1") console.log("SKIP  Part B (A851_NODE_ONLY=1) — browser scenarios not run");
else await runBrowser();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function runBrowser() {
  if (!existsSync(privatePath())) { console.log("SKIP  Part B — local browser harness absent"); return; }
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
    browser = await chromium.launch({ headless: true });
    await browserRun(browser, `http://localhost:${port}/`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.kill("SIGTERM"); } catch {}
    await sleep(300);
    try { server.kill("SIGKILL"); } catch {}
  }
}

async function browserRun(browser, BASE) {
  const net = { tx: 0, push: 0 };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(FORK_MODE_INIT); // [A-950] araso.journey.v1 = "2" before the app loads (fork boot)
  await context.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) { net.tx += 1; return route.abort(); }
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && req.method() === "POST" && /grant/i.test(u.pathname)) { net.tx += 1; return route.abort(); }
    return route.continue();
  });
  await forkRpcStub(context); // [A-950] the dummy fork RPC host is answered locally (after the suite's own routes: the later route wins) — no real network
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });

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
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 8; i += 1) { const r = await pointAt(sel, idx); if (r) { await p.mouse.click(r.x, r.y); return; } await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
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
  const bells = () => p.evaluate(() => [...document.querySelectorAll("#secondHomeBell")].map((b) => ({ label: b.getAttribute("aria-label"), text: b.textContent.trim(), img: b.querySelector("img")?.getAttribute("src") })));
  const becomeVisible = async () => { await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await sleep(500); };
  const NOW_ISO = new Date().toISOString();
  const installHook = (mode) => p.evaluate(([m, nowIso]) => {
    window.__a851Calls = 0;
    const rd = (id, status) => ({ id, status, reason: "x", read: { source: "read-only rpc @200000000", observedAt: nowIso, chainId: 143, block: 200000000, codePresent: true } });
    window.__ARASO_LOCAL_TEST_SECOND_LANE_READ__ = async (eventId) => {
      window.__a851Calls += 1;
      const failed = (id) => ({ id, status: "read_failed", reason: "rpc_unreachable", read: null });
      if (m === "unreadable") return { currentRead: { kind: "second_current_read", piggyAddress: null, candidates: [failed("euler-k3-weth")] }, agreedRules: {} };
      const forkJob = { id: "euler-k3-weth", status: "aave_buildable", reason: "read_via_lane_pre_action", read: { // [A-950-b] A-977 Grow row; pre-A-977: aave-usdc
        source: "read-only rpc @200000000", observedAt: nowIso, chainId: 143, block: 200000000, codePresent: true, receiptToken: { matchesRecorded: true },
        reserve: { active: true, frozen: false, paused: false }, holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" } } };
      const others = m === "mixed" ? [failed("kintsu-smon")] : [];
      return {
        currentRead: { kind: "second_current_read", piggyAddress: null, candidates: [forkJob, ...others] },
        agreedRules: { "euler-k3-weth": { kind: "agreed_rule", agreedBy: "user", eventId, candidateId: "euler-k3-weth", field: "piggyUsdcRaw", comparator: "gte", expected: "1000000" } },
      };
    };
  }, [mode, NOW_ISO]);
  const calls = () => p.evaluate(() => window.__a851Calls ?? 0);

  // birth + named Piggy + closed First (same harness as A-719 Part B)
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
  await p.locator("#piggyNameInput").fill("Bellbun"); await sleep(150);
  await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
  await waitScene(["sendstay"], 10000); await sleep(4500);
  if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }
  await p.evaluate(() => {
    const a = localStorage.getItem("araso.address");
    const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a851f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa851-dep", redeemTxHash: "0xa851-red", grantTxHash: "0xa851-grant", status: "success", at: Date.parse("2026-10-04T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
    localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
  });
  await p.reload({ waitUntil: "networkidle" }); await sleep(600);
  await unlockIfLocked();
  assert.equal(await exploreViaTapMe(), "explore"); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 12000)
  await mustTap("#exploreSaveButton", "save none"); await sleep(900);
  const ids = await p.evaluate(() => [...document.querySelectorAll("#exploreForm input[data-errand-id]")].map((e) => e.dataset.errandId));
  for (const want of ["grow", "asset-piece"]) { const idx = ids.indexOf(want); assert.ok(idx >= 0, `${want} on round 1 (${ids})`); await mustTap(".secondJourney__item", want, idx); await sleep(200); }
  await mustTap("#exploreSaveButton", "save"); await sleep(2600);
  assert.equal(await step(), "candidates");

  await check("B1 no hook = product reader unconfigured: Home from the candidates card waits, but no bell rings and nothing errors (fail-closed)", async () => {
    await mustTap("#stayButton", "Home");
    assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
    await sleep(1500); await becomeVisible(); await becomeVisible();
    assert.deepEqual(await bells(), []);
    assert.deepEqual(errors, []);
  });

  await check("B2 reader returns 0 candidates (unreadable row): re-check runs on app-visible, bell does not ring", async () => {
    await installHook("unreadable");
    await becomeVisible();
    assert.equal(await calls(), 1);
    assert.deepEqual(await bells(), []);
  });

  await check("B3 no timer / poll: with the hook installed and Home idle, the reader is not called again by itself", async () => {
    await sleep(6000);
    assert.equal(await calls(), 1);
  });

  await check("B3b strict fail-closed: the A-977 Grow candidate is readable but another picked-lane row is unreadable -> no bell at all", async () => {
    await installHook("mixed");
    await becomeVisible();
    assert.equal(await calls(), 1);
    assert.deepEqual(await bells(), []);
  });

  await check("B4 a candidate appears (readable + go-able): bell rings on Home once; aria-label bell, no visible text, existing asset", async () => {
    await installHook("one");
    await becomeVisible();
    assert.equal(await calls(), 1);
    const b = await bells();
    assert.equal(b.length, 1);
    assert.deepEqual(b[0], { label: "bell", text: "", img: "/card/crayon-bell.svg" });
    await becomeVisible(); await becomeVisible();
    assert.equal((await bells()).length, 1, "still one bell");
    assert.equal(await scene(), "sendstay", "never auto-opens");
    assert.deepEqual(errors, []);
  });

  await check("B5 tap the bell: Second candidates card reopens showing the candidate; nothing picked or sent", async () => {
    await mustTap("#secondHomeBell", "bell");
    assert.equal(await waitScene(["explore"], 4000), "explore");
    await sleep(2500);
    assert.equal(await step(), "candidates");
    const rows = await p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].map((b) => ({ id: b.dataset.destinationId, picked: b.classList.contains("is-picked") })));
    assert.ok(rows.some((r) => r.id === "euler-k3-weth") && rows.every((r) => !r.picked)); // [A-950-b] A-977 Grow row; pre-A-977: aave-usdc
    assert.equal(await p.evaluate(() => document.querySelector("#secondOkButton").disabled), true);
    assert.equal(net.tx, 0);
  });

  await check("B6 rung once per candidate id: back to Home and re-check, same candidate does not ring again", async () => {
    await mustTap("#stayButton", "Home");
    assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
    await sleep(800); await becomeVisible();
    assert.deepEqual(await bells(), []);
    assert.deepEqual(errors, []);
    assert.equal(net.tx, 0);
  });

  await check("B7 a candidate that is already go-able at the Home click does not ring (it did not appear later)", async () => {
    await forgetIntro(); // [A-891]
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
    assert.equal(await exploreViaTapMe(), "explore"); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 15000)
    for (let t0 = Date.now(); Date.now() - t0 < 6000 && (await step()) !== "interests";) await sleep(200);
    assert.equal(await step(), "interests");
    await mustTap("#exploreSaveButton", "save again"); await sleep(2600);
    assert.equal(await step(), "candidates");
    await installHook("one"); // go-able BEFORE the Home click
    await mustTap("#stayButton", "Home");
    assert.equal(await waitScene(["sendstay"], 4000), "sendstay");
    await sleep(1500); await becomeVisible(); await becomeVisible();
    assert.ok((await calls()) >= 2, "baseline read at the click + Home re-checks ran");
    assert.deepEqual(await bells(), []);
    assert.deepEqual(errors, []);
  });
}
