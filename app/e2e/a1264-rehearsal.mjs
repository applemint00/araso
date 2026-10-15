// [A-1264 · A-1264b] Whole-flow rehearsal: new people in fresh browsers walk the real app by clicking —
// envelope → Face ID → hatch → name → Home → Send → Away → Return → File it → quiet Home → "tap me!" → Second.
// Local only: a172-local build served through Playwright routes, in-memory /api (grant · fork-entry · event),
// in-memory testnet (app/e2e/a1264-chain.mjs), CDP virtual passkey with PRF. Network 0 · real tx 0 · keys 0.
//   npm run rehearse                      full run (screenshots → $ARASO_REHEARSAL_OUT or OS temp)
//   ARASO_REHEARSAL_REPO=<checkout>       run the same rehearsal against another checkout (rollback proof)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "../test/helpers/private-base.mjs";
import { createChain } from "./a1264-chain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(process.env.ARASO_REHEARSAL_REPO || path.resolve(HERE, "../.."));
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const BASE = "http://localhost:5944";
const FORK_HOST = "fork-rpc.a1264.invalid";
const FORK_INSTANCE = "a1264-local";
const OUT = path.resolve(process.env.ARASO_REHEARSAL_OUT || path.join(tmpdir(), `araso-a1264-${process.pid}`));
const BUILD = process.env.ARASO_REHEARSAL_PREBUILT ? path.resolve(process.env.ARASO_REHEARSAL_PREBUILT) : path.join(OUT, "build");
const T0 = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const screenshots = [];

function record(label, ok, why = "") { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — ${why}`}`); }
async function check(label, fn) { try { await fn(); record(label, true); } catch (error) { record(label, false, String(error?.message || error).split("\n")[0]); } }
// Known app findings that have their own card: reported every run as KNOWN, counted as failures only with ARASO_REHEARSAL_STRICT=1.
const known = [];
async function knownCheck(label, fn) {
  if (process.env.ARASO_REHEARSAL_STRICT === "1") return check(label, fn);
  try { await fn(); console.log(`PASS ${label} (known row now passes — retire it)`); } catch (error) { known.push(label); console.log(`KNOWN ${label} — ${String(error?.message || error).split("\n")[0]}`); }
}

// Visible copy allowed on the walked screens. Dynamic parts (time, date, name, counts) are normalised first.
const COPY_ALLOW = new Set([
  "Araso", "your money,", "as a little Piggy", "checking...", "Face ID", "trial phase · free", "skip", "<DATE>", "<DAY>",
  "you've got", "the one piggy !", "ok", "name it?", "Piggy name", "save", "HOME", "<STATUS>", "<TIME>", "<N>", "<NAME>",
  "still in home", "no records yet", "wanna let Piggy try one?", "send?", "$5", "Piggy's first job?", "0.001 MON test",
  "You sign. Piggy takes your money to work.", "send", "stay home", "—", "<NAME> is coming home", "<SHORTDATE>", "went out",
  "came back", "kept", "> done", "File it", "Receipt", "I'll keep it here.", "<RECORDS>", "Checking…", "Face ID may appear once.",
  "tap me!", "Piggy is home.", "work's coming! let's send Piggy to work — your money does the job.", "work's coming! let's send Piggy to work —", "your money does the job.", "virtual money · fork",
  "places to explore?", "+ Piggy", "checking…", "go to the market", "leave an order", "tidy the wallet", "back to Home", "Home", "Send", "away", "<STATUS>", "Piggy could not get ready.", "nothing moved.", "nothing moved. · 0.001 MON test", "Piggy went out.", "Can go out once.", "I found a few things.", "wanna see a few more?",
]);
function normaliseLine(line, name) {
  return line
    .replace(/^\d{1,2}:\d{2} (AM|PM)$/, "<TIME>").replace(/^[A-Z]+ \d{1,2}$/, "<DATE>").replace(/^(MON|TUES|WEDNES|THURS|FRI|SATUR|SUN)DAY$/, "<DAY>")
    .replace(/^[A-Z][a-z]{2} \d{1,2}$/, "<SHORTDATE>").replace(/^> status\s+\d+ in\s+\d+ out$/, "<STATUS>").replace(/^records · \d+$/, "<RECORDS>")
    .replace(/^\d+$/, "<N>").replace(new RegExp(`^${name}( is coming home)?$`), (_, s) => (s ? "<NAME> is coming home" : "<NAME>"));
}

