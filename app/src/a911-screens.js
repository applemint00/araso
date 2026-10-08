// [A-911] Own screens: Gift a Piggy · Money · Move money (design writer, wt a911d).
// MARKUP + LAYOUT ONLY. No money logic, no storage, no network, no new copy. Every visible word below already exists in the app or in the
// Owner README 2026-10-08 ("Gift a Piggy", "Move money", "Money", "Send", "in", "out", "tap to turn it over", "for you", "from <Piggy> · $X",
// "Gift gas cost", "Araso fee", "Not ready yet", "Monad network", "Pay with ...", the A-905 / A-898 lines).
//
// The builders take the SAME view-model shapes as the live modules (giftSendView / moneyTabView / outView / fundingPaperView), reduced to what
// the screen prints, and keep the live `data-a898-act` / `data-a905-act` / `data-a905-field` / `data-a898-field` attributes, so the existing
// delegated handlers keep working once the app writer mounts these strings into a `.a911-screen` host (see DESIGN.md).
//
// a911Fit(root) is pure geometry: it only writes CSS custom properties (--a911-*) on the screen root. No state.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const A911_COPY = Object.freeze({
  gift: "Gift a Piggy",
  move: "Move money",
  money: "Money", // mock M0 title (A-905 constant MONEY_TAB_TITLE was "MONEY": see DESIGN.md UNKNOWN U3)
  send: "Send",
  ok: "ok",
  turn: "tap to turn it over",
  forYou: "for you",
  back: "back",
  notReady: "Not ready yet",
  network: "Monad network",
  copy: "copy",
  copied: "copied",
});

const FACE_ICON = `<svg class="a911-act__icon" viewBox="0 0 22 22" fill="none" stroke="#E0B100" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 7 V5 Q2 2 5 2 H7 M15 2 H17 Q20 2 20 5 V7 M20 15 V17 Q20 20 17 20 H15 M7 20 H5 Q2 20 2 17 V15"/><circle cx="7.5" cy="9" r="0.9" fill="#E0B100" stroke="none"/><circle cx="14.5" cy="9" r="0.9" fill="#E0B100" stroke="none"/><path d="M8 14.5 Q11 16.5 14 14.5"/></svg>`;
const COPY_ICON = (stroke) => `<svg class="a911-ico" viewBox="0 0 22 22" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="7" y="7" width="11" height="12" rx="2"/><path d="M4 14V5a2 2 0 0 1 2-2h8"/></svg>`;
const CHECK_ICON = `<svg class="a911-ico" viewBox="0 0 22 22" fill="none" stroke="#E0B100" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 11.5l4.5 4.5L18 6"/></svg>`;
const SHARE_ICON = `<svg class="a911-ico" viewBox="0 0 22 22" fill="none" stroke="#EDE8DC" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3v11"/><path d="M7 7l4-4 4 4"/><path d="M6 10H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 19h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 17 10h-1"/></svg>`;

// ── shell: ARASO (A-829 spot) · floating back sticker · centred handwritten title ─────────────────────────────────────────
// `back` = { act: "gift-back" | "back", attr: "data-a898-act" | "data-a905-act" } : the live attribute the existing handler listens to.
function shell({ kind, title, stage = "", typing = false, back, body, act = "" }) {
  return `<div class="a911-screen" data-a911="${kind}" data-a911-stage="${esc(stage)}"${typing ? ' data-typing="1"' : ""} style="--a911-tex:url('/card/paper_tex_ivory.png')">
    <p class="arasoBrand a911-brand" aria-hidden="true">Araso</p>
    <button class="a911-back" type="button" aria-label="${A911_COPY.back}" ${back.attr}="${back.act}"><span class="a911-back__chip"><img class="a911-back__img" src="/card/back-sticker.svg" alt="" draggable="false" /></span></button>
    <h1 class="a911-title">${esc(title)}</h1>
    <div class="a911-body">${body}</div>
    ${act}
  </div>`;
}

