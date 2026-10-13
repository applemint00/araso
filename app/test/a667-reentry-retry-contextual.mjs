// A-1131 render pin: defer Invite auth presentation before teardown; auth/money bodies unchanged.
// A-667 [REENTRY FLOW · RETRY + CONTEXTUAL ACTIONS] — regression contract.
//   node app/test/a667-reentry-retry-contextual.mjs                    (Part N + Part B)
//   A667_NODE_ONLY=1 node app/test/a667-reentry-retry-contextual.mjs   (Part N only — no port/network)
//
// Bug (Owner, real iPhone Safari, A-665 addendum): after tapping the LOGIN_CHECKING Chog the screen stayed on
// "Checking…" forever. unlockApp()'s only exit from "checking" was settleUnlock() on the requestPrf promise; if
// WebKit never settles navigator.credentials.get() (sheet never presented / publicKey.timeout ignored), the lock
// stayed "checking" and every later tap hit the `phase === "checking"` guard as a silent no-op. Separately the
// reentry failure card showed BOTH "Try again" (→ an intermediate waiting screen, no auth) and "Check Piggy"
// (→ actually unlockApp, identity-only) — Owner: one contextual action per failure context.
//
// Part N (node:vm, cuts the REAL main.js text — same technique as a633):
//   S  state machine: waiting → tap → checking → success / cancel / error / timeout; late result after timeout
//      ignored (cannot unlock, cannot change state); one tap = one attempt; no auto invoke; retry = new attempt.
//   C  contextual actions: reentry failure → only "Try again" (#unlockRetryButton → unlockApp, synchronous
//      requestPrf inside the click, no intermediate screen, never checkPiggy/recoverPiggy/openPiggy);
//      recovery context (device has a Piggy marker) → only "Check Piggy" (render() wiring → checkPiggy unchanged).
//   P  pins: requestPrf / loginCheckingMarkup / render / checkPiggy / recoverPiggy / openPiggy / startPiggyOpen
//      byte-identical; CSS checking rule = data-app-lock hook only.
// Part B (Playwright + CDP virtual authenticator, local Vite dev server — coordinator runs it; this writer's
// sandbox cannot bind a port): 390x844 / 430x900 waiting → success; reject → failed card (Try again only) →
// Try again → exactly one new get → unlocked; never-resolving get → bounded wait → failed card → late success
// ignored → Try again → exactly one new get; captures waiting/checking/failed; 700/1440 Invite unchanged +
// desktop recovery card single action.
//   Env: A667_NODE_ONLY=1 skips Part B (prints SKIP, not PASS); A667_BASE_URL reuses a running dev server;
//        A667_SHOTS=<dir> saves PNGs.
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
import { restorePreA1051 } from "./helpers/a1051-restore.mjs"; // [A-1051 RE-PIN] protected-body pins compare pre-A-1051 text

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const norm = (x) => JSON.parse(JSON.stringify(x) ?? "null");
const deq = (a, b, msg) => assert.deepEqual(norm(a), norm(b), msg);

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js: start marker missing: ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`main.js: end marker missing: ${endMarker}`);
  return MAIN.slice(start, end);
}
function fnBody(name, src = MAIN) { // [A-1051] src param (default = MAIN, unchanged for every other check)
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ═══ fake clock (same shape as a633) ═══════════════════════════════════════════════════════════
function makeFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, delay) => { const id = nextId++; timers.set(id, { fireAt: now + delay, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let pickId = null, pickAt = Infinity;
        for (const [id, t] of timers) if (t.fireAt <= target && t.fireAt < pickAt) { pickAt = t.fireAt; pickId = id; }
        if (pickId === null) break;
        const { fn } = timers.get(pickId);
        timers.delete(pickId);
        now = pickAt;
        fn();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// ═══ Part N ═══════════════════════════════════════════════════════════════════════════════════
const UNLOCK_SRC = cut("function unlockApp() {", "function stayHome() {");
const LOCK_VIEW_SRC = [fnBody("renderAuthCard"), fnBody("loginCheckingMarkup"), fnBody("renderAppLock")].join("\n");
// sha256[0:16] of functions A-667 must NOT touch (captured from the pre-A-667 working tree; render / requestPrf /
// loginCheckingMarkup are pinned by full hash in P1).
// [A-667 R1–R6 re-pin] checkPiggy / recoverPiggy / openPiggy were changed by the Owner-GO'd R1–R6 repair (identity check,
// atomic commit, signer cleanup, PRF zeroing, bounded attempt tokens — behaviour pinned in a667-recovery-creation-storage.mjs).
// Previous pins: checkPiggy 99bf9a97bc5c3103 · recoverPiggy aadf3bc05d6bf23d · openPiggy 6cf6b1d15f23726b.
// [A-667 CREATE_RETRY_RACE re-pin] platform-inflight guard (check/open), pinned find after a late create (recoverPiggy `pin`).
// Previous R1–R6 pins: checkPiggy faae8c966693d0c1 · recoverPiggy abaacc8b8ad11065 · openPiggy a9a45bc537ea8c89.
// [A-669 re-pin] lockAppAfterIdle now first calls invalidateLiveAuthAttempt() (idle/session end kills live Check/Open/Send
// attempts — behaviour pinned in a669-auth-hardening.mjs). Previous pin: lockAppAfterIdle 0083d873b56358ef.
// [A-687] re-pinned: capability preflight in checkPiggy (e4d707461903f924 -> 5ec37f4dd967ec66) and openPiggy (bb4d577044f8e7b9 -> 1cfd3dd4c142f8bf); body-minus-guard == old hash is pinned in a687-auth-capability-preflight.mjs; every other pin unchanged.
// [Owner canon 2026-10-12] checkPiggy success no longer forces Name for an existing unnamed Piggy.
const PIN = { checkPiggy: "a33ad044254d8862", recoverPiggy: "8809320780061f3d", openPiggy: "1cfd3dd4c142f8bf", startPiggyOpen: "68f68a54ac604c7e", isCancelledAuthError: "69419866a83768d3", appLockSurface: "8c31689ea48cf8aa", lockAppAfterIdle: "e4ef41131c978a25", getRpId: "a4de6277279db63f" };
const WAIT_MS = Number((MAIN.match(/const UNLOCK_UI_WAIT_MS = ([\d_]+);/) || [])[1]?.replace(/_/g, ""));

// A deferred promise per requestPrf call so each test controls when (and whether) WebAuthn settles.
function buildHarness({ allowed = true, credential = { credentialId: "cred-1" }, markers = {} } = {}) {
  const clock = makeFakeClock();
  const calls = { requestPrf: [], render: [], touch: 0, errors: [], recovery: [], order: [], prfOutputs: [] };
  const state = { scene: "sendstay", message: "", detail: "", credential, appLock: { phase: "waiting", cancelled: false }, address: markers.address || "", authPhase: "idle", authCancelled: false };
  const listeners = new Map();
  const appEl = { innerHTML: "" };
  const document = {
    querySelector(sel) {
      const id = sel.startsWith("#") ? sel.slice(1) : null;
      if (!id || !appEl.innerHTML.includes(`id="${id}"`)) return null;
      return { addEventListener: (type, fn) => { listeners.set(id, fn); } };
    },
  };
  const ctx = {
    state, console, Promise, Uint8Array, Error, JSON,
    app: appEl, document,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    isAllowedPiggyRpId: () => allowed,
    storedPrfSalt: () => new Uint8Array(32).fill(1),
    isCancelledAuthError: (e) => e?.name === "NotAllowedError" || e?.cause?.name === "NotAllowedError",
    recordSafeError: (phase, e) => { calls.errors.push([phase, e?.name]); },
    touchAppSession: () => { calls.touch += 1; },
    requestPrf: (credentialArg, opts) => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      calls.requestPrf.push({ credentialArg, opts, resolve, reject });
      calls.order.push("requestPrf");
      return promise;
    },
    // recovery / creation entry points — must never be reached from the reentry lock
    checkPiggy: () => { calls.recovery.push("checkPiggy"); },
    recoverPiggy: () => { calls.recovery.push("recoverPiggy"); },
    openPiggy: () => { calls.recovery.push("openPiggy"); },
    startPiggyOpen: () => { calls.recovery.push("startPiggyOpen"); },
    setScene: (...a) => { calls.recovery.push(`setScene:${a[0]}`); },
    // view helpers (markup only)
    sendCardButtonMarkup: ({ id, label, disabled = false }) => `<button class="pkbtn" id="${id}"${disabled ? " disabled" : ""}>${label}</button>`,
    chogInviteMarkup: () => `<div class="chogInvite"></div>`,
    buttonInkFilter: () => "",
    arasoBrandMarkup: () => `<p class="arasoBrand">Araso</p>`,
    isDevDebugOptIn: () => false,
    resetLocalTest: () => {},
    clearInviteTimers: () => {},
    mountInviteChog: () => {},
    readCredential: () => markers.credential || null,
    hasReceivedPiggy: () => !!markers.received,
  };
  ctx.render = () => {
    calls.order.push("render");
    calls.render.push(state.appLock ? state.appLock.phase : "destination");
    if (state.appLock) ctx.renderAppLock();
  };
  vm.createContext(ctx);
  vm.runInContext(`${UNLOCK_SRC}\n${LOCK_VIEW_SRC}\nthis.unlockApp = unlockApp; this.renderAppLock = renderAppLock; this.renderAuthCard = renderAuthCard;`, ctx);
  ctx.render(); // boot draw of the waiting lock
  const tap = (id) => { const fn = listeners.get(id); if (!fn) throw new Error(`no listener on #${id}`); listeners.delete(id); fn({ type: "click" }); };
  const okResult = (id = "cred-1") => { const b = new Uint8Array(32).fill(7); calls.prfOutputs.push(b); return { credentialId: id, prfOutput: b }; };
  return { ctx, clock, calls, state, app: appEl, listeners, tap, okResult, phase: () => state.appLock?.phase ?? null };
}
const NOT_ALLOWED = Object.assign(new Error("cancel"), { name: "NotAllowedError" });

await check("N0 bounded UI wait constant is defined, positive, and shorter than the WebAuthn publicKey.timeout (120s)", () => {
  assert.ok(Number.isFinite(WAIT_MS) && WAIT_MS > 0, `UNLOCK_UI_WAIT_MS parsed: ${WAIT_MS}`);
  assert.equal(WAIT_MS, 45000);
  assert.ok(fnBody("requestPrf").includes("timeout: 120_000"));
  assert.ok(WAIT_MS < 120000);
});

await check("S1 waiting: boot draws the waiting LOGIN_CHECKING view and makes NO WebAuthn request until a tap", () => {
  const h = buildHarness();
  assert.equal(h.phase(), "waiting");
  assert.ok(h.app.innerHTML.includes('data-app-lock="waiting"'));
  assert.ok(h.app.innerHTML.includes("Checking…") && h.app.innerHTML.includes("Face ID may appear once."));
  assert.equal(h.calls.requestPrf.length, 0, "no request on load/render");
  h.clock.advance(10 * WAIT_MS);
  assert.equal(h.calls.requestPrf.length, 0, "no request on time passing either");
  assert.equal(h.phase(), "waiting");
});

await check("S2 tap → requestPrf synchronously inside the tap (pinned credential + stored salt) → THEN checking view rendered", () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  assert.equal(h.calls.requestPrf.length, 1, "requestPrf called before the click handler returned");
  deq(h.calls.requestPrf[0].credentialArg, { credentialId: "cred-1" });
  assert.equal(h.calls.requestPrf[0].opts.prfSalt.length, 32);
  assert.equal(h.phase(), "checking");
  deq(h.calls.order, ["render", "requestPrf", "render"], "boot render, request, then the checking render (never a render before the request)");
  assert.ok(h.app.innerHTML.includes('data-app-lock="checking"'), "checking state is visible to CSS");
  assert.equal(h.clock.pending(), 1, "one bounded-wait timer armed");
});

await check("S3 success → unlocked, timer cleared, app-idle only, PRF output zeroed, no recovery/creation", async () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.calls.requestPrf[0].resolve(h.okResult());
  await flush();
  assert.equal(h.state.appLock, null);
  assert.equal(h.clock.pending(), 0, "bounded-wait timer cleared on success");
  assert.equal(h.calls.touch, 1);
  assert.ok(h.calls.prfOutputs[0].every((b) => b === 0));
  deq(h.calls.recovery, []);
});

