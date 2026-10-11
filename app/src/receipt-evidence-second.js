// [A-878 / A-856 W3b] Second Journey -> receipt evidence ADAPTER (mapping only, no call-site wiring).
//
// Two things that are NEVER mixed here:
//   1) STAGED TX evidence — hashes Second lanes actually broadcast:
//        · plumbing proof pending record (second-execution-adapter.js): [deposit, redeem]
//        · Aave mainnet lane intent / lane Receipt / a receipt candidate's evidencePointer (mainnet-job-lane.js):
//          [approve, supply, withdraw]. The Receipt schema itself gains no field.
//      -> `staged` items (kind "tx"), shaped for the A-866 reader and the A-868 store.
//   2) STATE OBSERVATIONS — decision receipts (second_journey_decision_receipt_v1). A decision is not a tx:
//      it has no txHash, no evidenceKey, no readRequest and no store seed. -> `stateObservations`
//      (kind "state_observation", tagUsed "latest", commitState "proposed" — A-856: E observed only this way).
//      A record that claims txExecuted !== false, carries a txHash, or a non-zero actionCount is refused.
//
// Evidence is OBSERVATION ONLY — never execution or permission authority. Nothing here authorizes, consumes a
// nonce, advances a lane, or feeds money-executor / permission-envelope / second-job-readiness (none imported).
// Deterministic: no network, no timers, no clock (observedAt only when `now` is injected). Never throws.
// A FORK_SIM lane hash is labelled readEligible:false (no readRequest, no seed): a local-fork hash is not a chain
// fact and is never promoted.

import { evidenceKey } from "./receipt-evidence-reader.js";

export const SECOND_EVIDENCE_JOURNEY = "second";
export const SECOND_EVIDENCE_SOURCES = Object.freeze({
  PLUMBING_PENDING: "second.plumbing_pending",
  LANE_INTENT: "second.lane_intent",
  LANE_RECEIPT: "second.lane_receipt",
  DECISION_RECEIPT: "second.decision_receipt",
});
export const SECOND_PLUMBING_STEPS = Object.freeze(["deposit", "redeem"]);
export const SECOND_LANE_STEPS = Object.freeze(["approve", "supply", "withdraw"]);
// Copied labels (not imported, so this adapter stays outside the execution modules' import graph; the test pins them).
const PLUMBING_STAGES = new Set(["deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"]);
const PLUMBING_EVIDENCE_CLASS = "PASS_TESTNET_ACTUAL_TX";
const FORK_MODE = "fork_simulation";
const FORK_LABEL = "PASS_FORK_SIM";
const DECISION_SCHEMA = "second_journey_decision_receipt_v1";
const LANE_RECEIPT_SCHEMA = "araso_mainnet_lane_receipt_v1";

const HASH32 = /^0x[0-9a-f]{64}$/i;
const ADDR = /^0x[0-9a-f]{40}$/i;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chainOk = (c) => (typeof c === "number" && Number.isSafeInteger(c) && c > 0) || (typeof c === "string" && /^[1-9][0-9]{0,15}$/.test(c));
const label = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : "UNKNOWN");
const str = (v, n = 64) => (typeof v === "string" ? v.slice(0, n) : null);
const addrOf = (a) => (typeof a === "string" && ADDR.test(a) ? a.toLowerCase() : null);
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

function txItem({ chainId, chainLabel, lane, step, source, hash, recordClaim, expect, readEligible, now }) {
  const txHash = hash.toLowerCase();
  const journeyLabel = `${SECOND_EVIDENCE_JOURNEY}.${lane}.${step}`;
  const cid = String(chainId);
  const seed = { schema: "araso_tx_evidence_v1", chainId: cid, txHash, journey: journeyLabel, source, status: "unknown" };
  if (typeof now === "string" && now) seed.observedAt = now.slice(0, 40); // [A-878 F4] bounded
  return {
    kind: "tx",
    authority: "observation_only",
    chain: { chainId: cid, label: chainLabel },
    journey: SECOND_EVIDENCE_JOURNEY,
    lane,
    step,
    journeyLabel,
    source,
    txHash,
    evidenceKey: evidenceKey({ chainId: cid, txHash }),
    recordClaim,
    readEligible,
    readRequest: readEligible
      ? { chainId: cid, hash: txHash, journey: journeyLabel, source: `rpc;hash_from=${source}`, ...(expect ? { expect } : {}) }
      : null,
    seed: readEligible ? seed : null,
  };
}