const actButton = ({ label, attrs, disabled = false, kind = "send" }) =>
  `<button class="a911-act a911-act--${kind}" type="button" ${attrs}${disabled ? " disabled" : ""}>${kind === "send" ? FACE_ICON : ""}<span class="a911-act__label">${esc(label)}</span></button>`;

// ── GIFT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// view: { stage: "fan"|"pick"|"done", ci (centred card index in fan), picked: "01"|"02"|"04"|null, flipped, typing: "none"|"letter"|"amount",
//         fronts: [{id}], amountUsd: 0|20|50|100|custom, presets: [{id,label,selected}], fields: {to,message,from}, payerName, balanceUsd,
//         short, shortfallUsd, faceIdLine, fees: {giftGasCost:{usd,known}, arasoFee:{usd}}, canSend, link, copied }
const FRONT_ART = Object.freeze({
  "01": { src: "/card/gift/piggy_stand.svg", style: "left:37px;top:103px;width:244px;transform-origin:122px 88px;transform:rotate(-8deg)", clip: "left:0;top:0;right:0;height:300px;overflow:hidden" },
  "02": { src: "/card/gift/piggy_seat_listen.svg", style: "left:70px;top:70px;width:200px", clip: null },
  "04": { src: "/card/gift/piggy_watching_fit.svg", style: "left:-34px;top:130px;width:270px", clip: null },
});

function frontFace(id, view) {
  const art = FRONT_ART[id];
  const img = `<img class="a911-pig" src="${art.src}" alt="" style="${art.style}" />`;
  const amount = view.amountUsd ? String(view.amountUsd) : "";
  const n = `${amount ? esc(amount) : "—"}`; // [A-911] amounts come from the $20 / $50 / $100 chips only; no typed-amount input (typing your own = follow-up card)
  return `<span class="a911-face a911-face--front">${art.clip ? `<span class="a911-pig a911-pig--clip" style="${art.clip}">${img}</span>` : img}
    <span class="a911-amt"><span class="a911-amt__n${amount ? "" : " is-empty"}">${n}<small>USDC</small></span><span class="a911-amt__h">${A911_COPY.forYou}</span></span></span>`;
}

function letterFace(view, interactive) {
  const f = view.fields || {};
  const dis = interactive ? "" : ' tabindex="-1"';
  return `<span class="a911-face a911-face--back">
    <span class="a911-letter__to"><span class="a911-letter__small">TO</span><input class="a911-letter__in a911-letter__in--to" type="text" autocomplete="off" maxlength="80" aria-label="TO" data-a898-field="to" value="${esc(f.to)}" placeholder="name"${dis} /></span>
    <span class="a911-letter__msgBox"><textarea class="a911-letter__in a911-letter__msg" rows="4" maxlength="140" autocomplete="off" aria-label="message" data-a898-field="message" placeholder="a few words…"${dis}>${esc(f.message)}</textarea></span>
    <img class="a911-letter__peek" src="/card/gift/piggy_face.svg" alt="" />
    <span class="a911-letter__from"><span class="a911-letter__small">FROM</span><input class="a911-letter__in a911-letter__in--from" type="text" autocomplete="off" maxlength="40" aria-label="FROM" data-a898-field="from" value="${esc(f.from)}"${dis} /></span>
  </span>`;
}

function giftCards(view) {
  const stage = view.stage;
  const ci = Number.isInteger(view.ci) ? view.ci : 1;
  const picked = view.picked;
  const cards = (view.fronts || []).map((fr, i) => {
    let d = i - ci; if (d > 1) d -= 3; if (d < -1) d += 3;
    const isPicked = picked === fr.id;
    const away = picked && !isPicked;
    const side = away ? (i < (view.fronts || []).findIndex((x) => x.id === picked) ? -1 : 1) : d;
    const cls = `a911-card${stage === "fan" ? (d === 0 ? " is-centre" : " is-side") : isPicked ? " is-picked" : " is-away"}${isPicked && view.flipped ? " is-flipped" : ""}`;
    return `<div class="${cls}" style="--d:${stage === "fan" ? d : isPicked ? 0 : side}" data-a898-front="${esc(fr.id)}" data-i="${i}">
      <button class="a911-cardTap" type="button" data-a898-act="gift-front" data-a898-arg="${esc(fr.id)}" aria-pressed="${isPicked}" aria-label="${esc(fr.id)}"${isPicked && view.flipped ? ' tabindex="-1"' : ""}></button>
      <span class="a911-card__inner">${frontFace(fr.id, view)}${isPicked ? letterFace(view, !!view.flipped) : ""}</span></div>`;
  }).join("");
  return `<div class="a911-cards" data-a898-picked="${esc(picked || "")}" data-a911-cards="${stage}">${cards}</div>`;
}

