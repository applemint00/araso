// A-726 [FRESH DEVICE EXISTING PASSKEY RECOVERY · NO HATCH INVARIANT] — regression contract.
//   node app/test/a726-fresh-device-recovery-no-hatch.mjs                  (Part N + Part B)
//   A726_NODE_ONLY=1 node app/test/a726-fresh-device-recovery-no-hatch.mjs (Part N only — no port/browser)
//
// Invariant (Owner-observed): a fresh device/profile with NO local markers (credential / address / received / name /
// birth-played all absent) but with the user's existing discoverable Araso passkey must
//   · recover on the FIRST explicit Open (Invite) tap — exactly one credentials.get, zero credentials.create;
//   · never enter Hatch and never play hello even though hasPlayedBirth() === false;
//   · land on Home "sendstay" with "Same place, same Piggy." whether the recovered name is known or UNKNOWN;
//   · on a cancelled / failed recovery, never auto-create on that same tap.
//
// Part N (node:vm): cuts the ACTUAL main.js text of startPiggyOpen / checkPiggy / recoverPiggy / openPiggy / commitIdentity
//   / signer + attempt helpers (same technique as a667-recovery-creation-storage) over deterministic stubs. hasPlayedBirth
//   is the real function reading the real BIRTH_PLAYED_KEY from the stub storage.
// Part B (Playwright + CDP virtual authenticator, local vite `--mode a172-local --strictPort` on 5811): the REAL app,
//   unstubbed; a discoverable passkey is minted through the real new-user flow (regression: look → Make new → Open → create →
//   Hatch), then ALL app-side origin storage is wiped and the page reloaded (= fresh device/profile; the platform passkey
//   stays in the virtual authenticator) — then the Invite Open tap is driven and navigator.credentials get/create are
//   counted, every rendered [data-scene] is traced, and localStorage markers are read.
//   Env: A726_NODE_ONLY=1 skips Part B (prints SKIP, not PASS); A726_BASE_URL reuses a running dev server;
//        A726_PORT overrides 5811; A726_MAIN_PATH points Part N at a mutant copy (mutation evidence only).
// Network 0 (vite on 127.0.0.1 only) · real passkey 0 · keys 0 · tx 0.
import assert from "node:assert/strict";
import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
// A726_MAIN_PATH = mutation runs only (Part N reads a mutant copy; app/src/main.js is never edited for mutation).
const MAIN = readFileSync(process.env.A726_MAIN_PATH || path.join(REPO, "app/src/main.js"), "utf8");
const norm = (x) => JSON.parse(JSON.stringify(x) ?? "null");
const deq = (a, b, msg) => assert.deepEqual(norm(a), norm(b), msg);
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").slice(0, 8).join("\n      ")}`); fail += 1; }
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
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

// ═══ Part N ═══════════════════════════════════════════════════════════════════════════════════
const WAIT_MS = Number((MAIN.match(/const UNLOCK_UI_WAIT_MS = ([\d_]+);/) || [])[1]?.replace(/_/g, ""));
const KEYS = {
  cred: (MAIN.match(/const PASSKEY_STORAGE_KEY = "([^"]+)"/) || [])[1],
  recv: (MAIN.match(/const PIGGY_RECEIVED_KEY = "([^"]+)"/) || [])[1],
  name: (MAIN.match(/const PIGGY_NAME_KEY = "([^"]+)"/) || [])[1],
  birth: (MAIN.match(/const BIRTH_PLAYED_KEY = "([^"]+)"/) || [])[1],
  addr: "araso.address",
  salt: "araso.prfSalt",
};
const FNS = [
  "endSignerSession", "endActiveSession", "touchAppSession", "armSignerExpiry", "activateSigningSession",
  "namedAuthError", "identityStorageKeys", "snapshotIdentity", "restoreIdentity", "commitIdentity",
  "beginAuthAttempt", "boundAuthAttempt", "finishAuthAttempt", "trackPlatformAuth",
  "isCancelledAuthError", "recoverPiggy", "noteRecoverSuccess", "noteRecoverFailure", "openPiggy", "startPiggyOpen", "checkPiggy",
  "hasPlayedBirth", "readPiggyName", "hasReceivedPiggy",
  // the REAL Invite Open path: #inviteFaceButton → openInvite → startPiggyOpen in the same tap call stack
  "clearInviteTimers", "withInviteAuthPresentation", "playInviteTimelineAfterAuth", "openInvite",
].map(fnBody).join("\n");
const INVITE_TIMELINE_SRC = (MAIN.match(/const INVITE_TIMELINE = \[[\s\S]*?\];/) || [])[0];
const FRESH_FLAG = /const FRESH_DEVICE_RECOVERY_FIRST = (true|false);/.exec(MAIN)?.[1] === "true";

