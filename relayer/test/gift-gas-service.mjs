// [A-869] gift-gas-service + policy + reconcile tool. Fake chain, fake signer, no network, no keys, no env.
// node relayer/test/gift-gas-service.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { keccak256, parseTransaction, serializeTransaction } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openGiftGasLedger } from "../src/gift-gas-ledger.mjs";
import { createGiftGasPolicy, validateGiftGasRequest } from "../src/gift-gas-policy.mjs";
import { createGiftGasService } from "../src/gift-gas-service.mjs";
import { reconcileLedger } from "../tools/gift-gas-reconcile.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "a869s-"));
let n = 0;
const fresh = () => path.join(dir, `d${n}`, `l${n++}.json`);
const gid = (i) => `0x${i.toString(16).padStart(64, "0")}`;
// in-memory throwaway keys (never read from env or disk)
const ACCOUNT = privateKeyToAccount(generatePrivateKey());
const FOREIGN = privateKeyToAccount(generatePrivateKey());
const RELAYER = ACCOUNT.address.toLowerCase();
const SENDER = "0x00000000000000000000000000000000000000c3";
const TO = "0x00000000000000000000000000000000000000a1";
const E18 = 10n ** 18n;
const CFG = { valueWei: E18 / 100n, minGiftWei: E18 / 10n, perSenderMaxCount: 3, perSenderMaxWei: E18 / 20n, globalMaxCount: 5, globalMaxWei: E18 / 10n,
  relayerMinBalanceWei: E18, maxGasPriceWei: 200n * 10n ** 9n, chainId: 10143, relayerAddress: RELAYER };
const POLICY = createGiftGasPolicy(CFG);
let pass = 0;
const test = async (label, fn) => { await fn(); console.log(`PASS  ${label}`); pass += 1; };

// ---------- fakes ----------
function fakeChain(o = {}) {
  const c = {
    gifts: new Map(), balance: 10n * E18, pendingNonce: 5n, latestNonce: 5n, gasPrice: 50n * 10n ** 9n,
    broadcasts: [], receipts: new Map(), failBroadcast: false, giftLookups: 0,
    async getGift(id) { c.giftLookups += 1; if (c.throwGift) throw new Error("rpc down secret-token"); return c.gifts.get(id) ?? { exists: false }; },
    async getBalance() { return c.balance; },
    async getPendingNonce() { return c.pendingNonce; },
    async getLatestNonce() { return c.latestNonce; },
    async getGasPrice() { return c.gasPrice; },
    async broadcast(raw) { c.broadcasts.push(raw); if (c.failBroadcast) throw new Error("net down"); return keccak256(raw); },
    async getReceipt(h) { return c.receipts.get(h) ?? null; },
    addGift(i, over = {}) { c.gifts.set(gid(i), { exists: true, claimed: false, refunded: false, expired: false, sender: SENDER, amountWei: E18, ...over }); },
    mine(raw, over = {}) { // include tx into a "block"
      c.receipts.set(keccak256(raw), { status: "success", from: RELAYER, to: c.lastTo, value: CFG.valueWei, input: "0x", ...over });
    },
    ...o,
  };
  return c;
}
function fakeSigner() {
  const s = { calls: [], fail: false, account: ACCOUNT,
    async signNativeTransfer({ to, valueWei, nonce, gasLimit, gasPrice, chainId }) {
      s.calls.push({ to, nonce }); if (s.fail) throw new Error("hsm down secret-key");
      const rawTx = await ACCOUNT.signTransaction({ type: "legacy", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, gasPrice });
      return { rawTx, txHash: keccak256(rawTx) };
    } };
  return s;
}
const mk = (over = {}) => {
  const p = over.path ?? fresh();
  const ledger = over.ledger ?? openGiftGasLedger(p, over.ledgerOpts ?? {});
  const chain = over.chain ?? fakeChain(); const signer = over.signer ?? fakeSigner(); const logs = [];
  const svc = createGiftGasService({ ledger, policy: "policy" in over ? over.policy : POLICY, chain, signer, log: (m) => logs.push(m) });
  return { p, ledger, chain, signer, logs, svc };
};
const req = (i, to = TO) => ({ giftId: gid(i), to });
const NA = { status: 409, body: { ok: false, error: "not_available" } };

