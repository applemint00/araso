// Second Journey 카드 — Explore(관심선택) → 후보 check → JIT 0~1 → READY+Permission →
// amount → "Send this one?". A-360.
//
// [경계] return-view.js와 같은 규약이다 — 이 파일은 돈에 대해 아무것도 모른다. 판정은
// job-feed.js(runSecondJourney)·second-job-readiness.js(decideSecondJobPreflight)가 이미
// 끝낸 값을 main.js가 model 로 넘기면, 여기서는 그 model 을 markup 으로만 그린다. 클릭
// 배선(main.js render())도 기존 sendCardMarkup(#sendButton/#stayButton) 관례를 그대로
// 따른다 — id 만 내놓고 addEventListener 는 main.js 가 한다.
//
// [카드 재사용] 새 카드/종이 자산을 만들지 않는다. `.cardAnchor`/`.sendCard`(style.css,
// A-359 실측 285×364 공통 자리·중심)를 그대로 쓰고, 안쪽 목록/버튼만 추가 클래스로
// 채운다 — 종이 질감·글꼴·그림자는 기존 `.sendCard` 규칙에서 그대로 상속된다.

import { sendCardButtonMarkup } from "./send-card.js";
import { EXPLORE_ERRANDS } from "./job-feed.js";
import { JOB_FAMILY } from "./second-job-readiness.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// [A-421] 이전 STATUS_COPY/statusCopy() 는 job-feed.js 내부 파생 상태를 그대로 영어
// 단어로 옮긴 것("needs funding" 등)이었다 — Owner 실관찰: Candidates 화면에 이 내부
// 어휘가 그대로 노출됐다("저말을 사용자가 알거같냐고"). 정본 Paper 발화(§역할표, README
// :102-115/NOTES:570-578: place to explore?/checking…/Send this one?/nah.) 바깥의
// 병렬 문구를 더 만들지 않는다 — 아래 paperStatusCopy() 하나로 후보별 상태도 겸한다.
export function paperStatusCopy(status) {
  if (status === "JOB_READY") return "Send this one?";
  if (status === "NAH") return "nah.";
  return "checking…";
}

// [A-421 Owner] 우상 숫자 = 지금 몇 번째 Journey 인지. 모르면 비운다.
function mastheadMarkup(journeyNumber) {
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();
  const weekdayLabel = today.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  return `<div class="secondJourney__masthead"><span class="secondJourney__dot" aria-hidden="true"></span><span class="secondJourney__date">${dateLabel}<small>${weekdayLabel}</small></span><span class="secondJourney__page" aria-hidden="true">${journeyNumber ?? ""}</span></div>`;
}

// 실제 경로에서 이 카드가 왜 Send 를 막고 있는지 — 속이지 않는다(§success_criteria
// "실제경로는 후보/권한/금융미연결을 속이지 않고 fail closed"). [A-421 교정] 이전엔
// `not ready yet (${preflight.reason || preflight.status})` 로 second-job-readiness.js
// 내부 reason 코드(예: "rule_unknown")를 그대로 문자열에 꽂아 넣었다 — Owner 실관찰:
// check 클릭 뒤 화면에 "rule_unknown" 이 그대로 보였다. 같은 정보(왜 막혔는지)는 이미
// 승인된 paperStatusCopy() 로도 정직하게 전달된다(READY 아니면 checking…/nah.) — 내부
// 코드값을 노출하지 않고 이 함수 하나로 합친다.
export function secondJourneySendReason(preflight, devPreview) {
  if (!preflight) return "check a candidate first";
  if (!devPreview) return "no live Second Journey adapter yet — preview only in DEV";
  if (preflight.status !== "JOB_READY") return paperStatusCopy(preflight.status);
  if (!preflight.executionPermission) return "turn on permission first";
  return "";
}

// [A-421] Candidates/readiness 제목에 job-feed.js 내부 fixture title(예: "Swap-like
// Trade", "Kintsu-like Grow with delayed return")을 그대로 찍지 않는다 — Owner 실관찰:
// 선택 후 화면에 "Swap-like Trade" 가 그대로 보였다("저말을 사용자가 알거같냐고"). 그
// 내부 title 대신, 이미 interests 단계에서 사용자가 직접 보고 고른
// errand.label(job-feed.js EXPLORE_ERRANDS, interestsStepMarkup 이 이미 쓰는 문구)을
// destination.errandIds 로 되짚어 재사용한다 — 새 문구 발명 0. 대응하는 label 을 하나도
// 못 찾으면(맵 불일치) 빈 문자열을 반환한다 — 내부 title 로 채워 넣지 않는다.
function destinationDisplayLabel(destination, errandLabelById = {}) {
  const labels = (destination?.errandIds || []).map((id) => errandLabelById[id]).filter(Boolean);
  return labels.join(" / ");
}