mkdirSync(OUT, { recursive: true });
const configuredHarness = privatePath("ops/harness/package.json");
const repoHarness = path.join(REPO, `_${"private"}`, "ops/harness/package.json");
const { chromium } = createRequire(existsSync(configuredHarness) ? configuredHarness : repoHarness)("playwright");

// ── one local world per chain: grant memory · fork-entry memory · event log · request log ────────────────
function createWorld(label) {
  const chain = createChain();
  const forkChain = createChain({ chainId: 31337143, erc20: { defaultAllowance: 5_000_000n, defaultBalance: 0n }, guard: { guard: "araso-a949-public-guard", chainId: 31337143, forkInstanceId: FORK_INSTANCE, forkStartBlock: 110874000 } });
  const granted = new Set();
  const requests = [];
  const events = [];
  const fork = { reenterOnce: false, statusCalls: 0, refuseChallenge: 0 };
  async function route(route, person) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "testnet-rpc.monad.xyz") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(await chain.handle(request.postData())) });
    }
    if (url.hostname === FORK_HOST) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(await forkChain.handle(request.postData())) });
    }
    if (url.hostname !== "localhost") return route.abort();
    if (url.pathname.startsWith("/api/")) {
      let body = null; try { body = JSON.parse(request.postData() || "null"); } catch {}
      const invite = request.headers()["x-araso-invite"] || null;
      requests.push({ person, path: url.pathname, action: body?.action || null, invite, bodyInvite: !!(body && Object.hasOwn(body, "invite") && body.invite) });
      const json = (status, out) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(out) });
      if (url.pathname === "/api/event") { events.push({ person, step: body?.step, code: body?.code, at: Date.now() - T0 }); return route.fulfill({ status: 204, body: "" }); }
      if (url.pathname === "/api/grant") {
        const address = String(body?.address || "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return json(400, { ok: false, error: "bad address" });
        if (granted.has(address)) return json(403, { ok: false, error: "already funded" });
        granted.add(address); chain.fund(address, 200_000_000_000_000_000n);
        return json(200, { ok: true, txHash: `0x${"a1".repeat(32)}` });
      }
      if (url.pathname === "/api/fork-entry") {
        const action = body?.action;
        if (action === "public_state") return json(200, { ok: true, publicEntry: true });
        if (action === "status") {
          fork.statusCalls += 1;
          if (fork.reenterOnce) { fork.reenterOnce = false; return json(200, { ok: true, allowed: false, reenter: true }); }
          return json(200, { ok: true, allowed: true, forkScope: "monad-fork", forkInstanceId: FORK_INSTANCE });
        }
        if (action === "challenge" && fork.refuseChallenge > 0) { fork.refuseChallenge -= 1; return json(503, { ok: false, reason: "entry_unavailable" }); }
        if (action === "challenge") {
          const piggy = String(body?.piggyAddress || "").toLowerCase(); const nonce = "a1264".padEnd(32, "0"); const expiresAt = Date.now() + 60_000;
          const message = ["Araso Journey 2 entry", `uri: ${BASE}`, "chainId: 31337143", `piggy: ${piggy}`, `tester: public:${piggy.slice(2, 10)}`, `fork: ${FORK_INSTANCE}`, `nonce: ${nonce}`, `expires: ${new Date(expiresAt).toISOString()}`].join("\n");
          return json(200, { ok: true, nonce, message, expiresAt });
        }
        if (action === "enter") return json(200, { ok: true, allowed: true, forkScope: "monad-fork", forkInstanceId: FORK_INSTANCE, grants: [] });
        return json(400, { ok: false, reason: "a1264_unexpected_action" });
      }
      return json(404, { ok: false });
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const file = path.resolve(BUILD, rel);
    if (!file.startsWith(`${BUILD}${path.sep}`)) return route.abort();
    const actual = existsSync(file) ? file : path.join(BUILD, "index.html");
    const contentType = ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" })[path.extname(actual)] || "application/octet-stream";
    return route.fulfill({ status: 200, contentType, body: readFileSync(actual) });
  }
  return { label, chain, forkChain, requests, events, fork, route };
}

// ── one person = one browser context with its own virtual passkey ─────────────────────────────────────
async function addPasskey(page, credential = null) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true,
  } });
  if (credential) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  return { cdp, authenticatorId, credential: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials[0] || null };
}

