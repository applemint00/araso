// 귀환 씬의 **순수 화면 바인딩**. 앱(main.js)과 로컬 검토 하네스가 같은 이것을 쓴다.
// [A-322 교정 7] 하네스가 canvas 만 그려 보는 것으로는 DOM 연결의 증거가 되지 않는다.
//
// 이 파일은 돈에 대해 아무것도 모른다 — finance 는 전부 **주입**으로 받는다:
//   receiptRowsMarkup · name · onOpenFilebox · onError · isValid · schedule · mountHomeChog …
// main.js 를 테스트용으로 eval/재작성하지 않는다. 디버그 쿼리·가짜 done 전역 노출 0.

import { createReturnPlayback, RETURN_GEOMETRY } from "./piggy-return.js";

// [A-768 M-T-1] 사용자가 정한 Piggy 이름은 markup 에 넣기 전에 escape 한다(main.js escapeHtml 과 같은 규칙) — 보이는 글자는 같다.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const BOARD_W = 1256;
const BOARD_H = 772;
const HOME_CENTER = 1041;   // Home 판의 Piggy 중심
const HOME_FLOOR = 648;     // Home 판의 바닥선
// [A-891 UI-19] the First-filing label (accessible name only now) and the drawn folder's rect in the Return group (stage) units —
// the literal piggy-return.js draws (`folderRect = [580, 632, 130, 100]`, enterGroup() = board → group via RETURN_GEOMETRY.group).
const OPEN_FILE_LABEL = "open the file";
const FOLDER_STAGE_RECT = [580, 632, 130, 100];

/**
 * 씬 markup. finance 문자열은 전부 인자로 받는다.
 * @param {{line:string, receiptRowsMarkup:string, name:string, devExtra?:string}} input
 */
