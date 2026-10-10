// [A-905] Money tab — the Home Paper surface the honey jar opens (Owner 2026-10-08, gift_card_20261004/README "Home 입구 배치").
//
// Pure view-models + markup + one reducer. No DOM lookups, no storage, no network, no timers, no signing.
//  · the tab   : total $ (big) + real assets line (small) + two rows `> Move money` · `> Gift a Piggy` + each Piggy's amount.
//                MY MONEY stays a SUM view: no Piggy-tap money action, no Add/Send buttons inside Piggy cards, no special-cased Piggy kind.
//  · Move money: a two-word switch `in` `out` (default in). in = the existing A-646/A-898 flow (main.js drives it: 1 Piggy -> the
//                Funding Paper, 2+ -> where / how much first). out = SEND_MONEY: which Piggy (1 -> skipped) -> how much ->
//                outside address -> the existing Face ID line. The live seam MONEY_TAB_CONFIG.sendMoney is null, so the Face ID
//                button stays disabled: nothing is signed or sent from here.
//  · Away money is never selectable (out / Gift): it stays visible, greyed, with the existing line `still out working.`.
//  · Gift pay step: the paying Piggy is chosen once (2+ Piggies), or new money comes in through the Funding rows.
// Copy: only `Gift a Piggy`, `in`, `out` (Owner) and `Move money` (working label, ONE constant) are new. Everything else is an
// existing repo line (MY MONEY, ok, back, unknown, still out working., Confirm with Face ID, the Funding row labels).
// Class contract = receipts/A905_money_tab_jar/design/CLASS_CONTRACT.md. Actions = data-a905-act / data-a905-arg.

import { HOME_UNKNOWN_LABEL, amountChoiceMarkup, amountChoices } from "./home-paper.js";
import { quantityToUnits, unitsToQuantity } from "./piggy-registry.js";
import { ADDRESS_STATUS, buildSendPreview, canSendTo, checkDestination, freeBalance, resolveAmount } from "./send-money.js";
import { FUNDING_ROW_LABEL, FUNDING_ROW_ORDER } from "./funding-paper.js";

// ── copy: the only new strings (F) ──────────────────────────────────────────────────────────────────────────────────
export const MOVE_MONEY_LABEL = "Move money"; // working label (Owner liked the direction; final wording may change) — ONE constant
export const GIFT_A_PIGGY_LABEL = "Gift a Piggy"; // Owner
export const MONEY_SWITCH = Object.freeze({ IN: "in", OUT: "out" }); // Owner
// ── existing repo lines, reused ──
export const MONEY_TAB_TITLE = "MONEY"; // card C: the tab title (Cowork answer 2026-10-08)
export const AWAY_NOTE = "still out working."; // main.js awayNote (A-893b) wording
export const FACE_ID_LINE = "Confirm with Face ID"; // main.js moneyIntentMarkup wording
export const OUT_CONFIRM_NOTE = "Needs your OK — nothing has been sent yet."; // main.js moneyIntentMarkup (A-492 SEND_MONEY) wording
export const OUT_ASSET = "USDC";

/** Every live seam is null (finance gate): the out flow ends at a disabled Face ID button. Shape: async ({ preview }) => { ok, ... }. */
export const MONEY_TAB_CONFIG = Object.freeze({ sendMoney: null });

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ── who can be picked ───────────────────────────────────────────────────────────────────────────────────────────────
/** A Piggy whose money can be moved out / used for a Gift: at home AND has an address. Away / pending / unknown are never selectable. */
export function isSelectablePiggy(piggy) {
  return Boolean(piggy) && piggy.location === "home" && typeof piggy.address === "string" && ADDR.test(piggy.address);
}
export function selectablePiggies(piggies) {
  return (Array.isArray(piggies) ? piggies : []).filter(isSelectablePiggy);
}

// ── the tab ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const SCALE = 36;
/** "20 USDC · 4.1 MON": real holdings summed per symbol, exact (BigInt). Zero / unreadable quantities add nothing. */
export function realAssetsLine(piggies) {
  const sums = new Map();
  for (const p of Array.isArray(piggies) ? piggies : []) {
    for (const a of Array.isArray(p?.assets) ? p.assets : []) {
      if (!a || typeof a.symbol !== "string" || !a.symbol) continue;
      const u = quantityToUnits(String(a.quantity), SCALE);
      if (u === null || u <= 0n) continue;
      sums.set(a.symbol, (sums.get(a.symbol) ?? 0n) + u);
    }
  }
  return [...sums.entries()].map(([symbol, u]) => `${unitsToQuantity(u, SCALE)} ${symbol}`).join(" · ");
}