function meraError(causeName) {
  const e = new Error("passkey");
  e.__mera = true;
  e.code = "PASSKEY_OPERATION_FAILED";
  e.cause = { name: causeName };
  return e;
}
const key = (n) => new Uint8Array(32).fill(n);
const addrOf = (k) => `0xADDR${k[0]}`;

// Markerless fresh device. `name` optionally pre-seeds only the Piggy name (every other marker stays absent).
function freshDevice({ name = "" } = {}) {
  const store = new Map();
  if (name) store.set(KEYS.name, name);
  const calls = { get: [], create: 0, scenes: [], errors: [] };
  const pending = { get: [], create: [] };
  let nextTimer = 1;
  let now = 1_000_000;
  const timers = new Map();
  const clock = {
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
  };
  const board = { dataset: { phase: "closed" } };
  const ctx = {
    console, Uint8Array, JSON, Promise, Error, Map,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    document: { querySelector: (sel) => (sel === ".invite" && ctx.state.scene === "received" ? board : null) },
    setInvitePhase: (phase) => { board.dataset.phase = phase; },
    PASSKEY_STORAGE_KEY: KEYS.cred, PIGGY_RECEIVED_KEY: KEYS.recv, PIGGY_NAME_KEY: KEYS.name, BIRTH_PLAYED_KEY: KEYS.birth,
    UNLOCK_UI_WAIT_MS: WAIT_MS, FRESH_DEVICE_RECOVERY_FIRST: FRESH_FLAG, INDEX_BACKUP_ADAPTER: null,
    state: {
      scene: "received", message: "", detail: "", authPhase: "idle", authCancelled: false,
      credential: null, address: "", activeSignerAddress: "", recoverFailures: 0, noPiggy: false, freshRecoveryTried: false, appLock: null,
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    isMeraError: (e) => !!e && e.__mera === true,
    isAllowedPiggyRpId: () => true,
    webAuthnUnsupported: () => false,
    storedPrfSalt: () => null,
    getRpId: () => "localhost",
    localTestWebAuthnOption: () => ({}),
    localTestPrfSaltOption: () => ({}),
    toHex: (b) => Buffer.from(b).toString("hex"),
    requestPrf: (credential) => new Promise((resolve, reject) => { calls.get.push(credential); pending.get.push({ resolve, reject }); }),
    createPasskeyWithPrfOutput: () => { calls.create += 1; return new Promise((resolve, reject) => { pending.create.push({ resolve, reject }); }); },
    createSecp256k1SigningSession: ({ privateKey }) => ({ publicKey: new Uint8Array(privateKey), end() {} }),
    toViemAccount: (s) => ({ address: addrOf(s.publicKey) }),
    getEvmAddress: (pk) => addrOf(pk),
    indexControlledPiggy: () => ({ ok: true }),
    setScene: (scene, message = "", detail = "") => {
      calls.scenes.push([scene, message, detail]);
      Object.assign(ctx.state, { scene, message, detail });
      if (scene === "received") board.dataset.phase = "closed"; // a fresh Invite render = a closed envelope again
    },
    finishHatch: () => { calls.scenes.push(["finishHatch"]); },
    takePendingGiftClaim: () => null,
    knownPiggyAddresses: () => [],
    restorePendingGiftClaim: () => {},
    recordSafeError: (phase, e) => { calls.errors.push([phase, e?.name]); },
    readCredential: () => { try { return JSON.parse(store.get(KEYS.cred) || "null"); } catch { return null; } },
    lockAppAfterIdle: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(`let activeSession = null; let activeAccount = null; let idleTimer = null; let signerExpiryTimer = null; let authAttempt = null;
let platformAuthInflight = null; let lateCreatedCredential = null; let bornPiggyPending = null; let inviteTimers = []; let inviteAuthPresentation = false; let lastGiftClaimSettlement = null;
${INVITE_TIMELINE_SRC}
${FNS}
this.api = { startPiggyOpen, hasPlayedBirth, openInvite };`, ctx);
  const markers = () => Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, store.has(v)]));
  // The user's explicit tap on the Invite "Face ID" button starts the real passkey branch immediately.
  const tapInviteOpen = async () => { ctx.state.scene = "received"; ctx.api.openInvite(); await flush(); };
  return { ctx, store, calls, pending, clock, board, tapInviteOpen, state: ctx.state, api: ctx.api, markers };
}
const NONE = { cred: false, recv: false, name: false, birth: false, addr: false, salt: false };

