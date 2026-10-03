// [A-663] Second-owned testnet execution PLUMBING PROOF.
//
// Per the A-663 Owner correction (<private>, "A-663 OWNER CORRECTION — TESTNET
// shMON IS PLUMBING PROOF, NOT THE SECOND JOB", 2026-10-01): the Monad testnet shMON
// deposit/redeem roundtrip belongs to the First Journey lineage
// (second-job-readiness.js FIRST_JOURNEY_LINEAGE, id "fastlane-shmon",
// countsAsDistinctSecondExperience:false — NOT touched by this file). It is NOT a Second
// Journey product Job: it is never Explore-visible, never Send-visible, never selectable by
// a user, and it never counts toward Second Journey destination diversity.
//
// What this file IS: a narrow, reusable, Second-OWNED proof lane for exactly five things the
// A-663 card asks for —
//   1. Second-owned pending persistence (its own storage key, never First's SEND_PENDING_KEY)
//   2. duplicate-send prevention across reload/reopen
//   3. a fail-closed permission gate (nothing runs without an explicit `confirm:true`)
//   4. a truthful testnet-actual receipt/evidence contract (PASS_TESTNET_ACTUAL_TX, its own
//      executionMode "testnet_actual" — second-journey-receipt-bridge.js classifies it)
//   5. reconcile → the existing Second receipt bridge (commitSecondJourneyReceipt)
//
// [A-693 / A-680 M1] Durability + chokepoint hardening of this lane (D1-D8, R7, T11):
//   · every broadcast goes through money-executor.js (authorize -> reserve -> persist-nonce -> sign ->
//     persist-hash -> broadcast; this lane uses the compat "viem_send" transport, so the hash is persisted
//     right after the send with bounded retries and a failure is reported as `*_hash_unsaved`, never thrown)
//   · pending key is scoped per chain/account/Piggy (D6); the old global key is read only for migration (D5)
//   · pending reads are tri-state none|ok|corrupt|storage_error and only `none` may start a send (D4/T11)
//   · redeem amount = shares minted by THIS deposit (balance after - balance before), never the whole balance (D8)
//   · order on success: receipt build -> durable save (bridge) -> verify by re-read -> compare-and-clear pending (D1);
//     a failed save keeps the pending record and reports `done_unsaved` / `success_unsaved` so reconcile retries
//   · reconcile never re-broadcasts and never clears a record it did not verify (unchanged)
//
// Nothing here is wired into Explore/candidates/handleSecondSend/canSend. The only call site
// is a LOCAL_ONLY, LOCAL_DEV_ENTRY-gated harness entry point in main.js
// (window.__ARASO_LOCAL_TEST_SECOND_PLUMBING_RUN__) used by a coordinator-driven browser test
// against a local/mock RPC — never reachable in production, never reachable from the product
// Second Journey UI. Every dependency (account/walletClient/publicClient/signDigest) is
// injected by the caller; this module owns no live client and reuses none of First's module-
// scoped singletons (publicClient/activeAccount/activeSession) or stateful functions
// (sendPiggyOnce, requestGrant, readSendPending/writeSendPending, classifySendPending,
// reconcileSendPending, commitSendSuccess, finishTrip — all untouched, all still main.js-only).

import { encodeFunctionData } from "viem";
import { executeMoneyStep, TRANSPORT_KIND } from "./money-executor.js";
import { commitSecondJourneyReceipt } from "./second-journey-receipt-bridge.js";
import { loadSecondJourneyState, validatePersistenceScope } from "./second-journey-state.js";

// LEGACY single global key (A-663 original). Since A-693 it is only READ for migration/blocking; new records
// are written to secondSendPendingKey(scope, piggyId). It is deleted only after its record was migrated to the
// scoped key and that scoped record completed a verified save + clear cycle (Owner timing question stays open).
export const SECOND_SEND_PENDING_KEY = "araso.secondSendPending";
export const SECOND_SEND_PENDING_LEGACY_KEY = SECOND_SEND_PENDING_KEY;
export const SECOND_SEND_PENDING_KEY_PREFIX = "araso.secondSendPending.v1";
export const SECOND_SEND_PENDING_STAGES = Object.freeze([
  "deposit-sending",
  "deposit-broadcast",
  "redeem-sending",
  "redeem-broadcast",
]);

