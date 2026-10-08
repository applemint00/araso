// [A-887] Deferred main-runtime non-design wiring:
//   · First receipt-evidence sidecar in main.js (A-878 mapper · A-866 reader · A-868 store), observation only, default none;
//   · Gift gas delivery through the injected A-884 /gift-gas client (gift-claim-entry createGiftGasClientDelivery +
//     the main.js composition), no /grant fallback, server states mapped into the existing fail-closed Gift flow.
//   node app/test/a887-main-nondesign-wiring.mjs
// Network 0 · tx 0 · key 0 · RPC 0 (every rpc/fetch/chain is an in-memory fake; the Gift bridge drives the real A-874
// route handler in-process with fake req/res, no port). UI/copy/layout: static checks only (no render change).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import {
  GIFT_CLAIM_SUBMIT_STATUS as S,
  GIFT_GAS_CLIENT_DELIVERY_REFUSAL as DR,
  bindGiftToNewPiggy,
  createGiftClaimSubmitter,
  classifyGiftGasOutcome,
  createGiftGasClientDelivery,
  isGiftGasClientDelivery,
} from "../src/gift-claim-entry.js";
import { GIFT_GAS_CLIENT_OUTCOME as O, GIFT_GAS_TRANSPORT, createGiftGasClient } from "../src/gift-gas-client.js";
import { CLAIM_STATUS, attachGiftValue, createClaimLink, sealClaimLink } from "../src/gift-piggy-claim-link.js";
import { buildGiftValueBinding } from "../src/gift-value-spec.js";
import { createGiftGasLedger, createMemoryGiftGasStore } from "../src/gift-gas-ledger.js";
import { mapFirstEvidence } from "../src/receipt-evidence-first.js";
import { readTxEvidence } from "../src/receipt-evidence-reader.js";
import { createEvidenceStore, evidenceStoreKey } from "../src/receipt-evidence-store.js";
import { RECEIPT_KIND } from "../src/receipt-codec.js";
import { createGiftGasRoute } from "../../relayer/src/server.mjs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const ENTRY = readFileSync(new URL("../src/gift-claim-entry.js", import.meta.url), "utf8");
let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const lower = (a) => String(a || "").toLowerCase();
const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
function between(src, start, end) {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const j = src.indexOf(end, i);
  assert.ok(j > i, `missing ${end}`);
  return src.slice(i, j);
}
const GIFT_BLOCK = between(MAIN, "// ── [A-887] Gift gas client wiring", "// ── [A-887] end Gift gas client wiring");
const FIRST_BLOCK = between(MAIN, "// ── [A-887] First receipt-evidence sidecar", "// ── [A-887] end First receipt-evidence sidecar");
const IMPORT_BLOCK = between(MAIN, "// ── [A-887] non-design runtime wiring imports", "// ── [A-887] end imports");
const ENTRY_BLOCK = ENTRY.slice(ENTRY.indexOf("// ── [A-887] Gift gas delivery through the injected"));
const TRIGGER_LINE = '  if (typeof a887ObserveFirstEvidence === "function") a887ObserveFirstEvidence("broadcast"); // [A-887] observation only; default none';

// Function text by name (keyword through matching brace) — the same cut a845/a642 use.
function fnText(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  let d = 0;
  let st = false;
  for (let j = src.indexOf("{", m.index); j < src.length; j += 1) {
    if (src[j] === "{") { d += 1; st = true; } else if (src[j] === "}") { d -= 1; if (st && d === 0) return src.slice(m.index, j + 1); }
  }
  return null;
}

// ═══ N. design / protected invariance (static) ═══════════════════════════════════════════════════════════════════
// Protected hash-pinned main.js bodies (receipts/PROTECTED_PINS_MAP_20261007.md) + the First money/auth path.
const PROTECTED = ["render", "sendPiggyOnce", "sendPiggy", "requestPrf", "touchAppSession", "reconcileSendPending", "classifySendPending",
  "reconciledSendReceipt", "commitSendSuccess", "finishTrip", "readSendPending", "firstTripClosedShared", "reserveSend", "promoteSendReservation",
  "activateSigningSession", "appLockSurface", "arasoBrandMarkup", "awayRestoreLineMarkup", "beginAddPiggy", "chogHomeMarkupForAway",
  "confirmSendReservation", "endActiveSession", "firstSendAmountSecondary", "lockAppAfterIdle", "loginCheckingMarkup", "mountInviteChog",
  "readSendTxReceipt", "renderAuthCard", "sentRowValue", "settleUnlock", "showAwayRestore", "stayHome", "unlockApp",
  // First write/settle path and the Gift claim call site (not pinned, but A-887 must not edit them)
  "writeSendPending", "writeOwnedSendPending", "markSendPhaseSent", "rememberReceipt", "settleSend", "settleBoundGiftClaim", "returnLayout", "renderReturn"];

await check("N1 protected / money / auth / render bodies carry no A-887 code; the only A-887 line outside the delimited blocks is the waitForSuccess trigger", () => {
  for (const name of PROTECTED) {
    const t = fnText(MAIN, name);
    if (t === null) continue; // a name that only exists in another module
    assert.equal(/a887|A-887|FIRST_EVIDENCE|GIFT_GAS_CLIENT/.test(t), false, `${name} touched by A-887`);
  }
  let rest = MAIN.replace(GIFT_BLOCK, "").replace(FIRST_BLOCK, "").replace(IMPORT_BLOCK, "");
  const hits = rest.split("\n").filter((l) => /a887|A-887/.test(l));
  // the three delimiter "end" lines + the one trigger line
  assert.deepEqual(hits.filter((l) => !/^\/\/ ── \[A-887\] end /.test(l)), [TRIGGER_LINE]);
  const w = fnText(MAIN, "waitForSuccess");
  assert.ok(w.startsWith(`async function waitForSuccess(hash) {\n${TRIGGER_LINE}\n  let receipt;`), "trigger is the first statement, nothing else changed");
});

await check("N2 strict delta vs the pre-A-887 copy (when present): MAIN minus the A-887 blocks and trigger line == pre copy", () => {
  const pre = new URL("../../_private/ops/receipts/A887_main_nondesign_wiring/pre/main.js", import.meta.url);
  if (!existsSync(pre)) { console.log("      (pre copy absent: skipped, recorded in RECEIPT)"); return; }
  const PRE = readFileSync(pre, "utf8");
  const stripped = MAIN.replace(`${IMPORT_BLOCK}// ── [A-887] end imports ──\n`, "")
    .replace(/\/\/ ── \[A-887\] Gift gas client wiring[\s\S]*?\/\/ ── \[A-887\] end Gift gas client wiring[^\n]*\n\n/, "")
    .replace(/\/\/ ── \[A-887\] First receipt-evidence sidecar[\s\S]*?\/\/ ── \[A-887\] end First receipt-evidence sidecar[^\n]*\n\n/, "")
    .replace(`${TRIGGER_LINE}\n`, "");
  if (crypto.createHash("sha256").update(PRE).digest("hex") !== "da6ff5c711e97da825705ebc8d16200a8dce96625009702e805e58c1cda5f2aa"
    || stripped !== PRE) {
    // after the 3-way merge the base moves (A-891/A-893): then only N1 applies (recorded, not silently passed)
    console.log("      (merged tree: base moved — strict delta not applicable here; N1 still enforces the region boundary)");
    return;
  }
  assert.equal(stripped, PRE);
});

