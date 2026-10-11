// [A-552 Phase 1] node H — REAL browser localStorage + REAL page reload proof for Multi-Piggy.
//   node app/test/multi-piggy-browser-reopen.mjs
//
// Unlike h-multi-piggy-reopen.mjs / multi-piggy-product-reopen.mjs (both node:vm slices with
// an in-memory storage double), this test drives the actual shipped app/src/main.js bundle,
// served by a real Vite dev server, inside a real headless Chrome, using the real
// window.localStorage and real location.reload()/Page.navigate page-lifecycle. No test hooks,
// debug flags, or query bypasses are added to the app. No real WebAuthn ceremony is performed
// anywhere in this file (0 getCredential/createCredential calls) — this is a storage/render
// proof, not a passkey test, so AGENTS.md's production-only passkey rule does not apply.
//
// Method (reused, not reinvented — see phase1/STEP0.md consumed_source list):
//   - CDP client: hand-rolled, dependency-free (Node 24 global fetch + WebSocket), copied and
//     adapted inline from
//     the A544 receipt's tools/cdp.mjs (CDP code origin: A544 receipt; self-contained here
//     per this card's instruction, no new npm deps, no import from the receipts dir).
//   - Fixture seeding: the REAL app/src/piggy-index.js (registerControlledPiggy) and
//     app/src/piggy-registry.js (migrateSinglePiggy/createPiggy/saveRegistry) functions,
//     against a plain in-memory Map storage double (not createMemoryStorage — that helper is
//     explicitly excluded for this phase), then the resulting key/values are written into the
//     REAL browser's window.localStorage via Runtime.evaluate. Same technique as
//     A544's tools/gen-fixtures.mjs.
//   - DOM selectors: reused unchanged from A544's tools/matrix.mjs + list-detail-list.mjs,
//     which already proved these render against the shipped app.
//
// Hard timeout: 90s. Chrome + Vite are always killed in a finally block, even on timeout/throw.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";
import { FORK_MODE_ENV, FORK_MODE_OFF, FORK_MODE_SEED, RUN_SCOPE, forkKey, forkRpcStubCdp } from "./helpers/fork-mode.mjs"; // [A-974] + forkRpcStubCdp // [A-950] fork-profile mode (STALE_TESTS class (a)): + Piggy / "Second done" open only on the fork profile since A-948

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
// [A-638 (reissue of A-637)] Runtime screenshots/results go to a unique per-run OS temp dir.
// This general regression test must never write into historical receipt evidence directories
// (it previously overwrote the A-552 phase1 evidence on every full-suite run).
const OUT_DIR = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a552-mpbr-out-"));
console.log(`output dir (temp, per-run): ${OUT_DIR}`);

const VITE_PORT = 5552;
const CDP_PORT = 9552;
const APP_URL = `http://127.0.0.1:${VITE_PORT}/`;
const HARD_TIMEOUT_MS = 90_000;