await check("N0 markerless fresh device: credential/address/received/name/birth-played all absent; hasPlayedBirth() === false (real fn)", () => {
  const d = freshDevice();
  deq(d.markers(), NONE);
  assert.equal(d.api.hasPlayedBirth(), false);
  assert.ok(KEYS.cred && KEYS.recv && KEYS.name && KEYS.birth, "storage key names read from main.js");
});

await check("N1 fresh device, no name: FIRST startPiggyOpen → exactly one discoverable get (unpinned), create 0 → same Piggy Home; never Name/Hatch", async () => {
  const d = freshDevice();
  const run = d.api.startPiggyOpen();
  await flush();
  deq(d.calls.get, [null], "one get, no pinned credential (discoverable)");
  d.pending.get[0].resolve({ credentialId: "EXISTING", prfOutput: key(44) });
  deq(await run, { ok: true });
  assert.equal(d.calls.create, 0, "createPasskeyWithPrfOutput count");
  const scenes = d.calls.scenes.map((s) => s[0]);
  deq(scenes, ["birth", "sendstay"], "checking card → same Piggy Home");
  assert.equal(scenes.includes("name"), false, "unknown name never forces Name it");
  assert.equal(scenes.includes("hatch") || scenes.includes("finishHatch"), false, "no Hatch");
  assert.equal(d.store.has(KEYS.birth), false, "birth-played not written");
  assert.equal(d.api.hasPlayedBirth(), false, "still a never-played device, yet no Hatch");
  deq([d.store.get(KEYS.cred), d.store.get(KEYS.addr), d.store.get(KEYS.recv)], [JSON.stringify({ credentialId: "EXISTING" }), "0xADDR44", "1"], "existing Piggy adopted");
});

await check("N2 fresh device, name present (other markers absent): FIRST tap → one get, create 0 → sendstay \"Piggy is home.\" / \"Same place, same Piggy.\"; never hatch", async () => {
  const d = freshDevice({ name: "Honeybun" });
  deq(d.markers(), { ...NONE, name: true });
  const run = d.api.startPiggyOpen();
  await flush();
  d.pending.get[0].resolve({ credentialId: "EXISTING", prfOutput: key(44) });
  deq(await run, { ok: true });
  deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 0 });
  deq(d.calls.scenes.at(-1), ["sendstay", "Piggy is home.", "Same place, same Piggy."]);
  assert.equal(d.calls.scenes.some((s) => s[0] === "hatch" || s[0] === "finishHatch"), false);
  assert.equal(d.store.has(KEYS.birth), false);
});

