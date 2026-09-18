// Home 노트패드 — 정본 `HomeNotepad.dc.html` (canvas/onboarding_scenes_20260916, A-336).
// 원본 값 그대로: 용지 left30 top26 400×568 radius3, 종이 #EBE3D5 + paper_tex_ivory.png
// center/290px auto, 그림자 0 14px 30px rgba(0,0,0,.55). 카드1(HOME) left26 top34 348×
// (padding 20 20 18), 카드2(피기 줄) left26 top214 348×(padding 18 20) gap14, 아래 집도장
// 52px rotate(-5deg) + 로고 218px, gap22, bottom54. 이 파일은 chog-home.js #chogHomePad
// 안에 얹는 **공유 markup** 이다 — 기존 손끝 좌표·wrap 변환(±width/height 만 이 회차에서
// 맞춤, 자세한 사유는 chog-home.js 주석)은 여기서 건드리지 않는다.
//
// HOME 제목은 원본 private 폰트(Playfair Display weight 900)로 구워야 한다(§구현경계 2).
// 이번 회차 샌드박스에서는 그 렌더 경로(헤드리스 브라우저 · 폰트 변환기)를 안전하게 확보하지
// 못했다 — UNKNOWN, PNG 를 굽지 않고 시스템 serif 텍스트로 대체했다. 웹폰트는 싣지 않는다.
//
// 동적 값(이름/상태/시간)은 실제 데이터다. 샘플 "Honeybun"/"6:04 PM"을 그대로 쓰지 않는다.

const CARD_DIR = "/card";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 지금 이 기기엔 Piggy 가 하나뿐이다 — home/away 는 그 하나가 지금 어디 있는지의 사실이다.
// scene 에서 파생한다(main.js 가 판정을 두 번 하지 않도록).
export function homeStatusFromScene(scene) {
  const away = scene === "away";
  return {
    homeCount: away ? 0 : 1,
    awayCount: away ? 1 : 0,
    label: away ? "away" : "still in home",
  };
}

