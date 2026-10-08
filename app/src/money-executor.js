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
// [A-906] The ONE narrow exception to the authorizationList refusal: a list minted by gift-sponsor-7702.js guards (brand/WeakSet).
import { GIFT_SPONSOR_REDEEM_TO, giftSponsorRedeemData, isGiftSponsorAuthorizationList } from "./gift-sponsor-7702.js";
// [A-915] The other (and only other) 143 exception: the three sender create-step calls armed by gift-create-plan.js (exact shapes, see there).
import { giftCreateStepMatch } from "./gift-create-plan.js";

export const MONEY_EXECUTOR_ORDER = Object.freeze(["authorize", "reserve", "persist_nonce", "sign", "persist_hash", "broadcast"]);
export const TRANSPORT_KIND = Object.freeze({ VIEM_SEND: "viem_send", VIEM_RAW: "viem_raw", LANE_EXECUTOR: "lane_executor" });
export const DEFAULT_HASH_SAVE_ATTEMPTS = 3;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// [A-768 M-C-1] Pre-sign assertion. viem's prepareTransactionRequest may take chainId/type/gas/fees from the RPC
// (eth_fillTransaction), so the request is checked AFTER prepare and BEFORE signTransaction, in the strict path here and
// in First's two legacy sites (main.js signSendStep). Fail-closed: anything unexpected refuses the signature.
//   chainId   exactly Monad testnet (10143, a number) — the only chain these paths sign for today
//   type      "eip1559" (Monad testnet blocks carry baseFeePerGas; evidence: receipts baseFeePerGas 100 gwei)
//   absent    authorizationList (EIP-7702), blob fields, legacy gasPrice, fee-payer/fee-token/nonce-key extras, non-empty accessList
//   bounded   gas, maxFeePerGas, maxPriorityFeePerGas, gas*maxFeePerGas — explicit caps below (INFERRED, ~10x observed):
//             gas <= 2,000,000 (observed shMON-class calls ~100k gas) · maxFeePerGas <= 1000 gwei (observed testnet base fee
//             100 gwei / gasPrice 102 gwei) · whole-tx fee <= 0.1 MON (= the relayer grant, relayer/src/policy.mjs GRANT_WEI)
export const SIGN_GUARD = Object.freeze({
  chainId: 10143,
  type: "eip1559",
  maxGas: 2_000_000n,
  maxFeePerGas: 1_000_000_000_000n,
  maxTxFeeWei: 100_000_000_000_000_000n,
});
// [A-913 B] Monad mainnet is signable ONLY for the A-906 brand type-4 tx (see preparedSignProblem). SIGN_GUARD itself stays 10143.
export const SIGN_GUARD_SPONSOR_CHAIN_ID = 143;
const SIGN_FORBIDDEN_FIELDS = Object.freeze([
  "authorizationList", "blobs", "blobVersionedHashes", "sidecars", "maxFeePerBlobGas", "kzg",
  "gasPrice", "feePayerSignature", "feeToken", "keyAuthorization", "nonceKey",
]);