export function returnSceneMarkup(input) {
  const { line = "", receiptRowsMarkup = "", name = "", devExtra = "" } = input;
  return `
    <section class="stage" data-scene="return">
      <canvas class="departStage" id="returnStage" aria-hidden="true"></canvas>
      <!-- #homeBoard 자체는 aria-hidden 을 걸지 않는다 — 안의 Chog hit(role=button)
           까지 AX 트리에서 빠진다. 장식 파츠는 chog-home.js 쪽에서 개별로 숨긴다. -->
      <div class="homeBoard" id="homeBoard">
        <div class="returnChogHop" id="returnChogHop">${input.homeChogMarkup || ""}</div>
        <span class="homeChar__name returnName" id="returnName" hidden>${escapeHtml(name)}</span>
      </div>
      <button class="returnTap" id="returnTap" type="button" hidden aria-label="Receipt">
        <span class="returnTap__rows" id="returnRows">${receiptRowsMarkup}</span>
      </button>
      <span class="returnTap__hint" id="returnHint" hidden></span>
      <button class="tiny returnOpen" id="returnOpen" type="button" hidden></button>
      <!-- 결과 모션 skip. 문구·클래스·자리 전부 hatch 의 승인된 skip 과 같은 것을
           재사용한다(새 카피·새 수치 0). 첫 결과에서는 숨고, 그 뒤 Return 에서만 보인다. -->
      <button class="tiny skip" id="returnSkip" type="button" hidden>skip</button>
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
 *  - getReceiptRail  : [A-681] 모바일 전용 — () → Receipt 왼쪽 CONTENT rail 뷰포트 px 사실 | null
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
    openFileLabel = OPEN_FILE_LABEL,
    onError = () => {},
    onIdleEnter = () => {},
    // [A-466] 이 진입에서 skip 을 보여도 되는가. 판단(첫 결과인지)은 바깥이 한다 — 이 파일은
    // 금융도 저장소도 모른다(기존 경계 유지).
    allowSkip = false,
    createPlayback = createReturnPlayback,
    // [A-681] Mobile (<=640) only: () => viewport-px Receipt rail facts | null. Passed straight
    // through to the playback; this file still knows nothing about the rail's geometry, and
    // placePaper() below is untouched — it keeps re-measuring the ACTUAL rendered paper rect.
    getReceiptRail = null,
  } = opts;

  const $ = (id) => root.querySelector("#" + id);
  const canvas = $("returnStage");
  const board = $("homeBoard");
  const tapBtn = $("returnTap");
  const hint = $("returnHint");
  const openBtn = $("returnOpen");
  const skipBtn = $("returnSkip");
  // [A-891 UI-19] First filing ("open the file", the default label): the visible helper text is removed — the drawn folder itself
  // is the affordance. #returnOpen stays (same id, same click → onOpenFilebox); it only loses its text and sits over the folder
  // (placeFolderHit below). Its accessible name keeps the old words. Other labels (Second "Home") are unchanged.
  // pre-A-891 baseline: `openBtn.textContent = openFileLabel` for every label.
  const folderOpen = openFileLabel === OPEN_FILE_LABEL;
  if (openBtn) {
    if (folderOpen) {
      openBtn.textContent = "";
      openBtn.setAttribute("aria-label", openFileLabel);
      openBtn.classList.add("returnOpen--folder");
    } else {
      openBtn.textContent = openFileLabel;
    }
  }
  const nameTag = $("returnName");
  const chogRoot = root.querySelector("#chogHome");
  // 알람 hop 과 숨김은 **바깥 wrapper** 에만 건다.
  // `#chogHome` 자신의 transform 은 chog-home.js 의 corner 배치다 — 덮으면 판 밖으로 나간다.
  const chogWrap = root.querySelector("#returnChogHop");
  if (chogWrap) chogWrap.style.translate = `0px ${RETURN_GEOMETRY.chogDrop || 0}px`; // [A-920 item 3] same drop as placeChog() below, set before the first frame

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

  // [A-656 decision 4] Mobile/mid-band: the canvas (Piggy + Receipt/portal choreography) is
  // resized/repositioned with the SAME A-607 canon-K formula the First Job work canvas uses
  // (main.js), instead of `.departStage`'s plain centered fit — so Piggy's filed seat lands on
  // the exact Home foot on mobile and mid-band, not just the DOM Chog/name (`fitBoard()`, wired
  // in main.js's mountReturn()/mountSecondReturn(), already wraps #returnChogHop/#returnName and
  // returns `{ ...fit, floor }`, floor = null when neither applies — a strict no-op there, byte-
  // identical to the pre-A-656 plain fit, e.g. every measured web width).
  const fit = () => {
    const s = Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H);
    const info = fitBoard();
    const floor = info && info.floor;
    if (floor) {
      const k = floor.k;
      const left = info.left + s * HOME_CENTER * (1 - k) + floor.nudgeViewportX;
      const top = info.top + s * HOME_FLOOR * (1 - k) + floor.nudgeViewportY;
      const effW = BOARD_W * s * k;
      const effH = BOARD_H * s * k;
      canvas.width = Math.round(effW * (window.devicePixelRatio || 1));
      canvas.height = Math.round(effH * (window.devicePixelRatio || 1));
      canvas.style.width = `${effW}px`;
      canvas.style.height = `${effH}px`;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.transform = "none";
    } else {
      // Desktop / floor-not-active: unchanged simple centered fit (`.departStage`'s own CSS
      // left:50%/top:50%/translate(-50%,-50%) applies whenever these inline overrides are
      // cleared — same as every pre-A-656 width).
      canvas.style.left = "";
      canvas.style.top = "";
      canvas.style.transform = "";
      canvas.width = Math.round(BOARD_W * s * (window.devicePixelRatio || 1));
      canvas.height = Math.round(BOARD_H * s * (window.devicePixelRatio || 1));
      canvas.style.width = `${BOARD_W * s}px`;
      canvas.style.height = `${BOARD_H * s}px`;
    }
  };
  fit();

  if (!play) { onIdleEnter(); return null; }

  // ---- 프레임마다 화면을 맞춘다 -----------------------------------------
  let lastFrame = null;
  let waiting = false;   // gate 대기 중인가 — 종이 카드가 읽히는 구간

  // [A-322 교정 2] 종이 버튼·글자·hitbox 는 renderer 가 준 board rect 를
  // canvas 의 실제 client rect 로 옮겨 놓는다. 중앙 고정값 0.
  // [A-666 OWNER CORRECTION — RECEIPT TEXT MUST ALSO SCALE] 애니메이션 목표 중심/위치(p,
  // renderer 의 paperBoard)는 그대로 둔다 — Return 기하·게이트 타이밍 전부 무변경. 전에는
  // `#returnTap` 자신을 이 목표 박스(p.x/p.y/p.w/p.h) 그대로 놓고, 그 안에서 종이를
  // contain-fit(--paperScale)으로 줄여 넣기만 했다 — 모바일 글자 확대로 종이의
  // 내용-기반 자연 높이(nh)가 커지면 contain-fit 비율이 바뀌어 실제 그려지는(회전+스케일된)
  // 종이 바깥 테두리가 이 목표 박스 가장자리에서 떨어진다(한 축에 여유가 남는다) — 그만큼
  // `#returnTap`(히트박스)과 실제 보이는 종이가 어긋났다. 고치는 자리: --paperScale 을
  // 정한 "다음" 에 종이의 실제 렌더된 rect(getBoundingClientRect — 회전·스케일 다 반영된
  // 값)를 **다시 읽어** `#returnTap` 을 그 rect 에 맞춰 다시 앉힌다. `.returnTap__rows`
  // (style.css) 가 `#returnTap` 안에서 종이를 flex 로 가운데 정렬하므로, 종이의 중심은
  // 이 재배치 전후로 같다(원래 목표 박스의 중심 그대로) — 바뀌는 것은 눈에 안 보이는 버튼
  // 테두리뿐, 종이 자신의 위치·회전·애니메이션 경로는 전혀 건드리지 않는다.
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
      // [A-666 OWNER CORRECTION] --paperScale 을 막 바꿨으니 getBoundingClientRect() 는
      // 그 값을 반영한 레이아웃을 강제로(동기) 다시 계산해 돌려준다 — 그 실제 rect 로
      // `#returnTap` 자신을 다시 앉힌다. 종이는 위 flex 중앙정렬로 원래 목표 박스
      // 한가운데 그대로 있으므로, 이 재배치는 중심을 옮기지 않고 테두리만 실제 그려진
      // 크기에 맞춘다.
      const paperRect = paperEl.getBoundingClientRect();
      if (paperRect.width > 0 && paperRect.height > 0) {
        tapBtn.style.left = `${paperRect.left}px`;
        tapBtn.style.top = `${paperRect.top}px`;
        tapBtn.style.width = `${paperRect.width}px`;
        tapBtn.style.height = `${paperRect.height}px`;
      }
    }
    if (hint) {
      hint.style.left = `${r.left + (p.x + p.w / 2) * k}px`;
      hint.style.top = `${r.top + (p.y + p.h) * k + 8}px`;
    }
  }

  // [A-891 UI-19] The folder hit: the drawn folder's viewport rect (same canvas-rect × k mapping as placePaper()). Only after filing.
  function placeFolderHit() {
    if (!openBtn || !folderOpen || openBtn.hidden) return;
    const r = canvas.getBoundingClientRect();
    const k = r.width / BOARD_W;
    const g = RETURN_GEOMETRY.group;
    const [fx, fy, fw, fh] = FOLDER_STAGE_RECT;
    openBtn.style.left = `${r.left + (g.dx + fx * g.scale) * k}px`;
    openBtn.style.top = `${r.top + (g.dy + fy * g.scale) * k}px`;
    openBtn.style.width = `${fw * g.scale * k}px`;
    openBtn.style.height = `${fh * g.scale * k}px`;
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
    // [A-920 item 3] the Return Chog stands RETURN_GEOMETRY.chogDrop board units below the Home floor line (mock img_25-27); the CSS individual `translate` composes with the hop transform above.
    chogWrap.style.translate = `0px ${RETURN_GEOMETRY.chogDrop || 0}px`;
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

  // [A-681 D] Rendered-paper aspect for the mobile rail target (see piggy-return.js receiptRailTarget).
  // Measured once from the real `.receiptPaper` (rotated bbox of its natural layout size — the exact
  // quantities placePaper() contain-fits), briefly un-hiding #returnTap (sync layout, restored before
  // any paint). The rail path only; getReceiptRail === null leaves everything untouched.
  let paperAspect = 0;
  const measurePaperAspect = () => {
    if (paperAspect > 0) return paperAspect;
    const el = tapBtn && tapBtn.querySelector(".receiptPaper");
    if (!el) return 0;
    const wasHidden = tapBtn.hidden;
    tapBtn.hidden = false;
    const nw = el.offsetWidth, nh = el.offsetHeight;
    const m = new DOMMatrix(getComputedStyle(el).transform);
    tapBtn.hidden = wasHidden;
    if (!(nw > 0 && nh > 0)) return 0;
    const th = Math.atan2(m.b, m.a);
    const rw = Math.abs(nw * Math.cos(th)) + Math.abs(nh * Math.sin(th));
    const rh = Math.abs(nw * Math.sin(th)) + Math.abs(nh * Math.cos(th));
    paperAspect = rw / rh;
    return paperAspect;
  };
  const railWithPaperAspect = getReceiptRail ? () => {
    const r = getReceiptRail();
    if (!r) return r;
    const a = measurePaperAspect();
    return a > 0 ? { ...r, paperAspect: a } : r;
  } : null;

  let filed = false;
  const playback = createPlayback({
    canvas, isValid, schedule, reduced, onFrame, getReceiptRail: railWithPaperAspect,
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
      if (st.phase === "asset-missing" || st.phase === "asset-error") {
        if (skipBtn) skipBtn.hidden = true;   // [A-466] 실패에서는 skip 을 내린다
        onError(st);
      }
    },
    // [A-322 교정 3] 완료는 **정착**이다 — 화면을 갈아엎지 않는다.
    // Piggy 는 Home seat 에, Chog 는 파일 정리 끝자세에, 폴더와 함께 그대로 남는다.
    // 파일 열기는 사용자가 명시적으로 눌러야 일어난다.
    onFiled: () => {
      filed = true;
      if (skipBtn) skipBtn.hidden = true;   // [A-466] 끝났으면 skip 도 내린다
      if (tapBtn) { tapBtn.hidden = true; tapBtn.disabled = true; }
      if (hint) hint.hidden = true;
      if (nameTag) {
        nameTag.hidden = false;
        nameTag.style.left = `${HOME_CENTER - 60}px`;
        nameTag.style.top = `${HOME_FLOOR + 6}px`;
      }
      if (openBtn) openBtn.hidden = false;
      placeFolderHit(); // [A-891 UI-19]
    },
  });
  onCleanup(() => playback.stop());

  listen(window, "resize", () => { fit(); playback.redraw(); placePaper(lastFrame); placeFolderHit(); });

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
  // [A-466] skip — 이미 들어온 Return 씬의 **재생만** 끝으로 보낸다. Away→Return 전환을
  // 만들지 않고(여기는 이미 Return 이다), tx/영수증/권한도 건드리지 않는다.
  // 자산 실패 phase 에서는 playback.skip() 자신이 아무 일도 하지 않는다(성공 위장 0).
  if (skipBtn && allowSkip) {
    skipBtn.hidden = false;
    listen(skipBtn, "click", (e) => {
      e.preventDefault();
      if (filed) return;
      skipBtn.hidden = true;
      playback.skip();
    });
  }

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
