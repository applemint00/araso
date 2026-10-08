// [A-644 slice 1] Post-Second selected-Piggy control depth + MY MONEY real-pointer rows.
//   node app/test/a644-third-settings.mjs
//
// Part N (node, always): piggy-control-mode.js store contract (default / isolation / fail-closed /
//   closed non-secret shape), home-paper.js markup (row pointer-events + visible --on, 3-option
//   selector), main.js source contracts (Second gate, settings click writes only the store).
// Part B (real browser, default ON): Playwright headless Chromium + CDP virtual authenticator on a
//   local Vite dev server (127.0.0.1, rpId localhost — same harness as A-644 Lane U / A-624 sj_flow).
//   Every MY MONEY row / selector / close / stamp activation is a REAL mouse click at a point where
//   elementFromPoint hits the element (page.mouse.click), never element.click().
//   Card PHASE 3 scenarios 1–8. tx 0 (eth_send* / grant POST are aborted and counted).
//   Env: A644_BASE_URL=http://localhost:5665/ reuses a running server (else this spawns one on
//        127.0.0.1:5665 and kills it); A644_WIDTHS=390 (comma list); A644_SHOTS=<dir> saves PNGs;
//        A644_NODE_ONLY=1 skips Part B (prints SKIP; not a PASS).
// On the pre-A-644 tree piggy-control-mode.js does not exist → Part N fails → exit 1.
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const MODE_SRC_PATH = path.join(REPO, "app/src/piggy-control-mode.js");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`함수 없음: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`함수 끝 없음: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const FORBIDDEN_FIELD = /secret|prf|private|session|permission|token|signer|signature|auth|credential|nonce|tx|hash|amount|grant|intent/i;

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════
let CM = null;
let HP = null;
await check("N0 piggy-control-mode.js exists and imports (pre-A-644: absent)", async () => {
  CM = await import("../src/piggy-control-mode.js");
  HP = await import("../src/home-paper.js");
});

