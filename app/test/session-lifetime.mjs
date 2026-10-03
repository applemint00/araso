// [A-556 Owner bank-style session policy] PHASE 3 — proves card items 1-8 with a deterministic
// fake clock/timers driving the REAL main.js session-lifetime functions (endSignerSession,
// endActiveSession, touchAppSession, armSignerExpiry, activateSigningSession) plus the real
// sendPiggy/sendPiggyOnce send path and the real Gate C permission functions (authorizeMoneyAction,
// applyPiggySelection, consumeMoneyPermission) — same technique as send-lock.mjs/
// multi-piggy-product-reopen.mjs (cut the actual function text out of app/src/main.js, run it in
// node:vm with real library imports, no re-implementation of the rules under test). Network 0 ·
// real device Face ID 0 · real tx 0 · no real waiting — every "minute" below is a virtual tick on
// a fake setTimeout/clearTimeout, never a real one.
//
// Items 9-10 (S2 genuine-proof/tamper/replay rejects, S1 Model-A concurrency) are NOT
// re-implemented here — they are proven by rerunning funding-runtime-core.mjs and
// model-a-add-piggy.mjs unmodified (see RECEIPT.md test mapping); this file's scope is the new
// timer/reuse/permission-survival contract (items 1-8) only.
//   node app/test/session-lifetime.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { getEvmAddress, createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { selectionContext, switchSelection } from "../src/piggy-session.js";
import { issuePermission, authorize, consume, permissionNonce } from "../src/permission-envelope.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음(시작): ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN.slice(start, end);
}

// ── real function slices, cut straight out of main.js. Session timers are pulled as TWO narrow
// cuts (declarations, then the timer functions themselves) rather than the one wide
// "let activeSession..." → "// --- 씬 정리" range multi-piggy-product-reopen.mjs uses — that wide
// range also contains the real getRpId/isProductionRpId/isAllowedPiggyRpId (main.js ~476-495),
// which would shadow this file's isAllowedPiggyRpId stub with the real `window.location`-reading
// implementation. Narrowing avoids that collision without needing a fake `window`. ───────────────
const SESSION_DECLS_SRC = cut("let activeSession = null;", "function readCredential()");
const SESSION_TIMERS_SRC = cut("function endSignerSession() {", "// --- 씬 정리 (A-292 번호 9)");
const SESSION_SRC = `${SESSION_DECLS_SRC}\n${SESSION_TIMERS_SRC}`;
const constsSrc = cut('const SEND_PENDING_KEY = "araso.sendPending";', "\n\n");
const lockSrc = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");
const onceSrc = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");
const CORE_SRC = cut("function authorizeMoneyAction(request) {", "// [A-486 Lane B]");

for (const [name, src, needle] of [
  ["endSignerSession", SESSION_SRC, "function endSignerSession("],
  ["endActiveSession", SESSION_SRC, "function endActiveSession("],
  ["touchAppSession", SESSION_SRC, "function touchAppSession("],
  ["armSignerExpiry", SESSION_SRC, "function armSignerExpiry("],
  ["activateSigningSession", SESSION_SRC, "function activateSigningSession("],
  ["sendPiggy", lockSrc, "async function sendPiggy("],
  ["sendPiggyOnce", onceSrc, "async function sendPiggyOnce("],
  ["authorizeMoneyAction", CORE_SRC, "function authorizeMoneyAction("],
  ["applyPiggySelection", CORE_SRC, "function applyPiggySelection("],
  ["consumeMoneyPermission", CORE_SRC, "function consumeMoneyPermission("],
]) {
  if (!src.includes(needle)) throw new Error(`잘라낸 구간에 ${name} 없음 — 마커 확인 필요`);
}

// ── deterministic fake clock — the only "timer" anything in this file ever sees. advance(ms)
// fires every due callback in fireAt order (including ones a callback itself schedules at the
// same virtual instant), then lands `now` exactly on the target. No real setTimeout is driven by
// production code anywhere in this file. ─────────────────────────────────────────────────────────
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
        for (const [id, t] of timers) { if (t.fireAt <= target && t.fireAt < pickAt) { pickAt = t.fireAt; pickId = id; } }
        if (pickId === null) break;
        const { fn } = timers.get(pickId);
        timers.delete(pickId);
        now = pickAt;
        fn();
      }
      now = target;
    },
    pending: () => [...timers.values()].map((t) => t.fireAt),
  };
}
// real-Node macrotask flush between awaits — unrelated to the fake clock above (this just lets
// sendPiggyOnce's fire-and-forget settleSend(...).then().catch().finally() chain resolve).
const tick = () => new Promise((r) => setTimeout(r, 0));

function mockStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
  };
}

// ── one app instance = one fresh vm context + fresh fake clock + fresh module-scope state, same
// "close/reopen" model multi-piggy-product-reopen.mjs uses. `recoverPiggy` is defined INSIDE the
// vm script (not injected as an external stub) so it can call the real internal
// `activateSigningSession` by name — exactly what the shipped recover path does. ─────────────────
function buildApp({ grantThrows = false } = {}) {
  const clock = makeFakeClock();
  const authCalls = { count: 0 };
  const calls = { scenes: [], finished: [], grant: 0, sign: 0, sendTx: 0 };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const storage = mockStorage();
  const state = {
    address: "", txHash: "", mark: "", grantTxHash: "", activeSignerAddress: "",
    selectedPiggy: null, moneyIntent: null, funding: null, scene: "sendstay",
  };
  const prfOutput = crypto.randomBytes(32);
  const ctx = {
    state, console, Set, Map, Array, Object, Date, JSON, Promise,
    createSecp256k1SigningSession, getEvmAddress, toViemAccount,
    crypto: globalThis.crypto,
    localStorage: storage,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    setScene: (...a) => { calls.scenes.push(a); },
    isAllowedPiggyRpId: () => true,
    noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    // [A-669] lockAppAfterIdle 가 먼저 부르는 Check/Open 시도 무효화(authAttempt 영역은 이 하네스 밖) — 살아 있는 시도 없음.
    invalidateLiveAuthAttempt: () => false,
    requestGrant: async () => {
      calls.grant += 1;
      if (grantThrows) throw new Error("relayer unreachable");
      return { txHash: "", granted: false }; // "already funded" — no visibility wait needed
    },
    waitForGrantBalance: async () => true,
    simulateSend: async () => ({ depositTx: {}, before: 1n, beforeShares: 0n }),
    createWalletClient: () => ({
      sendTransaction: async () => { calls.sendTx += 1; return calls.sendTx % 2 === 1 ? "0xdeposit" : "0xredeem"; },
    }),
    MONAD_TESTNET: {}, MONAD_TESTNET_RPC: "", http: () => ({}),
    TextEncoder,
    toHex: () => "00", // [narrowed SESSION_SRC excludes main.js's own toHex() — harness wiring only]
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n }),
    readShmonBalance: async () => 5n,
    makeRedeemTx: () => ({}),
    publicClient: { estimateGas: async () => 1n },
    settleSend: async () => ({ outcome: "done", reason: "ok", receipt: null }),
    finishTrip: (t) => calls.finished.push(t.outcome),
    formatError: (e) => String(e),
    recordSafeError: () => {},
    render: () => {},
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    authorize, consume, switchSelection, selectionContext,
    __authCalls: authCalls,
    __prfOutput: prfOutput,
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SESSION_SRC}\n` +
      // 실제 recoverPiggy() 는 passkey/PRF 전체 배선을 거친다 — 여기서는 "성공한 인증 한 번"만
      // 흉내낸다: 같은 고정 prfOutput 으로 실제 activateSigningSession() 을 부른다(같은 Piggy가
      // 매번 같은 서명자로 돌아온다는 뜻 — item 2 의 "같은 Piggy" 전제).
      `async function recoverPiggy() { __authCalls.count += 1; activateSigningSession(__prfOutput); }\n` +
      // [A-698 M3] harness wiring: Send recovery now takes the shared Check/Open attempt slot (real helpers live in main.js; a698 test runs them).
      `let authAttempt = null; let platformAuthInflight = null; const UNLOCK_UI_WAIT_MS = 45000;\n` +
      `function trackPlatformAuth(p) { return p; }\nfunction beginAuthAttempt(kind) { authAttempt = { kind, live: true }; return authAttempt; }\n` +
      `function boundAuthAttempt(a, work) { return work; }\nfunction finishAuthAttempt(a) { if (authAttempt !== a) return false; authAttempt = null; return true; }\n` +
      `${constsSrc}\n${lockSrc}\n${onceSrc}\n` +
      `const consumedPermissionNonces = new Set();\n${CORE_SRC}\n` +
      `this.__api = { sendPiggy, readSendPending, sendBusy, authorizeMoneyAction, applyPiggySelection, consumeMoneyPermission };\n` +
      `this.__get = () => ({ hasSigner: !!activeAccount, address: activeAccount ? activeAccount.address : null });`,
    ctx,
  );
  return { clock, calls, authCalls, state, storage, btn, get: ctx.__get, prfOutput, ...ctx.__api };
}

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const DEST = "0x00000000000000000000000000000000000000a1";

function heldEnvelopeFor(piggyId, signerAddress) {
  const intent = {
    piggyId, signerAddress, action: "send_money", asset: "USDC", amount: "1",
    chain: "monad-testnet", destination: DEST, destinationRequired: true,
  };
  const auth = { method: "passkey", verified: true, verifiedAt: Date.now(), credentialId: "x" };
  const envelope = issuePermission({
    intent, auth, nonce: permissionNonce({ ...intent, at: new Date().toISOString() }), nowMs: Date.now(),
  }).envelope;
  return { intent, envelope };
}

// ══ 1. auth opens both the signer's 5m absolute timer and the app-idle 10m timer ══════════════
await check("1. a successful auth arms exactly two timers — signer 5m absolute + app-idle 10m", async () => {
  const app = buildApp();
  assert.deepEqual(app.clock.pending(), []);
  await app.sendPiggy();
  await tick(); await tick();
  assert.equal(app.authCalls.count, 1);
  assert.equal(app.get().hasSigner, true);
  assert.deepEqual(app.clock.pending().sort((a, b) => a - b), [FIVE_MIN, TEN_MIN]);
});

// ══ 2. same-Piggy second send within <5m reuses the live signer — no second auth call ══════════
await check("2. same Piggy, second send 2 minutes later: no new Face ID/auth call, signer reused", async () => {
  const app = buildApp();
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 1);
  app.clock.advance(2 * 60 * 1000);
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 1, "authCalls stayed at 1 — sendPiggyOnce's activeAccount/activeSession reuse branch, not recoverPiggy");
  assert.equal(app.get().hasSigner, true);
});

// ══ 3. second action cannot reuse the first action's consumed permission ═══════════════════════
await check("3. consuming a permission invalidates its nonce — but the live signer used for the SECOND action is unaffected by that consumption", async () => {
  const app = buildApp();
  await app.sendPiggy(); await tick(); await tick();
  const addr = app.get().address;
  app.state.selectedPiggy = { id: "honeybun", address: addr };
  const { intent, envelope } = heldEnvelopeFor("honeybun", addr);
  app.state.moneyIntent = { piggyId: "honeybun", status: "permitted", permission: envelope };
  assert.equal(app.authorizeMoneyAction(intent).ok, true, "first action authorizes against the fresh envelope");
  const consumed = app.consumeMoneyPermission();
  assert.equal(consumed.consumed, true);
  assert.equal(app.get().hasSigner, true, "bank-style: consuming the permission does not end the live signer session");
  const replay = app.authorizeMoneyAction(intent);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "permission_already_used", "the SAME action cannot reuse its own just-consumed permission");
});

// ══ 4. signer expires at 5m absolute despite app activity/another send in between ══════════════
await check("4. signer's 5m absolute cap fires even though a second send touched the app 4 minutes in", async () => {
  const app = buildApp();
  await app.sendPiggy(); await tick(); await tick(); // auth at t=0 — arms signer@5m, idle@10m
  app.clock.advance(4 * 60 * 1000); // t=4m
  await app.sendPiggy(); await tick(); await tick(); // 2nd send: touches app-idle only (item 2/PHASE 1)
  assert.equal(app.authCalls.count, 1);
  assert.equal(app.get().hasSigner, true, "still alive right after the t=4m send");
  const scenesBefore = app.calls.scenes.length;
  app.clock.advance(1 * 60 * 1000 + 1000); // total elapsed since AUTH = 5m1s
  assert.equal(app.get().hasSigner, false, "the signer's absolute 5m cap (armed at t=0) fired — the t=4m send never extended it");
  assert.equal(app.calls.scenes.length, scenesBefore, "signer-expiry alone forces no scene reset (card PHASE 1)");
});

// ══ 5. app-idle expiry at 10m ends the signer and enters the existing resting/locked behavior ══
await check("5. app-idle 10m expiry ends the signer and shows the existing 'resting' scene", async () => {
  const app = buildApp();
  await app.sendPiggy(); await tick(); await tick(); // t=0: arms idle@10m, signer@5m
  app.clock.advance(TEN_MIN + 1000);
  assert.equal(app.get().hasSigner, false, "app-idle expiry also ends the signer (endActiveSession, full teardown)");
  assert.deepEqual(app.calls.scenes.at(-1), ["sendstay", "Piggy is resting.", "Open again when you need it."], "same resting copy as before — no new UI text");
});

// ══ 6. Piggy switch ends signer + revokes the held permission ══════════════════════════════════
await check("6. switching to a different Piggy ends the old signer and revokes the permission it held", async () => {
  const app = buildApp();
  await app.sendPiggy(); await tick(); await tick();
  const addr1 = app.get().address;
  app.state.selectedPiggy = { id: "honeybun", address: addr1 };
  const { envelope } = heldEnvelopeFor("honeybun", addr1);
  app.state.moneyIntent = { piggyId: "honeybun", status: "permitted", permission: envelope };
  const mochiSecret = crypto.randomBytes(32);
  const mochiAddr = getEvmAddress(createSecp256k1SigningSession({ privateKey: mochiSecret }).publicKey);
  const out = app.applyPiggySelection({ id: "mochi", address: mochiAddr });
  assert.equal(out.invalidate, true);
  assert.equal(out.revokeNonce, envelope.nonce, "the held Honeybun permission is exactly what gets revoked");
  assert.equal(app.get().hasSigner, false, "Piggy switch ends the old (Honeybun) signer session immediately");
  assert.equal(app.state.moneyIntent, null);
});

// ══ 7. pending/in-flight stays replay-locked; the timer machinery is untouched by that guard ════
await check("7. pending early-return still blocks a re-tap and leaves both the signer and its timers exactly as they were", async () => {
  const app = buildApp();
  await app.sendPiggy(); await tick(); await tick();
  const pendingBefore = app.clock.pending().slice().sort((a, b) => a - b);
  app.storage.setItem("araso.sendPending", JSON.stringify({ stage: "redeem-broadcast", at: Date.now() }));
  await app.sendPiggy(); // pending early-return guard
  assert.deepEqual(app.clock.pending().slice().sort((a, b) => a - b), pendingBefore, "no timer touched by the early-return branch (A-556 PHASE 0: old S4 fail-safe removed)");
  assert.equal(app.get().hasSigner, true, "the early-return branch leaves the live signer alone");
  assert.equal(app.storage.has("araso.sendPending"), true, "pending record itself untouched");
});

// ══ 8. a failed send fabricates no permission/receipt, and does not mis-touch the timers ═══════
await check("8. a send that fails at grant leaves auth's own timers alone — no fabricated permission/receipt, no extra arm/cancel", async () => {
  const app = buildApp({ grantThrows: true });
  await app.sendPiggy(); await tick();
  assert.equal(app.authCalls.count, 1, "recoverPiggy still ran (no live session yet) before the grant step failed");
  assert.equal(app.get().hasSigner, true, "the freshly-authed signer is NOT torn down just because the send then failed (no S4 fail-safe)");
  assert.equal(app.state.moneyIntent, null, "no permission fabricated");
  assert.equal(app.calls.finished.length, 0, "no receipt/finishTrip fabricated");
  assert.equal(app.storage.has("araso.sendPending"), false, "no pending written before broadcast");
  assert.deepEqual(app.clock.pending().sort((a, b) => a - b), [FIVE_MIN, TEN_MIN], "exactly the two timers the one real auth armed — nothing extra, nothing cancelled");
});

console.log(`\n${pass}/${pass} PASS`);