async function openPerson(browser, world, id, { storageState, invite, credential, viewport } = {}) {
  const phone = Number(process.env.ARASO_REHEARSAL_WIDTH) > 0 ? { width: Number(process.env.ARASO_REHEARSAL_WIDTH), height: 932 } : { width: 390, height: 844 };
  const context = await browser.newContext({ viewport: viewport || phone, ...(storageState ? { storageState } : {}) });
  const tag = { id };
  await context.route("**/*", (route) => world.route(route, tag.id));
  if (invite) await context.addInitScript((token) => { try { if (!localStorage.getItem("araso.forkInvite.v1")) localStorage.setItem("araso.forkInvite.v1", token); } catch {} }, invite);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 160)));
  if (process.env.ARASO_REHEARSAL_DEBUG === "1") page.on("console", (m) => { if (m.type() !== "log" || /A1265|fork|entry|switch|journey/i.test(m.text())) console.log(`CONSOLE ${id} ${m.type()} ${m.text().slice(0, 200)}`); });
  const passkey = await addPasskey(page, credential);
  const person = { id, tag, world, context, page, passkey, errors, name: `P${id}`, copy: new Map(), steps: 0 };
  await page.goto(BASE, { waitUntil: "networkidle" });
  return person;
}

async function look(person) {
  return person.page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
    return {
      scene: document.querySelector("[data-scene]")?.dataset.scene || null,
      text: [...document.querySelectorAll("body *")].filter((el) => !el.children.length && visible(el)).map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean),
    };
  });
}
async function live(person, selector) {
  return person.page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || el.disabled || el.hidden) return false;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, selector);
}
async function checkpoint(person, step) {
  const seen = await look(person);
  const file = path.join(OUT, `${person.id}-${String(++person.steps).padStart(2, "0")}-${step}-${seen.scene || "none"}.png`);
  await person.page.screenshot({ path: file }); screenshots.push(file);
  for (const line of seen.text) { const n = normaliseLine(line, person.name); if (!COPY_ALLOW.has(n)) person.copy.set(n, `${person.id}@${step}`); }
  return seen;
}
async function until(person, label, predicate, timeout = 20_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) { last = await look(person).catch(() => null); if (last && (await predicate(last))) return last; await sleep(250); }
  throw new Error(`${label}: timeout — scene=${last?.scene} text=${JSON.stringify((last?.text || []).slice(-6))}`);
}
async function click(person, selector, label) {
  await until(person, `${label} clickable`, () => live(person, selector), 20_000);
  await person.page.locator(selector).click();
}

