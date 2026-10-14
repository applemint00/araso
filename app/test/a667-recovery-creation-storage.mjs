// A-667 R1–R6 [RECOVERY / CREATION / STORAGE REPAIR] — node-only regression contract.
//   node app/test/a667-recovery-creation-storage.mjs
//
// Runs main.js's ACTUAL function text (recoverPiggy / checkPiggy / openPiggy / startPiggyOpen / activateSigningSession /
// endSignerSession / endActiveSession / armSignerExpiry / touchAppSession / commitIdentity / attempt helpers /
// expireStaleAuthState) in node:vm over deterministic stubs (same technique as a633 and the A-667 audit probe).
// WebAuthn is a controllable deferred per call. Network 0 · browser 0 · real WebAuthn 0 · keys 0 · tx 0.
// Mutation: storage write failures are injected at EVERY identity write boundary (araso.passkey / araso.address /
// araso.prfSalt / araso.piggyReceived).
// Limits: this is not iOS. Real passkey-sheet/bfcache/background behaviour stays HUMAN (see VERIFY.md).
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const norm = (x) => JSON.parse(JSON.stringify(x) ?? "null");
const deq = (a, b, msg) => assert.deepEqual(norm(a), norm(b), msg);
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
// A guarded path that never settles would otherwise end the process silently (unsettled top-level await) — report it.
let finished = false;
process.on("exit", () => { if (!finished) { console.log("FAIL  run ended on an unsettled promise — a bounded/guarded path did not settle"); process.exitCode = 1; } });
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };
const WAIT_MS = Number((MAIN.match(/const UNLOCK_UI_WAIT_MS = ([\d_]+);/) || [])[1]?.replace(/_/g, ""));

const FNS = [
  "endSignerSession", "endActiveSession", "touchAppSession", "armSignerExpiry", "activateSigningSession",
  "namedAuthError", "identityStorageKeys", "snapshotIdentity", "restoreIdentity", "commitIdentity",
  "beginAuthAttempt", "boundAuthAttempt", "expireStaleAuthState", "finishAuthAttempt", "trackPlatformAuth",
  "isCancelledAuthError", "recoverPiggy", "noteRecoverSuccess", "noteRecoverFailure", "a1202CreatePasskey", "openPiggy", "startPiggyOpen", "checkPiggy",
].map(fnBody).join("\n");

const KEYS = { cred: "araso.passkey", addr: "araso.address", salt: "araso.prfSalt", recv: "araso.piggyReceived" };
const OLD_ADDR = "0xADDR11";

// fake clock: timers fire only on advance(); Date.now can also jump WITHOUT firing timers (background throttling).
function makeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    now: () => now,
    jump(ms) { now += ms; },
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

function meraError(causeName) {
  const e = new Error("passkey");
  e.__mera = true;
  e.code = "PASSKEY_OPERATION_FAILED";
  e.cause = { name: causeName };
  return e;
}
const key = (n) => new Uint8Array(32).fill(n);
const addrOf = (k) => `0xADDR${k[0]}`;

