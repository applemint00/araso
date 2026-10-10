// [A-898] Funding Paper — Araso's own paper for "Add money". Always our paper first; exactly three rows:
//   `Pay with card` · `Bank transfer` · `Pay with crypto`
// Card / bank are adapters that are honestly `available:false` + a reason until a provider key exists (the provider
// name is never shown; Apple/Google Pay will live INSIDE card later, never as a first-level option). Crypto = the
// Piggy's own address + copy (no in-repo QR encoder exists -> `qr: null`) + the "Monad network" note; the asset choice
// (USDC / MON) lives only inside the crypto row.
//
// This file is two regions:
//   [A-898 LOGIC]  app writer — pure state machine + view-model. No DOM, no network, no storage, no timers.
//   [A-898 MARKUP] design writer — pure `fundingPaperMarkup(view)`; the app writer ships an unstyled placeholder.
// Contract between the two: <private>
//
// What this file never does: call a provider, read the chain, enable any *_CONFIG, or credit a balance. A balance grows
// ONLY when a confirmed arrival result passes `applyFundingResult` (A-494): `balanceGrew === true` iff stage "confirmed".

import { FUNDING_METHOD, FUNDING_RAIL, FUNDING_STATE, applyFundingResult, startFunding } from "./funding-entry.js";
import { resumeAfterFunding } from "./funding-intent-bridge.js";

// ── [A-898 LOGIC] ─────────────────────────────────────────────────────────────────────────────────────────────────

export const FUNDING_ROW = Object.freeze({ CARD: "card", BANK: "bank", CRYPTO: "crypto" });
export const FUNDING_ROW_ORDER = Object.freeze([FUNDING_ROW.CRYPTO, FUNDING_ROW.CARD, FUNDING_ROW.BANK]); // [A-920 item 5 · A-924] mock order, crypto first (Cowork 06:35: this one line). pre-A-924 baseline: [CARD, BANK, CRYPTO]
// Owner copy (gift_card_20261004/README 2026-10-08 "Add money / Send a Piggy 흐름"). Verbatim.
export const FUNDING_ROW_LABEL = Object.freeze({
  card: "Pay with card",
  bank: "Bank transfer",
  crypto: "Pay with crypto",
});
export const FUNDING_CRYPTO_ASSETS = Object.freeze(["USDC", "MON"]);
export const FUNDING_NETWORK_NOTE = "Monad network"; // Owner copy (INBOX A-898 deliverable A)

// Every live seam is null. Filling one is a separate, Owner-gated build decision (provider key / reader).
//   arrivalReader: async ({ piggy, asset, chainId, since }) => applyFundingResult-shaped result  (null = no reader yet)
export const FUNDING_PAPER_CONFIG = Object.freeze({ arrivalReader: null });

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

/**
 * The adapter list for the paper. Card/bank are `available:false` with a reason (reason text reuses the existing
 * `no_provider_selected` -> "Not ready yet"); crypto is the direct wallet transfer rail and needs no provider.
 * An injected provider adapter for card/bank may flip `available` to true later — only here, nowhere in the UI.
 */
export function fundingPaperAdapters({ card = null, bank = null } = {}) {
  const off = (row) => ({ row, method: FUNDING_METHOD.BANK_CARD_APPLE_PAY, available: false, railId: null, unavailableReason: "no_provider_selected" });
  const on = (row, a) => ({ row, method: FUNDING_METHOD.BANK_CARD_APPLE_PAY, available: true, railId: a.railId, sourceContext: a.sourceContext ?? null, unavailableReason: null });
  return [
    card && card.available === true && typeof card.railId === "string" ? on(FUNDING_ROW.CARD, card) : off(FUNDING_ROW.CARD),
    bank && bank.available === true && typeof bank.railId === "string" ? on(FUNDING_ROW.BANK, bank) : off(FUNDING_ROW.BANK),
    { row: FUNDING_ROW.CRYPTO, method: FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: FUNDING_RAIL.DIRECT_WALLET_TRANSFER, sourceContext: null, unavailableReason: null },
  ];
}

/** Always exactly three rows in the fixed order. A missing adapter is `available:false` — never hidden. */
export function fundingPaperRows(adapters = []) {
  const byRow = new Map();
  for (const a of Array.isArray(adapters) ? adapters : []) if (a && FUNDING_ROW_ORDER.includes(a.row)) byRow.set(a.row, a);
  return FUNDING_ROW_ORDER.map((id) => {
    const a = byRow.get(id);
    const available = a?.available === true;
    return { id, label: FUNDING_ROW_LABEL[id], available, reason: available ? null : (a?.unavailableReason || "no_provider_selected") };
  });
}