// First Journey by hand. Returns when the filed receipt has settled back to Home.
async function walkFirstJourney(person) {
  await until(person, "envelope", (s) => s.scene === "received");
  await checkpoint(person, "envelope");
  await click(person, "#inviteFaceButton", "envelope Face ID");
  const born = await until(person, "hatch or name", (s) => ["hatch", "name"].includes(s.scene), 25_000);
  if (born.scene === "hatch") { await checkpoint(person, "hatch"); await click(person, "#skipHatchButton", "hatch skip"); }
  await until(person, "name", (s) => s.scene === "name");
  await click(person, ".nameCard__okBtn", "arrival ok");
  await click(person, "#piggyNameInput", "name input");
  await person.page.locator("#piggyNameInput").fill(person.name);
  await checkpoint(person, "name");
  await click(person, ".nameScene__save", "name save");
  await until(person, "Home Send card", () => live(person, "#sendButton"), 30_000);
  await checkpoint(person, "home-send");
  await person.page.locator("#sendButton").click();
  person.sentAt = Date.now();
}
async function walkReturnAndFile(person) {
  await until(person, "Return receipt", () => live(person, "#returnTap"), 60_000);
  await checkpoint(person, "return");
  for (let i = 0; i < 2; i += 1) { await click(person, "#returnTap", `receipt tap ${i + 1}`); await sleep(400); }
  await until(person, "filed → quiet Home", (s) => s.scene === "sendstay", 30_000);
  await checkpoint(person, "home-filed");
}
async function trace(person, label, ms) {
  if (process.env.ARASO_REHEARSAL_DEBUG !== "1") return;
  for (let t = 0; t < ms; t += 1000) {
    const s = await look(person).catch(() => null);
    const req = person.world.requests.filter((r) => r.person === person.id && r.path === "/api/fork-entry").map((r) => r.action).join(",");
    const j = await person.page.evaluate(() => localStorage.getItem("araso.journey.v1")).catch(() => "?");
    const fc = [...new Set(person.world.forkChain.calls)].join(",");
    const btn = await person.page.evaluate(() => [...document.querySelectorAll("button,[role=button]")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => `${b.id || String(b.className).split(" ")[0]}${b.disabled ? "(dis)" : ""}:${(b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 18)}`).join("|")).catch(() => "");
    console.log(`TRACE ${label} t=${t} scene=${s?.scene} btn=${btn} journey=${j} forkRpc=[${fc}] forkUnknown=[${[...new Set(person.world.forkChain.unknown)].join(",")}] fork=[${req}] text=${JSON.stringify((s?.text || []).slice(-5))} url=${person.page.url()}`);
    await sleep(1000);
  }
}
async function waitTapMe(person, timeout) {
  try { await until(person, "tap me!", (s) => s.text.includes("tap me!"), timeout); return true; } catch { return false; }
}
async function unlockIfLocked(person) {
  const s = await until(person, "boot surface", (x) => ["birth", "sendstay", "received", "name", "hatch"].includes(x.scene), 20_000);
  if (s.scene === "birth") { await checkpoint(person, "lock"); await click(person, "#loginChogButton", "lock Chog"); }
  await until(person, "Home after unlock", (x) => x.scene === "sendstay", 20_000);
}
async function enterSecond(person) {
  await until(person, "tap me! or Explore", (s) => s.scene === "explore" || s.text.includes("tap me!"), 40_000);
  if ((await look(person)).text.includes("tap me!")) { await checkpoint(person, "tapme"); await click(person, "#chogHomeHit", "tap me"); }
  await until(person, "Explore", (s) => s.scene === "explore", 30_000);
  await checkpoint(person, "explore");
}
async function walkSecondJob(person, round) {
  await until(person, "Explore", (s) => s.scene === "explore", 20_000);
  if (await person.page.locator('input[data-errand-id="clean"]').count()) {
    await person.page.locator('input[data-errand-id="clean"]').check();
    await click(person, "#exploreSaveButton", "explore save");
  }
  await click(person, ".secondJourney__pick", "job pick");
  await checkpoint(person, `j${round}-candidate`);
  await click(person, "#secondOkButton", "job ok");
  await until(person, "Job Send", () => live(person, "#secondSendButton"), 20_000);
  await checkpoint(person, `j${round}-job`);
  await person.page.locator("#secondSendButton").click();
  await until(person, "Away", (s) => s.scene === "secondAway", 15_000);
  await checkpoint(person, `j${round}-away`);
  await until(person, "Job Receipt", () => live(person, "#returnTap"), 90_000);
  await checkpoint(person, `j${round}-return`);
  for (let i = 0; i < 2; i += 1) { await click(person, "#returnTap", `job receipt tap ${i + 1}`); await sleep(400); }
  await click(person, "#returnOpen", "Second Receipt Home");
  await until(person, "filed → Home", (s) => s.scene === "sendstay", 30_000);
  await checkpoint(person, `j${round}-home`);
}
function publicInviteZero(world, who) {
  const bad = world.requests.filter((r) => who.includes(r.person) && (r.invite || r.bodyInvite || ["invite_state", "bind", "invite_challenge"].includes(r.action)));
  assert.deepEqual(bad.map((r) => `${r.path}:${r.action}:${r.invite ? "header" : "body"}`), [], "public ON must send no invite");
}
function copyClean(person) {
  const extra = [...person.copy].map(([line, at]) => `${at}: ${line}`);
  assert.equal(extra.length, 0, `visible copy outside allowlist: ${JSON.stringify(extra.slice(0, 10))}`);
}
function eventsOf(world, id) { return world.events.filter((e) => e.person === id).map((e) => `${e.step}/${e.code}`); }

// ── build ────────────────────────────────────────────────────────────────────────────────────────────
const built = process.env.ARASO_REHEARSAL_PREBUILT ? { status: 0 } : spawnSync(path.join(REPO, "node_modules/.bin/vite"), ["build", "app", "--mode", "a172-local", "--outDir", BUILD, "--emptyOutDir"], {
  cwd: REPO, encoding: "utf8",
  env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_ARASO_RELEASE_LEVEL: "2", VITE_ARASO_TEST_REPEAT_BELL: "1", VITE_ARASO_FORK_RPC_URL: `https://${FORK_HOST}/`, VITE_ARASO_FORK_INSTANCE_ID: FORK_INSTANCE },
});
if (built.status !== 0) { console.log(`FAIL a172-local build — ${(built.stderr || built.stdout || "").slice(-600)}`); process.exit(1); }
record("a172-local build", true);