// ---------- policy ----------
await test("P1. policy fails closed when any budget/field is unset or inconsistent; valueWei is server-derived", async () => {
  assert.ok(POLICY); assert.equal(POLICY.valueWei, CFG.valueWei);
  for (const k of Object.keys(CFG)) { const c = { ...CFG }; delete c[k]; assert.equal(createGiftGasPolicy(c), null, k); }
  assert.equal(createGiftGasPolicy({ ...CFG, globalMaxWei: 0 }), null);
  assert.equal(createGiftGasPolicy({ ...CFG, perSenderMaxWei: 1 }), null); // below one gift
  assert.equal(createGiftGasPolicy({ ...CFG, relayerAddress: "nope" }), null);
  assert.equal(createGiftGasPolicy(null), null);
});
await test("P2. request shape: exactly {giftId,to}; uppercase giftId, extra fields (amount/token/allowanceRef), zero address refused", async () => {
  assert.equal(validateGiftGasRequest(req(1)).ok, true);
  assert.equal(validateGiftGasRequest({ giftId: `0x${"AB".repeat(32)}`, to: TO }).ok, false);
  for (const extra of ["valueWei", "amount", "token", "allowanceRef"]) assert.equal(validateGiftGasRequest({ ...req(1), [extra]: "1" }).ok, false, extra);
  assert.equal(validateGiftGasRequest({ giftId: gid(1) }).ok, false);
  assert.equal(validateGiftGasRequest({ giftId: gid(1), to: `0x${"0".repeat(40)}` }).ok, false);
  assert.equal(validateGiftGasRequest([]).ok, false); assert.equal(validateGiftGasRequest(null).ok, false);
});

