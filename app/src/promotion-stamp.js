// [A-897 P2] 승격 장면(우표) — Owner 2026-10-08 (gift_card_20261004/README.md "승격 장면(우표)", 시안 stamp_alpha_mock_v2.png B 채택).
//
// 이 파일은 **장면만** 그린다. 언제 부르는가(승격 분기 판정 · once 보장 · Gift claim 결과)는 P1/main.js 몫이다.
// P1 은 main.js 의 `playPromotionStampScene({ onDone })` 한 줄만 부르면 된다 — 그 함수가 이 모듈의
// mountPromotionStamp() 를 body 위 오버레이로 붙인다(render()/씬 전환과 독립 · 끝나면 스스로 사라진다).
//
// 타임라인(약 2 s · 새 낱말은 "alpha!" 하나뿐):
//   0 ─ 260   빈 우표 테두리(`/invite/stamp_empty@2x.png`)가 찍히듯 자리잡는다(1.08 → 1, 불투명 0 → 1)
//   420       눈 파츠만 > / < 로 교체(eye-left/eye-right → *-squint) — 새 표정·머리 교체 0
//   520─1420  팔이 몸에서 안 떨어진 채 살짝 흔든다(시안 ≈14°, 기존 arm 파츠 + 같은 어깨 pivot)
//   760─1160  노랑 손글씨 "alpha!" 가 **우표 밖 오른쪽 옆**에 써진다(초그가 말하듯 · 테이프 0 · 반짝이 0)
//   1560─2000 페이지 넘김(왼쪽 가장자리를 축으로 넘어간다) → 같은 Piggy 가 있는 화면
// reduced-motion: 움직임 없이 완성 장면만 잠깐 보였다가 끝낸다(상태는 바뀌고 모션만 뺀다).
//
// 순수 부분(promotionStampFrame)은 DOM 없이 노드 테스트가 읽는다.

import { chogInviteMarkup, mountChogInvite, CHOG_INVITE_GEOMETRY } from "./chog-invite.js";