const browser = await chromium.launch({ headless: true });
const main = createWorld("main");     // a → c (reopen) → d (fresh device, same passkey)
const side = createWorld("side");     // b (stored used invite)
const fault1 = createWorld("fault1"); // first deposit refused once
const fault4 = createWorld("fault4"); // deposit refused four times, nonce unchanged
const faultEst = createWorld("faultEst"); // second gas estimate refused (grant seen by one node, not the next)
const desk = createWorld("desk");     // e (desktop width, public, no invite)
const people = [];

async function laneMain() {
  const a = await openPerson(browser, main, "a"); people.push(a);
  await check("a · public ON, no invite: envelope → Face ID → hatch → name → Home → Send pressed", () => walkFirstJourney(a));
  await check("a · Away → Return → Receipt → File it → quiet Home (real deposit + redeem on the stand-in chain)", async () => {
    await walkReturnAndFile(a);
    await trace(a, "after-file", 20_000);
    assert.match(a.world.chain.log.join(";"), /deposit nonce=0;sendRaw redeem nonce=1/);
  });
  await check("a · events: os · entry_shown/public · passkey_create/ok · home_reached/ok · send_tap/ok · grant/ok · send/ok", () => {
    const ev = eventsOf(main, "a");
    for (const want of ["entry_shown/public", "passkey_create/ok", "home_reached/ok", "send_tap/ok", "grant/ok", "send/ok"]) assert.ok(ev.includes(want), `${want} missing in ${ev.join(",")}`);
  });
  await knownCheck("a · public ON boot never reports entry_blocked/invite_only (A-1245 flicker)", () => {
    assert.ok(!eventsOf(main, "a").includes("entry_blocked/invite_only"), `events: ${eventsOf(main, "a").join(",")}`);
  });
  await check("a · 1st done → Journey 2 entry (live signer enters directly; otherwise \"tap me!\") → switch → intro → Explore", async () => {
    await until(a, "tap me! or Explore", (s) => s.scene === "explore" || s.text.includes("tap me!"), 40_000);
    if ((await look(a)).text.includes("tap me!")) { await checkpoint(a, "tapme"); await click(a, "#chogHomeHit", "tap me"); }
    await until(a, "Explore", (s) => s.scene === "explore", 30_000);
    await sleep(1500);
    await checkpoint(a, "explore");
    assert.ok(main.requests.some((r) => r.person === "a" && r.action === "enter"), "fork entry recorded");
  });
  await check("a · Journey 2 round 1: places → Job (tidy the wallet) → Send → Away → back → Receipt → File it → Home", () => walkSecondJob(a, 1));
  await check("a · reopen the app → lock → Chog → Face ID → Home → bell → Explore opens again", async () => {
    await a.page.goto("about:blank"); await a.page.goto(BASE, { waitUntil: "networkidle" });
    await unlockIfLocked(a);
    await until(a, "bell", async () => a.page.evaluate(() => !!document.querySelector("#secondHomeBell")), 60_000);
    await checkpoint(a, "bell");
    await until(a, "Explore again", (s) => s.scene === "explore", 20_000);
  });
  main.fork.reenterOnce = true; // E14: the next fork status answers reenter:true
  const entersBefore = main.requests.filter((r) => r.person === "a" && r.action === "enter").length;
  await check("a · Journey 2 round 2 (again) by hand, with fork status reenter:true injected", () => walkSecondJob(a, 2));
  await check("a · E14: reenter:true led back through entry (challenge → enter) and the Job still ran", () => {
    assert.equal(main.fork.reenterOnce, false, "reenter answer was consumed");
    assert.ok(main.requests.filter((r) => r.person === "a" && r.action === "enter").length > entersBefore, "no re-entry after reenter:true");
    assert.equal((main.forkChain.log.join(";").match(/sendRaw approve/g) || []).length, 2, `fork txs: ${main.forkChain.log.join(";")}`);
  });
  // c = the same person reopening: same passkey, same storage, page opened again → lock → Chog → Face ID → Home.
  const c = a; c.id = c.tag.id = "c"; c.steps = 0;
  await check("c · same passkey + same storage, reopened: lock → Chog → Face ID → Home (no hatch/name)", async () => {
    await c.page.goto("about:blank"); await c.page.goto(BASE, { waitUntil: "networkidle" });
    await until(c, "lock surface", (s) => s.scene === "birth", 20_000);
    await checkpoint(c, "lock");
    await click(c, "#loginChogButton", "lock Chog");
    await until(c, "Home", (s) => s.scene === "sendstay", 20_000);
    await checkpoint(c, "home");
    assert.ok(eventsOf(main, "c").includes("passkey_get/ok"), eventsOf(main, "c").join(","));
  });
  await check("c · reopened Home → bell → Journey 2 once more by hand", async () => {
    await until(c, "bell", async () => c.page.evaluate(() => !!document.querySelector("#secondHomeBell")), 60_000);
    await walkSecondJob(c, 3);
  });
  // d = a fresh device holding the same synced passkey: storage emptied, authenticator kept.
  const d = a; d.id = d.tag.id = "d"; d.steps = 0;
  await d.page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    for (const db of (await indexedDB.databases?.()) || []) if (db.name) indexedDB.deleteDatabase(db.name);
  });
  await d.context.clearCookies();
  await knownCheck("d · fresh device, same passkey, empty storage: envelope Face ID → recovered Home with no hatch/name", async () => {
    await d.page.goto("about:blank"); await d.page.goto(BASE, { waitUntil: "networkidle" });
    await until(d, "envelope", (s) => s.scene === "received");
    await checkpoint(d, "envelope");
    await click(d, "#inviteFaceButton", "envelope Face ID");
    const seen = new Set();
    await until(d, "recovered Home", async (s) => { seen.add(s.scene); return s.scene === "sendstay"; }, 30_000);
    await checkpoint(d, "home");
    assert.ok(!seen.has("hatch") && !seen.has("name"), `went through ${[...seen].join(",")}`);
  });
  await knownCheck("d · E7: recovered device gets a second-journey signal (tap me! or fork entry) within 20 s", async () => {
    const forkCalls = () => main.requests.filter((r) => r.person === "d" && r.path === "/api/fork-entry" && r.action !== "public_state").length;
    const tapMe = await waitTapMe(d, 20_000);
    assert.ok(tapMe || forkCalls() > 0, `tap me! ${tapMe} · fork-entry calls ${forkCalls()}`);
  });
  await a.context.close();
}

