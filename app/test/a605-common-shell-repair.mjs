// [A-605] Contract test for the common-shell repair (supersedes malformed A-604) — same
// "cut the real source and check the contract" pattern as home-arrival.mjs /
// home-character-scale-floor.mjs. network 0, browser 0. Live/measured proof (pixel rects,
// overlap %, no-clip/no-overflow) lives in
// the A-605 run records (raw facts + screenshots, kept outside this repo) — this file
// only locks the source contract so a future edit can't silently regress it.
//   node app/test/a605-common-shell-repair.mjs
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}

function cutCss(selector) {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`style.css 에서 못 찾음: ${selector}`);
  const end = CSS.indexOf("}", start);
  return CSS.slice(start, end);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

// ── FAIL 1 — auth(birth) narrow: Chog beside/below, not stacked above ──────────────────────
// column-reverse flips visual order (DOM stays chog-then-paper, main.js untouched) so paper
// renders first (top) and chog second (bottom); align-items:flex-start keeps chog left, not
// pushed right by the row layout's own flex-end.
const authNarrowRepairCss = (() => {
  const marker = "flex-direction: column-reverse;";
  const start = CSS.indexOf(marker);
  if (start < 0) throw new Error("style.css 에서 .authCard narrow column-reverse 규칙 못 찾음");
  const blockStart = CSS.lastIndexOf("{", start);
  const blockEnd = CSS.indexOf("}", start);
  return CSS.slice(blockStart, blockEnd);
})();
check("auth narrow: .authCard flips to column-reverse (paper visually first, chog second)",
  /flex-direction:\s*column-reverse;/.test(authNarrowRepairCss), true);
check("auth narrow: align-items:flex-start (chog pinned left, not flex-end/right)",
  /align-items:\s*flex-start;/.test(authNarrowRepairCss), true);
check("auth narrow: gap uses the shared grid token, not a repeated magic number",
  /gap:\s*var\(--grid-4\);/.test(authNarrowRepairCss), true);
check("auth narrow rule still scoped under max-width:640px (same breakpoint as A-600/A-603)",
  CSS.slice(0, CSS.indexOf(authNarrowRepairCss)).lastIndexOf("@media (max-width: 640px)") > -1, true);

// ── FAIL 2 — Name narrow: outer board scale gets a floor, internal coordinates untouched ───
check("NAME_SCENE_SCALE_FLOOR = 0.42 (reuses the Owner-approved Home value, no new magic number)",
  /const NAME_SCENE_SCALE_FLOOR = 0\.42;/.test(SRC), true);
const fitNameSceneSrc = cut("function fitNameScene() {", "\nfunction mountName()");
check("fitNameScene() takes the natural fit AND the floor (Math.max — floor never shrinks it)",
  /const scale = Math\.max\(natural, NAME_SCENE_SCALE_FLOOR\);/.test(fitNameSceneSrc), true);
check("fitNameScene() still centers the same 1280x800 board (no internal coordinate rewritten)",
  /translate\(\$\{\(window\.innerWidth - 1280 \* scale\) \/ 2\}px, \$\{\(window\.innerHeight - 800 \* scale\) \/ 2\}px\) scale\(\$\{scale\}\)/.test(fitNameSceneSrc),
  true);

// ── FAIL 3 — Home walk narrow: same floor carried through the walk, not just at settle ─────
const beginHomeWalkSrc = cut('  host.dataset.arrival = "1";', "\n  let elapsed = 0;");
check("walk start applies the SAME scale floor used at settle (no natural-scale-only walk)",
  /applyHomeCharacterScaleFloor\(fit\);/.test(beginHomeWalkSrc), true);
