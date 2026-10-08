// Piggy-id motion projection map. Pure: no DOM, no storage, no money/job/permission/selection
// or signer state is read or written here. Visual only.
//
// Priority per Piggy id: WORK → AWAY/RETURN (runtime truth) → ambient (Home-life random) → IDLE.
// Runtime cues always beat ambient; a Piggy changing runtime state only changes its own entry.
export const PIGGY_MOTION_STATE = Object.freeze({
  IDLE: "idle",
  WORK: "work",
  AWAY: "away",
  RETURN: "return",
  WATCHING: "watching",
  DRINK: "drink",
  LISTEN: "listen",
  SUNSHINE: "sunshine",
  FLOP_SLEEP: "flop-sleep",
});

const S = PIGGY_MOTION_STATE;
// Runtime/financial cues only — never picked by the ambient randomizer.
export const RUNTIME_MOTION_STATES = Object.freeze([S.WORK, S.AWAY, S.RETURN]);
// Owner-confirmed Home ambient pool (2026-09-26 freeze) with the living-Home starting weights.
export const AMBIENT_MOTION_STATES = Object.freeze([S.IDLE, S.WATCHING, S.DRINK, S.LISTEN, S.SUNSHINE, S.FLOP_SLEEP]);
export const AMBIENT_WEIGHTS = Object.freeze({
  [S.IDLE]: 30,
  [S.WATCHING]: 20,
  [S.DRINK]: 15,
  [S.LISTEN]: 15,
  [S.SUNSHINE]: 15,
  [S.FLOP_SLEEP]: 5,
});
// Density: never two visible Piggies in the same prop-heavy state; at most one sleep sequence.
export const AMBIENT_PROP_HEAVY = Object.freeze([S.WATCHING, S.LISTEN, S.DRINK]);
export const AMBIENT_SLEEP = Object.freeze([S.FLOP_SLEEP]);
// [A-790 OWNER DECISION LOCK 2026-10-05 (B)] Sleep is NOT part of the random pool any more: a Piggy only sleeps
// through the active-Piggy 90s inactivity clock below. AMBIENT_WEIGHTS / AMBIENT_MOTION_STATES keep the model
// values (the sleep entry is the recorded canon weight) but assignHomeAmbient() never draws a sleep state.
// Loop lengths (s) of the confirmed cues; used only to stagger phase offsets.
export const AMBIENT_CYCLE_S = Object.freeze({
  [S.IDLE]: 3.2,
  [S.WATCHING]: 48,
  [S.DRINK]: 6,
  [S.LISTEN]: 6,
  [S.SUNSHINE]: 4.4,
  [S.FLOP_SLEEP]: 2,
});

