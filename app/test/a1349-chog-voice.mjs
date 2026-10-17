// [A-1349 · Owner 10-17 12:2x "청록 90 주황도 킵" · FIRST_JOURNEY_PACING_20261015.md:117–118 + 07:0x · 07:1x · 12:2x]
// Chog's voice = cute (everyday) at the slow 90 % pace, teal set c09 = A and orange set s09 = B, the same slot taking turns.
// Picking: a line read in <= 2 s → a short one (1 · 6) · longer → 2 · 4 · 5 · 7 · 8 in turn · 3 (6.6 s) = the first-meeting line only.
// Every mood day speaks with this one voice. C: when the voice runs longer than the bubble, the next line waits for the voice to end.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./helpers/private-base.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e?.message || e).split("\n")[0]}`); } };
const mood = await import(path.join(REPO, "app/src/chog-mood.js"));
const name = (v) => String(v?.file || "").split("/").pop();
const SET = (s, n) => `sound_chog_cute90_${s}_${n}_1017.wav`;
const ALL = new Set(["c09", "s09"].flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => SET(s, n))));
const LINES = ["ok", "tap me to find out", "your money does the job.", "i'll keep it safe at home…", "when there's a new job for piggy,", "the jar's sparkling. wanna tap it?", "got it", "a piggy for you~"];

await check("(a) any day, any line: Chog's voice is one of the c09 / s09 files (slow 90 %, cute)", () => {
  for (const m of ["down", "dream", "cute"]) {
    const v = mood.createChogVoice();
    for (const t of LINES) { const p = v.pick(t, m); assert.ok(ALL.has(name(p)), `${m} · "${t}" → ${name(p)}`); }
  }
});
await check("(b) the same slot taken a second time = the other set (A teal c09 ↔ B orange s09)", () => {
  const v = mood.createChogVoice();
  const long = "your money does the job."; // 24 chars → 2640 ms > 2 s
  const got = Array.from({ length: 10 }, () => name(v.pick(long, "cute")));
  assert.deepEqual(got, [2, 4, 5, 7, 8].map((n) => SET("c09", n)).concat([2, 4, 5, 7, 8].map((n) => SET("s09", n))));
  const w = mood.createChogVoice();
  assert.deepEqual(Array.from({ length: 4 }, () => name(w.pick("ok", "cute"))), [SET("c09", 1), SET("c09", 6), SET("s09", 1), SET("s09", 6)]);
  const f = mood.createChogVoice();
  const first = mood.chogMoodLine("get your piggy", "down");
  assert.deepEqual([name(f.pick(first, "down")), name(f.pick(first, "down"))], [SET("c09", 3), SET("s09", 3)]);
});
await check("(c) C: the next line waits until the voice has ended (bubble time formula unchanged) · main.js uses it", () => {
  assert.equal(typeof mood.chogVoiceWaits, "function", "chogVoiceWaits missing");
  // two lines: first read 2 s + breath → second at 3000 ms; the voice runs 4170 ms → the second line waits for it
  assert.deepEqual(mood.chogVoiceWaits([0, 3000], 4170, 0), [0, 4170]);
  assert.deepEqual(mood.chogVoiceWaits([0, 3000], 2000, 0), [0, 3000]); // shorter voice: the formula stands
  assert.deepEqual(mood.chogVoiceWaits([0, 3000, 6000], 4170, 1000), [0, 3170, 6000]); // 1 s already gone: the voice has 3170 ms left · a later line already past it keeps its wait
  const v = mood.createChogVoice();
  const peek = v.peek("your money does the job.", "cute"); const got = v.pick("your money does the job.", "cute");
  assert.equal(peek.file, got.file); assert.ok(peek.ms > 2000 && Number.isFinite(peek.ms), `ms ${peek.ms}`);
  const main = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
  const body = main.slice(main.indexOf("function chogLineWaits("), main.indexOf("function chogLinesMarkup("));
  assert.match(body, /chogVoiceWaits\(/, "chogLineWaits does not wait for the voice");
});
await check("④ loudness: one trim for all 16 (all −28 LUFS) = old cute A at the app (−15.1 LUFS × 0.62) within ±1 dB", () => {
  const v = mood.createChogVoice();
  const trims = new Set(LINES.map((t) => v.pick(t, "cute").trim));
  assert.equal(trims.size, 1, `trims ${[...trims]}`);
  const t = [...trims][0];
  const now = -28 + 20 * Math.log10(t), was = -15.1 + 20 * Math.log10(0.62);
  assert.ok(Math.abs(now - was) <= 1, `new ${now.toFixed(2)} vs old ${was.toFixed(2)} LUFS`);
});
await check("files: the 16 app files = the design originals byte for byte · the old voice files are out of the app", () => {
  const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
  for (const s of ["c09", "s09"]) for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const app = path.join(REPO, "app/public/sound/chog", SET(s, n));
    assert.ok(existsSync(app), `${SET(s, n)} missing`);
    const src = privatePath(`design/chog/say/chatterbox31s/${s}/chog_cute_${n}.wav`);
    if (existsSync(src)) assert.equal(sha(app), sha(src), `${SET(s, n)} ≠ ${s}/chog_cute_${n}.wav`);
  }
  for (const old of ["fast6_cuteA", "fast6_cuteB", "fast6_dreamB", "long_cute6_1", "long_cute6_2", "long_cute6_both", "long_dream6_1", "long_dream6_2", "long_dream6_both"])
    assert.equal(existsSync(path.join(REPO, "app/public/sound/chog", `sound_chog_${old}_1016.wav`)), false, `${old} still in the app`);
});
console.log(`A-1349 chog voice: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
