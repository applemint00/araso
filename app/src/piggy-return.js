// 귀환 — 알람 → 포털 → Piggy 등장 → 정면 hold → toss → Receipt 두 번 탭 →
// 집으로 → Chog 수령 → 파일 정리. 승인 원본:
//   <private>
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
function anchorCenter(canvas) {
  const s = (canvas && (canvas.clientWidth || canvas.width)) / BOARD_W || 1;
  const cx = BOARD_W / 2 - 32 / s;
  const cy = BOARD_H / 2 - 48 / s;
  // GROUP 변환의 역함수로 이 board 중심을 "엔터그룹 이전" 무대 좌표로 되돌린다.
  const zx = (cx - GROUP_DX) / GROUP_SCALE;
  const zy = (cy - GROUP_DY) / GROUP_SCALE;
  // delivery=1 시점 종이 크기(무대 단위, 아래 rw/rh 식의 델리버리 종착 크기 280×320
  // 그대로) 절반만큼 확대 중심에서 물러난 자리를 도착 목표로 둔다 — 그래야 확대 pivot
  // 과 종이 중심이 같아, zoom 이 1→1.18 로 커지는 동안에도 화면 위치가 안 흔들린다.
  return { cx, cy, zx, zy, tx: zx - 280 / 2, ty: zy - 320 / 2 };
}

// 앉은 Piggy — 원본 Return 은 218×218 정사각이지만 캐릭터 원본 비율은 1056×1102.
// Home 과 같은 비율을 쓴다(무단 squash 0). 차이는 parts.json 에도 남겼다.
const SEAT_RECT = { x: 862, y: 515, w: 218, h: 218 * 1102 / 1056 };

