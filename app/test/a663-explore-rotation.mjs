// A-663 Explore "more options" rotation — node part (no network, no browser).
//   node app/test/a663-explore-rotation.mjs
//
// Covers the A-663 OWNER UX CORRECTION / OWNER DESIGN-COPY RESOLUTION (2026-10-01): at most
// 3 Explore-visible options per set, deterministic round traversal across the 8 canonical
// job-feed.js errands, reuse of the existing AskCard "one more" copy, and the learning-
// semantics separation (a rotation request is not a dislike signal). Functions are extracted
// from the live main.js by source-cut (same convention as j2-7-integration-reopen.mjs /
// a653-mainnet-lane.mjs fnBody) so this test always runs against the real implementation,
// never a reimplementation of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildVisibleLaneChoices } from "../src/job-feed.js";
import { updatePreference } from "../src/job-selector.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`);
    fail += 1;
  }
}

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

const factory = new Function(
  "buildVisibleLaneChoices",
  `
  const MAX_EXPLORE_VISIBLE = 3;
  ${fnBody("exploreRoundCount")}
  ${fnBody("inferSeedStage")}
  ${fnBody("computeExploreDisplayErrands")}
  ${fnBody("exploreEventId")}
  return { exploreRoundCount, inferSeedStage, computeExploreDisplayErrands, exploreEventId };
  `,
);
const { exploreRoundCount, inferSeedStage, computeExploreDisplayErrands, exploreEventId } = factory(buildVisibleLaneChoices);

const ALL = buildVisibleLaneChoices();

check("MAX_EXPLORE_VISIBLE is 3 in the live source (A-663 Owner: 5 -> 3)", () => {
  assert.match(MAIN, /const MAX_EXPLORE_VISIBLE = 3;/);
  assert.equal(/const MAX_EXPLORE_VISIBLE = 5;/.test(MAIN), false, "the old 5-cap literal must not survive next to the new cursor");
});

check("8 canonical errands, 3 rounds (ceil(8/3)), last round naturally short (2) — never fabricated to 3", () => {
  // [A-936 RE-PIN] the LP errand is the 9th (after grow) → rounds 3/3/3. pre-A-936 baseline: 8 errands, rounds 3/3/2
  assert.equal(ALL.length, 9);
  assert.equal(exploreRoundCount(), 3);
  assert.equal(computeExploreDisplayErrands({ seedStage: 0 }).length, 3);
  assert.equal(computeExploreDisplayErrands({ seedStage: 1 }).length, 3);
  assert.equal(computeExploreDisplayErrands({ seedStage: 2 }).length, 3);
});

check("<=3 visible at once for every round, never >3", () => {
  for (let r = 0; r < exploreRoundCount(); r += 1) {
    assert.ok(computeExploreDisplayErrands({ seedStage: r }).length <= 3);
  }
});

check("no duplicate within one shown set, and no duplicate across the full traversal (8 unique ids seen)", () => {
  const seen = new Set();
  for (let r = 0; r < exploreRoundCount(); r += 1) {
    const ids = computeExploreDisplayErrands({ seedStage: r }).map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `round ${r} has an internal duplicate`);
    for (const id of ids) {
      assert.ok(!seen.has(id), `id ${id} reappeared in round ${r}`);
      seen.add(id);
    }
  }
  assert.equal(seen.size, 9, "all 9 canonical errands are reachable with no duplicates across rounds"); // [A-936 RE-PIN] pre-A-936 baseline: 8
});

check("deterministic: same round always returns the same set (no Math.random, stable across repeated calls)", () => {
  for (let r = 0; r < exploreRoundCount(); r += 1) {
    const a = computeExploreDisplayErrands({ seedStage: r }).map((e) => e.id);
    const b = computeExploreDisplayErrands({ seedStage: r }).map((e) => e.id);
    assert.deepEqual(a, b);
  }
  assert.equal(/Math\.random/.test(fnBody("computeExploreDisplayErrands")), false);
  assert.equal(/Math\.random/.test(fnBody("inferSeedStage")), false);
});

check("render/resize/HISTORY open-close/unrelated state updates cannot change the set: computeExploreDisplayErrands is a pure function of {seedStage, selectedIds} only", () => {
  const body = fnBody("computeExploreDisplayErrands");
  // no access to Date.now()/window/document/render-only globals inside the selection logic
  assert.equal(/Date\.now\(\)|document\.|window\./.test(body), false);
  const once = computeExploreDisplayErrands({ seedStage: 1, unrelatedField: "anything", anotherOne: 123 }).map((e) => e.id);
  const again = computeExploreDisplayErrands({ seedStage: 1 }).map((e) => e.id);
  assert.deepEqual(once, again, "fields unrelated to seedStage/selectedIds never change the displayed set");
});