const money$ = (v) => (v == null || v === "" ? "" : String(v).startsWith("$") ? esc(v) : `$${esc(v)}`);

function giftCtrl(view) {
  const chips = (view.presets || []).map((p) => `<button class="a911-chip${p.selected ? " is-on" : ""}" type="button" aria-pressed="${!!p.selected}" data-a898-act="gift-amount" data-a898-arg="${esc(p.id)}">${esc(p.label)}</button>`).join("");
  const short = view.short
    ? `<div class="a911-short" data-a898-short="1"><span class="a911-short__line">need ${money$(view.shortfallUsd)} more</span><button class="a911-textBtn" type="button" data-a898-act="gift-add-money">Add money</button></div>` : "";
  const fees = view.fees || {};
  const gas = fees.giftGasCost && fees.giftGasCost.known ? money$(fees.giftGasCost.usd) : "";
  const araso = money$(fees.arasoFee ? fees.arasoFee.usd : "0");
  const mon = view.monOption && view.monOption.offered ? `<button class="a911-textBtn" type="button" data-a898-act="gift-use-mon">Use MON for the remaining ${money$(view.monOption.remainingUsd)}</button>` : "";
  const undo = view.payWith === "mon" ? `<button class="a911-textBtn" type="button" data-a898-act="gift-use-usdc">USDC</button>` : "";
  const explainBtn = view.faceIdLine && view.faceIdLine.exact && view.faceIdLine.assetChange ? `<button class="a911-textBtn" type="button" data-a898-act="gift-explain">What's this?</button>` : "";
  const explainBody = view.explainLines && view.explainLines.length ? `<div class="a911-faceLine" data-a898-explain="1">${view.explainLines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>` : "";
  const extra = (view.requote ? `<button class="a911-textBtn" type="button" data-a898-act="gift-requote">Try again</button>` : "")
    + (view.notReady ? `<div class="a911-faceLine" role="status">${A911_COPY.notReady}</div>` : "")
    + (view.notice ? `<div class="a911-faceLine" role="status" data-a898-notice="1">${esc(view.notice)}</div>` : "");
  const face = view.faceIdLine && view.faceIdLine.exact ? `<div class="a911-faceLine" data-a898-exact="1">${esc(view.faceIdLine.text)}${explainBtn}${undo}</div>${explainBody}` : undo ? `<div class="a911-faceLine">${undo}</div>` : "";
  return `<div class="a911-ctrl" data-a911-ctrl="1">
    <div class="a911-chips" role="group" aria-label="$">${chips}</div>
    <div class="a911-hint">${A911_COPY.turn}</div>
    <div class="a911-pay">from ${view.payerSwitch ? `<button class="a911-payBtn" type="button" data-a911-act="payer-next"><u>${esc(view.payerName)}</u></button>` : `<u>${esc(view.payerName)}</u>`} · ${money$(view.balanceUsd)}</div>
    ${short}${mon}${face}${extra}
    <div class="a911-fee"><span>Gift gas cost</span> ${gas} · <span>Araso fee</span> ${araso}</div>
  </div>`;
}

