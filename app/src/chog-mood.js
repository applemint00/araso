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

// Voice files (app/public/sound/chog · made from the Owner's 10-16 recording) with ear-level trims (RMS matched to the 10-08 voice).
const BASE = "/sound/chog";
const f = (name, trim) => ({ file: `${BASE}/sound_chog_${name}_1016.wav`, trim });
const VOICES = Object.freeze({
  cute: { short: [f("fast6_cuteA", 0.62), f("fast6_cuteB", 1.16)], long: [f("long_cute6_1", 0.69), f("long_cute6_2", 0.91)], both: f("long_cute6_both", 0.82) },
  dream: { short: [f("fast6_dreamB", 1.04)], long: [f("long_dream6_1", 0.79), f("long_dream6_2", 1.0)], both: f("long_dream6_both", 0.92) },
});
const DOWN_TRIM = 0.8; // the down day speaks with the dream voice, a little softer
const LONG_MS = 2000; // the same read time as chogSpeakMs (characters × 60 + 1200 ms)
const FIRST_MEETING_LINES = new Set([FIRST_MEETING, ...LINES[FIRST_MEETING]]);

export function createChogVoice() {
  const next = new Map();
  return {
    pick(text, mood = chogMood()) {
      const set = VOICES[mood === "cute" ? "cute" : "dream"];
      const gain = mood === "down" ? DOWN_TRIM : 1;
      const t = String(text || "").trim();
      if (FIRST_MEETING_LINES.has(t)) return { file: set.both.file, trim: set.both.trim * gain };
      const kind = t.length * 60 + 1200 > LONG_MS ? "long" : "short";
      const list = set[kind];
      const key = `${mood}:${kind}`;
      const i = next.get(key) || 0;
      next.set(key, i + 1);
      const v = list[i % list.length];
      return { file: v.file, trim: v.trim * gain };
    },
  };
}