// [A-421] 확정 디자인 = 기존 종이 카드의 둥근 양끝 종이 버튼(.pkbtn, send-card.js:54-63
// sendCardButtonMarkup 과 같은 껍질) — Owner 실관찰: 사각 `check` 버튼이 노출됐다. 후보별
// data-destination-id 가 필요해 sendCardButtonMarkup 을 그대로 호출할 수 없으므로(그
// 헬퍼는 임의 data attribute 를 받지 않는다) 같은 마크업을 여기서 그대로 복제한다 — 새
// 버튼 형체를 만들지 않는다. `.secondJourney__checkBtn`(옛 사각 버튼 CSS, style.css)은
// 더 이상 쓰지 않고 순수 JS 훅 클래스(`secondJourney__candidateCheck`, 자체 CSS 없음)로
// 갈아탄다 — 두 클래스를 같이 넣으면 옛 사각 규칙이 나중에 선언돼 있어 `.pkbtn` 를
// 덮어써 버린다(style.css 는 이 발주 범위 밖이라 고치지 않는다).
function checkButtonMarkup(destinationId) {
  return `
    <button class="pkbtn secondJourney__candidateCheck" type="button" data-destination-id="${escapeHtml(destinationId)}" aria-label="check">
      <span class="pkbtn__shell" aria-hidden="true">
        <img class="pkbtn__cap pkbtn__cap--l" src="/card/btn_l.png" alt="" />
        <span class="pkbtn__mid"></span>
        <img class="pkbtn__cap pkbtn__cap--r" src="/card/btn_r.png" alt="" />
      </span>
      <span class="pkbtn__word pkbtn__text" aria-hidden="true">check</span>
    </button>
  `;
}

// amount 는 UI 입력/검증값이다 — 기존 고정 SEND_AMOUNT 를 바꾸는 승인이 아니다(§5).
export function validateSecondAmount(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return { valid: false, amount: null, error: "" };
  // 십진 표기만 받는다 — 0x10·1e3 같은 Number() 허용형 거부. 소수 2자리 = 달러 입력 기준(INFERRED).
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return { valid: false, amount: null, error: "enter a positive amount" };
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return { valid: false, amount: null, error: "enter a positive amount" };
  return { valid: true, amount: numeric, error: "" };
}

// job-feed.js makeMockReceipt() 의 출력을 receipt-paper.js 종이 칸에 맞춘다. 항상
// "mock" 이 statusLabel 에 남는다 — 실제 receipt 처럼 보이면 안 된다(§7).
export function secondJourneyReceiptFields(mockReceipt, name = "Piggy") {
  const attempted = Boolean(mockReceipt && mockReceipt.attempted);
  const now = new Date();
  const statusWord = mockReceipt ? String(mockReceipt.decidedStatus || "UNKNOWN").toLowerCase() : "unknown";
  return {
    name,
    date: now.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    wentOut: "—",
    cameBack: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    kept: mockReceipt?.cost ? `${mockReceipt.cost.amount} (${mockReceipt.cost.source})` : "—",
    statusLabel: `mock · ${statusWord}`,
    empty: !attempted,
  };
}

// [A-405/A-405-a] Chog/Paper 한 자리 노트 — 새 카드/캐릭터 0, 기존 secondJourney__hint
// (Chog, 작은 말)·secondJourney__reason(Paper, 상태 문구) 클래스만 재사용한다(§9/§10
// NOTES "큰 글씨는 Paper, Chog 의 작은 말이 기억 쪽"). raw 내부 상태문자열이 아니라 이
// 승인된 카피만 지나간다 — main.js 가 만들어 넘긴다(job-feed/second-journey-state 내부
// reasonCode 를 여기서 그대로 노출하지 않는다).
function exploreNoteMarkup(note) {
  if (!note) return "";
  const { chogLine = "", paperLine = "" } = note;
  return `${chogLine ? `<p class="secondJourney__hint secondJourney__note--chog">${escapeHtml(chogLine)}</p>` : ""}${
    paperLine ? `<p class="secondJourney__reason secondJourney__note--paper">${escapeHtml(paperLine)}</p>` : ""
  }`;
}

// 최초 seed B 소진("okay./maybe later.") 및 본편 반복 none("not these?/for now." →
// "maybe later.")의 종결 화면 — 목록도 버튼도 없이 문구만, 같은 카드 자리·같은
// Send0/Piggy출발0 규율. secondAway(article.note--quiet, 버튼 없음)와 같은 관례 —
// 어차피 짧게 머물다 main.js 의 sceneTimeout 이 Home 으로 넘긴다(여기서는 그리기만).
// "back to Home" 버튼을 넣으면 그 버튼의 기존 전역 stayHome() 문구("Piggy stayed home
// today.")가 이 카드의 "maybe later." 와 다른 말을 해 헷갈린다 — 그래서 버튼 자체를
// 이 화면에는 두지 않는다.
export function noteStepMarkup(note = {}) {
  return `
    <h2 class="secondJourney__heading">${escapeHtml(note.paperLine || "")}</h2>
    ${note.chogLine ? `<p class="secondJourney__hint">${escapeHtml(note.chogLine)}</p>` : ""}
  `;
}

