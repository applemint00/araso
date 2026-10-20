// [A-898] Send a Piggy — the Gift SENDER flow, pure logic + view-model (Owner 2026-10-08, gift_card_20261004/README
// "Add money / Send a Piggy 흐름", "MON 받기 · 스왑 · 우리 수익", "Araso 자산 문법").
//
// Rules this file carries (each one has a test in app/test/a898-gift-send-flow.mjs):
//  · payer = the SELECTED Piggy, and it must be the signer (bindSigner). There is no Piggy picker.
//  · amounts are exactly 20 / 50 / 100 USDC, explicit, no default, no custom (gift-value-spec presets).
//  · short -> "need $X more" + [Add money] (never an automatic popup) -> Funding Paper prefilled (destination = payer,
//    amount = shortfall) -> on a CONFIRMED arrival return to the SAME draft (same draftId, fields untouched).
//  · asset grammar: held assets shown as-is; no auto conversion; no "convert?" screen. `Use MON for the remaining $X`
//    exists ONLY when the Gift is short and the Piggy holds MON.
//  · the Face ID line is the only exact execution line. It is exact only when every number in it is measured/injected;
//    otherwise Face ID stays disabled (fail closed). The quote is locked at Face ID and re-checked at execution.
//  · fees are named apart: `Gift gas cost` (sender, network; from giftGasBudget with INJECTED fee inputs) and
//    `Araso fee` = 0 / not adopted. No code path in this file (or planGiftSend) deducts an Araso fee.
//
// No network, no storage, no timers, no *_CONFIG enabled. Every live seam in GIFT_SEND_CONFIG is null.
//
// Two regions: [A-898 LOGIC] app writer · [A-898 MARKUP] design writer (contract: receipts/A898_funding_gift_send/INTERFACE.md).

import { GIFT_VALUE_PRESET_LABELS, giftGasBudget, GIFT_GAS_POLICY } from "./gift-value-spec.js";
import { planGiftCreate, armGiftCreateStep } from "./gift-create-plan.js";
// [A-915] the ONE send chokepoint, used only by runGiftCreateCalls below (main.js never names it).
import { executeMoneyStep, TRANSPORT_KIND } from "./money-executor.js";
import { checkIntentFunding, fundingRequestForShortfall } from "./funding-intent-bridge.js";
import { bindSigner } from "./piggy-session.js";

// ── [A-898 LOGIC] ─────────────────────────────────────────────────────────────────────────────────────────────────

export const GIFT_SEND_PRESETS = GIFT_VALUE_PRESET_LABELS; // [20, 50, 100] — nothing else, ever
export const GIFT_ASSET = "USDC";
export const GIFT_ASSET_DECIMALS = 6;
export const MON_DECIMALS = 18;
export const GIFT_FRONTS = Object.freeze(["01", "02", "04"]); // 01 standing Piggy · 02 headphones · 04 blanket (Owner 2026-10-08); back = A letter
export const GIFT_FROM_MAX = 40;
const GIFT_NOTHING_MOVED = Object.freeze(["faceid_declined", "signer_mismatch", "no_signer", "no_selection", "payer_changed", "selection_changed", "passkey_declined", "executor_unavailable", "missing_piggy", "missing_piggy_address"]);
export const GIFT_MESSAGE_MAX = 140;
export const GIFT_NOTE_MAX = 140; // the existing note channel (createClaimLink slices at 140); no new field
// note = front \n TO \n one line \n FROM  (front id is non-value display data; 3 separators + 2 front chars = 5 overhead)
export const GIFT_NOTE_OVERHEAD = 5;
const oneLine = (v) => String(v ?? "").replace(/[\r\n\u2028\u2029]+/g, " ");
export function packGiftNote({ front, to = "", message = "", from = "" } = {}) {
  if (!GIFT_FRONTS.includes(front)) return null;
  const note = [front, oneLine(to), oneLine(message), oneLine(from)].join("\n");
  return note.length <= GIFT_NOTE_MAX ? note : null;
}
export function unpackGiftNote(note) {
  if (typeof note !== "string") return null;
  const parts = note.split("\n");
  if (parts.length !== 4 || !GIFT_FRONTS.includes(parts[0])) return null;
  return { front: parts[0], to: parts[1], message: parts[2], from: parts[3] };
}
// clip a field so TO + line + FROM together never exceed what the note channel can carry
function clipField(draft, field, value, hardMax) {
  const others = ["to", "message", "from"].filter((f) => f !== field).reduce((n, f) => n + (draft[f] || "").length, 0);
  const room = Math.max(0, GIFT_NOTE_MAX - GIFT_NOTE_OVERHEAD - others);
  return oneLine(value).slice(0, Math.min(hardMax, room));
} // same cap createClaimLink applies to `note`

// Owner copy, verbatim (README 2026-10-08).
export const GIFT_SEND_COPY = Object.freeze({
  needMore: (usd) => `need $${usd} more`,
  useMon: (usd) => `Use MON for the remaining $${usd}`,
  faceIdMon: (mon, usd, fee) => `About ${mon} MON → $${usd} for this Gift · fee $${fee}`,
  // The USDC-only Face ID line is the same grammar without the asset part. UNKNOWN Owner copy: derived, flagged in the receipt.
  faceIdUsdc: (usd, fee) => `$${usd} for this Gift · fee $${fee}`,
  explain: "What's this?", // Owner 2026-10-08 "ㅇㅇ" (was the Korean placeholder 설명이 필요해?)
  giftGasCost: "Gift gas cost",
  arasoFee: "Araso fee",
});

/** Araso fee: 0 / not adopted (Owner). A constant — there is no setter and no code path that charges it. */
export const ARASO_FEE = Object.freeze({ adopted: false, bps: 0, usd: "0" });

// Every live seam is null (Owner-gated). Shapes:
//   gas:      { gasUnits:{commitClaim,claim,fundingTransfer}, feeInputs:{…,source}|null, safety:{bufferBps} }  -> giftGasBudget
//   market:   async ({ targetUsd|null }) => { monUsd, quote?:{ monIn, usdOut }, receivedAtMs, expiresAtMs }       (live quote OFF)
//   executor: async ({ plan, lock, payer }) => { ok:true, link } | { ok:false, reason }                         (escrow not live)
//   quoteRefreshMs / quoteToleranceBps: Owner/OPS numbers — UNKNOWN, so null (no default is invented).
export const GIFT_SEND_CONFIG = Object.freeze({
  gas: null,
  market: null,
  executor: null,
  quoteRefreshMs: null,
  quoteToleranceBps: null,
});

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const DEC = /^\d+(\.\d+)?$/;

