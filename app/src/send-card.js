// Send 카드 — 정본 `SendCard.dc.html` (canvas/onboarding_scenes_20260916, A-336).
// 원본은 380×560 종이 한 장에 세 상태(No rule yet / Ready / Cannot go)를 나란히 그린 비교
// 시트다. 세 상태 모두 아직 없는 세컨드 저니(JIT 칩·규칙·금액 입력)를 전제로 한 **견본**이라
// 그대로 옮기지 않는다 — 여기서 옮기는 것은 종이 껍질(점·날짜·제목·버튼)과 치수뿐이고,
// 안의 내용은 현재 첫 Journey(main.js renderSendStay)의 **실제** message/detail/address/
// terms(up to $5 등)로 채운다. 새 규칙·금액 칸·Permission UI는 만들지 않는다(A-336 §5).
//
// 제목("send")은 원본 `assets/t_send_cj.png`를 표시 30px 기준 2x(89×60)로 줄인 사본이다.
// 웹폰트는 싣지 않는다 — 동적 텍스트(메시지·약관·날짜)는 시스템 serif 로 같은 자리에 쓴다.
//
// Send/Stay 버튼은 기존 main.js 의 sendButton/stayButton id 를 그대로 쓴다 — 클릭 배선은
// main.js render() 가 이미 하고 있고, 여기서는 마크업만 만든다. checkButton(하단 tiny 버튼)은
// 카드 밖에 그대로 둔다 — 이 카드의 일부가 아니다.

const CARD_DIR = "/card";

// [A-377 §7] cb/ck 는 AskCard/second-journey-view.js 가 이미 쓰는 크레용 체크박스 필터와
// 같은 값이다(NOTES_explore_page.md §3 정본) — id 만 이 파일 전용으로 네임스페이스
// (a377-*, second-journey-view.js 의 a373-* 관례와 같다. 같은 시점에 한 씬만 #app 에
// 올라가므로 충돌은 없지만 관례를 맞춘다).
const SEND_FILTERS = `
  <svg width="0" height="0" class="btnink-defs" aria-hidden="true" focusable="false">
    <defs>
      <filter id="askink" x="-15%" y="-15%" width="130%" height="130%">
        <feTurbulence type="fractalNoise" baseFrequency="0.10" numOctaves="3" seed="4" result="t"></feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="w"></feDisplacementMap>
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="t2"></feTurbulence>
        <feColorMatrix in="t2" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 4 0 0 0 -2.9" result="h"></feColorMatrix>
        <feComposite in="w" in2="h" operator="out"></feComposite>
      </filter>
      <filter id="a377-cb" x="-25%" y="-25%" width="150%" height="150%">
        <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="5" result="n"></feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
      </filter>
      <filter id="a377-ck" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="9" result="n"></feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
      </filter>
    </defs>
  </svg>
`;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Reusable ButtonKit paper button for cards that need a primary action.
// Keep the existing asset/shell; callers supply the semantic label and id.
export function sendCardButtonMarkup({ id, label, disabled = false, className = "" } = {}) {
  return `
    <button class="sendCard__btn pkbtn ${className}" id="${escapeHtml(id)}" type="button" aria-label="${escapeHtml(label)}"${disabled ? " disabled" : ""}>
      <span class="pkbtn__shell" aria-hidden="true">
        <img class="pkbtn__cap pkbtn__cap--l" src="${CARD_DIR}/btn_l.png" alt="" />
        <span class="pkbtn__mid"></span>
        <img class="pkbtn__cap pkbtn__cap--r" src="${CARD_DIR}/btn_r.png" alt="" />
      </span>
      <span class="pkbtn__word pkbtn__text" aria-hidden="true">${escapeHtml(label)}</span>
    </button>
  `;
}

// 원본 SEPTEMBER 16 / 16 은 견본이다. 같은 자리에 오늘 값을 쓴다(name-card.js 의
// nameCardDate 와 같은 방법 — 웹폰트 없이 시스템 serif).
export function sendCardDate(now = new Date()) {
  return {
    day: now.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase(),
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase(),
    // [A-356 §5 / A-354-c] 이 자리는 getDate() 였고 "출발 횟수"로 잘못 읽혔다. 실제 출발
    // count 필드가 앱에 없어 임의로 만들거나 늘리지 않는다 — 데이터 연결 미정, 자리만
    // "—" 로 둔다(A356_SCENE_HANDOFF §5).
    dom: "—",
  };
}

