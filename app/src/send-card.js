// Send 카드 — 정본 `SendCard.dc.html` (canvas/onboarding_scenes_20260916, A-336).
// 원본은 380×560 종이 한 장에 세 상태(No rule yet / Ready / Cannot go)를 나란히 그린 비교
// 시트다. 세 상태 모두 아직 없는 세컨드 저니(JIT 칩·규칙·금액 입력)를 전제로 한 **견본**이라
// 그대로 옮기지 않는다 — 여기서 옮기는 것은 종이 껍질(점·날짜·제목·버튼)과 치수뿐이고,
// 안의 내용은 현재 첫 Journey(main.js renderSendStay)의 **실제** message/detail/address/
// terms(up to $5 등)로 채운다. 새 규칙·금액 칸·Permission UI는 만들지 않는다(A-336 §5).
//
// [A-407] 제목은 원본 `assets/t_send_cj.png`(실제 렌더 확인: "send?", 소문자+물음표)였다 —
// Delicious Handrawn 실텍스트로 옮긴다(SHA/@font-face 는 style.css 상단). 동적 텍스트
// (메시지·약관·날짜)는 그대로 시스템 serif 로 같은 자리에 쓴다 — 바꾸지 않는다.
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
//
// [A-415-c] 체크행 밑줄(물결선) 복원 — Owner 제공 원본 SVG,
// 감독 보존본 `.../scene-card-handoff/assets/send-checklist-underline-original.svg` 그대로
// path/viewBox(0 0 86 6)/stroke(#141210 1.6 round-cap) 불변 이식. 원본의 clipPath
// (id clip0_2_427)는 rect 가 viewBox 와 정확히 같은 86×6 라 시각 효과가 없고, 여러 term
// 행에 반복되면 id 가 중복돼 무효 HTML이 되므로 드롭한다(시각 차이 없음 — SVG 루트는
// 기본적으로 자기 뷰포트로 clip 됨). 크기는 원본 authored 치수(86×6, 종횡비 14.33:1)를
// 그대로 한 번 사용 — 체크리스트 칸(.sendCard__terms width:290, 들여쓰기 20) 안에
// 넉넉히 들어가고 SendCard.dc.html 실측 물결선(~100×6, 같은 칸)과 크기가 같은 자리수라
// 별도 동적 재계산 없이 이 값으로 고정한다. 좌측 20px 오프셋 = 체크박스 13 + gap 7
// (.sendCard__termCheckbox/.sendCard__termRow 실측과 동일) — 라벨 텍스트 시작선에 맞춘다.
//
// 노란 하이라이트(SendCard.dc.html top:206px 블록 실측 `background:rgba(224,177,0,.20);
// width:fit-content; padding:1px 3px 1px 0; border-radius:2px;`, 세 상태 동일 적용)는
// CSS 라 여기서 넣지 않는다 — style.css 는 통합자 소유, OUTBOX/보고로 전달한다.
// [A-419 item1] 체크박스 SVG 마크업 드롭 — FirstSend 카드는 체크박스/선택강조를
// 갖지 않는다(SecondExplore 실제 선택 UI는 별도 파일 second-journey-view.js 소유,
// 여기 손대지 않았다). 위 34×34 체크박스(§7 a377-cb/a377-ck 잉크)가 차지하던 20px
// (체크박스 13 + gap 7, §A-415-c 주석 참조)만큼의 밑줄 좌측 오프셋도 함께 0으로
// 되돌린다 — 그 20px 은 체크박스를 피하기 위한 값이었을 뿐, 체크박스가 없으면
// 남겨둘 근거가 없다. 물결선 path/치수/stroke 자체는 A-415-c 원본 그대로 불변.
function sendCardTermRowMarkup(term) {
  return `
    <div class="sendCard__termItem">
      <div class="sendCard__termRow">
        <span class="sendCard__termLabel">${escapeHtml(term)}</span>
      </div>
      <svg class="sendCard__termUnderline" width="86" height="6" viewBox="0 0 86 6" fill="none" aria-hidden="true" style="display:block; margin:2px 0 0 0;">
        <path d="M1 3.40001C17.6667 1.93334 34.6667 2.13334 52 4.00001C69.3333 5.86667 80 5.53334 84 3.00001" stroke="#141210" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
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
//
// [A-415 item1] 순서 교정: NOTES_explore_page.md §16.2/§16.3 및 SendCard.dc.html 원본
// 실측 결과 원본은 체크리스트(top206)가 위, 설명(top300)이 아래이고 설명은 정체
// (font 400, italic 아님, color rgba(20,18,16,.78))다. 이 파일은 기존에 message(설명)를
// terms(체크리스트)보다 앞에 두고 있었다 — 순서를 뒤집어 마크업(DOM/읽기 순서)을
// 원본과 맞춘다. 실제 화면상 y좌표는 두 블록 모두 position:absolute(top 고정값)라
// style.css 쪽 값(현재 .sendCard__message top:150/italic, .sendCard__terms top:206)이
// 바뀌어야 시각적으로도 맞다 — 이 파일 소유 범위 밖이라 통합자에게 별도 보고한다.
export function sendCardMarkup({
  message = "",
  detail = "",
  address = "",
  terms = [],
  blocked = false,
  // [A-441] First Send 진행 중·미확정 기록 있음 — 버튼만 잠근다(디자인·문구 변경 0).
  busy = false,
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
        <span class="sendCard__titleText">send?</span>
      </div>
      ${
        terms.length
          ? `<div class="sendCard__terms">${terms.map((t) => sendCardTermRowMarkup(t)).join("")}</div>`
          : ""
      }
      ${message ? `<p class="sendCard__message">${escapeHtml(message)}</p>` : ""}
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
          <button class="sendCard__btn pkbtn sendCard__send" type="button" id="sendButton" aria-label="send"${blocked || busy ? " disabled" : ""}${busy ? ' aria-disabled="true"' : ""}>
            <span class="pkbtn__shell" aria-hidden="true">
              <img class="pkbtn__cap pkbtn__cap--l" src="${CARD_DIR}/btn_l.png" alt="" />
              <span class="pkbtn__mid"></span>
              <img class="pkbtn__cap pkbtn__cap--r" src="${CARD_DIR}/btn_r.png" alt="" />
            </span>
            <span class="pkbtn__word pkbtn__cj" aria-hidden="true">send</span>
          </button>
        </div>
      </div>
    </div>
  `;
}