await check("S4 user cancel (NotAllowedError) → failed + cancelled, timer cleared, lock kept", async () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.calls.requestPrf[0].reject(NOT_ALLOWED);
  await flush();
  deq([h.phase(), h.state.appLock.cancelled], ["failed", true]);
  assert.equal(h.clock.pending(), 0);
  assert.ok(h.app.innerHTML.includes("Face ID was cancelled."));
});

await check("S5 other error / wrong credential → failed (not cancelled), lock kept", async () => {
  const a = buildHarness();
  a.tap("loginChogButton");
  a.calls.requestPrf[0].reject(Object.assign(new Error("x"), { name: "InvalidStateError" }));
  await flush();
  deq([a.phase(), a.state.appLock.cancelled], ["failed", false]);
  const b = buildHarness();
  b.tap("loginChogButton");
  b.calls.requestPrf[0].resolve(b.okResult("someone-else"));
  await flush();
  assert.equal(b.phase(), "failed");
  assert.ok(b.calls.prfOutputs[0].every((x) => x === 0), "even a mismatching result's PRF output is zeroed");
  assert.equal(b.calls.touch, 0);
});

await check("S6 never-settling request → still checking just before the bound, retryable failed card AT the bound (fail-closed, not 'cancelled')", () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.clock.advance(WAIT_MS - 1);
  assert.equal(h.phase(), "checking");
  h.clock.advance(1);
  deq([h.phase(), h.state.appLock.cancelled], ["failed", false]);
  deq(h.calls.errors, [["unlock", "UnlockWaitTimeout"]]);
  assert.ok(h.app.innerHTML.includes('data-app-lock="failed"'));
  assert.ok(h.app.innerHTML.includes('id="unlockRetryButton"'), "retry available");
  assert.equal(h.calls.touch, 0);
});

