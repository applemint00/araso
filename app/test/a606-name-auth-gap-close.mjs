// [A-606] Contract test for the A-605 gap-close (Name control sizes, Walk-430 edge review —
// no code change so nothing new to lock there, Auth shared-brand). Same "cut the real source
// and check the contract" pattern as a605-common-shell-repair.mjs — network 0, browser 0.
// Live/measured proof (pixel rects, dense walk-frame sequence, before/after numbers) lives in
// _private/ops/receipts/A606_a605_gap_close/{raw,screenshots}/ + WRITER.md — this file only
// locks the source contract so a future edit can't silently regress it.
//   node app/test/a606-name-auth-gap-close.mjs
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`main.js 에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}

function cutCssBlock(marker) {
  const start = CSS.indexOf(marker);
  if (start < 0) throw new Error(`style.css 에서 못 찾음: ${marker}`);
  const blockStart = CSS.indexOf("{", start);
  const blockEnd = CSS.indexOf("}", blockStart);
  return CSS.slice(start, blockEnd);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

// ── item1 — Name controls ≥44px ─────────────────────────────────────────────────────────────
// 1440 fix: base input height 34→40 (natural board scale there is a fixed 1.125 no-op —
// 40*1.125=45, matches the button which already passed at 45). Card/Chog coordinates untouched.
const inputBaseCss = cutCssBlock(".nameCard__field input {");
check("Name input base height raised 34→40 (1440: 40*1.125=45≥44)",
  /height:\s*40px;/.test(inputBaseCss), true);
check("Name input base line-height matches the new height (vertical centering)",
  /font:\s*600 20px\/40px system-ui, sans-serif;/.test(inputBaseCss), true);

// [A-608 OWNER ADDENDUM — NAME BUTTON PROPORTION, 2026-09-27] this card's own original
// narrow fix (pre-scale height = 44/0.42 ≈ 104.76, rounded up to 108, card/pad grown
// 300→460 to fit) is SUPERSEDED — the Owner explicitly rejected growing the VISIBLE
// controls to hit the touch-target minimum ("Do NOT make the visible button
// disproportionately large... visual size follows card scale; interactive target may be
// larger than the visible button"). Card/input/button/underline are back to their original
// (pre-A-606-item1) unscoped values; an invisible hit-area extension (label padding for the
// input, since `.nameCard__field` is a real `<label>`; a `::before` overlay for the button,
// since `<input>` doesn't support pseudo-elements) supplies the ≥44px real target instead.
// See style.css's own comment (same block) for the exact px math.
check("no narrow .nameScene__pad/.nameCard height override remains (card stays 300px, matching web — no A-606-item1 growth)",
  !/@media \(max-width: 640px\) \{\s*\n\s*\.nameScene__pad,\s*\n\s*\.nameCard \{\s*\n\s*height:\s*460px;/.test(CSS), true);
check("no narrow .nameCard__field input height override remains (input stays 40px, matching web)",
  !/\.nameCard__field input \{\s*\n\s*height:\s*108px;/.test(CSS), true);
const nameFieldNarrowCss = cutCssBlock("@media (max-width: 640px) {\n  /* input + button sit only");
check("narrow .nameCard__field gets an invisible padding-based hit-area extension (asymmetric — input/button sit too close for symmetric 44px each)",
  /padding:\s*46px 0 5px;/.test(CSS), true);
check("narrow .nameCard__field top shifts up by the added top-padding (152-46=106) so the VISIBLE input position is unchanged",
  /top:\s*106px;.*\n.*padding:\s*46px 0 5px;/.test(CSS) || /top:\s*106px; \/\* 152 - 46 \*\//.test(CSS), true);
check("narrow .nameCard .pkbtn gets position:relative (for its own ::before hit-area overlay)",
  /@media \(max-width: 640px\) \{[\s\S]*?\.nameCard \.pkbtn \{\s*\n\s*position:\s*relative;/.test(CSS), true);
check("narrow .nameCard .pkbtn::before is a fully invisible overlay (content:\"\", no background/border) extending the hit area only",
  /\.nameCard \.pkbtn::before \{\s*\n\s*content:\s*"";\s*\n\s*position:\s*absolute;\s*\n\s*top:\s*-5px;\s*\n\s*bottom:\s*-60px;/.test(CSS), true);
check("narrow fix does not touch .nameCard__ok/.nameCard__save's own right/bottom anchor rule (button position unchanged, card no longer grows)",
  !/\.nameCard__ok,\s*\n\s*\.nameCard__save \{[\s\S]{0,80}(?:460|108)/.test(CSS), true);
check("no orphaned reference to nameFieldNarrowCss variable (sanity: marker string exists in source)",
  nameFieldNarrowCss.length > 0, true);

// fitNameScene() itself (the 0.42 board-scale floor from A-605) is unchanged — this card's
// item1 fix is internal card reflow, not a bigger board floor (explicit card instruction).
const fitNameSceneSrc = cut("function fitNameScene() {", "\nfunction mountName()");
check("fitNameScene()'s own scale math is untouched by this card (still Math.max(natural, NAME_SCENE_SCALE_FLOOR))",
  /const scale = Math\.max\(natural, NAME_SCENE_SCALE_FLOOR\);/.test(fitNameSceneSrc), true);

// ── item3 — Auth uses the shared top-left brand, in-card duplicate hidden (not deleted) ────
// [A-633] renderAuthCard 가 선택 인자 `view = state` 를 받게 됐다(기본 호출 동작 동일) — 시작 표지만 괄호 앞까지로.
const renderAuthCardSrc = cut("function renderAuthCard(", "\n// =======================================================================");
check("renderAuthCard() calls the shared arasoBrandMarkup() (same function/place as Invite/Hatch/Name/Home)",
  /\$\{arasoBrandMarkup\(\)\}/.test(renderAuthCardSrc), true);
check("renderAuthCard()'s in-card eyebrow markup is NOT deleted (still renders \"Araso\", just no longer the only mark)",
  /<p class="authCard__eyebrow" aria-hidden="true">Araso<\/p>/.test(renderAuthCardSrc), true);
check("in-card eyebrow now carries aria-hidden (shared .arasoBrand is the one AT-announced Araso mark)",
  /class="authCard__eyebrow" aria-hidden="true"/.test(SRC), true);

const eyebrowCss = cutCssBlock(".authCard__eyebrow {");
check("in-card eyebrow visually hidden via visibility:hidden (not display:none — box/position untouched, card layout unchanged)",
  /visibility:\s*hidden;/.test(eyebrowCss), true);
check("in-card eyebrow keeps its original position/typography (right:34/top:26 untouched, only visibility added)",
  /right:\s*34px;/.test(eyebrowCss) && /top:\s*26px;/.test(eyebrowCss), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
