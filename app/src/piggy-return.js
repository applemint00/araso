// 귀환 — 알람 → 포털 → Piggy 등장 → 정면 hold → toss → Receipt 두 번 탭 →
// 집으로 → Chog 수령 → 파일 정리. 승인 원본:
//   확정 모션 디자인 원본의 return 미리보기(비공개, 이 저장소 밖)
//   (renderer.js sceneSVG/stateAt/rig/nativeState/nativeHand · player.js 의 두 번 탭 게이트)
// 원본은 읽기만 했다. 좌표·시간 함수는 원본 그대로다.
//
// 이 파일은 **화면만** 만든다. 돈에 대해 아무것도 모른다.
// 모션 완료는 「애니메이션이 끝났다」는 뜻이고 거래·저장 완료가 아니다.

const DIR = "/motion/piggy-return";

// --- 원본 좌표계 --------------------------------------------------------
export const RETURN_TOTAL_S = 15.6;     // renderer.js TOTAL
export const RECEIPT_GATE_S = 7.0;      // 첫 탭 대기 지점(RECEIPT_AT)
export const ZOOM_DONE_S = 7.6;         // 확대가 끝나 둘째 탭을 받는 지점
export const PICKUP_S = 8.5;            // 둘째 탭 뒤 재생 재개 지점
const STAGE_W = 1200, STAGE_H = 800;    // 원본 무대
const BOARD_W = 1256, BOARD_H = 772;    // 현재 Home 판

// Home 어댑터 — departure 와 같은 group 변환이다.
//   s = seatW/218 · dx = 966.135 − 862·s · dy = 491.75 − 515·s
const GROUP_SCALE = 150 / 218;
const GROUP_DX = 966.135 - 862 * GROUP_SCALE;
const GROUP_DY = 491.75 - 515 * GROUP_SCALE;

// [A-659 OWNER VISUAL REPAIR — E, round 2, 2026-09-30] Receipt paper enlarged (Owner:
// ".receiptPaper width 196px, too small"). ROUND 1 also bumped style.css's `.receiptPaper`/
// `.receiptPaper__teeth` CSS `width` 196→228px — coordinator's real-browser recapture caught two
// breaks: (1) that box's height is content-driven (fixed px padding/font-sizes/line-heights), not
// tied to `width`, so widening it alone grew width +17% but height only +2.6% ("squat"); (2) the
// anchor's half-extents grew but the CENTER didn't move, so the wider box's right edge grew
// straight into Piggy (1440: right edge 817→840, clearance 28px→~5px) and the center wasn't
// raised enough to read as "moved up" relative to Piggy's head. style.css's `.receiptPaper` is
// now back to 196px (round-2 comment there) — this factor instead scales ONLY the delivery
// TARGET box (`rw`/`rh` below) and the anchor's half-extents; return-view.js's `placePaper()`
// still contain-fits the SAME fixed-196px-wide, fixed-aspect paper into that target via
// `--paperScale` (a CSS `transform: scale()`, uniform on width AND height together) — so scaling
// the target uniformly makes the resulting `--paperScale` itself multiply by this same factor,
// growing the VISIBLE paper uniformly (aspect intact) without touching the paper's own layout.
// The tiny in-hand carry paper (drawRig()'s `280,225` and the fixed `36,29` post-pickup size,
// both elsewhere in this file) is NOT part of this — Owner's complaint was about the readable
// receipt, not the walking-home glimpse.
const RECEIPT_SIZE_SCALE = 228 / 196;
const RECEIPT_DELIVERED_W = 280 * RECEIPT_SIZE_SCALE;
const RECEIPT_DELIVERED_H = 320 * RECEIPT_SIZE_SCALE;

// [A-358 §4 → A-359 §2 교정] 공통 카드 자리(.cardAnchor, style.css) 중심 — 뷰포트
// 중앙에서 왼쪽32/위48 (CSS px). 옛 `BOARD_W/2-32, BOARD_H/2-48`(=596,338 고정)은 이
// 32/48 을 **board 단위로 그대로** 뺀 것이었다 — 틀렸다. board 중심은 항상 뷰포트
// 중심에 있지만(board·canvas 모두 fitHomeBoard() 식으로 중앙정렬), 중심에서의 오프셋은
// 화면에 나타날 때 board 의 실제 CSS 축척(s = canvas 의 실제 CSS 폭 / BOARD_W)만큼
// **줄어든다** — 그래서 board 좌표로 되돌리려면 32/48 을 그대로 빼지 않고 `32/s, 48/s`
// 를 빼야 한다(뷰포트 997×717, s≈0.7938 일 때 596,338 이 아니라 ≈587.7,325.5). s 는
// 뷰포트마다 달라 상수로 못 박을 수 없다 — `anchorCenter()` 가 매 draw 마다 실제
// `canvas.clientWidth`(getBoundingClientRect 와 같은 레이아웃 값, DPR 제외 — sx() 의
// canvas.width 는 DPR 포함이라 다른 값이다) 로 다시 잰다. 읽기-확대(zoom) 중심과 종이
// 도착 종착점은 이 값 **하나**로 맞춘다 — 옛 360/325(확대 중심)·220/165(도착 목표)는
// 같은 자리를 노린 서로 다른 임의 숫자였다.
// [A-656 OWNER CORRECTION — WEB-FIRST PROPORTIONAL INVARIANT, 2026-09-30] The prior fix (P3 R1,
// comment kept below for the record) derived cx/cy from the canvas's REAL on-screen rect via
// `(window.innerWidth/2 - 32 - left)/s` on every draw. That read the real rect correctly, but the
// TARGET it read *toward* was still "wherever the shared `.cardAnchor` viewport-centered slot
// happens to sit this frame" — a target with no relationship to Piggy/Chog's own board anchor
// (HOME_CENTER/HOME_FLOOR, main.js). Once the floor/mid-band correction moves the character
// cluster (and this whole canvas — return-view.js `fit()`) away from natural center, that
// viewport-center target stops tracking the cluster: PROP.md Q2 measured Δ up to −3.66
// normalized units (456px at 430) between the receipt and Home/Chog. Owner correction: "Receipt
// card/handoff must preserve the same proportional size and relative position to Piggy/Chog as
// the 1440 web canon. Do not lower only the returning Piggy while leaving Receipt/hitbox/card
// geometry on the old coordinate system."
// Fix: pin cx/cy to the FIXED board-local point the old formula produced at the 1440 reference
// (`REF_S_1440` — width-constrained at this board's aspect, same derivation main.js
// `computeHomeMidBandDropPx()` uses for its own 1440×900 reference) instead of re-deriving it
// from the live viewport every draw. That constant lives in the SAME board-local coordinate frame
// as every other fixed box in this file (SEAT_RECT/BOX/BELL_BOX) — and this whole draw already
// runs inside `enterGroup()`'s `ctx.scale(sx())`, which already carries the canvas's actual
// current on-screen scale (including the floor's k and any mid-band translate, since
// return-view.js resizes/repositions this ENTIRE canvas by exactly that transform). So a fixed
// board point rides through it exactly like Piggy/Chog/the receipt paper's other geometry do —
// proportional at 390/430/700/900, and, because REF_S_1440 equals the natural (floor/mid-band
// never apply there) 1440 scale exactly, byte-identical (Δ0) at 1440 — same numeric formula the
// old per-draw computation produced at that one width.
const REF_S_1440 = Math.min(1440 / BOARD_W, 900 / BOARD_H);
// [A-659 OWNER VISUAL REPAIR — E, round 2] Both half-extents grow with RECEIPT_SIZE_SCALE (board
// px, through the same GROUP_SCALE the drawn/reported box itself uses) — round 1 left the CENTER
// fixed while only the box grew, which pushed the RIGHT edge further right (coordinator-measured:
// 1440 right edge 817→840 vs Piggy's own left edge ≈845, clearance 28px→~5px) and only kept the
// BOTTOM edge in its old place (not "visibly higher", as Owner asked).
//   X: shift the center LEFT by exactly half the width growth, so the RIGHT edge (the side
//      nearest Piggy) lands EXACTLY where the old, smaller box's right edge did — same horizontal
//      clearance as before this card, not less, at every width (it's a fixed board-local point,
//      so it scales through the shared plan like every other fixed box here).
//   Y: shift the center UP by the FULL height growth (not just half) — the paper's own BOTTOM
//      edge (the side nearest Piggy/Chog vertically) then lands *above* where it used to (by half
//      the growth), a real, visible raise, not merely "no worse than before" — with the TOP
//      extending further up still (by 1.5× the growth).
const RECEIPT_SIZE_GROW_BOARD_W_PX = (RECEIPT_DELIVERED_W - 280) * GROUP_SCALE / 2;
const RECEIPT_SIZE_GROW_BOARD_H_PX = (RECEIPT_DELIVERED_H - 320) * GROUP_SCALE;
const ANCHOR_BOARD_CX = 628 - 32 / REF_S_1440 - RECEIPT_SIZE_GROW_BOARD_W_PX;
const ANCHOR_BOARD_CY = 386 - 48 / REF_S_1440 - RECEIPT_SIZE_GROW_BOARD_H_PX;
function anchorCenter() {
  const cx = ANCHOR_BOARD_CX;
  const cy = ANCHOR_BOARD_CY;
  // GROUP 변환의 역함수로 이 board 중심을 "엔터그룹 이전" 무대 좌표로 되돌린다.
  const zx = legacyDims.zx ?? (cx - GROUP_DX) / GROUP_SCALE; // [A-831] legacyDims.zx/zy = the Home card centre (provider) in stage units; unset -> the fixed 1440-canon anchor
  const zy = legacyDims.zy ?? (cy - GROUP_DY) / GROUP_SCALE;
  // delivery=1 시점 종이 크기(무대 단위, 아래 rw/rh 식의 델리버리 종착 크기 — [A-659] 이제
  // RECEIPT_DELIVERED_W/H, 옛 280×320 에 같은 배율을 곱한 값) 절반만큼 확대 중심에서 물러난
  // 자리를 도착 목표로 둔다 — 그래야 확대 pivot 과 종이 중심이 같아, zoom 이 1→1.18 로
  // 커지는 동안에도 화면 위치가 안 흔들린다.
  return { cx, cy, zx, zy, tx: zx - legacyDims.w / 2, ty: zy - legacyDims.h / 2 }; // [A-831] legacyDims = RECEIPT_DELIVERED_W/H unless the 0.91 x Home card provider answers
}
const legacyDims = { w: RECEIPT_DELIVERED_W, h: RECEIPT_DELIVERED_H, zx: null, zy: null };

