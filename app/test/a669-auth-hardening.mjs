// A-669 [AUTH HARDENING · PRE-NEXT GAP CLOSE] — node-only regression contract.
//   node app/test/a669-auth-hardening.mjs
//
// Runs main.js / piggy-index.js ACTUAL function text (node:vm, same technique as a667-recovery-creation-storage.mjs) or
// the real ESM exports over deterministic stubs. WebAuthn = controllable deferred per call · fake clock.
// Network 0 · browser 0 · real WebAuthn 0 · keys 0 · tx 0.
// Lanes:
//   IDLE  idle-lock / session end vs a pending Check/Open attempt (deterministic timer ordering)
//   PRF   zeroing at proveFundingTargetControl / requestMoneyPermission / admitSequencedPiggy (+ zeroing-only proof)
//   SEQ   additional-Piggy = ONE passkey + per-sequence salt, no reuse, no scan, no unbound address, missing index authority
//   SEND  Send recovery lane is OWNER_INPUT_REQUIRED (left pre-A-669) — source pins only, see VERIFY.md
// Limits: not iOS. Real passkey sheet / background / bfcache stays HUMAN.
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { admitModelAPiggy, admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey } from "../src/piggy-index.js";
import { modelASaltHex } from "../src/piggy-session.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const INDEX_SRC = readFileSync(new URL("../src/piggy-index.js", import.meta.url), "utf8");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const norm = (x) => JSON.parse(JSON.stringify(x) ?? "null");
const deq = (a, b, msg) => assert.deepEqual(norm(a), norm(b), msg);
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 8).join("\n      ")}`); fail += 1; }
}
// Brace-matched body from the declaration line start (includes `export ` / `async `), string/comment aware enough for these fns.
function bodyOf(src, name) {
  const m = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, "m").exec(src);
  if (!m) throw new Error(`function missing: ${name}`);
  let k = src.indexOf("(", m.index);
  for (let pd = 0; k < src.length; k += 1) { if (src[k] === "(") pd += 1; else if (src[k] === ")") { pd -= 1; if (pd === 0) break; } }
  let depth = 0;
  let inStr = null;
  for (let i = src.indexOf("{", k); i < src.length; i += 1) {
    const c = src[i];
    if (inStr) { if (c === "\\") { i += 1; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const fnBody = (name) => bodyOf(MAIN, name);
let finished = false;
process.on("exit", () => { if (!finished) { console.log("FAIL  run ended on an unsettled promise"); process.exitCode = 1; } });
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
const WAIT_MS = Number((MAIN.match(/const UNLOCK_UI_WAIT_MS = ([\d_]+);/) || [])[1]?.replace(/_/g, ""));
const IDLE_MS = 10 * 60 * 1000;

// Pre-A-669 sha256 pins (concatenated so no raw 64-hex literal sits in this file).
const PRE = {
  requestMoneyPermission: "905ac3b10d261a22" + "bca9ecec3e0c9409" + "371895f782257a09" + "4f408baa1d561dd1",
  proveFundingTargetControl: "75510cd7a119811d" + "a1437fafb7959ab3" + "677c9500ba9d641d" + "23569f868ed6bf72",
  admitSequencedPiggy: "c04fa2bfb30fa441" + "ebc1bf2e40bf8d9b" + "eb3c4f7935856f8b" + "e2b85daa70ff3e29",
  sendPiggyOnce: "33e13215c9fc55c2" + "a6a57758de638d7f" + "c363231353541cb0" + "d251b7cc7af3a730",
  render: "866133cf60711093" + "9b5ce2b05ad9ff25" + "3ee7ab77f8448b39" + "77faa974a9d3e27c",
};

// ═══ shared device harness (a667 shape) + real idle/lock/activity functions ════════════════════
function makeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    now: () => now,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let pick = null;
        for (const [id, t] of timers) if (t.at <= target && (!pick || t.at < pick[1].at)) pick = [id, t];
        if (!pick) break;
        timers.delete(pick[0]); now = pick[1].at; pick[1].fn();
      }
      now = target;
    },
    count: () => timers.size,
  };
}
const key = (n) => new Uint8Array(32).fill(n);
const addrOf = (k) => `0xADDR${k[0]}`;
const KEYS = { cred: "araso.passkey", addr: "araso.address", salt: "araso.prfSalt", recv: "araso.piggyReceived" };
const OLD_ADDR = "0xADDR11";

const DEVICE_FNS = [
  "endSignerSession", "endActiveSession", "touchAppSession", "armSignerExpiry", "activateSigningSession",
  "appLockSurface", "lockAppAfterIdle", "handleTrustedAppActivity",
  "namedAuthError", "identityStorageKeys", "snapshotIdentity", "restoreIdentity", "commitIdentity",
  "beginAuthAttempt", "boundAuthAttempt", "expireStaleAuthState", "finishAuthAttempt", "invalidateLiveAuthAttempt", "trackPlatformAuth",
  "isCancelledAuthError", "recoverPiggy", "noteRecoverSuccess", "noteRecoverFailure", "openPiggy", "startPiggyOpen", "checkPiggy",
].map(fnBody).join("\n");

function device({ stored = true, width = 390 } = {}) {
  const clock = makeClock();
  const store = new Map();
  if (stored) {
    store.set(KEYS.cred, JSON.stringify({ credentialId: "OLD", transports: ["internal"] }));
    store.set(KEYS.addr, OLD_ADDR);
    store.set(KEYS.recv, "1");
    store.set("araso.piggyName", "Honeybun");
  }
  const calls = { get: [], create: [], scenes: [], index: [], ended: 0, sessions: 0, errors: [], renders: 0 };
  const pending = { get: [], create: [] };
  const ctx = {
    console, Uint8Array, JSON, Promise, Error, Map,
    Date: { now: clock.now },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    window: { innerWidth: width },
    PASSKEY_STORAGE_KEY: KEYS.cred, PIGGY_RECEIVED_KEY: KEYS.recv,
    UNLOCK_UI_WAIT_MS: WAIT_MS, FRESH_DEVICE_RECOVERY_FIRST: true, INDEX_BACKUP_ADAPTER: null,
    state: {
      scene: "sendstay", message: "", detail: "", authPhase: "idle", authCancelled: false, homePaperMode: "home",
      credential: stored ? { credentialId: "OLD", transports: ["internal"] } : null,
      address: stored ? OLD_ADDR : "",
      activeSignerAddress: "", recoverFailures: 0, noPiggy: false, freshRecoveryTried: false, appLock: null,
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    isMeraError: (e) => !!e && e.__mera === true,
    isAllowedPiggyRpId: () => true,
    storedPrfSalt: () => null,
    getRpId: () => "localhost",
    localTestWebAuthnOption: () => ({}),
    localTestPrfSaltOption: () => ({}),
    toHex: (b) => Buffer.from(b).toString("hex"),
    requestPrf: (credential) => new Promise((resolve, reject) => { calls.get.push(credential); pending.get.push({ resolve, reject }); }),
    createPasskeyWithPrfOutput: () => new Promise((resolve, reject) => { calls.create.push(1); pending.create.push({ resolve, reject }); }),
    createSecp256k1SigningSession: ({ privateKey }) => { calls.sessions += 1; const copy = new Uint8Array(privateKey); return { publicKey: copy, end() { calls.ended += 1; } }; },
    toViemAccount: (s) => ({ address: addrOf(s.publicKey) }),
    getEvmAddress: (pk) => addrOf(pk),
    indexControlledPiggy: (row) => { calls.index.push(row); return { ok: true }; },
    setScene: (scene, message = "", detail = "") => { calls.scenes.push([scene, message]); Object.assign(ctx.state, { scene, message, detail }); },
    readPiggyName: () => store.get("araso.piggyName") || "",
    hasPlayedBirth: () => true,
    takePendingGiftClaim: () => null,
    knownPiggyAddresses: () => [],
    restorePendingGiftClaim: () => {},
    recordSafeError: (phase, e) => { calls.errors.push([phase, e?.name]); },
    readCredential: () => { try { return JSON.parse(store.get(KEYS.cred) || "null"); } catch { return null; } },
    hasReceivedPiggy: () => store.get(KEYS.recv) === "1",
    render: () => { calls.renders += 1; },
    settleUnlock: () => {},
    unlockWaitTimeoutError: () => Object.assign(new Error("u"), { name: "UnlockWaitTimeout" }),
  };
  vm.createContext(ctx);
  vm.runInContext(`let activeSession = null; let activeAccount = null; let idleTimer = null; let signerExpiryTimer = null; let authAttempt = null;