function toUnits(text, decimals) {
  if (typeof text !== "string" || !DEC.test(text)) return null;
  const [w, f = ""] = text.split(".");
  if (f.length > decimals) return null;
  return BigInt(w + f.padEnd(decimals, "0"));
}
function fromUnits(units, decimals) {
  const s = units.toString().padStart(decimals + 1, "0");
  const w = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}
// micro-USD (6 dp) -> "12" or "12.40", rounded UP to cents (never understate what is owed).
function usdFromMicro(micro) {
  const cents = (micro + 9999n) / 10000n;
  const w = cents / 100n;
  const c = cents % 100n;
  return c === 0n ? String(w) : `${w}.${String(c).padStart(2, "0")}`;
}
function ceilDiv(a, b) { return (a + b - 1n) / b; }

/** Which Piggy pays: only the selected one, and only if it is the same Piggy as the one asked about. No picker. */
export function giftSendPayerCheck({ piggy, selected } = {}) {
  if (!piggy || typeof piggy.id !== "string" || !piggy.id) return { ok: false, reason: "missing_payer" };
  if (!ADDR.test(piggy.address || "")) return { ok: false, reason: "payer_address_missing" };
  if (!selected || selected.id !== piggy.id) return { ok: false, reason: "payer_not_selected" };
  if (typeof selected.address === "string" && selected.address.toLowerCase() !== piggy.address.toLowerCase()) return { ok: false, reason: "payer_selection_address_mismatch" };
  return { ok: true, reason: null };
}

let draftCounter = 0;
function newDraftId(nowMs) {
  draftCounter += 1;
  return `gs-${Number.isFinite(nowMs) ? nowMs : 0}-${draftCounter}`;
}

/** Start a draft from the selected Piggy's paper. */
export function openGiftSend({ piggy, selected, chainScope, nowMs = Date.now() } = {}) {
  const gate = giftSendPayerCheck({ piggy, selected });
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const scope = typeof chainScope === "string" ? chainScope.trim() : "";
  if (!scope) return { ok: false, reason: "missing_chain_scope" };
  return {
    ok: true,
    draft: {
      draftId: newDraftId(nowMs),
      payer: { id: piggy.id, name: typeof piggy.name === "string" ? piggy.name : "", address: piggy.address },
      chainScope: scope,
      preset: null,
      to: "",
      message: "",
      from: "",
      front: null, // the sender's chosen front id (no default). Link channel for it = UNKNOWN (createClaimLink carries only `note`)
      flipped: false,
      payWith: "usdc",
      stage: "compose",
      refusal: null,
      lock: null,
      link: null,
      explainOpen: false,
    },
  };
}

/**
 * Pure reducer. Events: set_preset · set_to · set_message · pay_with · funding_opened · funding_returned ·
 * faceid_start · faceid_result · executed · requote · payer_changed · close.
 * Fields (to / message / preset) are NEVER cleared by funding_opened / funding_returned — that is the draft guarantee.
 */
export function giftSendReduce(draft, event = {}) {
  if (!draft || typeof draft !== "object") return draft;
  switch (event.type) {
    case "set_preset": {
      if (draft.stage !== "compose") return draft;
      const hit = GIFT_SEND_PRESETS.find((p) => p === Number(event.preset) && String(p) === String(event.preset));
      if (hit === undefined) return { ...draft, refusal: "unsupported_amount" }; // no custom amount
      return { ...draft, preset: hit, payWith: "usdc", refusal: null, lock: null };
    }
    case "set_to":
      return draft.stage === "compose" ? { ...draft, to: clipField(draft, "to", event.value, 80) } : draft;
    case "pick_front": {
      // step 1 (lift): the tapped card lifts, the others move aside. NOT flipped yet.
      if (draft.stage !== "compose") return draft;
      if (!GIFT_FRONTS.includes(String(event.front))) return { ...draft, refusal: "unknown_front" };
      return { ...draft, front: String(event.front), flipped: false, refusal: null };
    }
    case "flip_front":
      // step 2 (flip): only a lifted card can flip to the letter
      return draft.stage === "compose" && draft.front !== null && draft.flipped !== true ? { ...draft, flipped: true } : draft;
    case "flip_back":
      return draft.stage === "compose" && draft.front !== null && draft.flipped === true ? { ...draft, flipped: false } : draft;
    case "unpick":
      // back to the fan: pick again (canon). The letter text (to / message / from) is kept in the draft.
      return draft.stage === "compose" && draft.front !== null ? { ...draft, front: null, flipped: false } : draft;
    case "step_back":
      // one back step: flipped -> the front of the same card; lifted -> back to the fan (pick again)
      if (draft.stage !== "compose" || draft.front === null) return draft;
      return draft.flipped === true ? { ...draft, flipped: false } : { ...draft, front: null, flipped: false };
    case "tap_front": {
      // one tap grammar for the card hook: another card -> switch (lift); the lifted card -> flip / flip back
      if (draft.stage !== "compose") return draft;
      const id = String(event.front);
      if (!GIFT_FRONTS.includes(id)) return { ...draft, refusal: "unknown_front" };
      if (draft.front !== id) return { ...draft, front: id, flipped: false, refusal: null };
      return { ...draft, flipped: draft.flipped !== true };
    }
    case "set_from":
      return draft.stage === "compose" ? { ...draft, from: clipField(draft, "from", event.value, GIFT_FROM_MAX) } : draft;
    case "set_message":
      return draft.stage === "compose" ? { ...draft, message: clipField(draft, "message", event.value, GIFT_MESSAGE_MAX) } : draft;
    case "pay_with": {
      if (draft.stage !== "compose") return draft;
      if (event.asset === "usdc") return { ...draft, payWith: "usdc", lock: null, refusal: null };
      if (event.asset === "mon") {
        // allowed only when the evaluation offered it; the caller passes that fact in (no hidden state here)
        if (event.offered !== true) return { ...draft, refusal: "mon_not_offered" };
        return { ...draft, payWith: "mon", lock: null, refusal: null };
      }
      return draft;
    }
    case "funding_opened":
      return draft.stage === "compose" ? { ...draft, stage: "funding", refusal: null } : draft;
    case "funding_returned":
      return draft.stage === "funding" ? { ...draft, stage: "compose", payWith: "usdc", lock: null } : draft;
    case "faceid_start":
      return draft.stage === "compose" && event.lock ? { ...draft, stage: "faceid", lock: event.lock, refusal: null } : draft;
    case "faceid_result": {
      if (draft.stage !== "faceid") return draft;
      if (event.ok !== true) return { ...draft, stage: "compose", lock: null, refusal: "faceid_declined" };
      // payer must be the signer: the derived signer address must equal the draft's payer Piggy address
      const bound = bindSigner(draft.payer, event.signerAddress);
      if (!bound.ok) return { ...draft, stage: "compose", lock: null, refusal: bound.reason };
      return { ...draft, stage: "executing", refusal: null };
    }
    case "executed": {
      if (draft.stage !== "executing") return draft;
      if (event.result?.ok === true && typeof event.result.link === "string") return { ...draft, stage: "done", link: event.result.link };
      if (event.result?.reason === "requote_needed") return { ...draft, stage: "requote", lock: null, refusal: "requote_needed" };
      return { ...draft, stage: "unavailable", refusal: event.result?.reason || "executor_unavailable" };
    }
    case "toggle_explain":
      return draft.stage === "compose" ? { ...draft, explainOpen: draft.explainOpen !== true } : draft;
    case "requote":
      return draft.stage === "requote" || draft.stage === "unavailable" ? { ...draft, stage: "compose", lock: null } : draft;
    case "payer_changed":
      return { ...draft, stage: "closed", refusal: "payer_changed", lock: null };
    case "close":
      return { ...draft, stage: "closed" };
    default:
      return draft;
  }
}