// [A-681 MOBILE RETURN/RECEIPT — OWNER FINAL MOBILE CLOSEOUT A, 2026-10-03] On a phone (<=640)
// the Receipt's throw/hand-off target and its settled/read position are the viewer-LEFT CONTENT
// rail (same rail First Send / Explore / HISTORY use: left edge = `--mobile-inset`), larger and
// readable, instead of the fixed 1440-reference anchor above (ANCHOR_BOARD_CX/CY — root cause
// confirmed by the Owner note: the A-659 web repair raises CY by the full height growth, and that
// fixed board-local raise propagates proportionally into mobile, so the enlarged paper read too
// high and, after the A-681 character boost, drifted off the left edge).
// DESIGN: the target is NOT a board-local constant. main.js hands `renderOpts.receiptRail` — the
// live viewport-px facts only the DOM knows (see `RECEIPT_RAIL` shape below) — and this file
// converts them through the canvas's own on-screen rect (the SAME rect return-view.js placePaper()
// reads), so the paper lands in the same viewport rail no matter what transform the canvas rides.
// `receiptRail === null` (every width >640, and any caller that does not opt in) takes the legacy
// `anchorCenter()` + RECEIPT_DELIVERED_W/H path unchanged — an exact identity.
//
//   RECEIPT_RAIL = { vw, vh, inset, topBound, cardCy, cardW, gap }   (all CSS px, viewport space)
//     inset    : `--mobile-inset` (20 @390 family / 24 @430 family) — the rail's left edge and the
//                right-hand margin (symmetric, same shell inset every mobile scene uses)
//     topBound : `--mobile-top-safe` + `--grid-3` — highest the READ (zoomed) paper may reach
//     cardCy   : the shared card slot's centre line, vh/2 - 48 (style.css .cardAnchor, offY=48) —
//                preferred vertical centre; used when nothing forces the paper higher
//     cardW    : 285 (style.css .cardAnchor width) — the paper never grows past the First
//                Send/Explore card's own width ("comparable weight", not larger)
//     gap      : `--grid-5` (32) — clearance between the READ paper's bottom edge and the returning
//                Piggy's head box; also holds return-view.js's 8px-offset "Receipt/File it" hint.
//   Why the paper rides ABOVE Piggy and not beside it: at the two-tap gate (t 7.0-8.5) Piggy stands
//   at stage (PIGGY_GATE_STAGE_Y, PIGGY_GATE_SIZE) — with the boosted canvas she occupies viewport
//   x≈95-218 at 390 — i.e. INSIDE the 20..vw-20 rail horizontally, so the rail's only free band is
//   above her head. Piggy/Chog/bell all keep riding the ONE canvas transform (Home floor + boost,
//   main.js computeHomeFloorViewportNudge, no per-point compensation), so they stay coherent with
//   Chog's own "…is coming home" line; only the paper is re-targeted.
//
// Zoom: the first tap enlarges the paper to 1+READ_ZOOM_GAIN about a pivot (drawAt zoom). On the
// rail path the pivot is the paper's LEFT-CENTRE point (not its centre) so the settled paper's left
// edge sits exactly on the rail inset at zoom 1 AND the read (zoomed) paper still ends at
// <= vw - inset: baseW is sized so baseW*(1+READ_ZOOM_GAIN) <= vw - 2*inset.
const READ_ZOOM_GAIN = 0.18;                    // drawAt `zoom = 1 + READ_ZOOM_GAIN * …` (was literal 0.18)
const READ_ZOOM_MAX = 1 + READ_ZOOM_GAIN;
// [A-920 item 3] Piggy at the gate, back to the mock (img_25 / 26 / 27): 5 % smaller (0.24 -> 0.228), feet 26 board units lower (y +37.8 stage units, +13.9 for the smaller size so the feet land where
// the +26 says), x +5.7 so the centre stays. One constant in board / stage units: it follows the Home stage scale S at every width (the mock offsets / S = 25.7 / 26.2 / 26.3 at 390 / 810 / 1440),
// so there is no per-width value. All three fade into the unchanged seat pose with `settle`, as before. pre-A-920 baseline: PIGGY_GATE_STAGE_Y = 250, PIGGY_GATE_SIZE = 0.24, no dx.
const PIGGY_GATE_STAGE_Y = 250 + 51.7;          // drawAt `y = PIGGY_GATE_STAGE_Y` (Piggy at the gate; settle===0)
const PIGGY_GATE_SIZE = 0.228;                  // drawAt `mix(PIGGY_GATE_SIZE, 0.20, settle)` at settle===0
const PIGGY_GATE_DX = 5.7;                      // stage units added to the gate x (centre kept after the size change)
// [A-920 item 3] the Return Chog stands 24 board units lower than the Home floor line in the mock (ink TOP mock - app = 18 / 28 / 33 px = 23.2 / 23.7 / 24.8 board units at S .777 / 1.183 / 1.33; the mock's feet are cut
// by its annotation box at the floor line, so the top edge is the comparable one). DOM Chog (return-view.js placeChog)
// and the canvas native Chog (NATIVE_OY below) use this one value so the hand-over at t = 11.4 does not jump. pre-A-920 baseline: 0.
const RETURN_CHOG_DROP = 24;
// [A-831 · Cowork Q-C (c) · canon A-835 item 5] Receipt size = 0.91 x the Home card width. main.js registers a provider that answers the delivered Receipt's
// viewport-px width; it replaces the fixed 280x320 x RECEIPT_SIZE_SCALE legacy size (and the legacy end of the 640..700 blend) by that width at the same aspect, about the
// same legacy centre. Unregistered / answering null -> the exact previous size. Position = main.js returnLayout() (A-837).
let receiptLegacySizeProvider = null;
export function setReceiptLegacySizeProvider(fn) {
  receiptLegacySizeProvider = typeof fn === "function" ? fn : null;
}