async function laneSide() {
  const b = await openPerson(browser, side, "b", { invite: "used-invite-a1264-0001" }); people.push(b);
  await check("b · public ON + stored used invite: first journey by hand to the filed Home", async () => { await walkFirstJourney(b); await walkReturnAndFile(b); });
  await check("b · 1st done → Journey 2 entry → Explore → Job round 1", async () => { await enterSecond(b); await walkSecondJob(b, 1); });
  await check("b · reopen → lock → Face ID → bell → Journey 2 again", async () => {
    await b.page.goto("about:blank"); await b.page.goto(BASE, { waitUntil: "networkidle" });
    await unlockIfLocked(b);
    await until(b, "bell", async () => b.page.evaluate(() => !!document.querySelector("#secondHomeBell")), 60_000);
    await walkSecondJob(b, 2);
  });
  await check("b · stored invite never reaches the server (header · body · invite actions)", () => publicInviteZero(side, ["b"]));
  await b.context.close();
}

// e = Cowork clue 3: a public, invite-less person on a desktop width (no lock surface) reopening after First.
async function laneDesktop() {
  const e = await openPerson(browser, desk, "e", { viewport: { width: 1280, height: 800 } }); people.push(e);
  desk.fork.refuseChallenge = 1; // the in-session auto entry after File it fails once, so the reopen below is the first Journey 2 chance
  await check("e · desktop 1280: first journey by hand to the filed Home", async () => { await walkFirstJourney(e); await walkReturnAndFile(e); });
  await check("e · desktop reload after First (public_state race): Journey 2 still opens", async () => {
    await until(e, "entry attempt refused", () => desk.fork.refuseChallenge === 0, 30_000);
    await e.page.goto("about:blank"); await e.page.goto(BASE, { waitUntil: "networkidle" });
    await unlockIfLocked(e);
    await enterSecond(e);
  });
  await e.context.close();
}

