// [A-698 M3] Send recovery shares the Check/Open attempt slot + minimal appLock guard. Node-only, no browser/network/tx.
//   node app/test/a698-send-slot-lock-guard.mjs
// Real main.js functions (sendPiggyOnce, beginAuthAttempt, boundAuthAttempt, trackPlatformAuth, finishAuthAttempt,
// invalidateLiveAuthAttempt, lockAppAfterIdle, webAuthnUnsupported) run in a vm over spies. requestGrant /
// signDigest / sendTransaction are counters: any money step reached is visible.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); } else { fail += 1; console.log(`FAIL  ${name}${extra ? ` (${extra})` : ""}`); }
}
function cutFn(name, async = false) {
  const start = MAIN.indexOf(`${async ? "async " : ""}function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  return MAIN.slice(start, MAIN.indexOf("\n}\n", start) + 2);
}
// [A-707 M2-beta] harness wiring only: Send now reserves (sync, before any auth attempt) and confirms the reservation under a short lock before
// grant. These are the REAL main.js helpers over a fake storage and fake Web Locks; the assertions below are unchanged except where a707 adds.
function cutRange(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  const end = MAIN.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`range not found: ${startMarker}`);
  return MAIN.slice(start, end);
}
const RESERVE_SRC = `const SEND_PENDING_KEY = "araso.sendPending"; const SEND_PENDING_STAGES = ["reserved", "deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"];\n` +
  cutFn("readSendPending") + "\n" + cutFn("writeSendPending") + "\n" + cutRange("const SEND_LOCK_NAME", "// 보낸 뒤의 phase 갱신은");
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
const FAIL_COPY = ["birth", "Chog could not wake Piggy.", ""];
const flush = () => new Promise((r) => setImmediate(r));

function world({ session = false, locked = false, unsupported = false, recover = "resolve", preAttempt = false, preInflight = false } = {}) {
  const calls = { grant: 0, sign: 0, sendTx: 0, recover: 0, endSession: 0, scenes: [], failNote: 0, okNote: 0, safeErrors: [], timers: [] };
  let deferred;
  const ctx = {
    calls,
    localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    navigator: { locks: fakeLocks() },
    crypto: globalThis.crypto,
    keccak256: () => "0x" + "ab".repeat(32),
    MONAD_TESTNET: { id: 10143 },
    publicClient: { sendRawTransaction: async () => { calls.sendTx += 1; return "0x"; } },
    state: { address: "0xabc", appLock: locked ? { phase: "waiting", cancelled: false } : null, credential: { credentialId: "c" }, scene: "sendstay", authPhase: "x", authCancelled: true },
    signerSince: session ? Date.now() : 0, // [A-896 harness wiring] live signer stamped now (wall clock) so sendPiggyOnce's 60 s margin check sees a fresh signer
    activeAccount: session ? { address: "0xabc" } : null,
    activeSession: session ? { signDigest: async () => { calls.sign += 1; return { compact: new Uint8Array([1]), recovery: 0 }; } } : null,
    isAllowedPiggyRpId: () => true,
    setScene: (...a) => { calls.scenes.push(a); ctx.state.scene = a[0]; },
    render() {}, appLockSurface: () => true, readPiggyName: () => "P",
    webAuthnUnsupported: () => unsupported,
    UNLOCK_UI_WAIT_MS: 45000,
    setTimeout: (fn, ms) => { calls.timers.push(fn); return calls.timers.length; },
    clearTimeout: () => {},
    namedAuthError: (name, message) => { const e = new Error(message); e.name = name; return e; },
    isCancelledAuthError: (e) => !!e && e.name === "NotAllowedError",
    noteRecoverSuccess: () => { calls.okNote += 1; }, noteRecoverFailure: () => { calls.failNote += 1; },
    recordSafeError: (...a) => calls.safeErrors.push(a),
    endActiveSession: () => { calls.endSession += 1; ctx.activeAccount = null; ctx.activeSession = null; },
    requestGrant: async () => { calls.grant += 1; throw new Error("stop-at-grant"); },
    simulateSend: async () => { throw new Error("sim"); },
    createWalletClient: () => ({ sendTransaction: async () => { calls.sendTx += 1; return "0x"; } }),
    recoverPiggy: (opts = {}) => {
      calls.recover += 1;
      ctx.lastRecoverOpts = opts;
      if (recover === "resolve") return Promise.resolve().then(() => { ctx.signerSince = Date.now(); ctx.activeAccount = { address: "0xabc" }; ctx.activeSession = { signDigest: async () => { calls.sign += 1; return { compact: new Uint8Array([1]), recovery: 0 }; } }; });
      if (recover === "cancel") return Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
      // "pending": settled by hand; like the real recoverPiggy, a result that is no longer current is discarded (no signer set).
      return new Promise((resolve, reject) => { deferred = { resolve: () => { if (opts.isCurrent()) { ctx.signerSince = Date.now(); ctx.activeAccount = { address: "0xabc" }; ctx.activeSession = { signDigest: async () => { calls.sign += 1; return {}; } }; } resolve(); }, reject }; });
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    `let authAttempt = null; let platformAuthInflight = null;\n` +
      RESERVE_SRC + "\n" + [cutFn("trackPlatformAuth"), cutFn("beginAuthAttempt"), cutFn("boundAuthAttempt"), cutFn("finishAuthAttempt"), cutFn("invalidateLiveAuthAttempt"), cutFn("lockAppAfterIdle"), cutFn("sendPiggyOnce", true)].join("\n") +
      `\nholdSendTabLock();\nglobalThis.__f = {reservation: () => sendReservation, pending: () => readSendPending(),  sendPiggyOnce, lockAppAfterIdle, getAttempt: () => authAttempt, getInflight: () => platformAuthInflight, setAttempt: (a) => { authAttempt = a; }, setInflight: (v) => { platformAuthInflight = v; } };`,
    ctx,
  );
  if (preAttempt) ctx.__f.setAttempt({ kind: "check", live: true });
  if (preInflight) ctx.__f.setInflight({});
  return { ctx, calls, f: ctx.__f, settle: () => deferred };
}
// [A-707 r2] this tab's own pre-lock reservation record (araso.sendPending.reserve.<tabId>), or null.
const tabRes = (w) => { const k = w.f.reservation()?.key; const raw = k ? w.ctx.localStorage.getItem(k) : null; return raw ? JSON.parse(raw) : null; };
const scene = (calls, i = -1) => JSON.stringify(calls.scenes.at(i));
const failed = (calls) => scene(calls) === JSON.stringify(FAIL_COPY);

// 1 happy recovery shares the slot and proceeds to grant
{
  const w = world({});
  const p = w.f.sendPiggyOnce();
  check("recovery begins a 'send' attempt in the shared slot", w.f.getAttempt()?.kind === "send" && w.calls.recover === 1);
  await p;
  check("recovered -> slot released, platform inflight cleared, proceeds to requestGrant once", w.f.getAttempt() === null && w.f.getInflight() === null && w.calls.grant === 1 && w.calls.okNote === 1);
  check("recovery carries an attempt token (isCurrent)", typeof w.ctx.lastRecoverOpts.isCurrent === "function");
}
// 2-4 refusals (existing failure copy, no begin / recover / grant)
for (const [label, opt] of [["authAttempt live (Check/Open)", { preAttempt: true }], ["platformAuthInflight open", { preInflight: true }], ["webAuthn get unsupported", { unsupported: true }]]) {
  const w = world(opt);
  await w.f.sendPiggyOnce();
  check(`refuse when ${label}: existing failure card, 0 recover / 0 grant / 0 sign`, failed(w.calls) && w.calls.recover === 0 && w.calls.grant === 0 && w.calls.sign === 0 && w.calls.scenes.length === 1);
  if (opt.preAttempt) check("refusal leaves the other flow's attempt untouched", w.f.getAttempt()?.kind === "check");
}
// 5 cancel -> failure card, slot released
{
  const w = world({ recover: "cancel" });
  await w.f.sendPiggyOnce();
  check("recover cancelled: failure card, authCancelled, slot released, 0 grant", failed(w.calls) && w.ctx.state.authCancelled === true && w.f.getAttempt() === null && w.calls.grant === 0);
}
// 6 concurrent second send while first recovering
{
  const w = world({ recover: "pending" });
  const p1 = w.f.sendPiggyOnce();
  await w.f.sendPiggyOnce();
  // [A-707 M2-beta re-pin, named reason] the reservation record (written before the attempt) now refuses a second send in the same tab before the
  // attempt-slot refusal is reached: same single-recover guarantee, now with the existing busy card instead of the failure card.
  check("second send during live recovery is refused (1 recover total, existing busy card)", w.calls.recover === 1 && JSON.stringify(w.calls.scenes.at(-1)) === JSON.stringify(["sendstay", "Piggy is home.", "Confirmation is still catching up."]));
  w.settle().resolve(); await p1;
  check("first send continues to grant after its own recovery", w.calls.grant === 1 && w.f.getAttempt() === null);
}
// 7 timeout: failure card, slot freed, platform request still tracked; late settle -> nothing
{
  const w = world({ recover: "pending" });
  const p = w.f.sendPiggyOnce();
  w.calls.timers[0]();
  await p;
  check("timeout: failure card, slot released, 0 grant", failed(w.calls) && w.f.getAttempt() === null && w.calls.grant === 0);
  check("timeout: platform request still tracked until it settles (no overlapping get)", w.f.getInflight() !== null);
  w.settle().resolve(); await flush();
  check("late passkey after timeout: 0 grant / 0 sign / 0 broadcast, inflight cleared", w.calls.grant === 0 && w.calls.sign === 0 && w.calls.sendTx === 0 && w.f.getInflight() === null && w.ctx.activeSession === null);
}
// 8 H7: idle lock while passkey sheet is open (real lockAppAfterIdle), passkey arrives late
{
  const w = world({ recover: "pending" });
  const p = w.f.sendPiggyOnce();
  const before = w.calls.scenes.length;
  w.f.lockAppAfterIdle();
  await p;
  check("H7 idle lock invalidates the Send attempt: app locked, slot released", w.ctx.state.appLock !== null && w.f.getAttempt() === null);
  check("H7 stale Send leaves the lock screen alone (no scene write after lock)", w.calls.scenes.length === before);
  w.settle().resolve(); await flush();
  check("H7 late passkey after idle lock: 0 grant / 0 sign / 0 broadcast, no signer kept", w.calls.grant === 0 && w.calls.sign === 0 && w.calls.sendTx === 0 && w.ctx.activeSession === null && w.f.getInflight() === null);
}
// 9 H7b: recovery already resolved, but app locked before continuation (guard, no invalidation)
{
  const w = world({ recover: "resolve" });
  const p = w.f.sendPiggyOnce();
  w.ctx.state.appLock = { phase: "waiting", cancelled: false }; // locked without touching the attempt
  await p;
  check("H7b locked after recovery: existing failure card, signer ended, 0 grant / 0 sign / 0 broadcast", failed(w.calls) && w.calls.endSession === 1 && w.calls.grant === 0 && w.calls.sign === 0 && w.calls.sendTx === 0);
}
// 10 live session but app locked: no money ([A-1298] every Send asks Face ID first; the lock guard still stops before any grant)
{
  const w = world({ session: true, locked: true });
  await w.f.sendPiggyOnce();
  check("locked with live session: guard stops before requestGrant (after the Send's own Face ID), endActiveSession once", failed(w.calls) && w.calls.recover === 1 && w.calls.grant === 0 && w.calls.endSession === 1);
}
// 11 unlocked live session: [A-1298] the Send still asks Face ID (one bounded attempt, finished), then grant
{
  const w = world({ session: true });
  await w.f.sendPiggyOnce();
  check("unlocked live session: one Face ID (attempt finished), grant reached once", w.calls.recover === 1 && w.calls.grant === 1 && w.calls.endSession === 0 && w.f.getAttempt() === null);
}
// 12 source order
{
  const src = cutFn("sendPiggyOnce", true);
  const at = (s) => src.indexOf(s);
  check("order: refuse -> beginAuthAttempt -> bounded recover -> finish -> appLock guard -> requestGrant",
    at("platformAuthInflight") > 0 && at("platformAuthInflight") < at('beginAuthAttempt("send")') && at('beginAuthAttempt("send")') < at("boundAuthAttempt(") &&
    at("boundAuthAttempt(") < at("finishAuthAttempt(attempt)") && at("finishAuthAttempt(attempt)") < at("if (state.appLock)") && at("if (state.appLock)") < at("requestGrant("));
  check("no bare unbounded recoverPiggy() in sendPiggyOnce; recoverPiggy only inside trackPlatformAuth+boundAuthAttempt", !/await recoverPiggy\(\)/.test(src) && /boundAuthAttempt\(attempt, trackPlatformAuth\(recoverPiggy\(\{ isCurrent: \(\) => attempt\.live \}\)\)\)/.test(src));
  check("every exit after beginAuthAttempt finishes the attempt (catch + success path)", (src.match(/finishAuthAttempt\(attempt\)/g) || []).length === 2);
  check("no new user copy: only existing setScene strings", !/setScene\("[a-z]+", "(?!Piggy is waking up\.|Piggy is asking to go out\.|Chog could not wake Piggy\.|Not from here\.|Piggy can't go out yet\.|Piggy went out\.|relayer unreachable|Piggy is home|Piggy stayed)/.test(src.slice(0, src.indexOf("requestGrant("))));
}
// 13 [A-707 M2-beta] reservation lifecycle at the A-698 exits (the new rows; every row above is unchanged)
{
  const w = world({ recover: "pending" });
  const p = w.f.sendPiggyOnce();
  // [A-707 r2 re-baseline, named reason: tab-scoped reservation] the pre-passkey reservation now lives ONLY in this tab's key
  // (araso.sendPending.reserve.<tabId>); the shared araso.sendPending is written only under the exclusive lock (confirm), so it is still empty here.
  check("A-707 reservation record exists while the recovery passkey is pending (written before beginAuthAttempt, 0 grant)", tabRes(w)?.stage === "reserved" && w.f.pending() === null && w.f.getAttempt()?.kind === "send" && w.calls.grant === 0);
  w.f.lockAppAfterIdle();
  await p;
  check("A-707 stale attempt (idle lock invalidated it): reservation cleared, nothing signed", w.f.pending() === null && tabRes(w) === null && w.calls.sign === 0 && w.calls.sendTx === 0);
}
{
  const w = world({ recover: "cancel" });
  await w.f.sendPiggyOnce();
  check("A-707 recover cancelled: reservation cleared", w.f.pending() === null && tabRes(w) === null);
}
{
  const w = world({ recover: "pending" });
  const p = w.f.sendPiggyOnce();
  w.calls.timers[0]();
  await p;
  check("A-707 recover timeout: reservation cleared", w.f.pending() === null && tabRes(w) === null);
}
{
  const w = world({ preAttempt: true });
  await w.f.sendPiggyOnce();
  check("A-707 attempt-slot refusal: reservation cleared and the other flow's attempt untouched", w.f.pending() === null && tabRes(w) === null && w.f.getAttempt()?.kind === "check");
}
{
  const w = world({ recover: "resolve" });
  const p = w.f.sendPiggyOnce();
  w.ctx.state.appLock = { phase: "waiting", cancelled: false };
  await p;
  check("A-707 lock guard stop: reservation cleared, 0 grant / 0 sign / 0 broadcast", w.f.pending() === null && w.calls.grant === 0 && w.calls.sign === 0 && w.calls.sendTx === 0);
}
{
  const w = world({ session: true });
  await w.f.sendPiggyOnce();
  check("A-707 grant failure (live session): reservation cleared before the failure card", w.f.pending() === null && w.calls.grant === 1);
}
{
  const src = cutFn("sendPiggyOnce", true);
  const at = (x) => src.indexOf(x);
  check("A-707 order: reserveSend() -> platformAuthInflight refusal -> beginAuthAttempt -> ... -> confirmSendReservation -> appLock guard -> requestGrant, with no async wait before the reservation",
    at("reserveSend()") > 0 && at("reserveSend()") < at("platformAuthInflight") && at("platformAuthInflight") < at('beginAuthAttempt("send")') &&
    at("confirmSendReservation(") > at("finishAuthAttempt(attempt)") && at("confirmSendReservation(") < at("if (state.appLock)") && at("if (state.appLock)") < at("requestGrant(") && !/await|setTimeout/.test(src.slice(0, at("reserveSend()"))));
}
console.log(`\nA-698: ${pass}/${pass + fail} PASS`);
if (fail) process.exitCode = 1;