/**
 * Pure: viewport-space rail facts + the canvas's on-screen placement -> stage-unit Receipt target.
 * @param {{vw:number,vh:number,inset:number,topBound:number,cardCy:number,cardW:number,gap:number}|null} rail
 * @param {{left:number,top:number,k:number}|null} view  canvas rect left/top (CSS px) and CSS px per board unit
 * @returns {{tx:number,ty:number,zx:number,zy:number,w:number,h:number,vp:object}|null}
 */
export function receiptRailTarget(rail, view) {
  if (!rail || !view || !(view.k > 0)) return null;
  // [A-681 D] The box must have the DOM paper's OWN rendered aspect (rotated bbox w/h, measured by
  // return-view.js and passed as rail.paperAspect): placePaper() contain-fits the paper into this box
  // and CENTRES it, so a box wider than the paper pushed the rendered left edge inward by
  // (boxW - paperW)/2 (browser: +9.3px @390 and @430, paper 266.4 wide in a 285 box). Same aspect =>
  // contain-fit fills the box exactly => rendered left edge == rail inset. Falls back to the legacy
  // 280:320 delivered aspect when unmeasured.
  const aspect = rail.paperAspect > 0 ? rail.paperAspect : RECEIPT_DELIVERED_W / RECEIPT_DELIVERED_H;
  const piggyTopVp = view.top + view.k * (GROUP_DY + (PIGGY_GATE_STAGE_Y + BOX.body.y * PIGGY_GATE_SIZE) * GROUP_SCALE);
  const bottomBound = piggyTopVp - rail.gap;
  const availH = bottomBound - rail.topBound;
  const railW = rail.vw - 2 * rail.inset;
  // [A-831 Q-C] rail.sizeW = 0.91 x Home card width: the Receipt is that wide at every width (no height-limit shrink; arrangement above Piggy is A-837). pre-A-831: min(cardW, railW / zoom, availH / zoom x aspect)
  const baseW = rail.sizeW > 0 ? Math.min(rail.sizeW, railW / READ_ZOOM_MAX, (Math.max(0, bottomBound) / ((1 + READ_ZOOM_MAX) / 2)) * aspect) : Math.min(rail.cardW, railW / READ_ZOOM_MAX, (availH / READ_ZOOM_MAX) * aspect);
  if (!(baseW > 0)) return null;
  const baseH = baseW / aspect;
  const readH = baseH * READ_ZOOM_MAX;
  const cyLo = rail.topBound + readH / 2;
  const cyHi = bottomBound - readH / 2;
  // [A-831 Q-C] a 0.91 x Home card paper can be taller than the band above Piggy: then it stays bottom-anchored on the gap (cyHi), like the shorter papers, instead of top-aligned. pre-A-831: Math.max(cyLo, Math.min(cyHi, rail.cardCy))
  const cyVp = rail.sizeW > 0 && cyLo > cyHi ? cyHi : Math.max(cyLo, Math.min(cyHi, rail.cardCy));
  const toStageX = (vx) => ((vx - view.left) / view.k - GROUP_DX) / GROUP_SCALE;
  const toStageY = (vy) => ((vy - view.top) / view.k - GROUP_DY) / GROUP_SCALE;
  const w = baseW / (view.k * GROUP_SCALE);
  const h = baseH / (view.k * GROUP_SCALE);
  const tx = toStageX(rail.inset);
  const zy = toStageY(cyVp);
  return {
    tx, ty: zy - h / 2, zx: tx, zy, w, h,
    vp: { left: rail.inset, cy: cyVp, baseW, baseH, readH, readW: baseW * READ_ZOOM_MAX, piggyTop: piggyTopVp, bottomBound },
  };
}

// 앉은 Piggy — 원본 Return 은 218×218 정사각이지만 캐릭터 원본 비율은 1056×1102.
// Home 과 같은 비율을 쓴다(무단 squash 0). 차이는 parts.json 에도 남겼다.
const SEAT_RECT = { x: 862, y: 515, w: 218, h: 218 * 1102 / 1056 };

// 굽힌 배열의 공통 상자(= export 스크립트가 parts.json 에 적은 origin)
const BOX = {
  body: { x: 63.0154, y: -46.9846, w: 952.4308, h: 1206.2769 },
  arm: { x: -0.2769, y: 422.8, w: 317.4769, h: 461.3231 },
  hold: { x: 206.6923, y: 469.0, w: 436.6154, h: 368.9231 },
  ring: { x: 366.1, y: 221.75, w: 187.8, h: 286.5 },
  native: { x: 223.7808, y: 125.0577, w: 1596.0231, h: 2034.7923 },
  palm: { x: 260.1986, y: 1115.7986, w: 1523.1874, h: 404.3258 },
};

// Chog 다리 — 수령 시점에 native Chog 가 **기존 Home Chog 와 같은 잉크/발**에 서야 한다.
// Home Chog 정본: ink center 891 · floor 648 · height 118.28125 (board px).
// native 원본 잉크(2048×2252 좌표): x 393.06–1763.38 · y 189.65–2095.25.
const NATIVE_INK = { x0: 393.06, y0: 189.65, x1: 1763.38, y1: 2095.25 };
const HOME_CHOG = { centerX: 891, floorY: 648, inkH: 118.28125 };
const NATIVE_K = HOME_CHOG.inkH / (NATIVE_INK.y1 - NATIVE_INK.y0);   // board px / native unit
const NATIVE_OX = HOME_CHOG.centerX - ((NATIVE_INK.x0 + NATIVE_INK.x1) / 2) * NATIVE_K;
const NATIVE_OY = HOME_CHOG.floorY + RETURN_CHOG_DROP - NATIVE_INK.y1 * NATIVE_K; // [A-920] pre-A-920 baseline: HOME_CHOG.floorY - ...
// 원본의 frame24 이동량(무대 −41, −8)은 같은 무대 배율로 board 에 옮긴다.
const NATIVE_STEP_DX = -41 * GROUP_SCALE;
const NATIVE_STEP_DY = -8 * GROUP_SCALE;

// --- 알람 종 (Owner 지시, 채팅 2026-09-18: "피기 올문 옆에헤 내가 보는 오른쪽
// 옆에 집그림사이즈로") -------------------------------------------------
// 자산: 비공개 디자인 원본의 crayon_bell.svg(이 저장소 밖)
// sha256 c3b220d862b7195ac9c1c5db9a54217af8572d3686e98f55a1b2f9118fb20b3b, 8785B
// (대부분 C2PA metadata) — Owner 확인 "그게벨자산이야". app/public/card/crayon-bell.svg 는 그 파일의
// <metadata> 블록만 뺀 그림 내용 그대로다(재드로우 0, 좌표·색·필터 손대지 않음).
// [A-768 M-T-3] 예전엔 같은 마크업을 data: URI 로 실었는데, 배포 CSP `img-src 'self'` 가 data: 를 막아
// onerror → asset-missing → 귀환 연출 대신 filebox 로 떨어졌다. 이제 **같은 바이트**(969B, sha256
// a232a0797c8d4cc90310d9f7c4ee748935c0ef5d38a6ce8a8e2de0cab1ef8f2a — 옛 BELL_SVG_MARKUP 문자열과 동일)를
// 같은 origin 정적 파일로 읽는다. CSP 는 그대로(strict, data: 허용 0).
// [주의] main.js 에 "별도 벨/링 그래픽은 canon 에 없다"는 예전 주석이 남아 있을 수
// 있다 — 이 벨(2026-09-18)은 그 뒤에 온 새 Owner 지시다.
const BELL_KEY = "alarm-bell";
// Image — Path2D 가 아니다: 캔버스 2D 는 feTurbulence/feDisplacementMap
// 을 못 돌린다(SVG 래스터라이저가 Image onload 시 대신 돌려준다). Path2D 로 세 path 를
// 다시 그리면 크레용 displacement 질감이 사라진다 — 그래서 이 경로를 택했다.
const BELL_SRC = "/card/crayon-bell.svg";

