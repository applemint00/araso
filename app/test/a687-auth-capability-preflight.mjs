// [A-687] WebAuthn capability preflight — node-only, deterministic (no browser/network/tx).
//   node app/test/a687-auth-capability-preflight.mjs
// Real main.js functions (unlockApp, checkPiggy, openPiggy, startPiggyOpen, webAuthnUnsupported) are cut
// and run in a vm with spies. Any identifier the preflight must NOT reach (beginAuthAttempt, requestPrf,
// recoverPiggy, createPiggy ...) is either a spy that fails the check or undefined (-> ReferenceError).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

const FULL = { document: {}, isSecureContext: true, PublicKeyCredential: function () {} };
const credsAll = { create() {}, get() {} };
// capability cases: [label, window, navigator, which kinds are unsupported]
const CASES = [
  ["no secure context", { ...FULL, isSecureContext: false }, { credentials: credsAll }, { get: true, create: true }],
  ["no PublicKeyCredential", { document: {}, isSecureContext: true }, { credentials: credsAll }, { get: true, create: true }],
  ["no navigator.credentials", FULL, {}, { get: true, create: true }],
  ["missing get", FULL, { credentials: { create() {} } }, { get: true, create: false }],
  ["missing create", FULL, { credentials: { get() {} } }, { get: false, create: true }],
  ["supported", FULL, { credentials: credsAll }, { get: false, create: false }],
];

function world({ window, navigator, hook = null, rp = "arasoo.vercel.app", localDev = false, credential = null, fresh = false }) {
  const calls = { requestPrf: 0, beginAuthAttempt: 0, recoverPiggy: 0, createPiggy: 0, scenes: [], settled: [], render: 0, creds: 0 };
  const ctx = {
    window, navigator, __H__: hook,
    state: { authPhase: "x", authCancelled: true, credential, appLock: { phase: "idle", cancelled: false, attempt: null }, address: "", freshRecoveryTried: !fresh },
    setScene: (...a) => calls.scenes.push(a),
    isAllowedPiggyRpId: () => true,
    isLocalDevRpId: () => localDev, getRpId: () => rp, HARNESS_RP_ID: "araso-harness.local.test",
    LOCAL_TEST_WEBAUTHN_HOOK: "__H__",
    requestPrf: () => { calls.requestPrf += 1; return new Promise(() => {}); },
    beginAuthAttempt: () => { calls.beginAuthAttempt += 1; throw new Error("attempt begun"); },
    settleUnlock: (...a) => calls.settled.push(a),
    storedPrfSalt: () => null, render: () => { calls.render += 1; }, setTimeout: () => 0, UNLOCK_UI_WAIT_MS: 1,
    unlockWaitTimeoutError: () => new Error("t"),
    readCredential: () => credential, hasReceivedPiggy: () => false, FRESH_DEVICE_RECOVERY_FIRST: true,
    authAttempt: null, platformAuthInflight: false,
    checkPiggy: undefined, openPiggy: undefined,
  };
  vm.createContext(ctx);
  vm.runInContext(
    [cutFn("localTestWebAuthnClient"), cutFn("webAuthnUnsupported"), cutFn("unlockApp"), cutFn("checkPiggy", true), cutFn("openPiggy", true), cutFn("startPiggyOpen", true)].join("\n") +
      "\nglobalThis.__f = { webAuthnUnsupported, unlockApp, checkPiggy, openPiggy, startPiggyOpen };",
    ctx,
  );
  return { ctx, calls, f: ctx.__f };
}
const bad = (w, calls) => calls.requestPrf === 0 && calls.beginAuthAttempt === 0 && calls.recoverPiggy === 0 && calls.createPiggy === 0;
const FAIL_DETAIL = "This device can't use Face ID or a passkey here.";

