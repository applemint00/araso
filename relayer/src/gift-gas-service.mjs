// [A-869] Gift gas delivery service core. Transport-agnostic and NOT wired to server.mjs / api / app.
// chain + signer are injected (fake in tests). This module never reads env or keys.
//
// Flow per new giftId (all inside one in-process queue = single nonce writer):
//   policy -> existing-entry? -> relayer-wide checks (gas price, balance, nonce) -> chain gift check
//   -> ledger.reserve (durable, caps inside the lock) -> SIGN -> verify bytes -> ledger.recordSigned
//   (durable rawTx+nonce+txHash) -> ONLY THEN broadcast -> receipt check -> confirm.
// A given nonce is signed at most once. Ambiguity (nonce consumed elsewhere, revert, mismatch) => UNKNOWN,
// never an automatic re-sign. SENT after a crash is only ever re-broadcast with the SAME stored rawTx.
//
// chain interface (all async):
//   getGift(giftId) -> { exists, claimed, refunded, expired, sender, amountWei }  (expiry from chain time/blocks)
//   getBalance(addr) -> bigint        getPendingNonce(addr) / getLatestNonce(addr) -> bigint
//   getGasPrice() -> bigint           broadcast(rawTx) -> txHash   (same bytes twice must be harmless)
//   getReceipt(txHash) -> null | { status: "success"|"reverted", from, to, value, input }
// signer: { signNativeTransfer({to,valueWei,nonce,gasLimit,gasPrice,chainId}) -> { rawTx, txHash } }
//
// Responses are uniform so a caller cannot enumerate gifts: unknown / claimed / refunded / expired / bound to
// another destination / over a cap / below minimum all return the SAME 409 not_available.
// Caller authentication is NOT in this module (Owner gate); handle() must only be reached by an authenticated route.

import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { validateGiftGasRequest, deriveValueWei } from "./gift-gas-policy.mjs";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NA = () => ({ status: 409, body: { ok: false, error: "not_available" } });
const BAD = () => ({ status: 400, body: { ok: false, error: "bad_request" } });
const UNAVAIL = () => ({ status: 503, body: { ok: false, error: "unavailable" } });
// [A-895 P-B] 503 emitted ONLY on paths before ledger.reserve: nothing reserved, nothing signed, nothing broadcast. The client
// may release its local ledger entry on this exact body; every other 503 (UNAVAIL) stays ambiguous.
const UNAVAIL_NOT_SENT = () => ({ status: 503, body: { ok: false, error: "unavailable_not_sent" } });

const lc = (s) => String(s).toLowerCase();
const short = (g) => `${String(g).slice(0, 10)}…`;
const isEmptyInput = (i) => i === undefined || i === null || i === "0x" || i === "";

