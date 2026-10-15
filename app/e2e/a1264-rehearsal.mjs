// [A-1264 · A-1264b] Whole-flow rehearsal: new people in fresh browsers walk the real app by clicking —
// envelope → Face ID → hatch → name → Home → Send → Away → Return → File it → quiet Home → "tap me!" → Second.
// Local only: a172-local build served through Playwright routes, in-memory /api (grant · fork-entry · event),
// in-memory testnet (app/e2e/a1264-chain.mjs), CDP virtual passkey with PRF. Network 0 · real tx 0 · keys 0.
//   npm run rehearse                      full run (screenshots → $ARASO_REHEARSAL_OUT or OS temp)
//   ARASO_REHEARSAL_REPO=<checkout>       run the same rehearsal against another checkout (rollback proof)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const allWorlds = [];

function record(label, ok, why = "") { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — ${why}`}`); }
const chogMs = (text) => Math.round(String(text).length * 60 + 1200); // main.js chogSpeakMs
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
  "tap me!", "Piggy is home.", "work's coming! let's send Piggy to work — your money does the job.", "work's coming! let's send Piggy to work —", "your money does the job.", "work's coming!", "let's send Piggy to work —", "let's send Piggy to work", "these two?", "all of them?", "go to the market · leave an order", "go to the market · leave an order · tidy the wallet", "both can go. sending one for now.", "all of them work. let's try one first.", "only this one can go today.", "none of these can go now. something else?", "wait.", "pick up what is owed · pick up a piece of an asset", "pick up what is owed · put some money to work", "a quick trip", "try again", "tidy the wallet", "Couldn't open Piggy", "Face ID was cancelled.", "Make new", "wallet?", "Piggy!!!!!!", "my first piggy", "virtual money · fork",
  "places to explore?", "+ Piggy", "checking…", "go to the market", "leave an order", "tidy the wallet", "back to Home", "Home", "Send", "away", "<STATUS>", "Piggy could not get ready.", "nothing moved.", "nothing moved. · 0.001 MON test", "can't tell yet. · 0.001 MON test", "still out. · 0.001 MON test", "can't tell yet.", "still out.", "couldn't finish this one.", "Piggy went out.", "Can go out once.", "I found a few things.", "wanna see a few more?", "the jar's sparkling. wanna tap it?", "when there's a new job for piggy, the bell will ring.",
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
// Gas scenario (ARASO_REHEARSAL_GAS = low | now | high): 10 gwei · testnet eth_gasPrice read once at start (102 gwei if unreadable) · 1000 gwei.
const GAS = process.env.ARASO_REHEARSAL_GAS || "now";
async function scenarioGasPrice() {
  if (GAS === "low") return 10n * 10n ** 9n;
  if (GAS === "high") return 1000n * 10n ** 9n;
  try {
    const r = await fetch("https://testnet-rpc.monad.xyz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }), signal: AbortSignal.timeout(3000) });
    return BigInt((await r.json()).result);
  } catch { return 102n * 10n ** 9n; }
}
const GAS_PRICE_WEI = await scenarioGasPrice();
console.log(`A1264_GAS ${GAS} ${Number(GAS_PRICE_WEI / 10n ** 6n) / 1000} gwei`);

function createWorld(label, { fundLagMs = 0, grantMode = "ok", grantHangMs = 0 } = {}) {
  const chain = createChain({ gasPriceWei: GAS_PRICE_WEI, fundLagMs });
  const forkChain = createChain({ chainId: 31337143, gasPriceWei: GAS_PRICE_WEI, erc20: { defaultAllowance: 5_000_000n, defaultBalance: 0n }, guard: { guard: "araso-a949-public-guard", chainId: 31337143, forkInstanceId: FORK_INSTANCE, forkStartBlock: 110874000 } });
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
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/api/")) {
      let body = null; try { body = JSON.parse(request.postData() || "null"); } catch {}
      const invite = request.headers()["x-araso-invite"] || null;
      requests.push({ person, path: url.pathname, action: body?.action || null, invite, bodyInvite: !!(body && Object.hasOwn(body, "invite") && body.invite) });
      const json = (status, out) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(out) });
      if (url.pathname === "/api/event") { events.push({ person, step: body?.step, code: body?.code, at: Date.now() - T0 }); return route.fulfill({ status: 204, body: "" }); }
      if (url.pathname === "/api/grant" && grantHangMs > 0) { await sleep(grantHangMs); return route.abort(); } // relayer never answers
      if (url.pathname === "/api/grant") {
        const address = String(body?.address || "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) return json(400, { ok: false, error: "bad address" });
        if (granted.has(address)) return json(403, { ok: false, error: "already funded" });
        if (grantMode === "down") return json(500, { ok: false, error: "relayer down" });
        granted.add(address);
        if (grantMode !== "nofund") chain.fund(address, grantMode === "little" ? 5_000_000_000_000_000n : 200_000_000_000_000_000n);
        return json(200, { ok: true, txHash: `0x${"a1".repeat(32)}` });
      }
      if (url.pathname === "/api/fork-entry") {
        const action = body?.action;
        if (action === "public_state") return json(200, { ok: true, publicEntry: true });
        if (action === "status") {
          fork.statusCalls += 1;
          if (fork.reenterOnce) { fork.reenterOnce = false; return json(200, { ok: true, allowed: false, reenter: true }); }
          if (fork.refuseStatus) return json(403, { ok: false, allowed: false, reason: "not_allowed" });
          return json(200, { ok: true, allowed: true, forkScope: "monad-fork", forkInstanceId: FORK_INSTANCE });
        }
        if (action === "challenge" && fork.refuseChallenge > 0) { fork.refuseChallenge -= 1; return json(503, { ok: false, reason: "entry_unavailable" }); }
        if (action === "challenge") {
          const piggy = String(body?.piggyAddress || "").toLowerCase(); const nonce = "a1264".padEnd(32, "0"); const expiresAt = Date.now() + 60_000;
          const message = ["Araso Journey 2 entry", `uri: ${BASE}`, "chainId: 31337143", `piggy: ${piggy}`, `tester: public:${piggy.slice(2, 10)}`, `fork: ${FORK_INSTANCE}`, `nonce: ${nonce}`, `expires: ${new Date(expiresAt).toISOString()}`].join("\n");
          return json(200, { ok: true, nonce, message, expiresAt });
        }
        if (action === "enter") forkChain.fund(String(body?.piggyAddress || ""), 10n ** 19n); // the server tops up fork MON on entry
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
  const world = { label, chain, forkChain, requests, events, fork, route };
  allWorlds.push(world);
  return world;
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
  return { cdp, authenticatorId, page, credential: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials[0] || null };
}

async function openPerson(browser, world, id, { storageState, invite, credential, viewport, initScript, base, userVerified, clock } = {}) {
  const phone = Number(process.env.ARASO_REHEARSAL_WIDTH) > 0 ? { width: Number(process.env.ARASO_REHEARSAL_WIDTH), height: 932 } : { width: 390, height: 844 };
  const video = process.env.ARASO_REHEARSAL_VIDEO && id === "a" ? { recordVideo: { dir: process.env.ARASO_REHEARSAL_VIDEO, size: viewport || phone } } : {};
  const context = await browser.newContext({ ...video, viewport: viewport || phone, ...(storageState ? { storageState } : {}) });
  const tag = { id };
  await context.route("**/*", (route) => world.route(route, tag.id));
  if (invite) await context.addInitScript((token) => { try { if (!localStorage.getItem("araso.forkInvite.v1")) localStorage.setItem("araso.forkInvite.v1", token); } catch {} }, invite);
  if (initScript) await context.addInitScript(initScript);
  if (clock) await context.clock.install();
  await context.addInitScript(() => {
    // Pacing timeline: every 100 ms, record when a watched thing first appears/changes (scene, Send live, Chog lines, receipt).
    let tl = []; try { tl = JSON.parse(sessionStorage.getItem("__arasoTimeline") || "[]"); } catch {}
    let last = {};
    const live = (sel) => { const el = document.querySelector(sel); if (!el || el.disabled || el.hidden) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    setInterval(() => {
      try {
        const now = {
          scene: document.querySelector("[data-scene]")?.dataset.scene || "",
          card: !!document.querySelector("#sendButton") && document.querySelector("#sendButton").getBoundingClientRect().width > 0,
          send: live("#sendButton"),
          receipt: live("#returnTap"),
          phase: document.querySelector("#homeChar")?.dataset.phase || "",
          sayOut: (() => { const e = document.querySelector(".nameScene__say"); if (!e || !e.textContent) return ""; const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth ? `${e.textContent}@${Math.round(r.left)}..${Math.round(r.right)}/${innerWidth}` : ""; })(),
          // only the lines a person can see now (a later line of two-line speech waits hidden until the first is read)
          chog: [...document.querySelectorAll(".chogCheckLine")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const ls = [...e.querySelectorAll(".chogCheckLine__line")]; return (ls.length ? ls.filter((l) => getComputedStyle(l).visibility !== "hidden").map((l) => l.textContent.trim()).join(" ") : e.textContent).trim(); }).join(" | "),
        };
        let changed = false;
        for (const k of Object.keys(now)) if (now[k] !== last[k]) { tl.push({ t: Date.now(), k, v: now[k] }); changed = true; }
        last = now;
        window.__arasoTimeline = tl;
        if (changed) try { sessionStorage.setItem("__arasoTimeline", JSON.stringify(tl.slice(-400))); } catch {}
      } catch (e) { window.__arasoTimelineError = String(e); }
    }, 100);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 160)));
  if (process.env.ARASO_REHEARSAL_DEBUG === "1") page.on("console", (m) => { if (m.type() !== "log" || /A1265|fork|entry|switch|journey/i.test(m.text())) console.log(`CONSOLE ${id} ${m.type()} ${m.text().slice(0, 200)}`); });
  const passkey = await addPasskey(page, credential);
  if (userVerified === false) await passkey.cdp.send("WebAuthn.setUserVerified", { authenticatorId: passkey.authenticatorId, isUserVerified: false });
  const person = { id, tag, world, context, page, passkey, errors, name: `P${id}`, copy: new Map(), steps: 0 };
  await page.goto(base || BASE, { waitUntil: "networkidle" });
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
async function walkFirstJourney(person, { send = true } = {}) {
  await until(person, "envelope", (s) => s.scene === "received");
  await checkpoint(person, "envelope");
  await click(person, "#inviteFaceButton", "envelope Face ID");
  const born = await until(person, "hatch or name", (s) => ["hatch", "name"].includes(s.scene), 25_000);
  if (born.scene === "hatch") await checkpoint(person, "hatch"); // watch the hatch to its end like a person (no skip): pacing is measured on real time
  await until(person, "name", (s) => s.scene === "name", 30_000);
  if (await until(person, "Chog's arrival lines", (s) => s.text.includes("my first piggy"), 15_000).then(() => true, () => false)) await checkpoint(person, "name-say"); // read like a person; the line check below judges it
  await click(person, ".nameCard__okBtn", "arrival ok");
  await click(person, "#piggyNameInput", "name input");
  await person.page.locator("#piggyNameInput").fill(person.name);
  await checkpoint(person, "name");
  await click(person, ".nameScene__save", "name save");
  await until(person, "Home Send card", () => live(person, "#sendButton"), 70_000);
  await checkpoint(person, "home-send");
  person.cardStyle = await person.page.evaluate(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const c = getComputedStyle(el); return { color: c.color, stroke: c.webkitTextStrokeWidth || c.getPropertyValue("-webkit-text-stroke-width") }; };
    return { explain: pick(".sendCard__explain"), stamp: pick(".trialStamp--send"), chog: pick(".chogCheckLine") };
  });
  if (!send) return;
  await person.page.locator("#sendButton").click();
  person.sentAt = Date.now();
}
async function walkReturnAndFile(person) {
  await until(person, "Return receipt", () => live(person, "#returnTap"), 60_000);
  person.receiptText = (await checkpoint(person, "return")).text;
  for (let i = 0; i < 2; i += 1) { await click(person, "#returnTap", `receipt tap ${i + 1}`); await sleep(400); }
  await until(person, "filed → quiet Home", (s) => s.scene === "sendstay", 30_000);
  await checkpoint(person, "home-filed");
}
async function readTimeline(person) {
  for (let i = 0; i < 10; i += 1) {
    try {
      await person.page.waitForLoadState("domcontentloaded");
      const tl = await person.page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem("__arasoTimeline") || "[]"); } catch { return []; } });
      if (tl.length) return tl;
    } catch {}
    await sleep(300);
  }
  return [];
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
async function walkSecondJob(person, round, { tapHome = true } = {}) {
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
  // A person may tap the folder's Home, or just wait: Home must come either way.
  if (tapHome) await until(person, "Second Receipt Home or settled Home", async (s) => s.scene === "sendstay" || (await live(person, "#returnOpen")), 20_000);
  if (tapHome && (await live(person, "#returnOpen"))) await person.page.locator("#returnOpen").click().catch(() => {});
  await until(person, tapHome ? "filed → Home" : "filed → Home with no tap", (s) => s.scene === "sendstay", tapHome ? 30_000 : 20_000);
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
const lag = createWorld("lag", { fundLagMs: 20_000 }); // the node still sees the pre-grant balance for 20 s (live 10-15: refused +16–22 s)
const desk = createWorld("desk");     // e (desktop width, public, no invite)
const people = [];

async function laneMain() {
  const a = await openPerson(browser, main, "a"); people.push(a);
  await check("a · public ON, no invite: envelope → Face ID → hatch → name → Home → Send pressed", () => walkFirstJourney(a));
  await check("a · Away → Return → Receipt → File it → quiet Home (real deposit + redeem on the stand-in chain)", async () => {
    await walkReturnAndFile(a);
    a.firstTimeline = await readTimeline(a);
    await trace(a, "after-file", 20_000);
    assert.match(a.world.chain.log.join(";"), /deposit nonce=0;sendRaw redeem nonce=1/);
  });
  await check("a · first Receipt: went out shows the departure time (h:mm), kept stays —", () => {
    const t = a.receiptText || [];
    const i = t.indexOf("went out"), k = t.indexOf("kept");
    assert.ok(i >= 0 && /^\d{1,2}:\d{2} (AM|PM)$/.test(t[i + 1] || ""), `receipt rows: ${JSON.stringify(t)}`);
    assert.equal(t[k + 1], "—", `kept: ${t[k + 1]}`);
  });
  await check("a · events: os · entry_shown/public · passkey_create/ok · home_reached/ok · send_tap/ok · grant/ok · send/ok", () => {
    const ev = eventsOf(main, "a");
    for (const want of ["entry_shown/public", "passkey_create/ok", "home_reached/ok", "send_tap/ok", "grant/ok", "send/ok"]) assert.ok(ev.includes(want), `${want} missing in ${ev.join(",")}`);
  });
  await knownCheck("a · public ON boot never reports entry_blocked/invite_only (A-1245 flicker)", () => {
    assert.ok(!eventsOf(main, "a").includes("entry_blocked/invite_only"), `events: ${eventsOf(main, "a").join(",")}`);
  });
  // First-journey pacing (canon FIRST_JOURNEY_PACING_20261015): time to read before each next thing.
  const tl = a.firstTimeline || [];
  const at = (pred, from = 0) => (tl.find((e) => e.t >= from && pred(e)) || {}).t;
  const homeAt = at((e) => e.k === "scene" && e.v === "sendstay");
  const cardAt = at((e) => e.k === "card" && e.v === true, homeAt);
  const sendAt = at((e) => e.k === "send" && e.v === true, homeAt);
  const awayAt = at((e) => e.k === "scene" && e.v === "away", sendAt);
  const returnAt = at((e) => e.k === "scene" && e.v === "return", awayAt);
  const receiptAt = at((e) => e.k === "receipt" && e.v === true, returnAt);
  const chogLines = tl.filter((e) => e.k === "chog" && e.v).map((e) => e.v);
  await check("pace · name card: Chog says wallet? → Piggy!!!!!! → my first piggy, one at a time", () => {
    const i = ["wallet?", "Piggy!!!!!!", "my first piggy"].map((w) => chogLines.findIndex((v) => v === w));
    assert.ok(i.every((x) => x >= 0) && i[0] < i[1] && i[1] < i[2], `chog lines: ${JSON.stringify(chogLines.slice(0, 8))}`);
  });
  const sitAt = at((e) => e.k === "phase" && e.v && e.v !== "walk", homeAt + 500) || homeAt;
  await check("pace · Piggy sits → Send card ≈ 10 s (grant asked early enough that the node is ready)", () => { const d = cardAt - sitAt; assert.ok(d >= 9_500 && d <= 12_500, `${(d / 1000).toFixed(1)} s after sitting`); });
  await check("pace · Chog's lines on the name card stay inside the screen (no cut words)", () => { const out = tl.filter((e) => e.k === "sayOut" && e.v).map((e) => e.v); assert.deepEqual(out, []); });
  await check("pace · first Chog line on Home = work's coming! before the card; the two job lines come after the card", () => {
    const first = tl.find((e) => e.k === "chog" && e.v && e.t >= homeAt);
    assert.equal(first?.v, "work's coming!", `first Home line: ${first?.v}`);
    const jobLine = tl.find((e) => e.k === "chog" && /let's send Piggy to work/.test(e.v || ""));
    assert.ok(jobLine && jobLine.t >= cardAt + 1000, `job lines at ${jobLine?.t} · card at ${cardAt}`);
  });
  await check("pace · two job lines come one at a time: the first stays, the second joins after it is read (+1 s)", () => {
    const one = tl.find((e) => e.k === "chog" && e.v === "let's send Piggy to work");
    const both = tl.find((e) => e.k === "chog" && e.v === "let's send Piggy to work your money does the job.");
    assert.ok(one && both && both.t - one.t >= chogMs("let's send Piggy to work") + 1000 - 300, `first ${one?.t} · both ${both?.t} · seen ${JSON.stringify(tl.filter((e) => e.k === "chog" && /Piggy to work/.test(e.v || "")).map((e) => e.v).slice(0, 4))}`);
  });
  await check("pace · no dash in anything Chog says", () => { const d = tl.filter((e) => e.k === "chog" && /—/.test(e.v || "")).map((e) => e.v); assert.deepEqual([...new Set(d)], []); });
  await check("pace · Send can be pressed only after the job lines end (+1 s), not as the card appears", () => { assert.ok(sendAt - cardAt >= 4_000, `${((sendAt - cardAt) / 1000).toFixed(1)} s`); });
  await check("pace · Away → Return ≥ 8 s outside", () => { assert.ok(returnAt - awayAt >= 7_900, `${((returnAt - awayAt) / 1000).toFixed(1)} s`); });
  await check("pace · Return → Receipt has a breath (≥ base + 1.5 s)", () => { assert.ok(receiptAt - returnAt >= Number(process.env.ARASO_PACE_RECEIPT_MS || 8500), `${((receiptAt - returnAt) / 1000).toFixed(1)} s`); });
  await check("pace · yellow text = our gold #E0B100, drawn bold (card lines + Chog speech)", async () => {
    const st = await a.page.evaluate(() => {
      const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const c = getComputedStyle(el); return { color: c.color, stroke: c.webkitTextStrokeWidth || c.getPropertyValue("-webkit-text-stroke-width") }; };
      return { explain: pick(".sendCard__explain"), stamp: pick(".trialStamp--send"), chog: pick(".chogCheckLine") };
    });
    for (const [k, v] of Object.entries(a.cardStyle || st)) {
      if (!v) continue;
      assert.equal(v.color, "rgb(224, 177, 0)", `${k} color ${v.color}`);
      assert.ok(parseFloat(v.stroke) > 0, `${k} not bold (stroke ${v.stroke})`);
    }
  });
  if (process.env.ARASO_REHEARSAL_DEBUG === "1") console.log(`TL ${tl.length} ${JSON.stringify(tl.slice(0, 40))}`);
  if (process.env.ARASO_REHEARSAL_DEBUG === "1") console.log(`TLCHOG ${JSON.stringify(tl.filter((e) => e.k === "chog" || e.k === "send"))}`);
  console.log(`PACE home→card ${((cardAt - homeAt) / 1000).toFixed(1)} s · card→send ${((sendAt - cardAt) / 1000).toFixed(1)} s · away→return ${((returnAt - awayAt) / 1000).toFixed(1)} s · return→receipt ${((receiptAt - returnAt) / 1000).toFixed(1)} s`);
  await check("a · 1st done → Journey 2 entry (live signer enters directly; otherwise \"tap me!\") → switch → intro → Explore", async () => {
    await until(a, "tap me! or Explore", (s) => s.scene === "explore" || s.text.includes("tap me!"), 40_000);
    if ((await look(a)).scene === "explore") {
      const t2 = await readTimeline(a);
      const intro = t2.find((e) => e.k === "chog" && /I found a few things/.test(e.v || ""));
      const exp = t2.find((e) => e.k === "scene" && e.v === "explore" && (!intro || e.t >= intro.t));
      a.introToExplore = intro && exp ? exp.t - intro.t : null;
    }
    if ((await look(a)).text.includes("tap me!")) { await checkpoint(a, "tapme"); await click(a, "#chogHomeHit", "tap me"); }
    await until(a, "Explore", (s) => s.scene === "explore", 30_000);
    await sleep(1500);
    await checkpoint(a, "explore");
    assert.ok(main.requests.some((r) => r.person === "a" && r.action === "enter"), "fork entry recorded");
  });
  await check("pace · second intro line → Explore paper ≥ 2.7 s (1.2 s beat + 1.5 s breath)", () => { assert.ok(a.introToExplore >= 2_600, `${a.introToExplore} ms`); });
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

// Every failure leaves a place to press again (canon: no dead end). Money that may be mid-flight keeps the double-send guard:
// Send turns into a read-only re-check — it never broadcasts a second deposit.
async function laneStuck() {
  const oc = createWorld("stuck-oc");
  const p = await openPerson(browser, oc, "s-oc", { userVerified: false }); people.push(p);
  await check("stuck · create Face ID cancelled → Make new → Face ID approved → Piggy hatches (no dead end)", async () => {
    await until(p, "envelope", (s) => s.scene === "received");
    await click(p, "#inviteFaceButton", "envelope Face ID");
    await until(p, "cancel card", (s) => s.text.includes("Face ID was cancelled."), 20_000);
    await checkpoint(p, "create-cancelled");
    const dump = () => p.page.evaluate(() => ({ ss: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k).slice(0, 40)])), ls: Object.keys(localStorage).filter((k) => /araso/.test(k)) }));
    if (process.env.ARASO_REHEARSAL_DEBUG === "1") console.log("STUCK after cancel", JSON.stringify(await dump()));
    // Chromium's virtual authenticator keeps refusing after setUserVerified(true); a fresh one stands for "approve this time".
    await p.passkey.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: p.passkey.authenticatorId });
    p.passkey = await addPasskey(p.page);
    await click(p, "#authTryAgainButton", "Make new");
    await until(p, "envelope again", (s) => s.scene === "received", 10_000);
    if (process.env.ARASO_REHEARSAL_DEBUG === "1") console.log("STUCK before retry", JSON.stringify(await dump()));
    await click(p, "#inviteFaceButton", "envelope Face ID again");
    if (process.env.ARASO_REHEARSAL_DEBUG === "1") { await sleep(4000); console.log("STUCK after retry", JSON.stringify(await dump()), JSON.stringify(eventsOf(oc, "s-oc"))); }
    await until(p, "hatch or name", (s) => ["hatch", "name"].includes(s.scene), 25_000);
  });
  await p.context.close();
  const hw = createWorld("stuck-hang", { grantHangMs: 120_000 });
  const h = await openPerson(browser, hw, "s-gh"); people.push(h);
  await check("stuck · relayer never answers the early grant → the Send card still comes (≤ 26 s after Home incl. the walk), not held forever", async () => {
    await walkFirstJourney(h);
    const tl = await readTimeline(h);
    const homeAt = (tl.find((e) => e.k === "scene" && e.v === "sendstay") || {}).t;
    const cardAt = (tl.find((e) => e.k === "card" && e.v === true && e.t >= homeAt) || {}).t;
    assert.ok(cardAt - homeAt <= 26_000, `${((cardAt - homeAt) / 1000).toFixed(1)} s`);
  });
  await h.context.close();
  for (const [id, fault, expect] of [["s-dr", "revert:deposit", "can't tell yet."], ["s-rf", "refuse:redeem", "still out."], ["s-rr", "revert:redeem", "couldn't finish this one."]]) {
    const w = createWorld(`stuck-${id}`);
    const q = await openPerson(browser, w, id); people.push(q);
    await check(`stuck · ${fault} → "${expect}" → Send stays pressable as a re-check; pressing never broadcasts a second deposit`, async () => {
      await walkFirstJourney(q);
      const [kind, fn] = fault.split(":"); w.chain.faults[kind].add(fn);
      await until(q, expect, (s) => s.text.some((t) => t.includes(expect)), 60_000);
      await checkpoint(q, `money-stuck-${fn}-${kind}`);
      await until(q, "re-check pressable", () => live(q, "#sendButton"), 10_000);
      const deposits = () => (w.chain.log.join(";").match(/sendRaw deposit/g) || []).length;
      const before = deposits();
      await q.page.locator("#sendButton").click();
      await sleep(3000);
      assert.equal(deposits(), before, `a re-check must not send again: ${w.chain.log.join(";")}`);
      await until(q, "still a place to press after the re-check", () => live(q, "#sendButton"), 10_000);
    });
    await q.context.close();
  }
}

