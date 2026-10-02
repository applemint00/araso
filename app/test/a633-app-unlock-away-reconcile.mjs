// [A-633] APP UNLOCK CHECKING + AWAY/PENDING REENTRY RECONCILE — focused regression test.
//   node app/test/a633-app-unlock-away-reconcile.mjs
//
// Cuts the REAL main.js text (same technique as session-lifetime.mjs / send-lock.mjs) and runs it in
// node:vm with a deterministic fake clock and spies. Network 0 · browser 0 · real WebAuthn 0 · tx 0.
//   A  source contracts — unlock path never reaches signer/creation/permission/gift; reconcile path never
//      reaches sign/send/grant/approve/wallet/permission/gift; boot never calls WebAuthn by itself.
//   B  unlock-only runtime — WebAuthn called synchronously inside the tap, pinned credential only,
//      prfOutput zeroed, signing session 0, signer timer 0, activeSignerAddress "", app-idle armed.
//   C  app-idle 10m on the mobile/app surface → locked presentation (destination kept); web unchanged;
//      trusted activity refreshes; the signer's 5-minute absolute cap is not touched by unlock.
//   D  First Send pending reconcile matrix — every stage with mocked public receipt reads.
// On the pre-A-633 tree the new functions do not exist → the first cut throws → exit 1.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getEvmAddress, createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { TransactionReceiptNotFoundError } from "viem";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
// vm-realm objects have a different Object.prototype — compare plain JSON shapes (bigint kept as "<n>n").
const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? "null");
const deq = (a, b, msg) => assert.deepEqual(norm(a), norm(b), msg);
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음(시작): ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN.slice(start, end);
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`함수 없음: ${name}`);
  const start = m.index;
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", start)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(start, i + 1); }
  }
  throw new Error(`함수 끝 없음: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SESSION_SRC = `${cut("let activeSession = null;", "function readCredential()")}\n${cut("function endSignerSession() {", "// --- 씬 정리 (A-292 번호 9)")}`;
const UNLOCK_SRC = cut("function unlockApp() {", "function stayHome() {");
const RECONCILE_SRC = cut("// [A-633 C] First Send 미확정 기록", "async function requestGrant(");
const PENDING_SRC = cut("function readSendPending() {", "function sendBusy()");
const COMMIT_SRC = fnBody("commitSendSuccess");
const BOOT_SRC = cut("// [A-633 A/C] 모바일/app 표면에서 저장된 credential", "// [A-559 PHASE S1] Gift 링크 fragment");
const SHMON_ADDRESS = MAIN.match(/const SHMON_ADDRESS = "(0x[0-9a-fA-F]{40})";/)[1];

// ═══ A. source contracts ═════════════════════════════════════════════════════════════════════
const UNLOCK_FNS = ["unlockApp", "settleUnlock", "renderAppLock", "lockAppAfterIdle", "appLockSurface"];
const RECONCILE_FNS = ["isTxHash", "readSendTxReceipt", "classifySendPending", "reconciledSendReceipt", "awayRestoreLineMarkup", "showAwayRestore", "reconcileSendPending", "chogHomeMarkupForAway"];
const SIGNER_OR_CREATE = ["activateSigningSession(", "createSecp256k1SigningSession(", "armSignerExpiry(", "activeSignerAddress =", "recoverPiggy(", "checkPiggy(", "startPiggyOpen(", "openPiggy(", "createPasskeyWithPrfOutput(", "credentials.create"];
const MONEY = ["sendTransaction", "signDigest", "signMessage", "requestGrant(", "approve(", "createWalletClient", "activeSession", "activeAccount", "issuePermission(", "authorize(", "requestMoneyPermission(", "sendPiggy("];
const GIFT = ["takePendingGiftClaim(", "bindGiftToNewPiggy(", "settleBoundGiftClaim(", "beginGiftClaim(", "restorePendingGiftClaim("];

await check("A1 unlock/lock functions never reach signer creation, passkey creation, money or Gift", () => {
  for (const name of UNLOCK_FNS) {
    const body = stripComments(fnBody(name));
    for (const bad of [...SIGNER_OR_CREATE, ...MONEY, ...GIFT, "localStorage.setItem"]) {
      assert.equal(body.includes(bad), false, `${name} contains ${bad}`);
    }
  }
});
await check("A2 unlockApp calls requestPrf with the pinned stored credential, with no await/timer/render before it", () => {
  const body = stripComments(fnBody("unlockApp"));
  const at = body.indexOf("requestPrf(pinned, { prfSalt: storedPrfSalt() })");
  assert.ok(at > 0, "requestPrf(pinned, { prfSalt: storedPrfSalt() }) present");
  const before = body.slice(0, at);
  for (const bad of ["await ", "setTimeout(", "sceneTimeout(", "render(", "setScene(", "requestAnimationFrame("]) {
    assert.equal(before.includes(bad), false, `found ${bad} before the WebAuthn call`);
  }
  assert.equal((body.match(/requestPrf\(/g) || []).length, 1, "exactly one requestPrf call");
  assert.equal(/requestPrf\(null/.test(body), false, "no unpinned fallback");
});
await check("A3 settleUnlock zeroes prfOutput and forwards it nowhere; success arms only app-idle (touchAppSession)", () => {
  const body = stripComments(fnBody("settleUnlock"));
  assert.ok(body.includes("result.prfOutput.fill(0)"), "prfOutput zeroed");
  assert.equal((body.match(/prfOutput/g) || []).length, 2, "prfOutput referenced only by the instanceof guard + fill(0)");
  assert.ok(body.includes("touchAppSession()"), "app-idle armed on success");
});
await check("A4 reconcile path is read-only: no sign/send/grant/approve/wallet/permission/auth/Gift call", () => {
  for (const name of RECONCILE_FNS) {
    const body = stripComments(fnBody(name));
    for (const bad of [...SIGNER_OR_CREATE, ...MONEY, ...GIFT, "requestPrf(", "writeSendPending("]) {
      assert.equal(body.includes(bad), false, `${name} contains ${bad}`);
    }
  }
  const all = stripComments(RECONCILE_SRC);
  const calls = [...all.matchAll(/publicClient\.(\w+)\(/g)].map((m) => m[1]);
  deq([...new Set(calls)].sort(), ["getBalance", "getTransaction", "getTransactionReceipt", "readContract", "waitForTransactionReceipt"]);
});
await check("A4b the only readContract call in reconcile is ERC-20 style balanceOf (a view)", () => {
  const all = stripComments(RECONCILE_SRC);
  const fns = [...all.matchAll(/functionName: "(\w+)"/g)].map((m) => m[1]);
  deq([...new Set(fns)], ["balanceOf"]);
});
await check("A5 boot: lock only on the mobile/app surface for a stored credential with a Name/Home destination; boot calls no WebAuthn", () => {
  const b = stripComments(BOOT_SRC);
  assert.ok(/if \(state\.credential && \(state\.scene === "name" \|\| state\.scene === "sendstay"\) && appLockSurface\(\)\)/.test(b));
  for (const bad of ["unlockApp(", "requestPrf(", "checkPiggy(", "recoverPiggy(", "startPiggyOpen(", "openPiggy("]) assert.equal(b.includes(bad), false, `boot contains ${bad}`);
  const surf = stripComments(fnBody("appLockSurface"));
  assert.ok(surf.includes("window.innerWidth <= 640 && isAllowedPiggyRpId()"));
});
await check("A6 render() draws only the lock while locked (before any destination markup/mount)", () => {
  const r = stripComments(fnBody("render"));
  const lockAt = r.indexOf("if (state.appLock)");
  assert.ok(lockAt > 0 && lockAt < r.indexOf("const markup"), "lock branch precedes destination markup");
  assert.ok(r.slice(lockAt, r.indexOf("const markup")).includes("return;"));
});
await check("A7 single raw-signer creation site unchanged (createSecp256k1SigningSession once, inside activateSigningSession)", () => {
  assert.equal((MAIN.match(/createSecp256k1SigningSession\(/g) || []).length, 1);
  assert.ok(fnBody("activateSigningSession").includes("createSecp256k1SigningSession({ privateKey: prfOutput })"));
});
await check("A8 renderAuthCard default call keeps the pre markup (div Chog, no data-app-lock) — lock-only flags are opt-in", () => {
  const body = fnBody("renderAuthCard");
  assert.ok(body.includes("function renderAuthCard(view = state)"));
  assert.ok(body.includes('`<div class="authCard__chog" aria-hidden="true">${chogInviteMarkup()}</div>`'));
  assert.ok(body.includes('data-scene="birth"${view.appLock ? ` data-app-lock="${view.appLock}"` : ""}'));
});

// ═══ fake clock ═════════════════════════════════════════════════════════════════════════════
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
    now: () => now,
    pending: () => [...timers.values()].map((t) => t.fireAt),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function mockStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}

// ═══ B/C. unlock + idle app ═════════════════════════════════════════════════════════════════
function buildUnlockApp({ width = 390, allowed = true, credential = { credentialId: "cred-1" }, prf } = {}) {
  const clock = makeFakeClock();
  const calls = { requestPrf: [], sess: 0, render: 0, scenes: [], errors: [], prfOutputs: [] };
  const state = { scene: "sendstay", message: "", detail: "", credential, appLock: { phase: "waiting", cancelled: false }, activeSignerAddress: "", address: "0xabc", homePaperMode: "home", moneyIntent: null };
  const storage = mockStorage({ "araso.piggyName": "Honeybun" });
  const ctx = {
    state, console, Date, JSON, Promise, Uint8Array,
    window: { innerWidth: width },
    localStorage: storage,
    createSecp256k1SigningSession: (o) => { calls.sess += 1; return createSecp256k1SigningSession(o); },
    getEvmAddress, toViemAccount,
    isAllowedPiggyRpId: () => allowed,
    readPiggyName: () => storage.getItem("araso.piggyName") || "",
    render: () => { calls.render += 1; },
    setScene: (...a) => { calls.scenes.push(a); },
    storedPrfSalt: () => new Uint8Array(32).fill(1),
    isCancelledAuthError: (e) => e?.name === "NotAllowedError" || e?.cause?.name === "NotAllowedError",
    recordSafeError: (phase) => { calls.errors.push(phase); },
    // [A-669] lockAppAfterIdle 가 먼저 부르는 Check/Open 시도 무효화(authAttempt 영역은 이 하네스 밖) — 살아 있는 시도 없음.
    invalidateLiveAuthAttempt: () => false,
    requestPrf: (credentialArg, opts) => {
      calls.requestPrf.push({ credentialArg, opts, atTick: clock.now() });
      return prf ? prf(credentialArg) : Promise.resolve({ credentialId: credentialArg?.credentialId, prfOutput: (() => { const b = new Uint8Array(32).fill(7); calls.prfOutputs.push(b); return b; })() });
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(`${SESSION_SRC}\n${UNLOCK_SRC}\nthis.__api = { unlockApp, activateSigningSession, touchAppSession, lockAppAfterIdle };\nthis.__get = () => ({ hasSigner: !!activeSession, signerArmed: signerExpiryTimer !== null, idleArmed: idleTimer !== null });`, ctx);
  return { clock, calls, state, storage, ...ctx.__api, get: ctx.__get };
}

await check("B1 Chog tap: WebAuthn requested synchronously inside the tap (same task), pinned credential + stored salt", async () => {
  const app = buildUnlockApp();
  app.unlockApp();
  assert.equal(app.calls.requestPrf.length, 1, "requestPrf already called before unlockApp() returned — no await/timer before it");
  deq(app.calls.requestPrf[0].credentialArg, { credentialId: "cred-1" });
  assert.equal(app.calls.requestPrf[0].opts.prfSalt.length, 32);
  assert.equal(app.state.appLock.phase, "checking");
});
await check("B2 success unlocks identity only: signing session 0 · signer timer 0 · activeSignerAddress '' · moneyIntent null · prfOutput zeroed · app-idle armed", async () => {
  const app = buildUnlockApp();
  app.unlockApp();
  await flush();
  assert.equal(app.state.appLock, null, "unlocked");
  assert.equal(app.calls.sess, 0, "createSecp256k1SigningSession never called");
  deq(app.get(), { hasSigner: false, signerArmed: false, idleArmed: true });
  assert.equal(app.state.activeSignerAddress, "");
  assert.equal(app.state.moneyIntent, null);
  assert.ok(app.calls.prfOutputs[0].every((b) => b === 0), "PRF output bytes zeroed");
  // [A-667 re-pin] was 1. unlockApp now renders the "checking" lock view once right AFTER requestPrf is called
  // (Chog lifts above the iOS sheet), then settleUnlock renders the destination once → 2 total.
  assert.equal(app.calls.render, 2, "checking view once + destination once");
  assert.equal(app.state.scene, "sendstay", "destination preserved");
  deq(app.storage.keys().sort(), ["araso.piggyName"], "no storage write");
});
await check("B3 a different credential (not the stored one) does NOT unlock → existing failure card, lock kept", async () => {
  const app = buildUnlockApp({ prf: () => Promise.resolve({ credentialId: "someone-else", prfOutput: new Uint8Array(32).fill(9) }) });
  app.unlockApp();
  await flush();
  assert.equal(app.state.appLock.phase, "failed");
  assert.equal(app.calls.sess, 0);
});
await check("B4 cancel (NotAllowedError) → failed + cancelled, lock kept, no retry/creation", async () => {
  const err = Object.assign(new Error("x"), { name: "NotAllowedError" });
  const app = buildUnlockApp({ prf: () => Promise.reject(err) });
  app.unlockApp();
  await flush();
  deq({ phase: app.state.appLock.phase, cancelled: app.state.appLock.cancelled }, { phase: "failed", cancelled: true });
  assert.equal(app.calls.requestPrf.length, 1);
  deq(app.calls.errors, ["unlock"]);
});
await check("B5 double tap while checking → still one WebAuthn call", async () => {
  const app = buildUnlockApp({ prf: () => new Promise(() => {}) });
  app.unlockApp(); app.unlockApp(); app.unlockApp();
  assert.equal(app.calls.requestPrf.length, 1);
});
await check("B6 no stored credential / unsupported origin → failure card without any WebAuthn call", async () => {
  const a = buildUnlockApp({ credential: null });
  a.unlockApp();
  assert.equal(a.calls.requestPrf.length, 0);
  assert.equal(a.state.appLock.phase, "failed");
  const b = buildUnlockApp({ allowed: false });
  b.unlockApp();
  assert.equal(b.calls.requestPrf.length, 0);
});

const TEN_MIN = 10 * 60 * 1000;
await check("C1 mobile app-idle 10m → signer ended + locked presentation, Home destination kept (resting copy), no new auth", () => {
  const app = buildUnlockApp();
  app.state.appLock = null;
  app.activateSigningSession(new Uint8Array(32).fill(3)); // a money/recovery auth happened earlier
  assert.equal(app.get().hasSigner, true);
  app.clock.advance(TEN_MIN - 1000);
  assert.equal(app.state.appLock, null, "not locked at 9m59s");
  app.clock.advance(2000);
  deq(app.state.appLock, { phase: "waiting", cancelled: false });
  deq(app.get(), { hasSigner: false, signerArmed: false, idleArmed: false });
  deq([app.state.scene, app.state.message], ["sendstay", "Piggy is resting."]);
  assert.equal(app.calls.scenes.length, 0, "no unlocked Home setScene on the mobile surface");
  assert.equal(app.calls.requestPrf.length, 0);
});
await check("C2 mobile idle keeps Name / Away destinations", () => {
  const n = buildUnlockApp(); n.state.appLock = null; n.state.scene = "name"; n.storage.setItem("araso.piggyName", "");
  n.touchAppSession(); n.clock.advance(TEN_MIN + 1);
  deq([n.state.scene, n.state.appLock?.phase], ["name", "waiting"]);
  const a = buildUnlockApp(); a.state.appLock = null; a.state.scene = "away";
  a.touchAppSession(); a.clock.advance(TEN_MIN + 1);
  deq([a.state.scene, a.state.appLock?.phase], ["away", "waiting"]);
});
await check("C3 web (1440) idle behavior unchanged: existing resting setScene, no lock", () => {
  const app = buildUnlockApp({ width: 1440 });
  app.state.appLock = null;
  app.touchAppSession(); app.clock.advance(TEN_MIN + 1);
  assert.equal(app.state.appLock, null);
  deq(app.calls.scenes.at(-1), ["sendstay", "Piggy is resting.", "Open again when you need it."]);
});
await check("C4 unlock never arms/extends the signer's 5-minute absolute cap", async () => {
  const app = buildUnlockApp();
  app.state.appLock = null;
  app.activateSigningSession(new Uint8Array(32).fill(3)); // signer @ t=0 → expires t=5m
  app.clock.advance(4 * 60 * 1000);
  app.state.appLock = { phase: "waiting", cancelled: false };
  app.unlockApp(); await flush();
  assert.equal(app.state.appLock, null);
  app.clock.advance(60 * 1000 + 1000); // t=5m01s — original signer cap still fires
  assert.equal(app.get().hasSigner, false, "signer expired on its original schedule");
  assert.equal(app.get().idleArmed, true, "app-idle still running from the unlock");
});

// ═══ D. pending reconcile matrix ═══════════════════════════════════════════════════════════
const ADDR = "0x42a277c62556cdb96a62b4c7cfe43e09eec0053a";
const D = "0x" + "d".repeat(64);
const E = "0x" + "e".repeat(64);
function rcpt(hash, { status = "success", from = ADDR, block = 100n } = {}) {
  return { transactionHash: hash, status, from, to: SHMON_ADDRESS.toLowerCase(), blockNumber: block, gasUsed: 50000n, effectiveGasPrice: 100n };
}
function buildReconcile(record, sc) {
  const storage = mockStorage(record === undefined ? {} : { "araso.sendPending": typeof record === "string" ? record : JSON.stringify({ ...record, address: record.address ?? ADDR }) });
  const calls = { finish: [], scenes: [], lineWrites: [], reads: [], forbidden: [] };
  const state = { awayRestore: "checking", txHash: "", scene: "away" };
  const forbid = (n) => () => { calls.forbidden.push(n); throw new Error(`forbidden ${n}`); };
  const publicClient = {
    async getTransactionReceipt({ hash }) {
      calls.reads.push(["receipt", hash]);
      const w = hash === D ? sc.dep : hash === E ? sc.red : "null";
      if (w === "error") throw Object.assign(new Error("rpc down"), { name: "HttpRequestError" });
      if (!w || w === "null") throw new TransactionReceiptNotFoundError({ hash });
      if (w === "mismatch") return rcpt(hash, { from: "0x" + "1".repeat(40) });
      return rcpt(hash, { status: w === "reverted" ? "reverted" : "success", block: hash === D ? 100n : 101n });
    },
    async getTransaction({ hash }) { calls.reads.push(["tx", hash]); if (sc.histFail) throw new Error("no archive"); return { hash, value: 10n ** 15n }; },
    async getBalance({ blockNumber }) { calls.reads.push(["bal", blockNumber]); if (sc.histFail) throw new Error("no archive"); return blockNumber === 99n ? 5n * 10n ** 17n : 499n * 10n ** 15n; },
    async readContract({ functionName, blockNumber }) { calls.reads.push(["call", functionName, blockNumber]); return blockNumber === 100n ? 990n * 10n ** 12n : 0n; },
    waitForTransactionReceipt: ({ hash }) => { calls.reads.push(["wait", hash]); return sc.waitResolves ? Promise.resolve(rcpt(hash)) : new Promise(() => {}); },
    sendTransaction: forbid("sendTransaction"),
  };
  const ctx = {
    state, console, JSON, Date, String, Promise,
    localStorage: storage,
    publicClient,
    SHMON_ADDRESS, SHMON_ABI: [],
    indexedPiggyId: (a) => `legacy-${String(a).toLowerCase()}`,
    finishTrip: (trip) => { calls.finish.push(trip); },
    setScene: (...a) => calls.scenes.push(a),
    document: { querySelector: (sel) => (sel === "#awayRestoreLine" ? { set innerHTML(v) { calls.lineWrites.push(v); } } : null) },
    homePadMarkup: () => "", chogHomeMarkup: () => "",
    requestGrant: forbid("requestGrant"), createWalletClient: forbid("createWalletClient"), activateSigningSession: forbid("activateSigningSession"),
    requestPrf: forbid("requestPrf"), recoverPiggy: forbid("recoverPiggy"), issuePermission: forbid("issuePermission"),
    takePendingGiftClaim: forbid("takePendingGiftClaim"),
  };
  vm.createContext(ctx);
  vm.runInContext(`const SEND_PENDING_KEY = "araso.sendPending";\nconst SEND_PENDING_STAGES = ["deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"];\n${PENDING_SRC}\n${COMMIT_SRC}\n${RECONCILE_SRC}\nthis.__run = (p) => reconcileSendPending(p);\nthis.__read = () => readSendPending();`, ctx);
  return { calls, state, storage, publicClient, run: () => ctx.__run(ctx.__read()) };
}
async function stage(record, sc) {
  const r = buildReconcile(record, sc);
  const result = await r.run();
  await flush(); await flush();
  return { r, result };
}
const noMoney = (r) => deq(r.calls.forbidden, [], "no forbidden call");

await check("D1 deposit-sending / redeem-sending / unknown record: no hash read, can't tell yet., pending kept", async () => {
  for (const rec of [{ stage: "deposit-sending" }, { stage: "redeem-sending", depositTxHash: D }, "{not json"]) {
    const { r, result } = await stage(rec, {});
    assert.equal(result.kind, "unknown");
    assert.equal(r.calls.reads.length, 0, "no chain read without a reliable broadcast hash");
    assert.equal(r.state.awayRestore, "unknown");
    assert.ok(r.storage.getItem("araso.sendPending"));
    assert.equal(r.calls.finish.length, 0);
    noMoney(r);
  }
});
await check("D2 deposit-broadcast + receipt pending → still out., pending kept", async () => {
  const { r, result } = await stage({ stage: "deposit-broadcast", depositTxHash: D }, { dep: "null" });
  assert.equal(result.kind, "pending");
  assert.equal(r.state.awayRestore, "pending");
  assert.ok(r.storage.getItem("araso.sendPending"));
  assert.equal(r.calls.finish.length, 0);
  noMoney(r);
});
await check("D3 deposit-broadcast + receipt success, no redeem hash → still out., NOT finished, no auto-redeem, record unchanged", async () => {
  const rec = { stage: "deposit-broadcast", depositTxHash: D };
  const { r, result } = await stage(rec, { dep: "success" });
  assert.equal(result.kind, "deposit-confirmed");
  assert.equal(result.depositBlockNumber, 100n, "deposit completion recorded in the (memory) result for a later explicit resume");
  assert.equal(r.state.awayRestore, "pending");
  assert.equal(r.calls.finish.length, 0);
  assert.equal(JSON.parse(r.storage.getItem("araso.sendPending")).stage, "deposit-broadcast");
  assert.equal(r.storage.getItem("araso.txHash"), null);
  noMoney(r);
});
await check("D4 redeem-broadcast + receipt pending → still out. + read-only wait on the same hash", async () => {
  const { r, result } = await stage({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "success", red: "null" });
  assert.equal(result.kind, "pending");
  assert.equal(r.state.awayRestore, "pending");
  deq(r.calls.reads.filter((x) => x[0] === "wait"), [["wait", E]]);
  assert.equal(r.calls.finish.length, 0);
  noMoney(r);
});
await check("D5 redeem-broadcast + success → commitSendSuccess (pending cleared, txHash set) → existing finishTrip with a chain-pinned Receipt", async () => {
  const { r, result } = await stage({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "success", red: "success" });
  assert.equal(result.kind, "success");
  assert.equal(r.storage.getItem("araso.sendPending"), null);
  assert.equal(r.storage.getItem("araso.txHash"), E);
  assert.equal(r.calls.finish.length, 1);
  const t = r.calls.finish[0];
  deq([t.outcome, t.reason], ["done", "ok"]);
  deq(
    { before: t.receipt.before, after: t.receipt.after, gas: t.receipt.gas, sent: t.receipt.sent, dep: t.receipt.depositTxHash, red: t.receipt.redeemTxHash, tx: t.receipt.txHash, db: t.receipt.depositBlockNumber, rb: t.receipt.redeemBlockNumber, shmon: t.receipt.shmonReceived, grant: t.receipt.grantTxHash, piggyId: t.receipt.piggyId },
    { before: 5n * 10n ** 17n, after: 499n * 10n ** 15n, gas: 10000000n, sent: 10n ** 15n, dep: D, red: E, tx: E, db: 100n, rb: 101n, shmon: 990n * 10n ** 12n, grant: "", piggyId: `legacy-${ADDR}` },
  );
  assert.ok(r.calls.reads.some((x) => x[0] === "bal" && x[1] === 99n), "before = balance at the block before the deposit");
  noMoney(r);
});
await check("D5b redeem success but historical reads unavailable → existing done/balance-unavailable (no fabricated numbers)", async () => {
  const { r } = await stage({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "success", red: "success", histFail: true });
  deq(r.calls.finish, [{ outcome: "done", reason: "balance-unavailable", receipt: null }]);
  assert.equal(r.storage.getItem("araso.sendPending"), null);
  noMoney(r);
});
await check("D5c redeem pending then later mined → the one read-only follow-up re-classifies and bridges once", async () => {
  const sc = { dep: "success", red: "null" };
  let release;
  const r = buildReconcile({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, sc);
  r.calls.waitGate = new Promise((res) => { release = res; });
  const pc = r.publicClient;
  pc.waitForTransactionReceipt = ({ hash }) => { r.calls.reads.push(["wait", hash]); return r.calls.waitGate; };
  await r.run();
  assert.equal(r.calls.finish.length, 0, "still out. first");
  sc.red = "success"; // the chain now has the redeem receipt
  release();
  for (let i = 0; i < 10; i += 1) await flush();
  assert.equal(r.calls.finish.length, 1);
  assert.equal(r.calls.finish[0].outcome, "done");
  assert.equal(r.storage.getItem("araso.sendPending"), null);
  noMoney(r);
});
await check("D5d follow-up wait resolves but the re-read still says pending (inconsistent RPC) → no second wait, no read loop", async () => {
  const sc = { dep: "success", red: "null", waitResolves: true };
  const r = buildReconcile({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, sc);
  await r.run();
  for (let i = 0; i < 20; i += 1) await flush();
  assert.equal(r.calls.reads.filter((x) => x[0] === "wait").length, 1, "exactly one follow-up wait");
  assert.equal(r.calls.reads.filter((x) => x[0] === "receipt").length, 2, "initial read + one re-read");
  assert.equal(r.calls.finish.length, 0);
});
await check("D6 reverted (redeem or deposit) → existing failed outcome, no success return, pending kept (Send stays locked)", async () => {
  for (const [rec, sc] of [[{ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "success", red: "reverted" }], [{ stage: "deposit-broadcast", depositTxHash: D }, { dep: "reverted" }]]) {
    const { r, result } = await stage(rec, sc);
    assert.equal(result.kind, "failed");
    deq(r.calls.finish, [{ outcome: "failed", reason: "reverted", receipt: null }]);
    assert.ok(r.storage.getItem("araso.sendPending"));
    assert.equal(r.storage.getItem("araso.txHash"), null);
    noMoney(r);
  }
});
await check("D7 RPC/read failure → can't tell yet., pending kept, nothing finished", async () => {
  const { r, result } = await stage({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "error", red: "error" });
  assert.equal(result.kind, "unknown");
  assert.equal(r.state.awayRestore, "unknown");
  assert.ok(r.storage.getItem("araso.sendPending"));
  assert.equal(r.calls.finish.length, 0);
  noMoney(r);
});
await check("D8 stored hash that is not this Piggy → shMON tx → can't tell yet. (never trusted as success)", async () => {
  const { r, result } = await stage({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "mismatch", red: "mismatch" });
  assert.equal(result.kind, "unknown");
  assert.equal(r.calls.finish.length, 0);
  noMoney(r);
});
await check("D9 record changed while reading (another outcome already settled it) → no action", async () => {
  const r = buildReconcile({ stage: "redeem-broadcast", depositTxHash: D, redeemTxHash: E }, { dep: "success", red: "success" });
  const p = r.run();
  r.storage.removeItem("araso.sendPending");
  await p;
  assert.equal(r.calls.finish.length, 0);
  assert.equal(r.storage.getItem("araso.txHash"), null);
});
await check("D10 Away line strings are exactly the card's: checking… / still out. / can't tell yet.", () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${fnBody("awayRestoreLineMarkup")}\nthis.f = awayRestoreLineMarkup;`, ctx);
  deq(["checking", "pending", "unknown"].map((k) => ctx.f(k)), ["checking…", "still out.", "can't tell yet."]);
});
await check("D11 viem's not-yet-mined error name is the one reconcile treats as pending", () => {
  assert.equal(new TransactionReceiptNotFoundError({ hash: D }).name, "TransactionReceiptNotFoundError");
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