// ── [A-744] Wake = the approved Flop→roll→drowsy→sleep sequence played in REVERSE ──────────────────
// Owner clarification 2026-09-30 (A-656): "Wake may reuse the approved flop sequence in reverse rather
// than inventing a new animation, subject to source/timing verification. Reduced-motion remains a
// stable still pose." So there is NO new art and NO new beat here: every wake frame is the SAME forward
// draw evaluated at the mirrored time  forwardT = durationS - u  (u = seconds since the wake began).
// The forward draw is a pure function of time (frames/SVGs in public/motion/home-ambient/), hence
// reversing it is exactly this one subtraction.
//   forward beats (home_motion_confirmed_20260926 README · main.js ambFlopSleep): Flop 0–1.30 (idle 0–1.00,
//   squash 1.00–1.24, lean 1.24–1.30, landing from 1.30) · landed rest 1.30–3.00 · right roll 3.00–4.50 ·
//   drowsy 3.2s · blanket rise 2.4s (arm lift delay .15 dur 1.5) → deep sleep reached at 4.5+3.2+2.4 s.
//   The reverse of the deep-sleep part is NOT separately recorded in canon, so (per the A-744 card) the
//   forward timings are reversed as-is: blanket lowers 2.4s, drowsy undoes over 3.2s, roll back 1.5s,
//   landed rest 1.7s, Flop in reverse 1.3s (lying → seated idle) — 10.1s in all.
// [A-790 2026-10-06] The trigger is now decided (Owner lock (B): any meaningful interaction) and wired for the active
// Piggy through createActiveSleepClock()/piggyWakeStartFor() below; PIGGY_WAKE.wakeStartS stays null (the start is per-sleep, passed in).
// (historic A-744 text follows) TRIGGER: DORMANT. No wake trigger (tap / timer / interrupt) is recorded in canon (A656 VERIFY: "Wake
// trigger UNKNOWN") — Owner-open. So the reverse is implemented and tested but NOTHING in the product starts
// it: piggyWakePhase() only wakes when a caller passes an explicit `wakeStartS`, and no product caller does.
// With no start the sleeper behaves exactly as before A-744 (asleep; 77.1s cue then the 64s rest loop).
// `snapFreeStartS` documents the one start time at which a future trigger could begin without a pose snap
// (deep sleep 10.1 + one full 64s rest cycle: breath is a 4s period, hold plan a 64s cycle).
// Runtime cues (WORK/AWAY/RETURN) still pre-empt ambient exactly as before; reduced motion never wakes.
const WAKE_FORWARD = Object.freeze({ flopS: 1.3, landedUntilS: 3.0, rollUntilS: 4.5, drowsyS: 3.2, blanketRiseS: 2.4 });
const WAKE_FULL_SLEEP_S = Math.round((WAKE_FORWARD.rollUntilS + WAKE_FORWARD.drowsyS + WAKE_FORWARD.blanketRiseS) * 1000) / 1000;
const WAKE_REST_CYCLE_S = 64;
export const PIGGY_WAKE = Object.freeze({
  forward: WAKE_FORWARD,
  durationS: WAKE_FULL_SLEEP_S,
  restCycleS: WAKE_REST_CYCLE_S,
  wakeStartS: null, // dormant: no recorded trigger
  snapFreeStartS: WAKE_FULL_SLEEP_S + WAKE_REST_CYCLE_S,
  // forward time to draw u seconds into the wake (u clamped to [0, durationS])
  forwardTimeAt(u) {
    const c = Math.min(WAKE_FULL_SLEEP_S, Math.max(0, Number.isFinite(u) ? u : 0));
    return WAKE_FULL_SLEEP_S - c;
  },
});

// phase of a flop-sleep resident at `elapsedS` seconds into its Home-life cycle.
//   asleep  → the forward sequence (pre-A-744 mapping: cue 0–77.1s, then the 64s rest loop from 13.1s)
//   waking  → the same sequence mirrored      awake → seated idle
// Waking only exists when `wakeStartS` is a finite number (explicit trigger); default null = never wakes.
// reduced motion = stable still: the preview's persistent sleep pose (cue held at half its 77.1s length).
export function piggyWakePhase(elapsedS, reduced = false, wakeStartS = null) {
  if (reduced) return Object.freeze({ phase: "asleep", forwardT: 77.1 * 0.5, awakeS: 0 });
  const e = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  const W = PIGGY_WAKE;
  const asleep = Object.freeze({ phase: "asleep", forwardT: e <= 77.1 ? e : 13.1 + ((e - 13.1) % 64), awakeS: 0 });
  if (!Number.isFinite(wakeStartS) || e < wakeStartS) return asleep;
  const u = e - wakeStartS;
  if (u < W.durationS) return Object.freeze({ phase: "waking", forwardT: W.forwardTimeAt(u), awakeS: 0 });
  return Object.freeze({ phase: "awake", forwardT: 0, awakeS: u - W.durationS });
}

// ── [A-803 2026-10-06 · SUPERSEDES A-790's "only the active/main Piggy sleeps" rule] ───────────────────
// Sleep eligibility follows each Piggy's own resolved Home behavior, never its role or the Piggy count:
// a Home Piggy whose current behavior is plain IDLE may sleep after ACTIVE_SLEEP_AFTER_MS of inactivity
// whether it is single, main (seat) or a companion. Any other ambient action (watching / drink / listen /
// sunshine) or runtime action (work / away / return) never sleeps while it is in that behavior.
// (A-790 evidence stays as history; this is the newest Owner decision.)
export const HOME_SLEEP_ELIGIBLE_STATES = Object.freeze([S.IDLE]);
export function homeSleepEligible(resolvedState) {
  return HOME_SLEEP_ELIGIBLE_STATES.includes(resolvedState);
}

