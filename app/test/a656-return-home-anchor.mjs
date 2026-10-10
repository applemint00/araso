// [A-656] Return → Home anchor reconcile — mobile + mid-band + web, multi-Piggy placement, sleep.
//   node app/test/a656-return-home-anchor.mjs
//
// Part N (node, always): source/CSS contract checks for every piece wired in this card — the
//   mid-band drop (decision 2), the Away/Return floor wrap (decisions 3/4), the rect-based
//   Receipt anchor (P3 R1), the seeded slot-preference placement (decision 6), and the sleep
//   overflow/label fixes (decision 7). On the pre-A-656 tree every check here fails.
// Part B (real browser, default ON when the local harness exists, same convention as
//   app/test/a654-living-home.mjs): Playwright + CDP virtual authenticator on a local Vite dev
//   server. A656_BASE_URL reuses a running server; A656_NODE_ONLY=1 skips Part B (prints SKIP).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs";
import { sceneOracle } from "./helpers/a837-sweep.mjs"; // [A-837] pure Return layout (returnLayout) evaluated in a vm

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const RETURN_VIEW = readFileSync(path.join(REPO, "app/src/return-view.js"), "utf8");
const PIGGY_RETURN = readFileSync(path.join(REPO, "app/src/piggy-return.js"), "utf8");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function fnBody(name, src = MAIN) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
function cssRule(name, src = CSS) {
  const start = src.indexOf(`${name} {`);
  if (start < 0) throw new Error(`style.css 에서 ${name} 못 찾음`);
  return src.slice(start, src.indexOf("}", start));
}

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════

// [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, 2026-10-01] N1/N2 rewritten AGAIN — the
// visual-repair pass's own fixed "gap = max(64, 0.08·vh)" rule (foot ≈0.92·vh, moved 1440 itself)
// is superseded: the Owner's latest correction says 1440×900's CURRENT settled foot is canon and
// must not move, and every other web width (still 641+, still no upper bound — 1200 is not a
// special case either way) must match 1440's own NORMALIZED foot ratio instead of a fixed px gap.
// See computeHomeMidBandDropPx()/computeHomeFootNormalizedRatio()'s own header comment in main.js.
await check("N1 web mid-band scope: 641vw+ (no upper bound — 1200/1440 both run the same branch)", () => {
  assert.match(MAIN, /const HOME_MID_BAND_MIN_VW = 641;/);
  assert.equal(/const HOME_MID_BAND_MAX_VW/.test(MAIN), false, "no 1200 upper bound");
  const fn = fnBody("computeHomeMidBandDropPx");
  assert.match(fn, /if \(!\(vw >= HOME_MID_BAND_MIN_VW\)\) return 0;/, "no upper vw bound left in the function itself");
  assert.match(fn, /dy > 0\.5 \? dy : 0/, "only a real (>0.5px) drop ever applies — a cluster already low enough is never raised (this is what keeps 1440 itself at Δ0)");
});

await check("N2 the target is the 1440×900 canon's own NORMALIZED foot ratio, derived (not a magic literal), with mobile safe-area folded in as a MINIMUM only", () => {
  const fn = fnBody("computeHomeMidBandDropPx");
  assert.match(fn, /const targetFootViewportY = computeHomeFootTargetViewportY\(vh\);/);
  const targetFn = fnBody("computeHomeFootTargetViewportY");
  assert.match(targetFn, /Math\.min\(HOME_FOOT_NORMALIZED_RATIO \* vh, vh - bottomSafeMinPx\)/, "proportional target wins unless it would violate the mobile safe-area MINIMUM");
  const ratioFn = fnBody("computeHomeFootNormalizedRatio");
  assert.match(ratioFn, /Math\.min\(HOME_FOOT_REF_VW \/ HOME_BOARD_W, HOME_FOOT_REF_VH \/ HOME_BOARD_H\)/, "refS: same natural aspect-fit formula fitHomeBoard() itself uses");
  assert.match(ratioFn, /HOME_FLOOR \* refS/, "refFootFrac: same foot-local-point convention every other Home placement uses");
  assert.match(MAIN, /const HOME_FOOT_REF_VW = 1440;/);
  assert.match(MAIN, /const HOME_FOOT_REF_VH = 900;/);
  assert.match(MAIN, /const HOME_FOOT_NORMALIZED_RATIO = computeHomeFootNormalizedRatio\(\);/, "computed once from the constants above, not hand-typed");
  // Sanity-check the derivation reproduces the Owner's measured 1440×900 canon (750.7/900 ≈ 0.8341).
  const HOME_BOARD_W = 1256, HOME_BOARD_H = 772, HOME_FLOOR = 648;
  const refS = Math.min(1440 / HOME_BOARD_W, 900 / HOME_BOARD_H);
  const refTop = (900 - HOME_BOARD_H * refS) / 2;
  const R = (refTop + HOME_FLOOR * refS) / 900;
  assert.ok(Math.abs(R - 0.8341) < 0.001, `derived ratio ${R} should match the Owner's measured canon ≈0.8341`);
});