// device({ stored }) → stored identity on disk; key 11 is "the stored Piggy".
function device({ stored = true, credentialOnly = false, throwOn = null, indexThrows = false } = {}) {
  const clock = makeClock();
  const store = new Map();
  if (stored) {
    store.set(KEYS.cred, JSON.stringify({ credentialId: "OLD", transports: ["internal"] }));
    if (!credentialOnly) store.set(KEYS.addr, OLD_ADDR);
    store.set(KEYS.salt, "aa".repeat(32));
    store.set(KEYS.recv, "1");
  }
  const calls = { get: [], create: [], scenes: [], index: [], ended: 0, sessions: 0, errors: [], events: [] };
  const pending = { get: [], create: [] };
  const injected = { throwOn };
  const ctx = {
    // A1153 chain recovery is covered by its own unit + Chromium tests.
    restoreRecoveredFirstJourney: async () => {},
    console, Uint8Array, JSON, Promise, Error, Map,
    Date: { now: clock.now },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    PASSKEY_STORAGE_KEY: KEYS.cred, PIGGY_RECEIVED_KEY: KEYS.recv,
    UNLOCK_UI_WAIT_MS: WAIT_MS, FRESH_DEVICE_RECOVERY_FIRST: true, INDEX_BACKUP_ADAPTER: null,
    state: {
      scene: "birth", message: "", detail: "", authPhase: "idle", authCancelled: false,
      credential: stored ? { credentialId: "OLD", transports: ["internal"] } : null,
      address: stored && !credentialOnly ? OLD_ADDR : "",
      activeSignerAddress: "", recoverFailures: 0, noPiggy: false, freshRecoveryTried: false, appLock: null,
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { if (injected.throwOn === k) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } store.set(k, String(v)); },
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
    indexControlledPiggy: (row) => { if (indexThrows) return { ok: false, reason: "index_write_failed" }; calls.index.push(row); return { ok: true }; },
    setScene: (scene, message = "", detail = "") => { calls.scenes.push([scene, message]); Object.assign(ctx.state, { scene, message, detail }); },
    readPiggyName: () => "Honeybun",
    hasPlayedBirth: () => true,
    takePendingGiftClaim: () => null,
    knownPiggyAddresses: () => [],
    restorePendingGiftClaim: () => {},
    recordSafeError: (phase, e) => { calls.errors.push([phase, e?.name]); },
    track: (step, code) => { calls.events.push([step, code]); },
    readCredential: () => { try { return JSON.parse(store.get(KEYS.cred) || "null"); } catch { return null; } },
    hasReceivedPiggy: () => store.get(KEYS.recv) === "1",
    lockAppAfterIdle: () => false,
    settleUnlock: (...a) => { calls.settleUnlock = a; },
    unlockWaitTimeoutError: () => Object.assign(new Error("u"), { name: "UnlockWaitTimeout" }),
  };
  vm.createContext(ctx);
  // [A-667 CREATE_RETRY_RACE] module-level platform-inflight / late-created-credential markers (real names from main.js).
  vm.runInContext(`let activeSession = null; let activeAccount = null; let idleTimer = null; let signerExpiryTimer = null; let authAttempt = null;
let platformAuthInflight = null; let lateCreatedCredential = null;
${FNS}
this.api = { recoverPiggy, checkPiggy, openPiggy, startPiggyOpen, activateSigningSession, commitIdentity, expireStaleAuthState };
this.peek = () => ({ signer: !!activeSession, account: !!activeAccount, signerTimer: signerExpiryTimer !== null, idleTimer: idleTimer !== null, attempt: !!authAttempt });
this.race = () => ({ inflight: !!platformAuthInflight, late: lateCreatedCredential });`, ctx);
  const snap = () => Object.fromEntries([...store.entries()].sort());
  return { ctx, clock, store, calls, pending, injected, state: ctx.state, api: ctx.api, peek: ctx.peek, race: ctx.race, snap };
}
const resolveGet = (d, i, credentialId, k) => d.pending.get[i].resolve({ credentialId, prfOutput: k });
const resolveCreate = (d, i, credentialId, k) => d.pending.create[i].resolve({ credentialId, transports: ["internal"], prfOutput: k, prfSalt: new Uint8Array(32).fill(2) });

// ═══ R1 wrong passkey ═══════════════════════════════════════════════════════════════════════
await check("R1a pinned passkey → user CANCEL (NotAllowedError): NO unpinned fallback chooser, identity unchanged, no signer", async () => {
  const d = device();
  const before = d.snap();
  const run = d.api.checkPiggy();
  d.pending.get[0].reject(meraError("NotAllowedError"));
  await flush();
  assert.equal(d.calls.get.length, 1, "exactly one WebAuthn request — no second chooser");
  const out = await run;
  deq(out, { ok: false, cancelled: true });
  deq(d.snap(), before, "storage unchanged");
  deq([d.state.credential.credentialId, d.state.address], ["OLD", OLD_ADDR]);
  assert.equal(d.peek().signer, false);
  deq([d.state.scene, d.state.message, d.state.authCancelled], ["birth", "Chog could not find Piggy here.", true]);
});

await check("R1b pinned fails 'maybe gone' (non-cancel) → unpinned fallback picks a DIFFERENT same-rpId passkey (other address): refused, zero identity writes, signer cleared, PRF zeroed, no index row", async () => {
  const d = device();
  const before = d.snap();
  const other = key(22);
  const run = d.api.checkPiggy();
  d.pending.get[0].reject(meraError("InvalidStateError"));
  await flush();
  assert.equal(d.calls.get.length, 2, "fallback retained only for non-cancel failures");
  assert.equal(d.calls.get[1], null, "fallback is unpinned");
  resolveGet(d, 1, "OTHER", other);
  const out = await run;
  assert.equal(out.ok, false);
  deq(d.snap(), before, "stored credential/address/salt/received untouched");
  deq([d.state.credential.credentialId, d.state.address], ["OLD", OLD_ADDR], "in-memory identity untouched");
  deq(d.peek(), { signer: false, account: false, signerTimer: false, idleTimer: false, attempt: false }, "no signer/session carryover");
  assert.ok(other.every((b) => b === 0), "PRF output zeroed");
  deq(d.calls.index, [], "no index row for the foreign Piggy");
  deq([d.state.scene, d.state.message], ["birth", "Chog could not find Piggy here."]);
});

