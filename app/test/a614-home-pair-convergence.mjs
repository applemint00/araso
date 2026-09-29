// [A-614 PHASE 2 repair] Contract test for the Home walk-pair convergence fix — network 0,
// browser 0, same "cut the real source and check the contract" pattern as
// app/test/a610-chog-walk-start-floor.mjs / app/test/home-character-scale-floor.mjs. Live/
// measured proof (real screencast + RAF-sampled pixel-ink trajectory at 1440/430/390, before
// vs after) lives in
// _private/ops/receipts/A614_parallel_close_wave/home_pair/{HOME_PAIR.md,raw,screenshots}/ —
// this file locks the math/wiring contract so a future edit can't silently regress the fix or
// widen it onto 1440.
//   node app/test/a614-home-pair-convergence.mjs
//
// Bug (A-612 BEFORE.md §B): Piggy (main.js) and Chog (chog-home.js) each walk an independent,
// linear, point-to-point lerp from their own real Name-final rect to their own separate
// resting target, over the same nominal duration/blend — so at real elapsed t they are at the
// same fractional progress u along two unrelated chords, and only look like a pair near u→1
// (measured 408→220→192→161→32.5px at 430, ~160-220px apart through mid-walk — FAIL against
// the card's "read as one pair by MID" bar).
//
// Fix (positional geometry only, no new art, no frame/timing changes): feed the SAME eased,
// front-loaded curve `pairConvergenceEase(u)` (chog-home.js, exported so both files share one
// formula) into ONLY the position/scale lerp fraction for both characters — never the walk
// frame index or the blend/opacity crossfade, which keep using the original linear time. The
// curve is an identity at the endpoints (eased(0)=0, eased(1)=1), so true Name-final starts and
// the approved A-608 settle are algebraically unaffected; only the pacing in between changes.
// Gated by `pairConvergeActive` (main.js) = `computeHomeCharScaleFloorPlan(fit).applied` — the
// exact same narrow-viewport gate A-610 already uses — so 1440 (floor never applies) never sees
// `pairConverge`/`pairConvergeActive` turn true and both files fall through to the original raw
// `u`, a strict no-op there.
import { readFileSync } from "node:fs";
import { pairConvergenceEase, PAIR_CONVERGE_POWER } from "../src/chog-home.js";

