// [A-858] Gift gas-delivery idempotency: giftId-scoped exactly-once MON delivery.
//   node app/test/a858-gift-gas-idempotency.mjs
// Network 0 · tx 0 · deploy 0 · UI/copy/CSS/main.js 0. In-memory fake chain + counting gas layer.
// Maps to A-854 T1-T11 (T7/T9/T10 are NOT runnable here, see RECEIPT.md).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import {
  GIFT_CLAIM_SUBMIT_STATUS as S,
  bindGiftToNewPiggy,
  createGiftClaimSubmitter,
  createGiftGasClientDelivery,
} from "../src/gift-claim-entry.js";
import { createGiftGasClient } from "../src/gift-gas-client.js";
import { CLAIM_STATUS, attachGiftValue, createClaimLink, sealClaimLink } from "../src/gift-piggy-claim-link.js";
import { buildGiftValueBinding } from "../src/gift-value-spec.js";
import { GIFT_GAS_LEDGER_REASON as R, createBrowserGiftGasStore, createGiftGasLedger, createMemoryGiftGasStore } from "../src/gift-gas-ledger.js";

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const lower = (a) => String(a || "").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCOPE = "monad-mainnet";
const CHAIN_ID = 143;
const UNITS = Object.freeze({ commitClaim: 120000n, claim: 90000n, fundingTransfer: 21000n });
const FEES = Object.freeze({ baseFeePerGasWei: 100_000_000_000n, priorityFeePerGasWei: 0n, source: "a858 test fixture" });
const SENDER = "0x00000000000000000000000000000000000000d1";
const ESCROW = "0x00000000000000000000000000000000000000e5";
const mkAcct = (label) => privateKeyToAccount(`0x${crypto.createHash("sha256").update(`a858/${label}`).digest("hex")}`);
const PIGGY = mkAcct("piggy-1");
const PIGGY2 = mkAcct("piggy-2");

function fakeChain() {
  const balances = new Map();
  const txs = new Map();
  let head = 1000n;
  const chain = {
    chain: { id: CHAIN_ID },
    async getBalance({ address }) { return balances.get(lower(address)) ?? 0n; },
    async getTransactionCount() { return 0; },
    async sendRawTransaction() { throw new Error("test chain stops at commit"); },
    async waitForTransactionReceipt({ hash }) {
      const t = txs.get(hash);
      if (!t || t.hidden) throw new Error("unknown tx");
      return { status: t.status, blockNumber: t.blockNumber };
    },
    async getTransaction({ hash }) {
      const t = txs.get(hash);
      if (!t || t.hidden) throw new Error("unknown tx");
      return { from: SENDER, to: t.to, value: t.value, input: "0x" };
    },
    async readContract() { throw new Error("n/a"); },
    async getBlockNumber() { head += 1n; return head; },
  };
  const admin = {
    txs,
    mine({ to, value, status = "success", hidden = false, credit = true }) {
      head += 1n;
      const hash = keccak256(stringToHex(`d:${txs.size}:${to}:${value}:${head}`));
      txs.set(hash, { to, value, status, blockNumber: head, hidden });
      if (credit && status === "success") balances.set(lower(to), (balances.get(lower(to)) ?? 0n) + value);
      return hash;
    },
  };
  return { chain, admin };
}