// Standalone descriptor — never registered in job-feed.js buildDestinationFixtures() or
// second-job-readiness.js FORK_PROVEN_DESTINATIONS/buildExecutionPlan(). It identifies the
// plumbing-proof lane's own receipt rows only; it is not a Job id and never appears in Explore.
export const SECOND_PLUMBING_DESTINATION_ID = "second-execution-plumbing-proof";
export const SECOND_PLUMBING_EVIDENCE_CLASS = "PASS_TESTNET_ACTUAL_TX";
export const SECOND_PLUMBING_EXECUTION_MODE = "testnet_actual";
// Distinct from First's `araso:mera:send-piggy-to-work:v1:${address}` (main.js:2020) — a
// Second-owned signature can never be replayed against First's digest or vice versa.
export const SECOND_SIGN_MESSAGE_PREFIX = "araso:mera:second-execution-plumbing-proof:v1:";

// Own copy of the already-verified testnet shMON vault address/ABI shape (main.js SHMON_ADDRESS/
// SHMON_ABI, A-451/A-441 proven). Duplicated, not imported: main.js exports nothing, and the
// card's reuse rule is "verified low-level shMON primitives", not a shared mutable singleton.
const SHMON_ADDRESS = "0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9";
const SHMON_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
];

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function isTxHashLike(value) {
  return typeof value === "string" && TX_HASH_RE.test(value);
}

export function makeSecondDepositTx(amountWei, receiver) {
  return {
    to: SHMON_ADDRESS,
    value: amountWei,
    data: encodeFunctionData({ abi: SHMON_ABI, functionName: "deposit", args: [amountWei, receiver] }),
  };
}

export function makeSecondRedeemTx(shares, receiver, owner) {
  if (shares <= 0n) throw new Error("no shMON received");
  return {
    to: SHMON_ADDRESS,
    data: encodeFunctionData({ abi: SHMON_ABI, functionName: "redeem", args: [shares, receiver, owner] }),
  };
}

const enc = (v) => encodeURIComponent(String(v)).replace(/\./g, "%2E");

/** [A-693 D6] Per chain + account + Piggy key (mirrors mainnet-job-lane laneIntentKey). null when the scope is invalid. */
export function secondSendPendingKey(scope = {}, piggyId = "") {
  const valid = validatePersistenceScope(scope);
  const piggy = typeof piggyId === "string" ? piggyId.trim() : "";
  if (valid.error || !piggy) return null;
  return `${SECOND_SEND_PENDING_KEY_PREFIX}.${enc(valid.chainId)}.${enc(valid.accountId)}.${enc(piggy)}`;
}

/**
 * [A-693 D4] Tri-state read. A getItem throw is `storage_error` and unparseable/unknown-stage JSON is `corrupt`:
 * neither is ever "no pending". Only `none` (key absent) may allow a start.
 * @returns {{status: "none"|"ok"|"corrupt"|"storage_error", pending: object|null}}
 */
export function inspectSecondSendPending(storage, key) {
  if (!storage || typeof storage.getItem !== "function" || !key) return { status: "storage_error", pending: null };
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: "storage_error", pending: null };
  }
  if (raw === null || raw === undefined) return { status: "none", pending: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && SECOND_SEND_PENDING_STAGES.includes(parsed.stage)) return { status: "ok", pending: parsed };
  } catch {
    /* fall through */
  }
  return { status: "corrupt", pending: null };
}

// Legacy-shaped read: null (absent) | the record | {stage:"unknown"} (corrupt) | {stage:"unknown", error:"storage_error"}.
// With (scope, piggyId) it reads the scoped key; without, the legacy global key.
export function readSecondSendPending(storage, scope = null, piggyId = "") {
  const key = scope ? secondSendPendingKey(scope, piggyId) : SECOND_SEND_PENDING_LEGACY_KEY;
  if (!key) return { stage: "unknown", error: "invalid_scope" };
  const r = inspectSecondSendPending(storage, key);
  if (r.status === "none") return null;
  if (r.status === "ok") return r.pending;
  return r.status === "storage_error" ? { stage: "unknown", error: "storage_error" } : { stage: "unknown" };
}