if (CM) {
  const HB = { chainId: "monad-testnet", accountId: "0x1111111111111111111111111111111111111111", piggyId: "legacy-0x1111111111111111111111111111111111111111" };
  const MO = { ...HB, piggyId: "piggy-0x2222222222222222222222222222222222222222" };

  await check("N1 semantic values + exact Owner labels, closed 3-value set, default ask_me", () => {
    assert.deepEqual(CM.CONTROL_MODE_OPTIONS.map((o) => [o.value, o.label]), [
      ["piggy_decides", "Piggy decides"], ["ask_me", "Ask me"], ["ill_manage", "I'll manage"],
    ]);
    assert.equal(CM.DEFAULT_CONTROL_MODE, "ask_me");
    for (const bad of ["", "Ask me", "ASK_ME", "auto", null, undefined, 1, {}]) assert.equal(CM.isControlMode(bad), false);
  });

  await check("N2 key = araso.piggyControlMode.<chainId>.<accountId>.<piggyId>; bad scope → no key", () => {
    assert.equal(CM.piggyControlModeKey(HB), `araso.piggyControlMode.monad-testnet.${HB.accountId}.${HB.piggyId}`);
    assert.equal(CM.piggyControlModeKey({ ...HB, piggyId: "" }), null);
    assert.equal(CM.piggyControlModeKey({ ...HB, accountId: "" }), null);
    assert.equal(CM.piggyControlModeKey({ ...HB, piggyId: "a.b" }), null, "no dot injection into the key");
  });

  await check("N3 missing → default; save/load round trip; per-Piggy isolation (Honeybun change leaves Mochi)", () => {
    const s = memStorage();
    assert.deepEqual(CM.loadControlMode(s, HB), { mode: "ask_me", error: null });
    assert.equal(CM.saveControlMode(s, HB, "ill_manage", { at: "2026-09-29T00:00:00.000Z" }).saved, true);
    assert.equal(CM.loadControlMode(s, HB).mode, "ill_manage");
    assert.equal(CM.loadControlMode(s, MO).mode, "ask_me", "Mochi untouched → default");
    CM.saveControlMode(s, MO, "piggy_decides");
    CM.saveControlMode(s, HB, "ask_me");
    assert.equal(CM.loadControlMode(s, MO).mode, "piggy_decides", "Mochi keeps its own");
    assert.equal(s._m.size, 2, "one key per Piggy");
  });

  await check("N4 fail-closed on read: corrupt / version / unknown mode / extra field / secret-like / scope mismatch → default", () => {
    const s = memStorage();
    const key = CM.piggyControlModeKey(HB);
    const good = { version: 1, chainId: HB.chainId, accountId: HB.accountId, piggyId: HB.piggyId, mode: "ill_manage", updatedAt: "x" };
    const cases = {
      corrupt: "{not json",
      version_mismatch: JSON.stringify({ ...good, version: 2 }),
      unknown_mode: JSON.stringify({ ...good, mode: "auto_execute" }),
      unknown_field: JSON.stringify({ ...good, permission: true }),
      secret_like_field: JSON.stringify({ ...good, prfOutput: "00" }),
      scope_mismatch: JSON.stringify({ ...good, piggyId: MO.piggyId }),
    };
    for (const [err, raw] of Object.entries(cases)) {
      s.setItem(key, raw);
      const got = CM.loadControlMode(s, HB);
      assert.equal(got.mode, "ask_me", err);
      assert.equal(got.error, err === "unknown_field" ? "unknown_field" : err, err);
    }
    s.setItem(key, "[]");
    assert.equal(CM.loadControlMode(s, HB).mode, "ask_me");
    const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.equal(CM.loadControlMode(throwing, HB).mode, "ask_me");
    assert.equal(CM.saveControlMode(throwing, HB, "ill_manage").saved, false);
  });

  await check("N5 save: unknown mode / bad scope write nothing; written record = closed 6-field non-secret shape", () => {
    const s = memStorage();
    assert.equal(CM.saveControlMode(s, HB, "auto").saved, false);
    assert.equal(CM.saveControlMode(s, { ...HB, piggyId: "" }, "ask_me").saved, false);
    assert.equal(s._m.size, 0);
    CM.saveControlMode(s, HB, "piggy_decides");
    const rec = JSON.parse([...s._m.values()][0]);
    assert.deepEqual(Object.keys(rec).sort(), ["accountId", "chainId", "mode", "piggyId", "updatedAt", "version"]);
    for (const k of Object.keys(rec)) assert.equal(FORBIDDEN_FIELD.test(k), false, `field ${k}`);
  });

  await check("N6 module source: imports only piggy-registry.js; no signer/permission/tx/funding/Job/WebAuthn/network", () => {
    const src = stripComments(readFileSync(MODE_SRC_PATH, "utf8"));
    assert.deepEqual([...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]), ["./piggy-registry.js"]);
    for (const bad of ["credentials", "fetch(", "requestPrf", "Signing", "signer", "permission", "sendTransaction", "grant", "funding", "Job", "setTimeout", "setInterval"]) {
      assert.equal(src.includes(bad), false, bad);
    }
  });

  await check("N7 home-paper: tappable MY MONEY row carries pointer-events:auto; selected row = --on + aria-current + gold; others not", () => {
    const rows = HP.homeMoneyPiggyRows({ piggies: [{ id: "a", name: "Honeybun" }, { id: "b", name: "Mochi" }], selectedPiggyId: "b" });
    const html = HP.homeMoneyMarkup({ title: "MY MONEY", rows });
    const btns = html.match(/<button class="homePaper__row homePaper__row--tap[^>]*>/g);
    assert.equal(btns.length, 2);
    for (const b of btns) assert.ok(b.includes('style="pointer-events:auto"'), b);
    const on = btns.filter((b) => b.includes("homePaper__row--on"));
    assert.equal(on.length, 1);
    assert.ok(on[0].includes('id="homeMoneyPiggyRow--b"') && on[0].includes('aria-current="true"'));
    assert.ok(/homeMoneyPiggyRow--b[\s\S]*?<span class="homePaper__rowLabel" style="color:var\(--gold\)">Mochi</.test(html));
    // label + (unknown) amount of the selected row only — the same two spans the hover/focus rule colors
    assert.equal((html.match(/color:var\(--gold\)/g) || []).length, 2);
    assert.equal(/homeMoneyPiggyRow--a[\s\S]*?color:var\(--gold\)[\s\S]*?homeMoneyPiggyRow--b/.test(html), false, "unselected row uncolored");
  });

  await check("N7b selected row with a known amount colors label + amount (same two spans as the hover rule)", () => {
    const rows = HP.homeMoneyPiggyRows({ piggies: [{ id: "a", name: "Honeybun", valuation: { usd: "3" } }], selectedPiggyId: "a" });
    const html = HP.homeMoneyMarkup({ rows });
    assert.equal((html.match(/style="color:var\(--gold\)"/g) || []).length, 2);
    assert.ok(html.includes('<span style="color:var(--gold)" class="homePaper__amount">$3</span>'));
  });

  await check("N8 selector markup = .homePaper__choices + 3 .homePaper__records, exact labels, --on only on the selected", () => {
    const html = HP.controlModeChoicesMarkup(CM.CONTROL_MODE_OPTIONS, { selected: "ask_me", piggyId: "a" });
    assert.ok(html.startsWith('<div class="homePaper__choices homePaper__choices--control" data-control-piggy-id="a"'));
    const btns = [...html.matchAll(/<button class="(homePaper__records[^"]*)" id="homeControlMode--([a-z_]+)"[^>]*>([^<]*)<\/button>/g)];
    assert.deepEqual(btns.map((m) => [m[2], m[3]]), [["piggy_decides", "Piggy decides"], ["ask_me", "Ask me"], ["ill_manage", "I'll manage"]]);
    assert.deepEqual(btns.map((m) => m[1]), ["homePaper__records", "homePaper__records homePaper__records--on", "homePaper__records"]);
    assert.equal(html.includes("data-piggy-id"), false, "must not look like a resident records entry");
  });
}

