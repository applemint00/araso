// [A-710] E + Second local integration wave — node only, no network, no tx.
//   node app/test/a710-e-second-local.mjs
// Pins (each would fail on the pre-A-710 tree):
//   S1  A-693 M-3 closed: second-journey-state saves merge with what is stored (no lost updates across tabs) and
//       report saved:true only after a read-back shows every kept row.
//   E1  current-reader row → candidate decision: no READY / permission is created; Preference ≠ Permission ≠
//       Agreed Rule ≠ READY; agreed-rule mismatch → action 0 + durable decision Receipt (existing grammar) that
//       reopens from storage; missing / stale / conflicting evidence → unknown (never nah, never success).
//   L1  A-693 M-1/M-2 closed for the Second adapter: no injected cross-tab lock → lock_unsupported, no app-lock
//       state → app_lock_state_unknown, lock held elsewhere → lock_busy; all before any record / sign / send.
//   W1  main.js harness passes both; liveExecution stays false.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECISION_RECEIPT_SCHEMA,
  createMemoryStorage,
  createSecondJourneyState,
  applyExploreSelection,
  loadSecondJourneyState,
  recordSecondJourneyDecisionReceipt,
  recordSecondJourneyDecisionReceiptDurably,
  recordSecondJourneyReceipt,
  reopenSecondJourneyDecisionReceipts,
  saveSecondJourneyState,
  secondJourneyStorageKey,
  validateDecisionReceipt,
} from "../src/second-journey-state.js";
import { commitSecondJourneyReceipt } from "../src/second-journey-receipt-bridge.js";
import {
  LANE_RULES,
  MAINNET_LANE_CONFIG,
  acceptAgreedRule,
  decideCurrentCandidate,
  decideCurrentCandidates,
} from "../src/mainnet-job-lane.js";
import { readSecondCurrent } from "../src/second-current-reader.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { readSecondSendPending, runSecondPlumbingProof, secondMoneyLockName } from "../src/second-execution-adapter.js";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(path.join(HERE, "../src", f), "utf8");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 5).join("\n      ")}`);
    fail += 1;
  }
}

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const SCOPE = { accountId: ACCOUNT, chainId: "monad-testnet" };
const NOW = "2026-10-03T00:00:00Z";
const BLOCK = 200000000;

function decisionRow(eventId, extra = {}) {
  return {
    schema: DECISION_RECEIPT_SCHEMA, eventId, accountId: SCOPE.accountId, chainId: SCOPE.chainId,
    destinationId: "kintsu-smon", jobId: "kintsu-smon", decision: "unknown", reason: "missing_evidence", category: "return_semantic",
    expected: "right_back", found: "UNKNOWN", did: "nothing", why: "evidence missing — not guessed", delay: null,
    action: "none", actionCount: 0, txExecuted: false,
    evidence: { source: null, observedAt: null, block: null, evidenceMode: "fresh_read_missing", readStatus: "reader_unconfigured" },
    executionContext: { runtimeChain: SCOPE.chainId, jobChain: "monad-mainnet", executable: false, role: "evidence_only_other_chain" },
    selection: { source: "a710_test", semanticScope: "this_selection_event_only", ownerFinancialChoice: false, createsPermission: false },
    recordedAt: NOW,
    ...extra,
  };
}
const ids = (state) => state.receipts.map((r) => r.eventId).sort();