await check("N3 product defaults are null literals; the pinned Gift submitter lines are verbatim; no new UI/copy", () => {
  assert.match(MAIN, /^const GIFT_GAS_CLIENT_CONFIG = null;/m);
  assert.match(MAIN, /^const FIRST_EVIDENCE_SIDECAR = null;/m);
  assert.match(MAIN, /^const GIFT_CLAIM_SUBMIT_CONFIG = null;/m);
  assert.ok(MAIN.includes("const GIFT_CLAIM_SUBMITTER = GIFT_CLAIM_SUBMIT_CONFIG && GIFT_RECORD_CONFIG\n  ? createGiftClaimSubmitter(GIFT_CLAIM_SUBMIT_CONFIG)\n  : null;"));
  assert.equal((code(MAIN).match(/GIFT_GAS_CLIENT_CONFIG\s*=(?!=)/g) || []).length, 1);
  assert.equal((code(MAIN).match(/FIRST_EVIDENCE_SIDECAR\s*=(?!=)/g) || []).length, 1);
  for (const block of [GIFT_BLOCK, FIRST_BLOCK, IMPORT_BLOCK]) {
    const c = code(block);
    // no markup, no scene, no DOM, no style, no user-facing string
    assert.equal(/innerHTML|insertAdjacentHTML|document\.|querySelector|classList|\.style\b|setScene\(|render\(|<[a-z]+[\s>]|aria-|textContent/.test(c), false);
  }
  assert.equal(/innerHTML|document\.|querySelector|setScene|render\(/.test(code(ENTRY_BLOCK)), false);
  // [A-895 P-D] A-887 REVIEW I1/I2/I4/R1-comment. pre-A-895 baseline: none of these were asserted (the read had no deadline, the sweep bound was `>`).
  const fc = code(FIRST_BLOCK);
  assert.match(fc, /const A887_FIRST_READ_TIMEOUT_MS = \d+;/, "I1 per-read deadline constant");
  const readFn = fnText(FIRST_BLOCK, "a887ReadFirstEvidence");
  assert.ok(readFn && /Promise\.race\(/.test(code(readFn)) && /A887_FIRST_READ_TIMEOUT_MS/.test(code(readFn)) && /clearTimeout\(/.test(code(readFn)), "I1 each read is raced against the deadline and the timer cleared");
  assert.ok(/finally\s*\{\s*a887FirstReadBusy = false;/.test(code(readFn)), "I1 busy flag still released in finally");
  assert.match(fc, /records\.length >= A887_FIRST_RECEIPT_SWEEP_MAX\) break;/, "I2 bound: at most MAX records in total");
  assert.equal(/records\.length > A887_FIRST_RECEIPT_SWEEP_MAX/.test(fc), false);
  assert.equal(/after the boot reconcile/.test(FIRST_BLOCK.replace(/pre-A-895 text said it runs "after the boot reconcile"/, "")), false, "I4 comment no longer claims the sweep runs after the reconcile");
  // R1 comment (A-895 P-B REVIEW F7): the GIFT_CLAIM_SUBMIT_CONFIG example no longer shows a hand-written gasDelivery key
  const exLine = MAIN.split("\n").find((l) => l.startsWith("const GIFT_CLAIM_SUBMIT_CONFIG = null;"));
  assert.ok(exLine && /createGiftGasClientDelivery\(GIFT_GAS_CLIENT\)/.test(exLine) && !/\{ chain, gasDelivery,/.test(exLine), "example comment names the branded helper");
});

await check("N4 no execution authority in any A-887 block: no permission/lock/send/sign/storage-write/app-state write, no /grant", () => {
  const forbidden = /issuePermission|\bauthorize\(|\bconsume\(|permissionNonce|cancelPermission|sendInFlight|sendReservation|writeSendPending|writeOwnedSendPending|markSendPhaseSent|commitSendSuccess|finishTrip|reconcileSendPending|removeItem|localStorage|sessionStorage|indexedDB|sendTransaction|signTransaction|sendRawTransaction|signMessage|requestPrf|navigator\.credentials|walletClient|\/grant\b|requestGrant|RELAYER_URL|state\.[A-Za-z_$]+(\.[A-Za-z_$]+)*\s*=(?!=)|console\./;
  for (const [name, block] of [["gift", GIFT_BLOCK], ["first", FIRST_BLOCK], ["imports", IMPORT_BLOCK], ["entry", ENTRY_BLOCK]]) {
    const m = code(block).match(forbidden);
    assert.equal(m, null, `${name}: ${m && m[0]}`);
  }
  // the First sidecar only ever READS the First record (readSendPending) and in-memory receipts
  assert.match(code(FIRST_BLOCK), /readSendPending\(\)/);
  assert.match(code(FIRST_BLOCK), /state\.receipts/);
  // the Gift entry adapter talks only to the injected client: one request call, no fetch, no other route
  assert.equal((code(ENTRY_BLOCK).match(/request\.call\(/g) || []).length, 1);
  assert.equal(/\bfetch\b|https?:\/\/|\/gift-gas/.test(code(ENTRY_BLOCK)), false);
  // the only fetch in the Gift main block is the injected native fetch handed to the client (same-origin transport)
  assert.match(code(GIFT_BLOCK), /transport: GIFT_GAS_TRANSPORT\.SAME_ORIGIN/);
  assert.equal(/GIFT_GAS_TRANSPORT\.HTTPS/.test(code(GIFT_BLOCK)), false);
});

// ═══ G. Gift: createGiftGasClientDelivery mapping ═══════════════════════════════════════════════════════════════
const GID = "0x" + "ab".repeat(32);
const TO = "0x" + "AbCdEf0123".repeat(4);
const TX = "0x" + "12".repeat(32);
const okOut = (outcome, state, extra = {}) => Object.freeze({
  authority: "observation_only", localDelivery: false, ok: true, outcome, state, settled: state === "CONFIRMED", reachedServer: "yes",
  httpStatus: 200, giftId: GID, to: lower(TO), valueWei: "1", txHash: TX, ...extra,
});
const refusedOut = (outcome, reachedServer = "yes", extra = {}) => Object.freeze({ authority: "observation_only", localDelivery: false, ok: false, outcome, settled: false, reachedServer, ...extra });
// [A-895 P-B F1] the adapter accepts only clients made by createGiftGasClient(): this is a REAL client over a fake fetch.
// `reply(body)` returns { status, body } (a JSON object or raw string); `calls` records the parsed request bodies.
function fakeClient(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    const input = JSON.parse(init.body);
    calls.push(input);
    const r = typeof reply === "function" ? await reply(input) : reply;
    return { status: r.status, url, redirected: false, type: "basic", headers: { get: () => "application/json" }, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
  return { calls, client: createGiftGasClient({ fetch, transport: GIFT_GAS_TRANSPORT.HTTPS, endpoint: "https://relay.example/gift-gas" }) };
}
const okRecord = (state, extra = {}) => ({ status: 200, body: { ok: true, state, giftId: GID, to: lower(TO), valueWei: "1", txHash: TX, ...extra } });

await check("G1 createGiftGasClientDelivery: only a well-formed, configured client yields a (registered, frozen) delivery", () => {
  for (const bad of [null, undefined, 1, "x", {}, { request: 1 }, { configError: "no_fetch", request() {} },
    // [A-895 P-B F1] a hand-written client with the right shape is refused: it is not branded by createGiftGasClient()
    { configError: null, request: async () => ({}) }, Object.freeze({ configError: null, request: async () => ({}) }), { request() {} },
    Object.create(createGiftGasClient({ fetch: async () => {}, transport: GIFT_GAS_TRANSPORT.HTTPS, endpoint: "https://relay.example/gift-gas" })),
    new Proxy(createGiftGasClient({ fetch: async () => {}, transport: GIFT_GAS_TRANSPORT.HTTPS, endpoint: "https://relay.example/gift-gas" }), {}),
    Object.defineProperty({}, "request", { get: () => () => {} })]) {
    assert.equal(createGiftGasClientDelivery(bad), null);
  }
  const d = createGiftGasClientDelivery(fakeClient(okRecord("SENT")).client);
  assert.ok(Object.isFrozen(d));
  assert.equal(isGiftGasClientDelivery(d), true);
  assert.equal(isGiftGasClientDelivery({ ...d }), false);
  assert.equal(isGiftGasClientDelivery({ deliver: d.deliver }), false);
  // a real A-884 client without fetch is invalid_config => no delivery
  assert.equal(createGiftGasClientDelivery(createGiftGasClient({ transport: "same-origin", endpoint: "/gift-gas", pageOrigin: "https://arasoo.vercel.app" })), null);
});

await check("G2 deliver(): request is exactly {giftId(lower), to(lower)}; only SENT/CONFIRMED + exact echo + tx + valid echoed valueWei => { txHash, valueWei }", async () => {
  for (const state of ["SENT", "CONFIRMED"]) {
    const f = fakeClient(okRecord(state));
    const r = await createGiftGasClientDelivery(f.client).deliver(Object.freeze({ allowanceRef: GID.toUpperCase().replace("0X", "0x"), to: TO, valueWei: 5n }));
    // pre-A-895 baseline: { txHash: TX } only. A-895 P-B: the validated server-echoed valueWei (bigint) travels with it.
    assert.deepEqual({ ...r }, { txHash: TX, valueWei: 1n });
    assert.ok(Object.isFrozen(r));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(Object.keys(f.calls[0]).sort(), ["giftId", "to"]);
    assert.deepEqual(f.calls[0], { giftId: GID, to: lower(TO) });
  }
});

await check("G3 every other server/client state => deliver() throws a fixed code (=> existing GAS_DELIVERY_FAILED path); 1 request max", async () => {
  const cases = [
    okOut("pending", "PENDING", { txHash: null }), { ...okOut("unknown", "UNKNOWN", { txHash: null }), ok: false },
    refusedOut(O.NOT_AVAILABLE, "yes", { httpStatus: 409 }), refusedOut(O.UNAVAILABLE, "yes", { httpStatus: 503 }),
    // [A-895 P-B] the definite pre-action refusals (400/401/403/404/405/408/413/415, 503 unavailable_not_sent) are asserted in G8 as NOT_SENT;
    // pre-A-895 baseline listed them here as NOT_DELIVERED. Forged pairings of them stay NOT_DELIVERED:
    refusedOut(O.BAD_REQUEST, "yes", { httpStatus: 503 }), refusedOut(O.UNAVAILABLE_NOT_SENT, "yes", { httpStatus: 400 }), refusedOut(O.UNAUTHORIZED, "unknown", { httpStatus: 401 }),
    refusedOut(O.MALFORMED_RESPONSE, "yes"),
    refusedOut(O.TIMEOUT, "unknown"), refusedOut(O.NETWORK_ERROR, "unknown"), refusedOut(O.ABORTED, "unknown"),
    refusedOut(O.INVALID_REQUEST, "no"), refusedOut(O.INVALID_CONFIG, "no"), refusedOut(O.IN_FLIGHT_CONFLICT, "no"),
    // forged / inconsistent "success" shapes
    { ...okOut("sent", "SENT"), authority: "execution" }, { ...okOut("sent", "SENT"), localDelivery: true },
    { ...okOut("sent", "SENT"), reachedServer: "unknown" }, { ...okOut("sent", "SENT"), httpStatus: 201 },
    { ...okOut("sent", "SENT"), state: "CONFIRMED" }, { ...okOut("sent", "SENT"), giftId: "0x" + "cd".repeat(32) },
    { ...okOut("sent", "SENT"), to: "0x" + "11".repeat(20) }, { ...okOut("sent", "SENT"), txHash: "0x" + "AB".repeat(32) },
    { ...okOut("sent", "SENT"), txHash: null }, { ...okOut("sent", "SENT"), valueWei: "0" }, { ...okOut("sent", "SENT"), valueWei: undefined },
    { ...okOut("sent", "SENT"), valueWei: 5 }, { ...okOut("sent", "SENT"), valueWei: "0x10" }, { ...okOut("sent", "SENT"), ok: "true" }, { ...okOut("sent", "SENT"), outcome: "toString" },
    Object.defineProperty({ ...okOut("sent", "SENT") }, "txHash", { get: () => TX, enumerable: true }),
    null, undefined, "SENT", 1,
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("hostile"); } }),
  ];
  // [A-895 P-B F1] a branded client can no longer emit forged outcome shapes, so the hostile outcomes are fed to the adapter's pure
  // classifier directly (the very function deliver() uses). pre-A-895 baseline: they were returned by a hand-written client.
  for (const out of cases) {
    assert.equal(classifyGiftGasOutcome(out, GID, lower(TO)).kind, "not_delivered", JSON.stringify(out));
  }
  assert.equal(classifyGiftGasOutcome(okOut("sent", "SENT"), GID, lower(TO)).kind, "accepted");
  // and through the real client: reachable non-success replies => NOT_DELIVERED, exactly 1 request
  for (const reply of [okRecord("PENDING", { txHash: null }), okRecord("UNKNOWN", { txHash: null }), { status: 409, body: { ok: false, error: "not_available" } }, { status: 503, body: { ok: false, error: "unavailable" } }, { status: 200, body: "garbage" }, { status: 200, body: { ok: true, state: "SENT", giftId: GID, to: "0x" + "11".repeat(20), valueWei: "1", txHash: TX } }]) {
    const f = fakeClient(reply);
    await assert.rejects(createGiftGasClientDelivery(f.client).deliver({ allowanceRef: GID, to: TO, valueWei: 1n }), (e) => e.code === DR.NOT_DELIVERED, JSON.stringify(reply));
    assert.equal(f.calls.length, 1);
  }
  const net = fakeClient(() => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(createGiftGasClientDelivery(net.client).deliver({ allowanceRef: GID, to: TO, valueWei: 1n }), (e) => e.code === DR.NOT_DELIVERED);
  // bad delivery requests never reach the client
  const f = fakeClient(okRecord("SENT"));
  const d = createGiftGasClientDelivery(f.client);
  for (const bad of [null, {}, { allowanceRef: "g-1", to: TO }, { allowanceRef: GID, to: "0x12" }, { allowanceRef: GID }, Object.defineProperty({ to: TO }, "allowanceRef", { get: () => GID })]) {
    await assert.rejects(d.deliver(bad), (e) => e.code === DR.BAD_REQUEST);
  }
  assert.equal(f.calls.length, 0);
});

// ── fake Gift chain (stops at commit, as A-858) + real A-874 route bridge ──
const SCOPE = "monad-mainnet";
const CHAIN_ID = 143;
const UNITS = Object.freeze({ commitClaim: 120000n, claim: 90000n, fundingTransfer: 21000n });
const FEES = Object.freeze({ baseFeePerGasWei: 100_000_000_000n, priorityFeePerGasWei: 0n, source: "a887 test fixture" });
const DELIVER_WEI = (UNITS.commitClaim + UNITS.claim) * FEES.baseFeePerGasWei;
const SENDER = "0x00000000000000000000000000000000000000d1";
const ESCROW = "0x00000000000000000000000000000000000000e5";
const PIGGY = privateKeyToAccount(`0x${crypto.createHash("sha256").update("a887/piggy").digest("hex")}`);
const ORIGIN = "https://arasoo.vercel.app";

function fakeChain() {
  const balances = new Map();
  const txs = new Map();
  let head = 1000n;
  const chain = {
    chain: { id: CHAIN_ID },
    async getBalance({ address }) { return balances.get(lower(address)) ?? 0n; },
    async getTransactionCount() { return 0; },
    async sendRawTransaction() { throw new Error("test chain stops at commit"); },
    async waitForTransactionReceipt({ hash }) { const t = txs.get(hash); if (!t) throw new Error("unknown tx"); return { status: t.status, blockNumber: t.blockNumber }; },
    async getTransaction({ hash }) { const t = txs.get(hash); if (!t) throw new Error("unknown tx"); return { from: SENDER, to: t.to, value: t.value, input: "0x" }; },
    async readContract() { throw new Error("n/a"); },
    async getBlockNumber() { head += 1n; return head; },
  };
  const admin = {
    mine({ to, value }) {
      head += 1n;
      const hash = keccak256(stringToHex(`d:${txs.size}:${to}:${value}:${head}`));
      txs.set(hash, { to, value, status: "success", blockNumber: head });
      balances.set(lower(to), (balances.get(lower(to)) ?? 0n) + value);
      return hash;
    },
  };
  return { chain, admin };
}
async function makeGift() {
  const giftId = `0x${crypto.randomBytes(32).toString("hex")}`;
  const made = createClaimLink({ giftId, senderAddress: SENDER, chainId: SCOPE, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z" });
  const value = buildGiftValueBinding({ chainScope: SCOPE, presetLabel: 20 }).value;
  const sealed = await sealClaimLink(attachGiftValue(made.record, value).record, made.token);
  return { giftId, token: made.token, record: { ...sealed, status: CLAIM_STATUS.CLAIMED, recipientAddress: PIGGY.address, claimedAt: "2026-10-02T00:00:00.000Z" } };
}
const bindFor = (g) => bindGiftToNewPiggy({ intent: { giftId: g.giftId, token: g.token }, piggy: { id: "p", address: PIGGY.address, sequence: 1 }, preExistingAddresses: new Set(), signerAddress: PIGGY.address, requireSequence: true }).binding;
function routeFetch(route) {
  const calls = [];
  const f = (url, init) => new Promise((resolve) => {
    calls.push({ url, init });
    const req = new EventEmitter();
    req.method = init.method; req.url = new URL(url).pathname; req.destroy = () => {};
    req.headers = { ...Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])), "content-length": String(Buffer.byteLength(init.body)) };
    const res = {
      headersSent: false, writableEnded: false, status: 0, hdrs: {},
      writeHead(s, h) { this.status = s; this.hdrs = h; this.headersSent = true; },
      end(b) { this.writableEnded = true; resolve({ status: this.status, url, redirected: false, type: "basic", headers: { get: (k) => this.hdrs[k.toLowerCase()] ?? null }, text: async () => b }); },
    };
    route(req, res);
    setImmediate(() => { req.emit("data", Buffer.from(init.body)); req.emit("end"); });
  });
  f.calls = calls;
  return f;
}
function serverWith(entries, extra = {}) {
  const ledger = { get: (g) => entries.get(g) ?? null, isFailStopped: () => false, list: () => [...entries.values()] };
  const chain = { getReceipt: async () => null, getLatestNonce: async () => 0n, broadcast: async () => { throw new Error("server must not broadcast in this test"); } };
  const signer = { signNativeTransfer: async () => { throw new Error("server must not sign in this test"); } };
  return createGiftGasRoute({ ledger, policy: { relayerAddress: "0x" + "99".repeat(20) }, chain, signer, authorize: () => true, ...extra });
}
const sameOriginClient = (fetch) => createGiftGasClient({ fetch, transport: GIFT_GAS_TRANSPORT.SAME_ORIGIN, endpoint: "/gift-gas", pageOrigin: ORIGIN });
const submitterFor = (chain, gasDelivery, giftGasLedger) => createGiftClaimSubmitter({
  chain, gasDelivery, chainScope: SCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 },
  readFeeInputs: async () => FEES, sleep: async () => {}, maxPolls: 2, giftGasLedger,
});

await check("G4 end-to-end (real client · real A-874 route · real submitter + ledger): server CONFIRMED tx => delivery verified on chain, ledger CONFIRMED, 1 request to /gift-gas only", async () => {
  const { chain, admin } = fakeChain();
  const g = await makeGift();
  const hash = admin.mine({ to: PIGGY.address, value: DELIVER_WEI });
  const entries = new Map([[g.giftId, { giftId: g.giftId, to: lower(PIGGY.address), valueWei: String(DELIVER_WEI), state: "CONFIRMED", nonce: "1", rawTx: "0x00", txHash: hash }]]);
  const fetch = routeFetch(serverWith(entries));
  const store = createMemoryGiftGasStore();
  const ledger = createGiftGasLedger({ store, deviceId: "dev-a887" });
  const out = await submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), ledger).submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
  assert.equal(out.status, S.COMMIT_FAILED, JSON.stringify(out)); // past delivery: the test chain stops at commit
  assert.equal(out.txHashes.delivery, hash);
  assert.equal(store.snapshot().entries[g.giftId].state, "CONFIRMED");
  assert.equal(fetch.calls.length, 1);
  assert.equal(new URL(fetch.calls[0].url).pathname, "/gift-gas");
  assert.equal(new URL(fetch.calls[0].url).origin, ORIGIN);
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { giftId: g.giftId, to: lower(PIGGY.address) });
  assert.equal(fetch.calls[0].init.credentials, "omit");
  // resume: a second submit over the same ledger never asks the server again (ledger ALREADY_DELIVERED)
  await submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), ledger).submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
  assert.equal(fetch.calls.length, 1);
});

await check("G5 server states map into the existing fail-closed flow: 503(ambiguous)/409/PENDING/UNKNOWN => GAS_DELIVERY_FAILED + ledger UNKNOWN; wrong value on chain => GAS_DELIVERY_UNVERIFIED", async () => {
  const scenarios = [
    ["503 not configured", () => createGiftGasRoute(null)],
    // [A-895 P-B] "401 default auth deny" and "403 browser Origin not allowed" were UNKNOWN here (pre-A-895 baseline); they are definite pre-action
    // refusals now and are asserted as RELEASED in G9.
    ["409 bound elsewhere", (g) => serverWith(new Map([[g.giftId, { giftId: g.giftId, to: "0x" + "33".repeat(20), valueWei: "1", state: "CONFIRMED", nonce: "1", rawTx: "0x00", txHash: TX }]]))],
    ["PENDING", (g) => serverWith(new Map([[g.giftId, { giftId: g.giftId, to: lower(PIGGY.address), valueWei: String(DELIVER_WEI), state: "PENDING", nonce: null, rawTx: null, txHash: null }]]))],
    ["UNKNOWN", (g) => serverWith(new Map([[g.giftId, { giftId: g.giftId, to: lower(PIGGY.address), valueWei: String(DELIVER_WEI), state: "UNKNOWN", nonce: null, rawTx: null, txHash: null }]]))],
  ];
  for (const [label, mk] of scenarios) {
    const { chain } = fakeChain();
    const g = await makeGift();
    const fetch = routeFetch(mk(g));
    const store = createMemoryGiftGasStore();
    const out = await submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), createGiftGasLedger({ store, deviceId: "d" })).submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
    assert.equal(out.status, S.GAS_DELIVERY_FAILED, label);
    assert.equal(store.snapshot().entries[g.giftId].state, "UNKNOWN", label);
    assert.equal(fetch.calls.length, 1, label);
    assert.equal(JSON.stringify(out).includes("permission"), false);
  }
  // the server's SENT tx exists but its on-chain value differs from the valueWei the SERVER ECHOED (A-895 P-B: the echo is the
  // amount authority; pre-A-895 baseline: echo DELIVER_WEI - 1n and tx DELIVER_WEI - 1n were compared to this app's deliverWei)
  const { chain, admin } = fakeChain();
  const g = await makeGift();
  const hash = admin.mine({ to: PIGGY.address, value: DELIVER_WEI });
  const fetch = routeFetch(serverWith(new Map([[g.giftId, { giftId: g.giftId, to: lower(PIGGY.address), valueWei: String(DELIVER_WEI - 1n), state: "SENT", nonce: "1", rawTx: "0x00", txHash: hash }]])));
  const store = createMemoryGiftGasStore();
  const out = await submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), createGiftGasLedger({ store, deviceId: "d" })).submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
  assert.equal(out.status, S.GAS_DELIVERY_UNVERIFIED);
  assert.equal(store.snapshot().entries[g.giftId].state, "UNKNOWN");
  // after any failure the ledger blocks: a new submit does not call the server again
  const again = await submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), createGiftGasLedger({ store, deviceId: "d" })).submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
  assert.notEqual(again.status, S.VALUE_TRANSFERRED);
  assert.equal(fetch.calls.length, 1);
});

