// A-1131 render pin: defer Invite auth presentation before teardown; auth/money bodies unchanged.
// [A-707 MONEY SAFETY M2-BETA · FIRST PRE-BROADCAST] node-only failure-injection contract.
//   node app/test/money-safety-m2b.mjs
//   M2B_FORK_RPC=http://127.0.0.1:8545 node app/test/money-safety-m2b.mjs   (optional: extra local-fork transaction-format parity; anvil --chain-id 10143)
//
// Runs main.js's ACTUAL function text (new Function over cut source, same technique as money-safety-first / send-lock / a698) with fake storage,
// fake Web Locks shared between "tabs", a scripted chain and counters on every money step. Network 0 · browser 0 · real WebAuthn 0 · real keys 0 · tx 0.
//
// State order under test (First legacy):
//   reserve(sync, before any auth attempt; THIS TAB'S key araso.sendPending.reserve.<tabId> only) -> [passkey]
//     -> confirm(take the exclusive lock, promote into the shared araso.sendPending only if empty, KEEP the lock) -> [grant, simulate]
//     -> prepare -> SIGN -> persist {hash, nonce} + verify -> BROADCAST -> (phase sent) -> ... redeem leg ... -> lock released in sendPiggy finally
//     -> receipt -> verified save -> compare-and-clear
//   [A-707 r2] the shared record is never written outside the exclusive lock; writeOwnedSendPending and each broadcast re-assert the lock.
//
// Test-plan mapping (A-680 TEST_PLAN):
//   A1/A2/A3 (reserve / signed / post-broadcast writes)  R-series, B4-B6      A4/A5 (unreadable / corrupt record)  R3
//   C1..C8 (reload at every stage)                       W-series (crash windows)
//   D1..D5 (two tabs, locks absent)                      T-series, L-series
//   G1 (unknown RPC)                                     W-series (read error -> unknown)      H-series: source invariants
//   E1..E7 (F6 recovery-needed / resume)                 N/A here: F6 resume + N3 retry are Owner-gated and NOT implemented (no retry semantics)
//   G3/G4 (nonce-consumed unlock)                        N/A here: not implemented (needs block-pinned reads, U3 UNKNOWN) -> stays locked
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { TransactionReceiptNotFoundError, createWalletClient, createPublicClient, custom, http, keccak256, parseTransaction, recoverTransactionAddress, toHex } from "viem";
import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { decodeReceiptRow, encodeReceiptRow, receiptIdentityKey as codecReceiptIdentityKey, RECEIPT_KIND } from "../src/receipt-codec.js";
import { preparedSignProblem } from "../src/money-executor.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 7).join("\n      ")}`); fail += 1; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };

function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js: start not found: ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`main.js: end not found: ${endMarker}`);
  return MAIN.slice(start, end);
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (!m) throw new Error(`function missing: ${name}`);
  const start = m.index;
  return MAIN.slice(start, MAIN.indexOf("\n}\n", start) + 2);
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const CONSTS = [
  'const RECEIPTS_KEY = "araso.receipts";',
  'const TRIP_CLOSED_KEY = "araso.tripClosed";',
  'const SEND_PENDING_KEY = "araso.sendPending";',
  'const SEND_PENDING_STAGES = ["reserved", "deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"];',
];
for (const c of CONSTS) assert.ok(MAIN.includes(c), `const line still in main.js: ${c}`);
const SHMON_ADDRESS = MAIN.match(/const SHMON_ADDRESS = "(0x[0-9a-fA-F]{40})";/)[1];
const RECEIPT_FNS_SRC = cut("function readReceipts() {", "\nfunction writeCredential(credential) {");
const PENDING_SRC = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");
const RECONCILE_SRC = cut("// [A-633 C] First Send 미확정 기록", "async function requestGrant(");
const FINISH_SRC = fnBody("finishTrip");
const ONCE_SRC = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");
const SWEEP_CALL_SRC = fnBody("sweepStaleSendReservation");

// ── fakes ───────────────────────────────────────────────────────────────────────────────────────
function makeStorage() {
  const m = new Map();
  const fx = { throwSet: (k, v) => false, throwGet: new Set(), throwRemove: new Set(), dropSet: new Set(), getThrowsAfterSet: new Set() };
  const log = [];
  return {
    fx, log,
    getItem(k) { log.push(["get", k]); if (fx.throwGet.has(k)) throw new Error(`getItem ${k}`); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { log.push(["set", k, String(v)]); if (fx.throwSet(k, String(v))) throw new Error(`setItem ${k}`); if (fx.dropSet.has(k)) return; m.set(k, String(v)); },
    removeItem(k) { log.push(["remove", k]); if (fx.throwRemove.has(k)) throw new Error(`removeItem ${k}`); m.delete(k); },
    raw: (k) => (m.has(k) ? m.get(k) : null),
    has: (k) => m.has(k),
    put: (k, v) => m.set(k, v),
    rec: () => (m.has("araso.sendPending") ? JSON.parse(m.get("araso.sendPending")) : null),
    keys: () => [...m.keys()],
  };
}
// Web Locks stand-in shared by every "tab": exclusive, ifAvailable, query, and tab death (kill).
function makeLocks({ queryThrows = false, requestThrows = false, asyncGrant = false } = {}) {
  const held = new Map();
  const api = {
    held, queryThrows, requestThrows,
    async request(name, opts, cb) {
      if (api.requestThrows) throw new Error("locks request failed");
      if (asyncGrant) await new Promise((r) => setTimeout(r, 5)); // real browsers invoke the callback asynchronously
      if (held.has(name)) return opts.ifAvailable ? cb(null) : new Promise(() => {});
      // [A-707 r2] a held entry can be stolen (Web Locks `steal`): the holder's request promise rejects with AbortError and the lock is gone.
      const entry = {};
      const stolen = new Promise((_, reject) => { entry.abort = () => reject(Object.assign(new Error("lock stolen"), { name: "AbortError" })); });
      held.set(name, entry);
      try { return await Promise.race([cb({ name, mode: opts.mode || "exclusive" }), stolen]); } finally { if (held.get(name) === entry) held.delete(name); }
    },
    steal(name) { const e = held.get(name); held.delete(name); if (e && typeof e.abort === "function") e.abort(); },
    async query() { if (api.queryThrows) throw new Error("locks query failed"); return { held: [...held.keys()].map((name) => ({ name, mode: "exclusive" })), pending: [] }; },
    kill(name) { held.delete(name); },
    killPrefix(prefix) { for (const k of [...held.keys()]) if (k.startsWith(prefix)) held.delete(k); },
  };
  return api;
}
// [A-707 r2] every tab-scoped pre-lock reservation record currently in storage (araso.sendPending.reserve.<tabId>).
function tabRecs(storage) { return storage.keys().filter((k) => k.startsWith("araso.sendPending.reserve.")).map((k) => JSON.parse(storage.raw(k))); }
const ADDR = "0x42a277c62556cdb96a62b4c7cfe43e09eec0053a";
const RAW = (nonce) => `0xa${nonce}`;
const HASH = (nonce) => keccak256(RAW(nonce));
// Scripted chain: receipts by hash. sendRaw records the raw and (optionally) mines it.
function makeChain({ autoMine = true } = {}) {
  const chain = { receipts: new Map(), sent: [], autoMine, readError: false };
  chain.mine = (hash, status = "success", block = 100n) => chain.receipts.set(hash, { status, block });
  return chain;
}

// One browser tab running the REAL sendPiggy / sendPiggyOnce / finishTrip / reconcile text. `shared` = { storage, locks, chain }.
function makeTab(shared, opts = {}) {
  const { storage, locks, chain } = shared;
  const o = { freeze: null, signThrows: false, prepareThrows: false, sendRawThrows: null, sendRawReturns: null, simThrows: false, grantThrows: false, session: true,
    locksAbsent: false, noLockQuery: false, redeemNonceSkew: 0, waitDepositNull: false, appLockAtSign: false, ...opts };
  const calls = { grant: 0, sign: 0, prepared: 0, signTx: 0, sendRaw: 0, recover: 0, scenes: [], order: [], pendingAtScene: [], finished: [], reads: [], forbidden: [] };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const state = { address: ADDR, txHash: "", mark: "", grantTxHash: "", receipts: [], receiptIndex: 0, tripClosed: false, tripOutcome: "", tripReason: "", appLock: null, awayRestore: "checking", scene: "away", authPhase: "idle", authCancelled: false };
  const frozen = () => new Promise(() => {});
  const nonceBase = o.nonceBase ?? 0;
  const navigatorStub = o.locksAbsent ? {} : { locks: o.noLockQuery ? { request: locks.request.bind(locks) } : locks };
  const walletClient = {
    async prepareTransactionRequest({ to }) {
      calls.order.push("prepare");
      calls.prepared += 1;
      if (o.prepareThrows) throw new Error("prepare failed");
      const n = nonceBase + (calls.prepared === 1 ? 0 : 1 + o.redeemNonceSkew);
      // [A-768 M-C-1 harness wiring] a well-formed Monad-testnet eip1559 request — the pre-sign guard (preparedSignProblem) now checks it.
      return { type: "eip1559", chainId: 10143, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: n, to };
    },
  };
  const account = {
    address: ADDR,
    async signTransaction(prepared) {
      calls.order.push("sign");
      calls.signTx += 1;
      if (o.signThrows) throw new Error("sign failed");
      if (o.signHook) await o.signHook(calls.signTx);
      if (o.freeze === `after-sign-${calls.signTx === 1 ? "deposit" : "redeem"}`) { return frozen(); }
      return RAW(prepared.nonce);
    },
  };
  const env = {
    localStorage: storage, state,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : sel === "#awayRestoreLine" ? { set innerHTML(v) { calls.lineWrites = (calls.lineWrites || []).concat(v); } } : null) },
    navigator: navigatorStub, keccak256,
    isAllowedPiggyRpId: () => true,
    __startSigned: !!o.session, __account: account,
    __session: { signDigest: async () => { calls.sign += 1; calls.order.push("signDigest"); return { compact: new Uint8Array([1]), recovery: 0 }; } },
    __recover: async () => { calls.recover += 1; calls.order.push("recover"); calls.recoverStoredStage = storage.rec()?.stage; calls.recoverTabStage = tabRecs(storage)[0]?.stage; if (o.recoverHook) await o.recoverHook(); },
    setScene: (...a) => { calls.scenes.push(a); calls.pendingAtScene.push(storage.rec()); btn.disabled = true; btn.attrs["aria-disabled"] = "true"; },
    noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    webAuthnUnsupported: () => false, authAttempt: null, platformAuthInflight: null,
    beginAuthAttempt: (kind) => { calls.order.push("beginAuthAttempt"); calls.beginStage = storage.rec()?.stage; calls.beginTabStage = tabRecs(storage)[0]?.stage; return { kind, live: true }; },
    boundAuthAttempt: (a, work) => work, trackPlatformAuth: (p) => p, finishAuthAttempt: () => true,
    endActiveSession() {},
    requestGrant: async () => { calls.grant += 1; calls.order.push("grant"); calls.lockAtGrant = locks.held.has("araso.sendPending.v1"); if (o.grantThrows) throw new Error("relayer unreachable"); if (o.grantHook) await o.grantHook(state); return { txHash: "", granted: false }; },
    waitForGrantBalance: async () => true,
    simulateSend: async () => { calls.order.push("simulate"); if (o.simThrows) throw new Error("sim reverted"); return { depositTx: { to: SHMON_ADDRESS, value: 1n, data: "0x01" }, before: 1n, beforeShares: 0n }; },
    touchAppSession() {},
    createWalletClient: () => walletClient,
    MONAD_TESTNET: { id: 10143 }, MONAD_TESTNET_RPC: "", http: () => ({}),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) }, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) }, TextEncoder, toHex: () => "00",
    waitForSuccess: async (hash) => {
      calls.order.push("wait");
      if (o.waitHook) await o.waitHook(hash);
      if (o.freeze === "wait-deposit" && hash === HASH(nonceBase)) return frozen();
      if (o.freeze === "wait-redeem" && hash !== HASH(nonceBase)) return frozen();
      if (o.waitDepositNull && hash === HASH(nonceBase)) return null;
      return { status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n };
    },
    readShmonBalance: async () => 5n,
    makeRedeemTx: () => ({ to: SHMON_ADDRESS, data: "0x02" }),
    publicClient: {
      async estimateGas() { return 1n; },
      // [A-768 M-L-1 harness wiring] deposit-block nonce read = deposit nonce + 1 (the confirmed deposit is in that block).
      async getTransactionCount() { return nonceBase + 1; },
      async sendRawTransaction({ serializedTransaction }) {
        calls.order.push("sendRaw");
        calls.sendRaw += 1;
        chain.sent.push(serializedTransaction);
        const h = keccak256(serializedTransaction);
        calls.persistedAtSend = (calls.persistedAtSend || []).concat([storage.rec()]);
        calls.lockAtSend = (calls.lockAtSend || []).concat([locks.held.has("araso.sendPending.v1")]);
        if (o.freeze === `sendRaw-${calls.sendRaw === 1 ? "deposit" : "redeem"}`) return frozen();
        if (o.sendRawThrows && o.sendRawThrows(calls.sendRaw)) throw new Error("rpc dropped");
        if (chain.autoMine) chain.mine(h, "success", calls.sendRaw === 1 ? 100n : 101n);
        return o.sendRawReturns ? o.sendRawReturns(h) : h;
      },
      async getTransactionReceipt({ hash }) {
        calls.reads.push(["receipt", hash]);
        if (chain.readError) throw Object.assign(new Error("rpc down"), { name: "HttpRequestError" });
        const r = chain.receipts.get(hash);
        if (!r) throw new TransactionReceiptNotFoundError({ hash });
        return { transactionHash: hash, status: r.status, from: ADDR, to: SHMON_ADDRESS.toLowerCase(), blockNumber: r.block, gasUsed: 50000n, effectiveGasPrice: 100n };
      },
      async getTransaction({ hash }) { return { hash, value: 10n ** 15n }; },
      async getBalance({ blockNumber }) { return blockNumber === 99n ? 5n * 10n ** 17n : 499n * 10n ** 15n; },
      async readContract({ blockNumber }) { return blockNumber === 100n ? 990n * 10n ** 12n : 0n; },
      waitForTransactionReceipt: () => new Promise(() => {}),
    },
    settleSend: async ({ depositTxHash, redeemTxHash }) => (o.freeze === "settle" ? new Promise(() => {}) : {
      outcome: "done", reason: "ok",
      receipt: { before: 5n * 10n ** 17n, after: 499n * 10n ** 15n, gas: 10000000n, sent: 10n ** 15n, txHash: redeemTxHash, depositTxHash, redeemTxHash, grantTxHash: "", depositBlockNumber: 100n, redeemBlockNumber: 101n, depositGasUsed: 50000n, redeemGasUsed: 50000n, shmonReceived: 990n * 10n ** 12n, shmonAfterRedeem: 0n, status: "success", at: 1700000000000, piggyId: "p1" },
    }),
    formatError: (e) => String(e), recordSafeError: () => {},
    indexedPiggyId: () => "p1", SHMON_ADDRESS, SHMON_ABI: [], preparedSignProblem,
    decodeReceiptRow, encodeReceiptRow, codecReceiptIdentityKey, RECEIPT_KIND, LEGACY_TESTNET_PATH: true,
    homePadMarkup: () => "", chogHomeMarkup: () => "",
    setTimeout: () => 0,
    requestPrf: () => { calls.forbidden.push("requestPrf"); throw new Error("forbidden"); },
  };
  const names = Object.keys(env);
  const body = `let signerSince = __startSigned ? Date.now() : 0; /* [A-896 harness wiring] */ let activeAccount = __startSigned ? __account : null; let activeSession = __startSigned ? __session : null;\n` +
    `async function recoverPiggy() { await __recover(); signerSince = Date.now(); activeAccount = __account; activeSession = __session; }\n` +
    `${CONSTS.join("\n")}\n${RECEIPT_FNS_SRC}\n${PENDING_SRC}\n${FINISH_SRC}\n${RECONCILE_SRC}\n${ONCE_SRC}\n` +
    `return { sendPiggy, sendPiggyOnce, readSendPending, writeSendPending, sendBusy, holdSendTabLock, sweepStaleSendReservation, reserveSend, clearOwnSendPending, classifySendPending, reconcileSendPending, sendTabId, reservation: () => sendReservation, tabLockHeld: () => sendTabLockHeld, isInFlight: () => sendInFlight };`;
  const factory = new Function(...names, body);
  const api = factory(...names.map((n) => env[n]));
  if (o.holdLock !== false) api.holdSendTabLock();
  return { ...api, calls, btn, state, env, opts: o };
}
function shared(over = {}) { return { storage: makeStorage(), locks: makeLocks(), chain: makeChain(), ...over }; }
const lastScene = (t) => t.calls.scenes.at(-1);
const TAB_PREFIX = "araso.sendTab.";
const RESERVE_PREFIX = "araso.sendPending.reserve.";
const LOCK = "araso.sendPending.v1";

