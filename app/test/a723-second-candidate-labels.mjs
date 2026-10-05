// [A-723] Second candidate label restore — candidate rows carry the Job FAMILY title, not the shared "grow" errand
// title. grow_stable and grow_delayed must never collapse into the same visible text again.
//   node app/test/a723-second-candidate-labels.mjs
import assert from "node:assert/strict";

import { exploreCandidateRows } from "../src/mainnet-job-lane.js";
import { JOB_FAMILY, listVisibleJobFamilies } from "../src/second-job-readiness.js";
import { EXPLORE_ERRANDS } from "../src/job-feed.js";
import {
  SECOND_ACTION_TITLES_EN,
  SECOND_FAMILY_TITLES_EN,
  exploreCandidateDestinations,
  secondActionTitle,
  secondJourneyCardMarkup,
} from "../src/second-journey-view.js";

let pass = 0;
let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}

const ALL_ERRANDS = EXPLORE_ERRANDS.map((e) => e.id);
const rows = () => exploreCandidateRows({ decisions: [], families: listVisibleJobFamilies() }).rows;
const destinations = (selectedErrandIds, max = 3) => exploreCandidateDestinations(rows(), { selectedErrandIds, max });
const visibleTitles = (html) => [...html.matchAll(/class="job secondJourney__pick[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
// Asset symbols / protocol names that must not be used to tell candidate rows apart.
const IMPLEMENTATION_WORDS = /\b(aave|curvance|neverland|kintsu|abil|usdc|s?mon|wmon|sMON)\b/i;
const CLAIM_WORDS = /READY|Send this one\?|permission|live|yield|apy|apr|guarantee|earn|profit|\d+\s*(day|hour|min)/i;

check("M1 family → title mapping (Owner correction 2026-10-04, INBOX A-723)", () => {
  assert.equal(SECOND_FAMILY_TITLES_EN[JOB_FAMILY.GROW_STABLE], "a quick trip");
  assert.equal(SECOND_FAMILY_TITLES_EN[JOB_FAMILY.GROW_DELAYED], "stay out a little longer");
  assert.equal(SECOND_FAMILY_TITLES_EN[JOB_FAMILY.OWN_RWA], "try the stock market");
  assert.equal(Object.isFrozen(SECOND_FAMILY_TITLES_EN), true);
});

check("M2 each family baseline renders its own family title (rows → destinations → secondActionTitle)", () => {
  const byId = Object.fromEntries(destinations(ALL_ERRANDS, 9).map((d) => [d.id, d]));
  assert.equal(secondActionTitle(byId["aave-usdc"]), "a quick trip");
  assert.equal(secondActionTitle(byId["kintsu-smon"]), "stay out a little longer");
  assert.equal(secondActionTitle(byId["abil-spot"]), "try the stock market");
  assert.equal(secondActionTitle(byId["protect-revoke-allowance"]), "tidy the wallet", "protect keeps its existing errand title");
});

check("M3 Explore interest wording is unchanged: 'put some money to work' (and the asset-piece interest) stay on the interests step", () => {
  assert.equal(SECOND_ACTION_TITLES_EN.grow, "put some money to work");
  const html = secondJourneyCardMarkup({ step: "interests", errands: EXPLORE_ERRANDS, selectedIds: [] });
  assert.match(html, />put some money to work</);
  assert.match(html, />pick up a piece of an asset</);
  for (const t of Object.values(SECOND_FAMILY_TITLES_EN)) assert.equal(html.includes(`>${t}<`), false, `family title leaked into interests: ${t}`);
});

check("M4 UNIQUENESS: visible candidate titles in one card are unique (grow_stable ≠ grow_delayed)", () => {
  for (const sel of [["grow"], ["grow", "asset-piece"], ["asset-piece", "grow"], ["grow", "clean"], ALL_ERRANDS]) {
    for (const max of [3, 9]) {
      const html = secondJourneyCardMarkup({ step: "candidates", destinations: destinations(sel, max), pickedCandidateId: null });
      const titles = visibleTitles(html);
      assert.ok(titles.length > 0, `rows drawn for ${sel}`);
      assert.equal(titles.every((t) => t.trim() !== ""), true, `no blank title for ${sel}`);
      assert.equal(new Set(titles).size, titles.length, `duplicate visible candidate titles for ${sel}/${max}: ${JSON.stringify(titles)}`);
    }
  }
  const grow = visibleTitles(secondJourneyCardMarkup({ step: "candidates", destinations: destinations(["grow"]) }));
  assert.deepEqual(grow, ["a quick trip", "stay out a little longer"]);
  assert.notEqual(grow[0], grow[1], "grow_stable and grow_delayed collapsed to the same text");
});

check("M5 one visible slot per family: Curvance/Neverland stay behind Aave (no extra rows), Kintsu is its own row", () => {
  const all = destinations(ALL_ERRANDS, 9);
  const ids = all.map((d) => d.id);
  assert.equal(ids.includes("curvance-usdc") || ids.includes("neverland-usdc"), false);
  assert.equal(all.filter((d) => d.family === JOB_FAMILY.GROW_STABLE).length, 1);
  assert.equal(all.filter((d) => d.family === JOB_FAMILY.GROW_DELAYED).length, 1);
  assert.deepEqual([...rows().find((r) => r.family === JOB_FAMILY.GROW_STABLE).alternatives].sort(), ["curvance-usdc", "neverland-usdc"]);
});

check("M6 titles carry no protocol/asset names and no READY/permission/live/yield/time claims", () => {
  for (const t of Object.values(SECOND_FAMILY_TITLES_EN)) {
    assert.equal(IMPLEMENTATION_WORDS.test(t), false, `implementation word in ${t}`);
    assert.equal(CLAIM_WORDS.test(t), false, `claim word in ${t}`);
  }
  const html = secondJourneyCardMarkup({ step: "candidates", destinations: destinations(ALL_ERRANDS, 9) });
  for (const t of visibleTitles(html)) assert.equal(IMPLEMENTATION_WORDS.test(t), false, t);
});

check("M7 action card after a pick uses the same family title as the row (h1.job), for every lane family", () => {
  for (const d of destinations(ALL_ERRANDS, 9)) {
    const rowTitle = visibleTitles(secondJourneyCardMarkup({ step: "candidates", destinations: [d] }))[0];
    const html = secondJourneyCardMarkup({ step: "readiness", chosen: d, preflight: { status: d.derivedStatus, executionPermission: false }, canSend: false, sendReason: "checking…" });
    assert.match(html, new RegExp(`<h1 class="job">${rowTitle}</h1>`), d.id);
  }
});

check("M8 the family title is keyed on laneCandidate only: non-lane (DEV fixture) destinations keep their errand titles", () => {
  assert.equal(secondActionTitle({ errandIds: ["grow"], laneId: "grow", family: JOB_FAMILY.GROW_DELAYED }), "put some money to work");
  assert.equal(secondActionTitle({ laneCandidate: true, family: "constructor", errandIds: ["grow"] }), "put some money to work");
});

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