// 위치 — [OWNER_INPUT_REQUIRED] "집그림사이즈"의 절대 px 기준이 앱에 없다: Home
// paper stamp 는 `.homePaper__stamp{width:52px}` 이지만 종이 자체가 0.275~0.64 로
// 화면에서 다시 축소되므로 52px 는 "종이 좌표계 안" 값이지 절대 화면 px 가 아니다 —
// 그 52px 를 그대로 이 포털(전혀 다른 좌표계) 에 옮길 근거가 없다. 여기서는 포털 링
// 상자(BOX.ring, 위 56-63행: x366.1 y221.75 w187.8 h286.5, 오른쪽 끝 x=553.9, 세로
// 중심 y=365.0) 옆에 "작은 아이콘"으로 읽히는 크기를 이 파일 안에서 임의로 확정했다
// — Owner 재확인 전까지 잠정: gap 24(box 단위) · bell 64×64(box 단위, viewBox 1:1
// 유지, 비율 왜곡 0) · ring 세로 중심에 맞춤. board px 환산 ≈ 64×GROUP_SCALE(≈0.6881)
// ≈ 44×44 board px(실제 CSS px 는 anchorCenter() 주석과 같은 이유로 뷰포트마다
// 다르다 — sx()=canvas.clientWidth/BOARD_W).
const BELL_GAP = 24;
const BELL_SIZE = 64; // box 단위(BOX.ring 과 같은 좌표계)
const BELL_BOX = {
  x: BOX.ring.x + BOX.ring.w + BELL_GAP,           // 366.1+187.8+24 = 577.9
  y: BOX.ring.y + BOX.ring.h / 2 - BELL_SIZE / 2,  // 221.75+143.25-32 = 333.0
  w: BELL_SIZE, h: BELL_SIZE,
};
// 표시 구간 — 알람 시작(stateAt 의 리터럴 0.7, phase "Alarm" 시작과 동일) ~ Piggy
// 등장 직전(stateAt 의 리터럴 3.15, piggyVisible 과 동일). Owner 지시 "알람 표시 →
// 발화 → 등장" 순서를 그대로 따른다 — 종은 등장 신호가 아니라 등장 *전* 알림이라 Piggy
// 가 보이기 시작하면(t>=3.15) 사라진다(hold 안 함 — "읽기 낫다"고 판단해 등장까지만
// 든다, 이 판단은 이 파일 안에서 내렸다). 가장자리 0.15s 는 알파 페이드일 뿐 — stateAt/
// nativeState 등 원본 시간 함수·기존 상수는 전혀 건드리지 않았다(추가만).
const BELL_START_S = 0.7, BELL_END_S = 3.15, BELL_FADE_S = 0.15;
function bellAlphaAt(t) {
  return Math.min(
    smooth((t - BELL_START_S) / BELL_FADE_S),
    1 - smooth((t - (BELL_END_S - BELL_FADE_S)) / BELL_FADE_S)
  );
}

const pad2 = (i) => String(i).padStart(2, "0");
const WALK = Array.from({ length: 48 }, (_, i) => `piggy-walk-${pad2(i)}`);
const TURN = Array.from({ length: 25 }, (_, i) => `piggy-turn-${pad2(i)}`);
const REST_MORPH = Array.from({ length: 17 }, (_, i) => `piggy-rest-morph-${pad2(i)}`);
const REST_TURN = Array.from({ length: 25 }, (_, i) => `piggy-rest-turn-${pad2(i)}`);
const NATIVE = Array.from({ length: 25 }, (_, i) => `chog-native-${pad2(i)}`);
const PALM = Array.from({ length: 25 }, (_, i) => `chog-palm-${pad2(i)}`);
const SINGLES = ["piggy-hold", "piggy-rest-front", "piggy-rest-right", "piggy-seat",
  "portal-ring", "portal-mask", "folder-back", "folder-front", "receipt-paper"];
// chog-rest.png 은 굽되 **로드하지 않는다** — 수령 전 Chog 는 기존 Home Chog 를 그대로 쓴다.
const LOAD = [...WALK, ...TURN, ...REST_MORPH, ...REST_TURN, ...NATIVE, ...PALM, ...SINGLES];

export async function loadReturnAssets() {
  const images = new Map();
  const missing = [];
  await Promise.all([
    ...LOAD.map((name) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { images.set(name, im); resolve(); };
      im.onerror = () => { missing.push(name); resolve(); };
      im.src = `${DIR}/${name}.png`;
    })),
    // 알람 종 — PNG 가 아니라 같은 origin SVG 파일(위 BELL_SRC). 같은 실패 신호
    // 통로(missing[])를 쓴다 — 조용히 사라지지 않는다.
    new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { images.set(BELL_KEY, im); resolve(); };
      im.onerror = () => { missing.push(BELL_KEY); resolve(); };
      im.src = BELL_SRC;
    }),
  ]);
  return { images, missing };
}

// --- 원본 시간 함수 (renderer.js 그대로) --------------------------------
const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const mix = (a, b, t) => a + (b - a) * t;

/** renderer.js `stateAt` 그대로. */
export function stateAt(t) {
  t = Math.max(0, Math.min(RETURN_TOTAL_S, t));
  const opening = smooth((t - 1.8) / 1.1);
  const emerge = smooth((t - 3.15) / 2.1);
  const turn = smooth((t - 5.25) / 0.45) * (1 - smooth((t - 8.5) / 0.35));
  const present = smooth((t - 5.7) / 0.25);
  const delivery = clamp((t - 6.3) / 0.42);
  const settle = smooth((t - 8.85) / 2.05);
  const filing = smooth((t - 13.5) / 1.3);
  return {
    t, opening, emerge, turn, present, delivery, settle, filing,
    piggyVisible: t >= 3.15,
    phase: t < 0.7 ? "Away / waiting" : t < 1.8 ? "Alarm" : t < 5.25 ? "Returning"
      : t < 5.7 ? "Face front" : t < 5.95 ? "Presenting" : t < 6.3 ? "Holding"
      : t < 8.5 ? "Receipt" : t < 11.4 ? "Carrying receipt home"
      : t < 12 ? "Chog receives" : t < 12.45 ? "Holding receipt"
      : t < 14.8 ? "Turn and file" : "Filed / resting",
  };
}

/** renderer.js `nativeState` 그대로(무대 좌표). */
export function nativeState(t) {
  const turn = smooth((t - 12.45) / 0.85);
  const step = smooth((t - 13.3) / 1.1);
  return { turn, step, frame: Math.round(turn * 24), x: 732 - 41 * step, y: 545 - 8 * step };
}