// [옛 규칙 · A-803(101–107줄)이 대체 · 기록으로만 둠]
// ── [A-790] Active-Piggy sleep clock + wake start ───────────────────────────────────────────────────
// OWNER DECISION LOCK 2026-10-05 (B): ONLY the active/main Piggy sleeps, after 90 s of inactivity; any
// meaningful interaction wakes it with the existing reverse-Flop (piggyWakePhase). Chog stays on its own 60 s
// (chog-home.js SLEEP_IDLE_MS) — nothing here touches it.
// Inactivity = no meaningful user interaction. Meaningful = window `pointerdown` (tap/click/touch anywhere on
// Home, incl. the Piggy, Chog, Work/Away/Return buttons) or `keydown`. NOT meaningful: pointermove / hover /
// scroll / timers / re-renders / resize. Leaving Home for Work, Away or Return also resets the clock (main.js).
export const ACTIVE_SLEEP_AFTER_MS = 90000;
export const ACTIVE_SLEEP_INTERACTION_EVENTS = Object.freeze(["pointerdown", "keydown"]);

// Forward time of the sleeper at `elapsedS` seconds after it began to sleep (same mapping as piggyWakePhase).
function sleeperForwardT(elapsedS) {
  const e = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  return e <= 77.1 ? e : 13.1 + ((e - 13.1) % 64);
}

// wakeStartS (in the sleeper's own elapsed frame) for a wake triggered at `elapsedS`.
//   interaction BEFORE deep sleep (still flopping/rolling/drowsy, forward t < durationS): the reverse begins at
//   exactly that forward time -> the first wake frame equals the frame on screen (no snap).
//   interaction in deep sleep: begins at the canonical deep-sleep frame (as A-744; only the breath/turn phase
//   of the rest loop can differ from the frame on screen — snapFreeStartS documents the exact-match instant).
export function piggyWakeStartFor(elapsedS) {
  const e = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  const D = PIGGY_WAKE.durationS;
  const c = Math.min(D, sleeperForwardT(e));
  return e - (D - c);
}

// Pure, injectable (fake timers in tests). Modes: awake -> sleeping (after afterMs of no interact()) ->
// waking (interact() while sleeping; lasts the REMAINING reverse-Flop) -> awake (inactivity counts again).
// `slept` stays true after a wake until the next sleep so the caller keeps the seated-idle (awake) frame
// instead of snapping back to a mid-cycle ambient pose.
export function createActiveSleepClock({ now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, afterMs = ACTIVE_SLEEP_AFTER_MS, onChange = null } = {}) {
  let mode = "awake";
  let slept = false;
  let sleepStartMs = 0;
  let wakeStartS = null;
  let timer = null;
  const emit = () => { if (typeof onChange === "function") onChange(mode); };
  const clear = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const arm = () => {
    clear();
    timer = setTimer(() => {
      timer = null;
      if (mode !== "awake") return;
      mode = "sleeping";
      slept = true;
      sleepStartMs = now();
      wakeStartS = null;
      emit();
    }, afterMs);
  };
  return {
    // start counting inactivity (no-op while sleeping/waking or when already counting)
    arm() { if (mode === "awake" && timer === null) arm(); },
    // meaningful interaction. Returns true when it started a wake.
    // opts.instant (reduced motion: nothing animates) = sleeper is simply awake at once, no reverse-Flop.
    interact(opts = null) {
      if (mode === "awake") { arm(); return false; }
      if (mode === "waking") return false;
      if (opts && opts.instant) { clear(); mode = "awake"; slept = false; wakeStartS = null; emit(); arm(); return true; }
      const e = (now() - sleepStartMs) / 1000;
      wakeStartS = piggyWakeStartFor(e);
      mode = "waking";
      clear();
      const remainS = Math.max(0, PIGGY_WAKE.durationS - (e - wakeStartS));
      timer = setTimer(() => {
        timer = null;
        mode = "awake";
        emit();
        arm();
      }, Math.round(remainS * 1000));
      emit();
      return true;
    },
    // scene change that takes the Piggy away from the Home layer (Work/Away/Return) or no seat: back to plain awake
    reset() { clear(); mode = "awake"; slept = false; wakeStartS = null; },
    snapshot() {
      return Object.freeze({ mode, slept, sleepStartMs, elapsedS: slept ? Math.max(0, (now() - sleepStartMs) / 1000) : 0, wakeStartS });
    },
    setOnChange(fn) { onChange = fn; },
  };
}

function piggyIdOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isRuntimeMotionState(state) {
  return RUNTIME_MOTION_STATES.includes(state);
}

