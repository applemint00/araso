// [A-1360 · Owner 10-17 15:4x "열린 동안 보내기 승인만" · "그 Send 를 허락하는 거로 확인을 받는 거야" · 16:0x 판 E "글자 괜찮다"]
// [A-1364 · Owner 18:2x "이 줄을 빼고 금액은 큰 숫자 하나만 · 제안대로" · "다 같아야 해"] "piggy goes with this." is gone.
// The money Send approval sheet (Design canvas "Send 로그인 설명 시안" 판 E): it rises from the bottom over the screen — Piggy's face,
// the job's title, its two lines, the amount alone (one big number · none for a job with no amount), then "not now" and "allow" —
// every sheet the same height (판 E 332, short content sits at the top, the buttons on the same bottom line). It is an allow, never a Face ID:
// no Face ID mark, no sign-in words. Words come from the caller (only words that screen already has, or the Owner's job set).
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const SEND_ALLOW_COPY = Object.freeze({ notNow: "not now", allow: "allow" });

// [A-1434 A8 · 시안 v4] note = a small grey line under the amount (the first Send only: the tutorial's actual send); Job · Gift pass none
export function sendAllowMarkup({ title = "", lines = [], amount = "", note = "" } = {}) {
  const body = (Array.isArray(lines) ? lines : []).filter((l) => typeof l === "string" && l.trim());
  return `<div class="sendAllow" id="sendAllowSheet" role="dialog" aria-modal="true" aria-label="${esc(title || SEND_ALLOW_COPY.allow)}">
  <div class="sendAllow__veil" aria-hidden="true"></div>
  <div class="sendAllow__sheet">
    <div class="sendAllow__grip" aria-hidden="true"></div>
    <div class="sendAllow__head"><img class="sendAllow__face" src="/icons/icon-192.png" alt="" draggable="false" /><div class="sendAllow__title">${esc(title)}</div></div>
    ${body.length ? `<div class="sendAllow__lines">${body.map((l) => `<span class="sendAllow__line">${esc(l)}</span>`).join("")}</div>` : ""}
    ${amount ? `<div class="sendAllow__amount"><span class="sendAllow__sum">${esc(amount)}</span></div>` : ""}
    ${note ? `<div class="sendAllow__note">${esc(note)}</div>` : ""}
    <div class="sendAllow__row"><button type="button" class="sendAllow__no" id="sendAllowNo">${SEND_ALLOW_COPY.notNow}</button><button type="button" class="sendAllow__yes" id="sendAllowYes">${SEND_ALLOW_COPY.allow}</button></div>
  </div>
</div>`;
}
