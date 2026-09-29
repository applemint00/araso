// [A-620 MOBILE HOME RESPONSIVE REPAIR] Contract test — network 0, browser 0.
// Root cause (receipt A620_mobile_home_responsive/VERIFY.md §1): at 390/430 main.js
// applyHomeCharacterScaleFloor() wraps #chogHome in `.homeCharScaleFloor` (translate+scale(k),
// k = 0.52/s), but chog-home.js sharedCardPadTarget() measured only #homeBoard, so the docked
// HOME paper received k a second time (256.338×k → 429px @390, 389px @430) and grew off the
// left edge. The fix measures #chogHome's actual parent frame. This file locks that wiring and
// proves, with the same composition math, that the docked paper lands at the viewport canon
// (256.338×364 at centre−32/−48) at every width, with or without the floor wrapper.
//   node app/test/a620-home-paper-dock-frame.mjs
import { readFileSync } from "node:fs";
import { HOME_SCALE, CORNER_TX, CORNER_TY } from "../src/chog-home.js";

const CHOG = readFileSync(new URL("../src/chog-home.js", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); fail += 1; }
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

function cut(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`not found: ${startMarker}`);
  return src.slice(start, end);
}

// ── 1. source wiring ──
const target = cut(CHOG, "function sharedCardPadTarget()", "function draw()");
check("sharedCardPadTarget reads #chogHome's live parent", /root\.parentElement/.test(target));
check("parent accepted only when it is #homeBoard or .homeCharScaleFloor", /matches\("#homeBoard, \.homeCharScaleFloor"\)/.test(target));
check("falls back to #homeBoard otherwise", /:\s*homeBoardEl;/.test(target));
check("frame scale = frame rect width / frame layout width", /boardRect\.width \/ frameW/.test(target));
check("no longer hard-wires homeBoardEl.getBoundingClientRect()", !/homeBoardEl && homeBoardEl\.getBoundingClientRect\(\)/.test(target));
check("viewport canon unchanged: centre −32/−48, finalPaperScale contain-fit 285×364",
  /window\.innerWidth \/ 2 - 32 - paperW \/ 2/.test(target) && /window\.innerHeight \/ 2 - 48 - paperH \/ 2/.test(target) &&
  /const finalPaperScale = Math\.min\(CARD_ANCHOR_W \/ PAPER_W, CARD_ANCHOR_H \/ PAPER_H\);/.test(CHOG));

// character canon untouched (no shrink/move of the resident group to make room)
check("HOME_CHAR_SCALE_FLOOR still 0.52", /const HOME_CHAR_SCALE_FLOOR = 0\.52;/.test(MAIN));
check("floor still wraps #homeChar AND #chogHome", /const parts = \[homeChar, chogHome\]\.filter\(Boolean\);/.test(MAIN));
check("floor group transform formula unchanged", /group\.style\.transform = `translate\(\$\{nudgeLocalX\}px, \$\{nudgeLocalY\}px\) scale\(\$\{k\}\)`;/.test(MAIN));

// ── 2. composition math (reimplemented from the source above) ──
const PAPER_W = 400, PAPER_H = 568, PAPER_BASE_SCALE = 0.275;
const finalPaperScale = Math.min(285 / PAPER_W, 364 / PAPER_H);
const finalPadScale = finalPaperScale / PAPER_BASE_SCALE;
const HOME_CENTER = 1041, HOME_FLOOR = 648;

// target in #chogHome-local coordinates, given the measured frame rect (left/top/scale)
function padTarget(frame, vw, vh) {
  const viewportScale = frame.scale * HOME_SCALE;
  const paperW = finalPaperScale * PAPER_W;
  const paperH = finalPaperScale * PAPER_H;
  const boardX = (vw / 2 - 32 - paperW / 2 - frame.left) / frame.scale;
  const boardY = (vh / 2 - 48 - paperH / 2 - frame.top) / frame.scale;
  return {
    x: (boardX - CORNER_TX) / HOME_SCALE + (105 * finalPadScale) / viewportScale,
    y: (boardY - CORNER_TY) / HOME_SCALE + (102 * finalPadScale) / viewportScale,
    scale: finalPaperScale / (PAPER_BASE_SCALE * viewportScale),
  };
}
// render the docked paper (pad transform → mount −105/−102 110 wide → paper) through the REAL frame
function renderPaper(t, real) {
  const localLeft = CORNER_TX + HOME_SCALE * (t.x + t.scale * -105);
  const localTop = CORNER_TY + HOME_SCALE * (t.y + t.scale * -102);
  return {
    left: real.left + real.scale * localLeft,
    top: real.top + real.scale * localTop,
    width: real.scale * HOME_SCALE * t.scale * 110,
    height: real.scale * HOME_SCALE * t.scale * 156,
  };
}
function frames(vw, vh) {
  const s = Math.min(vw / 1256, vh / 772);
  const board = { left: (vw - 1256 * s) / 2, top: (vh - 772 * s) / 2, scale: s };
  if (s >= 0.52) return { s, board, real: board, k: 1 };
  const k = 0.52 / s;
  const nudgeLocalX = 6 / s;
  const nudgeLocalY = (vh - 52 - 22 - (board.top + HOME_FLOOR * s)) / s; // harness bottom-safe 52
  const real = {
    left: board.left + s * (nudgeLocalX + HOME_CENTER * (1 - k)),
    top: board.top + s * (nudgeLocalY + HOME_FLOOR * (1 - k)),
    scale: s * k,
  };
  return { s, board, real, k };
}

for (const [vw, vh] of [[390, 844], [430, 900], [360, 780], [1440, 900]]) {
  const { board, real, k } = frames(vw, vh);
  const fixed = renderPaper(padTarget(real, vw, vh), real);
  const wantLeft = vw / 2 - 32 - (finalPaperScale * PAPER_W) / 2;
  const wantTop = vh / 2 - 48 - (finalPaperScale * PAPER_H) / 2;
  check(`${vw}×${vh}: docked paper width = 256.338 (viewport canon)`, near(fixed.width, 256.338, 0.001), `got ${fixed.width}`);
  check(`${vw}×${vh}: docked paper left = centre−32−w/2`, near(fixed.left, wantLeft), `got ${fixed.left}`);
  check(`${vw}×${vh}: docked paper top = centre−48−h/2`, near(fixed.top, wantTop), `got ${fixed.top}`);
  if (vw <= 640) {
    const inset = vw <= 400 ? 20 : 24;
    check(`${vw}×${vh}: paper inside horizontal safe rails`, fixed.left >= inset - 0.5 && fixed.left + fixed.width <= vw - inset + 0.5, `l=${fixed.left} r=${fixed.left + fixed.width}`);
    // the pre-A620 behaviour: target computed from #homeBoard only, rendered through the floor frame
    const old = renderPaper(padTarget(board, vw, vh), real);
    check(`${vw}×${vh}: pre-A620 formula reproduces the ×k overflow (${(256.338 * k).toFixed(2)}px)`, near(old.width, 256.338 * k, 0.01), `got ${old.width}`);
  } else {
    const old = renderPaper(padTarget(board, vw, vh), real);
    check(`${vw}×${vh}: no floor → identical to pre-A620`, near(old.left, fixed.left, 1e-9) && near(old.width, fixed.width, 1e-9));
  }
}
// measured pre-repair values (VERIFY §1.2) match the ×k model
{
  const { real } = frames(390, 844);
  check("390 pre-repair measured width 429.281 = 256.338×1.67467", near(renderPaper(padTarget(frames(390, 844).board, 390, 844), real).width, 429.281, 0.01));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