// ═══ R. reservation lifecycle ════════════════════════════════════════════════════════════════════
// [A-707 r2 re-baseline, named reason: tab-scoped reservation] the synchronous pre-passkey reservation now lands in THIS tab's key only;
// the shared araso.sendPending must still be EMPTY at that point (it is written only under the exclusive lock). Same timing guarantees as r1.
await check("R1 the reservation is written SYNCHRONOUSLY on the tap (tab-scoped key), before the recovery passkey and before beginAuthAttempt('send'); the shared slot is not written before the lock", async () => {
  const sh = shared();
  const t = makeTab(sh, { session: false });
  const p = t.sendPiggy(); // no await yet: everything up to the first real async boundary has already run
  assert.equal(t.calls.recover, 1, "recoverPiggy reached synchronously from the tap (the user-gesture -> WebAuthn chain is not broken)");
  assert.equal(t.calls.recoverTabStage, "reserved", "the tab-scoped reserved record was in storage when the passkey was requested");
  assert.equal(t.calls.beginTabStage, "reserved", "and when the attempt slot was taken");
  assert.equal(t.calls.recoverStoredStage, undefined, "the shared araso.sendPending is NOT written outside the exclusive lock");
  assert.equal(t.calls.beginStage, undefined);
  assert.ok(t.calls.order.indexOf("beginAuthAttempt") < t.calls.order.indexOf("recover"));
  assert.equal(t.calls.grant, 0);
  await p; await settle();
  assert.equal(t.calls.sendRaw, 2, "the run completed once after the recovery");
  assert.equal(sh.storage.has("araso.sendPending"), false, "cleared after the verified receipt");
  assert.deepEqual(tabRecs(sh.storage), [], "tab-scoped reservation removed");
});
await check("R1b live session (no recovery): reserved is written synchronously too, before the grant", async () => {
  const sh = shared();
  const t = makeTab(sh);
  const p = t.sendPiggy();
  assert.equal(sh.storage.rec()?.stage, "reserved");
  assert.equal(t.calls.grant, 0);
  await p; await settle();
});
await check("R2 the reserved record carries reservationId + tabId only (no address, no hash, no secret), lives in this tab's key, and the tab lifetime lock is held", async () => {
  const sh = shared();
  const t = makeTab(sh);
  const r = t.reserveSend();
  assert.equal(r.ok, true);
  assert.equal(sh.storage.has("araso.sendPending"), false, "[A-707 r2] reserveSend never writes the shared record");
  const rec = JSON.parse(sh.storage.raw(RESERVE_PREFIX + t.sendTabId()));
  assert.deepEqual(Object.keys(rec).sort(), ["at", "reservationId", "stage", "tabId"]);
  assert.equal(rec.tabId, t.sendTabId());
  assert.equal(rec.stage, "reserved");
  assert.ok(sh.locks.held.has(TAB_PREFIX + t.sendTabId()));
  assert.deepEqual([t.reserveSend().ok, t.reserveSend().reason], [false, "busy"], "a second reservation in the same tab before promotion is refused (own key not overwritten)");
});
await check("R3 busy: any existing record (any stage / unknown / unreadable store) refuses the reservation without a write", async () => {
  for (const seed of [{ stage: "reserved", reservationId: "x.y", tabId: "other" }, { stage: "deposit-broadcast", address: ADDR, depositTxHash: HASH(0) }, { stage: "redeem-sending", address: ADDR }, "{not json"]) {
    const sh = shared();
    sh.storage.put("araso.sendPending", typeof seed === "string" ? seed : JSON.stringify(seed));
    const before = sh.storage.raw("araso.sendPending");
    const t = makeTab(sh);
    const r = t.reserveSend();
    assert.deepEqual([r.ok, r.reason], [false, "busy"]);
    assert.equal(sh.storage.raw("araso.sendPending"), before, "existing record untouched");
  }
  const sh = shared();
  sh.storage.fx.throwGet.add("araso.sendPending");
  const t = makeTab(sh);
  assert.deepEqual([t.reserveSend().ok, t.reserveSend().reason], [false, "busy"], "unreadable store = busy, never 'none'");
});
// [A-707 r2 re-baseline, named reason: tab-scoped reservation] the pre-passkey write now targets araso.sendPending.reserve.<tabId>, so the
// injected failures target that key (same three failure modes, same assertions). The shared-slot write failures moved to R4b (after the passkey).
await check("R4 reservation write failures (throws / silently dropped / read-back mismatch) stop before any passkey, grant, sign or broadcast; nothing is left behind", async () => {
  const isRes = (k) => k.startsWith(RESERVE_PREFIX);
  for (const mode of ["throw", "drop", "readback-throws"]) {
    const sh = shared();
    if (mode === "throw") sh.storage.fx.throwSet = (k) => isRes(k);
    const t = makeTab(sh, { session: false });
    if (mode === "drop") { const set = sh.storage.setItem.bind(sh.storage); sh.storage.setItem = (k, v) => { if (isRes(k)) return; set(k, v); }; }
    if (mode === "readback-throws") {
      const get = sh.storage.getItem.bind(sh.storage);
      let after = false;
      const set = sh.storage.setItem.bind(sh.storage);
      sh.storage.setItem = (k, v) => { set(k, v); if (isRes(k)) after = true; };
      sh.storage.getItem = (k) => { if (after && isRes(k)) { after = false; throw new Error("readback"); } return get(k); };
    }
    await t.sendPiggy(); await settle();
    assert.equal(`${t.calls.recover}/${t.calls.grant}/${t.calls.sign}/${t.calls.sendRaw}`, "0/0/0/0", mode);
    assert.equal(sh.storage.has("araso.sendPending"), false, `${mode}: no record left behind`);
    assert.deepEqual(tabRecs(sh.storage), [], `${mode}: no tab-scoped record left behind`);
    assert.equal(t.isInFlight(), false, mode);
    assert.equal(lastScene(t)[1], "Piggy can't go out yet.", mode);
  }
});
await check("R4b [A-707 r2] promotion into the shared slot fails under the lock (throws / dropped / read-back differs): stop before grant/sign/broadcast, own bytes rolled back, lock released, Send usable", async () => {
  for (const mode of ["throw", "drop", "readback-differs"]) {
    const sh = shared();
    const set = sh.storage.setItem.bind(sh.storage);
    const get = sh.storage.getItem.bind(sh.storage);
    if (mode === "throw") sh.storage.fx.throwSet = (k) => k === "araso.sendPending";
    if (mode === "drop") sh.storage.setItem = (k, v) => { if (k === "araso.sendPending") return; set(k, v); };
    if (mode === "readback-differs") { let n = 0; sh.storage.setItem = (k, v) => { set(k, v); if (k === "araso.sendPending") n = 1; }; sh.storage.getItem = (k) => { if (k === "araso.sendPending" && n === 1) { n = 2; return "{}"; } return get(k); }; }
    const t = makeTab(sh, { session: false });
    await t.sendPiggy(); await settle();
    assert.equal(t.calls.recover, 1, mode);
    assert.equal(`${t.calls.grant}/${t.calls.prepared}/${t.calls.signTx}/${t.calls.sendRaw}`, "0/0/0/0", mode);
    assert.equal(sh.storage.has("araso.sendPending"), false, `${mode}: own bytes rolled back`);
    assert.deepEqual(tabRecs(sh.storage), [], mode);
    assert.equal(sh.locks.held.has(LOCK), false, `${mode}: lock released`);
    assert.deepEqual(lastScene(t), ["sendstay", "Piggy can't go out yet.", ""], mode);
    assert.equal(t.sendBusy(), false, mode);
  }
});
await check("R5 every pre-sign exit releases the reservation BEFORE the failure card (so the card reads 'nothing moved'), and Send is usable again", async () => {
  const cases = [
    ["grant fails", { grantThrows: true }],
    ["simulate fails", { simThrows: true }],
    ["prepare fails", { prepareThrows: true }],
    ["sign fails", { signThrows: true }],
  ];
  for (const [label, o] of cases) {
    const sh = shared();
    const t = makeTab(sh, o);
    await t.sendPiggy(); await settle();
    assert.equal(sh.storage.has("araso.sendPending"), false, `${label}: released`);
    assert.equal(t.calls.pendingAtScene.at(-1), null, `${label}: no record when the failure card was drawn`);
    assert.equal(t.calls.sendRaw, 0, `${label}: 0 broadcast`);
    assert.equal(t.isInFlight(), false);
    assert.equal(t.sendBusy(), false, `${label}: Send usable`);
  }
  // app locked after the A-698 guard but before the signing boundary (the A-698 residual): stop before preparing/signing anything
  const sh3 = shared();
  const t3 = makeTab(sh3, { grantHook: async (st) => { st.appLock = { phase: "waiting" }; } });
  await t3.sendPiggy(); await settle();
  assert.equal(t3.calls.signTx + t3.calls.prepared + t3.calls.sendRaw + t3.calls.sign, 0, "locked before the money boundary: nothing prepared, signed or sent");
  assert.equal(sh3.storage.has("araso.sendPending"), false);
  assert.equal(t3.calls.pendingAtScene.at(-1), null);
});
await check("R6 a second tap in the same tab while the first runs starts nothing (existing busy copy), and the first still completes once", async () => {
  const sh = shared();
  let releaseGrant;
  const gate = new Promise((r) => { releaseGrant = r; });
  const t = makeTab(sh, { grantHook: async () => { await gate; } });
  const p1 = t.sendPiggy();
  await tick();
  await t.sendPiggy();
  assert.equal(t.calls.grant, 1);
  assert.equal(sh.storage.rec().stage, "reserved", "still exactly the first run's reservation");
  assert.equal(t.calls.scenes.filter((x) => x[1] === "Piggy is home.").length, 0, "the in-tab guard returns silently (sendInFlight), as before");
  releaseGrant(); await p1; await settle();
  assert.equal(t.calls.sendRaw, 2);
});

