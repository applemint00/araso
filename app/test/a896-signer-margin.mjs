// [A-896 99e M-L-2 · Owner 60 s] signer remaining-lifetime margin. Before a value-moving send starts, the live signer must have
// >= 60 s of its 5-minute ABSOLUTE lifetime left (wall clock: Date.now() - signerSince, never the timer alone); otherwise sendPiggyOnce
// treats it as "no session" and runs the existing recoverPiggy path (one Face ID) before continuing. Same technique as session-lifetime.mjs:
// the REAL main.js functions are cut out and run in node:vm; the wall clock (Date) and the timer clock are two separate injected fakes.
// Network 0 · real Face ID 0 · real tx 0 · no real waiting.
//   node app/test/a896-signer-margin.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { preparedSignProblem } from "../src/money-executor.js";
import { getEvmAddress, createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { selectionContext, switchSelection } from "../src/piggy-session.js";
import { authorize, consume } from "../src/permission-envelope.js";
// [A-791] authorizeMoneyAction now runs the A-763 destination provenance producer (real module) over this device's Piggy records.
import { deriveDestinationProvenance, DESTINATION_SOURCE } from "../src/execution-safety.js";

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

for (const [name, src, needle] of [
  ["endSignerSession", SESSION_SRC, "function endSignerSession("],
  ["endActiveSession", SESSION_SRC, "function endActiveSession("],
  ["touchAppSession", SESSION_SRC, "function touchAppSession("],
  ["armSignerExpiry", SESSION_SRC, "function armSignerExpiry("],
  ["activateSigningSession", SESSION_SRC, "function activateSigningSession("],
  ["sendPiggy", lockSrc, "async function sendPiggy("],
  ["sendPiggyOnce", onceSrc, "async function sendPiggyOnce("],
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

function fakeLocks() {
  const held = new Map();
  return {
    held,
    async request(name, opts, cb) {
      if (held.has(name)) return opts.ifAvailable ? cb(null) : new Promise(() => {});
      held.set(name, true);
      try { return await cb({ name, mode: "exclusive" }); } finally { held.delete(name); }
    },
    async query() { return { held: [...held.keys()].map((name) => ({ name })), pending: [] }; },
  };
}

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
// [A-896] injected wall clock: the app's `Date.now()` inside the vm is THIS, not the real one. The fake timer clock above
// is separate on purpose — a throttled/slept page lets the wall clock run on while the 5-min setTimeout has not fired.
function makeWallClock(start = 1_700_000_000_000) {
  let t = start;
  let mono = 5000; // performance.now(): advances with advance(); advanceMono() moves only the monotonic clock, set() moves only the wall clock
  class FakeDate extends Date { static now() { return t; } }
  return { Date: FakeDate, now: () => t, mono: () => mono, advance: (ms) => { t += ms; mono += ms; }, advanceMono: (ms) => { mono += ms; }, set: (v) => { t = v; } };
}
function buildApp({ grantThrows = false, recoverThrows = false, noPerf = false } = {}) {
  const clock = makeFakeClock();
  const wall = makeWallClock();
  const events = [];
  const authCalls = { count: 0 };
  const calls = { scenes: [], finished: [], grant: 0, sign: 0, sendTx: 0, prepared: 0 };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const storage = mockStorage();
  const state = {
    address: "", txHash: "", mark: "", grantTxHash: "", activeSignerAddress: "",
    selectedPiggy: null, moneyIntent: null, funding: null, scene: "sendstay",
  };
  const prfOutput = crypto.randomBytes(32);
  const ctx = {
    state, console, Set, Map, Array, Object, Date: wall.Date, ...(noPerf ? {} : { performance: { now: () => wall.mono() } }), JSON, Promise, __events: events, __recoverThrows: recoverThrows,
    createSecp256k1SigningSession, getEvmAddress, toViemAccount,
    crypto: globalThis.crypto,
    // [A-791 harness wiring] the destination producer at the authorize boundary reads this device's Piggy records. The envelope
    // destination in these checks (DEST) is modelled as another Piggy this device holds, so provenance is vouched and the checks
    // keep testing what they test (session / nonce lifetime). Unvouched destinations are refused — covered by a791 M5.
    deriveDestinationProvenance, DESTINATION_SOURCE,
    moneyPiggiesSnapshot: () => ({ piggies: [{ id: "dest-piggy", address: DEST }] }),
    localStorage: storage,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    setScene: (...a) => { calls.scenes.push(a); },
    isAllowedPiggyRpId: () => true,
    noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    // [A-669] lockAppAfterIdle 가 먼저 부르는 Check/Open 시도 무효화(authAttempt 영역은 이 하네스 밖) — 살아 있는 시도 없음.
    invalidateLiveAuthAttempt: () => false,
    requestGrant: async () => {
      calls.grant += 1; events.push("grant");
      if (grantThrows) throw new Error("relayer unreachable");
      return { txHash: "", granted: false }; // "already funded" — no visibility wait needed
    },
    waitForGrantBalance: async () => true,
    simulateSend: async () => ({ depositTx: {}, before: 1n, beforeShares: 0n }),
    // [A-707 M2-beta] harness wiring: sign-before-send. The REAL Mera account signs a real eip1559 request; the fake node returns keccak256(raw).
    createWalletClient: () => ({
      prepareTransactionRequest: async ({ to }) => (events.push("prepare"), { type: "eip1559", chainId: 10143, nonce: calls.prepared++, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, to: to || "0x00000000000000000000000000000000000000a1", value: 0n, data: "0x" }),
    }),
    keccak256, preparedSignProblem,
    navigator: { locks: fakeLocks() },
    MONAD_TESTNET: {}, MONAD_TESTNET_RPC: "", http: () => ({}),
    TextEncoder,
    toHex: () => "00", // [narrowed SESSION_SRC excludes main.js's own toHex() — harness wiring only]
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n }),
    readShmonBalance: async () => 5n,
    makeRedeemTx: () => ({}),
    publicClient: { estimateGas: async () => 1n, getTransactionCount: async () => calls.prepared, sendRawTransaction: async ({ serializedTransaction }) => { calls.sendTx += 1; events.push("broadcast"); return keccak256(serializedTransaction); } },
    settleSend: async () => ({ outcome: "done", reason: "ok", receipt: null }),
    finishTrip: (t) => calls.finished.push(t.outcome),
    formatError: (e) => String(e),
    recordSafeError: (k, e) => { console.log("SAFEERR", k, e && e.message); },
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
      `async function recoverPiggy() { __authCalls.count += 1; __events.push("recover"); if (__recoverThrows) throw new Error("face id cancelled"); activateSigningSession(__prfOutput); }\n` +
      // [A-698 M3] harness wiring: Send recovery now takes the shared Check/Open attempt slot (real helpers live in main.js; a698 test runs them).
      `let authAttempt = null; let platformAuthInflight = null; const UNLOCK_UI_WAIT_MS = 45000;\n` +
      `function trackPlatformAuth(p) { return p; }\nfunction beginAuthAttempt(kind) { authAttempt = { kind, live: true }; return authAttempt; }\n` +
      `function boundAuthAttempt(a, work) { return work; }\nfunction finishAuthAttempt(a) { if (authAttempt !== a) return false; authAttempt = null; return true; }\n` +
      `${constsSrc}\n${lockSrc}\n${onceSrc}\n` +
            `holdSendTabLock();\n` +
      `this.__api = { sendPiggy, readSendPending, sendBusy, activateSigningSession, endSignerSession, endActiveSession, __stamp: () => signerSince };\n` +
      `this.__get = () => ({ hasSigner: !!activeAccount, address: activeAccount ? activeAccount.address : null });`,
    ctx,
  );
  return { clock, wall, events, calls, authCalls, state, storage, btn, get: ctx.__get, prfOutput, __ctx: ctx, ...ctx.__api };
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const SEC = 1000;
const FIVE_MIN = 5 * 60 * SEC;

// activate a real signer (what recoverPiggy does on a successful auth) and let the wall clock run `ms` forward
function appWithSignerAged(ms, opts) {
  const app = buildApp(opts);
  app.activateSigningSession(app.prfOutput);
  app.authCalls.count = 0; app.events.length = 0;
  app.wall.advance(ms);
  return app;
}

// [A-1298 · Owner 04:0x "샌드는 트잭이라 해야해" · "10분하자"] supersedes the 60 s margin: every money Send asks Face ID (one recover) whatever the
// live key's age, and the key has no 5-minute timer — it ends with the 10-minute app-idle window. The stamps stay (set / cleared as before).
await check("A. stamp: set by activateSigningSession (wall clock), cleared by endSignerSession, endActiveSession and the app-idle (one clock) expiry", async () => {
  const app = buildApp();
  assert.equal(app.__stamp(), 0, "no signer, no stamp");
  app.activateSigningSession(app.prfOutput);
  assert.equal(app.__stamp(), app.wall.now(), "stamp == injected Date.now() at auth");
  app.endSignerSession();
  assert.equal(app.__stamp(), 0, "endSignerSession clears the stamp");
  assert.equal(app.get().hasSigner, false);
  app.wall.advance(7 * SEC);
  app.activateSigningSession(app.prfOutput);
  assert.equal(app.__stamp(), app.wall.now(), "re-auth re-stamps");
  app.endActiveSession();
  assert.equal(app.__stamp(), 0, "endActiveSession (via endSignerSession) clears the stamp");
  app.activateSigningSession(app.prfOutput);
  app.clock.advance(FIVE_MIN + 1);
  assert.equal(app.get().hasSigner, true, "no 5-minute signer timer any more");
  app.clock.advance(5 * 60 * SEC);
  assert.equal(app.get().hasSigner, false, "the 10-minute app-idle window ended the key");
  assert.equal(app.__stamp(), 0, "timer-driven end clears the stamp too");
  assert.equal(vm.runInContext("signerMono", app.__ctx), -1, "R1 monotonic stamp cleared with it");
});

// [A-1360 RE-PIN · Owner 15:4x "열린 동안 보내기 승인만" · 81_ENTRY_FLOW 끝 [15:4x] newest-wins over A-1298] with the key open (a live signer for
// this Piggy, any age, app not locked) a money Send asks no Face ID — our approval sheet allows it (askSendAllow; not in this slice) — and the
// live signer signs. pre-A-1360 (A-1298): one recover (Face ID) every Send and a fresh signer.
await check("B1. live key aged 239 s: no recover (the key is open) — both legs go out with the live key", async () => {
  const app = appWithSignerAged(FIVE_MIN - 61 * SEC);
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 0, "no recover");
  assert.notEqual(app.events[0], "recover", "recover is not on the money path");
  assert.equal(app.calls.sendTx, 2, "deposit + redeem broadcast with the live signer");
});

await check("B2. a brand-new key (age 0): no recover either", async () => {
  const app = appWithSignerAged(0);
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 0);
  assert.equal(app.calls.sendTx, 2);
});