function usedGas(gas) {
  // gas = { budget } already computed, or the raw config shape to compute here; either way giftGasBudget is the only source.
  if (!gas) return null;
  if (gas.budget) return gas.budget;
  const planned = giftGasBudget(gas);
  return planned.ok ? planned.budget : null;
}

/**
 * Evaluate the draft against what the Piggy holds and what the injected market says. Pure.
 * holdings = { usdc:"decimal"|null, mon:"decimal"|null }  (the Piggy's own AT-HOME quantities; null = unknown/none)
 * market   = { monUsd:"decimal"|null, quote:{monIn,usdOut}|null, receivedAtMs, expiresAtMs } | null
 * gas      = GIFT_SEND_CONFIG.gas shape | { budget } | null
 */
function evaluateCore(draft, { holdings = {}, market = null, gas = null, nowMs = Date.now() } = {}) {
  const usdcHeld = toUnits(holdings.usdc ?? "0", GIFT_ASSET_DECIMALS);
  const monHeld = toUnits(holdings.mon ?? "0", MON_DECIMALS);
  const out = {
    preset: draft?.preset ?? null,
    quoteAtMs: Number.isFinite(market?.receivedAtMs) ? market.receivedAtMs : null,
    state: "no_amount",
    short: false,
    shortfall: null,
    shortfallUsd: null,
    balanceUsd: usdcHeld === null ? null : usdFromMicro(usdcHeld),
    monOption: { offered: false, remainingUsd: null },
    payWith: draft?.payWith === "mon" ? "mon" : "usdc",
    monHeld: null,
    faceIdLine: null,
    fees: { giftGasCost: { usd: null, known: false }, total: { usd: null }, arasoFee: { ...ARASO_FEE } },
    canFaceId: false,
    blockedReason: null,
  };
  if (usdcHeld === null) { out.blockedReason = "balance_unreadable"; return out; }

  // ── what MON the Piggy holds, as-is: $ big (only if a price is injected), token small ──
  const monUsd = typeof market?.monUsd === "string" && DEC.test(market.monUsd) ? toUnits(market.monUsd, 6) : null;
  const marketLive = market && Number.isFinite(market.expiresAtMs) && market.expiresAtMs > nowMs;
  if (monHeld !== null && monHeld > 0n) {
    const usd = monUsd !== null && marketLive ? usdFromMicro((monHeld * monUsd) / 10n ** BigInt(MON_DECIMALS)) : null;
    out.monHeld = { usd, tokenQuantity: fromUnits(monHeld, MON_DECIMALS) };
  }

  // ── Gift gas cost (sender, network): giftGasBudget with injected fees, converted at the injected MON price ──
  const budget = usedGas(gas);
  let feeMicro = null;
  if (budget && budget.status === "ESTIMATE" && typeof budget.costWei === "bigint" && monUsd !== null && marketLive) {
    feeMicro = ceilDiv(budget.costWei * monUsd, 10n ** BigInt(MON_DECIMALS)); // micro-USD, rounded up
    out.fees.giftGasCost = { usd: usdFromMicro(feeMicro), known: true };
  }
  // Q5 (Cowork): the `fee` in the Face ID line is the user's TOTAL cost = Gift gas cost + route cost, as ONE number.
  // route cost = market.quote.routeFeeUsd (decimal string) on the MON path; the USDC-only path has no route (0).
  const gasMicro = feeMicro;
  const routeMicro = (payWithMon) => (payWithMon ? (typeof market?.quote?.routeFeeUsd === "string" ? toUnits(market.quote.routeFeeUsd, 6) : null) : 0n);
  const totalFee = (payWithMon) => {
    const r = routeMicro(payWithMon);
    return gasMicro === null || r === null ? null : usdFromMicro(gasMicro + r);
  };
  const feeUsd = totalFee(false);
  out.fees.total = { usd: feeUsd };

  if (draft?.preset === null || draft?.preset === undefined) return out;
  const want = BigInt(draft.preset) * 10n ** BigInt(GIFT_ASSET_DECIMALS);
  const check = checkIntentFunding({ piggyId: draft.payer.id, action: `gift_send:${draft.draftId}`, amount: String(draft.preset), asset: GIFT_ASSET, decimals: GIFT_ASSET_DECIMALS, available: fromUnits(usdcHeld, GIFT_ASSET_DECIMALS) });
  if (check.error) { out.blockedReason = check.error; return out; }

  if (check.sufficient) {
    out.state = "enough";
    out.payWith = "usdc"; // USDC covers it: no asset-related display at all
    out.faceIdLine = feeUsd === null
      ? { exact: false, text: null, assetChange: false, parts: { monIn: null, usd: String(draft.preset), feeUsd: null } }
      : { exact: true, text: GIFT_SEND_COPY.faceIdUsdc(String(draft.preset), feeUsd), assetChange: false, parts: { monIn: null, usd: String(draft.preset), feeUsd } };
    out.canFaceId = out.faceIdLine.exact && draft.stage === "compose";
    if (!out.faceIdLine.exact) out.blockedReason = "fee_unknown";
    return out;
  }

  // ── short ──
  out.short = true;
  out.shortfall = check.shortfall; // exact decimal string (becomes the Funding Paper prefill)
  out.shortfallUsd = usdFromMicro(toUnits(check.shortfall, GIFT_ASSET_DECIMALS));
  const quote = marketLive && market.quote && typeof market.quote.monIn === "string" && typeof market.quote.usdOut === "string" ? market.quote : null;
  const monIn = quote ? toUnits(quote.monIn, MON_DECIMALS) : null;
  const usdOut = quote ? toUnits(quote.usdOut, GIFT_ASSET_DECIMALS) : null;
  const shortMicro = toUnits(check.shortfall, GIFT_ASSET_DECIMALS);
  const holdsMon = monHeld !== null && monHeld > 0n;
  // MON option: only when short AND the Piggy holds MON; if a quote is in hand it must be coverable by what is held.
  const covers = monIn === null ? true : monIn <= monHeld;
  out.monOption = holdsMon && covers ? { offered: true, remainingUsd: out.shortfallUsd } : { offered: false, remainingUsd: null };
  out.state = "short";
  if (out.payWith === "mon" && !out.monOption.offered) out.payWith = "usdc"; // a stale choice never survives
  if (out.payWith === "usdc") { out.blockedReason = "short"; return out; }

  // ── paying the remainder with MON: the Face ID line ──
  out.state = "short_mon";
  let reason = null;
  const feeMon = totalFee(true);
  out.fees.total = { usd: feeMon };
  if (!quote || monIn === null || usdOut === null) reason = "quote_unavailable";
  else if (usdOut < shortMicro) reason = "quote_below_remaining";
  else if (feeMon === null) reason = "fee_unknown";
  if (reason) {
    out.faceIdLine = { exact: false, text: null, assetChange: true, parts: { monIn: null, usd: out.shortfallUsd, feeUsd: feeMon } };
    out.blockedReason = reason;
    return out;
  }
  // "About N MON": N rounded UP to 4 dp so the shown amount never understates what is spent (display cap = open question)
  const step = 10n ** BigInt(MON_DECIMALS - 4);
  const monShown = fromUnits(ceilDiv(monIn, step) * step, MON_DECIMALS);
  out.faceIdLine = {
    exact: true,
    text: GIFT_SEND_COPY.faceIdMon(monShown, out.shortfallUsd, feeMon),
    assetChange: true,
    parts: { monIn: monShown, usd: out.shortfallUsd, feeUsd: feeMon },
  };
  out.canFaceId = draft.stage === "compose";
  return out;
}