/** View-model of the tab. total = the registry sum only when every Piggy has a valuation (never invented). */
export function moneyTabView({ piggies = [], totals = null, canAct = true, canMove = canAct } = {}) {
  const list = Array.isArray(piggies) ? piggies : [];
  return {
    total: totals && typeof totals.totalUsd === "string" && totals.totalUsd !== "" ? `$${totals.totalUsd}` : HOME_UNKNOWN_LABEL,
    assets: realAssetsLine(list),
    canMove: canMove === true, // `in` is allowed while every Piggy is Away; `out` then shows them greyed and unpickable
    canGift: canAct === true && selectablePiggies(list).length > 0,
    allAway: list.length > 0 && list.every((p) => p && p.location === "away"),
    piggies: list.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      amount: p.valuation && typeof p.valuation.usd === "string" ? `$${p.valuation.usd}` : HOME_UNKNOWN_LABEL,
      away: p.location === "away",
    })),
  };
}

function piggyRowMarkup(row, { pick = null } = {}) {
  const away = row.away ? ' data-away="1"' : "";
  const inner = `<span class="a905-money__piggyName">${esc(row.name)}</span><span class="a905-money__piggyAmount">${esc(row.amount)}</span>${row.away ? `<span class="a905-money__piggyNote">${esc(AWAY_NOTE)}</span>` : ""}`;
  if (pick === null) return `<div class="a905-money__piggy"${away}>${inner}</div>`;
  const on = pick === true && !row.away;
  if (!on) return `<div class="a905-money__piggy"${away} data-pick="0" aria-disabled="true">${inner}</div>`;
  return `<button class="a905-money__piggy" type="button" data-pick="1" data-a905-act="${esc(row.act)}" data-a905-arg="${esc(row.id)}">${inner}</button>`;
}

/** Piggy list. pick = null (plain, the tab) | { act } (pickers; Away stays visible but data-pick="0"). */
export function piggyListMarkup(rows, { pick = null } = {}) {
  const body = (Array.isArray(rows) ? rows : []).map((r) => piggyRowMarkup(pick ? { ...r, act: pick.act } : r, { pick: pick ? true : null })).join("");
  return `<div class="a905-money__piggies">${body}</div>`;
}

/** CLASS_CONTRACT §2. withTitle=false when the Paper's own heading already says MY MONEY. */
export function moneyTabMarkup(view, { withTitle = true } = {}) {
  // Gift while every Piggy is Away: disabled, reusing the existing line (no new copy) instead of hiding the row.
  const rowBtn = (id, act, label, ok, note = "") =>
    `<button class="a905-money__row" type="button" id="${id}" data-a905-act="${act}"${ok ? "" : ' disabled aria-disabled="true"'}>&gt; ${esc(label)}${note ? ` <span class="a905-money__piggyNote">${esc(note)}</span>` : ""}</button>`;
  return `<section class="a905-money" data-a905-view="tab">`
    + (withTitle ? `<h2 class="a905-money__title">${esc(MONEY_TAB_TITLE)}</h2>` : "")
    + `<p class="a905-money__total">${esc(view.total)}</p>`
    + (view.assets ? `<p class="a905-money__assets">${esc(view.assets)}</p>` : "")
    + `<div class="a905-money__rows">`
    + rowBtn("a905MoveMoney", "move", MOVE_MONEY_LABEL, view.canMove)
    + rowBtn("a905GiftPiggy", "gift", GIFT_A_PIGGY_LABEL, view.canGift, view.allAway && !view.canGift ? AWAY_NOTE : "")
    + `</div>`
    + piggyListMarkup(view.piggies)
    + `</section>`;
}

/** CLASS_CONTRACT §3. Chosen = aria-pressed="true". */
export function moveSwitchMarkup(dir = MONEY_SWITCH.IN) {
  const d = dir === MONEY_SWITCH.OUT ? MONEY_SWITCH.OUT : MONEY_SWITCH.IN;
  const opt = (v) => `<button class="a905-switch__opt" type="button" data-dir="${v}" data-a905-act="dir" data-a905-arg="${v}" aria-pressed="${d === v}">${v}</button>`;
  return `<div class="a905-switch">${opt(MONEY_SWITCH.IN)}${opt(MONEY_SWITCH.OUT)}</div>`;
}

export function backMarkup() {
  return `<button class="homePaper__records" id="a905Back" type="button" data-a905-act="back">&lt; back</button>`;
}

// ── out = SEND_MONEY (live seams null) ──────────────────────────────────────────────────────────────────────────────
export const OUT_STAGE = Object.freeze({ PICK: "pick", AMOUNT: "amount", ADDRESS: "address", CONFIRM: "confirm" });

