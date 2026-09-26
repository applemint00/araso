import assert from "node:assert/strict";
import {
  applyExploreSelection,
  createMemoryStorage,
  createSecondJourneyState,
  loadSecondJourneyState,
  recordSecondJourneyReceipt,
  removeInterest,
  saveSecondJourneyState,
  secondJourneyStorageKey,
  normalizeSecondJourneyState,
  DECISION_RECEIPT_SCHEMA,
  readSecondJourneyDecisionReceipts,
  recordSecondJourneyDecisionReceipt,
  validateDecisionReceipt,
} from "../src/second-journey-state.js";
import { runSecondJourney, STATUS } from "../src/job-feed.js";
import { readSecondJourneyReceipts, resolveReceiptOutcome } from "../src/second-journey-receipt-bridge.js";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

const market = { id: "market", label: "시장 다녀오기", lane: "Trade" };
const claim = { id: "claim", label: "받을 것 받아오기", lane: "Claim" };
const pref = { preference: { reasonDislike: {}, novelty: 0.1, clarity: 0, liquidity: 0, lowCost: 0, yield: 0, confidence: 0, explorationWidth: 0 } };

check("storage key separates account and chain", () => {
  assert.notEqual(secondJourneyStorageKey({ accountId: "a", chainId: "1" }), secondJourneyStorageKey({ accountId: "a", chainId: "2" }));
  assert.notEqual(secondJourneyStorageKey({ accountId: "a", chainId: "1" }), secondJourneyStorageKey({ accountId: "b", chainId: "1" }));
});

check("one/multi selection stores explicit interests and bounded preference", () => {
  const state = createSecondJourneyState({ accountId: "a", chainId: "1" });
  const result = applyExploreSelection(state, { kind: "multi", errands: [market, claim] }, pref, { eventId: "e1", now: "t1" });
  assert.deepEqual(result.state.interests.map((item) => item.errandId), ["market", "claim"]);
  assert.equal(result.state.preference.novelty, 0.1);
  assert.equal(result.preferenceApplied, true);
});

check("same event id does not double-apply interests or preference", () => {
  const state = applyExploreSelection(createSecondJourneyState({ accountId: "a", chainId: "1" }), { kind: "one", errands: [market] }, pref, { eventId: "e1" }).state;
  const duplicate = applyExploreSelection(state, { kind: "one", errands: [claim] }, { preference: { novelty: 0.6 } }, { eventId: "e1" });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state.interests.map((item) => item.errandId), ["market"]);
  assert.equal(duplicate.state.preference.novelty, 0.1);
});

check("none/unsure do not delete an existing explicit list", () => {
  let state = applyExploreSelection(createSecondJourneyState({ accountId: "a", chainId: "1" }), { kind: "one", errands: [market] }, pref, { eventId: "e1" }).state;
  state = applyExploreSelection(state, { kind: "none", errands: [] }, { preference: { ...pref.preference, clarity: 0.1 } }, { eventId: "e2" }).state;
  assert.deepEqual(state.interests.map((item) => item.errandId), ["market"]);
  assert.equal(state.preference.clarity, 0.1);
});

check("deleting an interest is not pending-job cancellation", () => {
  const withInterest = applyExploreSelection(createSecondJourneyState({ accountId: "a", chainId: "1" }), { kind: "one", errands: [market] }, pref, { eventId: "e1" }).state;
  const withPending = { ...withInterest, pendingJobs: [{ id: "job-1", errandId: "market", status: "pending" }] };
  const removed = removeInterest(withPending, "market", { eventId: "e2" });
  assert.deepEqual(removed.interests, []);
  assert.equal(removed.pendingJobs.length, 1);
});

