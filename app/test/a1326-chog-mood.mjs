// [A-1326 · Owner 18:4x–19:0x · FIRST_JOURNEY_PACING_20261015.md:29–41] Chog's day mood: the device's date number ÷ 3 → down / dream /
// cute; the eight table lines read that day's wording (others stay as they are); Chog's voice follows the mood (cute or dream files ·
// down = the dream voice at 0.8 · long file when the line takes > 2 s · the first-meeting line gets the "both" file); the Home paper
// opens with glass-thin minor F; every letter on the Send card sits 1 px heavier underneath (gold → #8a6a00, ink → its own colour).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log("PASS", n); } catch (e) { fail += 1; console.log("FAIL", n, "—", String(e.message).split("\n")[0]); } };
const TABLE = [
  ["get your piggy", "your piggy's here…", "a piggy, floating in…", "a piggy for you~"],
  ["make passkey to hatch the piggy", "make a passkey… it'll hatch", "a passkey… and it wakes", "passkey, then pop! it hatches"],
  ["let's send Piggy to work", "let's send piggy out… slowly", "piggy floats off to work…", "off to work, little piggy~"],
  ["your money does the job.", "your money does the work… mm", "your money hums at work…", "your money's doing the job ♪"],
  ["I'll keep the details at home.", "i'll keep it all at home…", "i'll keep it safe at home…", "tucked away at home~"],
  ["tap me to find out", "tap me… if you wanna know", "tap me… a little secret", "tap me, tap me~"],
  ["let's try more kinds of jobs!", "more jobs, maybe…", "more jobs out there… maybe", "ooh, more jobs to try~"],
  ["closing soon.", "getting sleepy…", "fading out soon…", "nap time soon~"],
];
let mood;
try { mood = await import("../src/chog-mood.js"); } catch (e) { mood = null; }
const days = [new Date(2026, 9, 16, 9), new Date(2026, 9, 17, 9), new Date(2026, 9, 18, 9)];
// [A-1350 RE-PIN · Owner 12:5x "우선은 … 말투도"] the day's mood stays as chogDayMood (unused for now); Chog speaks cute every day (a1350). pre-A-1350: chogMood(d)
await check("① day mood table (kept, unused for now): three days in a row → three moods, the device's local date (same all day)", () => {
  assert.ok(mood, "chog-mood.js missing");
  const m = days.map((d) => mood.chogDayMood(d));
  assert.deepEqual([...new Set(m)].sort(), ["cute", "down", "dream"]);
  assert.equal(mood.chogDayMood(new Date(2026, 9, 16, 0, 1)), mood.chogDayMood(new Date(2026, 9, 16, 23, 59)));
  const n = Math.floor(Date.UTC(2026, 9, 16) / 864e5) % 3; assert.equal(mood.chogDayMood(days[0]), ["down", "dream", "cute"][n]);
});
await check("① eight lines × three moods = the table word for word · lines outside the table unchanged", () => {
  assert.ok(mood, "chog-mood.js missing");
  for (const [orig, down, dream, cute] of TABLE) for (const [m, want] of [["down", down], ["dream", dream], ["cute", cute]]) assert.equal(mood.chogMoodLine(orig, m), want, `${orig} / ${m}`);
  assert.equal(mood.chogMoodLine("work's coming!", "cute"), "work's coming!");
  assert.equal(mood.chogMoodLine("if you want to explore more, tap to wake me up.", "dream"), "if you want to explore more, tap to wake me up.");
  assert.deepEqual(mood.chogMoodLines(["closing soon.", "x"], "down"), ["getting sleepy…", "x"]);
});
// [A-1349 RE-PIN · Owner 10-17 12:2x "청록 90 주황도 킵" · PACING:118 12:2x newest-wins] one cute voice every day (slow 90 %, teal c09 / orange s09);
// the 10-16 cute/dream files and the down × 0.8 rule are retired. The full voice rules live in a1349-chog-voice.mjs. pre-A-1349: cute/dream 1016 files.
await check("② voice: every mood day = the cute 90 % voice · long when the line takes > 2 s · first meeting = slot 3", () => {
  assert.ok(mood, "chog-mood.js missing");
  const v = mood.createChogVoice();
  const long = "i'll keep it safe at home…"; assert.ok(long.length * 60 + 1200 > 2000);
  for (const m of ["down", "dream", "cute"]) assert.match(mood.createChogVoice().pick(long, m).file, /sound_chog_cute90_c09_2_1017\.wav$/, m);
  assert.match(v.pick("ok", "dream").file, /sound_chog_cute90_c09_1_1017\.wav$/);
  assert.match(v.pick(mood.chogMoodLine("get your piggy", "down"), "down").file, /sound_chog_cute90_c09_3_1017\.wav$/);
});
await check("② sound files are in the app (Home paper glass F)", () => {
  readFileSync(new URL("../public/sound/sound_home_glassthin_minor_1016_f.wav", import.meta.url));
});
await check("③ the Home paper opens with glass-thin minor F (UNFOLD_TRIM matched by ear-level RMS)", async () => {
  const s = await import("../src/sound.js");
  assert.match(s.SOUND_MOMENTS.unfold.files[0], /sound_home_glassthin_minor_1016_f\.wav$/);
});
await check("④ every letter on the Send card: 1 px heavier underneath (ink = its own colour · gold = #8a6a00) · stroke unchanged", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /\.sendCard,\s*\.sendCard \*\s*\{[^}]*text-shadow:\s*0 1px 0 currentColor/);
  assert.match(css, /\.sendCard__explain,\s*\.trialStamp--send\s*\{[^}]*text-shadow:\s*0 1px 0 #8a6a00/);
  assert.equal(/1\.5px 0 #8a6a00/.test(css), false, "1.5 px is too much (Owner 19:0x)");
});
// [A-1433 A1] the first Send cue's three lines are said word for word, not through the table (pre-A-1433: chogMoodLines(FIRST_SEND_CUE_PARTS…))
await check("① the screens read the table: entry · filed · second intro · tap me to find out · closing soon · (first Send cue: its own three lines)", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /chogMoodLines\(FIRST_SEND_CUE_PARTS/);
  for (const re of [/chogMoodLines\(ENTRY_CHOG_LINES\)/, /chogMoodLine\(A891_FILED_LINE\)/, /chogMoodLines\(A891_SECOND_INTRO_LINES\)/, /startTapCue\?\.\(chogMoodLine\("tap me to find out"\)\)/, /chogMoodLines\(APP_CLOSING_SOON_LINES\)/, /playSound\("chog", /])
    assert.match(main, re);
});
console.log(`A1326 chog mood ${pass} PASS / ${fail} FAIL / 0 SKIP`);
if (fail) process.exit(1);
