// Mainnet Job lanes — protocol-neutral helpers shared by the per-protocol modules.
//
// Move-only extraction: every function here is the exact body that the Aave lane (mainnet-job-lane.js)
// already used. Nothing here decides money safety on its own; the boundaries stay where they were:
//   · permission      -> permission-envelope.js (issuePermission / authorize / consume)
//   · the one send    -> money-executor.js executeMoneyStep (no other broadcast path)
//   · record binding  -> chain-profile.js bindRecordToProfile / checkRecordBinding
//   · decision receipt-> second-journey-state.js validateDecisionReceipt
// This module imports none of them except the rule-decision result words. It holds no key, reads no
// network, builds no transaction and has no send.

import { RESULT } from "./rule-decision.js";

export const ADDR = /^0x[0-9a-fA-F]{40}$/;
export const TX = /^0x[0-9a-fA-F]{64}$/;
export const lower = (v) => String(v || "").toLowerCase();
export const isDigits = (v) => typeof v === "string" && /^\d+$/.test(v);

/** Raw integer units -> fixed-point string with exactly `decimals` fraction digits (no rounding). */
export function formatUnits(raw, decimals) {
  const s = raw.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`;
}

/** Precedence fold over rule decisions: unknown > nah > ask > match. */
export function foldDecisions(decisions) {
  for (const result of [RESULT.UNKNOWN, RESULT.NAH, RESULT.ASK]) {
    const first = decisions.find((d) => d.result === result);
    if (first) return { result, deciding: first };
  }
  return { result: RESULT.DO_IT, deciding: null };
}

export const DECISION_WORD = Object.freeze({ [RESULT.NAH]: "nah", [RESULT.ASK]: "ask", [RESULT.UNKNOWN]: "unknown", [RESULT.DO_IT]: "match" });

/** A lifecycle record moved to `stage`, with a bounded history. Pure. */
export function stampRecord(record, stage, nowIso, extra = {}) {
  return { ...record, ...extra, stage, updatedAt: nowIso, history: [...(record.history || []), { stage, at: nowIso }].slice(-24) };
}

/** setItem under `key`; false on no storage / no key / a throw. */
export function saveRecord(storage, key, record) {
  if (!storage || !key) return false;
  try { storage.setItem(key, JSON.stringify(record)); return true; } catch { return false; }
}

/**
 * setItem + read-back: true only when the stored bytes are exactly what was written. For the writes a
 * money path depends on (the "about to send" record and the post-send hash), where "setItem did not
 * throw" is not enough.
 */
export function saveRecordVerified(storage, key, record) {
  if (!storage || !key || typeof storage.getItem !== "function") return false;
  try {
    const serialized = JSON.stringify(record);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch { return false; }
}

/**
 * Live execution has no path: only an injected executor of kind "local_fork" on the profile's own
 * chain id, pinned to an integer fork block, is accepted. Returns a refusal reason or null.
 */
export function executorRefusal(profile, executor) {
  if (!executor || typeof executor.send !== "function" || typeof executor.receipt !== "function") return "no_executor";
  if (executor.kind !== "local_fork") return "live_execution_disabled";
  if (executor.chainId !== profile.numericChainId || !Number.isInteger(executor.forkBlock)) return "executor_chain_mismatch";
  return null;
}