// ── [A-895 P-B] gift enable contract: amount authority · definite-refusal release · adapter-only gasDelivery ──
await check("G8 deliver(): definite pre-action refusals (400/401/403/404/405/408/413/415, 503 unavailable_not_sent) throw the NOT_SENT code; 409, plain 503, timeout/network/aborted/malformed and every forged pairing do not", async () => {
  const definite = [[O.BAD_REQUEST, 400], [O.UNAUTHORIZED, 401], [O.FORBIDDEN, 403], [O.NOT_FOUND, 404], [O.METHOD_NOT_ALLOWED, 405], [O.REQUEST_TIMEOUT, 408], [O.PAYLOAD_TOO_LARGE, 413], [O.UNSUPPORTED_MEDIA_TYPE, 415], [O.UNAVAILABLE_NOT_SENT, 503]];
  for (const [o, status] of definite) {
    assert.equal(classifyGiftGasOutcome(refusedOut(o, "yes", { httpStatus: status }), GID, lower(TO)).kind, "not_sent", o);
  }
  const bodies = { 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not found", 405: "method not allowed", 408: "request timeout", 413: "payload too large", 415: "unsupported media type", 503: "unavailable_not_sent" };
  for (const [status, error] of Object.entries(bodies)) {
    const f = fakeClient({ status: Number(status), body: { ok: false, error } });
    await assert.rejects(createGiftGasClientDelivery(f.client).deliver({ allowanceRef: GID, to: TO, valueWei: 1n }), (e) => e.code === DR.NOT_SENT, status);
    assert.equal(f.calls.length, 1);
  }
  const ambiguous = [refusedOut(O.NOT_AVAILABLE, "yes", { httpStatus: 409 }), refusedOut(O.UNAVAILABLE, "yes", { httpStatus: 503 }), refusedOut(O.TIMEOUT, "unknown"), refusedOut(O.NETWORK_ERROR, "unknown"),
    refusedOut(O.ABORTED, "unknown"), refusedOut(O.MALFORMED_RESPONSE, "yes", { httpStatus: 200 }), refusedOut(O.BAD_REQUEST, "yes", { httpStatus: 503 }), refusedOut(O.UNAVAILABLE, "yes", { httpStatus: 400 }),
    refusedOut(O.BAD_REQUEST, "unknown", { httpStatus: 400 }), refusedOut(O.INVALID_CONFIG, "no"), { ...refusedOut(O.BAD_REQUEST, "yes", { httpStatus: 400 }), authority: "execution" },
    { ...refusedOut(O.BAD_REQUEST, "yes", { httpStatus: 400 }), localDelivery: true }, refusedOut("toString", "yes", { httpStatus: 400 })];
  for (const out of ambiguous) assert.notEqual(classifyGiftGasOutcome(out, GID, lower(TO)).kind, "not_sent", JSON.stringify(out));
  for (const [status, error] of [[409, "not_available"], [503, "unavailable"], [400, "unavailable_not_sent"]]) {
    const f = fakeClient({ status, body: { ok: false, error } });
    await assert.rejects(createGiftGasClientDelivery(f.client).deliver({ allowanceRef: GID, to: TO, valueWei: 1n }), (e) => e.code !== DR.NOT_SENT, `${status} ${error}`);
  }
  assert.equal(DR.NOT_SENT, "gift_gas_delivery_refused_not_sent");
});

await check("G9 end-to-end definite refusals with REAL bytes (real client · real A-874 route · real submitter + ledger): 401/403/405/415/413/400 release the entry and a retry reaches the server again; 503 not-configured (ambiguous body) and 409 stay UNKNOWN", async () => {
  const cases = [
    ["401 default auth deny", () => createGiftGasRoute({ ledger: { get: () => null, isFailStopped: () => false }, policy: {}, chain: {}, signer: { signNativeTransfer() {} } }), true],
    ["403 browser Origin not allowed", () => { const r = serverWith(new Map()); return (req, res) => { req.headers.origin = ORIGIN; return r(req, res); }; }, true],
    ["405 wrong method", () => { const r = serverWith(new Map()); return (req, res) => { req.method = "GET"; return r(req, res); }; }, true],
    ["415 wrong content-type", () => { const r = serverWith(new Map()); return (req, res) => { req.headers["content-type"] = "text/plain"; return r(req, res); }; }, true],
    ["413 oversized content-length", () => { const r = serverWith(new Map()); return (req, res) => { req.headers["content-length"] = "99999"; return r(req, res); }; }, true],
    ["400 non-numeric content-length", () => { const r = serverWith(new Map()); return (req, res) => { req.headers["content-length"] = "nope"; return r(req, res); }; }, true],
    ["503 route not configured (ambiguous body)", () => createGiftGasRoute(null), false],
    ["409 not available (bound elsewhere)", (g) => serverWith(new Map([[g.giftId, { giftId: g.giftId, to: "0x" + "33".repeat(20), valueWei: "1", state: "CONFIRMED", nonce: "1", rawTx: "0x00", txHash: TX }]])), false],
  ];
  for (const [label, mk, released] of cases) {
    const { chain } = fakeChain();
    const g = await makeGift();
    const fetch = routeFetch(mk(g));
    const store = createMemoryGiftGasStore();
    const ledger = createGiftGasLedger({ store, deviceId: "d" });
    const sub = () => submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), ledger);
    const out = await sub().submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
    assert.equal(out.status, S.GAS_DELIVERY_FAILED, label);
    assert.equal(fetch.calls.length, 1, label);
    if (released) {
      assert.equal(store.snapshot().entries[g.giftId], undefined, `${label}: released`);
      await sub().submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
      assert.equal(fetch.calls.length, 2, `${label}: retry allowed => the server was asked again`);
    } else {
      assert.equal(store.snapshot().entries[g.giftId].state, "UNKNOWN", `${label}: UNKNOWN`);
      await sub().submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
      assert.equal(fetch.calls.length, 1, `${label}: blocked, the server was not asked again`);
    }
  }
});