check("save/load repairs malformed storage without touching other keys", () => {
  const storage = createMemoryStorage({ unrelated: "keep" });
  const scope = { accountId: "a", chainId: "1" };
  const state = applyExploreSelection(createSecondJourneyState(scope), { kind: "one", errands: [market] }, pref, { eventId: "e1" }).state;
  saveSecondJourneyState(storage, scope, state);
  assert.equal(loadSecondJourneyState(storage, scope).state.interests.length, 1);
  storage.setItem(secondJourneyStorageKey({ accountId: "b", chainId: "1" }), "{bad json");
  const bad = loadSecondJourneyState(storage, { accountId: "b", chainId: "1" });
  assert.equal(bad.repaired, true);
  assert.equal(bad.error, "corrupt_json");
  assert.equal(storage.getItem(secondJourneyStorageKey({ accountId: "b", chainId: "1" })), "{bad json");
  assert.equal(storage.getItem("unrelated"), "keep");
});

check("save rejects mismatched account or chain without relabeling state", () => {
  const storage = createMemoryStorage();
  const stateA = applyExploreSelection(createSecondJourneyState({ accountId: "a", chainId: "1" }), { kind: "one", errands: [market] }, pref, { eventId: "e1" }).state;
  const wrongAccount = saveSecondJourneyState(storage, { accountId: "b", chainId: "1" }, stateA);
  const wrongChain = saveSecondJourneyState(storage, { accountId: "a", chainId: "2" }, stateA);
  assert.equal(wrongAccount.saved, false);
  assert.equal(wrongAccount.error, "scope_mismatch");
  assert.equal(wrongChain.saved, false);
  assert.equal(loadSecondJourneyState(storage, { accountId: "b", chainId: "1" }).state.interests.length, 0);
  assert.equal(loadSecondJourneyState(storage, { accountId: "a", chainId: "2" }).state.interests.length, 0);
});

check("load rejects payload scope mismatch instead of relabeling", () => {
  const storage = createMemoryStorage();
  storage.setItem(secondJourneyStorageKey({ accountId: "b", chainId: "1" }), JSON.stringify({
    ...createSecondJourneyState({ accountId: "a", chainId: "1" }),
    interests: [{ errandId: "market", label: "시장 다녀오기" }],
  }));
  const loaded = loadSecondJourneyState(storage, { accountId: "b", chainId: "1" });
  assert.equal(loaded.error, "scope_mismatch");
  assert.deepEqual(loaded.state.interests, []);
});

check("save rejects malformed, missing identity, unsupported version, and unavailable adapter without writing", () => {
  const scope = { accountId: "a", chainId: "1" };
  for (const state of [null, [], { version: 1, chainId: "1" }, { version: 1, accountId: "a" }, { version: 1, accountId: 42, chainId: 42 }, { ...createSecondJourneyState(scope), version: 999 }]) {
    const storage = createMemoryStorage();
    const result = saveSecondJourneyState(storage, scope, state);
    assert.equal(result.saved, false);
    assert.equal(storage.getItem(secondJourneyStorageKey(scope)), null);
  }
  assert.equal(saveSecondJourneyState(null, scope, createSecondJourneyState(scope)).error, "storage_unavailable");
  assert.equal(saveSecondJourneyState(createMemoryStorage(), {}, createSecondJourneyState()).error, "missing_scope");
  assert.equal(saveSecondJourneyState(createMemoryStorage(), { accountId: 42, chainId: 42 }, createSecondJourneyState({ accountId: 42, chainId: 42 })).error, "missing_scope");
  const throwing = { setItem() { throw new Error("nope"); } };
  assert.equal(saveSecondJourneyState(throwing, scope, createSecondJourneyState(scope)).error, "storage_write_failed");
});

check("load rejects missing identity and future version as repaired empty state without overwriting raw", () => {
  const scope = { accountId: "a", chainId: "1" };
  const key = secondJourneyStorageKey(scope);
  for (const payload of [{ version: 1, preference: { novelty: 0.6 } }, { ...createSecondJourneyState(scope), version: 999 }]) {
    const storage = createMemoryStorage({ [key]: JSON.stringify(payload) });
    const result = loadSecondJourneyState(storage, scope);
    assert.equal(result.repaired, true);
    assert.equal(result.state.interests.length, 0);
    assert.equal(storage.getItem(key), JSON.stringify(payload));
  }
});