await check("B3. 59 s left on the old 5-minute count (age 241 s): no recover; the live signer (same stamp) signs", async () => {
  const app = appWithSignerAged(FIVE_MIN - 59 * SEC);
  const stale = app.__stamp();
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 0, "no recover (no Face ID)");
  assert.equal(app.events.filter((e) => e === "recover").length, 0);
  assert.equal(app.calls.sendTx, 2, "send went out: deposit + redeem");
  assert.equal(app.__stamp(), stale, "the same live signer");
});

await check("B4. timer throttled: wall clock 6 min old, the signer still alive in memory = the key is open → no recover", async () => {
  const app = appWithSignerAged(0);
  app.wall.advance(6 * 60 * SEC); // page slept; fake timer clock NOT advanced
  assert.equal(app.get().hasSigner, true, "precondition: the timer has not ended the signer");
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 0);
  assert.equal(app.calls.sendTx, 2);
});

await check("B5. key NOT open + recover failing -> nothing at all (no grant, no prepare, no broadcast, nothing left pending)", async () => {
  const app = buildApp({ recoverThrows: true }); // [A-1360 RE-PIN] the open key skips Face ID now, so the failing-recover case runs with no key
  await app.sendPiggy(); await tick(); await tick();
  assert.deepEqual(app.events, ["recover"], "only the recover attempt; no grant, no prepare, no broadcast");
  assert.equal(app.calls.sendTx, 0);
  assert.equal(app.calls.grant, 0);
  assert.equal(app.storage.has("araso.sendPending"), false, "nothing reserved/pending left behind");
  assert.equal(app.sendBusy(), false, "lock released; Send can be tried again");
});