export function homeTimeNow(now = new Date()) {
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// A-377 §2: 피기 줄(이름/상태) 밑에 붙는 작은 기록 보기 entry. Home 대시보드
// (main.js homePadMarkup, scene "sendstay")에서만 실제 라벨/id 를 채워 넣는다 — 다른
// 씬(away/explore/secondAway/secondReturn)에서는 pad 자체가 opacity 0 이 되므로
// (chog-home.js cardClaimed) 빈 문자열을 넘겨 자동 노출·자동 기록열기를 만들지 않는다
// (§5 "records view only via Home's explicit user selection"). recordsCount 는 실제
// state.receipts.length — 0이면 빈상태 라벨, 있으면 개수를 그대로 보여준다(추측 문구 0).
export function homePaperRecordsEntryMarkup(recordsCount = 0) {
  const label = recordsCount > 0 ? `records · ${recordsCount}` : "no records yet";
  return `<button class="homePaper__records" id="homeRecordsButton" type="button">${escapeHtml(label)}</button>`;
}

// A-412/b/c: 왼쪽 NOW 한 장 내부에서 Home ↔ Money ↔ Piggy 상세를 전환한다(오른쪽 HISTORY
// 는 별도, 세 번째 상시 종이 0). `mode` 가 "home" 이면 옛 두 카드(status/piggy)를 그대로
// 찍고, "money"/"piggyDetail" 이면 homeMoneyMarkup()/homePiggyDetailMarkup() 가 이미 구운
// bodyMarkup 을 그 자리에 대신 앉힌다 — 카드 위치(top34/top214, width348)·용지 400×568·
// 그림자·집도장/로고는 모든 모드에서 하나의 `.homePaper` 셸을 공유한다(A-412-c "새 파일/새
// paper 0"). 실제 모드 전환(state 보관·재렌더·리스너 부착)은 main.js 몫이다 — 여기는 이미
// 정해진 mode 를 받아 마크업만 만드는 순수 함수다.
export function homePaperMarkup({
  mode = "home", // "home" | "money" | "piggyDetail"
  name = "Piggy",
  homeCount = 1,
  awayCount = 0,
  label = "still in home",
  time = "",
  recordsEntryMarkup = "",
  bodyMarkup = "", // mode !== "home" 일 때: homeMoneyMarkup()/homePiggyDetailMarkup() 결과
} = {}) {
  const cardsMarkup =
    mode === "home"
      ? `
        <div class="homePaper__card homePaper__card--status">
          <div class="homePaper__heading" aria-label="Home">HOME</div>
          <div class="homePaper__statusRow">
            <span class="homePaper__statusText">&gt; status &nbsp; ${homeCount} in &nbsp; ${awayCount} out</span>
            <span class="homePaper__time">${escapeHtml(time)}</span>
          </div>
        </div>
        <div class="homePaper__card homePaper__card--piggy">
          <div class="homePaper__num">1</div>
          <div class="homePaper__piggyInfo">
            <div class="homePaper__name">${escapeHtml(name)}</div>
            <div class="homePaper__state">${escapeHtml(label)}</div>
            ${recordsEntryMarkup}
          </div>
          <img class="homePaper__face" src="${CARD_DIR}/home-face.png" alt="" aria-hidden="true" />
        </div>
      `
      : bodyMarkup;

  // [A-412 §2] 기존 aria-hidden 장식 이미지였던 집도장을 실제 컨트롤로 바꾼다. 그림/치수/
  // 회전은 그대로(`.homePaper__stamp`), 버튼은 눈에 보이지 않는 padding+상쇄 margin 으로만
  // hit 영역을 넓힌다(§style.css 주석) — 새 아이콘 0, 새 시각효과 0. 클릭이 실제로 무엇을
  // 하는지(모드 전환 dispatch)는 main.js 가 이 id 에 리스너를 붙여 정한다 — 여기서는
  // 상태를 갖지 않는다.
  const stampLabel = mode === "home" ? "Open money view" : "Back to home";
  return `
    <div class="homePaperMount">
      <div class="homePaper" id="homePaper" data-paper-mode="${escapeHtml(mode)}">
        ${cardsMarkup}
        <div class="homePaper__mark">
          <button
            class="homePaper__markButton"
            id="homePaperMoneyToggle"
            type="button"
            aria-label="${escapeHtml(stampLabel)}"
            aria-pressed="${mode !== "home"}"
          >
            <img class="homePaper__stamp" src="${CARD_DIR}/house-stamp.png" alt="" aria-hidden="true" />
          </button>
          <img class="homePaper__logo" src="${CARD_DIR}/arasoo-logo.png" alt="ARASOO" />
        </div>
      </div>
    </div>
  `;
}

// ---- Money mode / Piggy 상세 (A-412-b/c) ----------------------------------------------
//
// "미확인"은 근거 없는 값, "해당없음"은 이 Piggy/이 필드에 구조적으로 적용되지 않는 값이다
// (canon §"불명은 확인중/미확인, 0으로 대입0"). 0 을 대입해 있는 것처럼 보이게 하지 않는다.
// main.js 는 필드값을 이미 확정한 문자열로, 모르면 null/undefined 로, 해당없음이면 정확히
// HOME_NOT_APPLICABLE_LABEL 을 넘긴다 — 여기서 데이터 원천을 판정하거나 잔액을 계산하지
// 않는다(순수 렌더).
export const HOME_UNKNOWN_LABEL = "unknown";
export const HOME_NOT_APPLICABLE_LABEL = "—";
const HOME_CHECKING_LABEL = "checking…";

function homeMoneyValueMarkup(amount, unit) {
  if (amount === HOME_NOT_APPLICABLE_LABEL) {
    return `<span class="homePaper__amount homePaper__amount--unknown">${HOME_NOT_APPLICABLE_LABEL}</span>`;
  }
  if (amount === null || amount === undefined || amount === "") {
    return `<span class="homePaper__amount homePaper__amount--unknown">${HOME_UNKNOWN_LABEL}</span>`;
  }
  const unitMarkup = unit ? ` <span class="homePaper__unit">${escapeHtml(unit)}</span>` : "";
  return `<span class="homePaper__amount">${escapeHtml(amount)}</span>${unitMarkup}`;
}

// 한 행 = 소유/상태 하나의 사실(예: at home / with Piggy / away). main.js 가 이미 분리해
// 넘긴 값을 그대로 찍을 뿐, 여기서 두 행을 합산하지 않는다(canon "중복합산0").
function homeRowMarkup({ id, label, amount, unit, checking, clickable } = {}) {
  const valueMarkup = checking
    ? `<span class="homePaper__amount homePaper__amount--checking">${HOME_CHECKING_LABEL}</span>`
    : homeMoneyValueMarkup(amount, unit);
  const inner = `
    <span class="homePaper__rowLabel">${escapeHtml(label)}</span>
    <span class="homePaper__rowValue">${valueMarkup}</span>
  `;
  if (clickable) {
    return `<button class="homePaper__row homePaper__row--tap" type="button" id="${escapeHtml(id || "")}">${inner}</button>`;
  }
  return `<div class="homePaper__row">${inner}</div>`;
}

// 조회 실패/빈자산: 별도 에러 페이지가 아니라 같은 카드 자리에서 짧은 문구 + 재시도
// (canon "같은 종이 자리에서 짧은 상태/읽기 재시도, 별도 에러페이지 0"). retry 클릭 동작은
// main.js 가 이 id 에 붙인다.
function homeStatusFallbackMarkup(status, retryFallbackId) {
  return `
    <div class="homePaper__moneyStatus">
      <p class="homePaper__moneyStatusText">${escapeHtml(status.text || HOME_UNKNOWN_LABEL)}</p>
      <button class="homePaper__records" id="${escapeHtml(status.retryId || retryFallbackId)}" type="button">
        ${escapeHtml(status.retryLabel || "try reading again")}
      </button>
    </div>
  `;
}

// 왼쪽 NOW Paper 의 Money 내용 — 카드1(제목만 하나) + 카드2(행 나열, 바/차트 0). 기존
// .homePaper__card--status/--piggy 자리(top/left/width)를 그대로 물려받고, 카드
// 안쪽만 A-412-b 구조로 바꾼다(A-412-c "기존 디자인 그리드 안에서만"). rows 는 이미
// 확정된 값의 배열이다 — at home / with [실제 Piggy 이름] / actually away 세 줄이 기본
// 모양이지만, 어떤 소스가 어떤 행인지는 main.js 가 정한다(여기는 그리지만 정의하지 않는다).
export function homeMoneyMarkup({
  title = "AT HOME", // "MY MONEY" 도 가능 — 역할에 맞는 한 개만(A-412-b §1)
  time = "",
  rows = [], // [{ id, label, amount, unit, checking, clickable }]
  note = "", // 예: "home in/out counts are piggy counts, not trip counts"
  status = null, // { text, retryId, retryLabel } — 있으면 rows 대신 이걸 찍는다
} = {}) {
  const rowsCardBody = status
    ? homeStatusFallbackMarkup(status, "homeMoneyRetry")
    : `
      <div class="homePaper__rows">
        ${rows.map(homeRowMarkup).join("")}
      </div>
      ${note ? `<p class="homePaper__note">${escapeHtml(note)}</p>` : ""}
    `;
  return `
    <div class="homePaper__card homePaper__card--status homePaper__card--money">
      <div class="homePaper__heading" aria-label="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="homePaper__statusRow homePaper__statusRow--money">
        <span class="homePaper__time">${escapeHtml(time)}</span>
      </div>
    </div>
    <div class="homePaper__card homePaper__card--moneyRows">
      ${rowsCardBody}
    </div>
  `;
}

// Piggy 상세 — went out with / now / changed / work state / expected back / cost so far.
// 실데이터가 없는 필드는 각각 미확인(근거 없음) 또는 해당없음(구조적으로 적용 안 됨)으로만
// 채운다(A-412-b §2, 샘플 수치 0). changed 는 +/- 금액을 percent 보다 먼저 보여주고, percent
// 는 기준시점이 닫혔을 때만(넘겨받은 값이 있을 때만) 덧붙인다 — 여기서 손실색을 새로
// 정의하지 않고 기존 --gold(+)/기본 잉크색(-)으로만 부호를 나눈다(canon "빨강 확대 0").
export function homePiggyDetailMarkup({
  name = "Piggy",
  time = "",
  backLabel = "back",
  wentOutWith = null,
  now = null,
  changed = null, // { amount, sign: "+" | "-", percent } | null
  workState = null,
  expectedBack = null,
  costSoFar = null,
  status = null, // { text, retryId, retryLabel } — 있으면 필드 대신 이걸 찍는다
} = {}) {
  const changedMarkup = (() => {
    if (!changed || changed.amount === null || changed.amount === undefined) {
      return homeMoneyValueMarkup(changed === HOME_NOT_APPLICABLE_LABEL ? HOME_NOT_APPLICABLE_LABEL : null);
    }
    const signClass = changed.sign === "+" ? " homePaper__amount--up" : "";
    const percentMarkup =
      changed.percent === null || changed.percent === undefined
        ? ""
        : ` <span class="homePaper__percent">(${escapeHtml(changed.percent)})</span>`;
    return `<span class="homePaper__amount${signClass}">${escapeHtml(changed.sign || "")}${escapeHtml(changed.amount)}</span>${percentMarkup}`;
  })();

  const fieldRows = [
    { label: "went out with", value: wentOutWith },
    { label: "now", value: now },
    { label: "changed", valueMarkup: changedMarkup },
    { label: "work state", value: workState },
    { label: "expected back", value: expectedBack },
    { label: "cost so far", value: costSoFar },
  ]
    .map(
      (field) => `
        <div class="homePaper__row">
          <span class="homePaper__rowLabel">${escapeHtml(field.label)}</span>
          <span class="homePaper__rowValue">${field.valueMarkup ?? homeMoneyValueMarkup(field.value)}</span>
        </div>
      `,
    )
    .join("");

  const rowsCardBody = status ? homeStatusFallbackMarkup(status, "homePiggyDetailRetry") : `<div class="homePaper__rows">${fieldRows}</div>`;

  return `
    <div class="homePaper__card homePaper__card--status homePaper__card--money">
      <button class="homePaper__records" id="homePiggyDetailBack" type="button">&lt; ${escapeHtml(backLabel)}</button>
      <div class="homePaper__heading" aria-label="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="homePaper__statusRow homePaper__statusRow--money">
        <span class="homePaper__time">${escapeHtml(time)}</span>
      </div>
    </div>
    <div class="homePaper__card homePaper__card--moneyRows">
      ${rowsCardBody}
    </div>
  `;
}