check("inferSeedStage: round-by-round traversal via explore-none- prefixed processedEventIds, exhausted -> done (3 rounds)", () => {
  assert.equal(inferSeedStage(null), 0);
  assert.equal(inferSeedStage({ interests: [], processedEventIds: [] }), 0);
  assert.equal(inferSeedStage({ interests: [], processedEventIds: ["explore-none-0-market,order,clean"] }), 1);
  assert.equal(inferSeedStage({ interests: [], processedEventIds: ["explore-none-0-a", "explore-none-1-b"] }), 2);
  assert.equal(inferSeedStage({ interests: [], processedEventIds: ["explore-none-0-a", "explore-none-1-b", "explore-none-2-c"] }), "done");
  assert.equal(inferSeedStage({ interests: [{ errandId: "market" }], processedEventIds: [] }), "done");
});

check("[state/receipt review fix 2] inferSeedStage ignores non-Explore eventIds in the shared processedEventIds array (A-579 decision receipts / A-663 plumbing-proof receipts never advance the Explore round)", () => {
  // Only non-"explore-none-" ids present (e.g. an A-579 decision receipt id, or an A-663
  // plumbing-proof receipt's "second-plumbing-<txhash>" id, both of which share the SAME
  // processedEventIds array via recordSecondJourneyReceipt -> markProcessed) must not move the
  // round at all.
  assert.equal(inferSeedStage({ interests: [], processedEventIds: ["answer:dest-1:2026-10-01T00:00:00Z:1"] }), 0);
  assert.equal(inferSeedStage({ interests: [], processedEventIds: [`second-plumbing-0x${"a".repeat(64)}`] }), 0);
  assert.equal(inferSeedStage({ interests: [], processedEventIds: [`second-plumbing-0x${"a".repeat(64)}`, `second-plumbing-0x${"b".repeat(64)}`, "answer:x:y:1"] }), 0);
  // a real round-advance mixed in with unrelated receipt eventIds still counts correctly —
  // only the "explore-none-" ones move the round.
  const mixed = ["second-plumbing-0x" + "c".repeat(64), "explore-none-0-market,order,clean", "answer:dest-2:t:2"];
  assert.equal(inferSeedStage({ interests: [], processedEventIds: mixed }), 1);
});

check("reload/reopen within the same round restores the same offered set (no persisted-field cliff — same inference path as before, now 3-way)", () => {
  // The same domainState snapshot (interests/processedEventIds unchanged by a reload) must
  // infer the same round and therefore the same displayed set on every call.
  const domainState = { interests: [], processedEventIds: ["explore-none-0-market,order,clean"] };
  const round = inferSeedStage(domainState);
  const first = computeExploreDisplayErrands({ seedStage: round }).map((e) => e.id);
  const second = computeExploreDisplayErrands({ seedStage: inferSeedStage(domainState) }).map((e) => e.id);
  assert.deepEqual(first, second);
});

check("a corrupted/out-of-range round index clamps to the last round instead of returning an empty list", () => {
  const last = computeExploreDisplayErrands({ seedStage: 999 }).map((e) => e.id);
  assert.deepEqual(last, computeExploreDisplayErrands({ seedStage: 2 }).map((e) => e.id));
  const clampedLow = computeExploreDisplayErrands({ seedStage: -5 }).map((e) => e.id);
  assert.deepEqual(clampedLow, computeExploreDisplayErrands({ seedStage: 0 }).map((e) => e.id));
});

check("edit/repeat-visit ('done') keeps already-selected ids visible first, fills the rest in canonical order", () => {
  const shown = computeExploreDisplayErrands({ seedStage: "done", selectedIds: ["move"] }).map((e) => e.id);
  assert.equal(shown[0], "move");
  assert.equal(shown.length, 3);
});

check("exploreEventId: round 0 is distinct from the null/undefined placeholder; each round's id is stable and unique per id-set", () => {
  const ids = ["market", "order", "clean"];
  const e0 = exploreEventId("none", 0, ids);
  const e1 = exploreEventId("none", 1, ids);
  const eNull = exploreEventId("none", null, ids);
  assert.notEqual(e0, eNull, "round 0 (a real round) must not collide with the no-seedStage-yet placeholder");
  assert.notEqual(e0, e1);
  assert.equal(exploreEventId("none", 0, ids), exploreEventId("none", 0, [...ids].reverse()), "order-independent (ids are sorted)");
});

