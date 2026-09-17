// Invite Chog — 눈 깜박임 · 손 흔들기 · 해치 올려보기/뒷걸음 (A-312)
//
// 그림과 수식은 확정 보관본 `connected/invite-chog.js` 것이다.
//   svgMarkup            — 그림 원본 (여기서는 그 파츠를 구운 래스터를 쓴다)
//   sample(ms)           — 10000ms idle 주기: blink · wave
//   reaction(ms)         — 해치 반응: 올려보기 + 뒷걸음
//   character-hooks.js   — actor 레벨 보정(두 레벨 합성이 원본이다)
// 파츠는 `<private>` 가 구운 2x 래스터(로컬 사본).
//
// 원본은 변환을 **두 레벨**로 나눠 준다. 한 레벨로 뭉치면 단위가 섞인다:
//   svg 레벨   : px  — `translate(-10*step px, -3*amount px)`
//   headRig    : user — `rotate(-8*amount, 1040, 1180)`
//   eyes       : user — `translate(24*amount, -48*amount)`
//   arm        : user — `translate(-45,-55) rotate(wave|-18*amount, 1380, 1240)`
//   actor 레벨 : px  — origin 50% 95%, `translate(-14*step px, -3*amount px) rotate(-2*amount)`

const DIR = "/motion/chog-invite";

// 원본 svgMarkup 의 viewBox 와 export 가 넓힌 padding.
const VB = { x: 350, y: 145, w: 1380, h: 1780 };
const PAD = { l: 200, t: 200, r: 200, b: 160 };
const BOX = {
  vbx: VB.x - PAD.l,
  vby: VB.y - PAD.t,
  vbw: VB.w + PAD.l + PAD.r,
  vbh: VB.h + PAD.t + PAD.b,
};

// 승인 wide 앵커 — `connected/index.html` 의 `#bhv` (1280×800 판 기준).
export const INVITE_ANCHOR_WIDE = { left: 321.7, top: 496.9, width: 107.6, height: 139.9 };

// 파츠 z 순서 — 원본 mount() 가 headRig 를 root 마지막에 붙인다.
const PARTS = ["body", "arm", "head", "eye-left", "eye-right"];

const IDLE_PERIOD = 10000;
const BLINK_KEYS = [[2000, 1], [2070, 0.1], [2110, 0.1], [2190, 1]];
const WAVE_KEYS = [[5000, 0], [5350, -24], [5550, -12], [5770, -27], [5960, -14], [6320, 0]];
const UP_KEYS = [[0, 0], [150, 1], [580, 1], [1350, 0]];
const BACK_KEYS = [[0, 0], [180, 0.2], [600, 1], [1050, 1], [1500, 0]];
// 해치 시계에서 반응이 도는 창 — `character-hooks.js` 의 `hatchTime - 2900`, 0 ≤ t < 1500.
export const REACTION_OFFSET_MS = 2900;
export const REACTION_WINDOW_MS = 1500;

const ease = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