// counting sender-side gas layer
// [A-895 P-B] The submitter now accepts ONLY a createGiftGasClientDelivery() object (A-887 R1). The counting fake below plays the
// SERVER (same deliver(req) body as before: it decides the amount and mines the tx); the exported `delivery` is the
// A-884-client-shaped wrapper around it. pre-A-895 baseline: gasLayer() returned the bare { calls, deliver } as gasDelivery.
const SERVER_WEI = (UNITS.commitClaim + UNITS.claim) * FEES.baseFeePerGasWei; // = the client's fee-derived bound (bufferBps 0)
function gasLayer(admin, { throwAfterSend = false, delayMs = 0, mutate = null } = {}) {
  const calls = [];
  const fake = {
    async deliver(req) {
      calls.push({ keys: Object.keys(req).sort(), ...req });
      if (delayMs) await sleep(delayMs);
      const hash = admin.mine({ to: req.to, value: req.valueWei, ...(mutate ? mutate(req) : {}) });
      if (throwAfterSend) throw new Error("connection lost after broadcast");
      return { txHash: hash };
    },
  };
  // [A-895 P-B F1] a REAL createGiftGasClient() over a fake fetch (the adapter accepts only branded clients).
  const fakeFetch = async (url, init) => {
    const { giftId, to } = JSON.parse(init.body);
    let d;
    try { d = await fake.deliver({ allowanceRef: giftId, to, valueWei: SERVER_WEI }); } catch { throw new TypeError("connection lost"); }
    const body = JSON.stringify({ ok: true, state: "SENT", giftId, to, valueWei: String(SERVER_WEI), txHash: d.txHash });
    return { status: 200, url, redirected: false, type: "basic", headers: { get: () => "application/json" }, text: async () => body };
  };
  const client = createGiftGasClient({ fetch: fakeFetch, transport: "https", endpoint: "https://relay.example/gift-gas" });
  return { calls, delivery: createGiftGasClientDelivery(client) };
}
const totalDelivered = (gas) => gas.calls.reduce((s, c) => s + c.valueWei, 0n);

async function makeGift(giftId = `0x${crypto.randomBytes(32).toString("hex")}`) {
  const made = createClaimLink({ giftId, senderAddress: SENDER, chainId: SCOPE, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z" });
  const value = buildGiftValueBinding({ chainScope: SCOPE, presetLabel: 20 }).value;
  const sealed = await sealClaimLink(attachGiftValue(made.record, value).record, made.token);
  return { giftId, token: made.token, record: { ...sealed, status: CLAIM_STATUS.CLAIMED, recipientAddress: PIGGY.address, claimedAt: "2026-10-02T00:00:00.000Z" } };
}
function bindFor(giftId, token, acct = PIGGY) {
  const b = bindGiftToNewPiggy({ intent: { giftId, token }, piggy: { id: `p-${lower(acct.address)}`, address: acct.address, sequence: 1 }, preExistingAddresses: new Set(["0x00000000000000000000000000000000000000c3"]), signerAddress: acct.address, requireSequence: true });
  assert.equal(b.ok, true);
  return b.binding;
}
const submitterFor = (chain, gasDelivery, giftGasLedger) => createGiftClaimSubmitter({
  chain, gasDelivery: gasDelivery?.delivery ?? gasDelivery, chainScope: SCOPE, escrowAddress: ESCROW, gasUnits: UNITS, safety: { bufferBps: 0 },
  readFeeInputs: async () => FEES, sleep: async () => {}, maxPolls: 2, ...(giftGasLedger === undefined ? {} : { giftGasLedger }),
});
const run = (sub, g, acct = PIGGY) => sub.submit({ binding: bindFor(g.giftId, g.token, acct), record: g.record, token: g.token, account: acct });
const ledgerOn = (store, deviceId = "dev-A") => createGiftGasLedger({ store, deviceId });
const deliverWeiOf = () => (UNITS.commitClaim + UNITS.claim) * (FEES.baseFeePerGasWei + 0n);

await check("T1. refresh/retry (new submitter + new ledger over the same store, same Piggy) => exactly 1 delivery", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
  const first = await run(submitterFor(chain, gas, ledgerOn(store)), g);
  assert.equal(first.status, S.COMMIT_FAILED); // the test chain stops at commit; delivery already done
  assert.equal(gas.calls.length, 1);
  assert.ok(gas.calls[0].valueWei > 0n);
  for (let i = 0; i < 4; i += 1) {
    const again = await run(submitterFor(chain, gas, ledgerOn(store)), g);
    assert.equal(again.status, S.COMMIT_FAILED);
    assert.equal(again.txHashes.delivery, first.txHashes.delivery);
  }
  assert.equal(gas.calls.length, 1);
  assert.equal(totalDelivered(gas), gas.calls[0].valueWei); // T8: loss bound = 1 x deliverWei
  assert.equal(store.snapshot().entries[g.giftId.toLowerCase()].state, "CONFIRMED");
});

await check("T2. second (different) Piggy on the same device/giftId fails closed, 0 new deliveries", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
  await run(submitterFor(chain, gas, ledgerOn(store)), g);
  const out = await run(submitterFor(chain, gas, ledgerOn(store)), g, PIGGY2);
  // PIGGY2 is not the record's recipient binding but the signer/binding are self-consistent, so the gate is the ledger
  assert.equal(out.status, S.GAS_BOUND_TO_OTHER_PIGGY);
  assert.equal(gas.calls.length, 1);
});