// 굽힌 배열의 공통 상자(= A320_export.py 가 parts.json 에 적은 origin)
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
const NATIVE_OY = HOME_CHOG.floorY - NATIVE_INK.y1 * NATIVE_K;
// 원본의 frame24 이동량(무대 −41, −8)은 같은 무대 배율로 board 에 옮긴다.
const NATIVE_STEP_DX = -41 * GROUP_SCALE;
const NATIVE_STEP_DY = -8 * GROUP_SCALE;

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
  await Promise.all(LOAD.map((name) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => { images.set(name, im); resolve(); };
    im.onerror = () => { missing.push(name); resolve(); };
    im.src = `${DIR}/${name}.png`;
  })));
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
   * @param {{hidePaper?:boolean}} renderOpts
   *   [A-348 §3] gate 대기(await-first-tap/await-second-tap) 구간에서는 controller 가
   *   `hidePaper:true` 를 넘긴다 — canvas 는 그 프레임에 옛 receipt-paper 를 그리지 않고
   *   DOM(receiptPaperMarkup)에 자리를 **명시적으로** 넘긴다. paperBoard 좌표 계산은
   *   그대로 돌아간다(DOM 이 같은 자리에 앉으려면 필요) — 실제 drawImage 한 줄만 건너뛴다.
   *   단순히 DOM 을 canvas 위에 얹어 "덮었으니 중복 0" 이라 선언하지 않기 위한 장치다.
   */
  function drawAt(time, renderOpts = {}) {
    const { hidePaper = false } = renderOpts;
    const t = Math.max(0, Math.min(RETURN_TOTAL_S, time));
    const s = stateAt(t);
    const { opening, emerge, turn, present, delivery, settle } = s;
    const close = 1 - smooth((t - 5.5) / 0.55);
    const scale = opening * close;

    ctx = main;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // [A-359 §2] 이 프레임의 공통 카드 자리 — 매번 실제 canvas CSS 폭으로 다시 잰다
    // (뷰포트가 바뀌면 board 축척도 바뀐다, 위 anchorCenter() 주석).
    const anchor = anchorCenter(canvas);

    let x = mix(210, 520, emerge), y = 250;
    x = mix(x, 880, settle); y = mix(y, 508, settle);
    const size = mix(0.24, 0.20, settle);

    const moving = (t >= 3.15 && t < 5.25) || (t >= 8.85 && t < 10.9);
    const frame = moving
      ? (t >= 8.85 ? (31 + Math.floor((t - 8.85) * 1000 / 30)) % 48 : Math.floor(t * 1000 / 30) % 48)
      : 31;

    const pickup = smooth((t - 8.5) / 0.35);
    const handoff = smooth((t - 11.4) / 0.6);
    const carryHome = t >= 8.85 && t < 10.9;
    const seated = smooth((t - 10.9) / 0.5);
    const folderAlpha = smooth((t - 12.2) / 0.25);
    const zoom = 1 + 0.18 * smooth((t - 7.3) / 0.3) * (1 - pickup);
    const sitDrop = 6 * Math.sin(Math.PI * clamp((t - 10.9) / 0.5));

    // 영수증 자리 — 던짐 궤적 식(시작점·타이밍)은 원본 그대로다. 종착점만 [A-358 §4 →
    // A-359 §2] anchor.tx/ty(공통 카드 자리 역변환, 뷰포트 실측 기준)로 바꿨다 — 옛
    // 220/165 임의 숫자를 없앤다.
    let rx = mix(x + size * (300 + 1.12 * (480 - 300) - 40 - 80), anchor.tx, delivery);
    let ry = mix(y + size * (530 + 1.12 * (620 - 530) - 55), anchor.ty, delivery)
      - 110 * 4 * delivery * (1 - delivery);
    let rw = mix(size * 280 * 1.12, 280, delivery);
    let rh = mix(size * 225 * 1.12, 320, delivery);
    if (t >= 8.5 && t < 10.9) {
      rx = mix(anchor.tx, x + size * 480, pickup);
      ry = mix(anchor.ty, y + size * 620, pickup);
      rw = mix(280, size * 280, pickup);
      rh = mix(320, size * 225, pickup);
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

    // ③ 폴더 뒤 → 영수증 → 폴더 앞. 원본 z 순서 그대로.
    const folderRect = [580, 626, 130, 100];
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
    if (t >= 11.4) {
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
      // 화면이 소유권을 가릴 수 있도록 매 프레임 알려 준다. [A-322 교정 1]
      // t<11.4 = Home DOM Chog 만 · t>=11.4 = canvas native Chog 만.
      chogOwner: t >= 11.4 ? "canvas" : "dom",
      // [A-348 §3] 이번 프레임에 종이를 실제로 그렸는지 — hidePaper 로 건너뛴 프레임은
      // "dom"(그 자리는 DOM 이 그린다), 그렸으면 "canvas". 아무 것도 안 그렸으면 null.
      // t>=11.4 && t<14 는 위 ④ nativePaper 후처리가 그리므로 여기서도 "canvas" 다.
      paperOwner: paperVisible ? (hidePaper ? "dom" : "canvas")
        : (t >= 11.4 && t < 14 ? "canvas" : null),
      x, y, size, frame, pickup, handoff, seated, folderAlpha, zoom, sitDrop,
      receipt: { x: rx, y: ry, w: rw, h: rh },
      hand,
      alertHop: t >= 0.7 && t < 2.8 ? -5 * Math.sin(Math.PI * clamp((t - 0.7) / 0.55)) : 0,
      nativeVisible: t >= 11.4,
      done: t >= RETURN_TOTAL_S,
    };
  }

  return { drawAt, totalSeconds: RETURN_TOTAL_S };
}

export const RETURN_GEOMETRY = {
  board: [BOARD_W, BOARD_H], stage: [STAGE_W, STAGE_H],
  group: { scale: GROUP_SCALE, dx: GROUP_DX, dy: GROUP_DY },
  seatRect: SEAT_RECT,
  nativeBridge: { k: NATIVE_K, ox: NATIVE_OX, oy: NATIVE_OY, stepDx: NATIVE_STEP_DX, stepDy: NATIVE_STEP_DY, homeChog: HOME_CHOG, ink: NATIVE_INK },
  gates: { receipt: RECEIPT_GATE_S, zoomDone: ZOOM_DONE_S, pickup: PICKUP_S, total: RETURN_TOTAL_S },
  loaded: LOAD.length,
  notLoaded: ["chog-rest"],
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

  function paint() {
    if (!renderer || !alive()) return false;
    onFrame(renderer.drawAt(t, { hidePaper: isDomPaperPhase(phase) }));
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
    onFrame(renderer.drawAt(t, { hidePaper: isDomPaperPhase(phase) }));
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

  return { start, stop, tap, redraw: paint, status, get phase() { return phase; } };
}