let platformAuthInflight = null; let lateCreatedCredential = null;
const TRUSTED_APP_ACTIVITY_THROTTLE_MS = 15 * 1000; let lastTrustedAppActivityAt = -Infinity;
${DEVICE_FNS}
this.api = { recoverPiggy, checkPiggy, openPiggy, touchAppSession, beginAuthAttempt, boundAuthAttempt, finishAuthAttempt, invalidateLiveAuthAttempt, trackPlatformAuth, handleTrustedAppActivity, activateSigningSession };
this.peek = () => ({ signer: !!activeSession, idleTimer: idleTimer !== null, signerTimer: signerExpiryTimer !== null, attempt: !!authAttempt, inflight: !!platformAuthInflight });
this.attempt = () => authAttempt;
this.late = () => lateCreatedCredential;`, ctx);
  const snap = () => Object.fromEntries([...store.entries()].sort());
  return { ctx, clock, store, calls, pending, state: ctx.state, api: ctx.api, peek: ctx.peek, attempt: ctx.attempt, late: ctx.late, snap };
}
const resolveGet = (d, i, credentialId, k) => d.pending.get[i].resolve({ credentialId, prfOutput: k });
const resolveCreate = (d, i, credentialId, k) => d.pending.create[i].resolve({ credentialId, transports: ["internal"], prfOutput: k, prfSalt: new Uint8Array(32).fill(2) });
// app session alive, idle fires `leftMs` from now.
function armIdleWith(d, leftMs) { d.api.touchAppSession(); d.clock.advance(IDLE_MS - leftMs); }

// ═══ IDLE lane ═════════════════════════════════════════════════════════════════════════════════
await check("IDLE-1 idle fires during a pending Check Piggy → attempt invalidated at once; late SUCCESS: no signer, no idle re-arm, no write, no navigation, PRF zeroed", async () => {
  const d = device();
  armIdleWith(d, 5_000);
  const run = d.api.checkPiggy();
  const before = d.snap();
  assert.equal(d.peek().attempt, true);
  d.clock.advance(5_000); // idle (10m) fires well inside the 45s bound
  await flush();
  deq(await run, { ok: false, cancelled: false, reason: "superseded" }, "caller sees superseded, not a failure card");
  deq(d.calls.scenes.at(-1), ["sendstay", "Piggy is resting."], "idle destination (birth scene is not lockable → existing resting path)");
  const scenesAtIdle = d.calls.scenes.length;
  deq(d.peek(), { signer: false, idleTimer: false, signerTimer: false, attempt: false, inflight: true }, "session ended; platform request still honestly open");
  const late = key(11);
  resolveGet(d, 0, "OLD", late);
  await flush();
  assert.equal(d.calls.scenes.length, scenesAtIdle, "late result navigates nowhere");
  deq(d.peek(), { signer: false, idleTimer: false, signerTimer: false, attempt: false, inflight: false }, "no signer / idle / signer timer re-armed");
  assert.equal(d.calls.sessions, 0, "no signing session ever created");
  deq(d.snap(), before, "no persist");
  deq(d.calls.index, [], "no index row");
  assert.ok(late.every((b) => b === 0), "late PRF output zeroed");
  assert.equal(d.calls.get.length, 1, "no automatic WebAuthn after idle");
});

await check("IDLE-2 idle fires during a pending Open (create) → late CREATE success: no identity/signer/navigation, PRF zeroed, orphan kept in memory only (next Open finds first)", async () => {
  const d = device({ stored: false });
  d.state.freshRecoveryTried = true;
  armIdleWith(d, 3_000);
  const run = d.api.openPiggy();
  d.clock.advance(3_000);
  await flush();
  await run;
  const scenesAtIdle = d.calls.scenes.length;
  deq(d.calls.scenes.at(-1), ["sendstay", "Piggy is resting."]);
  const k = key(55);
  resolveCreate(d, 0, "NEWCRED", k);
  await flush();
  assert.equal(d.calls.scenes.length, scenesAtIdle, "no hatch / home navigation");
  deq(d.peek(), { signer: false, idleTimer: false, signerTimer: false, attempt: false, inflight: false });
  assert.equal(d.store.get(KEYS.cred), undefined, "no credential persisted");
  assert.equal(d.state.credential, null);
  assert.ok(k.every((b) => b === 0), "late create PRF zeroed");
  deq(d.late(), { credentialId: "NEWCRED", transports: ["internal"] }, "orphan passkey recorded in memory only (platform-side residual)");
  assert.equal(d.state.freshRecoveryTried, false, "next Open looks up first, never re-creates");
});

await check("IDLE-3 lockable surface: an attempt live while Home is shown → idle LOCKS; late success cannot unlock, persist, navigate or arm a session", async () => {
  const d = device();
  armIdleWith(d, 2_000);
  // a live attempt token on the Home (sendstay) surface, wired exactly like checkPiggy wires recoverPiggy
  const attempt = d.api.beginAuthAttempt("check");
  const bound = d.api.boundAuthAttempt(attempt, d.api.trackPlatformAuth(d.api.recoverPiggy({ isCurrent: () => attempt.live })));
  bound.catch(() => {});
  const before = d.snap();
  d.clock.advance(2_000);
  deq(d.state.appLock, { phase: "waiting", cancelled: false }, "locked");
  deq([d.state.scene, d.state.message], ["sendstay", "Piggy is resting."]);
  const k = key(11);
  resolveGet(d, 0, "OLD", k);
  await flush();
  deq(d.state.appLock, { phase: "waiting", cancelled: false }, "still locked — stale result did not unlock");
  assert.equal(d.calls.sessions, 0);
  deq(d.peek(), { signer: false, idleTimer: false, signerTimer: false, attempt: false, inflight: false });
  deq(d.snap(), before);
  assert.ok(k.every((b) => b === 0));
  assert.equal(d.finishAttempt, undefined);
  assert.equal(d.api.finishAuthAttempt(attempt), false, "the invalidated attempt no longer owns the UI");
});

await check("IDLE-4 idle + the attempt's own 45s bound: exactly ONE transition (idle first → bound timer cleared; bound first → idle finds nothing to invalidate)", async () => {
  // idle first
  const a = device();
  armIdleWith(a, 1_000);
  const runA = a.api.checkPiggy();
  a.clock.advance(1_000);
  await flush();
  const n = a.calls.scenes.length;
  a.clock.advance(WAIT_MS + 1_000); // the bound would have fired here
  await flush();
  deq(await runA, { ok: false, cancelled: false, reason: "superseded" });
  assert.equal(a.calls.scenes.length, n, "no second (failure-card) transition from the dead bound");
  assert.equal(a.calls.errors.length, 0, "no failure recorded twice");
  assert.equal(a.state.recoverFailures, 0, "idle invalidation is not counted as a recover failure");
  // bound first
  const b = device();
  armIdleWith(b, WAIT_MS + 5_000);
  const runB = b.api.checkPiggy();
  b.clock.advance(WAIT_MS);
  await flush();
  deq(await runB, { ok: false, cancelled: false });
  deq(b.calls.scenes.at(-1), ["birth", "Chog could not find Piggy here."], "bound → existing retryable failure card");
  const m = b.calls.scenes.length;
  assert.equal(b.api.invalidateLiveAuthAttempt(), false, "nothing live left");
  b.clock.advance(5_000); // idle fires now
  await flush();
  assert.equal(b.calls.scenes.length, m + 1, "idle adds only its own existing resting transition");
  deq(b.calls.scenes.at(-1), ["sendstay", "Piggy is resting."]);
  assert.equal(b.state.recoverFailures, 1, "the single bound failure counted once");
});

await check("IDLE-5 explicit invalidation → the bounded wait rejects StaleAuthAttempt AND recoverPiggy throws StaleAuthAttempt before any signer/write", async () => {
  const d = device();
  const attempt = d.api.beginAuthAttempt("check");
  const inner = d.api.recoverPiggy({ isCurrent: () => attempt.live });
  const bound = d.api.boundAuthAttempt(attempt, inner);
  const boundErr = bound.then(() => null, (e) => e.name);
  const innerErr = inner.then(() => null, (e) => e.name);
  assert.equal(d.api.invalidateLiveAuthAttempt(), true);
  assert.equal(attempt.live, false);
  assert.equal(await boundErr, "StaleAuthAttempt");
  const before = d.snap();
  const k = key(11);
  resolveGet(d, 0, "OLD", k);
  assert.equal(await innerErr, "StaleAuthAttempt");
  assert.equal(d.calls.sessions, 0);
  deq(d.snap(), before);
  assert.ok(k.every((b) => b === 0));
  assert.equal(d.api.invalidateLiveAuthAttempt(), false, "idempotent");
});

await check("IDLE-6 stale result never replaces a NEWER session: while the stale get is open a new Check is refused (single platform request); after it settles a new Check succeeds and the stale path cannot touch it", async () => {
  const d = device();
  armIdleWith(d, 1_000);
  const stale = d.api.checkPiggy();
  d.clock.advance(1_000);
  await flush();
  await stale;
  const blocked = await d.api.checkPiggy();
  deq(blocked, { ok: false, cancelled: false, reason: "platform_pending" }, "no second get while the first is open");
  assert.equal(d.calls.get.length, 1);
  resolveGet(d, 0, "OLD", key(11)); // stale success settles the platform request
  await flush();
  assert.equal(d.peek().inflight, false);
  const fresh = d.api.checkPiggy();
  resolveGet(d, 1, "OLD", key(11));
  deq(await fresh, { ok: true });
  deq(d.peek(), { signer: true, idleTimer: true, signerTimer: true, attempt: false, inflight: false }, "the newer session is intact");
  assert.equal(d.calls.ended, 0, "the stale path ended nothing of the newer session");
});

await check("IDLE-7 normal (no idle) Check Piggy is unchanged: success → Home, live signer WITH expiry + idle", async () => {
  const d = device();
  const run = d.api.checkPiggy();
  resolveGet(d, 0, "OLD", key(11));
  deq(await run, { ok: true });
  deq([d.state.scene, d.state.message], ["sendstay", "Piggy is home."]);
  deq(d.peek(), { signer: true, idleTimer: true, signerTimer: true, attempt: false, inflight: false });
});

await check("IDLE-8 trusted-activity throttle during a live attempt only re-arms app-idle — never touches the attempt, bound or platform marker", async () => {
  const d = device();
  armIdleWith(d, 30_000);
  const run = d.api.checkPiggy();
  const attempt = d.attempt();
  d.clock.advance(20_000);
  d.api.handleTrustedAppActivity({ isTrusted: true, type: "pointerdown" });
  d.api.handleTrustedAppActivity({ isTrusted: true, type: "keydown" });
  d.api.handleTrustedAppActivity({ isTrusted: false, type: "pointerdown" });
  assert.equal(d.attempt(), attempt, "same attempt object");
  assert.equal(attempt.live, true);
  deq(d.peek(), { signer: false, idleTimer: true, signerTimer: false, attempt: true, inflight: true });
  d.clock.advance(15_000); // past the original idle deadline — activity moved it, so no invalidation
  assert.equal(attempt.live, true, "idle was re-armed by activity, attempt untouched");
  resolveGet(d, 0, "OLD", key(11));
  deq(await run, { ok: true });
  const src = fnBody("handleTrustedAppActivity").replace(/\/\/.*$/gm, ""); // code only (its comments name what it does NOT call)
  assert.equal(/authAttempt|invalidateLiveAuthAttempt|platformAuthInflight|requestPrf|activateSigningSession/.test(src), false, "source: activity handler reaches no auth state");
});

await check("IDLE-9 source: idle callback order = endActiveSession → lockAppAfterIdle; lockAppAfterIdle invalidates BEFORE any early return; invalidation calls no WebAuthn; touchAppSession unchanged", () => {
  const lock = fnBody("lockAppAfterIdle");
  const inv = lock.indexOf("invalidateLiveAuthAttempt();");
  assert.ok(inv > 0 && inv < lock.indexOf("return false"), "invalidate precedes every return");
  const helper = fnBody("invalidateLiveAuthAttempt");
  assert.equal(/requestPrf|createPasskeyWithPrfOutput|unlockApp|checkPiggy|openPiggy|platformAuthInflight\s*=/.test(helper), false);
  const touch = fnBody("touchAppSession");
  assert.ok(touch.indexOf("endActiveSession();") < touch.indexOf("lockAppAfterIdle()"));
  assert.equal(sha(touch).slice(0, 16), "cd44c821c6781492", "touchAppSession byte-identical (protected)");
});

// ═══ PRF lane ══════════════════════════════════════════════════════════════════════════════════
// Strip exactly the A-669 zeroing delta from a current function text; must give back the pre-A-669 bytes.
function stripMoneyPermission(src) {
  return src
    .replace("  let result = null;\n  try {\n    // 여기서 실제로", "  try {\n    // 여기서 실제로")
    .replace("    result = await requestPrf(request.credential", "    const result = await requestPrf(request.credential")
    .replace(/\n  \} finally \{\n    \/\/ \[A-669\][^\n]*\n    if \(result && result\.prfOutput instanceof Uint8Array\) result\.prfOutput\.fill\(0\);\n  \}/, "\n  }");
}
function stripFundingProof(src) {
  return src
    .replace("  let address;\n  let result = null;\n", "  let address;\n")
    .replace("    result = await requestPrf(request.credential", "    const result = await requestPrf(request.credential")
    .replace(/\n  \} finally \{\n    \/\/ \[A-669\][^\n]*\n    if \(result && result\.prfOutput instanceof Uint8Array\) result\.prfOutput\.fill\(0\);\n  \}/, "\n  }");
}
const NEW_ADMIT_BLOCK = `  let address;
  try {
    // 돌아온 credential 이 우리가 고정한 그 루트인가 — 루트가 조용히 바뀌지 않게.
    if (!result || result.credentialId !== rootId) return refuse("root_credential_mismatch");
    try {
      address = deriveAddress(result.prfOutput);          // **라이브 파생** — 이 salt 로만
    } catch {
      return refuse("derive_failed");
    }
  } finally {
    // [A-669] PRF 출력은 주소 파생에만 쓰고 성공·거부·실패 모두 여기서 0 으로 지운다(돌려주거나 보관 0).
    if (result && result.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
  }`;
const OLD_ADMIT_BLOCK = `  // 돌아온 credential 이 우리가 고정한 그 루트인가 — 루트가 조용히 바뀌지 않게.
  if (!result || result.credentialId !== rootId) return refuse("root_credential_mismatch");
  let address;
  try {
    address = deriveAddress(result.prfOutput);            // **라이브 파생** — 이 salt 로만
  } catch {
    return refuse("derive_failed");
  }`;

await check("PRF-0 zeroing-only delta: removing exactly the A-669 zeroing lines restores the pre-A-669 bytes of all three callers (sha256)", () => {
  const rmp = fnBody("requestMoneyPermission");
  assert.notEqual(sha(rmp), PRE.requestMoneyPermission, "requestMoneyPermission did change");
  assert.equal(sha(stripMoneyPermission(rmp)), PRE.requestMoneyPermission, "requestMoneyPermission minus zeroing == pre-A-669");
  assert.equal(sha(stripFundingProof(fnBody("proveFundingTargetControl"))), PRE.proveFundingTargetControl, "proveFundingTargetControl minus zeroing == pre-A-669");
  const adm = bodyOf(INDEX_SRC, "admitSequencedPiggy");
  assert.ok(adm.includes(NEW_ADMIT_BLOCK));
  assert.equal(sha(adm.replace(NEW_ADMIT_BLOCK, OLD_ADMIT_BLOCK)), PRE.admitSequencedPiggy, "admitSequencedPiggy minus zeroing/finally == pre-A-669");
  assert.equal(sha(fnBody("render")), PRE.render, "render() byte-identical");
});

// requestMoneyPermission / proveFundingTargetControl over stubs. `variant` = current text or the stripped pre-A-669 text.
function moneyHarness(fnSrc, { prf = "ok", activateThrows = false, bindOk = true } = {}) {
  const calls = { log: [], prfBuf: null, sessionCopy: null };
  const sel = { id: "p1", address: "0x" + "11".repeat(20) };
  const ctx = {
    console, Uint8Array, JSON, Promise, Error, Set,
    Date: class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [1_700_000_000_000])); } static now() { return 1_700_000_000_000; } },
    crypto: { getRandomValues: (b) => b.fill(9) },
    state: { moneyIntent: { status: "awaiting", piggyId: "p1", action: "send", amount: "1", asset: "USDC" }, selectedPiggy: sel },
    PERMISSION_STATE: { AWAITING: "awaiting", FAILED: "failed", PERMITTED: "permitted" },
    render: () => calls.log.push("render"),
    authRequestForPiggy: () => ({ request: { credential: { credentialId: "C" }, prfSalt: null }, error: null }),
    selectedRegistryPiggy: () => sel,
    requestPrf: async () => {
      calls.log.push("requestPrf");
      if (prf === "reject") throw Object.assign(new Error("x"), { name: "NotAllowedError" });
      calls.prfBuf = key(7);
      return { credentialId: "C", prfOutput: calls.prfBuf };
    },
    activateSigningSession: (buf) => {
      calls.log.push("activate");
      calls.sessionCopy = new Uint8Array(buf); // Mera copies the key (createSigningKey copyBytes)
      if (activateThrows) throw new Error("derive");
      return { address: sel.address, account: {} };
    },
    bindSigner: (s, a) => (bindOk ? { ok: true, signerAddress: a } : { ok: false, reason: "signer_mismatch" }),
    endActiveSession: () => calls.log.push("endActiveSession"),
    endSignerSession: () => calls.log.push("endSignerSession"),
    cancelPermission: (r) => ({ state: "cancelled", reason: r }),
    secondJourneyScope: () => ({ chainId: "monad-testnet" }),
    permissionNonce: (b) => `nonce:${b.piggyId}:${b.at}`,
    issuePermission: (args) => { calls.log.push(["issue", args]); return { envelope: { ok: 1, ...args.intent }, error: null }; },
    fundingTargetChallenge: (c) => ({ challenge: `ch:${c.piggyId}`, error: null }),
    toHex: (b) => Buffer.from(b).toString("hex"),
    activeAccount: { signMessage: async () => "0xsig" },
  };
  vm.createContext(ctx);
  vm.runInContext(`${fnSrc}\nthis.run = typeof requestMoneyPermission === "function" ? requestMoneyPermission : proveFundingTargetControl;`, ctx);
  return { ctx, calls, sel };
}
const SCEN = [
  { name: "success", opt: {} },
  { name: "auth rejected", opt: { prf: "reject" } },
  { name: "derivation throws", opt: { activateThrows: true } },
  { name: "signer mismatch", opt: { bindOk: false } },
];

await check("PRF-1 requestMoneyPermission: PRF output zeroed on success / derive failure / signer mismatch; signer key copy intact; every observable identical to pre-A-669 text", async () => {
  const cur = fnBody("requestMoneyPermission");
  const pre = stripMoneyPermission(cur);
  for (const s of SCEN) {
    const a = moneyHarness(cur, s.opt);
    const b = moneyHarness(pre, s.opt);
    const ra = await a.ctx.run();
    const rb = await b.ctx.run();
    deq(ra, rb, `${s.name}: return`);
    deq(a.ctx.state.moneyIntent, b.ctx.state.moneyIntent, `${s.name}: permission state/envelope identical`);
    deq(a.calls.log, b.calls.log, `${s.name}: call sequence identical`);
    if (a.calls.prfBuf) {
      assert.ok(a.calls.prfBuf.every((x) => x === 0), `${s.name}: zeroed (current)`);
      assert.ok(b.calls.prfBuf.some((x) => x !== 0), `${s.name}: pre-A-669 left it`);
      assert.ok(a.calls.sessionCopy.every((x) => x === 7), `${s.name}: signer's own copy untouched`);
    }
  }
  const ok = moneyHarness(cur);
  await ok.ctx.run();
  assert.equal(ok.ctx.state.moneyIntent.status, "permitted");
});