function cleanPiggy(piggy) {
  const id = typeof piggy?.id === "string" ? piggy.id.trim() : "";
  const address = typeof piggy?.address === "string" ? piggy.address.trim() : "";
  if (!id) return null;
  if (!ADDR.test(address)) return null;
  return { id, name: typeof piggy.name === "string" ? piggy.name : "", address };
}

/**
 * Open the paper for ONE Piggy (the destination). `prefill` = { amount, asset:"USDC" } from a shortfall; `resumeAfter`
 * = the original intent (funding-intent-bridge) so a confirmed arrival can return to the same draft.
 */
export function openFundingPaper({ piggy, chainId, adapters = fundingPaperAdapters(), prefill = null, resumeAfter = null, draftId = null } = {}) {
  const p = cleanPiggy(piggy);
  if (!p) return { ok: false, reason: "missing_destination_piggy" };
  const chain = typeof chainId === "string" ? chainId.trim() : "";
  if (!chain) return { ok: false, reason: "missing_chain" };
  let pre = null;
  if (prefill !== null && prefill !== undefined) {
    const amount = typeof prefill.amount === "string" ? prefill.amount.trim() : "";
    if (!AMOUNT.test(amount) || Number(amount) <= 0) return { ok: false, reason: "invalid_prefill_amount" };
    pre = { amount, asset: "USDC" }; // a shortfall is always measured in the Gift's own asset
  }
  return {
    ok: true,
    paper: {
      stage: "rows",
      piggy: p,
      chainId: chain,
      adapters: Array.isArray(adapters) ? adapters : [],
      rows: fundingPaperRows(adapters),
      selectedRow: null,
      cryptoAsset: "USDC",
      prefill: pre,
      resumeAfter: resumeAfter ? { ...resumeAfter } : null,
      draftId: typeof draftId === "string" && draftId ? draftId : null,
      intent: null,
      copied: false,
      lastResult: null,
      resumed: null,
      closing: false,
      refusal: null,
    },
  };
}

function startCrypto(paper, asset) {
  const adapter = paper.adapters.find((a) => a && a.row === FUNDING_ROW.CRYPTO && a.available === true);
  const out = startFunding({
    method: FUNDING_METHOD.FROM_ANOTHER_WALLET,
    amount: paper.prefill?.amount ?? null,
    openAmount: true,
    arrival: { chain: paper.chainId, asset },
    expectedChain: paper.chainId,
    // Choosing MON in the crypto row IS the explicit act; the asset is held as-is (no conversion).
    assetChangeAcknowledged: asset !== "USDC",
    target: paper.piggy.address,
    targetPiggyId: paper.piggy.id,
    adapters: adapter ? [adapter] : [],
  });
  return out;
}

/**
 * Pure reducer. Events:
 *   { type:"choose_row", row } · { type:"choose_asset", asset } · { type:"copied" } · { type:"back" }
 *   { type:"arrival", result, available? }  (result = what an arrival reader produced; goes through applyFundingResult)
 */
export function fundingPaperReduce(paper, event = {}) {
  if (!paper || typeof paper !== "object") return paper;
  switch (event.type) {
    case "choose_row": {
      if (paper.stage !== "rows") return paper;
      const row = paper.rows.find((r) => r.id === event.row);
      if (!row) return { ...paper, refusal: "unknown_row" };
      // An unavailable row never starts anything — no provider call, no intent.
      if (!row.available) return { ...paper, refusal: row.reason || "no_provider_selected" };
      if (row.id !== FUNDING_ROW.CRYPTO) {
        // A card/bank adapter is not wired anywhere in this build; even if one were injected as available there is no
        // start path here (that is the provider build's job). Fail closed.
        return { ...paper, refusal: "no_start_path" };
      }
      const started = startCrypto(paper, paper.cryptoAsset);
      if (!started.ok) return { ...paper, refusal: started.reason };
      return { ...paper, stage: "crypto", selectedRow: FUNDING_ROW.CRYPTO, intent: started.intent, copied: false, refusal: null };
    }
    case "choose_asset": {
      if (paper.stage !== "crypto") return paper; // asset choice exists only inside the crypto row
      if (!FUNDING_CRYPTO_ASSETS.includes(event.asset)) return { ...paper, refusal: "unknown_asset" };
      const started = startCrypto(paper, event.asset);
      if (!started.ok) return { ...paper, refusal: started.reason };
      return { ...paper, cryptoAsset: event.asset, intent: started.intent, copied: false, refusal: null };
    }
    case "copied":
      return paper.stage === "crypto" ? { ...paper, copied: true } : paper;
    case "copy_reset":
      return paper.copied === true ? { ...paper, copied: false } : paper;
    case "back": {
      if (paper.stage === "crypto") return { ...paper, stage: "rows", selectedRow: null, intent: null, copied: false, refusal: null };
      return { ...paper, closing: true };
    }
    case "arrival": {
      // a failed / unknown paper can be re-checked ("Try again"); a confirmed one is final
      if (paper.stage !== "crypto" && paper.stage !== "pending" && paper.stage !== "failed" && paper.stage !== "unknown") return paper;
      const applied = applyFundingResult(paper.intent, event.result || {});
      const stage = applied.state === FUNDING_STATE.CONFIRMED ? "confirmed"
        : applied.state === FUNDING_STATE.PENDING ? "pending"
          : applied.state === FUNDING_STATE.UNKNOWN ? "unknown"
            : "failed";
      const resumed = resumeAfterFunding(applied, paper.resumeAfter, { available: event.available });
      return { ...paper, stage, lastResult: applied, resumed, refusal: null };
    }
    default:
      return paper;
  }
}

