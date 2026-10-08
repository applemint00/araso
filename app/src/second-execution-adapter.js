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
// [A-710 L1] A-693 M-1/M-2 closed for this lane: a run needs an injected exclusive cross-tab lock (`withMoneyLock`,
// per chain + account) and an app-lock reader (`isAppLocked`); without either it refuses before grant/sign/send.
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

import { encodeAbiParameters, encodeFunctionData, keccak256, maxUint256, stringToBytes } from "viem";
import { executeMoneyStep, TRANSPORT_KIND } from "./money-executor.js";
import { commitSecondJourneyReceipt } from "./second-journey-receipt-bridge.js";
import { loadSecondJourneyState, validatePersistenceScope } from "./second-journey-state.js";
// Aave mainnet lane execution boundary (section at the end of this file). The lane stays the only place that
// builds the lifecycle and calls the executor; this file only re-checks and seals what reaches it.
import { authorize } from "./permission-envelope.js";
import { EXECUTION_MODE, buildExecutionPlan } from "./second-job-readiness.js";
import { CURRENT_READER_STATUS } from "./second-current-reader.js";
import {
  LANE_AMOUNT_CAP_RAW, LANE_FORK_EVIDENCE, LANE_JOB_ID, LANE_RECEIPT_TOKEN, LANE_SELECTORS, LANE_STAGE, MAINNET_LANE_CONFIG,
  advanceLaneIntent, buildLaneReceipt, loadLaneIntent, reconcileLaneIntent,
} from "./mainnet-job-lane.js";
// [A-883] Receipt evidence sidecar: mapping only (observation, never authority). See "Receipt evidence sidecar" below.
import { mapSecondEvidence } from "./receipt-evidence-second.js";

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
  // A non-string receiver (e.g. a one-element array that a regex would coerce) is refused here, not passed to the encoder.
  if (typeof receiver !== "string" || !ADDRESS_RE.test(receiver)) throw new Error("invalid receiver");
  return {
    to: SHMON_ADDRESS,
    value: amountWei,
    data: encodeFunctionData({ abi: SHMON_ABI, functionName: "deposit", args: [amountWei, receiver] }),
  };
}

export function makeSecondRedeemTx(shares, receiver, owner) {
  if (shares <= 0n) throw new Error("no shMON received");
  if (typeof receiver !== "string" || !ADDRESS_RE.test(receiver) || typeof owner !== "string" || !ADDRESS_RE.test(owner)) throw new Error("invalid receiver");
  return {
    to: SHMON_ADDRESS,
    data: encodeFunctionData({ abi: SHMON_ABI, functionName: "redeem", args: [shares, receiver, owner] }),
  };
}

const enc = (v) => encodeURIComponent(String(v)).replace(/\./g, "%2E");

/** [A-710 L1] Exclusive cross-tab money lock name for the Second lane: per chain + account (not per Piggy). */
export const SECOND_MONEY_LOCK_PREFIX = "araso.secondMoney.v1";
export function secondMoneyLockName(scope = {}) {
  const valid = validatePersistenceScope(scope || {});
  if (valid.error) return null;
  return `${SECOND_MONEY_LOCK_PREFIX}.${enc(valid.chainId)}.${enc(valid.accountId.toLowerCase())}`;
}