for (const [label, err] of [["user cancel (NotAllowedError)", meraError("NotAllowedError")], ["not found / failed (non-cancel)", meraError("InvalidStateError")], ["raw DOMException failure", Object.assign(new Error("x"), { name: "UnknownError" })]]) {
  await check(`N3 fresh device, ${label} on the first tap → failure card, create 0 on that tap, no identity written, no hatch`, async () => {
    const d = freshDevice();
    const run = d.api.startPiggyOpen();
    await flush();
    d.pending.get[0].reject(err);
    // A tap that (wrongly) went on to create would await a create that never settles here — race it, never hang.
    const out = await Promise.race([run, flush().then(() => ({ ok: "unsettled: still awaiting after the failed recovery" }))]);
    await flush();
    deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 0 }, "same tap never auto-creates");
    assert.equal(out?.ok, false, `tap result ${JSON.stringify(out)}`);
    deq(d.markers(), NONE, "no marker written");
    deq(d.calls.scenes.at(-1).slice(0, 2), ["birth", "Chog could not find Piggy here."]);
    assert.equal(d.calls.scenes.some((s) => s[0] === "hatch"), false);
  });
}

await check("N5 REAL Invite path: tap starts find-first immediately; success then preserves the Invite timeline; existing Piggy lands Home with no Name/Hatch", async () => {
  assert.ok(INVITE_TIMELINE_SRC, "INVITE_TIMELINE cut from main.js");
  assert.match(MAIN, /document\.querySelector\("#inviteFaceButton"\)\?\.addEventListener\("click", openInvite\);/, "render(): Invite button → openInvite");
  for (const name of ["", "Honeybun"]) {
    const d = freshDevice({ name });
    d.state.scene = "received";
    d.api.openInvite();
    await flush();
    deq(d.calls.get, [null], "exactly one discoverable get from the explicit tap");
    d.pending.get[0].resolve({ credentialId: "EXISTING", prfOutput: key(44) });
    await flush();
    assert.equal(d.state.scene, "received", "successful auth returns to the existing Invite art for its timeline");
    d.clock.advance(5899); await flush();
    assert.equal(d.state.scene, "received", "destination waits for the unchanged Invite timeline");
    d.clock.advance(1); await flush();
    assert.equal(d.calls.create, 0);
    const trace = d.calls.scenes.map((x) => x[0]);
    assert.equal(trace.includes("hatch"), false, `trace ${trace.join(">")}`);
    assert.equal(trace.includes("name"), false, `trace ${trace.join(">")}`);
    deq(d.calls.scenes.at(-1), ["sendstay", "Piggy is home.", "Same place, same Piggy."], `trace ${trace.join(">")}`);
    assert.equal(d.store.has(KEYS.birth), false);
  }
});

await check("N6 REAL Invite path, cancel/failure: failure card, create 0 on that tap, no marker written", async () => {
  const d = freshDevice();
  await d.tapInviteOpen();
  d.pending.get[0].reject(meraError("NotAllowedError"));
  await flush();
  deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 0 });
  deq(d.calls.scenes.at(-1).slice(0, 2), ["birth", "Chog could not find Piggy here."]);
  deq(d.markers(), NONE);
});

await check("N7 genuine NEW user (no existing passkey) is unchanged: Invite tap 1 finds nothing (no create) → Make new → Invite tap 2 = explicit create → Hatch (hasPlayedBirth false)", async () => {
  const d = freshDevice();
  await d.tapInviteOpen();
  d.pending.get[0].reject(meraError("NotAllowedError"));   // no passkey on this device: iOS/Chromium report it like a cancel
  await flush();
  deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 0 }, "first tap only looks");
  d.ctx.setScene("received", "", "");                       // Make new (#authTryAgainButton) → Invite
  await d.tapInviteOpen();                                    // user explicitly opens again
  deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 1 }, "second explicit Open creates");
  d.pending.create[0].resolve({ credentialId: "NEW", transports: ["internal"], prfOutput: key(55), prfSalt: key(2) });
  await flush();
  assert.equal(d.state.scene, "received", "new credential succeeds before the existing Invite art runs");
  d.clock.advance(5900); await flush();
  deq(d.calls.scenes.at(-1)[0], "hatch", `trace ${d.calls.scenes.map((x) => x[0]).join(">")}`);
  deq([d.markers().cred, d.markers().addr, d.markers().recv], [true, true, true]);
});