export function createReturnRenderer(canvas, opts) {
  const { images } = opts;
  const main = canvas.getContext("2d");
  let ctx = main;
  const img = (n) => images.get(n) || null;

  let layer = null, layerCtx = null;
  function layer0() {
    if (!layer || layer.width !== canvas.width || layer.height !== canvas.height) {
      layer = document.createElement("canvas");
      layer.width = canvas.width; layer.height = canvas.height;
      layerCtx = layer.getContext("2d");
    }
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    return layerCtx;
  }

  const sx = () => canvas.width / BOARD_W;

  // board → group(무대 좌표). departure 와 같은 사슬이다.
  function enterGroup() {
    ctx.scale(sx(), sx());
    ctx.translate(GROUP_DX, GROUP_DY);
    ctx.scale(GROUP_SCALE, GROUP_SCALE);
  }

  // 공통 상자에 구운 파츠 한 장을 자기 좌표에 놓는다.
  function blit(name, box) {
    const im = img(name);
    if (!im) return;
    ctx.drawImage(im, box.x, box.y, box.w, box.h);
  }

  // 원본 rig() 를 그대로 옮긴 것. 그리는 순서가 곧 z 순서다.
  function drawRig(frame, carrying, front, push, lower) {
    const bodyName = front > 0 ? TURN[Math.min(24, Math.round(front * 24))] : WALK[frame];
    if (lower > 0.75) {
      // 내려놓은 왼팔은 몸 **뒤**에 먼저 그린다(원본과 같은 순서).
      const m = (lower - 0.75) / 0.25;
      const arm = m >= 1
        ? (front >= 1 ? "piggy-rest-front" : front <= 0 ? "piggy-rest-right"
          : REST_TURN[Math.round(front * 24)])
        : REST_MORPH[Math.round(m * 16)];
      blit(arm, BOX.arm);
      blit(bodyName, BOX.body);
      return;
    }
    blit(bodyName, BOX.body);
    ctx.save();
    ctx.translate(-80 * front - 40 * push, -55 * push);
    ctx.translate(300, 530); ctx.scale(1 + 0.12 * push, 1 + 0.12 * push); ctx.translate(-300, -530);
    // 들고 있는 작은 ivory 종이 — 원본 rig 안의 자리 그대로.
    if (carrying) { const im = img("receipt-paper"); if (im) ctx.drawImage(im, 480, 620, 280, 225); }
    ctx.save();
    ctx.translate(300, 530); ctx.rotate(68 * lower * Math.PI / 180); ctx.scale(1 - 0.2 * lower, 1 - 0.2 * lower); ctx.translate(-300, -530);
    blit("piggy-hold", BOX.hold);
    ctx.restore();
    ctx.restore();
  }

  /** 원본 `nativeHand` — 실제로 적용한 Chog 행렬 위에서 손끝을 구한다(board px). */
  function nativeHandBoard(t) {
    const s = nativeState(t);
    const px = mix(1670, 365, s.frame / 24);
    return {
      x: NATIVE_OX + px * NATIVE_K + NATIVE_STEP_DX * s.step,
      y: NATIVE_OY + 1280 * NATIVE_K + NATIVE_STEP_DY * s.step,
      frame: s.frame, step: s.step, palmX: px,
    };
  }

  // 수령 뒤 Chog — board 좌표에 직접 그린다(무대 group 밖).
  // 기존 Home Chog 와 같은 잉크/발에 서도록 bridge 행렬을 쓴다.
  function drawNativeChog(t) {
    const s = nativeState(t);
    const ox = NATIVE_OX + NATIVE_STEP_DX * s.step;
    const oy = NATIVE_OY + NATIVE_STEP_DY * s.step;
    ctx.save();
    ctx.scale(sx(), sx());
    ctx.translate(ox, oy); ctx.scale(NATIVE_K, NATIVE_K);
    blit(NATIVE[s.frame], BOX.native);
    ctx.restore();
    return { ox, oy, s };
  }

  function drawPalm(t) {
    const s = nativeState(t);
    const h = nativeHandBoard(t);
    const ox = NATIVE_OX + NATIVE_STEP_DX * s.step;
    const oy = NATIVE_OY + NATIVE_STEP_DY * s.step;
    ctx.save();
    ctx.scale(sx(), sx());
    ctx.translate(ox, oy); ctx.scale(NATIVE_K, NATIVE_K);
    // 원본은 palm-tip circle(r145) 로 자른다 — clip 은 런타임이 한다(굽지 않았다).
    ctx.beginPath();
    ctx.arc(h.palmX, 1280, 145, 0, Math.PI * 2);
    ctx.clip();
    blit(PALM[s.frame], BOX.palm);
    ctx.restore();
  }

  /**
   * 한 시각을 그린다. 원본 `sceneSVG(t)` 의 순서 그대로다.
   * @param {number} time  0…15.6 (애니메이션 시계 — 탭 대기 시간은 여기 들어오지 않는다)
   * @param {{hidePaper?:boolean, receiptRail?:object|null}} renderOpts
   *   [A-681] receiptRail — mobile viewer-left CONTENT rail facts (see receiptRailTarget); null = legacy anchor.
   *   [A-348 §3] gate 대기(await-first-tap/await-second-tap) 구간에서는 controller 가
   *   `hidePaper:true` 를 넘긴다 — canvas 는 그 프레임에 옛 receipt-paper 를 그리지 않고
   *   DOM(receiptPaperMarkup)에 자리를 **명시적으로** 넘긴다. paperBoard 좌표 계산은
   *   그대로 돌아간다(DOM 이 같은 자리에 앉으려면 필요) — 실제 drawImage 한 줄만 건너뛴다.
   *   단순히 DOM 을 canvas 위에 얹어 "덮었으니 중복 0" 이라 선언하지 않기 위한 장치다.
   */
  function drawAt(time, renderOpts = {}) {
    const { hidePaper = false, receiptRail = null } = renderOpts;
    const t = Math.max(0, Math.min(RETURN_TOTAL_S, time));
    const s = stateAt(t);
    const { opening, emerge, turn, present, delivery, settle } = s;
    const close = 1 - smooth((t - 5.5) / 0.55);
    const scale = opening * close;

    ctx = main;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // [A-656 OWNER CORRECTION] Fixed board-local anchor (derived from the 1440 canon once, at
    // module scope) — see anchorCenter() above for why this is no longer a per-draw viewport
    // read.
    // [A-681] Mobile: viewer-left CONTENT rail target (receiptRailTarget above); null -> legacy.
    // [A-831] legacy delivered size = 0.91 x Home card (provider) at the legacy aspect, about the legacy centre; no provider -> RECEIPT_DELIVERED_W/H (anchorCenter reads legacyDims).
    legacyDims.w = RECEIPT_DELIVERED_W; legacyDims.h = RECEIPT_DELIVERED_H; legacyDims.zx = null; legacyDims.zy = null;
    const legacyVp = receiptLegacySizeProvider ? receiptLegacySizeProvider() : null; // { w, cx, cy } viewport px: 0.91 x Home card width, Home card centre
    if (legacyVp && legacyVp.w > 0) {
      const cr0 = canvas.getBoundingClientRect();
      const k0 = cr0.width / BOARD_W;
      if (k0 > 0) {
        legacyDims.w = legacyVp.w / (k0 * GROUP_SCALE); legacyDims.h = legacyVp.h > 0 ? legacyVp.h / (k0 * GROUP_SCALE) : (legacyDims.w * RECEIPT_DELIVERED_H) / RECEIPT_DELIVERED_W; // [A-837] h = the paper's own rendered aspect when main.js measured it
        legacyDims.zx = ((legacyVp.cx - cr0.left) / k0 - GROUP_DX) / GROUP_SCALE; legacyDims.zy = ((legacyVp.cy - cr0.top) / k0 - GROUP_DY) / GROUP_SCALE;
      }
    }
    let railTarget = null;
    // [A-837] the 640/641 blend hand-over is gone: the Receipt is placed by main.js returnLayout() through the size provider at every width. `receiptRail` is kept as the
    // public option return-view.js (hash-pinned) forwards; main.js no longer passes it.
    if (receiptRail) {
      const cr = canvas.getBoundingClientRect();
      railTarget = receiptRailTarget(receiptRail, { left: cr.left, top: cr.top, k: cr.width / BOARD_W });
    }
    const anchor = railTarget || anchorCenter();
    const delW = railTarget ? railTarget.w : legacyDims.w;
    const delH = railTarget ? railTarget.h : legacyDims.h;

    let x = mix(210, 520, emerge) + PIGGY_GATE_DX, y = PIGGY_GATE_STAGE_Y;
    x = mix(x, 880, settle); y = mix(y, 508, settle);
    const size = mix(PIGGY_GATE_SIZE, 0.20, settle);

    const moving = (t >= 3.15 && t < 5.25) || (t >= 8.85 && t < 10.9);
    const frame = moving
      ? (t >= 8.85 ? (31 + Math.floor((t - 8.85) * 1000 / 30)) % 48 : Math.floor(t * 1000 / 30) % 48)
      : 31;

    const pickup = smooth((t - 8.5) / 0.35);
    const handoff = smooth((t - 11.4) / 0.6);
    const carryHome = t >= 8.85 && t < 10.9;
    const seated = smooth((t - 10.9) / 0.5);
    const folderAlpha = smooth((t - 12.2) / 0.25);
    const zoom = 1 + READ_ZOOM_GAIN * smooth((t - 7.3) / 0.3) * (1 - pickup);
    const sitDrop = 6 * Math.sin(Math.PI * clamp((t - 10.9) / 0.5));

    // 영수증 자리 — 던짐 궤적 식(시작점·타이밍)은 원본 그대로다. 종착점만 [A-358 §4 →
    // A-359 §2] anchor.tx/ty(공통 카드 자리 역변환, 뷰포트 실측 기준)로 바꿨다 — 옛
    // 220/165 임의 숫자를 없앤다.
    let rx = mix(x + size * (300 + 1.12 * (480 - 300) - 40 - 80), anchor.tx, delivery);
    let ry = mix(y + size * (530 + 1.12 * (620 - 530) - 55), anchor.ty, delivery)
      - 110 * 4 * delivery * (1 - delivery);
    // [A-659 OWNER VISUAL REPAIR — E] Delivered/read size only (RECEIPT_DELIVERED_W/H = 280×320 ×
    // RECEIPT_SIZE_SCALE) — the mid-toss intermediate sizes (`size * 280 * 1.12` etc.) and the
    // post-pickup tiny carry size (`36,29` below) are untouched (see the module-scope comment).
    let rw = mix(size * 280 * 1.12, delW, delivery);
    let rh = mix(size * 225 * 1.12, delH, delivery);
    if (t >= 8.5 && t < 10.9) {
      rx = mix(anchor.tx, x + size * 480, pickup);
      ry = mix(anchor.ty, y + size * 620, pickup);
      rw = mix(delW, size * 280, pickup);
      rh = mix(delH, size * 225, pickup);
    }
    let hand = null;
    if (t >= 10.9) {
      hand = nativeHandBoard(t);
      rw = 36; rh = 29;
    }

    // ① 포털 — 노란 rim. 검은 평면을 그 위에 덮지 않는다.
    if (scale > 0 && img("portal-ring")) {
      ctx.save(); enterGroup();
      ctx.translate(460, 365); ctx.scale(scale, scale); ctx.translate(-460, -365);
      blit("portal-ring", BOX.ring);
      ctx.restore();
    }

    // ①-b 알람 종 — 포털 옆(뷰어 오른쪽), Owner 지시(2026-09-18, 위 BELL_* 참고).
    // 포털이 아직 안 열려도(scale===0, t<1.8) 뜬다 — 알람이 포털보다 먼저다.
    // 링 자체의 opening scale 과는 독립이다(알파 페이드만 있다, 위 bellAlphaAt).
    const bellAlpha = bellAlphaAt(t);
    if (bellAlpha > 0 && img(BELL_KEY)) {
      ctx.save(); enterGroup();
      ctx.globalAlpha = bellAlpha;
      blit(BELL_KEY, BELL_BOX);
      ctx.restore();
    }

    // ② Piggy — t<5.25 구간은 원본처럼 reveal mask 안에서만 보인다.
    if (s.piggyVisible) {
      const masked = t < 5.25 && img("portal-mask");
      const target = masked ? layer0() : main;
      const keep = ctx; ctx = target;
      ctx.save();
      if (seated < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - seated;
        enterGroup();
        ctx.translate(x, y); ctx.scale(size, size);
        drawRig(frame, delivery === 0 || carryHome, turn, present * (1 - smooth((t - 6.3) / 0.45)),
          smooth((t - 6.4) / 0.5) * (1 - pickup));
        ctx.restore();
      }
      if (seated > 0) {
        ctx.save();
        ctx.globalAlpha = seated;
        enterGroup();
        const im = img("piggy-seat");
        if (im) ctx.drawImage(im, SEAT_RECT.x, SEAT_RECT.y + sitDrop, SEAT_RECT.w, SEAT_RECT.h);
        ctx.restore();
      }
      ctx.restore();
      ctx = keep;
      if (masked) {
        layerCtx.save();
        layerCtx.globalCompositeOperation = "destination-in";
        const k2 = ctx; ctx = layerCtx; enterGroup();
        ctx.translate(460, 365); ctx.scale(scale, scale); ctx.translate(-460, -365);
        ctx = k2;
        layerCtx.drawImage(img("portal-mask"), 0, 0, STAGE_W, STAGE_H);
        layerCtx.restore();
        ctx.drawImage(layer, 0, 0);
      }
    }

    // ③ 폴더 뒤 → 영수증 → 폴더 앞. 원본 z 순서 그대로(원본 renderer.js:38,43 폴더 draw).
    // [A-415-e] y=626 은 원본 renderer.js:38 의 리터럴 그대로였지만, 원본은 폴더와 종이가
    // **한 좌표계**(stage 1200×800)에 있던 반면 이 파일은 폴더를 Piggy group 다리
    // (enterGroup: GROUP_SCALE/DX/DY)로, 손끝 종이(papX/papY, 위 351-357행)는 Chog
    // native bridge(NATIVE_K/OX/OY, 65-75행 — Home Chog 잉크에 맞춘 별도 축척)로 각각
    // board 에 옮긴다 — 두 다리는 거의 같은 배율이지만(≈0.6881 vs ≈0.6887) 원점이 달라
    // 최종 정착(t=15.6) 종이 아래변이 folder 아래변보다 board 로 약 3.13 낮게 떨어졌다
    // (폴더 x=580 그대로일 때 폴더 bottom≈636.93, 종이 bottom≈640.06 — 실측, 아래 흰
    // 조각의 원인). A-375(`folder-left.patch`, 로컬 커밋 e7f3b7f)가 이미 같은 이유로
    // x 만 630→580 으로 옮겨 손 x 와 맞췄다(y·크기는 그때 안 건드림, OUTBOX #10059-60).
    // 여기서는 그 축의 y 만 같은 방식으로 맞춘다: t∈[14,15.6] 전 구간에서 종이 bbox 를
    // 재는 스크립트로 최적 y 를 풀면 632 가 위/아래 여유를 가장 고르게 준다(위 여유
    // ≈1.30, 아래 여유≈1.00 board 단위, t=14.01/14.70 각각 최악점 — 폴더는 그대로
    // 580,130,100, **크기·x·레이어 변경 0**, 폴더를 키워 덮지 않는다). 원본 좌표·시간
    // 함수(stateAt/nativeState/papX·papY mix 식)는 전혀 건드리지 않았다.
    const folderRect = [580, 632, 130, 100];
    if (folderAlpha > 0 && img("folder-back")) {
      ctx.save(); enterGroup(); ctx.globalAlpha = folderAlpha;
      ctx.drawImage(img("folder-back"), ...folderRect); ctx.restore();
    }

    let papX = 0, papY = 0;
    if (t >= 10.9) {
      // 종착점은 실제 적용한 Chog 행렬로 옮긴 손끝이다(board 좌표). 이 자리는 t>=11.4
      // 구간에도 nativePaper(아래 ④)가 그대로 써야 하므로 paperVisible 게이트 밖에서
      // 항상 계산해 둔다.
      // 원본: receiptX = mix(976, hand.x − 15, handoff) — 976·15·29 는 무대 단위다.
      papX = mix(GROUP_DX + 976 * GROUP_SCALE, hand.x - 15 * GROUP_SCALE, handoff);
      papY = mix(GROUP_DY + 632 * GROUP_SCALE, hand.y - 29 * GROUP_SCALE, handoff)
        + 70 * GROUP_SCALE * smooth((t - 14) / 0.7);
    }
    // [renderer.js 46행 sceneSVG] 일반(폴더 사이) 영수증은
    // `delivery>0 && !carryHome && !(t>=11.4 && t<14)` 일 때만 그린다 — 11.4~14 구간은
    // 원본이 이 레이어를 끄고 대신 손끝의 nativePaper(renderer.js 62-65행)로 넘긴다.
    // t>=6.3 부터 delivery 는 항상 1, carryHome 은 8.85~10.9 뿐이라 t>=11.4 구간에서는
    // 이 식이 정확히 `t>=14` 로 접힌다.
    const paperVisible = t >= 11.4 ? t >= 14 : delivery > 0 && !carryHome;
    if (paperVisible && img("receipt-paper")) {
      ctx.save();
      if (t >= 10.9) {
        ctx.scale(sx(), sx());
        // 자리 계산은 항상 돈다(paperBoard 가 이 값을 쓴다) — 건너뛰는 것은 그리기 한 줄뿐.
        if (!hidePaper) ctx.drawImage(img("receipt-paper"), papX, papY, rw * GROUP_SCALE, rh * GROUP_SCALE);
      } else {
        enterGroup();
        // [A-358 §4 → A-359 §2] 확대 중심을 공통 카드 자리(anchor.zx/zy, 뷰포트 실측
        // 기준)로 — 옛 360/325, 그리고 옛 미보정 596/338 유도값도 아니다.
        ctx.translate(anchor.zx, anchor.zy); ctx.scale(zoom, zoom); ctx.translate(-anchor.zx, -anchor.zy);
        if (!hidePaper) ctx.drawImage(img("receipt-paper"), rx, ry, rw, rh);
      }
      ctx.restore();
    }

    if (folderAlpha > 0 && img("folder-front")) {
      ctx.save(); enterGroup(); ctx.globalAlpha = folderAlpha;
      ctx.drawImage(img("folder-front"), ...folderRect); ctx.restore();
    }

    // ④ Chog — 수령(11.4) 뒤에는 native Chog 가 캔버스에 선다.
    //   그 전에는 **기존 Home Chog(DOM)** 를 그대로 둔다. 여기서 그리지 않는다.
    // [renderer.js 62-65행 nativePaper(t,x,y) 그대로] native 몸통(chogFilingSVG) 뒤에
    // (a) t<14 이면 손끝의 종이(papX,papY, 위에서 이미 계산)를 한 번 더 그리고 (b) 그
    // 위를 palm-tip 원(cx=palmX cy=1280 r=145, drawPalm 이 이미 이 클립을 쓴다)으로
    // 자른 손끝 레이어가 덮는다 — 손이 종이를 쥔 것처럼 보이게 하는 원본의 후처리다.
    // t>=14 부터는 (a) 를 멈추고(위 폴더 사이 레이어가 대신 그린다) (b) 만 계속 그린다.
    // [A-414-e] filing 이 끝나면(t>=RETURN_TOTAL_S) canvas native Chog 를 그만 그린다 —
    // 소유권이 DOM Home Chog(원본 Home-ready 자세)로 돌아가는 자리다. 이 canvas 는 folder/
    // Piggy 는 그대로 그려 "정착"(A-322 교정 3)을 지키고, Chog 자체만 넘긴다. 같은 프레임에
    // return-view.js placeChog() 가 meta.chogOwner 로 chogWrap 을 다시 보이므로, 두 Chog 가
    // 겹치는 프레임 0(아래 chogOwner 필드와 같은 경계 t<RETURN_TOTAL_S 를 쓴다).
    if (t >= 11.4 && t < RETURN_TOTAL_S) {
      drawNativeChog(t);
      if (t < 14 && !hidePaper && img("receipt-paper")) {
        ctx.save();
        ctx.scale(sx(), sx());
        ctx.drawImage(img("receipt-paper"), papX, papY, rw * GROUP_SCALE, rh * GROUP_SCALE);
        ctx.restore();
      }
      if (img(PALM[nativeState(t).frame])) drawPalm(t);
    }

    // [A-322 교정 2] 종이가 실제로 그려진 자리를 board 좌표로 돌려준다.
    // 화면(버튼·글자·hitbox·focus outline)이 중앙 고정값 대신 **이 값**을 쓴다.
    // zoom 은 receipt-card group 의 translate(anchor.zx anchor.zy) scale(zoom) —
    // [A-358 §4 → A-359 §2] 공통 카드 자리 중심(뷰포트 실측), 옛 360/325 도 옛 미보정
    // 596/338 유도값도 아니다.
    // t>=11.4 && t<14 구간은 위 nativePaper 후처리가 화면에 그리므로, paperBoard 도
    // 그 시간대에 실제로 보이는 자리(=papX,papY)를 그대로 보고한다.
    let paperBoard = null;
    if (paperVisible || (t >= 11.4 && t < 14)) {
      if (t >= 10.9) {
        paperBoard = { x: papX, y: papY, w: rw * GROUP_SCALE, h: rh * GROUP_SCALE };
      } else {
        const zx = anchor.zx + (rx - anchor.zx) * zoom;
        const zy = anchor.zy + (ry - anchor.zy) * zoom;
        paperBoard = {
          x: GROUP_DX + zx * GROUP_SCALE, y: GROUP_DY + zy * GROUP_SCALE,
          w: rw * zoom * GROUP_SCALE, h: rh * zoom * GROUP_SCALE,
        };
      }
    }

    return {
      t, phase: s.phase, opening, emerge, turn, present, delivery, settle,
      paperBoard,
      // 화면이 소유권을 가릴 수 있도록 매 프레임 알려 준다. [A-322 교정 1 → A-414-e 연장]
      // t<11.4 = Home DOM Chog 만 · 11.4<=t<RETURN_TOTAL_S = canvas native Chog 만 ·
      // t>=RETURN_TOTAL_S(filed) = 다시 Home DOM Chog 만(원본 Home-ready 복귀, 위 ④ 블록과
      // 같은 경계).
      chogOwner: (t >= 11.4 && t < RETURN_TOTAL_S) ? "canvas" : "dom",
      // [A-348 §3] 이번 프레임에 종이를 실제로 그렸는지 — hidePaper 로 건너뛴 프레임은
      // "dom"(그 자리는 DOM 이 그린다), 그렸으면 "canvas". 아무 것도 안 그렸으면 null.
      // t>=11.4 && t<14 는 위 ④ nativePaper 후처리가 그리므로 여기서도 "canvas" 다.
      paperOwner: paperVisible ? (hidePaper ? "dom" : "canvas")
        : (t >= 11.4 && t < 14 ? "canvas" : null),
      x, y, size, frame, pickup, handoff, seated, folderAlpha, zoom, sitDrop,
      receipt: { x: rx, y: ry, w: rw, h: rh },
      hand,
      alertHop: t >= 0.7 && t < 2.8 ? -5 * Math.sin(Math.PI * clamp((t - 0.7) / 0.55)) : 0,
      nativeVisible: t >= 11.4 && t < RETURN_TOTAL_S,
      bellAlpha,
      done: t >= RETURN_TOTAL_S,
    };
  }

  return { drawAt, totalSeconds: RETURN_TOTAL_S };
}

