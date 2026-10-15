// A-1283: after "these two?" / "all of them?" and the read, Chog says why only one goes (or none) as a second line, one at a time;
// then the one-line card opens (none: back to the Explore paper). "Can go" = the read's own JOB_READY rows; Owner lines only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const fn = (name) => {
  const i = MAIN.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `missing ${name}`);
  let d = 0;
  for (let j = MAIN.indexOf("{", i); j < MAIN.length; j += 1) {
    if (MAIN[j] === "{") d += 1;
    else if (MAIN[j] === "}" && --d === 0) return MAIN.slice(i, j + 1);
  }
  throw new Error(name);
};
const linesDecl = MAIN.slice(MAIN.indexOf("const EXPLORE_WHY_LINES"), MAIN.indexOf("});", MAIN.indexOf("const EXPLORE_WHY_LINES")) + 3);

function world({ offered, picks, ready, reading = false, lane = true, picked = null }) {
  const sj = { exploreOfferedIds: offered, selectedIds: picks, laneReading: reading, pickedCandidateId: picked };
  const dests = picks.map((id) => ({ id: `job-${id}`, derivedStatus: ready.includes(id) ? "JOB_READY" : "UNKNOWN" }));
  const api = new Function("secondPickedErrandIds", "computeExploreDisplayErrands", "secondLaneDestinations",
    `let exploreWhyLane = ${lane};\n${linesDecl}\n${fn("exploreChogConfirmLine")}\n${fn("exploreChogWhy")}\nreturn { why: exploreChogWhy };`)(
    (s) => s.selectedIds, () => offered.map((id) => ({ id })), () => dests);
  return api.why(sj);
}

let pass = 0;
const check = (label, f) => { f(); pass += 1; console.log(`PASS  ${label}`); };

check("two picked, both can go → these two? / both can go. sending one for now. · goes with the first", () => {
  const w = world({ offered: ["market", "order", "clean"], picks: ["market", "order"], ready: ["market", "order"] });
  assert.deepEqual([w.kind, w.lines, w.go.id], ["both", ["these two?", "both can go. sending one for now."], "job-market"]);
});
check("all picked, all can go → all of them? / all of them work. let's try one first.", () => {
  const w = world({ offered: ["market", "order", "clean"], picks: ["market", "order", "clean"], ready: ["market", "order", "clean"] });
  assert.deepEqual([w.kind, w.lines], ["all", ["all of them?", "all of them work. let's try one first."]]);
});
check("some can go (one) → only this one can go today. · goes with that one", () => {
  const w = world({ offered: ["market", "claim", "move"], picks: ["market", "claim"], ready: ["market"] });
  assert.deepEqual([w.kind, w.lines, w.go.id], ["one", ["these two?", "only this one can go today."], "job-market"]);
  const all = world({ offered: ["market", "claim", "move"], picks: ["market", "claim", "move"], ready: ["market"] });
  assert.deepEqual([all.kind, all.lines[0]], ["one", "all of them?"]);
});
check("none can go → none of these can go now. something else? · nothing to go with", () => {
  const w = world({ offered: ["claim", "move", "stay"], picks: ["claim", "move"], ready: [] });
  assert.deepEqual([w.kind, w.lines, w.go], ["none", ["these two?", "none of these can go now. something else?"], null]);
});
check("a row the person already picked is the one that goes", () => {
  const w = world({ offered: ["market", "order", "clean"], picks: ["market", "order"], ready: ["market", "order"], picked: "job-order" });
  assert.equal(w.go.id, "job-order");
});
check("no second line while checking…, off the fork lane, for one pick, or a case with no Owner line (2 of 3 picked-all go)", () => {
  assert.equal(world({ offered: ["market", "order", "clean"], picks: ["market", "order"], ready: ["market", "order"], reading: true }), null);
  assert.equal(world({ offered: ["market", "order", "clean"], picks: ["market", "order"], ready: ["market", "order"], lane: false }), null);
  assert.equal(world({ offered: ["market", "order", "clean"], picks: ["market"], ready: ["market"] }), null);
  assert.equal(world({ offered: ["market", "order", "clean"], picks: ["market", "order", "clean"], ready: ["market", "order"] }), null);
});
check("wiring: why line drawn before the A-849 wait lines, on the confirmation's clock; next step after both lines + breath; fork block turns it on", () => {
  const f = fn("chogHomeMarkupForExplore");
  assert.ok(f.indexOf("exploreChogWhy(sj)") < f.indexOf("oh… no jobs to go."));
  assert.match(f, /chogLinesMarkup\("exploreWhy", why\.lines\)/);
  assert.match(f, /chogLineWaits\("exploreWhy", \[confirmLine\]\)/);
  assert.match(fn("scheduleExploreWhyNext"), /startedAt \+ chogLinesMs\(why\.lines\) - Date\.now\(\)/);
  assert.match(fn("scheduleExploreWhyNext"), /if \(again\.kind === "none"\) \{ sj\.step = "interests"; render\(\); return; \}/);
  assert.match(MAIN, /if \(A977_FORK\) \{\n  exploreWhyLane = true;/);
  assert.match(fn("scheduleExploreWhyNext"), /if \(!why \|\| sj\.exploreWhyWent\) return;/, "once per save (Back from the card stays on the picks)");
  assert.match(fn("scheduleExploreWhyNext"), /sj\.exploreWhyWent = true;\n    if \(again\.kind === "none"\)/);
  assert.match(fn("handleExploreSave"), /chogLinesRestart\("exploreWhy"\);[^\n]*\n  sj\.exploreWhyWent = false;/);
  assert.match(fn("chogLineWaits"), /sig\.startsWith\(`\$\{was\.sig\}\\n`\)/);
  assert.equal((MAIN.match(/—/g) || []).length > 0 && /EXPLORE_WHY_LINES[\s\S]{0,400}—/.test(MAIN), false, "no dash in the new lines");
});
console.log(`${pass}/7 PASS`);