await check("G10 the submitter refuses any gasDelivery that is not an isGiftGasClientDelivery object (hand-written, /grant-like, spread copy, bare deliver, proxy): createGiftClaimSubmitter => null", () => {
  const { chain } = fakeChain();
  const base = { chain, chainScope: SCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 }, readFeeInputs: async () => FEES };
  const real = createGiftGasClientDelivery(fakeClient(okRecord("SENT")).client);
  assert.ok(createGiftClaimSubmitter({ ...base, gasDelivery: real }));
  for (const bad of [{ async deliver() { return { txHash: TX, valueWei: 1n }; } }, { ...real }, { deliver: real.deliver }, Object.create(real), new Proxy(real, {}), { deliver() {}, isGiftGasClientDelivery: true }]) {
    assert.equal(createGiftClaimSubmitter({ ...base, gasDelivery: bad }), null);
  }
  assert.equal(createGiftClaimSubmitter({ ...base, gasDelivery: null }), null);
  assert.match(ENTRY, /if \(!isGiftGasClientDelivery\(gasDelivery\)\) return null;/);
});

await check("G11 amount authority end-to-end: a server echo above the client bound is refused BEFORE markSent (UNKNOWN, no hash); a below-bound echo is verified against the chain by the ECHOED value and recorded", async () => {
  const { chain, admin } = fakeChain();
  const g = await makeGift();
  const hash = admin.mine({ to: PIGGY.address, value: DELIVER_WEI + 1n });
  const fetch = routeFetch(serverWith(new Map([[g.giftId, { giftId: g.giftId, to: lower(PIGGY.address), valueWei: String(DELIVER_WEI + 1n), state: "SENT", nonce: "1", rawTx: "0x00", txHash: hash }]])));
  const store = createMemoryGiftGasStore();
  const out = await submitterFor(chain, createGiftGasClientDelivery(sameOriginClient(fetch)), createGiftGasLedger({ store, deviceId: "d" })).submit({ binding: bindFor(g), record: g.record, token: g.token, account: PIGGY });
  assert.equal(out.status, S.GAS_DELIVERY_FAILED);
  assert.equal(out.txHashes, undefined);
  const e = store.snapshot().entries[g.giftId];
  assert.equal(e.state, "UNKNOWN"); assert.equal(e.txHash, null);
  const { chain: c2, admin: a2 } = fakeChain();
  const g2 = await makeGift();
  const h2 = a2.mine({ to: PIGGY.address, value: DELIVER_WEI - 1n });
  const f2 = routeFetch(serverWith(new Map([[g2.giftId, { giftId: g2.giftId, to: lower(PIGGY.address), valueWei: String(DELIVER_WEI - 1n), state: "CONFIRMED", nonce: "1", rawTx: "0x00", txHash: h2 }]])));
  const s2 = createMemoryGiftGasStore();
  const out2 = await submitterFor(c2, createGiftGasClientDelivery(sameOriginClient(f2)), createGiftGasLedger({ store: s2, deviceId: "d" })).submit({ binding: bindFor(g2), record: g2.record, token: g2.token, account: PIGGY });
  assert.equal(out2.status, S.GAS_INSUFFICIENT_AFTER_DELIVERY, JSON.stringify(out2));
  assert.equal(s2.snapshot().entries[g2.giftId].valueWei, String(DELIVER_WEI - 1n));
  assert.equal(s2.snapshot().entries[g2.giftId].state, "CONFIRMED");
});