// [A-377 §7] 체크박스 줄 하나 — AskCard/second-journey-view.js 의 크레용 체크 마크
// (§3 잉크 필터 정본) 그대로, 항상 체크된 상태로만 그린다. 이 카드에서 이 표시는
// "이미 합의된 실제 조건"을 보여주는 것뿐이고, 새 입력이 아니다 — 눌러서 켜고 끄는
// <input> 이 아니다(§7 "체크표시는 기존 실제 Permission 의미를 넘어 새권한을 부여하지
// 않는다"). 원본 13px/1.2 체크행 기준.
function sendCardTermRowMarkup(term) {
  return `
    <div class="sendCard__termRow">
      <svg class="sendCard__termCheckbox" viewBox="0 0 34 34" aria-hidden="true">
        <g class="sendCard__termBoxInk"><path d="M5 6 L29 4 L30 29 L4 30 Z" /></g>
        <g class="sendCard__termCheckInk"><path d="M8 18 L15 26 L28 6" /></g>
      </svg>
      <span class="sendCard__termLabel">${escapeHtml(term)}</span>
    </div>
  `;
}

// 카드 안에서 실제로 보여줄 것 — sendstay 화면의 진짜 사실 셋:
//   message  state.message (h1 자리였던 것) — 원본 13px/1.35 "설명" 자리(§7).
//   detail   state.detail  (있을 때만)
//   address  state.address (있을 때만)
//   terms    지금 실제로 유효한 약관 3줄 — "up to $5" 등, 견본 문구로 바꾸지 않는다.
//            체크박스 줄(원본 13px/1.2)에 정렬한다 — 옛 밋밋한 <ul><li> 대신.
//   blocked  rpId 밖이면 Send 를 잠근다.
export function sendCardMarkup({
  message = "",
  detail = "",
  address = "",
  terms = [],
  blocked = false,
  now = new Date(),
} = {}) {
  const date = sendCardDate(now);
  return `
    <div class="sendCard" id="sendCard">
      ${SEND_FILTERS}
      <span class="sendCard__dot" aria-hidden="true"></span>
      <div class="sendCard__date" aria-hidden="true">
        <div class="sendCard__day">${date.day}</div>
        <div class="sendCard__weekday">${date.weekday}</div>
      </div>
      <div class="sendCard__dom" aria-hidden="true">${date.dom}</div>
      <div class="sendCard__title">
        <img src="${CARD_DIR}/t_send_cj.png" alt="Send" />
      </div>
      ${message ? `<p class="sendCard__message">${escapeHtml(message)}</p>` : ""}
      ${
        terms.length
          ? `<div class="sendCard__terms">${terms.map((t) => sendCardTermRowMarkup(t)).join("")}</div>`
          : ""
      }
      ${
        detail || address
          ? `<div class="sendCard__meta">
              ${detail ? `<p class="sendCard__detail">${escapeHtml(detail)}</p>` : ""}
              ${address ? `<p class="sendCard__address">${escapeHtml(address)}</p>` : ""}
            </div>`
          : ""
      }
      <div class="sendCard__footer">
        <div class="sendCard__rule" aria-hidden="true"></div>
        <div class="sendCard__footerRow">
          <button class="sendCard__stay" id="stayButton" type="button">stay home</button>
          <button class="sendCard__btn pkbtn sendCard__send" type="button" id="sendButton" aria-label="send"${blocked ? " disabled" : ""}>
            <span class="pkbtn__shell" aria-hidden="true">
              <img class="pkbtn__cap pkbtn__cap--l" src="${CARD_DIR}/btn_l.png" alt="" />
              <span class="pkbtn__mid"></span>
              <img class="pkbtn__cap pkbtn__cap--r" src="${CARD_DIR}/btn_r.png" alt="" />
            </span>
            <img class="pkbtn__word" src="${CARD_DIR}/w_81da636da2.png" alt="" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  `;
}