// [A-407] 이 heading 은 원래 base64 인라인 CJ PNG(alt="explore?")였는데, 실제로 디코드해
// 보면 렌더 내용이 "place to" 뿐이었다(alt 와 실제 픽셀 불일치 — 이전 커밋의 잘못 잘린
// 자산으로 추정, OUTBOX 보고). Owner 확정 문구(A-405 §"Paper places to explore?")를 근거로
// "places to explore?" 실텍스트로 교체한다 — 새 문구를 만든 것이 아니라 이미 승인된 Paper
// 발화를 그대로 옮긴 것이다.
function interestsStepMarkup({ errands = [], selectedIds = [], note = null }) {
  // [A-421] 화면엔 영어표(SECOND_ACTION_TITLES_EN). 목록은 줄이지 않는다.
  const items = errands
    .map(
      (errand) => `
        <label class="secondJourney__item">
          <input type="checkbox" data-errand-id="${escapeHtml(errand.id)}" ${selectedIds.includes(errand.id) ? "checked" : ""} />
          <svg class="secondJourney__checkbox" viewBox="0 0 34 34" aria-hidden="true"><g class="secondJourney__boxInk"><path d="M5 6 L29 4 L30 29 L4 30 Z" /></g><g class="secondJourney__checkInk"><path d="M8 18 L15 26 L28 6" /></g></svg>
          <span class="secondJourney__label">${escapeHtml(SECOND_ACTION_TITLES_EN[errand.id] || errand.label)}<svg class="secondJourney__underline" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path d="M1 3.4 Q30 1.2 60 4 T99 3" /></svg></span>
        </label>
      `,
    )
    .join("");
  return `
    <h2 class="secondJourney__heading secondJourney__heading--interests"><span class="secondJourney__exploreText">places to explore?</span></h2>
    ${exploreNoteMarkup(note)}
    <form id="exploreForm" class="secondJourney__list secondJourney__list--interests">${items}</form>
    <div class="secondJourney__footer">
      <button class="sendCard__stay" id="stayButton" type="button">back to Home</button>
      ${sendCardButtonMarkup({ id: "exploreSaveButton", label: "save" })}
    </div>
  `;
}

// [A-421 INBOX 최신] 후보 = 행동 하나씩(합성 금지), checking… 은 제목 한 곳만(행별 중복 제거, nah. 만 행에 남김).
function candidatesStepMarkup({ destinations = [], errandLabelById = {}, pickedCandidateId = null, selectedIds = [], pickedErrandIds = null, reading = false }) {
  // [A-421 Owner 정본] "Select one → OK confirms the errand → amount/return card → Send grants
  // current execution permission." 고른 행동들을 .job 형식으로 보여주고, 누르면 선택(노란 표시),
  // 다른 걸 누르면 선택이 바뀐다. ok = 이 일 확정/다음 Paper 이동일 뿐 permission 아님.
  // Home 은 왼쪽에 항상.
  // [A-849 UI-24] 제목: "checking…" 은 실제 읽기가 진행 중일 때만. 고른 관심이 있는데 후보가 0 이면
  // WAIT 상태 = "wait."(A-571: no-match = wait, nah. 아님). 그 외(후보 있음/읽기 끝) 는 기존 승인 문구
  // "places to explore?". 고른 관심 한 줄은 제목 바로 아래 — 기존 errand 라벨, " · " 로 잇는다(새 문구 0).
  const picks = destinations
    .map((destination) => {
      const title = secondActionTitle(destination) || destinationDisplayLabel(destination, errandLabelById);
      const nah = destination.derivedStatus === "NAH";
      const picked = destination.id === pickedCandidateId;
      return `<button class="job secondJourney__pick${picked ? " is-picked" : ""}" type="button" data-destination-id="${escapeHtml(destination.id)}" aria-pressed="${picked}"${nah ? " disabled" : ""}>${escapeHtml(title)}</button>`;
    })
    .join("");
  const pickedLabels = (Array.isArray(pickedErrandIds) ? pickedErrandIds : Array.isArray(selectedIds) ? selectedIds : []).map((id) => errandLabelById?.[id]).filter(Boolean);
  const waiting = !reading && destinations.length === 0 && pickedLabels.length > 0;
  const heading = reading ? paperStatusCopy() : waiting ? "wait." : "places to explore?";
  const pickedLine = pickedLabels.length
    ? `<p class="secondJourney__picked" id="secondPickedLine">${escapeHtml(pickedLabels.join(" · "))}</p>`
    : "";
  return `
    <h2 class="secondJourney__heading secondJourney__heading--interests" id="secondCandidatesHeading" data-state="${reading ? "reading" : waiting ? "wait" : "ready"}"><span class="secondJourney__exploreText">${escapeHtml(heading)}</span></h2>
    ${pickedLine}
    ${picks}
    <div class="footer">
      <button class="back" id="stayButton" type="button">Home</button>
      ${sendCardButtonMarkup({ id: "secondOkButton", label: "ok", disabled: !pickedCandidateId })}
    </div>
  `;
}

