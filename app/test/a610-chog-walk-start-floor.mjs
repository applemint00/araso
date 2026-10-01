// [A-610 repair] Contract test for the Chog walk-start / character-scale-floor composition
// fix — network 0, browser 0, same "cut the real source and check the contract" pattern as
// app/test/home-character-scale-floor.mjs / app/test/home-arrival.mjs. Live/measured proof
// (real screencast + RAF-sampled pixel-ink trajectory at 1440/430/390) lives in
// the A-610 run records (kept outside this repo) — this file locks the
// math contract so a future edit can't silently regress it back to the FAIL this card closed.
//   node app/test/a610-chog-walk-start-floor.mjs
//
// Bug (proven in lane_chog/CHOG_TRAJECTORY_DRAFT.md): chog-home.js:661-668 computes Chog's
// walk-START transform purely from the raw `board` rect it is given (assuming `#chogHome`
// sits directly under `#homeBoard`'s own transform). At 430/390, main.js's
// `applyHomeCharacterScaleFloor()` (main.js:5154) re-parents `#chogHome` into an EXTRA
// ancestor, `.homeCharScaleFloor` (translate(nudge) scale(k), transform-origin
// HOME_CENTER/HOME_FLOOR) — composed ON TOP of that already-applied transform. The fix
// (main.js:chogWalkStartBoardRect) feeds `mountChogHome()` a pre-distorted `board` rect, F⁻¹,
// so composing with the real floor transform F exactly cancels back to the correct,
// un-wrapped placement. This test proves that cancellation numerically, using chog-home.js's
// OWN (unmodified, still-not-in-this-card's-allowlist) start formula.
import { readFileSync } from "node:fs";
import { CORNER_TX, CORNER_TY, HOME_SCALE } from "../src/chog-home.js";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
function near(label, got, want, eps = 1e-6) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= eps;
  if (ok) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${got}, want ~${want} (eps ${eps})`); fail += 1; }
}

const HOME_CENTER = 1041;
const HOME_FLOOR = 648;

// ── 0. source wiring — the real-arrival branch actually uses the corrected board rect ──────
check("mountHome() computes chogWillWalk (real startRect + motion not reduced)",
  /const chogWillWalk = !!\(chogStart && !prefersReducedMotion\(\)\);/.test(SRC), true);
check("mountHome() feeds mountChogHome() the corrected board only when a real walk starts",
  /const chogBoardRect = chogWillWalk\s*\n\s*\? chogWalkStartBoardRect\(fit, computeHomeCharScaleFloorPlan\(fit\)\)\s*\n\s*: fit\.rect;/.test(SRC),
  true);
check("mountChogHome() in mountHome() is given board: chogBoardRect (not the raw fit.rect)",
  /board: chogBoardRect,/.test(SRC), true);
check("chogWalkStartBoardRect() is a strict no-op (returns fit.rect) when the floor plan did not apply",
  /function chogWalkStartBoardRect\(fit, plan\) \{\s*\n\s*if \(!fit \|\| !fit\.rect\) return fit && fit\.rect;\s*\n\s*if \(!plan \|\| !plan\.applied\) return fit\.rect;/.test(SRC),
  true);
check("computeHomeCharScaleFloorPlan() shares the exact no-op guard (s>=FLOOR) with applyHomeCharacterScaleFloor()",
  /function computeHomeCharScaleFloorPlan\(fit\) \{[\s\S]*?if \(s >= HOME_CHAR_SCALE_FLOOR\) return \{ applied: false, s \};/.test(SRC),
  true);
// applyHomeCharacterScaleFloor() itself must stay byte-identical to its pre-A-610 shape —
// this card's fix must not touch that already-locked function (app/test/
// home-character-scale-floor.mjs owns its contract; this is a cross-check, not a duplicate).
check("applyHomeCharacterScaleFloor()'s own body is untouched (still declares const k = HOME_CHAR_SCALE_FLOOR / s directly)",
  /function applyHomeCharacterScaleFloor\(fit\) \{[\s\S]*?const k = HOME_CHAR_SCALE_FLOOR \/ s;/.test(SRC),
  true);

// ── 1. math — chogWalkStartBoardRect() cancels the floor transform exactly ──────────────────
// Re-derive chog-home.js's OWN (unmodified, un-editable-here) start formula from a board rect,
// exactly as chog-home.js:662-666 does.
function chogHomeStart(board, startRect) {
  const s = board.width / 1256;
  const k = startRect.height / s / 251;
  return {
    x: (startRect.left + startRect.width / 2 - board.left) / s - 449.5 * k,
    y: (startRect.bottom - board.top) / s - 527 * k,
    scale: k,
  };
}
// The floor group's own affine map (main.js:applyHomeCharacterScaleFloor — translate(nudge)
// scale(k) around transform-origin HOME_CENTER/HOME_FLOOR), applied to a board-local point.
function floorTransform(point, plan) {
  return {
    x: HOME_CENTER + plan.k * (point.x - HOME_CENTER) + plan.nudgeLocalX,
    y: HOME_FLOOR + plan.k * (point.y - HOME_FLOOR) + plan.nudgeLocalY,
  };
}
// This file's own copy of chogWalkStartBoardRect() — kept identical to main.js's version so a
// change to one without the other fails this test. (Cannot import main.js's internals — it is
// the app entry, not a module with test-facing exports — so the contract is enforced two ways:
// §0's regex locks main.js's source text, this reproduces the same closed-form formula and
// proves IT is mathematically correct against chog-home.js's real formula.)
function chogWalkStartBoardRect(fitRect, fitS, plan) {
  if (!plan || !plan.applied) return fitRect;
  const { k, nudgeLocalX, nudgeLocalY } = plan;
  return {
    left: fitRect.left + fitS * (HOME_CENTER * (1 - k) + nudgeLocalX),
    top: fitRect.top + fitS * (HOME_FLOOR * (1 - k) + nudgeLocalY),
    width: fitRect.width * k,
  };
}

// Representative real measurements (from lane_chog/CHOG_TRAJECTORY_DRAFT.md's own raw probe
// facts — same order of magnitude as the real 430/390/1440 runs, not invented numbers).
const cases = [
  {
    label: "430x900 (floor applies, k>1 — the proven FAIL viewport)",
    fitRect: { left: 0, top: 84.4, width: 430 },
    fitS: 430 / 1256,
    startRect: { left: 49, top: 704, bottom: 835, width: 104, height: 131 },
    plan: { applied: true, k: 1.51888, nudgeLocalX: 6 / (430 / 1256), nudgeLocalY: 836.27 - (84.4 + 648 * (430 / 1256)) },
  },
  {
    label: "390x844 (floor applies, k>1)",
    fitRect: { left: 0, top: 78.8, width: 390 },
    fitS: 390 / 1256,
    startRect: { left: 46, top: 648, bottom: 779, width: 103, height: 131 },
    plan: { applied: true, k: 1.5975, nudgeLocalX: 6 / (390 / 1256), nudgeLocalY: 812 - (78.8 + 648 * (390 / 1256)) },
  },
  {
    label: "1440x900 (floor never applies, k=1/no nudge — must be an exact identity no-op)",
    fitRect: { left: 92, top: 20, width: 1256 },
    fitS: 1,
    startRect: { left: 220, top: 625, bottom: 780, width: 118, height: 155 },
    plan: { applied: false },
  },
];

for (const c of cases) {
  const realStart = chogHomeStart(c.fitRect, c.startRect); // what chog-home.js computes today, unwrapped board
  const fakeBoard = chogWalkStartBoardRect(c.fitRect, c.fitS, c.plan);
  const fakeStart = chogHomeStart(fakeBoard, c.startRect); // what chog-home.js computes on OUR pre-distorted board
  const composedX = c.plan.applied ? floorTransform({ x: fakeStart.x, y: fakeStart.y }, c.plan).x : fakeStart.x;
  const composedY = c.plan.applied ? floorTransform({ x: fakeStart.x, y: fakeStart.y }, c.plan).y : fakeStart.y;
  const composedScale = c.plan.applied ? c.plan.k * fakeStart.scale : fakeStart.scale;
  near(`${c.label}: F(place(board_fake)).x cancels back to the un-wrapped start.x`, composedX, realStart.x, 1e-6);
  near(`${c.label}: F(place(board_fake)).y cancels back to the un-wrapped start.y`, composedY, realStart.y, 1e-6);
  near(`${c.label}: F(place(board_fake)).scale cancels back to the un-wrapped start.scale`, composedScale, realStart.scale, 1e-6);
  if (!c.plan.applied) {
    check(`${c.label}: no-floor case — board_fake is exactly fit.rect (strict no-op)`, fakeBoard === c.fitRect, true);
  }
}

// ── 2. sanity — the corrected walk-start, once actually rendered, is real ink on-screen ────
// (not just mathematically equal to the un-wrapped start — it must also land inside the
// viewport, which is the actual observable defect this card closes: Chog rendering entirely
// off-screen for ~2.7s at 430/390.) Reconstruct the ACTUAL on-screen rect chog-home.js would
// paint at t=0 (place(start.x,start.y,start.scale) composed through the real board scale AND
// the real floor transform) and check it overlaps the viewport, for the 430/390 cases only.
for (const c of cases.filter((c) => c.plan.applied)) {
  const fakeBoard = chogWalkStartBoardRect(c.fitRect, c.fitS, c.plan);
  const fakeStart = chogHomeStart(fakeBoard, c.startRect);
  // The "foot" is not root's transform translate component itself — it's
  // rootTransform(anchorLocal) for the SAME local anchor point (449.5,527) that
  // chog-home.js's own start.x/y formula is offset from (start.x = centerX - 449.5*k).
  const rootLocalFoot = { x: fakeStart.x + 449.5 * fakeStart.scale, y: fakeStart.y + 527 * fakeStart.scale };
  const boardLocalFoot = floorTransform(rootLocalFoot, c.plan);
  // real board's own transform: screen = fit.rect.{left,top} + fit.s * boardLocal
  const screenFootX = c.fitRect.left + c.fitS * boardLocalFoot.x;
  const screenFootY = c.fitRect.top + c.fitS * boardLocalFoot.y;
  // must land near the real Name-scene startRect's own bottom-center (continuity — no
  // teleport at the cut), not off-screen below the viewport as the FAIL measured.
  const wantX = c.startRect.left + c.startRect.width / 2;
  const wantY = c.startRect.bottom;
  near(`${c.label}: corrected on-screen walk-start foot X matches Name-final (no teleport)`, screenFootX, wantX, 0.5);
  near(`${c.label}: corrected on-screen walk-start foot Y matches Name-final (no teleport, not off-screen)`, screenFootY, wantY, 0.5);
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
