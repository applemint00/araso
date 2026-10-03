// [A-693 / A-680 M1] The ONE broadcast chokepoint for every non-legacy money lane.
//
// Contract: the only code under app/src (besides First's two legacy sites in main.js and the
// held Gift claim entry) that may call `walletClient.sendTransaction`, `publicClient.sendRawTransaction`
// or `executor.send` is this file. app/test/money-executor.mjs pins that (source invariant H1).
//
// Order (H2), strict sign-before-send transport ("viem_raw"):
//   authorize -> reserve -> persist_nonce -> sign -> persist_hash -> broadcast
// Compat transports ("viem_send", "lane_executor") cannot expose a hash before the send, so the
// hash is persisted right after it (bounded retries) and the result says so:
//   authorize -> reserve -> persist_nonce -> broadcast -> persist_hash
// A caller that must not accept the compat order passes requireSignBeforeSend:true.
//
// What this module does NOT do: hold keys, read storage, build transactions, pick an amount, decide
// what a stage is called. Every decision hook is injected by the lane that owns the record:
//   authorize()   -> permission gate (envelope/confirm/lock state). Nothing has happened yet.
//   reserve()     -> durably persist the "about to send" record AND verify it. Nothing signed yet.
//   persistNonce()-> (optional) durably persist the consumed permission nonce / verify it is stored.
//   persistHash({hash, nonce}) -> durably persist + verify the tx hash.
// A hook returns true | {ok:true} to pass; anything else (false, {ok:false, reason}, a throw) stops
// the step fail-closed with the phase and reason. Nothing is retried except the post-send hash write.
//
// Result: { ok, status, phase, reason, hash, nonce, broadcastAttempted, signedBeforeSend, order }
//   status "blocked"              nothing was broadcast
//   status "broadcast"            sent, hash known and persisted (ok:true)
//   status "send_outcome_unknown" the send threw / returned no usable hash; whether it landed is unknown
//   status "unknown_hash_unsaved" sent, hash known in memory only (all persist attempts failed)

import { keccak256 } from "viem";

export const MONEY_EXECUTOR_ORDER = Object.freeze(["authorize", "reserve", "persist_nonce", "sign", "persist_hash", "broadcast"]);
export const TRANSPORT_KIND = Object.freeze({ VIEM_SEND: "viem_send", VIEM_RAW: "viem_raw", LANE_EXECUTOR: "lane_executor" });
export const DEFAULT_HASH_SAVE_ATTEMPTS = 3;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function passed(r) {
  return r === true || (!!r && typeof r === "object" && r.ok === true);
}

async function runHook(fn, ...args) {
  try {
    const r = await fn(...args);
    return passed(r) ? { ok: true } : { ok: false, reason: (r && typeof r === "object" && typeof r.reason === "string" && r.reason) || null };
  } catch {
    return { ok: false, reason: "hook_threw" };
  }
}

function transportProblem(transport) {
  if (!transport || typeof transport !== "object") return "no_transport";
  if (transport.kind === TRANSPORT_KIND.VIEM_SEND) {
    return typeof transport.walletClient?.sendTransaction === "function" && ADDRESS.test(transport.account?.address || "") ? null : "transport_incomplete";
  }
  if (transport.kind === TRANSPORT_KIND.VIEM_RAW) {
    return typeof transport.walletClient?.prepareTransactionRequest === "function"
      && typeof transport.account?.signTransaction === "function"
      && typeof transport.publicClient?.sendRawTransaction === "function"
      && ADDRESS.test(transport.account?.address || "") ? null : "transport_incomplete";
  }
  if (transport.kind === TRANSPORT_KIND.LANE_EXECUTOR) {
    return typeof transport.executor?.send === "function" ? null : "transport_incomplete";
  }
  return "unknown_transport";
}

/**
 * Runs exactly one money step through the fixed order. See the file header for the contract.
 * @param {object} p
 * @param {object} p.tx           { to, data, value?, from? } — already derived from the authorized request by the lane
 * @param {object} p.transport    { kind, walletClient?, publicClient?, account?, executor? }
 * @param {Function} p.authorize
 * @param {Function} p.reserve
 * @param {Function} [p.persistNonce]
 * @param {Function} p.persistHash
 * @param {boolean} [p.requireSignBeforeSend]
 * @param {number} [p.hashSaveAttempts]
 */