// ── bounded pass/fail bookkeeping ──────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const assertions = [];
function checkTrue(label, cond, extra = undefined) {
  const ok = !!cond;
  if (ok) pass += 1;
  else fail += 1;
  assertions.push({ label, ok, ...(extra !== undefined ? { extra } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  return ok;
}
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  return checkTrue(`${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, ok, { got, want });
}

// ── minimal in-memory storage double — used ONLY to stage fixture writes through the real
// product functions before they are copied into the real browser's window.localStorage.
// Not createMemoryStorage() (excluded for this phase), just a plain Map. ────────────────────
function stagingStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// ── fixture: 2 Piggies (Honeybun = first/legacy, unknown valuation; Mochi = Model-A added,
// known $0 birth_unfunded valuation), 4 receipts (1 Honeybun-tagged, 2 Mochi-tagged, 1
// ownerless legacy). Built with the REAL library functions, not hand-typed schema. ──────────
const CHAIN = RUN_SCOPE; // [A-950] the booted chain scope: "monad-fork" (pre-A-950: "monad-testnet") // must match app/src/main.js secondJourneyScope()'s fixed chainId
const AT = "2026-09-23T06:00:00.000Z";
const AT_MS = Date.parse(AT);

function makeAddr(seed) {
  const hex = seed.toString(16).padStart(40, "0");
  return "0x" + hex;
}
const SELF_ADDR = makeAddr(0xa552100);
const MOCHI_ADDR = makeAddr(0xa552200);
const honeybunId = `legacy-${SELF_ADDR.toLowerCase()}`;
const mochiId = `piggy-${MOCHI_ADDR.toLowerCase()}`;

async function buildFixture() {
  // MY PIGGIES index — real registerControlledPiggy() (bindSigner just checks
  // address===signerAddress; no real WebAuthn/crypto needed for that check).
  const idxStorage = stagingStorage();
  const r1 = registerControlledPiggy(idxStorage, CHAIN, {
    id: honeybunId,
    name: "Honeybun",
    address: SELF_ADDR,
    signerAddress: SELF_ADDR,
    locator: { credentialId: Buffer.from("root-cred").toString("base64url") },
    at: AT,
  });
  if (!r1.ok) throw new Error(`registerControlledPiggy(Honeybun) failed: ${r1.reason}`);
  // [A-579 Lane B] sequenced rows only enter via admitSequencedPiggy (it computes modelASalt(n) itself and
  // stores it in the locator); a fixed-address fake provider stands in for WebAuthn here, then the name is set.
  const r2 = await admitSequencedPiggy({
    storage: idxStorage,
    chainId: CHAIN,
    sequence: 1,
    rootCredential: { credentialId: Buffer.from("root-cred").toString("base64url") },
    requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }),
    deriveAddress: () => MOCHI_ADDR,
    now: () => AT,
  });
  if (!r2.ok) throw new Error(`admitSequencedPiggy(Mochi) failed: ${r2.reason}`);
  const r2n = renameIndexedPiggy(idxStorage, CHAIN, { id: mochiId, name: "Mochi" });
  if (!r2n.ok) throw new Error(`renameIndexedPiggy(Mochi) failed: ${r2n.reason}`);
  const indexKey = `araso.myPiggiesIndex.v1.${CHAIN}`;

  // Financial registry — real migrateSinglePiggy() (Honeybun, unknown valuation) then real
  // createPiggy() (Mochi, known $0 birth_unfunded valuation).
  const first = migrateSinglePiggy({ address: SELF_ADDR, name: "Honeybun", createdAt: AT });
  if (!first.piggy) throw new Error("migrateSinglePiggy failed");
  const born = createPiggy({
    piggies: [first.piggy],
    newPiggy: { id: mochiId, name: null, address: MOCHI_ADDR },
    at: AT,
  });
  if (!born.ok) throw new Error(`createPiggy(Mochi) failed: ${born.reason}`);
  checkTrue("fixture: Honeybun valuation is unknown (migrateSinglePiggy, no valuation)", born.piggies[0].valuation === null);
  checkTrue(
    "fixture: Mochi valuation is known $0 birth_unfunded (createPiggy)",
    born.piggies[1].valuation && born.piggies[1].valuation.usd === "0" && born.piggies[1].valuation.source === "birth_unfunded",
  );

  const regStorage = stagingStorage();
  const scope = { accountId: SELF_ADDR, chainId: CHAIN };
  const saved = saveRegistry(regStorage, scope, { piggies: born.piggies });
  if (!saved.saved) throw new Error(`saveRegistry failed: ${saved.error}`);
  const registryKey = piggyRegistryKey(scope);

  // receipts — real persisted-receipt shape (main.js readReceipts()/serializeReceiptRow()):
  // BigInt-parseable string amounts + optional piggyId (present only when a non-empty string).
  function mkReceipt({ piggyId = undefined, at, txHash }) {
    return {
      before: "1000000000000000000",
      after: "900000000000000000",
      gas: "21000",
      sent: "100000000000000000",
      txHash,
      depositTxHash: `${txHash}-dep`,
      redeemTxHash: `${txHash}-red`,
      grantTxHash: `${txHash}-grant`,
      status: "success",
      at,
      ...(piggyId ? { piggyId } : {}),
    };
  }
  const receipts = [
    mkReceipt({ piggyId: honeybunId, at: AT_MS + 60_000, txHash: "0xhoneybun1" }), // index 0
    mkReceipt({ piggyId: mochiId, at: AT_MS + 120_000, txHash: "0xmochi1" }), // index 1
    mkReceipt({ at: AT_MS, txHash: "0xlegacy1" }), // index 2 — ownerless legacy
    mkReceipt({ piggyId: mochiId, at: AT_MS + 180_000, txHash: "0xmochi2" }), // index 3
  ];

  const localStorage = {
    "araso.address": SELF_ADDR,
    "araso.passkey": JSON.stringify({ credentialId: Buffer.from("root-cred").toString("base64url") }),
    "araso.piggyName": "Honeybun",
    "araso.birthPlayed": "1",
    "araso.piggyReceived": "1",
    [forkKey("araso.secondJourneyClosed")]: "1", ...FORK_MODE_SEED, // [A-950] fork-scope key + journey "2" (pre-A-950: "araso.secondJourneyClosed": "1")
 "araso.receipts": JSON.stringify(receipts),
    [indexKey]: idxStorage.getItem(indexKey),
    [registryKey]: regStorage.getItem(registryKey),
  };
  checkTrue(
    "fixture: no secret-like substrings in any seeded value",
    !/privateKey|prfOutput|mnemonic|sessionKey|signingKey/i.test(JSON.stringify(localStorage)),
  );
  return { localStorage, indexKey, registryKey, honeybunId, mochiId, SELF_ADDR, MOCHI_ADDR };
}

// ── dependency-free CDP client (Node 24 global fetch + WebSocket) — adapted inline from
// A544's tools/cdp.mjs (self-contained per this card's instruction). ────────────────────────
async function attach(port) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const bs = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    bs.onopen = res;
    bs.onerror = rej;
  });
  let seq = 1;
  const pending = new Map();
  const eventHandlers = new Map();
  bs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      const hs = eventHandlers.get(msg.method);
      if (hs) hs.forEach((h) => h(msg.params));
    }
  };
  function send(method, params = {}, sessionId) {
    const id = seq++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      bs.send(JSON.stringify(payload));
    });
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await forkRpcStubCdp(send, on, sessionId); // [A-974] fork RPC reads (MY MONEY) + fork entry status answered locally (no-op when A950_FORK_MODE=0). pre-A-974: none
  function on(method, handler) {
    if (!eventHandlers.has(method)) eventHandlers.set(method, []);
    eventHandlers.get(method).push(handler);
  }
  async function navigate(url) {
    const loaded = new Promise((resolve) => on("Page.loadEventFired", resolve));
    await send("Page.navigate", { url }, sessionId);
    await loaded;
  }
  async function evaluate(expression, { awaitPromise = false } = {}) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, sessionId);
    if (r.exceptionDetails) throw new Error("evaluate error: " + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  async function screenshot(filePath) {
    const r = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(filePath, Buffer.from(r.data, "base64"));
  }
  async function close() {
    await send("Target.closeTarget", { targetId });
    bs.close();
  }
  return { navigate, evaluate, screenshot, close };
}

// ── small evaluate wrappers ─────────────────────────────────────────────────────────────────
function mk(c) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const count = (sel) => c.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const click = (sel) =>
    c.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`,
    );
  const clickNth = (sel, i) =>
    c.evaluate(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!el) return false; el.click(); return true; })()`,
    );
  const textOf = (sel) => c.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? null`);
  const attrOf = (sel, attr) =>
    c.evaluate(`document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(attr)}) ?? null`);
  const classListOf = (sel) =>
    c.evaluate(`document.querySelector(${JSON.stringify(sel)})?.className ?? null`);
  const allText = (sel) =>
    c.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent.trim())`);
  const allAttr = (sel, attr) =>
    c.evaluate(
      `[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.getAttribute(${JSON.stringify(attr)}))`,
    );
  const readLocalStorage = () =>
    c.evaluate(`(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })()`);
  // Polling waits — the app's own render/mount timing (RAF settle, async peek-svg fetch,
  // A-540 fold/expand animation) varies run to run under sandboxed CPU scheduling; a fixed
  // sleep that was enough once is not guaranteed enough the next time. Poll instead of
  // guessing a bigger constant.
  async function waitForCount(sel, expected, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    while (Date.now() < deadline) {
      last = await count(sel);
      if (last === expected) return last;
      await wait(100);
    }
    throw new Error(`waitForCount(${sel}) expected ${expected}, last saw ${last}`);
  }
  async function waitForAttr(sel, attr, expected, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await attrOf(sel, attr);
      if (last === expected) return last;
      await wait(100);
    }
    throw new Error(`waitForAttr(${sel}.${attr}) expected ${expected}, last saw ${last}`);
  }
  // Wait for the target to exist, click it EXACTLY ONCE (several of these — #chogHomeHit,
  // #homePaperMoneyToggle — are real toggles: `pinned = !pinned`/mode flip; retrying the
  // click on a slow render would silently undo it), then poll (no more clicking) until the
  // effect shows up in the DOM.
  async function clickAndWaitForCount(sel, targetSel, expected, timeoutMs = 8000) {
    await waitForCount(sel, 1, timeoutMs);
    const clicked = await click(sel);
    if (!clicked) throw new Error(`click(${sel}) returned false immediately after it was found`);
    return waitForCount(targetSel, expected, timeoutMs);
  }
  return {
    wait, count, click, clickNth, textOf, attrOf, classListOf, allText, allAttr, readLocalStorage,
    waitForCount, waitForAttr, clickAndWaitForCount,
  };
}

// ── process lifecycle ───────────────────────────────────────────────────────────────────────
let viteProc = null;
let chromeProc = null;
let profileDir = null;

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return true;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr?.message ?? "no response"}`);
}