// [A-878 F1] Known chain scope labels -> numeric id (same pairs as funding-context.js CHAIN_SCOPE_BY_NUMERIC_ID; pinned in
// the test). An unknown label stays label-only (never turned into a number).
const SCOPE_NUMERIC = Object.freeze({ "monad-testnet": "10143", "monad-mainnet": "143", "monad-fork": "31337143" }); // [A-946] + the fork (= funding-context FORK_CHAIN_ID)
// [A-895 P-C / A-878 R-2] normalised: trim, lower-case, "_"/space -> "-" ("Monad-Testnet", "monad_testnet" resolve to the same scope).
const scopeNumeric = (s) => {
  if (typeof s !== "string") return null;
  const k = s.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return Object.prototype.hasOwnProperty.call(SCOPE_NUMERIC, k) ? SCOPE_NUMERIC[k] : null;
};

// Numeric chain id: injected and/or the record's own numeric id. Both present and different => mismatch. Never guessed.
// A known scope label on the record must agree with the resolved id too, or the record is refused (chain_mismatch).
function resolveChain(injected, recordNumeric, recordScope) {
  const a = chainOk(injected) ? String(injected) : null;
  const b = chainOk(recordNumeric) ? String(recordNumeric) : null;
  if (a && b && a !== b) return { error: "chain_mismatch" };
  if (!a && !b) return { error: "chain_unlabelled" };
  const id = a || b;
  const s = scopeNumeric(recordScope);
  if (s !== null && s !== id) return { error: "chain_mismatch" };
  return { chainId: id };
}

// [A-878 F2] Fork detection, normalised: mode/label case variants, fork:true, a forkBlock — on any of the given objects.
function isFork(...objs) {
  return objs.some((o) => isObj(o) && (
    (typeof o.executionMode === "string" && o.executionMode.toLowerCase() === FORK_MODE)
    || (typeof o.evidenceClass === "string" && o.evidenceClass.toUpperCase().startsWith(FORK_LABEL))
    || o.fork === true
    || (o.forkBlock !== undefined && o.forkBlock !== null)));
}

function mapHashes({ hashes, steps, base, claimFor, items, refused }) {
  const seen = new Set();
  for (const step of steps) {
    const h = hashes[step];
    if (h === undefined || h === null || h === "") { refused.push({ lane: base.lane, step, reason: "no_hash" }); continue; }
    if (typeof h !== "string" || !HASH32.test(h)) { refused.push({ lane: base.lane, step, reason: "hash_invalid" }); continue; }
    if (seen.has(h.toLowerCase())) return "duplicate_hash_across_steps";
    seen.add(h.toLowerCase());
    items.push(txItem({ ...base, step, hash: h, recordClaim: claimFor(step) }));
    if (!base.readEligible) refused.push({ lane: base.lane, step, reason: "fork_simulation_hash_not_read" });
  }
  return null;
}

/** Plumbing-proof pending record {stage, chainId(scope label), address, depositTxHash, redeemTxHash}. The numeric chain id comes from the injected opts.chainId and/or the record's own numeric chainId (both present and different => chain_mismatch); a scope label alone never becomes a number. */
export function mapSecondPlumbingPending(record, opts) {
  try {
    const { chainId, now } = isObj(opts) ? opts : {};
    if (!isObj(record)) return { ok: false, reason: "record_invalid" };
    // [A-895 P-C / A-878 R-1] the record's own chainId doubles as its numeric id (a scope label is not chainOk, so it stays label-only).
    const c = resolveChain(chainId, record.chainId, record.chainId);
    if (c.error) return { ok: false, reason: c.error };
    const items = [], refused = [];
    const from = addrOf(record.address);
    const stage = PLUMBING_STAGES.has(record.stage) ? record.stage : "unknown_stage";
    const dup = mapHashes({
      hashes: { deposit: record.depositTxHash, redeem: record.redeemTxHash }, steps: SECOND_PLUMBING_STEPS, items, refused,
      claimFor: () => ({ stage, evidenceClass: PLUMBING_EVIDENCE_CLASS }),
      base: { chainId: c.chainId, chainLabel: label(record.chainId), lane: "plumbing_proof", source: SECOND_EVIDENCE_SOURCES.PLUMBING_PENDING,
        expect: from ? { from } : null, readEligible: true, now },
    });
    if (dup) return { ok: false, reason: dup };
    return deepFreeze({ ok: true, items, refused });
  } catch { return { ok: false, reason: "record_invalid" }; }
}