export async function executeMoneyStep({ tx, transport, authorize, reserve, persistNonce = null, persistHash, requireSignBeforeSend = false, hashSaveAttempts = DEFAULT_HASH_SAVE_ATTEMPTS } = {}) {
  const order = [];
  const result = (status, phase, reason, extra = {}) => ({
    ok: status === "broadcast",
    status,
    phase,
    reason,
    hash: null,
    nonce: null,
    broadcastAttempted: false,
    signedBeforeSend: false,
    ...extra,
    order: [...order],
  });
  const blocked = (phase, reason, extra) => result("blocked", phase, reason, extra);

  // Misconfiguration is refused before any hook runs: a half-wired step must not reach a signer.
  if (!tx || typeof tx !== "object" || typeof tx.to !== "string" || !ADDRESS.test(tx.to)) return blocked("authorize", "invalid_tx");
  const tProblem = transportProblem(transport);
  if (tProblem) return blocked("authorize", tProblem);
  if (typeof authorize !== "function" || typeof reserve !== "function" || typeof persistHash !== "function") return blocked("authorize", "executor_misconfigured");
  if (persistNonce !== null && typeof persistNonce !== "function") return blocked("authorize", "executor_misconfigured");
  const strict = transport.kind === TRANSPORT_KIND.VIEM_RAW;
  if (requireSignBeforeSend && !strict) return blocked("authorize", "sign_before_send_unavailable");

  order.push("authorize");
  const auth = await runHook(authorize);
  if (!auth.ok) return blocked("authorize", auth.reason || "not_authorized");

  order.push("reserve");
  const res = await runHook(reserve);
  if (!res.ok) return blocked("reserve", res.reason || "reserve_failed");

  if (persistNonce) {
    order.push("persist_nonce");
    const n = await runHook(persistNonce);
    if (!n.ok) return blocked("persist_nonce", n.reason || "nonce_not_persisted");
  }

  // Persist the hash with bounded, immediate retries (no timers). Returns true only when a write verified.
  const attempts = Number.isInteger(hashSaveAttempts) && hashSaveAttempts >= 1 ? Math.min(hashSaveAttempts, 5) : DEFAULT_HASH_SAVE_ATTEMPTS;
  async function saveHash(hash, nonce) {
    for (let i = 0; i < attempts; i += 1) {
      if ((await runHook(persistHash, { hash, nonce })).ok) return true;
    }
    return false;
  }

  if (strict) {
    const { walletClient, publicClient, account } = transport;
    let raw;
    let hash;
    let nonce = null;
    order.push("sign");
    try {
      const prepared = await walletClient.prepareTransactionRequest({ account, ...tx });
      const { account: _drop, ...toSign } = prepared || {};
      raw = await account.signTransaction(toSign);
      if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) return blocked("sign", "sign_failed");
      hash = keccak256(raw);
      nonce = Number.isInteger(Number(toSign.nonce)) ? Number(toSign.nonce) : null;
    } catch {
      return blocked("sign", "sign_failed");
    }
    order.push("persist_hash");
    if (!(await saveHash(hash, nonce))) return blocked("persist_hash", "hash_not_persisted", { hash, nonce, signedBeforeSend: true });
    order.push("broadcast");
    let sent;
    try {
      sent = await publicClient.sendRawTransaction({ serializedTransaction: raw });
    } catch {
      return result("send_outcome_unknown", "broadcast", "send_outcome_unknown", { hash, nonce, broadcastAttempted: true, signedBeforeSend: true });
    }
    if (typeof sent === "string" && sent.toLowerCase() !== hash.toLowerCase()) {
      return result("send_outcome_unknown", "broadcast", "hash_mismatch", { hash, nonce, broadcastAttempted: true, signedBeforeSend: true });
    }
    return result("broadcast", "broadcast", null, { hash, nonce, broadcastAttempted: true, signedBeforeSend: true });
  }

  // Compat transports: the hash exists only once the send returns.
  order.push("broadcast");
  let hash;
  try {
    if (transport.kind === TRANSPORT_KIND.VIEM_SEND) {
      hash = await transport.walletClient.sendTransaction({ account: transport.account, ...tx });
    } else {
      const sent = await transport.executor.send(tx);
      hash = sent?.hash;
    }
  } catch {
    return result("send_outcome_unknown", "broadcast", "send_outcome_unknown", { broadcastAttempted: true });
  }
  if (typeof hash !== "string" || !TX_HASH.test(hash)) {
    return result("send_outcome_unknown", "broadcast", "send_outcome_unknown", { broadcastAttempted: true });
  }
  order.push("persist_hash");
  if (!(await saveHash(hash, null))) {
    return result("unknown_hash_unsaved", "persist_hash", "unknown_hash_unsaved", { hash, broadcastAttempted: true });
  }
  return result("broadcast", "persist_hash", null, { hash, broadcastAttempted: true });
}