await check("R1c credential-only device (no stored address): a different credential from the fallback is refused (cannot prove same Piggy)", async () => {
  const d = device({ credentialOnly: true });
  const before = d.snap();
  const run = d.api.checkPiggy();
  d.pending.get[0].reject(meraError("InvalidStateError"));
  await flush();
  resolveGet(d, 1, "OTHER", key(22));
  assert.equal((await run).ok, false);
  deq(d.snap(), before);
  assert.equal(d.peek().signer, false);
});

await check("R1d pinned success but derived address ≠ stored address (salt/identity drift) → fail closed, zero writes", async () => {
  const d = device();
  const before = d.snap();
  const run = d.api.checkPiggy();
  resolveGet(d, 0, "OLD", key(33));
  assert.equal((await run).ok, false);
  deq(d.calls.events.filter(([step]) => step === "piggy_find"), [["piggy_find", "after_get"]]);
  deq(d.snap(), before);
  assert.equal(d.peek().signer, false);
});

await check("R1e same Piggy (pinned, matching address) recovers normally; markerless device recovery still adopts (no identity to contradict)", async () => {
  const d = device();
  const run = d.api.checkPiggy();
  resolveGet(d, 0, "OLD", key(11));
  deq(await run, { ok: true });
  deq(d.calls.events.filter(([step]) => step === "piggy_find"), [["piggy_find", "ok"]]);
  deq([d.state.scene, d.state.message], ["sendstay", "Piggy is home."]);
  deq(d.peek(), { signer: true, account: true, signerTimer: true, idleTimer: true, attempt: false }, "live signer only WITH expiry + idle");
  const f = device({ stored: false });
  const run2 = f.api.checkPiggy();
  resolveGet(f, 0, "FOUND", key(44));
  deq(await run2, { ok: true });
  deq([f.store.get(KEYS.cred), f.store.get(KEYS.addr)], [JSON.stringify({ credentialId: "FOUND" }), "0xADDR44"]);
});