/** Aave lane intent {chainId(numeric), chain, stage, steps:{approve|supply|withdraw:{hash,status}}, executionMode, evidenceClass, piggyAddress}. */
export function mapSecondLaneIntent(intent, opts) {
  try {
    const { chainId, now } = isObj(opts) ? opts : {};
    if (!isObj(intent)) return { ok: false, reason: "record_invalid" };
    const c = resolveChain(chainId, intent.chainId, intent.chain);
    if (c.error) return { ok: false, reason: c.error };
    const fork = isFork(intent);
    const steps = isObj(intent.steps) ? intent.steps : {};
    const items = [], refused = [];
    const from = addrOf(intent.piggyAddress);
    const dup = mapHashes({
      hashes: Object.fromEntries(SECOND_LANE_STEPS.map((s) => [s, isObj(steps[s]) ? steps[s].hash : undefined])),
      steps: SECOND_LANE_STEPS, items, refused,
      claimFor: (s) => ({ stage: str(intent.stage, 32) ?? "UNKNOWN", stepStatus: isObj(steps[s]) ? str(steps[s].status, 32) : null,
        executionMode: str(intent.executionMode, 32), evidenceClass: str(intent.evidenceClass, 32) }),
      base: { chainId: c.chainId, chainLabel: label(intent.chain), lane: "aave_lane", source: SECOND_EVIDENCE_SOURCES.LANE_INTENT,
        expect: from ? { from } : null, readEligible: !fork, now },
    });
    if (dup) return { ok: false, reason: dup };
    return deepFreeze({ ok: true, items, refused });
  } catch { return { ok: false, reason: "record_invalid" }; }
}

/** Lane Receipt (araso_mainnet_lane_receipt_v1) or a receipt candidate (its evidencePointer): approveTx/supplyTx/withdrawTx. */
export function mapSecondLaneReceipt(receipt, opts) {
  try {
    const { chainId, now } = isObj(opts) ? opts : {};
    const r = isObj(receipt) && isObj(receipt.evidencePointer) ? receipt.evidencePointer : receipt;
    if (!isObj(r) || r.schema !== LANE_RECEIPT_SCHEMA) return { ok: false, reason: "record_invalid" };
    const c = resolveChain(chainId, r.chainId, r.chain);
    if (c.error) return { ok: false, reason: c.error };
    // A candidate wrapper that differs from its pointer: either side saying fork => fork.
    if (r !== receipt && isObj(receipt) && (chainOk(receipt.chainId) || scopeNumeric(receipt.chainId) !== null)) {
      const w = chainOk(receipt.chainId) ? String(receipt.chainId) : scopeNumeric(receipt.chainId);
      if (w !== c.chainId) return { ok: false, reason: "chain_mismatch" };
    }
    const fork = isFork(r, receipt);
    const items = [], refused = [];
    const from = addrOf(r.piggyAddress);
    const dup = mapHashes({
      hashes: { approve: r.approveTx, supply: r.supplyTx, withdraw: r.withdrawTx }, steps: SECOND_LANE_STEPS, items, refused,
      claimFor: () => ({ outcome: str(r.outcome, 16) ?? "UNKNOWN", failedStep: str(r.failedStep, 16),
        executionMode: str(r.executionMode, 32), evidenceClass: str(r.evidenceClass, 32) }),
      base: { chainId: c.chainId, chainLabel: label(r.chain), lane: "aave_lane", source: SECOND_EVIDENCE_SOURCES.LANE_RECEIPT,
        expect: from ? { from } : null, readEligible: !fork, now },
    });
    if (dup) return { ok: false, reason: dup };
    return deepFreeze({ ok: true, items, refused });
  } catch { return { ok: false, reason: "record_invalid" }; }
}

