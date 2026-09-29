// Home Chog — 걷기 · idle · hover · 3분 졸기 (A-308)
//
// 그림과 수식은 전부 확정 보관본
// `<private>`
// 의 것이다. 여기서 새로 설계하지 않는다.
//   index.html #hoverStage/#cornerScene/#character  — 배치·파츠 z 순서
//   flow.js                                        — Name 출발 → Home 걷기
//   hover.js                                       — hover 수식 · 노트패드
//   sleep-motion.js                                — 180000ms 졸기 advance()
// 파츠는 `<private>` 가 구운 2x 래스터다(로컬 사본).
//
// 좌표는 **corner 로컬**로 다룬다. Home 판(1256×772)으로의 환산은 바깥 컨테이너의
// `translate(...) scale(homeScale)` 하나가 맡는다 — 그래서 여기 숫자는 원본과 같다.

const DIR = "/motion/chog-home";

// --- 확정 좌표 (A-308 계약 2·4) ----------------------------------------
export const HOME_SCALE = (150 * 550 / 528 * 0.757) / 251; // .4712400398
export const CORNER_TX = 891 - 449.5 * HOME_SCALE;
export const CORNER_TY = 648 - 527 * HOME_SCALE;
// corner 로컬 viewport — 원본 `#character` 의 x/y/width/height.
const VP = { x: 340, y: 265, w: 220, h: 286 };
// Chog 잉크(로컬) 351,276 – 548,527 → 197×251.
const INK = { left: 351, top: 276, right: 548, bottom: 527 };

// 원본 viewBox 와, export 가 넓힌 padding. 둘을 합친 것이 PNG 한 장의 상자다.
const PAD = { l: 260, t: 320, r: 260, b: 120 };
const IDLE_VB = { x: -30, y: -20, w: 1730, h: 2250 };
const SLEEP_VB = { x: 280, y: 40, w: 1550, h: 2000 };

// 원본 svg 는 `xMidYMid meet` 로 viewport 에 들어간다. 그 배율과 중앙 보정을 그대로 쓴다.
function fitBox(vb) {
  const k = Math.min(VP.w / vb.w, VP.h / vb.h);
  return { k, ox: VP.x + (VP.w - vb.w * k) / 2, oy: VP.y + (VP.h - vb.h * k) / 2 };
}
const IDLE_FIT = fitBox(IDLE_VB);
const SLEEP_FIT = fitBox(SLEEP_VB);

// padding 을 포함한 PNG 한 장이 로컬 좌표에서 차지하는 자리.
function padRect(vb, fit) {
  return {
    left: fit.ox + (vb.x - PAD.l - vb.x) * fit.k,
    top: fit.oy + (vb.y - PAD.t - vb.y) * fit.k,
    width: (vb.w + PAD.l + PAD.r) * fit.k,
    height: (vb.h + PAD.t + PAD.b) * fit.k,
    vbx: vb.x - PAD.l,
    vby: vb.y - PAD.t,
    vbw: vb.w + PAD.l + PAD.r,
    vbh: vb.h + PAD.t + PAD.b,
  };
}
const IDLE_BOX = padRect(IDLE_VB, IDLE_FIT);
const SLEEP_BOX = padRect(SLEEP_VB, SLEEP_FIT);

// --- 졸기 머리 정렬 (A-415-g/h) -------------------------------------------
// Owner 최종규칙: 졸기도 Home/걷기와 같은 눈없는 정본머리(home-head.png)를 쓰고, 원래
// 얼굴 방향/좌표는 유지한 채 눈만 sleep-eyes-* 로 단계 교체한다. 기존 sleep-head.png
// (277×326)는 눈·코가 구워진 옛 자산이라 그 위에 눈 파츠가 또 올라가 두 쌍으로
// 보였다(감독 스크린샷 리포트). 새 그림·새 추출 0 — 두 PNG 의 알파 실루엣 bbox 를
// Pillow 로 실측해 같은 좌표계로 옮겨 재사용한다:
//   home-head.png (270×322)  실루엣 bbox (41,49)-(227,209), 187×161 → 중심(134,129)
//   sleep-head.png(277×326)  실루엣 bbox (50,52)-(235,212), 186×161 → 중심(142.5,132)
// 실루엣 크기 187×161 대 186×161(반올림 오차 1px 뿐) 로 캐논 §3 "머리 비율 1.0000"과
// 일치한다 — 그래서 재추출·재스케일 없이 중심만 맞추는 평행이동(8.5, 3 — sleep 캔버스
// px) 으로 충분하다. 이 오프셋은 sleep-eyes-* 자체 좌표와도 이미 맞는다: home-head 위의
// 원래 눈 슬롯(home-face-base.png 다크 bbox 93,125-187,177, homehead 실루엣 대비 오프셋
// 51/76)을 이 평행이동으로 sleep 캔버스에 옮기면(101.5,128)-(195.5,180) 이 되어
// sleep-eyes-base.png 실측 눈 bbox(106,129)-(186,166, 오프셋 56/77)와 상단 1px·중심
// 2.5px 오차로 겹친다 — 눈 파츠 좌표는 그대로 두고 머리만 옮기면 된다.
const HOME_HEAD_RASTER = { w: 270, h: 322 };
const SLEEP_HEAD_RASTER = { w: 277, h: 326 };
const HEAD_ALIGN_DX = 8.5; // sleep 캔버스(277) 기준 px
const HEAD_ALIGN_DY = 3; // sleep 캔버스(326) 기준 px
// home-head.png 를 앉힐 자리 — SLEEP_BOX 와 같은 배율(SLEEP_BOX.width/height 는 이미
// vbw/vbh*fit.k 이므로, 아래도 같은 fit.k 를 공유해 두 파츠가 화면에서 같은 px당
// 래스터 배율로 그려진다).
const HEAD_BOX = {
  left: SLEEP_BOX.left + (HEAD_ALIGN_DX * SLEEP_BOX.width) / SLEEP_HEAD_RASTER.w,
  top: SLEEP_BOX.top + (HEAD_ALIGN_DY * SLEEP_BOX.height) / SLEEP_HEAD_RASTER.h,
  width: (HOME_HEAD_RASTER.w * SLEEP_BOX.width) / SLEEP_HEAD_RASTER.w,
  height: (HOME_HEAD_RASTER.h * SLEEP_BOX.height) / SLEEP_HEAD_RASTER.h,
};
// 위 HEAD_BOX 와 짝을 이루는 "user 좌표" 상자 — originPct() 가 pivot(%) 계산에 쓴다.
const HEAD_VB = {
  vbx: SLEEP_BOX.vbx + (HEAD_ALIGN_DX * SLEEP_BOX.vbw) / SLEEP_HEAD_RASTER.w,
  vby: SLEEP_BOX.vby + (HEAD_ALIGN_DY * SLEEP_BOX.vbh) / SLEEP_HEAD_RASTER.h,
  vbw: (HOME_HEAD_RASTER.w * SLEEP_BOX.vbw) / SLEEP_HEAD_RASTER.w,
  vbh: (HOME_HEAD_RASTER.h * SLEEP_BOX.vbh) / SLEEP_HEAD_RASTER.h,
};

// user 좌표의 한 점을 그 PNG 안에서의 % 로 — transform-origin 에 쓴다.
function originPct(box, ux, uy) {
  return `${((ux - box.vbx) / box.vbw) * 100}% ${((uy - box.vby) / box.vbh) * 100}%`;
}