check("handleExploreNone source: reuses the existing AskCard copy exactly — no new/invented strings", () => {
  const body = fnBody("handleExploreNone");
  assert.match(body, /chogLine: isFirstRound \? "…none\?" : "not these\?"/);
  assert.match(body, /paperLine: "okay\. one more\."/);
  assert.match(body, /chogLine: "okay\."[\s\S]*paperLine: "maybe later\."/);
  assert.match(body, /chogLine: "not these\?", paperLine: "for now\."/);
  assert.match(body, /chogLine: "", paperLine: "maybe later\."/);
  // no literal shuffle control / new interaction family
  assert.equal(/shuffle/i.test(body), false);
});

check("round advance vs terminal: round < numRounds-1 advances and keeps step 'interests'; last round goes to the existing note-queue terminal (Home, no list)", () => {
  const body = fnBody("handleExploreNone");
  assert.match(body, /if \(sj\.seedStage < numRounds - 1\) \{/);
  assert.match(body, /sj\.seedStage \+= 1;/);
  assert.match(body, /sj\.step = "interests";/);
  assert.match(body, /beginExploreNoteSequence\(\[\{ chogLine: "okay\.", paperLine: "maybe later\." \}\]\);/);
});

check("LEARNING SEMANTICS: a rotation request ('none' on a numbered round) sends a neutral signal to updatePreference, not 'none' — zero reasonDislike / confidence / explorationWidth change", () => {
  const body = fnBody("handleExploreNone");
  assert.match(body, /kind: "explore_rotation"/, "handleExploreNone must not pass kind:\"none\" to updatePreference");
  const offered = ALL.slice(0, 3);
  const base = { reasonDislike: {}, novelty: 0, clarity: 0, liquidity: 0, lowCost: 0, yield: 0, confidence: 0, explorationWidth: 0 };
  const rotated = updatePreference(base, { kind: "explore_rotation", selectedJobs: [], offeredJobs: offered, offeredCount: offered.length });
  assert.deepEqual(rotated.preference.reasonDislike, {}, "no reason gets a dislike bump from a rotation request");
  for (const key of ["novelty", "clarity", "liquidity", "lowCost", "yield", "confidence", "explorationWidth"]) {
    assert.equal(rotated.preference[key], 0, `${key} must not move from a rotation request alone`);
  }
  // contrast: the OLD "none" kind (still used/tested directly in job-selector.js's own suite)
  // does bump dislike — proving explore_rotation is a genuinely different, neutral signal and
  // not just "none" renamed into job-selector.js itself (job-selector.js is unmodified).
  const oldNone = updatePreference(base, { kind: "none", selectedJobs: [], offeredJobs: offered, offeredCount: offered.length });
  assert.ok(Object.values(oldNone.preference.reasonDislike).some((v) => v > 0), "sanity: the pre-existing 'none' kind still carries dislike in job-selector.js, unmodified");
});

check("applyExploreSelection's own selection.kind stays \"none\" (storage/processedEventIds contract unchanged) even though the preference signal changed", () => {
  const body = fnBody("handleExploreNone");
  assert.match(body, /const selection = \{ kind: "none", errandIds: \[\], errands: \[\] \};/);
  assert.match(body, /applyExploreSelection\(domainState, selection, preferenceUpdate,/);
});

check("'more options' alone never touches permission/READY/agreedRule/amount/tx state (source contract: handleExploreNone never assigns those fields)", () => {
  const body = fnBody("handleExploreNone");
  assert.equal(/\bsj\.permission\s*=|\bsj\.amount\s*=|\bsj\.outcome\s*=|executionPermission|agreedRule/.test(body), false, body);
});

check("safety/eligibility-filtered candidates never reappear through rotation: buildVisibleLaneChoices() is the only source computeExploreDisplayErrands reads, and it is job-feed.js's own fixed list (not re-derived per round)", () => {
  const body = fnBody("computeExploreDisplayErrands");
  assert.match(body, /const all = buildVisibleLaneChoices\(\);/);
  // every round is a slice of the SAME `all` array — nothing can inject extra/filtered-back items
  assert.equal(/EXPLORE_ERRANDS|require\(|import\(/.test(body), false);
});

check("legacy draft migration: old \"A\"/\"B\" seedStage strings map to round 0/1, numeric 0 survives (falsy-safe)", () => {
  const body = fnBody("applySecondDraftIfAny");
  assert.match(body, /draft\.seedStage === "A" \? 0 : draft\.seedStage === "B" \? 1 : draft\.seedStage/);
  assert.match(body, /sj\.seedStage = draft\.seedStage != null \? legacySeedStage : sj\.seedStage;/, "must use != null, not ||, so round 0 is not dropped");
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
