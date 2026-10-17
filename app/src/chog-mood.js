// [A-1326 · Owner 18:4x–19:0x · FIRST_JOURNEY_PACING_20261015.md:29–41] Chog's day mood — one table for the words and the voice.
// The device's own date (local, whole day) numbered from 1970-01-01, ÷ 3 → down / dream / cute. The eight lines below read that
// day's wording, word for word from the Owner's table; any other line stays as written. Chog's voice follows the mood.
export const CHOG_MOODS = Object.freeze(["down", "dream", "cute"]);

// original → [down, dream, cute]
const LINES = Object.freeze({
  "get your piggy": ["your piggy's here…", "a piggy, floating in…", "a piggy for you~"],
  "make passkey to hatch the piggy": ["make a passkey… it'll hatch", "a passkey… and it wakes", "passkey, then pop! it hatches"],
  "let's send Piggy to work": ["let's send piggy out… slowly", "piggy floats off to work…", "off to work, little piggy~"],
  "your money does the job.": ["your money does the work… mm", "your money hums at work…", "your money's doing the job ♪"],
  "I'll keep the details at home.": ["i'll keep it all at home…", "i'll keep it safe at home…", "tucked away at home~"],
  "tap me to find out": ["tap me… if you wanna know", "tap me… a little secret", "tap me, tap me~"],
  "let's try more kinds of jobs!": ["more jobs, maybe…", "more jobs out there… maybe", "ooh, more jobs to try~"],
  "closing soon.": ["getting sleepy…", "fading out soon…", "nap time soon~"],
});
const FIRST_MEETING = "get your piggy";

export function chogMood(now = new Date()) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
  return CHOG_MOODS[((day % 3) + 3) % 3];
}
export function chogMoodLine(text, mood = chogMood()) {
  const row = LINES[text];
  const i = CHOG_MOODS.indexOf(mood);
  return row && i >= 0 ? row[i] : text;
}
export function chogMoodLines(lines, mood = chogMood()) {
  return [...lines].map((t) => chogMoodLine(t, mood));
}

// [A-1349 · Owner 10-17 12:2x "청록 90 주황도 킵" · PACING:117–118 · 07:0x · 07:1x] Chog's voice = cute (everyday), slow, 90 % pace:
// teal c09 = A · orange s09 = B (app/public/sound/chog/sound_chog_cute90_<set>_<n>_1017.wav · the design originals, byte for byte).
// Every mood day speaks with this one voice (the down / dream voices are not chosen yet). A line read in <= 2 s → a short one (1 · 6);
// longer → 2 · 4 · 5 · 7 · 8 in turn; 3 (6.6 s) = the first-meeting line only. The same slot taken again = the other set (A ↔ B).
// All 16 files are −28 LUFS: one trim brings them to the old cute A at the app (−15.1 LUFS × 0.62 = −19.25) — +8.75 dB, peak −12 dBTP.
const BASE = "/sound/chog";
const VOICE_TRIM = 2.74;
const VOICE_MS = Object.freeze({ // file length, ms (ffprobe)
  c09: [2451, 3074, 6650, 3712, 2898, 2373, 3547, 3421],
  s09: [2715, 3430, 7039, 4169, 3026, 2666, 3633, 3774],
});
const SLOTS = Object.freeze({ short: [1, 6], long: [2, 4, 5, 7, 8], first: [3] });
const LONG_MS = 2000; // the same read time as chogSpeakMs (characters × 60 + 1200 ms)
const FIRST_MEETING_LINES = new Set([FIRST_MEETING, ...LINES[FIRST_MEETING]]);

export function createChogVoice() {
  const next = new Map();
  const choose = (text) => {
    const t = String(text || "").trim();
    const kind = FIRST_MEETING_LINES.has(t) ? "first" : t.length * 60 + 1200 > LONG_MS ? "long" : "short";
    const list = SLOTS[kind];
    const i = next.get(kind) || 0;
    const n = list[i % list.length];
    const set = Math.floor(i / list.length) % 2 ? "s09" : "c09";
    return { kind, i, voice: { file: `${BASE}/sound_chog_cute90_${set}_${n}_1017.wav`, trim: VOICE_TRIM, ms: VOICE_MS[set][n - 1] } };
  };
  return {
    // the voice the next line with these words would get, without taking it (C: the line clock needs its length first)
    peek(text) { return choose(text).voice; },
    pick(text) { const c = choose(text); next.set(c.kind, c.i + 1); return c.voice; },
  };
}

// [A-1349 · PACING:117 ① C] when the voice runs longer than the bubble, the lines after the first wait for the voice to end.
// waits = ms each line still waits (chogLineWaits) · voiceMs = this speech's voice length · elapsed = ms since the speech started.
export function chogVoiceWaits(waits, voiceMs, elapsed = 0) {
  const hold = Math.max(0, (Number(voiceMs) || 0) - elapsed);
  return waits.map((w, i) => (i === 0 ? w : Math.max(w, hold)));
}