// ═══ L. locks present / absent ══════════════════════════════════════════════════════════════════
await check("L1 locks API absent: fail closed BEFORE reserve/passkey/grant/sign/broadcast, existing copy, nothing written", async () => {
  const sh = shared();
  const t = makeTab(sh, { locksAbsent: true, session: false });
  await t.sendPiggy(); await settle();
  assert.equal(`${t.calls.recover}/${t.calls.grant}/${t.calls.prepared}/${t.calls.signTx}/${t.calls.sendRaw}`, "0/0/0/0/0");
  assert.equal(sh.storage.log.some((x) => x[0] === "set" || x[0] === "remove"), false, "storage never written");
  assert.deepEqual(lastScene(t), ["sendstay", "Piggy can't go out yet.", ""]);
  assert.equal(t.isInFlight(), false);
});
await check("L2 locks.query missing (ambiguous capability) -> fail closed", async () => {
  const sh = shared();
  const t = makeTab(sh, { noLockQuery: true });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw + t.calls.signTx + t.calls.grant, 0);
  assert.equal(sh.storage.has("araso.sendPending"), false);
});
await check("L3 the tab lifetime lock was never granted (boot step missing / request threw) -> fail closed", async () => {
  const sh = shared({ locks: makeLocks({ requestThrows: true }) });
  const t = makeTab(sh);
  await settle();
  assert.equal(t.tabLockHeld(), false);
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw + t.calls.signTx + t.calls.grant, 0);
  const sh2 = shared();
  const t2 = makeTab(sh2, { holdLock: false });
  await t2.sendPiggy(); await settle();
  assert.equal(t2.calls.sendRaw + t2.calls.signTx + t2.calls.grant, 0, "no boot lock step -> no Send");
});
await check("L4 the confirm step: another tab holds the arbitration lock (ifAvailable cannot take it) -> release, nothing signed", async () => {
  const sh = shared();
  const t = makeTab(sh);
  sh.locks.held.set("araso.sendPending.v1", true); // another tab is arbitrating
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.grant + t.calls.prepared + t.calls.sendRaw, 0);
  assert.equal(sh.storage.has("araso.sendPending"), false, "own reservation released");
  assert.deepEqual(lastScene(t), ["sendstay", "Piggy can't go out yet.", ""]);
});
await check("L5 the confirm step: locks.request throws -> release, nothing signed", async () => {
  const sh = shared();
  const t = makeTab(sh);
  sh.locks.requestThrows = true; // after the boot lock was taken
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.grant + t.calls.prepared + t.calls.sendRaw, 0);
  assert.equal(sh.storage.has("araso.sendPending"), false);
});

// ═══ T. two tabs ═════════════════════════════════════════════════════════════════════════════════
await check("T1 two tabs tap in the same tick: exactly one reserves; the other is refused with the existing busy copy; broadcasts = 2 (one run), never 4", async () => {
  const sh = shared();
  const a = makeTab(sh);
  const b = makeTab(sh);
  const pa = a.sendPiggy();
  const pb = b.sendPiggy();
  await pa; await pb; await settle();
  const ran = [a, b].filter((t) => t.calls.grant > 0);
  assert.equal(ran.length, 1, "exactly one tab went past the reservation");
  const loser = ran[0] === a ? b : a;
  assert.equal(loser.calls.sendRaw + loser.calls.signTx + loser.calls.grant, 0);
  assert.deepEqual(lastScene(loser), ["sendstay", "Piggy is home.", "Confirmation is still catching up."]);
  assert.equal(a.calls.sendRaw + b.calls.sendRaw, 2);
  assert.equal(sh.chain.sent.length, 2);
});
// [A-707 r2 re-baseline, named reason: tab-scoped reservation] A's reservation is tab-scoped, so B's record in the shared slot is no longer
// "A's record overwritten" but "another tab holds the slot": the confirm (under the lock) refuses to promote over it, and the scene is the
// existing busy copy (the same rule reserveSend uses for any existing shared record). Every money assertion is unchanged.
await check("T2 lost-race arbitration: tab B's reservation occupies the shared slot while A's passkey is open; A's confirm refuses to promote, A signs nothing, B's record untouched", async () => {
  const sh = shared();
  const a = makeTab(sh, { session: false, recoverHook: async () => {
    const bRes = { stage: "reserved", reservationId: "B.race", tabId: "tabB", at: Date.now() };
    sh.storage.put("araso.sendPending", JSON.stringify(bRes));
  } });
  await a.sendPiggy(); await settle();
  assert.equal(a.calls.grant + a.calls.prepared + a.calls.signTx + a.calls.sendRaw, 0, "A did not pass the confirm");
  assert.equal(sh.storage.rec()?.reservationId, "B.race", "A never clears a record that is not its own");
  assert.deepEqual(tabRecs(sh.storage), [], "A's own tab-scoped reservation released");
  assert.deepEqual(lastScene(a), ["sendstay", "Piggy is home.", "Confirmation is still catching up."]);
});
await check("T3 persisted record blocks the second tab across the long awaits even with the locks API gone (D3): signed record from tab A, tab B taps", async () => {
  const sh = shared();
  const a = makeTab(sh, { freeze: "sendRaw-deposit" });
  a.sendPiggy(); await settle();
  assert.equal(sh.storage.rec().phase, "signed");
  const b = makeTab(sh, { locksAbsent: true });
  await b.sendPiggy(); await settle();
  assert.equal(b.calls.grant + b.calls.signTx + b.calls.sendRaw, 0);
  const b2 = makeTab(sh);
  await b2.sendPiggy(); await settle();
  assert.equal(b2.calls.grant + b2.calls.signTx + b2.calls.sendRaw, 0);
  assert.equal(sh.chain.sent.length, 1, "exactly one raw transaction ever reached the node");
});
await check("T4 tab B can never overwrite tab A's signed record (writeOwned refuses a record that is not its reservation)", async () => {
  const sh = shared();
  const a = makeTab(sh, { freeze: "sendRaw-deposit" });
  a.sendPiggy(); await settle();
  const before = sh.storage.raw("araso.sendPending");
  const b = makeTab(sh);
  assert.equal(b.reserveSend().ok, false);
  assert.equal(sh.storage.raw("araso.sendPending"), before);
});

