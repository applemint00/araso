// [A-699 MONEY SAFETY M2-ALPHA · FIRST LEGACY DURABILITY] node-only failure-injection contract.
//   node app/test/money-safety-first.mjs
//
// Runs main.js's ACTUAL function text (node:vm, same cut-the-source technique as a633 / send-lock / receipt-storage) over fake
// storage with injectable throw / silent-drop / corrupt, a scripted public client, and (for the flow tests) the real
// sendPiggy + sendPiggyOnce text. Network 0 · browser 0 · real WebAuthn 0 · keys 0 · tx 0.
//
// State order under test (First legacy, no sendPiggyOnce edit):
//   execution truth (settleSend / reconcile success) -> receipt build -> durable save -> verify by re-read
//     -> compare-and-clear of the pending record -> UI success
//
// Test-plan mapping (A-680 TEST_PLAN -> what is applicable to M2-alpha; the rest needs M2-beta reservation / sign-before-send):
//   A1/A2 (reserved / *-signed writes)  N/A (no such stages in alpha)  -> A1x: the existing pre-money write is now verified; a failed or
//                                         silently dropped `deposit-sending` write is a throw (sendPiggyOnce's existing catch -> nothing more is sent)
//   A3    (post-broadcast hash write)   [A-707 M2-beta] now covered: the signed record (hash + nonce) is written BEFORE the broadcast; FLOW-5 pins both
//                                         the failing signed write (0 broadcast) and the best-effort phase-sent write (flow continues). Full matrix: money-safety-m2b.mjs
//   A4 A5 A6 A7 A8                      applicable
//   A9    (Second bridge)               N/A (card M1, other files)
//   B1 B2 B4                            applicable (+ B5 stale-tab overwrite = T5, B6 compare-and-clear)
//   C1..C8 (new stages)                 N/A; C-legacy: every existing stage reconciles read-only (zero signer/send/grant/prf calls)
//   C9    (desktop width)               applicable (boot R4 block executed on stubs)
//   C10   (legacy hash-less shapes)     applicable
//   E1..E5 (F6 recovery-needed)         N/A (needs M2-beta recovery-needed state; a633 D3 pins deposit-only = still out., no auto redeem)
//   F1 F2 F3                            applicable, F1/F2 in their alpha form: NO partial receipt is invented (the receipt codec has no
//                                         "unknown" number); no durable receipt => pending stays
//   G1 G2                               applicable   G3 G4 (nonce rule)  N/A
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { TransactionNotFoundError, TransactionReceiptNotFoundError, keccak256 } from "viem";
import { preparedSignProblem } from "../src/money-executor.js";
import { decodeReceiptRow, encodeReceiptRow, receiptIdentityKey as codecReceiptIdentityKey, RECEIPT_KIND } from "../src/receipt-codec.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 7).join("\n      ")}`); fail += 1; }
}
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };

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
  let depth = 0;
  let inStr = null;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", start)); i < MAIN.length; i += 1) {
    const c = MAIN[i];
    if (inStr) { if (c === "\\") { i += 1; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && MAIN[i + 1] === "/") { i = MAIN.indexOf("\n", i); continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return MAIN.slice(start, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}

const SEND_PENDING_KEY = "araso.sendPending";
const RECEIPTS_KEY = "araso.receipts";
const CONSTS = [
  'const RECEIPTS_KEY = "araso.receipts";',
  'const TRIP_CLOSED_KEY = "araso.tripClosed";',
  'const SEND_PENDING_KEY = "araso.sendPending";',
  // [A-707 M2-beta re-pin, named reason] "reserved" joins the stage list (cross-tab reservation record); the legacy hash-less stages stay readable.
  'const SEND_PENDING_STAGES = ["reserved", "deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"];',
];
for (const c of CONSTS) assert.ok(MAIN.includes(c), `const line still in main.js: ${c}`);
const SHMON_ADDRESS = MAIN.match(/const SHMON_ADDRESS = "(0x[0-9a-fA-F]{40})";/)[1];
const RECEIPT_FNS_SRC = cut("function readReceipts() {", "\nfunction writeCredential(credential) {");
const PENDING_SRC = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");
const RECONCILE_SRC = cut("// [A-633 C] First Send 미확정 기록", "async function requestGrant(");
const FINISH_SRC = fnBody("finishTrip");
const ONCE_SRC = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");

// ── fake storage: injectable failures ─────────────────────────────────────────────────────────
function makeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  const log = [];
  const fx = { throwSet: new Set(), throwGet: new Set(), dropSet: new Set(), throwRemove: new Set() };
  return {
    fx, log,
    getItem(k) { log.push(["get", k]); if (fx.throwGet.has(k)) throw new Error(`getItem ${k} blocked`); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { log.push(["set", k]); if (fx.throwSet.has(k)) throw new Error(`setItem ${k} quota`); if (fx.dropSet.has(k)) return; m.set(k, String(v)); },
    removeItem(k) { log.push(["remove", k]); if (fx.throwRemove.has(k)) throw new Error(`removeItem ${k} blocked`); m.delete(k); },
    raw: (k) => (m.has(k) ? m.get(k) : null),
    has: (k) => m.has(k),
    put: (k, v) => m.set(k, v),
  };
}

const D = "0x" + "d".repeat(64);
const E = "0x" + "e".repeat(64);
const F = "0x" + "f".repeat(64);
const ADDR = "0x42a277c62556cdb96a62b4c7cfe43e09eec0053a";
const pend = (over = {}) => ({ stage: "redeem-broadcast", address: ADDR, depositTxHash: D, redeemTxHash: E, ...over });
function receipt(over = {}) {
  return {
    before: 5n * 10n ** 17n, after: 499n * 10n ** 15n, gas: 10000000n, sent: 10n ** 15n,
    txHash: E, depositTxHash: D, redeemTxHash: E, grantTxHash: "",
    depositBlockNumber: 100n, redeemBlockNumber: 101n, depositGasUsed: 50000n, redeemGasUsed: 50000n,
    shmonReceived: 990n * 10n ** 12n, shmonAfterRedeem: 0n, status: "success", at: 1700000000000, piggyId: "p1",
    ...over,
  };
}
const storedRows = (storage) => JSON.parse(storage.raw(RECEIPTS_KEY) || "[]");

// ── context with the REAL receipt / pending / finishTrip / reconcile text ──────────────────────
function build({ storage = makeStorage(), memoryReceipts = [], pendingRecord, receiptsRaw, sc = {} } = {}) {
  if (pendingRecord !== undefined) storage.put(SEND_PENDING_KEY, typeof pendingRecord === "string" ? pendingRecord : JSON.stringify(pendingRecord));
  if (receiptsRaw !== undefined) storage.put(RECEIPTS_KEY, receiptsRaw);
  const calls = { scenes: [], timeouts: [], forbidden: [], reads: [], lineWrites: [] };
  const state = { receipts: [...memoryReceipts], receiptIndex: 0, tripClosed: false, tripOutcome: "", tripReason: "", returnArrival: false, returnArrivalAlarm: false, txHash: "", awayRestore: "checking", scene: "away" };
  const forbid = (n) => () => { calls.forbidden.push(n); throw new Error(`forbidden ${n}`); };
  const publicClient = {
    async getTransactionReceipt({ hash }) {
      calls.reads.push(["receipt", hash]);
      const w = hash === D ? sc.dep : hash === E ? sc.red : "null";
      if (w === "error") throw Object.assign(new Error("rpc down"), { name: "HttpRequestError" });
      if (!w || w === "null") throw new TransactionReceiptNotFoundError({ hash });
      if (w === "mismatch") return { transactionHash: hash, status: "success", from: "0x" + "1".repeat(40), to: SHMON_ADDRESS.toLowerCase(), blockNumber: 100n, gasUsed: 50000n, effectiveGasPrice: 100n };
      return { transactionHash: hash, status: w === "reverted" ? "reverted" : "success", from: ADDR, to: SHMON_ADDRESS.toLowerCase(), blockNumber: hash === D ? 100n : 101n, gasUsed: 50000n, effectiveGasPrice: 100n };
    },
    async getTransaction({ hash }) { calls.reads.push(["tx", hash]); if (sc.histFail) throw new Error("no archive"); return { hash, value: 10n ** 15n }; },
    async getBalance({ blockNumber }) { calls.reads.push(["bal", blockNumber]); if (sc.histFail) throw new Error("no archive"); return blockNumber === 99n ? 5n * 10n ** 17n : 499n * 10n ** 15n; },
    async readContract({ functionName, blockNumber }) { calls.reads.push(["call", functionName, blockNumber]); return blockNumber === 100n ? 990n * 10n ** 12n : 0n; },
    waitForTransactionReceipt: () => new Promise(() => {}),
    sendTransaction: forbid("publicClient.sendTransaction"),
  };
  const ctx = {
    state, console, JSON, Date, String, Promise, Array, Error, BigInt, Number,
    localStorage: storage,
    publicClient, SHMON_ADDRESS, SHMON_ABI: [],
    indexedPiggyId: () => "p1",
    decodeReceiptRow, encodeReceiptRow, codecReceiptIdentityKey, RECEIPT_KIND,
    LEGACY_TESTNET_PATH: true,
    setScene: (...a) => calls.scenes.push(a),
    setTimeout: (fn, ms) => { calls.timeouts.push([fn, ms]); },
    document: { querySelector: (sel) => (sel === "#awayRestoreLine" ? { set innerHTML(v) { calls.lineWrites.push(v); } } : null) },
    homePadMarkup: () => "", chogHomeMarkup: () => "",
    requestGrant: forbid("requestGrant"), createWalletClient: forbid("createWalletClient"), activateSigningSession: forbid("activateSigningSession"),
    requestPrf: forbid("requestPrf"), recoverPiggy: forbid("recoverPiggy"), signDigest: forbid("signDigest"), sendRawTransaction: forbid("sendRawTransaction"),
    // [A-1487-c] the exclusive send lock the lock-held storage helpers ask for (adoptLandedRedeemHash); granted at once, no cross-tab holder here
    navigator: { locks: { query: async () => ({}), request: async (_name, _options, fn) => fn({}) } },
  };
  vm.createContext(ctx);
  vm.runInContext(
    `let activeSession = null; let activeAccount = null;\n${CONSTS.join("\n")}\n${RECEIPT_FNS_SRC}\n${PENDING_SRC}\n${FINISH_SRC}\n${RECONCILE_SRC}\n` +
    `this.__api = { readReceipts, rememberReceipt, readSendPending, writeSendPending, commitSendSuccess, finishTrip, reconcileSendPending, sendBusy, computeTripClosed };`,
    ctx,
  );
  return { api: ctx.__api, ctx, state, storage, calls };
}

const successTrip = (over = {}) => ({ outcome: "done", reason: "ok", receipt: receipt(), ...over });
const catchingUp = (calls) => calls.scenes.some((s) => s[0] === "away" && s[2] === "Confirmation is still catching up.");
const neverFailedCopy = (calls) => calls.scenes.every((s) => !(s[0] === "sendstay" && /couldn't finish/.test(s[1] || "")));

// ═══ source invariants ═══════════════════════════════════════════════════════════════════════
await check("S1 pending removal sites are exact and evidence-gated", () => {
  // [A-707 M2-beta re-pin, named reason] two more removal sites exist, both compare-and-clear of a record that proves nothing was sent:
  // clearOwnSendPending (this tab's `reserved`, or its just-written signed deposit record whose broadcast call never happened) and
  // sweepStaleSendReservation (a `reserved` record whose owner tab's lifetime lock is provably gone). Every other function still must not clear.
  // [A-707 r2 re-pin, named reason: tab-scoped reservation + lock held through] one more site: promoteSendReservation (runs only inside the
  // exclusive lock) rolls back its OWN just-written `reserved` bytes when the read-back did not verify. It cannot remove any other record.
  // [A-1260 re-pin, named reason] clearProvenNeverSentDeposit adds one removal site behind: exact signed-record compare,
  // missing receipt, pending nonce still equal to the signed nonce, and the exclusive send lock.
  const sites = [...MAIN.matchAll(/localStorage\.removeItem\(SEND_PENDING_KEY\)/g)].length;
  assert.equal(sites, 6, "exactly six removal sites, including A-1260 proved-never-sent cleanup");
  assert.ok(/if \(localStorage\.getItem\(SEND_PENDING_KEY\) === reservation\.json\) localStorage\.removeItem\(SEND_PENDING_KEY\)/.test(fnBody("promoteSendReservation")), "promote only removes its own exact bytes");
  assert.ok(/if \(!sendLockHeldBy\(reservation\)\) return false;/.test(fnBody("clearOwnSendPending")), "clearOwnSendPending touches the shared record only while holding the exclusive lock");
  assert.ok(fnBody("finishTrip").includes("localStorage.removeItem(SEND_PENDING_KEY)"));
  assert.ok(fnBody("clearOwnSendPending").includes("localStorage.removeItem(SEND_PENDING_KEY)"));
  assert.ok(fnBody("sweepStaleSendReservation").includes("localStorage.removeItem(SEND_PENDING_KEY)"));
  assert.ok(fnBody("clearProvenNeverSentDeposit").includes("localStorage.removeItem(SEND_PENDING_KEY)"));
  assert.ok(/blockTag: "pending"/.test(fnBody("proveSignedDepositNeverSent")), "A-1260 compares the pending nonce, not only latest");
  assert.ok(/TransactionReceiptNotFoundError/.test(fnBody("proveSignedDepositNeverSent")), "A-1260 requires an absent receipt");
  assert.ok(/stage !== "reserved" && !unsentSigned/.test(fnBody("clearOwnSendPending")), "clearOwnSendPending only clears reserved / proven-unsent-signed");
  assert.ok(/again\.stage !== "reserved"/.test(fnBody("sweepStaleSendReservation")), "the sweep only clears a reserved record");
  for (const name of ["commitSendSuccess", "sendPiggyOnce", "reconcileSendPending", "classifySendPending", "reconciledSendReceipt", "readSendPending", "writeSendPending", "rememberReceipt"]) {
    assert.equal(fnBody(name).includes("removeItem(SEND_PENDING_KEY)"), false, `${name} must not clear pending`);
  }
});
await check("S2 finishTrip order: rememberReceipt (verified) precedes the pending clear precedes tripClosed; clear is guarded by receiptSaved + stage/hash compare", () => {
  const b = fnBody("finishTrip");
  const iSave = b.indexOf("rememberReceipt(trip.receipt)");
  const iClear = b.indexOf("localStorage.removeItem(SEND_PENDING_KEY)");
  const iClosed = b.indexOf("state.tripClosed = true;");
  assert.ok(iSave > 0 && iSave < iClear && iClear < iClosed);
  const guard = b.slice(b.lastIndexOf("if (", iClear), iClear);
  assert.ok(/stored\.stage === "redeem-broadcast"/.test(guard) && /stored\.redeemTxHash === doneHash/.test(guard), "compare-and-clear guard");
  assert.ok(/if \(receiptSaved\) \{/.test(b.slice(0, iClear)), "clear only when the receipt is verified");
});
await check("S3 commitSendSuccess does not clear; sendPiggyOnce delegates its two outcomes to finishRedeemTail", () => {
  const b = fnBody("commitSendSuccess");
  assert.equal(b.includes("SEND_PENDING_KEY"), false);
  assert.ok(/try \{\s*localStorage\.setItem\("araso\.txHash", redeemTxHash\);\s*\} catch/.test(b));
  const once = fnBody("sendPiggyOnce");
  assert.equal(/rememberReceipt|removeItem\(SEND_PENDING_KEY\)|decodeReceiptRow/.test(once), false);
  assert.ok(once.includes('if (trip.outcome === "done") commitSendSuccess(redeemTxHash);\n        finishRedeemTail(trip);'), "live caller delegates pending and settled outcomes");
  const tail = fnBody("finishRedeemTail");
  assert.ok(/trip\.outcome === "pending"/.test(tail) && tail.includes('showAwayRestore("pending")') && tail.includes('setScene("away"'), "pending remains Away");
  assert.ok(tail.includes("finishTrip(trip);"), "all other outcomes use the existing finishTrip");
});
await check("S4 no new user-visible words: every setScene in the touched functions uses an existing string", () => {
  const all = [FINISH_SRC, RECONCILE_SRC, fnBody("finishRedeemTail"), fnBody("commitSendSuccess"), fnBody("rememberReceipt"), fnBody("readSendPending"), fnBody("writeSendPending")].join("\n");
  const strings = [...all.matchAll(/setScene\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(strings.length >= 4);
  for (const s of strings) assert.ok(/^(?:"sendstay", "couldn't finish this one\."|"sendstay", "Piggy can't go out yet\.", ""|"sendstay", "Piggy is home\.", ""|"return", "Piggy is home\.", "One tag\."|"away", "Piggy is home\.", "Confirmation is still catching up\."|"away", "Piggy went out\.", "Can go out once\."|"filebox")$/.test(s), `setScene args: ${s}`);
});

// ═══ A. storage failure ═════════════════════════════════════════════════════════════════════
await check("A4 getItem throws on the pending read -> NOT 'none': Send is blocked (busy), shape is the existing fail-closed unknown", () => {
  const t = build({ pendingRecord: pend() });
  t.storage.fx.throwGet.add(SEND_PENDING_KEY);
  assert.deepEqual(JSON.parse(JSON.stringify(t.api.readSendPending())), { stage: "unknown" });
  assert.equal(t.api.sendBusy(), true);
  assert.equal(t.api.computeTripClosed({ tripClosedFlag: null, txHash: "0xabc", pending: t.api.readSendPending() }), false, "no legacy txHash bridge while unreadable");
});
await check("A5 corrupt pending JSON -> blocked, record bytes untouched by readSendPending / sendBusy / reconcile", async () => {
  const t = build({ pendingRecord: "{not json" });
  assert.equal(t.api.readSendPending().stage, "unknown");
  assert.equal(t.api.sendBusy(), true);
  const r = await t.api.reconcileSendPending(t.api.readSendPending());
  assert.equal(r.kind, "unknown");
  assert.equal(t.storage.raw(SEND_PENDING_KEY), "{not json");
  assert.deepEqual(t.calls.forbidden, []);
});
await check("A6 receipt store setItem throws at the durable save -> done_unsaved: pending kept, never 'couldn't finish', existing 'catching up' copy, nothing thrown", () => {
  const t = build({ pendingRecord: pend() });
  t.storage.fx.throwSet.add(RECEIPTS_KEY);
  t.api.commitSendSuccess(E);
  assert.doesNotThrow(() => t.api.finishTrip(successTrip()));
  assert.ok(t.storage.has(SEND_PENDING_KEY), "pending NOT cleared");
  assert.equal(neverFailedCopy(t.calls), true);
  assert.equal(catchingUp(t.calls), true);
  assert.equal(t.state.returnArrival, false, "no return scene on an unsaved receipt");
  assert.equal(t.api.sendBusy(), true, "Send stays locked");
  assert.equal(t.state.tripOutcome, "done");
});
// [A-768 M-F-3 · declared expectation update] "one undecodable legacy row" moved out of A7: per 99e M-F-3 a single bad row must not
// poison the whole store (permanent receipt_store_unsound). It is now skipped and kept VERBATIM, like a broken add_money row (A7c below).
await check("A7 receipt store corrupt (unparseable / not an array) -> save refuses, stored bytes unchanged (T4), pending kept", () => {
  for (const raw of ["{broken", JSON.stringify({ a: 1 })]) {
    const t = build({ pendingRecord: pend(), receiptsRaw: raw });
    assert.throws(() => t.api.rememberReceipt(receipt()), /receipt_store_unsound/);
    assert.equal(t.storage.raw(RECEIPTS_KEY), raw, "bytes unchanged");
    t.api.commitSendSuccess(E);
    t.api.finishTrip(successTrip());
    assert.equal(t.storage.raw(RECEIPTS_KEY), raw, "still unchanged after the full finishTrip");
    assert.ok(t.storage.has(SEND_PENDING_KEY), "pending kept");
    assert.equal(neverFailedCopy(t.calls), true);
  }
});
await check("A7b a broken add_money row alone does not block the save and is preserved verbatim (readReceipts already skips it)", () => {
  const goodAdd = encodeReceiptRow({ kind: "add_money", chainId: "10143", token: "0x" + "a".repeat(40), amount: "1", txHash: "0x1", at: 1 });
  const badAdd = { kind: "add_money", chainId: "10143" };
  const t = build({ pendingRecord: pend(), receiptsRaw: JSON.stringify([goodAdd, badAdd]) });
  assert.equal(t.api.rememberReceipt(receipt()), true);
  const rows = storedRows(t.storage);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], goodAdd);
  assert.deepEqual(rows[2], badAdd);
  assert.equal(rows[0].redeemTxHash, E);
});
await check("A7c [A-768 M-F-3] one undecodable LEGACY row no longer poisons the store: the save succeeds, the bad row and the healthy row are kept verbatim, readReceipts shows the healthy history", () => {
  const goodRow = encodeReceiptRow(receipt({ redeemTxHash: F, txHash: F }));
  const badLegacy = { ...goodRow, before: "not-a-number" };
  const t = build({ pendingRecord: pend(), receiptsRaw: JSON.stringify([goodRow, badLegacy]) });
  assert.equal(t.api.rememberReceipt(receipt()), true);
  const rows = storedRows(t.storage);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], goodRow);
  assert.deepEqual(rows[2], badLegacy);
  assert.equal(rows[0].redeemTxHash, E);
});
await check("A8 verify mismatch (setItem 'succeeds' but the row is not in storage) -> not saved, pending kept", () => {
  const t = build({ pendingRecord: pend() });
  t.storage.fx.dropSet.add(RECEIPTS_KEY);
  t.api.commitSendSuccess(E);
  t.api.finishTrip(successTrip());
  assert.equal(t.storage.has(RECEIPTS_KEY), false);
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.equal(catchingUp(t.calls), true);
  assert.equal(neverFailedCopy(t.calls), true);
});
await check("A8b getItem blocked right after the write (cannot verify) -> not saved, pending kept", () => {
  const t = build({ pendingRecord: pend() });
  const orig = t.storage.setItem.bind(t.storage);
  t.storage.setItem = (k, v) => { orig(k, v); if (k === RECEIPTS_KEY) t.storage.fx.throwGet.add(RECEIPTS_KEY); };
  t.api.finishTrip(successTrip());
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.equal(catchingUp(t.calls), true);
});
await check("A9x txHash setItem failing inside commitSendSuccess is not a failed trip (T3): no throw, state.txHash set, pending untouched", () => {
  const t = build({ pendingRecord: pend() });
  t.storage.fx.throwSet.add("araso.txHash");
  assert.doesNotThrow(() => t.api.commitSendSuccess(E));
  assert.equal(t.state.txHash, E);
  assert.ok(t.storage.has(SEND_PENDING_KEY));
});
await check("A10x TRIP_CLOSED setItem failing in finishTrip success does not throw into the caller (T3) and the verified clear already happened", () => {
  const t = build({ pendingRecord: pend() });
  t.storage.fx.throwSet.add("araso.tripClosed");
  assert.doesNotThrow(() => t.api.finishTrip(successTrip()));
  assert.equal(t.storage.has(SEND_PENDING_KEY), false);
  assert.equal(t.state.tripClosed, true);
  assert.equal(t.state.returnArrival, true);
});
await check("A1x writeSendPending is verified: a throwing or silently dropped write throws (so sendPiggyOnce stops); one transient failure is retried", () => {
  const t = build();
  t.storage.fx.throwSet.add(SEND_PENDING_KEY);
  assert.throws(() => t.api.writeSendPending({ stage: "deposit-sending", address: ADDR }));
  t.storage.fx.throwSet.clear();
  t.storage.fx.dropSet.add(SEND_PENDING_KEY);
  assert.throws(() => t.api.writeSendPending({ stage: "deposit-sending", address: ADDR }), /send_pending_unverified/);
  t.storage.fx.dropSet.clear();
  let n = 0;
  const orig = t.storage.setItem.bind(t.storage);
  t.storage.setItem = (k, v) => { if (k === SEND_PENDING_KEY && n++ === 0) throw new Error("transient"); orig(k, v); };
  t.api.writeSendPending({ stage: "deposit-broadcast", address: ADDR, depositTxHash: D });
  assert.equal(JSON.parse(t.storage.raw(SEND_PENDING_KEY)).depositTxHash, D);
});

// ═══ B. duplicate / re-entry / cross-tab ════════════════════════════════════════════════════
await check("B1 live settle success + a second resolution (reconcile watch / other path) -> exactly one receipt row, pending cleared once, second finish is a no-op on storage", () => {
  const t = build({ pendingRecord: pend() });
  t.api.commitSendSuccess(E);
  t.api.finishTrip(successTrip());
  assert.equal(storedRows(t.storage).length, 1);
  assert.equal(t.storage.has(SEND_PENDING_KEY), false);
  const removes = () => t.storage.log.filter((x) => x[0] === "remove" && x[1] === SEND_PENDING_KEY).length;
  assert.equal(removes(), 1);
  t.api.finishTrip(successTrip({ receipt: receipt({ at: 1800000000000 }) })); // same identity, later timestamp
  assert.equal(storedRows(t.storage).length, 1);
  assert.equal(removes(), 1, "no second clear");
});
await check("B2 two concurrent reconciles of the same record -> one row, pending cleared, second becomes a no-op", async () => {
  const t = build({ pendingRecord: pend(), sc: { dep: "success", red: "success" } });
  const p = t.api.readSendPending();
  await Promise.all([t.api.reconcileSendPending(p, { watch: false }), t.api.reconcileSendPending(p, { watch: false })]);
  await flush();
  assert.equal(storedRows(t.storage).length, 1);
  assert.equal(t.storage.has(SEND_PENDING_KEY), false);
  assert.equal(t.storage.log.filter((x) => x[0] === "remove" && x[1] === SEND_PENDING_KEY).length, 1);
  assert.deepEqual(t.calls.forbidden, []);
});
await check("B4 rememberReceipt with the identity already in STORAGE but not in this tab's memory -> no duplicate row, no loss (T5)", () => {
  const other = receipt({ redeemTxHash: F, txHash: F });
  const t = build({ receiptsRaw: JSON.stringify([encodeReceiptRow(receipt()), encodeReceiptRow(other)]) });
  const before = t.storage.raw(RECEIPTS_KEY);
  assert.equal(t.api.rememberReceipt(receipt({ at: 1900000000000 })), true);
  assert.equal(t.storage.raw(RECEIPTS_KEY), before, "storage not rewritten");
  assert.equal(t.state.receipts.length, 1, "memory shows it once");
});
await check("B5 stale tab (memory missing rows another tab wrote) saves a new receipt -> the other tab's rows survive (T5)", () => {
  const rowX = encodeReceiptRow(receipt({ redeemTxHash: F, txHash: F }));
  const t = build({ receiptsRaw: JSON.stringify([rowX]), memoryReceipts: [] });
  assert.equal(t.api.rememberReceipt(receipt()), true);
  const rows = storedRows(t.storage);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].redeemTxHash, E);
  assert.equal(rows[1].redeemTxHash, F);
});
await check("B6 compare-and-clear: a receipt for another tx never clears a different pending record; an absent record is fine; stage-mismatch / unreadable records stay", () => {
  const t = build({ pendingRecord: pend({ redeemTxHash: F }) });
  t.api.finishTrip(successTrip()); // receipt belongs to E, pending is F
  assert.equal(JSON.parse(t.storage.raw(SEND_PENDING_KEY)).redeemTxHash, F, "other record untouched");
  const t2 = build();
  assert.doesNotThrow(() => t2.api.finishTrip(successTrip()));
  assert.equal(t2.state.returnArrival, true);
  const t3 = build({ pendingRecord: pend({ stage: "redeem-sending", redeemTxHash: undefined }) });
  t3.api.finishTrip(successTrip());
  assert.equal(JSON.parse(t3.storage.raw(SEND_PENDING_KEY)).stage, "redeem-sending", "stage mismatch -> not cleared");
  const t4 = build({ pendingRecord: "{not json" });
  t4.api.finishTrip(successTrip());
  assert.equal(t4.storage.raw(SEND_PENDING_KEY), "{not json");
});
await check("B7 write order recorded on the fake store: receipts write -> receipts re-read -> pending removal -> trip flag", () => {
  const t = build({ pendingRecord: pend() });
  t.storage.log.length = 0;
  t.api.finishTrip(successTrip());
  const idx = (op, key, from = 0) => t.storage.log.findIndex((x, i) => i >= from && x[0] === op && x[1] === key);
  const iSet = idx("set", RECEIPTS_KEY);
  const iVerify = idx("get", RECEIPTS_KEY, iSet + 1);
  const iClear = idx("remove", SEND_PENDING_KEY);
  const iFlag = idx("set", "araso.tripClosed");
  assert.ok(iSet >= 0 && iSet < iVerify && iVerify < iClear && iClear < iFlag, JSON.stringify(t.storage.log));
});
await check("B8 failure outcomes unchanged: failed trip keeps pending, same 'couldn't finish' scene, no receipt row", () => {
  const t = build({ pendingRecord: pend() });
  t.api.finishTrip({ outcome: "failed", reason: "unconfirmed", receipt: null });
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.deepEqual(t.calls.scenes.at(-1), ["sendstay", "couldn't finish this one."]);
  assert.equal(t.state.tripClosed, false);
  assert.equal(t.storage.has(RECEIPTS_KEY), false);
});

// ═══ C. reload / reconcile (read-only on every legacy stage and surface) ═══════════════════════
const NO_SIGNER = (t) => assert.deepEqual(t.calls.forbidden, [], "zero grant / signer / prf / send calls");
await check("C-legacy every existing stage reconciles read-only with zero grant/sign/prf/send calls and the right line", async () => {
  const cases = [
    [{ stage: "deposit-sending", address: ADDR }, {}, "unknown"],
    [{ stage: "deposit-broadcast", address: ADDR, depositTxHash: D }, { dep: "null" }, "pending"],
    [{ stage: "deposit-broadcast", address: ADDR, depositTxHash: D }, { dep: "success" }, "pending"],
    [{ stage: "redeem-sending", address: ADDR, depositTxHash: D }, {}, "unknown"],
    [{ stage: "redeem-broadcast", address: ADDR, depositTxHash: D, redeemTxHash: E }, { dep: "success", red: "null" }, "pending"],
  ];
  for (const [rec, sc, line] of cases) {
    const t = build({ pendingRecord: rec, sc });
    await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
    await flush();
    assert.equal(t.state.awayRestore, line, `${rec.stage}`);
    assert.ok(t.storage.has(SEND_PENDING_KEY), "never cleared");
    NO_SIGNER(t);
  }
});
// [A-1487-c] record / knownTxs / retryHash: the same harness drives the refused-redeem retry (a redeem-broadcast · signed record).
function resumeHarness({ event = true, chainNonce = 8, locked = false, signer = true, record = null, knownTxs = [D], retryHash = E } = {}) {
  const pendingRecord = record || { stage: "deposit-broadcast", phase: "sent", address: ADDR, depositTxHash: D, nonce: 7, reservationId: "r1" };
  const t = build({ pendingRecord });
  const { ctx, state } = t;
  const calls = { sign: 0, send: 0, lock: 0, deposit: 0 };
  const amount = 10n ** 15n;
  const topic = "0x" + "1".repeat(64);
  const owner = "0x" + "0".repeat(24) + ADDR.slice(2).toLowerCase();
  const depositReceipt = { transactionHash: D, status: "success", from: ADDR, to: SHMON_ADDRESS,
    blockNumber: 100n, logs: event ? [{ address: SHMON_ADDRESS, topics: [topic, owner, owner], data: "0x01", removed: false }] : [] };
  ctx.SHMON_DEPOSIT_TOPIC0 = topic;
  ctx.SEND_AMOUNT = amount;
  ctx.MONAD_TESTNET = {};
  ctx.MONAD_TESTNET_RPC = "local-test";
  ctx.http = () => ({});
  ctx.decodeFunctionData = () => ({ functionName: "deposit", args: [amount, ADDR] });
  ctx.decodeAbiParameters = () => [amount, amount];
  ctx.makeRedeemTx = () => ({ to: SHMON_ADDRESS });
  ctx.createWalletClient = () => ({});
  ctx.settleSend = () => new Promise(() => {});
  ctx.navigator = { locks: { query: async () => ({}), request: async (_name, _options, fn) => { calls.lock += 1; return fn({}); } } };
  ctx.publicClient.getTransactionReceipt = async ({ hash }) => {
    if (hash === D) { calls.deposit += 1; return depositReceipt; }
    throw new TransactionReceiptNotFoundError({ hash });
  };
  ctx.publicClient.getTransaction = async ({ hash }) => {
    if (!knownTxs.includes(hash)) throw new TransactionNotFoundError({ hash });
    return { hash: D, from: ADDR, to: SHMON_ADDRESS, value: amount, input: "0x01", nonce: 7 };
  };
  ctx.publicClient.getTransactionCount = async () => chainNonce;
  ctx.publicClient.estimateGas = async () => 100000n;
  ctx.publicClient.getBalance = async () => 0n;
  ctx.publicClient.sendRawTransaction = async () => { calls.send += 1; return E; };
  ctx.signSendStep = async () => { calls.sign += 1; return { nonce: 8, hash: retryHash, raw: "0x01" }; };
  ctx.__testAccount = { address: ADDR };
  if (signer) vm.runInContext("activeSession = {}; activeAccount = __testAccount;", ctx);
  state.appLock = locked ? {} : null;
  return { ...t, calls, pendingRecord, knownTxs };
}
await check("C-resume verified deposit sends one redeem, keeps its hash until receipt, and never resends on a second reconcile", async () => {
  const t = resumeHarness();
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(t.calls.sign, 1);
  assert.equal(t.calls.send, 1);
  assert.equal(t.calls.lock, 1);
  assert.equal(t.calls.deposit > 0, true);
  assert.equal(JSON.parse(t.storage.raw(SEND_PENDING_KEY)).stage, "redeem-broadcast");
  assert.equal(JSON.parse(t.storage.raw(SEND_PENDING_KEY)).redeemTxHash, E);
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(t.calls.send, 1);
  assert.ok(t.storage.has(SEND_PENDING_KEY));
});
for (const [label, options] of [
  ["Deposit event missing", { event: false }],
  ["pending nonce mismatch", { chainNonce: 9 }],
  ["app locked", { locked: true }],
]) {
  await check(`C-resume-insufficient ${label}: no signature, no send, pending kept`, async () => {
    const t = resumeHarness(options);
    await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
    assert.equal(t.calls.sign, 0);
    assert.equal(t.calls.send, 0);
    assert.equal(t.storage.raw(SEND_PENDING_KEY), JSON.stringify(t.pendingRecord));
  });
}
// ═══ [A-1487-c] refused redeem (redeem-broadcast · phase signed = sendRaw never returned a hash) → the SAME resume path retries once with the
// same nonce after the strict deposit verification + three node facts (old hash unknown · no receipt · pending nonce == deposit nonce + 1).
// The old hash is never dropped: it moves to priorRedeemTxHashes, and a receipt that lands later on it still counts as the trip's success.
const REFUSED = { stage: "redeem-broadcast", phase: "signed", address: ADDR, depositTxHash: D, redeemTxHash: E, nonce: 8, reservationId: "r1" };
await check("C-retry refused redeem: old hash unknown to the node + no receipt + pending nonce == deposit+1 → one new redeem (same nonce), old hash kept in priorRedeemTxHashes, never twice", async () => {
  const t = resumeHarness({ record: REFUSED, knownTxs: [D], retryHash: F });
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(t.calls.sign, 1);
  assert.equal(t.calls.send, 1);
  const rec = JSON.parse(t.storage.raw(SEND_PENDING_KEY));
  assert.deepEqual([rec.stage, rec.redeemTxHash, rec.nonce, rec.depositTxHash, rec.priorRedeemTxHashes], ["redeem-broadcast", F, 8, D, [E]]);
  t.knownTxs.push(F); // the node now knows the retry
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(t.calls.send, 1, "never twice");
  assert.deepEqual(JSON.parse(t.storage.raw(SEND_PENDING_KEY)).priorRedeemTxHashes, [E], "old hash never dropped");
});
for (const [label, options] of [
  ["old redeem known to the node", { knownTxs: [D, E] }],
  ["pending nonce already taken", { chainNonce: 9 }],
  ["phase sent (sendRaw returned a hash)", { record: { ...REFUSED, phase: "sent" } }],
  ["app locked", { locked: true }],
  ["Deposit event missing", { event: false }],
]) {
  await check(`C-retry-uncertain ${label}: no signature, no send, record byte-identical`, async () => {
    const t = resumeHarness({ record: REFUSED, retryHash: F, ...options });
    await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
    assert.equal(t.calls.sign + t.calls.send, 0);
    assert.equal(t.storage.raw(SEND_PENDING_KEY), JSON.stringify(t.pendingRecord));
  });
}
await check("C-retry-same-hash: pinned fees sign the same bytes → the retry IS the old hash; one send, slot keeps it, no prior entry", async () => {
  const t = resumeHarness({ record: REFUSED, knownTxs: [D], retryHash: E });
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(t.calls.send, 1);
  const rec = JSON.parse(t.storage.raw(SEND_PENDING_KEY));
  assert.deepEqual([rec.redeemTxHash, rec.nonce, rec.priorRedeemTxHashes], [E, 8, undefined]);
});
await check("C-prior-landed: a receipt arriving later for the OLD redeem hash counts as success (txHash = that hash · record cleared by finishTrip · zero signer)", async () => {
  const t = build({ pendingRecord: { ...REFUSED, phase: "sent", redeemTxHash: F, priorRedeemTxHashes: [E] }, sc: { dep: "success", red: "success" } });
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  await flush();
  assert.equal(t.state.txHash, E);
  assert.equal(t.storage.has(SEND_PENDING_KEY), false, "cleared by finishTrip after the verified receipt");
  NO_SIGNER(t);
});
await check("C9 desktop (no app-lock surface) with a pending record: the boot R4 block moves to Away(checking) and reconciles read-only; on the lock surface it does nothing (the existing lock block owns that)", () => {
  const block = cut("// [A-699 M2-alpha R4]", "// [A-633 A/C]");
  assert.ok(block.includes("!appLockSurface()") && block.includes("LEGACY_TESTNET_PATH"));
  for (const [lockSurface, expectRun] of [[false, true], [true, false]]) {
    const reconcileCalls = [];
    const state = { credential: { id: "c" }, scene: "sendstay", homeQuietForExplore: true, awayRestore: null };
    const storage = makeStorage({ [SEND_PENDING_KEY]: JSON.stringify(pend()) });
    vm.runInNewContext(block, {
      state, LEGACY_TESTNET_PATH: true, appLockSurface: () => lockSurface, readSendPending: () => JSON.parse(storage.raw(SEND_PENDING_KEY)),
      reconcileSendPending: (p) => reconcileCalls.push(p),
    });
    assert.equal(reconcileCalls.length, expectRun ? 1 : 0);
    assert.equal(state.scene, expectRun ? "away" : "sendstay");
    assert.equal(state.awayRestore, expectRun ? "checking" : null);
  }
  const state = { credential: { id: "c" }, scene: "sendstay", homeQuietForExplore: true, awayRestore: null };
  vm.runInNewContext(block, { state, LEGACY_TESTNET_PATH: true, appLockSurface: () => false, readSendPending: () => null, reconcileSendPending: () => { throw new Error("must not run"); } });
  assert.equal(state.scene, "sendstay", "no pending -> nothing changes even on desktop");
  assert.equal(/sendTransaction|signDigest|requestGrant|requestPrf|recoverPiggy|appLock\s*=/.test(block.replace(/\/\/.*$/gm, "")), false, "read-only by construction");
});
await check("C9b the existing lock-surface boot block is untouched (alpha added a separate block before it, did not edit it)", () => {
  const b = cut("// [A-633 A/C] 모바일/app 표면에서 저장된 credential", "// [A-559 PHASE S1] Gift 링크 fragment");
  assert.ok(b.includes('const bootPending = state.scene === "sendstay" && LEGACY_TESTNET_PATH ? readSendPending() : null;'));
  assert.equal(b.includes("A-699"), false);
});
await check("C10 legacy hash-less shapes -> unknown, lock kept, nothing cleared, zero chain reads", async () => {
  for (const rec of [{ stage: "deposit-sending", address: ADDR }, { stage: "redeem-sending", address: ADDR, depositTxHash: D }, "{not json", { stage: "deposit-broadcast", address: ADDR }]) {
    const t = build({ pendingRecord: rec });
    const r = await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
    assert.equal(r.kind, "unknown");
    assert.equal(t.calls.reads.length, 0);
    assert.ok(t.storage.has(SEND_PENDING_KEY));
    NO_SIGNER(t);
  }
});

// ═══ F. receipt build / save failure, end to end through the real reconcile ═══════════════════
await check("F1 live success with NO receipt (balance-unavailable): no fabricated receipt, no partial row, pending kept (nothing durable to clear against), existing 'catching up' copy", () => {
  const t = build({ pendingRecord: pend() });
  t.api.commitSendSuccess(E);
  t.api.finishTrip({ outcome: "done", reason: "balance-unavailable", receipt: null });
  assert.equal(t.storage.has(RECEIPTS_KEY), false);
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.equal(catchingUp(t.calls), true);
  assert.equal(t.state.tripOutcome, "done");
  assert.equal(t.state.returnArrival, false);
  assert.equal(neverFailedCopy(t.calls), true);
});
await check("F2 reconcile success but historic reads unsupported -> receipt null -> no row, pending kept, no invented number (UNKNOWN U3)", async () => {
  const t = build({ pendingRecord: pend(), sc: { dep: "success", red: "success", histFail: true } });
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  await flush();
  assert.equal(t.storage.has(RECEIPTS_KEY), false);
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.equal(catchingUp(t.calls), true);
  assert.equal(t.state.txHash, E, "the confirmed redeem hash is still recorded (araso.txHash)");
  NO_SIGNER(t);
});
await check("F3 success + receipt save failure (done_unsaved) -> reload: reconcile re-derives the receipt from chain facts, saves, verifies, then clears", async () => {
  const storage = makeStorage({ [SEND_PENDING_KEY]: JSON.stringify(pend()) });
  storage.fx.throwSet.add(RECEIPTS_KEY);
  const t1 = build({ storage });
  t1.api.commitSendSuccess(E);
  t1.api.finishTrip(successTrip());
  assert.ok(storage.has(SEND_PENDING_KEY) && !storage.has(RECEIPTS_KEY));
  storage.fx.throwSet.clear(); // "reload": new context over the same storage, failure gone
  const t2 = build({ storage, sc: { dep: "success", red: "success" } });
  await t2.api.reconcileSendPending(t2.api.readSendPending(), { watch: false });
  await flush();
  const rows = storedRows(storage);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].redeemTxHash, E);
  assert.equal(rows[0].shmonReceived, String(990n * 10n ** 12n), "numbers come from chain reads only");
  assert.equal(storage.has(SEND_PENDING_KEY), false);
  assert.equal(t2.state.returnArrival, true);
  NO_SIGNER(t2);
});
await check("F4 reconcile success with a healthy store: row saved + verified, then pending cleared, then the existing return scene", async () => {
  const t = build({ pendingRecord: pend(), sc: { dep: "success", red: "success" } });
  t.storage.log.length = 0;
  await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  await flush();
  assert.equal(storedRows(t.storage).length, 1);
  assert.equal(t.storage.has(SEND_PENDING_KEY), false);
  assert.deepEqual(t.calls.scenes.at(-1), ["return", "Piggy is home.", "One tag."]);
  const iSet = t.storage.log.findIndex((x) => x[0] === "set" && x[1] === RECEIPTS_KEY);
  const iClear = t.storage.log.findIndex((x) => x[0] === "remove" && x[1] === SEND_PENDING_KEY);
  assert.ok(iSet >= 0 && iSet < iClear);
});