async function startVite() {
  // Invoke the local vite binary directly (not `npx vite`) — npx can leave the actual vite
  // process as an orphaned grandchild that a plain kill() of the npx wrapper never reaches
  // (observed: a `node .../vite --port 5552` process survived cleanup() and kept the port
  // held for the next run). This is the exact binary `npm run dev`/`npx vite` resolve to.
  const viteBin = path.join(REPO_ROOT, "node_modules/.bin/vite");
  viteProc = spawn(
    viteBin,
    ["--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: APP_DIR, env: { ...process.env, ...FORK_MODE_ENV } /* [A-950] fork env */, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  viteProc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  viteProc.on("error", (err) => {
    throw new Error(`vite spawn error: ${err.message}`);
  });
  try {
    await waitForHttp(APP_URL, 20_000);
  } catch (err) {
    throw new Error(`vite dev server did not come up on ${APP_URL}: ${err.message}\nstderr: ${stderr}`);
  }
}

function startChrome() {
  profileDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "a552-chrome-"));
  const chromeBin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  chromeProc = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  chromeProc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  chromeProc.on("error", (err) => {
    throw new Error(`chrome spawn error: ${err.message}`);
  });
  chromeProc._stderrRef = () => stderr;
  return chromeProc;
}

async function waitForCdp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return true;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `timed out waiting for Chrome CDP on 127.0.0.1:${CDP_PORT}: ${lastErr?.message ?? "no response"}` +
      (chromeProc?._stderrRef ? `\nchrome stderr: ${chromeProc._stderrRef()}` : ""),
  );
}