// ═══ X. [A-707 r2] cross-tab confirm race (r1 security review MEDIUM): tab-scoped reservation + lock held through both broadcasts ═══
// Each X test FAILS on the r1 tree (shared slot written outside the lock / lock released right after the confirm) — see MUTATION.md.
function staleFirstRead(storage) {
  // a tab whose tap-time reads of the shared slot (sendPiggy's guard + reserveSend's check) observed "none" just BEFORE another tab's write
  // landed (the read-none/write-later interleave); every later read sees the real storage.
  const view = Object.create(storage);
  let stale = 2;
  view.getItem = (k) => { if (stale > 0 && k === "araso.sendPending") { stale -= 1; storage.log.push(["get-stale", k]); return null; } return storage.getItem(k); };
  return view;
}
await check("X1 stale-read interleave: tab A is between its signed persist and its broadcast; tab B read 'none' before A's write and taps now -> B writes nothing shared, cannot take the lock, signs nothing; A's signed record (hash, nonce) intact; exactly one raw tx ever", async () => {
  const sh = shared();
  const a = makeTab(sh, { freeze: "sendRaw-deposit" });
  a.sendPiggy(); await settle();
  const before = sh.storage.raw("araso.sendPending");
  assert.equal(JSON.parse(before).phase, "signed");
  const b = makeTab({ ...sh, storage: staleFirstRead(sh.storage) });
  await b.sendPiggy(); await settle();
  assert.equal(b.calls.grant + b.calls.prepared + b.calls.signTx + b.calls.sendRaw, 0, "B passed nothing past the lock");
  assert.equal(sh.storage.raw("araso.sendPending"), before, "A's signed record was never overwritten");
  assert.equal(sh.chain.sent.length, 1, "one raw transaction (A's deposit), never a second run");
  assert.deepEqual(lastScene(b), ["sendstay", "Piggy is home.", "Confirmation is still catching up."], "existing busy copy");
  assert.deepEqual(tabRecs(sh.storage), [], "B's tab-scoped key released; A's was removed at its promotion");
});
await check("X2 the exclusive lock is HELD from the confirm through grant, both persists and both broadcasts, and released only when sendPiggy returns (success and every failure exit)", async () => {
  const sh = shared();
  const t = makeTab(sh);
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.lockAtGrant, true, "held during grant");
  assert.deepEqual(t.calls.lockAtSend, [true, true], "held at the deposit and at the redeem broadcast");
  assert.equal(sh.locks.held.has(LOCK), false, "released after sendPiggy returned");
  for (const [label, o] of [["grant fails", { grantThrows: true }], ["sign fails", { signThrows: true }], ["broadcast throws", { sendRawThrows: () => true }], ["redeem broadcast throws", { sendRawThrows: (n) => n === 2 }]]) {
    const sh2 = shared();
    const t2 = makeTab(sh2, o);
    await t2.sendPiggy(); await settle();
    assert.equal(sh2.locks.held.has(LOCK), false, `${label}: released`);
    if (t2.calls.lockAtSend) assert.ok(t2.calls.lockAtSend.every(Boolean), `${label}: held at every broadcast`);
    assert.equal(t2.isInFlight(), false, label);
  }
});
await check("X3 lock lost (stolen / AbortError) mid-run: before signing -> nothing prepared/signed/sent; during the deposit signature -> the signed record is refused (writeOwned re-assert), 0 broadcast; before the redeem -> no redeem persisted or broadcast; the shared record is never touched once the lock is gone", async () => {
  // (a) lost during grant
  let sh = shared();
  let t = makeTab(sh, { grantHook: async () => { sh.locks.steal(LOCK); await tick(); } });
  await t.sendPiggy(); await settle();
  assert.equal(`${t.calls.sign}/${t.calls.prepared}/${t.calls.signTx}/${t.calls.sendRaw}`, "0/0/0/0", "(a) nothing signed or sent");
  assert.equal(sh.storage.rec()?.stage, "reserved", "(a) the shared record is not removed without the lock (fail-closed, swept once this tab is gone)");
  // (b) lost while the deposit is being signed
  sh = shared();
  t = makeTab(sh, { signHook: async (n) => { if (n === 1) { sh.locks.steal(LOCK); await tick(); } } });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.signTx, 1);
  assert.equal(t.calls.sendRaw, 0, "(b) 0 broadcast");
  assert.equal(sh.storage.rec()?.stage, "reserved", "(b) the signed record was refused (re-assert in writeOwnedSendPending)");
  assert.equal(sh.storage.log.filter((x) => x[1] === "araso.sendPending" && (x[0] === "set" || x[0] === "remove")).length, 1, "(b) only the promotion ever wrote the shared slot");
  // (c) lost while the deposit receipt is awaited -> no redeem
  sh = shared();
  t = makeTab(sh, { waitHook: async () => { sh.locks.steal(LOCK); await tick(); } });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 1, "(c) the redeem is never broadcast");
  assert.deepEqual([sh.storage.rec().stage, sh.storage.rec().depositTxHash, sh.storage.rec().redeemTxHash], ["deposit-broadcast", HASH(0), undefined], "(c) the deposit record stays (locked, fail-closed)");
  assert.equal(t.sendBusy(), true);
});
await check("X4 source + behaviour: every write/remove of the shared araso.sendPending during a run happens while the exclusive lock is held (reserve, confirm, persist, phase, failure clears)", async () => {
  const runs = [["happy (frozen at settle)", { freeze: "settle" }], ["grant fails", { grantThrows: true }], ["simulate fails", { simThrows: true }], ["sign fails", { signThrows: true }], ["deposit broadcast throws", { sendRawThrows: () => true }], ["redeem nonce skew", { redeemNonceSkew: 1 }], ["recovery path", { session: false }]];
  for (const [label, o] of runs) {
    const sh = shared();
    const ops = [];
    const set = sh.storage.setItem.bind(sh.storage);
    const rm = sh.storage.removeItem.bind(sh.storage);
    sh.storage.setItem = (k, v) => { if (k === "araso.sendPending") ops.push(["set", sh.locks.held.has(LOCK)]); set(k, v); };
    sh.storage.removeItem = (k) => { if (k === "araso.sendPending") ops.push(["remove", sh.locks.held.has(LOCK)]); rm(k); };
    const t = makeTab(sh, o);
    const p = t.sendPiggy();
    await (o.freeze === "settle" ? settle() : p); await settle();
    assert.ok(ops.length > 0, `${label}: the shared slot was used`);
    assert.deepEqual(ops.filter(([, held]) => !held), [], `${label}: shared-slot op outside the exclusive lock`);
  }
  assert.equal(/localStorage\.(setItem|removeItem)\(SEND_PENDING_KEY/.test(strip(fnBody("reserveSend"))), false, "reserveSend never touches the shared key");
});

// ═══ S. stale reservation sweep (owner proven dead by lock facts only) ═══════════════════════════
// [A-707 r2 re-baseline, named reason: tab-scoped reservation] a tab that dies BEFORE its confirm leaves only its own tab-scoped key (the shared
// slot was never written) -> nothing to sweep, the next tab sends directly (S1a). A tab that dies AFTER its confirm (shared `reserved` promoted,
// nothing signed) is the case the sweep exists for (S1b) — same assertions as r1's S1.
await check("S1a owner tab died during its passkey (before confirm): the shared slot was never written; the next tab sends without any sweep; nothing was signed", async () => {
  const sh = shared();
  const a = makeTab(sh, { session: false, recoverHook: () => new Promise(() => {}) });
  a.sendPiggy(); await settle();
  assert.equal(sh.storage.has("araso.sendPending"), false);
  assert.equal(tabRecs(sh.storage)[0]?.stage, "reserved");
  sh.locks.killPrefix(TAB_PREFIX + a.sendTabId()); // tab A dies
  const b = makeTab(sh);
  await tick();
  assert.equal(await b.sweepStaleSendReservation(), "none");
  await b.sendPiggy(); await settle();
  assert.equal(b.calls.sendRaw, 2);
  assert.equal(a.calls.signTx + a.calls.sendRaw, 0);
});
await check("S1b owner tab died after its confirm (shared `reserved`, before any signature): the next tab's sweep clears it under the arbitration lock, then Send works; nothing was signed", async () => {
  const sh = shared();
  const a = makeTab(sh, { grantHook: () => new Promise(() => {}) });
  a.sendPiggy(); await settle();
  assert.equal(sh.storage.rec().stage, "reserved");
  sh.locks.killPrefix(TAB_PREFIX + a.sendTabId()); // tab A dies: the browser releases both of its locks
  sh.locks.held.delete(LOCK);
  const b = makeTab(sh);
  await tick();
  assert.equal(await b.sweepStaleSendReservation(), "cleared");
  assert.equal(sh.storage.has("araso.sendPending"), false);
  assert.equal(a.calls.signTx + a.calls.sendRaw, 0);
  await b.sendPiggy(); await settle();
  assert.equal(b.calls.sendRaw, 2);
});
await check("S2 owner alive -> NOT cleared (lifetime lock listed)", async () => {
  const sh = shared();
  const a = makeTab(sh, { grantHook: () => new Promise(() => {}) }); // [A-707 r2] past its confirm: shared `reserved`, lock held
  a.sendPiggy(); await settle();
  assert.equal(sh.storage.rec().stage, "reserved");
  const b = makeTab(sh);
  await tick();
  assert.equal(await b.sweepStaleSendReservation(), "alive");
  assert.equal(sh.storage.rec().stage, "reserved");
});
await check("S3 uncertainty keeps the lock: query throws / own lifetime lock not listed / locks absent / malformed record / arbitration lock busy / record changed under the lock", async () => {
  const mk = () => { const sh = shared(); sh.storage.put("araso.sendPending", JSON.stringify({ stage: "reserved", reservationId: "dead.1", tabId: "dead", at: 1 })); return sh; };
  let sh = mk(); let b = makeTab(sh); await tick(); sh.locks.queryThrows = true;
  assert.equal(await b.sweepStaleSendReservation(), "unknown"); assert.ok(sh.storage.has("araso.sendPending"));
  sh = mk(); b = makeTab(sh); await tick(); sh.locks.killPrefix(TAB_PREFIX);
  assert.equal(await b.sweepStaleSendReservation(), "unknown", "cannot trust a snapshot that does not even list our own lifetime lock"); assert.ok(sh.storage.has("araso.sendPending"));
  sh = mk(); b = makeTab(sh, { locksAbsent: true });
  assert.equal(await b.sweepStaleSendReservation(), "unsupported"); assert.ok(sh.storage.has("araso.sendPending"));
  sh = shared(); sh.storage.put("araso.sendPending", JSON.stringify({ stage: "reserved", tabId: "", at: 1 })); b = makeTab(sh); await tick();
  assert.equal(await b.sweepStaleSendReservation(), "unknown"); assert.ok(sh.storage.has("araso.sendPending"));
  sh = mk(); b = makeTab(sh); await tick(); sh.locks.held.set("araso.sendPending.v1", true);
  assert.equal(await b.sweepStaleSendReservation(), "unknown"); assert.ok(sh.storage.has("araso.sendPending"));
  sh = mk(); b = makeTab(sh); await tick();
  const q = sh.locks.query.bind(sh.locks);
  sh.locks.query = async () => { const r = await q(); sh.storage.put("araso.sendPending", JSON.stringify({ stage: "reserved", reservationId: "new.2", tabId: "dead2", at: 2 })); return r; };
  assert.equal(await b.sweepStaleSendReservation(), "unknown", "the record changed between query and clear -> compare-and-clear refuses");
  assert.equal(sh.storage.rec().reservationId, "new.2");
});
await check("S3b real-browser timing: the lifetime-lock callback is ASYNC; the boot step (hold, then sweep immediately) still reaches 'cleared' because the sweep waits for the grant", async () => {
  const sh = shared({ locks: makeLocks({ asyncGrant: true }) });
  sh.storage.put("araso.sendPending", JSON.stringify({ stage: "reserved", reservationId: "dead.1", tabId: "dead", at: 1 }));
  const b = makeTab(sh); // holdSendTabLock() already called; the grant has NOT happened yet
  assert.equal(b.tabLockHeld(), false);
  assert.equal(await b.sweepStaleSendReservation(), "cleared");
  assert.equal(sh.storage.has("araso.sendPending"), false);
});
await check("S4 the sweep never touches a signed/broadcast record, whatever the lock facts say", async () => {
  for (const stage of ["deposit-broadcast", "redeem-broadcast", "deposit-sending", "redeem-sending"]) {
    const sh = shared();
    const rec = { stage, phase: "signed", address: ADDR, depositTxHash: HASH(0), redeemTxHash: HASH(1), tabId: "dead", reservationId: "dead.1" };
    sh.storage.put("araso.sendPending", JSON.stringify(rec));
    const b = makeTab(sh); await tick();
    assert.equal(await b.sweepStaleSendReservation(), "none");
    assert.deepEqual(sh.storage.rec(), rec);
  }
});
await check("S5 boot wiring: the sweep + lifetime-lock step is behind LEGACY_TESTNET_PATH, runs outside the pinned A-633 reconcile/boot blocks, and the post-clear card is an existing string", async () => {
  const boot = cut("if (LEGACY_TESTNET_PATH) {\n  holdSendTabLock();", "// [A-666] Owner-identified top-left HISTORY dot");
  assert.ok(boot.includes("sweepStaleSendReservation()"));
  assert.ok(/setScene\("sendstay", "Piggy can't go out yet\.", ""\)/.test(boot));
  assert.ok(MAIN.indexOf("holdSendTabLock();\n  sweepStaleSendReservation()") > MAIN.indexOf("\n\nrender();"), "after the first render(), outside every boot cut other suites pin");
});

// ═══ B. sign-before-send order, durability, never double-broadcast ═══════════════════════════════
await check("B1 call order: reserve -> (passkey) -> prepare -> sign -> PERSIST(hash,nonce) -> broadcast -> ... -> prepare -> sign -> PERSIST -> broadcast; the record with the hash is in storage when each broadcast is called", async () => {
  const sh = shared();
  const t = makeTab(sh);
  await t.sendPiggy(); await settle();
  assert.deepEqual(t.calls.order.filter((x) => ["prepare", "sign", "sendRaw", "signDigest"].includes(x)), ["signDigest", "prepare", "sign", "sendRaw", "prepare", "sign", "sendRaw"]);
  const [atDeposit, atRedeem] = t.calls.persistedAtSend;
  assert.deepEqual([atDeposit.stage, atDeposit.phase, atDeposit.depositTxHash, atDeposit.nonce], ["deposit-broadcast", "signed", HASH(0), 0]);
  assert.deepEqual([atRedeem.stage, atRedeem.phase, atRedeem.depositTxHash, atRedeem.redeemTxHash, atRedeem.nonce], ["redeem-broadcast", "signed", HASH(0), HASH(1), 1]);
  // the persisted hash IS keccak256 of the raw that was broadcast (the node would return exactly this)
  assert.deepEqual(sh.chain.sent.map((r) => keccak256(r)), [HASH(0), HASH(1)]);
  const setsOfRecord = sh.storage.log.filter((x) => x[0] === "set" && x[1] === "araso.sendPending").map((x) => JSON.parse(x[2]));
  const iSigned = setsOfRecord.findIndex((r) => r.phase === "signed" && r.stage === "deposit-broadcast");
  assert.ok(iSigned > 0 && setsOfRecord[0].stage === "reserved", "reserved is the first record, the signed record the second");
});
await check("B2 happy path end to end: reserved -> signed -> sent -> signed -> sent -> receipt saved -> pending cleared -> Send idle; nonces 0,1 recorded; one run = 2 broadcasts", async () => {
  const sh = shared();
  const t = makeTab(sh);
  await t.sendPiggy(); await settle();
  const phases = sh.storage.log.filter((x) => x[0] === "set" && x[1] === "araso.sendPending").map((x) => { const r = JSON.parse(x[2]); return `${r.stage}/${r.phase || "-"}/${r.nonce ?? "-"}`; });
  assert.deepEqual(phases, ["reserved/-/-", "deposit-broadcast/signed/0", "deposit-broadcast/sent/0", "redeem-broadcast/signed/1", "redeem-broadcast/sent/1"]);
  assert.equal(sh.storage.has("araso.sendPending"), false, "cleared only after the verified receipt (finishTrip compare-and-clear)");
  assert.equal(JSON.parse(sh.storage.raw("araso.receipts")).length, 1);
  assert.equal(t.calls.sendRaw, 2);
  assert.equal(t.sendBusy(), false);
});
await check("B3 persist-before-broadcast failures: signed write throws / silently dropped / read-back fails -> broadcast NEVER called, reservation (or the just-written unsent signed record) released, Send usable", async () => {
  for (const mode of ["throw", "drop-signed", "landed-then-readback-fails"]) {
    const sh = shared();
    const set = sh.storage.setItem.bind(sh.storage);
    if (mode === "throw") sh.storage.fx.throwSet = (k, v) => k === "araso.sendPending" && JSON.parse(v).phase === "signed";
    if (mode === "drop-signed") sh.storage.setItem = (k, v) => { if (k === "araso.sendPending" && JSON.parse(v).phase === "signed") return; set(k, v); };
    if (mode === "landed-then-readback-fails") {
      const get = sh.storage.getItem.bind(sh.storage);
      let armed = false;
      sh.storage.setItem = (k, v) => { set(k, v); if (k === "araso.sendPending" && JSON.parse(v).phase === "signed") armed = true; };
      sh.storage.getItem = (k) => { if (armed && k === "araso.sendPending" && JSON.parse(sh.storage.raw(k) || "{}").phase === "signed") throw new Error("readback"); return get(k); };
    }
    const t = makeTab(sh);
    await t.sendPiggy(); await settle();
    assert.equal(t.calls.sendRaw, 0, `${mode}: sendRawTransaction never called`);
    if (mode === "landed-then-readback-fails") {
      // the unsent signed record is discarded only when it can be read back to prove it is ours; the read keeps failing -> it stays (locked, fail-closed)
      assert.ok(sh.storage.has("araso.sendPending"), "unreadable -> cannot prove ours -> stays locked (fail-closed)");
    } else {
      assert.equal(sh.storage.has("araso.sendPending"), false, `${mode}: released`);
      assert.equal(t.sendBusy(), false);
    }
    assert.equal(t.isInFlight(), false);
  }
});
await check("B3b signed write lands but its read-back verification fails once: the unsent signed record is discarded (broadcast provably never called)", async () => {
  const sh = shared();
  const set = sh.storage.setItem.bind(sh.storage);
  const get = sh.storage.getItem.bind(sh.storage);
  let corrupt = false;
  sh.storage.setItem = (k, v) => { set(k, v); if (k === "araso.sendPending" && JSON.parse(v).phase === "signed") corrupt = true; };
  // verification reads see a different value twice (both write attempts), then reads are normal again
  let bad = 0;
  sh.storage.getItem = (k) => { if (corrupt && k === "araso.sendPending" && bad < 2) { bad += 1; return "{}"; } return get(k); };
  const t = makeTab(sh);
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 0);
  assert.equal(sh.storage.has("araso.sendPending"), false, "unsent signed record discarded: absence of broadcast proven in-process");
  assert.equal(t.sendBusy(), false);
});
await check("B3c the discard itself cannot be done (removeItem throws): the record stays -> locked, never unlocked on a guess", async () => {
  const sh = shared();
  sh.storage.fx.throwSet = (k, v) => k === "araso.sendPending" && JSON.parse(v).phase === "signed";
  sh.storage.fx.throwRemove.add("araso.sendPending");
  const t = makeTab(sh);
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 0);
  assert.equal(sh.storage.rec().stage, "reserved", "reservation could not be removed -> stays (the sweep proves it later)");
  assert.equal(t.sendBusy(), true);
});
await check("B4 the broadcast call throws (outcome unknown): the signed record STAYS, no second broadcast, no redeem, Send locked, card reads from the stored record", async () => {
  const sh = shared();
  const t = makeTab(sh, { sendRawThrows: () => true });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 1);
  assert.deepEqual([sh.storage.rec().stage, sh.storage.rec().phase, sh.storage.rec().depositTxHash], ["deposit-broadcast", "signed", HASH(0)]);
  assert.equal(t.calls.pendingAtScene.at(-1).stage, "deposit-broadcast", "the failure card is drawn while the record exists (can't tell yet.)");
  assert.equal(t.sendBusy(), true);
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 1, "re-tap: no rebroadcast, no new run");
});
await check("B5 the node returns a different hash than keccak256(raw) -> stop: no redeem, record stays signed", async () => {
  const sh = shared();
  const t = makeTab(sh, { sendRawReturns: () => "0x" + "bb".repeat(32) });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 1);
  assert.equal(t.calls.prepared, 1, "no redeem prepared");
  assert.equal(sh.storage.rec().depositTxHash, HASH(0));
});
await check("B6 redeem leg: nonce must be deposit+1 (else no redeem is signed, deposit record stays); redeem sign failure -> deposit record stays; redeem broadcast failure -> signed redeem record stays", async () => {
  let sh = shared(); let t = makeTab(sh, { redeemNonceSkew: 1 });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 1, "the unexpected-nonce redeem is never broadcast");
  assert.equal(t.calls.signTx, 2, "it was signed in memory only and dropped");
  assert.deepEqual([sh.storage.rec().stage, sh.storage.rec().phase], ["deposit-broadcast", "sent"], "never persisted: the deposit record stays");
  sh = shared(); t = makeTab(sh);
  t.env.makeRedeemTx = () => ({ to: SHMON_ADDRESS, data: "0x02" });
  const signOrig = t.env.__account.signTransaction;
  t.env.__account.signTransaction = async (p) => { if (t.calls.signTx >= 1) { t.calls.signTx += 1; throw new Error("redeem sign failed"); } return signOrig(p); };
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 1);
  assert.equal(sh.storage.rec().stage, "deposit-broadcast");
  sh = shared(); t = makeTab(sh, { sendRawThrows: (n) => n === 2 });
  await t.sendPiggy(); await settle();
  assert.equal(t.calls.sendRaw, 2);
  assert.deepEqual([sh.storage.rec().stage, sh.storage.rec().phase, sh.storage.rec().redeemTxHash], ["redeem-broadcast", "signed", HASH(1)]);
});
await check("B7 appLock raised while the deposit is waited for does not matter to the redeem (single attempt continues); the lock check is only at the START of money execution", async () => {
  const src = fnBody("sendPiggyOnce");
  assert.equal((src.match(/state\.appLock/g) || []).length, 2, "exactly the A-698 guard and the pre-sign boundary check; none in the redeem leg");
  assert.ok(src.indexOf('throw new Error("app_locked_before_sign")') > src.indexOf("simulateSend(account)"));
  assert.ok(src.indexOf('throw new Error("app_locked_before_sign")') < src.indexOf("signSendStep(walletClient, account, plan.depositTx)"));
});