// ═══ R2 atomic storage + R3 signer cleanup (failure injection at every boundary) ═══════════════
for (const k of [KEYS.cred, KEYS.addr]) {
  await check(`R2/R3 recover: setItem(${k}) throws after authentication → prior identity unchanged, signer cleared, retryable failure card, no index row`, async () => {
    const d = device({ stored: false });
    d.injected.throwOn = k;
    const before = d.snap();
    const run = d.api.checkPiggy();
    resolveGet(d, 0, "FOUND", key(44));
    const out = await run;
    assert.equal(out.ok, false);
    deq(d.snap(), before, "no half-written identity");
    deq([d.state.credential, d.state.address], [null, ""]);
    deq(d.peek(), { signer: false, account: false, signerTimer: false, idleTimer: false, attempt: false });
    deq(d.calls.index, []);
    deq([d.state.scene, d.state.authPhase], ["birth", "idle"], "retryable failure card (not stuck in checking)");
  });
}
for (const k of [KEYS.cred, KEYS.addr, KEYS.salt, KEYS.recv]) {
  await check(`R2/R3 open: setItem(${k}) throws after the passkey was created → no partial identity, signer cleared, failure card, next Open looks up first`, async () => {
    const d = device({ stored: false });
    d.state.freshRecoveryTried = true;
    d.injected.throwOn = k;
    const prf = key(55);
    const run = d.api.openPiggy();
    resolveCreate(d, 0, "NEW", prf);
    await run;
    deq(d.snap(), {}, "markerless device stays exactly as before (no half identity)");
    deq([d.state.credential, d.state.address], [null, ""]);
    deq(d.peek(), { signer: false, account: false, signerTimer: false, idleTimer: false, attempt: false });
    deq(d.calls.index, []);
    deq([d.state.scene, d.state.message, d.state.authPhase], ["birth", "Piggy could not open here.", "idle"]);
    assert.ok(prf.every((b) => b === 0), "PRF zeroed");
    assert.equal(d.state.freshRecoveryTried, false, "platform credential already exists → next explicit Open recovers first instead of creating again");
  });
}
await check("R2 existing identity is restored when a later key fails mid-commit (credential written, address throws)", async () => {
  const d = device();
  const before = d.snap();
  d.injected.throwOn = KEYS.addr;
  assert.throws(() => d.api.commitIdentity({ credential: { credentialId: "NEW" }, address: "0xADDR99" }), (e) => e.name === "PiggyIdentityWriteFailed");
  deq(d.snap(), before, "OLD credential restored, nothing deleted");
  deq([d.state.credential.credentialId, d.state.address], ["OLD", OLD_ADDR]);
});
await check("R2 checkPiggy: only the auxiliary 'received' marker failing does not turn a whole recovered identity into 'not found'", async () => {
  const d = device();
  d.injected.throwOn = KEYS.recv;
  const run = d.api.checkPiggy();
  resolveGet(d, 0, "OLD", key(11));
  deq(await run, { ok: true });
  deq(d.peek(), { signer: true, account: true, signerTimer: true, idleTimer: true, attempt: false }, "signer only with its expiry/idle timers");
});
await check("R3 activateSigningSession: a throw after the signer exists (account derivation / address write) ends it — no timer-less signer", async () => {
  const d = device();
  d.injected.throwOn = KEYS.addr;
  assert.throws(() => d.api.activateSigningSession(key(7)));
  deq(d.peek(), { signer: false, account: false, signerTimer: false, idleTimer: false, attempt: false });
  assert.equal(d.state.address, OLD_ADDR, "state.address only moves after a successful write");
  const e = device();
  e.ctx.toViemAccount = () => { throw new Error("derive"); };
  assert.throws(() => e.api.activateSigningSession(key(7), { persistAddress: false }));
  assert.equal(e.peek().signer, false);
  assert.ok(e.calls.ended >= 1, "Mera session end() called (key copy zeroed by Mera)");
});

await check("R3 checkPiggy: a step AFTER a successful recovery failing (here: the success navigation throws) ends the newly opened signer", async () => {
  const d = device();
  const realSetScene = d.ctx.setScene;
  d.ctx.setScene = (scene, ...rest) => { if (scene === "sendstay") throw new Error("render"); return realSetScene(scene, ...rest); };
  const run = d.api.checkPiggy();
  resolveGet(d, 0, "OLD", key(11));
  assert.equal((await run).ok, false);
  deq(d.peek(), { signer: false, account: false, signerTimer: false, idleTimer: false, attempt: false });
});

// ═══ R4 PRF hygiene ═══════════════════════════════════════════════════════════════════════
await check("R4 PRF output zeroed after derivation on recover success, recover mismatch, open success; recoverPiggy returns no PRF", async () => {
  const d = device();
  const k1 = key(11);
  const p = d.api.recoverPiggy();
  resolveGet(d, 0, "OLD", k1);
  const r = await p;
  assert.equal("prfOutput" in r, false, "no raw PRF returned");
  assert.ok(k1.every((b) => b === 0));
  const m = device();
  const k2 = key(33);
  const p2 = m.api.recoverPiggy().catch((e) => e);
  resolveGet(m, 0, "OLD", k2);
  assert.equal((await p2).name, "PiggyIdentityMismatch");
  assert.ok(k2.every((b) => b === 0));
  const o = device({ stored: false });
  const k3 = key(55);
  const p3 = o.api.openPiggy();
  resolveCreate(o, 0, "NEW", k3);
  await p3;
  assert.ok(k3.every((b) => b === 0));
  deq([o.store.get(KEYS.cred), o.store.get(KEYS.addr), o.store.get(KEYS.recv)], [JSON.stringify({ credentialId: "NEW", transports: ["internal"] }), "0xADDR55", "1"], "open success persists the whole identity");
  deq([o.state.scene, o.state.message], ["sendstay", "Piggy is home."]);
});