function linkStep(view) {
  return `<div class="a911-link" data-a898-link="1" data-a911-link="1">
    <span class="a911-link__url">${esc(view.link)}</span>
    <button class="a911-ibtn" type="button" data-a911-act="link-copy" data-copied="${view.copied ? "1" : "0"}" aria-label="${view.copied ? A911_COPY.copied : A911_COPY.copy}">${view.copied ? CHECK_ICON : COPY_ICON("#EDE8DC")}</button>
    <button class="a911-ibtn" type="button" data-a911-act="link-share" aria-label="share">${SHARE_ICON}</button>
  </div>`;
}

export function a911GiftMarkup(view = {}) {
  const typing = view.typing && view.typing !== "none";
  const body = view.stage === "done"
    ? `<div class="a911-giftGroup">${giftCards(view)}${linkStep(view)}</div>`
    : `<div class="a911-giftGroup">${giftCards(view)}${view.stage === "pick" ? giftCtrl(view) : ""}</div>`;
  const act = view.stage === "pick" ? actButton({ label: A911_COPY.send, attrs: 'data-a898-act="gift-faceid"', disabled: !view.canSend }) : "";
  return shell({ kind: "gift", title: A911_COPY.gift, stage: view.stage, typing, back: { attr: "data-a898-act", act: view.stage === "fan" || view.stage === "done" || view.notReady ? "gift-back" : "gift-repick" }, body, act });
}

// ── MONEY (tab) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// view: moneyTabView() output { total, assets, canMove, canGift, piggies:[{id,name,amount,away}] }
function piggyRow(r, { pick = null, on = false } = {}) {
  const away = r.away ? ' data-away="1"' : "";
  const inner = `<span class="a911-piggy__name">${esc(r.name)}</span><span class="a911-piggy__amt">${esc(r.amount)}</span>${r.away ? `<span class="a911-piggy__note">still out working.</span>` : ""}`;
  const cur = on ? ' aria-current="true"' : "";
  if (pick === null) return `<div class="a911-piggy"${away}>${inner}</div>`;
  if (r.away) return `<div class="a911-piggy"${away} data-pick="0" aria-disabled="true">${inner}</div>`;
  return `<button class="a911-piggy" type="button"${cur} data-pick="1" data-a905-act="${esc(pick)}" data-a905-arg="${esc(r.id)}">${inner}</button>`;
}
const list = (rows, opts) => `<div class="a911-list" data-a911-list="1">${(rows || []).map((r) => piggyRow(r, opts)).join("")}</div>`;

export function a911MoneyMarkup(view = {}) {
  const row = (id, act, label, ok, note = "") => `<button class="a911-row" type="button" id="${id}" data-a905-act="${act}"${ok === false ? ' disabled aria-disabled="true"' : ""}>&gt; ${esc(label)}${note ? ` <span class="a911-row__note">${esc(note)}</span>` : ""}</button>`;
  const body = `<section class="a911-paper a911-money" data-a905-view="tab">
    <div class="a911-money__head">${view.total ? `<p class="a911-money__total">${esc(view.total)}</p>` : ""}${view.assets ? `<p class="a911-money__assets">${esc(view.assets)}</p>` : ""}</div>
    <div class="a911-money__rows">${row("a905MoveMoney", "move", A911_COPY.move, view.canMove)}${row("a905GiftPiggy", "gift", A911_COPY.gift, view.canGift, view.allAway && !view.canGift ? "still out working." : "")}</div>
    ${list(view.piggies)}
  </section>`;
  return shell({ kind: "money", title: A911_COPY.money, stage: "tab", back: { attr: "data-a905-act", act: "back" }, body });
}

// ── MOVE MONEY ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// view: { dir: "in"|"out", step, typing,
//   in : step "rows" { rows:[{id,label,available}] } | "split" { total, split:[{id,name,amount}], canOk } | "crypto" { assets:[{id,selected}], network, address, copied }
//        | "state" { text }  (checking… / nothing moved. / can't tell yet. / ok)
//   out: step "pick" { rows } | "amount" { piggy:{name}, balance, amount, choices:[{id,label,selected}] } | "address" { piggy, amount, asset, address, notice } }
const sw = (dir) => `<div class="a911-sw" role="group">${["in", "out"].map((v) => `<button class="a911-sw__opt" type="button" data-dir="${v}" data-a905-act="dir" data-a905-arg="${v}" aria-pressed="${dir === v}">${v}</button>`).join("")}</div>`;
const mono = (addr) => `<div class="a911-mono" data-a898-address="1">${esc(addr)}</div>`;
const chips2 = (choices) => `<div class="a911-chips a911-chips--paper" role="group" aria-label="$">${(choices || []).map((c) => `<button class="a911-chip${c.selected ? " is-on" : ""}" type="button" aria-pressed="${!!c.selected}" data-a905-act="out-choice" data-a905-arg="${esc(c.id)}">${esc(c.label)}</button>`).join("")}</div>`;