// ═══ G. unknown RPC ═════════════════════════════════════════════════════════════════════════
await check("G1 getTransactionReceipt throws a non-NotFound error -> unknown, nothing cleared, no rebroadcast", async () => {
  const t = build({ pendingRecord: pend(), sc: { dep: "error", red: "error" } });
  const r = await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(r.kind, "unknown");
  assert.equal(t.state.awayRestore, "unknown");
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.equal(t.storage.has(RECEIPTS_KEY), false);
  NO_SIGNER(t);
});
await check("G2 receipt from/to mismatch -> unknown (never trusted as success)", async () => {
  const t = build({ pendingRecord: pend(), sc: { dep: "mismatch", red: "mismatch" } });
  const r = await t.api.reconcileSendPending(t.api.readSendPending(), { watch: false });
  assert.equal(r.kind, "unknown");
  assert.ok(t.storage.has(SEND_PENDING_KEY));
  assert.equal(t.storage.has(RECEIPTS_KEY), false);
});

// ═══ flow: real sendPiggy + sendPiggyOnce + real finishTrip / rememberReceipt ═══════════════════
const HASH_DEPOSIT = keccak256("0xa0");
const HASH_REDEEM = keccak256("0xa1");
function makeFlow({ storage = makeStorage(), settleOutcome = "done", depositThrows = false, simThrows = false } = {}) {
  const calls = { grant: 0, sign: 0, sendTx: 0, prepared: 0, scenes: [] };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const state = { address: "0xabc", txHash: "", mark: "", grantTxHash: "", receipts: [], receiptIndex: 0, tripClosed: false, tripOutcome: "", tripReason: "" };
  // [A-707 M2-beta] harness wiring: sign-before-send (fake account signs "0xa<nonce>"; the fake node returns keccak256(raw)) + fake Web Locks.
  const held = new Map();
  const navigatorStub = {
    locks: {
      async request(name, opts, cb) {
        if (held.has(name)) return opts.ifAvailable ? cb(null) : new Promise(() => {});
        held.set(name, true);
        try { return await cb({ name, mode: "exclusive" }); } finally { held.delete(name); }
      },
      async query() { return { held: [...held.keys()].map((name) => ({ name })), pending: [] }; },
    },
  };
  const env = {
    localStorage: storage, state,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    isAllowedPiggyRpId: () => true,
    signerSince: Date.now(), // [A-896 harness wiring] live signer stamped now (wall clock) so sendPiggyOnce's 60 s margin check sees a fresh signer
    activeAccount: { address: "0xabc", signTransaction: async (prepared) => `0xa${prepared.nonce}` },
    navigator: navigatorStub, keccak256,
    activeSession: { signDigest: async () => { calls.sign += 1; return { compact: new Uint8Array([1]), recovery: 0 }; } },
    setScene: (...a) => { calls.scenes.push(a); btn.disabled = true; btn.attrs["aria-disabled"] = "true"; /* a rendered scene starts locked; syncSendButton frees it */ },
    recoverPiggy: async () => {}, noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    requestGrant: async () => { calls.grant += 1; return { txHash: "0xgrant" }; },
    simulateSend: async () => { if (simThrows) throw new Error("sim reverted"); return { depositTx: {}, before: 1n, beforeShares: 0n }; },
    touchAppSession() {},
    // [A-768 M-C-1/M-L-1 harness wiring] the fake prepare returns a well-formed Monad-testnet eip1559 request (the pre-sign guard now checks it),
    // the REAL preparedSignProblem is injected, and the fake node answers the deposit-block nonce read (deposit nonce + 1).
    createWalletClient: () => ({ prepareTransactionRequest: async () => ({ type: "eip1559", chainId: 10143, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: calls.prepared++ }) }),
    preparedSignProblem,
    MONAD_TESTNET: {}, MONAD_TESTNET_RPC: "", http: () => ({}),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) }, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) }, TextEncoder, toHex: () => "00",
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n }),
    readShmonBalance: async () => 5n, makeRedeemTx: () => ({}),
    publicClient: { estimateGas: async () => 1n, getTransactionCount: async () => calls.prepared, sendRawTransaction: async ({ serializedTransaction }) => { calls.sendTx += 1; if (depositThrows && calls.sendTx === 1) throw new Error("rpc"); return keccak256(serializedTransaction); } },
    settleSend: async () => (settleOutcome === "done"
      ? { outcome: "done", reason: "ok", receipt: receipt({ txHash: HASH_REDEEM, redeemTxHash: HASH_REDEEM, depositTxHash: HASH_DEPOSIT }) }
      : { outcome: "failed", reason: "redeem-unconfirmed-or-reverted", receipt: null }),
    formatError: (e) => String(e), recordSafeError: () => {}, waitForGrantBalance: async () => true, endActiveSession() {},
    setTimeout: () => 0,
    decodeReceiptRow, encodeReceiptRow, codecReceiptIdentityKey, RECEIPT_KIND, LEGACY_TESTNET_PATH: true,
    authAttempt: null, platformAuthInflight: null,
  };
  const names = Object.keys(env);
  const body = `${CONSTS.join("\n")}\n${RECEIPT_FNS_SRC}\n${PENDING_SRC}\n${FINISH_SRC}\n${ONCE_SRC}\nreturn { sendPiggy, readSendPending, sendBusy, holdSendTabLock, isInFlight: () => sendInFlight };`;
  const factory = new Function(...names, body);
  const made = factory(...names.map((n) => env[n]));
  made.holdSendTabLock(); // boot step: tab lifetime lock (the fake locks grant it synchronously)
  return { ...made, calls, btn, state, storage };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
