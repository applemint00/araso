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
// Loop lengths (s) of the confirmed cues; used only to stagger phase offsets.
export const AMBIENT_CYCLE_S = Object.freeze({
  [S.IDLE]: 3.2,
  [S.WATCHING]: 48,
  [S.DRINK]: 6,
  [S.LISTEN]: 6,
  [S.SUNSHINE]: 4.4,
  [S.FLOP_SLEEP]: 2,
});

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
  let sleepTaken = false;
  const propTaken = new Set();
  order.forEach((id, rank) => {
    const rng = seededRandom(hashSeed(`${nonce}|${id}|ambient`));
    const candidates = AMBIENT_MOTION_STATES.filter((state) => {
      if (AMBIENT_SLEEP.includes(state) && sleepTaken) return false;
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
    if (AMBIENT_SLEEP.includes(picked)) sleepTaken = true;
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

export function planHomeSlots({ width, seat, chog, foot, paper, brand = null, safe }) {
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
  const candidates = band === "mobile"
    ? (() => {
      const belowY = Math.max(foot.b, chog.b, seat.b) + gap;
      const belowSlack = Math.max(0, safe.b - belowY - h - 1);
      return [
        ["M1", at(foot.x, foot.y - gap - h)],
        ["M2", at(foot.r - w, foot.y - gap - h * 1.6)],
        ["M3", at(safe.x, belowY)],
        ["M4", at(safe.r - w, belowY + belowSlack)],
      ];
    })()
    : band === "mid"
      ? [
        ["WN1", at(foot.x - gap - w, foot.y)],
        ["WN2", at(foot.r - w, foot.y - gap - h)],
        ["WN3", at(foot.x, foot.b + gap)],
      ]
      : [
        ["W2", at(foot.r + gap, foot.y)],
        ["W3", at(foot.r - w, foot.y - gap - h)],
        ["W4", at(paper.x, foot.b + gap)],
        // Owner/coordinator resolution 2026-09-30: measured WA1 (lower-left, seat floor line) and
        // WA2 (upper-left) are adopted, so 1440×900 fills W1 → W2 → WA1 → WA2 (W3/W4 do not fit there).
        ["WA1", at(foot.x - gap - w, seat.y)],
        ["WA2", at(foot.x - gap - w, foot.y)],
      ];
  const seatName = band === "mobile" ? "M0" : band === "mid" ? "SEAT" : "W1";
  const slots = [{ name: seatName, rect: seat, seat: true }];
  const rejected = [];
  for (const [name, r] of candidates) {
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