check("normalize preference handles null, array, and nonobject safely", () => {
  for (const preference of [null, [], "bad"]) {
    const normalized = normalizeSecondJourneyState({ ...createSecondJourneyState({ accountId: "a", chainId: "1" }), preference }, { accountId: "a", chainId: "1" }).state.preference;
    assert.equal(normalized.novelty, 0);
    assert.equal(normalized.confidence, 0);
    assert.deepEqual(normalized.reasonDislike, {});
  }
});

check("stored preference is clamped to selector bounds", () => {
  const normalized = loadSecondJourneyState(createMemoryStorage({
    [secondJourneyStorageKey({ accountId: "a", chainId: "1" })]: JSON.stringify({
      ...createSecondJourneyState({ accountId: "a", chainId: "1" }),
      preference: { novelty: 999, confidence: 999, explorationWidth: -999, reasonDislike: { novelty: 999, clarity: -1 } },
    }),
  }), { accountId: "a", chainId: "1" }).state.preference;
  assert.equal(normalized.novelty, 0.6);
  assert.equal(normalized.confidence, 0.35);
  assert.equal(normalized.explorationWidth, -0.25);
  assert.equal(normalized.reasonDislike.novelty, 0.35);
  assert.equal(normalized.reasonDislike.clarity, 0);
});

check("receipt record updates evidence but not knowledge by itself", () => {
  const state = createSecondJourneyState({ accountId: "a", chainId: "1" });
  const result = recordSecondJourneyReceipt(state, { eventId: "r1", evidencePointer: "tx:mock", txExecuted: false }, { eventId: "r1" });
  assert.deepEqual(result.state.evidenceState.pointers, ["tx:mock"]);
  assert.equal(result.state.knowledgeState.observedDemonstrations.length, 0);
});

// ── [A-576] action-0 nah Receipt through the EXISTING Second Journey storage path ──
// LOCAL/FIXTURE USER-SELECTION: a deterministic product-flow event for a local proof.
// It is not an Owner financial choice and not a permission.
const A576_SCOPE = { accountId: "0x00000000000000000000000000000000000000a1", chainId: "monad-testnet" };
const A576_DEST = "kintsu-like-grow-delayed-return";
function a576Flow(extra = {}) {
  return runSecondJourney({
    scope: A576_SCOPE,
    selectionKind: "one",
    selectedErrandIds: ["grow"],
    preferredDestinationId: A576_DEST,
    jitAnswer: "right_back",
    selectionSource: "LOCAL/FIXTURE USER-SELECTION",
    eventId: "a576-local-selection-1",
    now: "2026-09-24T00:00:00Z",
    ...extra,
  });
}

check("A-576 nah Receipt persists in the existing storage key and reload shows the same Receipt, action 0", () => {
  const storage = createMemoryStorage();
  const flow = a576Flow();
  assert.equal(flow.decisionReceipt.decision, "nah");
  const recorded = recordSecondJourneyDecisionReceipt(flow.explicitInterestState, flow.decisionReceipt);
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.error, null);
  const saved = saveSecondJourneyState(storage, A576_SCOPE, recorded.state);
  assert.equal(saved.saved, true);
  // No sidecar: the only key written is the existing Second Journey state key.
  assert.deepEqual(Object.keys(storage.dump()), [secondJourneyStorageKey(A576_SCOPE)]);
  // Reload = a fresh load from the same storage.
  const reloaded = loadSecondJourneyState(storage, A576_SCOPE);
  assert.equal(reloaded.error, undefined);
  const rows = readSecondJourneyDecisionReceipts(reloaded.state, { destinationId: A576_DEST });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], JSON.parse(JSON.stringify(flow.decisionReceipt)));
  assert.equal(rows[0].schema, DECISION_RECEIPT_SCHEMA);
  assert.equal(rows[0].decision, "nah");
  assert.equal(rows[0].actionCount, 0);
  assert.equal(rows[0].txExecuted, false);
  assert.equal(rows[0].did, "nothing");
  assert.equal(rows[0].evidence.provenance.contract, "0xA3227C5969757783154C60bF0bC1944180ed81B9");
  assert.equal(rows[0].evidence.observedAt, "2026-09-24");
  assert.equal(rows[0].selection.source, "LOCAL/FIXTURE USER-SELECTION");
  // A second reload gives the same value.
  assert.deepEqual(readSecondJourneyDecisionReceipts(loadSecondJourneyState(storage, A576_SCOPE).state), rows);
});