await check("FLOW-1 live success end to end: receipt stored + verified, pending cleared AFTER it, lock released, Send enabled (replaces the old stub-level 'pending cleared')", async () => {
  const storage = makeStorage();
  const t = makeFlow({ storage });
  await t.sendPiggy(); await tick(); await tick(); await tick();
  assert.equal(storedRows(storage).length, 1);
  assert.equal(storedRows(storage)[0].redeemTxHash, HASH_REDEEM);
  assert.equal(storage.has(SEND_PENDING_KEY), false);
  assert.equal(storage.raw("araso.txHash"), HASH_REDEEM);
  assert.equal(t.isInFlight(), false);
  assert.equal(t.btn.disabled, false);
  const iSet = storage.log.findIndex((x) => x[0] === "set" && x[1] === RECEIPTS_KEY);
  const iClear = storage.log.findIndex((x) => x[0] === "remove" && x[1] === SEND_PENDING_KEY);
  assert.ok(iSet >= 0 && iSet < iClear, "receipt written before the pending clear");
});
await check("FLOW-2 live success but the receipt store is down: money moved, pending kept, Send locked, NOT reported as failed, second tap starts nothing", async () => {
  const storage = makeStorage();
  storage.fx.throwSet.add(RECEIPTS_KEY);
  const t = makeFlow({ storage });
  await t.sendPiggy(); await tick(); await tick(); await tick();
  assert.equal(t.calls.sendTx, 2);
  assert.ok(storage.has(SEND_PENDING_KEY));
  assert.equal(JSON.parse(storage.raw(SEND_PENDING_KEY)).stage, "redeem-broadcast");
  assert.equal(t.calls.scenes.some((s) => s[1] === "couldn't finish this one."), false);
  assert.equal(t.isInFlight(), false);
  assert.equal(t.btn.disabled, true);
  const before = `${t.calls.grant}/${t.calls.sign}/${t.calls.sendTx}`;
  await t.sendPiggy(); await tick();
  assert.equal(`${t.calls.grant}/${t.calls.sign}/${t.calls.sendTx}`, before);
  assert.equal(t.calls.scenes.at(-1)[2], "Confirmation is still catching up.");
});
await check("FLOW-3 A4 end to end: unreadable pending store -> Send starts nothing (no grant / sign / send)", async () => {
  const storage = makeStorage();
  storage.fx.throwGet.add(SEND_PENDING_KEY);
  const t = makeFlow({ storage });
  await t.sendPiggy(); await tick();
  assert.equal(`${t.calls.grant}/${t.calls.sign}/${t.calls.sendTx}`, "0/0/0");
  assert.equal(t.calls.scenes.at(-1)[2], "Confirmation is still catching up.");
});
await check("FLOW-4 A1x end to end: the pre-money (reservation) write is dropped by the store -> nothing is sent", async () => {
  const storage = makeStorage();
  storage.fx.dropSet.add(SEND_PENDING_KEY);
  const t = makeFlow({ storage });
  await t.sendPiggy(); await tick();
  assert.equal(t.calls.sendTx, 0);
  assert.equal(t.isInFlight(), false);
});
await check("FLOW-5 A2/A3 [A-707 M2-beta]: the signed-record write failing -> 0 broadcast; the post-broadcast phase write failing -> flow continues (hash already durable)", async () => {
  // (a) the signed deposit record cannot be written: sign happened, persist failed -> broadcast never called, reservation released, Send usable.
  const s1 = makeStorage();
  const orig1 = s1.setItem.bind(s1);
  s1.setItem = (k, v) => { if (k === SEND_PENDING_KEY && JSON.parse(v).phase === "signed") throw new Error("quota"); orig1(k, v); };
  const t1 = makeFlow({ storage: s1 });
  await t1.sendPiggy(); await tick();
  assert.equal(t1.calls.sendTx, 0, "sendRawTransaction never called");
  assert.equal(s1.has(SEND_PENDING_KEY), false, "reservation released: nothing moved");
  assert.equal(t1.sendBusy(), false);
  assert.equal(t1.isInFlight(), false);
  // (b) the phase-sent write fails after each broadcast: best-effort, the signed record already carries the identity -> the run completes.
  const s2 = makeStorage();
  const orig2 = s2.setItem.bind(s2);
  s2.setItem = (k, v) => { if (k === SEND_PENDING_KEY && JSON.parse(v).phase === "sent") throw new Error("quota"); orig2(k, v); };
  const t2 = makeFlow({ storage: s2 });
  await t2.sendPiggy(); await tick(); await tick(); await tick();
  assert.equal(t2.calls.sendTx, 2, "deposit and redeem both broadcast once");
  assert.equal(storedRows(s2).length, 1, "receipt saved");
  assert.equal(s2.has(SEND_PENDING_KEY), false, "pending cleared after the verified receipt");
});
await check("FLOW-6 failed settle: unchanged contract (pending kept at redeem-broadcast, no receipt, no txHash)", async () => {
  const storage = makeStorage();
  const t = makeFlow({ storage, settleOutcome: "failed" });
  await t.sendPiggy(); await tick(); await tick(); await tick();
  assert.equal(JSON.parse(storage.raw(SEND_PENDING_KEY)).stage, "redeem-broadcast");
  assert.equal(storage.has(RECEIPTS_KEY), false);
  assert.equal(storage.raw("araso.txHash"), null);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
