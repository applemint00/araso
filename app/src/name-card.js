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
          <svg class="nameCard__line" width="224" height="6" viewBox="0 0 224 6" aria-hidden="true">
            <path d="M1 3.4 Q 67 1.2 134 4 T 222 3" fill="none" stroke="#141210" stroke-width="2.0" stroke-linecap="round" filter="url(#cb)"></path>
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