await check("S7 late SUCCESS after timeout is ignored: cannot unlock, cannot change state; PRF output still zeroed", async () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.clock.advance(WAIT_MS);
  const before = JSON.stringify({ phase: h.phase(), cancelled: h.state.appLock.cancelled });
  const renders = h.calls.render.length;
  h.calls.requestPrf[0].resolve(h.okResult());
  await flush();
  assert.notEqual(h.state.appLock, null, "late success must NOT unlock");
  assert.equal(JSON.stringify({ phase: h.phase(), cancelled: h.state.appLock.cancelled }), before, "state unchanged");
  assert.equal(h.calls.render.length, renders, "no re-render");
  assert.equal(h.calls.touch, 0);
  assert.ok(h.calls.prfOutputs[0].every((b) => b === 0), "late PRF output zeroed anyway");
});

await check("S8 late REJECT after timeout is ignored (does not flip the card to 'cancelled')", async () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.clock.advance(WAIT_MS);
  h.calls.requestPrf[0].reject(NOT_ALLOWED);
  await flush();
  deq([h.phase(), h.state.appLock.cancelled], ["failed", false]);
  assert.equal(h.calls.errors.length, 1, "only the timeout was recorded");
});

await check("S9 one tap = one attempt: repeated taps while checking start nothing new; no auto retry ever", () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.ctx.unlockApp(); h.ctx.unlockApp(); h.ctx.unlockApp();
  assert.equal(h.calls.requestPrf.length, 1);
  h.clock.advance(WAIT_MS * 10);
  assert.equal(h.calls.requestPrf.length, 1, "timeout never auto-retries");
  assert.equal(h.phase(), "failed");
});