// ── S1 · A-693 M-3 ─────────────────────────────────────────────────────────────────────────────
await check("S1 M-3: two tabs load the same state, both record a decision row, both save → both rows survive", () => {
  const storage = createMemoryStorage();
  assert.equal(saveSecondJourneyState(storage, SCOPE, createSecondJourneyState(SCOPE)).saved, true);
  const tabA = loadSecondJourneyState(storage, SCOPE).state;
  const tabB = loadSecondJourneyState(storage, SCOPE).state;
  const b = recordSecondJourneyDecisionReceipt(tabB, decisionRow("tab-b-decision"));
  assert.equal(saveSecondJourneyState(storage, SCOPE, b.state).saved, true);
  const a = recordSecondJourneyDecisionReceipt(tabA, decisionRow("tab-a-decision"));
  const savedA = saveSecondJourneyState(storage, SCOPE, a.state);
  assert.equal(savedA.saved, true);
  const stored = loadSecondJourneyState(storage, SCOPE).state;
  assert.deepEqual(ids(stored), ["tab-a-decision", "tab-b-decision"], "the stale tab no longer erases the other tab's row");
  assert.deepEqual(ids(savedA.state), ["tab-a-decision", "tab-b-decision"], "the caller gets the verified merged state back");
});

await check("S1 M-3: the bridge commit from a stale in-memory state keeps rows written since (A-693 double-write path)", () => {
  const storage = createMemoryStorage();
  const stale = createSecondJourneyState(SCOPE);
  const other = recordSecondJourneyDecisionReceipt(loadSecondJourneyState(storage, SCOPE).state, decisionRow("other-tab-decision"));
  assert.equal(saveSecondJourneyState(storage, SCOPE, other.state).saved, true);
  const out = commitSecondJourneyReceipt({
    state: stale,
    receipt: { eventId: "fork-run-1", outcome: "done", evidenceClass: "PASS_FORK_SIM", executionMode: "fork_simulation", accountId: SCOPE.accountId, chainId: SCOPE.chainId, piggyId: "piggy-1" },
    scope: SCOPE, storage, context: { devPreview: false },
  });
  assert.equal(out.saved, true);
  assert.deepEqual(ids(loadSecondJourneyState(storage, SCOPE).state), ["fork-run-1", "other-tab-decision"]);
  assert.deepEqual(ids(out.state), ["fork-run-1", "other-tab-decision"]);
});

await check("S1: a stale tab with nothing new does not overwrite the stored preference; a tab with a new event does", () => {
  const storage = createMemoryStorage();
  const fresh = createSecondJourneyState(SCOPE);
  saveSecondJourneyState(storage, SCOPE, { ...fresh, preference: { ...fresh.preference, yield: 0.3 }, processedEventIds: ["e1"] });
  const stale = { ...fresh, preference: { ...fresh.preference, yield: -0.3 }, processedEventIds: [] };
  assert.equal(saveSecondJourneyState(storage, SCOPE, stale).saved, true);
  assert.equal(loadSecondJourneyState(storage, SCOPE).state.preference.yield, 0.3);
  // [review M-B re-baseline of this card's own draft assertion] a stale tab's hand-set value with no recorded
  // per-event change no longer overwrites what another tab learned; see the M-B test below for the product path.
  saveSecondJourneyState(storage, SCOPE, { ...stale, processedEventIds: ["e2"] });
  assert.equal(loadSecondJourneyState(storage, SCOPE).state.preference.yield, 0.3);
});