// [A-421 v25] 선택된 행동의 영어 제목. 새 문구 0 — 이미 승인된 표에서만 가져온다.
// market/order/clean/claim: 비공개 디자인 노트 NOTES_explore_page.md:128-131(§4 화면 문구 열).
// grow: APP_HANDOFF.md:15 / CURRENCY_NOTES.md:12 (Owner 확정 "put some money to work").
// 보상 claim: APP_HANDOFF.md:16 / CURRENCY_NOTES.md:15 ("pick up my rewards") — 단
// "보상 아닌 수령 대상에 rewards 강제 적용 금지"(CURRENCY_NOTES.md:15)이므로 보상 여부를
// 실제 데이터로 구분할 수 있을 때만 쓴다(아래 secondActionTitle 주석).
// move/stay: Owner 승인 2026-10-01 (INBOX "A-663 OWNER COPY DECISION — MOVE / STAY").
// stay 는 Send 카드 "stay home" 과 같은 말 — 새 어휘 0.
export const SECOND_ACTION_TITLES_EN = Object.freeze({
  market: "go to the market",
  order: "leave an order",
  clean: "tidy the wallet",
  claim: "pick up what is owed",
  grow: "put some money to work",
  move: "find a better spot",
  stay: "stay home",
  // Owner 번역 지시(INBOX A-421 "영어로 다바꿔서 보내") — 과거 정본 아님.
  "asset-piece": "pick up a piece of an asset",
});

// [A-421 HOLD] `claim` 과 `clean` 두 라벨은 Owner 판단 대기 중이다(감독 전달).
// - claim: 보상수령/비보상 수령 문구 분기 자체를 Owner 가 다시 정하고 있다. 여기서
//   고르지 않고 이미 승인된 일반 라벨(NOTES_explore_page.md:131)을 그대로 둔다. 보상
//   여부를 판정할 실데이터 필드도 없다 — 내부 fixture 문자열 매칭으로 추측 0.
// - clean: "tidy the wallet" 은 라벨로는 승인됐지만 그 일이 잔돈 모으기인지 스캠 정리인지
//   Owner 미결이라 뜻이 고정되지 않았다(job-feed.js:57-69 은 fixture 행뿐). 라벨만 유지.
// 둘 다 OWNER_INPUT_REQUIRED 로 보고하고 새 문구를 쓰지 않는다.
// [A-421 박스] Explore-many → Send-one: 행동 카드는 선택된 destination 의 행동 **하나**만.
// errandIds 가 하나면 그것, 여럿이면 destination.laneId 와 같은 lane 의 errand(job-feed.js
// EXPLORE_ERRANDS 기존 값). 근거가 없으면 빈칸(SOURCE_MISSING) — 임의 선택 0.
// [A-723] Second lane candidate titles follow the Job FAMILY (experience), not the Explore errand: grow_stable
// and grow_delayed both sit under the one "grow" errand, so the errand title collapsed them into two identical
// "put some money to work" rows (A-719). Family semantics = second-job-readiness.js JOB_FAMILY (:302 맡기고 바로
// 찾기 / :303 며칠 나갔다 오기 / :305 값을 따라가는 것 갖기). English wording = Owner correction 2026-10-04 (INBOX
// A-723 "Approved visible candidate wording", newest wins) — no other canon source carries these strings.
// One title per family: same-family alternatives (Curvance/Neverland behind Aave) never get a row of their own.
// No asset/protocol names here — those live only in the selected-Job explanation. protect keeps its errand title.
export const SECOND_FAMILY_TITLES_EN = Object.freeze({
  [JOB_FAMILY.GROW_STABLE]: "a quick trip",
  [JOB_FAMILY.GROW_DELAYED]: "stay out a little longer",
  [JOB_FAMILY.OWN_RWA]: "try the stock market",
});

