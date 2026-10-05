// [A-711 W1] ISSUANCE AUTHORITY CLIENT GATE — the smallest fail-closed client side of the A-700 / A-708 design.
//
// STATUS: PAPER / LOCAL. This file talks to NOTHING. No network, no RPC, no provider, no key, no address, no
// contract. It only (a) validates an injected authority object, (b) bounds its calls in time, and (c) judges the
// evidence it hands back. main.js ships the authority config as `null`; with null, a live-scope issuance refuses
// before the passkey prompt. A real adapter (viem reads + a funded submitter) is a separate card + release GO.
//
// What the authority is (A-700 minimum authority, A-708 registry): ONE write-once, set-if-absent registry per chain.
// `register(piggy, purpose)` reverts if `piggy` is already registered and emits Registered(piggy, purpose, block) once.
// The local index (localStorage) is a cache and NEVER an authority: it cannot say "issued", and it cannot say "free".
//
// Client rules (A-708 WRITER_NOTES R0-R4, A-708 REVIEW M-2). The integration lives in piggy-index.js
// (admitIssuedPiggy); this module supplies the pieces:
//   R0  pin first      preflight() must say { ok:true } for the pinned registry (address + runtime codehash) —
//                      otherwise REFUSE BEFORE requestPrf. null / unreachable / throws / times out / anything but an
//                      exact ok:true  ==  refuse. Zero local writes.
//   R1  skip, adopt 0  isIssued(addr_n) === true  ->  burn n, refuse. An already-registered address is NEVER this
//                      attempt's success, whatever its purpose is. isIssued() can only ever REFUSE; it can never
//                      make an attempt succeed.
//   R2  own event only SUCCESS = the receipt of OUR OWN submitted tx hash, finalized, status 1, with EXACTLY ONE log
//                      emitted by the pinned registry, and that log is Registered(addr_n, purpose_n). Everything
//                      else — reverted, lost race, silent success, someone else's tx, not final, timeout, thrown —
//                      is a refusal, and the attempt burns n. NEVER a success signal: a registry view read of the
//                      address, a log-filter query, or any event found by searching (A-708 REVIEW M-2). This module
//                      contains no such read on purpose; a source test pins that.
//   R4  registry only  nothing in localStorage is consulted to decide "issued".
//
// Interface the injected authority must have (all fields required; unknown extra fields are ignored):
//   {
//     interfaceVersion: 1,
//     chainScope:       "monad-mainnet"            // must equal the index chain id this admission runs on
//     registryAddress:  "0x…40 hex"                // the pinned per-chain registry (config, not invented here)
//     async preflight()            -> { ok: true, registryAddress }     // R0: reachable + address + codehash verified
//     async isIssued(address)      -> boolean                           // R1 view; may only refuse
//     async register({ address, purpose, sequence, chainScope })
//         -> { outcome: "not_submitted", reason }                       // nothing was sent
//          | { outcome: "submitted", txHash, receipt }                  // OUR OWN tx; judged by verifyOwnRegistration
//   }
//   register() may throw: after a possible submission that is AMBIGUOUS (refuse + burn n).
//   receipt = { transactionHash, status (1 | "0x1" | "success"), finalized: true, to?, logs: [{ address, topics, data? }] }
//   `finalized` is the adapter's claim that the chain-specific finality depth (A-708 U1/L-3, UNKNOWN per chain, to be
//   pinned by the adapter card) was reached. This gate only refuses a receipt that does not say `finalized === true`.

export const ISSUANCE_AUTHORITY_INTERFACE_VERSION = 1;

// keccak256("plus") — purpose of an ordinary +Piggy (A-708 README). Pinned literal; the A-711 test recomputes it.
export const PLUS_PURPOSE = "0x36979e2b981adc4b52133616a4665dbb76993a0cc78fa3d0ba207eb994e1568f";
// topic0 of Registered(address indexed piggy, bytes32 indexed purpose, uint256 blockNumber). Pinned literal; the test recomputes it.
export const REGISTERED_TOPIC0 = "0xb7f299e98a5f1a10cac6f9de415eb1bcaa2a60a33cc22c24d2e334c8870ad26b";

export const ISSUANCE_PURPOSE_KIND = Object.freeze({ PLUS: "plus", GIFT: "gift" });