await check("N9 main.js: selector only when secondJourneyCompletedOnce === true + sendstay + a selected Piggy", () => {
  const body = stripComments(fnBody("controlModePiggyId"));
  assert.ok(body.includes('if (state.secondJourneyCompletedOnce !== true || state.scene !== "sendstay") return null;'));
  assert.ok(body.includes('state.homePaperMode === "money" && piggies.length > 1) return myMoneySelectedPiggyId(piggies)'));
  assert.ok(body.includes('state.homePaperMode === "piggyDetail" && piggies.length === 1) return piggies[0].id'));
  const sel = stripComments(fnBody("myMoneySelectedPiggyId"));
  assert.ok(sel.includes("state.selectedPiggy?.id !== id"), "row-tap selection (history + selectedPiggy same id)");
  const once = [...MAIN.matchAll(/state\.secondJourneyCompletedOnce = true/g)].length;
  assert.equal(once, 1);
  assert.ok(MAIN.includes("if (persistNow) state.secondJourneyCompletedOnce = true;"), "only a confirmed (outcome done) Second unlocks");
  assert.ok(MAIN.includes('secondJourneyCompletedOnce: localStorage.getItem(SECOND_JOURNEY_CLOSED_KEY) === "1"'), "reload reads the same persisted gate");
});

