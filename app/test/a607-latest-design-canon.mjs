// [A-607] Contract test for the 2026-09-27 consolidated design canon implementation —
// network 0, browser 0, same "cut the real source and check the contract" pattern as
// app/test/home-character-scale-floor.mjs / a605-common-shell-repair.mjs /
// a606-name-auth-gap-close.mjs. Covers items not already locked by those three files:
// onboarding Chog master-size unification (Invite mobile + Name's structural move out of
// the scaled board), the Records left-rail/two-paper rework, and the First-Job work-canvas
// floor-aware anchor fix. (Araso's own left-axis revert + narrow .stage side-inset fix are
// asserted in home-character-scale-floor.mjs, updated in this same card — not duplicated
// here.)
// [A-618, 2026-09-28] section 5/6's Records checks below were UPDATED (not left to bit-rot)
// when A-618 superseded this same card's own mobile left-rail/peek rule — see their own
// inline comments and app/test/a618-mobile-two-paper-fit.mjs for the new mechanism's own
// coverage. Nothing else in this file changed.
// [A-621, 2026-09-28] A-618's side-by-side mechanism is itself superseded (stacked Records);
// the three A-618-specific checks in section 5/6 are updated again — see
// app/test/a621-mobile-records-stack.mjs. Nothing else in this file changed.
//   node app/test/a607-latest-design-canon.mjs
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}

function cutCss(startMarker, endMarker) {
  const start = CSS.indexOf(startMarker);
  const end = CSS.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`style.css 에서 못 찾음: ${startMarker}`);
  return CSS.slice(start, end);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

