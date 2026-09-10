import assert from "node:assert/strict";
import { hardSafetyFilter, explainRejected, selectThreeJobs, updatePreference, runSelectorTrace, scoreCandidate } from "../src/job-selector.js";

const pool = [
  { id: "shmon-ready", family: "liquid-staking", reason: "liquidity", baseScore: 0.4, permission: "known", exit: "known", testSize: "known", cost: "known", availability: "open" },
  { id: "fee-watch", family: "watch-only", reason: "lowCost", baseScore: 0.35, permission: "known", exit: "known", testSize: "known", cost: "known", availability: "open", feeBps: 35 },
  { id: "reward-expiry", family: "reward", reason: "yield", baseScore: 0.3, permission: "known", exit: "known", testSize: "known", cost: "known", availability: "open", rewardExpiryHours: 36 },
  { id: "new-tokenized", family: "tokenized-asset", reason: "novelty", baseScore: 0.25, permission: "known", exit: "known", testSize: "known", cost: "known", availability: "open" },
  { id: "vault-wait", family: "vault", reason: "clarity", baseScore: 0.2, permission: "known", exit: "known", testSize: "known", cost: "known", availability: "open", waitDays: 2 },
  { id: "borrow-loop", family: "borrow", reason: "yield", baseScore: 0.9, permission: "known", exit: "known", testSize: "known", cost: "known", majorRisk: true, availability: "open" },
  { id: "unknown-exit", family: "vault", reason: "yield", baseScore: 0.8, permission: "known", exit: "unknown", testSize: "known", cost: "known", availability: "open" },
  { id: "source-conflict", family: "reward", reason: "yield", baseScore: 0.8, permission: "known", exit: "known", testSize: "known", cost: "known", sourceConflict: true, availability: "open" },
];

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("hard safety filter removes major risk/unknown/source conflict", () => {
  assert.deepEqual(explainRejected(pool).map((r) => r.id), ["borrow-loop", "unknown-exit", "source-conflict"]);
  assert.equal(hardSafetyFilter(pool).length, 5);
});

check("selector returns deterministic three with diverse reasons", () => {
  const selected = selectThreeJobs(pool, {});
  assert.deepEqual(selected.map((j) => j.id), ["shmon-ready", "fee-watch", "reward-expiry"]);
  assert.equal(new Set(selected.map((j) => j.reason)).size, 3);
});

check("selector is not APY/baseScore top three", () => {
  const selected = selectThreeJobs(pool, { novelty: 0.4, explorationWidth: 0.1 });
  assert.equal(selected.length, 3);
  assert.ok(selected.some((j) => j.id === "new-tokenized"));
  assert.ok(!selected.some((j) => j.id === "borrow-loop"));
});

check("one selection creates bounded hint without fixed label", () => {
  const [job] = selectThreeJobs(pool, {});
  const update = updatePreference({}, { kind: "select", selectedJobs: [job], offeredJobs: selectThreeJobs(pool, {}), offeredCount: 3, decisionTimeMs: 900, baselineDecisionTimeMs: 900, setIndex: 1 });
  assert.equal(update.signal, "one");
  assert.equal(update.fixedPersonalityLabel, null);
  assert.ok(update.preference.liquidity > 0);
  assert.equal(update.timeSignal.used, false);
  assert.equal(update.delta.confidence, 0);
});

check("all/none/unsure signals remain hints", () => {
  const offered = selectThreeJobs(pool, {});
  const all = updatePreference({}, { kind: "select", selectedJobs: offered, offeredJobs: offered, offeredCount: 3, decisionTimeMs: 500, baselineDecisionTimeMs: 1000, setIndex: 2 });
  const none = updatePreference({}, { kind: "select", selectedJobs: [], offeredJobs: offered, offeredCount: 3, decisionTimeMs: 500, baselineDecisionTimeMs: 1000, setIndex: 2 });
  const unsure = updatePreference({}, { kind: "unsure", selectedJobs: [], offeredJobs: offered, offeredCount: 3, decisionTimeMs: 1500, baselineDecisionTimeMs: 1000, setIndex: 2 });
  assert.equal(all.signal, "all");
  assert.ok(all.preference.novelty > 0);
  assert.ok(all.preference.explorationWidth > 0);
  assert.equal(none.signal, "none");
  assert.ok(none.preference.clarity > 0);
  assert.ok(none.preference.reasonDislike.liquidity > 0);
  assert.equal(unsure.signal, "unsure");
  assert.equal(all.fixedPersonalityLabel, null);
  assert.equal(none.fixedPersonalityLabel, null);
});

