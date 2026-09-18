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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const STATUS_COPY = {
  JOB_READY: "ready",
  JOB_ELIGIBLE_NEEDS_FUNDING: "needs funding",
  JOB_WAITING_RETURN: "waiting on return",
  JOB_CONDITIONAL: "condition not met yet",
  JOB_OPEN: "still open, no verdict yet",
  NAH: "not this one",
  NOT_JOB: "not a job",
};

function statusCopy(status) {
  return STATUS_COPY[status] || "unknown";
}

export function paperStatusCopy(status) {
  if (status === "JOB_READY") return "Send this one?";
  if (status === "NAH") return "nah.";
  return "checking…";
}

function mastheadMarkup() {
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();
  const weekdayLabel = today.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  return `<div class="secondJourney__masthead"><span class="secondJourney__dot" aria-hidden="true"></span><span class="secondJourney__date">${dateLabel}<small>${weekdayLabel}</small></span><span class="secondJourney__page" aria-hidden="true">—</span></div>`;
}

// 실제 경로에서 이 카드가 왜 Send 를 막고 있는지 — 속이지 않는다(§success_criteria
// "실제경로는 후보/권한/금융미연결을 속이지 않고 fail closed").
export function secondJourneySendReason(preflight, devPreview) {
  if (!preflight) return "check a candidate first";
  if (!devPreview) return "no live Second Journey adapter yet — preview only in DEV";
  if (preflight.status !== "JOB_READY") return `not ready yet (${preflight.reason || preflight.status})`;
  if (!preflight.executionPermission) return "turn on permission first";
  return "";
}

// amount 는 UI 입력/검증값이다 — 기존 고정 SEND_AMOUNT 를 바꾸는 승인이 아니다(§5).
export function validateSecondAmount(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return { valid: false, amount: null, error: "" };
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
  const items = errands
    .map(
      (errand) => `
        <label class="secondJourney__item">
          <input type="checkbox" data-errand-id="${escapeHtml(errand.id)}" ${selectedIds.includes(errand.id) ? "checked" : ""} />
          <svg class="secondJourney__checkbox" viewBox="0 0 34 34" aria-hidden="true"><g class="secondJourney__boxInk"><path d="M5 6 L29 4 L30 29 L4 30 Z" /></g><g class="secondJourney__checkInk"><path d="M8 18 L15 26 L28 6" /></g></svg>
          <span class="secondJourney__label">${escapeHtml(errand.label)}<svg class="secondJourney__underline" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><path d="M1 3.4 Q30 1.2 60 4 T99 3" /></svg></span>
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

function candidatesStepMarkup({ destinations = [] }) {
  const rows = destinations.length
    ? destinations
        .map(
          (destination) => `
            <div class="secondJourney__candidate">
              <div class="secondJourney__candidateTitle">${escapeHtml(destination.title)}</div>
              <div class="secondJourney__candidateStatus">${escapeHtml(statusCopy(destination.derivedStatus))}</div>
              <button class="secondJourney__checkBtn" type="button" data-destination-id="${escapeHtml(destination.id)}">check</button>
            </div>
          `,
        )
        .join("")
    : `<p class="secondJourney__hint">No matching errand destinations yet.</p>`;
  return `
    <h2 class="secondJourney__heading">Candidates</h2>
    <p class="secondJourney__hint">Interest is not the same as ready. Check one to see where it stands.</p>
    <div class="secondJourney__list">${rows}</div>
    <div class="secondJourney__footer">
      <button class="sendCard__stay" id="stayButton" type="button">back to Home</button>
      <button class="sendCard__stay" id="exploreEditButton" type="button">edit interests</button>
    </div>
  `;
}

function readinessStepMarkup(model) {
  const { chosen, decision, jitQuestion, jitAnswer, preflight, permission, amount, amountError, canSend, sendReason, devPreview } = model;
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
  const preflightLine = preflight ? escapeHtml(paperStatusCopy(preflight.status)) : "";
  return `
    <h2 class="secondJourney__heading">${escapeHtml(chosen.title)}</h2>
    <p class="secondJourney__reason" id="secondJourneyPreflightLine">${preflightLine}</p>
    <label class="secondJourney__item">
      <input type="checkbox" id="secondPermission" ${permission ? "checked" : ""} />
      <span>I want to go ahead if it's ready</span>
    </label>
    <label class="secondJourney__amountRow">
      <span>amount</span>
      <input type="number" id="secondAmount" inputmode="decimal" min="0" step="0.001" value="${escapeHtml(amount ?? "")}" />
    </label>
    <p class="secondJourney__reason" id="secondAmountError">${escapeHtml(amountError || "")}</p>
    ${devPreview ? `<p class="secondJourney__mockTag">UI preview — no transaction</p>` : ""}
    <div class="secondJourney__footer">
      <button class="sendCard__stay" id="stayButton" type="button">back to Home</button>
      <button class="sendCard__stay" id="exploreBackButton" type="button">back</button>
      ${sendCardButtonMarkup({ id: "secondSendButton", label: "Send", disabled: !canSend })}
    </div>
    <p class="secondJourney__reason" id="secondSendReason">${escapeHtml(sendReason || "")}</p>
  `;
}

// model = { step, errands, selectedIds, destinations, chosen, decision, jitQuestion,
//           jitAnswer, preflight, permission, amount, amountError, canSend, sendReason, devPreview }
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
    <div class="sendCard secondJourneyCard" id="secondJourneyCard">
      <span class="sendCard__dot" aria-hidden="true"></span>
      ${mastheadMarkup()}<div class="secondJourney__body"><svg class="secondJourney__inkDefs" aria-hidden="true"><defs><filter id="a373-askink" x="-15%" y="-15%" width="130%" height="130%">
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