function moveBody(view) {
  const s = view.step;
  const notice = view.notice ? `<div class="a911-note" role="status" data-a898-notice="1">${esc(view.notice)}</div>` : "";
  if (view.dir === "in") {
    if (s === "rows") {
      const pre = view.prefill ? `<div class="a911-note a911-note--top" data-a898-prefill="1">$${esc(view.prefill)}</div>` : "";
      const legs = (view.legs || []).map((l) => `<div class="a911-line" data-add-money-leg="${esc(l.id)}"><span>${esc(l.name)}</span><span class="a911-line__r">${esc(l.amount)}<small>${esc(l.unit || "USDC")}</small></span></div>`).join("");
      return pre + legs + (view.rows || []).map((r) => r.available
        ? `<button class="a911-line a911-line--go" type="button" ${r.act === "plan-fund" ? `data-a905-act="plan-fund" data-a905-arg="${esc(r.id)}"` : `data-a898-act="funding-row" data-a898-arg="${esc(r.id)}"`} data-a898-row="${esc(r.id)}">&gt; ${esc(r.label)}</button>`
        : `<div class="a911-line a911-line--off" aria-disabled="true" data-a898-row="${esc(r.id)}"><span>${esc(r.label)}</span><span class="a911-line__note">${A911_COPY.notReady}</span></div>`).join("") + notice;
    }
    if (s === "split") {
      const rows = (view.split || []).map((p) => `<div class="a911-line" data-add-money-row="${esc(p.id)}"><span>${esc(p.name)}</span><input class="a911-amtField a911-amtField--sm" type="text" inputmode="decimal" autocomplete="off" aria-label="${esc(p.name)}" id="homeAddMoneyAmount--${esc(p.id)}" value="${esc(p.amount)}" /></div>`).join("");
      return `<div class="a911-line"><span>total</span><input class="a911-amtField a911-amtField--sm" type="text" inputmode="decimal" autocomplete="off" aria-label="total" id="homeAddMoneyTotal" value="${esc(view.total)}" /></div>${rows}`;
    }
    if (s === "crypto") {
      const chips = (view.assets || []).map((a) => `<button class="a911-asset${a.selected ? " is-on" : ""}" type="button" aria-pressed="${!!a.selected}" data-a898-act="funding-asset" data-a898-arg="${esc(a.id)}">${esc(a.id)}</button>`).join("");
      return `<div class="a911-line a911-line--head">Pay with crypto</div><div class="a911-assets" role="group">${chips}</div>
        <div class="a911-note">${esc(view.network || A911_COPY.network)}</div>
        <div class="a911-addr">${mono(view.address)}<button class="a911-ibtn a911-ibtn--ink" type="button" data-a898-act="funding-copy" data-copied="${view.copied ? "1" : "0"}" aria-label="${view.copied ? A911_COPY.copied : A911_COPY.copy}">${view.copied ? CHECK_ICON : COPY_ICON("#141210")}</button></div>${notice}`;
    }
    return `<div class="a911-state" role="status">${esc(view.text)}</div>${view.check ? `<button class="a911-textBtn" type="button" data-a898-act="funding-check">Try again</button>` : ""}`;
  }
  // out
  if (s === "pick") return list(view.rows, { pick: "out-pick" });
  if (s === "amount") {
    return `<div class="a911-note a911-note--top">from <u>${esc(view.piggy.name)}</u> · ${esc(view.balance)}</div>
      <div class="a911-amtField" data-a905-amount-view="1">${view.amount ? esc(view.amount) : "$"}</div>${chips2(view.choices)}`; // [A-911] read-only: chips only (typing your own = follow-up card)
  }
  return `<div class="a911-line"><span>${esc(view.piggy.name)}</span><span class="a911-line__r">${esc(view.amount)}<small>${esc(view.asset || "USDC")}</small></span></div>
    <div class="a911-note">to</div>
    <textarea class="a911-addrField" rows="2" spellcheck="false" autocomplete="off" aria-label="to" data-a905-field="address">${esc(view.address)}</textarea>
    ${view.notice ? `<div class="a911-note">${esc(view.notice)}</div>` : ""}`;
}