// Journey 2 Job failures must not be silent: Chog says try again over the screen it happened on, Piggy looks sulky,
// and the server learns why (job_why) — before Away (still on Explore) or after Away (back Home).
async function walkToJobSend(person) {
  await walkFirstJourney(person);
  await walkReturnAndFile(person);
  await enterSecond(person);
  await person.page.locator('input[data-errand-id="clean"]').check();
  await click(person, "#exploreSaveButton", "explore save");
  await click(person, ".secondJourney__pick", "job pick");
  await click(person, "#secondOkButton", "job ok");
  await until(person, "Job Send", () => live(person, "#secondSendButton"), 20_000);
}
// Unlock failures are told apart by cause (the screen copy stays): cancelled vs the app's own wait running out.
async function laneUnlockWhy() {
  const runs = [["uw-cancel", "cancelled", async (p) => { await p.passkey.cdp.send("WebAuthn.setUserVerified", { authenticatorId: p.passkey.authenticatorId, isUserVerified: false }); }],
    ["uw-timeout", "timeout", async (p) => { await p.passkey.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: p.passkey.authenticatorId, enabled: false }); }]];
  await Promise.all(runs.map(async ([id, word, arm]) => {
    const w = createWorld(`unlock-${id}`);
    const p = await openPerson(browser, w, id); people.push(p);
    await check(`unlock why · ${word}: the unlock failure is recorded with its own cause word (unlock_why/${word})`, async () => {
      await walkFirstJourney(p);
      await p.page.goto("about:blank"); await p.page.goto(BASE, { waitUntil: "networkidle" });
      await until(p, "lock", (s) => s.scene === "birth", 20_000);
      await arm(p);
      await click(p, "#loginChogButton", "lock Chog");
      await until(p, "unlock failed card", async () => live(p, "#unlockRetryButton"), 60_000);
      assert.ok(eventsOf(w, id).includes(`unlock_why/${word}`), `events: ${eventsOf(w, id).join(",")}`);
    });
    await p.context.close();
  }));
}

