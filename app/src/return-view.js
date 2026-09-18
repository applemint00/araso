// 귀환 씬의 **순수 화면 바인딩**. 앱(main.js)과 로컬 검토 하네스가 같은 이것을 쓴다.
// [A-322 교정 7] 하네스가 canvas 만 그려 보는 것으로는 DOM 연결의 증거가 되지 않는다.
//
// 이 파일은 돈에 대해 아무것도 모른다 — finance 는 전부 **주입**으로 받는다:
//   receiptRowsMarkup · name · onOpenFilebox · onError · isValid · schedule · mountHomeChog …
// main.js 를 테스트용으로 eval/재작성하지 않는다. 디버그 쿼리·가짜 done 전역 노출 0.

import { createReturnPlayback, RETURN_GEOMETRY } from "./piggy-return.js";

const BOARD_W = 1256;
const BOARD_H = 772;
const HOME_CENTER = 1041;   // Home 판의 Piggy 중심
const HOME_FLOOR = 648;     // Home 판의 바닥선

/**
 * 씬 markup. finance 문자열은 전부 인자로 받는다.
 * @param {{line:string, receiptRowsMarkup:string, name:string, devExtra?:string}} input
 */
export function returnSceneMarkup(input) {
  const { line = "", receiptRowsMarkup = "", name = "", devExtra = "" } = input;
  return `
    <section class="stage" data-scene="return">
      <canvas class="departStage" id="returnStage" aria-hidden="true"></canvas>
      <!-- [A-358 §2] #homeBoard 자체는 aria-hidden 을 걸지 않는다 — 안의 Chog hit(role=button)
           까지 AX 트리에서 빠진다. 장식 파츠는 chog-home.js 쪽에서 개별로 숨긴다. -->
      <div class="homeBoard" id="homeBoard">
        <div class="returnChogHop" id="returnChogHop">${input.homeChogMarkup || ""}</div>
        <span class="homeChar__name returnName" id="returnName" hidden>${name}</span>
      </div>
      <button class="returnTap" id="returnTap" type="button" hidden aria-label="Receipt">
        <span class="returnTap__rows" id="returnRows">${receiptRowsMarkup}</span>
      </button>
      <span class="returnTap__hint" id="returnHint" hidden></span>
      <button class="tiny returnOpen" id="returnOpen" type="button" hidden>open the file</button>
      <article class="note note--quiet"><p class="line" id="returnLine">${line}</p></article>
      ${devExtra}
    </section>
  `;
}

/**
 * 씬을 실제로 붙인다. 반환값으로 playback 을 돌려주어 검토가 같은 인스턴스를 본다.
 *
 * 주입:
 *  - root            : 씬이 들어간 컨테이너(document 기본)
 *  - isValid         : 이 인스턴스가 아직 유효한가(token 가드)
 *  - schedule        : RAF 등록기(앱의 runSceneFrames)
 *  - listen          : (target,type,handler,opts) 리스너 등록기 — cleanup 포함
 *  - onCleanup       : (fn) 정리 등록기
 *  - mountHomeChog   : (root, opts) → Home Chog 인스턴스. 이 파일은 Chog 를 모른다.
 *  - fitBoard        : () → {rect} Home 판 맞추기
 *  - reduced         : 모션 줄이기
 *  - play            : 이번 진입에서 재생할 것인가(transient 표)
 *  - onOpenFilebox   : 사용자가 파일을 열었다 — 기존 Receipt 읽기 기능으로
 *  - onError         : 자산 실패 — **정확히 한 번** 불린다
 *  - onIdleEnter     : 재생하지 않는 진입(새로고침·재방문)
 */