// ═══ R5 bounded attempts + tokens ═══════════════════════════════════════════════════════════
await check("R5a Check Piggy never settles → checking until the bound, then the retryable failure card; late SUCCESS ignored (no signer, no write, no navigation, PRF zeroed)", async () => {
  const d = device();
  const before = d.snap();
  const run = d.api.checkPiggy();
  d.clock.advance(WAIT_MS - 1);
  await flush();
  deq([d.state.scene, d.state.authPhase], ["birth", "checking"]);
  d.clock.advance(1);
  const out = await run;
  assert.equal(out.ok, false);
  deq([d.state.scene, d.state.message, d.state.authPhase, d.state.authCancelled], ["birth", "Chog could not find Piggy here.", "idle", false]);
  const late = key(11);
  const scenes = d.calls.scenes.length;
  resolveGet(d, 0, "OLD", late);
  await flush();
  assert.equal(d.calls.sessions, 0, "late result opened no signer");
  deq(d.snap(), before);
  assert.equal(d.calls.scenes.length, scenes, "late result did not navigate");
  assert.ok(late.every((b) => b === 0), "late PRF zeroed");
});

await check("R5b Open never settles → bound → 'Piggy could not open here.'; late CREATE success: no state/storage/signer, PRF zeroed; residual = platform passkey exists → next Open looks up first", async () => {
  const d = device({ stored: false });
  d.state.freshRecoveryTried = true;
  const run = d.api.openPiggy();
  d.clock.advance(WAIT_MS);
  await run;
  deq([d.state.scene, d.state.message, d.state.authPhase], ["birth", "Piggy could not open here.", "idle"]);
  const late = key(55);
  resolveCreate(d, 0, "NEW", late);
  await flush();
  deq(d.snap(), {}, "late create wrote nothing");
  assert.equal(d.calls.sessions, 0);
  assert.ok(late.every((b) => b === 0));
  assert.equal(d.state.freshRecoveryTried, false);
  d.api.startPiggyOpen();
  await flush();
  deq([d.calls.get.length, d.calls.create.length], [1, 1], "the next explicit Open asks to FIND (get), not create again");
});

await check("R5c one gesture = one active WebAuthn attempt: rapid double Check Piggy / Open-while-checking create nothing new", async () => {
  const d = device();
  const a = d.api.checkPiggy();
  const b = await d.api.checkPiggy();
  deq(b, { ok: false, cancelled: false, reason: "attempt_active" });
  await d.api.openPiggy();
  deq([d.calls.get.length, d.calls.create.length], [1, 0]);
  resolveGet(d, 0, "OLD", key(11));
  deq(await a, { ok: true });
});

await check("R5d retry after timeout = a NEW attempt; the old late result neither settles the new attempt nor ends its signer", async () => {
  // [A-667 CREATE_RETRY_RACE re-pin] a retry while the timed-out first get is STILL pending at the platform no longer
  // starts an overlapping second get (was: second get issued immediately) — it fails closed to the existing card.
  const d = device();
  const before = d.snap();
  const first = d.api.checkPiggy();
  d.clock.advance(WAIT_MS);
  await first;
  deq(await d.api.checkPiggy(), { ok: false, cancelled: false, reason: "platform_pending" });
  deq(d.calls.events.filter(([step]) => step === "piggy_find"), [["piggy_find", "platform_pending"]]);
  assert.equal(d.calls.get.length, 1, "no overlapping get while the first is pending");
  deq([d.state.scene, d.state.message, d.state.authPhase], ["birth", "Chog could not find Piggy here.", "idle"]);
  resolveGet(d, 0, "OLD", key(11)); // stale success
  await flush();
  deq([d.calls.sessions, d.race().inflight], [0, false], "stale success ignored; platform request now settled");
  deq(d.snap(), before);
  const third = d.api.checkPiggy();
  assert.equal(d.calls.get.length, 2, "after the first settled, a retry is a NEW attempt");
  resolveGet(d, 1, "OLD", key(11));
  deq(await third, { ok: true });
  assert.equal(d.peek().signer, true);
  const e = device();
  const one = e.api.checkPiggy();
  e.clock.advance(WAIT_MS);
  await one;
  e.pending.get[0].reject(meraError("InvalidStateError")); // stale FAILURE
  await flush();
  deq([e.state.scene, e.state.message, e.race().inflight], ["birth", "Chog could not find Piggy here.", false], "stale failure changes nothing");
  const two = e.api.checkPiggy();
  resolveGet(e, 1, "OLD", key(11));
  deq(await two, { ok: true });
  deq(e.peek(), { signer: true, account: true, signerTimer: true, idleTimer: true, attempt: false });
});