await check("N10 main.js settings click writes only the preference store (signer 0 / permission 0 / tx 0 / funding 0 / Job 0)", () => {
  const h = stripComments(fnBody("handleHomePaperMountClick"));
  const a = h.indexOf("const controlModeButton");
  const b = h.indexOf("return;", a);
  assert.ok(a > 0 && b > a);
  const branch = h.slice(a, b);
  for (const bad of ["requestPrf", "activateSigningSession", "requestMoneyPermission", "applyPiggySelection", "consumeMoneyPermission", "moneyIntent", "selectedPiggy =", "historyPiggyId =", "funding", "Funding", "sendTransaction", "requestGrant", "credentials", "render()", "openSecondJourneyExplore", "runSecondJourney", "fetch("]) {
    assert.equal(branch.includes(bad), false, bad);
  }
  assert.ok(branch.includes("saveControlMode(safeLocalStorage(), controlModeScope(piggyId), mode)"));
  assert.ok(branch.includes("refreshHomePaperMount()"));
  const mk = stripComments(fnBody("controlModeMarkupFor"));
  assert.ok(!/save|setItem|permission|signer/i.test(mk), "render path only reads");
});

// ═══ Part B — real browser ═════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEIGHT = { 390: 844, 430: 932, 700: 900, 1440: 900 };
const INIT = `(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials;
  if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`;
