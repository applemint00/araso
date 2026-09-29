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
// (A-485 filterHistory 로 이미 걸러진) 개수 — 0이면 빈상태 라벨, 있으면 그대로 보여준다.
//
// [A-540] 둘 이상의 Piggy 카드가 있으면 카드마다 자기 것 하나씩 이 함수를 부른다 — `id`
// 는 한 페이지에 하나만 유효한데 카드가 여럿이면 깨지므로, `piggyId` 가 있으면 `id` 대신
// `data-piggy-id` 를 단다. `piggyId` 가 없는(=지금까지의 한 마리/전체 경로) 호출만
// `id="homeRecordsButton"` 을 쓴다 — 이 분기는 한 화면에 최대 한 장만 그려지므로(1마리
// 폴백 카드 하나) 중복이 생기지 않는다.
export function homePaperRecordsEntryMarkup(recordsCount = 0, piggyId = null) {
  const label = recordsCount > 0 ? `records · ${recordsCount}` : "no records yet";
  const attr = piggyId ? ` data-piggy-id="${escapeHtml(piggyId)}"` : ` id="homeRecordsButton"`;
  return `<button class="homePaper__records"${attr} type="button">${escapeHtml(label)}</button>`;
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
  // [A-522 B2a → A-540] MY PIGGIES 색인에서 온 **정체성 줄**(둘 이상일 때만 main.js 가
  // 넘긴다). [{ id, name, label, recordsEntryMarkup }] — 돈/권한 정보가 아니다. 비어 있으면
  // 기존 한 마리 카드 그대로. `+ Piggy` 탭·피크·접힘/펼침은 더 이상 여기(정적 마크업)가
  // 만들지 않는다 — home-peek.js/home-paper-multi.js 가 렌더 뒤 DOM 에 얹는다(A-540 §integrate).
  residents = null,
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
        ${residentCardsMarkup({ name, label, recordsEntryMarkup, residents })}
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

// ---- [A-522 B2a → A-540] 주민 카드 -----------------------------------------------------
//
// 한 마리면 **정본 카드2 그대로**(top214). 색인에 둘 이상이면 같은 크기의 카드를 DOM 순서대로
// 그대로 이어 붙인다 — 상한 0(A-515 무대의 max3 상한은 무대 전용, Paper 목록에는 적용하지
// 않는다), 납작화 0. 위치/접힘/펼침/스크롤/`+ Piggy` 탭/피크는 이제 전부
// home-peek.js/home-paper-multi.js(App 런타임 모듈)가 이 DOM 순서를 그대로 감싸서 만든다
// (A-540 cleanup boundary) — 여기서는 카드마다 정확한 `data-piggy-id` 와 그 카드 자신의
// records entry 만 찍는 순수 마크업이다.
function residentCardMarkup({ index, name, label, recordsEntryMarkup, id = null }) {
  const idAttr = id ? ` data-piggy-id="${escapeHtml(id)}"` : "";
  return `
        <div class="homePaper__card homePaper__card--piggy"${idAttr}>
          <div class="homePaper__num">${index + 1}</div>
          <div class="homePaper__piggyInfo">
            <div class="homePaper__name">${escapeHtml(name)}</div>
            <div class="homePaper__state">${escapeHtml(label)}</div>
            ${recordsEntryMarkup}
          </div>
          <img class="homePaper__face" src="${CARD_DIR}/home-face.png" alt="" aria-hidden="true" />
        </div>`;
}

export function residentCardsMarkup({ name, label, recordsEntryMarkup = "", residents = null } = {}) {
  const rows = Array.isArray(residents) && residents.length > 0
    ? residents
    : [{ id: null, name, label, recordsEntryMarkup }];
  const multi = Array.isArray(residents) && residents.length > 0;
  return rows
    .map((r, i) => residentCardMarkup({
      index: i,
      id: r.id,
      name: r.name || "Piggy",
      label: typeof r.label === "string" ? r.label : "",
      // 둘 이상이면 main.js homeResidents() 가 이미 행마다 자기 records entry 를 채워
      // 넘긴다(§records contract). 한 마리 폴백 행만 바깥 recordsEntryMarkup 을 그대로 쓴다.
      recordsEntryMarkup: multi ? (r.recordsEntryMarkup || "") : recordsEntryMarkup,
    }))
    .join("");
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
// [A-644 U-1] 탭 가능한 행은 Home 패드 체인의 pointer-events:none 을 물려받아 실제 탭이
// 닿지 않았다(elementFromPoint = section.stage, 390/430/700/1440). 스탬프(A-419)·records·
// flap/+Piggy(A-623/A-624)와 같은 처방(pointer-events:auto)을, style.css 가 이 카드 허용
// 범위 밖이라 **이 버튼 자신의 인라인 속성**으로만 건다 — 크기·위치·색 변화 0.
const TAP_ROW_STYLE = "pointer-events:auto";
// [A-644] 고른 행/고른 선택지 표시. `--on` 수정자는 이미 쓰이는 이름이지만(amountChoiceMarkup)
// style.css 에 규칙이 없다 — 새 색을 만들지 않고, 같은 행이 hover/focus 때 이미 쓰는
// var(--gold) 를 인라인으로 그대로 건다(키보드 focus 에만 기대지 않는다).
const ON_STYLE = "color:var(--gold)";

function homeRowMarkup({ id, label, amount, unit, checking, clickable, selected } = {}) {
  const valueMarkup = checking
    ? `<span class="homePaper__amount homePaper__amount--checking">${HOME_CHECKING_LABEL}</span>`
    : homeMoneyValueMarkup(amount, unit);
  const on = clickable && selected === true;
  // hover/focus 규칙과 같은 두 곳(.homePaper__rowLabel · .homePaper__amount)에만 색을 건다.
  const onStyle = on ? ` style="${ON_STYLE}"` : "";
  const inner = `
    <span class="homePaper__rowLabel"${onStyle}>${escapeHtml(label)}</span>
    <span class="homePaper__rowValue">${on ? valueMarkup.replace(/<span class="homePaper__amount/g, `<span${onStyle} class="homePaper__amount`) : valueMarkup}</span>
  `;
  if (clickable) {
    const onAttrs = on ? ` aria-current="true"` : "";
    const onClass = on ? " homePaper__row--on" : "";
    return `<button class="homePaper__row homePaper__row--tap${onClass}" type="button" id="${escapeHtml(id || "")}" style="${TAP_ROW_STYLE}"${onAttrs}>${inner}</button>`;
  }
  return `<div class="homePaper__row">${inner}</div>`;
}

// [A-644 2B] 고른 Piggy 의 조작 깊이 — 기존 `.homePaper__choices` + `.homePaper__records`
// 문법 그대로(amountChoiceMarkup 과 같은 모양), 고른 것만 `--on`. 라벨은 호출자가 넘긴
// Owner 라벨 세 개뿐이다(새 문구 0). 이 마크업은 **설정(선호)** 일 뿐 권한·서명·tx 를 만들지
// 않는다 — 누르면 main.js 가 piggy-control-mode.js 저장소에만 쓴다.
// 가로 한 줄(flex)은 세 줄로 쌓아 집도장과 겹치는 것을 피하려는 배치일 뿐이다(인라인, 새 클래스 0).
export function controlModeChoicesMarkup(options, { selected = null, piggyId = "", idPrefix = "homeControlMode" } = {}) {
  if (!Array.isArray(options) || options.length === 0) return "";
  const body = options.map((o) => {
    const on = o.value === selected;
    const cls = on ? " homePaper__records--on" : "";
    const style = on ? ` style="${ON_STYLE}"` : "";
    return `<button class="homePaper__records${cls}" id="${escapeHtml(idPrefix)}--${escapeHtml(o.value)}" type="button" aria-pressed="${on}"${style}>${escapeHtml(o.label)}</button>`;
  }).join("");
  return `<div class="homePaper__choices homePaper__choices--control" data-control-piggy-id="${escapeHtml(piggyId)}" style="display:flex;flex-wrap:wrap;gap:0 14px">${body}</div>`;
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
  // [A-644 2B] 같은 행 카드 안, 행(과 note) 바로 아래 — 고른 Piggy 의 조작 깊이 자리. 비면 0.
  afterRowsMarkup = "",
} = {}) {
  const rowsCardBody = status
    ? homeStatusFallbackMarkup(status, "homeMoneyRetry")
    : `
      <div class="homePaper__rows">
        ${rows.map(homeRowMarkup).join("")}
      </div>
      ${note ? `<p class="homePaper__note">${escapeHtml(note)}</p>` : ""}
      ${afterRowsMarkup}
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
  afterRowsMarkup = "", // [A-644 2B] 한 마리 경로의 고른 Piggy 조작 깊이 자리(이름 카드 안). 비면 0.
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

  // [A-644] 상세 면은 여섯 줄이라 행 카드 아래는 집도장에 가린다(390 실측) — 조작 깊이는
  // 이 Piggy 이름 카드 안, 시간 줄 아래에 둔다(두 카드 사이 빈 종이 안; 위치 이동·새 카드 0).
  return `
    <div class="homePaper__card homePaper__card--status homePaper__card--money">
      <button class="homePaper__records" id="homePiggyDetailBack" type="button">&lt; ${escapeHtml(backLabel)}</button>
      <div class="homePaper__heading" aria-label="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="homePaper__statusRow homePaper__statusRow--money">
        <span class="homePaper__time">${escapeHtml(time)}</span>
      </div>
      ${status ? "" : afterRowsMarkup}
    </div>
    <div class="homePaper__card homePaper__card--moneyRows">
      ${rowsCardBody}
    </div>
  `;
}

// [A-484 Lane C] Third Journey 임시 두 장 구조의 MY MONEY 행들.
//
// 규율(A-483): **왼쪽 종이는 바뀐다. 오른쪽 종이는 기억한다.**
// 여기서 만드는 행은 왼쪽 종이 안에 머물고, 행을 고르면 **오른쪽 HISTORY 의 정체성만** 바뀐다.
// 세 번째 종이도, 별도 Piggy Detail 페이지도 만들지 않는다.
//
// 값 규율(A-484 카드): **가짜 총액을 만들지 않는다.** 모든 Piggy 에 유효한 평가(원천+시각)가
// 있을 때만 total 이 생기고, 하나라도 없으면 total 줄 자체를 내보내지 않는다.
// 증감(+$12)도 근거가 닫혔을 때만 — 이 함수는 근거가 없으면 **그 줄을 만들지 않는다**.

// [A-510 Stream A] 다중 경로에는 **별도 `at home` 합계 행이 없다.** 그 행은 Piggy 와 별개인
// Home 돈을 뜻했고(A-484), A-508 에서 역사가 됐다. `at home` 은 이제 **각 Piggy 안의 상태**다.
// total 은 Piggy 총액을 **한 번씩만** 더한 값이다(projectRegistryTotals).
export function homeMoneyPiggyRows({ totals = null, piggies = [], selectedPiggyId = null } = {}) {
  const rows = [];

  // total: projectRegistryTotals() 가 숫자를 줬을 때만. null 이면 줄을 만들지 않는다.
  // "0.00" 도 숫자다 — 전부 $0 이어도 total 은 보인다.
  if (totals && typeof totals.totalUsd === "string" && totals.totalUsd !== "") {
    rows.push({ id: null, label: "total", amount: `$${totals.totalUsd}`, clickable: false });
  }

  for (const piggy of piggies) {
    const label = piggy.name || piggy.id;
    // away 는 조용한 상태 라벨일 뿐 금액을 대신하지 않는다.
    const stateSuffix = piggy.location === "away" ? "  away" : "";
    rows.push({
      // 행마다 고유 id — 어느 Piggy 의 기록을 열지 이 id 로 정해진다.
      id: `homeMoneyPiggyRow--${piggy.id}`,
      label: `${label}${stateSuffix}`,
      amount: piggy.valuation ? `$${piggy.valuation.usd}` : null,
      clickable: true,
      selected: piggy.id === selectedPiggyId,
    });
  }
  return rows;
}

// 총액을 못 만든 이유를 사람 말로. 숫자를 지어내는 대신 **왜 없는지**를 보여준다.
export function homeMoneyTotalsNote(totals) {
  if (!totals || totals.totalUsd) return "";
  if (totals.reason === "no_piggies") return "";
  if (totals.reason === "incomplete_valuation") return "총액은 모든 Piggy 의 값을 읽은 뒤에 보여줘.";
  return "";
}

// [A-510 Stream A] A-486 의 인라인 `give some` / `bring some home` / `bring all home` 은
// **Home 이 따로 돈을 가진다**는 옛 모델의 동작이라 걷어냈다(A-508: 현 모델에서 제거).
// Piggy→Piggy 는 parked 다. 이력·증거는 receipts/A486_ui_runtime 에 그대로 있다.

/**
 * 금액 고르기 — 기존 AskCard 식 텍스트 선택지다.
 * 가진 것보다 큰 선택지는 **만들지 않는다**. 자산을 조용히 바꾸지 않는다.
 */
export function amountChoices(availableQuantity, { presets = ["20", "50"] } = {}) {
  const available = Number(availableQuantity);
  if (!Number.isFinite(available) || available <= 0) return [];
  const usable = presets.filter((p) => Number(p) <= available);
  // 프리셋이 하나도 안 맞으면 가진 것 전부를 한 칸으로 준다(반올림으로 부풀리지 않는다).
  if (usable.length === 0) return [{ value: String(availableQuantity), label: `all · ${availableQuantity}` }, { value: "custom", label: "custom" }];
  return [...usable.map((p) => ({ value: p, label: `$${p}` })), { value: "custom", label: "custom" }];
}

export function amountChoiceMarkup(choices, { selected = null, idPrefix = "homeAmountChoice" } = {}) {
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const body = choices.map((c) => {
    const on = c.value === selected ? " homePaper__records--on" : "";
    return `<button class="homePaper__records${on}" id="${escapeHtml(idPrefix)}--${escapeHtml(c.value)}" type="button">${escapeHtml(c.label)}</button>`;
  }).join("");
  return `<div class="homePaper__choices">${body}</div>`;
}

/** 기존 ok 버튼 껍데기 재사용. **유효한 금액 전까지 disabled.** */
export function confirmButtonMarkup({ id = "homeActionOk", label = "ok", enabled = false } = {}) {
  return `<button class="homePaper__records" id="${escapeHtml(id)}" type="button"${enabled ? "" : " disabled"}>${escapeHtml(label)}</button>`;
}

// [A-495 Lane B] 충전 방법 목록 — **역량 상태가 목록을 만든다.**
//
// 개수를 2개나 3개로 못 박지 않는다. 지금 쓸 수 있는 게 하나뿐이면 하나만,
// 나중에 늘면 늘어난다. **지원 안 되는 방법은 고를 수 없게** 두되 **숨기지도 않는다** —
// 사용자가 "왜 안 되는지" 를 알 수 있어야 한다.
//
// 사용자에게 보이는 것은 **돈이 어디서 오는지**이지 네트워크·브리지·스왑이 아니다.

const FUNDING_METHOD_LABEL = Object.freeze({
  bank_card_apple_pay: "은행 · 카드 · Apple Pay",
  from_another_wallet: "다른 지갑에서",
  other_options: "다른 방법",
});

const FUNDING_UNAVAILABLE_NOTE = Object.freeze({
  no_provider_selected: "아직 준비 중이야",
});

// ─────────────────────────────────────────────────────────────────────────────
// [A-646 phase B] Add money — MY MONEY 안에서만(Second 뒤). A-645 NEXT_APP_INPUT S1·S2·S8·S9.
// 문구는 기존 캐논 라벨뿐: `Add money` · `total` · `at home` · `working with` · `ok` · `back`.
// style.css 는 이 카드 범위 밖 — Slice 1 처럼 **인라인 속성**만 쓴다(새 색·새 규칙 0).
// 입력 칸은 Home 패드의 pointer-events:none 체인 안이라 자기 인라인 pointer-events:auto 를 단다.
// 탭 영역은 최소 36px 높이(≤430 에서 손가락으로 닿게, A-644 R6).
const ADD_MONEY_TAP_STYLE = "pointer-events:auto;min-height:36px";
// 글자·색은 기존 .homePaper__amount 와 같은 값(상속하면 종이 밖 밝은 글자색이 와서 안 보인다).
const ADD_MONEY_INPUT_STYLE = "pointer-events:auto;font:700 15px/1.25 Georgia,'Times New Roman',serif;color:#141210;background:transparent;border:0;"
  + "border-bottom:1px solid currentColor;border-radius:0;min-height:36px;padding:0 2px;text-align:right;box-sizing:border-box";

/** MY MONEY 의 `Add money` 입구 하나. 호출자가 게이트(Second 뒤·조용한 Home)를 판단한다. */
export function addMoneyEntryMarkup() {
  return `<button class="homePaper__records" id="homeAddMoney" type="button" style="${ADD_MONEY_TAP_STYLE}">&gt; Add money</button>`;
}

function addMoneyBackMarkup() {
  return `<button class="homePaper__records" id="homeAddMoneyBack" type="button" style="${ADD_MONEY_TAP_STYLE}">&lt; back</button>`;
}

/**
 * 한 마리: 고르는 단계 없이 그 Piggy 가 받는 곳(A-508 picker skip). 퍼센트·여러 줄 0.
 * 방법 목록은 기존 fundingMethodsMarkup 그대로 — 레일 0 이면 정직하게 전부 비활성.
 */
export function addMoneySingleMarkup({ name = "Piggy", methodsMarkup = "" } = {}) {
  return `<div class="homePaper__addMoney" data-add-money="single">
    ${addMoneyBackMarkup()}
    <div class="homePaper__rows"><div class="homePaper__row"><span class="homePaper__rowLabel">${escapeHtml(name)}</span></div></div>
    ${methodsMarkup}
  </div>`;
}

/**
 * 둘 이상: 한 화면, 있는 Piggy 마다 한 줄 = 이름 · 금액 칸 · 퍼센트 칸. 기준 숫자 = 이번 입금 `total`.
 * 미리 고른 줄 0(값은 호출자가 넘긴 그대로 — 기억이 있으면 그 숫자, 없으면 빈 칸). 추천 표시 0.
 * Σ ≠ total 이면 ok 는 disabled. 주소는 그리지 않는다 — 이름만.
 */
export function addMoneyAllocationMarkup({ total = "", unit = "", rows = [], canConfirm = false } = {}) {
  const unitMarkup = unit ? ` <span class="homePaper__unit">${escapeHtml(unit)}</span>` : "";
  const rowMarkup = rows.map((r) => `
      <div class="homePaper__row" data-add-money-row="${escapeHtml(r.piggyId)}" style="align-items:center">
        <span class="homePaper__rowLabel">${escapeHtml(r.name || "Piggy")}</span>
        <span class="homePaper__rowValue" style="white-space:nowrap">
          <input class="homePaper__addMoneyAmount" id="homeAddMoneyAmount--${escapeHtml(r.piggyId)}" type="text" inputmode="decimal" autocomplete="off" aria-label="${escapeHtml(r.name || "Piggy")}" value="${escapeHtml(r.amount ?? "")}" style="${ADD_MONEY_INPUT_STYLE};width:5.2em" />
          <input class="homePaper__addMoneyPercent" id="homeAddMoneyPercent--${escapeHtml(r.piggyId)}" type="text" inputmode="decimal" autocomplete="off" aria-label="${escapeHtml(r.name || "Piggy")} %" value="${escapeHtml(r.percent ?? "")}" style="${ADD_MONEY_INPUT_STYLE};width:3.4em" /><span class="homePaper__unit">%</span>
        </span>
      </div>`).join("");
  return `<div class="homePaper__addMoney" data-add-money="allocation">
    ${addMoneyBackMarkup()}
    <div class="homePaper__rows">
      <div class="homePaper__row" style="align-items:center">
        <span class="homePaper__rowLabel">total</span>
        <span class="homePaper__rowValue" style="white-space:nowrap"><input class="homePaper__addMoneyTotal" id="homeAddMoneyTotal" type="text" inputmode="decimal" autocomplete="off" aria-label="total" value="${escapeHtml(total)}" style="${ADD_MONEY_INPUT_STYLE};width:6.2em" />${unitMarkup}</span>
      </div>
      ${rowMarkup}
    </div>
    ${confirmButtonMarkup({ id: "homeAddMoneyOk", enabled: canConfirm }).replace("<button ", `<button style="${ADD_MONEY_TAP_STYLE}" `)}
  </div>`;
}

/**
 * ok 뒤: 확인한 계획을 **읽기 전용**으로(이름 · 금액) + 기존 방법 목록. 레일 0 → 전부 비활성(정직한 unavailable).
 * 여기서 보내는 것 0 · 서명 0 · WebAuthn 0.
 */
export function addMoneyPlanMarkup({ unit = "", legs = [], methodsMarkup = "" } = {}) {
  const unitMarkup = unit ? ` <span class="homePaper__unit">${escapeHtml(unit)}</span>` : "";
  const legRows = legs.map((l) => `
      <div class="homePaper__row" data-add-money-leg="${escapeHtml(l.piggyId)}">
        <span class="homePaper__rowLabel">${escapeHtml(l.name || "Piggy")}</span>
        <span class="homePaper__rowValue"><span class="homePaper__amount">${escapeHtml(l.amount)}</span>${unitMarkup}</span>
      </div>`).join("");
  return `<div class="homePaper__addMoney" data-add-money="plan">
    ${addMoneyBackMarkup()}
    <div class="homePaper__rows">${legRows}</div>
    ${methodsMarkup}
  </div>`;
}

/**
 * [A-646 S8] 고른 Piggy 안의 돈 상태 — 모든 Piggy 같은 규칙(특별 취급 0).
 * `at home` = 확인된 값만, 모르면 unknown(≠ $0). `working with` = 실제 상태가 있을 때만(없으면 줄 자체 0).
 * `returning` 은 실제 원천이 없어서 **그리지 않는다**. working 을 at home 에 더하지 않는다.
 */
export function piggyMoneyStateMarkup({ atHomeValue = null, workingWithValue = null } = {}) {
  const rows = [`
      <div class="homePaper__row">
        <span class="homePaper__rowLabel">at home</span>
        <span class="homePaper__rowValue">${homeMoneyValueMarkup(atHomeValue)}</span>
      </div>`];
  if (typeof workingWithValue === "string" && workingWithValue !== "") {
    rows.push(`
      <div class="homePaper__row">
        <span class="homePaper__rowLabel">working with</span>
        <span class="homePaper__rowValue">${homeMoneyValueMarkup(workingWithValue)}</span>
      </div>`);
  }
  return `<div class="homePaper__rows homePaper__rows--piggyState" data-piggy-state="1">${rows.join("")}</div>`;
}

export function fundingMethodsMarkup(methods, { idPrefix = "homeFundingMethod" } = {}) {
  const rows = Array.isArray(methods) ? methods : [];
  if (rows.length === 0) return "";
  const body = rows.map((m) => {
    const label = FUNDING_METHOD_LABEL[m.method] || m.method;
    if (m.available) {
      return `<button class="homePaper__records" id="${escapeHtml(idPrefix)}--${escapeHtml(m.method)}" type="button">&gt; ${escapeHtml(label)}</button>`;
    }
    // 쓸 수 없는 방법은 **비활성으로 보이되 이유를 단다** — 있는 척하지 않는다.
    const note = FUNDING_UNAVAILABLE_NOTE[m.unavailableReason] || "아직 준비 중이야";
    return `<button class="homePaper__records" type="button" disabled>${escapeHtml(label)} · ${escapeHtml(note)}</button>`;
  }).join("");
  return `<div class="homePaper__choices homePaper__choices--funding">${body}</div>`;
}
