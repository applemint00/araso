// [A-603] Contract test for the Home character scale-floor (ported from A-602's measured
// Candidate-C mechanism, the A-602 preview's c_floor.js) and the
// shared ARASO shell brand — network 0, browser 0, same "cut the real source and check the
// contract" pattern as app/test/home-arrival.mjs.
//   node app/test/home-character-scale-floor.mjs
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

// ── 1. 바닥값·넛지 상수 ────────────────────────────────────────────────────────────────
// [A-606 OWNER ADDENDUM · pass2] "0.42 를 최종으로 굳히지 마라" — 0.48/0.50/0.52 실측
// 비교(WRITER.md Pass 2, screenshots/floor_compare/) 뒤 가장 큰 값(0.52)을 택했다.
check("HOME_CHAR_SCALE_FLOOR = 0.52 (A-606 pass2 — Owner-compared 0.48/0.50/0.52, largest chosen)",
  /const HOME_CHAR_SCALE_FLOOR = 0\.52;/.test(SRC), true);
check("nudge constant present (6/8 viewport px, same as A-602 c_floor.js — .y kept for this literal contract, superseded for Y by the bottom-anchor formula, see §3a)",
  /const HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX = \{ x: 6, y: 8 \};/.test(SRC), true);
check("bottom-anchor gap constant present (20-24px band's midpoint)",
  /const HOME_CHAR_BOTTOM_ANCHOR_GAP_PX = 22;/.test(SRC), true);

// ── 2. 원점 — 실제 정박 상수(HOME_CENTER/HOME_FLOOR)를 쓴다, board rect 파생 0 ─────────
// (rect-derived origin was tried first and produced a real, browser-verified regression —
// see A603_layout_normalization/GRID.md "character scale floor" — this locks the fix in.)
const applyFnSrc = cut("function applyHomeCharacterScaleFloor(fit) {", "\n// 정본 배치");
check("origin X = HOME_CENTER (not a board-rect-derived centerX)",
  /const originLocalX = HOME_CENTER;/.test(applyFnSrc), true);
check("origin Y = HOME_FLOOR (not a board-rect-derived bottom)",
  /const originLocalY = HOME_FLOOR;/.test(applyFnSrc), true);
check("does NOT call getBoundingClientRect on homeChar/chogHome for the origin",
  !/parts\.map\(\(el\) => el\.getBoundingClientRect\(\)\)/.test(applyFnSrc), true);
check("no-op when natural scale already meets the floor",
  /if \(s >= HOME_CHAR_SCALE_FLOOR\) return \{ applied: false, s \};/.test(applyFnSrc), true);
check("unwraps before recomputing (idempotent — no compounding across resizes)",
  applyFnSrc.indexOf("unwrapHomeCharacterScaleFloor();") < applyFnSrc.indexOf("const k = HOME_CHAR_SCALE_FLOOR / s;"), true);

// ── 3. 걷기 도중에는 걸지 않는다("location first, scale second") ──────────────────────
const mountHomeSrc = cut("function mountHome({ cardClaimed = state.sendCardVisible } = {}) {", "\n// Home 3분 무입력 졸기 타이머");
const settleSrc = cut("  const settle = ({ keepPose = false } = {}) => {", "\n  const startRect = state.homeStartRect;");
check("settle() applies the scale floor (post-arrival, every settle path)",
  /applyHomeCharacterScaleFloor\(fit\);/.test(settleSrc), true);
check("resize listener re-applies it, guarded to skip mid-walk",
  /if \(host\.dataset\.arrival !== "1"\) applyHomeCharacterScaleFloor\(freshFit\);/.test(mountHomeSrc), true);