await check("PRF-2 proveFundingTargetControl: PRF output zeroed on success / derive failure / signer mismatch; return values identical to pre-A-669 text", async () => {
  const cur = fnBody("proveFundingTargetControl");
  const pre = stripFundingProof(cur);
  for (const s of SCEN) {
    const a = moneyHarness(cur, s.opt);
    const b = moneyHarness(pre, s.opt);
    const ra = await a.ctx.run(a.sel);
    const rb = await b.ctx.run(b.sel);
    deq(ra, rb, `${s.name}: return`);
    deq(a.calls.log, b.calls.log, `${s.name}: call sequence identical`);
    if (a.calls.prfBuf) assert.ok(a.calls.prfBuf.every((x) => x === 0), `${s.name}: zeroed`);
  }
});

// ═══ SEQ lane (real piggy-index.js exports) ════════════════════════════════════════════════════
const CHAIN = "monad-testnet";
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const locks = { request: (_n, _o, fn) => fn() };
const ROOT = { credentialId: "ROOT", transports: ["internal"] };
// deterministic "derivation": address is a function of (passkey, salt) only — PRF output = f(credential, salt).
function prfProvider({ returnCred = null, log = [] } = {}) {
  const bufs = [];
  const requestPrf = async (credential, salt) => {
    log.push({ credentialId: credential?.credentialId ?? null, salt: Buffer.from(salt).toString("hex") });
    const out = new Uint8Array(32);
    const seed = createHash("sha256").update(`${credential?.credentialId}|${Buffer.from(salt).toString("hex")}`).digest();
    out.set(seed);
    bufs.push(out);
    return { credentialId: returnCred ?? credential?.credentialId, prfOutput: out };
  };
  const deriveAddress = (prf) => "0x" + Buffer.from(prf.slice(0, 20)).toString("hex");
  return { requestPrf, deriveAddress, bufs, log };
}

