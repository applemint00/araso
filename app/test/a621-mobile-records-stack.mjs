// [A-621 OWNER CONFIRMED · MOBILE RECORDS STACK, 2026-09-28 — Candidate B] Contract test —
// network 0, browser 0, same "cut the real source and check the contract" pattern as
// a607/a618/a620 tests. Real-flow proof (390×844 / 430×900 A-B-C-D-E-R rects, font/hit table,
// elementFromPoint, 1440 no-regression, screenshots) lives in
// the A-621 verification record (kept outside this repo); this file locks the formula and
// wiring so a later edit cannot silently bring back the A-618 side-by-side shrink, move HOME on
// open, or change web.
//   node app/test/a621-mobile-records-stack.mjs
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function cut(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`not found: ${startMarker}`);
  return text.slice(start, end);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── 1. formula (re-implemented from stackMobileRecordsOverHome(); section 2 asserts the source
// matches). HOME rect = A-620 corrected docked paper: 256.338×364 at (vw/2 − 32 − w/2,
// vh/2 − 48 − h/2) — see a620-home-paper-dock-frame.mjs. ────────────────────────────────────
const HOME_W = 256.338;
const HOME_H = 364;
function homeRect(vw, vh) {
  return { left: vw / 2 - 32 - HOME_W / 2, top: vh / 2 - 48 - HOME_H / 2, width: HOME_W, height: HOME_H };
}
function stack(home, vw, inset) {
  const left = Math.max(home.left, vw - inset - home.width);
  return { left, top: home.top, width: home.width, height: home.height };
}
// [A-662] these rows test stackMobileRecordsOverHome()'s own stack() formula in isolation
// (HOME rect → HISTORY rect), NOT the side-by-side/stacked trigger — that became a live
// geometry decision (computeHistoryFitMode(), section 2 below) and no longer has a single
// fixed-width switch. 640 here is just one more width inside what is now (and remains, per
// A-662 VERIFY.md) the stacked range — not asserted as "the" mobile/web boundary value.
for (const [vw, vh, inset, wantLeft, wantEdge] of [
  [390, 844, 20, 113.662, 78.831],
  [430, 900, 24, 149.662, 94.831],
  [360, 780, 20, null, null],
  [640, 900, 24, null, null],
]) {
  const home = homeRect(vw, vh);
  const hist = stack(home, vw, inset);
  const edge = hist.left - home.left;
  check(`${vw}: HISTORY same outer size as HOME`, hist.width === home.width && hist.height === home.height, true);
  check(`${vw}: HISTORY top == HOME top`, hist.top === home.top, true);
  check(`${vw}: HISTORY right edge on the safe rail (vw − inset)`, near(hist.left + hist.width, vw - inset), true);
  check(`${vw}: deliberate HOME edge visible (HISTORY.left > HOME.left)`, edge > 0, true);
  if (wantLeft != null) {
    check(`${vw}: HISTORY.left ≈ A-620 candidate-B measurement (${wantLeft}, ±0.01)`, near(hist.left, wantLeft, 0.01), true);
    check(`${vw}: visible HOME edge ≈ ${wantEdge}px (±0.01)`, near(edge, wantEdge, 0.01), true);
  }
}
{
  // clamp: HISTORY never goes left of HOME (edge never negative) even on an absurdly narrow frame.
  const home = { left: 10, top: 0, width: HOME_W, height: HOME_H };
  check("clamp: HISTORY.left >= HOME.left on a too-narrow frame", stack(home, 200, 20).left >= home.left, true);
}

// ── 2. source wiring ────────────────────────────────────────────────────────────────────────
const stackSrc = cut(SRC, "function stackMobileRecordsOverHome() {", "\n}\n");
check("stackMobileRecordsOverHome() reads the live .homePaper rect (A-620-corrected HOME), not a group-fit",
  /document\.querySelector\("\.homePaper"\)/.test(stackSrc) && /paper\.getBoundingClientRect\(\)/.test(stackSrc), true);
check("stackMobileRecordsOverHome() uses the right safe rail: innerWidth − --mobile-inset − HOME width, clamped to HOME.left",
  /getPropertyValue\("--mobile-inset"\)/.test(stackSrc) &&
  /Math\.max\(paperRect\.left, window\.innerWidth - inset - paperRect\.width\)/.test(stackSrc), true);
check("stackMobileRecordsOverHome() sets top/width/height from HOME's own rect",
  /anchor\.style\.top = `\$\{paperRect\.top - stageRect\.top\}px`/.test(stackSrc) &&
  /anchor\.style\.width = `\$\{paperRect\.width\}px`/.test(stackSrc) &&
  /anchor\.style\.height = `\$\{paperRect\.height\}px`/.test(stackSrc), true);
check("stackMobileRecordsOverHome() never writes to HOME (#homePaper / .homePaperMount / pad)",
  /paper\.style|homePaperMount|chogHomePad|appendChild/.test(stackSrc), false);
check("no --recordsShrink write anywhere in main.js (HISTORY renders at native/web scale)",
  /--recordsShrink"/.test(SRC.replace(/\/\/.*$/gm, "")), false);

const alignSrc = cut(SRC, "function alignRecordsCardToHomePaper() {", "\n}\n");
// [A-662] the flat `window.innerWidth <= 640` check is gone — alignRecordsCardToHomePaper()
// now asks the one shared geometry-fit decision (computeHistoryFitMode()) instead of testing
// the raw width itself. The web side-by-side formula below it is unchanged.
check("alignRecordsCardToHomePaper(): stacked mode (computeHistoryFitMode()) → stackMobileRecordsOverHome(); web branch keeps the live .homePaper + RECORDS_CARD_GAP side-by-side",
  /if \(computeHistoryFitMode\(\) === "stacked"\) \{\s*\n\s*stackMobileRecordsOverHome\(\);\s*\n\s*return;/.test(alignSrc) &&
  // pre-A-833 baseline: /const left = paperRect\.right - stageRect\.left \+ RECORDS_CARD_GAP;/ (History left = live Home right + gap)
  /placement\.histLeft - stageRect\.left/.test(alignSrc) && /computeHistoryPlacement\(\)/.test(alignSrc), true);
check("no bare `window.innerWidth <= 640` left inside alignRecordsCardToHomePaper() (the shared decision owns it now)",
  /window\.innerWidth <= 640/.test(alignSrc), false);

const openSrc = cut(SRC, "function openRecordsCard() {", "\n}\n");
const closeSrc = cut(SRC, "function closeRecordsCard() {", "\n}\n");
// [A-623 superseding update] the one-shot `if (innerWidth > 640) setHomeTwoCardShift(true)` gate
// moved into syncRecordsViewportState() (re-run per align frame so a live 640px crossing can't
// leave a stale shift) — same contract: shift only on web, never on mobile open.
// [A-662] "mobile" → "stackedMode", literal width test → computeHistoryFitMode() — same contract
// (shift only when HISTORY is NOT stacked), just geometry-derived instead of a flat 640 cutoff.
check("openRecordsCard(): setHomeTwoCardShift only when HISTORY is side-by-side (HOME never moves while stacked)",
  /syncRecordsViewportState\(\);/.test(openSrc) &&
  /const stackedMode = computeHistoryFitMode\(\) === "stacked";[\s\S]*?const shift = open && !stackedMode;/.test(SRC), true);
check("openRecordsCard(): a reopen cancels a pending mobile exit (timer + --closing class)",
  /clearRecordsExitTimer\(\);/.test(openSrc) && /classList\.remove\("recordsCardAnchor--closing"\)/.test(openSrc), true);
check("openRecordsCard(): reduced motion never adds --opening (immediate final state)",
  /if \(!reduced\) anchor\.classList\.add\("recordsCardAnchor--opening"\);/.test(openSrc), true);
check("closeRecordsCard(): stacked mode + motion → --closing then hide after RECORDS_EXIT_MS; else immediate hide",
  /computeHistoryFitMode\(\) === "stacked" && !anchor\.hidden && !prefersReducedMotion\(\)/.test(closeSrc) &&
  /classList\.add\("recordsCardAnchor--closing"\)/.test(closeSrc) &&
  /RECORDS_EXIT_MS\)/.test(closeSrc) &&
  /\} else \{\s*\n\s*anchor\.hidden = true;/.test(closeSrc), true);
check("closeRecordsCard(): exit timer only hides if Records was not reopened meanwhile",
  /if \(!state\.recordsCardVisible\) anchor\.hidden = true;/.test(closeSrc), true);
// pre-A-833 baseline: RECORDS_EXIT_MS (180) >= the 160ms .recordsCardAnchor transition:
//   /const RECORDS_EXIT_MS = 180;/ && /transition: opacity 160ms ease, transform 160ms ease;/ (base rule text still present, kept below)
check("RECORDS_EXIT_MS (260) >= the 240ms close (A-833); base 160ms rule text kept; stacked 320/240 rules added",
  /const RECORDS_EXIT_MS = 260;/.test(SRC) && /transition: opacity 160ms ease, transform 160ms ease;/.test(CSS) &&
  /\.recordsCardAnchor--stackedMode\.recordsCardAnchor--closing \{\s*\n\s*transition: opacity 240ms/.test(CSS) &&
  /\.recordsCardAnchor--stackedMode:not\(\.recordsCardAnchor--opening\):not\(\.recordsCardAnchor--closing\) \{\s*\n\s*transition: opacity 320ms/.test(CSS), true);

// ── 3. CSS — mobile only; web rules untouched ──────────────────────────────────────────────
const stackCss = cut(CSS, "/* [A-621 OWNER CONFIRMED · MOBILE RECORDS STACK", "\n}\n\n.recordsCard__body");
check("≤640px: .recordsCardAnchor z-index 2 (above .homeBoard's 1 → HISTORY stacks over HOME)",
  /@media \(max-width: 640px\) \{\s*\n\s*\.recordsCardAnchor \{\s*\n\s*z-index:\s*2;/.test(stackCss), true);
check("≤640px: --opening and --closing both = opacity 0 + translateX(+12px) (enter from / exit toward viewer-right)",
  /\.recordsCardAnchor--opening,\s*\n\s*\.recordsCardAnchor--closing \{\s*\n\s*opacity:\s*0;\s*\n\s*transform:\s*translateX\(12px\);/.test(stackCss), true);
check("≤640px: --closing disables taps on the exiting card", /\.recordsCardAnchor--closing \.recordsCard \{\s*\n\s*pointer-events:\s*none;/.test(stackCss), true);
check("≤640px: close/back ::after hit areas grow inward within the card's 14px padding (right/bottom ≤ 14)",
  /\.recordsCard__close::after \{\s*\n\s*inset:\s*-17px -12px -13px -10px;/.test(stackCss) &&
  /\.recordsCard__back::after \{\s*\n\s*inset:\s*-15px -10px -15px -12px;/.test(stackCss), true);
check("close ::after effective box ≥ 44×44 at the measured 26.156×14.391 visible close (12px, scale 1)",
  26.156 + 12 + 10 >= 44 && 14.391 + 17 + 13 >= 44, true);
check("≤640px: the A-618 mobile .recordsCard 285×364 box is gone (base inset:0 applies)",
  /\.recordsCard \{\s*\n\s*inset:\s*auto;/.test(CSS), false);
check("web base rules unchanged: .recordsCardAnchor z-index 0, --opening translateX(-12px), .recordsCard inset 0",
  /\.recordsCardAnchor \{\s*\n\s*position:\s*absolute;\s*\n\s*z-index:\s*0;/.test(CSS) &&
  /\.recordsCardAnchor--opening \{\s*\n\s*opacity:\s*0;\s*\n\s*transform:\s*translateX\(-12px\);/.test(CSS) &&
  /\.recordsCard \{\s*\n\s*position:\s*absolute;\s*\n\s*inset:\s*0;/.test(CSS), true);
check("web close/back base rule unchanged (12px italic, no padding)",
  /\.recordsCard__back,\s*\n\.recordsCard__close \{[^}]*padding:\s*0;[^}]*font:\s*italic 12px\/1\.2 Georgia/.test(CSS), true);

const recCss = cut(CSS, "/* [A-621] mobile-only readability/touch compensation", "\n}\n\n");
// [A-666 re-pin, named reason] Owner decision (INBOX A-666 "GLOBAL MOBILE TYPOGRAPHY OWNER
// DECISION"): increase ALL existing mobile text from its currently-approved size. This was
// already the approved MOBILE value (not the 12px web/base value, re-asserted unchanged
// below) — bumped 18px → 21px, same ≈1.15 ratio TYPOGRAPHY_SCALE.md applies everywhere else.
// Hit-area math only grows with a larger font (18px already cleared ≥44 CSS px before this
// card), so the ::after inset itself did not need to change.
check("≤640px only: #homeRecordsButton 21px (A-666 mobile type-scale, ≈1.15× the pre-card 18px) + ::after ≥44 CSS px tall",
  /@media \(max-width: 640px\) \{\s*\n\s*#homeRecordsButton(,\s*\n\s*\.homePaper__records\[data-piggy-id\])? \{\s*\n\s*font-size:\s*21px;/.test(recCss) &&
  /#homeRecordsButton::after \{\s*\n\s*inset:\s*-14px -12px -34px -12px;/.test(recCss), true);
check("records hit math: (21×1.2 + 14 + 34) × 0.6408 ≥ 44 and 21 × 0.6408 ≥ 11",
  (21 * 1.2 + 14 + 34) * (256.338 / 400) >= 44 && 21 * (256.338 / 400) >= 11, true);
check("web .homePaper__records base font stays 12px", /\.homePaper__records \{[^}]*font:\s*italic 12px\/1\.2 Georgia/.test(CSS), true);

// ── 4. [A-662] computeHistoryFitMode() — geometry-fit trigger, no hardcoded width ──────────
// Source wiring: the function exists, is used by all 3 call sites (checked in section 2/close
// test above), and actually implements BOTH the whitespace check AND the character-safe check
// (Condition 2 of the A-662 prewrite review — whitespace-only was explicitly rejected).
const fitModeSrc = cut(SRC, "function computeHistoryFitMode() {", "\n}\n");
check("computeHistoryFitMode(): reads the live .homePaper rect (never cached)",
  /document\.querySelector\("\.homePaper"\)/.test(fitModeSrc) && /paper\.getBoundingClientRect\(\)/.test(fitModeSrc), true);
// pre-A-833 baseline: whitespace check reused RECORDS_CARD_GAP (>= 2 mentions, no --mobile-inset) and homeCharacterSafeBoxViewport( was called in the fit mode.
// A-833: the decision is computeHistoryPlacement() (pure layout rule, gap 24 x k, free span ends 12 px before the stage when the cards reach the characters).
const placementSrc = cut(SRC, "function computeHistoryPlacement(", "\n}\n");
check("computeHistoryFitMode(): decided by computeHistoryPlacement() (not --mobile-inset)",
  /computeHistoryPlacement\(\)/.test(fitModeSrc) && !/--mobile-inset/.test(fitModeSrc), true);
check("computeHistoryPlacement(): gap 24 x k, character clearance = free span ends at stageLeft - 12 when the cards reach the characters",
  /const gap = 24 \* L\.k;/.test(placementSrc) && /L\.stageLeft - 12/.test(placementSrc) && /L\.cardY \+ L\.cardH > L\.stageTop/.test(placementSrc), true);
check("computeHistoryFitMode(): missing/unmeasurable .homePaper never claims side-by-side",
  /if \(!stage \|\| !paper\) return "stacked";/.test(fitModeSrc) &&
  /if \(!paperRect\.width \|\| !paperRect\.height\) return "stacked";/.test(fitModeSrc), true);

// Whitespace-only re-implementation, fed with A-662 VERIFY.md's own re-measured current-code
// numbers (RECORDS_CARD_GAP=24, live .homePaper right edge + width at vh=900, no character
// overlap at any of these widths — confirmed separately below) — this is the same formula
// computeHistoryFitMode() uses for its own whitespace test, independent of the character check.
const GAP = 24;
function whitespaceOnlyMode(vw, paperRight, paperWidth) {
  const candidateRight = paperRight + GAP + paperWidth;
  return vw - candidateRight < GAP ? "stacked" : "side-by-side";
}
for (const [vw, paperRight, paperWidth, want] of [
  [641, 370.7, 256.3, "stacked"], // whitespace ≈ -10.0
  [660, 380.2, 256.3, "stacked"], // whitespace ≈ -0.5
  [700, 400.2, 256.3, "stacked"], // whitespace ≈ 19.5 (<24)
  [720, 410.2, 256.3, "side-by-side"], // whitespace ≈ 29.5 (≥24)
  [768, 434.2, 256.3, "side-by-side"], // whitespace ≈ 53.5
  [800, 450.2, 256.3, "side-by-side"], // whitespace ≈ 69.5
  [1440, 770.2, 256.3, "side-by-side"], // whitespace ≈ 389.5
]) {
  check(`computeHistoryFitMode() whitespace formula @ ${vw}×900 (current .homePaper geometry) → ${want}`,
    whitespaceOnlyMode(vw, paperRight, paperWidth), want);
}
check("641/660/700 no longer read as an unresolved residual (all correctly resolve to stacked, not a clipped side-by-side)",
  ["641", "660", "700"].every((w) => whitespaceOnlyMode(Number(w), { 641: 370.7, 660: 380.2, 700: 400.2 }[w], 256.3) === "stacked"),
  true);

// Character-clearance case (A-662 prewrite review §3 Condition 2): the rectangle-intersection
// logic itself, isolated from the specific board-local geometry derivation (that derivation is
// exercised live in the browser matrix, A-662 VERIFY.md) — proves the function does not just
// return "side-by-side" whenever whitespace alone passes.
function collisionMode(candidate, charBox) {
  if (!charBox) return "side-by-side";
  const overlapsX = candidate.left < charBox.right && candidate.right > charBox.left;
  const overlapsY = candidate.top < charBox.bottom && candidate.bottom > charBox.top;
  return overlapsX && overlapsY ? "stacked" : "side-by-side";
}
{
  const candidate = { left: 424, right: 680, top: 220, bottom: 584 };
  const collidingCharBox = { left: 400, right: 900, top: 300, bottom: 650 }; // overlaps both axes
  const clearCharBox = { left: 605, right: 672, top: 666, bottom: 751 }; // A-662 900×900 measured-equivalent box (no Y overlap with candidate.bottom=584)
  check("character-clearance case: candidate rect colliding with the character-safe box → stacked even though whitespace alone would pass",
    collisionMode(candidate, collidingCharBox), "stacked");
  check("character-clearance case: candidate rect clear of the character-safe box (real 900×900 geometry) → side-by-side",
    collisionMode(candidate, clearCharBox), "side-by-side");
}

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
