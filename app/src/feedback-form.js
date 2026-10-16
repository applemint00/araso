// Tester feedback (design feedback_form_sian_20261016 A5 · C · D): a handwritten `feedback ♡` at the foot of the Home paper opens one
// paper sheet; Send posts the words with two fixed words (screen · os bucket) to /api/feedback; afterwards the paper folds and Chog says
// one gold line, then the screen goes back. No address, key, passkey or device model leaves the page.
import { coarseOsBucket } from "./os-bucket.js";
import { FEEDBACK_MAX_CHARS, feedbackText } from "./feedback-schema.js";
import { a911Fit } from "./a911-screens.js";

export const FEEDBACK_COPY = Object.freeze({
  entry: "feedback",
  title: "Tell us",
  hint: "anything that felt strange",
  sentWith: "sent with:",
  send: "Send",
  thanks: "got it. thank you",
});
const SCREEN_LABEL = Object.freeze({ home: "Home" });
const DEVICE_LABEL = Object.freeze({ ios18_7: "iPhone", ios18: "iPhone", ios17: "iPhone", ios_old: "iPhone", ipados: "iPad", android: "Android", mac: "Mac", windows: "Windows" });
const THANKS_MS = 3000;
const FOLD_MS = 320;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const HEART = `<svg class="homeFeedback__heart" viewBox="0 0 24 22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19.5C8.4 16.9 3 13.2 3 8.4 3 5.6 5.1 3.6 7.6 3.6c1.9 0 3.4 1.1 4.3 2.7.9-1.6 2.5-2.7 4.4-2.7 2.5 0 4.6 2 4.6 4.8 0 4.8-5.3 8.4-8.9 11.1"/></svg>`;

/** The Home paper foot entry: words + heart are one tap target. */
export function feedbackEntryMarkup() {
  return `<button class="homeFeedback" id="homeFeedback" type="button"><span class="homeFeedback__word">${esc(FEEDBACK_COPY.entry)}</span>${HEART}</button>`;
}

/** "Home · iPhone · 18:26" — what goes with the words, shown before Send. */
export function feedbackSentWith({ screen = "home", os = "other", at = new Date() } = {}) {
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return [SCREEN_LABEL[screen] || screen, DEVICE_LABEL[os] || "other", `${hh}:${mm}`].join(" · ");
}

/** view: { text, sentWith, sending, stage: "write" | "thanks", typing } */
export function feedbackScreenMarkup(view = {}) {
  const thanks = view.stage === "thanks";
  const canSend = !view.sending && feedbackText(view.text || "") !== null;
  const paper = thanks ? "" : `<section class="a911-paper fb-paper" data-fb-paper="1">
      <h2 class="fb-title">${esc(FEEDBACK_COPY.title)}</h2>
      <p class="fb-hint">${esc(FEEDBACK_COPY.hint)}</p>
      <textarea class="fb-text" id="feedbackText" rows="4" maxlength="${FEEDBACK_MAX_CHARS}" autocomplete="off" aria-label="${esc(FEEDBACK_COPY.title)}">${esc(view.text)}</textarea>
      <p class="fb-with">${esc(FEEDBACK_COPY.sentWith)} ${esc(view.sentWith)}</p>
    </section>`;
  const act = thanks ? "" : `<button class="a911-act a911-act--ok" id="feedbackSend" type="button"${canSend ? "" : " disabled"}><span class="a911-act__label">${esc(FEEDBACK_COPY.send)}</span></button>`;
  const say = thanks ? `<span class="chogCheckLine fb-thanks" id="feedbackThanks" role="status">${esc(FEEDBACK_COPY.thanks)}</span>` : "";
  return `<div class="a911-screen" data-a911="feedback" data-a911-stage="${thanks ? "thanks" : "write"}"${view.typing ? ' data-typing="1"' : ""} style="--a911-tex:url('/card/paper_tex_ivory.png')">
    <p class="arasoBrand a911-brand" aria-hidden="true">Araso</p>
    ${thanks ? "" : `<button class="a911-back" type="button" aria-label="back" id="feedbackBack"><span class="a911-back__chip"><img class="a911-back__img" src="/card/back-sticker.svg" alt="" draggable="false" /></span></button>`}
    <h1 class="a911-title"></h1>
    <div class="a911-body">${paper}${say}</div>
    ${act}
  </div>`;
}