const MAIN_SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CHOG_SRC = readFileSync(new URL("../src/chog-home.js", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
function near(label, got, want, eps = 1e-9) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= eps;
  if (ok) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${got}, want ~${want} (eps ${eps})`); fail += 1; }
}

// ── 0. source wiring — main.js computes ONE shared gate and threads it into both characters ──
check("mountHome() derives pairConvergeActive from the same computeHomeCharScaleFloorPlan(fit).applied gate A-610 already uses",
  /const pairConvergeActive = !!\(fit && computeHomeCharScaleFloorPlan\(fit\)\?\.applied\);/.test(MAIN_SRC), true);
check("A-610's own chogBoardRect line is untouched (still its own computeHomeCharScaleFloorPlan(fit) call — that card's contract test locks this exact text)",
  /const chogBoardRect = chogWillWalk\s*\n\s*\? chogWalkStartBoardRect\(fit, computeHomeCharScaleFloorPlan\(fit\)\)\s*\n\s*: fit\.rect;/.test(MAIN_SRC),
  true);
check("mountChogHome() is only told to converge when it will actually walk AND the gate is on",
  /pairConverge: chogWillWalk && pairConvergeActive,/.test(MAIN_SRC), true);
check("Piggy's own position/scale lerp is fed posU (eased when active, raw u otherwise)",
  /const posU = pairConvergeActive \? pairConvergenceEase\(u\) : u;/.test(MAIN_SRC), true);
check("Piggy's translate/scale template literal uses posU, not the raw linear u",
  /translate\(\$\{lerp\(ENTER_X, 0, posU\)\}px, \$\{lerp\(entryY, 0, posU\)\}px\) scale\(\$\{lerp\(entryScale, 1, posU\)\}\)/.test(MAIN_SRC),
  true);
check("Piggy's walk frame index still uses k (original linear time) — gait timing/frame order untouched",
  /walk\.src = `\$\{MOTION_DIR\}\/walk\/f\$\{String\(Math\.floor\(k \/ HOME_FPS\) % HOME_WALK_FRAMES\)\.padStart\(2, "0"\)\}\.svg`;/.test(MAIN_SRC),
  true);
check("main.js imports pairConvergenceEase from chog-home.js (one shared formula, not a duplicate)",
  /import \{ chogHomeMarkup, mountChogHome, CHOG_HOME_GEOMETRY, pairConvergenceEase \} from "\.\/chog-home\.js";/.test(MAIN_SRC),
  true);

check("chog-home.js exports pairConvergenceEase", typeof pairConvergenceEase, "function");
check("chog-home.js exports PAIR_CONVERGE_POWER as a finite number > 1 (front-loaded, not linear/back-loaded)",
  Number.isFinite(PAIR_CONVERGE_POWER) && PAIR_CONVERGE_POWER > 1, true);
check("mountChogHome() opts destructure includes pairConverge, defaulting false (existing callers untouched)",
  /pairConverge = false \} = opts;/.test(CHOG_SRC), true);
check("Chog's walking branch computes posU gated by pairConverge",
  /const posU = pairConverge \? pairConvergenceEase\(u\) : u;/.test(CHOG_SRC), true);
check("Chog's place() call uses posU for x/y/scale",
  /place\(\s*\n\s*lerp\(start\.x, CORNER_TX, posU\),\s*\n\s*lerp\(start\.y, CORNER_TY, posU\),\s*\n\s*lerp\(start\.scale, HOME_SCALE, posU\),\s*\n\s*\);/.test(CHOG_SRC),
  true);
check("Chog's walk frame index (move-based) and blend (walkElapsed-based) are untouched by posU",
  /walk\.src = `\$\{DIR\}\/walk-\$\{String\(Math\.floor\(move \/ WALK_FPS_MS\) % WALK_FRAMES\)\.padStart\(2, "0"\)\}\.png`;[\s\S]*?const blend = Math\.min\(1, walkElapsed \/ WALK_BLEND_MS\);/.test(CHOG_SRC),
  true);
// Every OTHER mountChogHome() call site (mountSecondAway/mountAway/mountReturnView) must still
// compile with the new opt absent — since it defaults false and those sites pass
// startRect: null (never reach the `if (startRect && !reduced)` branch), they are provably
// unaffected; this just proves the card's writer didn't touch them.
check("mountSecondAway/mountAway/mountReturnView chog mounts still pass startRect: null (untouched, unaffected by the new opt)",
  (MAIN_SRC.match(/startRect: null,/g) || []).length >= 3, true);

// ── 1. math — pairConvergenceEase() is a true front-loaded reparametrization of [0,1] ────────
near("pairConvergenceEase(0) === 0 — true Name-final start is an exact identity (no teleport)", pairConvergenceEase(0), 0);
near("pairConvergenceEase(1) === 1 — approved A-608 settle is an exact identity (byte-identical settle)", pairConvergenceEase(1), 1);
{
  const samples = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];
  let monotonic = true;
  let frontLoaded = true;
  let inRange = true;
  let prev = -Infinity;
  for (const u of samples) {
    const e = pairConvergenceEase(u);
    if (e < prev) monotonic = false;
    prev = e;
    if (u > 0 && u < 1 && !(e > u)) frontLoaded = false; // strictly ahead of linear, front-loaded
    if (e < 0 || e > 1) inRange = false;
  }
  check("pairConvergenceEase() is monotonically non-decreasing over [0,1] (no relative-position snap)", monotonic, true);
  check("pairConvergenceEase(u) > u for every interior u (genuinely front-loaded, not linear/back-loaded)", frontLoaded, true);
  check("pairConvergenceEase(u) stays within [0,1] for u in [0,1] (never overshoots past true start/settle)", inRange, true);
}
// clamps outside [0,1] the same way the two call sites' own u already does (Math.min(1,...)/
// division never produces negative u here, but the function itself is defensively clamped).
near("pairConvergenceEase(-0.3) clamps to eased(0) = 0", pairConvergenceEase(-0.3), 0);
near("pairConvergenceEase(1.4) clamps to eased(1) = 1", pairConvergenceEase(1.4), 1);

// ── 2. gate — when pairConverge/pairConvergeActive is false, posU is BYTE-identical to u ─────
// (the 1440 no-op contract: this is what "the code path is a no-op" reduces to arithmetically,
// since 1440's own homeCharPlan.applied is always false — s>=HOME_CHAR_SCALE_FLOOR there,
// A-610's own no-op guard, untouched by this card.)
function posUFormula(u, active) {
  return active ? pairConvergenceEase(u) : u;
}
for (const u of [0, 0.1, 0.306, 0.5, 0.653, 0.861, 1]) {
  check(`posUFormula(${u}, false) === u exactly (1440 gate off ⇒ untouched linear lerp fraction)`, posUFormula(u, false), u);
}
// and when the gate IS on (narrow, real walk), posU strictly differs from u in the interior —
// i.e. the fix is actually live, not a no-op that silently never fires.
{
  const u = 0.306;
  const on = posUFormula(u, true);
  check(`posUFormula(${u}, true) !== u (fix is live when the gate is on)`, on !== u, true);
  check(`posUFormula(${u}, true) > u (front-loaded: converges faster than linear time, not slower)`, on > u, true);
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