/** [A-693 D6] Per chain + account + Piggy key (mirrors mainnet-job-lane laneIntentKey). null when the scope is invalid. */
export function secondSendPendingKey(scope = {}, piggyId = "") {
  const valid = validatePersistenceScope(scope || {});
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
  if (!scope || typeof scope !== "object") return false;
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
export async function classifySecondSendPending(pending, opts = {}) {
  const readTxReceipt = opts?.readTxReceipt;
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

// ── [A-883] Receipt evidence sidecar (observation only) ────────────────────────────────────────────────────────
// Runs AFTER a call site's own tx/result boundary is settled, on hashes that call site already has. It never
// changes the result object, its order, a retry, a lock, a pending record or a permission:
//   · injected only: opts.evidence = { store, chainId, now, onReport } (default none). No evidence object, or one
//     with neither a store nor onReport => nothing at all runs (no mapping, no read, no write).
//   · store = an A-868 evidence store (append). Only staged tx seeds are appended; a FORK_SIM hash has no seed and is
//     never written. Decision receipts (state_observation) are never handled here and never reach a store.
//   · any failure (bad config, mapping refusal, store refusal/throw/async, onReport throw) is swallowed into the
//     report's evidenceErrors; nothing is thrown or returned to the money path.
function evidenceSidecarConfig(evidence) {
  if (evidence === null || evidence === undefined) return null;
  try {
    if (typeof evidence !== "object") return null;
    const store = evidence.store ?? null;
    const onReport = typeof evidence.onReport === "function" ? evidence.onReport : null;
    if (!store && !onReport) return null;
    return { store, onReport, chainId: evidence.chainId, now: evidence.now };
  } catch {
    return null; // an unreadable evidence config is no evidence; the money path never sees it
  }
}

function swallowAsync(value) {
  try {
    if (value && typeof value.then === "function") value.then(undefined, () => {});
  } catch { /* evidence layer only */ }
}

function appendEvidenceSeed(store, item) {
  try {
    if (!store || typeof store.append !== "function") return { evidenceKey: item.evidenceKey, ok: false, reason: "evidence_store_unavailable" };
    const res = store.append(item.seed);
    if (res && typeof res.then === "function") {
      swallowAsync(res);
      return { evidenceKey: item.evidenceKey, ok: false, reason: "evidence_store_async_unconfirmed" };
    }
    if (res && res.ok === true) return { evidenceKey: item.evidenceKey, ok: true, outcome: typeof res.outcome === "string" ? res.outcome : null };
    return { evidenceKey: item.evidenceKey, ok: false, reason: typeof res?.reason === "string" ? res.reason.slice(0, 64) : "evidence_store_refused" };
  } catch {
    return { evidenceKey: item.evidenceKey, ok: false, reason: "evidence_store_threw" };
  }
}

// sources = { plumbingPending, laneIntent, laneReceipt } (tx sources only).
function recordSecondTxEvidence(cfg, sources) {
  if (!cfg) return;
  const report = { journey: "second", authority: "observation_only", staged: [], stored: [], refused: [], evidenceErrors: [] };
  try {
    const mapped = mapSecondEvidence({ ...sources, chainId: cfg.chainId, now: cfg.now });
    if (!mapped || mapped.ok !== true) {
      report.evidenceErrors.push({ reason: typeof mapped?.reason === "string" ? mapped.reason : "evidence_mapping_failed" });
    } else {
      report.staged = [...mapped.staged];
      report.refused = [...mapped.refused];
      if (cfg.store) {
        for (const item of mapped.staged) {
          if (!item.seed) continue;
          const r = appendEvidenceSeed(cfg.store, item);
          report.stored.push(Object.freeze(r));
          if (!r.ok) report.evidenceErrors.push(Object.freeze({ evidenceKey: r.evidenceKey, reason: r.reason }));
        }
      }
    }
  } catch {
    report.evidenceErrors.push({ reason: "evidence_mapping_threw" });
  }
  if (!cfg.onReport) return;
  try {
    for (const k of ["staged", "stored", "refused", "evidenceErrors"]) Object.freeze(report[k]);
    swallowAsync(cfg.onReport(Object.freeze(report)));
  } catch { /* evidence layer only */ }
}

// Boot/reopen reconcile. Read-only toward the chain — never re-broadcasts, never clears a pending record that
// is not a confirmed success whose receipt was durably saved, never touches a record outside the given scope.
// Result kinds: none | out_of_scope | unknown | pending | failed | success | success_unsaved (saved failed, pending kept).
// [A-883] Not async on purpose: without an evidence sidecar the caller gets the very same promise as before.
export function reconcileSecondPendingOnBoot(opts = {}) {
  let cfg = null;
  try { cfg = evidenceSidecarConfig(opts?.evidence); } catch { cfg = null; }
  if (!cfg) return reconcileSecondPendingCore(opts, null);
  const seen = {};
  return reconcileSecondPendingCore(opts, seen).then((out) => {
    // After the reconcile result is final: the pending record it classified (if any) is observed, never changed.
    if (seen.pending) recordSecondTxEvidence(cfg, { plumbingPending: seen.pending });
    return out;
  });
}

async function reconcileSecondPendingCore(opts, seen) {
  // A null options object (or null scope) is an invalid scope, not a TypeError.
  const { storage, scope: rawScope, piggyId, readTxReceipt } = opts || {};
  const scope = rawScope || {};
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
  if (seen) seen.pending = pending; // [A-883] evidence sidecar only: an in-scope record this reconcile classifies
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
export async function runSecondPlumbingProof(opts = {}) {
  const {
    storage,
    scope: rawScope,
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
    withMoneyLock = null,
    evidence = null,
  } = opts || {};
  // Fail-closed permission gate — nothing below runs without an explicit, caller-confirmed
  // request. This is the plumbing lane's own analogue of "permission missing/mismatch => action0".
  if (confirm !== true) return { outcome: "blocked", reason: "permission_not_confirmed" };
  // One snapshot of the caller's scope and signer address: a getter that answers differently on a later read
  // can never change which key / lock / receiver / owner the run uses after validation.
  let scope;
  let accountAddress;
  try {
    scope = rawScope && typeof rawScope === "object" ? { ...rawScope } : null;
    accountAddress = account && typeof account === "object" ? account.address : undefined;
  } catch {
    return { outcome: "blocked", reason: "invalid_scope" };
  }
  if (!scope || typeof scope.accountId !== "string" || !scope.accountId || typeof scope.chainId !== "string" || !scope.chainId) {
    return { outcome: "blocked", reason: "invalid_scope" };
  }
  if (typeof piggyId !== "string" || !piggyId) return { outcome: "blocked", reason: "missing_piggy" };
  if (!account || typeof accountAddress !== "string" || !ADDRESS_RE.test(accountAddress)) {
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
  // [A-710 L1 · A-693 M-2] The app-lock state is required, not optional: absent means unknown, and unknown
  // refuses before any grant / sign / broadcast (previously an absent function meant "not locked").
  if (typeof isAppLocked !== "function") return { outcome: "blocked", reason: "app_lock_state_unknown" };
  // [A-710 L1 · A-693 M-1] Cross-tab reservation: the whole run (pending check -> grant -> sign -> deposit ->
  // redeem -> receipt save) runs inside ONE exclusive lock per chain + account (account level, so two Piggies of
  // the same address cannot interleave either: A-693 L-1). The lock primitive is injected (main.js exports
  // nothing; the caller passes a Web Locks wrapper). No primitive = refuse before signing.
  if (typeof withMoneyLock !== "function") return { outcome: "blocked", reason: "lock_unsupported" };
  const lockName = secondMoneyLockName(scope);
  if (!lockName) return { outcome: "blocked", reason: "invalid_scope" };
  const evidenceSeen = {}; // [A-883] evidence sidecar only: hashes this run broadcast (assignment-only, never read by the run)
  let locked;
  try {
    // A throw from the run itself is that run's failure (pending record kept, nothing retried), not a lock problem.
    locked = await withMoneyLock(lockName, async () => {
      try {
        return { ran: true, value: await runUnderLock() };
      } catch {
        return { ran: true, value: { outcome: "failed", reason: "run_error" } };
      }
    });
  } catch {
    return { outcome: "blocked", reason: "lock_unsupported" };
  }
  // The body did not run: another tab (or this one) holds the lock, or the primitive did not grant it.
  if (!locked || locked.ran !== true) return { outcome: "blocked", reason: "lock_busy" };
  // [A-883] Evidence sidecar, after the lock is released and the run's result is final. Observes the hashes this
  // run broadcast (captured, or carried by the result); never changes `locked.value`.
  const evCfg = evidenceSidecarConfig(evidence);
  if (evCfg) {
    try {
      const v = locked.value;
      const depositTxHash = evidenceSeen.depositTxHash ?? v?.depositTxHash;
      const redeemTxHash = evidenceSeen.redeemTxHash ?? v?.redeemTxHash;
      if (depositTxHash || redeemTxHash) {
        recordSecondTxEvidence(evCfg, { plumbingPending: {
          stage: redeemTxHash ? "redeem-broadcast" : "deposit-broadcast",
          chainId: scope.chainId, address: accountAddress, depositTxHash, redeemTxHash,
        } });
      }
    } catch { /* evidence layer only */ }
  }
  return locked.value;

  async function runUnderLock() {
  // Duplicate-send prevention: ANY readable, unreadable or corrupt record (scoped or legacy) blocks a new
  // broadcast — the caller should reconcile instead, never start a second one. (Re-checked atomically at reserve.)
  const early = blockingPendingReason(storage, scope, piggyId, key);
  if (early) return { outcome: "blocked", reason: early };

  // Grant is conditional — exactly First's waitForGrantBalance pattern (check/call, then treat
  // "not granted" as non-error, since api/grant.js answers 403-already-funded the same way).
  if (typeof requestGrant === "function") {
    let grant;
    try {
      grant = await requestGrant(accountAddress);
    } catch {
      return { outcome: "failed", reason: "grant_error" };
    }
    if (grant?.granted && typeof waitForGrantBalance === "function") {
      const visible = await waitForGrantBalance(accountAddress);
      if (!visible) return { outcome: "failed", reason: "grant_not_visible" };
    }
  }

  if (typeof signDigest === "function") {
    try {
      const bytes = new TextEncoder().encode(`${SECOND_SIGN_MESSAGE_PREFIX}${accountAddress}`);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      await signDigest(digest);
    } catch {
      return { outcome: "failed", reason: "sign_error" };
    }
  }

  // [A-693 D8] Share balance BEFORE this deposit, so the redeem amount is only what this deposit minted.
  let shareBefore;
  try {
    shareBefore = BigInt(await publicClient.readContract({ address: SHMON_ADDRESS, abi: SHMON_ABI, functionName: "balanceOf", args: [accountAddress] }));
  } catch {
    return { outcome: "blocked", reason: "balance_before_unreadable" };
  }

  const base = { address: accountAddress, accountId: scope.accountId, chainId: scope.chainId, piggyId, asset: "shMON", reservationId: newReservationId(), shareBefore: shareBefore.toString() };
  const authorize = () => {
    if (confirm !== true) return { ok: false, reason: "permission_not_confirmed" };
    // [A-710 L1] isAppLocked is guaranteed to be a function here (checked above); a throw stops the step (hook_threw).
    if (isAppLocked() !== false) return { ok: false, reason: "app_locked" };
    return { ok: true };
  };
  const transport = { kind: TRANSPORT_KIND.VIEM_SEND, walletClient, account };

  // ── deposit ────────────────────────────────────────────────────────────────────────────────
  const depositSending = { ...base, stage: "deposit-sending" };
  const dep = await executeMoneyStep({
    tx: makeSecondDepositTx(amount, accountAddress),
    transport,
    authorize,
    reserve: () => reservePending(storage, scope, piggyId, key, depositSending),
    persistHash: ({ hash }) => transitionPending(storage, key, depositSending, { ...base, stage: "deposit-broadcast", depositTxHash: hash }),
  });
  const depStop = mapExecutor(dep, { sendError: "deposit_send_error", hashUnsaved: "deposit_hash_unsaved", hashField: "depositTxHash" });
  if (depStop) return depStop;
  const depositTxHash = dep.hash;
  evidenceSeen.depositTxHash = depositTxHash;
  const depositBroadcast = { ...base, stage: "deposit-broadcast", depositTxHash };

  const depositReceipt = await waitForTxSuccess(publicClient, depositTxHash);
  if (!depositReceipt) return { outcome: "failed", reason: "deposit_unconfirmed_or_reverted" };

  // [A-693 D8] Redeem only what this deposit minted. Anything else (unreadable, non-positive) stops here with the
  // pending record still at deposit-broadcast (value stays as shMON; reconcile classifies by the stored hash).
  let shareAfter;
  try {
    shareAfter = BigInt(await publicClient.readContract({ address: SHMON_ADDRESS, abi: SHMON_ABI, functionName: "balanceOf", args: [accountAddress] }));
  } catch {
    return { outcome: "failed", reason: "balance_read_error" };
  }
  const shmonReceived = shareAfter - shareBefore;
  if (shmonReceived <= 0n) return { outcome: "failed", reason: "no_shares_minted" };

  // ── redeem ─────────────────────────────────────────────────────────────────────────────────
  const redeemSending = { ...base, stage: "redeem-sending", depositTxHash, sharesToRedeem: shmonReceived.toString() };
  const red = await executeMoneyStep({
    tx: makeSecondRedeemTx(shmonReceived, accountAddress, accountAddress),
    transport,
    authorize,
    reserve: () => transitionPending(storage, key, depositBroadcast, redeemSending),
    persistHash: ({ hash }) => transitionPending(storage, key, redeemSending, { ...redeemSending, stage: "redeem-broadcast", redeemTxHash: hash }),
  });
  const redStop = mapExecutor(red, { sendError: "redeem_send_error", hashUnsaved: "redeem_hash_unsaved", hashField: "redeemTxHash" });
  if (redStop) return { ...redStop, depositTxHash };
  const redeemTxHash = red.hash;
  evidenceSeen.redeemTxHash = redeemTxHash;
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
}

// ── Aave mainnet lane · execution boundary (local only; live execution stays off) ───────────────────────────
// mainnet-job-lane.js owns the errand record and the one send (advanceLaneIntent -> money-executor.js). What it
// does not re-check at the moment of a step, this boundary does, fail-closed, BEFORE the lane is called:
//   1. the exact permission envelope, revalidated against the STORED errand (not the caller's copy) on every step;
//   2. current, block-tagged evidence for this step: destination code, reserve state, receipt token, balance,
//      allowance; a read older than the errand's own reads, outside an explicit freshness window, or naming a
//      different destination / Piggy / chain is refused;
//   3. capacity: supply-cap evidence before entry and an explicit exit-liquidity precheck on every step;
//      missing evidence is refused, never assumed;
//   4. local amount / gas / fee caps from fields that are actually measured or quoted; gas in USD has no
//      measured source and stays "UNKNOWN";
//   5. the calldata the user authorized is rebuilt from the stored errand and compared to the preview; the lane
//      then receives the rebuilt, frozen copy, so the caller's preview object can never be swapped in later;
//   6. an unknown outcome stays unknown: no step runs over a *_sending / *_sent / unknown record, and the
//      reconcile path hands the lane a receipt-only reader (it has no send method at all).
// Nothing here constructs an executor, picks a network or reads one; MAINNET_LANE_CONFIG must stay
// { reader: null, liveExecution: false } or every step is refused.

const AAVE_NEXT_STEP = Object.freeze({ [LANE_STAGE.AUTHORIZED]: "approve", [LANE_STAGE.APPROVED]: "supply", [LANE_STAGE.OUT]: "withdraw" });
const AAVE_TERMINAL = Object.freeze([LANE_STAGE.RETURNED, LANE_STAGE.REVERTED]);
const AAVE_ENTRY_STEPS = Object.freeze(["approve", "supply"]);
const AAVE_STEPS = Object.freeze(["approve", "supply", "withdraw"]);
export const AAVE_GUARD_UNKNOWN = "UNKNOWN";

const isRawUnits = (v) => typeof v === "string" && /^\d+$/.test(v);
const lowerHex = (v) => (typeof v === "string" ? v.toLowerCase() : "");
const isPositiveInt = (v) => Number.isSafeInteger(v) && v > 0;

// Plain-data copy taken once: every getter is read exactly one time, so a value that changes between reads
// (or a Proxy) cannot pass a check and then answer differently at execution. Non-plain input -> null.
function plainOnce(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const copy = JSON.parse(JSON.stringify(value));
    return copy && typeof copy === "object" && !Array.isArray(copy) ? copy : null;
  } catch {
    return null;
  }
}

// The lane's pool for this Piggy, derived again from the Job plan (not from the preview or the read).
function aaveExpectedPool(profile, piggyAddress) {
  try {
    const out = buildExecutionPlan(LANE_JOB_ID, { context: { address: piggyAddress, chain: profile.scope }, executionMode: EXECUTION_MODE.LIVE });
    const pool = out?.plan?.destination;
    return typeof pool === "string" && ADDRESS_RE.test(pool) ? pool : null;
  } catch {
    return null;
  }
}

/**
 * The three step transactions the errand authorizes, rebuilt from its own fields: approve exactly `amountRaw`
 * to the pool, supply `amountRaw` on behalf of the Piggy, withdraw max to the Piggy. null on any bad field.
 */
export function rebuildAaveLaneSteps({ token, pool, piggyAddress, amountRaw } = {}) {
  if (![token, pool, piggyAddress].every((a) => typeof a === "string" && ADDRESS_RE.test(a))) return null;
  if (!isRawUnits(amountRaw) || BigInt(amountRaw) <= 0n) return null;
  const amount = BigInt(amountRaw);
  const args = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values).slice(2);
  return Object.freeze([
    Object.freeze({ step: "approve", to: token, data: `${LANE_SELECTORS.approve}${args(["address", "uint256"], [pool, amount])}` }),
    Object.freeze({ step: "supply", to: pool, data: `${LANE_SELECTORS.supply}${args(["address", "uint256", "address", "uint16"], [token, amount, piggyAddress, 0])}` }),
    Object.freeze({ step: "withdraw", to: pool, data: `${LANE_SELECTORS.withdraw}${args(["address", "uint256", "address"], [token, maxUint256, piggyAddress])}` }),
  ]);
}

/** Digest of exactly what is authorized: nonce + each step's target and calldata. */
export function aavePreviewDigest(nonce, steps) {
  const rows = (steps || []).map((s) => [s.step, lowerHex(s.to), lowerHex(s.data)]);
  return keccak256(stringToBytes(JSON.stringify({ nonce: String(nonce), steps: rows })));
}

function aaveRequestFromIntent(intent) {
  return { piggyId: intent.piggyId, signerAddress: intent.piggyAddress, action: intent.action, asset: intent.asset, amount: intent.amountRaw, chain: intent.chain, destination: intent.pool };
}

/**
 * The exact envelope, re-checked at the execution boundary against the STORED errand. It must be the sealed
 * object issued for this errand, carry the errand's nonce, have been consumed by this errand's start, still be
 * inside its lifetime, and match chain / asset / action / amount / destination / Piggy / live signer exactly.
 * Returns a refusal reason or null.
 */
export function revalidateAaveEnvelope({ envelope, intent, signerContext, consumedNonces, nowMs } = {}) {
  if (!envelope || typeof envelope !== "object") return "no_permission";
  if (!Object.isFrozen(envelope)) return "envelope_not_sealed";
  const env = plainOnce(envelope);
  if (!env) return "no_permission";
  if (!intent || typeof intent.nonce !== "string" || !intent.nonce) return "errand_nonce_missing";
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return "permission_clock_missing";
  // [A-791 / A-758 review hardening] `authorize` compares `nowMs > expiresAt`, which is false for a missing or string expiry, so a
  // forged sealed envelope without a numeric lifetime would pass forever. Require the issuer's shape here: finite numeric
  // issuedAt <= expiresAt, and issuedAt <= nowMs < expiresAt. Anything else is refused before authorize runs (authorize itself
  // still refuses any state other than "permitted").
  if (typeof env.issuedAt !== "number" || !Number.isFinite(env.issuedAt) || typeof env.expiresAt !== "number" || !Number.isFinite(env.expiresAt) || env.issuedAt > env.expiresAt) return "envelope_lifetime_malformed";
  if (nowMs < env.issuedAt) return "envelope_not_yet_valid";
  if (nowMs >= env.expiresAt) return "permission_expired";
  if (env.nonce !== intent.nonce) return "envelope_nonce_mismatch";
  if (!(consumedNonces instanceof Set) || !consumedNonces.has(intent.nonce)) return "envelope_not_consumed_for_errand";
  const r = authorize(env, aaveRequestFromIntent(intent), { nowMs, consumedNonces: null, context: plainOnce(signerContext) });
  return r.ok ? null : r.reason || "no_permission";
}

// The caller's preview must be the one this errand authorized, byte for byte. Read once (plainOnce).
function aavePreviewProblem(preview, intent, rebuilt) {
  const p = plainOnce(preview);
  if (!p) return "preview_unreadable";
  if (p.nonce !== intent.nonce) return "preview_nonce_mismatch";
  if (p.amountRaw !== intent.amountRaw) return "preview_amount_mismatch";
  if (lowerHex(p.target) !== lowerHex(intent.pool) || lowerHex(p.spender) !== lowerHex(intent.pool)) return "preview_destination_mismatch";
  if (p.piggyId !== intent.piggyId || lowerHex(p.piggyAddress) !== lowerHex(intent.piggyAddress) || p.chainId !== intent.chainId) return "preview_binding_mismatch";
  if (p.unlimitedApproval !== false || p.reusable !== false || p.liveExecution !== false) return "preview_scope_mismatch";
  const req = p.request || {};
  const want = aaveRequestFromIntent(intent);
  for (const k of Object.keys(want)) {
    const same = k === "signerAddress" || k === "destination" ? lowerHex(req[k]) === lowerHex(want[k]) : req[k] === want[k];
    if (!same) return "preview_request_mismatch";
  }
  if (!Array.isArray(p.steps) || p.steps.length !== rebuilt.length) return "preview_replaced";
  for (let i = 0; i < rebuilt.length; i += 1) {
    const a = p.steps[i];
    const b = rebuilt[i];
    if (!a || a.step !== b.step || lowerHex(a.to) !== lowerHex(b.to) || lowerHex(a.data) !== lowerHex(b.data)) return "preview_replaced";
  }
  return null;
}

/**
 * Pre-send evidence for ONE step. `read` has the readLanePreAction shape, plus `supplyCap` {block, capRaw,
 * suppliedRaw} and `exitLiquidity` {block, availableRaw} taken at the same block. Freshness is judged only
 * against what the caller states (maxReadAgeMs, expiresAtMs) and against the errand's own recorded blocks; no
 * window is assumed here. Returns a refusal reason or null.
 */
export function aaveEvidenceProblem({ read, profile, intent, step, expectedPool, maxReadAgeMs, nowMs } = {}) {
  const r = plainOnce(read);
  if (!r) return "evidence_missing";
  if (!intent || !AAVE_STEPS.includes(step)) return "no_step";
  if (r.stale === true || r.conflict === true) return "stale_evidence";
  if (r.chainId !== profile?.numericChainId) return "evidence_chain_mismatch";
  if (!Number.isSafeInteger(r.block) || r.block < 0) return "evidence_block_missing";
  if (typeof r.source !== "string" || !r.source.endsWith(`@${r.block}`)) return "evidence_block_untagged";
  if (!Number.isSafeInteger(intent.before?.block)) return "before_block_missing";
  const recorded = Object.values(intent.steps || {}).map((s) => (Number.isSafeInteger(s?.blockNumber) ? s.blockNumber : -1));
  if (r.block < Math.max(intent.before.block, ...recorded)) return "stale_evidence";
  const observedMs = typeof r.observedAt === "string" ? Date.parse(r.observedAt) : NaN;
  if (!Number.isFinite(observedMs)) return "evidence_time_missing";
  if (!isPositiveInt(maxReadAgeMs)) return "freshness_window_unknown";
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return "evidence_clock_missing";
  if (observedMs > nowMs) return "evidence_from_future";
  if (nowMs - observedMs > maxReadAgeMs) return "stale_evidence";
  if (r.expiresAtMs !== undefined && r.expiresAtMs !== null && !(Number.isFinite(r.expiresAtMs) && r.expiresAtMs > nowMs)) return "stale_evidence";
  if (r.codePresent !== true) return "destination_code_absent";
  if (!expectedPool || lowerHex(r.pool) !== lowerHex(expectedPool) || lowerHex(r.pool) !== lowerHex(intent.pool)) return "destination_evidence_mismatch";
  const reserve = r.reserve || {};
  if (lowerHex(reserve.aTokenAddress) !== lowerHex(LANE_RECEIPT_TOKEN.address)) return "receipt_token_mismatch";
  if (reserve.decimals !== profile?.usdc?.decimals) return "decimals_mismatch";
  if (![reserve.active, reserve.frozen, reserve.paused].every((b) => typeof b === "boolean")) return "reserve_state_unreadable";
  const piggy = r.piggy || {};
  if (lowerHex(piggy.address) !== lowerHex(intent.piggyAddress)) return "piggy_mismatch";
  if (!isRawUnits(piggy.usdcRaw) || !isRawUnits(piggy.aTokenRaw) || !isRawUnits(piggy.allowanceRaw)) return "balance_evidence_missing";
  if (!isRawUnits(intent.amountRaw)) return "amount_not_exact";
  const amount = BigInt(intent.amountRaw);
  if (AAVE_ENTRY_STEPS.includes(step)) {
    if (!reserve.active || reserve.frozen || reserve.paused) return "reserve_not_accepting_supply";
    if (BigInt(piggy.usdcRaw) < amount) return "balance_below_amount";
    if (step === "supply" && BigInt(piggy.allowanceRaw) !== amount) return "allowance_not_exact";
  } else {
    // Exit needs an active, unpaused reserve and a position to take back.
    if (!reserve.active || reserve.paused) return "reserve_exit_unavailable";
    if (BigInt(piggy.aTokenRaw) === 0n) return "no_position_to_exit";
  }
  return null;
}

/**
 * Capacity, explicit and fail-closed: entry needs supply-cap evidence with room for the amount; every step
 * needs exit-liquidity evidence covering what would be taken back (the amount at entry, the whole position at
 * exit). Both must be read at the evidence block. Returns a refusal reason or null.
 */
export function aaveCapacityProblem({ read, intent, step } = {}) {
  const r = plainOnce(read);
  if (!r || !intent || !AAVE_STEPS.includes(step) || !isRawUnits(intent.amountRaw)) return "evidence_missing";
  const amount = BigInt(intent.amountRaw);
  if (AAVE_ENTRY_STEPS.includes(step)) {
    const cap = r.supplyCap;
    if (!cap || typeof cap !== "object" || cap.block !== r.block || !isRawUnits(cap.capRaw) || !isRawUnits(cap.suppliedRaw)) return "supply_cap_unknown";
    if (BigInt(cap.suppliedRaw) + amount > BigInt(cap.capRaw)) return "supply_cap_exceeded";
  }
  const exit = r.exitLiquidity;
  if (!exit || typeof exit !== "object" || exit.block !== r.block || !isRawUnits(exit.availableRaw)) return "exit_liquidity_unknown";
  const need = step === "withdraw" ? (isRawUnits(r.piggy?.aTokenRaw) ? BigInt(r.piggy.aTokenRaw) : null) : amount;
  if (need === null) return "exit_liquidity_unknown";
  if (BigInt(exit.availableRaw) < need) return "exit_liquidity_insufficient";
  return null;
}

/**
 * Local amount / gas / fee caps for ONE step. Inputs are only measured or quoted integers: the lane's amount
 * cap, the fork-measured gasUsed for the step (a gas limit below it is refused), the caller's quote
 * {gasLimit, maxFeePerGasWei} and explicit caps {maxGasUnits:{step}, maxFeeWei, amountCapRaw?}. A missing
 * quote or cap is refused, not defaulted. Gas in USD has no measured source here: always "UNKNOWN".
 * @returns {{problem: string|null, quoted: object|null}}
 */
export function checkAaveFeeGuard({ step, amountRaw, quote, caps } = {}) {
  if (!AAVE_STEPS.includes(step)) return { problem: "no_step", quoted: null };
  const c = plainOnce(caps) || {};
  if (!isRawUnits(amountRaw) || BigInt(amountRaw) <= 0n) return { problem: "amount_not_exact", quoted: null };
  if (BigInt(amountRaw) > BigInt(LANE_AMOUNT_CAP_RAW)) return { problem: "amount_over_cap", quoted: null };
  if (c.amountCapRaw !== undefined && (!isRawUnits(c.amountCapRaw) || BigInt(amountRaw) > BigInt(c.amountCapRaw))) return { problem: "amount_over_cap", quoted: null };
  const q = plainOnce(quote);
  if (!q || !isRawUnits(q.gasLimit)) return { problem: "gas_quote_unknown", quoted: null };
  if (!isRawUnits(q.maxFeePerGasWei)) return { problem: "fee_quote_unknown", quoted: null };
  const measured = LANE_FORK_EVIDENCE.gasUsed[step];
  const gasLimit = BigInt(q.gasLimit);
  if (!Number.isSafeInteger(measured) || gasLimit < BigInt(measured)) return { problem: "gas_limit_below_measured", quoted: null };
  const gasCap = c.maxGasUnits && typeof c.maxGasUnits === "object" ? c.maxGasUnits[step] : undefined;
  if (!isRawUnits(gasCap)) return { problem: "gas_cap_unknown", quoted: null };
  if (gasLimit > BigInt(gasCap)) return { problem: "gas_over_cap", quoted: null };
  if (!isRawUnits(c.maxFeeWei)) return { problem: "fee_cap_unknown", quoted: null };
  const maxFeeWei = gasLimit * BigInt(q.maxFeePerGasWei);
  if (maxFeeWei > BigInt(c.maxFeeWei)) return { problem: "fee_over_cap", quoted: null };
  return {
    problem: null,
    quoted: Object.freeze({
      step,
      amountRaw,
      gasLimit: q.gasLimit,
      maxFeePerGasWei: q.maxFeePerGasWei,
      maxFeeWei: maxFeeWei.toString(),
      gasUsd: AAVE_GUARD_UNKNOWN,
      forkMeasuredGasUsed: measured,
    }),
  };
}

/**
 * ONE guarded step of the Aave errand. Every check above runs on the STORED errand before the lane is called;
 * the lane then receives the rebuilt, frozen preview (never the caller's object). A refusal sends nothing.
 * Unknown outcomes come back with retry:false and next:"reconcile_read_only".
 */
export async function advanceAaveLaneGuarded(opts = {}) {
  const {
    profile, piggy: rawPiggy, intent: callerIntent, preview, envelope, signerContext, consumedNonces,
    read, quote, caps, executor, storage, nowMs, nowIso, evidence: evidenceSink = null,
  } = opts || {};
  const refuse = (reason, extra = {}) => ({ status: "blocked", reason, sent: false, retry: false, ...extra });
  if (MAINNET_LANE_CONFIG.liveExecution !== false || MAINNET_LANE_CONFIG.reader !== null || profile?.liveExecution !== false) {
    return refuse("live_execution_disabled");
  }
  const piggySnap = plainOnce(rawPiggy);
  if (!piggySnap || typeof piggySnap.id !== "string" || typeof piggySnap.address !== "string" || !ADDRESS_RE.test(piggySnap.address)) return refuse("missing_piggy");
  const piggy = { id: piggySnap.id, address: piggySnap.address };
  const stored = loadLaneIntent(storage, profile, piggy);
  if (stored.error || !stored.intent) return refuse(stored.error ? "stored_intent_unavailable" : "no_errand", stored.error ? { detail: stored.error } : {});
  const intent = stored.intent;
  const given = plainOnce(callerIntent);
  if (!given || given.nonce !== intent.nonce || given.stage !== intent.stage) return refuse("stored_intent_changed");
  if (AAVE_TERMINAL.includes(intent.stage)) return { status: "terminal", reason: intent.stage, sent: false, retry: false };
  const step = AAVE_NEXT_STEP[intent.stage];
  if (!step) {
    // *_sending, *_sent or unknown: whether something went out is not known from here. Read, never re-send.
    return { status: "reconcile_first", reason: "unknown_outcome_must_reconcile", sent: false, retry: false, next: "reconcile_read_only" };
  }
  if (lowerHex(intent.token) !== lowerHex(profile?.usdc?.address)) return refuse("asset_mismatch");
  const expectedPool = aaveExpectedPool(profile, intent.piggyAddress);
  if (!expectedPool || lowerHex(expectedPool) !== lowerHex(intent.pool)) return refuse("destination_mismatch");

  const envelopeProblem = revalidateAaveEnvelope({ envelope, intent, signerContext, consumedNonces, nowMs });
  if (envelopeProblem) return refuse(envelopeProblem);

  const rebuilt = rebuildAaveLaneSteps({ token: intent.token, pool: intent.pool, piggyAddress: intent.piggyAddress, amountRaw: intent.amountRaw });
  if (!rebuilt) return refuse("calldata_unbuildable");
  const previewProblem = aavePreviewProblem(preview, intent, rebuilt);
  if (previewProblem) return refuse(previewProblem);

  const c = plainOnce(caps) || {};
  const evidence = plainOnce(read);
  const evidenceProblem = aaveEvidenceProblem({ read: evidence, profile, intent, step, expectedPool, maxReadAgeMs: c.maxReadAgeMs, nowMs });
  if (evidenceProblem) return refuse(evidenceProblem);
  const capacityProblem = aaveCapacityProblem({ read: evidence, intent, step });
  if (capacityProblem) return refuse(capacityProblem);
  const fee = checkAaveFeeGuard({ step, amountRaw: intent.amountRaw, quote, caps: c });
  if (fee.problem) return refuse(fee.problem);

  const sealed = Object.freeze({ nonce: intent.nonce, steps: rebuilt });
  const facts = { step, previewDigest: aavePreviewDigest(intent.nonce, rebuilt), quoted: fee.quoted, evidenceBlock: evidence.block };
  let out;
  try {
    out = await advanceLaneIntent({ profile, piggy, intent, preview: sealed, executor, storage, nowIso });
  } catch {
    // A throw after the lane started cannot prove nothing was sent: unknown, reconcile by reading.
    return { status: "unknown", reason: "lane_threw", retry: false, next: "reconcile_read_only", ...facts };
  }
  let res;
  if (out.status === "blocked") res = { ...out, sent: false, retry: false, ...facts };
  else if (out.status === "unknown" || out.status === "pending" || out.status === "unsaved" || out.status === "reconcile_first") {
    res = { ...out, retry: false, next: "reconcile_read_only", ...facts };
  } else res = { ...out, retry: false, ...facts };
  // [A-883] Evidence sidecar after the lane's result is final: the errand's recorded step hashes, observed only.
  observeLaneIntentEvidence(evidenceSink, out);
  return res;
}

function observeLaneIntentEvidence(evidenceSink, out) {
  const cfg = evidenceSidecarConfig(evidenceSink);
  if (!cfg) return;
  try {
    const intent = out?.intent;
    if (intent && typeof intent === "object") recordSecondTxEvidence(cfg, { laneIntent: intent });
  } catch { /* evidence layer only */ }
}

/**
 * Read-only reconcile of the stored errand. The lane gets a reader with `receipt` only: there is no send method
 * to call, so a reconcile can never broadcast. "*_sending" becomes unknown; "*_sent" reads its receipt.
 */
export async function reconcileAaveLaneReadOnly(opts = {}) {
  const { profile, piggy: rawPiggy, executor, storage, nowIso, evidence: evidenceSink = null } = opts || {};
  const piggySnap = plainOnce(rawPiggy);
  if (!piggySnap || typeof piggySnap.id !== "string" || typeof piggySnap.address !== "string") return { status: "unknown", reason: "missing_piggy", sent: false, retry: false };
  const piggy = { id: piggySnap.id, address: piggySnap.address };
  const stored = loadLaneIntent(storage, profile, piggy);
  if (stored.error || !stored.intent) return { status: "unknown", reason: stored.error ? "stored_intent_unavailable" : "no_errand", sent: false, retry: false };
  const txReceiptReader = executor && typeof executor.receipt === "function" ? Object.freeze({ receipt: (hash) => executor.receipt(hash) }) : null;
  let out;
  try {
    out = await reconcileLaneIntent({ profile, piggy, intent: stored.intent, executor: txReceiptReader, storage, nowIso });
  } catch {
    return { status: "unknown", reason: "reconcile_threw", sent: false, retry: false };
  }
  const res = { ...out, sent: false, retry: false };
  observeLaneIntentEvidence(evidenceSink, out); // [A-883] after the read-only result is final
  return res;
}

/**
 * The finished errand's Receipt with QUOTED and MEASURED kept apart. `quotes` is {approve, supply, withdraw},
 * each the `quoted` object a guarded step returned. A measured field never falls back to a quote, and a quote
 * never stands in for a measurement: what was not measured is "UNKNOWN".
 */
export function buildAaveGuardedReceipt({ profile, piggy, intent, after, nowIso, quotes, evidence: evidenceSink = null } = {}) {
  const built = buildLaneReceipt({ profile, piggy: piggy || {}, intent, after, nowIso });
  if (!built.receipt) return { record: null, reason: built.reason };
  const rc = built.receipt;
  const q = plainOnce(quotes) || {};
  const quotedStep = (s) => {
    const x = q[s] && typeof q[s] === "object" ? q[s] : {};
    return Object.freeze({
      gasLimit: isRawUnits(x.gasLimit) ? x.gasLimit : AAVE_GUARD_UNKNOWN,
      maxFeePerGasWei: isRawUnits(x.maxFeePerGasWei) ? x.maxFeePerGasWei : AAVE_GUARD_UNKNOWN,
      maxFeeWei: isRawUnits(x.maxFeeWei) ? x.maxFeeWei : AAVE_GUARD_UNKNOWN,
    });
  };
  const measuredGas = (s) => (Number.isSafeInteger(rc.gasUsed?.[s]) ? rc.gasUsed[s] : AAVE_GUARD_UNKNOWN);
  // [A-883] Evidence sidecar: the finished errand's lane Receipt tx hashes, observed only (the record is unchanged).
  const evCfg = evidenceSidecarConfig(evidenceSink);
  if (evCfg) recordSecondTxEvidence(evCfg, { laneReceipt: rc });
  return {
    record: Object.freeze({
      schema: "araso_mainnet_lane_receipt_split_v1",
      eventId: rc.eventId,
      outcome: rc.outcome,
      evidenceClass: rc.evidenceClass,
      executionMode: rc.executionMode,
      quoted: Object.freeze({
        source: "pre_send_quote",
        amountRaw: rc.amountRaw,
        returnRaw: AAVE_GUARD_UNKNOWN,
        gas: Object.freeze(Object.fromEntries(AAVE_STEPS.map((s) => [s, quotedStep(s)]))),
        gasUsd: AAVE_GUARD_UNKNOWN,
      }),
      measured: Object.freeze({
        source: "step_receipts_and_after_read",
        usdcBeforeRaw: rc.usdcBeforeRaw,
        usdcAfterRaw: rc.usdcAfterRaw,
        deltaRaw: rc.deltaRaw,
        receiptTokenBeforeRaw: rc.receiptTokenBeforeRaw,
        receiptTokenAfterRaw: rc.receiptTokenAfterRaw,
        allowanceAfterRaw: rc.allowanceAfterRaw,
        beforeBlock: rc.beforeBlock,
        afterBlock: rc.afterBlock,
        gasUsed: Object.freeze(Object.fromEntries(AAVE_STEPS.map((s) => [s, measuredGas(s)]))),
        gasUsd: AAVE_GUARD_UNKNOWN,
        txs: Object.freeze({ approve: rc.approveTx, supply: rc.supplyTx, withdraw: rc.withdrawTx }),
      }),
      unmeasured: Object.freeze([...rc.unmeasured]),
      laneReceipt: rc,
    }),
    reason: null,
  };
}

// ── Second mainnet merge · per-protocol descriptors and fail-closed execution routes (live stays off) ─────────
// Five protocols, five shapes. Each descriptor carries its own protocol block (aave / neverland / curvance /
// abil / kintsu); there is no shared "lending" shape and no field one protocol borrows from another.
// The four non-Aave lanes are NOT imported by product code (their own suites pin that). A caller binds them by
// injection (`lanes`), and every bound lane is re-checked against its descriptor before it is consulted; a lane
// whose exports drifted is refused. The route below has no path that returns allowed:true: it collects the
// protocol's own refusals (reader evidence, lane boundary, still-unproven fields/steps, gates) and then refuses
// on the live gate. Nothing here sends, signs, issues a permission or reads a network.
export const SECOND_MAINNET_DESCRIPTOR_SCHEMA = "araso_second_mainnet_descriptor_v1";
const MERGE_LOCKS = Object.freeze({ ready: false, executable: false, executionPermission: false, createsPermission: false, liveExecution: false });
const ff = (a) => Object.freeze([...a]);

export const SECOND_MAINNET_DESCRIPTORS = Object.freeze({
  "aave-usdc": Object.freeze({
    schema: SECOND_MAINNET_DESCRIPTOR_SCHEMA, jobId: "aave-usdc", protocol: "aave", evidenceClass: LANE_FORK_EVIDENCE.label,
    steps: ff(AAVE_STEPS),
    lane: Object.freeze({ binding: "built_in", boundary: "advanceAaveLaneGuarded" }),
    aave: Object.freeze({
      exitObserved: LANE_FORK_EVIDENCE.exit,
      receiptTokenMustMatchRecorded: true,
      stepProof: ff(["exact_permission_envelope", "stored_errand", "block_tagged_step_evidence", "supply_cap_evidence", "exit_liquidity_precheck", "fee_guard", "rebuilt_calldata"]),
      unmeasured: ff(LANE_FORK_EVIDENCE.unmeasured),
    }),
    ...MERGE_LOCKS,
  }),
  "neverland-usdc": Object.freeze({
    schema: SECOND_MAINNET_DESCRIPTOR_SCHEMA, jobId: "neverland-usdc", protocol: "neverland", evidenceClass: "PASS_FORK_SIM",
    steps: ff(["approve", "supply", "withdraw", "withdrawPartial"]),
    lane: Object.freeze({ binding: "injected", jobIdExport: "NEVERLAND_JOB_ID", gate: "neverlandExecutionGate", readiness: "neverlandReadiness" }),
    neverland: Object.freeze({
      receiptTokenShape: "reader_assumed",
      exitObserved: "whole_position_next_block_no_time_warp",
      exitTiming: "UNKNOWN",
      unprovenSteps: ff(["withdrawPartial"]),
      unknownFields: ff(["exitTiming", "exitLiquidity", "supplyCap", "reserveFlags", "supplyRate", "gasFeeUsd", "feeCap", "freshnessWindow", "eligibilityPolicy"]),
    }),
    ...MERGE_LOCKS,
  }),
  "curvance-usdc": Object.freeze({
    schema: SECOND_MAINNET_DESCRIPTOR_SCHEMA, jobId: "curvance-usdc", protocol: "curvance", evidenceClass: "PASS_FORK_SIM",
    steps: ff(["approve", "deposit", "redeem", "redeemPartial", "withdraw", "mint"]),
    lane: Object.freeze({ binding: "injected", jobIdExport: "CURVANCE_JOB_ID", gate: "curvanceExecutionGate", readiness: "curvanceReadiness" }),
    curvance: Object.freeze({
      shareAccounting: "measured_only",
      sharesAssumedEqualToAmount: false,
      holdingPeriod: "UNKNOWN",
      exitObserved: "whole_position_next_block_no_time_warp",
      unprovenSteps: ff(["redeemPartial", "withdraw", "mint"]),
      unknownFields: ff(["exitTiming", "holdingPeriod", "exitLiquidity", "depositCap", "sharePrice", "expectedShares", "expectedAssetsBack", "minSharesOut", "feeOrHaircut", "supplyRate", "gasFeeUsd", "feeCap", "freshnessWindow", "eligibilityPolicy"]),
    }),
    ...MERGE_LOCKS,
  }),
  "abil-spot": Object.freeze({
    schema: SECOND_MAINNET_DESCRIPTOR_SCHEMA, jobId: "abil-spot", protocol: "abil", evidenceClass: "PASS_FORK_SIM",
    steps: ff(["buy", "sell"]),
    lane: Object.freeze({ binding: "injected", jobIdExport: "ABIL_JOB_ID", gate: "abilExecutionGate", readiness: "abilReadiness" }),
    abil: Object.freeze({
      eligibilityGates: ff(["eligibility", "kyc", "geo"]),
      rightsGate: Object.freeze({ id: "economic_exposure_only_no_shareholder_rights", required: true, satisfied: false }),
      blockingFields: ff(["eligibility", "kyc", "geo", "rights", "redemption", "secondaryLiquidity", "quote", "minOut", "exitEvidence", "dividend", "freshness", "priceImpact"]),
      quote: "UNKNOWN",
      forkMinOutIsProbeOnly: true,
    }),
    ...MERGE_LOCKS,
  }),
  "kintsu-smon": Object.freeze({
    schema: SECOND_MAINNET_DESCRIPTOR_SCHEMA, jobId: "kintsu-smon", protocol: "kintsu", evidenceClass: "PASS_FORK_SIM_WITH_PENDING",
    steps: ff(["deposit", "requestUnlock", "cancelUnlockRequest", "submitBatch", "redeem", "return"]),
    lane: Object.freeze({ binding: "injected", jobIdExport: "KINTSU_JOB_ID", gate: "kintsuExecutionGate", readiness: "kintsuReadiness" }),
    kintsu: Object.freeze({
      exitSemantics: "pending",
      returnProof: "unproven",
      returnComplete: false,
      immediateExit: false,
      eta: "UNKNOWN",
      cooldown: "UNKNOWN",
      unprovenSteps: ff(["submitBatch", "redeem", "return"]),
    }),
    ...MERGE_LOCKS,
  }),
});
export const SECOND_MAINNET_JOB_IDS = Object.freeze(Object.keys(SECOND_MAINNET_DESCRIPTORS));
const MERGE_PROTOCOL_KEYS = Object.freeze(["aave", "neverland", "curvance", "abil", "kintsu"]);

const ownKey = (o, k) => !!o && (typeof o === "object" || typeof o === "function") && Object.prototype.hasOwnProperty.call(o, k);
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/** Structural check of one merged descriptor. { ok: true } or { error }. */
export function validateSecondMainnetDescriptor(d) {
  if (!d || typeof d !== "object") return { error: "descriptor_missing" };
  if (d.schema !== SECOND_MAINNET_DESCRIPTOR_SCHEMA) return { error: "descriptor_schema" };
  for (const k of Object.keys(MERGE_LOCKS)) if (!ownKey(d, k) || d[k] !== false) return { error: `descriptor_lock_not_false:${k}` };
  if (!MERGE_PROTOCOL_KEYS.includes(d.protocol) || !ownKey(d, d.protocol)) return { error: "descriptor_protocol_block" };
  const foreign = MERGE_PROTOCOL_KEYS.find((k) => k !== d.protocol && ownKey(d, k));
  if (foreign) return { error: `descriptor_foreign_block:${foreign}` };
  const p = d[d.protocol];
  if (d.protocol === "kintsu" && (p.returnComplete !== false || p.immediateExit !== false || p.returnProof !== "unproven" || p.exitSemantics !== "pending")) return { error: "kintsu_return_claimed" };
  if (d.protocol === "abil") {
    if (!p.rightsGate || p.rightsGate.required !== true || p.rightsGate.satisfied !== false) return { error: "abil_rights_gate_not_blocking" };
    for (const f of ["eligibility", "kyc", "geo", "rights"]) if (!Array.isArray(p.blockingFields) || !p.blockingFields.includes(f)) return { error: `abil_gate_not_blocking:${f}` };
  }
  if (d.protocol === "curvance" && p.sharesAssumedEqualToAmount !== false) return { error: "curvance_one_to_one_claimed" };
  if (d.protocol === "neverland" && p.receiptTokenShape !== "reader_assumed") return { error: "neverland_shape_claimed" };
  return { ok: true };
}

// A bound lane must still say what its descriptor says. Anything else is drift and the route is refused.
function mergeLaneProblem(d, lanes) {
  if (d.lane.binding === "built_in") return LANE_JOB_ID === d.jobId && LANE_FORK_EVIDENCE.label === d.evidenceClass ? null : "lane_descriptor_drift:aave";
  const lane = ownKey(lanes, d.jobId) ? lanes[d.jobId] : null;
  if (!lane || typeof lane !== "object") return "lane_not_bound";
  const read = (name) => (ownKey(lane, name) ? lane[name] : undefined);
  if (read(d.lane.jobIdExport) !== d.jobId) return "lane_descriptor_drift:job_id";
  if (typeof read(d.lane.gate) !== "function" || typeof read(d.lane.readiness) !== "function") return "lane_descriptor_drift:boundary";
  const p = d[d.protocol];
  if (d.protocol === "neverland") {
    if (!sameList(read("NEVERLAND_UNKNOWN_FIELDS"), p.unknownFields) || !sameList(read("NEVERLAND_UNPROVEN_STEPS"), p.unprovenSteps)) return "lane_descriptor_drift:neverland_unknowns";
    if (read("NEVERLAND_FORK_EVIDENCE")?.exitObserved !== p.exitObserved || read("NEVERLAND_FORK_EVIDENCE")?.label !== d.evidenceClass) return "lane_descriptor_drift:neverland_evidence";
  } else if (d.protocol === "curvance") {
    if (!sameList(read("CURVANCE_UNKNOWN_FIELDS"), p.unknownFields) || !sameList(read("CURVANCE_UNPROVEN_STEPS"), p.unprovenSteps)) return "lane_descriptor_drift:curvance_unknowns";
    if (read("CURVANCE_FORK_EVIDENCE")?.exitObserved !== p.exitObserved || read("CURVANCE_FORK_EVIDENCE")?.label !== d.evidenceClass) return "lane_descriptor_drift:curvance_evidence";
  } else if (d.protocol === "abil") {
    const fields = read("ABIL_BLOCKING_FIELDS");
    if (!sameList(read("ABIL_BLOCKING_FIELD_NAMES"), p.blockingFields)) return "lane_descriptor_drift:abil_blocking_fields";
    for (const f of p.blockingFields) if (!ownKey(fields, f) || fields[f].blocking !== true || fields[f].value !== "UNKNOWN") return `lane_descriptor_drift:abil_field:${f}`;
    let gate = null;
    try { gate = typeof read("abilRightsGate") === "function" ? read("abilRightsGate")(null) : null; } catch { gate = null; }
    if (!gate || gate.id !== p.rightsGate.id || gate.required !== true || gate.satisfied !== false) return "lane_descriptor_drift:abil_rights_gate";
  } else if (d.protocol === "kintsu") {
    if (!sameList(read("KINTSU_UNPROVEN_STEPS"), p.unprovenSteps)) return "lane_descriptor_drift:kintsu_unproven_steps";
    const ev = read("KINTSU_FORK_EVIDENCE");
    if (ev?.exitSemantics !== p.exitSemantics || ev?.label !== d.evidenceClass) return "lane_descriptor_drift:kintsu_evidence";
    const stages = read("KINTSU_STAGE");
    if (!stages || typeof stages !== "object" || Object.values(stages).some((s) => /return|redeem|done|complete|final/i.test(String(s)))) return "lane_descriptor_drift:kintsu_return_stage";
  }
  return null;
}

// What the protocol itself still lacks, independent of the lane's own gate. Reader unknowns are carried, not judged away.
function mergeProofGaps(d, route, step, lanes) {
  const gaps = [];
  const p = d[d.protocol];
  if (d.protocol === "aave") {
    if (route?.read?.receiptToken?.matchesRecorded !== true) gaps.push("aave_receipt_token_not_matching_recorded");
    gaps.push("aave_guarded_boundary_only");
  } else if (d.protocol === "neverland") {
    if (route?.status === CURRENT_READER_STATUS.NEVERLAND_DERIVED_ASSUMED) gaps.push("neverland_receipt_token_shape_assumed");
    if (p.unprovenSteps.includes(step)) gaps.push(`unproven_step:${step}`);
    for (const f of p.unknownFields) gaps.push(`unknown_field:${f}`);
  } else if (d.protocol === "curvance") {
    if (p.unprovenSteps.includes(step)) gaps.push(`unproven_step:${step}`);
    for (const f of p.unknownFields) gaps.push(`unknown_field:${f}`);
  } else if (d.protocol === "abil") {
    let gate = null;
    const lane = ownKey(lanes, d.jobId) ? lanes[d.jobId] : null;
    try { gate = lane && typeof lane.abilRightsGate === "function" ? lane.abilRightsGate(null) : null; } catch { gate = null; }
    if (!gate || gate.satisfied !== true) gaps.push("rights_gate_unsatisfied");
    for (const f of p.blockingFields) gaps.push(`blocking_field:${f}`);
    // The reader never has a quote source (its quote is always UNKNOWN); a caller value cannot stand in for one.
    gaps.push("abil_quote_unknown");
  } else if (d.protocol === "kintsu") {
    if (p.unprovenSteps.includes(step)) gaps.push(`unproven_step:${step}`);
    gaps.push("kintsu_return_unproven");
  }
  return gaps;
}

/**
 * Could this protocol's step run, given its routed reader evidence and its bound lane? Never. The answer lists
 * every refusal in order — reader route, lane binding / drift, the lane's own gate, the protocol's still-open
 * proof, the live gate — and `reason` is the first. Caller-supplied claims (`proof`, `ready`, …) are ignored.
 */
export function routeSecondMainnetExecution(input) {
  const { jobId, step, route, lanes, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const d = typeof jobId === "string" && ownKey(SECOND_MAINNET_DESCRIPTORS, jobId) ? SECOND_MAINNET_DESCRIPTORS[jobId] : null;
  const base = { kind: "second_mainnet_execution_route", allowed: false, action: "none", actionCount: 0, sent: false, ...MERGE_LOCKS };
  if (!d) return Object.freeze({ ...base, jobId: null, protocol: null, step: null, reason: "unknown_route", blockedBy: ff(["unknown_route"]), readerEvidence: "unknown", unknown: ff([]) });
  const blockedBy = [];
  const valid = validateSecondMainnetDescriptor(d);
  if (valid.error) blockedBy.push(`descriptor:${valid.error}`);
  if (typeof step !== "string" || !d.steps.includes(step)) blockedBy.push("unknown_step");
  const r = route && typeof route === "object" && route.kind === "second_reader_route" ? route : null;
  if (!r) blockedBy.push("reader_route_missing");
  else if (r.jobId !== d.jobId) blockedBy.push("reader_route_job_mismatch");
  else if (r.evidence !== "observed") blockedBy.push(`reader_evidence_unknown:${r.unknownClass || "missing"}`);
  const laneProblem = mergeLaneProblem(d, lanes);
  if (laneProblem) blockedBy.push(laneProblem);
  if (!laneProblem && d.lane.binding === "injected") {
    let gate = null;
    try { gate = lanes[d.jobId][d.lane.gate]({ profile, piggy, executor, step }); } catch { gate = null; }
    blockedBy.push(gate && typeof gate.reason === "string" ? `lane:${gate.reason}` : "lane:gate_unreadable");
  }
  blockedBy.push(...mergeProofGaps(d, r && r.jobId === d.jobId ? r : null, step, lanes));
  if (MAINNET_LANE_CONFIG.liveExecution !== false || MAINNET_LANE_CONFIG.reader !== null || profile?.liveExecution !== false) blockedBy.push("live_execution_disabled");
  else blockedBy.push("live_gate_closed");
  blockedBy.push("merge_route_has_no_execution_path");
  const extra = d.protocol === "kintsu" ? { returnComplete: false, immediateExit: false }
    : d.protocol === "abil" ? { rightsGate: d.abil.rightsGate } : {};
  return Object.freeze({
    ...base, jobId: d.jobId, protocol: d.protocol, step: typeof step === "string" ? step : null,
    reason: blockedBy[0], blockedBy: ff([...new Set(blockedBy)]),
    readerEvidence: r && r.jobId === d.jobId ? r.evidence : "unknown",
    unknown: ff(r && r.jobId === d.jobId && Array.isArray(r.unknown) ? r.unknown : []),
    ...extra,
  });
}

/**
 * How a Kintsu errand may be shown. Return is unproven: never complete, never immediate, no ETA, whatever the
 * stage or claim passed in. The word comes from the bound lane's own outcome words (none / holding / pending),
 * otherwise "unknown".
 */
export function secondKintsuReturnView({ stage, lanes } = {}) {
  const d = SECOND_MAINNET_DESCRIPTORS["kintsu-smon"];
  let word = "unknown";
  if (!mergeLaneProblem(d, lanes)) {
    try { word = lanes[d.jobId].kintsuOutcomeWord(stage); } catch { word = "unknown"; }
  }
  if (!["none", "holding", "pending"].includes(word)) word = "unknown";
  return Object.freeze({
    jobId: d.jobId, word, returnProof: d.kintsu.returnProof, returnComplete: false, immediateExit: false,
    eta: "UNKNOWN", cooldown: "UNKNOWN", finalReturn: "UNKNOWN",
  });
}