export function a911MoveMarkup(view = {}) {
  const typing = !!view.typing;
  const body = `<section class="a911-paper a911-move" data-a905-view="move" data-a905-dir="${view.dir}" data-a905-step="${esc(view.step)}">${view.noSwitch ? "" : sw(view.dir)}<div class="a911-move__body${view.step === "pick" || view.step === "split" ? " has-list" : ""}">${moveBody(view)}</div></section>`;
  let act = "";
  if (view.dir === "out" && view.step === "address") act = actButton({ label: A911_COPY.send, attrs: 'id="a905OutFaceId" data-a905-act="out-faceid"', disabled: view.canSend === false });
  else if (view.dir === "out" && view.step === "amount") act = actButton({ label: A911_COPY.ok, attrs: 'id="a905OutOk" data-a905-act="out-next"', kind: "ok", disabled: view.canOk === false });
  else if (view.dir === "in" && view.step === "split") act = actButton({ label: A911_COPY.ok, attrs: 'id="homeAddMoneyOk" data-add-money="ok"', kind: "ok", disabled: view.canOk === false });
  return shell({ kind: "move", title: A911_COPY.move, stage: `${view.dir}-${view.step}`, typing, back: { attr: "data-a905-act", act: "back" }, body, act });
}

// ── geometry (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// [A-917] A-829 keyframe maths, same as main.js hkKey (390 / 810 / 1440, linear between; below 390 x W/390 and above 1440 x min(W/1440, 1.33) unless pct).
const A911_CAP = 1.33;
function a911Key(W, kf, pct) {
  const [a, b, c] = kf;
  if (W <= 390) return pct ? a : (a * W) / 390;
  if (W <= 810) return a + ((b - a) * (W - 390)) / 420;
  if (W <= 1440) return b + ((c - b) * (W - 810)) / 630;
  return pct ? c : c * Math.min(W / 1440, A911_CAP);
}
// the one zoom for text / button / paper / gutters: NO media-query steps. Below 390 it stays 1 (A-843 on-screen minimum 12 px beats A-829 "below 390 x W/390").
export const a911Z = (W) => a911Key(W, [1, 1.15, 1.35], true) * (W > 1440 ? Math.min(W / 1440, A911_CAP) : 1);
export const a911Bottom = (W, H) => a911Key(W, [0.071, 0.08, 0.08], true) * H; // A-829 bottom margin (floor to viewport bottom), + safe-area in CSS
export const a911SideM = (W) => a911Key(W, [20, 52, 120]);