/** Decision receipt -> state_observation (NOT a tx; never a reader/store input). */
export function mapSecondStateObservation(receipt, opts) {
  try {
    const { now } = isObj(opts) ? opts : {};
    if (!isObj(receipt) || receipt.schema !== DECISION_SCHEMA) return { ok: false, reason: "not_a_decision_receipt" };
    if (receipt.txExecuted !== false || receipt.txHash !== undefined || (receipt.actionCount !== undefined && receipt.actionCount !== 0)) {
      return { ok: false, reason: "not_a_state_observation" };
    }
    const ev = isObj(receipt.evidence) ? receipt.evidence : {};
    const block = Number.isSafeInteger(ev.block) ? ev.block : null;
    return deepFreeze({ ok: true, observation: {
      kind: "state_observation",
      authority: "observation_only",
      chain: { chainId: null, label: label(receipt.chainId) },
      journey: SECOND_EVIDENCE_JOURNEY,
      journeyLabel: `${SECOND_EVIDENCE_JOURNEY}.decision`,
      source: SECOND_EVIDENCE_SOURCES.DECISION_RECEIPT,
      eventId: str(receipt.eventId, 160),
      destinationId: str(receipt.destinationId),
      decision: str(receipt.decision, 16),
      expected: str(receipt.expected, 160),
      found: str(receipt.found, 160),
      block,
      tagUsed: "latest",
      commitState: block === null ? null : "proposed",
      readSource: str(ev.source),
      observedAt: str(ev.observedAt, 40) ?? (typeof now === "string" && now ? now.slice(0, 40) : null),
      txExecuted: false,
    } });
  } catch { return { ok: false, reason: "record_invalid" }; }
}

// ── Fork money split (new fields only; no existing field changes meaning) ─────────────────────────────────────────────────────
// On the shared fork three amounts appear around one errand and are never one number:
//   · virtualGrant — what the fork's grant ledger put on the Piggy (a fork-state write, not money anyone sent; never "earned")
//   · jobInput     — what the Job step itself took in (the asset the record binding names, e.g. 1 MON into shMON, 1 WETH into Euler)
//   · gas          — the native MON the fork charged for the step's transactions (always MON, never the Job's input asset)
// They stay three separate fields, are never summed or netted (`summed: false`), and are labelled fork-only: readEligible false, no
// readRequest, no seed. A record on any other chain is refused (a virtual grant exists only on the fork).
export const FORK_MONEY_SPLIT_SCHEMA = "araso_fork_money_split_v1";
const FORK_NUMERIC = SCOPE_NUMERIC["monad-fork"];
const RAW = /^(0|[1-9][0-9]{0,77})$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9]{0,15}$/;

function splitPart(part, name) {
  if (part === undefined || part === null) return { value: null };
  if (!isObj(part)) return { error: `${name}_invalid` };
  if (name === "gas") {
    if (part.asset !== undefined && part.asset !== "MON") return { error: "gas_not_native_mon" };
    if (!RAW.test(part.feeWei ?? "")) return { error: "gas_fee_not_raw" };
    if (part.gasUsed !== undefined && !RAW.test(part.gasUsed)) return { error: "gas_used_not_raw" };
    return { value: { asset: "MON", native: true, feeWei: part.feeWei, gasUsed: part.gasUsed ?? null } };
  }
  if (typeof part.asset !== "string" || !SYMBOL.test(part.asset)) return { error: `${name}_asset_invalid` };
  if (!RAW.test(part.amountRaw ?? "")) return { error: `${name}_amount_not_raw` };
  const out = { asset: part.asset, amountRaw: part.amountRaw, native: part.native === true };
  if (name === "virtualGrant") return { value: { ...out, virtual: true, grantVersion: str(part.grantVersion, 32) } };
  return { value: { ...out, jobId: str(part.jobId, 64), step: str(part.step, 32) } };
}