export function secondActionTitle(destination) {
  if (destination?.laneCandidate === true && Object.prototype.hasOwnProperty.call(SECOND_FAMILY_TITLES_EN, destination.family ?? "")) {
    return SECOND_FAMILY_TITLES_EN[destination.family];
  }
  const ids = destination?.errandIds || [];
  let id = ids.length === 1 ? ids[0] : null;
  if (!id && destination?.laneId) {
    id = ids.find((eid) => EXPLORE_ERRANDS.find((e) => e.id === eid)?.lane?.toLowerCase() === destination.laneId) || null;
  }
  // [A-421] 보상 수령(CURRENCY_NOTES "보상 claim 은 pick up my rewards") — destination 자체가
  // 보상 잔고를 늘리는 claim 일 때만(job-feed fixture measurableStateChange). 다른 수령엔 강제 0.
  if (destination?.laneId === "collect" && /reward/i.test(destination?.capabilityContext?.measurableStateChange || "")) {
    return "pick up my rewards";
  }
  return (id && SECOND_ACTION_TITLES_EN[id]) || "";
}

// Second lane candidates → candidate rows for the existing candidates card (product Explore).
// `rows` come from mainnet-job-lane.js exploreCandidateRows() (A-710 decisions × the readiness family table ×
// A-715 descriptor view). A row is shown only when its family belongs to an errand the user picked on the Explore
// Paper (family "grow_stable" → lane "Grow", "protect" → "Protect", "own_rwa" → "Own"; the errand list's own
// `lane` field, nothing restated). The cut to `max` is presentation only: the decided universe stays whole in
// the caller. derivedStatus is "NAH" or "UNKNOWN" — never JOB_READY, so paperStatusCopy never says "Send this one?".
export function exploreCandidateDestinations(rows = [], { selectedErrandIds = [], max = 3 } = {}) {
  const selected = new Set(Array.isArray(selectedErrandIds) ? selectedErrandIds : []);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.candidateId !== "string" || typeof row.family !== "string") continue;
    const lane = row.family.split("_")[0];
    const errand = EXPLORE_ERRANDS.find((e) => String(e.lane || "").toLowerCase() === lane);
    if (!errand || !selected.has(errand.id)) continue;
    out.push({
      id: row.candidateId,
      laneCandidate: true,
      family: row.family,
      laneId: lane,
      errandIds: [errand.id],
      derivedStatus: row.status === "nah" ? "NAH" : "UNKNOWN",
    });
  }
  // A-727 diversity: pass 1 takes at most one row per selected lane (existing row order), pass 2 fills the remaining
  // slots with the other rows (existing row order). Output order = pass order. The cut to `max` stays last.
  const seenLanes = new Set();
  const pass1 = [];
  const pass2 = [];
  for (const d of out) {
    if (seenLanes.has(d.laneId)) pass2.push(d);
    else { seenLanes.add(d.laneId); pass1.push(d); }
  }
  return pass1.concat(pass2).slice(0, Math.max(0, Number.isInteger(max) ? max : 3));
}

// 조건별 화면 구분(APP_HANDOFF.md:21-24): 수령형(맡길 금액 칸 없음) · 지연귀환형 ·
// 금액형. 판정은 이미 job-feed.js 가 만든 destination 값만 읽는다(새 판정 0).
export function readinessCardKind(destination) {
  if (!destination) return "amount";
  // Second lane candidate (product Explore): nothing is runnable yet, so no amount/claim field is drawn —
  // the card keeps the chosen action, the Paper status line and a disabled Send only.
  if (destination.laneCandidate === true) return "status";
  if (destination.laneId === "collect") return "collect";
  if (destination.capabilityContext?.returnModel?.type === "delayed") return "wait";
  return "amount";
}

// Name it 카드에 이미 인라인된 승인 밑줄(name-card.js:102-119, Figma Vector 1 4:685,
// viewBox 0 0 364 20 / stroke #141210 width 6 round / drop-shadow filter)과 path·viewBox·
// filter 가 바이트 동일한 자산이다(amount-card-review/amount-line.svg). 새 에셋을 만들지
// 않고 같은 인라인 SVG 를 이 카드 폭에 맞춰 재사용한다. 한 문서에 filter id 가 두 번
// 나오면 충돌하므로 이 인스턴스만 접미사(_sj)를 붙였다 — path/수치는 그대로다.
function amountLineMarkup() {
  return `
    <svg class="amount-line" viewBox="0 0 364 20" preserveAspectRatio="none" aria-hidden="true">
      <g filter="url(#filter0_d_4_685_sj)">
        <path d="M7.00006 6.48663C7.12408 6.49001 9.61704 5.97081 41.3694 5.87377C70.6961 5.78414 126.837 7.68218 157.26 8.20797C190.679 8.78554 194.632 7.99598 196.464 7.96819C201.332 7.89436 206.524 7.55755 211.686 7.39265C227.139 6.89898 248.335 7.2937 252.022 7.16114C260.183 6.8677 277.488 6.16731 285.9 5.73406C295.371 5.24627 300.065 4.65218 313.909 4.76359C321.292 4.82302 327.986 3.77582 332.452 3.43589C336.973 3.12438 342.564 3.19519 347.142 3.13009C349.751 3.09286 352.939 3.04712 356.225 2.99998" stroke="#141210" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
      </g>
      <defs>
        <filter id="filter0_d_4_685_sj" x="0" y="0" width="363.225" height="19.4184" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood>
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix>
          <feOffset dy="4"></feOffset>
          <feGaussianBlur stdDeviation="2"></feGaussianBlur>
          <feComposite in2="hardAlpha" operator="out"></feComposite>
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"></feColorMatrix>
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_4_685_sj"></feBlend>
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_4_685_sj" result="shape"></feBlend>
        </filter>
      </defs>
    </svg>
  `;
}