// 원본 `between()` 그대로 — 구간 선형 + smoothstep.
function between(t, keys) {
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      return a[1] + (b[1] - a[1]) * ease((t - a[0]) / (b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}

// user 좌표 한 점을 PNG 안의 % 로 — transform-origin 에 쓴다.
function originPct(ux, uy) {
  return `${((ux - BOX.vbx) / BOX.vbw) * 100}% ${((uy - BOX.vby) / BOX.vbh) * 100}%`;
}

// 눈 중심 — 원본 `mount()` 가 `eye_L/eye_R` 의 `getBBox()` 중심을 잡아 blink 원점으로 쓴다.
// 아래는 같은 방식으로 원본 svgMarkup 을 붙여 실측한 값이다(추정 아님).
const EYE_CENTER = {
  "eye-left": { x: 1225.72, y: 845.49 },
  "eye-right": { x: 888.45, y: 899.35 },
};

export function chogInviteMarkup() {
  return `
    <div class="chogInvite" data-chog-invite>
      ${PARTS.map((p) => `<img class="chogInvite__part" data-part="${p}" src="${DIR}/${p}.png" alt="" />`).join("")}
    </div>
  `;
}

/**
 * Invite Chog 를 붙인다.
 * @param {HTMLElement} root  `chogInviteMarkup()` 이 만든 `.chogInvite`
 * @param {object} opts  { anchor, reduced, onFrame, onCleanup, listen }
 *   anchor  화면에 놓을 rect(부모 좌표계 px). 없으면 CSS 가 정한 자리를 쓴다.
 */
export function mountChogInvite(root, opts = {}) {
  const { anchor = null, reduced = false, onFrame, onCleanup, listen } = opts;
  const q = (n) => root.querySelector(`[data-part="${n}"]`);
  const body = q("body");
  const arm = q("arm");
  const head = q("head");
  const eyeL = q("eye-left");
  const eyeR = q("eye-right");
  const heads = [head, eyeL, eyeR]; // headRig 에 함께 들어가는 것들

  // 파츠는 모두 같은 상자다 — 앵커 하나로 다 덮는다.
  if (anchor) {
    Object.assign(root.style, {
      left: `${anchor.left - (PAD.l / VB.w) * anchor.width}px`,
      top: `${anchor.top - (PAD.t / VB.h) * anchor.height}px`,
      width: `${(BOX.vbw / VB.w) * anchor.width}px`,
      height: `${(BOX.vbh / VB.h) * anchor.height}px`,
    });
  }
  // user → 이 상자 안의 px. 원본이 user 단위로 주는 값을 여기서 환산한다.
  const uxPx = () => root.getBoundingClientRect().width / BOX.vbw;

  if (arm) arm.style.transformOrigin = originPct(1380, 1240);
  for (const el of heads) if (el) el.style.transformOrigin = originPct(1040, 1180);
  if (eyeL) eyeL.dataset.cx = EYE_CENTER["eye-left"].x;
  if (eyeR) eyeR.dataset.cx = EYE_CENTER["eye-right"].x;

  let destroyed = false;
  let elapsed = 0;
  let last = 0;
  let mode = "idle"; // idle | reaction
  let reactionMs = 0;

  function applyIdle(ms) {
    const t = reduced ? 0 : Math.max(0, ms) % IDLE_PERIOD;
    const blink = t >= 2000 && t <= 2190 ? between(t, BLINK_KEYS) : 1;
    const wave = t >= 5000 && t <= 6320 ? between(t, WAVE_KEYS) : 0;
    root.style.transform = "";
    for (const el of heads) if (el) el.style.transform = "";
    // 눈은 자기 중심에서 세로로만 눌린다 — 원본 `scale(1, blink)`.
    for (const [el, key] of [[eyeL, "eye-left"], [eyeR, "eye-right"]]) {
      if (!el) continue;
      el.style.transformOrigin = originPct(EYE_CENTER[key].x, EYE_CENTER[key].y);
      el.style.transform = `scaleY(${blink})`;
    }
    // 어깨 `translate(-45 -55)` 는 원본이 매 프레임 같이 준다 — 래스터에 굽지 않았다.
    if (arm) {
      const k = uxPx();
      arm.style.transform = `translate(${-45 * k}px, ${-55 * k}px) rotate(${wave}deg)`;
    }
    return { time: t, blink, wave };
  }

  function applyReaction(ms) {
    const t = Math.max(0, ms);
    const up = between(t, UP_KEYS);
    const back = between(t, BACK_KEYS);
    const amount = reduced ? 0 : up;
    const step = reduced ? 0 : back;
    const k = uxPx();
    // svg 레벨(px) + actor 레벨(px) — 원본은 두 레벨이고 여기서 합쳐 적용한다.
    // 단위를 잃지 않도록 각 항을 그대로 더한다.
    root.style.transformOrigin = "50% 95%";
    root.style.transform =
      `translate(${-10 * step}px, ${-3 * amount}px)` +
      ` translate(${-14 * step}px, ${-3 * amount}px) rotate(${-2 * amount}deg)`;
    // headRig — 머리와 두 눈이 같이 돈다.
    for (const el of heads) {
      if (!el) continue;
      el.style.transformOrigin = originPct(1040, 1180);
      el.style.transform = `rotate(${-8 * amount}deg)`;
    }
    // 눈은 그 위에 시선 이동(user 단위)을 더 받는다.
    for (const el of [eyeL, eyeR]) {
      if (!el) continue;
      el.style.transform = `rotate(${-8 * amount}deg) translate(${24 * amount * k}px, ${-48 * amount * k}px)`;
    }
    if (arm) {
      arm.style.transform = `translate(${-45 * k}px, ${-55 * k}px) rotate(${-18 * amount}deg)`;
    }
    return { amount, step, gazeX: 24 * amount, gazeY: -48 * amount, headAngle: -8 * amount };
  }

  applyIdle(0);

  if (onFrame && !reduced) {
    onFrame((now) => {
      if (destroyed) return false;
      const dt = last && !document.hidden ? Math.min(now - last, 50) : 0;
      last = now;
      if (mode === "idle") {
        elapsed += dt;
        applyIdle(elapsed);
      }
      return true;
    });
  }
  if (listen) {
    listen(document, "visibilitychange", () => {
      last = 0;
    });
  }
  if (onCleanup) {
    onCleanup(() => {
      destroyed = true;
    });
  }

  return {
    /** 해치 시계 t(ms) 를 그대로 넘긴다 — 별도 wall clock 을 쓰지 않는다. */
    syncHatch(hatchMs) {
      if (destroyed) return null;
      const r = hatchMs - REACTION_OFFSET_MS;
      if (r >= 0 && r < REACTION_WINDOW_MS) {
        mode = "reaction";
        reactionMs = r;
        return applyReaction(r);
      }
      if (mode === "reaction") {
        mode = "idle";
        root.style.transform = "";
        root.style.transformOrigin = "";
        applyIdle(elapsed);
      }
      return null;
    },
    idleAt: applyIdle,
    reactionAt: applyReaction,
    get state() {
      return { mode, elapsed, reactionMs, destroyed };
    },
    destroy() {
      destroyed = true;
      root.remove();
    },
  };
}

export const CHOG_INVITE_GEOMETRY = {
  sourceViewBox: VB,
  paddedViewBox: BOX,
  padding: PAD,
  anchorWide: INVITE_ANCHOR_WIDE,
  zOrder: PARTS,
  eyeCenters: EYE_CENTER,
  headPivot: [1040, 1180],
  armPivot: [1380, 1240],
  shoulderTranslate: [-45, -55],
  idlePeriodMs: IDLE_PERIOD,
  blinkKeys: BLINK_KEYS,
  waveKeys: WAVE_KEYS,
  upKeys: UP_KEYS,
  backKeys: BACK_KEYS,
  reactionOffsetMs: REACTION_OFFSET_MS,
  reactionWindowMs: REACTION_WINDOW_MS,
};