// ── 1. ONBOARDING CHOG MASTER SIZE — Invite mobile now uses the same "big" anchor crop
// Hatch/Auth/invite-wide already share (was the smaller 62-unit base crop, ~91.4px tall vs
// their fixed 168.19px — the master-size break the canon calls out by name). ──────────────
const inviteChogCss = cutCss(".invite__chog {", "\n\n.invite__trail");
check("mobile .invite__chog .chogInvite override present (big-anchor crop, not the smaller base rule)",
  /\.invite__chog \.chogInvite \{[\s\S]*?width:\s*138\.79px;[\s\S]*?height:\s*168\.19px;/.test(CSS), true);
check("mobile .invite__chog top moved up (620→560) so the now-taller ink clears .invite__copy",
  /top:\s*560px;/.test(inviteChogCss), true);

// ── 2. NAME CHOG — moved out of the scaled #nameScene board entirely; same anchor pattern
// (and same byte-identical size) as .hatchChog, not a flat <img> that shrank with the board
// floor. Class name kept (`.nameScene__chog`) — Save-time walk-start rect capture unchanged. ──
check("renderName() no longer has a flat <img> for the chog (moved to a component div)",
  !/<img class="nameScene__chog"/.test(SRC), true);
const renderNameSrc = cut("function renderName() {", "\n}");
check("renderName() renders .nameScene__chog as a chogInviteMarkup() component",
  /<div class="nameScene__chog" aria-hidden="true">\$\{chogInviteMarkup\(\)\}<\/div>/.test(renderNameSrc), true);
// Sibling-of-#nameScene check: the chog div must appear AFTER #nameScene's own closing div,
// still inside the <section>, not nested inside #nameScene.
const nameSceneOpenIdx = renderNameSrc.indexOf('id="nameScene"');
const nameChogDivIdx = renderNameSrc.indexOf('<div class="nameScene__chog"');
check("nameScene__chog div appears after #nameScene in source order (sibling, not nested child)",
  nameSceneOpenIdx >= 0 && nameChogDivIdx > nameSceneOpenIdx, true);

const mountNameSrc = cut("function mountName() {", "\n// --- 첫 Home 도착");
check("mountName() mounts the chog via mountChogInvite() on .nameScene__chog's own [data-chog-invite]",
  /document\.querySelector\("\.nameScene__chog \[data-chog-invite\]"\)/.test(mountNameSrc), true);
check("mountName()'s chog mount reuses the shared inviteChog module var (same convention as mountHatch())",
  /inviteChog = nameChog;/.test(mountNameSrc), true);

const nameChogCss = cutCss("/* [A-607 canon C/G/H — onboarding Chog master size + continuity]", "\n@media (max-width: 640px) {\n  .nameScene__chog {");
check(".nameScene__chog base rule is the SAME fixed anchor as .hatchChog (107.6x139.9, translate(-260%,-6%) — byte-identical size/position formula)",
  /width:\s*107\.6px;/.test(nameChogCss) && /height:\s*139\.9px;/.test(nameChogCss) && /transform:\s*translate\(-260%, -6%\);/.test(nameChogCss),
  true);
check(".nameScene__chog .chogInvite uses the same big-anchor crop as Hatch/Auth (138.79x168.19)",
  /\.nameScene__chog \.chogInvite \{[\s\S]{0,120}width:\s*138\.79px;[\s\S]{0,40}height:\s*168\.19px;/.test(CSS), true);
const nameChogNarrowCss = cutCss("@media (max-width: 640px) {\n  .nameScene__chog {", "\n}\n");
check("narrow .nameScene__chog uses the SAME left-axis clearance as .hatchChog/.authCard__chog (--mobile-inset + --grid-4)",
  /left:\s*calc\(var\(--mobile-inset\) \+ var\(--grid-4\)\);/.test(nameChogNarrowCss), true);

// ── 3. ARASO LEFT-AXIS CLEARANCE — Auth/Hatch chog anchors pushed right of the brand's own
// real "A" ink (measured via Range, not the padded box — see WRITER.md). ───────────────────
const authChogNarrowCss = cutCss("@media (max-width: 640px) {\n  .authCard {", "\n}\n\n");
check(".authCard__chog gets a narrow margin-left (--grid-4) so its ink clears the Araso A baseline",
  /margin-left:\s*var\(--grid-4\);/.test(authChogNarrowCss), true);
const hatchChogNarrowCss = cutCss("@media (max-width: 640px) {\n  .hatchChog {", "\n}\n");
check(".hatchChog narrow left is --mobile-inset + --grid-4 (not --mobile-inset alone — that put its ink left of the brand's own A)",
  /left:\s*calc\(var\(--mobile-inset\) \+ var\(--grid-4\)\);/.test(hatchChogNarrowCss), true);

// ── 4. INVITE MOBILE VERTICAL SPACING — Owner: mobile letter/paper-to-button gap "feels
// wrong" (web fine, untouched). ──────────────────────────────────────────────────────────
const inviteFaceCss = cutCss("/* Face ID = 이 화면의 유일한 입력.", "\n.invite__faceLabel");
check(".invite__face (mobile) top tightened 455→405 (envelope-to-button gap ~93→~43 local px)",
  /top:\s*405px;/.test(inviteFaceCss), true);
check(".invite--wide .invite__face is untouched (Owner: web spacing is fine)",
  /\.invite--wide \.invite__face \{/.test(CSS), true);

// ── 5. RECORDS — [A-618, 2026-09-28] the A-607/A-608 fixed 285×364 left-rail anchor (+ peek)
// this section used to lock is itself superseded by the A-618 OWNER-CONFIRMED MOBILE TARGET
// (A-616's own RECORDS_TARGET.md names the left-rail rule as drift). These checks are updated
// to lock the NEW mobile mechanism instead of the old one; deep coverage of the new fit math
// lives in app/test/a618-mobile-two-paper-fit.mjs, not duplicated here. Web stays untouched
// either way (still asserted below). ───────────────────────────────────────────────────────
const recordsAnchorCss = cutCss(".recordsCardAnchor {\n  position: absolute;", "\n}\n\n.recordsCardAnchor[hidden]");
check(".recordsCardAnchor base (web) rule still sets no left/width/height/transform of its own (those come from JS — see alignRecordsCardToHomePaper()/fitMobileTwoPaperGroup())",
  !/width:\s*285px/.test(recordsAnchorCss) && !/left:\s*var\(--grid-5\)/.test(recordsAnchorCss) && !/left:\s*var\(--mobile-inset\)/.test(recordsAnchorCss),
  true);
check(".recordsCardAnchor z-index still 0 (below .homeBoard's 1 — z-index canon preserved, A-413-b's fix untouched)",
  /z-index:\s*0;/.test(recordsAnchorCss), true);
// [A-621] a ≤640px `.recordsCardAnchor { z-index: 2 }` rule now exists (HISTORY stacks over
// HOME) — so this check now asserts what it always meant: no ≤640px `.recordsCardAnchor`
// rule carries a fixed position/size (the A-607 left-rail 285×364 geometry stays gone; mobile
// geometry comes from main.js stackMobileRecordsOverHome(), inline, like web).
const mobileAnchorBlocks = [...CSS.matchAll(/@media \(max-width: 640px\) \{\s*\n\s*\.recordsCardAnchor \{([^}]*)\}/g)].map((m) => m[1]);
check("[A-618→A-621] no ≤640px .recordsCardAnchor rule sets left/top/width/height/transform (old fixed 285×364 left-rail override stays gone)",
  mobileAnchorBlocks.every((b) => !/\b(left|top|width|height|transform)\s*:/.test(b)), true);
const recordsPeekCss = cutCss(".recordsCardAnchor__peek {", "\n}\n");
check(".recordsCardAnchor__peek is display:none (no second/rear paper at any width — [A-618 card §7] the mobile peek is removed, not just web's)",
  /display:\s*none;/.test(recordsPeekCss) && /left:\s*10px;/.test(recordsPeekCss) && /z-index:\s*-1;/.test(recordsPeekCss),
  true);
check("[A-618] the ≤640px peek override that used to flip it to display:block no longer exists",
  !/@media \(max-width: 640px\) \{\s*\n\s*\.recordsCardAnchor__peek \{\s*\n\s*display:\s*block;/.test(CSS), true);
const recordsCardMarkupSrc = cut("function recordsCardMarkup() {", "\n}");
check("recordsCardMarkup() still renders the peek div inside #recordsCardAnchor (markup untouched — A-618 only changed CSS display, no HTML/JS restructuring needed for an always-hidden element)",
  /<div class="recordsCardAnchor__peek" aria-hidden="true"><\/div>/.test(recordsCardMarkupSrc), true);

// ── 6. RECORDS — A-608 pass 2 RE-ACTIVATES the homePaper-derived mechanism for web ("Home+
// Records web is also reference/frozen"); [A-618] narrow now gets its OWN live mechanism
// (fitMobileTwoPaperGroup()) instead of no-opping in favor of fixed CSS. ───────────────────
const openRecordsCardSrc = cut("function openRecordsCard() {", "\n}");
const closeRecordsCardSrc = cut("function closeRecordsCard() {", "\n}");
check("openRecordsCard() calls alignRecordsCardToHomePaper() again (web freeze revert)", /alignRecordsCardToHomePaper\(\)/.test(openRecordsCardSrc), true);
check("openRecordsCard() calls startRecordsAlignLoop() again", /startRecordsAlignLoop\(\)/.test(openRecordsCardSrc), true);
check("closeRecordsCard() calls stopRecordsAlignLoop() again", /stopRecordsAlignLoop\(\)/.test(closeRecordsCardSrc), true);
// [A-621] the A-618 two-paper proxy (and so its restoreMobileTwoPaperGroup() teardown) is
// superseded — HOME is never re-parented/re-scaled any more, so close has nothing to undo.
check("[A-621] closeRecordsCard() no longer calls the superseded A-618 restoreMobileTwoPaperGroup()",
  /restoreMobileTwoPaperGroup\(\)/.test(closeRecordsCardSrc), false);
const alignFnSrc = cut("function alignRecordsCardToHomePaper() {", "\n// [A-621 OWNER CONFIRMED");
check("[A-621] alignRecordsCardToHomePaper() calls stackMobileRecordsOverHome() at narrow (≤640px) — A-618 fitMobileTwoPaperGroup() superseded",
  /window\.innerWidth <= 640/.test(alignFnSrc) && /stackMobileRecordsOverHome\(\)/.test(alignFnSrc) && !/fitMobileTwoPaperGroup\(\)/.test(alignFnSrc), true);

// ── 7. FIRST JOB — the "work?" reaction canvas (Piggy, drawn by piggy-depart.js — outside
// this card's files) now gets the SAME floor-scale/bottom-anchor treatment
// applyHomeCharacterScaleFloor() gives #homeChar/#chogHome, only for clock==="send" (First
// Job) — Explore's clock==="second" is left on its original simple centered fit. ───────────
const workPoseSrc = cut("function mountSendCardWorkPose({", "\n  loadWorkAssetsCached()");
check("mountSendCardWorkPose()'s fit() checks the SAME HOME_CHAR_SCALE_FLOOR condition applyHomeCharacterScaleFloor() uses",
  /s < HOME_CHAR_SCALE_FLOOR/.test(workPoseSrc), true);
check("fit()'s floor branch is scoped to clock === \"send\" only (Explore's \"second\" clock untouched)",
  /clock === "send" && board && s > 0 && s < HOME_CHAR_SCALE_FLOOR/.test(workPoseSrc), true);
check("fit()'s floor branch derives k the same way applyHomeCharacterScaleFloor() does (HOME_CHAR_SCALE_FLOOR / s)",
  /const k = HOME_CHAR_SCALE_FLOOR \/ s;/.test(workPoseSrc), true);
check("fit()'s floor branch reuses resolveCssLengthVarPx() for the bottom-safe token (not a new hardcoded number)",
  /resolveCssLengthVarPx\("--mobile-bottom-safe", 20\)/.test(workPoseSrc), true);
check("fit()'s floor branch does NOT add the card-collision X term (96px) — a repair-pass cluster nudge instead, avoids pushing this wider canvas's ink past the right safe edge",
  !/nudgeViewportX = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX\.x \+ \(collisionActive/.test(workPoseSrc),
  true);
// [A-608 pass 2 — MOBILE HOME CHARACTER CLUSTER MUST NOT MOVE BETWEEN CARDS] the repair
// pass's own custom cluster-nudge constant is gone — this canvas now uses the exact same
// base-only nudge `applyHomeCharacterScaleFloor()` uses (no card-state-dependent term of any
// kind), so Piggy lands in the literal same resident slot regardless of which card is open.
check("fit()'s floor branch uses the plain base nudge only — no repair-pass cluster constant, no collision term (Piggy maps into the exact same slot Home settled uses)",
  /const nudgeViewportX = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX\.x;\s*\n\s*const nudgeViewportY/.test(workPoseSrc) &&
  !/FIRST_JOB_PIGGY_CLUSTER_NUDGE_X_PX/.test(SRC),
  true);
check("fit()'s non-floor branch resets left/top/transform to \"\" (falls back to .departStage's own centered CSS — unchanged for desktop/Explore)",
  /canvas\.style\.left = "";\s*\n\s*canvas\.style\.top = "";\s*\n\s*canvas\.style\.transform = "";/.test(workPoseSrc), true);

// ── 8. REPAIR PASS (four read-only lane findings, fixed in one pass) ──────────────────────

// lane_a: Auth's "Try again"/"Check Piggy" buttons measured 40px tall at EVERY viewport
// (`.pkbtn`'s shared base rule, not scoped to a scaled board like Name's own controls) —
// below the card's own ≥44px minimum at web too, not just narrow. First repair-pass attempt
// grew the VISIBLE button to 46px; the "A-608 OWNER ADDENDUM — NAME BUTTON PROPORTION" (which
// explicitly asks for the SAME treatment on Auth "if needed so web Auth's visual button
// returns to its reference size") rejects growing the visible control — pass 2 reverts the
// visible size and adds an invisible ::before hit-area extension instead.
check(".authCard__actions .pkbtn stays visually at the shared 40px base (no height/border-radius override) — hit area comes from an invisible overlay instead",
  !/\.authCard__actions \.pkbtn \{\s*\n\s*height:\s*46px;/.test(CSS), true);
const authBtnPseudoCss = cutCss(".authCard__actions .pkbtn::before {", "\n}\n");
check(".authCard__actions .pkbtn::before is a fully invisible overlay (content:\"\", inset -3px = 46px real hit area) — no background/border CSS property set",
  /content:\s*"";/.test(authBtnPseudoCss) && /inset:\s*-3px;/.test(authBtnPseudoCss) &&
  !/^\s*background:/m.test(authBtnPseudoCss) && !/^\s*border:/m.test(authBtnPseudoCss),
  true);
check(".pkbtn's own shared base rule is untouched (scoped fix only, same discipline as A-606's Name-only fix)",
  /\.pkbtn \{\s*\n\s*position: relative;[\s\S]*?height:\s*40px;/.test(CSS), true);

// lane_a (crop-box) + lane_b (pixel scan): Hatch/Name Chog's real ink sat flush (0px
// clearance, pixel-confirmed) on the simulated bottom-safe line — lifted for real breathing
// room, kept byte-identical between Hatch and Name per canon.
const hatchChogNarrowCss2 = cutCss("@media (max-width: 640px) {\n  .hatchChog {", "\n  }\n}\n");
check(".hatchChog narrow bottom now adds +5px above --mobile-bottom-safe (was flush; tuned from an initial +10px to land inside A-608's ~12-16px real-clearance band, see WRITER.md)",
  /bottom:\s*calc\(var\(--mobile-bottom-safe\) \+ 5px\);/.test(hatchChogNarrowCss2), true);
const nameChogNarrowCss2 = cutCss("@media (max-width: 640px) {\n  .nameScene__chog {", "\n  }\n}\n");
check(".nameScene__chog narrow bottom is BYTE-IDENTICAL to .hatchChog's own (+5px), per canon (\"keep Hatch and Name identical\")",
  /bottom:\s*calc\(var\(--mobile-bottom-safe\) \+ 5px\);/.test(nameChogNarrowCss2), true);

// lane_d flagged `.cardAnchor` (First Job's card) as centered on WEB, not left-rail — this
// seat briefly added a web-scoped override, then REVERTED it in the same repair pass once
// the A-608 Owner correction ("FREEZE ALL WEB, MOBILE-ONLY LAYOUT CHANGES") explicitly called
// that exact finding INVALID ("Web First Job centered card is reference behavior and must
// not be changed"). Assert the revert: no extra web-scoped rule remains, base rule (centered)
// is the only one governing web, narrow override is untouched.
check("no extra web-scoped `.stage[data-scene=\"sendstay\"] .cardAnchor` rule remains outside the narrow media query (A-608 freeze — First Job's web card position is reverted to centered)",
  !/\.stage\[data-scene="sendstay"\] \.cardAnchor \{\s*\n\s*left:\s*var\(--grid-5\);/.test(CSS), true);
check("base .cardAnchor rule (centered on web) is unchanged — left:50% + the original -32px/-48px offset",
  /\.cardAnchor \{\s*\n\s*position: absolute;\s*\n\s*left:\s*50%;\s*\n\s*top:\s*50%;\s*\n\s*width:\s*285px;\s*\n\s*height:\s*364px;\s*\n\s*transform:\s*translate\(calc\(-50% - 32px\), calc\(-50% - 48px\)\);/.test(CSS),
  true);
check("narrow (≤640px) .stage[data-scene=\"sendstay\"] .cardAnchor override is untouched (still --mobile-inset, A-605's own fix)",
  /@media \(max-width: 640px\) \{\s*\n\s*\.stage\[data-scene="sendstay"\] \.cardAnchor \{\s*\n\s*left:\s*var\(--mobile-inset\);/.test(CSS),
  true);

// lane_d: at 430/390, Piggy (canvas) and Chog (real group, which got the full 96px
// card-collision push at the time) overlapped into one continuous ink blob. Pass 2 removes
// the root cause (the collision push itself, see a605-common-shell-repair.mjs's own
// assertion) instead of compensating for it with a hand-tuned constant — already asserted
// above (no cluster-nudge constant, base nudge only, matches applyHomeCharacterScaleFloor()
// exactly).

// ── 9. NAME CHOG — A-608 pass 2 web freeze: "Name Chog stage-level move" reverted at web,
// kept at narrow. Legacy web element (`.nameScene__chogWeb`, byte-identical to pre-A-607)
// reinstated; the new master-size element (`.nameScene__chog`) hidden at web. ──────────────
check(".nameScene__chog base rule is display:none (hidden at web — legacy element takes over there)",
  /\.nameScene__chog \{\s*\n\s*display:\s*none;/.test(CSS), true);
check("narrow .nameScene__chog override sets display:block",
  /@media \(max-width: 640px\) \{\s*\n\s*\.nameScene__chog \{\s*\n\s*display:\s*block;/.test(CSS), true);
check(".nameScene__chogWeb legacy rule exists with the exact pre-A-607 coordinates (left196/top556/width104)",
  /\.nameScene__chogWeb \{\s*\n\s*position:\s*absolute;\s*\n\s*left:\s*196px;\s*\n\s*top:\s*556px;\s*\n\s*width:\s*104px;/.test(CSS), true);
check(".nameScene__chogWeb hidden at narrow (only the new master-size element shows there)",
  /@media \(max-width: 640px\) \{\s*\n\s*\.nameScene__chogWeb \{\s*\n\s*display:\s*none;/.test(CSS), true);
check("renderName() reinstates the legacy <img class=\"nameScene__chogWeb\"> inside #nameScene (same asset, chog_idle_fill.png)",
  /<img class="nameScene__chogWeb" src="\$\{MOTION_DIR\}\/assets\/chog_idle_fill\.png"/.test(renderNameSrc), true);
check("Save-time capture checks BOTH .nameScene__chogWeb and .nameScene__chog, picking whichever is actually visible (non-zero rect)",
  /document\.querySelector\("\.nameScene__chogWeb"\)/.test(SRC) &&
  /chogCandidates\.find\(\(el\) => el && el\.getBoundingClientRect\(\)\.width > 0\)/.test(SRC),
  true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