/**
 * Mount the entry behaviour once. `post(body)` resolves true when the server took it; `onClosed()` runs after the screen leaves.
 * `say(line)` shows the thank-you line on Home's own Chog and returns that line's element (removed after 3 s); null = the screen shows it.
 */
export function mountFeedback({ document: doc = globalThis.document, window: win = globalThis.window, post = null, say = null, now = () => new Date(), userAgent = () => win?.navigator?.userAgent || "" } = {}) {
  if (!doc || typeof doc.addEventListener !== "function") return { open() {}, close() {} };
  const s = { text: "", sending: false, stage: "write", typing: false, os: "other", at: now() };
  const root = () => doc.querySelector('.a911-screen[data-a911="feedback"]');
  const view = () => ({ text: s.text, sending: s.sending, stage: s.stage, typing: s.typing, sentWith: feedbackSentWith({ screen: "home", os: s.os, at: s.at }) });
  const kb = () => {
    const vv = win?.visualViewport;
    if (!vv || !(vv.height > 0)) return 0;
    const covered = Math.round(win.innerHeight - vv.height - (Number(vv.offsetTop) || 0));
    return covered > 40 ? covered : 0;
  };
  const layout = () => { const r = root(); if (r) a911Fit(r, { kb: kb() }); };
  const paint = () => {
    const tpl = doc.createElement("template");
    tpl.innerHTML = feedbackScreenMarkup(view()).trim();
    const next = tpl.content.firstElementChild;
    const cur = root();
    const focused = cur && doc.activeElement && doc.activeElement.id === "feedbackText";
    if (cur) cur.replaceWith(next); else doc.body.append(next);
    if (focused) { const t = next.querySelector("#feedbackText"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
    layout();
  };
  const syncSend = () => { const b = root()?.querySelector("#feedbackSend"); if (b) b.disabled = s.sending || feedbackText(s.text) === null; };
  const close = () => { root()?.remove(); s.text = ""; s.sending = false; s.stage = "write"; s.typing = false; };
  const open = () => { s.text = ""; s.sending = false; s.stage = "write"; s.typing = false; s.os = coarseOsBucket(userAgent()); s.at = now(); paint(); };
  const send = async () => {
    const text = feedbackText(s.text);
    if (s.sending || text === null || typeof post !== "function") return;
    s.sending = true; syncSend();
    let ok = false;
    try { ok = (await post({ text, screen: "home", os: s.os })) === true; } catch { ok = false; }
    s.sending = false;
    if (!ok) { syncSend(); return; } // the same paper stays with the words: Send again
    const paper = root()?.querySelector("[data-fb-paper]");
    if (paper) paper.classList.add("is-folding");
    win.setTimeout(() => {
      close();
      const line = typeof say === "function" ? say(FEEDBACK_COPY.thanks) : null;
      if (line) { win.setTimeout(() => line.remove(), THANKS_MS); return; }
      s.stage = "thanks"; paint(); // no Home Chog on screen: the line shows on its own
      win.setTimeout(close, THANKS_MS);
    }, FOLD_MS);
  };
  doc.addEventListener("click", (event) => {
    const t = event.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("#homeFeedback")) { event.preventDefault(); event.stopPropagation(); open(); return; }
    const r = root();
    if (!r || !r.contains(t)) return;
    if (t.closest("#feedbackBack")) { close(); return; }
    if (t.closest("#feedbackSend")) void send();
  }, true);
  doc.addEventListener("input", (event) => {
    if (event.target?.id !== "feedbackText") return;
    s.text = event.target.value;
    syncSend();
  });
  const focusChange = () => win.setTimeout(() => {
    const r = root();
    if (!r) return;
    const on = doc.activeElement?.id === "feedbackText";
    if (on === s.typing) { layout(); return; }
    s.typing = on;
    if (on) r.dataset.typing = "1"; else r.removeAttribute("data-typing");
    layout();
  }, 50);
  doc.addEventListener("focusin", focusChange);
  doc.addEventListener("focusout", focusChange);
  win?.addEventListener?.("resize", layout);
  win?.visualViewport?.addEventListener?.("resize", layout);
  return { open, close };
}

/** The live sender: same-origin JSON POST; true only on 204. */
export async function postFeedback(body, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") return false;
  const res = await fetchImpl("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return Boolean(res) && res.status === 204;
}