// A-1283: after "these two?" / "all of them?" and checking…, Chog says why only one goes (or none), one line at a time; then the one card.
const FORK_RUNNABLE_ERRANDS = ["market", "order", "clean", "grow", "lp"]; // second-job-readiness.js FORK_JOB_ROWS errand ids
async function laneExploreWhy() {
  const cases = [
    ["xw-two", ["market", "order"], "these two?", "both can go. sending one for now."],
    ["xw-all", ["market", "order", "clean"], "all of them?", "all of them work. let's try one first."],
    // the next Explore set (save with nothing picked) holds errands with no fork Job row: some / none can go
    ["xw-some", "one-of-two", "these two?", "only this one can go today."],
    ["xw-none", "none-of-two", "these two?", "none of these can go now. something else?"],
  ];
  await Promise.all(cases.map(async ([id, picks, first, second]) => {
    const w = createWorld(`explorewhy-${id}`);
    const p = await openPerson(browser, w, id); people.push(p);
    await check(`explore why · ${typeof picks === "string" ? picks : `${picks.length} picked, all can go`} → "${first}" then "${second}" one at a time, then the one-line card with Send`, async () => {
      await walkFirstJourney(p);
      await walkReturnAndFile(p);
      await enterSecond(p);
      const errands = () => p.page.evaluate(() => [...document.querySelectorAll("input[data-errand-id]")].map((e) => e.dataset.errandId));
      let shown = await errands();
      let chosen = picks;
      if (typeof picks === "string") {
        for (let r = 0; r < 4; r += 1) {
          const run = shown.filter((x) => FORK_RUNNABLE_ERRANDS.includes(x)); const rest = shown.filter((x) => !FORK_RUNNABLE_ERRANDS.includes(x));
          chosen = picks === "one-of-two" ? (run.length && rest.length ? [run[0], rest[0]] : null) : (rest.length >= 2 && shown.length > 2 ? rest.slice(0, 2) : null);
          if (chosen) break;
          await click(p, "#exploreSaveButton", "explore save with nothing (next set)"); await sleep(800); shown = await errands();
        }
        assert.ok(chosen, `no Explore set for ${picks}: last ${JSON.stringify(shown)}`);
      }
      assert.ok(chosen.every((x) => shown.includes(x)) && (chosen.length === 2 ? shown.length > 2 : shown.length === chosen.length), `Explore shows ${JSON.stringify(shown)}`);
      for (const x of chosen) await p.page.locator(`input[data-errand-id="${x}"]`).check();
      await click(p, "#exploreSaveButton", "explore save");
      await until(p, "second line", (st) => st.text.includes(second), 15_000).then(() => checkpoint(p, "why-two-lines"), () => {});
      const none = picks === "none-of-two";
      const sendAt = await until(p, none ? "back to the Explore paper" : "one-line card Send", async () => (none ? (await p.page.locator("input[data-errand-id]").count()) > 0 : live(p, "#secondSendButton")), 25_000).then(() => Date.now(), () => null);
      const tl = await readTimeline(p);
      const seen = tl.filter((e) => e.k === "chog" && e.v).map((e) => e.v);
      const one = tl.find((e) => e.k === "chog" && e.v === first);
      const both = tl.find((e) => e.k === "chog" && e.v === `${first} ${second}`);
      assert.ok(one && both, `Chog said ${JSON.stringify([...new Set(seen)].slice(-6))}`);
      assert.ok(both.t - one.t >= chogMs(first) + 1000 - 300, `second line ${both.t - one.t} ms after the first`);
      assert.ok(sendAt && sendAt - both.t >= chogMs(second) + 1000 - 400, `${none ? "paper" : "card"} ${sendAt ? sendAt - both.t : "never"} ms after both lines`);
      assert.equal(await p.page.locator(".secondJourney__pick").count(), 0, none ? "back on the Explore paper (no pick list)" : "the card is the one-line card (no pick list)");
      if (none) assert.equal(await live(p, "#secondSendButton"), false, "nothing to send");
      await checkpoint(p, "why-card");
    });
  }));
}
async function laneJobFail() {
  const cases = [
    ["jf-reverted", "after Away · the Job tx reverts", (w) => w.forkChain.faults.revert.add("approve"), "failed"],
    ["jf-refused", "after Away · the node refuses the Job tx", (w) => w.forkChain.faults.refuse.add("approve"), "failed"],
    ["jf-server", "before Away · the server refuses the fork re-check", (w) => { w.fork.refuseStatus = true; }, "server_refused"],
    ["jf-read", "before Away · the fork chain cannot be read", (w) => { w.forkChain.faults.blockError = true; }, "read_failed"],
  ];
  await Promise.all(cases.map(async ([id, label, inject, word]) => {
    const w = createWorld(`jobfail-${id}`);
    const p = await openPerson(browser, w, id); people.push(p);
    await check(`job fail · ${label} → Chog "try again" + sulky Piggy on that screen · event job_why/${word}`, async () => {
      await walkToJobSend(p);
      inject(w);
      await p.page.locator("#secondSendButton").click();
      await until(p, "try again", (s) => s.text.includes("try again"), 60_000);
      // only the face changes (and a small dip): no second whole-body picture laid over Piggy
      const face = await p.page.evaluate(() => ({ overlay: document.querySelectorAll(".homeChar__seat--sulky").length, sulkyFace: document.querySelectorAll(".sulkyFace").length, seatSulky: /seat_sulky/.test(document.querySelector("#homeSeat")?.getAttribute("src") || "") && getComputedStyle(document.querySelector("#homeSeat")).visibility !== "hidden", canvasSulky: !!document.querySelector('.departStage[data-face="sulky"]'), dip: !!document.querySelector(".is-sulky-dip"),
        scene: document.querySelector(".stage")?.dataset.scene, idle: !!document.querySelector(".homeAmbient__idle #face"), seat: (() => { const e = document.querySelector("#homeSeat"); if (!e) return null; const r = e.getBoundingClientRect(); return `${e.getAttribute("src")}@${Math.round(r.width)}x${Math.round(r.height)} ${getComputedStyle(e).visibility}/${getComputedStyle(e).opacity}`; })(),
        ambientSeat: document.querySelector("#homeChar")?.hasAttribute("data-ambient-seat"), imgs: [...document.querySelectorAll("#homeChar img, #homeChar svg")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => `${e.tagName}.${e.getAttribute("class") || ""}#${e.id}`).slice(0, 6) }));
      assert.equal(face.overlay, 0, `whole-body overlay present ${JSON.stringify(face)}`);
      assert.ok((face.sulkyFace > 0 || face.seatSulky || face.canvasSulky) && face.dip, `face-only sulky missing ${JSON.stringify(face)}`);
      await checkpoint(p, `job-failed-${word}`);
      const ok = word === "failed" ? eventsOf(w, id).some((e) => e === "job_why/failed" || e === "job_why/refused") : eventsOf(w, id).includes(`job_why/${word}`);
      assert.ok(ok, `events: ${eventsOf(w, id).join(",")}`);
    });
    await p.context.close();
  }));
}