// 예상 귀환 강조 크레용 타원 — 노랑(accent.site #E0B100) 변형. 근거는 함수 안 주석.
// 귀환 추정값이 없으면 이 span 자체가 나오지 않는다.
function returnTimeMarkup(returnEstimate, costLine = null) {
  // [A-421] Owner 시안 캡처: 노란 타원이 귀환 시간 + cost 두 줄을 함께 감싼다.
  const inner = costLine ? `${escapeHtml(returnEstimate)}<br>${escapeHtml(costLine)}` : escapeHtml(returnEstimate);
  // [A-421 Owner 판정 2026-09-18] "먹색 위험시, 노랑색 강조시" — 색 규칙이 확정됐다.
  // 예상 귀환+cost 는 위험이 아니라 **강조**이므로 노랑(accent.site #E0B100)이다.
  // 그래서 여기 있던 먹색(#141210 1.6) 변형을 v25 원본의 노랑 변형으로 바꾼다 —
  // amount-card-review/index.html:12 초기 update() 의 crayonCircle path 2개(4.8/2.4)와
  // feTurbulence/feDisplacementMap 필터 값 그대로다(새 path 작도 0). 먹색 변형
  // (index.html:14)은 쓰지 않는다. 앞선 PREMISE_CONFLICT 는 이 판정으로 종결한다.
  // 필터 id 는 한 문서 공존 시 충돌을 막으려 `_sj` 접미사를 붙인다.
  return `<span class="return-time">${inner}<svg viewBox="0 0 210 62" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="crayonCircle_sj" x="-20%" y="-30%" width="140%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" seed="8" result="grain"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="grain" scale="3" xChannelSelector="R" yChannelSelector="G" result="w"></feDisplacementMap><feColorMatrix in="grain" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 -4.3" result="holes"></feColorMatrix><feComposite in="w" in2="holes" operator="out"></feComposite></filter></defs><g fill="none" stroke="#e0b100" stroke-linecap="round" filter="url(#crayonCircle_sj)"><path stroke-width="4.8" d="M185 8 C148 -2 47 3 18 19 C-4 33 10 53 44 57 C101 63 181 48 199 31 C215 17 200 9 180 7"></path><path stroke-width="2.4" d="M165 3 C120 -2 38 11 11 30 C-2 43 30 59 65 58 C135 60 187 43 201 24"></path></g></svg></span>`;
}

function conditionLineMarkup({ kind, returnEstimate, costLine }) {
  const showReturn = kind === "wait" && returnEstimate;
  const parts = [];
  if (showReturn) parts.push(returnTimeMarkup(returnEstimate, costLine));
  else if (costLine) parts.push(escapeHtml(costLine));
  if (!parts.length) return "";
  return `<p class="condition" id="secondConditionLine">${parts.join("<br>")}</p>`;
}