/** Returns null when the prepared request may be signed, otherwise a short refusal reason. Pure; never throws. */
export function preparedSignProblem(prepared) {
  try {
    if (!prepared || typeof prepared !== "object") return "prepared_missing";
    // [A-913 B] chainId 143 passes this line only when the authorizationList is the A-906 brand (checked below again: type, to, calldata, value, auth chain).
    const sponsorList = isGiftSponsorAuthorizationList(prepared.authorizationList);
    // [A-915] ...or a non-brand tx that is EXACTLY one of the three armed Gift create-step calls (approve / create / gas deposit; plain eip1559, forbidden fields still refused below).
    const createStep = !sponsorList && prepared.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID ? giftCreateStepMatch(prepared) : null;
    if (prepared.chainId !== SIGN_GUARD.chainId && !(sponsorList && prepared.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID) && !createStep) return "chain_id_mismatch";
    // [A-906] Exception, ONLY for an authorizationList minted by gift-sponsor-7702.js (pinned StatelessDeleGator, gift Monad chain, brand check)
    // on a type-4 tx whose `to` is the pinned DelegationManager with no native value. Everything else (any other list, empty list,
    // eip7702 without the brand) keeps the A-768 refusals below, unchanged.
    if (sponsorList) {
      if (prepared.type !== "eip7702") return "tx_type_unexpected";
      if (typeof prepared.to !== "string" || prepared.to.toLowerCase() !== GIFT_SPONSOR_REDEEM_TO.toLowerCase()) return "unexpected_field";
      if (prepared.authorizationList[0].chainId !== prepared.chainId) return "chain_id_mismatch";
      // brand is bound to the redeemDelegations calldata of THIS delegation: any other calldata to the DelegationManager is refused
      if (typeof prepared.data !== "string" || prepared.data.toLowerCase() !== giftSponsorRedeemData(prepared.authorizationList)) return "sponsor_calldata_mismatch";
      if (prepared.value !== undefined && prepared.value !== null && prepared.value !== 0n) return "value_invalid";
    } else if (prepared.type !== SIGN_GUARD.type) return "tx_type_unexpected";
    for (const field of SIGN_FORBIDDEN_FIELDS) {
      if (sponsorList && field === "authorizationList") continue;
      if (prepared[field] !== undefined && prepared[field] !== null) return field === "authorizationList" ? "authorization_list_present" : "unexpected_field";
    }
    if (prepared.accessList !== undefined && prepared.accessList !== null && !(Array.isArray(prepared.accessList) && prepared.accessList.length === 0)) return "access_list_present";
    if (!Number.isSafeInteger(prepared.nonce) || prepared.nonce < 0) return "nonce_invalid";
    const { gas, maxFeePerGas, maxPriorityFeePerGas, value } = prepared;
    if (typeof gas !== "bigint" || gas <= 0n || gas > SIGN_GUARD.maxGas) return "gas_out_of_bounds";
    if (typeof maxFeePerGas !== "bigint" || maxFeePerGas <= 0n || maxFeePerGas > SIGN_GUARD.maxFeePerGas) return "fee_out_of_bounds";
    if (typeof maxPriorityFeePerGas !== "bigint" || maxPriorityFeePerGas < 0n || maxPriorityFeePerGas > maxFeePerGas) return "fee_out_of_bounds";
    if (gas * maxFeePerGas > SIGN_GUARD.maxTxFeeWei) return "fee_out_of_bounds";
    if (value !== undefined && (typeof value !== "bigint" || value < 0n)) return "value_invalid";
    return null;
  } catch {
    return "prepared_unreadable";
  }
}

// [A-774] The one signing copy. A fill-supporting node (geth/anvil) echoes gasPrice on an eip1559 tx and viem copies it;
// the copy drops it ONLY when type is eip1559 and both max-fee fields are present. The original prepared object is never
// mutated; legacy/untyped or fee-incomplete + gasPrice keeps gasPrice and is refused by preparedSignProblem.
// [A-791] Shared by the strict path and the VIEM_SEND compat path, so both check and sign the same object.
export function signingCopy(prepared) {
  const { account: _drop, ...toSign } = prepared || {};
  if (toSign.type === "eip1559" && toSign.maxFeePerGas !== undefined && toSign.maxFeePerGas !== null && toSign.maxPriorityFeePerGas !== undefined && toSign.maxPriorityFeePerGas !== null) delete toSign.gasPrice;
  return toSign;
}

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
    // [A-791] viem's sendTransaction signs inside the call, so the request is prepared here first and the SAME pre-sign
    // assertion runs on it before the send (signingCopy + preparedSignProblem). No prepare function -> nothing to check -> refused.
    return typeof transport.walletClient?.sendTransaction === "function"
      && typeof transport.walletClient?.prepareTransactionRequest === "function"
      && ADDRESS.test(transport.account?.address || "") ? null : "transport_incomplete";
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
      // [A-774] toSign is a copy (see signingCopy); the same copy goes to the guard and to the signer.
      const toSign = signingCopy(prepared);
      // [A-768 M-C-1] refuse before the signer is touched — nothing signed, nothing persisted, nothing sent.
      const signProblem = preparedSignProblem(toSign);
      if (signProblem) return blocked("sign", signProblem);
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

  // [A-791 / A-768 R1] VIEM_SEND pre-sign parity with the strict path: viem signs INSIDE sendTransaction, so the request is
  // prepared here, the A-774 signing copy is built and the A-768 assertion runs on it BEFORE sendTransaction is touched. A refusal
  // (or a prepare that throws) is blocked at "sign": nothing signed, nothing sent. The checked copy is fully specified (chainId,
  // type, nonce, gas, fees) and is exactly what sendTransaction receives, so the send does not re-fill different values.
  let viemSendRequest = null;
  if (transport.kind === TRANSPORT_KIND.VIEM_SEND) {
    order.push("sign");
    try {
      const toSign = signingCopy(await transport.walletClient.prepareTransactionRequest({ account: transport.account, ...tx }));
      const signProblem = preparedSignProblem(toSign);
      if (signProblem) return blocked("sign", signProblem);
      viemSendRequest = toSign;
    } catch {
      return blocked("sign", "sign_failed");
    }
  }

  // Compat transports: the hash exists only once the send returns.
  order.push("broadcast");
  let hash;
  try {
    if (transport.kind === TRANSPORT_KIND.VIEM_SEND) {
      if (!viemSendRequest) return blocked("sign", "presign_check_missing");
      hash = await transport.walletClient.sendTransaction({ ...viemSendRequest, account: transport.account });
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
