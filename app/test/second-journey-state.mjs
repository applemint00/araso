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
} from "../src/second-journey-state.js";

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

console.log(`\n${pass}/${pass} PASS`);