export function giftSendEvaluate(draft, opts = {}) {
  const out = evaluateCore(draft, opts);
  // the sender must pick one of the three fronts (no default), like the amount
  if (out.canFaceId && !GIFT_FRONTS.includes(draft?.front)) return { ...out, canFaceId: false, blockedReason: "front_required" };
  return out;
}


// ── "설명이 필요해?" body (Owner 2026-10-08 "[확정 · 설명이 필요해? 본문 = 문장 조각 조립]"): ONE fragment table + one assembler. ──
// Changing wording = replacing a fragment here and nowhere else. Slots are filled only from real quote values; a fragment whose slot is
// missing is OMITTED (never invented). The body is shown only when expanded (collapsed by default).
export const EXPLAIN_FRAGMENTS = Object.freeze({
  HAVE: (s) => (s.have ? `You have ${s.have} MON.` : null),
  USES: () => "This one uses MON.",
  NEED: () => "Gifts are sent in USDC, a digital dollar (1 USDC ≈ $1).",
  CHANGE: (s) => (s.mon && s.usd ? `We'll turn about ${s.mon} MON into $${s.usd} for this Gift.` : null),
  MOVES: () => "MON price can move.",
  MAY_DIFFER: () => "Prices move, so the final amount can be a little different.",
  FEE: (s) => (s.fee ? `Sending costs about $${s.fee}. You pay this.` : null),
  MOVE_FEE: (s) => (s.fee ? `Moving it here costs about $${s.fee}.` : null),
  FROM: (s) => (s.place ? `This money is coming in from somewhere else (${s.place}).` : null),
  WAIT: () => "We'll show it here once it arrives.",
  COSTLY: () => "Sending costs more than usual right now.",
  SLOW: () => "It's taking longer than usual right now.",
});
// situation -> fragment order (Owner). 6 = USDC direct: nothing changes, so NO explanation at all.
export const EXPLAIN_SITUATION = Object.freeze({
  1: ["USES", "NEED", "CHANGE", "MOVES", "MAY_DIFFER"], // Gift paid with MON
  2: ["HAVE", "MOVES"], // MON simply arrived / is held
  3: ["MOVES", "WAIT"], // depositing MON through Pay with crypto
  4: ["FROM", "MOVE_FEE", "CHANGE", "WAIT"], // bringing money in from elsewhere (Relay)
  5: ["COSTLY_OR_SLOW", "FEE"], // costlier / slower than usual, then the sender chooses
  6: [],
});
export function assembleExplanation(situation, slots = {}) {
  const order = EXPLAIN_SITUATION[situation];
  if (!order) return [];
  const out = [];
  for (const key of order) {
    const k = key === "COSTLY_OR_SLOW" ? (slots.slow === true ? "SLOW" : slots.costly === true ? "COSTLY" : null) : key;
    if (!k) continue;
    const line = EXPLAIN_FRAGMENTS[k](slots);
    if (typeof line === "string" && line) out.push(line);
  }
  return out;
}

/** Plain, secret-free snapshot of the editable draft (no lock, no stage, no link). For chain-scoped local storage. */
export function giftDraftSnapshot(draft) {
  if (!draft || typeof draft !== "object" || !draft.payer) return null;
  return { v: 1, draftId: draft.draftId, payerId: draft.payer.id, payerAddress: draft.payer.address, chainScope: draft.chainScope, preset: draft.preset, front: draft.front, to: draft.to, message: draft.message, from: draft.from };
}