export const PROMOTION_STAMP_TEXT = "alpha!"; // Owner 확정 유일한 새 문구
export const PROMOTION_STAMP_TIMELINE = Object.freeze({
  totalMs: 2000,
  pressMs: 260,
  squintAtMs: 420,
  waveFromMs: 520,
  waveToMs: 1420,
  alphaFromMs: 760,
  alphaToMs: 1160,
  turnFromMs: 1560,
  reducedHoldMs: 900,
});
export const PROMOTION_STAMP_ARM_MAX_DEG = 14; // 시안 ≈14°
// 승인 idle 의 arm 이 쓰는 방향(−)을 그대로 쓴다 — 올라가는 쪽.
const ARM_KEYS = [[520, 0], [700, -14], [880, -4], [1060, -14], [1240, -4], [1420, 0]];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
function between(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      return a[1] + (b[1] - a[1]) * ease((t - a[0]) / (b[0] - a[0]));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * 시각 ms 에서의 장면 상태. 순수.
 * @returns {{ stampScale:number, stampOpacity:number, squint:boolean, armDeg:number, alphaReveal:number, turn:number, done:boolean }}
 */
export function promotionStampFrame(ms, { reduced = false } = {}) {
  const T = PROMOTION_STAMP_TIMELINE;
  if (reduced) {
    return { stampScale: 1, stampOpacity: 1, squint: true, armDeg: 0, alphaReveal: 1, turn: 0, done: ms >= T.reducedHoldMs };
  }
  const t = Math.max(0, ms);
  const press = ease(t / T.pressMs);
  return {
    stampScale: 1.08 - 0.08 * press,
    stampOpacity: press,
    squint: t >= T.squintAtMs,
    armDeg: between(t, ARM_KEYS),
    alphaReveal: ease((t - T.alphaFromMs) / (T.alphaToMs - T.alphaFromMs)),
    turn: ease((t - T.turnFromMs) / (T.totalMs - T.turnFromMs)),
    done: t >= T.totalMs,
  };
}

export function promotionStampMarkup() {
  // 큰 쪽(126×134, `invite/wide/`)을 모든 폭에 쓴다 — 모바일 90×96 은 폰에서 6.8배 확대돼 흐렸다(M2). 같은 틀 · 안쪽만 비웠다.
  return `
    <div class="promotionStamp" data-promotion-stamp role="img" aria-label="${PROMOTION_STAMP_TEXT}">
      <div class="promotionStamp__page" data-ps-page>
        <div class="promotionStamp__group">
          <div class="promotionStamp__stamp" data-ps-stamp>
            <img class="promotionStamp__frame" src="/invite/wide/stamp_empty@2x.png" alt="" draggable="false" />
            <div class="promotionStamp__chog">${chogInviteMarkup()}</div>
          </div>
          <span class="promotionStamp__alpha" data-ps-alpha aria-hidden="true">${PROMOTION_STAMP_TEXT}</span>
        </div>
      </div>
    </div>
  `;
}

const SQUINT = { "eye-left": "/motion/chog-invite/eye-left-squint.png", "eye-right": "/motion/chog-invite/eye-right-squint.png" };

/**
 * 오버레이 root(`.promotionStamp`)에 장면을 건다.
 * @param {HTMLElement} root  promotionStampMarkup() 이 만든 `.promotionStamp` (이미 DOM 에 있어야 한다)
 * @param {object} opts { reduced, raf, caf, onDone }  raf/caf 는 테스트가 갈아끼운다.
 * @returns {{ destroy():void, frameAt(ms):object, get finished():boolean }}
 */
export function mountPromotionStamp(root, opts = {}) {
  const {
    reduced = false,
    raf = (fn) => requestAnimationFrame(fn),
    caf = (h) => cancelAnimationFrame(h),
    onDone,
  } = opts;
  const page = root.querySelector("[data-ps-page]");
  const stamp = root.querySelector("[data-ps-stamp]");
  const alpha = root.querySelector("[data-ps-alpha]");
  const chogRoot = root.querySelector("[data-chog-invite]");
  const arm = chogRoot?.querySelector('[data-part="arm"]') || null;
  const eyes = {
    "eye-left": chogRoot?.querySelector('[data-part="eye-left"]') || null,
    "eye-right": chogRoot?.querySelector('[data-part="eye-right"]') || null,
  };
  // 눈 교체 그림을 미리 받아 둔다 — 교체 순간에 빈 칸이 보이지 않게.
  for (const src of Object.values(SQUINT)) {
    try {
      const im = new Image();
      im.src = src;
    } catch {
      // 최선 노력
    }
  }
  // 승인 Chog 를 붙이되 **idle 루프는 돌리지 않는다**(onFrame 없음) — 팔·눈을 이 장면이 직접 정한다.
  // (idle 은 매 프레임 arm/eye transform 을 덮어써서 시안 14° 를 지킬 수 없다.)
  const chog = chogRoot ? mountChogInvite(chogRoot, { reduced: true }) : null;

  const VBW = CHOG_INVITE_GEOMETRY.paddedViewBox.vbw;
  const [shx, shy] = CHOG_INVITE_GEOMETRY.shoulderTranslate;
  let squintApplied = false;
  let destroyed = false;
  let finished = false;
  let handle = 0;
  let t0 = null;

  function paint(ms) {
    const f = promotionStampFrame(ms, { reduced });
    if (stamp) {
      stamp.style.opacity = String(f.stampOpacity);
      stamp.style.transform = f.stampScale === 1 ? "" : `scale(${f.stampScale})`;
    }
    if (f.squint && !squintApplied) {
      squintApplied = true;
      for (const [key, el] of Object.entries(eyes)) if (el) el.setAttribute("src", SQUINT[key]);
      root.setAttribute("data-squint", "1");
    }
    if (arm) {
      // 어깨 translate 는 원본 idle 과 같다(래스터에 굽지 않았다) — 몸에서 안 떨어지는 이유.
      const k = (chogRoot.offsetWidth || 0) / VBW;
      arm.style.transform = `translate(${shx * k}px, ${shy * k}px) rotate(${f.armDeg}deg)`;
    }
    if (alpha) alpha.style.clipPath = f.alphaReveal >= 1 ? "none" : `inset(0 ${(1 - f.alphaReveal) * 100}% 0 0)`;
    if (alpha) alpha.style.opacity = f.alphaReveal > 0 ? "1" : "0";
    if (page) {
      // 오른쪽 가장자리가 화면 안쪽으로 멀어지게(+) 돌고, 원근은 폭에 비례 — 어느 폭에서도 같은 모양(B2)
      const persp = Math.max(1200, 3 * (page.offsetWidth || 0));
      page.style.transform = f.turn > 0 ? `perspective(${persp}px) rotateY(${100 * f.turn}deg)` : "";
      page.style.opacity = f.turn > 0 ? String(1 - 0.6 * f.turn) : "";
    }
    return f;
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (handle) caf(handle);
    handle = 0;
    try {
      onDone?.();
    } catch {
      // onDone 실패가 장면 정리를 막지 않는다
    }
  }

  function tick(ts) {
    if (destroyed || finished) return;
    if (t0 === null) t0 = ts;
    const f = paint(ts - t0);
    if (f.done) {
      finish();
      return;
    }
    handle = raf(tick);
  }

  if (reduced) {
    paint(0);
    // 완성 장면을 잠깐 보인 뒤 끝낸다 — 시계는 호출자(main.js)의 setTimeout 이 아니라 여기 raf 시계.
    handle = raf(function hold(ts) {
      if (destroyed || finished) return;
      if (t0 === null) t0 = ts;
      if (ts - t0 >= PROMOTION_STAMP_TIMELINE.reducedHoldMs) {
        finish();
        return;
      }
      handle = raf(hold);
    });
  } else {
    paint(0);
    handle = raf(tick);
  }

  return {
    frameAt: (ms) => paint(ms),
    get finished() {
      return finished;
    },
    chog,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (handle) caf(handle);
      handle = 0;
    },
  };
}