/** Balance grows only on a CONFIRMED arrival that credits this paper's Piggy (A-494). Nothing else counts. */
export function fundingPaperBalanceGrew(paper) {
  return paper?.stage === "confirmed" && paper?.lastResult?.creditsTarget === true;
}

/** True when a confirmed arrival should return to the Send a Piggy draft this paper was opened from. */
export function fundingPaperReturnsToDraft(paper) {
  return Boolean(paper?.draftId) && paper?.resumed?.resume === true;
}

/** The view-model the markup region receives (INTERFACE.md §2). */
export function fundingPaperView(paper, { canCheck = FUNDING_PAPER_CONFIG.arrivalReader !== null } = {}) {
  const rows = (paper?.rows || []).map((r) => ({ ...r, selected: paper.selectedRow === r.id }));
  const inCrypto = paper?.stage === "crypto" || paper?.stage === "pending" || paper?.stage === "confirmed" || paper?.stage === "failed" || paper?.stage === "unknown";
  const showCrypto = inCrypto && paper.selectedRow === FUNDING_ROW.CRYPTO;
  return {
    stage: paper?.stage || "rows",
    piggyName: paper?.piggy?.name || "",
    prefill: paper?.prefill ? { amountUsd: paper.prefill.amount, asset: paper.prefill.asset } : null,
    rows,
    crypto: showCrypto
      ? {
        asset: paper.cryptoAsset,
        assets: FUNDING_CRYPTO_ASSETS.map((id) => ({ id, selected: id === paper.cryptoAsset })),
        network: FUNDING_NETWORK_NOTE,
        address: paper.piggy.address,
        copyText: paper.piggy.address,
        copied: paper.copied === true,
        qr: null, // no in-repo QR encoder; address + copy only (no new dependency)
      }
      : null,
    canCheck: Boolean(canCheck) && showCrypto && paper.stage !== "confirmed",
    balanceGrew: fundingPaperBalanceGrew(paper),
    returnsToDraft: Boolean(paper?.draftId),
    refusal: paper?.refusal || null,
    // existing Owner grammar: a refused / declined proof moved nothing
    notice: paper?.refusal && paper.refusal !== "no_provider_selected" ? "nothing moved." : null,
  };
}

// ── [A-898 MARKUP] (design writer) ───────────────────────────────────────────
function a898Esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Copy used (all pre-existing): the three Owner row labels · `Not ready yet` (home-paper FUNDING_UNAVAILABLE_NOTE) ·
// `Monad network` (Owner) · `back` / `ok` / `checking…` (canon labels) · failed `nothing moved.` / unknown `can't tell yet.` (main.js money status classes, A-494: unknown = reconcile before retry). Nothing else is printed.
const A898_UNAVAILABLE_NOTE = "Not ready yet";

function a898FundingBack() {
  return `<button class="a898-link" type="button" data-a898-act="funding-back">&lt; back</button>`;
}

function a898FundingRow(row) {
  const label = a898Esc(row.label);
  const id = a898Esc(row.id);
  if (!row.available) {
    // honest unavailable: visible, disabled, with the reason — never hidden, never faked
    return `<button class="a898-row a898-row--off" type="button" disabled data-a898-row="${id}" data-a898-act="funding-row" data-a898-arg="${id}"><span class="a898-row__label">${label}</span><span class="a898-row__note">${A898_UNAVAILABLE_NOTE}</span></button>`;
  }
  return `<button class="a898-row${row.selected ? " is-selected" : ""}" type="button" aria-pressed="${row.selected ? "true" : "false"}" data-a898-row="${id}" data-a898-act="funding-row" data-a898-arg="${id}"><span class="a898-row__label">${label}</span></button>`;
}