/** [A-693] Write + read-back verify. Never throws; `ok:true` only when the stored bytes equal what was written. */
export function writeSecondSendPending(storage, key, entry) {
  if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function" || !key) return { ok: false, error: "storage_unavailable" };
  const serialized = JSON.stringify({ ...entry, at: Date.now() });
  try {
    storage.setItem(key, serialized);
  } catch {
    return { ok: false, error: "storage_write_failed" };
  }
  try {
    return storage.getItem(key) === serialized ? { ok: true, error: null } : { ok: false, error: "write_not_verified" };
  } catch {
    return { ok: false, error: "write_not_verified" };
  }
}

// Unconditional removal (kept for the A-663 export surface). Product paths use clearSecondSendPendingIf.
export function clearSecondSendPending(storage, key = SECOND_SEND_PENDING_LEGACY_KEY) {
  if (!storage) return;
  storage.removeItem(key);
}

const sameRecord = (a, b) =>
  !!a && !!b && a.stage === b.stage && a.depositTxHash === b.depositTxHash && a.redeemTxHash === b.redeemTxHash && a.reservationId === b.reservationId;

/**
 * [A-693] Compare-and-clear: removes `key` only if the stored record is still the expected one (stage + hashes +
 * reservationId), then re-reads to confirm it is gone. A different or unreadable record is left alone.
 */
export function clearSecondSendPendingIf(storage, key, expected) {
  const cur = inspectSecondSendPending(storage, key);
  if (cur.status === "none") return { cleared: true, reason: "already_clear" };
  if (cur.status !== "ok") return { cleared: false, reason: cur.status === "corrupt" ? "pending_corrupt" : "pending_unreadable" };
  if (!sameRecord(cur.pending, expected)) return { cleared: false, reason: "pending_changed" };
  try {
    storage.removeItem(key);
  } catch {
    return { cleared: false, reason: "storage_write_failed" };
  }
  return inspectSecondSendPending(storage, key).status === "none" ? { cleared: true, reason: null } : { cleared: false, reason: "clear_not_verified" };
}

// Bound to chain + asset + token(shMON) + Piggy — a reload never cross-reads another Piggy's,
// another account's, another chain's, or another asset's pending record.
export function secondSendPendingBelongsToScope(pending, scope = {}) {
  return (
    !!pending &&
    pending.stage !== "unknown" &&
    pending.accountId === scope.accountId &&
    pending.chainId === scope.chainId &&
    pending.piggyId === scope.piggyId &&
    pending.asset === "shMON"
  );
}

/**
 * [A-693 D4/D5/T11] Why a new send must not start, or null when it may. Checked on the scoped key AND the legacy
 * global key: any readable record blocks (an out-of-scope legacy record is unresolved money of an unknown Piggy),
 * and so does anything unreadable/corrupt. Synchronous — no await between this and the reserving write.
 */
function blockingPendingReason(storage, scope, piggyId, key) {
  const here = inspectSecondSendPending(storage, key);
  if (here.status === "storage_error") return "pending_unreadable";
  if (here.status === "corrupt") return "pending_corrupt";
  if (here.status === "ok") return "pending_exists";
  const legacy = inspectSecondSendPending(storage, SECOND_SEND_PENDING_LEGACY_KEY);
  if (legacy.status === "storage_error") return "pending_unreadable";
  if (legacy.status === "corrupt") return "pending_corrupt";
  if (legacy.status === "ok") return secondSendPendingBelongsToScope(legacy.pending, { ...scope, piggyId }) ? "pending_exists" : "legacy_pending_out_of_scope";
  return null;
}

// Atomic (single tick) check-then-write of the first record of a run, verified by read-back.
function reservePending(storage, scope, piggyId, key, record) {
  const blockedBy = blockingPendingReason(storage, scope, piggyId, key);
  if (blockedBy) return { ok: false, reason: blockedBy };
  const w = writeSecondSendPending(storage, key, record);
  return w.ok ? { ok: true } : { ok: false, reason: "pending_write_failed" };
}

