// Name it 카드 — Owner 지정 정본 `AskNameIt.dc.html` (460×300 엽서, A-324).
// 원본은 비교 시트(1560×700)에 세 장을 나란히 놓은 것이다. 앱은 카드 **한 장** 안에서
// 도착(YOU'VE GOT) → 빈 Name it → 입력된 Name it 을 이어 간다. 새로 디자인하지 않는다.
// [A-407] 제목·got·ok/save 낱말은 원래 구워진 CJ PNG였다 — 실제 렌더 확인
// ("you've got"/"the one piggy !"/"name it?"/"ok"/"save", 모두 소문자) 결과 그대로
// Delicious Handrawn 실텍스트로 옮겼다(SHA/@font-face 는 style.css 상단). 입력 필드에
// 타이핑되는 이름 자체와 밑줄 path 는 Figma에 해당 노드가 없거나(입력 텍스트) 정확한
// path/수치가 아직 UNKNOWN(밑줄 4:685, NAME_FIGMA_TYPOGRAPHY_20260918.md)이라 그대로
// system-ui/기존 path 유지 — 추측 폰트로 바꾸지 않는다. 날짜만 동적 텍스트라 시스템
// serif 로 같은 자리에 쓴다.
// 이 파일은 앱(main.js)과 private 검토 하네스가 **같은 markup/mount** 를 쓰려고 분리했다.

const CARD_DIR = "/card";

// 원본 `#askink`(제목) · `#cb`(밑줄) 필터 — 값 그대로. `#btnink` 는 main.js 가 이미 싣는다.
const CARD_FILTERS = `
  <svg width="0" height="0" class="btnink-defs" aria-hidden="true" focusable="false">
    <defs>
      <filter id="askink" x="-15%" y="-15%" width="130%" height="130%">
        <feTurbulence type="fractalNoise" baseFrequency="0.10" numOctaves="3" seed="4" result="t"></feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="w"></feDisplacementMap>
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="t2"></feTurbulence>
        <feColorMatrix in="t2" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 4 0 0 0 -2.9" result="h"></feColorMatrix>
        <feComposite in="w" in2="h" operator="out"></feComposite>
      </filter>
      <filter id="cb" x="-25%" y="-25%" width="150%" height="150%">
        <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="5" result="n"></feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
      </filter>
    </defs>
  </svg>
`;

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 원본의 SEPTEMBER 16 / TUESDAY 는 견본이다. 같은 자리에 **오늘** 값을 쓴다.
export function nameCardDate(now = new Date()) {
  return {
    day: now.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase(),
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase(),
  };
}

// ButtonKit 3조각 122×40 (cap23 · mid76 반복 · cap23), 낱말 높이 20.
// [A-407] 낱말은 원래 구운 PNG(w_59c57b16a2.png="ok"/w_95e7321cc4.png="save")였다 —
// 종이 껍질(btn_l/r/m.png)·비율·바깥 그림자·label/disabled/click 은 그대로 두고 낱말만
// 실텍스트(.pkbtn__cj, Delicious Handrawn)로 바꾼다.
function cardButton({ cls, type, label, disabled = false }) {
  return `
    <button class="nameCard__btn pkbtn ${cls}" type="${type}" aria-label="${escapeAttr(label)}"${disabled ? " disabled" : ""}>
      <span class="pkbtn__shell" aria-hidden="true">
        <img class="pkbtn__cap pkbtn__cap--l" src="${CARD_DIR}/btn_l.png" alt="" />
        <span class="pkbtn__mid"></span>
        <img class="pkbtn__cap pkbtn__cap--r" src="${CARD_DIR}/btn_r.png" alt="" />
      </span>
      <span class="pkbtn__word pkbtn__cj" aria-hidden="true">${escapeAttr(label)}</span>
    </button>
  `;
}