await check("S1 review M-B: tab A learns e1 (liquidity), stale tab B learns e2 (yield) → both survive; e1 is not lost", () => {
  const storage = createMemoryStorage();
  assert.equal(saveSecondJourneyState(storage, SCOPE, createSecondJourneyState(SCOPE)).saved, true);
  const tabA = loadSecondJourneyState(storage, SCOPE).state;
  const tabB = loadSecondJourneyState(storage, SCOPE).state;
  const a = applyExploreSelection(tabA, { kind: "one", errands: [{ id: "grow", label: "Grow", lane: "grow" }] },
    { preference: { ...tabA.preference, liquidity: 0.5 } }, { eventId: "e1", now: "2026-10-03T00:00:01Z" });
  assert.equal(saveSecondJourneyState(storage, SCOPE, a.state).saved, true);
  const b = applyExploreSelection(tabB, { kind: "none", errands: [] },
    { preference: { ...tabB.preference, yield: 0.25, reasonDislike: { fees: 0.1 } } }, { eventId: "e2", now: "2026-10-03T00:00:02Z" });
  const savedB = saveSecondJourneyState(storage, SCOPE, b.state);
  assert.equal(savedB.saved, true);
  const stored = loadSecondJourneyState(storage, SCOPE).state;
  assert.equal(stored.preference.liquidity, 0.5, "tab A's e1 learning survives the stale tab's save");
  assert.equal(stored.preference.yield, 0.25, "tab B's e2 learning is applied on top");
  assert.equal(stored.preference.reasonDislike.fees, 0.1);
  assert.deepEqual([...stored.processedEventIds].sort(), ["e1", "e2"]);
  assert.deepEqual(stored.interests.map((i) => i.errandId), ["grow"]);
  // bounds still hold after re-application
  const c = applyExploreSelection(loadSecondJourneyState(storage, SCOPE).state, { kind: "none", errands: [] }, { preference: { ...stored.preference, liquidity: 0.6 } }, { eventId: "e3" });
  const stale = applyExploreSelection(tabB, { kind: "none", errands: [] }, { preference: { ...tabB.preference, liquidity: 0.6 } }, { eventId: "e4" });
  saveSecondJourneyState(storage, SCOPE, c.state);
  saveSecondJourneyState(storage, SCOPE, stale.state);
  assert.equal(loadSecondJourneyState(storage, SCOPE).state.preference.liquidity, 0.6, "re-applied deltas stay clamped to the existing bounds");
});

await check("S1 review L-1: a placeholder timestamp never wins the interest merge over a real time", () => {
  const storage = createMemoryStorage();
  const real = { ...createSecondJourneyState(SCOPE), interests: [{ errandId: "grow", label: "real", updatedAt: "2026-10-03T00:00:00Z" }], processedEventIds: ["r1"] };
  saveSecondJourneyState(storage, SCOPE, real);
  const placeholder = { ...createSecondJourneyState(SCOPE), interests: [{ errandId: "grow", label: "placeholder", updatedAt: "UNKNOWN_TIME" }], processedEventIds: ["p1"] };
  saveSecondJourneyState(storage, SCOPE, placeholder);
  assert.equal(loadSecondJourneyState(storage, SCOPE).state.interests[0].label, "real");
});

await check("S1: durability before success — a write that does not land is saved:false (save_not_verified)", () => {
  const inner = createMemoryStorage();
  const dropping = { getItem: (k) => inner.getItem(k), setItem: () => {}, removeItem: (k) => inner.removeItem(k) };
  const st = recordSecondJourneyReceipt(createSecondJourneyState(SCOPE), { eventId: "x1" }).state;
  const out = saveSecondJourneyState(dropping, SCOPE, st);
  assert.deepEqual([out.saved, out.error], [false, "save_not_verified"]);
  const writeOnly = { setItem: () => {} };
  assert.equal(saveSecondJourneyState(writeOnly, SCOPE, st).saved, false, "no read-back possible = not saved");
});

await check("S1: a stored state from a future version is never overwritten", () => {
  const key = secondJourneyStorageKey(SCOPE);
  const raw = JSON.stringify({ ...createSecondJourneyState(SCOPE), version: 999 });
  const storage = createMemoryStorage({ [key]: raw });
  const out = saveSecondJourneyState(storage, SCOPE, createSecondJourneyState(SCOPE));
  assert.deepEqual([out.saved, out.error], [false, "stored_state_unreadable"]);
  assert.equal(storage.getItem(key), raw);
});

await check("S1: a row the store dropped by its own 20-row cap is not resurrected by a stale tab", () => {
  const storage = createMemoryStorage();
  const stale = recordSecondJourneyReceipt(createSecondJourneyState(SCOPE), { eventId: "old-0" }).state;
  saveSecondJourneyState(storage, SCOPE, stale);
  let st = loadSecondJourneyState(storage, SCOPE).state;
  for (let i = 1; i <= 20; i += 1) st = recordSecondJourneyReceipt(st, { eventId: `new-${i}` }).state;
  saveSecondJourneyState(storage, SCOPE, st);
  assert.ok(!ids(loadSecondJourneyState(storage, SCOPE).state).includes("old-0"));
  saveSecondJourneyState(storage, SCOPE, stale);
  const after = loadSecondJourneyState(storage, SCOPE).state;
  assert.equal(after.receipts.length, 20);
  assert.ok(!ids(after).includes("old-0"));
});