check("nah signal remains separate from preference dislike", () => {
  const offered = selectThreeJobs(pool, {});
  const update = updatePreference({}, { kind: "rule_nah", selectedJobs: [], offeredJobs: offered, offeredCount: 3, decisionTimeMs: 500, baselineDecisionTimeMs: 1000, setIndex: 2 });
  assert.equal(update.signalSeparation, "rule/safety rejection; not a taste dislike");
  assert.deepEqual(update.preference.reasonDislike, {});
});

check("no meaningful change trace stays stable", () => {
  const trace = runSelectorTrace(pool, [
    { pick: ["shmon-ready"], decisionTimeMs: 1000 },
    { pick: ["shmon-ready"], decisionTimeMs: 700 },
    { pick: ["shmon-ready"], decisionTimeMs: 650 },
    { pick: ["shmon-ready"], decisionTimeMs: 630 },
    { pick: ["shmon-ready"], decisionTimeMs: 620 },
  ], {}, { mode: "stable" });
  const first = new Set(trace[0].selected.map((job) => job.id));
  assert.equal(trace.every((row) => row.selected.filter((job) => first.has(job.id)).length >= 2), true);
  assert.equal(trace[0].timeSignal.used, false);
  assert.ok(trace[4].preferenceAfter.confidence > 0);
});

check("meaningful user/state change responds within 2-3 sets and has learned_me_event", () => {
  const trace = runSelectorTrace(pool, [
    { pick: ["shmon-ready"], decisionTimeMs: 1000 },
    { pick: ["new-tokenized"], decisionTimeMs: 650 },
    { pick: ["new-tokenized"], decisionTimeMs: 600 },
    { kind: "unsure", pick: [], decisionTimeMs: 1600 },
    { pick: ["vault-wait"], decisionTimeMs: 750 },
  ]);
  const sets = trace.map((row) => row.selected.map((job) => job.id));
  assert.ok(sets[2].includes("new-tokenized") || sets[3].includes("new-tokenized"));
  assert.ok(trace.some((row) => row.learned_me_event));
  assert.ok(trace.some((row) => row.stateVariation.some((v) => v.meaningfulChange)));
  console.log("TRACE_CHANGE", JSON.stringify(trace.map((row) => ({ set: row.set, selected: row.selected.map((j) => j.id), signal: row.mockUserSelection.kind, timeUsed: row.timeSignal.used, learned: row.learned_me_event, after: row.preferenceAfter })), null, 2));
});

check("hard safety cannot be bypassed by preference or time", () => {
  const selected = selectThreeJobs(pool, { yield: 0.6, confidence: 0.35, explorationWidth: 0.25 });
  assert.equal(selected.some((j) => ["borrow-loop", "unknown-exit", "source-conflict"].includes(j.id)), false);
});

check("repeated none/unsure avoids forcing same disliked candidate forever", () => {
  let preference = {};
  let offered = selectThreeJobs(pool, preference);
  preference = updatePreference(preference, { kind: "select", selectedJobs: [], offeredJobs: offered, offeredCount: 3, decisionTimeMs: 500, baselineDecisionTimeMs: 1000, setIndex: 2 }).preference;
  offered = selectThreeJobs(pool, preference);
  preference = updatePreference(preference, { kind: "unsure", selectedJobs: [], offeredJobs: offered, offeredCount: 3, decisionTimeMs: 1800, baselineDecisionTimeMs: 1000, setIndex: 3 }).preference;
  const next = selectThreeJobs(pool, preference);
  assert.ok(Object.values(preference.reasonDislike).some((v) => v > 0));
  assert.ok(next.some((j) => j.id === "new-tokenized" || j.id === "vault-wait"));
});

check("multi/all slightly widens exploration without fixed profile", () => {
  const offered = selectThreeJobs(pool, {});
  const updated = updatePreference({}, { kind: "select", selectedJobs: offered, offeredJobs: offered, offeredCount: 3, decisionTimeMs: 500, baselineDecisionTimeMs: 1000, setIndex: 2 });
  assert.ok(updated.preference.explorationWidth > 0);
  assert.equal(updated.fixedPersonalityLabel, null);
  assert.ok(scoreCandidate(pool.find((j) => j.id === "new-tokenized"), updated.preference) > scoreCandidate(pool.find((j) => j.id === "new-tokenized"), {}));
});

console.log(`\n${pass}/${pass} PASS`);