await check("N4 source pins: checkPiggy's success path cannot reach Hatch/hello/birth-played; recovery code never creates", () => {
  const cp = stripComments(fnBody("checkPiggy"));
  for (const bad of ['"hatch"', "finishHatch(", "hasPlayedBirth(", "BIRTH_PLAYED_KEY", "openPiggy(", "createPasskeyWithPrfOutput(", "startPiggyOpen(", "hello"]) {
    assert.equal(cp.includes(bad), false, `checkPiggy contains ${bad}`);
  }
  const rp = stripComments(fnBody("recoverPiggy"));
  for (const bad of ['"hatch"', "openPiggy(", "createPasskeyWithPrfOutput(", "setScene("]) assert.equal(rp.includes(bad), false, `recoverPiggy contains ${bad}`);
  const sp = stripComments(fnBody("startPiggyOpen"));
  assert.match(sp, /if \(FRESH_DEVICE_RECOVERY_FIRST && !state\.freshRecoveryTried\) \{\s*state\.freshRecoveryTried = true;\s*return checkPiggy\(\);/, "fresh-device branch returns checkPiggy without falling through");
  assert.equal(FRESH_FLAG, true, "FRESH_DEVICE_RECOVERY_FIRST on");
  // Hatch is only ever set by openPiggy (new birth), and only when birth was not yet played.
  const hatchSetters = stripComments(MAIN).match(/setScene\("hatch"/g) || [];
  assert.equal(hatchSetters.length, 1, "exactly one setScene(\"hatch\") in main.js");
  assert.ok(stripComments(fnBody("openPiggy")).includes('setScene("hatch")'), "the only Hatch entry is openPiggy");
});

console.log(`\nPart N: ${pass}/${pass + fail} PASS`);

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════
const PORT = Number(process.env.A726_PORT || 5811);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTH_OPTS = { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true };

// Counts every navigator.credentials call and records every [data-scene] that is ever rendered (MutationObserver from
// document start — a Hatch that flashes for one frame is still caught). mode: "pass" | "reject" (NotAllowedError) | "fail".
const INIT = `(() => {
  const wa = window.__wa = { create: 0, get: 0, mode: "pass", scenes: [], getOpts: [] };
  const c = navigator.credentials;
  if (c) {
    const oc = c.create.bind(c), og = c.get.bind(c);
    c.create = (o) => { wa.create++; return oc(o); };
    c.get = (o) => {
      wa.get++;
      wa.getOpts.push({ allow: (o && o.publicKey && o.publicKey.allowCredentials || []).length });
      if (wa.mode === "reject") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
      if (wa.mode === "fail") return Promise.reject(new DOMException("Unknown authenticator failure.", "UnknownError"));
      return og(o).then((cred) => {
        let prf = null;
        try { const r = cred && cred.getClientExtensionResults && cred.getClientExtensionResults(); prf = !!(r && r.prf && r.prf.results && r.prf.results.first); } catch {}
        wa.lastGet = { ok: true, prf };
        return cred;
      }, (e) => { wa.lastGet = { ok: false, name: e && e.name, message: String(e && e.message).slice(0, 160) }; throw e; });
    };
  }
  const seen = () => document.querySelectorAll("[data-scene]").forEach((el) => {
    const s = el.dataset.scene;
    if (wa.scenes[wa.scenes.length - 1] !== s) wa.scenes.push(s);
  });
  new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-scene"] });
})();`;

async function runBrowser() {
  if (!existsSync(privatePath())) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  let chromium;
  try {
    ({ chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright"));
  } catch (e) {
    await check("B0 playwright available (private harness)", () => { throw e; });
    return;
  }
  let server = null;
  let BASE = process.env.A726_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let errText = "";
    server.stderr.on("data", (d) => { errText += String(d); });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
        server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
        server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
      });
    } catch (e) {
      // e.g. sandbox without local port binding (listen EPERM) — a FAIL, never a silent pass.
      await check(`B0 vite dev server on 127.0.0.1:${PORT}`, () => { throw new Error(`${e.message}\n${errText.split("\n").slice(0, 4).join("\n")}`); });
      server.kill("SIGTERM");
      return;
    }
    BASE = `http://localhost:${PORT}/`;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    await freshDeviceRun(browser, BASE, { label: "B1 no name", name: "" });
    await freshDeviceRun(browser, BASE, { label: "B2 name present", name: "Honeybun" });
    await freshDeviceFailure(browser, BASE, "reject");
    await freshDeviceFailure(browser, BASE, "fail");
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

// One browser context + one CDP virtual authenticator = the user's platform passkey store (iCloud Keychain / Google
// Password Manager analogue). The app's local storage is wiped separately — that is the fresh device/profile.
// (Exporting the credential with WebAuthn.getCredentials and re-importing with addCredential into another authenticator
// was the first harness: the CDP Credential carries no PRF/hmac-secret key, so the imported passkey cannot answer the
// PRF request and recovery failed for a HARNESS reason — first coordinator run, browser_coordinator.log.)
async function newDevice(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT);
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH_OPTS });
  return { context, p, cdp, authenticatorId, errors };
}
const sceneOf = (p) => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
const waOf = (p) => p.evaluate(() => ({ get: window.__wa.get, create: window.__wa.create, scenes: [...window.__wa.scenes], getOpts: window.__wa.getOpts, lastGet: window.__wa.lastGet || null }));
const markersOf = (p) => p.evaluate((K) => Object.fromEntries(Object.entries(K).map(([k, v]) => [k, localStorage.getItem(v) !== null])), KEYS);
const cardText = (p) => p.evaluate(() => (document.querySelector('[data-scene="birth"]')?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200));
async function waitScene(p, want, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await sceneOf(p).catch(() => null);
    if (want.includes(s) && (s !== "birth" || await p.locator("#authTryAgainButton, #checkButton").count())) return s;
    await sleep(150);
  }
  return `TIMEOUT:${await sceneOf(p).catch(() => null)}`;
}