check("A-576 the decision Receipt never reads as an execution outcome", () => {
  const flow = a576Flow();
  const state = recordSecondJourneyDecisionReceipt(flow.explicitInterestState, flow.decisionReceipt).state;
  assert.equal(readSecondJourneyReceipts(state).length, 0);
  assert.equal(resolveReceiptOutcome(state.receipts[0]), "unknown");
});

check("A-576 same decision event is recorded once", () => {
  const flow = a576Flow();
  const first = recordSecondJourneyDecisionReceipt(flow.explicitInterestState, flow.decisionReceipt);
  const second = recordSecondJourneyDecisionReceipt(first.state, flow.decisionReceipt);
  assert.equal(second.duplicate, true);
  assert.equal(readSecondJourneyDecisionReceipts(second.state).length, 1);
});

check("A-576 recording the Receipt does not touch preference, interests or knowledge", () => {
  const flow = a576Flow();
  const before = flow.explicitInterestState;
  const after = recordSecondJourneyDecisionReceipt(before, flow.decisionReceipt).state;
  assert.deepEqual(after.preference, before.preference);
  assert.deepEqual(after.interests, before.interests);
  assert.deepEqual(after.knowledgeState, before.knowledgeState);
  assert.deepEqual(after.evidenceState, before.evidenceState);
});

check("A-576 non-action-0 / overclaiming / unscoped Receipts are refused, state unchanged", () => {
  const flow = a576Flow();
  const base = flow.decisionReceipt;
  const state = flow.explicitInterestState;
  const bad = [
    [{ ...base, action: "execute" }, "not_action0"],
    [{ ...base, actionCount: 1 }, "not_action0"],
    [{ ...base, txExecuted: true }, "not_action0"],
    [{ ...base, txHash: "0x" + "1".repeat(64) }, "forbidden_field_present"],
    [{ ...base, permission: true }, "forbidden_field_present"],
    [{ ...base, agreedRule: { returnTolerance: "right_back" } }, "forbidden_field_present"],
    [{ ...base, decision: "done" }, "not_action0_decision"],
    [{ ...base, evidence: { ...base.evidence, source: null } }, "nah_without_provenance"],
    [{ ...base, evidence: { ...base.evidence, observedAt: null } }, "nah_without_provenance"],
    [{ ...base, accountId: "0x00000000000000000000000000000000000000b2" }, "scope_mismatch"],
    [{ ...base, selection: { ...base.selection, ownerFinancialChoice: true } }, "selection_overclaims"],
    [{ ...base, selection: { ...base.selection, createsPermission: true } }, "selection_overclaims"],
  ];
  for (const [receipt, error] of bad) {
    const out = recordSecondJourneyDecisionReceipt(state, receipt);
    assert.equal(out.recorded, false, error);
    assert.equal(out.error, error);
    assert.equal(out.state, state);
  }
  assert.equal(validateDecisionReceipt(base, state).error, null);
});