await check("SEQ-1 one passkey + per-sequence salt: every admission asks the SAME pinned root once with salt modelASalt(n), n = issuedThrough+1; PRF zeroed after derivation", async () => {
  const storage = memStorage();
  const p = prfProvider();
  const r1 = await admitModelAPiggy({ storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  const r2 = await admitModelAPiggy({ storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  assert.ok(r1.ok && r2.ok);
  deq(p.log.map((x) => x.credentialId), ["ROOT", "ROOT"], "one passkey only, exactly one request per admission (no scan)");
  deq(p.log.map((x) => x.salt), [modelASaltHex(1), modelASaltHex(2)], "salt is modelASalt(n) for the issued n");
  deq([r1.piggy.sequence, r2.piggy.sequence], [1, 2]);
  assert.notEqual(r1.piggy.address, r2.piggy.address, "distinct sequence → distinct derived address");
  assert.ok(p.bufs.every((b) => b.every((x) => x === 0)), "every PRF output zeroed");
});

await check("SEQ-2 no sequence reuse: a deleted row does not free its number (watermark), an explicit re-admit of an issued n is refused, nothing written", async () => {
  const storage = memStorage();
  const p = prfProvider();
  for (let i = 0; i < 2; i += 1) await admitModelAPiggy({ storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  const k = myPiggiesIndexKey(CHAIN);
  const raw = JSON.parse(storage.getItem(k));
  raw.piggies = raw.piggies.filter((r) => r.sequence !== 2);
  storage.setItem(k, JSON.stringify(raw));
  const r3 = await admitModelAPiggy({ storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  assert.equal(r3.piggy.sequence, 3, "next is 3, never 2 again");
  const before = storage.getItem(k);
  const again = await admitSequencedPiggy({ storage, chainId: CHAIN, sequence: 1, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress, requireNext: true });
  deq([again.ok, again.reason], [false, "stale_sequence"]);
  const gap = await admitSequencedPiggy({ storage, chainId: CHAIN, sequence: 2, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  deq([gap.ok, gap.reason], [false, "stale_sequence"], "a freed-looking lower number is refused even without requireNext");
  assert.equal(storage.getItem(k), before, "index unchanged");
  assert.ok(p.bufs.every((b) => b.every((x) => x === 0)), "refused paths zeroed too");
});

await check("SEQ-3 no unbound derived address: a different passkey answering is refused (root_credential_mismatch), derive failure refused; PRF zeroed on both; no row, no watermark move", async () => {
  const storage = memStorage();
  const other = prfProvider({ returnCred: "OTHER" });
  const r = await admitModelAPiggy({ storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: other.requestPrf, deriveAddress: other.deriveAddress });
  deq([r.ok, r.reason], [false, "root_credential_mismatch"]);
  assert.ok(other.bufs[0].every((x) => x === 0), "mismatch path zeroed");
  const p = prfProvider();
  let seen = null;
  const bad = await admitModelAPiggy({ storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: (buf) => { seen = buf; throw new Error("x"); } });
  deq([bad.ok, bad.reason], [false, "derive_failed"]);
  assert.ok(seen.every((x) => x === 0), "derive-failure path zeroed");
  const { index } = loadMyPiggiesIndex(storage, CHAIN);
  deq([index.issuedThrough, index.piggies.length], [0, 0]);
});

await check("SEQ-4 missing index authority (new device, INDEX_BACKUP_ADAPTER = null): Check Piggy recovers the root only — one WebAuthn request, no sequence guessing, no salt scan, no additional-Piggy rows", async () => {
  assert.ok(/\nconst INDEX_BACKUP_ADAPTER = null;\n/.test(MAIN), "no remote index authority wired");
  const check = fnBody("checkPiggy");
  assert.ok(check.includes("if (INDEX_BACKUP_ADAPTER) {"), "list restore only behind the (null) adapter");
  const d = device({ stored: false });
  const run = d.api.checkPiggy();
  resolveGet(d, 0, "ROOTFOUND", key(44));
  deq(await run, { ok: true });
  assert.equal(d.calls.get.length, 1, "exactly one platform request");
  deq(d.calls.index.map((r) => r.prfSaltHex), [null], "only the root row (default salt) — no modelASalt(n) probing");
  // source: no product loop asks requestPrf over sequence numbers; modelASalt is derived only inside admitSequencedPiggy
  assert.equal((MAIN.match(/modelASalt\(/g) || []).length, 0, "main.js never derives a sequence salt itself");
  assert.equal((INDEX_SRC.match(/await modelASalt\(/g) || []).length, 1, "piggy-index.js derives exactly one salt per admission");
});

await check("SEQ-5 BLOCKED residual (recorded, not fixed): on a device with no local index, +Piggy issues n=1 again — it re-derives the SAME bound address as the other device's #1 (same passkey+salt), never an unbound or foreign one", async () => {
  const deviceA = memStorage();
  const deviceB = memStorage();
  const p = prfProvider();
  const a1 = await admitModelAPiggy({ storage: deviceA, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  const b1 = await admitModelAPiggy({ storage: deviceB, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: p.requestPrf, deriveAddress: p.deriveAddress });
  deq([a1.piggy.sequence, b1.piggy.sequence], [1, 1], "number re-issued across devices — needs an authoritative index (Gate B, OWNER/infra)");
  assert.equal(a1.piggy.address, b1.piggy.address, "same identity, bound by live derivation — not a new unbound Piggy");
});

// ═══ SEND lane — OWNER_INPUT_REQUIRED, left pre-A-669 ══════════════════════════════════════════
await check("SEND-0 Send lane left exactly pre-A-669 (OWNER_INPUT_REQUIRED): sendPiggyOnce byte-identical, recoverPiggy() called without an attempt token", () => {
  const once = fnBody("sendPiggyOnce");
  assert.equal(sha(once), PRE.sendPiggyOnce, "sendPiggyOnce unchanged");
  assert.ok(once.includes("      await recoverPiggy();\n"), "unbounded money-path recovery is the recorded residual");
});

finished = true;
console.log(`\nA-669: ${pass}/${pass + fail} PASS`);
if (fail) process.exitCode = 1;
