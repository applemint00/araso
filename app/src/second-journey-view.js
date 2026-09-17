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

function interestsStepMarkup({ errands = [], selectedIds = [] }) {
  const items = errands
    .map(
      (errand) => `
        <label class="secondJourney__item">
          <input type="checkbox" data-errand-id="${escapeHtml(errand.id)}" ${selectedIds.includes(errand.id) ? "checked" : ""} />
          <span>${escapeHtml(errand.label)}</span>
        </label>
      `,
    )
    .join("");
  return `
    <h2 class="secondJourney__heading">Explore</h2>
    <p class="secondJourney__hint">Pick what Piggy should look into. More than one is fine.</p>
    <form id="exploreForm" class="secondJourney__list">${items}</form>
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
        <button class="sendCard__stay" id="exploreBackButton" type="button">candidates</button>
      </div>
    `;
  }
  const needsJit = decision?.action === "ask" && !jitAnswer && jitQuestion;
  if (needsJit) {
    const answers = jitQuestion.answers
      .map(
        (answer) => `<button class="secondJourney__jitBtn" type="button" data-jit-answer="${escapeHtml(answer)}">${escapeHtml(answer.replace(/_/g, " "))}</button>`,
      )
      .join("");
    return `
      <h2 class="secondJourney__heading">${escapeHtml(chosen.title)}</h2>
      <p class="secondJourney__hint">${escapeHtml(jitQuestion.prompt)}</p>
      <div class="secondJourney__list">${answers}</div>
      <div class="secondJourney__footer">
        <button class="sendCard__stay" id="stayButton" type="button">back to Home</button>
        <button class="sendCard__stay" id="exploreBackButton" type="button">candidates</button>
      </div>
    `;
  }
  const preflightLine = preflight ? `&gt; ${escapeHtml(preflight.status)} · ${escapeHtml(preflight.reason || "")}` : "";
  return `
    <h2 class="secondJourney__heading">${escapeHtml(chosen.title)}</h2>
    <p class="secondJourney__hint">${escapeHtml(statusCopy(chosen.derivedStatus))}</p>
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
      ${sendCardButtonMarkup({ id: "secondSendButton", label: "Send this one?", disabled: !canSend })}
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
        : readinessStepMarkup(model);
  return `
    <div class="sendCard secondJourneyCard" id="secondJourneyCard">
      <span class="sendCard__dot" aria-hidden="true"></span>
      <div class="secondJourney__body">${body}</div>
    </div>
  `;
}