/** Restore a snapshot into a fresh compose draft, only for the SAME payer and chain scope. Anything off -> null. */
export function giftDraftRestore(snap, { piggy, selected, chainScope } = {}) {
  if (!snap || typeof snap !== "object" || snap.v !== 1) return null;
  const opened = openGiftSend({ piggy, selected, chainScope });
  if (!opened.ok) return null;
  const d = opened.draft;
  if (snap.payerId !== d.payer.id || String(snap.payerAddress || "").toLowerCase() !== d.payer.address.toLowerCase() || snap.chainScope !== d.chainScope) return null;
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const base = {
    ...d,
    draftId: typeof snap.draftId === "string" && snap.draftId ? snap.draftId : d.draftId,
    preset: GIFT_SEND_PRESETS.includes(snap.preset) ? snap.preset : null,
    front: GIFT_FRONTS.includes(snap.front) ? snap.front : null,
    flipped: false,
    to: "", message: "", from: "",
  };
  // the combined note budget applies on restore too (a hand-edited snapshot can't pass Face ID and then fail to pack)
  let out = base;
  out = { ...out, to: clipField(out, "to", str(snap.to, 80), 80) };
  out = { ...out, message: clipField(out, "message", str(snap.message, GIFT_MESSAGE_MAX), GIFT_MESSAGE_MAX) };
  out = { ...out, from: clipField(out, "from", str(snap.from, GIFT_FROM_MAX), GIFT_FROM_MAX) };
  return out;
}

/** Args for openFundingPaper from a short draft: destination = the payer, amount = the shortfall, original intent kept. */
export function giftSendFundingArgs(draft, evaluation, { chainId } = {}) {
  if (!evaluation?.short) return { ok: false, reason: "not_short" };
  // Re-derive from the evaluation itself so the shortfall can't drift: want - shortfall = what was held.
  const want = BigInt(draft.preset) * 10n ** 6n;
  const short = toUnits(evaluation.shortfall, GIFT_ASSET_DECIMALS);
  if (short === null || short <= 0n || short > want) return { ok: false, reason: "invalid_shortfall" };
  const c = checkIntentFunding({
    piggyId: draft.payer.id, action: `gift_send:${draft.draftId}`, amount: String(draft.preset), asset: GIFT_ASSET,
    decimals: GIFT_ASSET_DECIMALS, available: fromUnits(want - short, GIFT_ASSET_DECIMALS),
  });
  const request = fundingRequestForShortfall(c, { target: draft.payer.address, chain: chainId });
  if (!request) return { ok: false, reason: "shortfall_request_failed" };
  return {
    ok: true,
    openArgs: {
      piggy: draft.payer,
      chainId,
      prefill: { amount: request.amount, asset: GIFT_ASSET },
      resumeAfter: request.resumeAfter,
      draftId: draft.draftId,
    },
  };
}

/** After a Funding Paper resolves: does its resume point back at THIS draft? (same draftId, same payer, confirmed) */
export function giftSendResumeCheck(draft, paper) {
  if (!draft || !paper) return { ok: false, reason: "no_draft" };
  if (paper.draftId !== draft.draftId) return { ok: false, reason: "different_draft" };
  const r = paper.resumed;
  if (!r || r.resume !== true) return { ok: false, reason: r?.reason || "not_resumed" };
  if (r.intent?.action !== `gift_send:${draft.draftId}` || r.intent?.piggyId !== draft.payer.id) return { ok: false, reason: "different_draft" };
  return { ok: true, funded: r.funded === true, stillShort: r.stillShort ?? null };
}

/** Lock the shown line at Face ID. Returns null unless the line is exact. */
export function lockQuote(evaluation, { nowMs = Date.now() } = {}) {
  const line = evaluation?.faceIdLine;
  if (!line || line.exact !== true || evaluation.canFaceId !== true) return null;
  return Object.freeze({
    payWith: evaluation.payWith,
    preset: evaluation.preset,
    usd: line.parts.usd,
    monIn: line.parts.monIn,
    feeUsd: line.parts.feeUsd,
    text: line.text,
    quoteAtMs: evaluation.quoteAtMs ?? null,
    lockedAtMs: nowMs,
  });
}

/**
 * At execution, compare a fresh market read to the locked line (README: "Face ID 누르는 순간 보이던 견적으로 고정,
 * 실행 때 허용 범위 밖이면 다시 보여주고 묻기"). Nothing worse than the lock passes without an injected tolerance;
 * with no tolerance (UNKNOWN) anything worse -> requote_needed. Never silently re-prices.
 */
export function reconcileQuote(lock, freshEvaluation, { toleranceBps = GIFT_SEND_CONFIG.quoteToleranceBps } = {}) {
  if (!lock) return { ok: false, reason: "no_lock" };
  const line = freshEvaluation?.faceIdLine;
  if (!line || line.exact !== true) return { ok: false, reason: "requote_needed" };
  // Freshness (finance review S-6): the quoteRefreshMs interval is UNKNOWN (null), so freshness cannot be assumed. Fail closed:
  // the execution-time read must be strictly newer than the quote the user saw. A cached object is not a new quote.
  // The tolerance upper bound is UNKNOWN (Owner/OPS); it is NOT clamped here.
  if (!Number.isFinite(lock.quoteAtMs) || !Number.isFinite(freshEvaluation.quoteAtMs) || freshEvaluation.quoteAtMs <= lock.quoteAtMs) return { ok: false, reason: "requote_needed" };
  if (line.parts.usd !== lock.usd || freshEvaluation.payWith !== lock.payWith) return { ok: false, reason: "requote_needed" };
  const tol = Number.isInteger(toleranceBps) && toleranceBps >= 0 ? BigInt(toleranceBps) : 0n;
  const allow = (v) => (v * (10000n + tol)) / 10000n;
  if (lock.payWith === "mon") {
    const a = toUnits(lock.monIn, MON_DECIMALS);
    const b = toUnits(line.parts.monIn, MON_DECIMALS);
    if (a === null || b === null || b > allow(a)) return { ok: false, reason: "requote_needed" };
  }
  const fa = toUnits(lock.feeUsd, 6);
  const fb = toUnits(line.parts.feeUsd, 6);
  if (fa === null || fb === null || fb > allow(fa)) return { ok: false, reason: "requote_needed" };
  return { ok: true, reason: null };
}

