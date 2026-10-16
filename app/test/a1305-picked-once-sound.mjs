// [A-1305 ⑤⑦] ⑤ (A-1303) with the pick list up the small name line above it is not drawn (a name shows once); the 0-row "wait." keeps it.
// ⑦ the Home paper unfold plays at half its old level: MASTER_GAIN × unfold trim ≤ 0.35 (was 0.5 × 1.4 = 0.7); other sounds unchanged.
import assert from "node:assert/strict";
import { secondJourneyCardMarkup, exploreCandidateDestinations } from "../src/second-journey-view.js";
import { exploreCandidateRows } from "../src/mainnet-job-lane.js";
import { listVisibleJobFamilies } from "../src/second-job-readiness.js";
import { MASTER_GAIN, SOUND_MOMENTS } from "../src/sound.js";

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass += 1; console.log("PASS", name); } catch (e) { fail += 1; console.log("FAIL", name, "—", e.message.split("\n")[0]); } };
const LABELS = { grow: "put some money to work", "asset-piece": "pick up a piece of an asset", market: "go to the market", order: "leave an order", clean: "tidy the wallet" };
const rowsAll = exploreCandidateRows({ decisions: [], families: listVisibleJobFamilies() }).rows;
const dest = (ids) => exploreCandidateDestinations(rowsAll, { selectedErrandIds: ids });

for (const ids of [["grow"], ["asset-piece", "grow"]]) {
  check(`⑤ ${dest(ids).length} rows with the list up: no name line above the list`, () => {
    const d = dest(ids);
    assert.ok(d.length >= 1, `rows for ${ids}`);
    const html = secondJourneyCardMarkup({ step: "candidates", destinations: d, selectedIds: ids, errandLabelById: LABELS });
    assert.equal(/id="secondPickedLine"/.test(html), false, `name line drawn with ${d.length} rows: ${(html.match(/id="secondPickedLine">[^<]*/) || [""])[0]}`);
  });
}
check("⑤ 0 rows (wait.): the name line stays", () => {
  const html = secondJourneyCardMarkup({ step: "candidates", destinations: [], selectedIds: ["market"], errandLabelById: LABELS });
  assert.match(html, /secondJourney__exploreText">wait\.</);
  assert.match(html, /id="secondPickedLine">go to the market</);
});
check("⑦ unfold effective gain ≤ 0.35 (half of 0.7); toss/bell/chog trims unchanged", () => {
  const eff = MASTER_GAIN * SOUND_MOMENTS.unfold.trims[0];
  assert.ok(eff <= 0.35 + 1e-9, `unfold effective gain ${eff}`);
  assert.equal(MASTER_GAIN, 0.5);
  assert.deepEqual([SOUND_MOMENTS.toss.trims, SOUND_MOMENTS.bell.trims, SOUND_MOMENTS.chog.trims], [[1.23], [0.53], [0.52, 0.63]]);
});
console.log(`A1305 picked-once/sound ${pass} PASS / ${fail} FAIL / 0 SKIP`);
if (fail) process.exit(1);