check("A-576 right_back is agreed for that selection event only: reload without an answer is not nah", () => {
  const storage = createMemoryStorage();
  const flow = a576Flow();
  saveSecondJourneyState(storage, A576_SCOPE, recordSecondJourneyDecisionReceipt(flow.explicitInterestState, flow.decisionReceipt).state);
  const restored = loadSecondJourneyState(storage, A576_SCOPE).state;
  const next = runSecondJourney({ secondJourneyState: restored, scope: A576_SCOPE, selectionKind: "one", selectedErrandIds: ["grow"], preferredDestinationId: A576_DEST, eventId: "a576-local-selection-2" });
  const kintsu = next.destinations.find((d) => d.id === A576_DEST);
  assert.notEqual(kintsu.derivedStatus, STATUS.NAH);
  assert.equal(kintsu.decision.action, "ask");
  assert.equal(next.decisionReceipt, null);
  // The earlier Receipt is still there after reload.
  assert.equal(readSecondJourneyDecisionReceipts(next.explicitInterestState).length, 1);
});

// ── [A-579 repair RV-1] the validated object is the stored object (review RV-1, 4 vectors) ──
function rv1Base(st) {
  return { schema: DECISION_RECEIPT_SCHEMA, eventId: "e1", accountId: st.accountId, chainId: st.chainId, destinationId: "d", jobId: "j",
    decision: "unknown", reason: "r", category: "c", expected: "x", found: "y", did: "nothing", why: "w", action: "none", actionCount: 0,
    txExecuted: false, evidence: { source: null, observedAt: null, block: null }, executionContext: { runtimeChain: st.chainId, executable: false },
    selection: { source: "app_ui_jit_answer", ownerFinancialChoice: false, createsPermission: false }, recordedAt: "t" };
}
const RV1_SCOPE = { accountId: "0x" + "a".repeat(40), chainId: "monad-testnet" };
const RV1_TX = "0x" + "ab".repeat(32);

check("A-579 RV-1 baseline: a plain valid decision Receipt still records, stored row equals the validated snapshot", () => {
  const st = createSecondJourneyState(RV1_SCOPE);
  const r = rv1Base(st);
  const out = recordSecondJourneyDecisionReceipt(st, r);
  assert.equal(out.error, null);
  assert.equal(out.recorded, true);
  assert.deepEqual(out.state.receipts[0], JSON.parse(JSON.stringify(r)));
  assert.notEqual(out.state.receipts[0], r);
  assert.deepEqual(validateDecisionReceipt(r, st).receipt, out.state.receipts[0]);
  // null-prototype plain objects are plain data too
  const bare = Object.assign(Object.create(null), rv1Base(st), { eventId: "e-bare" });
  assert.equal(recordSecondJourneyDecisionReceipt(st, bare).error, null);
});

check("A-579 RV-1 vector 1: toJSON on evidence (smuggling txHash/permission) is refused, nothing stored", () => {
  const st = createSecondJourneyState(RV1_SCOPE);
  const r = rv1Base(st); r.eventId = "e-tojson";
  r.evidence = { source: null, observedAt: null, block: null, toJSON() { return { txHash: RV1_TX, permission: true }; } };
  const out = recordSecondJourneyDecisionReceipt(st, r);
  assert.equal(out.recorded, false);
  assert.equal(out.error, "receipt_not_plain_data");
  assert.equal(out.state, st);
  assert.equal(out.state.receipts.length, 0);
});

check("A-579 RV-1 vector 2: evidence on the prototype (unseen by an own-key scan) is refused", () => {
  const st = createSecondJourneyState(RV1_SCOPE);
  let r = rv1Base(st); r.eventId = "e-proto";
  const ev = { source: null, observedAt: null, block: null, txHash: RV1_TX, Permission: true };
  delete r.evidence;
  r = Object.assign(Object.create({ evidence: ev }), r);
  const out = recordSecondJourneyDecisionReceipt(st, r);
  assert.equal(out.recorded, false);
  assert.equal(out.error, "receipt_not_plain_data");
  assert.equal(out.state.receipts.length, 0);
});