// Refusal reasons returned as `reason` by the admission path (also the only strings that reach state.addPiggy.reason).
export const ISSUANCE_REFUSAL = Object.freeze({
  UNCONFIGURED: "issuance_authority_unconfigured",         // required (live scope) but no authority injected
  INVALID: "issuance_authority_invalid",                   // injected object has the wrong shape / version / registry pin
  CHAIN_MISMATCH: "issuance_authority_chain_mismatch",     // authority.chainScope !== index chain id
  UNREACHABLE: "issuance_authority_unreachable",           // preflight/isIssued threw, timed out, or answered non-boolean
  NOT_READY: "issuance_authority_not_ready",               // preflight answered, but not an exact ok:true for the pinned registry
  PURPOSE_INVALID: "issuance_purpose_invalid",
  SEQUENCE_REGISTERED: "issuance_sequence_registered",     // addr_n already registered (R1) -> n burned, never adopted
  NOT_SUBMITTED: "issuance_not_submitted",                 // adapter sent nothing
  REGISTRATION_UNVERIFIED: "issuance_registration_unverified", // not our own finalized status-1 receipt with exactly one matching log -> n burned
  REGISTRATION_AMBIGUOUS: "issuance_registration_ambiguous",   // register() threw / timed out after a possible submission -> n burned
});

export const AUTHORITY_PREFLIGHT_TIMEOUT_MS = 8_000;
// Submission + finality can legitimately take a while; the exclusive admission lock is held for this long at most.
export const AUTHORITY_REGISTER_TIMEOUT_MS = 180_000;

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

/**
 * Purpose of this issuance as a bytes32. null/undefined/{kind:"plus"} -> keccak256("plus").
 * {kind:"gift", giftId} -> the giftId itself (a bytes32 in this app; bytes32(0) is the registry's "unset", refused).
 * Anything else -> error. (A-708 U4: whether a giftId may be public on-chain is an Owner/product decision; UNKNOWN here.)
 */
export function resolveIssuancePurpose(purpose) {
  if (purpose === null || purpose === undefined) return { purpose: PLUS_PURPOSE, kind: ISSUANCE_PURPOSE_KIND.PLUS, error: null };
  if (typeof purpose !== "object" || Array.isArray(purpose)) return { purpose: null, kind: null, error: ISSUANCE_REFUSAL.PURPOSE_INVALID };
  if (purpose.kind === ISSUANCE_PURPOSE_KIND.PLUS) return { purpose: PLUS_PURPOSE, kind: ISSUANCE_PURPOSE_KIND.PLUS, error: null };
  if (purpose.kind === ISSUANCE_PURPOSE_KIND.GIFT) {
    const id = typeof purpose.giftId === "string" ? purpose.giftId : "";
    if (!BYTES32.test(id) || /^0x0{64}$/.test(id)) return { purpose: null, kind: null, error: ISSUANCE_REFUSAL.PURPOSE_INVALID };
    return { purpose: id.toLowerCase(), kind: ISSUANCE_PURPOSE_KIND.GIFT, error: null };
  }
  return { purpose: null, kind: null, error: ISSUANCE_REFUSAL.PURPOSE_INVALID };
}

/** Shape check of an injected authority against the index chain id. Pure, no calls. */
export function validateIssuanceAuthority(authority, chainId) {
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) return { ok: false, reason: ISSUANCE_REFUSAL.INVALID };
  if (authority.interfaceVersion !== ISSUANCE_AUTHORITY_INTERFACE_VERSION) return { ok: false, reason: ISSUANCE_REFUSAL.INVALID };
  if (typeof authority.preflight !== "function" || typeof authority.isIssued !== "function" || typeof authority.register !== "function") {
    return { ok: false, reason: ISSUANCE_REFUSAL.INVALID };
  }
  if (!ADDR.test(authority.registryAddress || "") || /^0x0{40}$/.test(authority.registryAddress)) return { ok: false, reason: ISSUANCE_REFUSAL.INVALID };
  if (typeof authority.chainScope !== "string" || authority.chainScope === "" || authority.chainScope !== chainId) {
    return { ok: false, reason: ISSUANCE_REFUSAL.CHAIN_MISMATCH };
  }
  return { ok: true, reason: null };
}

/** Rejects (never resolves late) when `ms` passes. The timer is always cleared. */
function withDeadline(run, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("authority_timeout")), ms); });
  let call;
  try { call = Promise.resolve(run()); } catch (err) { call = Promise.reject(err); }
  return Promise.race([call, timeout]).finally(() => { if (timer !== null) clearTimeout(timer); });
}

/**
 * R0. Resolves { ok:true } ONLY for an answer that is exactly { ok:true, registryAddress == the pinned one }.
 * Throw / timeout -> UNREACHABLE. Any other answer -> NOT_READY. No retries, no fallbacks, no second provider.
 */
export async function preflightIssuanceAuthority(authority, { timeoutMs = AUTHORITY_PREFLIGHT_TIMEOUT_MS } = {}) {
  let answer;
  try {
    answer = await withDeadline(() => authority.preflight(), timeoutMs);
  } catch {
    return { ok: false, reason: ISSUANCE_REFUSAL.UNREACHABLE };
  }
  if (!answer || answer.ok !== true || lower(answer.registryAddress) !== lower(authority.registryAddress)) {
    return { ok: false, reason: ISSUANCE_REFUSAL.NOT_READY };
  }
  return { ok: true, reason: null };
}