// --- 파츠 z 순서 (A-308 계약 5. body/head 사이에 앞팔이 있어 합치지 않는다) ---
const IDLE_PARTS = [
  "home-far-arm",
  "home-leg-right",
  "home-leg-left",
  "home-body",
  "home-near-arm",
  "home-head",
  "home-face-base",
  "home-face-hover",
];
const SLEEP_PARTS = ["sleep-legs", "sleep-torso", "sleep-head"];
const EYE_STAGES = ["base", "half", "sleepy", "closed"];

// --- 걷기 (flow.js) -----------------------------------------------------
const WALK_FRAMES = 48;
const WALK_BLEND_MS = 120;
const WALK_MOVE_MS = 2880;
const WALK_FPS_MS = 30;
const WALK_TOTAL_MS = 3000;
const REST_MS = 240; // 다리가 ±60 로컬에서 제자리로 모이는 시간

// [A-614 repair] Piggy 와 Chog 는 각자 자기 진짜 Name-final 자리에서 자기 진짜 정착
// 자리까지, 완전히 독립된 직선을 걷는다(A-612 BEFORE.md §B — 두 시작점이 서로
// 160~410px 떨어진 무관한 두 선이라, mid-walk 에 130~220px 벌어져 보인다는 실측 진단).
// 두 캐릭터의 끝점(진짜 시작·진짜 A-608 정착)은 그대로 두고, **위치 lerp 에 먹이는
// 진행률만** 앞쪽으로 몰아(front-load) 실제 걷는 시간 기준으로 서로에게 더 빨리
// 가까워지게 한다 — u=0 에서 0, u=1 에서 1 인 항등이라 첫 프레임(시작 연속성)과
// 정착(A-608 자리)은 손대지 않는다. 걷기 프레임 인덱스(`move`)·페이드 블렌드
// (`walkElapsed`)는 이 값을 쓰지 않으므로 다리 애니 타이밍·프레임 순서는 그대로다.
// 좁은 화면(플로어 적용)에서만 켠다 — main.js 의 `pairConvergeActive`
// (`computeHomeCharScaleFloorPlan(fit).applied`) 가 그 판정이고, 1440(플로어
// 미적용)에서는 호출부가 이 옵션을 넘기지 않아 `u` 가 그대로 쓰인다(byte-identical
// no-op, 카드 지시). 지수(POWER)는 A-614 home_pair 실측 프로브로 튜닝한 값이다 —
// HOME_PAIR.md 의 before/after 표가 그 근거다.
export const PAIR_CONVERGE_POWER = 5.5; // A614 home_pair 실측(430/390 real-flow probe)으로 정한 값
export function pairConvergenceEase(u) {
  const c = Math.min(1, Math.max(0, u));
  return 1 - Math.pow(1 - c, PAIR_CONVERGE_POWER);
}

// --- 졸기 (sleep-motion.js CONFIG 그대로) --------------------------------
export const SLEEP_IDLE_MS = 60000; // [A-421 Owner "일분으로 줄여" 2026-09-18] 180000 → 60000
// [A-421 Owner "고개가 꾸벅 졸아야해"] droop 4→12, drop 34→60 (INFERRED — 확정본 4/34 는 고개가 거의 안 보였다).
const SLEEP_CFG = { dozeSpeed: 13, nodMs: 3800, droop: 12, drop: 60, sink: 12, jerk: 55, sleepNod: 40 };
const SIT_SETTLE_MS = 1100;
const SIT_DROP_MS = 420;
const SLEEP_STEP_MS = 20;
// [A-421 Owner] 졸기 = base→half→sleepy 까지만, 잠들지 않고 반복. false 면 확정본(잠듦·closed) 그대로.
const DOZE_REPEAT = true;
// sleep-head 는 placement(scale .895953757) 안에 있으므로, 거기 준 translate 는
// 화면에서 그만큼 줄어든다. torso 는 sleep-body 바로 밑이라 1:1 이다.
const HEAD_PLACE_SCALE = 0.895953757;
const HEAD_PLACE_TX = 316;
const HEAD_PLACE_TY = -31;
const SLEEP_BODY_TY = -81;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;

// --- [A-624] 첫 도착 가르침 신호 B (Owner 선택 — A-614 lane_home_affordance PREVIEW) ------
// 정착 뒤 한 번: 앞팔만 작게 한 번 흔들고(wave) 손글씨 "tap me!" 가 뜬다. Home 종이를 스스로
// 열지 않는다(hover() 를 부르지 않는다 — PREVIEW 의 hover(1) 단계는 카드 "Do NOT auto-open"
// 에 따라 뺐다). 실제 Chog 탭(toggle)에서 사라진다. reduced-motion = 흔들기 0, 정지 라벨만.
// 흔들기 키 = PREVIEW sequence.js WAVE_SUBTLE_KEYS 그대로(Invite WAVE_KEYS 를 0 기준·~30% 로
// 줄인 값). 새 그림 0 — 기존 home-near-arm 래스터를 같은 어깨 pivot 으로 더 돌릴 뿐이다.
const TAP_CUE_DELAY_MS = 300; // PREVIEW WAVE_START_B
const TAP_CUE_WAVE_KEYS = [
  [0, 0],
  [350, -7],
  [550, -4],
  [770, -8],
  [960, -4],
  [1320, 0],
];
const TAP_CUE_WAVE_MS = 1320;
const TAP_CUE_FADE_MS = 250; // PREVIEW 라벨 페이드
// 라벨 글자 크기는 화면 px 로 고정한다(INFERRED — Owner 수치 아님). .chogHome 로컬 좌표는
// 바닥 스케일·판 스케일을 거쳐 390 에서 ≈0.245배, 1440 에서 ≈0.54배로 줄어들어 로컬 18px
// (PREVIEW) 은 폰에서 ≈4px 가 된다 — 읽히지 않는 신호는 신호가 아니다.
const TAP_CUE_SCREEN_PX = 15;
const TAP_CUE_GAP_SCREEN_PX = 4;
// [A-626 A] Owner: 라벨이 완전히 보인 뒤 약 1.0–1.5초(목표 1.2초) 그대로 읽히게 둔 다음에야 첫 Journey
// 카드가 자리를 가져간다. 신호 시계(tapCue.t)는 화면에 그려진 프레임 dt 로만 흐르므로(숨은 탭 dt 0)
// 숨은 동안에는 이 대기도 멈춘다 — 카드가 보이지 않은 라벨을 건너뛰지 못한다.
const TAP_CUE_HOLD_MS = 1200;
export const TAP_CUE_TIMING = {
  delayMs: TAP_CUE_DELAY_MS,
  waveMs: TAP_CUE_WAVE_MS,
  fadeMs: TAP_CUE_FADE_MS,
  entranceMs: TAP_CUE_DELAY_MS + TAP_CUE_WAVE_MS + TAP_CUE_FADE_MS,
  holdMs: TAP_CUE_HOLD_MS,
  readyMs: TAP_CUE_DELAY_MS + TAP_CUE_WAVE_MS + TAP_CUE_FADE_MS + TAP_CUE_HOLD_MS,
  waveKeys: TAP_CUE_WAVE_KEYS,
  screenPx: TAP_CUE_SCREEN_PX,
};
function between(t, keys) {
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      return a[1] + (b[1] - a[1]) * ease(clamp01((t - a[0]) / (b[0] - a[0])));
    }
  }
  return keys[keys.length - 1][1];
}
// 순수 함수 — 테스트가 곡선을 브라우저 없이 확인한다.
export function tapCueFrame(t, reduced = false) {
  if (reduced) return { waveDeg: 0, labelOpacity: 1, entering: false };
  const local = t - TAP_CUE_DELAY_MS;
  const waveDeg = local > 0 && local < TAP_CUE_WAVE_MS ? between(local, TAP_CUE_WAVE_KEYS) : 0;
  const labelOpacity = ease(clamp01((local - TAP_CUE_WAVE_MS) / TAP_CUE_FADE_MS));
  return { waveDeg, labelOpacity, entering: t < TAP_CUE_TIMING.entranceMs };
}

