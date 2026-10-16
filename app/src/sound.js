// [A-902] Sound set player (Owner-picked sounds, default ON). One small Web Audio player.
//
// Rules (INBOX A-902):
//   * four moments only: paper unfold, receipt toss, return bell, Chog speech bubble (babble A/B alternate).
//     File it has no sound. Callers pass a moment name; anything else is ignored.
//   * lazy unlock: the AudioContext is created / resumed only inside a real user gesture. Nothing plays before one.
//   * fails silent: no AudioContext, no fetch, a decode error, a blocked play -> no throw, no console noise.
//   * one moderate master level; per-sound trims only make the five files equally loud (EBU R128 integrated loudness
//     measured on the shipped WAVs, trimmed to about -20 LUFS). Not coupled to prefers-reduced-motion.
//   * on/off flag stored here (default ON). The only visible control is the speaker icon on the HOME card (home-paper.js).
//
// No DOM at import time: node tests import this file and drive it with fakes.

export const SOUND_STORAGE_KEY = "araso.sound.off.v1"; // present ("1") = muted; absent = ON (default)
export const SOUND_BASE = "/sound";
export const MASTER_GAIN = 0.5;
// [A-1305 ⑦ · Owner] the Home paper unfold at half its old level (1.4 → 0.7). One place, so the phone check can set it again.
export const UNFOLD_TRIM = 0.7;

// moment -> file(s) + trim (linear). Chog has two files that alternate per bubble.
export const SOUND_MOMENTS = {
  unfold: { files: [`${SOUND_BASE}/sound_home_paper_unfold.wav`], trims: [UNFOLD_TRIM] },
  toss: { files: [`${SOUND_BASE}/sound_receipt_toss.wav`], trims: [1.23] },
  bell: { files: [`${SOUND_BASE}/sound_return_bell_dmsd_glass.wav`], trims: [0.53] },
  chog: { files: [`${SOUND_BASE}/chog/sound_chog_babble_radio_A.wav`, `${SOUND_BASE}/chog/sound_chog_babble_radio_B.wav`], trims: [0.52, 0.63] },
};

const GESTURE_EVENTS = ["pointerdown", "touchend", "keydown", "click"];

export function createSoundPlayer({ win = typeof window !== "undefined" ? window : null, storage = undefined, fetchImpl = undefined } = {}) {
  let ctx = null;
  let unlocked = false;
  let chogNext = 0;
  let memoryOff = false; // used when storage is unavailable
  const buffers = new Map(); // url -> Promise<AudioBuffer|null>
  const onceKeys = new Set();

  function store() {
    if (storage !== undefined) return storage;
    try { return win?.localStorage ?? null; } catch { return null; }
  }

  function isOn() {
    try {
      const s = store();
      if (s) return s.getItem(SOUND_STORAGE_KEY) !== "1";
    } catch { /* fall through to memory */ }
    return !memoryOff;
  }

  function setOn(on) {
    memoryOff = !on;
    try {
      const s = store();
      if (s) { if (on) s.removeItem(SOUND_STORAGE_KEY); else s.setItem(SOUND_STORAGE_KEY, "1"); }
    } catch { /* memory flag still holds for this session */ }
    if (on && unlocked) preload();
    return isOn();
  }

  function makeContext() {
    if (ctx) return ctx;
    try {
      const Ctor = win?.AudioContext || win?.webkitAudioContext;
      if (typeof Ctor !== "function") return null;
      ctx = new Ctor();
    } catch { ctx = null; }
    return ctx;
  }

  // Called from inside a user-gesture event. Creates / resumes the context and marks the player unlocked.
  function unlock() {
    try {
      const c = makeContext();
      if (!c) return false;
      if (c.state === "suspended" && typeof c.resume === "function") {
        const r = c.resume();
        if (r && typeof r.catch === "function") r.catch(() => {});
      }
      unlocked = true;
      preload(); // after the first gesture, so the first play is not late
      return true;
    } catch { return false; }
  }

  function preload() {
    try {
      if (!isOn()) return; // a muted player fetches nothing
      for (const def of Object.values(SOUND_MOMENTS)) for (const url of def.files) loadBuffer(url);
    } catch { /* silent */ }
  }

  function installGestureUnlock() {
    if (!win || typeof win.addEventListener !== "function") return () => {};
    const handler = () => { unlock(); };
    for (const type of GESTURE_EVENTS) win.addEventListener(type, handler, { capture: true, passive: true });
    return () => { for (const type of GESTURE_EVENTS) win.removeEventListener?.(type, handler, { capture: true }); };
  }

  function loadBuffer(url) {
    if (buffers.has(url)) return buffers.get(url);
    const p = (async () => {
      try {
        const f = fetchImpl || win?.fetch?.bind(win);
        if (typeof f !== "function" || !ctx) return null;
        const res = await f(url);
        if (!res || res.ok === false) return null;
        const data = await res.arrayBuffer();
        return await new Promise((resolve) => {
          try {
            const r = ctx.decodeAudioData(data, (b) => resolve(b), () => resolve(null));
            if (r && typeof r.then === "function") r.then(resolve, () => resolve(null));
          } catch { resolve(null); }
        });
      } catch { return null; }
    })();
    buffers.set(url, p);
    return p;
  }

  // Plays one moment. Returns true only when a sound was handed to the audio graph.
  async function play(moment) {
    try {
      const def = SOUND_MOMENTS[moment];
      if (!def) return false;
      if (!isOn()) return false; // flag off -> never plays
      if (!unlocked || !ctx) return false; // no autoplay before a gesture
      let idx = 0;
      if (def.files.length > 1) { idx = chogNext % def.files.length; chogNext += 1; } // A, B, A, B ...
      const buf = await loadBuffer(def.files[idx]);
      if (!buf || !isOn() || !ctx) return false;
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      gain.gain.value = MASTER_GAIN * def.trims[idx];
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
      return true;
    } catch { return false; }
  }

  // At most once per key (e.g. one DOM element / one scene instance). Re-renders reuse the key and stay silent.
  function playOnce(moment, key) {
    const k = `${moment}:${String(key)}`;
    if (onceKeys.has(k)) return Promise.resolve(false);
    onceKeys.add(k);
    return play(moment);
  }

  return { isOn, setOn, unlock, installGestureUnlock, play, playOnce, get unlocked() { return unlocked; } };
}

// The app's single player. Safe to import without a window (tests).
const player = createSoundPlayer();
if (typeof window !== "undefined") player.installGestureUnlock();

export const soundIsOn = () => player.isOn();
export const setSoundOn = (on) => player.setOn(on);
export const playSound = (moment) => player.play(moment);
export const playSoundOnce = (moment, key) => player.playOnce(moment, key);