export function mountReturnView(opts) {
  const {
    root = document,
    isValid = () => true,
    schedule,
    listen = (t, y, h, o) => t.addEventListener(y, h, o),
    onCleanup = () => {},
    mountHomeChog,
    fitBoard = () => null,
    reduced = false,
    play = true,
    onOpenFilebox = () => {},
    openFileLabel = "open the file",
    onError = () => {},
    onIdleEnter = () => {},
    createPlayback = createReturnPlayback,
  } = opts;

  const $ = (id) => root.querySelector("#" + id);
  const canvas = $("returnStage");
  const board = $("homeBoard");
  const tapBtn = $("returnTap");
  const hint = $("returnHint");
  const openBtn = $("returnOpen");
  if (openBtn) openBtn.textContent = openFileLabel;
  const nameTag = $("returnName");
  const chogRoot = root.querySelector("#chogHome");
  // 알람 hop 과 숨김은 **바깥 wrapper** 에만 건다.
  // `#chogHome` 자신의 transform 은 chog-home.js 의 corner 배치다 — 덮으면 판 밖으로 나간다.
  const chogWrap = root.querySelector("#returnChogHop");

  // Home Chog — 수령 전의 소유자. 도착해 있는 idle 로만 붙인다(시작 모션 0).
  let homeChog = null;
  const fit0 = fitBoard();
  if (chogRoot && fit0 && mountHomeChog) {
    homeChog = mountHomeChog(chogRoot, { board: fit0.rect });
    onCleanup(() => { homeChog = null; });
  }
  if (!canvas) {
    listen(window, "resize", () => fitBoard());
    return null;
  }

  const fit = () => {
    const s = Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H);
    canvas.width = Math.round(BOARD_W * s * (window.devicePixelRatio || 1));
    canvas.height = Math.round(BOARD_H * s * (window.devicePixelRatio || 1));
    canvas.style.width = `${BOARD_W * s}px`;
    canvas.style.height = `${BOARD_H * s}px`;
    fitBoard();
  };
  fit();

  if (!play) { onIdleEnter(); return null; }

  // ---- 프레임마다 화면을 맞춘다 -----------------------------------------
  let lastFrame = null;
  let waiting = false;   // gate 대기 중인가 — 종이 카드가 읽히는 구간

  // [A-322 교정 2] 종이 버튼·글자·hitbox 는 renderer 가 준 board rect 를
  // canvas 의 실제 client rect 로 옮겨 놓는다. 중앙 고정값 0.
  function placePaper(meta) {
    if (!tapBtn) return;
    const p = meta && meta.paperBoard;
    // 종이가 손안의 작은 조각일 때는 카드(글자·hitbox)를 띄우지 않는다.
    // 읽을 수 있는 크기로 멈춰 선 gate 구간에서만 보인다.
    if (!p || !waiting) { tapBtn.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    const k = r.width / BOARD_W;
    tapBtn.hidden = false;
    tapBtn.style.left = `${r.left + p.x * k}px`;
    tapBtn.style.top = `${r.top + p.y * k}px`;
    tapBtn.style.width = `${p.w * k}px`;
    tapBtn.style.height = `${p.h * k}px`;
    // [A-348 §2] 보이는 종이(196px 내부 디자인폭)를 실제 hitbox(paperBoard — 1.18 확대 포함)
    // 안에 비율보존 contain-fit 으로 맞춘다. offsetWidth/Height 는 CSS transform 의 영향을
    // 받지 않는 레이아웃 값이라, 194px 류 상수를 다시 가정하지 않고 실제 렌더된 카드 크기를
    // 그대로 쓴다 — 종이·글자·teeth·hitbox 가 이 스케일 하나로 같이 움직인다.
    const paperEl = tapBtn.querySelector(".receiptPaper");
    if (paperEl) {
      const nw = paperEl.offsetWidth || 1;
      const nh = paperEl.offsetHeight || 1;
      // [A-352 §2] 종이는 rotate(-1.2deg)(완료) / rotate(2.4deg)(빈손, .receiptPaper--empty)
      // 를 이미 걸고 있다(style.css). contain-fit을 회전 전 nw/nh 로만 계산하면 실제 보이는
      // (회전 후) bbox 가 hitbox 를 넘는다 — 실측 gate1 hitbox117.80x134.63 vs paper
      // 118.53x137.14, gate2 hitbox139.01x158.87 vs paper139.87x161.82. 각도를 여기 다시
      // 상수로 박지 않고(캐릭터 모션 값과 달리 이건 "종이" 고유값이지만, 중복 0 을 위해) 현재
      // 적용된 transform 에서 그대로 읽는다 — scale(var(--paperScale)) 는 균등 스케일이라
      // atan2(b,a) 는 스케일과 무관하게 순수 회전각만 돌려준다.
      const m = new DOMMatrix(getComputedStyle(paperEl).transform);
      const theta = Math.atan2(m.b, m.a);
      const rw = Math.abs(nw * Math.cos(theta)) + Math.abs(nh * Math.sin(theta));
      const rh = Math.abs(nw * Math.sin(theta)) + Math.abs(nh * Math.cos(theta));
      const fit = Math.min((p.w * k) / rw, (p.h * k) / rh);
      paperEl.style.setProperty("--paperScale", String(fit > 0 ? fit : 1));
    }
    if (hint) {
      hint.style.left = `${r.left + (p.x + p.w / 2) * k}px`;
      hint.style.top = `${r.top + (p.y + p.h) * k + 8}px`;
    }
  }

  // [A-322 교정 1] 같은 화면에 Chog 는 언제나 **하나**다.
  //   t < 11.4 → Home DOM Chog 만 · t ≥ 11.4 → canvas native 만.
  function placeChog(meta) {
    if (!chogWrap) return;
    const owner = meta ? meta.chogOwner : "dom";
    chogWrap.hidden = owner !== "dom";
    if (owner !== "dom") { chogWrap.style.transform = ""; return; }
    // 원본 알람 hop(−5·sin, 무대 단위)을 현재 board 축척으로. 내부 transform 은 건드리지 않는다.
    const hop = (meta && meta.alertHop) || 0;
    chogWrap.style.transform = hop ? `translateY(${hop * RETURN_GEOMETRY.group.scale}px)` : "";
  }

  // [A-414-e] "문서 받기 전 checking 0" — Chog 옆 발화(main.js state.awayLine/
  // returnArrivalAlarm)는 지금까지 mount 즉시(정적 markup)로 판정돼 실제 손전달 이벤트와
  // 무관했다. piggy-return.js 는 매 프레임 이미 chogOwner 를 알려준다(dom→canvas 전환 =
  // Piggy 가 종이를 Chog 손에 넘기기 시작하는 시점, piggy-return.js:430 — 원본 stateAt phase
  // "Chog receives" 시작과 같은 t=11.4 경계, character_motion_confirmed_20260917/
  // reference-preview/return/renderer.js 의 같은 리터럴과 대조 완료). 그 순간을 한 번
  // 잡아 두면(아래 received) 화면 쪽(main.js)이 mount-time 정적 문구 대신 이 실제 수령
  // 신호로 checking/coming 발화를 켤 수 있다 — 이 파일은 문구 자체를 모른다(§1 계약).
  let received = false;
  function onFrame(meta) {
    lastFrame = meta;
    if (meta && meta.chogOwner === "canvas") received = true;
    placePaper(meta);
    placeChog(meta);
  }

  let filed = false;
  const playback = createPlayback({
    canvas, isValid, schedule, reduced, onFrame,
    onStatus: (st) => {
      const gateOpen = st.phase === "await-first-tap" || st.phase === "await-second-tap";
      // [A-352 §3] 첫 탭 확대(taps===1 && phase==="playing", t≈7.3~7.6s) 동안은 아직
      // 상호작용 게이트가 아니지만(둘째 탭은 ZOOM_DONE_S 이후에만 열린다 — piggy-return.js
      // tap() 그대로) DOM 종이는 계속 보여야 canvas 옛 종이로 바뀌지 않는다. 그래서 표시
      // 여부(waiting)와 상호작용 가능 여부(gateOpen)를 분리한다 — 게이트 자체는 안 넓힌다.
      const zooming = st.taps === 1 && st.phase === "playing";
      waiting = gateOpen || zooming;
      if (tapBtn) {
        tapBtn.disabled = !gateOpen;
        tapBtn.classList.toggle("is-live", gateOpen);
        if (!waiting) tapBtn.hidden = true;
      }
      placePaper(lastFrame);
      if (hint) {
        hint.hidden = !gateOpen;
        hint.textContent = st.phase === "await-first-tap" ? "Receipt"
          : st.phase === "await-second-tap" ? "File it" : "";
      }
      if (st.phase === "asset-missing" || st.phase === "asset-error") onError(st);
    },
    // [A-322 교정 3] 완료는 **정착**이다 — 화면을 갈아엎지 않는다.
    // Piggy 는 Home seat 에, Chog 는 파일 정리 끝자세에, 폴더와 함께 그대로 남는다.
    // 파일 열기는 사용자가 명시적으로 눌러야 일어난다.
    onFiled: () => {
      filed = true;
      if (tapBtn) { tapBtn.hidden = true; tapBtn.disabled = true; }
      if (hint) hint.hidden = true;
      if (nameTag) {
        nameTag.hidden = false;
        nameTag.style.left = `${HOME_CENTER - 60}px`;
        nameTag.style.top = `${HOME_FLOOR + 6}px`;
      }
      if (openBtn) openBtn.hidden = false;
    },
  });
  onCleanup(() => playback.stop());

  listen(window, "resize", () => { fit(); playback.redraw(); placePaper(lastFrame); });

  // ---- 입력 — 한 사용자 입력에 한 gate --------------------------------
  // [A-322 교정 6] click 과 keydown 을 둘 다 걸면 button 의 기본 활성화와 겹쳐
  // Enter 한 번이 두 gate 를 지날 수 있다. 눌린 키는 keydown 에서 삼키고,
  // 실제 진행은 click 한 곳에서만 한다. repeat(꾹 누름)은 무시한다.
  if (tapBtn) {
    listen(tapBtn, "keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.repeat) { e.preventDefault(); return; }   // 꾹 누름으로 두 gate 통과 0
      // 기본 활성화(click)가 뒤따르게 두고 여기서는 진행하지 않는다.
    });
    listen(tapBtn, "click", (e) => {
      e.preventDefault();
      if (filed) return;
      playback.tap();
    });
  }
  if (openBtn) listen(openBtn, "click", () => onOpenFilebox());

  playback.start();
  // [A-414-e] `received` — main.js 가 기존 `filed` 폴링(§mountReturn, runSceneFrames)과
  // 같은 방식으로 붙여 쓰는 게터다: true 가 되는 순간부터(문서가 실제로 Chog 손에 들어간
  // 뒤) "checking"/coming 발화를 켜고, 이미 있는 `filed` 로 끈다. mount 시점 정적 판정을
  // 대체하는 신호이지 문구 자체는 아니다 — 문구·타이밍 정책은 main.js 몫(계약 §1).
  return { playback, placePaper: () => placePaper(lastFrame), get lastFrame() { return lastFrame; },
           get received() { return received; }, get filed() { return filed; } };
}

// alarmBell — main.js chogHomeMarkupForReturn() 이 "발화는 알람 종보다 한 박자 늦게"
// (Owner GO, 채팅 2026-09-18)를 계산할 때 쓴다. main.js 는 piggy-return.js 를 직접
// import 하지 않는다(파일 header §1 계약, 이 파일이 유일한 창구) — 그래서 새 숫자를
// 만들지 않고 piggy-return.js RETURN_GEOMETRY.alarmBell(BELL_START_S/BELL_FADE_S 원본)을
// 그대로 다시 내보낸다.
export const RETURN_VIEW_GEOMETRY = {
  board: [BOARD_W, BOARD_H], homeCenter: HOME_CENTER, homeFloor: HOME_FLOOR,
  alarmBell: RETURN_GEOMETRY.alarmBell,
};