const NODE_ONLY = process.env.A644_NODE_ONLY === "1";
if (NODE_ONLY) {
  console.log("SKIP  Part B (A644_NODE_ONLY=1) — browser scenarios not run");
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
  let BASE = process.env.A644_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", "5665", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = "http://localhost:5665/";
  }
  const widths = (process.env.A644_WIDTHS || "390").split(",").map(Number);
  const shots = process.env.A644_SHOTS || "";
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

  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a644_w${w}_${name}.png`) }); };
  const scene = () => p.evaluate(() => { const s = document.querySelector("[data-scene]"); const v = s?.dataset.scene ?? null; return v === "return" && s.querySelector(".secondJourney__mockTag") ? "secondReturn" : v; });
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  // REAL pointer: find a point where elementFromPoint lands on the element, then page.mouse.click.
  const realClick = async (sel, idx = 0) => {
    const r = await p.evaluate(([s, i]) => {
      const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
      for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
        const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
      }
      return null;
    }, [sel, idx]);
    if (!r) return "unreachable";
    await p.mouse.click(r.x, r.y);
    return "pointer";
  };
  // retries only wait out open/close transitions; every attempt is still a real pointer click.
  const mustTap = async (sel, label, idx = 0) => {
    for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); }
    throw new Error(`${label}: ${sel} not pointer-reachable`);
  };
  const paperMode = () => p.evaluate(() => document.querySelector("#homePaper")?.dataset.paperMode ?? null);
  const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
  const openHomePaper = async () => { for (let i = 0; i < 4; i += 1) { if (await paperOpen()) return true; if (!(await p.locator("#chogHomeHit").count())) return false; await p.locator("#chogHomeHit").click({ force: true }); await sleep(1500); } return paperOpen(); };
  const recOpen = () => p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); return !!a && !a.hidden && a.getBoundingClientRect().width > 1; });
  const identity = () => p.evaluate(() => document.querySelector(".recordsCard__identityName")?.textContent.trim() ?? null);
  const closeRecords = async () => { if (!(await recOpen())) return; await mustTap("#recordsCardClose", "HISTORY close"); await sleep(900); };
  const waitMoneyRead = async () => { for (let i = 0; i < 30; i += 1) { const t = await p.evaluate(() => document.querySelector("#homePaper")?.innerText || ""); if (!/checking/i.test(t)) return; await sleep(500); } };
  const toMoney = async () => { await closeRecords(); await openHomePaper(); await sleep(800); if ((await paperMode()) === "home") { await mustTap("#homePaperMoneyToggle", "stamp"); await sleep(1500); } await waitMoneyRead(); };
  const toHomeFace = async () => { await closeRecords(); if ((await paperMode()) !== "home") { await mustTap("#homePaperMoneyToggle", "stamp back"); await sleep(900); } };
  const selector = () => p.evaluate(() => {
    const box = document.querySelector(".homePaper__choices--control");
    const all = [...document.querySelectorAll('[id^="homeControlMode--"]')];
    return { present: !!box, piggy: box?.dataset.controlPiggyId ?? null, labels: all.map((b) => b.textContent), on: all.filter((b) => b.classList.contains("homePaper__records--on")).map((b) => b.id.split("--")[1]), bodyHasLabels: /Piggy decides|I'll manage/.test(document.body.innerText) };
  });
  const storeModes = () => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("araso.piggyControlMode.")).map((k) => [k.split(".").pop(), JSON.parse(localStorage.getItem(k))])));
  const lsSnapshot = () => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  const unlockIfLocked = async () => { for (let i = 0; i < 3; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
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
  const rowSelectedLook = (id) => p.evaluate((rid) => {
    document.activeElement?.blur?.();
    const el = document.getElementById(rid); if (!el) return null;
    const lab = el.querySelector(".homePaper__rowLabel");
    return { on: el.classList.contains("homePaper__row--on"), current: el.getAttribute("aria-current"), color: lab ? getComputedStyle(lab).color : null, pe: getComputedStyle(el).pointerEvents };
  }, id);
  // one settings tap measured: webauthn 0, tx 0, and localStorage changes ONLY at that Piggy's key.
  const measuredModeTap = async (value) => {
    const before = await lsSnapshot(); const wa0 = await p.evaluate(() => ({ ...window.__wa })); const tx0 = net.tx;
    await mustTap(`#homeControlMode--${value}`, `mode ${value}`); await sleep(500);
    const after = await lsSnapshot(); const wa1 = await p.evaluate(() => ({ ...window.__wa }));
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
    return { changed, webauthn: wa1.get - wa0.get + wa1.create - wa0.create, tx: net.tx - tx0, scene: await scene() };
  };

  try {
    // ── birth + closed First (Lane U harness) ────────────────────────────────────────────────
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
      const addr = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a644f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa644-dep", redeemTxHash: "0xa644-red", grantTxHash: "0xa644-grant", status: "success", at: Date.parse("2026-09-28T00:00:00Z"), piggyId: `legacy-${String(addr).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
    await exploreViaTapMe(); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 9000) (opened by itself)
    await realClick("#stayButton"); await waitScene(["sendstay"], 4000); await sleep(3000);

    // ── S1 Second incomplete ─────────────────────────────────────────────────────────────────
    await check(`B1 ${T} S1 Second incomplete: MY MONEY row REAL tap → Piggy detail, no control-depth selector; +Piggy absent`, async () => {
      assert.equal(await p.evaluate(() => localStorage.getItem("araso.secondJourneyClosed")), null);
      await openHomePaper(); await sleep(800);
      assert.equal(await p.locator(".homePlusPiggyTab").count(), 0, "+Piggy gate unchanged (absent pre-Second)");
      await toMoney();
      assert.equal(await paperMode(), "money");
      const look = await rowSelectedLook("homePaperMoneyRow");
      assert.equal(look.pe, "auto", "row receives pointer (U-1)");
      await mustTap("#homePaperMoneyRow", "single row");
      await sleep(900);
      assert.equal(await paperMode(), "piggyDetail", "real pointer tap reached the row");
      const s = await selector();
      assert.equal(s.present, false); assert.equal(s.bodyHasLabels, false);
      await shot("S1_preSecond_detail");
    });

    // ── S4 unconfirmed / garbage gate never unlocks ────────────────────────────────────────────
    await check(`B2 ${T} S4 unconfirmed Second (closed key garbage "true") + reload → still no selector, no +Piggy`, async () => {
      await p.evaluate(() => localStorage.setItem("araso.secondJourneyClosed", "true"));
      await forgetIntro(); // [A-891] the Second entry is offered again only through the cue; a completed Second never arms it
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked();
      // [A-895 P-D] pre-A-895 text: "Explore auto-opens again". Since A-891 Explore never auto-opens; it opens only after the Chog tap (exploreViaTapMe).
      // unconfirmed → Explore is offered again through the cue (same as pre-Second), the gate stays locked
      assert.equal(await exploreViaTapMe(), "explore", "Explore is reachable again (cue tap, or this copy of exploreViaTapMe accepts an auto-open) - gate not unlocked"); // [A-891] pre-A-891 baseline: await waitScene(["explore"], 9000)
      if ((await scene()) === "explore") { await realClick("#stayButton"); await waitScene(["sendstay"], 4000); await sleep(2500); }
      await openHomePaper(); await sleep(800);
      assert.equal(await p.locator(".homePlusPiggyTab").count(), 0);
      await toMoney(); await mustTap("#homePaperMoneyRow", "single row"); await sleep(900);
      assert.equal(await paperMode(), "piggyDetail");
      assert.equal((await selector()).present, false);
      await p.evaluate(() => localStorage.removeItem("araso.secondJourneyClosed"));
      await mustTap("#homePiggyDetailBack", "detail back"); await sleep(600);
      await toHomeFace();
    });

    // ── S2 confirmed Second (DEV preview flow, real pointer send/return) ──────────────────────
    await check(`B3 ${T} S2 confirmed Second → quiet Home (no Explore auto-reopen), closed key "1"`, async () => {
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
      assert.equal(await scene(), "sendstay", "quiet Home holds, no Explore auto-reopen");
    });

    // ── S5 one Piggy: MY MONEY → selected Piggy → control mode → HISTORY ─────────────────────
    let honeyId = null;
    await check(`B4 ${T} S5 one Piggy: REAL tap row → detail shows 3 Owner labels, default Ask me; tap I'll manage → stored`, async () => {
      await toMoney();
      await mustTap("#homePaperMoneyRow", "single row"); await sleep(900);
      assert.equal(await paperMode(), "piggyDetail");
      const s = await selector();
      assert.equal(s.present, true);
      assert.deepEqual(s.labels, ["Piggy decides", "Ask me", "I'll manage"]);
      assert.deepEqual(s.on, ["ask_me"], "default ask_me (conservative default)");
      honeyId = s.piggy;
      await shot("S5_1piggy_detail_default");
      const m = await measuredModeTap("ill_manage");
      const addr = await p.evaluate(() => localStorage.getItem("araso.address"));
      assert.deepEqual(m.changed, [`araso.piggyControlMode.monad-testnet.${addr}.${honeyId}`], "only this Piggy's preference key changed");
      assert.equal(m.webauthn, 0, "credentials.get/create 0"); assert.equal(m.tx, 0, "tx 0"); assert.equal(m.scene, "sendstay");
      assert.deepEqual((await selector()).on, ["ill_manage"]);
      const rec = (await storeModes())[honeyId];
      assert.deepEqual(Object.keys(rec).sort(), ["accountId", "chainId", "mode", "piggyId", "updatedAt", "version"]);
      assert.equal(rec.mode, "ill_manage");
      await shot("S5_1piggy_detail_ill_manage");
      await mustTap("#homePiggyDetailBack", "detail back"); await sleep(600);
      await toHomeFace();
      await mustTap("#homeRecordsButton", "HOME records"); await sleep(1400);
      assert.equal(await recOpen(), true);
      assert.equal(await identity(), "Honeybun", "HISTORY = the same (only) Piggy");
      await closeRecords();
    });

    // ── S3 reload keeps unlock + mode ────────────────────────────────────────────────────────
    await check(`B5 ${T} S3 reload → unlock persists; Honeybun still I'll manage`, async () => {
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked(); await sleep(4500);
      assert.equal(await scene(), "sendstay");
      await toMoney(); await mustTap("#homePaperMoneyRow", "single row"); await sleep(900);
      const s = await selector();
      assert.equal(s.present, true); assert.deepEqual(s.on, ["ill_manage"]); assert.equal(s.piggy, honeyId);
      await mustTap("#homePiggyDetailBack", "detail back"); await sleep(600);
      await toHomeFace();
    });

    // ── S7 +Piggy → Mochi, independent default ────────────────────────────────────────────────
    let mochiId = null;
    await check(`B6 ${T} S7 +Piggy (real pointer) → Mochi; MY MONEY 2 rows; REAL tap Mochi row → HISTORY Mochi, selected row visible, own default Ask me`, async () => {
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
      const rows = await p.evaluate(() => [...document.querySelectorAll('[id^="homeMoneyPiggyRow--"]')].map((e) => ({ id: e.id, text: e.textContent.replace(/\s+/g, " ").trim() })));
      assert.equal(rows.length, 2);
      assert.equal((await selector()).present, false, "no selection yet → no selector");
      const mRow = rows.find((r) => r.text.startsWith("Mochi"));
      mochiId = mRow.id.slice("homeMoneyPiggyRow--".length);
      await mustTap(`[id="${mRow.id}"]`, "Mochi row"); await sleep(1600);
      assert.equal(await recOpen(), true); assert.equal(await identity(), "Mochi");
      await shot("S7_mochi_history");
      await closeRecords();
      const look = await rowSelectedLook(mRow.id);
      assert.equal(look.on, true); assert.equal(look.current, "true"); assert.equal(look.color, "rgb(224, 177, 0)", "visible without focus");
      const s = await selector();
      assert.equal(s.present, true); assert.equal(s.piggy, mochiId); assert.deepEqual(s.on, ["ask_me"], "new Piggy = independent default");
      await shot("S7_mochi_selected_mode");
    });

    // ── S6 two Piggies isolation + HISTORY identity ──────────────────────────────────────────
    await check(`B7 ${T} S6 Mochi → Piggy decides leaves Honeybun I'll manage; Honeybun row → HISTORY Honeybun + its own mode`, async () => {
      const m = await measuredModeTap("piggy_decides");
      assert.equal(m.changed.length, 1); assert.ok(m.changed[0].endsWith(`.${mochiId}`));
      assert.equal(m.webauthn, 0); assert.equal(m.tx, 0);
      const modes = await storeModes();
      assert.equal(modes[mochiId].mode, "piggy_decides");
      assert.equal(modes[honeyId]?.mode, "ill_manage", "Honeybun untouched");
      const hRow = await p.evaluate(() => [...document.querySelectorAll('[id^="homeMoneyPiggyRow--"]')].find((e) => e.textContent.trim().startsWith("Honeybun"))?.id);
      assert.equal(hRow, `homeMoneyPiggyRow--${honeyId}`, "same Piggy id in single and multi paths (mode carried)");
      await mustTap(`[id="${hRow}"]`, "Honeybun row"); await sleep(1600);
      assert.equal(await identity(), "Honeybun");
      await closeRecords();
      const s = await selector();
      assert.equal(s.piggy, honeyId); assert.deepEqual(s.on, ["ill_manage"]);
      assert.equal((await rowSelectedLook(`homeMoneyPiggyRow--${mochiId}`)).on, false, "only one selected row");
      await shot("S6_honeybun_selected_mode");
    });

    await check(`B8 ${T} S3/S6 reload with 2 Piggies → both modes persist, HISTORY identity follows the tapped row`, async () => {
      await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked(); await sleep(4500);
      await toMoney();
      for (const [id, want, name] of [[mochiId, "piggy_decides", "Mochi"], [honeyId, "ill_manage", "Honeybun"]]) {
        await mustTap(`[id="homeMoneyPiggyRow--${id}"]`, `${name} row`); await sleep(1600);
        assert.equal(await identity(), name);
        await closeRecords();
        assert.deepEqual((await selector()).on, [want], name);
      }
    });

    // (window.__wa resets per page load; per-tap WebAuthn deltas are asserted in B4/B7.)
    await check(`B9 ${T} S8 whole run: tx 0 (eth_send*/grant POST), pageerror 0, credentials.create 0 since the last reload`, async () => {
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
