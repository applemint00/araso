// A-663 Second-owned testnet execution PLUMBING PROOF — node part (no network).
//   node app/test/a663-second-execution-adapter.mjs
//
// Per the A-663 Owner correction (_private/ops/INBOX.md, "TESTNET shMON IS PLUMBING PROOF,
// NOT THE SECOND JOB", 2026-10-01): this file proves the reusable Second-owned
// execution/pending/receipt plumbing in second-execution-adapter.js — pending-before-
// broadcast, duplicate-send prevention across reload/reopen, fail-closed permission, a
// truthful testnet-actual receipt/evidence contract, and reconcile -> the existing Second
// receipt bridge. It does NOT test or assume any Second Journey product destination — the
// module under test is never imported by job-feed.js/job-selector.js/Explore/candidates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifySecondSendPending,
  clearSecondSendPending,
  makeSecondDepositTx,
  makeSecondRedeemTx,
  readSecondSendPending,
  reconcileSecondPendingOnBoot,
  runSecondPlumbingProof as runSecondPlumbingProofRaw,
  SECOND_PLUMBING_DESTINATION_ID,
  SECOND_PLUMBING_EVIDENCE_CLASS,
  SECOND_PLUMBING_EXECUTION_MODE,
  SECOND_SEND_PENDING_KEY,
  SECOND_SEND_PENDING_STAGES,
  secondSendPendingBelongsToScope,
  secondSendPendingKey,
  inspectSecondSendPending,
  clearSecondSendPendingIf,
  writeSecondSendPending,
  SECOND_SIGN_MESSAGE_PREFIX,
} from "../src/second-execution-adapter.js";
import { classifySecondReceipt, PERSISTABLE_EVIDENCE_CLASSES } from "../src/second-journey-receipt-bridge.js";
import { resolveChainProfile, legacyTestnetPathOpen } from "../src/chain-profile.js";