/**
 * R1. issued:true = already registered (burn + refuse). issued:false = free (continue to R2; this does NOT make
 * anything succeed). Throw / timeout / non-boolean -> UNREACHABLE (refuse; n is not burned: nothing is known).
 */
export async function queryIssued(authority, address, { timeoutMs = AUTHORITY_PREFLIGHT_TIMEOUT_MS } = {}) {
  let issued;
  try {
    issued = await withDeadline(() => authority.isIssued(address), timeoutMs);
  } catch {
    return { ok: false, issued: null, reason: ISSUANCE_REFUSAL.UNREACHABLE };
  }
  if (issued !== true && issued !== false) return { ok: false, issued: null, reason: ISSUANCE_REFUSAL.UNREACHABLE };
  return { ok: true, issued, reason: null };
}

const topicOfAddress = (address) => `0x${"0".repeat(24)}${lower(address).slice(2)}`;
const isSuccessStatus = (status) => status === 1 || status === "0x1" || status === "0x01" || status === "success";

/**
 * R2 / M-2. Judges the evidence of ONE attempt. Pure. Everything is bound to OUR tx hash: receipt.transactionHash ===
 * txHash, status success, finalized === true, and EXACTLY ONE log emitted by the pinned registry, being
 * Registered(address, purpose). Logs from other emitters are ignored; a second registry log, a different topic0, a
 * different piggy or a different purpose is a refusal. No registry view and no log search is an input here.
 */
export function verifyOwnRegistration(submitted, { registryAddress, address, purpose } = {}) {
  const bad = (why) => ({ ok: false, reason: ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED, why });
  if (!ADDR.test(registryAddress || "") || !ADDR.test(address || "") || !BYTES32.test(purpose || "")) return bad("bad_expectation");
  if (!submitted || typeof submitted !== "object") return bad("no_evidence");
  const txHash = submitted.txHash;
  const receipt = submitted.receipt;
  if (!BYTES32.test(txHash || "")) return bad("no_own_tx_hash");
  if (!receipt || typeof receipt !== "object") return bad("no_receipt");
  if (lower(receipt.transactionHash) !== lower(txHash)) return bad("receipt_not_own_tx");   // someone else's tx
  if (!isSuccessStatus(receipt.status)) return bad("status_not_success");                    // reverted (lost race / taken)
  if (receipt.finalized !== true) return bad("not_finalized");
  if (receipt.to !== undefined && receipt.to !== null && lower(receipt.to) !== lower(registryAddress)) return bad("receipt_to_not_registry");
  if (!Array.isArray(receipt.logs)) return bad("no_logs");
  const fromRegistry = receipt.logs.filter((l) => l && typeof l === "object" && lower(l.address) === lower(registryAddress));
  if (fromRegistry.length !== 1) return bad(fromRegistry.length === 0 ? "no_registry_log" : "multiple_registry_logs");
  const topics = Array.isArray(fromRegistry[0].topics) ? fromRegistry[0].topics.map(lower) : [];
  if (topics.length !== 3) return bad("log_shape");
  if (topics[0] !== REGISTERED_TOPIC0) return bad("log_not_registered_event");
  if (topics[1] !== topicOfAddress(address)) return bad("log_other_piggy");
  if (topics[2] !== lower(purpose)) return bad("log_other_purpose");
  return { ok: true, reason: null, why: null, txHash: lower(txHash) };
}

/**
 * Calls register() once, bounded in time, and classifies. Never retries.
 *   { ok:true }                        -> own, finalized, status 1, exactly one matching log
 *   { ok:false, burn:false, reason }   -> adapter sent nothing (NOT_SUBMITTED)
 *   { ok:false, burn:true,  reason }   -> possible/actual submission without a verified own result: n is burned
 */
export async function registerWithAuthority(authority, { address, purpose, sequence, chainScope }, { timeoutMs = AUTHORITY_REGISTER_TIMEOUT_MS } = {}) {
  let out;
  try {
    out = await withDeadline(() => authority.register(Object.freeze({ address, purpose, sequence, chainScope })), timeoutMs);
  } catch {
    return { ok: false, burn: true, reason: ISSUANCE_REFUSAL.REGISTRATION_AMBIGUOUS };
  }
  if (out && out.outcome === "not_submitted") return { ok: false, burn: false, reason: ISSUANCE_REFUSAL.NOT_SUBMITTED };
  if (!out || out.outcome !== "submitted") return { ok: false, burn: true, reason: ISSUANCE_REFUSAL.REGISTRATION_AMBIGUOUS };
  const verdict = verifyOwnRegistration(out, { registryAddress: authority.registryAddress, address, purpose });
  if (!verdict.ok) return { ok: false, burn: true, reason: verdict.reason };
  return { ok: true, burn: false, reason: null, txHash: verdict.txHash };
}