for (const [label, window, navigator, unsupported] of CASES) {
  // helper itself
  for (const kind of ["get", "create"]) {
    const { f } = world({ window, navigator });
    check(`[${label}] webAuthnUnsupported(${kind}) === ${unsupported[kind]}`, f.webAuthnUnsupported(kind) === unsupported[kind]);
  }
  // unlock (get)
  {
    const { ctx, calls, f } = world({ window, navigator, credential: { credentialId: "abc" } });
    f.unlockApp();
    if (unsupported.get) {
      check(`[${label}] unlock: no requestPrf, existing fail-closed settleUnlock(null, non-cancel error), no lock.phase/attempt`, bad(0, calls) && calls.settled.length === 1 && calls.settled[0][0] === null && calls.settled[0][1]?.name === "WebAuthnUnsupported" && ctx.state.appLock.phase === "idle" && ctx.state.appLock.attempt === null);
    } else {
      check(`[${label}] unlock: supported -> requestPrf runs exactly once, no settle`, calls.requestPrf === 1 && calls.settled.length === 0);
    }
  }
  // check Piggy (get)
  {
    const { calls, f } = world({ window, navigator, credential: { credentialId: "abc" } });
    let r, threw = null;
    f.checkPiggy().then((v) => { r = v; }, (e) => { threw = e; });
    await Promise.resolve();
    if (unsupported.get) {
      check(`[${label}] check: failure card via setScene birth, no attempt/request`, bad(0, calls) && calls.scenes.length === 1 && calls.scenes[0][0] === "birth" && calls.scenes[0][2] === FAIL_DETAIL && r && r.ok === false && r.cancelled === false);
    } else {
      check(`[${label}] check: supported -> proceeds to the attempt (beginAuthAttempt reached)`, calls.beginAuthAttempt === 1 && calls.scenes.length === 0);
    }
  }
  // open / create (create)
  {
    const { calls, f } = world({ window, navigator });
    f.openPiggy().catch(() => {});
    await Promise.resolve();
    if (unsupported.create) {
      check(`[${label}] open: failure card via setScene birth, no attempt/creation`, bad(0, calls) && calls.scenes.length === 1 && calls.scenes[0][0] === "birth" && calls.scenes[0][2] === FAIL_DETAIL);
    } else {
      check(`[${label}] open: supported -> proceeds to the attempt (beginAuthAttempt reached)`, calls.beginAuthAttempt === 1 && calls.scenes.length === 0);
    }
  }
  // invite -> startPiggyOpen: routing unchanged, same preflight at the destination
  for (const [route, opts, kind] of [["returning-user", { credential: { credentialId: "abc" } }, "get"], ["fresh-device", { fresh: true }, "get"]]) {
    const { calls, f } = world({ window, navigator, ...opts });
    f.startPiggyOpen().catch(() => {});
    await Promise.resolve();
    const blocked = unsupported[kind];
    check(`[${label}] invite->${route}: ${blocked ? "failure card, no credential call" : "reaches attempt"}`, blocked ? bad(0, calls) && calls.scenes.length === 1 && calls.scenes[0][2] === FAIL_DETAIL : calls.beginAuthAttempt === 1);
  }
  {
    // no marker, find-first already tried -> create path
    const { calls, f } = world({ window, navigator });
    f.startPiggyOpen().catch(() => {});
    await Promise.resolve();
    check(`[${label}] invite->markerless create: ${unsupported.create ? "failure card" : "reaches attempt"}`, unsupported.create ? bad(0, calls) && calls.scenes[0]?.[2] === FAIL_DETAIL : calls.beginAuthAttempt === 1);
  }
}

// test-hook path: harness-supplied client is never blocked, even when the browser lacks WebAuthn
{
  const hook = { createCredential() {}, getCredential() {} };
  const { f } = world({ window: { document: {}, isSecureContext: false }, navigator: {}, hook, localDev: true, rp: "araso-harness.local.test" });
  check("test hook: harness client on harness rpId -> not blocked (get and create)", f.webAuthnUnsupported("get") === false && f.webAuthnUnsupported("create") === false);
  const w2 = world({ window: { document: {}, isSecureContext: false }, navigator: {}, hook, localDev: true, rp: "other.local" });
  check("test hook ignored off the harness rpId (fail-closed)", w2.f.webAuthnUnsupported("get") === true);
  const w3 = world({ window: { document: {}, isSecureContext: false }, navigator: {}, hook: { createCredential() {} }, localDev: true, rp: "araso-harness.local.test" });
  check("half-shaped hook does not bypass the preflight", w3.f.webAuthnUnsupported("get") === true);
  const w4 = world({ window: undefined, navigator: undefined });
  check("no browser context evidence -> not blocked", w4.f.webAuthnUnsupported("get") === false);
  const w5 = world({ window: { location: { hostname: "x" } }, navigator: {} });
  check("non-browser window stub (no document) -> not blocked", w5.f.webAuthnUnsupported("get") === false && w5.f.webAuthnUnsupported("create") === false);
}