export function createGiftGasService({ ledger, policy, chain, signer, log = () => {} }) {
  // log only fixed codes + short giftId prefix. Never rawTx, tokens, keys, error bodies.
  const say = (code, giftId) => { try { log(`gift-gas ${code}${giftId ? ` ${short(giftId)}` : ""}`); } catch { /* logger must not break flow */ } };
  const relayer = policy ? policy.relayerAddress : null;

  // valueWei in the body is the ledger entry's value = exactly the value that was reserved, signed (verifySigned checks
  // t.value === valueWei) and broadcast. [A-895 P-B] It is the single amount authority the client checks against its bound.
  const record = (e) => ({ status: 200, body: { ok: true, state: e.state, giftId: e.giftId, to: e.to, valueWei: e.valueWei, txHash: e.txHash } });

  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.then(() => {}, () => {});
    return run;
  };

  function receiptMatches(e, r) {
    return r && r.status === "success" && lc(r.from) === relayer && lc(r.to) === e.to
      && (() => { try { return BigInt(r.value) === BigInt(e.valueWei); } catch { return false; } })()
      && isEmptyInput(r.input);
  }

  /** One reconcile step for a SENT entry. Same-bytes rebroadcast only; never signs. Returns the fresh entry. */
  async function progress(giftId, { rebroadcast }) {
    let e = ledger.get(giftId);
    if (!e || e.state !== "SENT") return e;
    let r;
    try { r = await chain.getReceipt(e.txHash); } catch { say("receipt_lookup_failed", giftId); return e; }
    if (r) {
      if (receiptMatches(e, r)) { ledger.confirm(giftId, e.txHash); say("confirmed", giftId); }
      else { ledger.markUnknown(giftId, r.status === "success" ? "receipt_mismatch" : "reverted"); say("unknown_receipt", giftId); }
      return ledger.get(giftId);
    }
    let latest;
    try { latest = await chain.getLatestNonce(relayer); } catch { say("nonce_lookup_failed", giftId); return e; }
    if (BigInt(latest) > BigInt(e.nonce)) {
      // nonce consumed but our tx has no receipt: possibly another tx. Human decision, no re-sign.
      ledger.markUnknown(giftId, "nonce_consumed");
      say("unknown_nonce_consumed", giftId);
      return ledger.get(giftId);
    }
    if (rebroadcast) {
      try { await chain.broadcast(e.rawTx); say("rebroadcast_same_bytes", giftId); } catch { say("rebroadcast_failed", giftId); }
    }
    return ledger.get(giftId);
  }

  async function verifySigned(signed, { to, valueWei, nonce }) {
    if (!signed || typeof signed.rawTx !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signed.rawTx)) return null;
    const rawTx = signed.rawTx.toLowerCase();
    try {
      if (keccak256(rawTx) !== lc(signed.txHash)) return null;
      const t = parseTransaction(rawTx);
      if (t.type !== "legacy" && t.type !== "eip1559") return null;
      if (!t.to || lc(t.to) !== to) return null;
      if (BigInt(t.value ?? 0n) !== valueWei) return null;
      if (t.nonce === undefined || BigInt(t.nonce) !== nonce) return null;
      if (t.chainId !== policy.chainId) return null;
      if (!isEmptyInput(t.data)) return null;
      if (t.accessList && t.accessList.length > 0) return null;
      if (t.authorizationList && t.authorizationList.length > 0) return null;
      if (t.gas === undefined || BigInt(t.gas) <= 0n || BigInt(t.gas) > policy.gasLimit) return null;
      const fees = t.type === "legacy" ? [t.gasPrice] : [t.maxFeePerGas, t.maxPriorityFeePerGas];
      for (const f of fees) if (f === undefined || BigInt(f) > policy.maxGasPriceWei) return null;
      // must be signed by the relayer key (unsigned / foreign-signed bytes are refused)
      const signer0 = await recoverTransactionAddress({ serializedTransaction: rawTx });
      if (lc(signer0) !== relayer) return null;
    } catch { return null; }
    return { rawTx, txHash: lc(signed.txHash) };
  }

  async function processNew({ giftId, to }) {
    // relayer-wide checks first: independent of giftId, so their failures leak nothing about a gift
    const valueWei = deriveValueWei(policy);
    let gasPrice; let nonce;
    try {
      gasPrice = BigInt(await chain.getGasPrice());
      if (gasPrice > policy.maxGasPriceWei) { say("gas_price_over_cap"); return UNAVAIL_NOT_SENT(); }
      const bal = BigInt(await chain.getBalance(relayer));
      if (bal < valueWei + policy.gasLimit * gasPrice + policy.relayerMinBalanceWei) { say("relayer_balance_low"); return UNAVAIL_NOT_SENT(); }
      const chainNonce = BigInt(await chain.getPendingNonce(relayer));
      const ledgerNonce = ledger.nextSafeNonce();
      nonce = chainNonce > ledgerNonce ? chainNonce : ledgerNonce;
    } catch { say("chain_read_failed"); return UNAVAIL_NOT_SENT(); }

    let g;
    try { g = await chain.getGift(giftId); } catch { say("gift_lookup_failed", giftId); return UNAVAIL_NOT_SENT(); }
    const sender = g && typeof g.sender === "string" && ADDR.test(g.sender) ? lc(g.sender) : null;
    if (!g || g.exists !== true || g.claimed !== false || g.refunded !== false || g.expired !== false || sender === null
      || typeof g.amountWei !== "bigint" || g.amountWei < policy.minGiftWei
      || sender === to || sender === relayer || to === relayer) { say("refused_precheck", giftId); return NA(); }

    try {
      ledger.reserve(giftId, to, valueWei, sender, policy.limits);
    } catch (err) {
      const m = String(err?.message ?? "");
      if (/^LEDGER_(LIMIT_|GIFT_ALREADY_RESERVED)/.test(m)) { say("refused_cap_or_dup", giftId); return NA(); }
      say("reserve_failed", giftId); return UNAVAIL();
    }

    let signed;
    try { signed = await signer.signNativeTransfer({ to, valueWei, nonce, gasLimit: policy.gasLimit, gasPrice, chainId: policy.chainId }); }
    catch { signed = null; }
    const ok = await verifySigned(signed, { to, valueWei, nonce });
    if (!ok) {
      try { ledger.markUnknown(giftId, "sign_failed"); } catch { /* failstop: stays PENDING on disk */ }
      say("sign_failed", giftId); return UNAVAIL();
    }

    try { ledger.recordSigned(giftId, { nonce, rawTx: ok.rawTx, txHash: ok.txHash }); }
    catch { say("record_signed_failed", giftId); return UNAVAIL(); } // NOT durable => NO broadcast

    try { await chain.broadcast(ok.rawTx); say("broadcast", giftId); }
    catch { say("broadcast_failed", giftId); } // stays SENT: same bytes can be re-broadcast later
    const e = await progress(giftId, { rebroadcast: false });
    return record(e);
  }

  async function processRequest(v) {
    if (ledger.isFailStopped()) { say("ledger_failstopped"); return UNAVAIL_NOT_SENT(); }
    if (!policy) { say("policy_unset"); return UNAVAIL_NOT_SENT(); }
    let e;
    try { e = ledger.get(v.giftId); } catch { return UNAVAIL_NOT_SENT(); }
    if (e) {
      if (e.to !== v.to) return NA();
      if (e.state === "SENT") e = (await progress(v.giftId, { rebroadcast: true })) ?? e;
      return record(e);
    }
    return processNew(v);
  }

  return {
    /** body = untrusted request. Returns { status, body }. */
    handle: (body) => {
      const v = validateGiftGasRequest(body);
      if (!v.ok) return Promise.resolve(BAD());
      return enqueue(async () => {
        try { return await processRequest(v); } catch { say("internal_error", v.giftId); return UNAVAIL(); }
      });
    },
    /** Startup: only SENT entries are advanced (same-bytes rebroadcast / receipt check). PENDING/UNKNOWN untouched. */
    recover: () => enqueue(async () => {
      if (ledger.isFailStopped()) { say("ledger_failstopped"); return { failStopped: true, status: 503, sent: 0, confirmed: 0, unknown: 0, pending: 0, rebroadcast: 0 }; }
      const out = { sent: 0, confirmed: 0, unknown: 0, pending: 0, rebroadcast: 0 };
      for (const e of ledger.list()) {
        if (e.state === "PENDING") { out.pending += 1; continue; }
        if (e.state !== "SENT") continue;
        out.sent += 1;
        const after = await progress(e.giftId, { rebroadcast: true });
        if (after.state === "CONFIRMED") out.confirmed += 1;
        else if (after.state === "UNKNOWN") out.unknown += 1;
      }
      return out;
    }),
    /** Operator-invoked, explicit: UNKNOWN with a recorded txHash whose on-chain receipt verifies -> CONFIRMED. */
    resolveUnknown: (giftId) => enqueue(async () => {
      if (ledger.isFailStopped()) return false;
      const e = ledger.get(giftId);
      if (!e || e.state !== "UNKNOWN" || !e.txHash) return false;
      let r;
      try { r = await chain.getReceipt(e.txHash); } catch { return false; }
      if (!receiptMatches(e, r)) return false;
      ledger.resolveUnknownToConfirmed(giftId, e.txHash);
      return true;
    }),
  };
}