// Genuine NEW user on this profile (no passkey anywhere yet): first Invite Open only looks (get, no create) → Make new →
// Invite → second explicit Open creates → Hatch. This is both the regression for the new-user path and the way the
// "existing" passkey comes to exist on the platform authenticator.
async function mintAsNewUser(d, BASE) {
  await d.p.goto(BASE, { waitUntil: "networkidle" });
  await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
  await d.p.locator("#inviteFaceButton").click();
  const first = await waitScene(d.p, ["hatch", "name", "sendstay", "birth"], 30000);
  const w1 = await waOf(d.p);
  assert.equal(first, "birth", `new user, tap 1 (nothing to find) → failure card; trace ${w1.scenes.join(">")}`);
  deq({ get: w1.get, create: w1.create }, { get: 1, create: 0 }, "new user tap 1 looks only");
  await d.p.locator("#authTryAgainButton").click();
  await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
  await d.p.locator("#inviteFaceButton").click();
  const second = await waitScene(d.p, ["hatch", "name", "sendstay", "birth"], 30000);
  const w2 = await waOf(d.p);
  assert.ok(["hatch", "name"].includes(second) && w2.scenes.includes("hatch"), `new user, explicit second Open → Hatch rendered; trace ${w2.scenes.join(">")} · card "${await cardText(d.p)}"`);
  deq({ get: w2.get, create: w2.create }, { get: 1, create: 1 }, "new user: exactly one create on the explicit Open");
  const address = await d.p.evaluate(() => localStorage.getItem("araso.address"));
  assert.match(String(address), /^0x[0-9a-fA-F]{40}$/, "new Piggy address");
  const { credentials } = await d.cdp.send("WebAuthn.getCredentials", { authenticatorId: d.authenticatorId });
  assert.equal(credentials.length, 1, "one passkey on the platform authenticator");
  assert.equal(credentials[0].isResidentCredential, true, "discoverable");
  return address;
}