// Move this run's own record forward (reservationId must still match). Idempotent for executor retries: a record
// that already is the target counts as done.
function transitionPending(storage, key, from, next) {
  const cur = inspectSecondSendPending(storage, key);
  if (cur.status !== "ok") return { ok: false, reason: cur.status === "none" ? "pending_missing" : cur.status === "corrupt" ? "pending_corrupt" : "pending_unreadable" };
  if (cur.pending.reservationId !== from.reservationId) return { ok: false, reason: "pending_changed" };
  if (cur.pending.stage === next.stage && cur.pending.depositTxHash === next.depositTxHash && cur.pending.redeemTxHash === next.redeemTxHash) return { ok: true };
  if (cur.pending.stage !== from.stage || cur.pending.depositTxHash !== from.depositTxHash) return { ok: false, reason: "pending_changed" };
  const w = writeSecondSendPending(storage, key, next);
  return w.ok ? { ok: true } : { ok: false, reason: "pending_write_failed" };
}

// Stage classifier — mirrors main.js classifySendPending()'s shape (kind:
// unknown|pending|deposit-confirmed|failed|success) as independent, new code. `readTxReceipt`
// is injected (address, hash) => { kind: "success"|"reverted"|"pending"|"unknown", receipt? }.
export async function classifySecondSendPending(pending, { readTxReceipt } = {}) {
  if (!pending || typeof readTxReceipt !== "function") return { kind: "unknown" };
  const address = pending.address;
  if (typeof address !== "string" || !ADDRESS_RE.test(address)) return { kind: "unknown" };
  if (pending.stage === "deposit-broadcast" && isTxHashLike(pending.depositTxHash)) {
    const dep = await readTxReceipt(pending.depositTxHash, address);
    if (dep.kind === "success") return { kind: "deposit-confirmed", depositReceipt: dep.receipt || null };
    return { kind: dep.kind === "reverted" ? "failed" : dep.kind };
  }
  if (pending.stage === "redeem-broadcast" && isTxHashLike(pending.redeemTxHash) && isTxHashLike(pending.depositTxHash)) {
    const red = await readTxReceipt(pending.redeemTxHash, address);
    if (red.kind !== "success") return { kind: red.kind === "reverted" ? "failed" : red.kind };
    const dep = await readTxReceipt(pending.depositTxHash, address);
    return {
      kind: "success",
      redeemReceipt: red.receipt || null,
      depositReceipt: dep.kind === "success" ? dep.receipt || null : null,
      depositTxHash: pending.depositTxHash,
      redeemTxHash: pending.redeemTxHash,
    };
  }
  // deposit-sending / redeem-sending / unknown / no trustworthy broadcast hash yet.
  return { kind: "unknown" };
}

function buildPlumbingReceipt(pending, evidence = {}) {
  return {
    eventId: `second-plumbing-${pending.redeemTxHash}`,
    outcome: "done",
    evidenceClass: SECOND_PLUMBING_EVIDENCE_CLASS,
    executionMode: SECOND_PLUMBING_EXECUTION_MODE,
    accountId: pending.accountId,
    chainId: pending.chainId,
    piggyId: pending.piggyId,
    destinationId: SECOND_PLUMBING_DESTINATION_ID,
    txHash: pending.redeemTxHash,
    depositTxHash: pending.depositTxHash,
    redeemTxHash: pending.redeemTxHash,
    at: Date.now(),
    // [A-663 state/receipt review] Same evidence fields as the direct-success path
    // (blockNumber/measuredDelta) — filled only when actually available from the injected
    // readTxReceipt result, never fabricated. `measuredDelta` is explicitly the literal string
    // "unknown" (not omitted, not guessed) when reconcile cannot re-derive the shares amount —
    // reconcile only confirms tx status from the stored record, it never re-reads the shMON
    // balance (that would need a fresh readContract this entry point does not have).
    ...(Number.isFinite(evidence.blockNumber) ? { blockNumber: evidence.blockNumber } : {}),
    measuredDelta: "unknown",
  };
}

