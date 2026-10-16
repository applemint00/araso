// Send/Away 출발 — yay → 돈 챙김 → 걷기 → 옆멈춤 → 뒤돌기 → 문 그리기 → 입장 → Away
//
// 수식·시간·좌표는 전부 확정 보관본(비공개 모션 디자인 원본의 departure.js)
// 것이다. 여기서 새로 설계하지 않는다.
// 그림은 비공개 디자인 원본에서 구운 2x 래스터다.
// 원본 벡터 `d` 는 앱에 들어오지 않는다 — Canvas 는 PNG 만 그린다.
//
// 이 모듈은 **모션만** 한다. 거래·서명·권한과 무관하고, 완료 콜백은
// "애니메이션이 끝났다"는 뜻일 뿐 "거래가 끝났다"가 아니다.

const DIR = "/motion/piggy-depart";

// --- 원본 좌표계 --------------------------------------------------------
// [A-318 교정 1] 원본은 만든 직후 layer 의 viewBox 를 `0 0 1256 772` 로 **바꾼다**
// (departure.js: `layer.setAttribute('viewBox','0 0 1256 772')`, width 1256px height 772px).
// 즉 1 user unit = board 1px 다. meet fit 도 letterbox 도 없다.
// 마크업에 적힌 1200×800 은 portal 등 내부 좌표의 계산 범위일 뿐 fit 근거가 아니다.
const STAGE_W = 1200;   // 원본 내부 좌표 범위(계산용) — 축척에 쓰지 않는다
const STAGE_H = 800;
const BOARD_W = 1256;
const BOARD_H = 772;

// piggyMarkup 로컬 상자 (export 와 같은 값)
const PM = { x: 125.5, y: 17.5, w: 801, h: 1075 };
const PM_PAD = { l: 260, t: 120, r: 560, b: 120 };
const PM_BOX = {
  x: PM.x - PM_PAD.l, y: PM.y - PM_PAD.t,
  w: PM.w + PM_PAD.l + PM_PAD.r, h: PM.h + PM_PAD.t + PM_PAD.b,
};
// `#standing` 의 정적 변환 — **런타임에서 한 번만** 적용한다(굽지 않았다).
const STANDING = { scale: 0.2, tx: 1000, mirrorX: true };

// 포털 (stage 좌표)
const PORTAL = { cx: 480, cy: 410, rx: 76, ry: 116 };
const PORTAL_PAD = 40;
const PORTAL_RECT = {
  x: PORTAL.cx - PORTAL.rx - PORTAL_PAD, y: PORTAL.cy - PORTAL.ry - PORTAL_PAD,
  w: (PORTAL.rx + PORTAL_PAD) * 2, h: (PORTAL.ry + PORTAL_PAD) * 2,
};

// 앉은/올려보는 이미지 자리. 원본은 만든 뒤 height 를 `218*1102/1056` 으로 **덮어쓴다**
// — 원본 SVG 의 가로세로비(1056×1102)를 지키기 위해서다. [A-318 교정 2]
const SEAT_RECT = { x: 862, y: 515, w: 218, h: 218 * 1102 / 1056 };

// 원본이 layer 전체에 거는 group 변환. Home 의 seat 자리에 맞추는 값이다:
//   scale = seatW/218 ; dx = seatLeft − 862·scale ; dy = seatTop − 515·scale
// Home 정본(seat 150 / left 966.135 / top 491.75)으로 계산한다.
const HOME_SEAT = { w: 150, left: 966.135, top: 491.75 };
const GROUP_SCALE = HOME_SEAT.w / 218;
const GROUP_DX = HOME_SEAT.left - 862 * GROUP_SCALE;
const GROUP_DY = HOME_SEAT.top - 515 * GROUP_SCALE;