// ---------- service ----------
await test("S1. happy path: rawTx+nonce durable BEFORE broadcast; server-derived value; confirmed on matching receipt", async () => {
  const t = mk(); t.chain.addGift(1);
  let durableAtBroadcast = null;
  const origBroadcast = t.chain.broadcast;
  t.chain.broadcast = async (raw) => { const e = t.ledger.get(gid(1)); durableAtBroadcast = JSON.parse(readFileSync(t.p, "utf8")).entries[gid(1)]; assert.equal(e.rawTx, raw); return origBroadcast(raw); };
  t.chain.lastTo = TO;
  const r = await t.svc.handle(req(1));
  assert.equal(r.status, 200); assert.equal(r.body.state, "SENT"); assert.equal(r.body.valueWei, CFG.valueWei.toString());
  assert.equal(durableAtBroadcast.state, "SENT"); assert.equal(durableAtBroadcast.nonce, "5"); assert.ok(durableAtBroadcast.rawTx.startsWith("0x"));
  t.chain.mine(t.chain.broadcasts[0]);
  const r2 = await t.svc.handle(req(1)); // re-request = record, advanced to CONFIRMED
  assert.equal(r2.body.state, "CONFIRMED"); assert.equal(t.signer.calls.length, 1); assert.equal(t.chain.broadcasts.length, 1);
  t.ledger.close();
});
await test("S2. exactly once under concurrency: 25 parallel requests for one giftId => 1 reserve, 1 sign, 1 broadcast", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.lastTo = TO;
  const rs = await Promise.all(Array.from({ length: 25 }, () => t.svc.handle(req(1))));
  assert.ok(rs.every((r) => r.status === 200)); assert.equal(t.signer.calls.length, 1); assert.equal(t.ledger.count(), 1);
  assert.equal(new Set(t.chain.broadcasts).size, 1);
  t.ledger.close();
});
await test("S3. concurrency across gifts: unique nonces, global cap holds exactly (5), extras get uniform not_available", async () => {
  const t = mk(); for (let i = 1; i <= 12; i += 1) t.chain.addGift(i, { sender: `0x${(0x100 + i).toString(16).padStart(40, "0")}` });
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => t.svc.handle(req(i + 1))));
  assert.equal(rs.filter((r) => r.status === 200).length, 5);
  assert.deepEqual(rs.filter((r) => r.status !== 200).map((r) => r.body), Array(7).fill(NA.body));
  const nonces = t.ledger.list().map((e) => e.nonce); assert.equal(new Set(nonces).size, 5); assert.deepEqual([...nonces].sort(), ["5", "6", "7", "8", "9"]);
  assert.equal(t.signer.calls.length, 5);
  t.ledger.close();
});
await test("S4. per-sender cap (3) enforced; another sender unaffected", async () => {
  const t = mk(); for (let i = 1; i <= 5; i += 1) t.chain.addGift(i);
  t.chain.addGift(9, { sender: "0x00000000000000000000000000000000000000d4" });
  const rs = []; for (let i = 1; i <= 5; i += 1) rs.push((await t.svc.handle(req(i))).status);
  assert.deepEqual(rs, [200, 200, 200, 409, 409]);
  assert.equal((await t.svc.handle(req(9))).status, 200);
  t.ledger.close();
});
await test("S5. uniform responses: unknown / claimed / refunded / expired / too small / sender==to / other destination are IDENTICAL", async () => {
  const t = mk();
  t.chain.addGift(1, { claimed: true }); t.chain.addGift(2, { refunded: true }); t.chain.addGift(3, { expired: true });
  t.chain.addGift(4, { amountWei: 1n }); t.chain.addGift(5, { sender: TO }); t.chain.addGift(6, { exists: undefined }); t.chain.addGift(7, { claimed: undefined });
  t.chain.addGift(8); t.chain.lastTo = TO; await t.svc.handle(req(8)); // delivered to TO
  const other = "0x00000000000000000000000000000000000000b2";
  const rs = [req(99), req(1), req(2), req(3), req(4), req(5), req(6), req(7), req(8, other)];
  for (const body of rs) assert.deepEqual(await t.svc.handle(body), NA, JSON.stringify(body));
  assert.equal(t.signer.calls.length, 1); // only gift 8
  t.ledger.close();
});
await test("S6. same giftId, different destination: refused, nothing signed (bound)", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.lastTo = TO;
  await t.svc.handle(req(1));
  assert.deepEqual(await t.svc.handle(req(1, "0x00000000000000000000000000000000000000b2")), NA);
  assert.equal(t.signer.calls.length, 1);
  t.ledger.close();
});
await test("S7. policy unset / ledger cap unset => 503 unavailable, zero sign, zero broadcast", async () => {
  const t = mk({ policy: null }); t.chain.addGift(1);
  const r = await t.svc.handle(req(1));
  assert.equal(r.status, 503); assert.equal(t.signer.calls.length, 0); assert.equal(t.chain.broadcasts.length, 0); assert.equal(t.ledger.count(), 0);
  t.ledger.close();
});
await test("S8. relayer-wide guards (gas price over cap, low balance, rpc error) => 503 BEFORE any reserve; same answer for real and fake gifts", async () => {
  const t = mk(); t.chain.addGift(1);
  t.chain.gasPrice = 10n ** 12n; for (const i of [1, 77]) assert.equal((await t.svc.handle(req(i))).status, 503);
  t.chain.gasPrice = 1n; t.chain.balance = 1n; for (const i of [1, 77]) assert.equal((await t.svc.handle(req(i))).status, 503);
  t.chain.balance = 10n * E18; t.chain.throwGift = true; assert.equal((await t.svc.handle(req(1))).status, 503);
  assert.equal(t.ledger.count(), 0); assert.equal(t.signer.calls.length, 0);
  t.ledger.close();
});
await test("S9. bad body => 400 and no chain lookup (no enumeration oracle in shape errors)", async () => {
  const t = mk(); t.chain.addGift(1);
  for (const b of [null, {}, { giftId: gid(1) }, { ...req(1), valueWei: "1" }, { giftId: "0xAB", to: TO }]) assert.equal((await t.svc.handle(b)).status, 400);
  assert.equal(t.chain.giftLookups, 0);
  t.ledger.close();
});