await check("T3. different device (same giftId, shared view of the store) fails closed; an independent browser store is NOT a barrier (server ledger is)", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
  await run(submitterFor(chain, gas, ledgerOn(store, "dev-A")), g);
  const other = await run(submitterFor(chain, gas, ledgerOn(store, "dev-B")), g);
  assert.equal(other.status, S.GAS_BOUND_TO_OTHER_PIGGY);
  assert.equal(gas.calls.length, 1);
  // documented limit: a truly separate device has a separate store and would deliver again
  await run(submitterFor(chain, gas, ledgerOn(createMemoryGiftGasStore(), "dev-C")), g);
  assert.equal(gas.calls.length, 2);
});

await check("T4. crash points: before deliver -> blocked; after markSent -> reconcile from chain, no redelivery; unverifiable hash -> UNKNOWN, no redelivery; throw after broadcast -> blocked", async () => {
  // (a) crash after reserve, before deliver
  { const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
    assert.equal((await ledgerOn(store).reserve(g.giftId, PIGGY.address, deliverWeiOf())).ok, true);
    const out = await run(submitterFor(chain, gas, ledgerOn(store)), g);
    assert.equal(out.status, S.GAS_RECONCILE_REQUIRED); assert.equal(gas.calls.length, 0); }
  // (b) crash after deliver returned + markSent, before the receipt check: chain has it -> resume without redelivery
  { const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
    const led = ledgerOn(store); const wei = deliverWeiOf(); await led.reserve(g.giftId, PIGGY.address, wei);
    await led.markSent(g.giftId, admin.mine({ to: PIGGY.address, value: wei }));
    const out = await run(submitterFor(chain, gas, ledgerOn(store)), g);
    assert.equal(out.status, S.COMMIT_FAILED); assert.equal(gas.calls.length, 0);
    assert.equal(store.snapshot().entries[g.giftId.toLowerCase()].state, "CONFIRMED"); }
  // (c) recorded hash is not on chain / wrong value => UNKNOWN, never redeliver
  { const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
    const led = ledgerOn(store); const wei = deliverWeiOf(); await led.reserve(g.giftId, PIGGY.address, wei);
    await led.markSent(g.giftId, admin.mine({ to: PIGGY.address, value: wei - 1n }));
    for (let i = 0; i < 2; i += 1) { const out = await run(submitterFor(chain, gas, ledgerOn(store)), g); assert.equal(out.status, S.GAS_RECONCILE_REQUIRED); }
    assert.equal(gas.calls.length, 0); assert.equal(store.snapshot().entries[g.giftId.toLowerCase()].state, "UNKNOWN"); }
  // (d) gas layer throws after it already broadcast => blocked (state UNKNOWN), never auto-redeliver
  { const { chain, admin } = fakeChain(); const gas = gasLayer(admin, { throwAfterSend: true }); const store = createMemoryGiftGasStore(); const g = await makeGift();
    assert.equal((await run(submitterFor(chain, gas, ledgerOn(store)), g)).status, S.GAS_DELIVERY_FAILED);
    assert.equal((await run(submitterFor(chain, gas, ledgerOn(store)), g)).status, S.GAS_RECONCILE_REQUIRED);
    assert.equal(gas.calls.length, 1); assert.equal(store.snapshot().entries[g.giftId.toLowerCase()].state, "UNKNOWN"); }
});