// Fresh device/profile: wipe every app-side store of the origin (local/session storage, IndexedDB, cache, cookies) and reload
// (new JS memory → freshRecoveryTried=false). The platform passkey stays.
async function wipeToFreshProfile(d, BASE, name) {
  // Leave the app first so no running Hatch/timer can write a marker after the wipe.
  await d.p.goto("about:blank");
  await d.cdp.send("Storage.clearDataForOrigin", { origin: new URL(BASE).origin, storageTypes: "all" });
  await d.p.goto(BASE, { waitUntil: "networkidle" });
  await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await d.p.reload({ waitUntil: "networkidle" });
  if (name) { await d.p.evaluate((n) => localStorage.setItem("araso.piggyName", n), name); await d.p.reload({ waitUntil: "networkidle" }); }
  await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
}

async function freshDeviceRun(browser, BASE, { label, name }) {
  await check(`${label}: [new user → Hatch regression] then fresh profile + that existing discoverable passkey → FIRST Invite Open tap recovers: get 1 (discoverable) · create 0 · same address · Home sendstay · Name/Hatch/hello never rendered · birth-played absent`, async () => {
    const d = await newDevice(browser);
    const address = await mintAsNewUser(d, BASE);
    await wipeToFreshProfile(d, BASE, name);
    deq(await markersOf(d.p), { ...NONE, name: !!name }, "markerless before the tap");
    deq(await d.p.evaluate(() => [window.__wa.get, window.__wa.create]), [0, 0], "no WebAuthn on load");
    await d.p.locator("#inviteFaceButton").click();
    const landed = await waitScene(d.p, ["name", "sendstay", "hatch", "birth"], 30000);
    // Nothing may follow (no delayed Hatch / hello): sample for 3s whether any Hatch/hello node is actually VISIBLE.
    // The Name scene's piggy (public/motion/name-piggy.html) always carries the archived `.pghello` node, switched off by
    // style.css `.nameScene .pghello { display: none }` (A-290) — presence alone is not playback; visibility is.
    const visibleHatchHello = [];
    for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
      const v = await d.p.evaluate(() => [...document.querySelectorAll(".stage--hatch, #skipHatchButton, [class*='hello'], img[src*='hello']")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const visible = typeof el.checkVisibility === "function" ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : getComputedStyle(el).display !== "none";
          return visible && r.width > 0 && r.height > 0;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, ".")}#${el.id}`));
      for (const x of v) if (!visibleHatchHello.includes(x)) visibleHatchHello.push(x);
      await sleep(100);
    }
    const wa = await waOf(d.p);
    const diag = `trace ${wa.scenes.join(">")} · lastGet ${JSON.stringify(wa.lastGet)} · card "${landed === "birth" ? await cardText(d.p) : ""}"`;
    deq({ get: wa.get, create: wa.create }, { get: 1, create: 0 }, `credentials counts (${diag})`);
    deq(wa.getOpts, [{ allow: 0 }], "the one get is a discoverable request (no allowCredentials)");
    assert.equal(landed, "sendstay", `landed on ${landed}; ${diag}`);
    assert.equal(await sceneOf(d.p), landed, "stayed");
    assert.equal(wa.scenes.includes("hatch"), false, `Hatch never rendered: ${diag}`);
    assert.equal(await d.p.locator(".stage--hatch, #skipHatchButton").count(), 0, "no Hatch stage / skip button in the DOM");
    const helloNodes = await d.p.evaluate(() => [...document.querySelectorAll("[class*='hello'], img[src*='hello']")].map((el) => `${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, ".")} display=${getComputedStyle(el).display}`));
    deq(visibleHatchHello, [], `no Hatch/hello node VISIBLE during the 3s after landing (hidden archived nodes present: ${JSON.stringify(helloNodes)}; ${diag})`);
    const m = await markersOf(d.p);
    assert.equal(m.birth, false, "birth-played still absent (hasPlayedBirth()=false) yet no Hatch");
    deq([m.cred, m.addr, m.recv], [true, true, true], "existing Piggy adopted");
    assert.equal((await d.p.evaluate(() => localStorage.getItem("araso.address"))).toLowerCase(), address.toLowerCase(), "same Piggy (same address as before the wipe)");
    if (name) {
      // "Same place, same Piggy." semantics on Home = same address (above) + same name on the plain Home, no Send card.
      // checkPiggy sets ("sendstay", "Piggy is home.", "Same place, same Piggy.") — asserted byte-exact in Part N (N2/N5) —
      // but plain Home renders message/detail only inside the Send card (renderSendStay: state.sendCardVisible, A-354-b),
      // so the line is not on screen here. Showing it would be a UI/copy change (forbidden) — reported, not patched.
      const home = await d.p.evaluate(() => ({
        homeName: document.querySelector("#homeName")?.textContent?.trim() ?? null,
        sendCard: !!document.querySelector("#sendCardAnchor"),
        lineVisible: document.body.innerText.includes("Same place, same Piggy."),
      }));
      deq({ homeName: home.homeName, sendCard: home.sendCard }, { homeName: name, sendCard: false }, `plain Home shows the same Piggy (${JSON.stringify(home)})`);
      console.log(`      note B2: "Same place, same Piggy." on screen = ${home.lineVisible} (plain Home has no message slot; Part N pins the setScene copy)`);
    }
    else {
      assert.equal(await d.p.locator("#piggyNameInput").count(), 0, "UNKNOWN existing name never forces Name it");
      assert.equal(await d.p.evaluate(() => document.querySelector("#homeName")?.textContent?.trim()), "Piggy", "existing unnamed Piggy uses the current Home fallback label");
    }
    // reload of the recovered-but-never-played device still never routes to Hatch
    await d.p.reload({ waitUntil: "networkidle" });
    await sleep(1500);
    const after = await waOf(d.p);
    assert.equal(after.scenes.includes("hatch"), false, `reload trace ${after.scenes.join(">")}`);
    assert.equal(after.create, 0);
    deq(d.errors, [], "pageerror 0");
    await d.context.close();
  });
}