// --- 원본 시간 함수 (departure.js 그대로) --------------------------------
export const DEPART_TOTAL_S = 11.25;
// ── [A-735] Work? 확정 cue (Owner 확정 2026-09-26, home_motion_confirmed_20260926) ──────────────────
// 원본: 비공개 preview.js:14,1087-1125 `drawConfirmedWorkCue`. 수치 그대로(새 모션·새 그림 0):
//   0–0.35s 올려다봄(work 렌더러 source 상승) → 0.35–0.75s 놀란 눈 한 박자(원본 SURPRISED_EYES 경로 2개 +
//   검정 덮개) → 0.9–1.45s 점프 한 번(-18px) → 1.8s 에 준비 홀드로 정지(loop:false).
// 이 cue 는 출발/Send 를 시작하지 않는다 — 씬 시계(source)는 그대로 0.8 에서 멈춘다(위 A-419 식).
export const WORK_CUE = Object.freeze({ total: 1.8, lookUp: 0.35, surprisedEnd: 0.75, jumpStart: 0.9, jumpEnd: 1.45, jump: -18 });
const WORK_SURPRISED = {
  viewbox: { width: 1086, height: 1149 },
  seat: { width: 150, height: 150 * 1102 / 1056 },
  cover: [1008, 548, 43, 24],
  eyes: [
    { d: "M629.282 534.398L639.973 541.407L650.015 556.554L655.829 576.985L656.408 597.918L653.453 617.588L644.347 636.274L635.018 646.891L624.538 647.934L612.057 639.488L607.517 633.481L601.915 621.103L599.948 613.225L599.057 581.021L599.706 572.864L605.334 554.543L617.974 537.138L629.282 534.398Z", sourceCenter: [627.7, 591.2], targetCenter: [1017.1, 558.5] },
    { d: "M776.846 524.282L788.5 534.425L795.88 548.222L799.994 570.437L800.617 592.98L797.528 607.819L790.078 623.111L779.048 635.512L769.441 636.468L764.118 633.769L756.916 626.412L752.286 617.185L746.472 596.754L745.76 570.991L751.154 544.601L757.777 531.024L762.877 525.673L776.846 524.282Z", sourceCenter: [773.2, 580.4], targetCenter: [1037.6, 561.7] },
  ],
};
// [A-1281] The #2 sulky face (lookdownR-2 eyes + mouth, seat.svg viewBox coords; main.js builds the seated-Piggy SVG face from the
// same paths). On the work pose it is mapped by the eye pair: the seat face"s eye centres → the work pose"s eye centres
// (WORK_SURPRISED targets), so only the face changes and the body stays the drawn work-open picture.
export const SULKY_FACE = Object.freeze({
  offset: [152, -94], // where the face sits on the seated Piggy (seat.svg)
  eyes: ["M222.153 623.234L210.5 628.581L203.119 635.854L199.006 647.565L198.382 659.448L201.471 667.271L208.921 675.332L219.951 681.869L229.558 682.373L234.882 680.95L242.084 677.072L246.713 672.208L252.527 661.438L253.24 647.857L247.846 633.945L241.223 626.788L236.122 623.967L222.153 623.234Z", "M369.717 628.568L359.026 632.263L348.984 640.247L343.17 651.018L342.591 662.052L345.546 672.421L354.652 682.272L363.981 687.869L374.461 688.418L386.942 683.966L391.482 680.8L397.084 674.274L399.051 670.122L399.942 653.145L399.293 648.845L393.666 639.187L381.025 630.012L369.717 628.568Z"],
  mouth: "M234.586 733.014C232.61 732.593 230.548 732.973 228.853 734.071C227.158 735.169 225.969 736.896 225.547 738.872C225.125 740.847 225.505 742.909 226.603 744.604C227.702 746.299 229.429 747.489 231.404 747.91C231.404 747.91 231.404 747.91 231.404 747.91C232.313 748.101 232.97 748.109 233.351 748.115C233.566 748.116 233.771 748.111 233.959 748.103C234.117 748.096 234.268 748.086 234.416 748.075C235.048 748.023 235.451 747.962 235.888 747.892C236.734 747.752 237.434 747.595 238.11 747.43C239.466 747.096 240.688 746.726 241.891 746.332C253.736 742.28 264.066 736.319 273.675 728.982C274.03 728.708 274.375 728.433 274.718 728.15C281.124 723.05 286.299 715.208 288.944 709.446C288.946 709.443 288.947 709.441 288.949 709.439C288.966 709.417 288.966 709.43 288.936 709.488C288.914 709.532 288.834 709.677 288.642 709.93C288.476 710.127 288.118 710.673 286.996 711.428C286.598 711.709 285.201 712.475 283.647 712.624C282.106 712.841 280.063 712.382 278.835 711.628C277.464 710.792 277.142 710.32 276.696 709.815C276.501 709.574 276.351 709.36 276.23 709.172C276.104 708.975 276.057 708.891 275.989 708.771C275.747 708.328 275.661 708.079 275.622 707.985C275.536 707.759 275.558 707.829 275.572 707.949C275.657 708.507 275.783 709.738 275.875 710.902C276.067 713.299 276.236 715.932 276.496 718.621C277.306 724.166 276.851 729.327 281.796 737.538C281.853 737.619 281.909 737.7 281.966 737.78C289.636 748.81 302.725 751.588 310.587 753.831L309.43 753.525C309.431 753.525 309.432 753.526 309.433 753.527C310.033 753.846 311.304 755.634 314.092 756.921C314.099 756.924 314.105 756.927 314.112 756.93C314.748 757.215 315.341 757.459 315.877 757.674C318.312 758.631 319.716 759.16 321.417 759.97C324.34 761.342 327.665 761.479 330.677 760.315C333.688 759.154 336.139 756.786 337.475 753.769C338.811 750.753 338.917 747.346 337.754 744.335C336.592 741.323 334.255 738.953 331.275 737.711C331.275 737.711 331.275 737.711 331.275 737.711C328.892 736.691 326.086 735.704 324.325 735.123C323.95 734.997 323.637 734.89 323.375 734.799C323.373 734.798 323.37 734.797 323.367 734.796C322.159 734.415 319.639 734.05 316.115 733.017C316.109 733.015 316.103 733.014 316.098 733.012C315.864 732.954 315.179 732.738 314.94 732.706C305.779 731.609 299.765 730.555 296.631 726.777C296.605 726.747 296.579 726.717 296.553 726.686C296.385 726.739 295.483 724.921 294.988 723.031C294.44 721.085 294.011 718.834 293.645 716.491C293.275 714.139 292.979 711.702 292.613 709.034C292.415 707.664 292.256 706.366 291.822 704.441C291.692 703.9 291.569 703.39 291.273 702.549C291.147 702.201 290.913 701.582 290.533 700.891C290.361 700.581 290.057 700.053 289.563 699.443C289.01 698.809 288.61 698.253 287.08 697.321C284.133 695.3 279.152 696.536 278.032 697.594C276.679 698.493 276.044 699.34 275.718 699.743C274.915 700.813 274.721 701.261 274.396 701.878C274.384 701.903 274.372 701.927 274.36 701.952C271.608 708.725 269.282 712.794 265.032 716.395C264.814 716.574 264.595 716.748 264.37 716.922C256.108 723.275 246.627 728.64 237.136 731.861C236.215 732.164 235.302 732.435 234.481 732.637C234.079 732.735 233.691 732.817 233.425 732.861C233.297 732.882 233.196 732.892 233.225 732.889C233.244 732.888 233.292 732.883 233.454 732.883C233.591 732.888 233.903 732.875 234.586 733.014Z",
  eyeCentres: [[226.1 + 152, 652.8 - 94], [371.3 + 152, 658.5 - 94]],
  cover: [1005, 546, 46, 38], // work-open eyes + mouth, board coords (black, inside the head)
});
/** 순수 타임라인(캔버스 없이 검증 가능). elapsed(초, 실제 경과) → 그 순간의 cue 상태. */
export function workCueState(elapsed) {
  const t = Math.max(0, Math.min(WORK_CUE.total, Number.isFinite(elapsed) ? elapsed : 0));
  const jp = t >= WORK_CUE.jumpStart && t <= WORK_CUE.jumpEnd ? (t - WORK_CUE.jumpStart) / (WORK_CUE.jumpEnd - WORK_CUE.jumpStart) : 0;
  return {
    t,
    clock: t < WORK_CUE.lookUp ? t : 1, // work 렌더러에 넘기는 시계: 올려다보기 후 홀드
    surprised: t >= WORK_CUE.lookUp && t < WORK_CUE.surprisedEnd,
    jumpY: jp ? WORK_CUE.jump * Math.sin(Math.PI * jp) : 0,
    hold: t >= WORK_CUE.total,
  };
}