/** Start the out flow: exactly one selectable Piggy skips the picker; none leaves the picker with nothing pickable. */
export function outStart(piggies) {
  const sel = selectablePiggies(piggies);
  // the picker is skipped only when there is exactly ONE Piggy and it is selectable; with 2+ Piggies (even one at home) the picker shows, so an Away Piggy is seen greyed
  const skip = sel.length === 1 && (Array.isArray(piggies) ? piggies.length : 0) === 1;
  return { stage: skip ? OUT_STAGE.AMOUNT : OUT_STAGE.PICK, piggyId: skip ? sel[0].id : null, amount: "", address: "", skipped: skip, refusal: null };
}

const findPiggy = (piggies, id) => (Array.isArray(piggies) ? piggies : []).find((p) => p && p.id === id) || null;

function outCheck(out, piggies, others = {}) {
  const piggy = findPiggy(piggies, out.piggyId);
  const free = piggy ? freeBalance(piggy, OUT_ASSET) : null;
  const amount = piggy ? resolveAmount(out.amount === "all" ? "all" : String(out.amount ?? "").trim(), free) : { amount: null, reason: "no_piggy" };
  const others2 = (Array.isArray(piggies) ? piggies : []).filter((p) => p && p.id !== out.piggyId && p.address).map((p) => p.address);
  const dest = checkDestination(out.address, { selfAddress: piggy?.address ?? null, otherPiggyAddresses: others.otherPiggyAddresses ?? others2 });
  return { piggy, free, amount, dest };
}

/** Pure reducer for the out flow. Events: pick · amount · address · next · back. Unknown events change nothing. */
export function outReduce(out, event = {}, { piggies = [] } = {}) {
  if (!out || typeof out !== "object") return out;
  switch (event.type) {
    case "pick": {
      if (out.stage !== OUT_STAGE.PICK) return out;
      const p = findPiggy(piggies, event.id);
      if (!isSelectablePiggy(p)) return { ...out, refusal: "piggy_not_selectable" }; // Away / pending / unknown money is never selectable
      return { ...out, stage: OUT_STAGE.AMOUNT, piggyId: p.id, amount: "", address: "", refusal: null };
    }
    case "amount":
      return out.stage === OUT_STAGE.AMOUNT ? { ...out, amount: String(event.value ?? "").slice(0, 40), refusal: null } : out;
    case "address":
      return out.stage === OUT_STAGE.ADDRESS ? { ...out, address: String(event.value ?? "").trim().slice(0, 80), refusal: null } : out;
    case "next": {
      const c = outCheck(out, piggies);
      if (!isSelectablePiggy(c.piggy)) return { ...out, refusal: "piggy_not_selectable" };
      if (out.stage === OUT_STAGE.AMOUNT) return c.amount.amount !== null ? { ...out, stage: OUT_STAGE.ADDRESS, refusal: null } : { ...out, refusal: c.amount.reason };
      if (out.stage === OUT_STAGE.ADDRESS) return canSendTo(c.dest) && c.amount.amount !== null ? { ...out, stage: OUT_STAGE.CONFIRM, refusal: null } : { ...out, refusal: `destination_${c.dest.status}` };
      return out;
    }
    case "back": {
      if (out.stage === OUT_STAGE.CONFIRM) return { ...out, stage: OUT_STAGE.ADDRESS };
      if (out.stage === OUT_STAGE.ADDRESS) return { ...out, stage: OUT_STAGE.AMOUNT };
      if (out.stage === OUT_STAGE.AMOUNT && !out.skipped) return { ...out, stage: OUT_STAGE.PICK, piggyId: null, amount: "", address: "" };
      return { ...out, exit: true }; // the first stage: leave the flow (the caller returns to the tab)
    }
    default:
      return out;
  }
}