// Each passkey made here carries its own name (picker shows them apart); a saved Piggy name renames it where the Signal API exists.
async function laneNames() {
  const w = createWorld("names");
  const signalStub = () => { try { const PKC = window.PublicKeyCredential; if (PKC) PKC.signalCurrentUserDetails = (o) => { window.__arasoSignal = o; return Promise.resolve(); }; } catch {} };
  const made = [];
  for (const id of ["n1", "n2"]) {
    const p = await openPerson(browser, w, id, { initScript: signalStub }); people.push(p);
    await check(`names · ${id}: create a Piggy and name it`, () => walkFirstJourney(p, { send: false }));
    const creds = (await p.passkey.cdp.send("WebAuthn.getCredentials", { authenticatorId: p.passkey.authenticatorId })).credentials;
    made.push({ p, cred: creds[0], signal: await p.page.evaluate(() => window.__arasoSignal || null), handle: await p.page.evaluate(() => localStorage.getItem("araso.pkUserHandle.v1")) });
  }
  await check("names · two passkeys made on this site have different names (not one constant)", () => {
    const names = made.map((m) => m.cred?.userName);
    assert.ok(names.every(Boolean), `names: ${JSON.stringify(names)}`);
    assert.ok(names.every((n) => /^Araso Piggy · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(n)), `names: ${JSON.stringify(names)}`);
    assert.ok(!names.includes("araso-owner"), `names: ${JSON.stringify(names)}`);
    const handles = made.map((m) => m.cred?.userHandle);
    assert.notEqual(handles[0], handles[1], "user handles stay unique");
  });
  await check("names · saving the Piggy name asks the browser to rename that passkey (Signal API, same user handle)", () => {
    for (const m of made) {
      assert.ok(m.signal && m.signal.name === m.p.name && m.signal.displayName === m.p.name, `signal: ${JSON.stringify(m.signal)}`);
      assert.equal(m.signal.userId, m.handle, "renames the passkey made here");
      assert.equal(Buffer.from(m.cred.userHandle, "base64").toString("base64url"), m.handle, "stored handle = the authenticator's user handle");
    }
  });
  for (const m of made) await m.p.context.close();
  // Real Signal API (no stub): does this browser's authenticator take the new name? Recorded, not judged (support varies by browser).
  const r = await openPerson(browser, w, "n3"); people.push(r);
  await walkFirstJourney(r, { send: false }).catch(() => {});
  await sleep(1500);
  const after = (await r.passkey.cdp.send("WebAuthn.getCredentials", { authenticatorId: r.passkey.authenticatorId })).credentials[0];
  console.log(`NAMES real-signal userName after naming = ${JSON.stringify(after?.userName)} (Piggy ${r.name})`);
  await r.context.close();
}