// ---------- crash matrix ----------
await test("C1. crash after reserve, before sign (signer dies): PENDING->UNKNOWN(sign_failed), nothing signed, never auto-retried", async () => {
  const t = mk(); t.chain.addGift(1); t.signer.fail = true;
  assert.equal((await t.svc.handle(req(1))).status, 503);
  const e = t.ledger.get(gid(1)); assert.equal(e.state, "UNKNOWN"); assert.equal(e.rawTx, null);
  t.signer.fail = false; t.chain.lastTo = TO;
  assert.equal((await t.svc.handle(req(1))).body.state, "UNKNOWN"); assert.equal(t.signer.calls.length, 1); assert.equal(t.chain.broadcasts.length, 0);
  t.ledger.close();
});
await test("C2. durable write of rawTx fails (rollback-safe fault): NO broadcast, entry PENDING, rawTx not stored, no re-sign on retry", async () => {
  let arm = false; const fsReal = await import("node:fs");
  const io = { renameSync: (...a) => { if (arm) throw new Error("EIO"); return fsReal.renameSync(...a); } };
  const t = mk({ ledgerOpts: { io } }); t.chain.addGift(1);
  const origSign = t.signer.signNativeTransfer.bind(t.signer);
  t.signer.signNativeTransfer = async (a) => { arm = true; return origSign(a); }; // fault hits recordSigned's flush
  assert.equal((await t.svc.handle(req(1))).status, 503);
  assert.equal(t.chain.broadcasts.length, 0); assert.equal(t.ledger.get(gid(1)).state, "PENDING"); assert.equal(t.ledger.get(gid(1)).rawTx, null);
  arm = false; t.chain.lastTo = TO;
  assert.equal((await t.svc.handle(req(1))).body.state, "PENDING"); assert.equal(t.signer.calls.length, 1); assert.equal(t.chain.broadcasts.length, 0);
  t.ledger.close();
});
await test("C3. dir-fsync fault on rawTx write => fail-stop: no broadcast; restart finds SENT and rebroadcasts the SAME bytes only", async () => {
  let arm = false; let c = 0; const fsReal = await import("node:fs");
  const io = { fsyncSync: (fd) => { if (arm && ++c === 2) throw new Error("EIO"); return fsReal.fsyncSync(fd); } };
  const t = mk({ ledgerOpts: { io } }); t.chain.addGift(1); t.chain.lastTo = TO;
  const origSign = t.signer.signNativeTransfer.bind(t.signer);
  t.signer.signNativeTransfer = async (a) => { arm = true; return origSign(a); };
  assert.equal((await t.svc.handle(req(1))).status, 503); assert.equal(t.chain.broadcasts.length, 0); assert.equal(t.ledger.isFailStopped(), true);
  t.ledger.close();
  const l2 = openGiftGasLedger(t.p); const stored = l2.get(gid(1)).rawTx; assert.equal(l2.get(gid(1)).state, "SENT");
  const t2 = mk({ ledger: l2, chain: t.chain, signer: t.signer });
  const rec = await t2.svc.recover();
  assert.equal(rec.sent, 1); assert.deepEqual(t.chain.broadcasts, [stored]); assert.equal(t.signer.calls.length, 1);
  l2.close();
});
await test("C4. crash after durable rawTx, before/while broadcast: restart rebroadcasts same bytes; receipt => CONFIRMED; signer never called again", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.lastTo = TO; t.chain.failBroadcast = true;
  const r = await t.svc.handle(req(1));
  assert.equal(r.body.state, "SENT");
  const stored = t.ledger.get(gid(1)).rawTx; t.ledger.close(); // "crash"
  t.chain.failBroadcast = false; t.chain.broadcasts.length = 0;
  const l2 = openGiftGasLedger(t.p); const t2 = mk({ ledger: l2, chain: t.chain, signer: t.signer });
  await t2.svc.recover(); assert.deepEqual(t.chain.broadcasts, [stored]);
  t.chain.mine(stored); const rec = await t2.svc.recover();
  assert.equal(rec.confirmed, 1); assert.equal(l2.get(gid(1)).state, "CONFIRMED"); assert.equal(t.signer.calls.length, 1);
  l2.close();
});
await test("C5. broadcast landed but process died before confirm: restart sees receipt => CONFIRMED, zero re-sign, zero extra delivery", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.lastTo = TO;
  await t.svc.handle(req(1)); const raw = t.chain.broadcasts[0]; t.chain.mine(raw); t.ledger.close();
  const l2 = openGiftGasLedger(t.p); const t2 = mk({ ledger: l2, chain: t.chain, signer: t.signer });
  assert.equal((await t2.svc.recover()).confirmed, 1); assert.equal((await t2.svc.handle(req(1))).body.state, "CONFIRMED");
  assert.equal(t.signer.calls.length, 1); assert.equal(t.chain.broadcasts.length, 1);
  l2.close();
});
await test("C6. nonce consumed by another tx / revert / receipt mismatch => UNKNOWN (no auto re-sign); UNKNOWN->CONFIRMED only via explicit resolveUnknown", async () => {
  const t = mk(); for (const i of [1, 2, 3]) t.chain.addGift(i, { sender: `0x${(0x200 + i).toString(16).padStart(40, "0")}` }); t.chain.lastTo = TO;
  for (const i of [1, 2, 3]) await t.svc.handle(req(i));
  const [r1, r2, r3] = t.chain.broadcasts;
  t.chain.latestNonce = 6n; // nonce 5 (gift 1) consumed, but no receipt for our hash
  t.chain.mine(r2, { status: "reverted" }); t.chain.mine(r3, { value: 1n });
  await t.svc.recover();
  assert.deepEqual([1, 2, 3].map((i) => t.ledger.get(gid(i)).state), ["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  assert.deepEqual([1, 2, 3].map((i) => t.ledger.get(gid(i)).reason), ["nonce_consumed", "reverted", "receipt_mismatch"]);
  assert.equal(t.signer.calls.length, 3); const bc = t.chain.broadcasts.length;
  await t.svc.recover(); await t.svc.handle(req(1)); assert.equal(t.chain.broadcasts.length, bc); // UNKNOWN: zero sends
  assert.equal(await t.svc.resolveUnknown(gid(2)), false); // reverted => stays UNKNOWN
  t.chain.mine(r1); assert.equal(await t.svc.resolveUnknown(gid(1)), true); // our tx did land after all
  assert.equal(t.ledger.get(gid(1)).state, "CONFIRMED");
  t.ledger.close();
});
await test("C7. nonce allocation never reuses a nonce held by a ledger entry even if chain nonce lags", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.addGift(2, { sender: "0x00000000000000000000000000000000000000d4" });
  await t.svc.handle(req(1)); t.chain.pendingNonce = 5n; // RPC lag: still reports 5
  await t.svc.handle(req(2));
  assert.deepEqual(t.ledger.list().map((e) => e.nonce).sort(), ["5", "6"]);
  t.ledger.close();
});
await test("C8. second process cannot open the ledger while the service holds it (LEDGER_LOCKED)", async () => {
  const t = mk(); assert.throws(() => openGiftGasLedger(t.p), /LEDGER_LOCKED/); t.ledger.close();
});
await test("C9. signer returning bad bytes is rejected, never stored or broadcast: wrong to/value/nonce/hash/chain, foreign key, unsigned, eip7702, missing gas, eip1559 fee over cap, access list, eip2930", async () => {
  const tweaks = {
    to: {}, value: {}, nonce: {}, hash: {}, chain: {}, foreign: {}, unsigned: {}, eip7702: {}, nogas: {}, hifee: {}, prio: {}, accesslist: {}, eip2930: {},
  };
  for (const tweak of Object.keys(tweaks)) {
    const t = mk(); t.chain.addGift(1); let produced = false;
    t.signer.signNativeTransfer = async ({ to, valueWei, nonce, gasLimit, gasPrice, chainId }) => {
      const base = { type: "legacy", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, gasPrice };
      let tx = base; let acct = ACCOUNT; let unsigned = false;
      if (tweak === "to") tx = { ...base, to: "0x00000000000000000000000000000000000000e9" };
      if (tweak === "value") tx = { ...base, value: valueWei * 2n };
      if (tweak === "nonce") tx = { ...base, nonce: Number(nonce) + 1 };
      if (tweak === "chain") tx = { ...base, chainId: 1 };
      if (tweak === "foreign") acct = FOREIGN;
      if (tweak === "unsigned") unsigned = true;
      if (tweak === "nogas") { tx = { ...base }; delete tx.gas; }
      if (tweak === "hifee") tx = { ...base, gasPrice: 10n ** 13n };
      if (tweak === "prio") tx = { type: "eip1559", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, maxFeePerGas: 10n ** 13n, maxPriorityFeePerGas: 10n ** 13n }; // priority <= maxFee by construction, so both exceed the cap
      if (tweak === "accesslist") tx = { type: "eip1559", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, maxFeePerGas: gasPrice, maxPriorityFeePerGas: 1n, accessList: [{ address: "0x00000000000000000000000000000000000000e9", storageKeys: [] }] };
      if (tweak === "eip2930") tx = { ...base, type: "eip2930", accessList: [] };
      if (tweak === "eip7702") tx = { type: "eip7702", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, maxFeePerGas: gasPrice, maxPriorityFeePerGas: 1n,
        authorizationList: [{ chainId, address: "0x00000000000000000000000000000000000000e9", nonce: 0, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, yParity: 0 }] };
      const rawTx = unsigned ? serializeTransaction(tx) : await acct.signTransaction(tx);
      produced = true; // bytes really were produced, so rejection is by verification, not by a signing error
      return { rawTx, txHash: tweak === "hash" ? `0x${"00".repeat(32)}` : keccak256(rawTx) };
    };
    assert.equal((await t.svc.handle(req(1))).status, 503, tweak); assert.equal(produced, true, `${tweak}: signer produced bytes`);
    assert.equal(t.chain.broadcasts.length, 0, tweak); assert.equal(t.ledger.get(gid(1)).rawTx, null, tweak); assert.equal(t.ledger.get(gid(1)).state, "UNKNOWN", tweak);
    t.ledger.close();
  }
  // positive control: a well-formed eip1559 tx signed by the relayer key is accepted
  const t = mk(); t.chain.addGift(1); t.chain.lastTo = TO;
  t.signer.signNativeTransfer = async ({ to, valueWei, nonce, gasLimit, gasPrice, chainId }) => {
    const rawTx = await ACCOUNT.signTransaction({ type: "eip1559", chainId, to, value: valueWei, nonce: Number(nonce), gas: gasLimit, maxFeePerGas: gasPrice, maxPriorityFeePerGas: 1n });
    return { rawTx, txHash: keccak256(rawTx) };
  };
  assert.equal((await t.svc.handle(req(1))).status, 200); assert.equal(t.chain.broadcasts.length, 1);
  t.ledger.close();
});
await test("F1. fail-stop gate: after dir-fsync failure, retry and recover() make ZERO broadcasts and answer 503; resolveUnknown refuses", async () => {
  let arm = false; let c = 0; const fsReal = await import("node:fs");
  const io = { fsyncSync: (fd) => { if (arm && ++c === 2) throw new Error("EIO"); return fsReal.fsyncSync(fd); } };
  const t = mk({ ledgerOpts: { io } }); t.chain.addGift(1); t.chain.lastTo = TO;
  const origSign = t.signer.signNativeTransfer.bind(t.signer);
  t.signer.signNativeTransfer = async (a) => { arm = true; return origSign(a); };
  assert.equal((await t.svc.handle(req(1))).status, 503); assert.equal(t.ledger.isFailStopped(), true);
  assert.equal((await t.svc.handle(req(1))).status, 503);
  assert.equal((await t.svc.handle(req(2))).status, 503);
  const rec = await t.svc.recover(); assert.equal(rec.failStopped, true);
  assert.equal(await t.svc.resolveUnknown(gid(1)), false);
  assert.equal(t.chain.broadcasts.length, 0); assert.equal(t.signer.calls.length, 1);
  t.ledger.close();
});
await test("L1. logs never contain rawTx, key/token-bearing error text, or full addresses; only short giftId prefix", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.addGift(2, { sender: "0x00000000000000000000000000000000000000d4" }); t.chain.addGift(3, { sender: "0x00000000000000000000000000000000000000d5" });
  t.chain.lastTo = TO; t.signer.fail = true; await t.svc.handle(req(1)); t.signer.fail = false;
  t.chain.failBroadcast = true; await t.svc.handle(req(2)); t.chain.failBroadcast = false; t.chain.throwGift = true; await t.svc.handle(req(3));
  const raw = t.ledger.get(gid(2)).rawTx; const all = t.logs.join("\n");
  assert.ok(t.logs.length >= 3, all);
  for (const bad of [raw.slice(0, 40), "secret-key", "secret-token", "hsm down", TO, gid(1)]) assert.equal(all.includes(bad), false, bad);
  t.ledger.close();
});