const C = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => { t = C(t); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/** 원본 `sceneTime` — 옆모습 3.85–4.15 멈춤, 그 뒤 0.5배속 느린 뒤돌기. */
export function sceneTimeOf(t) {
  return t < 3.85 ? t
    : t < 4.15 ? 3.85
    : t < 5.05 ? 3.85 + (t - 4.15) * 0.5
    : t - 0.75;
}

/** 원본 send 소스 재매핑 — yay/챙김 구간을 늘려 붙인다. */
export function sendSourceOf(e) {
  return e < 0.5 ? 0.8
    : e < 1.05 ? 1 + (e - 0.5)
    : e < 1.7 ? 1.55
    : 1.6 + e - 1.7;
}

// 프레임 변동 5종 × 48
const FRAME_GROUPS = ["walk-legR", "walk-legL", "walk-handR", "walk-v6", "walk-v7"];
const STATIC_PARTS = ["ears_R", "rear_ears", "body", "eye_L", "eye_R", "mouth_smile", "mouth_strait", "group8"];
const STATE_IMAGES = ["seat-idle", "seat-lookup", "work-open", "work-half", "work-shut"];
const FACE_WINDOW = { cx: 500, cy: 450, rx: 320, ry: 360 };
const OVERLAYS = ["portal-ring", "portal-depth", "entry-mask"];
const FRAMES = 48;

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

// [A-1291] Sulky = design C: the whole sulky Piggy of the mock (seat_idle arms/legs + #2 lookdownR-2 ears/body/eyes/mouth) replaces the
// work-open picture for the beat, cross-faded. It is drawn in the seat picture's 300x300 frame (the frame drawSeat maps onto SEAT_RECT),
// placed by `place` = a similarity fit of the mock's normal Piggy onto seat-idle.png (IoU 0.968) followed by seat-idle.png onto
// work-open.png (IoU 0.905): scale · turn (rad) · x · y, in that frame. Missing / broken svg = the face-only sulky below.
export const SULKY_C = Object.freeze({ src: "seat-sulky-c.svg", size: [1100, 1180], place: [0.26946, 0.142907, 31.5434, -28.9077] });

/** 필요한 PNG 를 한 번만 받아 둔다. */
export async function loadDepartAssets() {
  const names = [...STATIC_PARTS, ...STATE_IMAGES, ...OVERLAYS];
  const jobs = names.map((n) => loadImage(`${DIR}/${n}.png`).then((im) => [n, im]));
  for (const g of FRAME_GROUPS) {
    for (let i = 0; i < FRAMES; i += 1) {
      const key = `${g}-${String(i).padStart(2, "0")}`;
      jobs.push(loadImage(`${DIR}/${key}.png`).then((im) => [key, im]));
    }
  }
  const pairs = await Promise.all(jobs);
  const map = new Map(pairs);
  const missing = pairs.filter(([, im]) => !im).map(([n]) => n);
  const sulkyC = await loadImage(`${DIR}/${SULKY_C.src}`); // optional: never part of `missing`
  if (sulkyC) map.set("seat-sulky-c", sulkyC);
  return { images: map, missing };
}

/**
 * 출발 렌더러. **UI 없는 `drawAt(elapsed)` 만 제공한다** — 원본의 seek/time/status
 * 같은 검토용 DOM 은 앱에 만들지 않는다(A-316 계약 12).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{images:Map, boardScale:number, mode?:string}} opts
 */
export function createDepartRenderer(canvas, opts) {
  const { images, mode = "send" } = opts;
  let ctx = canvas.getContext("2d");
  const mainCtx = ctx;
  const img = (n) => images.get(n) || null;
  // 입장 구간에서 캐릭터를 가리는 층. 원본은 `#piggyClip` 에 `entryDepthMask` 를 걸어
  // 문 왼쪽으로 들어간 몸을 지운다 — 「보이지 않는 곡선 mask」가 이것이다.
  let layer = null;
  let layerCtx = null;
  function layerCtx0() {
    if (!layer || layer.width !== canvas.width || layer.height !== canvas.height) {
      layer = document.createElement("canvas");
      layer.width = canvas.width; layer.height = canvas.height;
      layerCtx = layer.getContext("2d");
    }
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    return layerCtx;
  }

  // board(1256×772) → canvas px. 그 밖의 fit 은 없다. [A-318 교정 1]
  const sx = () => canvas.width / BOARD_W;

  // 원본 변환 사슬 그대로:
  //   stage → piggyPosition translate(x, y) → standing scale(.2) translate(1000 0) scale(-1 1)
  // 순서를 바꾸면 위치가 어긋난다. `#standing` 의 정적 변환은 여기 한 곳에서만 걸린다.
  // stage → group(translate dx,dy scale) → 그 안에서 원본 좌표를 쓴다.
  function enterGroup() {
    ctx.scale(sx(), sx());
    ctx.translate(GROUP_DX, GROUP_DY);
    ctx.scale(GROUP_SCALE, GROUP_SCALE);
  }

  function withStanding(px, py, draw) {
    ctx.save();
    enterGroup();
    ctx.translate(px, py);
    ctx.scale(STANDING.scale, STANDING.scale);
    ctx.translate(STANDING.tx, 0);
    if (STANDING.mirrorX) ctx.scale(-1, 1);
    draw();
    ctx.restore();
  }

  // 파츠 PNG 한 장을 자기 로컬 상자에 놓는다.
  function part(name, { tx = 0, ty = 0, rot = 0, pivot = null, alpha = 1, visible = true } = {}) {
    if (!visible || alpha <= 0) return;
    const im = img(name);
    if (!im) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 원본 `transform="translate(tx ty) rotate(a cx cy)"` 와 같은 순서.
    // translate 가 바깥, pivot 회전이 안쪽이다 — 뒤집으면 팔이 몸에서 떨어진다.
    ctx.translate(tx, ty);
    if (rot && pivot) {
      ctx.translate(pivot[0], pivot[1]);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-pivot[0], -pivot[1]);
    }
    ctx.drawImage(im, PM_BOX.x, PM_BOX.y, PM_BOX.w, PM_BOX.h);
    ctx.restore();
  }

  function frameIndex(sceneTime, stepping, turning) {
    if (turning) return 25;
    if (!stepping) return 0;
    return Math.floor((sceneTime * 1000) / 30) % FRAMES;
  }

  /**
   * 원본 `renderBase()` 를 Canvas 로 옮긴 것. 수식은 그대로다.
   * @param {number} elapsed 초 단위 실제 경과(애니메이션 시계)
   */
  let face = null; // [A-1281] null = the picture's own face · "sulky" = the #2 face over it (work mode)
  function drawSulkyFace() {
    const sf = SULKY_FACE;
    const [s0, s1] = sf.eyeCentres;
    const [t0, t1] = WORK_SURPRISED.eyes.map((e) => e.targetCenter);
    const k = Math.hypot(t1[0] - t0[0], t1[1] - t0[1]) / Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    const turn = Math.atan2(t1[1] - t0[1], t1[0] - t0[0]) - Math.atan2(s1[1] - s0[1], s1[0] - s0[0]);
    ctx.save();
    ctx.scale(sx(), sx());
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(sf.cover[0] + sf.cover[2] / 2, sf.cover[1] + sf.cover[3] / 2, sf.cover[2] / 2, sf.cover[3] / 2, turn, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(t0[0], t0[1]);
    ctx.rotate(turn);
    ctx.scale(k, k);
    ctx.translate(-s0[0], -s0[1]);
    ctx.translate(sf.offset[0], sf.offset[1]);
    ctx.fillStyle = "#fff";
    for (const p of [...sf.eyes, sf.mouth]) ctx.fill(new Path2D(p));
    ctx.restore();
  }
  let faceMix = 1; // [A-1291] 0..1 cross-fade of the design C picture over work-open
  function drawSulkyC(alpha, dy) {
    const im = img("seat-sulky-c");
    if (!im || alpha <= 0) return;
    const [s, turn, x, y] = SULKY_C.place;
    ctx.save();
    ctx.globalAlpha = alpha;
    enterGroup();
    ctx.translate(SEAT_RECT.x, SEAT_RECT.y + dy);
    ctx.scale(SEAT_RECT.w / 300, SEAT_RECT.h / 300);
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.scale(s, s);
    ctx.drawImage(im, 0, 0, SULKY_C.size[0], SULKY_C.size[1]);
    ctx.restore();
  }
  function setFace(next, mix = 1) { face = next || null; faceMix = Math.max(0, Math.min(1, mix)); }
  function drawAt(rawElapsed) {
    // [A-735] work? = 확정 cue 타임라인. 렌더러 안의 모든 `elapsed` 는 cue 시계(올려다봄 후 홀드)가 된다.
    const cue = mode === "work" ? workCueState(rawElapsed) : null;
    const elapsed = cue ? cue.clock : rawElapsed;
    const e = Math.max(0, Math.min(DEPART_TOTAL_S, elapsed));
    // [A-419] work? 홀드식이 이 파일에 없어서 호출부(main.js mountSendCardWorkPose)가
    // elapsed 자체를 0.8 로 얼려 출발을 막고 있었다 — 그 대가로 아래 깜박임 계산
    // (`elapsed % 3.6`)이 상수가 되어 work-half/work-shut 이 화면에 한 번도 나오지
    // 않았다. A-414-b/c 에서 "출발 금지와 깜박임은 수학적으로 동시에 불가"라고 보고한
    // 것은 오진이며 여기서 정정한다. 확정 원본
    // (비공개 모션 디자인 원본 departure.js:79) —`const elapsed=t; if(mode==='work')source=.15+.65*ease(elapsed/.55);
    //  t=source; renderBase(); t=elapsed;` — 는 **씬 시계(source)만** 0.15→0.8 로 올려
    // 출발 임계 1.0 밑에 영구히 머물게 하고, `elapsed` 는 실제 시계 그대로 흘려 보낸다.
    // 그래서 두 요구가 동시에 성립한다. 그 식을 그대로 옮긴다(수치 변경 0).
    const source =
      mode === "send" ? sendSourceOf(e) : mode === "work" ? 0.15 + 0.65 * ease(elapsed / 0.55) : e;
    const t = sceneTimeOf(source);

    ctx = mainCtx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (cue) { ctx.save(); ctx.translate(0, cue.jumpY * sx()); } // [A-735] 점프 = 캔버스 통째 -18px 한 번(원본과 같음)

    const rise = ease((t - 1) / 0.55);
    const travel = ease((t - 1.6) / 2.2);
    const draw = C((t - 4.3) / 2.4);
    const enter = ease((t - 7.0) / 1.25);
    const close = ease((t - 8.4) / 0.75);

    let x = mix(860, 555, travel);
    let y = mix(508, 330, travel);
    x -= enter * 345;
    y -= enter * 40;

    // 포털 뒤선 — 그리는 동안은 진행분만 보인다(원본 dashoffset 대응).
    const portalVisible = !(t < 4.3 || close === 1);
    if (portalVisible) {
      const s = 1 - close * 0.96;
      ctx.save();
      enterGroup();
      ctx.translate(PORTAL.cx, PORTAL.cy);
      ctx.scale(s, s);
      ctx.translate(-PORTAL.cx, -PORTAL.cy);
      // 안쪽 어둠
      const depthA = ease((t - 6.55) / 0.4);
      if (depthA > 0 && img("portal-depth")) {
        ctx.globalAlpha = depthA;
        ctx.drawImage(img("portal-depth"), PORTAL_RECT.x, PORTAL_RECT.y, PORTAL_RECT.w, PORTAL_RECT.h);
        ctx.globalAlpha = 1;
      }
      // 링 — 입장 전에는 뒤선, 입장 뒤에는 전경 rim 으로 **교대**한다.
      // 같은 그림 한 장이라 두 겹으로 겹쳐 밝아지지 않는다(원본 의도).
      if (t < 7 && img("portal-ring")) {
        drawRingProgress(draw);
      }
      ctx.restore();
    }

    // --- 캐릭터 ---------------------------------------------------------
    const side = ease((t - 3.45) / 0.4);
    const back = ease((t - 3.85) / 0.45);
    const profile = side * (1 - back);
    const armTurn = ease((t - 3.85) / 0.36);
    const rearView = back >= 0.5;
    const stepping = (t > 1.6 && t < 3.8) || (t >= 7 && t < 8.25);
    const turning = t >= 3.65 && t < 7;
    const fi = frameIndex(t, stepping, turning);
    const pad2 = (n) => String(n).padStart(2, "0");

    let armAngle = -35 * side - 70 * armTurn;
    if (t >= 4.3 && t < 7) {
      const a = draw * 2 * Math.PI;
      const target = [PORTAL.cx + PORTAL.rx * Math.cos(a), PORTAL.cy + PORTAL.ry * Math.sin(a)];
      const shoulder = [x + 36, y + 106];
      const aim = (Math.atan2(target[1] - shoulder[1], -(target[0] - shoulder[0])) * 180) / Math.PI - 105;
      const drawing = ease((t - 4.3) / 0.18) * (1 - ease((t - 6.7) / 0.3));
      armAngle = mix(-105, aim, drawing);
    }

    // 앉은/올려보는 상태 — 일어서기 전.
    const sittingA = t < 0.15 ? 1 : 0;
    // [A-841 UI-16] 잔상 제거 — 앉은 포즈와 선 포즈가 같은 프레임에 5% 넘게 겹치지 않게 한다.
    // rise 창(0.55s)은 그대로, 알파만 어긋나게: 앉은 쪽은 rise 0..K 에서 사라지고 선 쪽은 K..1 에서 나타난다.
    // pre-A-841 baseline: lookingA = 1 - rise; 서 있는 몸 globalAlpha = rise
    const XFADE_K = 0.5;
    const lookingA = t >= 0.15 ? C(1 - rise / XFADE_K) : 0;
    const standA = C((rise - XFADE_K) / (1 - XFADE_K));
    const drawSeat = (name, alpha, dy = 0) => {
      const im = img(name);
      if (!im || alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      enterGroup();
      ctx.drawImage(im, SEAT_RECT.x, SEAT_RECT.y + dy, SEAT_RECT.w, SEAT_RECT.h);
      ctx.restore();
    };
    drawSeat("seat-idle", sittingA);

    // work? 는 준비 반응이다 — 눈 단계만 바뀌고 출발하지 않는다.
    let lookName = "seat-lookup";
    if (mode === "work") {
      lookName = "work-open"; // [A-735] 3.6s 깜박임 루프 제거 — 확정 cue 는 놀란 눈 한 박자 뒤 홀드(원본 preview 도 work-open 고정)
    } else if (mode === "send" && elapsed < 0.5) {
      lookName = "work-open";
    }
    const hop = mode === "send" && elapsed < 0.5 ? -9 * Math.sin(Math.PI * C(elapsed / 0.5)) : 0;
    const perk = mode === "work" ? -4 * Math.sin(Math.PI * C(elapsed / 0.55)) : 0;
    const sulkyC = mode === "work" && face === "sulky" && img("seat-sulky-c");
    if (!sulkyC || faceMix < 1) drawSeat(lookName, lookingA, hop + perk); // during the swap the old picture stays solid under the fading-in one (no see-through grey)
    if (sulkyC) drawSulkyC(lookingA * faceMix, hop + perk);

    // 서 있는 몸 — rise 로 나타난다.
    // sceneTime >= 7 이면 원본처럼 entryDepthMask 로 가린다. 그 구간에서는 별도 층에
    // 그린 뒤 `destination-in` 으로 마스크를 먹이고 본 화면에 얹는다.
    const masked = t >= 7 && img("entry-mask");
    // [A-841 UI-16] 일어서는 동안(standA<1)에도 별도 층에 불투명으로 그린 뒤 한 번에 알파를 건다.
    // 파츠마다 globalAlpha 를 덮어쓰던 것이 잔상(서 있는 몸이 앉은 포즈 위에 100% 로 얹힘)의 원인이었다.
    const useLayer = masked || (standA > 0 && standA < 1);
    const target = useLayer ? layerCtx0() : ctx;
    if (standA > 0) {
      const ctxSave = ctx;
      ctx = target;
      ctx.save();
      ctx.globalAlpha = 1;
      withStanding(x, y + 14 * (1 - rise), () => {
        // z 순서 — 원본 문서 순서 그대로
        part("ears_R", { tx: -230 * profile, visible: !(rearView || side > 0.95) });
        part(`walk-legR-${pad2(fi)}`);
        part(`walk-legL-${pad2(fi)}`);
        part(`walk-handR-${pad2(fi)}`, { tx: -430 * back });
        part("rear_ears", { visible: rearView });
        part("body");
        // 얼굴 — mask 안으로 가린다(원본 face-depth-occlusion).
        drawFace(side, back);
        part("group8", { tx: 150 * side + 130 * back, ty: 35 * back, visible: !rearView });
        // 그리는 팔 — 같은 holding 팔이 끝까지 앞에 남는다.
        const hx = 100 * side + 420 * armTurn;
        part(`walk-v6-${pad2(fi)}`, { tx: hx, rot: armAngle, pivot: [300, 530] });
        part(`walk-v7-${pad2(fi)}`, { tx: hx, rot: armAngle, pivot: [300, 530] });
      });
      ctx.restore();
      ctx = ctxSave;
      if (useLayer) {
       if (masked) {
        // 마스크 적용 — 흰 영역만 남는다.
        // 원본은 `#piggyClip` 에 mask 를 건다 — 그 요소는 group 안이므로
        // mask 의 userSpace 도 **group 좌표계**다. stage 에 걸면 경계가 어긋난다.
        layerCtx.save();
        layerCtx.globalCompositeOperation = "destination-in";
        const keep = ctx;
        ctx = layerCtx;
        enterGroup();
        ctx = keep;
        layerCtx.drawImage(img("entry-mask"), 0, 0, STAGE_W, STAGE_H);
        layerCtx.restore();
       }
        ctx.save();
        ctx.globalAlpha = standA;
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      }
    }

    // 입장 — 전경 rim 하나만. 뒤선은 이미 꺼졌다.
    if (t >= 7 && close < 1 && img("portal-ring")) {
      const s = 1 - close * 0.96;
      ctx.save();
      enterGroup();
      ctx.translate(PORTAL.cx, PORTAL.cy);
      ctx.scale(s, s);
      ctx.translate(-PORTAL.cx, -PORTAL.cy);
      ctx.drawImage(img("portal-ring"), PORTAL_RECT.x, PORTAL_RECT.y, PORTAL_RECT.w, PORTAL_RECT.h);
      ctx.restore();
    }

    if (cue) {
      if (face === "sulky" && !cue.surprised && !img("seat-sulky-c")) drawSulkyFace();
      if (cue.surprised) {
        const sv = WORK_SURPRISED;
        ctx.save();
        ctx.scale(sx(), sx());
        ctx.fillStyle = "#000";
        ctx.fillRect(...sv.cover);
        ctx.fillStyle = "#fff";
        for (const eye of sv.eyes) {
          ctx.save();
          ctx.translate(eye.targetCenter[0], eye.targetCenter[1]);
          ctx.scale(sv.seat.width / sv.viewbox.width, sv.seat.height / sv.viewbox.height);
          ctx.translate(-eye.sourceCenter[0], -eye.sourceCenter[1]);
          ctx.fill(new Path2D(eye.d));
          ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    return {
      elapsed: e, source, sceneTime: t,
      rise, travel, draw, enter, close, side, back, profile, armAngle,
      frame: fi, rearView,
      portalPhase: t < 4.3 ? "none" : t < 7 ? "line" : close < 1 ? "rim" : "closed",
      awayOpacity: ease((t - 9.15) / 0.4),
      done: e >= DEPART_TOTAL_S,
    };
  }

  // 그리는 진행 — 원본은 stroke-dashoffset 으로 길이를 드러낸다.
  // PNG 한 장이라 같은 각도 매개변수로 부채꼴 clip 을 쓸어 같은 진행을 만든다.
  function drawRingProgress(draw) {
    const im = img("portal-ring");
    if (!im) return;
    if (draw >= 1) {
      ctx.drawImage(im, PORTAL_RECT.x, PORTAL_RECT.y, PORTAL_RECT.w, PORTAL_RECT.h);
      return;
    }
    if (draw <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(PORTAL.cx, PORTAL.cy);
    const steps = Math.max(2, Math.ceil(draw * 96));
    for (let k = 0; k <= steps; k += 1) {
      const a = draw * 2 * Math.PI * (k / steps);
      ctx.lineTo(PORTAL.cx + (PORTAL.rx + PORTAL_PAD) * 1.6 * Math.cos(a),
                 PORTAL.cy + (PORTAL.ry + PORTAL_PAD) * 1.6 * Math.sin(a));
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(im, PORTAL_RECT.x, PORTAL_RECT.y, PORTAL_RECT.w, PORTAL_RECT.h);
    ctx.restore();
  }

  // 얼굴 — 눈/입이 옆으로 밀리고, 창(face-mask) 밖은 가린다.
  function drawFace(side, back) {
    const faceShift = side * 70 + back * 440;
    ctx.save();
    // 원본 #turn-face-window — standing 지역 좌표의 타원 clip.
    // 얼굴이 옆으로 밀리면 이 창 밖으로 나가 사라진다. clip 은 밀기 **전** 좌표에 건다.
    ctx.beginPath();
    ctx.ellipse(FACE_WINDOW.cx, FACE_WINDOW.cy, FACE_WINDOW.rx, FACE_WINDOW.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(faceShift, 0);
    part("eye_L", { alpha: 1 - side });
    part("eye_R");
    part("mouth_smile", { tx: 130 * side * (1 - back) });
    part("mouth_strait");
    ctx.restore();
  }

  return { drawAt, setFace, totalSeconds: DEPART_TOTAL_S };
}

export const DEPART_GEOMETRY = {
  stage: [STAGE_W, STAGE_H],
  board: [BOARD_W, BOARD_H],
  stageFit: 1,   // [A-318] 추가 fit 없음 — layer viewBox 가 곧 board
  piggyLocal: PM,
  paddedBox: PM_BOX,
  standing: STANDING,
  portal: PORTAL,
  portalRect: PORTAL_RECT,
  seatRect: SEAT_RECT,
  group: { scale: GROUP_SCALE, dx: GROUP_DX, dy: GROUP_DY, homeSeat: HOME_SEAT },
  totalSeconds: DEPART_TOTAL_S,
  frames: FRAMES,
  frameGroups: FRAME_GROUPS,
  staticParts: STATIC_PARTS,
  stateImages: STATE_IMAGES,
  overlays: OVERLAYS,
};

// --- 실제 재생 lifecycle ------------------------------------------------
// [A-318 교정 5] 앱(`mountAway`)과 검토 하네스가 **같은 이 함수**를 쓴다.
// 하네스가 따로 쓴 token 모형으로 가드를 통과시키지 않는다 — 통과해야 할 코드가 이것이다.
// 주입점: 자산 promise(`loadAssets`) · RAF(`schedule`) · 유효 token(`isValid`) · `reduced`.
// 이 함수는 돈에 대해 아무것도 모른다. 완료는 「애니메이션이 끝났다」일 뿐이다.
export function createDepartPlayback(opts) {
  const {
    canvas,
    loadAssets = loadDepartAssets,
    makeRenderer = createDepartRenderer,
    isValid = () => true,
    schedule,
    reduced = false,
    total = DEPART_TOTAL_S,
    onStatus = () => {},
  } = opts;

  let renderer = null;
  let stopped = false;
  let elapsed = 0;
  let last = 0;
  let drawCount = 0;
  let frameRequested = false;
  let phase = "idle";
  let error = null;
  let missingList = [];
  let completed = false;

  const alive = () => !stopped && isValid();
  const status = () => ({
    phase, elapsed, drawCount, completed,
    missing: missingList.slice(), error: error ? String(error && error.message || error) : null,
  });
  const settle = (next) => { phase = next; onStatus(status()); return status(); };
  // [A-320 교정 14] 이미 무효가 된 재생은 **바깥에 알리지 않는다** — 늦게 온 결과가
  // 새 씬의 onStatus 를 부르면 지난 씬의 사실이 지금 화면으로 샌다.
  // stop() 으로 끝났으면 그 라벨을 유지한다(늦은 reject 가 stopped 를 덮지 않는다).
  const quiet = (next) => { if (phase !== "stopped") phase = next; return status(); };

  // 마지막 시각을 다시 그린다. canvas 크기를 대입하면 내용이 지워지므로
  // resize 뒤에는 반드시 이것을 부른다(중간프레임·완료·reduced 모두). [A-318 교정 7]
  function redraw() {
    if (!renderer || !alive()) return false;
    renderer.drawAt(elapsed);
    drawCount += 1;
    return true;
  }

  function step(now) {
    if (!alive()) { frameRequested = false; return false; }
    const dt = last ? Math.min(now - last, 80) : 0;
    last = now;
    elapsed = Math.min(total, elapsed + dt / 1000);
    renderer.drawAt(elapsed);
    drawCount += 1;
    if (elapsed >= total) {
      frameRequested = false;
      completed = true;
      settle("complete");   // 상태를 바꾸지 않는다 — 실제 결과는 바깥이 정한다
      return false;
    }
    return true;
  }

  function start() {
    if (stopped) return Promise.resolve(status());
    settle("loading");
    return Promise.resolve()
      .then(() => loadAssets())
      .then((res) => {
        const images = res && res.images;
        missingList = (res && res.missing) || [];
        // 늦게 도착한 자산이 다른 씬에 그리지 않는다.
        // stop() 으로 끝난 경우엔 그 사실을 유지한다(늦게 온 자산이 라벨을 덮지 않는다).
        if (!alive()) return quiet(stopped ? "stopped" : "abandoned");
        // 깨진 파츠로 계속 재생하지 않는다. 이번 모션만 접고 Away 상태·Chog 는 그대로 둔다.
        if (!images || missingList.length) return settle("asset-missing");
        renderer = makeRenderer(canvas, { images });
        if (reduced) { elapsed = total; redraw(); completed = true; return settle("reduced-final"); }
        elapsed = 0; last = 0;
        frameRequested = true;
        settle("playing");
        schedule(step);
        return status();
      })
      .catch((err) => {
        error = err;
        renderer = null;
        // 늦은 reject 도 같다 — 무효면 조용히 접는다.
        if (!alive()) return quiet(stopped ? "stopped" : "abandoned");
        return settle("asset-error");
      });
  }

  function stop() {
    stopped = true;
    frameRequested = false;
    renderer = null;
    if (phase !== "complete") phase = "stopped";
    return status();
  }

  return { start, stop, redraw, status, get phase() { return phase; } };
}