async function freshDeviceFailure(browser, BASE, mode) {
  await check(`B3 [${mode === "reject" ? "cancel NotAllowedError" : "failure UnknownError"}] fresh profile with an existing passkey: first Invite Open → recovery fails → failure card; create 0 on that tap (waited past the Invite timer); no marker written; no Hatch`, async () => {
    const d = await newDevice(browser);
    await mintAsNewUser(d, BASE);
    await wipeToFreshProfile(d, BASE, "");
    await d.p.evaluate((m) => { window.__wa.mode = m; }, mode);
    await d.p.locator("#inviteFaceButton").click();
    const landed = await waitScene(d.p, ["birth", "name", "sendstay", "hatch"], 30000);
    await sleep(4000);
    const wa = await waOf(d.p);
    assert.equal(landed, "birth", `trace ${wa.scenes.join(">")}`);
    deq({ get: wa.get, create: wa.create }, { get: 1, create: 0 }, "same tap: one recovery attempt, zero creation");
    deq(await d.p.evaluate(() => [...document.querySelectorAll(".authCard__actions button")].map((b) => b.id)), ["authTryAgainButton"], "only the explicit Make new (→ Invite)");
    deq(await markersOf(d.p), NONE, "no marker written");
    assert.equal(wa.scenes.includes("hatch"), false);
    deq(d.errors, [], "pageerror 0");
    await d.context.close();
  });
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

if (process.env.A726_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A726_NODE_ONLY=1) — browser scenarios not run");
  finish();
} else {
  await runBrowser();
  finish();
}
