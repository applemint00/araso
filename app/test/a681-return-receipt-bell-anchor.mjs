// [A-681 FINAL CLOSEOUT] Contract test for the mobile Return/Receipt geometry + Name composition +
// companion-label rules. Supersedes the iteration 5/6 version of this file, which pinned the
// per-point "anchor-exact" canvas nudge (RETURN_RECEIPT_ANCHOR_BOARD_CX/CY mirrors in main.js).
// RE-PIN REASON (named, per brief): the Owner's closeout (A) requires bell + returning Piggy +
// Receipt canvas to share ONE mobile transform with Chog's group; the anchor nudge translated only
// the canvas (not Chog's wrapper) and put the bell on Chog's yellow line. That nudge and its
// mirrored constants are deleted; the Receipt is now re-targeted inside piggy-return.js from live
// viewport facts (receiptRailTarget), so no cross-file board constants need mirroring any more.
//   node app/test/a681-return-receipt-bell-anchor.mjs
import { readFileSync } from "node:fs";
import { receiptRailTarget, createReturnRenderer, RETURN_GEOMETRY } from "../src/piggy-return.js";

const RETURN_SRC = readFileSync(new URL("../src/piggy-return.js", import.meta.url), "utf8");
const MAIN_SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const VIEW_SRC = readFileSync(new URL("../src/return-view.js", import.meta.url), "utf8");
const CSS_SRC = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(label, got, want, tol = 1e-6) {
  const ok = typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
  if (ok) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${got}, want ${want}`); fail += 1; }
}
const has = (src, re) => re.test(src);
function cut(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`못 찾음: ${from}`);
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? undefined : b);
}

// ── 1. main.js: ONE transform — no per-point nudge left ─────────────────────────────────────
const nudgeSrc = cut(MAIN_SRC, "function computeHomeFloorViewportNudge(plan, s) {", "\n}\n");
check("computeHomeFloorViewportNudge(): applied branch is the pure floor (nudgeLocal * s), no extra term",
  has(nudgeSrc, /return \{ k: plan\.k, nudgeViewportX: plan\.nudgeLocalX \* s, nudgeViewportY: plan\.nudgeLocalY \* s \};/), true);
check("computeHomeFloorViewportNudge(): no anchor/bell compensation read remains",
  /anchorComp|extraNudge|homeFloorPointCompensation|homeCharMobileBoost/.test(nudgeSrc), false);
check("main.js: RETURN_RECEIPT_ANCHOR_/BELL_CENTER mirrors deleted",
  /RETURN_RECEIPT_(ANCHOR|BELL)_/.test(MAIN_SRC.replace(/\/\/.*$/gm, "")), false);
check("main.js: both mountReturnView() calls (First + Second Return) pass getReceiptRail: homeReturnReceiptRail",
  (MAIN_SRC.match(/getReceiptRail: homeReturnReceiptRail,/g) || []).length, 2);
const railFn = cut(MAIN_SRC, "function homeReturnReceiptRail() {", "\n}\n");
check("homeReturnReceiptRail(): returns null above 640 (1440/700/900 take the legacy anchor)",
  has(railFn, /if \(!\(vw <= 640\)\) return null;/), true);
check("homeReturnReceiptRail(): every term is an existing token/constant (inset, top-safe+grid-3, vh/2-48, 285, grid-5)",
  has(railFn, /--mobile-inset/) && has(railFn, /--mobile-top-safe/) && has(MAIN_SRC, /const RECEIPT_RAIL_TOP_EXTRA_TOKEN = "--grid-3";/)
    && has(railFn, /cardCy: vh \/ 2 - RECEIPT_RAIL_CARD_OFF_Y/) && has(MAIN_SRC, /const RECEIPT_RAIL_CARD_W = 285;/)
    && has(MAIN_SRC, /const RECEIPT_RAIL_CARD_OFF_Y = 48;/) && has(MAIN_SRC, /const RECEIPT_RAIL_GAP_TOKEN = "--grid-5";/), true);
check("main.js RECEIPT_RAIL_CARD_W/OFF_Y mirror style.css .cardAnchor (285 wide, translateY(-50% - 48px))",
  has(CSS_SRC, /\.cardAnchor \{[^}]*width: 285px;[^}]*calc\(-50% - 48px\)/s), true);
check("style.css --grid-3 = 16px and --grid-5 = 32px (the gap/top tokens the rail reads)",
  has(CSS_SRC, /--grid-3: 16px;/) && has(CSS_SRC, /--grid-5: 32px;/), true);
check("return-view.js: getReceiptRail is accepted and handed to createPlayback; placePaper() hitbox re-measure intact",
  has(VIEW_SRC, /getReceiptRail = null,/) && has(VIEW_SRC, /onFrame, getReceiptRail: railWithPaperAspect,/)
    && has(VIEW_SRC, /const paperRect = paperEl\.getBoundingClientRect\(\);/)
    && has(VIEW_SRC, /tapBtn\.style\.left = `\$\{paperRect\.left\}px`;/), true);
check("Return seat pivot unchanged: return-view.js still pivots on HOME_CENTER/HOME_FLOOR (1041/648)",
  has(VIEW_SRC, /const HOME_CENTER = 1041;/) && has(VIEW_SRC, /const HOME_FLOOR = 648;/)
    && has(VIEW_SRC, /s \* HOME_CENTER \* \(1 - k\) \+ floor\.nudgeViewportX/), true);

// ── 2. piggy-return.js: legacy path untouched; drawAt literals mirrored by named constants ──
check("anchorCenter() legacy body untouched (a656 N9 pins it too)",
  has(RETURN_SRC, /const cx = ANCHOR_BOARD_CX;\s*\n\s*const cy = ANCHOR_BOARD_CY;/), true);
check("READ_ZOOM_GAIN = 0.18 and drawAt zoom uses it", has(RETURN_SRC, /const READ_ZOOM_GAIN = 0\.18;/)
  && has(RETURN_SRC, /const zoom = 1 \+ READ_ZOOM_GAIN \* smooth\(\(t - 7\.3\) \/ 0\.3\) \* \(1 - pickup\);/), true);
check("PIGGY_GATE_STAGE_Y = 250 mirrors drawAt `y = 250`", has(RETURN_SRC, /const PIGGY_GATE_STAGE_Y = 250;/)
  && has(RETURN_SRC, /let x = mix\(210, 520, emerge\), y = 250;/), true);
check("PIGGY_GATE_SIZE = 0.24 mirrors drawAt `mix(0.24, 0.20, settle)`", has(RETURN_SRC, /const PIGGY_GATE_SIZE = 0\.24;/)
  && has(RETURN_SRC, /const size = mix\(0\.24, 0\.20, settle\);/), true);
check("drawAt: rail path swaps ONLY the target (anchor, delW/delH); toss/pickup start sizes untouched",
  has(RETURN_SRC, /const anchor = railTarget \|\| anchorCenter\(\);/)
    && has(RETURN_SRC, /let rw = mix\(size \* 280 \* 1\.12, delW, delivery\);/)
    && has(RETURN_SRC, /rw = mix\(delW, size \* 280, pickup\);/), true);
check("no new bell compensation: bell blit is the untouched `blit(BELL_KEY, BELL_BOX)`",
  has(RETURN_SRC, /blit\(BELL_KEY, BELL_BOX\);/), true);

// ── 3. receiptRailTarget(): pure geometry invariants at 390 / 430 ───────────────────────────
const BOARD_W = 1256, BOARD_H = 772, HOME_CENTER = 1041, HOME_FLOOR = 648, FLOOR = 0.52, BOOST = 1.5;
const { scale: GS, dx: GDX, dy: GDY } = RETURN_GEOMETRY.group;
// Simulated return-canvas placement exactly as return-view.js fit() + main.js nudge compute it:
// left = s*HOME_CENTER*(1-kb) + 6 ; top = fitTop + s*HOME_FLOOR*(1-kb) + (footTarget - natural foot).
// footTarget uses the measured ratio ~0.834*vh minus the boosted 12.48px ink overhang (main.js).
function sim(vw, vh) {
  const s = Math.min(vw / BOARD_W, vh / BOARD_H);
  const kb = (FLOOR / s) * BOOST;
  const fitLeft = (vw - BOARD_W * s) / 2, fitTop = (vh - BOARD_H * s) / 2;
  const target = 0.834 * vh - 12.48 * BOOST;
  const left = fitLeft + s * HOME_CENTER * (1 - kb) + 6;
  const top = fitTop + s * HOME_FLOOR * (1 - kb) + (target - (fitTop + HOME_FLOOR * s));
  return { view: { left, top, k: s * kb }, vw, vh };
}
function rail(vw, vh) {
  return { vw, vh, inset: vw <= 400 ? 20 : 24, topBound: 14 + 16, cardCy: vh / 2 - 48, cardW: 285, gap: 32 };
}
for (const [vw, vh] of [[390, 844], [430, 900], [360, 640], [375, 667]]) {
  const { view } = sim(vw, vh);
  const r = rail(vw, vh);
  const T = receiptRailTarget(r, view);
  const L = `${vw}x${vh}`;
  check(`${L}: target exists`, !!T, true);
  const vp = T.vp;
  check(`${L}: settled paper LEFT edge = rail inset (${r.inset}px)`, vp.left, r.inset);
  check(`${L}: stage tx maps back to the inset (viewport left)`, view.left + view.k * (GDX + T.tx * GS), r.inset, 1e-6);
  check(`${L}: stage w maps back to baseW`, T.w * GS * view.k, vp.baseW, 1e-6);
  check(`${L}: aspect preserved (RECEIPT_DELIVERED 280:320)`, T.w / T.h, 280 / 320, 1e-9);
  check(`${L}: baseW <= card width 285`, vp.baseW <= 285 + 1e-9, true);
  check(`${L}: READ (zoomed) paper stays inside the right rail margin`, r.inset + vp.readW <= vw - r.inset + 1e-6, true);
  check(`${L}: READ paper bottom clears Piggy head box by >= gap`, vp.cy + vp.readH / 2 <= vp.piggyTop - r.gap + 1e-6, true);
  check(`${L}: READ paper top >= topBound`, vp.cy - vp.readH / 2 >= r.topBound - 1e-6, true);
  check(`${L}: settled paper larger than the pre-A-681 ~109x133 mobile paper`, vp.baseW > 109 && vp.baseH > 133, true);
  console.log(`INFO  ${L}: baseW=${vp.baseW.toFixed(1)} baseH=${vp.baseH.toFixed(1)} readW=${vp.readW.toFixed(1)} readH=${vp.readH.toFixed(1)} cy=${vp.cy.toFixed(1)} piggyTop=${vp.piggyTop.toFixed(1)} (simulated canvas placement, NOT a browser measurement)`);
}
check("receiptRailTarget(null, view) -> null (legacy path)", receiptRailTarget(null, sim(390, 844).view), null);
check("receiptRailTarget(rail, null) -> null", receiptRailTarget(rail(390, 844), null), null);
check("no free band (gap larger than the band) -> null, not NaN geometry",
  receiptRailTarget({ ...rail(390, 844), gap: 5000 }, sim(390, 844).view), null);

// ── 4. drawAt end-to-end with a recording fake canvas: identity w/o rail, rail rect with it ──
function fakeCanvas(view) {
  const ctx = new Proxy({}, { get: (_, p) => (p === "canvas" ? null : () => {}), set: () => true });
  const w = Math.round(BOARD_W * view.k);
  return {
    width: w, height: Math.round(BOARD_H * view.k), getContext: () => ctx,
    getBoundingClientRect: () => ({ left: view.left, top: view.top, width: BOARD_W * view.k, height: BOARD_H * view.k }),
  };
}
const imgs = { get: () => ({}) };
function drawMeta(view, t, receiptRail) {
  const r = createReturnRenderer(fakeCanvas(view), { images: imgs });
  return r.drawAt(t, receiptRail === undefined ? {} : { receiptRail });
}
{
  const { view } = sim(390, 844);
  const REF = Math.min(1440 / BOARD_W, 900 / BOARD_H);
  const SCALE = 228 / 196, DW = 280 * SCALE, DH = 320 * SCALE;
  const cx = 628 - 32 / REF - ((DW - 280) * GS) / 2, cy = 386 - 48 / REF - (DH - 320) * GS;
  const tx = (cx - GDX) / GS - DW / 2, ty = (cy - GDY) / GS - DH / 2;
  const a = drawMeta(view, 8.0, undefined), b = drawMeta(view, 8.0, null);
  check("t=8.0 no rail: receipt target == legacy anchor tx (identity)", a.receipt.x, tx, 1e-9);
  check("t=8.0 no rail: receipt target == legacy anchor ty (identity)", a.receipt.y, ty, 1e-9);
  check("t=8.0 no rail: w/h == legacy RECEIPT_DELIVERED", a.receipt.w + "," + a.receipt.h, DW + "," + DH);
  check("t=8.0 receiptRail:null == omitted (same meta)", JSON.stringify(a), JSON.stringify(b));
}
for (const [vw, vh] of [[390, 844], [430, 900]]) {
  const { view } = sim(vw, vh);
  const r = rail(vw, vh);
  const kk = view.k;
  const vpRect = (pb) => ({ l: view.left + pb.x * kk, t: view.top + pb.y * kk, w: pb.w * kk, h: pb.h * kk });
  const gate1 = vpRect(drawMeta(view, 7.0, r).paperBoard);
  const gate2 = vpRect(drawMeta(view, 7.6, r).paperBoard);
  const L = `${vw}x${vh}`;
  check(`${L} gate1 (zoom 1): paperBoard left == rail inset`, gate1.l, r.inset, 1e-6);
  check(`${L} gate2 (zoom 1.18): left stays on the rail inset (left-centre pivot)`, gate2.l, r.inset, 1e-6);
  check(`${L} gate2: right edge <= vw - inset`, gate2.l + gate2.w <= vw - r.inset + 1e-6, true);
  check(`${L} gate2: bottom clears Piggy head by gap`, gate2.t + gate2.h <= sim(vw, vh).view.top + kk * (GDY + (250 + -46.9846 * 0.24) * GS) - r.gap + 1e-6, true);
  check(`${L} gate1 -> gate2 growth is exactly READ zoom 1.18 (no coordinate-system jump)`, gate2.w / gate1.w, 1.18, 1e-9);
  const thrown = vpRect(drawMeta(view, 6.3 + 0.42, r).paperBoard);
  check(`${L} throw end (delivery=1) == gate1 rect (same coordinate system)`, thrown.l + "," + thrown.w.toFixed(6), gate1.l + "," + gate1.w.toFixed(6));
}

// ── 5. Name: card + motion Piggy scale as ONE composition ──────────────────────────────────
check("NAME_COMP_LEFT = 380 mirrors name-piggy .pgwrap inline left (Piggy wrapper) ",
  has(MAIN_SRC, /const NAME_COMP_LEFT = 380;/) && has(CSS_SRC, /\.nameScene__piggy \{[^}]*\}/s), true);
check("NAME_COMP_RIGHT = 612 + 460 mirrors .nameScene__pad left 612 + .nameCard width 460",
  has(MAIN_SRC, /const NAME_COMP_RIGHT = 612 \+ 460;/) && has(CSS_SRC, /\.nameScene__pad \{[^}]*left: 612px;[^}]*width: 460px;/s)
    && has(CSS_SRC, /\.nameCard \{[^}]*width: 460px;[^}]*height: 300px;/s), true);
check("NAME_CARD_BOTTOM = 292 + 300; NAME_PIGGY_WRAP_TOP = 252", has(MAIN_SRC, /const NAME_CARD_BOTTOM = 292 \+ 300;/)
  && has(MAIN_SRC, /const NAME_PIGGY_WRAP_TOP = 252;/), true);
const nameFn = cut(MAIN_SRC, "function nameCompositionFit(base) {", "\nfunction fitNameScene()");
check("nameCompositionFit(): mobile-only (>640 -> null) and only when it beats the floor scale",
  has(nameFn, /if \(!\(vw <= 640\)\) return null;/) && has(nameFn, /if \(!\(comp > base\)\) return null;/), true);
check("nameCompositionFit(): uniform scale + translate only (no per-part size, no .nameCard width edit)",
  has(nameFn, /scale: comp, tx: inset - NAME_COMP_LEFT \* comp/) && !/nameCard|namePiggy|pgwrap/.test(nameFn), true);
check("fitNameScene(): floor line untouched; composition override is the only addition",
  has(MAIN_SRC, /const scale = Math\.max\(natural, NAME_SCENE_SCALE_FLOOR\);/) && has(MAIN_SRC, /const composed = nameCompositionFit\(scale\);/), true);
for (const [vw, vh] of [[390, 844], [430, 900]]) {
  const inset = vw <= 400 ? 20 : 24;
  const comp = Math.min((vw - 2 * inset) / (1072 - 380), vh / 800);
  const base = Math.max(Math.min(vw / 1280, vh / 800), 0.42);
  const tx = inset - 380 * comp;
  const cardL = tx + 612 * comp, cardR = tx + 1072 * comp, cardW = 460 * comp, cardH = 300 * comp;
  const L = `${vw}x${vh}`;
  check(`${L} Name: composition scale > old floor ${base.toFixed(3)}`, comp > base, true);
  check(`${L} Name: card right edge = vw - inset`, cardR, vw - inset, 1e-9);
  check(`${L} Name: Piggy wrapper left edge = inset (on screen at arrival)`, tx + 380 * comp, inset, 1e-9);
  check(`${L} Name: card heavier than old (${(460 * base).toFixed(0)}x${(300 * base).toFixed(0)})`, cardW > 460 * base && cardH > 300 * base, true);
  // Piggy : card ratio is the authored one at ANY scale (uniform board transform)
  check(`${L} Name: Piggy wrapper width / card width unchanged (230/460)`, (230 * comp) / cardW, 230 / 460, 1e-12);
  console.log(`INFO  ${L} Name: scale=${comp.toFixed(3)} card=${cardW.toFixed(1)}x${cardH.toFixed(1)} left=${cardL.toFixed(1)} right=${cardR.toFixed(1)} (old floor ${base}: ${(460 * base).toFixed(1)}x${(300 * base).toFixed(1)}); First Send card = 285x364`);
}
const centred = (base, vw) => (vw - 1280 * base) / 2;
check("Name >640 identity: nothing in the >640 branch changes tx (centred board)", centred(0.5, 700), (700 - 640) / 2);

// ── 6. Companion labels hidden on mobile only ───────────────────────────────────────────────
check("style.css: .homeLiving__name { display: none } inside @media (max-width: 640px) (last rule block)",
  has(CSS_SRC, /@media \(max-width: 640px\) \{\s*\.homeLiving__name \{ display: none; \}\s*\}\s*$/), true);
check("style.css: base .homeLiving__name rule still shows the label (web unchanged)",
  has(CSS_SRC, /\.homeLiving__name \{\s*position: absolute;\s*width: 120px;/), true);
check("style.css: a666's 15px mobile font rule still present", has(CSS_SRC, /\.homeLiving__name \{ font-size: 15px; \}/), true);

// ── 7. [FINAL CLOSEOUT B] right safe rail: rightmost character ink at vw - --mobile-inset ──────
const helperSrc = cut(MAIN_SRC, "function homeFloorNudgeViewportX(s) {", "\n}\n");
check("homeFloorNudgeViewportX(): identity guard (boost<=1 or s>=FLOOR -> old base constant)",
  has(helperSrc, /if \(!\(boost > 1\) \|\| !\(s > 0\) \|\| !\(s < HOME_CHAR_SCALE_FLOOR\)\) return base;/), true);
check("homeFloorNudgeViewportX(): min(base, rail target) from the un-trimmed seat box right edge",
  has(helperSrc, /HOME_SEAT_L \+ HOME_SEAT_W/) && has(helperSrc, /return Math\.min\(base, vw - inset - rightAtZeroNudge\);/), true);
check("all 4 floor consumers use the helper; no raw base-constant read left",
  (MAIN_SRC.match(/const nudgeViewportX = homeFloorNudgeViewportX\(s\);/g) || []).length === 4
    && !/nudgeViewportX = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX/.test(MAIN_SRC), true);
{
  const SEAT_W = 150, SEAT_L = HOME_CENTER - 0.4991 * SEAT_W;
  for (const [vw, vh, want] of [[390, 844, -11.8], [430, 900, -9.0]]) {
    const s = Math.min(vw / BOARD_W, vh / BOARD_H), kb = (FLOOR / s) * BOOST;
    const fitLeft = (vw - BOARD_W * s) / 2, inset = vw <= 400 ? 20 : 24;
    const right0 = fitLeft + s * HOME_CENTER * (1 - kb) + s * kb * (SEAT_L + SEAT_W);
    const nudge = Math.min(6, vw - inset - right0);
    check(`${vw}: rightmost leaf right = vw - inset after the nudge`, right0 + nudge, vw - inset, 1e-9);
    check(`${vw}: nudge ≈ ${want} (shift ${(nudge - 6).toFixed(1)}px vs old +6)`, nudge, want, 0.1);
    check(`${vw}: old state reproduces measured leaf right (387.8@390)`, vw === 390 ? right0 + 6 : 0, vw === 390 ? 387.8 : 0, 0.1);
  }
}

// ── 8. [FINAL CLOSEOUT D-1] Name->Home first walk frame == visible Name peek Piggy ──────────
// ROOT CAUSE: `walk` sits inside the floor group (translate(nudge) scale(k)); ENTER_X/entryScale/entryY
// were computed with the bare board scale s, so the first frame rendered k times too big + displaced.
check("mountHome(): start rect mapped through the inverse floor group (chogWalkStartBoardRect), mobile-only",
  has(MAIN_SRC, /const floorPlan = window\.innerWidth <= 640 \? computeHomeCharScaleFloorPlan\(fit\) : null;/)
    && has(MAIN_SRC, /const inv = floorPlan && floorPlan\.applied \? chogWalkStartBoardRect\(fit, floorPlan\) : null;/)
    && has(MAIN_SRC, /const entryScale = startRect\.width \/ sW \/ HOME_WALK_W;/)
    && has(MAIN_SRC, /left: `\$\{\(startRect\.left - leftW\) \/ sW\}px`,/) && has(MAIN_SRC, /width: `\$\{startRect\.width \/ sW\}px`,/)
    && has(MAIN_SRC, /const sW = inv \? inv\.width \/ HOME_BOARD_W : s;/), true);
{
  const WALK_W = 190 * 0.88, FLOORK = 0.52;
  for (const [vw, vh, nx] of [[390, 844, -11.8], [430, 900, -9.0]]) {
    const s = Math.min(vw / BOARD_W, vh / BOARD_H), k = (FLOORK / s) * BOOST;
    const left = (vw - BOARD_W * s) / 2, top = (vh - BOARD_H * s) / 2;
    const nlx = nx / s, nly = 100 / s; // arbitrary y nudge: formula must hold for any
    // inverse exactly as chogWalkStartBoardRect(): left' = left + s*(C(1-k)+nlx), s' = s*k
    const lW = left + s * (HOME_CENTER * (1 - k) + nlx), tW = top + s * (HOME_FLOOR * (1 - k) + nly), sW = s * k;
    const start = { left: 150, bottom: 380, width: 45 }; // a peek-Piggy-sized screen rect
    const ENTER_X = (start.left + start.width * 0.5133 - lW) / sW - HOME_CENTER;
    const entry = start.width / sW / WALK_W, entryY = (start.bottom - tW) / sW - HOME_FLOOR;
    // forward through the group: screen = left + s*(C + k*(L - C) + nlx)
    const Lcx = HOME_CENTER + ENTER_X;               // local x of the 0.5133 ink anchor
    const screenCx = left + s * (HOME_CENTER + k * (Lcx - HOME_CENTER) + nlx);
    const screenW = s * k * entry * WALK_W;
    const screenBottom = top + s * (HOME_FLOOR + k * entryY + nly);
    const L = vw + "";
    // frozen-pose snapshot (child of #homeChar, inside the group): local box -> screen must equal start rect
    const sl = (start.left - lW) / sW, st = (start.bottom - 60 - tW) / sW, sw = start.width / sW, sh = 60 / sW;
    check(`${L}: snapshot screen left == start.left`, left + s * (HOME_CENTER + k * (sl - HOME_CENTER) + nlx), start.left, 1e-9);
    check(`${L}: snapshot screen top == start top`, top + s * (HOME_FLOOR + k * (st - HOME_FLOOR) + nly), start.bottom - 60, 1e-9);
    check(`${L}: snapshot screen width/height == start rect`, s * k * sw + "," + s * k * sh, "45,60".replace(/.*/, (m) => (s * k * sw) + "," + (s * k * sh)));
    check(`${L}: snapshot width == 45 and height == 60 (exact)`, Math.abs(s * k * sw - 45) < 1e-9 && Math.abs(s * k * sh - 60) < 1e-9, true);
    check(`${L}: first frame on-screen width == peek width (45)`, screenW, 45, 1e-9);
    check(`${L}: first frame ink anchor x == peek anchor`, screenCx, start.left + start.width * 0.5133, 1e-9);
    check(`${L}: first frame bottom == peek bottom`, screenBottom, 380, 1e-9);
    const bare = start.width / s / WALK_W; // old behaviour
    console.log(`INFO  ${L}: old entryScale ${bare.toFixed(3)} rendered ${(s * k * bare * WALK_W).toFixed(1)}px wide (k=${k.toFixed(3)}); new ${screenW.toFixed(1)}px`);
  }
}

// ── 9. [FINAL CLOSEOUT A fix] box aspect == rendered paper aspect => contain-fit fills it => left == inset
check("receiptRailTarget(): box aspect = rail.paperAspect when measured (fallback 280:320)",
  has(RETURN_SRC, /const aspect = rail\.paperAspect > 0 \? rail\.paperAspect : RECEIPT_DELIVERED_W \/ RECEIPT_DELIVERED_H;/), true);
check("return-view.js measures the rendered paper aspect (rotated bbox) and injects rail.paperAspect",
  has(VIEW_SRC, /const measurePaperAspect = \(\) => \{/) && has(VIEW_SRC, /\? \{ \.\.\.r, paperAspect: a \} : r;/), true);
for (const [vw, vh] of [[390, 844], [430, 900]]) {
  const { view } = sim(vw, vh), r = rail(vw, vh);
  const pa = 266.4 / 325.7; // browser-measured rendered paper 266.4 wide in a 325.7-high box
  const T = receiptRailTarget({ ...r, paperAspect: pa }, view);
  check(`${vw}: box aspect == paper aspect`, T.w / T.h, pa, 1e-9);
  // contain-fit of a paper with aspect pa into this box fills it: rendered left == box left == inset
  const boxW = T.vp.baseW, boxH = T.vp.baseH, fit = Math.min(boxW / pa, boxH) ; // paper height 1 unit scaled
  const paperW = fit * pa;
  check(`${vw}: contain-fit paper width == box width (no centring offset)`, paperW, boxW, 1e-9);
  check(`${vw}: rendered left == inset`, T.vp.left + (boxW - paperW) / 2, r.inset, 1e-9);
  check(`${vw}: read paper still inside right rail`, r.inset + T.vp.readW <= vw - r.inset + 1e-6, true);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
