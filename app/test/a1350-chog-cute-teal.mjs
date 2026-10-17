// [A-1350 · Owner 10-17 12:5x "우선은 청록만으로 업데이트하자 말투도"] Chog speaks the cute column every day (the down / dream
// columns stay in the table, unused) and with the teal c09 voice only (slow 90 %): short 1 · 6 · long 2 · 4 · 5 · 7 · 8 · first meeting 3.
// The orange s09 files are out of the app.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./helpers/private-base.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e?.message || e).split("\n")[0]}`); } };
const mood = await import(path.join(REPO, "app/src/chog-mood.js"));
const name = (v) => String(v?.file || "").split("/").pop();
// Owner table (FIRST_JOURNEY_PACING_20261015.md:29–41) — original → cute
const CUTE = [["get your piggy", "a piggy for you~"], ["make passkey to hatch the piggy", "passkey, then pop! it hatches"], ["let's send Piggy to work", "off to work, little piggy~"],
  ["your money does the job.", "your money's doing the job ♪"], ["I'll keep the details at home.", "tucked away at home~"], ["tap me to find out", "tap me, tap me~"],
  ["let's try more kinds of jobs!", "ooh, more jobs to try~"], ["closing soon.", "nap time soon~"]];

await check("(a) any day (down · dream · cute days alike): Chog's eight lines = the cute column", () => {
  for (let d = 0; d < 3; d += 1) {
    const day = new Date(2026, 9, 16 + d, 12);
    assert.equal(mood.chogMood(day), "cute", `chogMood on ${day.toDateString()}`);
  }
  for (const [orig, cute] of CUTE) assert.equal(mood.chogMoodLine(orig), cute, orig);
  assert.deepEqual(mood.chogMoodLines(["closing soon.", "work's coming!"]), ["nap time soon~", "work's coming!"]);
});
await check("(b) the voice = teal c09 only: short 1 · 6 · long 2 · 4 · 5 · 7 · 8 · first meeting 3 · a slot's second turn is c09 too", () => {
  const v = mood.createChogVoice();
  const long = Array.from({ length: 10 }, () => name(v.pick("your money does the job.")));
  assert.deepEqual(long, [2, 4, 5, 7, 8, 2, 4, 5, 7, 8].map((n) => `sound_chog_cute90_c09_${n}_1017.wav`));
  const s = mood.createChogVoice();
  assert.deepEqual(Array.from({ length: 4 }, () => name(s.pick("ok"))), [1, 6, 1, 6].map((n) => `sound_chog_cute90_c09_${n}_1017.wav`));
  const f = mood.createChogVoice();
  assert.deepEqual([name(f.pick("a piggy for you~")), name(f.pick("a piggy for you~"))], ["sound_chog_cute90_c09_3_1017.wav", "sound_chog_cute90_c09_3_1017.wav"]);
});
await check("(c) app/public/sound/chog: no s09 file · the 8 c09 files = the design originals byte for byte", () => {
  const dir = path.join(REPO, "app/public/sound/chog");
  assert.deepEqual(readdirSync(dir).filter((f) => /_s09_/.test(f)), []);
  const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
  for (let n = 1; n <= 8; n += 1) {
    const app = path.join(dir, `sound_chog_cute90_c09_${n}_1017.wav`);
    assert.ok(existsSync(app), `c09 ${n} missing`);
    const src = privatePath(`design/chog/say/chatterbox31s/c09/chog_cute_${n}.wav`);
    if (existsSync(src)) assert.equal(sha(app), sha(src), `c09 ${n}`);
  }
});
console.log(`A-1350 chog cute teal: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