// Jar + Piggy: after each Journey 2 round, the jar must show on Home with no tap; then + Piggy must make a new Piggy.
async function jarShown(person) {
  return person.page.evaluate(() => { const el = document.querySelector("#a905Jar"); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; });
}
const JAR_LINE = "the jar's sparkling. wanna tap it?";
const BELL_LINE = "when there's a new job for piggy, the bell will ring.";
const speakMs = (t) => t.length * 60 + 1200; // same read time as the app's Chog lines
async function watchJarGuide(person) {
  const t0 = Date.now();
  await until(person, "jar", () => jarShown(person), 20_000);
  const jarAt = Date.now();
  await until(person, "Chog: the jar's sparkling", (s) => s.text.includes(JAR_LINE), 15_000);
  return { homeToJar: jarAt - t0, jarToLine: Date.now() - jarAt, lineAt: Date.now() };
}
async function laneJarTap() {
  const w = createWorld("jartap");
  const q = await openPerson(browser, w, "jt"); people.push(q);
  await check("guide · tap path: first Journey → Journey 2 round 1 → Home", async () => {
    await walkFirstJourney(q); await walkReturnAndFile(q); await enterSecond(q); await walkSecondJob(q, 1);
  });
  await check("guide · tap the sparkling jar → Money → back → 1 s → Chog adds the bell line under the jar line", async () => {
    await watchJarGuide(q);
    await checkpoint(q, "guide-jar-line");
    await q.page.locator("#a905Jar").click();
    await until(q, "Money screen", async () => q.page.evaluate(() => !!document.querySelector(".a911-screen")), 10_000);
    await sleep(1500);
    assert.ok(!(await look(q)).text.includes(BELL_LINE), "bell line came while Money was open");
    await q.page.locator('.a911-back[data-a905-act="back"]').click();
    const back = Date.now();
    const s = await until(q, "Chog: bell line", (x) => x.text.includes(BELL_LINE), 10_000);
    const ms = Date.now() - back;
    assert.ok(ms >= 900 && ms <= 3000, `back → bell line ${ms} ms`);
    assert.ok(s.text.includes(JAR_LINE), "jar line kept above the bell line");
    await checkpoint(q, "guide-bell-line");
  });
  await q.context.close();
}
async function laneJarPiggy() {
  const w = createWorld("jarpiggy");
  const p = await openPerson(browser, w, "jp"); people.push(p);
  await check("jar · first Journey → filed → Journey 2 round 1 → Receipt filed → Home with no tap", async () => {
    await walkFirstJourney(p); await walkReturnAndFile(p); await enterSecond(p); await walkSecondJob(p, 1, { tapHome: false });
  });
  let guide = null;
  await check("jar · round 1 done: jar shows on Home within 20 s with no tap", async () => {
    guide = watchJarGuide(p).catch((e) => ({ error: e }));
    await until(p, "jar after round 1", () => jarShown(p), 20_000);
    await checkpoint(p, "jar-r1");
  });
  await check("guide · first Home after Journey 2: the jar drops, sparkles, settles 1.5 s → Chog: the jar's sparkling. wanna tap it?", async () => {
    const g = await guide;
    if (g?.error) throw g.error;
    assert.ok(g.jarToLine >= 1500, `jar → line ${g.jarToLine} ms`);
    assert.equal(await p.page.evaluate(() => document.querySelector("#a905Jar")?.getAttribute("data-a904")), "twinkle", "jar sparkles while Chog says it");
    await checkpoint(p, "guide-jar-line");
  });
  await check("guide · no tap: after the jar line's read time + 5 s, Chog adds the bell line (jar line kept) and no bell rang before it", async () => {
    const g = await guide;
    if (g?.error) throw g.error;
    let bellEarly = false;
    const s = await until(p, "Chog: bell line", async (x) => { if (!x.text.includes(BELL_LINE) && (await p.page.evaluate(() => !!document.querySelector("#secondHomeBell")))) bellEarly = true; return x.text.includes(BELL_LINE); }, 20_000);
    const ms = Date.now() - g.lineAt;
    assert.ok(ms >= speakMs(JAR_LINE) + 5000 - 400, `jar line → bell line ${ms} ms (want ≥ ${speakMs(JAR_LINE) + 5000})`);
    assert.ok(s.text.includes(JAR_LINE), "jar line kept");
    assert.ok(!bellEarly, "bell rang before the guide ended");
    await checkpoint(p, "guide-bell-line");
  });
  await check("jar · reopen → unlock → bell → Journey 2 round 2 → Receipt filed → Home with no tap", async () => {
    await p.page.goto("about:blank"); await p.page.goto(BASE, { waitUntil: "networkidle" });
    await unlockIfLocked(p);
    await until(p, "bell", async () => p.page.evaluate(() => !!document.querySelector("#secondHomeBell")), 60_000);
    await walkSecondJob(p, 2, { tapHome: false });
  });
  await check("jar · round 2 done: jar shows on Home within 20 s with no tap, and the guide does not come again", async () => {
    await until(p, "jar after round 2", () => jarShown(p), 20_000);
    await sleep(6000);
    const t = (await checkpoint(p, "jar-r2")).text;
    assert.ok(!t.includes(JAR_LINE) && !t.includes(BELL_LINE), `guide again: ${JSON.stringify(t.slice(-6))}`);
  });
  // KNOWN until the fork-scope origin index is decided: after the Journey 2 switch the app runs in the fork scope, whose Piggy index is empty
  // (the first Piggy and its birth mark live in the testnet scope), so + Piggy stops before Face ID (origin_index_missing) and nothing shows.
  await knownCheck("piggy · Chog opens the Home paper → + Piggy → a new Piggy is made (Name it)", async () => {
    await click(p, "#chogHomeHit", "Chog");
    await sleep(2500); // the paper has finished opening (a person reads it before tapping)
    await click(p, ".homePlusPiggyTab", "+ Piggy");
    await checkpoint(p, "plus-piggy");
    try { await until(p, "Name it for the new Piggy", (s) => s.scene === "name", 20_000); }
    catch (e) {
      const idx = await p.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("araso.myPiggiesIndex.v1.")).join(","));
      throw new Error(`${e.message} · Piggy index keys: ${idx || "none"}`);
    }
    await checkpoint(p, "plus-piggy-name");
  });
  await p.context.close();
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
    await until(g, "try again", (s) => s.text.includes("try again"), 5_000);
    await checkpoint(g, "send-failed-sulky-now");
    if (process.env.ARASO_REHEARSAL_OUT) await g.page.screenshot({ path: path.join(OUT, `${g.id}-sulky-closeup.png`), clip: { x: 230, y: 640, width: 160, height: 170 } }).catch(() => {});
    // only the face changes (and a small dip): no second whole-body picture laid over the seated Piggy
    const face = await g.page.evaluate(() => ({ overlay: document.querySelectorAll(".homeChar__seat--sulky").length, sulkyFace: document.querySelectorAll(".sulkyFace").length, seatSulky: /seat_sulky/.test(document.querySelector("#homeSeat")?.getAttribute("src") || "") && getComputedStyle(document.querySelector("#homeSeat")).visibility !== "hidden", canvasSulky: !!document.querySelector('.departStage[data-face="sulky"]'), dip: !!document.querySelector(".is-sulky-dip") }));
    assert.equal(face.overlay, 0, `whole-body overlay present ${JSON.stringify(face)}`);
    assert.ok((face.sulkyFace > 0 || face.seatSulky || face.canvasSulky) && face.dip, `face-only sulky missing ${JSON.stringify(face)}`);
    assert.equal(await live(g, "#sendButton"), false, "Send waits while Piggy is sulky");
    await checkpoint(g, "send-failed-sulky");
    assert.equal(await g.page.evaluate(() => Object.keys(localStorage).filter((k) => /sendPending/i.test(k) && localStorage.getItem(k)).length), 0, "send pending record cleared");
    await until(g, "Send pressable", () => live(g, "#sendButton"), 20_000);
    await checkpoint(g, "home-after-refusals");
    assert.doesNotMatch(fault4.chain.log.join(";"), /sendRaw deposit/, "no deposit landed; nonce stays 0");
    assert.ok(eventsOf(fault4, "f4").includes("send_why/broadcast"), `events: ${eventsOf(fault4, "f4").join(",")}`);
  });
  await check("fault · after the sulky beat: Piggy's face comes back and Send can be pressed again", async () => {
    await until(g, "Send back", () => live(g, "#sendButton"), 10_000);
    assert.equal(await g.page.evaluate(() => document.querySelectorAll(".homeChar__seat--sulky.is-in:not(.is-leaving)").length), 0);
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

  // The live failure of 2026-10-15: the grant lands, but the node refuses the deposit as "insufficient balance" for ~20 s.
  const k = await openPerson(browser, lag, "f6"); people.push(k);
  await check("fault · grant lag: walk to Send", () => walkFirstJourney(k));
  await check("fault · grant lag (node refuses for 20 s after the grant): the app waits — no refused broadcast, the first trip finishes", async () => {
    await walkReturnAndFile(k);
    assert.doesNotMatch(lag.chain.log.join(";"), /refused insufficient/, `chain: ${lag.chain.log.join(";")}`);
    assert.match(lag.chain.log.join(";"), /sendRaw deposit nonce=0;sendRaw redeem nonce=1/);
  });
  await k.context.close();
}

// ── Failure atlas (ARASO_REHEARSAL_ONLY=atlas): each lane forces one failure screen on the current app and screenshots it ──
const ATLAS_DIR = privatePath("ops", "receipts", "failure_atlas_20261015");
const atlasRows = [];
async function atlasShot(person, name) {
  const seen = await look(person);
  mkdirSync(ATLAS_DIR, { recursive: true });
  await person.page.screenshot({ path: path.join(ATLAS_DIR, `${name}.png`) });
  return seen;
}
async function atlasLane(id, { world, setup, trigger, expect, retry, shot }) {
  const row = { id, shot: `${id}.png`, text: [], retry: "—", ok: false, why: "" };
  let person = null;
  try {
    person = await openPerson(browser, world, id, setup || {}); people.push(person);
    await trigger(person);
    const seen = await until(person, `${id} failure screen`, (x) => expect.every((e) => x.text.some((t) => t.includes(e))), 60_000);
    row.text = seen.text.filter((t) => expect.some((e) => t.includes(e)) || /could|can't|couldn|not |nothing|still|Not from/i.test(t));
    await atlasShot(person, id);
    row.ok = true;
    if (retry) row.retry = await retry(person);
  } catch (error) { row.why = String(error?.message || error).split("\n")[0].slice(0, 200); }
  atlasRows.push(row);
  record(`atlas ${id} shows ${expect.join(" · ")}`, row.ok, row.why);
  await person?.context.close().catch(() => {});
}
async function sendAgain(person, fixed, waitMs = 0) {
  if (waitMs) await sleep(waitMs);
  // the sulky beat holds Send for a few seconds after a failure; a person sees it come back
  try { await until(person, "Send back after the failure beat", () => live(person, "#sendButton"), 8_000); } catch { return "안 됨 (Send 잠김)"; }
  const deposits = (person.world.chain.log.join(";").match(/sendRaw deposit/g) || []).length;
  const before = (await look(person)).text.join("|");
  await person.page.locator("#sendButton").click();
  await sleep(2000);
  if ((await look(person)).text.some((t) => t.includes("Confirmation is still catching up."))) {
    await sleep(3000);
    const again = (person.world.chain.log.join(";").match(/sendRaw deposit/g) || []).length;
    return `다시 확인(읽기 전용) — 두 번째 보냄 ${again - deposits} · Send 다시 누를 수 있음 ${await live(person, "#sendButton")}`;
  }
  try {
    const end = await until(person, "retry final", async (x) => (await live(person, "#returnTap")) || (x.scene === "sendstay" && x.text.some((t) => /could not get ready|can't go out yet|couldn't finish/.test(t))), 60_000);
    if (await live(person, "#returnTap")) return fixed;
    return "안 됨 (같은 실패)";
  } catch { return `모름 (60 s 안에 끝 0 · 앞 화면 ${before.slice(0, 40)})`; }
}
async function retryOpen(p) {
  const ids = await p.page.$$eval("button,[role=button]", (bs) => bs.filter((x) => x.getBoundingClientRect().width > 0).map((x) => x.id).filter(Boolean));
  const btn = ["authTryAgainButton", "unlockRetryButton", "checkButton", "loginChogButton", "inviteFaceButton"].find((x) => ids.includes(x));
  if (!btn) return `안 됨 (누를 버튼 없음: ${ids.join("/") || "—"})`;
  await p.page.locator(`#${btn}`).click();
  await sleep(2500);
  if ((await look(p)).scene === "received" && (await live(p, "#inviteFaceButton"))) { await p.page.locator("#inviteFaceButton").click(); }
  try { await until(p, "after retry", (s) => ["hatch", "name", "sendstay"].includes(s.scene), 12_000); return `바로 풀림 (#${btn})`; } catch { return `안 됨 (#${btn} 뒤 같은 실패 · 원인 지속)`; }
}
async function retryHomeLive(p, label) { return (await live(p, "#sendButton")) ? `Send 다시 누를 수 있음 (${label})` : `안 됨 (${label})`; }
async function laneAtlas() {
  const W = (label, o) => createWorld(label, o);
  const toSend = (p) => walkFirstJourney(p);
  const lanes = [
    ["open-unsupported", { world: W("at1"), setup: { initScript: () => { try { delete window.PublicKeyCredential; Object.defineProperty(navigator, "credentials", { value: undefined, configurable: true }); } catch {} } },
      trigger: async (p) => { await until(p, "envelope", (s) => s.scene === "received"); await p.page.locator("#inviteFaceButton").click(); }, expect: ["Couldn't open Piggy", "This device can't use Face ID or a passkey here."], retry: retryOpen }],
    ["open-not-this-site", { world: W("at2"), setup: { base: "http://127.0.0.1:5944" },
      trigger: async (p) => { await until(p, "envelope", (s) => s.scene === "received"); await p.page.locator("#inviteFaceButton").click(); }, expect: ["Couldn't open Piggy", "Piggy opens in the real app."], retry: retryOpen }],
    ["find-not-this-site", { world: W("at2b"), setup: { base: "http://127.0.0.1:5944", initScript: () => { try { sessionStorage.setItem("araso.publicCreateAttempt.v1", "attempted"); } catch {} } },
      trigger: async (p) => { await until(p, "envelope", (s) => s.scene === "received"); await p.page.locator("#inviteFaceButton").click(); }, expect: ["Couldn't open Piggy"], retry: retryOpen }],
    ["find-unsupported", { world: W("at1b"), setup: { initScript: () => { try { sessionStorage.setItem("araso.publicCreateAttempt.v1", "attempted"); delete window.PublicKeyCredential; Object.defineProperty(navigator, "credentials", { value: undefined, configurable: true }); } catch {} } },
      trigger: async (p) => { await until(p, "envelope", (s) => s.scene === "received"); await p.page.locator("#inviteFaceButton").click(); }, expect: ["Couldn't open Piggy"], retry: retryOpen }],
    ["open-cancelled", { world: W("at3"), setup: { userVerified: false },
      trigger: async (p) => { await until(p, "envelope", (s) => s.scene === "received"); await p.page.locator("#inviteFaceButton").click(); }, expect: ["Couldn't open Piggy", "Face ID was cancelled."],
      // A virtual authenticator keeps refusing after setUserVerified(true); a fresh one stands for "approve this time".
      retry: async (p) => { await p.passkey.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: p.passkey.authenticatorId }); p.passkey = await addPasskey(p.page); return `${await retryOpen(p)} — 이번엔 Face ID 승인(새 인증기)`; } }],
    ["find-failed", { world: W("at4"), setup: { initScript: () => { try { sessionStorage.setItem("araso.publicCreateAttempt.v1", "attempted"); } catch {} }, userVerified: false },
      trigger: async (p) => { await until(p, "envelope", (s) => s.scene === "received"); await p.page.locator("#inviteFaceButton").click(); }, expect: ["Couldn't open Piggy"], retry: retryOpen }],
    ["unlock-failed", { world: W("at5"),
      trigger: async (p) => { await toSend(p); await p.page.goto("about:blank"); await p.page.goto(BASE, { waitUntil: "networkidle" }); await until(p, "lock", (s) => s.scene === "birth", 20_000); await p.passkey.cdp.send("WebAuthn.clearCredentials", { authenticatorId: p.passkey.authenticatorId }); await click(p, "#loginChogButton", "lock Chog"); },
      expect: ["Couldn't open Piggy"], retry: retryOpen }],
    ["grant-down", { world: W("at6", { grantMode: "down" }), trigger: async (p) => { await toSend(p); }, expect: ["Piggy can't go out yet."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["grant-not-visible", { world: W("at7", { grantMode: "nofund" }), trigger: async (p) => { await toSend(p); }, expect: ["Piggy can't go out yet."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["simulate-too-little", { world: W("at8", { grantMode: "little" }), trigger: async (p) => { await toSend(p); }, expect: ["Piggy can't go out yet."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["broadcast-refused", { world: W("at9"), trigger: async (p) => { await toSend(p); p.world.chain.faults.refuse.add("deposit"); }, expect: ["Piggy could not get ready.", "nothing moved."], retry: (p) => sendAgain(p, "바로 풀림") }],
    // The early grant + card wait (grant settle) means this refusal no longer reaches a person: the first trip finishes.
    ["grant-lag-insufficient", { world: W("at10", { fundLagMs: 20_000 }), trigger: async (p) => { await toSend(p); }, expect: ["came back"], retry: async () => "고쳐짐 — 실패 화면 안 뜸(grant 미리 받기 + 25 s 뒤 카드)" }],
    ["deposit-reverted", { world: W("at11"), trigger: async (p) => { await toSend(p); p.world.chain.faults.revert.add("deposit"); }, expect: ["Piggy could not get ready.", "can't tell yet."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["redeem-refused", { world: W("at12"), trigger: async (p) => { await toSend(p); p.world.chain.faults.refuse.add("redeem"); }, expect: ["Piggy could not get ready.", "still out."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["redeem-reverted", { world: W("at13"), trigger: async (p) => { await toSend(p); p.world.chain.faults.revert.add("redeem"); }, expect: ["couldn't finish this one."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["receipt-missing-reopen", { world: W("at14"), trigger: async (p) => { await toSend(p); p.world.chain.faults.hideReceipts = true; await until(p, "away", (s) => s.scene === "away", 20_000); await sleep(3000); await p.page.goto("about:blank"); await p.page.goto(BASE, { waitUntil: "networkidle" }); if ((await look(p)).scene === "birth") await click(p, "#loginChogButton", "lock Chog"); },
      expect: ["still out"], retry: (p) => retryHomeLive(p, "확인 올 때까지 Away") }],
    ["job-reverted", { world: W("at16"), trigger: async (p) => { await toSend(p); await walkReturnAndFile(p); await enterSecond(p); p.world.forkChain.faults.revert.add("approve");
        await p.page.locator('input[data-errand-id="clean"]').check(); await click(p, "#exploreSaveButton", "explore save"); await click(p, ".secondJourney__pick", "job pick"); await click(p, "#secondOkButton", "job ok");
        await until(p, "Job Send", () => live(p, "#secondSendButton"), 20_000); await p.page.locator("#secondSendButton").click(); await until(p, "Away", (s) => s.scene === "secondAway", 15_000); await until(p, "back home", (s) => s.scene === "sendstay", 90_000); },
      expect: ["still in home"], retry: (p) => retryHomeLive(p, "2차 Job 실패 = 조용히 홈 · 문구 0") }],
    ["two-tabs-send", { world: W("at17"), trigger: async (p) => { await walkFirstJourney(p, { send: false });
        // the record another tab of the same phone writes when it pressed Send first (same storage key and shape)
        await p.page.evaluate(() => localStorage.setItem("araso.sendPending", JSON.stringify({ stage: "reserved", reservationId: "othertab.0001", tabId: "othertab", at: Date.now() })));
        await p.page.locator("#sendButton").click(); },
      expect: ["Confirmation is still catching up."], retry: (p) => sendAgain(p, "바로 풀림") }],
    ["away-second-open", { world: W("at18"), trigger: async (p) => { await toSend(p); p.world.chain.faults.hideReceipts = true; await until(p, "away", (s) => s.scene === "away", 20_000); await sleep(3000);
        await p.page.goto("about:blank"); await p.page.goto(BASE, { waitUntil: "networkidle" }); if ((await look(p)).scene === "birth") await click(p, "#loginChogButton", "lock Chog");
        await until(p, "still out working.", (s) => s.text.some((t) => t.includes("still out working.")), 30_000);
        // leave the app and come back (the phone's app switcher) — the same Away opened a second time
        await p.page.evaluate(() => { const set = (v) => { Object.defineProperty(document, "visibilityState", { value: v, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }; set("hidden"); set("visible"); }); },
      expect: ["not back yet."], retry: (p) => retryHomeLive(p, "확인 올 때까지 Away") }],
    ["signer-expired-send", { world: W("at19"), setup: { clock: true }, trigger: async (p) => { await walkFirstJourney(p, { send: false });
        await p.page.clock.fastForward("05:05"); await sleep(500);
        await p.passkey.cdp.send("WebAuthn.setUserVerified", { authenticatorId: p.passkey.authenticatorId, isUserVerified: false });
        await p.page.locator("#sendButton").click(); },
      expect: ["Couldn't open Piggy", "Face ID was cancelled."], retry: async (p) => { await p.passkey.cdp.send("WebAuthn.setUserVerified", { authenticatorId: p.passkey.authenticatorId, isUserVerified: true }); return `${await retryOpen(p)} — 이번엔 Face ID 승인`; } }],
    ["j2-entry-refused", { world: W("at20"), trigger: async (p) => { p.world.fork.refuseChallenge = 99; await toSend(p); await walkReturnAndFile(p); await sleep(20_000); },
      expect: ["still in home"], retry: async (p) => { const s = await look(p); return s.text.includes("tap me!") ? "tap me 있음" : `안 됨 (조용한 홈 · tap me 0 · fork 입장 요청 ${p.world.requests.filter((r) => r.person === p.id && r.action === "challenge").length}회 거절)`; } }],
    ["balance-read-failed", { world: W("at15"), trigger: async (p) => { await walkFirstJourney(p, { send: false }); p.world.chain.faults.balanceError = true; await p.page.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(2000); await p.page.evaluate(() => document.querySelector("#homePaperMoneyToggle")?.click()); }, expect: ["couldn't read the balance."], retry: async (p) => { await p.page.evaluate(() => document.querySelector("#homePaperMoneyToggle")?.click()); await sleep(800); await p.page.evaluate(() => document.querySelector("#homePaperMoneyToggle")?.click()); await sleep(2500); return (await look(p)).text.some((t) => t.includes("couldn't read the balance.")) ? "안 됨 (읽기 실패 동안)" : "바로 풀림"; } }],
  ];
  // Revert proof: the same lanes without their fault must reach the Receipt (no failure screen).
  if (process.env.ARASO_ATLAS_REVERT === "1") {
    // the four forecast lanes without their fault
    {
      const p = await openPerson(browser, W("revert-one-tab"), "revert-one-tab"); people.push(p);
      await check("atlas revert two-tabs-send: no other tab record → Receipt", async () => { await toSend(p); await until(p, "Receipt", () => live(p, "#returnTap"), 60_000); }); await p.context.close();
      const q = await openPerson(browser, W("revert-signer-ok", {}), "revert-signer-ok", { clock: true }); people.push(q);
      await check("atlas revert signer-expired-send: expired signer + Face ID ok → wakes and reaches Receipt", async () => { await walkFirstJourney(q, { send: false }); await q.page.clock.fastForward("05:05"); await sleep(500); await q.page.locator("#sendButton").click(); await until(q, "Receipt", () => live(q, "#returnTap"), 60_000); }); await q.context.close();
      const r = await openPerson(browser, W("revert-entry-ok"), "revert-entry-ok"); people.push(r);
      await check("atlas revert j2-entry-refused: entry allowed → Explore", async () => { await toSend(r); await walkReturnAndFile(r); await enterSecond(r); }); await r.context.close();
      const t = await openPerson(browser, W("revert-receipt-ok"), "revert-receipt-ok"); people.push(t);
      await check("atlas revert away-second-open: receipts arrive → Return (no Away restore line)", async () => { await toSend(t); await until(t, "Receipt", () => live(t, "#returnTap"), 60_000); }); await t.context.close();
    }
    for (const [id, grantMode] of [["revert-grant-ok", "ok"], ["revert-no-refusal", "ok"]]) {
      const p = await openPerson(browser, W(id, { grantMode }), id); people.push(p);
      await check(`atlas revert ${id}: without the fault the first send reaches the Receipt`, async () => { await toSend(p); await until(p, "Receipt", () => live(p, "#returnTap"), 60_000); });
      await p.context.close();
    }
    return;
  }
  const queue = [...lanes];
  await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) { const [id, o] = queue.shift(); await atlasLane(id, o); } }));
  const out = path.join(ATLAS_DIR, "atlas.json");
  writeFileSync(out, JSON.stringify(atlasRows.map((r) => ({ ...r, events: eventsOfAll(r.id) })), null, 2));
  console.log(`A1264_ATLAS ${atlasRows.filter((r) => r.ok).length}/${atlasRows.length} → ${out}`);
}
function eventsOfAll(id) { for (const w of allWorlds) { const e = eventsOf(w, id); if (e.length) return e; } return []; }

try {
  const only = (process.env.ARASO_REHEARSAL_ONLY || "main,side,faults,desk,stuck,jobfail,unlockwhy,names,jarpiggy").split(",");
  await Promise.all([only.includes("main") && laneMain(), only.includes("side") && laneSide(), only.includes("faults") && laneFaults(), only.includes("desk") && laneDesktop(), only.includes("atlas") && laneAtlas(), only.includes("stuck") && laneStuck(), only.includes("jobfail") && laneJobFail(), only.includes("unlockwhy") && laneUnlockWhy(), only.includes("names") && laneNames(), only.includes("explorewhy") && laneExploreWhy(), only.includes("jarpiggy") && laneJarPiggy(), only.includes("jarpiggy") && laneJarTap()].filter(Boolean));
  await check("public ON: no invite on any request (all people)", () => { for (const w of [main, side, fault1, fault4, faultEst, lag, desk]) publicInviteZero(w, people.map((p) => p.id)); });
  await check("visible copy stays inside the allowlist", () => { for (const p of people) copyClean(p); });
  await check("no uncaught page errors", () => { const all = people.flatMap((p) => p.errors.map((e) => `${p.id}: ${e}`)); assert.equal(all.length, 0, JSON.stringify(all.slice(0, 6))); });
  await check("fault · fork status reenter:true is wired back through entry (source pin, main.js)", () => {
    assert.match(MAIN, /if \(r\.reenter === true\) return \(await a956Enter\(\{ reenter: true \}\)\) === true;/);
  });
  await check("stand-in chain saw no unhandled RPC method", () => {
    const u = [...new Set([main, side, fault1, fault4, faultEst, lag, desk].flatMap((w) => w.chain.unknown))].filter((m) => m !== "eth_fillTransaction");
    assert.deepEqual(u, []);
  });
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`A1264 ${results.length - failed.length} PASS / ${failed.length} FAIL / ${known.length} KNOWN · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`A1264_EVENTS ${JSON.stringify(Object.fromEntries([main, side, fault1, fault4, faultEst, lag, desk].flatMap((w) => [...new Set(w.events.map((e) => e.person))].map((id) => [id, eventsOf(w, id)]))))}`);
console.log(`A1264_SCREENSHOTS=${screenshots.length}`);
console.log(`A1264_SCREENSHOT_DIR=${OUT}`);
process.exit(failed.length ? 1 : 0);