await check("T5. two tabs: concurrent submits (shared store; separate ledger instances) => exactly 1 delivery", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin, { delayMs: 25 }); const store = createMemoryGiftGasStore(); const g = await makeGift();
  const [a, b] = await Promise.all([
    run(submitterFor(chain, gas, ledgerOn(store)), g),
    run(submitterFor(chain, gas, ledgerOn(store)), g),
  ]);
  assert.equal(gas.calls.length, 1);
  assert.deepEqual([a.status, b.status].sort(), [S.COMMIT_FAILED, S.GAS_RECONCILE_REQUIRED].sort());
  // and the same submitter hit twice at once
  const g2 = await makeGift(); const sub = submitterFor(chain, gas, ledgerOn(createMemoryGiftGasStore()));
  await Promise.all([run(sub, g2), run(sub, g2), run(sub, g2)]);
  assert.equal(gas.calls.length, 2);
});

await check("T6. reverted / dropped delivery: UNKNOWN, no automatic redelivery; a later on-chain proof reconciles to CONFIRMED", async () => {
  const { chain, admin } = fakeChain(); const store = createMemoryGiftGasStore(); const g = await makeGift();
  const gas = gasLayer(admin, { mutate: () => ({ status: "reverted", credit: false }) });
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(store)), g)).status, S.GAS_DELIVERY_UNVERIFIED);
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(store)), g)).status, S.GAS_RECONCILE_REQUIRED);
  assert.equal(gas.calls.length, 1);
  // dropped-then-visible: hash hidden from chain, then appears
  const g2 = await makeGift(); const gas2 = gasLayer(admin, { mutate: () => ({ hidden: true, credit: false }) }); const store2 = createMemoryGiftGasStore();
  const first = await run(submitterFor(chain, gas2, ledgerOn(store2)), g2);
  assert.equal(first.status, S.GAS_DELIVERY_UNVERIFIED);
  assert.equal((await run(submitterFor(chain, gas2, ledgerOn(store2)), g2)).status, S.GAS_RECONCILE_REQUIRED);
  const t = admin.txs.get(first.txHashes.delivery); t.hidden = false; t.status = "success";
  const resumed = await run(submitterFor(chain, gas2, ledgerOn(store2)), g2);
  assert.equal(resumed.status, S.GAS_INSUFFICIENT_AFTER_DELIVERY); // balance was never credited in this fixture; the point: no redelivery
  assert.equal(gas2.calls.length, 1);
  assert.equal(store2.snapshot().entries[g2.giftId.toLowerCase()].state, "CONFIRMED");
});

await check("T11. ledger corrupt / unavailable / write fails => fail closed with 0 deliveries; a failed reserve leaves nothing reserved", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const g = await makeGift();
  const s1 = createMemoryGiftGasStore(); s1.ctl.unavailable = true;
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(s1)), g)).status, S.GAS_LEDGER_UNAVAILABLE);
  const s2 = createMemoryGiftGasStore(); s2.corrupt();
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(s2)), g)).status, S.GAS_LEDGER_UNAVAILABLE);
  const s3 = createMemoryGiftGasStore(); s3.ctl.failSaves = 1;
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(s3)), g)).status, S.GAS_LEDGER_UNAVAILABLE);
  assert.equal(s3.snapshot(), null);
  assert.equal(gas.calls.length, 0);
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(s3)), g)).status, S.COMMIT_FAILED); // recovered store works
  assert.equal(gas.calls.length, 1);
  // schema-invalid stored entry (wrong shape) is corrupt too
  const s4 = createMemoryGiftGasStore(); await s4.transact((d) => ({ write: true, data: { version: 1, entries: { [g.giftId.toLowerCase()]: { giftId: g.giftId.toLowerCase(), to: "nope" } } } }));
  assert.equal((await run(submitterFor(chain, gas, ledgerOn(s4)), g)).status, S.GAS_LEDGER_UNAVAILABLE);
  assert.equal(gas.calls.length, 1);
  // markSent write failing after a real broadcast: reported, and still never a second delivery
  const g5 = await makeGift(); const s5 = createMemoryGiftGasStore(); const gas5 = gasLayer(admin);
  const sub5 = submitterFor(chain, gas5, ledgerOn(s5));
  const origTransact = s5.transact.bind(s5); let n = 0;
  s5.transact = (fn) => { n += 1; if (n === 2) s5.ctl.failSaves = 1; return origTransact(fn); }; // 2nd tx = markSent
  assert.equal((await run(sub5, g5)).status, S.GAS_LEDGER_UNAVAILABLE);
  assert.equal((await run(submitterFor(chain, gas5, ledgerOn(s5)), g5)).status, S.GAS_RECONCILE_REQUIRED);
  assert.equal(gas5.calls.length, 1);
});