await check("G12 [R-B1] overwriting WeakSet.prototype.has/add after load does not let a hand-written client, delivery or error through", async () => {
  const realClient = fakeClient(okRecord("SENT")).client;
  const realDelivery = createGiftGasClientDelivery(realClient);
  const handClient = { configError: null, request: async () => okRecord("SENT").body };
  const handDelivery = { async deliver() { return { txHash: TX, valueWei: 1n }; } };
  const savedHas = WeakSet.prototype.has; const savedAdd = WeakSet.prototype.add;
  try {
    WeakSet.prototype.has = function () { return true; };
    WeakSet.prototype.add = function () { return this; };
    assert.equal(createGiftGasClientDelivery(handClient), null, "hand-written client still refused");
    assert.equal(isGiftGasClientDelivery(handDelivery), false, "hand-written delivery still refused");
    const { chain } = fakeChain();
    assert.equal(createGiftClaimSubmitter({ chain, gasDelivery: handDelivery, chainScope: SCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 }, readFeeInputs: async () => FEES }), null);
    // registrations made after the overwrite still work (captured add), and real ones stay recognised
    assert.equal(isGiftGasClientDelivery(realDelivery), true);
    assert.ok(createGiftGasClientDelivery(createGiftGasClient({ fetch: async () => {}, transport: GIFT_GAS_TRANSPORT.HTTPS, endpoint: "https://relay.example/gift-gas" })));
    // a forged not-sent error is still not "provably not sent": a definite refusal from a real client still is
    const f = fakeClient({ status: 400, body: { ok: false, error: "bad_request" } });
    await assert.rejects(createGiftGasClientDelivery(f.client).deliver({ allowanceRef: GID, to: TO, valueWei: 1n }), (e) => e.code === DR.NOT_SENT);
  } finally { WeakSet.prototype.has = savedHas; WeakSet.prototype.add = savedAdd; }
});