// source-level invariants
{
  const fn = cutFn("webAuthnUnsupported").replace(/\/\/[^\n]*/g, "");
  check("preflight is synchronous and read-only (no await/async/timers/credential calls)", !/await|async|setTimeout|\.create\(|\.get\(|isUserVerifying/.test(fn));
  for (const [name, async] of [["checkPiggy", true], ["openPiggy", true]]) {
    const src = cutFn(name, async);
    const i = src.indexOf("webAuthnUnsupported(");
    check(`${name}: preflight precedes beginAuthAttempt and any await`, i > 0 && i < src.indexOf("beginAuthAttempt(") && !/await/.test(src.slice(0, i)));
  }
  const u = cutFn("unlockApp");
  check("unlockApp: preflight precedes requestPrf (same sync chain)", u.indexOf("webAuthnUnsupported(") > 0 && u.indexOf("webAuthnUnsupported(") < u.indexOf("requestPrf("));
  check("startPiggyOpen/render untouched by preflight", !/webAuthnUnsupported/.test(cutFn("startPiggyOpen", true)) && !/webAuthnUnsupported/.test(cutFn("render")));
  check("unsupported error is not a cancellation (name is not NotAllowedError)", /unsupported\.name = "WebAuthnUnsupported"/.test(MAIN));
  check("openInvite routes to startPiggyOpen in the tap call stack", /setInvitePhase\("checking"\);\s*const out = await startPiggyOpen\(\);/.test(cutFn("openInvite", true)));
  // [A-698 M3 re-pin] was: sendPiggyOnce had NO webAuthnUnsupported. Now the Send recovery block (and only it) calls it
  // exactly once, before beginAuthAttempt("send") and before any await; finishTrip stays untouched.
  {
    const once = cutFn("sendPiggyOnce", true);
    const i = once.indexOf('webAuthnUnsupported("get")');
    check("sendPiggyOnce: get-preflight exactly once, before beginAuthAttempt and recoverPiggy, no await before it (A-698)",
      once.split("webAuthnUnsupported(").length === 2 && i > 0 && i < once.indexOf('beginAuthAttempt("send")') && i < once.indexOf("recoverPiggy(") && !/await/.test(once.slice(0, i)));
    check("finishTrip untouched by preflight", !/webAuthnUnsupported/.test(cutFn("finishTrip")));
  }
}

// a669-style delta pin: each changed function minus exactly the added guard == its pre-A-687 hash.
{
  const sha16 = (x) => createHash("sha256").update(x).digest("hex").slice(0, 16);
  const body = (name) => {
    const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
    let depth = 0;
    for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
      if (MAIN[i] === "{") depth += 1;
      else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
    }
  };
  const GUARD = /  \/\/ \[A-687 capability preflight\][\s\S]*?\n  \}\n/;
  // checkPiggy's post-guard hash changed only for the Owner-canon unnamed recovery route (Name -> Home).
  for (const [name, old] of [["checkPiggy", "d050cfb99a53f206"], ["openPiggy", "bb4d577044f8e7b9"], ["unlockApp", "d4167d7c8fbf1f82"]]) {
    const b = body(name);
    check(`${name}: exactly one added guard; body minus guard == pre-A-687 hash ${old}`, (b.match(/A-687 capability preflight/g) || []).length === 1 && sha16(b.replace(GUARD, "")) === old, sha16(b.replace(GUARD, "")));
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
