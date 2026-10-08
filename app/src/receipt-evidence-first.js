// [A-878 / A-856 W3a] First Journey -> receipt evidence ADAPTER (mapping only, no call-site wiring).
//
// Maps the First send record's broadcast hashes ([deposit, redeem]) into items the A-866 reader
// (readTxEvidence) and the A-868 store (append) can take. It does NOT read the chain, write storage,
// sign, send, authorize or decide anything. Evidence is OBSERVATION ONLY — never execution or
// permission authority: no item carries an executable/permission/authorize field, and nothing here
// is an input to money-executor / permission-envelope / the First Send lock.
//
//   · deterministic: same input -> same output. No network, no timers, no clock (observedAt only when
//     `now` is injected as a string).
//   · every item is labelled: chain {chainId, label} · journey ("first") + step · source (where the hash came from).
//   · a failed / reverted / unknown First send keeps its hash as an evidence item (A-856: today it is dropped).
//   · the record's own stage/status is carried as `recordClaim` (what the record SAYS), never as a chain fact.
//   · chainId is never guessed: it must be injected (First records do not carry one) — no default network.
//   · never throws: hostile input -> { ok:false, reason } or a `refused` entry.
//
// Record shapes (read from main.js, not imported): send-pending {stage, depositTxHash, redeemTxHash};
// settled send receipt {depositTxHash, redeemTxHash, txHash(legacy = redeem), status}.

import { evidenceKey } from "./receipt-evidence-reader.js";

export const FIRST_EVIDENCE_JOURNEY = "first";
export const FIRST_EVIDENCE_STEPS = Object.freeze(["deposit", "redeem"]);
export const FIRST_EVIDENCE_SOURCES = Object.freeze({ SEND_PENDING: "first.send_pending", SEND_RECEIPT: "first.send_receipt" });
// First send-pending stages known today (main.js). Anything else is labelled "unknown_stage", never coerced.
const FIRST_STAGES = new Set(["deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"]);

const HASH32 = /^0x[0-9a-f]{64}$/i;
const ADDR = /^0x[0-9a-f]{40}$/i;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chainOk = (c) => (typeof c === "number" && Number.isSafeInteger(c) && c > 0) || (typeof c === "string" && /^[1-9][0-9]{0,15}$/.test(c));
const label = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : "UNKNOWN");
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const isHash = (h) => typeof h === "string" && HASH32.test(h);
const absent = (h) => h === undefined || h === null || h === "";

function txItem({ chainId, chainLabel, step, source, hash, recordClaim, expect, now }) {
  const txHash = hash.toLowerCase();
  const journeyLabel = `${FIRST_EVIDENCE_JOURNEY}.${step}`;
  const cid = String(chainId);
  const seed = { schema: "araso_tx_evidence_v1", chainId: cid, txHash, journey: journeyLabel, source, status: "unknown" };
  if (typeof now === "string" && now) seed.observedAt = now.slice(0, 40); // [A-878 F4] bounded
  return {
    kind: "tx",
    authority: "observation_only",
    chain: { chainId: cid, label: chainLabel },
    journey: FIRST_EVIDENCE_JOURNEY,
    step,
    journeyLabel,
    source,
    txHash,
    evidenceKey: evidenceKey({ chainId: cid, txHash }),
    recordClaim,
    readEligible: true,
    // Arguments for readTxEvidence (the caller injects rpc/stored/finality). Read-only.
    readRequest: { chainId: cid, hash: txHash, journey: journeyLabel, source: `rpc;hash_from=${source}`, ...(expect ? { expect } : {}) },
    // A hash-known, not-yet-read row for the A-868 store (status "unknown" never overwrites a settled fact there).
    seed,
  };
}

/**
 * mapFirstEvidence({ record, sourceKind, chainId, chainLabel, piggyAddress, now })
 *   sourceKind: "send_pending" | "send_receipt" (required — the record kind is never guessed)
 *   chainId:    numeric chain id (required; injected by the caller)
 * -> { ok:true, journey:"first", items:[...], refused:[{step, reason}] } | { ok:false, reason }
 */
export function mapFirstEvidence(input) {
  try {
    if (!isObj(input)) return { ok: false, reason: "record_invalid" };
    const { record, sourceKind, chainId, chainLabel, piggyAddress, now } = input;
    if (!chainOk(chainId)) return { ok: false, reason: "chain_unlabelled" };
    if (!isObj(record)) return { ok: false, reason: "record_invalid" };
    const source = sourceKind === "send_pending" ? FIRST_EVIDENCE_SOURCES.SEND_PENDING
      : sourceKind === "send_receipt" ? FIRST_EVIDENCE_SOURCES.SEND_RECEIPT : null;
    if (!source) return { ok: false, reason: "source_kind_unknown" };
    if (chainOk(record.chainId) && String(record.chainId) !== String(chainId)) return { ok: false, reason: "chain_mismatch" };
    const cl = label(chainLabel);
    const expect = typeof piggyAddress === "string" && ADDR.test(piggyAddress) ? { from: piggyAddress.toLowerCase() } : null;
    const claim = sourceKind === "send_pending"
      ? { stage: FIRST_STAGES.has(record.stage) ? record.stage : "unknown_stage" }
      : { status: typeof record.status === "string" ? record.status.slice(0, 32) : "UNKNOWN" };
    const items = [];
    const refused = [];
    const hashes = { deposit: record.depositTxHash, redeem: record.redeemTxHash };
    let redeemSource = source;
    if (sourceKind === "send_receipt" && isHash(record.txHash)) {
      // Legacy settled receipts: `txHash` is the redeem hash when `redeemTxHash` is absent (main.js receipt rule).
      if (absent(hashes.redeem)) { hashes.redeem = record.txHash; redeemSource = `${source}.txHash_legacy`; }
      else if (isHash(hashes.redeem) && record.txHash.toLowerCase() !== hashes.redeem.toLowerCase()) {
        refused.push({ step: "redeem", reason: "txhash_redeem_mismatch" }); // only redeemTxHash is mapped; nothing rewritten
      }
    }
    for (const step of FIRST_EVIDENCE_STEPS) {
      const h = hashes[step];
      if (absent(h)) { refused.push({ step, reason: "no_hash" }); continue; }
      if (!isHash(h)) { refused.push({ step, reason: "hash_invalid" }); continue; }
      items.push(txItem({ chainId, chainLabel: cl, step, source: step === "redeem" ? redeemSource : source, hash: h, recordClaim: { ...claim }, expect, now }));
    }
    if (items.length === 2 && items[0].txHash === items[1].txHash) return { ok: false, reason: "duplicate_hash_across_steps" };
    return deepFreeze({ ok: true, journey: FIRST_EVIDENCE_JOURNEY, items, refused });
  } catch {
    return { ok: false, reason: "record_invalid" };
  }
}