// ── main.js Gift composition, evaluated from the real block text ──
function evalGiftBlock({ config = null, location, fetch } = {}) {
  let src = GIFT_BLOCK;
  assert.ok(src.includes("const GIFT_GAS_CLIENT_CONFIG = null;"));
  src = src.replace("const GIFT_GAS_CLIENT_CONFIG = null;", "const GIFT_GAS_CLIENT_CONFIG = __config;");
  const saved = globalThis.fetch;
  if (fetch !== undefined) globalThis.fetch = fetch;
  try {
    return new Function("createGiftGasClient", "GIFT_GAS_TRANSPORT", "createGiftGasClientDelivery", "location", "__config",
      `${src}\nreturn { GIFT_GAS_CLIENT, a887GiftClaimSubmitConfig, a887GiftGasClient };`)(createGiftGasClient, GIFT_GAS_TRANSPORT, createGiftGasClientDelivery, location, config);
  } finally {
    globalThis.fetch = saved;
  }
}

await check("G6 main.js composition: default null => no client, no submit config; gasDelivery comes only from the client; own gasDelivery (e.g. /grant-backed) refused", async () => {
  const def = evalGiftBlock({ location: { origin: ORIGIN } });
  assert.equal(def.GIFT_GAS_CLIENT, null);
  assert.equal(def.a887GiftClaimSubmitConfig({ chainScope: SCOPE }), null);
  assert.equal(createGiftClaimSubmitter(def.a887GiftClaimSubmitConfig({ chainScope: SCOPE })), null);

  const fetch = routeFetch(createGiftGasRoute(null));
  const on = evalGiftBlock({ config: { endpoint: "/gift-gas" }, location: { origin: ORIGIN }, fetch });
  assert.ok(on.GIFT_GAS_CLIENT && on.GIFT_GAS_CLIENT.configError === null);
  const composed = on.a887GiftClaimSubmitConfig({ chainScope: SCOPE, escrowAddress: ESCROW });
  assert.equal(isGiftGasClientDelivery(composed.gasDelivery), true);
  assert.deepEqual(Object.keys(composed).sort(), ["chainScope", "escrowAddress", "gasDelivery"]);
  // a config that brings its own delivery (any other route, incl. /grant) is refused outright
  const grantLike = { async deliver() { return { txHash: TX }; } };
  assert.equal(on.a887GiftClaimSubmitConfig({ chainScope: SCOPE, gasDelivery: grantLike }), null);
  assert.equal(on.a887GiftClaimSubmitConfig({ chainScope: SCOPE, gasDelivery: undefined }), null);
  assert.equal(on.a887GiftClaimSubmitConfig(null), null);
  // the composed delivery uses the native fetch captured at boot, same-origin /gift-gas only
  const saved = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    await assert.rejects(composed.gasDelivery.deliver({ allowanceRef: GID, to: TO, valueWei: 1n }), (e) => e.code === DR.NOT_DELIVERED);
  } finally { globalThis.fetch = saved; }
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, `${ORIGIN}/gift-gas`);
});