// the resize-guard added by A-603 (skip re-applying mid-walk, so a mid-walk resize can't
// change k) must still be intact — this card adds an EARLIER application, not a different one.
const mountHomeSrc = cut("function mountHome({ cardClaimed = state.sendCardVisible } = {}) {", "\n// Home 3분 무입력 졸기 타이머");
check("resize listener still guards against re-applying mid-walk (unchanged from A-603)",
  /if \(host\.dataset\.arrival !== "1"\) applyHomeCharacterScaleFloor\(freshFit\);/.test(mountHomeSrc), true);

// ── FAIL 4 — First Job narrow: card viewer-left, character group viewer-right/lower-right ──
check("HOME_CHAR_COLLISION_NUDGE_VIEWPORT_PX constant present (extra reflow offset, viewport px)",
  /const HOME_CHAR_COLLISION_NUDGE_VIEWPORT_PX = \{ x: 96, y: 40 \};/.test(SRC), true);
check("homeCharacterCollisionActive() scopes the reflow to sendstay + an actually-visible Send card",
  /function homeCharacterCollisionActive\(\) \{\s*return state\.scene === "sendstay" && !!state\.sendCardVisible;/.test(SRC),
  true);
const applyFnSrc = cut("function applyHomeCharacterScaleFloor(fit) {", "\n// 정본 배치");
check("collision reflow only ever runs inside the existing s < FLOOR branch (desktop untouched)",
  applyFnSrc.indexOf('if (s >= HOME_CHAR_SCALE_FLOOR) return { applied: false, s };') <
    applyFnSrc.indexOf("const collisionActive = homeCharacterCollisionActive();"),
  true);
// [A-608 OWNER CORRECTION — MOBILE HOME CHARACTER CLUSTER MUST NOT MOVE BETWEEN CARDS] the
// collision term used to add 96px to Chog's own X nudge whenever First Job's card was up —
// removed so Chog sits at the same slot in Home settled/First Job/Records ("card state does
// not shift the group"). `collisionActive` itself is still computed/read (informational,
// `data-collision-reflow` attribute) but no longer feeds the nudge.
check("X nudge no longer adds the collision term (Chog's own slot is now card-state-independent)",
  !/HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX\.x \+ \(collisionActive \? HOME_CHAR_COLLISION_NUDGE_VIEWPORT_PX\.x : 0\)/.test(applyFnSrc),
  true);
// [A-607 repair pass] a second, WEB-scoped rule with this exact same selector text was added
// ahead of this narrow one (First Job's card now also reads the left rail on web — lane_d
// finding, see WRITER.md's "Repair pass" section) — anchor the search inside the
// `@media (max-width: 640px)` block specifically so this still cuts the narrow-only rule,
// not the new web one.
const cardAnchorNarrowCss = cutCss('@media (max-width: 640px) {\n  .stage[data-scene="sendstay"] .cardAnchor {');
check("First Job card pins to --mobile-inset (viewer-left) only on the sendstay scene",
  /left:\s*var\(--mobile-inset\);/.test(cardAnchorNarrowCss), true);
check("First Job card's vertical offset (-48px) is preserved — only horizontal changed",
  /transform:\s*translate\(0, calc\(-50% - 48px\)\);/.test(cardAnchorNarrowCss), true);
// Explore's own reuse of .cardAnchor#sendCardAnchor (Second Journey) must NOT be scoped by
// this rule — the selector requires data-scene="sendstay" specifically.
check("card-left rule does not touch Explore's own .cardAnchor reuse (scene-scoped selector)",
  cardAnchorNarrowCss.includes('data-scene="sendstay"'), true);

// ── FAIL 5 — shared shell: tokens actually govern the repaired scenes, not just :root ──────
check("auth narrow fix consumes --grid-4 (already checked above) — re-asserted for FAIL 5 intent",
  /gap:\s*var\(--grid-4\);/.test(authNarrowRepairCss), true);
check("First Job card-left fix consumes --mobile-inset (already checked above) — re-asserted for FAIL 5 intent",
  /left:\s*var\(--mobile-inset\);/.test(cardAnchorNarrowCss), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