// ── 3a. [A-606 OWNER ADDENDUM · pass2] BOTTOM ANCHOR — Y nudge is now a computed target,
// not a fixed magic number, so the character group's feet sit near the bottom-safe frame
// instead of wherever fitHomeBoard()'s own aspect-fit centering happened to leave them.
check("resolveCssLengthVarPx() reads the LIVE computed px value of a CSS custom property (not the raw unresolved string)",
  /function resolveCssLengthVarPx\(varName, fallbackPx\) \{/.test(SRC), true);
// [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, 2026-10-01] the target used to be computed
// inline here as a fixed bottom-safe offset (innerHeight - bottomSafe - gap). The Owner's latest
// correction makes this branch share the SAME 1440-canon-derived proportional target the web
// mid-band branch uses — folding --mobile-bottom-safe into that shared function
// (computeHomeFootTargetViewportY(), main.js) as a MINIMUM clearance only, not the primary
// target. The token is still read (inside that shared function, checked separately by
// a656-return-home-anchor.mjs's own N2) — this branch now just calls the shared target function.
check("[A-681 iteration 2 re-pin] Y nudge target now comes from the SAME shared, 1440-canon-derived target function the web mid-band branch uses, minus the A-681 ink-overhang correction (not a fixed bottom-safe offset re-derived inline, not a hardcoded number)",
  /const targetFootViewportY = computeHomeFootTargetViewportY\(window\.innerHeight\) - homeCharFloorInkOverhangCorrectionPx\(\);/.test(applyFnSrc), true);
check("Y nudge = target - natural (replaces the old fixed .y sum entirely)",
  /const nudgeViewportY = targetFootViewportY - naturalFootViewportY;/.test(applyFnSrc), true);
// [A-608 pass 2 — MOBILE HOME CHARACTER CLUSTER MUST NOT MOVE BETWEEN CARDS] the collision
// term this test used to lock is gone — Chog's own slot no longer depends on card state (see
// a605-common-shell-repair.mjs's own updated assertion for the detailed reasoning).
// [A-681 FINAL CLOSEOUT B re-pin] X nudge is now homeFloorNudgeViewportX(s) = min(base 6, right-rail target) so the rightmost ink clears --mobile-inset; still card-state-independent, base constant itself unchanged (pinned above).
check("X nudge is base-only now — no collision term (Chog's own slot is card-state-independent)",
  /const nudgeViewportX = homeFloorNudgeViewportX\(s\);/.test(applyFnSrc), true);
check("transform-origin is still the foot's own LOCAL point (HOME_CENTER/HOME_FLOOR) — foot anchor stable, only the translate's Y derivation changed",
  /group\.style\.transformOrigin = `\$\{originLocalX\}px \$\{originLocalY\}px`;/.test(applyFnSrc), true);

// ── 4. CSS 상자 — board 와 같은 1256×772, pointer-events:none(hit 영역은 자식이 auto로 되살림) ─
const cssRule = (() => {
  const start = CSS.indexOf(".homeCharScaleFloor {");
  const end = CSS.indexOf("}", start);
  if (start < 0) throw new Error("style.css 에서 .homeCharScaleFloor 못 찾음");
  return CSS.slice(start, end);
})();
check(".homeCharScaleFloor matches #homeBoard's own local box (1256x772)",
  /width:\s*1256px/.test(cssRule) && /height:\s*772px/.test(cssRule), true);
check(".homeCharScaleFloor is pointer-events:none (same convention as .homeBoard/.chogHome)",
  /pointer-events:\s*none/.test(cssRule), true);

// ── 5. ARASO 셀 브랜드 — Invite/Hatch/Name/Home/birth 다섯 씬 전부(A-606 item3 으로 birth 합류) ──
check("arasoBrandMarkup() defined, reuses .arasoBrand (no new class per scene)",
  /function arasoBrandMarkup\(\) \{\s*return `<p class="arasoBrand" aria-hidden="true">Araso<\/p>`;/.test(SRC), true);
const renderReceivedSrc = cut("function renderReceived() {", "\n}");
const renderHatchSrc = cut("function renderHatch() {", "\n}");
const renderNameSrc = cut("function renderName() {", "\n}");
const renderSendStaySrc = cut("function renderSendStay() {", "${sendWorkStageMarkup}");
check("received (Invite) renders the shell brand", /\$\{arasoBrandMarkup\(\)\}/.test(renderReceivedSrc), true);
check("hatch renders the shell brand", /\$\{arasoBrandMarkup\(\)\}/.test(renderHatchSrc), true);
check("name renders the shell brand", /\$\{arasoBrandMarkup\(\)\}/.test(renderNameSrc), true);
check("sendstay (Home) renders the shell brand", /\$\{arasoBrandMarkup\(\)\}/.test(renderSendStaySrc), true);
// [A-606 item3] birth (couldn't-open-Piggy auth card) used to be the one scene left out of the
// shared shell brand — its own in-card .authCard__eyebrow was the sole "Araso" mark there. Owner
// common-shell intent ("product brand, not a scene title") folds it in: birth now ALSO renders
// the shared arasoBrandMarkup(), and the old in-card eyebrow stays in the DOM (still reads
// "Araso", same position/typography) but is visually hidden so the two marks don't double up.
// Full contract for that: app/test/a606-name-auth-gap-close.mjs.
// [A-633] renderAuthCard 가 선택 인자 `view = state` 를 받게 됐다(기본 호출 동작 동일) — 시작 표지만 괄호 앞까지로.
const renderAuthCardSrc = cut("function renderAuthCard(", "\n// =======================================================================");
check("birth/authCard now also renders the shared shell brand (A-606 — no longer the one exception)",
  /\$\{arasoBrandMarkup\(\)\}/.test(renderAuthCardSrc), true);

// [A-606 OWNER ADDENDUM · pass2] centered it ("Place it TOP-CENTER, not top-left").
// [A-607, 2026-09-27 CONSOLIDATED CANON] briefly superseded that with a LEFT axis on web too.
// [A-608 OWNER CORRECTION — FREEZE ALL WEB, 2026-09-27] reverts the web change — "ALL
// 1440x900 WEB scene compositions are FROZEN... restore that web layout" — A-606 pass2's
// centered brand is the web reference again. The left-axis intent survives, scoped to
// narrow (`@media max-width:640px`) only — "apply layout fixes only at 430x900 and 390x844."
// [A-616 OWNER EXCEPTION — WEB ARASO POSITION ONLY, 2026-09-28] this A-608 web-freeze
// contract itself is superseded, but only for this one property set: INBOX A-616
// OWNER_CONFIRMED grants "ONE exception" to the 1440 freeze — adopt the reentry HANDOFF
// web target (reentry design HANDOFF §4, kept outside this repo) for the EXISTING
// `.arasoBrand`: rendered left anchor x=140px, top=32px (top was already `var(--grid-5)`
// = 32px, unchanged). The old "centered again" assertion below is replaced with the new
// fixed left-anchor contract; text/font/weight/size/letter-spacing/color/casing/z-index/
// visibility and the mobile (`@media max-width:640px`) rule are untouched — see the CSS
// comment right above `.arasoBrand {}` for the full rationale.
const arasoBrandCss = (() => {
  const start = CSS.indexOf(".arasoBrand {");
  const end = CSS.indexOf("}", start);
  if (start < 0) throw new Error("style.css 에서 .arasoBrand 못 찾음");
  return CSS.slice(start, end);
})();
check(".arasoBrand base (web, >640px) rule is fixed at the A-616 owner-approved exception anchor — left:140px, no self-centering transform",
  /left:\s*140px;/.test(arasoBrandCss) && !/transform:\s*translateX/.test(arasoBrandCss), true);
check(".arasoBrand base (web) top is unchanged at the grid-5 token (already 32px, matches A-616's top=32px target)",
  /top:\s*var\(--grid-5\);/.test(arasoBrandCss), true);
const arasoBrandNarrowCss = (() => {
  const marker = "@media (max-width: 640px) {\n  .arasoBrand {";
  const start = CSS.indexOf(marker);
  const end = CSS.indexOf("}", start);
  if (start < 0) throw new Error("style.css 에서 narrow .arasoBrand 규칙 못 찾음");
  return CSS.slice(start, end);
})();
check("narrow .arasoBrand override reads --mobile-inset for horizontal position (left axis, mobile-only per A-608) and --mobile-top-safe for vertical",
  /left:\s*var\(--mobile-inset\)/.test(arasoBrandNarrowCss) && /top:\s*var\(--mobile-top-safe\)/.test(arasoBrandNarrowCss),
  true);

// [A-606 OWNER ADDENDUM · pass2 §2/§5] Auth's card (the one bare-`.stage` scene that is
// actually flow-laid-out, see the padding comment in style.css) now starts below BOTH the
// simulated top-safe band AND the now-centered brand's own line — a real capture found the
// card's paper painting directly over the brand when this only added the safe-top token
// (both landing on the same line + both horizontally centered at this width); the extra
// `--grid-4` gap term is what actually fixed that paint collision.
const stageNarrowCss = (() => {
  const marker = "@media (max-width: 620px) {";
  const start = CSS.indexOf(marker);
  const blockStart = CSS.indexOf(".stage {", start);
  const end = CSS.indexOf("}", blockStart);
  if (start < 0 || blockStart < 0) throw new Error("style.css 에서 narrow .stage 규칙 못 찾음");
  return CSS.slice(blockStart, end);
})();
check("narrow .stage padding-top = safe-top token + a gap (not the safe-top token alone — that collided with the once-centered brand)",
  /padding:\s*calc\(var\(--mobile-top-safe\) \+ var\(--grid-4\)\) var\(--mobile-inset\) 144px;/.test(stageNarrowCss), true);
// [A-607] side padding was a bare 16px, undercutting the canon's own 20/24px minimum content
// inset — now reuses --mobile-inset (same token Chog/brand insets already read).
check("narrow .stage side padding reuses --mobile-inset (not a second hardcoded 16px)",
  !/16px 144px/.test(stageNarrowCss), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