await check("G7 main.js client config is strict: cross-origin / other path / /grant / extra key / accessor / no origin / no fetch => no client", () => {
  const fetch = async () => { throw new Error("must not be called"); };
  const bad = [
    { endpoint: "https://relay.example/gift-gas" }, { endpoint: "/grant" }, { endpoint: "/api/grant" }, { endpoint: "/gift-gas?x=1" },
    { endpoint: "//evil.example/gift-gas" }, { endpoint: "/gift-gas", timeoutMs: 1 }, { endpoint: "/gift-gas", transport: "https" },
    { endpoint: "/gift-gas", fetch }, Object.defineProperty({}, "endpoint", { get: () => "/gift-gas", enumerable: true }),
    Object.create({ endpoint: "/gift-gas" }), [], "x", {}, { endpoint: undefined },
  ];
  for (const config of bad) assert.equal(evalGiftBlock({ config, location: { origin: ORIGIN }, fetch }).GIFT_GAS_CLIENT, null, JSON.stringify(config));
  assert.equal(evalGiftBlock({ config: { endpoint: "/gift-gas" }, location: undefined, fetch }).GIFT_GAS_CLIENT, null);
  assert.equal(evalGiftBlock({ config: { endpoint: "/gift-gas" }, location: { origin: ORIGIN }, fetch: null }).GIFT_GAS_CLIENT, null);
  assert.ok(evalGiftBlock({ config: { endpoint: "/gift-gas", timeoutMs: 15000 }, location: { origin: ORIGIN }, fetch }).GIFT_GAS_CLIENT);
});

// ═══ F. First receipt-evidence sidecar, evaluated from the real block text ════════════════════════════════════════
const DEP = "0x" + "a1".repeat(32);
const RED = "0x" + "b2".repeat(32);
const ADDR = "0x" + "c3".repeat(20);
const MONAD_TESTNET = Object.freeze({ id: 10143, name: "Monad Testnet" });
function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
function evalFirst({ sidecar = null, pending = null, receipts = [], legacy = true, readThrows = false, readTimeoutMs = null } = {}) {
  let src = FIRST_BLOCK;
  if (readTimeoutMs !== null) src = src.replace(/const A887_FIRST_READ_TIMEOUT_MS = \d+;/, `const A887_FIRST_READ_TIMEOUT_MS = ${readTimeoutMs};`); // [A-895 P-D] test-only shrink of the I1 deadline
  assert.ok(src.includes("const FIRST_EVIDENCE_SIDECAR = null;"));
  src = src.replace("const FIRST_EVIDENCE_SIDECAR = null;", "const FIRST_EVIDENCE_SIDECAR = __sidecar;");
  const reads = { pending: 0 };
  const writes = [];
  const state = new Proxy({ receipts }, { set(t, k, v) { writes.push(k); t[k] = v; return true; }, deleteProperty(t, k) { writes.push(k); return true; } });
  const readSendPending = () => { reads.pending += 1; if (readThrows) throw new Error("x"); return pending; };
  const api = new Function("readSendPending", "state", "LEGACY_TESTNET_PATH", "MONAD_TESTNET", "RECEIPT_KIND", "mapFirstEvidence", "readTxEvidence", "evidenceStoreKey", "__sidecar",
    `${src}\nreturn { a887ObserveFirstEvidence, busy: () => a887FirstReadBusy };`)(readSendPending, state, legacy, MONAD_TESTNET, RECEIPT_KIND, mapFirstEvidence, readTxEvidence, evidenceStoreKey, sidecar);
  return { ...api, reads, writes };
}
const tick = () => new Promise((r) => setImmediate(r));

await check("F1 default FIRST_EVIDENCE_SIDECAR = null: nothing scheduled, nothing read, nothing stored, returns undefined", async () => {
  const t = evalFirst({ pending: { stage: "redeem-broadcast", depositTxHash: DEP, redeemTxHash: RED } });
  await tick();
  assert.equal(t.a887ObserveFirstEvidence("broadcast"), undefined);
  assert.equal(t.reads.pending, 0, "no boot sweep, no read");
  assert.deepEqual(t.writes, []);
});

await check("F2 injected A-868 store: pending (both hashes) + legacy receipt => one row per tx, status unknown, idempotent; add_money skipped; boot sweep scheduled", async () => {
  const storage = memStorage();
  const store = createEvidenceStore({ storage, chainId: 10143 });
  const reports = [];
  const pending = { stage: "redeem-broadcast", phase: "sent", address: ADDR, depositTxHash: DEP, redeemTxHash: RED, reservationId: "r", at: 1 };
  const receipts = [
    { kind: RECEIPT_KIND.ADD_MONEY, chainId: "10143", token: "x", amount: "1", txHash: "0x" + "dd".repeat(32), at: 1 },
    { txHash: RED, depositTxHash: DEP, redeemTxHash: RED, status: "success" },
    { txHash: "0x" + "ee".repeat(32), status: "success" }, // legacy txHash-only receipt => redeem
  ];
  const t = evalFirst({ sidecar: { store, onReport: (r) => reports.push(r) }, pending, receipts });
  await tick(); // boot sweep
  assert.equal(t.reads.pending, 1);
  const all = store.readAll();
  assert.equal(all.ok, true);
  assert.deepEqual(all.rows.map((r) => r.txHash).sort(), [DEP, RED, "0x" + "ee".repeat(32)].sort());
  for (const r of all.rows) { assert.equal(r.status, "unknown"); assert.equal(r.chainId, "10143"); }
  assert.ok(!all.rows.some((r) => r.txHash === "0x" + "dd".repeat(32)), "add_money row never mapped as First");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].authority, "observation_only");
  assert.equal(reports[0].trigger, "boot");
  assert.ok(Object.isFrozen(reports[0]));
  const before = storage.getItem(evidenceStoreKey(10143));
  t.a887ObserveFirstEvidence("broadcast");
  assert.equal(storage.getItem(evidenceStoreKey(10143)), before, "second sweep writes nothing");
  assert.deepEqual([...storage.m.keys()], [evidenceStoreKey(10143)], "only the evidence key is ever written");
  assert.deepEqual(t.writes, [], "no app state write");
});

await check("F3 failed / unknown First send keeps its hash as evidence (deposit-broadcast); reserved/unknown/junk records map nothing and never throw", async () => {
  const storage = memStorage();
  const store = createEvidenceStore({ storage, chainId: 10143 });
  const t = evalFirst({ sidecar: { store }, pending: { stage: "deposit-broadcast", phase: "signed", depositTxHash: DEP } });
  await tick();
  assert.deepEqual(store.readAll().rows.map((r) => r.txHash), [DEP]);
  for (const pending of [{ stage: "reserved" }, { stage: "unknown" }, { stage: "deposit-broadcast", depositTxHash: "0x12" }, { stage: "redeem-broadcast", depositTxHash: DEP, redeemTxHash: DEP }, "junk", 7]) {
    const s2 = memStorage();
    const st2 = createEvidenceStore({ storage: s2, chainId: 10143 });
    const t2 = evalFirst({ sidecar: { store: st2 }, pending, receipts: [null, 1, "x", { kind: 5 }, Object.create(null)] });
    await tick();
    assert.equal(t2.a887ObserveFirstEvidence("broadcast"), undefined);
    assert.equal(st2.readAll().rows.length, 0, JSON.stringify(pending));
  }
  const t3 = evalFirst({ sidecar: { store }, readThrows: true });
  await tick();
  assert.equal(t3.a887ObserveFirstEvidence("broadcast"), undefined);
});