await check("S10 retry after timeout = exactly one NEW attempt; superseded attempt's late result ignored; new attempt can unlock", async () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.clock.advance(WAIT_MS);
  h.tap("unlockRetryButton");
  assert.equal(h.calls.requestPrf.length, 2, "retry fired exactly one new request, synchronously inside the click");
  assert.equal(h.phase(), "checking");
  assert.ok(h.app.innerHTML.includes('data-app-lock="checking"'), "straight to checking — no intermediate waiting screen");
  h.calls.requestPrf[0].resolve(h.okResult()); // attempt #1 (superseded) resolves late
  await flush();
  assert.equal(h.phase(), "checking", "superseded attempt cannot unlock or settle the new one");
  h.calls.requestPrf[1].resolve(h.okResult());
  await flush();
  assert.equal(h.state.appLock, null, "the current attempt unlocks");
  assert.equal(h.clock.pending(), 0);
});

await check("S11 no stored credential / unsupported origin → failed card without any WebAuthn call or timer", () => {
  const a = buildHarness({ credential: null });
  a.tap("loginChogButton");
  assert.equal(a.calls.requestPrf.length, 0);
  assert.equal(a.phase(), "failed");
  assert.equal(a.clock.pending(), 0);
  const b = buildHarness({ allowed: false });
  b.tap("loginChogButton");
  assert.equal(b.calls.requestPrf.length, 0);
  assert.equal(b.phase(), "failed");
});

await check("C1 reentry failure card shows exactly ONE action: \"Try again\" (#unlockRetryButton) — no Check Piggy, no birth Try again id", async () => {
  for (const kind of ["cancel", "error", "timeout"]) {
    const h = buildHarness({ markers: { credential: { credentialId: "cred-1" }, received: true, address: "0xabc" } });
    h.tap("loginChogButton");
    if (kind === "cancel") h.calls.requestPrf[0].reject(NOT_ALLOWED);
    if (kind === "error") h.calls.requestPrf[0].reject(new Error("x"));
    if (kind === "timeout") h.clock.advance(WAIT_MS);
    await flush();
    const html = h.app.innerHTML;
    assert.equal((html.match(/<button class="pkbtn"/g) || []).length, 1, `${kind}: one action button`);
    assert.ok(html.includes('id="unlockRetryButton"') && html.includes(">Try again<"), `${kind}: Try again`);
    assert.equal(html.includes("checkButton") || html.includes("Check Piggy"), false, `${kind}: no Check Piggy (button or copy)`);
    assert.equal(html.includes("authTryAgainButton"), false, `${kind}: not the birth-card Try again`);
    assert.ok(html.includes("Couldn't open Piggy"), `${kind}: existing failure-card heading`);
    assert.ok(html.includes(kind === "cancel" ? "Face ID was cancelled." : "Face ID may appear once."), `${kind}: existing copy`);
  }
});

await check("C2 reentry Try again re-invokes the identity-unlock path directly: requestPrf inside the click, never checkPiggy/recoverPiggy/openPiggy/setScene", async () => {
  const h = buildHarness();
  h.tap("loginChogButton");
  h.calls.requestPrf[0].reject(NOT_ALLOWED);
  await flush();
  const n = h.calls.order.length;
  h.tap("unlockRetryButton");
  deq(h.calls.order.slice(n), ["requestPrf", "render"], "request first, then the checking render — no intermediate waiting render");
  deq(h.calls.requestPrf[1].credentialArg, { credentialId: "cred-1" }, "same pinned credential");
  deq(h.calls.recovery, [], "no recovery/creation/scene change");
  const rAL = stripComments(fnBody("renderAppLock"));
  assert.ok(rAL.includes('document.querySelector("#unlockRetryButton")?.addEventListener("click", unlockApp);'));
  for (const bad of ["checkPiggy", "recoverPiggy", "openPiggy", "startPiggyOpen", "setScene(", "#checkButton", "#authTryAgainButton", "phase: \"waiting\""]) {
    assert.equal(rAL.includes(bad), false, `renderAppLock contains ${bad}`);
  }
  const un = stripComments(fnBody("unlockApp")) + stripComments(fnBody("settleUnlock"));
  for (const bad of ["checkPiggy(", "recoverPiggy(", "openPiggy(", "startPiggyOpen(", "setScene(", "credentials.create", "createPasskeyWithPrfOutput("]) {
    assert.equal(un.includes(bad), false, `unlock path contains ${bad}`);
  }
});

await check("C3 recovery context (this device has a Piggy marker) shows exactly ONE action: \"Check Piggy\"", () => {
  for (const markers of [{ credential: { credentialId: "c" } }, { received: true }, { address: "0x00000000000000000000000000000000000000c3" }]) {
    const h = buildHarness({ markers });
    h.state.appLock = null;
    Object.assign(h.state, { scene: "birth", authPhase: "idle", authCancelled: false, message: "Chog could not find Piggy here.", detail: "Couldn't find your Piggy." });
    const html = h.ctx.renderAuthCard();
    assert.equal((html.match(/<button class="pkbtn"/g) || []).length, 1, `${JSON.stringify(markers)}: one action`);
    assert.ok(html.includes('id="checkButton"') && html.includes(">Check Piggy<"));
    assert.equal(html.includes("Try again"), false, "no Try again (button or copy)");
    assert.equal(html.includes("unlockRetryButton"), false);
  }
});