// ---------- reconcile tool ----------
await test("T1. reconcile tool: dry-run writes nothing; report hides rawTx; --apply only appends audit; entries identical after", async () => {
  const t = mk(); for (const i of [1, 2, 3, 4]) t.chain.addGift(i, { sender: `0x${(0x300 + i).toString(16).padStart(40, "0")}` }); t.chain.lastTo = TO;
  await t.svc.handle(req(1)); t.chain.mine(t.chain.broadcasts[0]); await t.svc.recover(); // CONFIRMED
  t.chain.failBroadcast = true; await t.svc.handle(req(2)); t.chain.failBroadcast = false; // SENT
  t.signer.fail = true; await t.svc.handle(req(3)); t.signer.fail = false; // UNKNOWN
  t.ledger.reserve(gid(4), TO, 1n, SENDER, POLICY.limits); // PENDING
  t.ledger.close();
  const before = readFileSync(t.p, "utf8");
  const rep = reconcileLedger(t.p);
  assert.equal(readFileSync(t.p, "utf8"), before); // dry run: byte identical
  assert.deepEqual(rep.counts, { CONFIRMED: 1, SENT: 1, UNKNOWN: 1, PENDING: 1 });
  const raw = JSON.parse(before).entries[gid(2)].rawTx;
  assert.equal(JSON.stringify(rep).includes(raw), false);
  assert.equal(rep.entries.find((e) => e.state === "SENT").rawTxHashMatches, true);
  const entriesBefore = JSON.stringify(JSON.parse(before).entries);
  const rep2 = reconcileLedger(t.p, { apply: [{ giftId: gid(4), action: "VOID_REVIEWED", note: "nonce unused, no transfer found" }, { giftId: null, action: "NOTE", note: "g4 review" }] });
  assert.equal(rep2.auditAppended, 2);
  const after = JSON.parse(readFileSync(t.p, "utf8"));
  assert.equal(JSON.stringify(after.entries), entriesBefore); // no state change, no deletion
  assert.ok(after.audit.length >= 2 && after.audit.some((a) => a.action === "VOID_REVIEWED"));
  assert.equal(after.entries[gid(4)].state, "PENDING"); // VOID is a record, not a delete/transition
  for (const bad of [{ action: "AUTO_UNKNOWN" }, { action: "RESOLVED_CONFIRMED" }, { action: "DELETE" }]) assert.throws(() => reconcileLedger(t.p, { apply: [{ giftId: gid(4), note: "x", ...bad }] }));
  assert.throws(() => reconcileLedger(t.p, { apply: [{ giftId: gid(4), action: "NOTE", note: `0x${"ab".repeat(60)}` }] }), /BAD_AUDIT_NOTE/);
  const missing = path.join(dir, "nodir", "none.json");
  assert.throws(() => reconcileLedger(missing), /LEDGER_DIR_INVALID|LEDGER_MISSING/);
  assert.equal(existsSync(path.dirname(missing)), false); // no mkdir
  assert.throws(() => reconcileLedger(path.join(path.dirname(t.p), "none.json")), /LEDGER_MISSING/);
  const held = openGiftGasLedger(t.p); assert.throws(() => reconcileLedger(t.p), /LEDGER_LOCKED/); held.close(); // refuses while service holds it
});

