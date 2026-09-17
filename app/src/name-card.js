// Name it 카드 — Owner 지정 정본 `AskNameIt.dc.html` (460×300 엽서, A-324).
// 원본은 비교 시트(1560×700)에 세 장을 나란히 놓은 것이다. 앱은 카드 **한 장** 안에서
// 도착(YOU'VE GOT) → 빈 Name it → 입력된 Name it 을 이어 간다. 새로 디자인하지 않는다.
// 제목·버튼 낱말은 구워진 PNG(원본 assets/ 에서 최대 2x 로 줄인 사본)이고, 웹폰트는
// 싣지 않는다. 날짜만 동적 텍스트라 시스템 serif 로 같은 자리에 쓴다.
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
function cardButton({ cls, type, label, word, disabled = false }) {
  return `
    <button class="nameCard__btn pkbtn ${cls}" type="${type}" aria-label="${label}"${disabled ? " disabled" : ""}>
      <span class="pkbtn__shell" aria-hidden="true">
        <img class="pkbtn__cap pkbtn__cap--l" src="${CARD_DIR}/btn_l.png" alt="" />
        <span class="pkbtn__mid"></span>
        <img class="pkbtn__cap pkbtn__cap--r" src="${CARD_DIR}/btn_r.png" alt="" />
      </span>
      <img class="pkbtn__word" src="${CARD_DIR}/${word}" alt="" aria-hidden="true" />
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
      <div class="nameCard__got" aria-label="You've got">
        <img src="${CARD_DIR}/t_got_1_cj.png" alt="" />
        <img src="${CARD_DIR}/t_got_2_cj.png" alt="" />
      </div>
      <div class="nameCard__title">
        <img src="${CARD_DIR}/t_name_it_cj.png" alt="Name it" />
      </div>
      <div class="nameCard__ok">
        ${cardButton({ cls: "nameCard__okBtn", type: "button", label: "ok", word: "w_59c57b16a2.png" })}
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
          ${cardButton({ cls: "nameScene__save", type: "submit", label: "save", word: "w_95e7321cc4.png", disabled: !name.trim() })}
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