await check("G1. deliver is never called without a reservation: gas layer sees exactly {allowanceRef,to,valueWei}; call count tracks ledger entries", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const store = createMemoryGiftGasStore(); const g = await makeGift();
  await run(submitterFor(chain, gas, ledgerOn(store)), g);
  assert.deepEqual(gas.calls[0].keys, ["allowanceRef", "to", "valueWei"]);
  assert.equal(gas.calls[0].allowanceRef, g.giftId);
  assert.equal(gas.calls[0].valueWei, deliverWeiOf());
  const entry = store.snapshot().entries[g.giftId.toLowerCase()];
  assert.equal(entry.to, lower(PIGGY.address)); assert.equal(entry.valueWei, gas.calls[0].valueWei.toString());
  const text = JSON.stringify(store.snapshot());
  assert.equal(text.includes(g.token), false); assert.equal(/salt|preimage|token/i.test(text), false);
});

await check("G2. no injected ledger => per-submitter in-memory ledger still gates (NOT durable: release blocker)", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const g = await makeGift();
  const sub = submitterFor(chain, gas);
  assert.ok(sub);
  await run(sub, g); await run(sub, g); await run(sub, g);
  assert.equal(gas.calls.length, 1);
  assert.equal((await run(sub, g, PIGGY2)).status, S.GAS_BOUND_TO_OTHER_PIGGY);
});

await check("G3. malformed giftGasLedger => submitter is null; ledger API refuses bad input and reports reasons", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin);
  assert.equal(submitterFor(chain, gas, {}), null);
  assert.equal(submitterFor(chain, gas, { reserve() {} }), null);
  assert.equal(createGiftGasLedger({ store: null, deviceId: "x" }), null);
  assert.equal(createGiftGasLedger({ store: createMemoryGiftGasStore(), deviceId: "" }), null);
  const led = ledgerOn(createMemoryGiftGasStore());
  const gid = `0x${"0a".repeat(32)}`;
  assert.equal((await led.reserve("nope", PIGGY.address, 1n)).reason, R.BAD_INPUT);
  assert.equal((await led.reserve(gid, PIGGY.address, 0n)).reason, R.BAD_INPUT);
  assert.equal((await led.reserve(gid, PIGGY.address, 5n)).ok, true);
  assert.equal((await led.reserve(gid, PIGGY2.address, 5n)).reason, R.BOUND_TO_OTHER_DESTINATION);
  assert.equal((await led.reserve(gid, PIGGY.address, 5n)).reason, R.MUST_RECONCILE);
  assert.equal((await led.reconcile(gid, {})).reason, R.MUST_RECONCILE);
  assert.equal((await led.confirm(gid, `0x${"33".repeat(32)}`)).ok, true);
  assert.equal((await led.markSent(gid, `0x${"44".repeat(32)}`)).reason, R.BAD_STATE);
  assert.equal((await led.reserve(gid, PIGGY.address, 5n)).reason, R.ALREADY_DELIVERED);
  assert.equal((await led.get(`0x${"0b".repeat(32)}`)).reason, R.NOT_FOUND);
});