function img(name, extra = "", srcName = name) {
  return `<img class="chogHome__part" data-part="${name}" src="${DIR}/${srcName}.png" alt="" ${extra} />`;
}

// padMarkup — A-336: 후버 노트패드는 이제 확정 home-paper.js 공유 view 다(예전 단일
// notepad.png 래스터 대신). 호출부(main.js)가 실제 데이터로 채운 markup 을 넘긴다.
// 넘기지 않으면(가령 사설 하네스가 아직 안 옮겼으면) 옛 단일 이미지로 그대로 대체한다 —
// 손끝 좌표·wrap 변환 계산은 이 함수 밖(layout())이 맡고, 둘 다 같은 앵커 규약을 쓴다.
// [A-358 §2] #homeBoard 조상의 aria-hidden 을 뗐으니, 여기서는 진짜 장식(몸 그림
// stack/sleep)만 각자 aria-hidden 으로 내려 감춘다 — 상호작용 hit(role=button)과
// 카드형 padWrap(HomeNotepad, 텍스트 정보)은 그대로 AX 트리에 남는다.
export function chogHomeMarkup({ padMarkup = "" } = {}) {
  return `
    <div class="chogHome" id="chogHome" data-state="idle" data-phase="rest">
      <div class="chogHome__stack" id="chogHomeStack" aria-hidden="true">
        ${IDLE_PARTS.map((p) => img(p)).join("")}
        <img class="chogHome__walk" id="chogHomeWalk" src="${DIR}/walk-00.png" alt="" />
      </div>
      <div class="chogHome__sleep" id="chogHomeSleep" aria-hidden="true">
        ${SLEEP_PARTS.map((p) => img(p, "", p === "sleep-head" ? "home-head" : p)).join("")}
        ${EYE_STAGES.map((s) => img(`sleep-eyes-${s}`, `data-eye-stage="${s}"`)).join("")}
        ${img("sleep-face-nosecheeks", 'data-doze-face="1"')}
      </div>
      <div class="chogHome__padWrap" id="chogHomePad">${padMarkup || `<img src="${DIR}/notepad.png" alt="" />`}</div>
      <div class="chogHome__hit" id="chogHomeHit" role="button" tabindex="0" aria-label="Chog"></div>
    </div>
  `;
}

// 파츠를 로컬 좌표에 앉힌다. 모든 파츠가 같은 상자를 쓰므로 하나로 끝난다.
function layout(root) {
  const put = (el, box) => {
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
  };
  root.querySelectorAll(".chogHome__stack > *").forEach((el) => put(el, IDLE_BOX));
  root.querySelectorAll(".chogHome__sleep > *").forEach((el) => put(el, SLEEP_BOX));
  // [A-415-g/h] sleep-head 만 home-head.png(눈없는 정본머리) 자리(HEAD_BOX, 위 실측
  // 오프셋)로 다시 덮어쓴다. 다리·몸통·눈시트는 그대로 SLEEP_BOX(변경 없음).
  const sleepHeadPart = root.querySelector('[data-part="sleep-head"]');
  if (sleepHeadPart) put(sleepHeadPart, HEAD_BOX);

  // 회전 중심 — 원본 pivot 을 PNG 안의 % 로 옮긴 것.
  const q = (n) => root.querySelector(`[data-part="${n}"]`);
  const nearArm = q("home-near-arm");
  const farArm = q("home-far-arm");
  const faceBase = q("home-face-base");
  const faceHover = q("home-face-hover");
  if (nearArm) nearArm.style.transformOrigin = originPct(IDLE_BOX, 500, 1180);
  if (farArm) farArm.style.transformOrigin = originPct(IDLE_BOX, 1220, 1180);
  for (const f of [faceBase, faceHover]) {
    if (f) f.style.transformOrigin = originPct(IDLE_BOX, 900, 900);
  }

  // sleep pivot — 원본 계층 실측(A-310): `sleep-head-placement` 는 `sleep-body` 의
  // **형제**다. 그래서 head·eyes 에는 `translate(0 -81)` 이 걸리지 않는다.
  // (A-308 은 여기에 -81 을 더해 머리를 81 만큼 잘못 올렸다.)
  const headPivotX = 1000 * HEAD_PLACE_SCALE + HEAD_PLACE_TX;
  const headPivotY = 1300 * HEAD_PLACE_SCALE + HEAD_PLACE_TY;
  const torsoPivotY = 1580 + SLEEP_BODY_TY;
  const head = q("sleep-head");
  const torso = q("sleep-torso");
  // head 는 이제 자기만의 상자(HEAD_BOX)를 쓰므로 pivot% 도 그 상자 기준인 HEAD_VB
  // 로 다시 잡는다(SLEEP_BOX 기준 % 를 그대로 쓰면 다른 크기 상자에 적용돼 어긋난다).
  // torso·눈은 여전히 SLEEP_BOX 그대로라 손대지 않는다.
  if (head) head.style.transformOrigin = originPct(HEAD_VB, headPivotX, headPivotY);
  if (torso) torso.style.transformOrigin = originPct(SLEEP_BOX, 1110, torsoPivotY);
  root.querySelectorAll("[data-eye-stage], [data-doze-face]").forEach((el) => {
    el.style.transformOrigin = originPct(SLEEP_BOX, headPivotX, headPivotY);
  });

  // 노트패드 — 캐릭터와 별개 좌표(원본 rect -105,-102,110,111).
  // 노트패드 — 원본 `<image x="-105" y="-102" width="110" height="111">` 그대로.
  // 그 음수 오프셋이 있어야 translate 로 준 자리가 손끝이 되고 종이는 그 위로 걸린다.
  // 원본은 `<g id="pad">` 에 transform 을 주고, 그 안의 `<image x="-105" y="-102"
  // width="110" height="111">` 이 오프셋을 갖는다. CSS 에서 offset 을 left/top 으로
  // 주면 scale·rotate 가 그 오프셋에 걸리지 않아 궤적이 달라진다(A-310 지적 5).
  // 그래서 wrapper 원점을 0,0 으로 두고 **안쪽 img** 가 오프셋을 갖게 한다 —
  // 원본과 같은 행렬 순서다.
  const pad = root.querySelector("#chogHomePad");
  if (pad) {
    pad.style.left = "0px";
    pad.style.top = "0px";
    const padChild = pad.firstElementChild;
    if (padChild) {
      // A-336: home-paper.js 의 실제 용지는 400×568(옛 notepad.png 는 736×736 정사각)이라
      // 같은 폭 110 에서 비율대로 높이만 156 으로 늘렸다(110 × 568/400). 앵커 자체
      // (left -105 / top -102, 손끝 기준 원점)는 그대로다 — 「작은 시각차이는 범위 안에서
      // 바로 고친다」(A-336 착수 조건)에 해당하는 치수 보정 하나뿐이고, wrap 의 위치/scale/
      // 회전/성장 타이밍(draw() 의 pad.style.transform)은 손대지 않았다.
      const isHomePaper = padChild.classList.contains("homePaperMount");
      padChild.style.position = "absolute";
      padChild.style.left = "-105px";
      padChild.style.top = "-102px";
      padChild.style.width = "110px";
      padChild.style.height = isHomePaper ? "156px" : "111px";
    }
  }
  // 손이 닿는 자리만 hit — 다른 카드 클릭을 가로채지 않는다.
  const hit = root.querySelector("#chogHomeHit");
  if (hit) {
    hit.style.left = `${INK.left}px`;
    hit.style.top = `${INK.top}px`;
    hit.style.width = `${INK.right - INK.left}px`;
    hit.style.height = `${INK.bottom - INK.top}px`;
  }
}