// [A-693 D1/D2] The only way a run or a reconcile may finish: durable save of the receipt through the bridge,
// verified by a fresh read, THEN a compare-and-clear of the pending record. Any failure keeps the pending record.
function finalizeSuccess({ storage, scope, key, pending, receipt }) {
  const loaded = loadSecondJourneyState(storage, scope);
  // An unreadable journey store is never overwritten here; pending stays and reconcile retries later.
  if (loaded.error || loaded.repaired) return { saved: false, cleared: false, reason: "journey_state_unreadable" };
  const out = commitSecondJourneyReceipt({ state: loaded.state, receipt, scope, storage, context: { devPreview: false } });
  if (out.saved !== true) return { saved: false, cleared: false, reason: out.reason || "receipt_not_saved" };
  const cleared = clearSecondSendPendingIf(storage, key, pending);
  if (!cleared.cleared) return { saved: true, cleared: false, reason: cleared.reason };
  // Legacy cleanup only after the scoped record completed save + clear, and only if the legacy record is the same one.
  const legacy = inspectSecondSendPending(storage, SECOND_SEND_PENDING_LEGACY_KEY);
  if (legacy.status === "ok" && sameRecord(legacy.pending, pending)) clearSecondSendPendingIf(storage, SECOND_SEND_PENDING_LEGACY_KEY, legacy.pending);
  return { saved: true, cleared: true, reason: null };
}

// Boot/reopen reconcile. Read-only toward the chain — never re-broadcasts, never clears a pending record that
// is not a confirmed success whose receipt was durably saved, never touches a record outside the given scope.
// Result kinds: none | out_of_scope | unknown | pending | failed | success | success_unsaved (saved failed, pending kept).
export async function reconcileSecondPendingOnBoot({ storage, scope = {}, piggyId, readTxReceipt } = {}) {
  const key = secondSendPendingKey(scope, piggyId);
  if (!key) return { kind: "unknown", reason: "invalid_scope" };
  const bind = { ...scope, piggyId };
  let cur = inspectSecondSendPending(storage, key);
  if (cur.status === "none") {
    const legacy = inspectSecondSendPending(storage, SECOND_SEND_PENDING_LEGACY_KEY);
    if (legacy.status === "none") return { kind: "none" };
    if (legacy.status !== "ok") return { kind: "unknown", reason: legacy.status === "corrupt" ? "pending_corrupt" : "pending_unreadable" };
    if (!secondSendPendingBelongsToScope(legacy.pending, bind)) return { kind: "out_of_scope" };
    // Migrate the in-scope legacy record to the scoped key (verified) before acting on it; legacy is deleted later.
    if (!writeSecondSendPending(storage, key, { ...legacy.pending, migratedFromLegacy: true }).ok) return { kind: "unknown", reason: "migration_write_failed" };
    cur = inspectSecondSendPending(storage, key);
  }
  if (cur.status !== "ok") return { kind: "unknown", reason: cur.status === "corrupt" ? "pending_corrupt" : "pending_unreadable" };
  const pending = cur.pending;
  if (!secondSendPendingBelongsToScope(pending, bind)) return { kind: "out_of_scope" };
  const result = await classifySecondSendPending(pending, { readTxReceipt });
  if (result.kind === "success") {
    const rawBlock = result.redeemReceipt?.blockNumber;
    const blockNumber = rawBlock !== undefined && rawBlock !== null ? Number(rawBlock) : NaN;
    const receipt = buildPlumbingReceipt(pending, { blockNumber });
    const fin = finalizeSuccess({ storage, scope, key, pending, receipt });
    if (!fin.saved || !fin.cleared) return { kind: "success_unsaved", reason: fin.reason, receipt };
    return { kind: "success", receipt };
  }
  if (result.kind === "failed") return { kind: "failed" };
  return { kind: result.kind === "unknown" ? "unknown" : "pending" };
}

async function waitForTxSuccess(publicClient, hash) {
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch {
    return null;
  }
  return receipt && receipt.status === "success" ? receipt : null;
}