check("A-579 RV-1 vector 3: a stateful getter (action none → execute) is refused, and read at most 0 times by the store", () => {
  const st = createSecondJourneyState(RV1_SCOPE);
  const r = rv1Base(st); r.eventId = "e-getter";
  let n = 0;
  Object.defineProperty(r, "action", { enumerable: true, get() { n += 1; return n > 2 ? "execute" : "none"; } });
  const out = recordSecondJourneyDecisionReceipt(st, r);
  assert.equal(out.recorded, false);
  assert.equal(out.error, "receipt_not_plain_data");
  assert.equal(out.state.receipts.length, 0);
  assert.equal(n, 0); // refused on the descriptor, the getter is never invoked
});

check("A-579 RV-1 vector 4: toJSON on executionContext (validated executable:false, would store executable:true) is refused", () => {
  const st = createSecondJourneyState(RV1_SCOPE);
  const r = rv1Base(st); r.eventId = "e-ctx";
  r.executionContext = { runtimeChain: st.chainId, executable: false, toJSON() { return { runtimeChain: "monad-mainnet", executable: true }; } };
  const out = recordSecondJourneyDecisionReceipt(st, r);
  assert.equal(out.recorded, false);
  assert.equal(out.error, "receipt_not_plain_data");
  assert.equal(out.state.receipts.length, 0);
  // top-level toJSON / non-plain class instance / symbol key / nested accessor: same refusal
  const top = { ...rv1Base(st), eventId: "e-top", toJSON() { return { ...rv1Base(st), action: "execute" }; } };
  assert.equal(recordSecondJourneyDecisionReceipt(st, top).error, "receipt_not_plain_data");
  class Fancy { constructor() { Object.assign(this, rv1Base(st), { eventId: "e-class" }); } }
  assert.equal(recordSecondJourneyDecisionReceipt(st, new Fancy()).error, "receipt_not_plain_data");
  const sym = { ...rv1Base(st), eventId: "e-sym", [Symbol("x")]: 1 };
  assert.equal(recordSecondJourneyDecisionReceipt(st, sym).error, "receipt_not_plain_data");
  const nested = rv1Base(st); nested.eventId = "e-nested";
  Object.defineProperty(nested.selection, "source", { enumerable: true, get: () => "app_ui_jit_answer" });
  assert.equal(recordSecondJourneyDecisionReceipt(st, nested).error, "receipt_not_plain_data");
});

check("A-579 RV-1 load: a stored decision row that fails the validator is dropped on load and never surfaced; valid rows and other receipt types survive", () => {
  const storage = createMemoryStorage();
  const st = createSecondJourneyState(RV1_SCOPE);
  const good = recordSecondJourneyDecisionReceipt(st, rv1Base(st)).state;
  const bad = { ...rv1Base(st), eventId: "e-bad-row", action: "execute", evidence: { source: null, observedAt: null, block: null, txHash: RV1_TX } };
  const other = { eventId: "send-1", outcome: "done" };
  storage.setItem(secondJourneyStorageKey(RV1_SCOPE), JSON.stringify({ ...good, receipts: [bad, ...good.receipts, other] }));
  const loaded = loadSecondJourneyState(storage, RV1_SCOPE).state;
  assert.deepEqual(loaded.receipts.map((row) => row.eventId), ["e1", "send-1"]);
  assert.deepEqual(readSecondJourneyDecisionReceipts(loaded).map((row) => row.eventId), ["e1"]);
  // read also re-validates rows already in memory (does not crash, does not surface)
  const inMemory = { ...loaded, receipts: [bad, ...loaded.receipts] };
  assert.deepEqual(readSecondJourneyDecisionReceipts(inMemory).map((row) => row.eventId), ["e1"]);
  assert.equal(normalizeSecondJourneyState(inMemory, RV1_SCOPE).state.receipts.some((row) => row.eventId === "e-bad-row"), false);
});

console.log(`\n${pass}/${pass} PASS`);