/** View of the out flow. `faceIdEnabled` is true only when a sendMoney seam is injected AND the preview is ready. */
export function outView(out, piggies, { config = MONEY_TAB_CONFIG, chain = null } = {}) {
  const c = outCheck(out, piggies);
  const preview = c.piggy ? buildSendPreview({ piggy: c.piggy, symbol: OUT_ASSET, requested: out.amount === "all" ? "all" : String(out.amount ?? "").trim(), destinationCheck: c.dest, chain }) : null;
  const available = c.free && Number(c.free.quantity) > 0 ? c.free.quantity : null;
  return {
    stage: out.stage,
    rows: (Array.isArray(piggies) ? piggies : []).map((p) => ({ id: p.id, name: p.name || p.id, amount: p.valuation && typeof p.valuation.usd === "string" ? `$${p.valuation.usd}` : HOME_UNKNOWN_LABEL, away: p.location === "away" })),
    piggy: c.piggy ? { id: c.piggy.id, name: c.piggy.name || c.piggy.id } : null,
    amount: out.amount,
    choices: available ? amountChoices(available, { presets: [] }) : [], // [A-924 · Owner 06:4x ③] Move out = `all · <balance>` + typed (no fixed $ presets). pre-A-924 baseline: amountChoices(available) (presets $20 / $50)
    address: out.address,
    addressStatus: c.dest.status,
    canNext: out.stage === OUT_STAGE.AMOUNT ? c.amount.amount !== null : out.stage === OUT_STAGE.ADDRESS ? canSendTo(c.dest) && c.amount.amount !== null : false,
    preview,
    faceIdEnabled: typeof config?.sendMoney === "function" && preview?.ready === true && out.stage === OUT_STAGE.CONFIRM,
    refusal: out.refusal ?? null,
  };
}

const okMarkup = (enabled) => `<button class="homePaper__records" id="a905OutOk" type="button" data-a905-act="out-next"${enabled ? "" : " disabled"}>ok</button>`;
// aria-label reuses existing words (no visible text): `total` (A-646 Add money amount label) and `to` (A-898 Gift TO label).
export const OUT_FIELD_LABEL = Object.freeze({ amount: "total", address: "to" });
const fieldMarkup = (name, value, mode) =>
  `<input class="a905-field" type="text" inputmode="${mode}" autocomplete="off" spellcheck="false" data-a905-field="${name}" aria-label="${esc(OUT_FIELD_LABEL[name] ?? "")}" value="${esc(value)}" />`;

export function outMarkup(v) {
  const head = backMarkup();
  if (v.stage === OUT_STAGE.PICK) {
    return `<section class="a905-money" data-a905-view="out" data-a905-stage="pick">${head}${piggyListMarkup(v.rows, { pick: { act: "out-pick" } })}</section>`;
  }
  const who = v.piggy ? `<div class="a905-money__piggies">${piggyRowMarkup({ id: v.piggy.id, name: v.piggy.name, amount: "", away: false })}</div>` : "";
  if (v.stage === OUT_STAGE.AMOUNT) {
    return `<section class="a905-money" data-a905-view="out" data-a905-stage="amount">${head}${who}${amountChoiceMarkup(v.choices, { selected: v.amount, idPrefix: "a905AmountChoice" })}${fieldMarkup("amount", v.amount, "decimal")}${okMarkup(v.canNext)}</section>`;
  }
  if (v.stage === OUT_STAGE.ADDRESS) {
    return `<section class="a905-money" data-a905-view="out" data-a905-stage="address">${head}${who}${fieldMarkup("address", v.address, "text")}${okMarkup(v.canNext)}</section>`;
  }
  const p = v.preview;
  const face = `<button class="homePaper__records" id="a905OutFaceId" type="button" data-a905-act="out-faceid"${v.faceIdEnabled ? "" : ' disabled aria-disabled="true" data-reason="executor_unavailable"'}>&gt; ${esc(FACE_ID_LINE)}</button>`;
  return `<section class="a905-money" data-a905-view="out" data-a905-stage="confirm">${head}${who}`
    + `<div class="homePaper__rows"><div class="homePaper__row"><span class="homePaper__rowLabel">${esc(p?.amount ?? "")} ${esc(p?.asset ?? "")}</span><span class="homePaper__rowValue">${esc(p?.destination ?? "")}</span></div></div>`
    + `<p class="homePaper__note">${esc(OUT_CONFIRM_NOTE)}</p>${face}</section>`;
}

// ── the Move money screen & the Gift pay step ───────────────────────────────────────────────────────────────────────
/** The in/out switch, then the direction's body (markup built by the caller for `in`, by outMarkup for `out`). */
export function moveMoneyMarkup({ dir = MONEY_SWITCH.IN, bodyMarkup = "" } = {}) {
  return `<section class="a905-money" data-a905-view="move" data-a905-dir="${dir === MONEY_SWITCH.OUT ? "out" : "in"}">${bodyMarkup === "" ? backMarkup() : ""}${moveSwitchMarkup(dir)}${bodyMarkup}</section>`;
}

/**
 * Gift pay step (E). `piggies` = all Piggies; `payerId` = the current paying Piggy. 2+ selectable Piggies: pick which Piggy pays
 * (once; Away stays visible, not pickable). New payment = the three Funding rows (existing labels). 1 Piggy: no picker (auto).
 */