const newReservationId = () => globalThis.crypto?.randomUUID?.() || `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Maps a money-executor result to this lane's outcome vocabulary. Nothing here retries.
function mapExecutor(res, names) {
  if (res.ok) return null;
  if (res.status === "blocked") return { outcome: "blocked", reason: res.reason };
  if (res.status === "unknown_hash_unsaved") return { outcome: "failed", reason: names.hashUnsaved, [names.hashField]: res.hash };
  return { outcome: "failed", reason: names.sendError };
}

// The orchestrator. Every side effect is injected and every broadcast goes through money-executor.js; this
// function itself opens no network connection and holds no credential. The reserving pending write happens
// BEFORE each broadcast, and a hash is persisted (verified) right after it.
export async function runSecondPlumbingProof({
  storage,
  scope,
  piggyId,
  amountWei,
  confirm,
  account,
  walletClient,
  publicClient,
  signDigest,
  requestGrant = null,
  waitForGrantBalance = null,
  isAppLocked = null,
} = {}) {
  // Fail-closed permission gate — nothing below runs without an explicit, caller-confirmed
  // request. This is the plumbing lane's own analogue of "permission missing/mismatch => action0".
  if (confirm !== true) return { outcome: "blocked", reason: "permission_not_confirmed" };
  if (!scope || typeof scope.accountId !== "string" || !scope.accountId || typeof scope.chainId !== "string" || !scope.chainId) {
    return { outcome: "blocked", reason: "invalid_scope" };
  }
  if (typeof piggyId !== "string" || !piggyId) return { outcome: "blocked", reason: "missing_piggy" };
  if (!account || typeof account.address !== "string" || !ADDRESS_RE.test(account.address)) {
    return { outcome: "blocked", reason: "missing_account" };
  }
  if (typeof walletClient?.sendTransaction !== "function" || typeof publicClient?.waitForTransactionReceipt !== "function" || typeof publicClient?.readContract !== "function") {
    return { outcome: "blocked", reason: "missing_clients" };
  }
  let amount;
  try {
    amount = BigInt(amountWei);
  } catch {
    return { outcome: "blocked", reason: "invalid_amount" };
  }
  if (amount <= 0n) return { outcome: "blocked", reason: "invalid_amount" };
  // [A-693] No durable store, no money movement (previously the run proceeded with no pending trail at all).
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    return { outcome: "blocked", reason: "storage_unavailable" };
  }
  const key = secondSendPendingKey(scope, piggyId);
  if (!key) return { outcome: "blocked", reason: "invalid_scope" };

  // Duplicate-send prevention: ANY readable, unreadable or corrupt record (scoped or legacy) blocks a new
  // broadcast — the caller should reconcile instead, never start a second one. (Re-checked atomically at reserve.)
  const early = blockingPendingReason(storage, scope, piggyId, key);
  if (early) return { outcome: "blocked", reason: early };

  // Grant is conditional — exactly First's waitForGrantBalance pattern (check/call, then treat
  // "not granted" as non-error, since api/grant.js answers 403-already-funded the same way).
  if (typeof requestGrant === "function") {
    let grant;
    try {
      grant = await requestGrant(account.address);
    } catch {
      return { outcome: "failed", reason: "grant_error" };
    }
    if (grant?.granted && typeof waitForGrantBalance === "function") {
      const visible = await waitForGrantBalance(account.address);
      if (!visible) return { outcome: "failed", reason: "grant_not_visible" };
    }
  }

  if (typeof signDigest === "function") {
    try {
      const bytes = new TextEncoder().encode(`${SECOND_SIGN_MESSAGE_PREFIX}${account.address}`);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      await signDigest(digest);
    } catch {
      return { outcome: "failed", reason: "sign_error" };
    }
  }

  // [A-693 D8] Share balance BEFORE this deposit, so the redeem amount is only what this deposit minted.
  let shareBefore;
  try {
    shareBefore = BigInt(await publicClient.readContract({ address: SHMON_ADDRESS, abi: SHMON_ABI, functionName: "balanceOf", args: [account.address] }));
  } catch {
    return { outcome: "blocked", reason: "balance_before_unreadable" };
  }

  const base = { address: account.address, accountId: scope.accountId, chainId: scope.chainId, piggyId, asset: "shMON", reservationId: newReservationId(), shareBefore: shareBefore.toString() };
  const authorize = () => {
    if (confirm !== true) return { ok: false, reason: "permission_not_confirmed" };
    if (typeof isAppLocked === "function" && isAppLocked()) return { ok: false, reason: "app_locked" };
    return { ok: true };
  };
  const transport = { kind: TRANSPORT_KIND.VIEM_SEND, walletClient, account };

  // ── deposit ────────────────────────────────────────────────────────────────────────────────
  const depositSending = { ...base, stage: "deposit-sending" };
  const dep = await executeMoneyStep({
    tx: makeSecondDepositTx(amount, account.address),
    transport,
    authorize,
    reserve: () => reservePending(storage, scope, piggyId, key, depositSending),
    persistHash: ({ hash }) => transitionPending(storage, key, depositSending, { ...base, stage: "deposit-broadcast", depositTxHash: hash }),
  });
  const depStop = mapExecutor(dep, { sendError: "deposit_send_error", hashUnsaved: "deposit_hash_unsaved", hashField: "depositTxHash" });
  if (depStop) return depStop;
  const depositTxHash = dep.hash;
  const depositBroadcast = { ...base, stage: "deposit-broadcast", depositTxHash };

  const depositReceipt = await waitForTxSuccess(publicClient, depositTxHash);
  if (!depositReceipt) return { outcome: "failed", reason: "deposit_unconfirmed_or_reverted" };

  // [A-693 D8] Redeem only what this deposit minted. Anything else (unreadable, non-positive) stops here with the
  // pending record still at deposit-broadcast (value stays as shMON; reconcile classifies by the stored hash).
  let shareAfter;
  try {
    shareAfter = BigInt(await publicClient.readContract({ address: SHMON_ADDRESS, abi: SHMON_ABI, functionName: "balanceOf", args: [account.address] }));
  } catch {
    return { outcome: "failed", reason: "balance_read_error" };
  }
  const shmonReceived = shareAfter - shareBefore;
  if (shmonReceived <= 0n) return { outcome: "failed", reason: "no_shares_minted" };

  // ── redeem ─────────────────────────────────────────────────────────────────────────────────
  const redeemSending = { ...base, stage: "redeem-sending", depositTxHash, sharesToRedeem: shmonReceived.toString() };
  const red = await executeMoneyStep({
    tx: makeSecondRedeemTx(shmonReceived, account.address, account.address),
    transport,
    authorize,
    reserve: () => transitionPending(storage, key, depositBroadcast, redeemSending),
    persistHash: ({ hash }) => transitionPending(storage, key, redeemSending, { ...redeemSending, stage: "redeem-broadcast", redeemTxHash: hash }),
  });
  const redStop = mapExecutor(red, { sendError: "redeem_send_error", hashUnsaved: "redeem_hash_unsaved", hashField: "redeemTxHash" });
  if (redStop) return { ...redStop, depositTxHash };
  const redeemTxHash = red.hash;
  const redeemBroadcast = { ...redeemSending, stage: "redeem-broadcast", redeemTxHash };

  const redeemReceipt = await waitForTxSuccess(publicClient, redeemTxHash);
  if (!redeemReceipt) return { outcome: "failed", reason: "redeem_unconfirmed_or_reverted" };

  // [A-693 D1] execution truth -> receipt build -> durable save -> verify -> compare-and-clear.
  const receipt = {
    ...buildPlumbingReceipt({ accountId: scope.accountId, chainId: scope.chainId, piggyId, depositTxHash, redeemTxHash }),
    blockNumber: Number(redeemReceipt.blockNumber || 0),
    measuredDelta: `shMON ${shmonReceived.toString()} minted then redeemed`,
  };
  const fin = finalizeSuccess({ storage, scope, key, pending: redeemBroadcast, receipt });
  if (!fin.saved || !fin.cleared) {
    return { outcome: "done_unsaved", reason: fin.reason, receipt, depositTxHash, redeemTxHash, shmonReceived };
  }
  return { outcome: "done", receipt, depositTxHash, redeemTxHash, shmonReceived };
}
