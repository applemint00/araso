// [A-878 / A-856 W3c] Gift -> receipt evidence ADAPTER (mapping only, no call-site wiring).
//
// Maps the Gift commit->claim submitter's tx hashes ([delivery, commit, claim], gift-claim-entry.js
// `txHashes`) into items the A-866 reader and the A-868 store can take.
//
// The giftId gas-delivery LEDGER (app/src/gift-gas-ledger.js, relayer/src/gift-gas-ledger.mjs) is NOT replaced
// or duplicated here: this module does not import, read, write or mirror it, emits no ledger state
// (PENDING / CONFIRMED / UNKNOWN), keys evidence per tx (never per giftId), and refuses a ledger entry as input.
// "Delivered exactly once per giftId" stays the ledger's job; evidence only records what a tx hash looks like on chain.
//
// Evidence is OBSERVATION ONLY — never execution, permission or delivery authority. Deterministic: no network,
// no timers, no clock (observedAt only when `now` is injected). Never throws.
// The giftId is carried only as `giftRef` (a grouping label). Tokens, salts and preimages are never accepted or copied.

import { evidenceKey } from "./receipt-evidence-reader.js";

export const GIFT_EVIDENCE_JOURNEY = "gift";
export const GIFT_EVIDENCE_STEPS = Object.freeze(["delivery", "commit", "claim"]);
export const GIFT_EVIDENCE_SOURCE = "gift.submit_result";
export const GIFT_LEDGER_BOUNDARY = "gift_gas_ledger_separate";

const HASH32 = /^0x[0-9a-f]{64}$/i;
const ADDR = /^0x[0-9a-f]{40}$/i;
const LEDGER_STATES = new Set(["PENDING", "CONFIRMED", "UNKNOWN"]);
const SECRET_KEYS = ["token", "salt", "preimage", "claimtoken", "secret", "privatekey"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chainOk = (c) => (typeof c === "number" && Number.isSafeInteger(c) && c > 0) || (typeof c === "string" && /^[1-9][0-9]{0,15}$/.test(c));
const label = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : "UNKNOWN");
const addrOf = (a) => (typeof a === "string" && ADDR.test(a) ? a.toLowerCase() : null);
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

// What each step's tx is expected to look like (verification inputs for the reader; never permission).
function expectFor(step, recipient, escrow) {
  if (step === "delivery") return recipient ? { to: recipient } : null;
  const e = {};
  if (recipient) e.from = recipient; // commit and claim are signed by the bound Gift Piggy itself
  if (escrow) e.to = escrow;
  return Object.keys(e).length ? e : null;
}

/**
 * mapGiftEvidence({ giftId, txHashes:{delivery, commit, claim}, submitStatus, chainId, chainLabel, recipient, escrow, now })
 * -> { ok:true, journey:"gift", giftRef, ledgerBoundary, items:[...], refused:[...] } | { ok:false, reason }
 */
export function mapGiftEvidence(input = {}) {
  try {
    if (!isObj(input)) return { ok: false, reason: "record_invalid" };
    const { giftId, txHashes, submitStatus, chainId, chainLabel, recipient, escrow, now } = input;
    // A ledger entry is not an evidence source (the ledger stays the authority for its own state).
    if (LEDGER_STATES.has(input.state) || input.deviceId !== undefined || isObj(input.entries)) return { ok: false, reason: "ledger_entry_not_accepted" };
    // [A-878 F4] key PRESENCE, case/underscore-insensitive (Token, claim_token, salt: undefined all refused).
    if (Object.keys(input).some((k) => SECRET_KEYS.includes(k.toLowerCase().replace(/[_-]/g, "")))) return { ok: false, reason: "secret_field_not_accepted" };
    if (!chainOk(chainId)) return { ok: false, reason: "chain_unlabelled" };
    if (typeof giftId !== "string" || !HASH32.test(giftId)) return { ok: false, reason: "gift_id_invalid" };
    if (!isObj(txHashes)) return { ok: false, reason: "record_invalid" };
    const cid = String(chainId);
    const giftRef = giftId.toLowerCase();
    const r = addrOf(recipient), e = addrOf(escrow);
    const claim = { submitStatus: typeof submitStatus === "string" ? submitStatus.slice(0, 40) : "UNKNOWN" };
    const items = [], refused = [], seen = new Set();
    for (const step of GIFT_EVIDENCE_STEPS) {
      const h = txHashes[step];
      if (h === undefined || h === null || h === "") { refused.push({ step, reason: "no_hash" }); continue; }
      if (typeof h !== "string" || !HASH32.test(h)) { refused.push({ step, reason: "hash_invalid" }); continue; }
      const txHash = h.toLowerCase();
      if (seen.has(txHash) || txHash === giftRef) return { ok: false, reason: "duplicate_hash_across_steps" };
      seen.add(txHash);
      const journeyLabel = `${GIFT_EVIDENCE_JOURNEY}.${step}`;
      const expect = expectFor(step, r, e);
      const seed = { schema: "araso_tx_evidence_v1", chainId: cid, txHash, journey: journeyLabel, source: GIFT_EVIDENCE_SOURCE, status: "unknown" };
      if (typeof now === "string" && now) seed.observedAt = now.slice(0, 40); // [A-878 F4] bounded
      items.push({
        kind: "tx",
        authority: "observation_only",
        chain: { chainId: cid, label: label(chainLabel) },
        journey: GIFT_EVIDENCE_JOURNEY,
        step,
        journeyLabel,
        source: GIFT_EVIDENCE_SOURCE,
        giftRef,
        ledgerBoundary: GIFT_LEDGER_BOUNDARY,
        txHash,
        evidenceKey: evidenceKey({ chainId: cid, txHash }),
        recordClaim: { ...claim },
        readEligible: true,
        readRequest: { chainId: cid, hash: txHash, journey: journeyLabel, source: `rpc;hash_from=${GIFT_EVIDENCE_SOURCE}`, ...(expect ? { expect } : {}) },
        seed,
      });
    }
    return deepFreeze({ ok: true, journey: GIFT_EVIDENCE_JOURNEY, giftRef, ledgerBoundary: GIFT_LEDGER_BOUNDARY, items, refused });
  } catch { return { ok: false, reason: "record_invalid" }; }
}