// ═══ R6 lifecycle ═══════════════════════════════════════════════════════════════════════════
await check("R6a bfcache restore (pageshow persisted) during Check Piggy → fail-closed failure card at once; late result cannot unlock/persist", async () => {
  const d = device();
  const before = d.snap();
  const run = d.api.checkPiggy();
  d.api.expireStaleAuthState({ restored: true });
  await flush();
  assert.equal(d.state.authPhase, "idle", "restore ended the attempt immediately");
  assert.equal((await run).ok, false);
  deq([d.state.scene, d.state.authPhase], ["birth", "idle"]);
  resolveGet(d, 0, "OLD", key(11));
  await flush();
  deq(d.snap(), before);
  assert.equal(d.calls.sessions, 0);
  assert.equal(d.calls.get.length, 1, "no new WebAuthn call on restore");
});
await check("R6b background→visible: within the bound nothing changes; past the bound (timers throttled, not yet fired) the attempt ends now", async () => {
  const d = device();
  const run = d.api.checkPiggy();
  d.clock.jump(WAIT_MS - 5);
  d.api.expireStaleAuthState({ restored: false });
  await flush();
  assert.equal(d.state.authPhase, "checking", "still inside the bound — the sheet may still be up");
  d.clock.jump(10);
  d.api.expireStaleAuthState({ restored: false });
  await flush();
  assert.equal(d.state.authPhase, "idle", "overdue attempt ended on return to visible");
  assert.equal((await run).ok, false);
  assert.equal(d.calls.get.length, 1, "no new WebAuthn call on visibility");
});
await check("R6c bfcache restore with a pending unlock attempt → settleUnlock with that attempt (existing fail-closed lock card); no WebAuthn", () => {
  const d = device();
  const attempt = { timer: 1 };
  d.state.appLock = { phase: "checking", attempt };
  d.api.expireStaleAuthState({ restored: true });
  assert.equal(d.calls.settleUnlock[3], attempt);
  assert.equal(d.calls.settleUnlock[1].name, "UnlockWaitTimeout");
  assert.equal(d.calls.get.length, 0);
});
await check("R6d listeners: pageshow(persisted)/visibilitychange call only expireStaleAuthState — no requestPrf/unlockApp/checkPiggy/openPiggy/create", () => {
  const ps = MAIN.match(/window\.addEventListener\("pageshow", [^\n]*\n/)[0];
  const vc = MAIN.match(/document\.addEventListener\("visibilitychange", \(\) => \{ if \(document\.visibilityState === "visible"\) expireStaleAuthState[^\n]*\n/)[0];
  assert.ok(ps.includes("if (event.persisted) expireStaleAuthState({ restored: true })"));
  const body = stripComments(fnBody("expireStaleAuthState"));
  for (const bad of ["requestPrf(", "unlockApp(", "checkPiggy(", "openPiggy(", "startPiggyOpen(", "createPasskeyWithPrfOutput(", "credentials.", "setScene(", "render("]) {
    assert.equal((ps + vc + body).includes(bad), false, bad);
  }
});

// ═══ CREATE_RETRY_RACE — the exact Owner order ═══════════════════════════════════════════════
// 1) first create unresolved → 2) app wait times out (UI retryable) → 3) user starts a second Open BEFORE the first
// platform request settles → 4) the first create resolves late.
async function raceToStep3() {
  const d = device({ stored: false });
  d.state.freshRecoveryTried = true; // Make new path: the explicit Open creates
  const first = d.api.openPiggy();
  assert.equal(d.calls.create.length, 1, "step 1: first platform create issued synchronously");
  d.clock.advance(WAIT_MS);
  await first;
  deq([d.state.scene, d.state.message, d.state.authPhase], ["birth", "Piggy could not open here.", "idle"], "step 2: retryable failure card");
  deq([d.peek().attempt, d.race().inflight], [false, true], "UI attempt over, platform request still pending");
  await d.api.openPiggy(); // step 3: second Open (Make new → Invite → Open)
  await d.api.openPiggy(); // and a double tap
  await d.api.startPiggyOpen();
  deq([d.calls.create.length, d.calls.get.length], [1, 0], "step 3: NO second platform create and no get while the first is pending");
  deq([d.state.scene, d.state.message, d.state.authPhase], ["birth", "Piggy could not open here.", "idle"], "fail-closed, existing copy, retryable");
  assert.ok(d.calls.errors.some(([p, n]) => p === "open" && n === "PlatformAuthPending"));
  deq(d.snap(), {}, "nothing persisted so far");
  return d;
}

await check("RACE-1 exact order, first create resolves late with SUCCESS: no persist/index/signer/navigation; orphan recorded in memory only; next Open finds THAT credential (pinned), never creates", async () => {
  const d = await raceToStep3();
  const scenes = d.calls.scenes.length;
  const prf = key(61);
  resolveCreate(d, 0, "FIRST", prf); // step 4
  await flush();
  deq(d.snap(), {}, "late success persisted nothing");
  deq([d.state.credential, d.state.address, d.calls.sessions, d.calls.index.length, d.calls.scenes.length], [null, "", 0, 0, scenes]);
  assert.ok(prf.every((b) => b === 0), "late PRF zeroed");
  deq(d.race(), { inflight: false, late: { credentialId: "FIRST", transports: ["internal"] } });
  const find = d.api.startPiggyOpen(); // user's next explicit Open
  await flush();
  deq([d.calls.create.length, d.calls.get.length], [1, 1], "find-before-create, not a second create");
  deq(d.calls.get[0], { credentialId: "FIRST", transports: ["internal"] }, "the get is pinned to the late-created credential only");
  await d.api.openPiggy();
  assert.equal(d.calls.create.length, 1, "a create cannot overlap the pending pinned get");
  resolveGet(d, 0, "FIRST", key(61));
  deq(await find, { ok: true });
  deq([d.store.get(KEYS.cred), d.store.get(KEYS.addr), d.calls.index.length, d.race().late], [JSON.stringify({ credentialId: "FIRST", transports: ["internal"] }), "0xADDR61", 1, null], "exactly one app Piggy / one index row");
});

await check("RACE-1b pinned find after a late create: a DIFFERENT passkey (unpinned fallback) is refused — no unbound identity adopted", async () => {
  const d = await raceToStep3();
  resolveCreate(d, 0, "FIRST", key(61));
  await flush();
  const run = d.api.startPiggyOpen();
  d.pending.get[0].reject(meraError("InvalidStateError"));
  await flush();
  resolveGet(d, 1, "SOMEONE", key(77));
  await run;
  deq(d.snap(), {}, "nothing adopted");
  deq([d.calls.sessions > 0 ? d.peek().signer : false, d.calls.index.length], [false, 0]);
});

await check("RACE-2 exact order, first create REJECTS late: nothing changes; only after it settled can an explicit Open create — once; one Piggy, one index row", async () => {
  const d = await raceToStep3();
  const scenes = d.calls.scenes.length;
  d.pending.create[0].reject(meraError("NotAllowedError"));
  await flush();
  deq([d.snap(), d.calls.scenes.length, d.race()], [{}, scenes, { inflight: false, late: null }]);
  const second = d.api.openPiggy();
  assert.equal(d.calls.create.length, 2, "second create only after the first settled");
  resolveCreate(d, 1, "SECOND", key(62));
  await second;
  deq([d.store.get(KEYS.addr), d.calls.index.length, d.state.scene], ["0xADDR62", 1, "sendstay"]);
});

await check("RACE-3 'second in flight when the first resolves' cannot be reached: the second create is never issued while the first is pending; a create in flight (before timeout) blocks a double tap", async () => {
  const d = device({ stored: false });
  d.state.freshRecoveryTried = true;
  const first = d.api.openPiggy();
  await d.api.openPiggy(); // double tap DURING the live attempt
  assert.equal(d.calls.create.length, 1);
  resolveCreate(d, 0, "FIRST", key(61));
  await first;
  deq([d.store.get(KEYS.addr), d.calls.index.length, d.race()], ["0xADDR61", 1, { inflight: false, late: null }]);
  const r = await raceToStep3();
  assert.equal(r.pending.create.length, 1, "at step 3 there is no second platform create to be 'in flight'");
});

// ═══ fresh-device semantics ═══════════════════════════════════════════════════════════════
await check("F1 markerless find-first CANCEL is not treated as 'no Piggy': nothing written/created, noPiggy not set by one failure, no auto create", async () => {
  const d = device({ stored: false });
  const run = d.api.startPiggyOpen();
  d.pending.get[0].reject(meraError("NotAllowedError"));
  await run;
  deq(d.snap(), {});
  deq([d.calls.create.length, d.state.noPiggy, d.state.authCancelled], [0, false, true]);
  await flush();
  assert.equal(d.calls.create.length, 0, "no create without the explicit Open");
});

finished = true;
console.log(`\nPart N: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exitCode = 1;