// [A-710 L1 re-baseline · named reason: A-693 M-1/M-2 closed] runSecondPlumbingProof now REQUIRES an injected
// cross-tab money lock (`withMoneyLock`) and app-lock state (`isAppLocked`) and refuses without them (pinned in
// app/test/a710-e-second-local.mjs). Every existing case here keeps its arguments and assertions; these two
// dependencies are supplied as defaults (an in-process exclusive lock, app not locked) and any case may override
// them (e.g. `isAppLocked: () => true` below).
const HELD_TEST_LOCKS = new Set();
async function testMoneyLock(name, body) {
  if (HELD_TEST_LOCKS.has(name)) return undefined;
  HELD_TEST_LOCKS.add(name);
  try { return await body(); } finally { HELD_TEST_LOCKS.delete(name); }
}
const runSecondPlumbingProof = (args = {}) => runSecondPlumbingProofRaw({ isAppLocked: () => false, withMoneyLock: testMoneyLock, ...args });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`);
    fail += 1;
  }
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const SCOPE = { accountId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chainId: "monad-testnet" };
const PIGGY_ID = "piggy-1";
const ACCOUNT = { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
const DEPOSIT_HASH = `0x${"11".repeat(32)}`;
const REDEEM_HASH = `0x${"22".repeat(32)}`;

function stubClients({ sharesBefore = 0n, minted = 777n, depositHash = DEPOSIT_HASH, redeemHash = REDEEM_HASH, failDeposit = false, failRedeem = false, throwOnDeposit = false, throwOnRedeem = false, requirePendingBeforeSend = true } = {}) {
  const sent = [];
  let depositSent = false; // [A-693 D8] the vault balance only rises once the deposit has been sent
  const receipts = { [depositHash]: { status: failDeposit ? "reverted" : "success", blockNumber: 100n }, [redeemHash]: { status: failRedeem ? "reverted" : "success", blockNumber: 101n } };
  const storage = createMemoryStorage();
  const walletClient = {
    async sendTransaction(tx) {
      if (requirePendingBeforeSend) {
        const pending = readSecondSendPending(storage, SCOPE, PIGGY_ID);
        if (!pending || pending.stage === "unknown") throw new Error("TEST GUARD: sendTransaction called before pending was written");
      }
      sent.push(tx);
      if (tx.to === undefined) throw new Error("bad tx");
      // distinguish deposit (has value) vs redeem (no value) by shape used in makeSecondDepositTx/makeSecondRedeemTx
      const isDeposit = Object.prototype.hasOwnProperty.call(tx, "value");
      if (isDeposit) {
        if (throwOnDeposit) throw new Error("deposit send failed");
        depositSent = true;
        return depositHash;
      }
      if (throwOnRedeem) throw new Error("redeem send failed");
      return redeemHash;
    },
  };
  const publicClient = {
    async waitForTransactionReceipt({ hash }) {
      return receipts[hash] || null;
    },
    async readContract({ functionName }) {
      if (functionName === "balanceOf") return depositSent ? sharesBefore + minted : sharesBefore;
      throw new Error("unexpected readContract call: " + functionName);
    },
  };
  return { storage, walletClient, publicClient, sent };
}

// ── 1. constants / shapes ────────────────────────────────────────────────────────────────
await check("constants: standalone, never shared with First's SEND_PENDING_KEY/stages", () => {
  assert.notEqual(SECOND_SEND_PENDING_KEY, "araso.sendPending");
  assert.deepEqual([...SECOND_SEND_PENDING_STAGES], ["deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"]);
  assert.equal(SECOND_PLUMBING_EVIDENCE_CLASS, "PASS_TESTNET_ACTUAL_TX");
  assert.equal(SECOND_PLUMBING_EXECUTION_MODE, "testnet_actual");
  assert.notEqual(SECOND_PLUMBING_EVIDENCE_CLASS, "PASS_MAINNET_TX");
  assert.ok(!SECOND_PLUMBING_EVIDENCE_CLASS.startsWith("PASS_FORK"));
  // standalone destination id — never a FORK_PROVEN_DESTINATIONS / job-feed.js fixture id
  assert.equal(SECOND_PLUMBING_DESTINATION_ID, "second-execution-plumbing-proof");
  assert.notEqual(SECOND_SIGN_MESSAGE_PREFIX, "araso:mera:send-piggy-to-work:v1:");
  assert.match(MAIN, /araso:mera:send-piggy-to-work:v1:\$\{account\.address\}/, "First's digest string is still exactly what it was");
});

await check("tx builders: deposit carries value, redeem does not; redeem throws on 0 shares", () => {
  const dep = makeSecondDepositTx(1000n, ACCOUNT.address);
  assert.equal(dep.value, 1000n);
  assert.equal(typeof dep.data, "string");
  const red = makeSecondRedeemTx(500n, ACCOUNT.address, ACCOUNT.address);
  assert.equal(red.value, undefined);
  assert.throws(() => makeSecondRedeemTx(0n, ACCOUNT.address, ACCOUNT.address), /no shMON received/);
});

// ── 2. pending store: fail-closed read, scope binding ───────────────────────────────────
await check("readSecondSendPending: absent -> null; garbled JSON -> fail-closed {stage:unknown}; unknown stage -> fail-closed", () => {
  const storage = createMemoryStorage();
  assert.equal(readSecondSendPending(storage), null);
  storage.setItem(SECOND_SEND_PENDING_KEY, "{not json");
  assert.deepEqual(readSecondSendPending(storage), { stage: "unknown" });
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "not-a-real-stage" }));
  assert.deepEqual(readSecondSendPending(storage), { stage: "unknown" });
});

await check("secondSendPendingBelongsToScope: chain + asset(shMON) + token + Piggy all must match", () => {
  const good = { stage: "deposit-broadcast", accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON" };
  assert.equal(secondSendPendingBelongsToScope(good, { ...SCOPE, piggyId: PIGGY_ID }), true);
  for (const bad of [
    { ...good, chainId: "monad-mainnet" },
    { ...good, accountId: "0x" + "9".repeat(40) },
    { ...good, piggyId: "other-piggy" },
    { ...good, asset: "USDC" },
    { ...good, stage: "unknown" },
  ]) {
    assert.equal(secondSendPendingBelongsToScope(bad, { ...SCOPE, piggyId: PIGGY_ID }), false, JSON.stringify(bad));
  }
  assert.equal(secondSendPendingBelongsToScope(null, { ...SCOPE, piggyId: PIGGY_ID }), false);
});

// ── 3. permission fail-closed ────────────────────────────────────────────────────────────
await check("permission fail-closed: confirm !== true blocks before any client call", async () => {
  const { storage, walletClient, publicClient, sent } = stubClients();
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: false, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "blocked");
  assert.equal(out.reason, "permission_not_confirmed");
  assert.equal(sent.length, 0);
  assert.equal(readSecondSendPending(storage, SCOPE, PIGGY_ID), null, "nothing written when permission is missing");
});

await check("missing/invalid scope, account, amount, or clients -> blocked, no side effects", async () => {
  const { storage, walletClient, publicClient, sent } = stubClients();
  const base = { storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) };
  assert.equal((await runSecondPlumbingProof({ ...base, scope: {} })).reason, "invalid_scope");
  assert.equal((await runSecondPlumbingProof({ ...base, piggyId: "" })).reason, "missing_piggy");
  assert.equal((await runSecondPlumbingProof({ ...base, account: { address: "not-an-address" } })).reason, "missing_account");
  assert.equal((await runSecondPlumbingProof({ ...base, walletClient: {} })).reason, "missing_clients");
  assert.equal((await runSecondPlumbingProof({ ...base, amountWei: "0" })).reason, "invalid_amount");
  assert.equal((await runSecondPlumbingProof({ ...base, amountWei: "not-a-number" })).reason, "invalid_amount");
  assert.equal(sent.length, 0);
});

// ── 4. ordering: pending written BEFORE broadcast ───────────────────────────────────────
await check("pending-before-broadcast ordering: a wallet client that requires pending-first succeeds; one that fakes the order would throw", async () => {
  const { storage, walletClient, publicClient } = stubClients();
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "done", out.reason || "");
  // sanity: a client that DOESN'T require pending-first still works (ordering is enforced by
  // the guard stub above, not by this assertion) — the point is the guard above never threw.
});

// ── 5. duplicate-send prevention ────────────────────────────────────────────────────────
await check("duplicate-send prevention: an existing in-scope pending record blocks a new run; no second broadcast", async () => {
  const { storage, walletClient, publicClient, sent } = stubClients();
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "deposit-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH }));
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "blocked");
  assert.equal(out.reason, "pending_exists");
  assert.equal(sent.length, 0);
});

await check("[A-693 D5] an out-of-scope LEGACY (global-key) pending record now BLOCKS a new run; it is left untouched", async () => {
  const { storage, walletClient, publicClient, sent } = stubClients();
  const legacy = JSON.stringify({ stage: "deposit-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: "other-piggy", asset: "shMON", depositTxHash: DEPOSIT_HASH });
  storage.setItem(SECOND_SEND_PENDING_KEY, legacy);
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "blocked");
  assert.equal(out.reason, "legacy_pending_out_of_scope");
  assert.equal(sent.length, 0);
  assert.equal(storage.getItem(SECOND_SEND_PENDING_KEY), legacy, "unresolved money of another Piggy is never overwritten");
});

await check("[A-693 D6] another Piggy's SCOPED pending record does not collide with this run and is never touched", async () => {
  const { storage, walletClient, publicClient } = stubClients();
  const otherKey = secondSendPendingKey(SCOPE, "other-piggy");
  const other = JSON.stringify({ stage: "deposit-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: "other-piggy", asset: "shMON", depositTxHash: DEPOSIT_HASH });
  storage.setItem(otherKey, other);
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "done", out.reason || "");
  assert.equal(storage.getItem(otherKey), other);
  assert.notEqual(secondSendPendingKey(SCOPE, PIGGY_ID), otherKey);
});

// ── 6. failure paths: pending stays, never auto-cleared on failure ─────────────────────
await check("deposit send throws -> failed, pending stays at deposit-sending (no auto-retry)", async () => {
  const { storage, walletClient, publicClient } = stubClients({ throwOnDeposit: true });
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "deposit_send_error");
  const pending = readSecondSendPending(storage, SCOPE, PIGGY_ID);
  assert.equal(pending.stage, "deposit-sending");
});

await check("deposit reverted -> failed, pending stays at deposit-broadcast", async () => {
  const { storage, walletClient, publicClient } = stubClients({ failDeposit: true });
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "deposit_unconfirmed_or_reverted");
  assert.equal(readSecondSendPending(storage, SCOPE, PIGGY_ID).stage, "deposit-broadcast");
});

await check("redeem reverted -> failed, pending stays at redeem-broadcast (both hashes kept)", async () => {
  const { storage, walletClient, publicClient } = stubClients({ failRedeem: true });
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}) });
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "redeem_unconfirmed_or_reverted");
  const pending = readSecondSendPending(storage, SCOPE, PIGGY_ID);
  assert.equal(pending.stage, "redeem-broadcast");
  assert.equal(pending.depositTxHash, DEPOSIT_HASH);
  assert.equal(pending.redeemTxHash, REDEEM_HASH);
});

// ── 7. grant 403-already-funded is not a failure ───────────────────────────────────────
await check("grant: granted:false (403 already-funded) is non-error and the run proceeds to done", async () => {
  const { storage, walletClient, publicClient } = stubClients();
  let grantCalled = false;
  const out = await runSecondPlumbingProof({
    storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}),
    requestGrant: async () => { grantCalled = true; return { granted: false, txHash: "" }; },
    waitForGrantBalance: async () => { throw new Error("should not be called when not granted"); },
  });
  assert.equal(grantCalled, true);
  assert.equal(out.outcome, "done", out.reason || "");
});

await check("grant: granted:true but balance never becomes visible -> failed, before any send", async () => {
  const { storage, walletClient, publicClient, sent } = stubClients();
  const out = await runSecondPlumbingProof({
    storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}),
    requestGrant: async () => ({ granted: true, txHash: "0x" + "3".repeat(64) }),
    waitForGrantBalance: async () => false,
  });
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "grant_not_visible");
  assert.equal(sent.length, 0);
});

await check("grant: requestGrant throws -> failed (fail-closed), before any send", async () => {
  const { storage, walletClient, publicClient, sent } = stubClients();
  const out = await runSecondPlumbingProof({
    storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async () => ({}),
    requestGrant: async () => { throw new Error("relayer unreachable"); },
  });
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "grant_error");
  assert.equal(sent.length, 0);
});

// ── 8. success: full receipt shape, cleared pending ─────────────────────────────────────
await check("success: pending cleared, receipt shape matches the card's evidence contract", async () => {
  const { storage, walletClient, publicClient } = stubClients();
  const out = await runSecondPlumbingProof({ storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient, publicClient, signDigest: async (digest) => { assert.ok(digest instanceof Uint8Array); return { ok: true }; } });
  assert.equal(out.outcome, "done");
  assert.equal(readSecondSendPending(storage, SCOPE, PIGGY_ID), null, "pending cleared only on confirmed success");
  const r = out.receipt;
  assert.equal(r.outcome, "done");
  assert.equal(r.evidenceClass, SECOND_PLUMBING_EVIDENCE_CLASS);
  assert.equal(r.executionMode, SECOND_PLUMBING_EXECUTION_MODE);
  assert.equal(r.accountId, SCOPE.accountId);
  assert.equal(r.chainId, SCOPE.chainId);
  assert.equal(r.piggyId, PIGGY_ID);
  assert.equal(r.destinationId, SECOND_PLUMBING_DESTINATION_ID);
  assert.equal(r.txHash, REDEEM_HASH);
  assert.equal(r.depositTxHash, DEPOSIT_HASH);
  assert.equal(r.redeemTxHash, REDEEM_HASH);
  assert.ok(typeof r.eventId === "string" && r.eventId.length > 0);
});

// ── 9. evidence class accepted by the existing Second receipt bridge, rejected if mislabeled ──
await check("receipt bridge: the new class is in PERSISTABLE_EVIDENCE_CLASSES and is accepted only with the matching executionMode + real txHash", () => {
  assert.ok(PERSISTABLE_EVIDENCE_CLASSES.includes("PASS_TESTNET_ACTUAL_TX"));
  const good = { eventId: "e1", outcome: "done", evidenceClass: "PASS_TESTNET_ACTUAL_TX", executionMode: "testnet_actual", accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, destinationId: SECOND_PLUMBING_DESTINATION_ID, txHash: REDEEM_HASH };
  const v = classifySecondReceipt(good, { scope: SCOPE });
  assert.equal(v.persistable, true, v.reason);
  assert.equal(v.receipt.evidenceClass, "PASS_TESTNET_ACTUAL_TX");
  // mislabeled as mainnet live: mode mismatch
  assert.equal(classifySecondReceipt({ ...good, evidenceClass: "PASS_MAINNET_TX" }, { scope: SCOPE }).reason, "evidence_mode_mismatch");
  // mislabeled execution mode on the real class itself
  assert.equal(classifySecondReceipt({ ...good, executionMode: "fork_simulation" }, { scope: SCOPE }).reason, "evidence_mode_mismatch");
  assert.equal(classifySecondReceipt({ ...good, executionMode: "live" }, { scope: SCOPE }).reason, "evidence_mode_mismatch");
  // a fork class can never claim testnet_actual mode either
  assert.equal(classifySecondReceipt({ ...good, evidenceClass: "PASS_FORK_SIM", executionMode: "testnet_actual" }, { scope: SCOPE }).reason, "evidence_mode_mismatch");
  // done without a real tx hash is rejected even with the right class/mode
  assert.equal(classifySecondReceipt({ ...good, txHash: undefined }, { scope: SCOPE }).reason, "live_evidence_without_tx");
  // dev/mock is rejected before any of the above even runs
  assert.equal(classifySecondReceipt({ ...good, devPreview: true }, { scope: SCOPE }).reason, "dev_mock_receipt");
  // forbidden fields still rejected for the new class too
  assert.equal(classifySecondReceipt({ ...good, permission: true }, { scope: SCOPE }).reason, "forbidden_field_present");
});

// ── 10. reload/reopen reconcile: never re-broadcasts, binds to scope ───────────────────
await check("reconcile: no pending -> {kind:'none'}; out-of-scope pending untouched; unknown stays unknown (no auto-retry)", async () => {
  const storage = createMemoryStorage();
  assert.deepEqual(await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success" }) }), { kind: "none" });

  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "deposit-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: "other-piggy", asset: "shMON", depositTxHash: DEPOSIT_HASH }));
  assert.deepEqual(await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success" }) }), { kind: "out_of_scope" });
  assert.notEqual(readSecondSendPending(storage), null, "an out-of-scope record is never cleared by someone else's reconcile");

  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "deposit-sending", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON" }));
  const unk = await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => { throw new Error("should not even be called: no broadcast hash yet"); } });
  assert.deepEqual(unk, { kind: "unknown" });
});

await check("reconcile: deposit-broadcast + pending read -> pending (no redeem attempted)", async () => {
  const storage = createMemoryStorage();
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "deposit-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH }));
  const out = await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "pending" }) });
  assert.deepEqual(out, { kind: "pending" });
  assert.notEqual(readSecondSendPending(storage), null);
});

await check("reconcile: redeem-broadcast + success read -> success, pending cleared, receipt built from the stored record only (no re-send)", async () => {
  const storage = createMemoryStorage();
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "redeem-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH, redeemTxHash: REDEEM_HASH }));
  let reads = 0;
  const out = await reconcileSecondPendingOnBoot({
    storage, scope: SCOPE, piggyId: PIGGY_ID,
    readTxReceipt: async (hash) => { reads += 1; return { kind: "success", receipt: { blockNumber: hash === REDEEM_HASH ? 101n : 100n } }; },
  });
  assert.equal(out.kind, "success");
  assert.equal(readSecondSendPending(storage), null);
  assert.equal(out.receipt.evidenceClass, SECOND_PLUMBING_EVIDENCE_CLASS);
  assert.equal(out.receipt.txHash, REDEEM_HASH);
  // classify-then-maybe-depositcheck: at most two read-only receipt reads, zero sends
  assert.ok(reads <= 2, `reads=${reads}`);
  // [state/receipt review fix 1] reconcile fills the SAME evidence fields the direct-success
  // path does (blockNumber truthfully read; measuredDelta explicitly "unknown" — never
  // fabricated, never silently omitted, since reconcile never re-reads the shMON balance).
  assert.equal(out.receipt.blockNumber, 101, "blockNumber comes from the real redeem tx receipt");
  assert.equal(out.receipt.measuredDelta, "unknown");
  assert.equal(typeof out.receipt.at, "number");
});

await check("reconcile: success receipt omits blockNumber (never fabricates 0/NaN) when the injected readTxReceipt doesn't supply one", async () => {
  const storage = createMemoryStorage();
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "redeem-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH, redeemTxHash: REDEEM_HASH }));
  const out = await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success", receipt: {} }) });
  assert.equal(out.kind, "success");
  assert.equal(Object.prototype.hasOwnProperty.call(out.receipt, "blockNumber"), false, "no blockNumber field invented when evidence is absent");
  assert.equal(out.receipt.measuredDelta, "unknown");
  // the bridge still accepts it (blockNumber/measuredDelta are not part of its required shape)
  const v = classifySecondReceipt(out.receipt, { scope: SCOPE });
  assert.equal(v.persistable, true, v.reason);
});

await check("reconcile: redeem-broadcast + reverted read -> failed, pending stays (no silent clear)", async () => {
  const storage = createMemoryStorage();
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ stage: "redeem-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH, redeemTxHash: REDEEM_HASH }));
  const out = await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "reverted" }) });
  assert.deepEqual(out, { kind: "failed" });
  assert.notEqual(readSecondSendPending(storage), null);
});

await check("classifySecondSendPending: garbled/unknown stage or missing address never reads a tx, kind unknown", async () => {
  let readCalled = false;
  const readTxReceipt = async () => { readCalled = true; return { kind: "success" }; };
  assert.deepEqual(await classifySecondSendPending({ stage: "unknown" }, { readTxReceipt }), { kind: "unknown" });
  assert.deepEqual(await classifySecondSendPending({ stage: "deposit-broadcast", address: "bad" }, { readTxReceipt }), { kind: "unknown" });
  assert.deepEqual(await classifySecondSendPending(null, { readTxReceipt }), { kind: "unknown" });
  assert.equal(readCalled, false);
});

// ── 11. chain-profile gate: this lane carries no profile logic of its own — it is inert  ──
// off-testnet exactly because main.js's own harness entry point (not this module) is gated
// behind LOCAL_DEV_ENTRY, same first lock as every other A-629 LOCAL_ONLY hook. Paired here
// with a653-mainnet-lane.mjs's own profile-gate assertions (that file owns chain-profile.js
// coverage; this just confirms the two never collide on scope/chain values).
await check("chain-profile pairing: a653's resolveChainProfile/legacyTestnetPathOpen never accept this module's scope as mainnet, and vice versa", () => {
  const testnet = resolveChainProfile(undefined);
  const mainnet = resolveChainProfile("monad-mainnet");
  assert.equal(legacyTestnetPathOpen(testnet), true);
  assert.equal(legacyTestnetPathOpen(mainnet), false);
  assert.notEqual(SCOPE.chainId, "monad-mainnet");
});

await check("main.js wiring: the harness entry points exist, are LOCAL_DEV_ENTRY-gated, and are never referenced by Explore/candidates/handleSecondSend/canSend", () => {
  assert.match(MAIN, /async function runLocalSecondPlumbingProofIfHarnessed\(/);
  assert.match(MAIN, /async function reconcileLocalSecondPlumbingProofIfHarnessed\(/);
  assert.match(MAIN, /if \(!LOCAL_DEV_ENTRY\) return \{ ran: false, reason: "not_local_dev_entry" \};/);
  assert.match(MAIN, /window\.__ARASO_LOCAL_TEST_SECOND_PLUMBING_RUN__ = runLocalSecondPlumbingProofIfHarnessed;/);
  assert.match(MAIN, /window\.__ARASO_LOCAL_TEST_SECOND_PLUMBING_RECONCILE__ = reconcileLocalSecondPlumbingProofIfHarnessed;/);
  // [state/receipt review fix 3] both harness entry points set sj.executionReceipt on success
  assert.match(MAIN, /sj\.executionReceipt = outcome\.receipt;/);
  assert.match(MAIN, /sj\.executionReceipt = result\.receipt;/);
  // never called from the product Explore/candidates/Send gate functions themselves (their own
  // bodies, not "whatever text happens to sit between them in the file").
  function ownBody(name) {
    const start = MAIN.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    let depth = 0;
    for (let i = MAIN.indexOf("{", MAIN.indexOf(")", start)); i < MAIN.length; i += 1) {
      if (MAIN[i] === "{") depth += 1;
      else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(start, i + 1); }
    }
    throw new Error(`${name}: end not found`);
  }
  for (const name of ["openSecondJourneyExplore", "handleExploreSave", "handleExploreNone", "handleCandidatePick", "handleSecondSend", "recomputeSecondJourneyFlow", "buildSecondJourneyViewModel", "updateSecondJourneyReadinessUI"]) {
    assert.ok(!/runSecondPlumbingProof|SecondPlumbing|runLocalSecondPlumbingProofIfHarnessed/.test(ownBody(name)), `${name} must not reference the plumbing-proof lane`);
  }
  // static grep: no new file reaches First's pending key or sendPiggyOnce (comments may name
  // them descriptively — strip comments first, same convention as a653-mainnet-lane.mjs N18).
  const adapterSrc = readFileSync(path.join(REPO, "app/src/second-execution-adapter.js"), "utf8");
  const adapterCode = adapterSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.ok(!/sendPiggyOnce\(|(?<!SECOND_)SEND_PENDING_KEY|TRIP_CLOSED_KEY/.test(adapterCode));
});

await check("FIRST_JOURNEY_LINEAGE is untouched: shMON still non-distinct, still absent from FORK_PROVEN_DESTINATIONS", async () => {
  const { FIRST_JOURNEY_LINEAGE, listForkProvenDestinations } = await import("../src/second-job-readiness.js");
  assert.equal(FIRST_JOURNEY_LINEAGE.id, "fastlane-shmon");
  assert.equal(FIRST_JOURNEY_LINEAGE.countsAsDistinctSecondExperience, false);
  assert.equal(listForkProvenDestinations().some((d) => d.id === SECOND_PLUMBING_DESTINATION_ID), false);
  assert.equal(listForkProvenDestinations().some((d) => d.id === "fastlane-shmon"), false);
});

// ── 12. Return/Receipt consumes an actual executionReceipt when present (state/receipt review fix 3) ──
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

function makeRenderSecondReturn(stateObj) {
  const factory = new Function(
    "state", "returnSceneMarkup", "receiptPaperMarkup", "receiptPaperFields", "secondJourneyReceiptFields",
    "chogHomeMarkupForReturn", "displayPiggyName", "isDevDebugOptIn", "isDevMockReceipt",
    `${fnBody("renderSecondReturn")}\nreturn renderSecondReturn;`,
  );
  return factory(
    stateObj,
    (args) => args, // returnSceneMarkup: identity, so we can inspect the model it was given
    (fields) => fields, // receiptPaperMarkup: identity, so we can inspect the fields it was given
    ({ receipt, name }) => ({ source: "actual", receipt, name }),
    (mockReceipt, name) => ({ source: "mock", mockReceipt, name }),
    () => "<chog/>",
    () => "Piggy",
    () => false,
    (candidate) => !!candidate?.devPreview || candidate?.evidenceClass === "dev_preview" || candidate?.evidenceClass === "mock",
  );
}

await check("renderSecondReturn: no executionReceipt (every product path today) -> byte-identical mockReceipt behavior", () => {
  const render = makeRenderSecondReturn({ secondJourney: { executionReceipt: null, mockReceipt: { attempted: true, decidedStatus: "JOB_READY" } } });
  const model = render();
  assert.equal(model.receiptRowsMarkup.source, "mock");
  assert.match(model.devExtra, /UI preview — no transaction/);
});

await check("renderSecondReturn: a real executionReceipt (A-663 harness only) takes priority over mockReceipt, reusing the existing real-receipt formatter, and drops the preview tag", () => {
  const actual = { eventId: "e1", outcome: "done", evidenceClass: "PASS_TESTNET_ACTUAL_TX", executionMode: "testnet_actual", txHash: REDEEM_HASH, at: Date.now() };
  const render = makeRenderSecondReturn({ secondJourney: { executionReceipt: actual, mockReceipt: { attempted: true, decidedStatus: "JOB_READY" } } });
  const model = render();
  assert.equal(model.receiptRowsMarkup.source, "actual");
  assert.equal(model.receiptRowsMarkup.receipt, actual);
  assert.equal(/UI preview — no transaction/.test(model.devExtra), false, "no longer true once a real result exists — no new copy, just drop the now-false one");
});

await check("renderSecondReturn: a dev/mock-shaped object placed in executionReceipt is never treated as real (defense in depth via isDevMockReceipt)", () => {
  const render = makeRenderSecondReturn({ secondJourney: { executionReceipt: { devPreview: true, outcome: "done" }, mockReceipt: { attempted: true, decidedStatus: "JOB_READY" } } });
  const model = render();
  assert.equal(model.receiptRowsMarkup.source, "mock");
});

// ── 13. [A-693] money-safety M1: D1-D8, R7, T11 (failure injection; no network) ─────────────────────
// Storage whose reads/writes can be made to fail per key prefix, switchable at any time.
function faultyStorage() {
  const base = createMemoryStorage();
  const f = { getThrows: () => false, setThrows: () => false, setSilentDrop: () => false };
  return {
    f,
    getItem: (k) => { if (f.getThrows(k)) throw new Error("getItem boom"); return base.getItem(k); },
    setItem: (k, v) => { if (f.setThrows(k, v)) throw new Error("setItem boom"); if (f.setSilentDrop(k, v)) return; base.setItem(k, v); },
    removeItem: (k) => base.removeItem(k),
    _dump: base._dump,
  };
}
const JOURNEY_PREFIX = "araso.secondJourney";
const runArgs = (c, extra = {}) => ({ storage: c.storage, scope: SCOPE, piggyId: PIGGY_ID, amountWei: "1000", confirm: true, account: ACCOUNT, walletClient: c.walletClient, publicClient: c.publicClient, signDigest: async () => ({}), ...extra });
const withStorage = (c, storage) => ({ ...c, storage, walletClient: { async sendTransaction(tx) { return c.walletClient.sendTransaction(tx); } } });
const SCOPED_KEY = secondSendPendingKey(SCOPE, PIGGY_ID);

await check("D6: scoped key is per chain+account+Piggy, collision-safe, null on invalid scope", () => {
  assert.equal(SCOPED_KEY, `araso.secondSendPending.v1.monad-testnet.${SCOPE.accountId}.piggy-1`);
  assert.notEqual(secondSendPendingKey(SCOPE, "a.b"), secondSendPendingKey({ ...SCOPE, accountId: `${SCOPE.accountId}.a` }, "b"));
  assert.notEqual(SCOPED_KEY, SECOND_SEND_PENDING_KEY);
  assert.equal(secondSendPendingKey({}, PIGGY_ID), null);
  assert.equal(secondSendPendingKey(SCOPE, ""), null);
  assert.equal(secondSendPendingKey({ accountId: "unknown-account", chainId: "x" }, PIGGY_ID), null);
});

await check("A4/T11/D4: getItem throws on the pending read -> blocked pending_unreadable, zero sends, nothing written", async () => {
  const c = stubClients();
  const storage = faultyStorage();
  storage.f.getThrows = (k) => k.startsWith("araso.secondSendPending");
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "pending_unreadable"]);
  assert.equal(c.sent.length, 0);
  assert.deepEqual(storage._dump(), {});
  assert.equal(inspectSecondSendPending(storage, SCOPED_KEY).status, "storage_error");
  assert.deepEqual(readSecondSendPending(storage, SCOPE, PIGGY_ID), { stage: "unknown", error: "storage_error" }, "a throw is never reported as 'no pending'");
  assert.deepEqual(await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success" }) }), { kind: "unknown", reason: "pending_unreadable" });
});

await check("A5/D4: corrupt scoped pending -> blocked pending_corrupt, bytes unchanged, zero sends", async () => {
  const c = stubClients();
  c.storage.setItem(SCOPED_KEY, "{not json");
  const out = await runSecondPlumbingProof(runArgs(c));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "pending_corrupt"]);
  assert.equal(c.storage.getItem(SCOPED_KEY), "{not json");
  assert.equal(c.sent.length, 0);
  assert.deepEqual(await reconcileSecondPendingOnBoot({ storage: c.storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success" }) }), { kind: "unknown", reason: "pending_corrupt" });
  assert.equal(c.storage.getItem(SCOPED_KEY), "{not json");
});

await check("T11: corrupt LEGACY key blocks the start too (it used to be overwritten)", async () => {
  const c = stubClients();
  c.storage.setItem(SECOND_SEND_PENDING_KEY, "garbage");
  const out = await runSecondPlumbingProof(runArgs(c));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "pending_corrupt"]);
  assert.equal(c.storage.getItem(SECOND_SEND_PENDING_KEY), "garbage");
  assert.equal(c.sent.length, 0);
});

await check("A1: setItem throws on the first (reserving) write -> blocked, zero sends, no record", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const storage = faultyStorage();
  storage.f.setThrows = (k) => k.startsWith("araso.secondSendPending");
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "pending_write_failed"]);
  assert.equal(c.sent.length, 0);
});

await check("A8: setItem 'succeeds' but the bytes are not there (silent drop) -> reserve not verified -> blocked, zero sends", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const storage = faultyStorage();
  storage.f.setSilentDrop = (k) => k.startsWith("araso.secondSendPending");
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "pending_write_failed"]);
  assert.equal(c.sent.length, 0);
});

await check("no storage -> blocked storage_unavailable (the run no longer proceeds without a pending trail)", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  for (const bad of [null, undefined, { getItem() { return null; } }]) {
    const out = await runSecondPlumbingProof(runArgs({ ...c, storage: bad }));
    assert.deepEqual([out.outcome, out.reason], ["blocked", "storage_unavailable"]);
  }
  assert.equal(c.sent.length, 0);
});

await check("reserve is atomic with the check: a record that appears during the async grant wait blocks the send", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const out = await runSecondPlumbingProof(runArgs(c, { requestGrant: async () => { c.storage.setItem(SCOPED_KEY, JSON.stringify({ stage: "deposit-sending", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", reservationId: "other-tab" })); return { granted: false }; } }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "pending_exists"]);
  assert.equal(c.sent.length, 0);
  assert.equal(JSON.parse(c.storage.getItem(SCOPED_KEY)).reservationId, "other-tab", "the other record was not overwritten");
});

await check("authorize: isAppLocked() true -> blocked app_locked before any record or send", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const out = await runSecondPlumbingProof(runArgs(c, { isAppLocked: () => true }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "app_locked"]);
  assert.equal(c.sent.length, 0);
  assert.equal(c.storage.getItem(SCOPED_KEY), null);
});

await check("R7/A3: setItem throws AFTER the deposit broadcast -> no throw, failed deposit_hash_unsaved with the hash in memory, no redeem", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const storage = faultyStorage();
  c.walletClient.sendTransaction = ((orig) => async (tx) => { const h = await orig(tx); storage.f.setThrows = (k) => k.startsWith("araso.secondSendPending"); return h; })(c.walletClient.sendTransaction);
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "deposit_hash_unsaved");
  assert.equal(out.depositTxHash, DEPOSIT_HASH, "the broadcast hash is returned, not lost");
  assert.equal(c.sent.length, 1, "no redeem was attempted");
  assert.equal(JSON.parse(storage.getItem(SCOPED_KEY)).stage, "deposit-sending", "record is still the pre-send reservation (fail-closed)");
});

await check("R7: setItem throws AFTER the redeem broadcast -> failed redeem_hash_unsaved, both hashes returned, pending not cleared", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const storage = faultyStorage();
  c.walletClient.sendTransaction = ((orig) => async (tx) => { const h = await orig(tx); if (!Object.prototype.hasOwnProperty.call(tx, "value")) storage.f.setThrows = (k) => k.startsWith("araso.secondSendPending"); return h; })(c.walletClient.sendTransaction);
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.deepEqual([out.outcome, out.reason, out.depositTxHash, out.redeemTxHash], ["failed", "redeem_hash_unsaved", DEPOSIT_HASH, REDEEM_HASH]);
  assert.equal(JSON.parse(storage.getItem(SCOPED_KEY)).stage, "redeem-sending");
});

await check("D1/D2: receipt store write fails -> done_unsaved, pending NOT cleared; reconcile with a working store saves, then clears", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const storage = faultyStorage();
  storage.f.setThrows = (k) => k.startsWith(JOURNEY_PREFIX);
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.equal(out.outcome, "done_unsaved");
  assert.equal(out.receipt.txHash, REDEEM_HASH, "money moved: the receipt is returned even though it was not saved");
  assert.equal(JSON.parse(storage.getItem(SCOPED_KEY)).stage, "redeem-broadcast", "pending kept");
  // reconcile while the store is still failing: honest success_unsaved, pending kept
  const mid = await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success", receipt: { blockNumber: 101n } }) });
  assert.equal(mid.kind, "success_unsaved");
  assert.notEqual(storage.getItem(SCOPED_KEY), null);
  // store recovers
  storage.f.setThrows = () => false;
  const fin = await reconcileSecondPendingOnBoot({ storage, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success", receipt: { blockNumber: 101n } }) });
  assert.equal(fin.kind, "success");
  assert.equal(storage.getItem(SCOPED_KEY), null, "cleared only after the save was verified");
  const saved = JSON.parse(storage.getItem(`${JOURNEY_PREFIX}.${SCOPE.chainId}.${SCOPE.accountId}`));
  assert.equal(saved.receipts.some((r) => r.eventId === fin.receipt.eventId), true);
});

await check("A8/D2: the journey store silently drops the write -> not verified -> pending kept (done_unsaved)", async () => {
  const c = stubClients({ requirePendingBeforeSend: false });
  const storage = faultyStorage();
  storage.f.setSilentDrop = (k) => k.startsWith(JOURNEY_PREFIX);
  const out = await runSecondPlumbingProof(runArgs({ ...c, storage }));
  assert.equal(out.outcome, "done_unsaved");
  assert.notEqual(storage.getItem(SCOPED_KEY), null);
});

await check("D1: an unreadable (corrupt) journey store is never overwritten by the money path; pending kept", async () => {
  const c = stubClients();
  const jk = `${JOURNEY_PREFIX}.${SCOPE.chainId}.${SCOPE.accountId}`;
  c.storage.setItem(jk, "{corrupt");
  const out = await runSecondPlumbingProof(runArgs(c));
  assert.equal(out.outcome, "done_unsaved");
  assert.equal(out.reason, "journey_state_unreadable");
  assert.equal(c.storage.getItem(jk), "{corrupt");
  assert.notEqual(c.storage.getItem(SCOPED_KEY), null);
});

await check("D1 compare-and-clear: a pending record that changed since is NOT cleared (and the bridge-first order holds on success)", async () => {
  const st = createMemoryStorage();
  const rec = { stage: "redeem-broadcast", reservationId: "r1", depositTxHash: DEPOSIT_HASH, redeemTxHash: REDEEM_HASH };
  st.setItem(SCOPED_KEY, JSON.stringify({ ...rec, at: 1 }));
  assert.deepEqual(clearSecondSendPendingIf(st, SCOPED_KEY, { ...rec, redeemTxHash: `0x${"33".repeat(32)}` }), { cleared: false, reason: "pending_changed" });
  assert.deepEqual(clearSecondSendPendingIf(st, SCOPED_KEY, { ...rec, reservationId: "r2" }), { cleared: false, reason: "pending_changed" });
  assert.notEqual(st.getItem(SCOPED_KEY), null);
  assert.deepEqual(clearSecondSendPendingIf(st, SCOPED_KEY, rec), { cleared: true, reason: null });
  assert.equal(st.getItem(SCOPED_KEY), null);
  assert.deepEqual(clearSecondSendPendingIf(st, SCOPED_KEY, rec), { cleared: true, reason: "already_clear" });
  // order: the receipt is already in the journey store at the moment the pending record disappears
  const c = stubClients();
  const jk = `${JOURNEY_PREFIX}.${SCOPE.chainId}.${SCOPE.accountId}`;
  let journeyHadReceiptWhenCleared = null;
  const origRemove = c.storage.removeItem;
  c.storage.removeItem = (k) => { if (k === SCOPED_KEY) journeyHadReceiptWhenCleared = (JSON.parse(c.storage.getItem(jk) || "{}").receipts || []).length === 1; return origRemove(k); };
  const out = await runSecondPlumbingProof(runArgs(c));
  assert.equal(out.outcome, "done");
  assert.equal(journeyHadReceiptWhenCleared, true, "durable save happens BEFORE the pending clear");
});

await check("D8/E7: pre-existing shares are NOT redeemed; only this deposit's minted delta is", async () => {
  const c = stubClients({ sharesBefore: 500n, minted: 777n });
  const redeemed = [];
  const orig = c.walletClient.sendTransaction;
  c.walletClient.sendTransaction = async (tx) => { if (!Object.prototype.hasOwnProperty.call(tx, "value")) redeemed.push(tx.data); return orig(tx); };
  const out = await runSecondPlumbingProof(runArgs(c));
  assert.equal(out.outcome, "done", out.reason || "");
  assert.equal(out.shmonReceived, 777n);
  assert.equal(redeemed[0], makeSecondRedeemTx(777n, ACCOUNT.address, ACCOUNT.address).data);
  assert.notEqual(redeemed[0], makeSecondRedeemTx(1277n, ACCOUNT.address, ACCOUNT.address).data, "never the whole balance");
  assert.equal(out.receipt.measuredDelta, "shMON 777 minted then redeemed");
});

await check("D8: balance unreadable before the deposit -> blocked, no send; delta <= 0 after -> failed no_shares_minted, no redeem, pending stays", async () => {
  const c1 = stubClients({ requirePendingBeforeSend: false });
  c1.publicClient.readContract = async () => { throw new Error("rpc down"); };
  const o1 = await runSecondPlumbingProof(runArgs(c1));
  assert.deepEqual([o1.outcome, o1.reason], ["blocked", "balance_before_unreadable"]);
  assert.equal(c1.sent.length, 0);
  const c2 = stubClients({ minted: 0n });
  const o2 = await runSecondPlumbingProof(runArgs(c2));
  assert.deepEqual([o2.outcome, o2.reason], ["failed", "no_shares_minted"]);
  assert.equal(c2.sent.length, 1, "only the deposit was sent");
  assert.equal(readSecondSendPending(c2.storage, SCOPE, PIGGY_ID).stage, "deposit-broadcast");
  const c3 = stubClients();
  let calls = 0;
  c3.publicClient.readContract = async () => { calls += 1; if (calls === 1) return 0n; throw new Error("rpc down"); };
  const o3 = await runSecondPlumbingProof(runArgs(c3));
  assert.deepEqual([o3.outcome, o3.reason], ["failed", "balance_read_error"]);
  assert.equal(c3.sent.length, 1);
});

await check("D5/D6 migration: an in-scope LEGACY record is migrated to the scoped key, reconciled, and the legacy key is deleted only after the verified save + clear", async () => {
  const st = createMemoryStorage();
  const legacy = { stage: "redeem-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH, redeemTxHash: REDEEM_HASH };
  st.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify(legacy));
  // a failing journey store: legacy must survive, scoped copy exists
  const fs = faultyStorage();
  fs.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify(legacy));
  fs.f.setThrows = (k) => k.startsWith(JOURNEY_PREFIX);
  const bad = await reconcileSecondPendingOnBoot({ storage: fs, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success", receipt: {} }) });
  assert.equal(bad.kind, "success_unsaved");
  assert.notEqual(fs.getItem(SECOND_SEND_PENDING_KEY), null, "legacy NOT deleted before the save cycle completed");
  assert.notEqual(fs.getItem(SCOPED_KEY), null);
  // a start is blocked meanwhile
  const c = stubClients({ requirePendingBeforeSend: false });
  assert.equal((await runSecondPlumbingProof(runArgs({ ...c, storage: fs }))).reason, "pending_exists");
  fs.f.setThrows = () => false;
  const good = await reconcileSecondPendingOnBoot({ storage: fs, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success", receipt: {} }) });
  assert.equal(good.kind, "success");
  assert.equal(fs.getItem(SCOPED_KEY), null);
  assert.equal(fs.getItem(SECOND_SEND_PENDING_KEY), null, "legacy deleted after the scoped cycle");
  const again = await reconcileSecondPendingOnBoot({ storage: fs, scope: SCOPE, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success" }) });
  assert.deepEqual(again, { kind: "none" });
});

await check("reconcile: invalid scope -> unknown (never reads or clears anything); zero chain sends during any reconcile", async () => {
  const st = createMemoryStorage();
  st.setItem(SCOPED_KEY, JSON.stringify({ stage: "deposit-broadcast", address: ACCOUNT.address, accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: PIGGY_ID, asset: "shMON", depositTxHash: DEPOSIT_HASH }));
  assert.deepEqual(await reconcileSecondPendingOnBoot({ storage: st, scope: {}, piggyId: PIGGY_ID, readTxReceipt: async () => ({ kind: "success" }) }), { kind: "unknown", reason: "invalid_scope" });
  assert.notEqual(st.getItem(SCOPED_KEY), null);
});

await check("source: the adapter has no direct broadcast call and no longer imports a bare global key for writes", () => {
  const adapterSrc = readFileSync(path.join(REPO, "app/src/second-execution-adapter.js"), "utf8");
  const code = adapterSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.ok(!/\.sendTransaction\(|\.sendRawTransaction\(|executor\.send\(/.test(code), "broadcast only through money-executor.js");
  assert.ok(/executeMoneyStep\(/.test(code));
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