await check("F4 store must be an A-868 store bound to chain 10143; off the testnet path nothing runs; wrong/hostile stores never throw", async () => {
  const pending = { stage: "redeem-broadcast", depositTxHash: DEP, redeemTxHash: RED };
  const wrongChain = createEvidenceStore({ storage: memStorage(), chainId: 143 });
  const disguised = { storeKey: "araso.receipts", append() { throw new Error("must not be called"); } };
  for (const store of [wrongChain, disguised, null, {}, { append: 1 }]) {
    const t = evalFirst({ sidecar: { store }, pending });
    await tick();
    t.a887ObserveFirstEvidence("broadcast");
    assert.equal(t.reads.pending, 0);
  }
  if (wrongChain.readAll().rows.length !== 0) assert.fail("wrong-chain store written");
  const offTestnet = evalFirst({ sidecar: { store: createEvidenceStore({ storage: memStorage(), chainId: 10143 }) }, pending, legacy: false });
  await tick();
  offTestnet.a887ObserveFirstEvidence("broadcast");
  assert.equal(offTestnet.reads.pending, 0);
  const key = evidenceStoreKey(10143);
  const errors = [];
  const hostile = [
    { storeKey: key, append() { throw new Error("boom"); } },
    { storeKey: key, append() { return Promise.reject(new Error("async")); } },
    { storeKey: key, append() { return { ok: false, reason: "store_unsound" }; } },
    { storeKey: key, append() { return { ok: true }; }, get() { throw new Error("get boom"); } },
  ];
  for (const store of hostile) {
    const t = evalFirst({ sidecar: { store, onReport: (r) => errors.push(r.evidenceErrors.length) }, pending });
    await tick();
    assert.equal(t.a887ObserveFirstEvidence("broadcast"), undefined);
  }
  assert.deepEqual(errors.slice(0, 6), [2, 2, 2, 2, 2, 2]);
  const t = evalFirst({ sidecar: { store: createEvidenceStore({ storage: memStorage(), chainId: 10143 }), onReport() { throw new Error("report boom"); } }, pending });
  await tick();
  assert.equal(t.a887ObserveFirstEvidence("x"), undefined);
  const t2 = evalFirst({ sidecar: { store: createEvidenceStore({ storage: memStorage(), chainId: 10143 }), onReport: () => Promise.reject(new Error("r")) }, pending });
  await tick();
  assert.equal(t2.a887ObserveFirstEvidence("x"), undefined);
});

await check("F5b [A-895 P-D · I1/I2] a never-settling rpc releases the read flag after the per-read deadline (a later sweep can read again); sweep stores at most MAX records", async () => {
  const s = createEvidenceStore({ storage: memStorage(), chainId: 10143 });
  let calls = 0;
  const t = evalFirst({ sidecar: { store: s, rpc: () => { calls += 1; return new Promise(() => {}); } }, readTimeoutMs: 40, pending: { stage: "deposit-broadcast", address: ADDR, depositTxHash: DEP } });
  assert.equal(t.a887ObserveFirstEvidence("broadcast"), undefined);
  await tick();
  assert.equal(t.busy(), true, "hung read holds the flag only until the deadline");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(t.busy(), false, "flag released after the deadline");
  assert.ok(calls >= 1);
  assert.ok(s.readAll().rows.every((r) => r.status === "unknown"), "a timed-out read changes nothing");
  const before = calls;
  t.a887ObserveFirstEvidence("broadcast");
  await tick(); await tick();
  assert.ok(calls > before, "after the release a later sweep reads again");
  // I2: 30 distinct receipts + a pending record => at most A887_FIRST_RECEIPT_SWEEP_MAX (20) records are mapped
  const many = Array.from({ length: 30 }, (_, i) => ({ txHash: "0x" + (i + 1).toString(16).padStart(64, "0"), status: "success", before: "1", after: "1", gas: "1", sent: "1", at: 1 }));
  const s2 = createEvidenceStore({ storage: memStorage(), chainId: 10143 });
  const t2 = evalFirst({ sidecar: { store: s2, onReport: () => {} }, pending: { stage: "deposit-broadcast", address: ADDR, depositTxHash: DEP }, receipts: many });
  t2.a887ObserveFirstEvidence("broadcast");
  assert.ok(s2.readAll().rows.length <= 20, `rows ${s2.readAll().rows.length} <= 20`);
});

await check("F5 optional injected read-only rpc: background read fills the row (success), bounded, never awaited by the caller; failures leave rows unknown", async () => {
  const storage = memStorage();
  const store = createEvidenceStore({ storage, chainId: 10143 });
  const methods = [];
  const rpc = async (method, params) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x279f";
    if (method === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0x10", blockHash: "0x" + "77".repeat(32), transactionHash: params[0], transactionIndex: "0x0", gasUsed: "0x5208" };
    if (method === "eth_getTransactionByHash") return { hash: params[0], nonce: "0x1", gas: "0x5208", from: ADDR, to: "0x" + "44".repeat(20) };
    if (method === "eth_getTransactionCount") return "0x2";
    return null;
  };
  const t = evalFirst({ sidecar: { store, rpc }, pending: { stage: "redeem-broadcast", address: ADDR, depositTxHash: DEP, redeemTxHash: RED } });
  const ret = t.a887ObserveFirstEvidence("broadcast"); // synchronous return while reads may be in flight
  assert.equal(ret, undefined);
  for (let i = 0; i < 20 && (t.busy() || store.readAll().rows.some((r) => r.status === "unknown")); i += 1) await tick();
  const rows = store.readAll().rows;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.status, "success");
  assert.ok(methods.every((m) => /^eth_(chainId|getTransactionReceipt|getTransactionByHash|getTransactionCount|getBalance|getBlockByNumber|blockNumber|call)$/.test(m)));
  // a settled row is not re-read
  const n = methods.length;
  t.a887ObserveFirstEvidence("broadcast");
  for (let i = 0; i < 5; i += 1) await tick();
  assert.equal(methods.length, n);
  // rpc failures: rows stay unknown, nothing thrown
  const s2 = createEvidenceStore({ storage: memStorage(), chainId: 10143 });
  const t2 = evalFirst({ sidecar: { store: s2, rpc: async () => { throw new Error("rpc down"); } }, pending: { stage: "deposit-broadcast", depositTxHash: DEP } });
  for (let i = 0; i < 10; i += 1) await tick();
  assert.equal(t2.busy(), false);
  assert.ok(s2.readAll().rows.every((r) => r.status === "unknown"));
  // wrong chain from rpc => read_failed, row stays unknown
  const s3 = createEvidenceStore({ storage: memStorage(), chainId: 10143 });
  evalFirst({ sidecar: { store: s3, rpc: async (m) => (m === "eth_chainId" ? "0x8f" : null) }, pending: { stage: "deposit-broadcast", depositTxHash: DEP } });
  for (let i = 0; i < 10; i += 1) await tick();
  assert.ok(s3.readAll().rows.every((r) => r.status === "unknown"));
});

await check("F6 waitForSuccess trigger: observation first, result unchanged (success / reverted / throw); cut-out harness without the sidecar still works", async () => {
  const W = fnText(MAIN, "waitForSuccess");
  for (const [receipt, throws, want] of [[{ status: "success", n: 1 }, false, "same"], [{ status: "reverted" }, false, null], [null, true, null]]) {
    const seen = [];
    const publicClient = { waitForTransactionReceipt: async () => { if (throws) throw new Error("x"); return receipt; } };
    const fn = new Function("publicClient", "a887ObserveFirstEvidence", `${W}\nreturn waitForSuccess;`)(publicClient, (t) => { seen.push(t); });
    const out = await fn(DEP);
    assert.equal(out, want === "same" ? receipt : null);
    assert.deepEqual(seen, ["broadcast"]);
  }
  // existing harnesses cut waitForSuccess without the sidecar in scope: the typeof guard keeps them working
  const bare = new Function("publicClient", `${W}\nreturn waitForSuccess;`)({ waitForTransactionReceipt: async () => ({ status: "success" }) });
  assert.deepEqual(await bare(DEP), { status: "success" });
});

console.log(`\nA-887: ${pass}/${pass} PASS`);