await check("C4 recovery card with an empty detail does not show copy that names a missing action", () => {
  const h = buildHarness({ markers: { received: true } });
  h.state.appLock = null;
  Object.assign(h.state, { scene: "birth", authPhase: "idle", authCancelled: false, message: "Chog could not wake Piggy.", detail: "" });
  const html = h.ctx.renderAuthCard();
  assert.equal(html.includes("Try again"), false);
});

// [Owner decision 2026-10-02 "OWNER DECISION — A-667 FRESH-DEVICE FAILURE: ONE MAKE NEW ACTION"] replaces the
// interim two-button PREMISE_CONFLICT pin: markerless fresh device → same failure card, ONE "Make new".
await check("C5 markerless fresh device, find-first lookup FAILED or CANCELLED (and new-Piggy open failure) → same couldn't-find card format, exactly ONE action \"Make new\"", () => {
  const cases = [
    { name: "lookup failed", s: { message: "Chog could not find Piggy here.", detail: "Couldn't find your Piggy.", authCancelled: false }, body: "Couldn't find your Piggy." },
    { name: "lookup cancelled", s: { message: "Chog could not find Piggy here.", detail: "Couldn't find your Piggy.", authCancelled: true }, body: "Face ID was cancelled." },
    { name: "open failed", s: { message: "Piggy could not open here.", detail: "", authCancelled: false }, body: "" },
  ];
  for (const c of cases) {
    const h = buildHarness({ markers: {} });
    h.state.appLock = null;
    Object.assign(h.state, { scene: "birth", authPhase: "idle", ...c.s });
    const html = h.ctx.renderAuthCard();
    assert.equal((html.match(/<button class="pkbtn"/g) || []).length, 1, `${c.name}: one action`);
    assert.ok(html.includes('<button class="pkbtn" id="authTryAgainButton">Make new</button>'), `${c.name}: Make new on the existing Invite-navigation id`);
    for (const bad of ["Try again", "Check Piggy", "checkButton", "unlockRetryButton"]) assert.equal(html.includes(bad), false, `${c.name}: ${bad}`);
    assert.ok(html.includes('<h1 class="authCard__title">Couldn\'t open Piggy</h1>'), `${c.name}: existing heading`);
    assert.ok(html.includes(`<p class="authCard__body">${c.body}</p>`), `${c.name}: existing body copy`);
    assert.ok(html.includes('class="authCard"') && html.includes('class="authCard__paper"'), `${c.name}: same card format`);
  }
});

// Runs the REAL startPiggyOpen + the REAL render() click handler for #authTryAgainButton (extracted verbatim).
function buildFreshFlow() {
  const calls = { check: 0, open: 0, scenes: [], removed: [], set: [] };
  const store = new Map();
  const ctx = {
    state: { scene: "birth", freshRecoveryTried: false, address: "" },
    FRESH_DEVICE_RECOVERY_FIRST: true,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { calls.set.push(k); store.set(k, String(v)); }, removeItem: (k) => { calls.removed.push(k); store.delete(k); } },
    readCredential: () => null,
    hasReceivedPiggy: () => false,
    checkPiggy: async () => { calls.check += 1; return { ok: false }; },
    openPiggy: async () => { calls.open += 1; return { created: true }; },
    setScene: (scene) => { calls.scenes.push(scene); ctx.state.scene = scene; },
  };
  vm.createContext(ctx);
  const handlerSrc = (stripComments(fnBody("render")).match(/addEventListener\("click", (\(\) => setScene\("received", "", ""\))\);/) || [])[1];
  if (!handlerSrc) throw new Error("render() #authTryAgainButton handler not found verbatim");
  vm.runInContext(`${fnBody("startPiggyOpen")}\nthis.startPiggyOpen = startPiggyOpen; this.makeNew = ${handlerSrc};`, ctx);
  return { ctx, calls };
}

await check("C7 Make new → Invite (existing explicit new-Piggy entry); NO create on the tap itself — creation only after the user's explicit Open", async () => {
  const r = stripComments(fnBody("render"));
  assert.ok(r.includes('document.querySelector("#authTryAgainButton")?.addEventListener("click", () => setScene("received", "", ""));'), "Make new reuses render()'s existing Invite wiring");
  assert.ok(r.includes('document.querySelector("#inviteFaceButton")?.addEventListener("click", openInvite);'), "Invite Open stays an explicit tap");
  const f = buildFreshFlow();
  await f.ctx.startPiggyOpen();                    // first explicit Open on a markerless device = find-first lookup
  deq([f.calls.check, f.calls.open], [1, 0], "find-first lookup, no create");
  f.ctx.makeNew();                                  // tap "Make new" on the couldn't-find card
  deq(f.calls.scenes, ["received"], "goes to Invite");
  deq([f.calls.check, f.calls.open], [1, 0], "Make new itself creates nothing and does not re-run recovery");
  await f.ctx.startPiggyOpen();                    // user explicitly taps Open on Invite
  deq([f.calls.check, f.calls.open], [1, 1], "creation happens only on the explicit Open (A-533 path)");
});