export function isAmbientMotionState(state) {
  return AMBIENT_MOTION_STATES.includes(state);
}

function lookup(source, id) {
  if (!source || !id) return undefined;
  if (source instanceof Map) return source.get(id);
  return Object.prototype.hasOwnProperty.call(source, id) ? source[id] : undefined;
}

export function resolvePiggyMotionState({
  piggyId,
  affectedPiggyId = null,
  cue = PIGGY_MOTION_STATE.IDLE,
  runtime = null,
  ambient = null,
} = {}) {
  const id = piggyIdOf(piggyId);
  const affected = piggyIdOf(affectedPiggyId);
  const work = id !== null && affected === id && cue === PIGGY_MOTION_STATE.WORK;
  let state = work ? PIGGY_MOTION_STATE.WORK : PIGGY_MOTION_STATE.IDLE;
  if (!work && id !== null) {
    const run = lookup(runtime, id);
    const amb = lookup(ambient, id);
    const ambState = typeof amb === "string" ? amb : amb?.state;
    if (isRuntimeMotionState(run)) state = run;
    else if (isAmbientMotionState(ambState)) state = ambState;
  }
  return Object.freeze({
    piggyId: id,
    state,
    active: work,
  });
}

export function buildPiggyMotionStateMap(piggies = [], context = {}) {
  const states = new Map();
  for (const piggy of Array.isArray(piggies) ? piggies : []) {
    const id = piggyIdOf(piggy?.id);
    if (!id || states.has(id)) continue;
    states.set(id, resolvePiggyMotionState({ ...context, piggyId: id }));
  }
  return states;
}

export function piggyMotionStateFromMap(states, piggyId) {
  const id = piggyIdOf(piggyId);
  return (id && states instanceof Map && states.get(id)) || resolvePiggyMotionState({ piggyId: id });
}