function readinessStepMarkup(model) {
  let {
    chosen,
    decision,
    jitQuestion,
    jitAnswer,
    preflight,
    amount,
    canSend,
    sendReason,
    devPreview,
    // [A-421 v25] 아래 4개는 main.js 가 실제 데이터에서만 채운다 — 없으면 null 로 와서
    // 해당 줄을 그리지 않는다(시안 예시 수치로 채우지 않는다, APP_HANDOFF.md:30).
    balanceLine = null,
    failureLine = null,
    costLine = null,
    returnEstimate = null,
    claimValue = null,
  } = model;
  const claimValueIsText = claimValue !== null && claimValue !== "" && !Number.isFinite(Number(claimValue));
  if (!chosen) {
    return `
      <h2 class="secondJourney__heading">Check</h2>
      <p class="secondJourney__hint">Pick a candidate to check first.</p>
      <div class="secondJourney__footer">
        <button class="sendCard__stay" id="stayButton" type="button">back to Home</button>
        <button class="sendCard__stay" id="exploreBackButton" type="button">back</button>
      </div>
    `;
  }
  const needsJit = decision?.action === "ask" && !jitAnswer && jitQuestion;
  if (needsJit) {
    // [A-377 §6] 질문이 제목 자리를 쓴다 — chosen.title(카드 이름) + 질문 문장을
    // 나란히 두 번 찍지 않는다(구 "chosen.title 헤딩 + 질문 문단" 중복 제거).
    const answers = jitQuestion.answers
      .map(
        (answer) => `<button class="secondJourney__jitBtn" type="button" data-jit-answer="${escapeHtml(answer)}">${escapeHtml(answer.replace(/_/g, " "))}</button>`,
      )
      .join("");
    return `
      <h2 class="secondJourney__heading">${escapeHtml(jitQuestion.prompt)}</h2>
      <div class="secondJourney__list">${answers}</div>
      <div class="secondJourney__footer">
        <button class="sendCard__stay" id="stayButton" type="button">back to Home</button>
        <button class="sendCard__stay" id="exploreBackButton" type="button">back</button>
      </div>
    `;
  }
  // [A-421 v25] READY 일 때의 Paper 발화는 "Send this one?" 인데, 최신 승인은 이 카드에서
  // 그 제목을 없애고 선택된 행동을 주인공으로 둔다(CURRENCY_NOTES.md:18). 그래서 이
  // 상태줄은 아직 준비되지 않은 상태(checking…/nah.)만 말한다 — READY 면 비운다.
  const preflightLine = preflight && preflight.status !== "JOB_READY" ? escapeHtml(paperStatusCopy(preflight.status)) : "";
  const kind = readinessCardKind(chosen);
  const jobTitle = secondActionTitle(chosen);
  // [A-421 v25] 승인 시안(amount-card-review/index.html:10) 구조를 그대로 옮긴다.
  // - 별도 "Send this one?" 제목 제거(CURRENCY_NOTES.md:18 최신 Owner 지시). 선택된 행동이
  //   카드의 h1(.job)이 된다 — 24/28 Handrawn + 노란 밑강조는 style.css 담당(다른 좌석).
  // - 금액형/지연귀환형/수령형 3상태(APP_HANDOFF.md:21-24). 시안의 review-modes nav 는
  //   검토 하네스 조작부라 옮기지 않는다.
  // - 시안의 24 / 3.20 / 0.10 / 2 days 는 예시 수치다(APP_HANDOFF.md:30) — 실제 값이
  //   없으면 자리를 비운다. 데모 상수를 앱에 넣지 않는다.
  // [A-421 Owner] 거래 없는 미리보기도 시안 배치 그대로 — 실제 값이 들어올 자리에
  // 무엇이 표시될지만 적는다(숫자 발명 0, DEV 미리보기에서만).
  // [A-912 · item 2] unknown value = "—" (pre-A-912 baseline: each placeholder was a parenthesised stand-in phrase).
  if (devPreview) {
    balanceLine = balanceLine || "> remaining amount at home · USDC —";
    costLine = costLine || "cost · —";
    returnEstimate = returnEstimate || "return time —"; // 지연귀환형에서만 그려짐(conditionLineMarkup kind==="wait")
    if (readinessCardKind(chosen) === "collect") claimValue = claimValue ?? "—"; // 값 자리만 표시
  }
  const amountBlock =
    kind === "collect" || kind === "status"
      ? ""
      : `
    <section class="amount">
      <!-- 시안의 이탤릭 label 자리. 시안(index.html:10)에도 보이는 텍스트가 없고
           "바깥 how much? 삭제"(CURRENCY_NOTES.md:2)라 승인된 문구가 없다 — 비워 둔다.
           입력의 접근성 이름은 시안과 같은 aria-label 이 맡는다. -->
      <label for="secondAmount"></label>
      <div class="field">
        <span>$</span>
        <input type="text" id="secondAmount" inputmode="decimal" placeholder="how much?" aria-label="Amount in USDC dollars" value="${escapeHtml(amount ?? "")}" />
      </div>
      ${amountLineMarkup()}
      ${balanceLine ? `<p class="balance" id="secondBalanceLine">${escapeHtml(balanceLine)}</p>` : `<p class="balance" id="secondBalanceLine" hidden></p>`}
      <p class="failure" id="secondAmountError" role="status"${failureLine ? "" : " hidden"}>${escapeHtml(failureLine || "")}</p>
    </section>
  `;
  // 수령형: 맡길 금액 칸 없음. 숫자든 글자든 같은 value 줄과 같은 밑줄 자리를 공유하고
  // ($ 는 돈일 때만), cost 는 to bring home 아래(APP_HANDOFF.md:35/44/47).
  const receiveBlock =
    kind === "collect"
      ? `
    <div class="receive">
      <div class="claim-value${claimValueIsText ? " claim-value--text" : ""}">${claimValue === null || claimValue === "" ? "" : `${claimValueIsText ? "" : `<span>$</span> `}${escapeHtml(claimValue)}`}</div>
      ${amountLineMarkup()}
      <div class="claim-bring">to bring home</div>
    </div>
  `
      : "";
  // 지연귀환형: 예상 귀환(노란 크레용 동그라미 .return-time, Owner 색 규칙 확정) + cost. 실제 exit
  // evidence 기반 값만 그린다(APP_HANDOFF.md:12) — 없으면 줄 자체를 그리지 않는다.
  const conditionBlock = conditionLineMarkup({ kind, returnEstimate, costLine });
  // [A-421] chosen.title 은 job-feed.js 내부 fixture 이름("Swap-like Trade" 등)이다 —
  // Owner 실관찰: check 클릭 뒤 이 제목이 그대로 보였다. destinationDisplayLabel()로
  // 이미 approved 된 errand.label 로 되짚는다(위 :함수 정의 주석). 같은 자리에 Name/
  // Explore 와 동일 정본 Delicious Handrawn 36/30/0(secondJourney__heading--interests +
  // secondJourney__exploreText, 기존 클래스 재사용, 새 CSS 0)을 적용한다(Owner 지시).
  // [A-421 실화면 교정] 이 제목만 --interests/exploreText 조합을 쓰지 않는다. 그 두
  // 클래스는 Explore 의 고정 문구 "places to explore?" 전용 장식이라 width:max-content
  // (style.css:2994) + white-space:nowrap (:3023) 을 갖는다 — 길이가 고정인 문구에는
  // 맞지만, 여기 제목은 심부름 이름을 이어 붙인 가변 문구라 줄바꿈이 막혀 카드 밖으로
  // 밀려 나갔다(실측 903×773: 제목 width 425 vs body clientWidth 378 → 오른쪽 19.8
  // screen px 잘림 + 카드 안 가로 스크롤바, 사진 12). 기본 .secondJourney__heading 이
  // 이미 정본 36/30/0 을 갖고 있고(style.css:1140) 평범한 블록이라 줄바꿈된다 —
  // 정본 값을 바꾸지 않고 Explore 전용 장식만 뺀다.
  return `
    <h1 class="job">${escapeHtml(jobTitle)}</h1>
    ${amountBlock}
    ${receiveBlock}
    ${conditionBlock}
    <div class="footer">
      <!-- footer 자리는 시안(index.html:10) 그대로지만 버튼 정본은 Owner 확정에
           따라 **기존 오리지널 종이 버튼 하나로 통일**한다("버튼은 다 통일이야 ... 이미
           버튼 네임에 쓰고 있는버튼써"): Send 는 Name 카드 ok/save 와 같은 .pkbtn 껍질
           (send-card.js sendCardButtonMarkup)을 그대로 호출한다. 시안의 .send /
           112×38 / radius999 / Hand 23-26 은 쓰지 않는다 — 낱말 크기도 기존
           --btnWordSize(20px) 토큰 그대로다. Home/back 은 시안과 같이 글자 버튼(.back).
           id 는 기존 배선(main.js wireExploreCard)을 유지한다. -->
      <button class="back" id="stayButton" type="button">Home</button>
      ${sendCardButtonMarkup({ id: "secondSendButton", label: "Send", disabled: !canSend })}
    </div>
    <p class="secondJourney__reason" id="secondSendReason"${devPreview ? " hidden" : ""}>${escapeHtml(sendReason || "")}</p>
  `;
}