await check("G4. browser store: needs navigator.locks (null without); round-trips; read-back failure and bad JSON fail closed", async () => {
  const mem = new Map(); const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const locks = { request: async (_name, fn) => fn() };
  assert.equal(createBrowserGiftGasStore(storage, { locks: null }), null);
  assert.equal(createBrowserGiftGasStore(storage, { locks: {} }), null);
  assert.equal(createBrowserGiftGasStore(storage, { locks: { request: "x" } }), null);
  const store = createBrowserGiftGasStore(storage, { locks });
  const gid = `0x${"0c".repeat(32)}`;
  assert.equal((await ledgerOn(store).reserve(gid, PIGGY.address, 3n)).ok, true);
  assert.equal((await ledgerOn(createBrowserGiftGasStore(storage, { locks })).reserve(gid, PIGGY.address, 3n)).reason, R.MUST_RECONCILE);
  assert.equal(createBrowserGiftGasStore(null, { locks }), null);
  const dropping = createBrowserGiftGasStore({ getItem: () => null, setItem: () => {} }, { locks });
  assert.equal((await ledgerOn(dropping).reserve(gid, PIGGY.address, 3n)).reason, R.LEDGER_UNAVAILABLE); // write not read back
  const bad = createBrowserGiftGasStore({ getItem: () => "{oops", setItem: () => {} }, { locks });
  assert.equal((await ledgerOn(bad).reserve(gid, PIGGY.address, 3n)).reason, R.LEDGER_UNAVAILABLE);
});

await check("F1. a misbehaving injected ledger can never cause a delivery: ok without reserved:true, ALREADY_DELIVERED/reconcile-ok without a valid hash => 0 deliveries", async () => {
  const { chain, admin } = fakeChain(); const gas = gasLayer(admin); const g = await makeGift();
  const base = { markSent: async () => ({ ok: true }), confirm: async () => ({ ok: true }), markUnknown: async () => ({ ok: true }) };
  const cases = {
    "ok without reserved": { ...base, reserve: async () => ({ ok: true }), reconcile: async () => ({ ok: false, reason: R.MUST_RECONCILE }) },
    "reserved:false": { ...base, reserve: async () => ({ ok: true, reserved: false }), reconcile: async () => ({ ok: false }) },
    "undefined reserve": { ...base, reserve: async () => undefined, reconcile: async () => ({ ok: false }) },
    "already_delivered, no hash": { ...base, reserve: async () => ({ ok: false, reason: R.ALREADY_DELIVERED }), reconcile: async () => ({ ok: false }) },
    "already_delivered, bad hash": { ...base, reserve: async () => ({ ok: false, reason: R.ALREADY_DELIVERED, txHash: "0x12" }), reconcile: async () => ({ ok: false }) },
    "reconcile ok, no hash": { ...base, reserve: async () => ({ ok: false, reason: R.MUST_RECONCILE }), reconcile: async () => ({ ok: true }) },
    "reconcile ok, bad hash": { ...base, reserve: async () => ({ ok: false, reason: R.MUST_RECONCILE }), reconcile: async () => ({ ok: true, txHash: "nope" }) },
    "reconcile undefined": { ...base, reserve: async () => ({ ok: false, reason: R.MUST_RECONCILE }), reconcile: async () => undefined },
  };
  for (const [label, led] of Object.entries(cases)) {
    const out = await run(submitterFor(chain, gas, led), g);
    assert.ok([S.GAS_LEDGER_UNAVAILABLE, S.GAS_RECONCILE_REQUIRED].includes(out.status), `${label}: ${out.status}`);
    assert.equal(gas.calls.length, 0, label);
  }
});

await check("S1. scope: main.js Gift transports stay null; ledger module has no network/signing/relayer import", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /const GIFT_CLAIM_SUBMIT_CONFIG = null;/);
  assert.match(main, /const GIFT_RECORD_CONFIG = null;/);
  const src = readFileSync(new URL("../src/gift-gas-ledger.js", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|signTransaction|^import\s|process\.env/m.test(code), false);
  const entry = readFileSync(new URL("../src/gift-claim-entry.js", import.meta.url), "utf8");
  assert.match(entry, /gasDelivery\.deliver\(Object\.freeze\(\{ allowanceRef: giftId, to: recipient, valueWei: deliverWei \}\)\)/);
});

console.log(`\n${pass}/${pass} PASS`);