function cleanup() {
  try {
    if (chromeProc && !chromeProc.killed) chromeProc.kill("SIGKILL");
  } catch {
    /* best effort */
  }
  try {
    if (viteProc && !viteProc.killed) viteProc.kill("SIGKILL");
  } catch {
    /* best effort */
  }
  try {
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const fx = await buildFixture();

  await startVite();
  startChrome();
  await waitForCdp(20_000);
  const c = await attach(CDP_PORT);
  const h = mk(c);

  const homeCounts = []; // per-cycle DOM snapshot for cross-reload comparison
  const localStorageSnapshots = [];

  // ── seed once via real localStorage.setItem calls (not a debug bypass — this is the
  // browser's real Web Storage API, exactly how a real device would have this data after
  // real product flows ran) ──────────────────────────────────────────────────────────────
  await c.navigate(APP_URL);
  await c.evaluate(`(() => {
    localStorage.clear();
    const kv = ${JSON.stringify(fx.localStorage)};
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    return true;
  })()`);

  // ═══ 1) 2+ Piggies appear in the existing Home model; no new Village/picker/page ═══════════
  await c.navigate(APP_URL);
  await h.waitForCount("#chogHomeHit", 1);
  await h.clickAndWaitForCount("#chogHomeHit", ".homePaper__card--piggy", 2);
  await c.screenshot(path.join(OUT_DIR, "1_home_initial.png"));

  const initial = {
    paperMode: await h.attrOf(".homePaper", "data-paper-mode"),
    residentCount: await h.count(".homePaper__card--piggy"),
    residentIds: await h.allAttr(".homePaper__card--piggy", "data-piggy-id"),
    residentNames: await h.allText(".homePaper__card--piggy .homePaper__name"),
    villageLikeCount: await c.evaluate(
      `[...document.querySelectorAll('*')].filter(e => /village|picker/i.test((e.className||'')+' '+(e.id||''))).length`,
    ),
    plusPiggyTabCount: await h.count(".homePlusPiggyTab"),
  };
  homeCounts.push(initial);

  check("1. paper is in home mode", initial.paperMode, "home");
  check("1. 2 resident cards rendered", initial.residentCount, 2);
  check("1. resident ids in index order (Honeybun then Mochi)", initial.residentIds, [fx.honeybunId, fx.mochiId]);
  check("1. resident names in index order", initial.residentNames, ["Honeybun", "Mochi"]);
  checkTrue("1. no Village/picker-named element anywhere in the rendered DOM", initial.villageLikeCount === 0);
  checkTrue("1. + Piggy affordance exists but is not a new page/screen (same .homePaper shell, no navigation)", initial.plusPiggyTabCount >= 1);

  const lsAfterFirstBoot = await h.readLocalStorage();
  localStorageSnapshots.push({ label: "initial", keys: Object.keys(lsAfterFirstBoot).sort() });

  // ═══ 2) reload cycle 1 — real location.reload() (same profile, same origin) ═══════════════
  await c.evaluate(`location.reload()`);
  await h.waitForCount("#chogHomeHit", 1);
  await h.clickAndWaitForCount("#chogHomeHit", ".homePaper__card--piggy", 2);
  await c.screenshot(path.join(OUT_DIR, "2_home_reload1.png"));
  const reload1 = {
    paperMode: await h.attrOf(".homePaper", "data-paper-mode"),
    residentCount: await h.count(".homePaper__card--piggy"),
    residentIds: await h.allAttr(".homePaper__card--piggy", "data-piggy-id"),
    residentNames: await h.allText(".homePaper__card--piggy .homePaper__name"),
  };
  homeCounts.push(reload1);
  check("2. reload#1 — same resident count", reload1.residentCount, initial.residentCount);
  check("2. reload#1 — same resident id order", reload1.residentIds, initial.residentIds);
  check("2. reload#1 — same resident name order", reload1.residentNames, initial.residentNames);
  const lsAfterReload1 = await h.readLocalStorage();
  check(
    "2. reload#1 — MY PIGGIES index key byte-identical across reload",
    lsAfterReload1[fx.indexKey],
    fx.localStorage[fx.indexKey],
  );
  check(
    "2. reload#1 — financial registry key byte-identical across reload",
    lsAfterReload1[fx.registryKey],
    fx.localStorage[fx.registryKey],
  );

  // ═══ 2) reload cycle 2 — a second, independent real reload (Page.navigate, same profile) ══
  await c.navigate(APP_URL);
  await h.waitForCount("#chogHomeHit", 1);
  await h.clickAndWaitForCount("#chogHomeHit", ".homePaper__card--piggy", 2);
  await c.screenshot(path.join(OUT_DIR, "3_home_reload2.png"));
  const reload2 = {
    paperMode: await h.attrOf(".homePaper", "data-paper-mode"),
    residentCount: await h.count(".homePaper__card--piggy"),
    residentIds: await h.allAttr(".homePaper__card--piggy", "data-piggy-id"),
    residentNames: await h.allText(".homePaper__card--piggy .homePaper__name"),
  };
  homeCounts.push(reload2);
  check("2. reload#2 — same resident count", reload2.residentCount, initial.residentCount);
  check("2. reload#2 — same resident id order", reload2.residentIds, initial.residentIds);
  check("2. reload#2 — same resident name order", reload2.residentNames, initial.residentNames);
  const lsAfterReload2 = await h.readLocalStorage();
  check("2. reload#2 — same set of localStorage keys as initial boot", Object.keys(lsAfterReload2).sort(), localStorageSnapshots[0].keys);

  // ═══ 3) known $0 vs unknown valuation, from rendered MY MONEY text ═════════════════════════
  await h.clickAndWaitForCount("#homePaperMoneyToggle", '[id^="homeMoneyPiggyRow--"]', 2);
  await h.waitForAttr(".homePaper", "data-paper-mode", "money");
  await c.screenshot(path.join(OUT_DIR, "4_my_money.png"));
  const honeybunAmountText = await h.textOf(`#homeMoneyPiggyRow--${fx.honeybunId} .homePaper__amount`);
  const honeybunAmountClass = await h.classListOf(`#homeMoneyPiggyRow--${fx.honeybunId} .homePaper__amount`);
  const mochiAmountText = await h.textOf(`#homeMoneyPiggyRow--${fx.mochiId} .homePaper__amount`);
  const mochiAmountClass = await h.classListOf(`#homeMoneyPiggyRow--${fx.mochiId} .homePaper__amount`);
  check("3. Honeybun (unknown valuation) renders the literal word 'unknown'", honeybunAmountText, "unknown");
  checkTrue("3. Honeybun's amount carries the --unknown class (not a fabricated $0)", (honeybunAmountClass || "").includes("homePaper__amount--unknown"));
  check("3. Mochi (birth_unfunded) renders known '$0'", mochiAmountText, "$0");
  checkTrue("3. Mochi's amount does NOT carry the --unknown class (it is a known value)", !(mochiAmountClass || "").includes("homePaper__amount--unknown"));
  const totalRowCount = await h.count('[id^="homeMoneyPiggyRow--"]');
  check("3. exactly 2 clickable Piggy money rows (no phantom rows)", totalRowCount, 2);
  const totalLineCount = await c.evaluate(`[...document.querySelectorAll('.homePaper__row')].filter(e => e.textContent.includes('total')).length`);
  checkTrue("3. no fabricated 'total' row (one Piggy's valuation is unknown)", totalLineCount === 0);

  // back to home
  await h.clickAndWaitForCount("#homePaperMoneyToggle", ".homePaper__card--piggy", 2);

  // ═══ 4) each Piggy opens the existing RIGHT HISTORY with its own masthead + own rows ═══════
  // ═══ 5) ownerless legacy receipt appears in neither Piggy-specific history ═════════════════
  // [A-974] HISTORY rows are the legacy testnet receipts (main.js:393 state.receipts, LEGACY_TESTNET_PATH): the fork never reads them by design, so
  // steps 4/5 (per-Piggy rows) run in the forkMode-off run (A950_FORK_MODE=0); on the fork each Piggy's HISTORY is checked as the empty state.
  // pre-A-974 baseline: steps 4/5 ran unconditionally (they stopped the fork run here: A-950 multi-piggy row).
  let honeybunHistory = null, mochiHistory = null;
  if (!FORK_MODE_OFF) {
    for (const [id, nm] of [[fx.honeybunId, "Honeybun"], [fx.mochiId, "Mochi"]]) {
      await h.clickAndWaitForCount(`.homePaper__records[data-piggy-id="${id}"]`, ".recordsCard__empty", 1);
      check(`4 (fork). ${nm}'s HISTORY masthead + empty state, 0 rows`, [await h.textOf(".recordsCard__identityName"), await h.count(".recordsCard__row")], [nm, 0]);
      await h.clickAndWaitForCount("#recordsCardClose", "#recordsCardAnchor:not([hidden])", 0);
    }
  } else {
  await h.clickAndWaitForCount(`.homePaper__records[data-piggy-id="${fx.honeybunId}"]`, ".recordsCard__row", 1);
  await c.screenshot(path.join(OUT_DIR, "5_honeybun_history.png"));
  honeybunHistory = {
    identity: await h.textOf(".recordsCard__identityName"),
    caption: await h.textOf(".recordsCard__caption"),
    anchorCount: await h.count("#recordsCardAnchor"),
    rowCount: await h.count(".recordsCard__row"),
    rowIndices: await h.allAttr(".recordsCard__row", "data-receipt-index"),
  };
  check("4. Honeybun's HISTORY masthead shows 'Honeybun'", honeybunHistory.identity, "Honeybun");
  check("4. Honeybun's HISTORY shows exactly 1 row (its own tagged receipt)", honeybunHistory.rowCount, 1);
  check("4. Honeybun's HISTORY row is the original index 0 receipt", honeybunHistory.rowIndices, ["0"]);
  checkTrue("5. Honeybun's HISTORY does not include the ownerless row (index 2)", !honeybunHistory.rowIndices.includes("2"));
  checkTrue("5. Honeybun's HISTORY does not include any Mochi row (index 1 or 3)", !honeybunHistory.rowIndices.includes("1") && !honeybunHistory.rowIndices.includes("3"));

  await h.clickAndWaitForCount("#recordsCardClose", "#recordsCardAnchor:not([hidden])", 0);

  await h.clickAndWaitForCount(`.homePaper__records[data-piggy-id="${fx.mochiId}"]`, ".recordsCard__row", 2);
  await c.screenshot(path.join(OUT_DIR, "6_mochi_history.png"));
  mochiHistory = {
    identity: await h.textOf(".recordsCard__identityName"),
    caption: await h.textOf(".recordsCard__caption"),
    anchorCount: await h.count("#recordsCardAnchor"),
    rowCount: await h.count(".recordsCard__row"),
    rowIndices: await h.allAttr(".recordsCard__row", "data-receipt-index"),
  };
  check("4. Mochi's HISTORY masthead shows 'Mochi'", mochiHistory.identity, "Mochi");
  check("4. Mochi's HISTORY shows exactly 2 rows (its own tagged receipts)", mochiHistory.rowCount, 2);
  check("4. Mochi's HISTORY rows are the original index 1 and 3 receipts", [...mochiHistory.rowIndices].sort(), ["1", "3"]);
  checkTrue("5. Mochi's HISTORY does not include the ownerless row (index 2)", !mochiHistory.rowIndices.includes("2"));
  checkTrue("5. Mochi's HISTORY does not include Honeybun's row (index 0)", !mochiHistory.rowIndices.includes("0"));
  checkTrue("4/5. Honeybun's and Mochi's HISTORY row sets are disjoint", !honeybunHistory.rowIndices.some((i) => mochiHistory.rowIndices.includes(i)));

  await h.clickAndWaitForCount("#recordsCardClose", "#recordsCardAnchor:not([hidden])", 0);
  } // [A-974] end off-mode steps 4/5

  // ═══ Gate B territory — cleared localStorage, same real browser/profile. NOT a fresh device,
  // but the narrowest thing this sandbox can exercise for "no local data at all". Reported,
  // never counted toward H, per A-552 card + A-551 audit's fresh-device boundary. ═══════════
  await c.evaluate(`(() => { localStorage.clear(); return true; })()`);
  await c.navigate(APP_URL);
  await h.wait(500);
  const gateB = {
    scene_indicator_homePaperExists: await h.count(".homePaper"),
    scene_indicator_chogHomeHitExists: await h.count("#chogHomeHit"),
    localStorageKeyCount: await c.evaluate(`localStorage.length`),
    bodyFirstButtons: await c.evaluate(`[...document.querySelectorAll('button')].slice(0, 5).map(b => b.id || b.className)`),
  };
  await c.screenshot(path.join(OUT_DIR, "7_gate_b_cleared_storage.png"));
  console.log("\n--- Gate B territory (cleared localStorage / no local data) — NOT_PROVEN, not counted toward H ---");
  console.log(JSON.stringify(gateB, null, 2));

  await c.close();

  const evidence = {
    cardId: "A-552",
    phase: "phase1",
    generatedAt: new Date().toISOString(),
    fixture: {
      honeybunId: fx.honeybunId,
      mochiId: fx.mochiId,
      selfAddress: fx.SELF_ADDR,
      mochiAddress: fx.MOCHI_ADDR,
      indexKey: fx.indexKey,
      registryKey: fx.registryKey,
    },
    homeCycles: homeCounts,
    localStorageSnapshots,
    myMoney: { honeybunAmountText, honeybunAmountClass, mochiAmountText, mochiAmountClass, totalRowCount, totalLineCount },
    honeybunHistory,
    mochiHistory,
    gateB_NOT_PROVEN: gateB,
    assertions,
    summary: { pass, fail },
  };
  writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(evidence, null, 2));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
  if (fail > 0) process.exitCode = 1;
}

const timeout = setTimeout(() => {
  console.error(`FAIL  hard timeout after ${HARD_TIMEOUT_MS}ms — killing chrome/vite and exiting non-zero`);
  cleanup();
  process.exit(1);
}, HARD_TIMEOUT_MS);
timeout.unref?.();

try {
  await main();
} catch (err) {
  console.error("FAIL  uncaught error:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  cleanup();
}
// The CDP WebSocket / child-process pipes can leave a dangling handle even after cleanup()
// kills chrome+vite (observed: the process otherwise never returns to the shell). Exit
// explicitly rather than relying on the event loop draining naturally.
process.exit(process.exitCode || 0);