export function giftPayStepView({ piggies = [], payerId = null } = {}) {
  const list = Array.isArray(piggies) ? piggies : [];
  const sel = selectablePiggies(list);
  return {
    showPiggies: sel.length > 1,
    payerId: sel.some((p) => p.id === payerId) ? payerId : (sel[0]?.id ?? null),
    rows: list.map((p) => ({ id: p.id, name: p.name || p.id, amount: p.valuation && typeof p.valuation.usd === "string" ? `$${p.valuation.usd}` : HOME_UNKNOWN_LABEL, away: p.location === "away", on: p.id === payerId })),
    funding: FUNDING_ROW_ORDER.map((id) => ({ id, label: FUNDING_ROW_LABEL[id] })),
  };
}

/** The three Funding rows (existing labels) as tappable rows with the given action. Used by the Gift pay step and the `in` plan. */
export function fundingRowsMarkup(act, rows = FUNDING_ROW_ORDER.map((id) => ({ id, label: FUNDING_ROW_LABEL[id] }))) {
  return `<div class="a905-money__rows" data-a905-pay="new">${rows.map((f) => `<button class="a905-money__row" type="button" data-a905-act="${esc(act)}" data-a905-arg="${esc(f.id)}">&gt; ${esc(f.label)}</button>`).join("")}</div>`;
}

export function giftPayStepMarkup(v) {
  const piggies = v.showPiggies
    ? `<div class="a905-money__piggies" data-a905-pay="piggy">${v.rows.map((r) => piggyRowMarkup({ ...r, act: "gift-payer" }, { pick: true }).replace('class="a905-money__piggy"', `class="a905-money__piggy"${r.on ? ' aria-current="true"' : ""}`)).join("")}</div>`
    : "";
  const funding = fundingRowsMarkup("gift-new-payment", v.funding);
  return `<section class="a905-money" data-a905-view="gift-pay">${piggies}${funding}</section>`;
}

// ── state of the surface ────────────────────────────────────────────────────────────────────────────────────────────
/** views: "tab" | "move" | "gift". `scene` ties the surface to the scene it was opened in (a stale surface never leaks). */
export function moneyTabOpen(scene) {
  return { scene: scene ?? null, view: "tab", dir: MONEY_SWITCH.IN, out: null };
}

export function moneyTabReduce(s, event = {}, { piggies = [] } = {}) {
  if (!s || typeof s !== "object") return s;
  switch (event.type) {
    case "move": return { ...s, view: "move", dir: MONEY_SWITCH.IN, out: null };
    case "gift": return { ...s, view: "gift", out: null };
    case "tab":  return { ...s, view: "tab", dir: MONEY_SWITCH.IN, out: null };
    case "dir": {
      if (s.view !== "move") return s;
      if (event.dir === MONEY_SWITCH.OUT) return { ...s, dir: MONEY_SWITCH.OUT, out: s.out ?? outStart(piggies) };
      if (event.dir === MONEY_SWITCH.IN) return { ...s, dir: MONEY_SWITCH.IN, out: null };
      return s;
    }
    case "out": {
      if (s.view !== "move" || s.dir !== MONEY_SWITCH.OUT || !s.out) return s;
      const next = outReduce(s.out, event.event, { piggies });
      return next && next.exit === true ? { ...s, view: "tab", dir: MONEY_SWITCH.IN, out: null } : { ...s, out: next };
    }
    default: return s;
  }
}

// ── `in` with 2+ Piggies: allocation-leg sequencing (security review F1/F2) ──────────────────────────────────────────
// A leg is DONE only when its deposit was confirmed (not merely opened). A cancelled / closed-unconfirmed leg is offered again.
// While a leg's paper is open nothing else opens (a double tap cannot skip a leg). When every leg is done a tap opens nothing.
export function planLegsInit() {
  return { done: [], current: null };
}
export function nextPlanLeg(legs, s = planLegsInit()) {
  if (!s || s.current !== null) return null;
  return (Array.isArray(legs) ? legs : []).find((l) => l && !s.done.includes(l.piggyId)) || null;
}
/** Events: open {id} · confirmed {id} · closed. Anything out of order changes nothing. */
export function planLegsReduce(s = planLegsInit(), event = {}, legs = []) {
  switch (event.type) {
    case "open": {
      const next = nextPlanLeg(legs, s);
      return next && next.piggyId === event.id ? { ...s, current: event.id } : s;
    }
    case "confirmed":
      return s.current !== null && s.current === event.id && !s.done.includes(event.id) ? { ...s, done: [...s.done, event.id] } : s;
    case "closed":
      return s.current === null ? s : { ...s, current: null };
    default:
      return s;
  }
}