// phase: "arrival"(도착 카드 + ok) | "name"(Name it + Save).
export function nameCardMarkup({ phase = "arrival", name = "", now = new Date() } = {}) {
  const date = nameCardDate(now);
  const value = escapeAttr(name);
  return `
    <div class="nameCard" id="nameCard" data-phase="${phase === "name" ? "name" : "arrival"}">
      ${CARD_FILTERS}
      <span class="nameCard__dot" aria-hidden="true"></span>
      <div class="nameCard__date" aria-hidden="true">
        <div class="nameCard__day">${date.day}</div>
        <div class="nameCard__weekday">${date.weekday}</div>
      </div>
      <div class="nameCard__got" aria-label="you've got">
        <span class="nameCard__gotLine">you've got</span>
        <span class="nameCard__gotLine">the one piggy !</span>
      </div>
      <div class="nameCard__title">
        <span class="nameCard__titleText">name it?</span>
      </div>
      <div class="nameCard__ok">
        ${cardButton({ cls: "nameCard__okBtn", type: "button", label: "ok" })}
      </div>
      <form class="nameCard__form" id="nameForm">
        <label class="nameCard__field">
          <span class="sr-only">Piggy name</span>
          <input id="piggyNameInput" name="piggyName" maxlength="24" autocomplete="off" value="${value}" />
          <!-- Owner 원본 Name 입력선 SVG, inline 이식.
               출처: <local>
                 scene-card-handoff/typography-20260918/name/assets/name-underline-original.svg
               sha256: 5882fd1f24f138684e97c6451f72211b85ac97e265f9c8efaccabb32f264a950
               색만 변경(color only changed) — stroke white → 카드 기존 잉크 #141210(위 line 94 이전
               버전과 동일 표기). path/stroke-width6/round cap·join/drop-shadow filter/viewBox
               "0 0 364 20"/종횡비는 원본 그대로 보존, 재유도 없음. 카드 외곽 460×300·field
               224px 폭에 맞춰 width/height 속성으로 단 한 번만 비례 축소(224 : 224*20/364).
               정확한 title font-size/line-height 는 이 교체와 별개로 여전히 UNKNOWN. -->
          <svg class="nameCard__line" width="224" height="12.30769" viewBox="0 0 364 20" aria-hidden="true">
            <g id="Vector 1" filter="url(#filter0_d_4_685)">
              <path d="M7.00006 6.48663C7.12408 6.49001 9.61704 5.97081 41.3694 5.87377C70.6961 5.78414 126.837 7.68218 157.26 8.20797C190.679 8.78554 194.632 7.99598 196.464 7.96819C201.332 7.89436 206.524 7.55755 211.686 7.39265C227.139 6.89898 248.335 7.2937 252.022 7.16114C260.183 6.8677 277.488 6.16731 285.9 5.73406C295.371 5.24627 300.065 4.65218 313.909 4.76359C321.292 4.82302 327.986 3.77582 332.452 3.43589C336.973 3.12438 342.564 3.19519 347.142 3.13009C349.751 3.09286 352.939 3.04712 356.225 2.99998" stroke="#141210" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
            </g>
            <defs>
              <filter id="filter0_d_4_685" x="0" y="0" width="363.225" height="19.4184" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                <feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood>
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix>
                <feOffset dy="4"></feOffset>
                <feGaussianBlur stdDeviation="2"></feGaussianBlur>
                <feComposite in2="hardAlpha" operator="out"></feComposite>
                <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"></feColorMatrix>
                <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_4_685"></feBlend>
                <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_4_685" result="shape"></feBlend>
              </filter>
            </defs>
          </svg>
        </label>
        <div class="nameCard__save">
          ${cardButton({ cls: "nameScene__save", type: "submit", label: "save", disabled: !name.trim() })}
        </div>
      </form>
    </div>
  `;
}

// 카드 안의 상태만 잇는다. 저장·씬 전환은 부르는 쪽(onSubmit) 몫이다.
// listen(target, type, fn) 은 씬 lifecycle 의 리스너 등록기를 그대로 받는다.
export function mountNameCard(root, { listen, onSubmit, focus = true } = {}) {
  const card = root?.querySelector("#nameCard");
  if (!card) return null;
  const on = listen || ((t, type, fn) => t.addEventListener(type, fn));
  const input = card.querySelector("#piggyNameInput");
  const save = card.querySelector(".nameScene__save");
  const ok = card.querySelector(".nameCard__okBtn");
  const form = card.querySelector("#nameForm");

  // [A-415 item2] Owner 확정 시퀀스의 첫 프레임("Piggy 서 있음") — 첫 해치 직후
  // (data-phase="arrival")에만, style.css 의 카드-뒤-웅크림 baseline(translateX(-36px))
  // 으로 슬라이드해 들어가기 전 한 박자 세워 둔다. 새 포즈/새 자산 0 — 같은 frozen
  // peek 프레임의 위치만 다르다(`.nameScene__piggy.is-standing`, style.css). 이름
  // 미완 복귀(phase="name", `.nameScene.is-hidden`)에는 붙이지 않는다 — 그 경로는
  // Save 전까지 계속 숨어 있어야 한다(Owner 명세: 이름 결정 전 표시 0).
  if (card.dataset.phase === "arrival") {
    const piggy = root.querySelector(".nameScene__piggy");
    if (piggy) {
      piggy.classList.add("is-standing");
      setTimeout(() => {
        if (piggy.isConnected) piggy.classList.remove("is-standing");
      }, 260);
    }
  }

  const sync = () => {
    if (!save || !input) return;
    // 저장 진행 중(입력 잠김)이면 버튼을 다시 켜지 않는다 — Save 단일 실행.
    if (input.disabled) return;
    save.disabled = !input.value.trim();
  };
  const showName = () => {
    card.dataset.phase = "name";
    sync();
    if (focus) input?.focus();
  };

  if (input) on(input, "input", sync);
  if (ok) on(ok, "click", showName);
  if (form && onSubmit) on(form, "submit", onSubmit);
  sync();
  if (card.dataset.phase === "name" && focus) input?.focus();
  return { card, input, save, showName, sync };
}