/** Fork errand money record {chainId, piggyAddress, virtualGrant, jobInput, gas} -> one split observation (three separate fields). */
export function mapForkMoneySplit(record, opts) {
  try {
    const { chainId } = isObj(opts) ? opts : {};
    if (!isObj(record)) return { ok: false, reason: "record_invalid" };
    const c = resolveChain(chainId, record.chainId, record.chain);
    if (c.error) return { ok: false, reason: c.error };
    if (c.chainId !== FORK_NUMERIC) return { ok: false, reason: "not_fork_chain" };
    const parts = {};
    for (const name of ["virtualGrant", "jobInput", "gas"]) {
      const r = splitPart(record[name], name);
      if (r.error) return { ok: false, reason: r.error };
      parts[name] = r.value;
    }
    if (parts.virtualGrant === null && parts.jobInput === null && parts.gas === null) return { ok: false, reason: "nothing_to_split" };
    return deepFreeze({ ok: true, split: {
      kind: "fork_money_split",
      schema: FORK_MONEY_SPLIT_SCHEMA,
      authority: "observation_only",
      chain: { chainId: c.chainId, label: label(record.chain ?? record.chainId) },
      journey: SECOND_EVIDENCE_JOURNEY,
      piggyAddress: addrOf(record.piggyAddress),
      virtualGrant: parts.virtualGrant,
      jobInput: parts.jobInput,
      gas: parts.gas,
      summed: false,
      readEligible: false,
      readRequest: null,
      seed: null,
    } });
  } catch { return { ok: false, reason: "record_invalid" }; }
}

/**
 * mapSecondEvidence({ plumbingPending, laneIntent, laneReceipt, decisionReceipts, chainId, now })
 * -> { ok:true, journey:"second", staged:[tx items], stateObservations:[...], refused:[...] }
 * Staged tx items and state observations are separate arrays and are never converted into each other.
 * New, optional: `forkMoney` (a fork errand money record) adds `forkMoneySplit` (mapForkMoneySplit) to the result. Without it the
 * result is exactly what it was; the split never becomes a staged item.
 */
export function mapSecondEvidence(input) {
  try {
    if (!isObj(input)) return { ok: false, reason: "record_invalid" };
    const { plumbingPending, laneIntent, laneReceipt, decisionReceipts, chainId, now, forkMoney } = input;
    const staged = [], stateObservations = [], refused = [];
    const keys = new Set();
    const take = (res, source) => {
      if (!res.ok) { refused.push({ source, reason: res.reason }); return; }
      refused.push(...res.refused.map((r) => ({ source, ...r })));
      // [A-878 F3] one staged item per evidenceKey across sources: the first source wins, later ones are refused (not merged).
      for (const it of res.items) {
        if (keys.has(it.evidenceKey)) { refused.push({ source, lane: it.lane, step: it.step, reason: "duplicate_evidence_key_across_sources" }); continue; }
        keys.add(it.evidenceKey); staged.push(it);
      }
    };
    if (plumbingPending != null) take(mapSecondPlumbingPending(plumbingPending, { chainId, now }), SECOND_EVIDENCE_SOURCES.PLUMBING_PENDING);
    if (laneIntent != null) take(mapSecondLaneIntent(laneIntent, { chainId, now }), SECOND_EVIDENCE_SOURCES.LANE_INTENT);
    if (laneReceipt != null) take(mapSecondLaneReceipt(laneReceipt, { chainId, now }), SECOND_EVIDENCE_SOURCES.LANE_RECEIPT);
    for (const d of Array.isArray(decisionReceipts) ? decisionReceipts : []) {
      const r = mapSecondStateObservation(d, { now });
      if (r.ok) stateObservations.push(r.observation); else refused.push({ source: SECOND_EVIDENCE_SOURCES.DECISION_RECEIPT, reason: r.reason });
    }
    if (forkMoney != null) {
      const m = mapForkMoneySplit(forkMoney, { chainId });
      if (!m.ok) refused.push({ source: "second.fork_money", reason: m.reason });
      return deepFreeze({ ok: true, journey: SECOND_EVIDENCE_JOURNEY, staged, stateObservations, refused, forkMoneySplit: m.ok ? m.split : null });
    }
    return deepFreeze({ ok: true, journey: SECOND_EVIDENCE_JOURNEY, staged, stateObservations, refused });
  } catch { return { ok: false, reason: "record_invalid" }; }
}