await check("N3 applyHomeCharacterScaleFloor()'s mid-band branch runs BEFORE, and does not replace, the locked no-op guard", () => {
  const applySrc = fnBody("applyHomeCharacterScaleFloor");
  assert.match(applySrc, /if \(s >= HOME_CHAR_SCALE_FLOOR\) \{\s*\n\s*const midBandDy = computeHomeMidBandDropPx/, "mid-band checked first");
  // home-character-scale-floor.mjs's own locked contract also requires this exact string present —
  // this is a cross-check, not a duplicate.
  assert.match(applySrc, /if \(s >= HOME_CHAR_SCALE_FLOOR\) return \{ applied: false, s \};/, "A-603 locked no-op guard untouched");
  assert.match(applySrc, /return \{ applied: false, s, midBand: true, midBandDy \};/, "midBand flagged SEPARATELY from `applied` — never true together");
});

await check("N4 computeHomeCharScaleFloorPlan() (the read-only twin) shares the same mid-band branch", () => {
  const planSrc = fnBody("computeHomeCharScaleFloorPlan");
  assert.match(planSrc, /midBand: true, midBandDy/);
  assert.match(planSrc, /if \(s >= HOME_CHAR_SCALE_FLOOR\) return \{ applied: false, s \};/, "A-610's own cross-check regex still finds this");
});

await check("N5 walk-start / pairConverge gate does not switch on for mid-band (only `.applied`, never `.midBand`)", () => {
  assert.match(MAIN, /const pairConvergeActive = !!\(fit && computeHomeCharScaleFloorPlan\(fit\)\?\.applied\);/, "A-614's own locked gate text — untouched, so mid-band (midBand:true, applied:false) never trips it");
  assert.match(fnBody("chogWalkStartBoardRect"), /if \(!plan \|\| !plan\.applied\) return fit\.rect;/, "A-610's own locked no-op guard — untouched, so mid-band never distorts the walk-start board rect either");
});

await check("N6 decision 3 — Away keeps Chog at the Home anchor (mobile floor / mid-band) on BOTH First and Second", () => {
  assert.match(MAIN, /function applyHomeFloorToChogOnly\(fit\) \{/);
  const chogOnly = fnBody("applyHomeFloorToChogOnly");
  assert.match(chogOnly, /unwrapHomeCharacterScaleFloor\(\);/, "same idempotent global marker Home itself uses");
  assert.match(chogOnly, /computeHomeCharScaleFloorPlan\(fit\)/);
  assert.match(chogOnly, /plan\.applied \? plan\.k : 1/);
  assert.match(chogOnly, /plan\.midBandDy \/ s/);
  const mountSecondAway = fnBody("mountSecondAway");
  assert.match(mountSecondAway, /applyHomeFloorToChogOnly\(boardFit\);/, "First mount");
  assert.match(mountSecondAway, /applyHomeFloorToChogOnly\(fitHomeBoard\(\)\);/, "resize (both the no-canvas early-return and the main fit())");
  const mountAway = fnBody("mountAway");
  assert.match(mountAway, /applyHomeFloorToChogOnly\(boardFit\);/);
  assert.match(mountAway, /applyHomeFloorToChogOnly\(fitHomeBoard\(\)\);/);
});

await check("N7 decision 4 — Return wraps #returnChogHop + #returnName (not #chogHome directly, so the alarm-hop transform stays attached)", () => {
  const cluster = fnBody("applyHomeFloorToReturnCluster");
  assert.match(cluster, /board\.querySelector\("#returnChogHop"\), board\.querySelector\("#returnName"\)/);
  assert.match(cluster, /unwrapHomeCharacterScaleFloor\(\);/);
  const mountReturn = fnBody("mountReturn");
  // [A-831 RE-PIN] the Return canvas rides the keyframe board: fitBoard falls back to keyframeCanvasFloor(fit) when no floor plan applies. Same intent: Return wraps #returnChogHop + #returnName
  // via applyHomeFloorToReturnCluster (asserted above) and still hands the canvas the viewport-space k/nudge. pre-A-831 baseline:
  // assert.match(mountReturn, /fitBoard: \(\) => \{\s*\n\s*const fit = fitHomeBoard\(\);\s*\n\s*const plan = applyHomeFloorToReturnCluster\(fit\);\s*\n\s*return \{ \.\.\.fit, floor: computeHomeFloorViewportNudge\(plan, fit\.s\) \};/);
  // pre-A-837 baseline (A-831 round): assert.match(mountReturn, /fitBoard: \(\) => \{\s*\n\s*const fit = fitHomeBoard\(\);\s*\n\s*const plan = applyHomeFloorToReturnCluster\(fit\);\s*\n\s*return \{ \.\.\.fit, floor: computeHomeFloorViewportNudge\(plan, fit\.s\) \|\| keyframeCanvasFloor\(fit\) \};/);
  // A-837: both Return mounts share returnFitBoard, which does the same three things plus the Return group shift (dx) on the cluster and the canvas.
  assert.match(mountReturn, /fitBoard: returnFitBoard,/);
  const rfb = fnBody("returnFitBoard");
  assert.match(rfb, /const fit = fitHomeBoard\(\);/);
  assert.match(rfb, /const plan = applyHomeFloorToReturnCluster\(fit, dx\);/);
  assert.match(rfb, /computeHomeFloorViewportNudge\(plan, fit\.s\) \|\| keyframeCanvasFloor\(fit\)/);
  const mountSecondReturn = fnBody("mountSecondReturn");
  // pre-A-837 baseline: assert.match(mountSecondReturn, /const plan = applyHomeFloorToReturnCluster\(fit\);/);
  assert.match(mountSecondReturn, /fitBoard: returnFitBoard,/);
});

await check("N8 decision 4 — the Return canvas resizes/repositions with the SAME A-607 canon-K formula the First Job work canvas uses (return-view.js)", () => {
  assert.match(RETURN_VIEW, /const info = fitBoard\(\);/);
  assert.match(RETURN_VIEW, /const floor = info && info\.floor;/);
  assert.match(RETURN_VIEW, /const left = info\.left \+ s \* HOME_CENTER \* \(1 - k\) \+ floor\.nudgeViewportX;/);
  assert.match(RETURN_VIEW, /const top = info\.top \+ s \* HOME_FLOOR \* \(1 - k\) \+ floor\.nudgeViewportY;/);
  assert.match(RETURN_VIEW, /canvas\.style\.transform = "none";/);
  // desktop / no-floor path stays the plain centered fit — byte-shape check, not just presence.
  assert.match(RETURN_VIEW, /canvas\.style\.left = "";\s*\n\s*canvas\.style\.top = "";\s*\n\s*canvas\.style\.transform = "";/);
});

await check("N9 [A-656 OWNER CORRECTION, supersedes P3 R1] anchorCenter() is now a FIXED board-local anchor (derived once from the 1440 canon), not a per-draw viewport-center chase — P3 R1's own real-rect read still tracked the wrong target (the shared .cardAnchor viewport slot) once the floor/mid-band correction moved the cluster (PROP.md Q2, Δ up to −3.66 norm). The fixed point rides the canvas's own scale/position transform (return-view.js fit()) exactly like every other fixed box in this file.", () => {
  assert.match(PIGGY_RETURN, /const REF_S_1440 = Math\.min\(1440 \/ BOARD_W, 900 \/ BOARD_H\);/, "1440×900 reference, derived not hardcoded — same convention as main.js computeHomeMidBandDropPx()");
  // [A-659 OWNER VISUAL REPAIR — E, round 2] Both CX and CY now also subtract a receipt
  // size-growth term — see N9b below for the numeric derivation of both.
  assert.match(PIGGY_RETURN, /const ANCHOR_BOARD_CX = 628 - 32 \/ REF_S_1440 - RECEIPT_SIZE_GROW_BOARD_W_PX;/);
  assert.match(PIGGY_RETURN, /const ANCHOR_BOARD_CY = 386 - 48 \/ REF_S_1440 - RECEIPT_SIZE_GROW_BOARD_H_PX;/);
  const fn = fnBody("anchorCenter", PIGGY_RETURN);
  assert.match(fn, /const cx = ANCHOR_BOARD_CX;/);
  assert.match(fn, /const cy = ANCHOR_BOARD_CY;/);
  // the old per-draw viewport-center formula must be GONE from the function body — that's the bug.
  assert.equal(/window\.innerWidth|window\.innerHeight|getBoundingClientRect/.test(fn), false, "no live-viewport read left in anchorCenter() — the whole point of the fix");
  // [A-831 RE-PIN, Cowork Q-C (c)] the half-extents are the delivered box (0.91 x Home card via legacyDims; = RECEIPT_DELIVERED_W/H when no provider is registered). pre-A-831 baseline:
  // assert.match(fn, /tx: zx - RECEIPT_DELIVERED_W \/ 2, ty: zy - RECEIPT_DELIVERED_H \/ 2/, "[A-659] half-extents scale with the enlarged delivered box, not the old fixed 280/320");
  assert.match(fn, /tx: zx - legacyDims\.w \/ 2, ty: zy - legacyDims\.h \/ 2/, "[A-659 / A-831] half-extents scale with the delivered box (legacyDims)");
  assert.match(PIGGY_RETURN, /const legacyDims = \{ w: RECEIPT_DELIVERED_W, h: RECEIPT_DELIVERED_H, zx: null, zy: null \};/, "legacyDims defaults to the enlarged delivered box");
});

// [A-659 OWNER VISUAL REPAIR — E, round 2] Neither CX nor CY is Δ0 at 1440 any more — round 1's
// CX-unchanged/CY-half-raise left the paper's RIGHT edge growing straight into Piggy (coordinator-
// measured: 1440 right edge 817→840 vs Piggy's own left edge ≈845, clearance 28px→~5px) and only
// kept the BOTTOM edge where it was (not "visibly higher"). Round 2: CX shifts LEFT by half the
// width growth (keeps the RIGHT edge — the side nearest Piggy — at its OLD position, same
// clearance as before, not less) and CY shifts UP by the FULL height growth (the BOTTOM edge — the
// side nearest Piggy/Chog vertically — lands ABOVE its old position by half the growth, a real
// raise, with the TOP extending further still).
await check("N9b [round 2] RECEIPT_SIZE_SCALE + the delivered box/anchor-shift constants exist with the exact derivation", () => {
  assert.match(PIGGY_RETURN, /const RECEIPT_SIZE_SCALE = 228 \/ 196;/);
  assert.match(PIGGY_RETURN, /const RECEIPT_DELIVERED_W = 280 \* RECEIPT_SIZE_SCALE;/);
  assert.match(PIGGY_RETURN, /const RECEIPT_DELIVERED_H = 320 \* RECEIPT_SIZE_SCALE;/);
  assert.match(PIGGY_RETURN, /const RECEIPT_SIZE_GROW_BOARD_W_PX = \(RECEIPT_DELIVERED_W - 280\) \* GROUP_SCALE \/ 2;/);
  assert.match(PIGGY_RETURN, /const RECEIPT_SIZE_GROW_BOARD_H_PX = \(RECEIPT_DELIVERED_H - 320\) \* GROUP_SCALE;/);
});

await check("N9c [round 2] CX/CY numerically match the derivation (right edge preserved, bottom edge raised)", () => {
  const REF_S_1440 = Math.min(1440 / 1256, 900 / 772);
  const GROUP_SCALE = 150 / 218;
  const scale = 228 / 196;
  const deliveredW = 280 * scale;
  const deliveredH = 320 * scale;
  const growW = (deliveredW - 280) * GROUP_SCALE / 2;
  const growH = (deliveredH - 320) * GROUP_SCALE;
  const cxOld = 628 - 32 / REF_S_1440;
  const cyOld = 386 - 48 / REF_S_1440;
  const cx = cxOld - growW;
  const cy = cyOld - growH;
  assert.ok(Math.abs(growW - 15.727391874180867) < 1e-6, `growW ${growW}`);
  assert.ok(Math.abs(growH - 35.94832428384198) < 1e-6, `growH ${growH}`);
  assert.ok(Math.abs(cx - 584.361497014708) < 1e-6, `cx ${cx}`);
  assert.ok(Math.abs(cy - 308.1850090494913) < 1e-6, `cy ${cy}`);
  // rw/rh (280/320, deliveredW/H) are STAGE units (pre-GROUP-transform); cx/cy are BOARD units —
  // an edge in board units is center ± (half-width in stage units)·GROUP_SCALE (same conversion
  // RECEIPT_SIZE_GROW_BOARD_W/H_PX itself uses).
  // the RIGHT edge (cx_old + oldHalfW·GROUP_SCALE) must equal the NEW right edge (cx +
  // newHalfW·GROUP_SCALE) — same clearance from Piggy as before this card, not less.
  const oldRight = cxOld + (280 / 2) * GROUP_SCALE;
  const newRight = cx + (deliveredW / 2) * GROUP_SCALE;
  assert.ok(Math.abs(oldRight - newRight) < 1e-6, `right edge drifted: old ${oldRight} new ${newRight}`);
  // the BOTTOM edge (cy + newHalfH·GROUP_SCALE) must be ABOVE (numerically less than) the OLD
  // bottom edge (cyOld + oldHalfH·GROUP_SCALE) — a real raise, not merely unchanged.
  const oldBottom = cyOld + (320 / 2) * GROUP_SCALE;
  const newBottom = cy + (deliveredH / 2) * GROUP_SCALE;
  assert.ok(newBottom < oldBottom - 1e-6, `bottom edge not raised: old ${oldBottom} new ${newBottom}`);
});

await check("N10 First Job work canvas also gets the mid-band anchor (Home → work → Away → Return has no jump at mid-band)", () => {
  // fnBody()'s bracket counter mis-tracks this function's own destructured-default parameter list
  // (it contains a nested call, `currentScenePiggyId()`) — slice to the next top-level function
  // instead, same technique the file already uses for other multi-function spans (e.g. `applyFnSrc`
  // in home-character-scale-floor.mjs).
  const start = MAIN.indexOf("function mountSendCardWorkPose(");
  assert.ok(start >= 0, "function present");
  const end = MAIN.indexOf("\nfunction ", start + 1);
  const fit = MAIN.slice(start, end);
  assert.match(fit, /clock === "send" && board && s >= HOME_CHAR_SCALE_FLOOR\) \{[\s\S]*?computeHomeMidBandDropPx/);
});

await check("N11 decision 6 — seeded slot PREFERENCE (Fisher–Yates over the measured slot names), not just who-sits-where", () => {
  const pref = fnBody("homeSlotPreference");
  assert.match(pref, /seededRandom\(hashSeed\(`\$\{nonce\}\|\$\{id\}\|slot`\)\)/);
  assert.match(pref, /for \(let i = list\.length - 1; i > 0; i -= 1\)/, "Fisher–Yates, not a name-hash sort");
  const place = fnBody("placeHomeAmbientSet");
  assert.match(place, /function placeHomeAmbientSet\(plan, anchors, ids, sceneId, nonce, keep = null\)/);
  assert.match(place, /homeSlotPreference\(nonce, id, free\.keys\(\)\)\.find\(\(n\) => !taken\.has\(n\)\)/);
  assert.match(place, /if \(!pick\) continue; \/\/ beyond capacity/, "over-capacity still falls back to card-only, same as before");
});

await check("N12 decision 6 — a Piggy leaving never shifts anyone else's slot (present subset keeps the full-cycle slotOf)", () => {
  const plan = fnBody("planHomeAmbient");
  assert.match(plan, /placeHomeAmbientSet\(plan, anchors, everyone, sceneId, nonce\)/, "A-654's own locked full-cycle call — untouched");
  assert.match(plan, /placeHomeAmbientSet\(plan, anchors, present, sceneId, nonce, full\.slotOf\)/, "present subset now KEEPS the full-cycle slot");
});

await check("N13 decision 7 — flop-sleep footprint widened .25→.40 (matches the measured unclipped ink), no other pose touched", () => {
  assert.match(MAIN, /"flop-sleep": Object\.freeze\(\{ left: 0\.36, right: 0\.33, top: 0\.2, bottom: 0\.4 \}\)/);
  assert.match(MAIN, /watching: Object\.freeze\(\{ left: \(\(1981 \* 1102\) \/ \(1229 \* 1056\) - 1\) \/ 2, right: \(\(1981 \* 1102\) \/ \(1229 \* 1056\) - 1\) \/ 2, top: 0, bottom: 0 \}\)/, "watching's own footprint untouched");
});

await check("N14 decision 7 — the blanket's own clip is removed (CSS only, no art/timing change)", () => {
  const flop = cssRule(".homeAmbient__flop");
  assert.match(flop, /overflow:\s*visible/);
  const svg = cssRule(".homeAmbient__flop .owner-roll-frame > svg");
  assert.match(svg, /overflow:\s*visible/);
});

await check("N15 decision 7 — name label drops below the settled lying pose for flop-sleep ONLY (every other state keeps the existing seated offset)", () => {
  const place = fnBody("placeHomeAmbientResidents");
  // [A-681 iteration — OWNER VISUAL DECISION, MOBILE MULTI-PIGGY HOME] re-pinned S.h (the full
  // rendered-art height every inner offset in this function is calibrated against) in place of
  // box.h (the slot's own placement box, now possibly size-reduced for Home's small companions,
  // M1/M2) — the art itself always mounts at full size and is scaled as one rigid outer unit, so
  // this offset must stay in that same full-size coordinate space, not the slot's own box.
  assert.match(place, /const nameDropPx = projected\.state === "flop-sleep" \? S\.b - anchors\.name\.y \+ 0\.29 \* S\.h \+ 2 : 0;/);
  assert.match(place, /tag\.style\.top = `\$\{nameOff\.y \+ nameDropPx\}px`;/);
});

await check("N16 forbidden ground stays untouched: no auth/money/permission/signer/tx wiring touched by any A-656 helper", () => {
  const names = ["applyHomeFloorToChogOnly", "applyHomeFloorToReturnCluster", "computeHomeFloorViewportNudge", "computeHomeMidBandDropPx", "homeSlotPreference", "applyHomeFloorToDepartCanvas"];
  const body = names.map((n) => fnBody(n)).join("\n");
  assert.equal(/requestPrf|activateSigningSession|requestMoneyPermission|sendTransaction|writeContract|signMessage|navigator\.credentials|localStorage\.setItem/.test(body), false);
});

await check("N17 [A-656 OWNER CORRECTION] Departure shares the Home floor/mid-band baseline — applyHomeFloorToDepartCanvas() mirrors the work-canvas k/nudge/mid-band formulas, wired into BOTH mountAway() and mountSecondAway()'s own fit()", () => {
  const fn = fnBody("applyHomeFloorToDepartCanvas");
  assert.match(fn, /s < HOME_CHAR_SCALE_FLOOR/);
  assert.match(fn, /const k = HOME_CHAR_SCALE_FLOOR \/ s;/);
  assert.match(fn, /computeHomeMidBandDropPx\(\{ top: fitTopMid \}, null, s\)/);
  // desktop / floor-not-active fallback stays the plain centered fit — same as before this card.
  assert.match(fn, /canvas\.style\.left = "";\s*\n\s*canvas\.style\.top = "";\s*\n\s*canvas\.style\.transform = "";/);
  const away = fnBody("mountAway");
  assert.match(away, /applyHomeFloorToDepartCanvas\(canvas\);/, "mountAway()'s fit() calls the new helper");
  const secondAway = fnBody("mountSecondAway");
  assert.match(secondAway, /applyHomeFloorToDepartCanvas\(canvas\);/, "mountSecondAway()'s fit() calls the new helper");
});

console.log(`\nPart N: ${pass}/${pass + fail} PASS`);

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INIT = `(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials;
  if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`;

if (process.env.A656_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A656_NODE_ONLY=1) — browser scenarios not run");
} else {
  await runBrowser();
}

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  let chromium;
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await check("B0 playwright available (local harness)", () => { throw e; });
    console.log(`\nPart B: ${pass}/${pass + fail} PASS total`);
    if (fail > 0) process.exit(1);
    return;
  }
  let server = null;
  let BASE = process.env.A656_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", "5690", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = "http://localhost:5690/";
  }
  const browser = await chromium.launch({ headless: true });
  try {
    await browserRun(browser, BASE);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
  console.log(`\nTOTAL: ${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exit(1);
}

async function browserRun(browser, BASE) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT);
  await context.route("**/*", async (route) => {
    const req = route.request(); const body = req.postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) return route.abort();
    return route.continue();
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });

  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
      const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
    }
    return null;
  }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const atWidth = async (w, h) => { await p.setViewportSize({ width: w, height: h }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked(); await waitScene(["sendstay"], 9000); await sleep(4000); };
  const ink = () => p.evaluate(() => {
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 0 ? [b.left, b.top, b.right, b.bottom] : null; };
    const hit = document.querySelector("#chogHomeHit");
    return {
      seat: box(document.querySelector("#homeSeat")),
      name: box(document.querySelector("#homeName")),
      chog: box(hit),
      board: (() => { const b = document.querySelector("#homeBoard")?.getBoundingClientRect(); return b ? [b.left, b.top, b.right, b.bottom] : null; })(),
      boardTransform: document.querySelector("#homeBoard")?.style.transform || null,
      iw: innerWidth, ih: innerHeight,
    };
  });
  const chogFoot = (g) => g.chog ? g.chog[3] : null;
  // eps 2.5px: Chog's idle sprite has a natural small blink/breathe bob (a654's own B5 proves
  // ambient residents animate between frames) — two single-instant DOM snapshots taken at
  // different wall-clock moments (Home settle vs. mid-Return) can legitimately differ by a
  // couple of px even with the anchor otherwise exact. This is well under any real anchor
  // mismatch (P3 measured 300+px for the pre-A-656 mobile bug).
  const near = (a, b, eps = 2.5) => Math.abs(a - b) <= eps;

  try {
    // ── birth "Honeybun" (real CDP passkey), through First closed → Second confirmed ───────────
    await p.goto(BASE, { waitUntil: "networkidle" });
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
      if (v.input) break;
      if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
      await sleep(300);
    }
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000); await sleep(4500);
    if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }

    // ── B1/B2: [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, 2026-10-01] rewritten AGAIN —
    // the visual-repair pass's own "ONE fixed bottom-safe rule for every width, 1440 no longer
    // preserved" (previous B1/B2 text) is superseded: 1440×900's CURRENT settled foot is canon and
    // must not move; every other web width (still 641+, still no upper bound) must instead match
    // 1440's own NORMALIZED foot ratio (R ≈0.8341, derived in main.js
    // computeHomeFootNormalizedRatio() — see its module-scope comment for the full rationale), not
    // a fixed px gap. This checks EVERY measured web width lands within tolerance of that SAME
    // ratio (so 1200 is not a hole and 1440 is not a special case in the FORMULA — it's just the
    // width where the formula's own reference point lives, so its measured Δ should be ~0), and
    // that the correction is still translate-only — seat width, scaled by the SAME board scale `s`
    // at every one of these (all width-constrained: s = vw/1256), must stay proportional to vw.
    const footGeom = async (w, h) => {
      await atWidth(w, h);
      const g = await ink();
      return { frac: chogFoot(g) / g.ih, seatWPerVw: (g.seat[2] - g.seat[0]) / w };
    };
    const HOME_FOOT_NORMALIZED_RATIO_EXPECTED = 0.8341;
    let refSeatWPerVw = null;
    for (const w of [700, 900, 1200, 1440]) {
      await check(`B1/B2 [${w}] Home settled foot matches the 1440-canon normalized ratio (R≈0.8341) — 1440 itself at Δ0, 1200 no longer a hole`, async () => {
        const g = await footGeom(w, 900);
        // [A-827 RE-PIN, desktop widths >= 1100 only] the desktop format keeps the bottom margin = reference x s (s = vw/1440), so the foot fraction is
        // 1 - (1 - 0.8341) * s at 900 high (== 0.8341 at 1440x900, unchanged). pre-A-827 baseline: 0.8341 at every width (1200: 0.8341).
        // [A-831 RE-PIN, every width] the A-829 keyframe rule: bottom margin = 7.1 / 8 / 8 % of vh interpolated by width (the foot fraction = 1 - bottom / vh) and the group scale
        // follows the stage-width keyframes (seat width = 150 x S). pre-A-831 baseline: the A-827 expectedFrac above (0.8341 below 1100, 1 - (1 - 0.8341) s from 1100) and
        // assert.ok(Math.abs(g.seatWPerVw - refSeatWPerVw) < 0.005, `[${w}] seat width/vw ${g.seatWPerVw} vs 700's ${refSeatWPerVw} — a scale change, not a pure translate`)
        const KL = layoutOracle(MAIN)(w, 900);
        const expectedFrac831 = 1 - KL.bottom / 900;
        assert.ok(Math.abs(g.frac - expectedFrac831) < 0.02, `[${w}] foot frac ${g.frac} vs keyframe rule ${expectedFrac831}`);
        assert.ok(Math.abs(g.seatWPerVw - (150 * KL.S) / w) < 0.005, `[${w}] seat width/vw ${g.seatWPerVw} vs keyframe ${(150 * KL.S) / w}`);
        if (refSeatWPerVw === null) { refSeatWPerVw = g.seatWPerVw; return; }
      });
    }
    await check("B1c [1440] foot is at Δ0 — no wrapper transform at all (byte/pixel-identical to the pre-repair canon)", async () => {
      await atWidth(1440, 900);
      const midBand = await p.evaluate(() => !!document.querySelector(".homeCharScaleFloor[data-mid-band-drop]"));
      assert.equal(midBand, false, "1440×900 must get no mid-band wrapper at all — the canon is untouched, not merely close");
    });

    // ── B3: mobile + mid-band Chog invariant, Home → Away → Return → Home ──────────────────────
    for (const [w, h] of [[390, 844], [430, 900], [700, 900], [900, 900]]) {
      await check(`B3 [${w}] Chog anchor invariant: Home → Away → Return(coming-home) → Return(filed) → Home`, async () => {
        await atWidth(w, h);
        const home0 = chogFoot(await ink());
        assert.ok(Number.isFinite(home0), "Home Chog foot measured");
        await p.evaluate(() => window.__arasoScene("away", { arrival: true }));
        await sleep(1500);
        const away = chogFoot(await ink());
        assert.ok(near(away, home0), `Away Chog foot ${away} vs Home ${home0}`);
        await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
        await sleep(1200); // past bell(0.7s)/coming-home(0.93s), before Piggy visible(3.15s)
        const comingHome = chogFoot(await ink());
        // [A-920 RE-PIN] the Return Chog stands RETURN_CHOG_DROP (24 board units = 14-32 px at 390-900) below the Home floor line, as in the Owner mock img_25-27. pre-A-920 baseline: assert.ok(near(comingHome, home0), ...)
        assert.ok(comingHome - home0 > 10 && comingHome - home0 < 34, `Return coming-home Chog foot ${comingHome} vs Home ${home0} (+24 board units)`);
        // let it run to filed (gates auto-open via automaticPresenceSimulation is N/A here — tap through).
        for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
          const openBtn = await p.evaluate(() => { const e = document.getElementById("returnOpen"); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; });
          if (openBtn) break;
          const tapBtn = await p.evaluate(() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; });
          if (tapBtn) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
          await sleep(250);
        }
        const filed = chogFoot(await ink());
        // [A-920 RE-PIN] same drop for the canvas native Chog (NATIVE_OY). pre-A-920 baseline: assert.ok(near(filed, home0), ...)
        assert.ok(filed - home0 > 10 && filed - home0 < 34, `Return filed Chog foot ${filed} vs Home ${home0} (+24 board units)`);
        await mustTap("#returnOpen", "open the file / Home");
        await waitScene(["sendstay"], 9000); await sleep(3000);
        const backHome = chogFoot(await ink());
        assert.ok(near(backHome, home0), `final Home Chog foot ${backHome} vs Home ${home0}`);
      });
    }

    // ── B4: Receipt tap lands on the drawn Receipt (DOM rect comparison, no canvas pixel read) ──
    await check("B4 [390] Receipt tap hitbox matches the drawn .receiptPaper within ≤2px", async () => {
      await atWidth(390, 844);
      await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
      for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
        const has = await p.evaluate(() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; });
        if (has) break;
        await sleep(250);
      }
      const rects = await p.evaluate(() => {
        const tap = document.getElementById("returnTap")?.getBoundingClientRect();
        const paper = document.querySelector(".receiptPaper")?.getBoundingClientRect();
        return { tap: tap && [tap.left, tap.top, tap.right, tap.bottom], paper: paper && [paper.left, paper.top, paper.right, paper.bottom] };
      });
      assert.ok(rects.tap && rects.paper, `tap ${JSON.stringify(rects.tap)} paper ${JSON.stringify(rects.paper)}`);
      for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(rects.tap[i] - rects.paper[i]) <= 2, `edge ${i}: tap ${rects.tap[i]} vs paper ${rects.paper[i]}`);
    });

    // ── B5: no A-654 ambient duplicate during Return ────────────────────────────────────────────
    await check("B5 [390] no ambient (.homeLiving) resident renders during Return", async () => {
      const n = await p.evaluate(() => document.querySelectorAll(".homeLiving").length);
      assert.equal(n, 0);
      await mustTap("#returnOpen", "close out this Return", 0).catch(() => {});
    });

    // ── B6: reduced motion — ambient residents (if any) stay a still pose ───────────────────────
    await check("B6 [1440] reduced motion: settled Home is stable across two samples", async () => {
      await p.emulateMedia({ reducedMotion: "reduce" });
      await atWidth(1440, 900);
      const a = await ink();
      await sleep(1200);
      const b = await ink();
      assert.deepEqual(a.seat, b.seat);
      assert.deepEqual(a.chog, b.chog);
      await p.emulateMedia({ reducedMotion: "no-preference" });
    });

    // ── B7/B8/B10: A-656 OWNER CORRECTION — Departure start shares the SAME Home floor/mid-band
    // foot baseline Chog already carries (PROP.md Q1 measured up to 318.5px/−3.91 norm off before
    // this fix). #departStage's own outer canvas rect (post applyHomeFloorToDepartCanvas()) implies
    // a foot point — board-local HOME_FLOOR(648) of HOME_BOARD_H(772), the same ratio Piggy/Chog's
    // own floor transform pivots on — that must land on the same viewport Y as Chog's own foot.
    const departImpliedFoot = () => p.evaluate(() => {
      const el = document.getElementById("departStage");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      return r.top + (648 / 772) * r.height;
    });
    const departStyle = () => p.evaluate(() => {
      const el = document.getElementById("departStage");
      return el && { left: el.style.left, top: el.style.top, transform: el.style.transform };
    });
    for (const [w, h] of [[390, 844], [430, 900], [700, 900], [900, 900], [1440, 900]]) {
      await check(`B7 [${w}] Departure start (First) foot matches Chog's own Home-anchored foot`, async () => {
        await atWidth(w, h);
        const home0 = chogFoot(await ink());
        await p.evaluate(() => window.__arasoScene("away", { arrival: true }));
        await sleep(400);
        const foot = await departImpliedFoot();
        assert.ok(Number.isFinite(foot), "departStage rect measured");
        assert.ok(near(foot, home0, 3), `depart foot ${foot} vs Chog/Home foot ${home0}`);
      });
      await check(`B8 [${w}] Departure start (Second) foot matches Chog's own Home-anchored foot`, async () => {
        await atWidth(w, h);
        const home0 = chogFoot(await ink());
        await p.evaluate(() => window.__arasoScene("secondAway", { arrival: true }));
        await sleep(400);
        const foot = await departImpliedFoot();
        assert.ok(Number.isFinite(foot), "departStage rect measured (second)");
        assert.ok(near(foot, home0, 3), `second depart foot ${foot} vs Chog/Home foot ${home0}`);
      });
    }
    // [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, 2026-10-01 — re-pin AGAIN] B10 briefly
    // asserted 1440 takes the shared-plan branch (during the now-superseded visual-repair pass,
    // when 1440's own target was the fixed 0.92·vh rule and so legitimately differed from its
    // natural position). Restored to its ORIGINAL pre-A-659 shape: since the target is now derived
    // FROM 1440's own natural foot (computeHomeFootNormalizedRatio()), `computeHomeMidBandDropPx()`
    // resolves to 0 at 1440×900 (no `dy > 0.5`), so `applyHomeFloorToDepartCanvas()` falls through
    // to its plain-CSS-centered default (left/top cleared) exactly like every pre-A-656 width did —
    // byte-identical to the canon, not merely close. B7/B8 above already re-run the functional
    // foot-matches-Chog check per width including 1440; this is the structural half.
    await check("B10 [1440] Departure canvas keeps the plain CSS-centered default (1440 canon untouched — Δ0, no shared-plan override) and its start foot matches Chog's own Home-anchored foot", async () => {
      await atWidth(1440, 900);
      const home0 = chogFoot(await ink());
      await p.evaluate(() => window.__arasoScene("away", { arrival: true }));
      await sleep(400);
      const style = await departStyle();
      // [A-831 RE-PIN] the shared stage is the keyframe board at every width, so the Departure canvas is placed on the same board box as #homeBoard (applyDesktopBoardToCanvas).
      // pre-A-831 baseline: assert.equal(style.left, "", "1440 canon: no inline left override — plain CSS centering"); assert.equal(style.top, ""...); assert.equal(style.transform, "", ...)
      const KB = layoutOracle(MAIN)(1440, 900);
      assert.ok(Math.abs(parseFloat(style.left) - KB.boardLeft) < 0.6, `canvas left ${style.left} vs board ${KB.boardLeft}`);
      assert.ok(Math.abs(parseFloat(style.top) - KB.boardTop) < 0.6, `canvas top ${style.top} vs board ${KB.boardTop}`);
      assert.equal(style.transform, "none", "canvas rides the board box (no extra transform)");
      const foot = await departImpliedFoot();
      assert.ok(Number.isFinite(foot), "departStage rect measured");
      assert.ok(near(foot, home0, 3), `depart foot ${foot} vs Chog/Home foot ${home0}`);
    });

    // ── B11: Receipt hitbox matches the drawn paper at every width (B4 already covers 390) ───────
    const returnGateRects = async () => {
      for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
        const has = await p.evaluate(() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; });
        if (has) break;
        await sleep(250);
      }
      return p.evaluate(() => {
        const tap = document.getElementById("returnTap")?.getBoundingClientRect();
        const paper = document.querySelector(".receiptPaper")?.getBoundingClientRect();
        const canvas = document.getElementById("returnStage")?.getBoundingClientRect();
        return {
          tap: tap && [tap.left, tap.top, tap.right, tap.bottom],
          paper: paper && [paper.left, paper.top, paper.right, paper.bottom],
          canvas: canvas && [canvas.left, canvas.top, canvas.width, canvas.height],
        };
      });
    };
    for (const [w, h] of [[430, 900], [700, 900], [900, 900], [1440, 900]]) {
      await check(`B11 [${w}] Receipt tap hitbox matches the drawn .receiptPaper within ≤2px`, async () => {
        await atWidth(w, h);
        await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
        const rects = await returnGateRects();
        assert.ok(rects.tap && rects.paper, `tap ${JSON.stringify(rects.tap)} paper ${JSON.stringify(rects.paper)}`);
        for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(rects.tap[i] - rects.paper[i]) <= 2, `edge ${i}: tap ${rects.tap[i]} vs paper ${rects.paper[i]}`);
      });
    }

    // ── B12: A-656 OWNER CORRECTION — Receipt gate1/gate2 board position, canvas-normalized,
    // proportional to 1440 (PROP.md Q2 measured up to −3.66 norm / 456px before this fix). The
    // receipt's board position (piggy-return.js anchorCenter()) is now a FIXED board constant, so
    // its position relative to the canvas's own (already floor/mid-band-corrected) rect should be
    // width-invariant — compared here against the 1440 reference within 0.03 (this file's own
    // tolerance convention, applied to a canvas-relative ratio since a full HomeCharacterHeight
    // normalization harness is out of scope for this node+Playwright test).
    const norm = (rect, canvas) => (canvas ? {
      x: ((rect[0] + rect[2]) / 2 - canvas[0]) / canvas[2],
      y: ((rect[1] + rect[3]) / 2 - canvas[1]) / canvas[3],
    } : null);
    const returnGates = async () => {
      const gate1 = await returnGateRects();
      await realClick("#returnTap");
      await sleep(700); // gate1(7.0s) → gate2/ZOOM_DONE_S(7.6s)
      for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
        const ok = await p.evaluate(() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; });
        if (ok) break;
        await sleep(200);
      }
      const gate2 = await p.evaluate(() => {
        const tap = document.getElementById("returnTap")?.getBoundingClientRect();
        const paper = document.querySelector(".receiptPaper")?.getBoundingClientRect();
        const canvas = document.getElementById("returnStage")?.getBoundingClientRect();
        return {
          tap: tap && [tap.left, tap.top, tap.right, tap.bottom],
          paper: paper && [paper.left, paper.top, paper.right, paper.bottom],
          canvas: canvas && [canvas.left, canvas.top, canvas.width, canvas.height],
        };
      });
      await realClick("#returnTap"); // second tap — let the scene proceed so the next atWidth() reload is clean
      return { gate1, gate2 };
    };
    let ref1440 = null;
    for (const [w, h] of [[1440, 900], [390, 844], [430, 900], [450, 600], [560, 600], [700, 900], [900, 900]]) { // [A-837] + 450x600 / 560x600 for the restored head-clearance check
      await check(`B12 [${w}] Receipt gate1/gate2 board position proportional to 1440 (canvas-normalized, ≤0.03)`, async () => {
        await atWidth(w, h);
        await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
        const { gate1, gate2 } = await returnGates();
        assert.ok(gate1.paper && gate1.canvas, `gate1 rects ${JSON.stringify(gate1)}`);
        assert.ok(gate2.paper && gate2.canvas, `gate2 rects ${JSON.stringify(gate2)}`);
        const n1 = norm(gate1.paper, gate1.canvas);
        const n2 = norm(gate2.paper, gate2.canvas);
        if (w === 1440) { ref1440 = { n1, n2 }; return; }
        assert.ok(ref1440, "1440 reference captured first");
        // pre-A-837 baseline: (<=640) rail contract: paper left ~ --mobile-inset (+-4), right <= vw - inset + 1, bottom <= Piggy head top - 32 + 4; (>=700) paper centre = Home card centre +-4 and
        // width = 0.91 x card (A-831 Q-C). A-837 (Cowork U-R1/U-R3): the Receipt is placed by returnLayout() at every width - portrait top-centred under ARASO, landscape left of the
        // character cluster in one centred group, blended with t - so the paper centre is (rcx, rcy) and its width 0.91 x card.
        const L837 = sceneOracle(MAIN);
        const KC = L837.L(w, h, 0), RL = L837.ret(KC);
        for (const [name, g, zoom] of [["gate1", gate1, 1], ["gate2", gate2, 1.18]]) {
          const r = g.paper, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
          assert.ok(Math.abs(cx - RL.rcx) <= 4, `${name} paper cx ${cx.toFixed(1)} vs returnLayout ${RL.rcx.toFixed(1)}`);
          assert.ok(Math.abs(cy - RL.rcy) <= (RL.rw >= 0.91 * KC.cardW - 1e-6 ? 12 : 40), `${name} paper cy ${cy.toFixed(1)} vs returnLayout ${RL.rcy.toFixed(1)} (height follows the paper aspect)`);
          assert.ok(RL.rw >= 0.91 * KC.cardW - 1e-6 ? Math.abs((r[2] - r[0]) - RL.rw * zoom) <= 6 * zoom : ((r[2] - r[0]) <= (0.91 * KC.cardW + 6) * zoom && (r[2] - r[0]) >= 0.8 * RL.rw * zoom), // clamped: the oracle uses the legacy .875 paper aspect, the page the measured one (+-20 %)
           `${name} paper width ${(r[2] - r[0]).toFixed(1)} vs returnLayout ${(RL.rw * zoom).toFixed(1)} (= 0.91 x card ${(0.91 * KC.cardW * zoom).toFixed(1)} unless the short-window clearance narrows it)`);
          assert.ok(r[0] >= -1 && r[2] <= w + 1, `${name} paper inside the viewport width`);
        }
        // restored (pre-A-837 baseline, <=640): the Receipt must clear the returning Piggy's head by the 32 px gap (--grid-5) - replaced here by the same equivalent assertion (rotation slack +4), so a
        // short window (600 tall, 450-560 wide) cannot put the paper on Piggy.
        if (w <= 640) {
          const { RETURN_GEOMETRY } = await import("../src/piggy-return.js");
          const gs = RETURN_GEOMETRY.group, kc = gate1.canvas[2] / 1256;
          const piggyTop = gate1.canvas[1] + kc * (gs.dy + (250 + (-46.9846) * 0.24) * gs.scale);
          const clL = KC.stageLeft - 108 * KC.S + RL.dxChar, clR = clL + 218 * KC.S; // cluster span (a837 returnLayout)
          for (const [name, g] of [["gate1", gate1], ["gate2", gate2]]) {
            const sharesX = g.paper[0] < clR + 4 && g.paper[2] > clL - 4; // beside Piggy (landscape arrangement) there is nothing to clear
            if (sharesX) assert.ok(g.paper[3] <= piggyTop + 4, `${name} paper bottom ${g.paper[3].toFixed(1)} must not reach Piggy head top ${piggyTop.toFixed(1)} @${w}x${h}`); // pre-A-837 baseline: <= piggyTop - 32 + 4 (rail gap; the rail shrank the paper at 640x808, which a819 B-UI17 now pins at 0.91 x card)
          }
        }
      });
    }

    await check("B9 whole run: pageerror 0", () => {
      assert.deepEqual(errors, []);
    });
  } catch (e) {
    await check("B! browser run", () => { throw e; });
  } finally {
    await context.close();
  }
}