// ═══ W. crash windows: freeze the run at a point (= process death), reload on the same storage, classify ═════════
// reload = a NEW tab; the old tab's lifetime lock is released (it died). The reload world is read-only by construction:
// every money counter must stay 0 and no raw transaction may reach the node.
async function crashAndReload(freeze, chainSetup) {
  const sh = shared({ chain: makeChain({ autoMine: false }) });
  const a = makeTab(sh, { freeze });
  a.sendPiggy();
  await settle();
  const sentBeforeReload = sh.chain.sent.length;
  sh.locks.killPrefix(TAB_PREFIX + a.sendTabId());
  sh.locks.held.delete("araso.sendPending.v1");
  if (chainSetup) chainSetup(sh.chain, a);
  const b = makeTab(sh);
  await tick();
  const swept = await b.sweepStaleSendReservation();
  const pending = b.readSendPending();
  const cls = pending ? await b.classifySendPending(pending) : null;
  return { sh, a, b, swept, pending, cls, sentBeforeReload };
}
await check("W1 crash after SIGN, before persist: only `reserved` exists; nothing on chain; reload sweep clears it (owner dead); Send usable; 0 broadcast ever", async () => {
  const r = await crashAndReload("after-sign-deposit");
  assert.equal(r.a.calls.signTx, 1);
  assert.equal(r.sentBeforeReload, 0);
  assert.equal(r.swept, "cleared");
  assert.equal(r.sh.storage.has("araso.sendPending"), false);
  assert.equal(r.sh.chain.sent.length, 0);
  assert.equal(r.b.sendBusy(), false);
});
await check("W2 crash after PERSIST, before broadcast: signed record (hash,nonce) in storage; classify by hash: not on chain -> pending (still out.), record kept, locked, NEVER rebroadcast (the raw is not stored anywhere)", async () => {
  const r = await crashAndReload("sendRaw-deposit");
  assert.equal(r.sh.storage.rec().phase, "signed");
  assert.equal(r.swept, "none", "the sweep does not touch a signed record");
  assert.equal(r.cls.kind, "pending");
  assert.ok(r.sh.storage.has("araso.sendPending"));
  assert.equal(r.b.sendBusy(), true);
  // reconcile + re-tap: still zero money steps in the reload tab
  await r.b.reconcileSendPending(r.pending, { watch: false });
  await r.b.sendPiggy(); await settle();
  assert.equal(`${r.b.calls.grant}/${r.b.calls.prepared}/${r.b.calls.signTx}/${r.b.calls.sendRaw}/${r.b.calls.sign}/${r.b.calls.recover}`, "0/0/0/0/0/0");
  assert.equal(r.sh.chain.sent.length, 1, "only the original (frozen) attempt ever called the node");
  assert.ok(r.sh.storage.rec().depositTxHash === HASH(0) && r.sh.storage.rec().nonce === 0);
});
await check("W2b same record, but the deposit DID land before the crash (broadcast reached the node): classify -> deposit-confirmed (still out.), no auto redeem, no unlock; a reverted deposit -> failed (existing contract: lock kept)", async () => {
  let r = await crashAndReload("sendRaw-deposit", (chain) => chain.mine(HASH(0), "success", 100n));
  assert.equal(r.cls.kind, "deposit-confirmed");
  await r.b.reconcileSendPending(r.pending, { watch: false });
  assert.equal(r.b.calls.sendRaw + r.b.calls.signTx, 0);
  assert.ok(r.sh.storage.has("araso.sendPending"));
  r = await crashAndReload("sendRaw-deposit", (chain) => chain.mine(HASH(0), "reverted", 100n));
  assert.equal(r.cls.kind, "failed");
  await r.b.reconcileSendPending(r.pending, { watch: false });
  assert.ok(r.sh.storage.has("araso.sendPending"), "no unlock on a revert in this patch (N3 retry/unlock policy is Owner-gated)");
  assert.equal(r.b.calls.sendRaw, 0);
});
await check("W3 crash after BROADCAST, before the receipt (deposit leg): same record -> classified by hash from chain facts; read error -> unknown (can't tell yet.); nothing cleared, nothing re-sent", async () => {
  let r = await crashAndReload("wait-deposit");
  assert.equal(r.a.calls.sendRaw, 1);
  assert.equal(r.sh.storage.rec().phase, "sent");
  assert.equal(r.cls.kind, "pending");
  r = await crashAndReload("wait-deposit", (chain) => { chain.readError = true; });
  assert.equal(r.cls.kind, "unknown");
  await r.b.reconcileSendPending(r.pending, { watch: false });
  assert.ok(r.sh.storage.has("araso.sendPending"));
  assert.equal(r.b.calls.sendRaw + r.b.calls.signTx + r.b.calls.grant, 0);
});
await check("W4 crash after the REDEEM was persisted, before its broadcast: redeem-broadcast/signed record with both hashes; classify by the redeem hash; success on chain -> the existing success contract (verified receipt, then compare-and-clear), no money step in the reload tab", async () => {
  let r = await crashAndReload("sendRaw-redeem", (chain) => { chain.mine(HASH(0), "success", 100n); });
  assert.deepEqual([r.sh.storage.rec().stage, r.sh.storage.rec().phase, r.sh.storage.rec().redeemTxHash], ["redeem-broadcast", "signed", HASH(1)]);
  assert.equal(r.cls.kind, "pending", "redeem hash not on chain");
  await r.b.reconcileSendPending(r.pending, { watch: false });
  assert.ok(r.sh.storage.has("araso.sendPending"));
  r = await crashAndReload("sendRaw-redeem", (chain) => { chain.mine(HASH(0), "success", 100n); chain.mine(HASH(1), "success", 101n); });
  assert.equal(r.cls.kind, "success");
  await r.b.reconcileSendPending(r.pending, { watch: false });
  assert.equal(r.sh.storage.has("araso.sendPending"), false, "cleared by finishTrip after the verified receipt");
  assert.equal(JSON.parse(r.sh.storage.raw("araso.receipts")).length, 1);
  assert.equal(r.b.calls.sendRaw + r.b.calls.signTx + r.b.calls.grant + r.b.calls.prepared, 0);
  assert.equal(r.sh.chain.sent.length, 2, "no extra raw transaction from the reload tab");
});
await check("W5 crash after the redeem broadcast, before its receipt: classify by hash (pending / reverted -> failed / success); never a rebroadcast", async () => {
  let r = await crashAndReload("settle", (chain) => { chain.mine(HASH(0), "success", 100n); });
  assert.equal(r.sh.storage.rec().phase, "sent");
  assert.equal(r.cls.kind, "pending");
  r = await crashAndReload("settle", (chain) => { chain.mine(HASH(0), "success", 100n); chain.mine(HASH(1), "reverted", 101n); });
  assert.equal(r.cls.kind, "failed");
  await r.b.reconcileSendPending(r.pending, { watch: false });
  assert.ok(r.sh.storage.has("araso.sendPending"), "revert keeps the lock (existing contract)");
  assert.equal(r.b.calls.sendRaw + r.b.calls.signTx, 0);
});
await check("W6 legacy hash-less records (deposit-sending / redeem-sending) still classify unknown (can't tell yet.) and are never cleared by any new code path", async () => {
  for (const rec of [{ stage: "deposit-sending", address: ADDR }, { stage: "redeem-sending", address: ADDR, depositTxHash: HASH(0) }]) {
    const sh = shared();
    sh.storage.put("araso.sendPending", JSON.stringify(rec));
    const b = makeTab(sh); await tick();
    assert.equal((await b.classifySendPending(b.readSendPending())).kind, "unknown");
    assert.equal(await b.sweepStaleSendReservation(), "none");
    assert.deepEqual(sh.storage.rec(), rec);
    await b.sendPiggy(); await settle();
    assert.equal(b.calls.grant + b.calls.signTx + b.calls.sendRaw, 0);
  }
});
await check("W7 a `reserved` record classifies unknown (can't tell yet.) in the read-only reconcile (no network read, nothing cleared by classify)", async () => {
  const sh = shared();
  sh.storage.put("araso.sendPending", JSON.stringify({ stage: "reserved", reservationId: "x.1", tabId: "t", at: 1 }));
  const b = makeTab(sh); await tick();
  const r = await b.reconcileSendPending(b.readSendPending(), { watch: false });
  assert.equal(r.kind, "unknown");
  assert.equal(b.calls.reads.length, 0);
  assert.ok(sh.storage.has("araso.sendPending"));
});

