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

export const SECOND_SEND_PENDING_KEY = "araso.secondSendPending";
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

// Fail-closed read: a malformed/unparseable record is never treated as "no pending" — it comes
// back as `{ stage: "unknown" }` so a caller never silently re-broadcasts over it.
export function readSecondSendPending(storage) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(SECOND_SEND_PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && SECOND_SEND_PENDING_STAGES.includes(parsed.stage)) return parsed;
  } catch {
    /* fall through to the fail-closed placeholder */
  }
  return { stage: "unknown" };
}

export function writeSecondSendPending(storage, entry) {
  if (!storage) return;
  storage.setItem(SECOND_SEND_PENDING_KEY, JSON.stringify({ ...entry, at: Date.now() }));
}

export function clearSecondSendPending(storage) {
  if (!storage) return;
  storage.removeItem(SECOND_SEND_PENDING_KEY);
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

// Boot/reopen reconcile. Read-only — never re-broadcasts, never clears a pending record that
// is not confirmed success, never touches a record outside the given scope.
export async function reconcileSecondPendingOnBoot({ storage, scope = {}, piggyId, readTxReceipt } = {}) {
  const pending = readSecondSendPending(storage);
  if (!pending) return { kind: "none" };
  if (!secondSendPendingBelongsToScope(pending, { ...scope, piggyId })) return { kind: "out_of_scope" };
  const result = await classifySecondSendPending(pending, { readTxReceipt });
  if (result.kind === "success") {
    clearSecondSendPending(storage);
    const rawBlock = result.redeemReceipt?.blockNumber;
    const blockNumber = rawBlock !== undefined && rawBlock !== null ? Number(rawBlock) : NaN;
    return { kind: "success", receipt: buildPlumbingReceipt(pending, { blockNumber }) };
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

// The orchestrator. Every side effect (sign/broadcast) is injected — this function itself opens
// no network connection and holds no credential. Pending is written BEFORE each broadcast
// (never after), so a thrown/lost send still leaves a fail-closed trail for reconcile to find.
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

  // Duplicate-send prevention: an existing pending record in this exact scope blocks a new
  // broadcast — the caller should reconcile instead, never start a second one.
  const existing = readSecondSendPending(storage);
  if (secondSendPendingBelongsToScope(existing, { ...scope, piggyId })) {
    return { outcome: "blocked", reason: "pending_exists" };
  }

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

  writeSecondSendPending(storage, { stage: "deposit-sending", address: account.address, accountId: scope.accountId, chainId: scope.chainId, piggyId, asset: "shMON" });
  let depositTxHash;
  try {
    depositTxHash = await walletClient.sendTransaction({ account, ...makeSecondDepositTx(amount, account.address) });
  } catch {
    // Pending stays exactly as written (fail-closed) — a lost send is never retried automatically.
    return { outcome: "failed", reason: "deposit_send_error" };
  }
  writeSecondSendPending(storage, { stage: "deposit-broadcast", address: account.address, accountId: scope.accountId, chainId: scope.chainId, piggyId, asset: "shMON", depositTxHash });

  const depositReceipt = await waitForTxSuccess(publicClient, depositTxHash);
  if (!depositReceipt) return { outcome: "failed", reason: "deposit_unconfirmed_or_reverted" };

  let shmonReceived;
  try {
    shmonReceived = await publicClient.readContract({ address: SHMON_ADDRESS, abi: SHMON_ABI, functionName: "balanceOf", args: [account.address] });
  } catch {
    return { outcome: "failed", reason: "balance_read_error" };
  }

  writeSecondSendPending(storage, { stage: "redeem-sending", address: account.address, accountId: scope.accountId, chainId: scope.chainId, piggyId, asset: "shMON", depositTxHash });
  let redeemTxHash;
  try {
    redeemTxHash = await walletClient.sendTransaction({ account, ...makeSecondRedeemTx(shmonReceived, account.address, account.address) });
  } catch {
    return { outcome: "failed", reason: "redeem_send_error" };
  }
  writeSecondSendPending(storage, { stage: "redeem-broadcast", address: account.address, accountId: scope.accountId, chainId: scope.chainId, piggyId, asset: "shMON", depositTxHash, redeemTxHash });

  const redeemReceipt = await waitForTxSuccess(publicClient, redeemTxHash);
  if (!redeemReceipt) return { outcome: "failed", reason: "redeem_unconfirmed_or_reverted" };

  clearSecondSendPending(storage);
  const receipt = {
    ...buildPlumbingReceipt({ accountId: scope.accountId, chainId: scope.chainId, piggyId, depositTxHash, redeemTxHash }),
    blockNumber: Number(redeemReceipt.blockNumber || 0),
    measuredDelta: `shMON ${shmonReceived.toString()} minted then redeemed`,
  };
  return { outcome: "done", receipt, depositTxHash, redeemTxHash, shmonReceived };
}