/** Should the shown quote be re-read now? Interval is an injected number; null/invalid = never auto-refresh. */
export function quoteRefreshDue({ lastAtMs, nowMs, intervalMs = GIFT_SEND_CONFIG.quoteRefreshMs } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  if (!Number.isFinite(lastAtMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - lastAtMs >= intervalMs;
}

/**
 * The plan for the link: planGiftCreate with the preset EXACTLY and the injected gas. The escrow amount is the preset
 * and nothing else — no Araso fee is deducted or added (ARASO_FEE.bps = 0, adopted:false).
 */
export async function planGiftSend({ draft, senderAddress, expiry, gas = null, origin = null, createdAt, sponsor = null } = {}) {
  if (!draft || draft.preset === null) return { ok: false, reason: "explicit_selection_required" };
  if (!ADDR.test(senderAddress || "") || senderAddress.toLowerCase() !== draft.payer.address.toLowerCase()) return { ok: false, reason: "sender_is_not_payer" };
  const packed = packGiftNote(draft);
  if (packed === null) return { ok: false, reason: draft.front ? "note_too_long" : "front_required" };
  const planned = await planGiftCreate({
    chainScope: draft.chainScope, presetLabel: draft.preset, senderAddress, expiry, note: packed, origin,
    ...(createdAt ? { createdAt } : {}),
    ...(gas && !gas.budget ? { gas } : {}),
    // [A-913 A] pinned sponsor: the sender's gas budget is deposited to it in the same create step (UNKNOWN budget => refused inside the plan)
    ...(sponsor ? { sponsor } : {}),
  });
  if (!planned.ok) return planned;
  return { ...planned, arasoFee: { ...ARASO_FEE }, gasPayer: GIFT_GAS_POLICY.payer };
}

/** The view-model for the markup region (INTERFACE.md §3). */
export function giftSendView(draft, evaluation) {
  const ev = evaluation || {};
  return {
    stage: draft?.stage || "compose",
    payerName: draft?.payer?.name || "",
    presets: GIFT_SEND_PRESETS.map((p) => ({ id: String(p), label: `$${p}`, selected: draft?.preset === p })),
    fields: { to: draft?.to || "", message: draft?.message || "", from: draft?.from || "" },
    fronts: GIFT_FRONTS.map((id) => ({ id, selected: draft?.front === id })),
    picked: draft?.front ?? null,
    flipped: draft?.flipped === true,
    balanceUsd: ev.balanceUsd ?? null,
    short: ev.short === true,
    shortfallUsd: ev.shortfallUsd ?? null,
    monOption: ev.monOption || { offered: false, remainingUsd: null },
    payWith: ev.payWith || "usdc",
    monHeld: ev.monHeld || null,
    faceIdLine: ev.faceIdLine || null,
    fees: ev.fees || { giftGasCost: { usd: null, known: false }, arasoFee: { ...ARASO_FEE } },
    canFaceId: ev.canFaceId === true && draft?.stage === "compose",
    blockedReason: ev.blockedReason ?? null,
    refusal: draft?.refusal ?? null,
    // existing Owner grammar: where nothing left, `nothing moved.` (money-side refusals only)
    notice: GIFT_NOTHING_MOVED.includes(draft?.refusal) ? "nothing moved." : null,
    explainOpen: draft?.explainOpen === true,
    // the expanded body: only for situation 1 (Gift paid with MON, exact line) and only when expanded
    explain: { open: draft?.explainOpen === true, lines: draft?.explainOpen === true && ev.payWith === "mon" && ev.faceIdLine?.exact === true
      ? assembleExplanation(1, { mon: ev.faceIdLine.parts.monIn, usd: ev.faceIdLine.parts.usd }) : [] },
    link: draft?.stage === "done" ? draft.link : null,
  };
}

// ── [A-898 MARKUP] (design writer) ───────────────────────────────────────────
function a898Esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Copy used (Owner README 2026-10-08, verbatim): `need $12 more` · `Add money` · `Use MON for the remaining $12` ·
// the Face ID line (from the view) · red `설명이 필요해?` · `Gift gas cost` · `Araso fee`; canon labels `back` / `ok` /
// `unknown` / `TO`. Nothing else is printed.
// Same button as the Invite board's `inviteFace()` (main.js): yellow face icon + the `Face ID` label (Delicious Handrawn).
// Only the wrapper class differs (the board's `.invite__face` is absolutely positioned inside the Invite board).
const A898_FACE_ICON = `<svg class="invite__faceIcon" viewBox="0 0 22 22" fill="none" stroke="#E0B100" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 7 V5 Q2 2 5 2 H7 M15 2 H17 Q20 2 20 5 V7 M20 15 V17 Q20 20 17 20 H15 M7 20 H5 Q2 20 2 17 V15"></path><circle cx="7.5" cy="9" r="0.9" fill="#E0B100" stroke="none"></circle><circle cx="14.5" cy="9" r="0.9" fill="#E0B100" stroke="none"></circle><path d="M8 14.5 Q11 16.5 14 14.5"></path></svg>`;

function a898Usd(v) { if (v === null || v === undefined || v === "") return ""; const t = String(v); return a898Esc(t.startsWith("$") ? t : `$${t}`); } // unknown value -> nothing (never a bare "$")

function a898Presets(presets) {
  const items = (presets || []).map((p) => `<button class="a898-preset${p.selected ? " is-selected" : ""}" type="button" aria-pressed="${p.selected ? "true" : "false"}" data-a898-act="gift-amount" data-a898-arg="${a898Esc(p.id)}">${a898Esc(p.label)}</button>`).join("");
  return `<div class="a898-presets" role="group" aria-label="$">${items}</div>`;
}

function a898Balance(view) {
  // $ big, token small. A held MON shows $ big + quantity small; USDC is one `$` line.
  const mon = view.monHeld
    ? `<div class="a898-held"><span class="a898-held__usd">${a898Usd(view.monHeld.usd)}</span><span class="a898-held__token">${a898Esc(view.monHeld.tokenQuantity)} MON</span></div>` : "";
  return `<div class="a898-balance"><div class="a898-amount" data-a898-balance="1">${a898Usd(view.balanceUsd)}</div>${mon}</div>`;
}

function a898Short(view) {
  if (!view.short) return "";
  const usd = view.shortfallUsd == null ? "" : a898Usd(view.shortfallUsd);
  const mon = view.monOption && view.monOption.offered
    ? `<button class="a898-link" type="button" data-a898-act="gift-use-mon">Use MON for the remaining ${a898Usd(view.monOption.remainingUsd)}</button>` : "";
  return `<div class="a898-short" data-a898-short="1">
      <span class="a898-short__line a898-reason">need ${usd} more</span>
      <button class="a898-link" type="button" data-a898-act="gift-add-money">Add money</button>
      ${mon}
    </div>`;
}

function a898FaceIdLine(view) {
  const l = view.faceIdLine;
  const undo = view.payWith === "mon"
    ? `<button class="a898-link a898-link--quiet" type="button" data-a898-act="gift-use-usdc">USDC</button>` : "";
  if (!l || !l.exact || !l.text) return undo ? `<div class="a898-faceLine">${undo}</div>` : "";
  const explain = l.assetChange
    ? `<button class="a898-explain" type="button" data-a898-act="gift-explain">What's this?</button>` : "";
  return `<div class="a898-faceLine" data-a898-exact="1"><span class="a898-faceLine__text">${a898Esc(l.text)}</span>${explain}${undo}</div>`;
}

function a898Fees(fees, view = {}) {
  if (!fees) return "";
  // one fee number per screen (N1): when the Face ID line is exact it carries the TOTAL; the gas-only row then shows a value only if it is that same total.
  const exactTotal = view.faceIdLine && view.faceIdLine.exact ? view.faceIdLine.parts.feeUsd : null;
  const gasKnown = fees.giftGasCost && fees.giftGasCost.known && fees.giftGasCost.usd != null;
  const gas = gasKnown && (exactTotal === null || exactTotal === fees.giftGasCost.usd) ? a898Usd(fees.giftGasCost.usd) : "";
  const araso = fees.arasoFee && fees.arasoFee.adopted ? "" : a898Usd(fees.arasoFee ? fees.arasoFee.usd : "0");
  return `<dl class="a898-fees"><div><dt>Gift gas cost</dt><dd>${gas}</dd></div><div><dt>Araso fee</dt><dd>${araso}</dd></div></dl>`;
}


// ── Card F: the sender picks one of three fronts, then writes the back-A letter (gift_card_20261004 README). ──
// Art = existing poses only (README 자산 출처): 01 piggy_stand · 02 piggy_seat_listen · 04 piggy_watching_fit, letter corner = piggy_face,
// copied by the merge to /card/gift/ (same file names as the design folder's assets/). Fronts: black #121110, one pose cropped by the edge,
// amount = cream-outlined box (no fill) that MIRRORS the preset row chosen below it (no default; the box stays empty until a preset is tapped).
// Back A: paper, TO top-left, hand-written one line in the middle, FROM signature box bottom-right, corner Piggy peeking bottom-left.
// Motion (proposal, Owner visual check pending): fan of three tilted -> tapped card lifts, others slide out -> flips to the letter.
// view.fronts = [{id:"01"|"02"|"04", selected}] · view.picked = id|null · view.flipped = boolean · view.fields = {to,message,from?}
// FROM source is UNKNOWN (README names the box, not where its text comes from): it is an optional field `from`, empty box if absent.
const A898_FRONT_ART = Object.freeze({
  "01": { src: "/card/gift/piggy_stand.svg", style: "left:29.6px;top:82.4px;width:195.2px;transform-origin:97.6px 70.4px;transform:rotate(-8deg)" },
  "02": { src: "/card/gift/piggy_seat_listen.svg", style: "left:56px;top:56px;width:160px" },
  "04": { src: "/card/gift/piggy_watching_fit.svg", style: "left:-27.2px;top:104px;width:216px" },
});

function a898FrontFace(id, amountUsd) {
  const art = A898_FRONT_ART[id];
  if (!art) return "";
  const box = amountUsd
    ? `<span class="a898-cardAmt"><span class="a898-cardAmt__n">${a898Usd(amountUsd)}</span></span>`
    : `<span class="a898-cardAmt"></span>`;
  return `<span class="a898-cardFace a898-cardFace--front"><span class="a898-cardArt"><img src="${a898Esc(art.src)}" alt="" style="${art.style}" /></span>${box}</span>`;
}

function a898LetterFace(f, flipped) {
  const dis = flipped ? "" : ' tabindex="-1"';
  return `<span class="a898-cardFace a898-cardFace--back">
      <span class="a898-letter__to"><span class="a898-letter__small">TO</span><input class="a898-letter__in a898-letter__in--to" type="text" autocomplete="off" maxlength="80" aria-label="TO" data-a898-field="to" value="${a898Esc(f.to)}"${dis} /></span>
      <textarea class="a898-letter__in a898-letter__msg" rows="4" maxlength="140" autocomplete="off" aria-label="message" data-a898-field="message"${dis}>${a898Esc(f.message)}</textarea>
      <img class="a898-letter__peek" src="/card/gift/piggy_face.svg" alt="" />
      <span class="a898-letter__from"><span class="a898-letter__small">FROM</span><input class="a898-letter__in a898-letter__in--from" type="text" autocomplete="off" maxlength="40" aria-label="FROM" data-a898-field="from" value="${a898Esc(f.from)}"${dis} /></span>
    </span>`;
}

function a898CardStage(view) {
  const picked = view.picked || null;
  const amount = (view.presets || []).find((p) => p.selected);
  const amountUsd = amount ? amount.id : "";
  const f = view.fields || {};
  const cards = view.fronts.map((fr, i) => {
    const isPicked = picked === fr.id;
    const cls = `a898-card${picked ? (isPicked ? " is-picked" : " is-away") : ""}${isPicked && view.flipped ? " is-flipped" : ""}`;
    return `<div class="${cls}" data-a898-front="${a898Esc(fr.id)}" data-i="${i}">
      <button class="a898-cardTap" type="button" data-a898-act="gift-front" data-a898-arg="${a898Esc(fr.id)}" aria-pressed="${isPicked ? "true" : "false"}" aria-label="${a898Esc(fr.id)}"${isPicked && view.flipped ? ' tabindex="-1"' : ""}></button>
      <span class="a898-card__inner">${a898FrontFace(fr.id, amountUsd)}${isPicked ? a898LetterFace(f, !!view.flipped) : ""}</span>
    </div>`;
  }).join("");
  const repick = picked ? `<button class="a898-link a898-repick" type="button" aria-label="back" data-a898-act="gift-repick">&lsaquo;</button>` : "";
  return `${repick}<div class="a898-stage" data-a898-picked="${a898Esc(picked || "")}" data-a898-flipped="${view.flipped ? "1" : "0"}">${cards}</div>`;
}

export function giftSendPaperMarkup(view = {}) {
  const f = view.fields || {};
  if (view.stage === "unavailable") {
    return `<div class="homePaper__addMoney a898-paper" data-add-money="a898-gift" data-a898-root="gift" data-a898-stage="unavailable">
      <button class="a898-link" type="button" data-a898-act="gift-back">&lt; back</button>
      <div class="a898-state a898-detail" role="status">Not ready yet</div>
    </div>`;
  }
  const done = view.stage === "done" && view.link
    ? `<div class="a898-link-out a898-detail" data-a898-link="1">${a898Esc(view.link)}</div>` : "";
  const busy = view.stage === "executing";
  return `<div class="homePaper__addMoney a898-paper" data-add-money="a898-gift" data-a898-root="gift" data-a898-stage="${a898Esc(view.stage)}">
    <button class="a898-link" type="button" data-a898-act="gift-back">&lt; back</button>
    <div class="a898-head"><span class="a898-who">${a898Esc(view.payerName)}</span></div>
    ${a898Balance(view)}
    ${a898Presets(view.presets)}
    ${a898Short(view)}
    ${Array.isArray(view.fronts) && view.fronts.length ? a898CardStage(view) : `<label class="a898-field"><span class="a898-field__label">TO</span><input class="a898-input" type="text" autocomplete="off" maxlength="80" data-a898-field="to" value="${a898Esc(f.to)}" /></label>
    <label class="a898-field"><input class="a898-input" type="text" autocomplete="off" maxlength="140" aria-label="message" data-a898-field="message" value="${a898Esc(f.message)}" /></label>`}
    ${view.notice ? `<div class="a898-state a898-reason" role="status" data-a898-notice="1">${a898Esc(view.notice)}</div>` : ""}
    ${view.explain && view.explain.open && view.explain.lines.length ? `<div class="a898-explainBody a898-detail" data-a898-explain="1">${view.explain.lines.map((l) => `<p>${a898Esc(l)}</p>`).join("")}</div>` : ""}
    ${view.stage === "requote" ? `<button class="sendCard__btn pkbtn a898-try" type="button" aria-label="Try again" data-a898-act="gift-requote"><span class="pkbtn__shell" aria-hidden="true"><img class="pkbtn__cap pkbtn__cap--l" src="/card/btn_l.png" alt="" /><span class="pkbtn__mid"></span><img class="pkbtn__cap pkbtn__cap--r" src="/card/btn_r.png" alt="" /></span><span class="pkbtn__word pkbtn__text" aria-hidden="true">Try again</span></button>` : ""}
    ${a898Fees(view.fees, view)}
    <div class="a898-foot">${a898FaceIdLine(view)}
    <button class="a898-faceBtn" type="button" data-a898-act="gift-faceid"${view.canFaceId && !busy ? "" : " disabled"}${view.blockedReason ? ` data-blocked="${a898Esc(view.blockedReason)}"` : ""}>${A898_FACE_ICON}<span class="invite__faceLabel">Passkey</span></button></div>
    ${done}
  </div>`;
}
// ── [/A-898 MARKUP] ──────────────────────────────────────────────────────────

// ── [A-915] the Gift create step on Monad mainnet: arm -> (executeMoneyStep + receipt) x 3 -> disarm ──────────────────────────────────────────
/**
 * Sends the three calls of ONE create step (approve -> create -> gas deposit, as built by buildGiftCreateStepCalls) in order, each through the one
 * chokepoint (strict sign-before-send), waiting for a successful receipt before the next. The calls are armed for SIGN_GUARD first (exact shapes only,
 * see gift-create-plan.js armGiftCreateStep) and disarmed on every exit. Nothing is retried, nothing is sent twice. Never throws.
 * `clients` = { walletClient, publicClient } for the Gift chain (injected); `account` = the live payer account (one signer session).
 * Returns { results: [{status:"success"|"unconfirmed"|"missing", hash}] x 3, blockedReason: string|null, armRefused: reason|null }.
 */
export async function runGiftCreateCalls({ plan, calls, escrowAddress, account, clients, receiptTimeoutMs, authorize, reserve, persistHash } = {}) {
  const results = [];
  const finish = (extra = {}) => { while (results.length < 3) results.push({ status: "missing", hash: null }); return { results, blockedReason: null, armRefused: null, ...extra }; };
  const armed = armGiftCreateStep(plan, calls, { escrowAddress });
  if (!armed.ok) return finish({ armRefused: armed.reason });
  try {
    if (!clients || !clients.walletClient || !clients.publicClient || !account) return finish({ blockedReason: "executor_unavailable" });
    for (const call of calls) {
      const step = await executeMoneyStep({
        tx: { to: call.to, data: call.data, value: call.value },
        transport: { kind: TRANSPORT_KIND.VIEM_RAW, walletClient: clients.walletClient, publicClient: clients.publicClient, account },
        requireSignBeforeSend: true,
        authorize,
        reserve,
        persistHash: (h) => persistHash(call.label, h),
      });
      // a send whose outcome is unknown still has a known hash (signed before send): reading its receipt is read-only
      if (!step.hash || !(step.ok || step.status === "send_outcome_unknown")) return finish({ blockedReason: step.reason || step.status });
      let receipt = null;
      try { receipt = await clients.publicClient.waitForTransactionReceipt({ hash: step.hash, timeout: receiptTimeoutMs }); } catch { receipt = null; }
      results.push({ status: receipt && receipt.status === "success" ? "success" : "unconfirmed", hash: step.hash });
      if (results[results.length - 1].status !== "success") return finish();
    }
    return finish();
  } catch {
    return finish({ blockedReason: "executor_unavailable" });
  } finally {
    armed.disarm();
  }
}