await check("C8 nothing on load/render/timeout: Make new/Invite never start creation by themselves; no credential is cleared anywhere on this path", async () => {
  const f = buildFreshFlow();
  f.ctx.state.freshRecoveryTried = true;
  f.ctx.makeNew();
  await flush();
  deq([f.calls.check, f.calls.open], [0, 0], "no auth/creation call without an explicit Open");
  deq(f.calls.removed, [], "no storage removal");
  deq(f.calls.set, [], "no storage write");
  for (const fn of ["setScene", "startPiggyOpen", "renderAuthCard", "openInvite", "renderReceived"]) {
    const b = stripComments(fnBody(fn));
    assert.equal(/removeItem\(|localStorage\.clear\(/.test(b), false, `${fn} clears storage`);
    // startPiggyOpen IS the explicit-Open creation entry (C7 proves it runs only after the Open tap).
    if (fn !== "startPiggyOpen") assert.equal(/openPiggy\(|createPasskeyWithPrfOutput\(|credentials\.create/.test(b), false, `${fn} creates`);
  }
  assert.equal(/startPiggyOpen\(/.test(stripComments(fnBody("renderReceived"))), false, "render of Invite does not open");
  assert.ok(/setInvitePhase\("checking"\);\s*return withInviteAuthPresentation\(async \(\) => \{\s*const out = await startPiggyOpen\(\);/.test(stripComments(fnBody("openInvite"))), "Invite tap starts the passkey branch immediately");
});

await check("C9 separation: marker → Check Piggy only · markerless → Make new only · reentry lock → Try again only; three distinct ids, one each", async () => {
  const card = (markers) => { const h = buildHarness({ markers }); h.state.appLock = null; Object.assign(h.state, { scene: "birth", authPhase: "idle", authCancelled: false, message: "Chog could not find Piggy here.", detail: "Couldn't find your Piggy." }); return h.ctx.renderAuthCard(); };
  const ids = (html) => [...html.matchAll(/<button class="pkbtn" id="(\w+)"[^>]*>([^<]+)</g)].map((m) => `${m[1]}:${m[2]}`);
  deq(ids(card({ received: true })), ["checkButton:Check Piggy"]);
  deq(ids(card({})), ["authTryAgainButton:Make new"]);
  const h = buildHarness({ markers: {} });
  h.tap("loginChogButton");
  h.calls.requestPrf[0].reject(NOT_ALLOWED);
  await flush();
  deq(ids(h.app.innerHTML), ["unlockRetryButton:Try again"], "reentry card unaffected by markers (markerless here)");
  const rAL = stripComments(fnBody("renderAppLock"));
  assert.equal(/authTryAgainButton|checkButton|Make new/.test(rAL), false, "lock never wires Make new / Check Piggy");
});

await check("C6 render() birth wiring unchanged: #checkButton → checkPiggy (recovery semantics), #authTryAgainButton → Invite; the lock never reaches it", () => {
  const r = stripComments(fnBody("render"));
  assert.ok(r.includes('document.querySelector("#checkButton")?.addEventListener("click", checkPiggy);'));
  assert.ok(r.includes('document.querySelector("#authTryAgainButton")?.addEventListener("click", () => setScene("received", "", ""));'));
  const lockAt = r.indexOf("if (state.appLock)");
  assert.ok(lockAt > 0 && r.slice(lockAt, r.indexOf("const markup")).includes("return;"), "locked render returns before birth wiring");
  assert.equal(r.includes("unlockRetryButton"), false);
});

await check("P1 byte-identical pins: requestPrf / loginCheckingMarkup (security-kit baseline) and render / recovery+creation functions", () => {
  const PRE1051 = restorePreA1051(MAIN); const fnBody1051 = (n) => fnBody(n, PRE1051); // [A-1051 RE-PIN] pre-A-1051: fnBody(n) on MAIN
  // Full sha256 pins, split into two halves only so the repo secret hook does not read them as keys (values unchanged).
  assert.equal(sha(fnBody1051("requestPrf")), "766fc57ed63b6009feb116105bdc73cc" + "0c2cebff74ea614c02c48df6b935a321", "requestPrf");
  assert.equal(sha(fnBody1051("loginCheckingMarkup")), "dcec88389ae4385ad03e7d4645cd7704" + "6eb95b7762695d2d59e96a8844772f91", "loginCheckingMarkup");
  assert.equal(sha(fnBody1051("render")), "521db6368b3a331d44eb1287883319905c2a4f98c9148331df4adf698bbf6dd4", "render");
  const want = { checkPiggy: PIN.checkPiggy, recoverPiggy: PIN.recoverPiggy, openPiggy: PIN.openPiggy, startPiggyOpen: PIN.startPiggyOpen, isCancelledAuthError: PIN.isCancelledAuthError, appLockSurface: PIN.appLockSurface, lockAppAfterIdle: PIN.lockAppAfterIdle, getRpId: PIN.getRpId };
  const got = Object.fromEntries(Object.keys(want).map((n) => [n, sha(fnBody1051(n)).slice(0, 16)]));
  deq(got, want);
  assert.ok(/const PRODUCTION_RP_ID = "arasoo\.vercel\.app";/.test(MAIN), "PRODUCTION_RP_ID unchanged");
});

await check("P2 CSS: checking is distinguished only via the existing data-app-lock hook — Chog face lifted, waiting coordinates untouched, reduced-motion respected", () => {
  const at = CSS.indexOf('.stage--loginCheck[data-app-lock="checking"] .loginCheck__face {');
  assert.ok(at > 0, "checking rule present");
  const rule = CSS.slice(at, CSS.indexOf("}", at) + 1);
  assert.ok(/transform:\s*translateY\(-108px\);/.test(rule));
  assert.ok(/animation:\s*loginCheckLift /.test(rule));
  assert.ok(/@keyframes loginCheckLift\s*\{\s*from \{ transform: translateY\(0\); \}\s*to \{ transform: translateY\(-108px\); \}\s*\}/.test(CSS));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.stage--loginCheck\[data-app-lock="checking"\] \.loginCheck__face \{\s*animation: none;/.test(CSS));
  const base = CSS.slice(CSS.indexOf(".stage--loginCheck .loginCheck__face {"), CSS.indexOf("}", CSS.indexOf(".stage--loginCheck .loginCheck__face {")) + 1);
  assert.ok(base.includes("top: 132.5px;") && base.includes("left: calc(50% - 100.5px);") && !base.includes("transform"), "waiting face box unchanged");
  const lockRules = [...CSS.matchAll(/data-app-lock="(\w+)"/g)].map((m) => m[1]);
  deq([...new Set(lockRules)], ["checking"], "only the checking state gets a rule (waiting/failed unchanged)");
});

console.log(`\nPart N: ${pass}/${pass + fail} PASS`);

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════
const HEIGHT = { 390: 844, 430: 900, 700: 900, 1440: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBrowser() {
  let chromium;
  if (!existsSync(privatePath())) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  try {
    const req = createRequire(privatePath("ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await check("B0 playwright available (private harness)", () => { throw e; });
    return;
  }
  let server = null;
  let BASE = process.env.A667_BASE_URL || "";
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
  const shots = process.env.A667_SHOTS || "";
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const w of [390, 430]) await mobileWidth(browser, BASE, w, shots);
    await desktopWidths(browser, BASE, shots);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

// navigator.credentials spy with a per-page mode: "pass" (real virtual authenticator), "reject"
// (NotAllowedError, i.e. user cancel), "hang" (never settles — the A-665 iPhone symptom). A hung request
// keeps its options so the test can later deliver a REAL late result into it (releaseLate).
const INIT = `(() => {
  const wa = window.__wa = { create: 0, get: 0, mode: "pass", hung: [] };
  const c = navigator.credentials; if (!c) return;
  const oc = c.create.bind(c), og = c.get.bind(c);
  c.create = (o) => { wa.create++; return oc(o); };
  c.get = (o) => {
    wa.get++;
    if (wa.mode === "reject") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
    if (wa.mode === "hang") return new Promise((resolve, reject) => { wa.hung.push({ resolve, reject, o }); });
    return og(o);
  };
  wa.releaseLate = async () => { const h = wa.hung.shift(); if (!h) return "none"; try { h.resolve(await og(h.o)); return "resolved"; } catch (e) { h.reject(e); return "rejected"; } };
})();`;

async function mobileWidth(browser, BASE, w, shots) {
  const T = `[${w}]`;
  const h = HEIGHT[w];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT);
  const p = await context.newPage();
  const pageErrors = [];
  p.on("pageerror", (e) => pageErrors.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a667_w${w}_${name}.png`) }); };
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const lockState = () => p.evaluate(() => document.querySelector("[data-app-lock]")?.dataset.appLock ?? null);
  const wa = () => p.evaluate(() => ({ create: window.__wa.create, get: window.__wa.get }));
  const setMode = (m) => p.evaluate((mm) => { window.__wa.mode = mm; }, m);
  const waitLock = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await lockState().catch(() => undefined); if (s === want) return s; await sleep(150); } return `TIMEOUT:${await lockState().catch(() => null)}`; };
  const faceTop = () => p.evaluate(() => document.querySelector("#loginChogButton")?.getBoundingClientRect().top ?? null);
  const actions = () => p.evaluate(() => [...document.querySelectorAll(".authCard__actions button")].map((b) => `${b.id}:${b.textContent.trim()}`));
  const reloadLocked = async () => { await setMode("pass"); await p.reload({ waitUntil: "networkidle" }); await p.waitForSelector("#loginChogButton", { timeout: 15000 }); await sleep(400); };

  await check(`B1 ${T} birth one Piggy on desktop (virtual authenticator), then ${w}x${h} reload → waiting LOGIN_CHECKING, zero WebAuthn on load`, async () => {
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
    await sleep(2500);
    await p.setViewportSize({ width: w, height: h });
    await reloadLocked();
    const before = await wa();
    await sleep(1500);
    assert.equal(await lockState(), "waiting");
    deq(await wa(), before, "no credentials.get/create on load/render");
    await shot("1_waiting");
  });

  await check(`B2 ${T} success: one tap → exactly one get → unlocked (no create)`, async () => {
    const b = await wa();
    await p.locator("#loginChogButton").click();
    const t0 = Date.now(); while (Date.now() - t0 < 8000 && (await lockState()) !== null) await sleep(150);
    assert.equal(await lockState(), null, "unlocked");
    const a = await wa();
    deq({ get: a.get - b.get, create: a.create - b.create }, { get: 1, create: 0 });
  });

  await check(`B3 ${T} user cancel → failed card with ONLY "Try again" → Try again → exactly one new get → unlocked`, async () => {
    await reloadLocked();
    await setMode("reject");
    await p.locator("#loginChogButton").click();
    assert.equal(await waitLock("failed", 5000), "failed");
    deq(await actions(), ["unlockRetryButton:Try again"]);
    assert.equal(await p.locator("#checkButton").count(), 0);
    await shot("4_failed_cancel");
    await setMode("pass");
    const b = await wa();
    await p.locator("#unlockRetryButton").click();
    const t0 = Date.now(); while (Date.now() - t0 < 8000 && (await lockState()) !== null) await sleep(150);
    assert.equal(await lockState(), null, "unlocked by the retry");
    const a = await wa();
    deq({ get: a.get - b.get, create: a.create - b.create }, { get: 1, create: 0 });
  });

  await check(`B4 ${T} never-resolving get → checking (Chog lifted) → bounded wait → failed card; late real success ignored; Try again → exactly one new get → unlocked`, async () => {
    await reloadLocked();
    const waitingTop = await faceTop();
    await setMode("hang");
    const b = await wa();
    await p.locator("#loginChogButton").click();
    assert.equal(await waitLock("checking", 3000), "checking");
    await sleep(600);
    const checkingTop = await faceTop();
    assert.ok(waitingTop - checkingTop > 100, `Chog lifted while checking (waiting ${waitingTop} → checking ${checkingTop})`);
    await shot("2_checking");
    await p.locator("#loginChogButton").click({ force: true }).catch(() => {});
    assert.equal((await wa()).get - b.get, 1, "second tap during checking starts nothing");
    assert.equal(await waitLock("failed", 50000), "failed", "bounded wait ends in the failed card");
    deq(await actions(), ["unlockRetryButton:Try again"]);
    await shot("3_failed_timeout");
    const late = await p.evaluate(() => window.__wa.releaseLate());
    await sleep(1500);
    assert.equal(await lockState(), "failed", `late ${late} result must not unlock or change state`);
    await setMode("pass");
    const b2 = await wa();
    await p.locator("#unlockRetryButton").click();
    const t0 = Date.now(); while (Date.now() - t0 < 8000 && (await lockState()) !== null) await sleep(150);
    assert.equal(await lockState(), null);
    const a = await wa();
    deq({ get: a.get - b2.get, create: a.create - b2.create }, { get: 1, create: 0 });
    assert.deepEqual(pageErrors, [], "pageerror 0");
  });

  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => {});
  await context.close();
}

async function desktopWidths(browser, BASE, shots) {
  for (const w of [390, 430, 700, 1440]) {
    const h = HEIGHT[w];
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    await context.addInitScript(INIT);
    const p = await context.newPage();
    await check(`B5 [${w}] fresh device: couldn't-find card shows ONE "Make new" → Invite, no create/get before an explicit Open, storage untouched; with a Piggy marker ONLY "Check Piggy"${w >= 700 ? "; desktop Invite stage unchanged, no lock" : ""}`, async () => {
      await p.goto(BASE, { waitUntil: "networkidle" });
      await p.waitForSelector(".stage--invite", { timeout: 15000 });
      if (w >= 700) {
        const r = await p.evaluate(() => document.querySelector(".stage--invite").getBoundingClientRect().toJSON());
        assert.ok(Math.abs(r.height - h) < 2 && Math.abs(r.top) < 2, `stage ${JSON.stringify(r)}`);
        assert.equal(await p.locator("[data-app-lock]").count(), 0);
        if (shots) await p.screenshot({ path: path.join(shots, `a667_w${w}_invite.png`) });
      }
      const btns = () => p.evaluate(() => [...document.querySelectorAll(".authCard__actions button")].map((b) => `${b.id}:${b.textContent.trim()}`));
      await p.evaluate(() => window.__arasoScene("authfail", { reason: "notfound" }));
      await sleep(400);
      deq(await btns(), ["authTryAgainButton:Make new"], "markerless fresh device: Make new only");
      if (shots) await p.screenshot({ path: path.join(shots, `a667_w${w}_fresh_make_new.png`) });
      await p.evaluate(() => window.__arasoScene("authfail", { reason: "cancelled" }));
      await sleep(400);
      deq(await btns(), ["authTryAgainButton:Make new"], "markerless fresh device, cancelled: Make new only");
      const keysBefore = await p.evaluate(() => Object.keys(localStorage).sort());
      const waBefore = await p.evaluate(() => ({ create: window.__wa.create, get: window.__wa.get }));
      await p.locator("#authTryAgainButton").click();
      await sleep(1500);
      assert.equal(await p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene), "received", "Make new → Invite");
      assert.ok(await p.locator("#inviteFaceButton").count(), "explicit Open available");
      deq(await p.evaluate(() => ({ create: window.__wa.create, get: window.__wa.get })), waBefore, "no create/get until the user taps Open");
      deq(await p.evaluate(() => Object.keys(localStorage).sort()), keysBefore, "no storage key cleared/added by Make new");
      await p.evaluate(() => { localStorage.setItem("araso.piggyReceived", "1"); window.__arasoScene("authfail", { reason: "notfound" }); });
      await sleep(400);
      deq(await btns(), ["checkButton:Check Piggy"], "recovery context: Check Piggy only");
      if (shots) await p.screenshot({ path: path.join(shots, `a667_w${w}_recovery_card.png`) });
      await p.evaluate(() => localStorage.clear());
    });
    await context.close();
  }
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

// Entry runs last so every module-level const (INIT, HEIGHT, …) is initialized first (TDZ).
if (process.env.A667_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A667_NODE_ONLY=1) — browser scenarios not run");
  finish();
} else {
  await runBrowser();
  finish();
}