await check("B6. wall clock moved backwards (negative age) or no stamp at all -> fail closed: recover", async () => {
  const back = appWithSignerAged(0);
  back.wall.set(back.__stamp() - 10 * SEC);
  await back.sendPiggy(); await tick(); await tick();
  assert.equal(back.authCalls.count, 1, "negative age is not 'fresh'");
  const live = buildApp();
  live.activateSigningSession(live.prfOutput);
  live.authCalls.count = 0; live.events.length = 0;
  // a signer that exists with no stamp (should never happen) is not trusted
  vm.runInContext("signerSince = 0;", live.__ctx);
  await live.sendPiggy(); await tick(); await tick();
  assert.equal(live.authCalls.count, 1, "no stamp = no proof of lifetime = recover");
});

await check("B7. R1 monotonic stamp: wall clock set back but still after the stamp, performance.now 241 s on: the key is open, no recover (A-1360 RE-PIN)", async () => {
  const app = appWithSignerAged(FIVE_MIN - 59 * SEC);
  app.wall.set(app.__stamp() + 30 * SEC); // wall clock pulled back to "30 s old"
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 0, "[A-1360] both clocks at/after the stamp = the key is open: no recover (pre: one recover every Send)");
  assert.equal(app.calls.sendTx, 2);
});

await check("B8. R1 clock moved backwards -> recover: monotonic clock behind its stamp (negative mono age) is not fresh", async () => {
  const app = appWithSignerAged(10 * SEC);
  app.wall.advanceMono(-20 * SEC); // mono now 10 s BEHIND the stamp
  await app.sendPiggy(); await tick(); await tick();
  assert.equal(app.authCalls.count, 1);
});