// model = { step, errands, selectedIds, destinations, errandLabelById, chosen, decision,
//           jitQuestion, jitAnswer, preflight, permission, amount, amountError, canSend,
//           sendReason, devPreview }
export function secondJourneyCardMarkup(model = {}) {
  const step = model.step || "interests";
  const body =
    step === "interests"
      ? interestsStepMarkup(model)
      : step === "candidates"
        ? candidatesStepMarkup(model)
        : step === "note"
          ? noteStepMarkup(model.note || {})
          : readinessStepMarkup(model);
  return `
    <div class="sendCard secondJourneyCard${step === "candidates" ? " secondJourneyCard--candidates" : ""}" id="secondJourneyCard">
      <span class="sendCard__dot" aria-hidden="true"></span>
      ${mastheadMarkup(model.journeyNumber)}<div class="secondJourney__body"><svg class="secondJourney__inkDefs" aria-hidden="true"><defs><filter id="a373-askink" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency="0.10" numOctaves="3" seed="4" result="t"/>
      <feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="w"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="t2"/>
      <feColorMatrix in="t2" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 4 0 0 0 -2.9" result="h"/>
      <feComposite in="w" in2="h" operator="out"/></filter><filter id="a373-cb" x="-25%" y="-25%" width="150%" height="150%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="5" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G"/></filter><filter id="a373-ck" x="-30%" y="-30%" width="160%" height="160%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="9" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>${body}</div>
    </div>
  `;
}