// ── E1 · current reader → candidate decision ──────────────────────────────────────────────────────
const EVENT = "a710-event-1";
const kintsuRow = (read = {}) => ({ id: "kintsu-smon", status: "kintsu_observation", reason: "return_observation_only",
  read: { source: `read-only rpc @${BLOCK}`, observedAt: NOW, chainId: 143, block: BLOCK, codePresent: true, exitFeeBips: 10, ...read } });
const aaveRow = (read = {}) => ({ id: "aave-usdc", status: "aave_buildable", reason: "read_via_lane_pre_action",
  read: { source: `read-only rpc @${BLOCK}`, observedAt: NOW, chainId: 143, block: BLOCK, codePresent: true,
    receiptToken: { matchesRecorded: true }, reserve: { active: true, frozen: false, paused: false },
    holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" }, ...read } });
const rightBack = { kind: "agreed_rule", agreedBy: "user", eventId: EVENT, candidateId: "kintsu-smon", field: "returnSemantic", expected: "right_back" };
const usdcAtLeast = (expected) => ({ kind: "agreed_rule", agreedBy: "user", eventId: EVENT, candidateId: "aave-usdc", field: "piggyUsdcRaw", comparator: "gte", expected });
const PERMISSIONISH = /ready|readiness|preflight|permissiongranted|envelope|signature|nonce|txhash/i;
function keysDeep(v, out = []) {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

await check("E1: a reading alone creates no READY / permission — unknown, action 0, executionPermission false", () => {
  for (const row of [kintsuRow(), aaveRow()]) {
    const d = decideCurrentCandidate({ row, scope: SCOPE, eventId: EVENT, nowIso: NOW });
    assert.deepEqual([d.decision, d.action, d.reason, d.executionPermission], ["unknown", "none", "rule_not_agreed", false]);
    assert.ok(!keysDeep(d).some((k) => PERMISSIONISH.test(k)), `no READY/permission key in ${d.candidateId} output`);
  }
});

await check("E1: Preference ≠ Permission ≠ Agreed Rule ≠ READY — none of the others is accepted as the agreed rule", () => {
  const ctx = { candidateId: "aave-usdc", eventId: EVENT };
  const pref = { ...createSecondJourneyState(SCOPE).preference, kind: "preference" };
  assert.equal(acceptAgreedRule(pref, ctx).error, "preference_is_not_agreed_rule");
  assert.equal(acceptAgreedRule(createSecondJourneyState(SCOPE).preference, ctx).error, "preference_is_not_agreed_rule");
  assert.equal(acceptAgreedRule({ kind: "permission", nonce: "n1", field: "piggyUsdcRaw" }, ctx).error, "permission_is_not_agreed_rule");
  assert.equal(acceptAgreedRule({ ready: true, status: "READY" }, ctx).error, "rule_not_agreed");
  for (const literal of LANE_RULES) assert.equal(acceptAgreedRule(literal, ctx).error, "rule_not_agreed", `code constant ${literal.id} is not a user agreement`);
  assert.equal(acceptAgreedRule({ ...usdcAtLeast("1"), eventId: "an-earlier-event" }, ctx).error, "rule_not_for_this_event");
  assert.equal(acceptAgreedRule({ ...usdcAtLeast("1"), agreedBy: "system" }, ctx).error, "rule_not_agreed");
  assert.equal(acceptAgreedRule(usdcAtLeast("1"), ctx).error, undefined);
  const d = decideCurrentCandidate({ row: aaveRow(), agreedRule: pref, scope: SCOPE, eventId: EVENT });
  assert.deepEqual([d.decision, d.action], ["unknown", "none"]);
});

await check("E1: agreed-rule match is `ask` (exact permission still required), never execute, no receipt", () => {
  const d = decideCurrentCandidate({ row: aaveRow(), agreedRule: usdcAtLeast("1000000"), scope: SCOPE, eventId: EVENT });
  assert.deepEqual([d.decision, d.action, d.executionPermission, d.receipt], ["match", "ask", false, null]);
});

await check("E1: agreed-rule mismatch → nah, action 0, Receipt in the existing grammar (expected · found · block N)", () => {
  const d = decideCurrentCandidate({ row: aaveRow(), agreedRule: usdcAtLeast("9000000"), scope: SCOPE, eventId: EVENT, selectionSource: "a710_test", nowIso: NOW });
  assert.deepEqual([d.decision, d.action, d.executionPermission], ["nah", "none", false]);
  assert.equal(d.receiptError, null);
  const r = d.receipt;
  assert.equal(r.schema, DECISION_RECEIPT_SCHEMA);
  assert.deepEqual([r.expected, r.found, r.evidence.block, r.action, r.actionCount, r.txExecuted, r.did], ["9000000", "5000000", BLOCK, "none", 0, false, "nothing"]);
  assert.equal(r.executionContext.executable, false);
  assert.equal(r.selection.createsPermission, false);
  assert.equal(validateDecisionReceipt(r, SCOPE).error, null);
});

await check("E1: semantic mismatch (right_back vs Kintsu delayed exit, pinned block) → nah, action 0", () => {
  const d = decideCurrentCandidate({ row: kintsuRow(), agreedRule: rightBack, scope: SCOPE, eventId: EVENT, nowIso: NOW });
  assert.deepEqual([d.decision, d.action, d.reason], ["nah", "none", "semantic_return_mismatch"]);
  assert.deepEqual([d.receipt.expected, d.receipt.found, d.receipt.evidence.block], ["right_back", "delayed", BLOCK]);
});

await check("E1: mismatch Receipt is durable and reopens from storage after a reload; a re-record is a verified duplicate", () => {
  const storage = createMemoryStorage();
  const d = decideCurrentCandidate({ row: kintsuRow(), agreedRule: rightBack, scope: SCOPE, eventId: EVENT, nowIso: NOW });
  const out = recordSecondJourneyDecisionReceiptDurably(storage, SCOPE, d.receipt);
  assert.deepEqual([out.saved, out.recorded, out.error], [true, true, null]);
  const reloaded = createMemoryStorage(storage.dump());
  const reopened = reopenSecondJourneyDecisionReceipts(reloaded, SCOPE, { destinationId: "kintsu-smon" });
  assert.equal(reopened.error, null);
  assert.equal(reopened.receipts.length, 1);
  assert.deepEqual([reopened.receipts[0].decision, reopened.receipts[0].found, reopened.receipts[0].evidence.block], ["nah", "delayed", BLOCK]);
  const again = recordSecondJourneyDecisionReceiptDurably(reloaded, SCOPE, d.receipt);
  assert.deepEqual([again.saved, again.duplicate, again.recorded], [true, true, false]);
  const dropping = { getItem: (k) => storage.getItem(k), setItem: () => {}, removeItem: () => {} };
  const other = decideCurrentCandidate({ row: kintsuRow(), agreedRule: { ...rightBack, eventId: "e2" }, scope: SCOPE, eventId: "e2", nowIso: NOW });
  const lost = recordSecondJourneyDecisionReceiptDurably(dropping, SCOPE, other.receipt);
  assert.equal(lost.saved, false, "a Receipt that did not land is never reported saved");
  // Another writer replaces the stored state right after the save's own read-back: the reopen check still catches it.
  const inner = createMemoryStorage(storage.dump());
  let readsAfterWrite = -1;
  let before = null;
  const clobbered = {
    getItem: (k) => {
      if (readsAfterWrite >= 0 && (readsAfterWrite += 1) > 1) return before;
      return inner.getItem(k);
    },
    setItem: (k, v) => { before = inner.getItem(k); readsAfterWrite = 0; inner.setItem(k, v); },
    removeItem: (k) => inner.removeItem(k),
  };
  const third = decideCurrentCandidate({ row: kintsuRow(), agreedRule: { ...rightBack, eventId: "e3" }, scope: SCOPE, eventId: "e3", nowIso: NOW });
  const vanished = recordSecondJourneyDecisionReceiptDurably(clobbered, SCOPE, third.receipt);
  assert.deepEqual([vanished.saved, vanished.error], [false, "save_not_verified"]);
});

await check("E1: missing / stale / conflicting evidence → unknown, never nah, never success", () => {
  const cases = [
    [{ id: "kintsu-smon", status: "read_failed", reason: "no_rpc", read: null }, "evidence_unavailable:read_failed"],
    [kintsuRow({ stale: true }), "stale_evidence"],
    [kintsuRow({ expiresAtMs: Date.parse(NOW) - 1 }), "stale_evidence"],
    [kintsuRow({ chainId: 10143 }), "source_conflict"],
    [kintsuRow({ conflict: true }), "source_conflict"],
    [kintsuRow({ codePresent: false }), "source_conflict"],
    [kintsuRow({ block: null }), "missing_block"],
    [kintsuRow({ observedAt: null }), "missing_evidence"],
    [kintsuRow({ block: 1 }), "stale_evidence"], // older than the recorded live read → the Job's own evidence calls it stale
    [kintsuRow({ exitFeeBips: 11 }), "source_conflict"], // the Job changed since it was proven
  ];
  for (const [row, why] of cases) {
    const d = decideCurrentCandidate({ row, agreedRule: rightBack, scope: SCOPE, eventId: EVENT, nowMs: Date.parse(NOW), nowIso: NOW });
    assert.equal(d.decision, "unknown", `${why}: decision`);
    assert.equal(d.action, "none", `${why}: action`);
    assert.equal(d.receipt?.decision, "unknown", `${why}: receipt is an unknown, not a nah`);
    assert.ok(d.reason === why || (why === "source_conflict" && d.reason === "source_conflict"), `${why}: got ${d.reason}`);
  }
  // review M-A: an expiry with no caller clock cannot be shown fresh → stale (unknown), never a nah
  for (const nowMs of [undefined, Number.NaN]) {
    const noClock = decideCurrentCandidate({ row: aaveRow({ expiresAtMs: 1, holdings: { usdcRaw: "100", receiptRaw: "0", allowanceToPoolRaw: "0" } }), agreedRule: usdcAtLeast("500"), scope: SCOPE, eventId: EVENT, nowMs });
    assert.deepEqual([noClock.decision, noClock.reason, noClock.action, noClock.receipt.decision], ["unknown", "stale_evidence", "none", "unknown"]);
  }
  const badExpiry = decideCurrentCandidate({ row: aaveRow({ expiresAtMs: "soon" }), agreedRule: usdcAtLeast("9000000"), scope: SCOPE, eventId: EVENT, nowMs: Date.parse(NOW) });
  assert.deepEqual([badExpiry.decision, badExpiry.reason], ["unknown", "stale_evidence"]);
  const liveExpiry = decideCurrentCandidate({ row: aaveRow({ expiresAtMs: Date.parse(NOW) + 60000 }), agreedRule: usdcAtLeast("9000000"), scope: SCOPE, eventId: EVENT, nowMs: Date.parse(NOW) });
  assert.equal(liveExpiry.decision, "nah", "an unexpired reading with a caller clock is still compared");
  const aaveConflict = decideCurrentCandidate({ row: aaveRow({ receiptToken: { matchesRecorded: false } }), agreedRule: usdcAtLeast("9000000"), scope: SCOPE, eventId: EVENT });
  assert.deepEqual([aaveConflict.decision, aaveConflict.reason], ["unknown", "source_conflict"]);
  // numeric rules have no Job-evidence second check: the chain guard itself must hold (a wrong-chain read is not a nah)
  const wrongChain = decideCurrentCandidate({ row: aaveRow({ chainId: 10143 }), agreedRule: usdcAtLeast("9000000"), scope: SCOPE, eventId: EVENT });
  assert.deepEqual([wrongChain.decision, wrongChain.reason, wrongChain.receipt.decision], ["unknown", "source_conflict", "unknown"]);
  const staleNumeric = decideCurrentCandidate({ row: aaveRow({ stale: true }), agreedRule: usdcAtLeast("9000000"), scope: SCOPE, eventId: EVENT });
  assert.deepEqual([staleNumeric.decision, staleNumeric.reason], ["unknown", "stale_evidence"]);
});

await check("E1: the candidate universe is the reader's (9 rows today), every row decided — no top-3 cap", async () => {
  const read = await readSecondCurrent({ profile: resolveChainProfile("monad-mainnet"), piggyAddress: ACCOUNT });
  const all = decideCurrentCandidates({ currentRead: read, scope: SCOPE, eventId: EVENT, nowIso: NOW });
  assert.equal(all.length, read.candidates.length);
  assert.ok(all.length >= 9);
  assert.deepEqual(all.map((d) => d.candidateId), read.candidates.map((c) => c.id));
  for (const d of all) assert.deepEqual([d.decision, d.action, d.executionPermission], ["unknown", "none", false]);
});

// ── L1 · A-693 M-1 / M-2 (Second adapter) ──────────────────────────────────────────────────────────
const PIGGY = "piggy-1";
const SIGNER = { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
function clients() {
  const sent = [];
  // [A-791 harness wiring] VIEM_SEND prepares + runs the A-768 pre-sign assertion before sendTransaction (well-formed eip1559 here).
  const walletClient = { async prepareTransactionRequest(t) { return { ...t, type: "eip1559", chainId: 10143, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 7, gas: 21000n }; }, async sendTransaction(tx) { sent.push(tx); return `0x${String(sent.length).repeat(64).slice(0, 64)}`; } };
  const publicClient = { async waitForTransactionReceipt() { return { status: "success", blockNumber: 1n }; }, async readContract() { return BigInt(sent.length * 100); } };
  return { sent, walletClient, publicClient };
}
const held = new Set();
async function memLock(name, body) {
  if (held.has(name)) return undefined;
  held.add(name);
  try { return await body(); } finally { held.delete(name); }
}
const runArgs = (c, storage, extra = {}) => ({ storage, scope: SCOPE, piggyId: PIGGY, amountWei: "1000", confirm: true, account: SIGNER,
  walletClient: c.walletClient, publicClient: c.publicClient, signDigest: async () => ({}), isAppLocked: () => false, withMoneyLock: memLock, ...extra });

await check("L1 M-1: no injected cross-tab lock → lock_unsupported before any record / sign / send", async () => {
  const c = clients();
  const storage = createMemoryStorage();
  let signed = 0;
  const out = await runSecondPlumbingProof(runArgs(c, storage, { withMoneyLock: null, signDigest: async () => { signed += 1; } }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "lock_unsupported"]);
  assert.deepEqual([c.sent.length, signed, readSecondSendPending(storage, SCOPE, PIGGY)], [0, 0, null]);
  const thrown = await runSecondPlumbingProof(runArgs(c, storage, { withMoneyLock: async () => { throw new Error("no locks"); } }));
  assert.deepEqual([thrown.outcome, thrown.reason], ["blocked", "lock_unsupported"]);
  assert.equal(c.sent.length, 0);
});

await check("L1 M-2: no app-lock state → app_lock_state_unknown; a non-false answer is locked", async () => {
  const c = clients();
  const storage = createMemoryStorage();
  const out = await runSecondPlumbingProof(runArgs(c, storage, { isAppLocked: null }));
  assert.deepEqual([out.outcome, out.reason], ["blocked", "app_lock_state_unknown"]);
  const vague = await runSecondPlumbingProof(runArgs(c, storage, { isAppLocked: () => undefined }));
  assert.deepEqual([vague.outcome, vague.reason], ["blocked", "app_locked"]);
  assert.equal(c.sent.length, 0);
});

await check("L1 M-1 / L-1: lock held by another run of the same account (other Piggy) → lock_busy, nothing sent", async () => {
  const c = clients();
  const name = secondMoneyLockName(SCOPE);
  assert.equal(name, secondMoneyLockName({ ...SCOPE, accountId: SCOPE.accountId.toUpperCase().replace("0X", "0x") }), "account-level name");
  held.add(name);
  try {
    const out = await runSecondPlumbingProof(runArgs(c, createMemoryStorage(), { piggyId: "piggy-2" }));
    assert.deepEqual([out.outcome, out.reason], ["blocked", "lock_busy"]);
    assert.equal(c.sent.length, 0);
  } finally {
    held.delete(name);
  }
  const ok = await runSecondPlumbingProof(runArgs(c, createMemoryStorage()));
  assert.equal(ok.outcome, "done", ok.reason || "");
  assert.equal(c.sent.length, 2, "deposit + redeem once the lock is free");
});

await check("L1 review L-4: an exception inside the locked run is that run's failure, not lock_unsupported (fail-closed)", async () => {
  const c = clients();
  const out = await runSecondPlumbingProof(runArgs(c, createMemoryStorage(), {
    requestGrant: async () => ({ granted: true }),
    waitForGrantBalance: async () => { throw new Error("balance poll exploded"); },
  }));
  assert.deepEqual([out.outcome, out.reason], ["failed", "run_error"]);
  assert.equal(c.sent.length, 0);
  assert.equal(held.size, 0, "the lock is released");
});

await check("L1: two concurrent runs on one account → exactly one reaches the money executor", async () => {
  const c = clients();
  const storage = createMemoryStorage();
  const [a, b] = await Promise.all([
    runSecondPlumbingProof(runArgs(c, storage, { piggyId: "piggy-a" })),
    runSecondPlumbingProof(runArgs(c, storage, { piggyId: "piggy-b" })),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["blocked", "done"]);
  assert.equal([a, b].find((o) => o.outcome === "blocked").reason, "lock_busy");
  assert.equal(c.sent.length, 2);
});

// ── W1 · main.js wiring + execution boundary ──────────────────────────────────────────────────────
await check("W1: main.js harness passes isAppLocked + a Web Locks wrapper; the wrapper is exclusive + ifAvailable", () => {
  const main = SRC("main.js");
  const call = main.slice(main.indexOf("const outcome = await runSecondPlumbingProof({"), main.indexOf("if (outcome.outcome === \"done\" && outcome.receipt)"));
  assert.match(call, /isAppLocked: \(\) => !!state\.appLock/);
  assert.match(call, /withMoneyLock: secondMoneyLock\(\)/);
  const fn = main.slice(main.indexOf("function secondMoneyLock()"), main.indexOf("async function runLocalSecondPlumbingProofIfHarnessed"));
  assert.match(fn, /if \(!sendLocksCapable\(\)\) return null;/);
  assert.match(fn, /navigator\.locks\.request\(name, \{ mode: "exclusive", ifAvailable: true \}/);
  assert.match(main, /if \(result\.saved && result\.state\) sj\.domainState = result\.state;/);
});

await check("Boundary: liveExecution stays false; the E1 decision code has no send / sign / executor path", () => {
  assert.equal(MAINNET_LANE_CONFIG.liveExecution, false);
  assert.equal(MAINNET_LANE_CONFIG.reader, null);
  const lane = SRC("mainnet-job-lane.js");
  const e1 = lane.slice(lane.indexOf("// ── [E1] current-reader output")).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(e1.length > 1000);
  assert.ok(!/sendTransaction|sendRawTransaction|executeMoneyStep|executor\.|issuePermission|authorize\(|consume\(|signTransaction|localStorage|setItem/.test(e1));
});

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