export const RETURN_GEOMETRY = {
  board: [BOARD_W, BOARD_H], stage: [STAGE_W, STAGE_H],
  group: { scale: GROUP_SCALE, dx: GROUP_DX, dy: GROUP_DY },
  chogDrop: RETURN_CHOG_DROP, // [A-920]
  seatRect: SEAT_RECT,
  nativeBridge: { k: NATIVE_K, ox: NATIVE_OX, oy: NATIVE_OY, stepDx: NATIVE_STEP_DX, stepDy: NATIVE_STEP_DY, homeChog: HOME_CHOG, ink: NATIVE_INK },
  gates: { receipt: RECEIPT_GATE_S, zoomDone: ZOOM_DONE_S, pickup: PICKUP_S, total: RETURN_TOTAL_S },
  loaded: LOAD.length,
  notLoaded: ["chog-rest"],
  // [OWNER_INPUT_REQUIRED] "집그림사이즈" 절대 px 기준 미확정 — box 정의부 주석 참고.
  alarmBell: {
    key: BELL_KEY, box: BELL_BOX, gap: BELL_GAP, sizeBoxUnits: BELL_SIZE,
    sizeBoardPxApprox: BELL_SIZE * GROUP_SCALE,
    start: BELL_START_S, end: BELL_END_S, fade: BELL_FADE_S,
    ownerInputRequired: "absolute on-screen size for '집그림사이즈' unresolved — chose 64 box units (~44 board px) beside BOX.ring; Owner has not confirmed",
  },
};

