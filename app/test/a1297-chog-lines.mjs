// A-1297 (Owner 03:0x–03:4x; replaces A-1283's automatic narrowing): Chog's Journey 2 lines and their time.
// Journey 2 starts on Home with two lines one at a time · picking: "let me see which jobs can go." → only the Jobs that can go, one line
// for how many · the first receipt's line is read (≥ 3 s) · the Journey 2 receipt ends with "done!".
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
const decl = (name) => { const i = MAIN.indexOf(`const ${name}`); assert.ok(i >= 0, name); return MAIN.slice(i, MAIN.indexOf(";\n", i) + 1); };
const chogSpeakMs = (t) => Math.round(String(t).length * 60 + 1200);

function pick({ picks = ["a", "b"], ready = 2, reading = false, savedAgoMs = 10_000, lane = true, scene = "explore", step = "candidates", picked = null }) {
  const sj = { selectedIds: picks, laneReading: reading, whySavedAt: Date.now() - savedAgoMs, step, pickedCandidateId: picked };
  const dests = Array.from({ length: ready }, (_, i) => ({ id: `job-${i}`, derivedStatus: "JOB_READY" }));
  return new Function("state", "secondPickedErrandIds", "secondLaneDestinations", "chogSpeakMs",
    `let exploreWhyLane = ${lane};\n${decl("EXPLORE_CHECK_LINE")}\n${MAIN.slice(MAIN.indexOf("const EXPLORE_PICK_LINES"), MAIN.indexOf("});", MAIN.indexOf("const EXPLORE_PICK_LINES")) + 3)}\n${fn("explorePickState")}\nreturn explorePickState;`)(
    { scene }, (s) => s.selectedIds, () => dests, chogSpeakMs)(sj);
}

let pass = 0;
const check = (label, f) => { f(); pass += 1; console.log(`PASS  ${label}`); };

check("Journey 2 starts on Home: two lines (one at a time via a891ChogSay); the Explore paper is not given them again", () => {
  assert.match(MAIN, /const A891_SECOND_INTRO_LINES = \["let's try more kinds of jobs!", "work's coming!"\];/);
  const tap = fn("a891HomeChogTap");
  assert.equal((tap.match(/a891ChogSay\(/g) || []).length, 1, "said once, on Home");
  assert.doesNotMatch(tap, /data-scene="explore"\] #chogHome/);
});
check("picking: checking while the read runs or the check line is still being read; then one line for how many can go", () => {
  assert.equal(pick({ reading: true }).line, "let me see which jobs can go.");
  assert.equal(pick({ savedAgoMs: 1000 }).kind, "checking", "the line is read first (2.94 s)");
  assert.equal(pick({ ready: 2 }).line, "two can go. pick one?");
  assert.equal(pick({ picks: ["a", "b", "c"], ready: 3 }).line, "pick one of these.");
  assert.equal(pick({ ready: 1 }).line, "only this one can go. go?");
  assert.equal(pick({ ready: 0 }).line, "none of these can go now. something else?");
  assert.deepEqual(pick({ ready: 0 }).lines, ["none of these can go now.", "something else?"], "same words, two stacked lines (fits 390)");
  assert.equal(pick({ ready: 2, picked: "job-1" }).go.id, "job-1", "a row the person picked is the one that goes");
});
check("picking only where Jobs run, on the candidates step, with picks", () => {
  assert.equal(pick({ lane: false }), null);
  assert.equal(pick({ step: "readiness" }), null);
  assert.equal(pick({ picks: [] }), null);
});
check("old lines are not shown where Jobs run (these two? / all of them? / the A-1283 reasons)", () => {
  assert.match(fn("chogHomeMarkupForExplore"), /const confirmLine = !exploreWhyLane && /);
  for (const old of ["both can go. sending one for now.", "all of them work. let's try one first.", "only this one can go today."]) assert.equal(MAIN.includes(old), false, old);
});
check("one / none move on by themselves once the line is read (+ a breath), once per save; two / many wait for the person", () => {
  const f = fn("scheduleExploreWhyNext");
  assert.match(f, /const hideList = pick\.kind !== "two" && pick\.kind !== "many";/);
  assert.match(f, /sj\.whyResultAt \+ chogLinesMs\(pick\.lines\) - Date\.now\(\)/);
  assert.match(f, /if \(again\.kind === "none"\) \{ sj\.step = "interests"; render\(\); return; \}/);
  assert.match(f, /chogHelpRemember\("exploreChogSay", pick\.lines\)/, "the ? can say it again");
  assert.match(fn("handleExploreSave"), /sj\.whySavedAt = Date\.now\(\);[\s\S]*sj\.exploreWhyWent = false;/);
});
check("receipts: the first line is read before Home (max 3 s, read time); the Journey 2 receipt ends with done!", () => {
  assert.match(MAIN, /const A891_FILED_LINE = "I'll keep the details at home\.";/);
  // [A-1326 RE-PIN · FIRST_JOURNEY_PACING_20261015.md:33–41 day wording] pre-A-1326: chogSpeakMs(A891_FILED_LINE) — now the day's line is read
  assert.match(MAIN, /const A891_FILED_LINE_READ_MS = Math\.max\(3000, chogSpeakMs\(chogMoodLine\(A891_FILED_LINE\)\)\);/);
  assert.match(fn("a891AfterFiling"), /teach \? A891_FILED_LINE_READ_MS : A891_FILED_LINE_HOLD_MS/);
  assert.match(MAIN, /const A1297_SECOND_DONE_LINE = "done!";/);
  assert.match(MAIN, /a891ChogSay\(document\.querySelector\("#returnChogHop #chogHome"\), "secondDoneLine", \[A1297_SECOND_DONE_LINE\]\)/);
});
console.log(`${pass}/6 PASS`);