// ---------- [A-895 P-B] gift enable contract: provably-not-sent 503 + valueWei echo ----------
const NOT_SENT_503 = { status: 503, body: { ok: false, error: "unavailable_not_sent" } };
const AMBIGUOUS_503 = { status: 503, body: { ok: false, error: "unavailable" } };
await test("B1. 503 on every path BEFORE ledger.reserve carries the exact body unavailable_not_sent (policy unset, gas cap, low balance, rpc/gift lookup error, ledger lookup error, fail-stop) and nothing is reserved, signed or broadcast", async () => {
  { const t = mk({ policy: null }); t.chain.addGift(1); assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503); assert.equal(t.ledger.count(), 0); t.ledger.close(); }
  { const t = mk(); t.chain.addGift(1);
    t.chain.gasPrice = 10n ** 12n; assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503);
    t.chain.gasPrice = 1n; t.chain.balance = 1n; assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503);
    t.chain.balance = 10n * E18; t.chain.throwGift = true; assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503);
    t.chain.throwGift = false; const og = t.chain.getGasPrice; t.chain.getGasPrice = async () => { throw new Error("rpc down"); }; assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503); t.chain.getGasPrice = og;
    assert.equal(t.ledger.count(), 0); assert.equal(t.signer.calls.length, 0); assert.equal(t.chain.broadcasts.length, 0); t.ledger.close(); }
  { const ledger = { get() { throw new Error("disk"); }, isFailStopped: () => false }; const t = mk({ ledger }); assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503); assert.equal(t.signer.calls.length, 0); }
  { const ledger = { get() { return null; }, isFailStopped: () => true }; const t = mk({ ledger }); assert.deepEqual(await t.svc.handle(req(1)), NOT_SENT_503); }
});
await test("B2. 503 on a path AT or AFTER reserve (reserve error, sign failure, durable-write failure, internal error) keeps the ambiguous body unavailable: the client must NOT release", async () => {
  { const t = mk(); t.chain.addGift(1); t.signer.fail = true; assert.deepEqual(await t.svc.handle(req(1)), AMBIGUOUS_503); assert.equal(t.ledger.get(gid(1)).state, "UNKNOWN"); t.ledger.close(); }
  { const real = openGiftGasLedger(fresh()); const ledger = new Proxy(real, { get: (o, k) => (k === "reserve" ? () => { throw new Error("EIO"); } : typeof o[k] === "function" ? o[k].bind(o) : o[k]) });
    const t = mk({ ledger }); t.chain.addGift(1); assert.deepEqual(await t.svc.handle(req(1)), AMBIGUOUS_503); real.close(); }
  { let arm = false; const fsReal = await import("node:fs");
    const io = { renameSync: (...a) => { if (arm) throw new Error("EIO"); return fsReal.renameSync(...a); } };
    const t = mk({ ledgerOpts: { io } }); t.chain.addGift(1);
    const origSign = t.signer.signNativeTransfer.bind(t.signer); t.signer.signNativeTransfer = async (a) => { arm = true; return origSign(a); };
    assert.deepEqual(await t.svc.handle(req(1)), AMBIGUOUS_503); assert.equal(t.chain.broadcasts.length, 0); t.ledger.close(); }
  { const t = mk(); t.chain.addGift(1); t.chain.getReceipt = async () => { throw new Error("x"); }; t.chain.lastTo = TO;
    const first = await t.svc.handle(req(1)); assert.equal(first.status, 200); // receipt lookup failure after broadcast is not a 503
    t.ledger.close(); }
  { const t = mk(); t.chain.addGift(1); const og = t.ledger.get.bind(t.ledger); let n = 0; t.ledger.get = (g) => { n += 1; if (n === 2) throw new Error("post-broadcast read"); return og(g); };
    t.chain.lastTo = TO; const r = await t.svc.handle(req(1)); assert.deepEqual(r, AMBIGUOUS_503); assert.equal(t.chain.broadcasts.length, 1, "broadcast happened: the 503 is ambiguous"); t.ledger.close(); }
});
await test("B3. amount authority: the valueWei echoed in the 200 body is the policy value, equals the value inside the signed+broadcast tx and the ledger entry, and is identical on every later read", async () => {
  const t = mk(); t.chain.addGift(1); t.chain.lastTo = TO;
  const r = await t.svc.handle(req(1));
  assert.equal(r.status, 200);
  assert.equal(r.body.valueWei, CFG.valueWei.toString());
  assert.equal(BigInt(parseTransaction(t.chain.broadcasts[0]).value), BigInt(r.body.valueWei), "echo == the tx value actually broadcast");
  assert.equal(t.ledger.get(gid(1)).valueWei, r.body.valueWei);
  assert.deepEqual(Object.keys(r.body).sort(), ["giftId", "ok", "state", "to", "txHash", "valueWei"]);
  t.chain.mine(t.chain.broadcasts[0]);
  const again = await t.svc.handle(req(1));
  assert.equal(again.body.valueWei, r.body.valueWei);
  t.ledger.close();
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass} PASS`);
