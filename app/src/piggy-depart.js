// Send/Away 출발 — yay → 돈 챙김 → 걷기 → 옆멈춤 → 뒤돌기 → 문 그리기 → 입장 → Away
//
// 수식·시간·좌표는 전부 확정 보관본
// `<private>`
// 것이다. 여기서 새로 설계하지 않는다.
// 그림은 `<private>` 가 구운 2x 래스터다(로컬 사본).
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
  function drawAt(elapsed) {
    const e = Math.max(0, Math.min(DEPART_TOTAL_S, elapsed));
    const source = mode === "send" ? sendSourceOf(e) : e;
    const t = sceneTimeOf(source);

    ctx = mainCtx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
    const lookingA = t >= 0.15 ? 1 - rise : 0;
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
      const b = elapsed % 3.6;
      let stage = "open";
      for (const start of [1.65, 1.98]) {
        const d = b - start;
        if (d >= 0 && d < 0.18) stage = d < 0.035 || d > 0.145 ? "half" : "shut";
      }
      lookName = `work-${stage}`;
    } else if (mode === "send" && elapsed < 0.5) {
      lookName = "work-open";
    }
    const hop = mode === "send" && elapsed < 0.5 ? -9 * Math.sin(Math.PI * C(elapsed / 0.5)) : 0;
    const perk = mode === "work" ? -4 * Math.sin(Math.PI * C(elapsed / 0.55)) : 0;
    drawSeat(lookName, lookingA, hop + perk);

    // 서 있는 몸 — rise 로 나타난다.
    // sceneTime >= 7 이면 원본처럼 entryDepthMask 로 가린다. 그 구간에서는 별도 층에
    // 그린 뒤 `destination-in` 으로 마스크를 먹이고 본 화면에 얹는다.
    const masked = t >= 7 && img("entry-mask");
    const target = masked ? layerCtx0() : ctx;
    if (rise > 0) {
      const ctxSave = ctx;
      ctx = target;
      ctx.save();
      ctx.globalAlpha = rise;
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
        ctx.drawImage(layer, 0, 0);
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

  return { drawAt, totalSeconds: DEPART_TOTAL_S };
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