// --- 졸기 상태기 (sleep-motion.js advance 그대로) -------------------------
function newDoze() {
  return { d: 0, start: 0, len: SLEEP_CFG.nodMs, startle: -1000, stage: "base", asleep: false };
}

function advance(z, now, dt) {
  z.d = Math.min(1, z.d + dt / (SLEEP_CFG.dozeSpeed * 1000));
  const room = 1 - z.d;
  let dr = 0;
  if (z.d > 0.3 && room > 0.12 && !z.asleep) {
    const p = (now - z.start) / z.len;
    if (p >= 1) {
      z.start = now;
      z.len = SLEEP_CFG.nodMs;
      z.startle = now;
      z.d = Math.max(0.15, z.d - 0.55 * 0.6 * Math.pow(room, 1.3));
    } else dr = p < 0.8 ? p / 0.8 : 1 - (p - 0.8) / 0.2;
  } else if (z.d > 0.3 && DOZE_REPEAT) {
    // [A-421 Owner "이거 반복해야해", "하프 슬립까지만 쓰자"] 끝까지 처지면 잠들지 않고 흠칫 깨서
    // 다시 졸기 시작한다(반복). 깨는 깊이 0.35 = INFERRED(확정본엔 반복 없음).
    z.start = now;
    z.len = SLEEP_CFG.nodMs;
    z.startle = now;
    z.d = 0.35;
  } else if (z.d > 0.3) {
    if (!z.asleep) {
      z.asleep = true;
      z.start = now;
      z.len = 15200;
    }
    const p = (now - z.start) / z.len;
    if (p >= 1) {
      z.start = now;
      dr = 0;
    } else dr = (p < 0.5 ? p / 0.5 : (1 - p) / 0.5) * 0.4;
  } else z.start = now;
  const nod = z.asleep ? dr : dr * room;
  const wk = z.asleep ? 0 : Math.max(0, 1 - (now - z.startle) / 420);
  const lv = (z.d * 0.95 + 0.32 * nod) * (1 - wk);
  z.stage = z.asleep ? "closed" : lv < 0.26 ? "base" : lv < 0.54 ? "half" : lv < 0.82 || DOZE_REPEAT ? "sleepy" : "closed"; // 반복 모드: sleepy 까지만
  const amt = (z.d * 0.85 + nod) * (1 - wk) - 0.3 * wk;
  return {
    stage: z.stage,
    asleep: z.asleep,
    angle: SLEEP_CFG.droop * amt,
    drop: SLEEP_CFG.drop * amt,
    sink: SLEEP_CFG.sink * Math.max(0, amt),
  };
}

// 하네스 없이 곡선을 확인할 수 있게, 순수 함수로도 내보낸다.
export function sampleDoze(ms) {
  const z = newDoze();
  let out;
  for (let t = 0; t <= ms; t += SLEEP_STEP_MS) out = advance(z, t, t ? SLEEP_STEP_MS : 0);
  return out;
}

/**
 * Home Chog 를 붙인다.
 * @param {HTMLElement} root  `chogHomeMarkup()` 이 만든 `.chogHome`
 * @param {object} opts
 *   startRect  Name it 의 Chog 화면 rect (없으면 걷기 없이 제자리)
 *   board      Home 판의 실제 rect
 *   reduced    prefers-reduced-motion
 *   onFrame    RAF 등록기 — 씬 정리에 묶기 위해 바깥에서 받는다
 *   onCleanup  해제 등록기
 *   listen     리스너 등록기
 */