// --- 실제 재생 controller ------------------------------------------------
// 앱(`mountReturn`)과 검토 하네스가 **같은 이 함수**를 쓴다(A-318 에서 배운 것:
// 하네스가 따로 쓴 모형을 통과시키면 그건 앱의 증거가 아니다).
// 주입점: 자산 promise · RAF · 유효 token · reduced.
//
// 두 번 탭 게이트는 원본 player.js 그대로다:
//   7.0 에서 멈춤 → 첫 탭 → 7.3~7.6 확대 후 멈춤 → 둘째 탭 → 8.5 부터 끝까지.
// 둘째 탭은 **이미 저장된 영수증을 UI 에서 정리하는 입력**이다.
// 여기서 rememberReceipt / settleSend / finishTrip / tx 를 부르지 않는다.
export function createReturnPlayback(opts) {
  const {
    canvas,
    loadAssets = loadReturnAssets,
    makeRenderer = createReturnRenderer,
    isValid = () => true,
    schedule,
    reduced = false,
    onStatus = () => {},
    onFiled = () => {},
    onSecondTap = () => {},
    // [A-322 교정 1] 매 프레임 renderer 의 값을 화면에 넘긴다 — 지금까지 버리고 있었다.
    onFrame = () => {},
    // [A-681] Optional: () => RECEIPT_RAIL | null (viewport-px facts, see receiptRailTarget()).
    // Absent / returns null -> the legacy fixed anchor (web, and every width >640).
    getReceiptRail = null,
  } = opts;

  let renderer = null;
  let stopped = false;
  let t = 0;
  let last = 0;
  let running = false;
  let phase = "idle";
  let error = null;
  let missingList = [];
  let taps = 0;           // 0 = 아직, 1 = 확대함, 2 = 정리함
  let secondTapCalls = 0; // 둘째 탭 부수효과가 몇 번 나갔는지 — 연타 검증용
  let drawCount = 0;
  let filedFired = false; // 완료 신호는 **한 번만** 나간다(늦은 프레임이 씬을 다시 넘기지 않게)

  const alive = () => !stopped && isValid();
  // [A-348 §3] 종이 gate 대기 구간 — 이때만 DOM 이 종이를 소유한다(explicit ownership).
  const isWaitingPhase = (p) => p === "await-first-tap" || p === "await-second-tap";
  // [A-352 §3] 첫 탭 뒤 확대 재생(taps===1, phase="playing", t≈7.3~7.6s)은 gate 대기가
  // 아니라서 isWaitingPhase 만 보면 이 구간에 hidePaper 가 꺼져 canvas 가 다시 옛 종이를
  // 그리는데, 그 순간 view 쪽(waiting)도 phase!="await-*" 라 DOM tapBtn 을 숨겨 버린다 —
  // 둘이 같이 "새 종이가 사라지고 옛 종이로 바뀌는" 전환이 보였다. 확대가 끝나 taps===2 로
  // 넘어가기 전까지는(await-second-tap 진입까지) DOM 이 계속 종이를 들고 있게 한다. 타이밍·
  // 게이트 자체(gateFor/tap 진행 조건)는 건드리지 않는다 — 그리기 소유권만 넓힌다.
  const isDomPaperPhase = (p) => isWaitingPhase(p) || (taps === 1 && p === "playing");
  const status = () => ({
    phase, t, taps, drawCount, secondTapCalls, running,
    missing: missingList.slice(), error: error ? String((error && error.message) || error) : null,
  });
  const settle = (next) => {
    phase = next;
    // gate 에 막 들어선 순간 — 얼려 둔 마지막 프레임을 hidePaper:true 로 한 번 더 그려
    // canvas 쪽 종이를 지운다. 그래야 DOM(receiptPaper)이 얹혀도 같은 자리에 두 장이
    // 겹치지 않는다(그냥 덮어서 "중복 0" 이라 주장하지 않기 위함 — A-348 §3).
    if (isWaitingPhase(next)) paint();
    onStatus(status());
    return status();
  };
  // 무효가 된 재생은 바깥에 알리지 않는다(A-320 교정 14 와 같은 규율).
  const quiet = (next) => { if (phase !== "stopped") phase = next; return status(); };

  const drawOpts = () => ({
    hidePaper: isDomPaperPhase(phase),
    receiptRail: getReceiptRail ? getReceiptRail() : null,
  });

  function paint() {
    if (!renderer || !alive()) return false;
    onFrame(renderer.drawAt(t, drawOpts()));
    drawCount += 1;
    return true;
  }

  // 지금 시점에서 더 진행할 수 있는 한계.
  const gateFor = () => (taps === 0 ? RECEIPT_GATE_S : taps === 1 ? ZOOM_DONE_S : RETURN_TOTAL_S);

  function step(now) {
    if (!alive() || filedFired) { running = false; return false; }
    const dt = last ? Math.min(now - last, 80) : 0;
    last = now;
    const gate = gateFor();
    t = Math.min(gate, t + dt / 1000);
    // gate 도달 직전 마지막 프레임까지는 아직 "playing" — taps===1 구간(첫 탭 확대)은
    // isDomPaperPhase 로 DOM 소유가 이어진다. settle() 이 그 다음에 await-*-tap 으로 넘기며
    // 한 번 더 hidePaper:true 로 다시 그린다(위 settle 참조).
    onFrame(renderer.drawAt(t, drawOpts()));
    drawCount += 1;
    if (t >= gate) {
      running = false;
      if (gate === RETURN_TOTAL_S) {
        if (filedFired) return false;
        filedFired = true;
        settle("filed"); onFiled();
      }
      else settle(taps === 0 ? "await-first-tap" : "await-second-tap");
      return false;
    }
    return true;
  }

  function run() {
    if (!alive() || running) return;
    running = true; last = 0;
    settle("playing");
    schedule(step);
  }

  /** 종이 탭 / Enter / Space. 각 단계 한 번만 먹는다(연타·혼합 입력 포함). */
  function tap() {
    if (!alive() || !renderer) return status();
    if (taps === 0) {
      if (t < RECEIPT_GATE_S) return status();     // 아직 영수증이 나오기 전
      taps = 1;
      if (reduced) { t = ZOOM_DONE_S; paint(); return settle("await-second-tap"); }
      t = 7.3; paint(); run();
      return status();
    }
    if (taps === 1) {
      if (t < ZOOM_DONE_S) return status();        // 확대가 끝나야 둘째 탭을 받는다
      taps = 2;
      secondTapCalls += 1;
      onSecondTap();                               // 저장 호출 아님 — UI 정리 신호다
      if (reduced) {
        t = RETURN_TOTAL_S; paint();
        if (!filedFired) { filedFired = true; settle("filed"); onFiled(); }
        return status();
      }
      t = PICKUP_S; paint(); run();
      return status();
    }
    return status();                               // 세 번째부터는 아무 일도 없다
  }

  // [A-466 Lane A] 사용자 skip — **화면만** 최종 filed 상태로 보낸다.
  // 이 함수는 tx 확정·trip 결과·영수증 생성·권한을 만들지도 바꾸지도 않는다(그것들은 이 씬에
  // 들어오기 전에 이미 끝났거나, 끝나지 않았다면 여기로 오지 않는다).
  // 자산 실패(asset-missing/asset-error)에서는 **아무 일도 하지 않는다** — 실패를 filed 로
  // 위장하지 않기 위해서다. reduced 경로의 정착 방식을 그대로 쓰되, 그것은 시스템 자동 정착이고
  // 이쪽은 사용자 조작이라 호출 지점이 다르다(구분 유지).
  function skip() {
    if (!alive() || !renderer) return status();
    if (phase === "asset-missing" || phase === "asset-error" || phase === "loading") return status();
    if (filedFired) return status();
    taps = 2;
    t = RETURN_TOTAL_S;
    paint();
    filedFired = true;
    settle("filed");
    onFiled();
    return status();
  }

  function start() {
    if (stopped) return Promise.resolve(status());
    settle("loading");
    return Promise.resolve()
      .then(() => loadAssets())
      .then((res) => {
        const images = res && res.images;
        missingList = (res && res.missing) || [];
        if (!alive()) return quiet(stopped ? "stopped" : "abandoned");
        // 유효한 인스턴스면 바깥이 fallback 을 걸 수 있게 정확히 한 번 알린다.
        // (무효면 위 alive() 검사에서 이미 조용히 끝났다.)
        if (!images || missingList.length) return settle("asset-missing");
        renderer = makeRenderer(canvas, { images });
        if (reduced) {
          // 모션 구간만 건너뛴다 — 두 번 입력 게이트는 그대로 살아 있다.
          t = RECEIPT_GATE_S; paint();
          return settle("await-first-tap");
        }
        t = 0; paint(); run();
        return status();
      })
      .catch((err) => {
        error = err; renderer = null;
        if (!alive()) return quiet(stopped ? "stopped" : "abandoned");
        return settle("asset-error");
      });
  }

  function stop() {
    stopped = true; running = false; renderer = null;
    if (phase !== "filed") phase = "stopped";
    return status();
  }

  return { start, stop, tap, skip, redraw: paint, status, get phase() { return phase; } };
}