// Writes --a911-* vars on the screen root. Reads: the root's .a911-body rect (already ends above the keyboard when typing), the optional
// .a911-ctrl height. `kb` = px the keyboard covers (visualViewport based in the app; a number in the frames).
export function a911Fit(root, { width = window.innerWidth, height = window.innerHeight, kb = 0 } = {}) {
  if (!root) return null;
  const set = (k, v) => root.style.setProperty(k, String(v));
  const W = width;
  const z = a911Z(W);
  set("--a911-z", z.toFixed(5));
  set("--a911-bm", `${a911Bottom(W, height).toFixed(3)}px`);
  set("--a911-kb", `${kb}px`);
  const body = root.querySelector(".a911-body");
  let availH = 0;
  if (body) { const cs = getComputedStyle(body); availH = body.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0); } // content box only (after --a911-z / --a911-bm landed)
  const tier = W < 1024 ? 0 : 2; // only the Gift controls side-by-side switch (>= 1024); card scales below are interpolated, not tiered
  // card scales from the mock (gift_screen_mock.html P()), keyframed 390 / 810 / 1440: [fan centre, fan side, fan dx, pick, done]
  const kf = (i, c) => a911Key(W, [c[0][i], c[1][i], c[2][i]], true);
  const KF = [[0.84, 0.66, 158, 1.17, 0.86], [1.2, 0.95, 270, 1.55, 1.2], [1.18, 0.96, 300, 1.6, 1.25]];
  const T = [kf(0, KF), kf(1, KF), W <= 390 ? (158 * W) / 390 : kf(2, KF), kf(3, KF), kf(4, KF)];
  const stage = root.dataset.a911Stage;
  const typing = root.dataset.typing === "1";
  const ctrl = root.querySelector(".a911-ctrl");
  const link = root.querySelector(".a911-link");
  const gap = 20 * z;
  // [A-917 Cowork 19:20] the card size must not step at 1024: the controls' height is reserved on both sides of the arrangement switch (beside <-> below). Pre-A-917: 0 when beside, so the card grew ~1.6 % there.
  const ctrlH = !typing && ctrl ? ctrl.getBoundingClientRect().height + gap : 0;
  const linkH = link ? link.getBoundingClientRect().height + gap : 0;
  const fit = (want, extra) => Math.max(0.45, Math.min(want, (availH - extra - 4) / 342));
  if (root.dataset.a911 === "gift") {
    const fanC = fit(T[0], 0);
    set("--a911-fanC", fanC.toFixed(3));
    set("--a911-fanS", (fanC * (T[1] / T[0])).toFixed(3));
    set("--a911-dx", `${(T[2] * (fanC / T[0])).toFixed(1)}px`);
    set("--a911-s", (stage === "done" ? fit(T[4], linkH) : fit(T[3], ctrlH)).toFixed(3));
  }
  return { availH, tier, z };
}

// [A-917 B] Send / ok has NO JS placement: one pin in CSS (right = side margin line, bottom = safe-area + --a911-bm) at every width on every screen.

// Paper list: when the Piggy list is longer than the room (paper is capped by .a911-body), ONLY the list scrolls; the window ends on a half
// row ("2.5 + fade", home-paper-multi.js). Returns true when scrolling.
export function a911FitList(root) {
  const lists = root ? [...root.querySelectorAll(".a911-list")] : [];
  let scrolling = false;
  for (const l of lists) {
    l.style.maxHeight = ""; l.classList.remove("is-scroll", "is-end");
    if (l.scrollHeight <= l.clientHeight + 1) continue;      // fits: no scroll, no fade
    const rows = [...l.children]; if (!rows.length) continue;
    // the window ends on a half row ("2.5 + fade"): the last row whose upper half still fits is cut in the middle
    const room = l.clientHeight; let cut = rows[0].offsetHeight * 1.5;
    for (const r of rows) { const half = r.offsetTop - l.offsetTop + r.offsetHeight / 2; if (half <= room - 2) cut = half; }
    l.style.maxHeight = `${Math.round(cut)}px`;
    if (l.scrollHeight > l.clientHeight + 1) {
      l.classList.add("is-scroll"); scrolling = true;
      if (!l.dataset.a911Fade) {
        l.dataset.a911Fade = "1";
        l.addEventListener("scroll", () => l.classList.toggle("is-end", l.scrollTop + l.clientHeight >= l.scrollHeight - 2), { passive: true });
      }
    }
  }
  return scrolling;
}

// iPhone share sheet; unsupported / cancelled-by-error -> `fallbackCopy()` (copy instead). UI only: nothing is sent anywhere by this function.
export async function a911Share(url, fallbackCopy) {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try { await navigator.share({ url }); return "shared"; } catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  if (typeof fallbackCopy === "function") fallbackCopy();
  return "copied";
}