// ── Stable Home-life randomness ────────────────────────────────────────────────────────────
// Seed = Piggy id + a local Home-life nonce. No network, no clock, no Math.random here: the same
// (ids, nonce) always gives the same answer, so renders, paper/HISTORY/MY MONEY toggles and
// selection changes can never reroll anything.
export function hashSeed(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stableOrder(ids, nonce, salt) {
  return [...ids].sort((a, b) => {
    const d = hashSeed(`${nonce}|${a}|${salt}`) - hashSeed(`${nonce}|${b}|${salt}`);
    return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
  });
}

function uniqueIds(list) {
  const out = [];
  for (const value of Array.isArray(list) ? list : []) {
    const id = piggyIdOf(typeof value === "string" ? value : value?.id);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// Ambient assignment for the Home-present Piggies of one Home-life cycle.
// `eligible(id, state)` lets the caller veto a state that cannot be drawn at that Piggy's slot
// without overlap (wide lying poses); it never changes the weights of the remaining states.
// Returns Map<id, { state, phaseS }>. phaseS = staggered start offset (seconds) so residents never
// animate in lockstep; residents are spread over distinct phase buckets.
export function assignHomeAmbient(piggyIds, nonce, { eligible = null } = {}) {
  const ids = uniqueIds(piggyIds);
  const order = stableOrder(ids, nonce, "ambient");
  const out = new Map();
  const propTaken = new Set();
  order.forEach((id, rank) => {
    const rng = seededRandom(hashSeed(`${nonce}|${id}|ambient`));
    const candidates = AMBIENT_MOTION_STATES.filter((state) => {
      // [A-790] never sleep by random assignment (companions never sleep; the active Piggy sleeps only via the 90s clock)
      if (AMBIENT_SLEEP.includes(state)) return false;
      if (AMBIENT_PROP_HEAVY.includes(state) && propTaken.has(state)) return false;
      if (typeof eligible === "function" && state !== S.IDLE && !eligible(id, state)) return false;
      return true;
    });
    const total = candidates.reduce((sum, state) => sum + AMBIENT_WEIGHTS[state], 0);
    let roll = rng() * total;
    let picked = S.IDLE;
    for (const state of candidates) {
      roll -= AMBIENT_WEIGHTS[state];
      if (roll < 0) { picked = state; break; }
    }
    if (AMBIENT_PROP_HEAVY.includes(picked)) propTaken.add(picked);
    const bucket = (rank + rng()) / Math.max(1, order.length);
    out.set(id, Object.freeze({ state: picked, phaseS: bucket * AMBIENT_CYCLE_S[picked] }));
  });
  return out;
}

// Stable resident → slot order for one Home-life cycle. The scene Piggy (the one the existing
// First/Second route belongs to) keeps the established seat; the rest are ordered by the seed,
// never by selection. Returns ids in fill order (index 0 = seat when `seatId` is present).
export function orderHomeResidents(piggyIds, nonce, seatId = null) {
  const ids = uniqueIds(piggyIds);
  const seat = piggyIdOf(seatId);
  const rest = stableOrder(ids.filter((id) => id !== seat), nonce, "slot");
  return seat && ids.includes(seat) ? [seat, ...rest] : rest;
}

// ── Measured safe slots (living-Home geometry lane formulas) ─────────────────────────────────────
// All inputs are live viewport rects {x,y,r,b}; nothing here is a hard-coded screen position.
//   seat  = current seat ∪ name label (S)         chog = Chog ink (C)
//   foot  = Paper+HISTORY maximum footprint (F)    paper = HISTORY-closed open paper (P)
//   brand = brand mark                             safe = viewport safe rect
// Mobile ≤640: M0(seat) M1 M2 M3 M4 · mid 641–1199: SEAT WN1 WN2 WN3 · ≥1200: W1(seat) W2 W3 W4.
// Each slot is the seat's own size (approved scale, no shrink). A slot is kept only if it stays
// inside `safe` and clears Chog / footprint / brand / seat / earlier slots by the band gap.
export const HOME_SLOT_GAP = Object.freeze({ mobile: 12, web: 24 });

export function rect(x, y, r, b) {
  return { x, y, r, b, w: r - x, h: b - y };
}

export function rectsTouch(a, b, gap = 0) {
  const eps = 0.01;
  return a.x < b.r + gap - eps && b.x < a.r + gap - eps && a.y < b.b + gap - eps && b.y < a.b + gap - eps;
}

export function rectInside(inner, outer) {
  const eps = 0.01;
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.r <= outer.r + eps && inner.b <= outer.b + eps;
}

export function homeSlotBand(width) {
  if (width <= 640) return "mobile";
  if (width < 1200) return "mid";
  return "web";
}

export function planHomeSlots({ width, seat, chog, foot, paper, brand = null, safe, mobileVisibleCap = 2 }) {
  const band = homeSlotBand(width);
  const gap = band === "mobile" ? HOME_SLOT_GAP.mobile : HOME_SLOT_GAP.web;
  const w = seat.w;
  const h = seat.h;
  const at = (x, y) => rect(x, y, x + w, y + h);
  // [A-659 OWNER VISUAL REPAIR — D, round 2, 2026-09-30] Owner: the old M1..M4 read as an obvious
  // two-row grid (M1/M2 sharing one y, M3/M4 sharing another). Round 1 kept M1/M2 sharing a y
  // (reasoned: `foot.y - gap - h` is the only strip clearing the full-width HISTORY/paper
  // footprint) and only staggered M3/M4 — coordinator's real-browser recapture showed the visible
  // bug was exactly that untouched upper pair (Bebe/Dumpling ≈5px apart, still reading as a row).
  // Round 2: the "M1/M2 must share a y" reasoning was incomplete — that strip is thin (foot's
  // FULL width, `foot.x` to `foot.r`, is off-limits, but its HEIGHT band from `safe.y` up through
  // `foot.y - gap - h` has slack) — so M2 now sits `0.6h` HIGHER within that same strip (still
  // clearing `foot`, still inside `safe`, still x-disjoint from M1 so no new M1/M2 collision).
  // M3/M4 used to sit just below `seat.y` (the character's own row) — round 2 gave them a 0.5h/
  // 0.08h offset that cleared `foot` with margin at THAT baseline's character position.
  //
  // [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, round 3, 2026-10-01] The 1440-canon
  // correction (main.js computeHomeFootTargetViewportY()) moves the mobile Home cluster's own
  // foot UP by ~98px(390)/~108px(430) — `seat`/`chog` are live rects, so this function still never
  // hardcodes a screen position, but `seat.y - h*0.5` now lands INSIDE `foot`'s own reserved band
  // (foot's Y-span covers nearly the full mobile width, so nothing can dodge it sideways) — the
  // coordinator's real-browser recapture measured exactly this: capacity dropped 5→3, M3 and M4
  // both rejected on "footprint". Root cause: M3/M4 were anchored to the CHARACTER's row, which
  // used to sit safely below `foot`; now it doesn't, and the character's rise opened a NEW gap
  // between `foot`'s bottom and `safe`'s bottom instead. Fix: anchor M3/M4 to the union of EVERY
  // real obstacle's bottom edge (`foot`, `chog`, `seat` — whichever is lowest, entirely live-
  // measured, no hardcoded band) plus `gap`, not to `seat.y` specifically — so they always sit in
  // whatever open strip exists below the lowest obstacle, at any baseline. That strip is often too
  // short for the full 0.5h vertical stagger M1/M2 get (only ~5–14px of slack once the 92.6px-tall
  // slot itself is placed), so M3/M4 stagger by whatever vertical slack `safe.b` actually leaves
  // (`belowSlack`, clamped ≥0) AND by x (opposite ends of `safe`, same as before) — x-disjoint
  // slots never collide regardless of y, so a near-zero `belowSlack` still degrades safely (no
  // overlap), it just reads as more side-by-side than staggered at the very tightest heights. A
  // viewport where even ONE slot's h doesn't fit below the obstacles still simply rejects it at
  // runtime (`rectInside(r, safe)`), same as any other candidate — this never forces a placement
  // that would clip.
  // [A-681 OWNER CLARIFICATION 2026-10-02 / OWNER DIRECTION 2026-10-03 item 1] "Mobile visible
  // Piggies: maximum 2" originally superseded the A-654/A-659 mobile capacity of 5 (M0 seat +
  // M1..M4) as a VISIBLE-composition rule — the logical/indexed Piggy count stayed untouched
  // (indexedResidents(), main.js, is a fully separate data path HISTORY/list reads from; it
  // never calls this function). That reading is itself now SUPERSEDED below.
  //
  // [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03, supersedes the "max 2
  // visible total" reading] Home may show the main current Piggy+Chog (dominant, full-size,
  // unchanged, slot M0) PLUS up to TWO additional Piggies as one small, size-reduced companion
  // cluster near the lower-left floor line — close together, not scattered, with slight size/
  // vertical variation for an organic feel ("about 10% relative difference, not wildly random").
  // Action scenes (Explore etc.) still show ONLY the active Piggy — `mobileVisibleCap: 0` is
  // passed from main.js there (HOME_LIFE_SCENES call site), vs. Home's default of 2. Sizes
  // relative to the main seat (`w`/`h` above), within the Owner-recommended range, at the higher
  // end per the Owner's own "the mock extras were a bit too small — implement slightly larger"
  // correction: extra A (M1) ≈ 0.425× · extra B (M2) ≈ 0.375× (≈12% apart — "about 10%", kept
  // slightly off round numbers rather than inventing an exact 10.0%). A resident that doesn't
  // get a slot (beyond `mobileVisibleCap`, or in an action scene) already falls back to
  // "card-only" (placeHomeAmbientSet()'s own `if (!pick) continue;`, main.js) — i.e. Home/Paper/
  // list/HISTORY information only, zero new fallback code. `mid`/`web` bands are untouched — this
  // card is mobile-only (<=640, the same boundary `homeSlotBand()` already draws).
  //
  // This replaces the earlier A-659 "M1..M4 two-row grid, staggered to avoid a 5-seat pile-up"
  // formulas entirely (history above, superseded code removed rather than kept dead — that
  // design assumed up to 4 FULL-SIZE extras scattered across the viewport, which is exactly what
  // this Owner decision now forbids: "Do NOT scatter extra Piggies around the viewport"). Floor
  // line = the lower of the main pair's own feet (`seat.b`/`chog.b`, live-measured, never a
  // hardcoded screen position) — same "no hardcoded band" discipline the old M3/M4 anchor used.
  const HOME_EXTRA_A_SCALE = 0.425;
  const HOME_EXTRA_B_SCALE = 0.375;
  const atSize = (x, y, ww, hh) => rect(x, y, x + ww, y + hh);
  const candidates = band === "mobile"
    ? (() => {
      if (mobileVisibleCap <= 0) return [];
      const wA = w * HOME_EXTRA_A_SCALE, hA = h * HOME_EXTRA_A_SCALE;
      const wB = w * HOME_EXTRA_B_SCALE, hB = h * HOME_EXTRA_B_SCALE;
      const floorY = Math.max(seat.b, chog.b);
      // B sits a touch higher than A (slight vertical variation, organic, not aligned/copies).
      const bLift = hB * 0.15;
      return [
        ["M1", atSize(safe.x, floorY - hA, wA, hA)],
        ["M2", atSize(safe.x + wA + gap, floorY - bLift - hB, wB, hB)],
      ].slice(0, Math.min(2, mobileVisibleCap));
    })()
    : (() => {
      // [A-831 · A-829 / A-682 item 1 / A-788 — Cowork Q-A (a)] Home shows Main + up to 2 smaller companions in ONE lower-left cluster: on the Main floor line, left of the
      // character stage (Chog ink), BELOW the Home card — and below the two-card footprint (`foot`, History open) — never behind or over a card. Same companion scales as the
      // mobile cluster (A .425 / B .375 of the seat), shrunk further only when the strip between the footprint and the floor is shorter than that. Replaces the old
      // fixed-rect formulas (W2/W3/W4/WA1/WA2 and WN1..WN3, all anchored to the pre-v10 centred paper), which no longer fit the larger / zone-placed v10 card.
      // Names are kept (web: WA1, WA2; mid: WN1, WN2) so the seeded slot preference / wide-pose code is untouched. No motion, state or timing change.
      const floorY = seat.b;
      const strip = Math.max(0, floorY - (foot.b + gap + 0.5));
      const sA = Math.min(HOME_EXTRA_A_SCALE, strip / h), sB = Math.min(HOME_EXTRA_B_SCALE, strip / h);
      const wA = w * sA, hA = h * sA, wB = w * sB, hB = h * sB;
      const xA = chog.x - gap - 0.5 - wA;
      const names = band === "mid" ? ["WN1", "WN2"] : ["WA1", "WA2"];
      return [
        [names[0], atSize(xA, floorY - hA, wA, hA)],
        [names[1], atSize(xA - gap - 0.5 - wB, floorY - hB - Math.max(0, Math.min(hB * 0.15, strip - hB)), wB, hB)],
      ];
    })();
  const seatName = band === "mobile" ? "M0" : band === "mid" ? "SEAT" : "W1";
  const slots = [{ name: seatName, rect: seat, seat: true }];
  const rejected = [];
  for (const [name, r, opt] of candidates) {
    if (opt?.fallback && !rejected.length) continue;
    const why = [];
    if (!rectInside(r, safe)) why.push("viewport-margin");
    if (rectsTouch(r, chog, gap)) why.push("chog");
    if (rectsTouch(r, foot, gap)) why.push("footprint");
    if (brand && rectsTouch(r, brand, gap)) why.push("brand");
    if (slots.some((s) => rectsTouch(r, s.rect, gap))) why.push("slot");
    if (why.length) rejected.push({ name, rect: r, why });
    else slots.push({ name, rect: r, seat: false });
  }
  return { band, gap, slots, rejected };
}

// Wider lying poses (Watching, Flop→sleep) keep the approved scale, so their drawing is wider
// than the seat box. They may only be used where that wider footprint also clears every obstacle.
// `footprint` = { left, right, top, bottom } growth as fractions of the slot size.
export function wideSlotRect(slotRect, footprint, align) {
  const addW = slotRect.w * (footprint.left + footprint.right);
  const addTop = slotRect.h * footprint.top;
  const addBottom = slotRect.h * footprint.bottom;
  const shift = align === "start" ? slotRect.w * footprint.left : align === "end" ? -slotRect.w * footprint.right : 0;
  const x = slotRect.x - slotRect.w * footprint.left + shift;
  return { rect: rect(x, slotRect.y - addTop, x + slotRect.w + addW, slotRect.b + addBottom), dx: shift };
}

export function fitWideSlot({ slot, footprint, others = [], obstacles = [], safe, gap }) {
  for (const align of ["center", "start", "end"]) {
    const { rect: r, dx } = wideSlotRect(slot.rect, footprint, align);
    if (!rectInside(r, safe)) continue;
    if (obstacles.some((o) => o && rectsTouch(r, o, gap))) continue;
    if (others.some((o) => o !== slot && rectsTouch(r, o.rect, gap))) continue;
    return { align, dx, rect: r };
  }
  return null;
}