await check("B9. both clocks fresh, or performance.now unavailable: the key is open, no recover (A-1360 RE-PIN)", async () => {
  const fresh = appWithSignerAged(FIVE_MIN - 61 * SEC);
  await fresh.sendPiggy(); await tick(); await tick();
  assert.equal(fresh.authCalls.count, 0, "[A-1360] key open: no recover (pre: one recover every Send)");
  const np61 = appWithSignerAged(FIVE_MIN - 61 * SEC, { noPerf: true });
  await np61.sendPiggy(); await tick(); await tick();
  assert.equal(np61.authCalls.count, 0, "no performance: the wall clock stamp alone keeps the key open");
  const np59 = appWithSignerAged(FIVE_MIN - 59 * SEC, { noPerf: true });
  await np59.sendPiggy(); await tick(); await tick();
  assert.equal(np59.authCalls.count, 0, "no performance, any age: key open");
});

await check("C. source shape: sendPiggyOnce has no key-reuse branch; the recover (Face ID) runs before any grant/sign; no 5-minute signer timer", async () => {
  const once = onceSrc;
  assert.equal(once.includes("signerMarginOk"), false, "no margin / reuse decision any more");
  assert.ok(once.indexOf("recoverPiggy(") > 0 && once.indexOf("recoverPiggy(") < once.indexOf("requestGrant("), "Face ID before any grant");
  assert.ok(once.indexOf("recoverPiggy(") < once.indexOf("signSendStep("), "Face ID before any signing");
  assert.doesNotMatch(SESSION_SRC, /setTimeout\(\(\) => \{\s*endSignerSession\(\);\s*\}, 5 \* 60 \* 1000\)/, "no 5-minute signer timer");
  assert.equal((SESSION_SRC.match(/signerSince =/g) || []).length, 3, "declaration + stamp + clear only");
  assert.equal((SESSION_SRC.match(/signerMono =/g) || []).length, 3, "R1 monotonic: declaration + stamp + clear only");
});

console.log(`\n${pass}/${pass} PASS`);