// ═══ P. transaction-format parity: sign-before-send == viem sendTransaction's own local-account path ══════════
// The signed bytes, the hash and the nonce of signSendStep (main.js, verbatim) equal what walletClient.sendTransaction would have broadcast.
// Always runs against a deterministic JSON-RPC stand-in; additionally against a real local fork when M2B_FORK_RPC is set (anvil --chain-id 10143).
const SIGN_STEP_SRC = fnBody("signSendStep");
const CHAIN = (rpc) => ({ id: 10143, name: "Monad Testnet", nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" }, rpcUrls: { default: { http: [rpc] } } });
function stubTransport(state) {
  return custom({
    async request({ method, params }) {
      state.log.push(method);
      switch (method) {
        case "eth_chainId": return "0x279f";
        case "eth_getTransactionCount": return toHex(state.nonce);
        case "eth_estimateGas": return "0x5b2c";
        case "eth_getBlockByNumber": return { number: "0x10", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", timestamp: "0x1", transactions: [], miner: ADDR, difficulty: "0x0", nonce: "0x0000000000000000", sha3Uncles: "0x" + "33".repeat(32), logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x" + "44".repeat(32), stateRoot: "0x" + "55".repeat(32), receiptsRoot: "0x" + "66".repeat(32), extraData: "0x", size: "0x1", uncles: [], totalDifficulty: "0x0", mixHash: "0x" + "77".repeat(32) };
        case "eth_maxPriorityFeePerGas": return "0x3b9aca00";
        case "eth_gasPrice": return "0x77359400";
        case "eth_feeHistory": return { oldestBlock: "0x1", baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"], gasUsedRatio: [0], reward: [["0x3b9aca00"]] };
        case "eth_sendRawTransaction": state.sent.push(params[0]); return keccak256(params[0]);
        default: throw new Error(`unexpected rpc ${method}`);
      }
    },
  });
}
await check("P1 stand-in RPC: for the deposit and the redeem shape, signSendStep's raw bytes == the bytes viem's sendTransaction broadcasts (same nonce, fees, gas, signature), hash == keccak256(raw) == node return, signer recovers to the account", async () => {
  const session = createSecp256k1SigningSession({ privateKey: randomBytes(32) });
  const account = toViemAccount(session);
  const factory = new Function("keccak256", "MONAD_TESTNET", "preparedSignProblem", `${SIGN_STEP_SRC}\nreturn signSendStep;`);
  for (const tx of [{ to: SHMON_ADDRESS, value: 10n ** 15n, data: "0x6e553f65" + "00".repeat(64) }, { to: SHMON_ADDRESS, data: "0xba087652" + "00".repeat(96) }]) {
    const stOld = { nonce: 4, log: [], sent: [] };
    const wcOld = createWalletClient({ account, chain: CHAIN("http://stub"), transport: stubTransport(stOld) });
    const hashOld = await wcOld.sendTransaction({ account, chain: CHAIN("http://stub"), ...tx });
    const stNew = { nonce: 4, log: [], sent: [] };
    const chain = CHAIN("http://stub");
    const wcNew = createWalletClient({ account, chain, transport: stubTransport(stNew) });
    const pcNew = createPublicClient({ chain, transport: stubTransport(stNew) });
    const signSendStep = factory(keccak256, chain, preparedSignProblem);
    const signed = await signSendStep(wcNew, account, tx);
    const returned = await pcNew.sendRawTransaction({ serializedTransaction: signed.raw });
    assert.equal(signed.raw, stOld.sent[0], "raw bytes identical");
    assert.equal(signed.hash, hashOld, "hash identical to the old path's returned hash");
    assert.equal(returned, signed.hash, "node return == computed hash");
    assert.equal(signed.nonce, 4);
    assert.equal(parseTransaction(signed.raw).nonce, 4);
    assert.equal((await recoverTransactionAddress({ serializedTransaction: signed.raw })).toLowerCase(), account.address.toLowerCase());
    assert.deepEqual(stOld.log.filter((m) => m === "eth_sendRawTransaction").length, 1);
    assert.equal(stNew.log.includes("eth_sendRawTransaction"), true);
  }
});
await check("P2 signSendStep refuses a prepared request without an integer nonce and a non-hex signature (no persisted identity can be invented)", async () => {
  const factory = new Function("keccak256", "MONAD_TESTNET", "preparedSignProblem", `${SIGN_STEP_SRC}\nreturn signSendStep;`);
  const signSendStep = factory(keccak256, { id: 1 }, preparedSignProblem);
  await assert.rejects(() => signSendStep({ prepareTransactionRequest: async () => ({}) }, { signTransaction: async () => "0xaa" }, {}), /send_nonce_missing/);
  // [A-768 M-C-1] a well-formed prepared request is needed to reach the signer now (the pre-sign guard refuses anything else first).
  await assert.rejects(() => signSendStep({ prepareTransactionRequest: async () => ({ type: "eip1559", chainId: 10143, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 1 }) }, { signTransaction: async () => "nothex" }, {}), /send_sign_failed/);
  await assert.rejects(() => signSendStep({ prepareTransactionRequest: async () => ({ nonce: 1 }) }, { signTransaction: async () => "0xaa" }, {}), /send_prepared_refused/);
  await assert.rejects(() => signSendStep({ prepareTransactionRequest: async () => ({ nonce: -1 }) }, { signTransaction: async () => "0xaa" }, {}), /send_nonce_missing/);
});
const FORK = process.env.M2B_FORK_RPC;
if (FORK) {
  await check(`P3 LOCAL FORK ${FORK}: with fees pinned, raw bytes / hash / nonce of sign-before-send == viem sendTransaction on the same state (evm_snapshot/revert); unpinned: same tx fields, only the base-fee-derived maxFeePerGas may differ`, async () => {
    const rpc = async (method, params = []) => { const j = await (await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json(); if (j.error) throw new Error(j.error.message); return j.result; };
    assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(FORK), "P3 only ever talks to a LOCAL node (never a public RPC)");
    assert.equal(await rpc("eth_chainId"), "0x279f", "fork must run with --chain-id 10143");
    assert.equal(typeof (await rpc("anvil_nodeInfo")), "object", "the local node is anvil (anvil_* methods present)");
    // [A-773] a throwaway signing key generated at runtime (never persisted/logged); funded only on this local node via anvil_setBalance below.
    const session = createSecp256k1SigningSession({ privateKey: randomBytes(32) });
    const account = toViemAccount(session);
    await rpc("anvil_setCode", [SHMON_ADDRESS, "0x00"]);
    await rpc("anvil_setBalance", [account.address, toHex(10n ** 18n)]);
    const chain = CHAIN(FORK);
    const wc = createWalletClient({ account, chain, transport: http(FORK) });
    const pc = createPublicClient({ chain, transport: http(FORK) });
    const signSendStep = new Function("keccak256", "MONAD_TESTNET", "preparedSignProblem", `${SIGN_STEP_SRC}\nreturn signSendStep;`)(keccak256, chain, preparedSignProblem);
    // pinned fees are derived from the fork's own base fee (Monad testnet's base fee is far above a fixed 3 gwei)
    const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
    const baseFee = BigInt(latest.baseFeePerGas || "0x0");
    console.log(`      P3 node=${FORK} block=${BigInt(latest.number)} baseFee=${baseFee} account=${account.address} (runtime-generated)`);
    for (const fees of [{ maxFeePerGas: baseFee * 3n + 1000000000n, maxPriorityFeePerGas: 1000000000n }, {}]) {
      const txs = [{ ...fees, to: SHMON_ADDRESS, value: 10n ** 15n, data: "0x6e553f65" + "00".repeat(64) }, { ...fees, to: SHMON_ADDRESS, data: "0xba087652" + "00".repeat(96) }];
      await rpc("evm_setAutomine", [true]);
      const snap = await rpc("evm_snapshot");
      const startNonce = Number(await rpc("eth_getTransactionCount", [account.address, "latest"]));
      const oldRuns = [];
      for (const tx of txs) { const h = await wc.sendTransaction({ account, chain, ...tx }); oldRuns.push({ h, raw: await rpc("eth_getRawTransactionByHash", [h]), receipt: await pc.getTransactionReceipt({ hash: h }) }); }
      assert.equal(await rpc("evm_revert", [snap]), true);
      const snapNew = await rpc("evm_snapshot");
      const newRuns = [];
      for (const tx of txs) { const s = await signSendStep(wc, account, tx); const h = await pc.sendRawTransaction({ serializedTransaction: s.raw }); newRuns.push({ s, h, raw: await rpc("eth_getRawTransactionByHash", [h]), receipt: await pc.getTransactionReceipt({ hash: h }) }); }
      newRuns.forEach((n, i) => {
        assert.equal(n.h, n.s.hash, "node-returned hash == keccak256(raw)");
        assert.equal(n.raw, n.s.raw, "what the node stored is the raw we hashed");
        assert.equal(n.s.nonce, startNonce + i, "nonce recorded == nonce used (account's next nonce, then +1)");
        assert.equal(Number(parseTransaction(n.raw).nonce), n.s.nonce, "nonce in the node-stored raw == recorded nonce");
        assert.equal(n.receipt.status, oldRuns[i].receipt.status);
        const po = parseTransaction(oldRuns[i].raw), pn = parseTransaction(n.s.raw);
        for (const k of ["type", "chainId", "to", "gas", "data", "nonce", "value"]) assert.equal(String(pn[k]), String(po[k]), k);
        if (fees.maxFeePerGas) { assert.equal(n.s.raw, oldRuns[i].raw, "pinned fees: byte-identical raw"); assert.equal(n.h, oldRuns[i].h, "pinned fees: identical hash"); }
      });
      for (const [i, n] of newRuns.entries()) console.log(`      P3 ${fees.maxFeePerGas ? "pinned" : "unpinned"} leg${i} nonce=${n.s.nonce} hash=${n.s.hash} old=${oldRuns[i].h} byteEqual=${n.s.raw === oldRuns[i].raw} status=${n.receipt.status}`);
      assert.equal(await rpc("evm_revert", [snapNew]), true);
    }
  });
} else {
  console.log("SKIP  P3 local-fork parity (set M2B_FORK_RPC to a local anvil --chain-id 10143; result recorded in A707 VERIFY.md)");
}

// ═══ H. source invariants ════════════════════════════════════════════════════════════════════════
await check("H1 broadcast sites: main.js has exactly two broadcast calls (First deposit + redeem), both `publicClient.sendRawTransaction`, no sendTransaction call left (money-executor.mjs H1 stays green)", async () => {
  const code = strip(MAIN);
  assert.equal((code.match(/\.sendRawTransaction\s*\(/g) || []).length, 2);
  assert.equal((code.match(/\.sendTransaction\s*\(/g) || []).length, 0);
  assert.equal((strip(fnBody("sendPiggyOnce")).match(/publicClient\.sendRawTransaction\(/g) || []).length, 2);
});
await check("H2 source order inside sendPiggyOnce: reserve < confirm < appLock guard < grant; per leg: signSendStep < writeOwnedSendPending(signed) < sendRawTransaction; unsent-hash window closes only after the persist", async () => {
  const s = fnBody("sendPiggyOnce");
  const at = (x) => s.indexOf(x);
  assert.ok(at("reserveSend()") < at("confirmSendReservation(") && at("confirmSendReservation(") < at("if (state.appLock)") && at("if (state.appLock)") < at("requestGrant("));
  const dep = [at("signSendStep(walletClient, account, plan.depositTx)"), at('writeOwnedSendPending(reservation, { stage: "deposit-broadcast", phase: "signed"'), at("unsentDepositHash = null; //"), at("publicClient.sendRawTransaction({ serializedTransaction: depositSigned.raw })")];
  assert.ok(dep.every((x) => x > 0) && dep[0] < dep[1] && dep[1] < dep[2] && dep[2] < dep[3], `deposit order ${dep}`);
  // [A-768 M-L-1 re-pin, named reason] the redeem signature moved into prepareRedeemAfterDeposit (deposit-block-pinned reads + bounded
  // retry); its call site in sendPiggyOnce keeps the same order: sign (inside the helper) < persist(signed) < broadcast.
  const red = [at("prepareRedeemAfterDeposit({"), at('writeOwnedSendPending(reservation, { stage: "redeem-broadcast", phase: "signed"'), at("publicClient.sendRawTransaction({ serializedTransaction: redeemSigned.raw })")];
  assert.ok(red.every((x) => x > 0) && red[0] < red[1] && red[1] < red[2], `redeem order ${red}`);
  assert.ok(fnBody("prepareRedeemAfterDeposit").includes("signSendStep(walletClient, account, { ...redeemTx, gas })"), "the helper signs the redeem through signSendStep");
  assert.ok(at("clearOwnSendPending(reservation, { unsentHash: unsentDepositHash })") > at("catch (error)"));
  assert.equal(/deposit-sending|redeem-sending/.test(strip(s)), false, "no hash-less stage is written any more");
});
await check("H3 no new user-visible words and no retry semantics: setScene strings added by this card are existing ones; sendPiggyOnce/helpers contain no setTimeout/loop re-send", async () => {
  const added = [...fnBody("sendPiggyOnce").matchAll(/setScene\(([^)]*)\)/g)].map((m) => m[1]);
  for (const a of added) assert.ok(/^"(sendstay|birth|away)", "(Piggy is home\.|Piggy can't go out yet\.|Chog could not wake Piggy\.|Piggy is waking up\.|Piggy is asking to go out\.|Piggy went out\.|relayer unreachable|Piggy could not get ready\.|Not from here\.)"/.test(a) || /Piggy can only go out/.test(a), `setScene ${a}`);
  const helpers = strip(PENDING_SRC);
  assert.equal(/setTimeout|setInterval|while \(|for \(;;\)/.test(strip(fnBody("sendPiggyOnce")) + strip(fnBody("signSendStep")) + strip(fnBody("clearOwnSendPending"))), false);
});
await check("H4 the raw signed transaction is never persisted or logged: no storage write contains `raw`, serializedTransaction only flows to sendRawTransaction", async () => {
  const s = strip(fnBody("sendPiggyOnce"));
  assert.equal(/writeOwnedSendPending\([^)]*raw/.test(s), false);
  assert.equal((s.match(/serializedTransaction/g) || []).length, 2);
  assert.equal(/recordSafeError\([^)]*raw/.test(s), false);
});
await check("H5 pinned functions untouched by this card: classifySendPending / reconcileSendPending / reconciledSendReceipt / readSendPending / writeSendPending / commitSendSuccess / finishTrip / render keep their A-699 hashes", async () => {
  const sha16 = (x) => createHash("sha256").update(x).digest("hex").slice(0, 16);
  const want = { classifySendPending: "2389cf76d2658fd6", reconcileSendPending: "1caf49b6a16b09df", readSendPending: "065bbae2d4bb516e", commitSendSuccess: "9d3ac854b6df8ff3", finishTrip: "60edd8708e77d531", reconciledSendReceipt: "1de55c29816852f7", render: "521db6368b3a331d" };
  for (const [name, h] of Object.entries(want)) assert.equal(sha16(fnBody(name)), h, name);
});

// ═══ [A-756 H-1] stale second tab after a FINISHED First (99d_SECURITY_REVIEW H-1) ══════════════════════════════════════════════
// The shared persisted trip-closed truth (araso.tripClosed="1", or the legacy confirmed araso.txHash bridge) is re-read at reserve time AND
// inside the exclusive lock (promoteSendReservation) before any grant / sign / sendRaw. A stale tab spends nothing. Fail closed on read error.
const moneyCalls = (t) => t.calls.grant + t.calls.prepared + t.calls.signTx + t.calls.sendRaw;
await check("A756-H1a stale tab B (open before A's Send) taps after A FINISHED: grant/prepare/sign/sendRaw 0; exactly A's two raw txs ever; existing copy; no record left", async () => {
  const sh = shared();
  const b = makeTab(sh); // tab B booted first (its state.tripClosed is the stale boot value: false)
  const a = makeTab(sh);
  await a.sendPiggy(); await settle();
  assert.equal(sh.storage.raw("araso.tripClosed"), "1", "A closed the trip in shared storage");
  assert.equal(sh.storage.has("araso.sendPending"), false, "A cleared its pending record");
  assert.equal(b.state.tripClosed, false, "B's in-memory flag is stale");
  await b.sendPiggy(); await settle();
  assert.equal(moneyCalls(b), 0, "B spent nothing");
  assert.equal(sh.chain.sent.length, 2, "only A's deposit+redeem ever reached the node");
  assert.deepEqual(lastScene(b), ["sendstay", "Piggy can't go out yet.", ""], "existing failure copy, no new words");
  assert.equal(sh.storage.has("araso.sendPending"), false);
  assert.deepEqual(tabRecs(sh.storage), [], "B wrote no reservation");
});
await check("A756-H1b IN-LOCK recheck: B reserved and is inside its passkey while A runs a whole First to completion; B's confirm (under the exclusive lock, slot empty) refuses -> grant/sign/sendRaw 0", async () => {
  const sh = shared();
  let aTab = null;
  const b = makeTab(sh, { session: false, recoverHook: async () => {
    aTab = makeTab(sh);
    await aTab.sendPiggy(); await settle();
  } });
  await b.sendPiggy(); await settle();
  assert.equal(b.calls.recover, 1, "B passed reserveSend (trip was open at its tap) and reached the passkey");
  assert.equal(aTab.calls.sendRaw, 2, "A completed while B's passkey was open");
  assert.equal(sh.storage.raw("araso.tripClosed"), "1");
  assert.equal(sh.storage.has("araso.sendPending"), false, "shared slot was EMPTY at B's confirm — only the trip-closed recheck can stop B");
  assert.equal(moneyCalls(b), 0, "B: grant/prepare/sign/sendRaw 0");
  assert.equal(sh.chain.sent.length, 2, "never a second run");
  assert.equal(sh.locks.held.has(LOCK), false, "B released the exclusive lock");
  assert.deepEqual(tabRecs(sh.storage), [], "B's tab-scoped reservation released");
});
await check("A756-H1c legacy confirmed araso.txHash (no tripClosed flag, no pending) = closed: 0 money steps", async () => {
  const sh = shared();
  sh.storage.put("araso.txHash", HASH(9));
  const b = makeTab(sh);
  await b.sendPiggy(); await settle();
  assert.equal(moneyCalls(b), 0);
  assert.equal(sh.chain.sent.length, 0);
});
await check("A756-H1d fail closed: unreadable araso.tripClosed -> no reservation, 0 money steps", async () => {
  const sh = shared();
  sh.storage.fx.throwGet.add("araso.tripClosed");
  const b = makeTab(sh);
  const r = b.reserveSend();
  assert.deepEqual([r.ok, r.reason], [false, "trip_closed"]);
  await b.sendPiggy(); await settle();
  assert.equal(moneyCalls(b), 0);
});
await check("A756-H1e unknown/pending semantics unchanged: tripClosed=1 AND a live pending record -> still 'busy' (pending checked first), record untouched, existing catching-up copy", async () => {
  for (const seed of [{ stage: "deposit-broadcast", phase: "signed", depositTxHash: HASH(0), reservationId: "x.y" }, '{"stage":"unrecognized"}']) { // (unparseable JSON breaks this harness's setScene probe; an unknown stage is the same fail-closed branch)
    const sh = shared();
    sh.storage.put("araso.tripClosed", "1");
    sh.storage.put("araso.sendPending", typeof seed === "string" ? seed : JSON.stringify(seed));
    const before = sh.storage.raw("araso.sendPending");
    const b = makeTab(sh);
    assert.deepEqual([b.reserveSend().ok, b.reserveSend().reason], [false, "busy"]);
    await b.sendPiggy(); await settle();
    assert.equal(moneyCalls(b), 0);
    assert.equal(sh.storage.raw("araso.sendPending"), before);
    assert.deepEqual(lastScene(b), ["sendstay", "Piggy is home.", "Confirmation is still catching up."]);
  }
});
await check("A756-H1f no over-block: A's Send FAILED before broadcast (grant refused) -> trip stays open -> stale tab B can still run exactly once", async () => {
  const sh = shared();
  const b = makeTab(sh);
  const a = makeTab(sh, { grantThrows: true });
  await a.sendPiggy(); await settle();
  assert.equal(sh.storage.has("araso.tripClosed"), false);
  await b.sendPiggy(); await settle();
  assert.equal(b.calls.sendRaw, 2, "B ran once");
  assert.equal(sh.chain.sent.length, 2);
});
await check("A756-H1g same tab, second tap after its own finished First: 0 money steps", async () => {
  const sh = shared();
  const a = makeTab(sh);
  await a.sendPiggy(); await settle();
  const before = { ...a.calls };
  await a.sendPiggy(); await settle();
  assert.equal(a.calls.grant, before.grant);
  assert.equal(a.calls.sendRaw, 2);
  assert.equal(sh.chain.sent.length, 2);
});
await check("A756-H1h source: the trip-closed recheck sits INSIDE promoteSendReservation (runs only under the exclusive lock) before the shared write, and in reserveSend after the pending check", async () => {
  const p = strip(fnBody("promoteSendReservation"));
  assert.ok(p.indexOf("firstTripClosedShared()") > 0 && p.indexOf("firstTripClosedShared()") < p.indexOf("localStorage.setItem(SEND_PENDING_KEY"));
  const r = strip(fnBody("reserveSend"));
  assert.ok(r.indexOf("readSendPending()") < r.indexOf("firstTripClosedShared()") && r.indexOf("firstTripClosedShared()") < r.indexOf("localStorage.setItem("));
  const f = strip(fnBody("firstTripClosedShared"));
  assert.ok(/catch \{\s*return true;/.test(f), "read error = closed");
});

console.log(`\nA-707: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