// Address copy = an icon, no on-screen text (Owner): two sheets of paper in ink (crayon line, same feTurbulence/displacement + round caps as crayon-bell.svg);
// tapped = a gold check drawn in one stroke (~0.2 s, CSS), back to the sheets after 1.5 s (main.js timer). aria-label "copy" / "copied".
const A898_COPY_ICON = `<svg class="a898-copy__svg" viewBox="0 0 100 100" aria-hidden="true"><defs><filter id="a898crb" x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="13" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/></filter></defs><g class="a898-copy__sheets" filter="url(#a898crb)" fill="none" stroke="#141210" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M36 30 L36 20 C36 16 38 14 42 14 L78 14 C82 14 84 16 84 20 L84 58 C84 62 82 64 78 64 L68 64"/><path d="M22 36 L58 36 C62 36 64 38 64 42 L64 80 C64 84 62 86 58 86 L22 86 C18 86 16 84 16 80 L16 42 C16 38 18 36 22 36 Z"/></g><g class="a898-copy__check" filter="url(#a898crb)" fill="none" stroke="#E0B100" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M18 54 L40 76 L84 26"/></g></svg>`;

function a898CryptoBlock(c) {
  if (!c) return "";
  const assets = (c.assets || []).map((a) => `<button class="a898-chip${a.selected ? " is-selected" : ""}" type="button" aria-pressed="${a.selected ? "true" : "false"}" data-a898-act="funding-asset" data-a898-arg="${a898Esc(a.id)}">${a898Esc(a.id)}</button>`).join("");
  return `<div class="a898-crypto" data-a898-crypto="1">
      <div class="a898-chips" role="group" aria-label="${a898Esc(c.network)}">${assets}</div>
      <div class="a898-detail">${a898Esc(c.network)}</div>
      <div class="a898-addr" data-a898-address="1">${a898Esc(c.address)}</div>
      <button class="a898-copy" type="button" data-a898-act="funding-copy" data-copied="${c.copied ? "1" : "0"}" aria-label="${c.copied ? "copied" : "copy"}">${A898_COPY_ICON}</button>
    </div>`;
}

function a898FundingStage(view) {
  // No invented sentences: stage is carried as a data attribute; only existing words are printed.
  if (view.stage === "pending") return `<div class="a898-state a898-detail" role="status" data-a898-stage="pending">checking…</div>`;
  if (view.stage === "confirmed") return `<div class="a898-state" role="status" data-a898-stage="confirmed" data-balance-grew="${view.balanceGrew ? "1" : "0"}"><button class="a898-link" type="button" data-a898-act="funding-back">ok</button></div>`;
  if (view.stage === "failed" || view.stage === "unknown") return `<div class="a898-state a898-reason" role="status" data-a898-stage="${a898Esc(view.stage)}">${view.stage === "failed" ? "nothing moved." : "can't tell yet."}</div>`;
  return "";
}

export function fundingPaperMarkup(view = {}) {
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const prefill = view.prefill && view.prefill.amountUsd
    ? `<div class="a898-amount" data-a898-prefill="1">$${a898Esc(view.prefill.amountUsd)}</div>` : "";
  const check = view.canCheck && (view.stage === "failed" || view.stage === "unknown")
    ? `<button class="sendCard__btn pkbtn a898-try" type="button" aria-label="Try again" data-a898-act="funding-check"><span class="pkbtn__shell" aria-hidden="true"><img class="pkbtn__cap pkbtn__cap--l" src="/card/btn_l.png" alt="" /><span class="pkbtn__mid"></span><img class="pkbtn__cap pkbtn__cap--r" src="/card/btn_r.png" alt="" /></span><span class="pkbtn__word pkbtn__text" aria-hidden="true">Try again</span></button>` : "";
  return `<div class="homePaper__addMoney a898-paper" data-add-money="a898-funding" data-a898-root="funding" data-a898-stage="${a898Esc(view.stage)}">
    ${a898FundingBack()}
    <div class="a898-head"><span class="a898-who">${a898Esc(view.piggyName)}</span>${prefill}</div>
    <div class="a898-rows">${rows.map(a898FundingRow).join("")}</div>
    ${a898CryptoBlock(view.crypto)}
    ${a898FundingStage(view)}
    ${view.notice ? `<div class="a898-state a898-reason" role="status" data-a898-notice="1">${a898Esc(view.notice)}</div>` : ""}
    ${check}
  </div>`;
}
// ── [/A-898 MARKUP] ──────────────────────────────────────────────────────────