export function mountChogHome(root, opts) {
  // [A-359 §3] cardClaimed — 공통 카드 자리(.cardAnchor)를 지금 이 화면의 다른 카드
  // (Send/Receipt)가 이미 쓰고 있는가. true 면 손끝-노트패드는 그 자리로 도킹하지
  // 않는다(아래 sharedCardPadTarget) — 한 자리 한 카드. 호출부(main.js)가 실제
  // state.sendCardVisible/귀환 씬 여부를 그대로 넘긴다 — DEV 경로 전용이 아니다.
  // [A-360 §3] onTap — 공통 카드 자리가 비어 있을 때(!cardClaimed)만 "여는 탭"(pinned
  // false→true) 에서 한 번 불린다. hover(pointerenter/leave)는 여전히 기존 노트패드만
  // 연다/닫는다 — "normal Home hover" 그대로. 호출부(main.js)가 Explore 진입을 여기 건다.
  const { startRect = null, board, reduced = false, cardClaimed = false, onFrame, onCleanup, listen, onTap = () => {}, pairConverge = false } = opts;
  layout(root);

  const stack = root.querySelector("#chogHomeStack");
  const sleepLayer = root.querySelector("#chogHomeSleep");
  const walk = root.querySelector("#chogHomeWalk");
  const pad = root.querySelector("#chogHomePad");
  const hit = root.querySelector("#chogHomeHit");
  const nearArm = root.querySelector('[data-part="home-near-arm"]');
  const farArm = root.querySelector('[data-part="home-far-arm"]');
  const legR = root.querySelector('[data-part="home-leg-right"]');
  const legL = root.querySelector('[data-part="home-leg-left"]');
  const faceBase = root.querySelector('[data-part="home-face-base"]');
  const faceHover = root.querySelector('[data-part="home-face-hover"]');
  const bobParts = [farArm, root.querySelector('[data-part="home-body"]'), nearArm, root.querySelector('[data-part="home-head"]'), faceBase, faceHover];
  const sleepHead = root.querySelector('[data-part="sleep-head"]');
  const sleepTorso = root.querySelector('[data-part="sleep-torso"]');
  const eyes = new Map(EYE_STAGES.map((s) => [s, root.querySelector(`[data-eye-stage="${s}"]`)]));
  const dozeFace = root.querySelector("[data-doze-face]");

  // corner 변환 — 이것 하나가 로컬을 Home 판으로 옮긴다.
  const place = (x, y, sc) => {
    root.style.transform = `translate(${x}px, ${y}px) scale(${sc})`;
  };
  place(CORNER_TX, CORNER_TY, HOME_SCALE);

  // ---- 상태 --------------------------------------------------------------
  let progress = 0; // hover 0→1
  let target = 0;
  let pinned = false;
  let settle = 1; // 다리 모으기 0→1
  let hopAge = -1;
  let walking = false;
  let walkElapsed = 0;
  let ready = !startRect; // 걷기가 끝나야 hover/sleep 를 받는다
  let dozePhase = "awake"; // awake | sitting | dozing
  let dozeState = newDoze();
  let dozeElapsed = 0;
  let dozeAccum = 0; // 20ms 고정 스텝에서 남는 시간
  let dozeOut = null;
  let idleTimer = 0;
  let sitTimer = 0;
  let destroyed = false;
  let handoff = null; // Name it 그림 → 걷기 넘김용 임시 <img>
  // [A-624] 첫 도착 신호 — startTapCue() 전에는 null. { t, label, hidden, measure }
  let tapCue = null;
  let waveDeg = 0;

  // [A-358 §3] hover 노트패드의 손끝-출발 모션은 그대로 두고(아래 draw() 의 sx/sy/dx/dy),
  // release(카드가 열리는 마지막 구간)가 끝나갈 때만 같은 공통 카드 자리(.cardAnchor,
  // style.css — 중앙에서 왼쪽32/위48, 285×364)로 보간해 붙인다. HomeNotepad 실제 용지는
  // 400×568(레이아웃()의 padChild 110×156, 즉 110/400=.275 축소 — 주석 "A-336" 그대로)라,
  // 같은 340px 비율로 285×364 안에 등축 contain-fit 한다(비균등 늘림 금지).
  const CARD_ANCHOR_W = 285;
  const CARD_ANCHOR_H = 364;
  const PAPER_W = 400;
  const PAPER_H = 568;
  const PAPER_BASE_SCALE = 0.275; // layout() 의 padChild 110/400
  const finalPaperScale = Math.min(CARD_ANCHOR_W / PAPER_W, CARD_ANCHOR_H / PAPER_H);
  const finalPadScale = finalPaperScale / PAPER_BASE_SCALE;
  const homeBoardEl = root.closest("#homeBoard");

  // 공통 앵커 중심(뷰포트 중앙 -32/-48, Home 판 좌표계) 을 이 Chog 의 로컬(코너) 좌표로
  // 되돌린다 — place(CORNER_TX,CORNER_TY,HOME_SCALE) 의 역변환. board 는 fitHomeBoard()
  // 의 실제 rect(계산값이 아니라 getBoundingClientRect, main.js 관례 그대로).
  function sharedCardPadTarget() {
    // [A-359 §3] 자리가 이미 다른 카드 몫이면 도킹하지 않는다 — 손끝 hover 자리(draw()
    // 의 기존 sx/sy/dx/dy 수식)에 그대로 머문다. pinned 는 꺼지지 않는다(그건 사용자
    // 입력이다) — 겹치는 것은 "같은 화면자리" 뿐이라 여기서만 막는다.
    if (cardClaimed) return null;
    // [A-620] root(#chogHome) 의 **실제 부모 좌표계**를 잰다. 좁은 화면에서는 main.js
    // applyHomeCharacterScaleFloor() 가 #chogHome 을 .homeCharScaleFloor(1256×772 상자,
    // translate+scale(k=0.52/s))로 감싸므로, #homeBoard rect 만 쓰면 이 목표가 그 k 를 한 번
    // 더 받아 종이가 256.338×k(390: 429px, 430: 389px)로 커지고 왼쪽 밖으로 밀렸다
    // (A620 VERIFY §1). 부모 상자의 rect 는 그 합성 변환을 그대로 담고 있으니 이것 하나로
    // 목표를 되돌린다. 1440(바닥 미적용)은 부모가 곧 #homeBoard 라 결과가 이전과 같다.
    const parentEl = root.parentElement;
    const frameEl = parentEl && parentEl.matches("#homeBoard, .homeCharScaleFloor") ? parentEl : homeBoardEl;
    const frameW = (frameEl && frameEl.offsetWidth) || 1256;
    const boardRect = (frameEl && frameEl.getBoundingClientRect()) || board;
    if (!boardRect || !boardRect.width) return null;
    const boardScale = boardRect.width / frameW;
    if (!boardScale) return null;
    const viewportScale = boardScale * HOME_SCALE;
    // [A-359 §2] 실측 x324,y128.5,w256.338,h364 — 종이는 400×568 을 285×364 안에 등축
    // contain-fit 해 세로가 기준이 되고(finalPaperScale, 위) 가로는 256.338 로 285보다
    // 좁다. 앵커 상자(CARD_ANCHOR_W/H)의 왼쪽에 그대로 붙이면 중심이 (285−256.338)/2
    // ≈14.33px 왼쪽으로 어긋난다(명세 재현값 그대로). 상자 자체가 아니라 **실제 종이
    // 크기**의 절반만큼 앵커 중심에서 물러난 자리를 잡아야 두 카드가 같은 중심을 쓴다.
    const paperW = finalPaperScale * PAPER_W;
    const paperH = finalPaperScale * PAPER_H;
    const boardX = (window.innerWidth / 2 - 32 - paperW / 2 - boardRect.left) / boardScale;
    const boardY = (window.innerHeight / 2 - 48 - paperH / 2 - boardRect.top) / boardScale;
    return {
      // padChild 의 -105/-102 오프셋(손끝 원점, layout() 주석)도 최종 스케일로 되돌려
      // 같이 옮긴다 — 안 그러면 용지 모서리가 앵커에서 어긋난다.
      x: (boardX - CORNER_TX) / HOME_SCALE + (105 * finalPadScale) / viewportScale,
      y: (boardY - CORNER_TY) / HOME_SCALE + (102 * finalPadScale) / viewportScale,
      scale: finalPaperScale / (PAPER_BASE_SCALE * viewportScale),
    };
  }

  // ---- 그리기 (hover.js render 수식 그대로) --------------------------------
  function draw() {
    // A-359: another scene card owns the shared slot. Clear the local hover state
    // before deriving arm/face transforms so a stale tap cannot leave Chog raised.
    if (cardClaimed) {
      pinned = false;
      target = 0;
      progress = 0;
      hopAge = -1;
    }
    // `±60` 은 원본 svg 의 user 단위다(hover.js 가 SVG transform 속성으로 준다).
    // 로컬 px 로 옮기려면 viewport 배율을 곱해야 한다 — 안 곱하면 8배로 벌어진다.
    const restX = 60 * ease(settle) * IDLE_FIT.k;
    if (legR) legR.style.transform = `translateX(${restX}px)`;
    if (legL) legL.style.transform = `translateX(${-restX}px)`;

    // [A-411-p] Home "next errand" 버튼을 없앴다(main.js homePadMarkup) — #nextErrandButton
    // 은 이제 DOM에 없으므로 그 가시성/tabIndex 배선도 함께 지운다. 카드 자리가 열렸는지는
    // 여전히 onTap(pinned && !cardClaimed)만으로 판정한다(아래).
    const u = ease(progress);
    if (faceHover) faceHover.style.opacity = String(u);
    if (faceBase) faceBase.style.opacity = String(1 - u);

    const push = ease(clamp01((progress - 0.14) / 0.86));
    const angle = progress < 0.14 ? -4 * ease(progress / 0.14) : -4 + 102 * push;
    const crouch = 5 * Math.sin(Math.PI * clamp01(progress / 0.26));
    const rebound = -7 * Math.sin(Math.PI * clamp01((progress - 0.2) / 0.65));
    const hopPhase = clamp01((hopAge - 80) / 280);
    const hop = hopAge >= 0 ? -8 * Math.pow(Math.sin(Math.PI * hopPhase), 2) : 0;
    const landing = hopAge >= 360 && hopAge < 420 ? 2 * Math.sin((Math.PI * (hopAge - 360)) / 60) : 0;
    const bob = crouch + rebound + landing;

    // 두 팔은 회전과 bob 을 같이 받는다. bob 루프가 회전을 덮지 않도록 여기서 합친다.
    // [A-624] 첫 도착 신호의 흔들기(waveDeg)는 같은 어깨 pivot 에 회전만 더한다 — 신호가
    // 없으면 0 이라 이 줄은 이전과 같은 값을 낸다.
    if (nearArm) nearArm.style.transform = `translateY(${bob}px) rotate(${angle + waveDeg}deg)`;
    if (farArm) farArm.style.transform = `translateY(${bob}px) rotate(${-102 * push}deg)`;
    for (const el of bobParts) {
      if (!el || el === farArm || el === nearArm || el === faceBase) continue;
      el.style.transform = `translateY(${bob}px)`;
    }
    // 머리/얼굴은 bob 위에 hover 이동이 더해진다(원본 user 단위 → 로컬 환산).
    if (faceBase) {
      faceBase.style.transform = `translate(${-22 * u * IDLE_FIT.k}px, ${(-28 * u * IDLE_FIT.k) + bob}px) rotate(${3 * u}deg)`;
    }
    // 전체 캐릭터가 hop 한다. 다리는 bob 을 받지 않는다(원본과 같다).
    stack.style.transform = `translateY(${hop}px)`;

    // 노트패드 — 손끝에서 시작해 왼쪽 위로 올라가며 커진다.
    if (pad) {
      const a = (angle * Math.PI) / 180;
      const sx = VP.x + ((500 + 30) * VP.w) / IDLE_VB.w;
      const sy = VP.y + ((1180 + 20) * VP.h) / IDLE_VB.h;
      const dx = (-60 * VP.w) / IDLE_VB.w;
      const dy = (320 * VP.h) / IDLE_VB.h;
      const x = sx + dx * Math.cos(a) - dy * Math.sin(a);
      const y = sy + dx * Math.sin(a) + dy * Math.cos(a);
      const release = clamp01((progress - 0.2) / 0.8);
      const floatUp = ease(release);
      const grow = 1 + 2.15 * Math.pow(release - 1, 3) + 1.15 * Math.pow(release - 1, 2);
      const padScale = 0.18 + 1.07 * grow;
      const wobble = 5 * Math.sin(2 * Math.PI * release) * (1 - release);
      const handX = x - 35 * floatUp;
      const handY = y + bob + hop * (1 - floatUp) - 65 * floatUp;
      const handRotate = -3 * push + wobble;
      // [A-358 §3] release 마지막 16%(0.84→1) 에서만, 손출발 모션은 그대로 둔 채 공통
      // 카드 자리로 보간한다 — 이 앞은 기존 손끝 모션 그대로다(수정 0).
      const anchorTarget = release > 0.84 ? sharedCardPadTarget() : null;
      const anchorBlend = anchorTarget ? ease(clamp01((release - 0.84) / 0.16)) : 0;
      const finalX = anchorTarget ? lerp(handX, anchorTarget.x, anchorBlend) : handX;
      const finalY = anchorTarget ? lerp(handY, anchorTarget.y, anchorBlend) : handY;
      const finalScale = anchorTarget ? lerp(padScale, anchorTarget.scale, anchorBlend) : padScale;
      const finalRotate = anchorTarget ? lerp(handRotate, 0, anchorBlend) : handRotate;
      pad.style.transform = `translate(${finalX}px, ${finalY}px) rotate(${finalRotate}deg) scale(${finalScale})`;
      pad.style.opacity = cardClaimed ? "0" : String(clamp01(progress / 0.1));
      // [A-628 B] 완전히 접힌 종이(progress 0 · 여는 의도 target 0 — opacity 0, 손끝 크기)는 키보드에서
      // 빠진다. 전에는 보이지 않는 records/money stamp/flap/+Piggy 가 Tab·focus 를 받았고, 접힌 채
      // Enter 로 HISTORY 가 손끝 크기로 열리거나(Chog 까지 inert 로 갇힘) Money 모드·flap 이 몰래
      // 바뀌었다(A-628 pre 390/430/1440). #chogHomeHit 은 pad 밖 형제라 그대로 산다. 여는 순간
      // (target 1) 바로 풀리므로 열린 종이의 키보드/포인터와 닫히는 애니메이션 동안의 포인터는
      // 전과 같다. 접힌 pad 는 포인터 적중 0(pre 표본 780/1786점 전부 0)이라 포인터 변화도 0.
      const folded = progress === 0 && target === 0;
      if (pad.inert !== folded) pad.inert = folded;
    }
  }

  function drawSleep(out) {
    // 머리 변환 — 원본은 `#sleep-head` 하나에 주고 눈은 그 **자식**이라 같이 움직인다.
    // 파츠를 갈라 구웠으니 여기서 같은 행렬을 눈에도 그대로 준다. 안 주면 고개만
    // 숙이고 눈이 제자리에 남는다(A-310 지적 2).
    const headT = reduced
      ? ""
      : `translateY(${out.drop * HEAD_PLACE_SCALE * SLEEP_FIT.k}px) rotate(${out.angle}deg)`;
    if (sleepHead) sleepHead.style.transform = headT;
    for (const [stage, el] of eyes) {
      if (!el) continue;
      el.style.display = stage === out.stage ? "block" : "none";
      el.style.transform = headT; // head 와 같은 행렬 · 같은 origin
    }
    // [A-421 Owner "넣어라"] 코·볼 — metro pose_v2 pose_sit_sleepy 원본을 눈과 같은 캔버스로 반입
    // (<private>). 눈처럼 머리와 같이 움직인다.
    if (dozeFace) dozeFace.style.transform = headT;
    if (sleepTorso) {
      sleepTorso.style.transform = reduced
        ? ""
        : `translateY(${out.sink * SLEEP_FIT.k}px) rotate(${out.angle * 0.22}deg)`;
    }
  }

  // ---- 졸기 생명주기 (sleep-motion.js) -------------------------------------
  function showSleep(on) {
    root.dataset.state = on ? "sleep" : "idle";
    sleepLayer.style.display = on ? "block" : "none";
    stack.style.visibility = on ? "hidden" : "";
    if (pad && on) pad.style.opacity = "0";
  }

  function clearSleepTimers() {
    clearTimeout(idleTimer);
    clearTimeout(sitTimer);
    idleTimer = 0;
    sitTimer = 0;
  }

  function armIdle() {
    // [A-427 Owner "카드 있을 때는 졸림 안 나오게"] 카드 자리가 점유 중이면 졸기 예약 0.
    if (destroyed || document.hidden || !ready || cardClaimed) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(sit, SLEEP_IDLE_MS);
  }

  function wake() {
    if (destroyed) return;
    clearSleepTimers();
    dozePhase = "awake";
    dozeState = newDoze();
    dozeAccum = 0;
    dozeOut = null;
    showSleep(false);
    root.dataset.phase = "rest";
    armIdle();
  }

  function sit() {
    if (destroyed || document.hidden || !ready) return;
    clearSleepTimers();
    dozePhase = "sitting";
    root.dataset.phase = "sitting";
    showSleep(true);
    drawSleep(advance(newDoze(), 0, 0));
    if (!reduced) {
      sleepLayer.animate(
        [{ transform: "translateY(-6px)" }, { transform: "translateY(1px)", offset: 0.72 }, { transform: "translateY(0)" }],
        { duration: SIT_DROP_MS, easing: "cubic-bezier(.22,.7,.3,1)" },
      );
    }
    sitTimer = setTimeout(() => {
      if (destroyed) return;
      dozePhase = "dozing";
      root.dataset.phase = "dozing";
      dozeElapsed = 0;
      dozeAccum = 0;
      dozeOut = null;
      dozeState = newDoze();
    }, SIT_SETTLE_MS);
  }

  // ---- hover ------------------------------------------------------------
  function requestHover(value) {
    if (!ready || destroyed) return;
    if (dozePhase !== "awake") {
      // [A-411-m] 이 졸기 분기는 원본 hover.js/sleep-motion.js 어디에도 없다(A-308이
      // chog-home.js 안에서만 얹은 통합 코드) — 그래서 "확정 수식" 변경이 아니다.
      // 기존에는 여기서 곧장 return 해 이 호출이 가진 value(특히 실제 tap 이 이미
      // pinned=true 로 올린 여는 의도)를 그대로 버렸다: wake() 는 돌지만 progress/target
      // 은 이전 값(대개 0)에 머물러, pinned 는 true인데 노트패드는 계속 닫힌 채(progress
      // 0/padScale .18)로 남는다 — 감독 실측 .homePaper·.recordsCardAnchor 9.34×13.27
      // (A-411-m 재현) 이 정확히 이 값이다. 깨우고 나서 같은 tap 의 값을 마저 적용한다 —
      // 아래 정상 분기로 그대로 이어진다(좌표·이징·padScale 식 자체는 손대지 않는다).
      wake();
    }
    if (reduced) {
      progress = value;
      target = value;
      hopAge = -1;
      draw();
      return;
    }
    if (value && !target && progress < 0.15 && !walking) hopAge = 0;
    target = value;
    if (walking) return;
    draw();
  }

  // ---- [A-624] 첫 도착 신호 B ------------------------------------------------
  // 호출부(main.js mountHome settle())가 "Save 직후 첫 도착" 사실(isFirstArrival)로만 부른다 —
  // 새 저장 키 0. 한 인스턴스에 한 번. 공통 카드 자리가 이미 다른 카드 몫이면(cardClaimed)
  // Chog 탭이 종이를 못 여니 가르칠 것이 없다 → 띄우지 않는다.
  function startTapCue() {
    if (destroyed || cardClaimed || tapCue || !hit) return false;
    const label = document.createElement("div");
    label.className = "chogHome__tapCue";
    label.setAttribute("aria-hidden", "true"); // 탭 대상(#chogHomeHit "Chog")이 이미 AX 에 있다
    label.textContent = "tap me!";
    label.style.opacity = reduced ? "1" : "0";
    root.append(label);
    tapCue = { t: 0, label, hidden: false, measure: true };
    root.dataset.tapCue = reduced ? "shown" : "entering";
    measureTapCue();
    return true;
  }

  // 로컬 좌표 → 화면 배율은 hit 의 실제 rect 로 잰다(바닥 스케일·판 스케일 합성값).
  function measureTapCue() {
    if (!tapCue || tapCue.hidden) return;
    const r = hit.getBoundingClientRect();
    const k = r.width / (INK.right - INK.left);
    if (!k) return;
    tapCue.measure = false;
    const { label } = tapCue;
    label.style.fontSize = `${TAP_CUE_SCREEN_PX / k}px`;
    label.style.left = `${(INK.left + INK.right) / 2}px`;
    label.style.top = `${INK.top - TAP_CUE_GAP_SCREEN_PX / k}px`;
  }

  function hideTapCue() {
    if (!tapCue || tapCue.hidden) return;
    tapCue.hidden = true;
    waveDeg = 0;
    tapCue.label.remove();
    root.dataset.tapCue = "off";
  }

  if (hit) {
    listen(hit, "pointerenter", () => requestHover(1));
    listen(hit, "pointerleave", () => {
      if (!pinned) requestHover(0);
    });
    listen(hit, "focus", () => requestHover(1));
    listen(hit, "blur", () => {
      // A-419: moving focus to a paper control must preserve the tapped-open Home.
      if (!pinned) requestHover(0);
    });
    const toggle = (e) => {
      e.preventDefault();
      // [A-624] 실제 Chog 탭(click/touch/Enter/Space) = 신호를 치운다. hover/focus 는 아니다.
      hideTapCue();
      pinned = !pinned;
      requestHover(pinned ? 1 : 0);
      // [A-360 §3] "여는 탭"에서만 — 자리가 이미 다른 카드 몫이면(cardClaimed) 부르지
      // 않는다(첫 Journey 카드가 떠 있는 동안 탭이 Explore로 새지 않게).
      if (pinned && !cardClaimed) onTap();
    };
    listen(hit, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle(e);
    });
    // 터치는 같은 핀 토글에 건다.
    let lastTouchAt = -Infinity;
    listen(
      hit,
      "touchstart",
      (e) => {
        lastTouchAt = e.timeStamp ?? Date.now();
        toggle(e);
      },
      { passive: false },
    );
    // [A-354] 데스크톱 click 도 같은 핀 토글에 건다(Owner: 초그 tap 요구). 터치 기기는
    // touchstart 뒤에 합성 click 을 한 번 더 보내므로, 그 즉시 다시 토글해 버리면 꺼졌다
    // 켜졌다 두 번 움직인다 — touchstart 로부터 500ms 안의 click 은 무시한다(터치 자체가
    // 이미 toggle 을 실행했다).
    listen(hit, "click", (e) => {
      const at = e.timeStamp ?? Date.now();
      if (at - lastTouchAt < 500) return;
      toggle(e);
    });
  }

  // 입력이 있으면 졸기 시계를 되돌린다(원본 events 정책 그대로).
  const activity = () => {
    if (!ready || destroyed) return;
    if (dozePhase === "awake") armIdle();
    else wake();
  };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    listen(document, type, activity, { passive: true });
  }
  // [A-624] 창 크기가 바뀌면(바닥 스케일 재계산) 신호 글자 크기를 다음 프레임에 다시 잰다.
  listen(window, "resize", () => {
    if (tapCue) tapCue.measure = true;
  });
  listen(document, "visibilitychange", () => {
    if (document.hidden) {
      clearSleepTimers();
      showSleep(false);
      dozePhase = "awake";
    } else wake();
  });

  // ---- 걷기 → 도착 --------------------------------------------------------
  let start = null;
  if (startRect && !reduced) {
    const s = board.width / 1256;
    const k = startRect.height / s / 251;
    start = {
      x: (startRect.left + startRect.width / 2 - board.left) / s - 449.5 * k,
      y: (startRect.bottom - board.top) / s - 527 * k,
      scale: k,
    };
    walking = true;
    settle = 0;
    root.dataset.state = "walk";
    place(start.x, start.y, start.scale);
    walk.style.display = "block";
    // 첫 RAF 가 돌기 전까지도 합이 1이어야 한다 — 안 걸어 두면 처음 몇 프레임에
    // 동결 그림과 걷기가 둘 다 불투명하게 겹친다(A-310 실측 ~24ms).
    walk.style.opacity = "0";
    stack.querySelectorAll(".chogHome__part").forEach((el) => (el.style.visibility = "hidden"));

    // 첫 120ms — Name it 에 있던 그 그림을 같은 자리에 깔고, 걷기 첫 프레임과 겹쳐 넘긴다.
    // 없으면 걷기가 맨바닥에서 튀어나온다(A-310 지적 4). 합이 늘 1이라 빈 프레임이 없다.
    if (opts.startSrc) {
      handoff = document.createElement("img");
      handoff.className = "chogHome__handoff";
      handoff.src = opts.startSrc;
      const s2 = board.width / 1256;
      Object.assign(handoff.style, {
        position: "absolute",
        left: `${(startRect.left - board.left) / s2 / start.scale - start.x / start.scale}px`,
        top: `${(startRect.top - board.top) / s2 / start.scale - start.y / start.scale}px`,
        width: `${startRect.width / s2 / start.scale}px`,
        height: `${startRect.height / s2 / start.scale}px`,
        pointerEvents: "none",
      });
      root.append(handoff);
      onCleanup(() => handoff?.remove());
    }
    for (let i = 0; i < WALK_FRAMES; i += 1) {
      const pre = new Image();
      pre.src = `${DIR}/walk-${String(i).padStart(2, "0")}.png`;
    }
  } else {
    walk.style.display = "none";
    settle = 1;
    ready = true;
  }

  let last = 0;
  onFrame((now) => {
    if (destroyed) return false;
    const dt = last && !document.hidden ? Math.min(now - last, 50) : 0;
    last = now;

    if (walking) {
      walkElapsed += dt;
      const move = Math.max(0, walkElapsed - WALK_BLEND_MS);
      const u = Math.min(1, move / WALK_MOVE_MS);
      walk.src = `${DIR}/walk-${String(Math.floor(move / WALK_FPS_MS) % WALK_FRAMES).padStart(2, "0")}.png`;
      const blend = Math.min(1, walkElapsed / WALK_BLEND_MS);
      walk.style.opacity = String(blend);
      if (handoff) {
        handoff.style.opacity = String(1 - blend);
        if (blend >= 1) { handoff.remove(); handoff = null; }
      }
      // [A-614 repair] 위치/스케일 lerp 에만 앞선 곡선을 먹인다 — 위 walk.src/blend 는
      // 그대로 원래 선형 시간을 쓴다(프레임 순서·크로스페이드 타이밍 불변).
      const posU = pairConverge ? pairConvergenceEase(u) : u;
      place(
        lerp(start.x, CORNER_TX, posU),
        lerp(start.y, CORNER_TY, posU),
        lerp(start.scale, HOME_SCALE, posU),
      );
      if (walkElapsed >= WALK_TOTAL_MS) {
        walking = false;
        walk.style.display = "none";
        walk.style.removeProperty("opacity");
        if (handoff) { handoff.remove(); handoff = null; }
        stack.querySelectorAll(".chogHome__part").forEach((el) => el.style.removeProperty("visibility"));
        place(CORNER_TX, CORNER_TY, HOME_SCALE);
        root.dataset.state = "idle";
        ready = true;
        armIdle();
      }
      draw();
      return true;
    }

    if (tapCue && !tapCue.hidden) {
      if (tapCue.measure) measureTapCue();
      if (!reduced) {
        tapCue.t += dt;
        const f = tapCueFrame(tapCue.t);
        waveDeg = f.waveDeg;
        tapCue.label.style.opacity = String(f.labelOpacity);
        if (!f.entering && root.dataset.tapCue === "entering") root.dataset.tapCue = "shown";
      }
    }

    if (!reduced) {
      if (hopAge >= 0) {
        hopAge += dt;
        if (hopAge >= 420) hopAge = -1;
      }
      settle = Math.min(1, settle + dt / REST_MS);
      progress = clamp01(progress + (target > progress ? 1 : target < progress ? -1 : 0) * (dt / 650));
    }

    if (dozePhase === "dozing" && !document.hidden) {
      // 원본은 `setTimeout(step, 20)` 으로 **고정 20ms** 씩 전진한다. RAF 의 들쭉날쭉한
      // dt 를 그대로 넣으면 같은 시각에 다른 상태가 나와 `sampleDoze` 와 어긋난다.
      // 남는 시간은 쌓아 두었다가 다음에 쓴다(A-310 지적 6).
      dozeAccum += dt;
      while (dozeAccum >= SLEEP_STEP_MS) {
        dozeAccum -= SLEEP_STEP_MS;
        dozeElapsed += SLEEP_STEP_MS;
        dozeOut = advance(dozeState, dozeElapsed, SLEEP_STEP_MS);
      }
      if (dozeOut) drawSleep(dozeOut);
    }
    draw();
    return true;
  });

  // [A-359 §3] 카드소유상태 — 이 인스턴스의 pinned/open 카드를 즉시 닫는다. 화면
  // 전환(render() 의 innerHTML 교체)은 DOM 을 통째로 없애지만, 그건 "다음 그림"이 있고
  // 나서다 — 이 자리를 다른 카드(Send/Receipt)에게 넘기기 **직전**(main.js
  // homeChog.closeCard() 호출) 과 scene teardown(destroy) 양쪽에서 먼저 닫아, 겹치는
  // 프레임을 만들지 않는다. progress 를 0으로 즉시 내려 draw() 가 opacity 0 을 낸다
  // (기존 650ms easing 을 기다리지 않는다 — 소유권 이전은 즉시여야 한다).
  const closeCard = () => {
    // [A-624] 자리를 넘기는 순간 신호도 같이 치운다 — 다음 카드와 한 프레임도 겹치지 않게.
    hideTapCue();
    pinned = false;
    target = 0;
    progress = 0;
    hopAge = -1;
    if (pad) {
      pad.style.opacity = "0";
    }
  };

  onCleanup(() => {
    closeCard();
    destroyed = true;
    clearSleepTimers();
  });

  if (!startRect || reduced) armIdle();
  draw();

  return {
    get state() {
      return { ready, walking, progress, pinned, dozePhase, stage: dozeState.stage, asleep: dozeState.asleep };
    },
    // [A-624] 신호가 아직 등장 중인가 — main.js 첫 Journey 카드가 이 동안 기존 재시도 규율로 미룬다.
    get tapCueEntering() {
      return !!tapCue && !tapCue.hidden && !reduced && tapCue.t < TAP_CUE_TIMING.entranceMs;
    },
    // [A-626 A] 등장 + 완전 가시 유지(holdMs)까지 남은 신호 시간(ms). 신호 없음/치움/reduced = 0
    // (reduced 는 정착 즉시 정지 라벨이라 기존 1200ms 첫 카드 대기가 그대로 읽힘 창이다).
    get tapCueHoldRemainingMs() {
      if (!tapCue || tapCue.hidden || reduced) return 0;
      return Math.max(0, TAP_CUE_TIMING.readyMs - tapCue.t);
    },
    startTapCue,
    wake,
    hover: requestHover,
    closeCard,
    // 로컬 검토용 — 3분을 기다리지 않고 앉기/졸기 경로를 눈으로 보려고 쓴다.
    // 시간을 앞당길 뿐 수식은 그대로라, 이것만으로 실시간 PASS 를 주장하지 않는다.
    previewSit: sit,
  };
}

export const CHOG_HOME_GEOMETRY = {
  homeScale: HOME_SCALE,
  cornerTransform: { x: CORNER_TX, y: CORNER_TY },
  viewportLocal: VP,
  inkLocal: INK,
  inkBoard: { w: (INK.right - INK.left) * HOME_SCALE, h: (INK.bottom - INK.top) * HOME_SCALE },
  centerBoardX: 891,
  floorBoardY: 648,
  idleBox: IDLE_BOX,
  sleepBox: SLEEP_BOX,
  walk: { frames: WALK_FRAMES, blendMs: WALK_BLEND_MS, moveMs: WALK_MOVE_MS, fpsMs: WALK_FPS_MS, totalMs: WALK_TOTAL_MS },
  sleep: { idleMs: SLEEP_IDLE_MS, ...SLEEP_CFG, sitDropMs: SIT_DROP_MS, sitSettleMs: SIT_SETTLE_MS, stepMs: SLEEP_STEP_MS },
};