async function laneFaults() {
  const f = await openPerson(browser, fault1, "f1"); people.push(f);
  await check("fault · first deposit -32000 once → retried → Return", async () => {
    await walkFirstJourney(f);
  });
  // the refusal must be armed before the Send tap reaches broadcast; arm right after the click (sign + grant come first)
  fault1.chain.faults.sendErrors.push(1);
  await check("fault · -32000 once: same signed deposit re-sent and the trip finishes", async () => {
    await walkReturnAndFile(f);
    assert.match(fault1.chain.log.join(";"), /refused -32000;sendRaw deposit nonce=0/);
  });
  await f.context.close();

  const g = await openPerson(browser, fault4, "f4"); people.push(g);
  await check("fault · four refusals: walk to Send", () => walkFirstJourney(g));
  fault4.chain.faults.sendErrors.push(1, 1, 1, 1);
  await check("fault · four refusals + nonce unchanged → never-sent deposit released: \"nothing moved.\", Send pressable again", async () => {
    await until(g, "nothing moved.", (s) => s.text.some((t) => t.startsWith("nothing moved.")), 40_000);
    assert.equal(await g.page.evaluate(() => Object.keys(localStorage).filter((k) => /sendPending/i.test(k) && localStorage.getItem(k)).length), 0, "send pending record cleared");
    await until(g, "Send pressable", () => live(g, "#sendButton"), 20_000);
    await checkpoint(g, "home-after-refusals");
    assert.doesNotMatch(fault4.chain.log.join(";"), /sendRaw deposit/, "no deposit landed; nonce stays 0");
    assert.ok(eventsOf(fault4, "f4").includes("send_why/broadcast"), `events: ${eventsOf(fault4, "f4").join(",")}`);
  });
  await g.context.close();

  // A node that saw the grant answers the first gas estimate; the next one (prepare, after Away) says "insufficient funds".
  const h = await openPerson(browser, faultEst, "f5"); people.push(h);
  await check("fault · second gas estimate refused: walk to Send", () => walkFirstJourney(h));
  faultEst.chain.faults.estimateOkLeft = 1;
  await check("fault · estimate refused after Away → \"Piggy could not get ready. · nothing moved.\" · send_why/insufficient (not broadcast)", async () => {
    await until(h, "nothing moved.", (s) => s.text.some((t) => t.startsWith("nothing moved.")), 40_000);
    assert.doesNotMatch(faultEst.chain.log.join(";"), /sendRaw/, "nothing broadcast");
    const ev = eventsOf(faultEst, "f5");
    assert.ok(ev.includes("send/fail") && ev.includes("send_why/insufficient"), `events: ${ev.join(",")}`);
  });
  await h.context.close();
}

try {
  const only = (process.env.ARASO_REHEARSAL_ONLY || "main,side,faults,desk").split(",");
  await Promise.all([only.includes("main") && laneMain(), only.includes("side") && laneSide(), only.includes("faults") && laneFaults(), only.includes("desk") && laneDesktop()].filter(Boolean));
  await check("public ON: no invite on any request (all people)", () => { for (const w of [main, side, fault1, fault4, faultEst, desk]) publicInviteZero(w, people.map((p) => p.id)); });
  await check("visible copy stays inside the allowlist", () => { for (const p of people) copyClean(p); });
  await check("no uncaught page errors", () => { const all = people.flatMap((p) => p.errors.map((e) => `${p.id}: ${e}`)); assert.equal(all.length, 0, JSON.stringify(all.slice(0, 6))); });
  await check("fault · fork status reenter:true is wired back through entry (source pin, main.js)", () => {
    assert.match(MAIN, /if \(r\.reenter === true\) return \(await a956Enter\(\{ reenter: true \}\)\) === true;/);
  });
  await check("stand-in chain saw no unhandled RPC method", () => {
    const u = [...new Set([main, side, fault1, fault4, faultEst, desk].flatMap((w) => w.chain.unknown))].filter((m) => m !== "eth_fillTransaction");
    assert.deepEqual(u, []);
  });
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`A1264 ${results.length - failed.length} PASS / ${failed.length} FAIL / ${known.length} KNOWN · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`A1264_EVENTS ${JSON.stringify(Object.fromEntries([main, side, fault1, fault4, faultEst, desk].flatMap((w) => [...new Set(w.events.map((e) => e.person))].map((id) => [id, eventsOf(w, id)]))))}`);
console.log(`A1264_SCREENSHOTS=${screenshots.length}`);
console.log(`A1264_SCREENSHOT_DIR=${OUT}`);
process.exit(failed.length ? 1 : 0);
