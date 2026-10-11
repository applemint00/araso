// [A-906] Gift claim via EIP-7702 sponsor-submit — app guards, signing session, request builder. LOCAL, default OFF.
//
// The receiving Gift Piggy only SIGNS (one Face ID step): (1) a 7702 authorization to the verified MetaMask
// EIP7702StatelessDeleGator and (2) ONE single-use delegation for the Gift escrow's commitClaim. Our sponsor submits
// DelegationManager.redeemDelegations and pays gas; claim() is a plain sponsor tx (permissionless in msg.sender, A-814
// REVIEW_SECURITY finding 8). The Piggy needs 0 MON. Ported from the A-814 harness
// (a814-mera-metamask-7702-testnet {lib,partf}.mjs): guardedSignAuthorization, caveat encodings, EIP-712 types.
//
// Everything here is FAIL-CLOSED: any unknown, missing, extra, or mismatched field refuses. Pure functions return
// { ok:false, reason } and never throw. Nothing here touches the network except the injected `readCode`.
//
// UNKNOWN (never invented): the expiry window length. It is the injected `expirySeconds`; missing => refuse.
// UNKNOWN: TimestampEnforcer runtime code hash (address from the official v1.3.0 Deployments.md only; see receipt).
//
// The relayer mirrors these guard functions server-side (relayer must import or copy this exact logic): see
// the A-906 gift sponsor adopt receipt (INTERFACE.md).

import {
  decodeAbiParameters, encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, hexToBigInt,
  keccak256, recoverTypedDataAddress, size, slice,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const B32_RE = /^0x[0-9a-fA-F]{64}$/;
const SIG65_RE = /^0x[0-9a-fA-F]{130}$/;
const UINT_DEC_RE = /^(0|[1-9][0-9]{0,77})$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

// Official MetaMask delegation-framework v1.3.0 (A-814 PREFLIGHT §1: provenance + CREATE2 reproduction + masked runtime equality).
export const GIFT_SPONSOR_PINS = Object.freeze({
  delegationManager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  statelessDelegate: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B", // EIP7702StatelessDeleGatorImpl
  exactExecutionEnforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
  limitedCallsEnforcer: "0x04658B29F6b82ed55274221a06Fc97D318E25416",
  timestampEnforcer: "0x1046bb45C8d673d4ea75321280DB34899413c069", // Deployments.md only; code hash UNKNOWN (not pinned)
  root: `0x${"f".repeat(64)}`,
  mode: `0x${"0".repeat(64)}`, // single / default exec mode
  // Runtime-code keccak per Monad chain (immutables differ between chains, so DM and the impl differ).
  // 10143: PREFLIGHT §1 table. 143: A-814 Part F raw/partf_fork.json official_code (fork of mainnet 143).
  codeHash: Object.freeze({
    10143: Object.freeze({
      delegationManager: "0x292b39ef44a63d81e9a8080b185a5449ed4b8ce74436177ca8f475fefd78807b",
      statelessDelegate: "0x399646560cadf8e8f30b232c75d0be4e629939b4eba8019589c6d0d4b69ff9f9",
      exactExecutionEnforcer: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e",
      limitedCallsEnforcer: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468",
    }),
    143: Object.freeze({
      delegationManager: "0x85674a6f4a65e3b61df3b6d45a89f2bf6165efda91a83610b797ff917f64866f",
      statelessDelegate: "0xd4dee59ae6be4a997964e8f19ae6905f0a233c6ae88d9bc5d945bc60738376c1",
      exactExecutionEnforcer: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e",
      limitedCallsEnforcer: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468",
      // FORK-READ (A-906 fork_e2e.json fork_code.timestampEnforcer, anvil fork of mainnet 143), same value the relayer pins. Not a live read.
      // 10143 TimestampEnforcer hash: UNKNOWN (not in the A-814 artifacts) => absent => a 10143 session refuses at the code check only
      // for the four pinned contracts; the Timestamp enforcer code on 10143 is therefore NOT hash-verified by the app (residual).
      timestampEnforcer: "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c",
    }),
    // [gift-fork] the shared mainnet fork (31337143) copies 143's state, so its row = the 143 row value for value (the fork's code was read
    // against the 143 row in the local fork run: ok). A row of its own, so 143 / 10143 lookups are unchanged and the fork never answers as 143.
    31337143: Object.freeze({
      delegationManager: "0x85674a6f4a65e3b61df3b6d45a89f2bf6165efda91a83610b797ff917f64866f",
      statelessDelegate: "0xd4dee59ae6be4a997964e8f19ae6905f0a233c6ae88d9bc5d945bc60738376c1",
      exactExecutionEnforcer: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e",
      limitedCallsEnforcer: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468",
      timestampEnforcer: "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c",
    }),
  }),
});
// [A-913 C] Delegation expiry cap = the A-556 Piggy signer 5-minute session cap, reused (not a new number). Internal security value, never shown in UI.
export const GIFT_SPONSOR_MAX_EXPIRY_SECONDS = 300;
/**
 * [A-913 C] Timestamp `before` the app signs = min(now + 300, gift deadline); `after` is always 0 (buildTimestampTerms).
 * A missing/invalid deadline or one not strictly after `now` refuses (no default). `capSeconds` can only LOWER the cap.
 */
export function giftSponsorExpiryBefore({ nowSeconds, giftDeadlineSeconds, capSeconds = GIFT_SPONSOR_MAX_EXPIRY_SECONDS } = {}) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) return refuse(R.CONFIG_INVALID);
  if (!Number.isSafeInteger(capSeconds) || capSeconds <= 0) return refuse(R.EXPIRY_UNKNOWN);
  if (!Number.isSafeInteger(giftDeadlineSeconds) || giftDeadlineSeconds <= nowSeconds) return refuse(R.GIFT_DEADLINE_INVALID);
  return { ok: true, before: Math.min(nowSeconds + Math.min(capSeconds, GIFT_SPONSOR_MAX_EXPIRY_SECONDS), giftDeadlineSeconds) };
}

/**
 * [A-913 E] Chain-truth reconcile table (README "Gift 7702 위임 안전 모델" 3). Pure. Returns ONLY the next certain step.
 * truth = { installed, commitExists, claimed, delegationDisabled, expired, sendUncertain } — booleans; null/undefined = unknown.
 * Unknown needed fields, or a send that may have landed, => "read_receipt_first" (never resend).
 */
export const GIFT_SPONSOR_STEP = Object.freeze({
  READ_RECEIPT_FIRST: "read_receipt_first", START_OVER: "start_over", CONTINUE_COMMIT: "continue_commit",
  REVOKE_THEN_WAIT_FACE_ID: "revoke_then_wait_face_id", REVOKE_THEN_CLAIM: "revoke_then_claim", CLAIM: "claim",
  REVOKE_CLEANUP: "revoke_cleanup", DONE: "done",
});
export function giftSponsorNextStep(truth) {
  const S = GIFT_SPONSOR_STEP;
  const t = truth && typeof truth === "object" ? truth : {};
  const known = (k) => t[k] === true || t[k] === false;
  if (t.sendUncertain !== false) return S.READ_RECEIPT_FIRST; // true OR unknown: a possible in-flight send is never repeated
  if (!known("installed") || !known("commitExists") || !known("claimed")) return S.READ_RECEIPT_FIRST;
  const live = t.installed === true && t.delegationDisabled === false;
  if ((t.commitExists || t.claimed) && t.installed === true && !known("delegationDisabled")) return S.READ_RECEIPT_FIRST;
  if (t.claimed) return live ? S.REVOKE_CLEANUP : S.DONE;
  if (t.commitExists) return live ? S.REVOKE_THEN_CLAIM : S.CLAIM;
  if (!t.installed) return S.START_OVER;
  if (!known("expired")) return S.READ_RECEIPT_FIRST;
  return t.expired ? S.REVOKE_THEN_WAIT_FACE_ID : S.CONTINUE_COMMIT;
}

export const GIFT_SPONSOR_CHAINS = Object.freeze([10143, 143, 31337143]); // Monad testnet, Monad mainnet, [A-946] the shared mainnet fork (own id = funding-context FORK_CHAIN_ID, pinned by the a946 test; never 143). Never 0, never other.

export const GIFT_SPONSOR_REFUSAL = Object.freeze({
  CONFIG_INVALID: "config_invalid",
  EXPIRY_UNKNOWN: "expiry_seconds_missing",
  CHAIN_ID_INVALID: "chain_id_invalid",
  AUTH_SHAPE: "authorization_shape",
  AUTH_CHAIN_ID: "authorization_chain_id",
  AUTH_DELEGATE: "authorization_delegate_not_pinned",
  AUTH_NONCE: "authorization_nonce",
  AUTH_SIGNER: "authorization_signer_mismatch",
  CODE_UNVERIFIED: "pinned_code_unverified",
  CODE_HASH_MISMATCH: "pinned_code_hash_mismatch",
  DELEGATION_SHAPE: "delegation_shape",
  DELEGATE_NOT_SPONSOR: "delegation_delegate_not_sponsor",
  DELEGATOR_MISMATCH: "delegation_delegator_mismatch",
  AUTHORITY_NOT_ROOT: "delegation_authority_not_root",
  CAVEATS_SHAPE: "delegation_caveats_shape",
  ENFORCER_NOT_PINNED: "delegation_enforcer_not_pinned",
  EXEC_TARGET: "delegation_exec_target",
  EXEC_VALUE: "delegation_exec_value",
  EXEC_METHOD: "delegation_exec_method",
  EXEC_CALLDATA: "delegation_exec_calldata",
  LIMIT_NOT_ONE: "delegation_limit_not_one",
  EXPIRY_INVALID: "delegation_expiry_invalid",
  SIGNATURE_INVALID: "delegation_signature_invalid",
  GIFT_ID: "gift_id_invalid",
  REQUEST_SHAPE: "request_shape",
  SECOND_SIGNATURE: "second_signature_request",
  SIGNER_UNAVAILABLE: "signer_unavailable",
  SIGN_FAILED: "sign_failed",
  NOT_READY: "session_not_ready",
  GIFT_DEADLINE_INVALID: "gift_deadline_invalid", // [A-913 C]
  REVOKE_AUTH_ADDRESS: "revoke_authorization_address_not_zero", // [A-913 D]
  REVOKE_AUTH_SIGNER: "revoke_authorization_signer_mismatch",
});
const R = GIFT_SPONSOR_REFUSAL;
const refuse = (reason) => ({ ok: false, reason });

export const COMMIT_CLAIM_ABI = Object.freeze([
  { type: "function", name: "commitClaim", inputs: [{ name: "giftId", type: "bytes32" }, { name: "commitHash", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
]);
const COMMIT_CLAIM_SELECTOR = "0xfa4185fa"; // A-814 Part F trace: commit frame input4
const DELEGATION_TYPES = Object.freeze({
  Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
  Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
});

const lc = (s) => String(s).toLowerCase();
const sameAddr = (a, b) => typeof a === "string" && typeof b === "string" && ADDR_RE.test(a) && ADDR_RE.test(b) && lc(a) === lc(b);
const ownKeysExactly = (o, keys) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));

function toSafeInt(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === "bigint") return v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
  return null;
}
function toUint256(v) {
  if (typeof v === "bigint") return v >= 0n && v <= MAX_UINT256 ? v : null;
  if (typeof v === "string" && UINT_DEC_RE.test(v)) { const b = BigInt(v); return b <= MAX_UINT256 ? b : null; }
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
}

// ── config ────────────────────────────────────────────────────────────────────────────────────────
// { chainId, escrowAddress, sponsorAddress, expirySeconds }  — all injected; none has a default; null/any gap => null.
export function normalizeGiftSponsorConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return refuse(R.CONFIG_INVALID);
  const allowed = ["chainId", "escrowAddress", "sponsorAddress", "expirySeconds", "skewSeconds"];
  if (Object.keys(config).some((k) => !allowed.includes(k))) return refuse(R.CONFIG_INVALID);
  const { chainId, escrowAddress, sponsorAddress, expirySeconds, skewSeconds = 0 } = config;
  if (!Number.isSafeInteger(chainId) || !GIFT_SPONSOR_CHAINS.includes(chainId)) return refuse(R.CHAIN_ID_INVALID); // 0 and others refused
  if (!ADDR_RE.test(String(escrowAddress || "")) || !ADDR_RE.test(String(sponsorAddress || ""))) return refuse(R.CONFIG_INVALID);
  if (/^0x0{40}$/i.test(escrowAddress) || /^0x0{40}$/i.test(sponsorAddress)) return refuse(R.CONFIG_INVALID);
  if (expirySeconds === undefined || expirySeconds === null) return refuse(R.EXPIRY_UNKNOWN); // Owner number UNKNOWN: never defaulted
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0) return refuse(R.EXPIRY_UNKNOWN);
  if (!Number.isSafeInteger(skewSeconds) || skewSeconds < 0) return refuse(R.CONFIG_INVALID);
  return { ok: true, config: Object.freeze({ chainId, escrowAddress: getAddress(escrowAddress), sponsorAddress: getAddress(sponsorAddress), expirySeconds, skewSeconds }) };
}

// ── pinned on-chain code (delegate address AND code hash) ─────────────────────────────────────────
/** `readCode(address) -> 0x… bytecode` is injected (eth_getCode). Any failure / mismatch refuses. */
export async function checkPinnedCode({ chainId, readCode } = {}) {
  const table = GIFT_SPONSOR_PINS.codeHash[chainId];
  if (!table) return refuse(R.CHAIN_ID_INVALID);
  if (typeof readCode !== "function") return refuse(R.CODE_UNVERIFIED);
  for (const name of Object.keys(table)) {
    let code;
    try { code = await readCode(GIFT_SPONSOR_PINS[name]); } catch { return refuse(R.CODE_UNVERIFIED); }
    if (typeof code !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(code)) return refuse(R.CODE_UNVERIFIED);
    if (keccak256(code) !== table[name]) return refuse(R.CODE_HASH_MISMATCH);
  }
  return { ok: true };
}

// ── EIP-7702 authorization ────────────────────────────────────────────────────────────────────────
const AUTH_KEYS = ["address", "chainId", "nonce", "r", "s", "yParity"];
/** Normalizes viem's SignedAuthorization (accepts `contractAddress` as an alias of `address`) to the exact tx shape. */
export function normalizeAuthorization(auth) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
  const a = { ...auth };
  if (a.contractAddress !== undefined) {
    if (a.address !== undefined && !sameAddr(a.address, a.contractAddress)) return null;
    a.address = a.address ?? a.contractAddress;
    delete a.contractAddress;
  }
  if (a.v !== undefined) { // viem returns { v, yParity } together: v must agree with yParity (27/28 or 0/1), then it is dropped
    const v = toSafeInt(a.v);
    const y = a.yParity === undefined ? undefined : toSafeInt(a.yParity);
    const vy = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : null;
    if (vy === null || (y !== undefined && y !== vy)) return null;
    a.yParity = vy;
    delete a.v;
  }
  return ownKeysExactly(a, AUTH_KEYS) ? a : null;
}
/** Pure. ctx: { chainId (gift's Monad chain), authNonce? (exact) }. Never accepts chainId 0 / any delegate. */
export function checkAuthorization(auth, { chainId, authNonce } = {}) {
  if (!GIFT_SPONSOR_CHAINS.includes(chainId)) return refuse(R.CHAIN_ID_INVALID);
  const a = normalizeAuthorization(auth);
  if (!a) return refuse(R.AUTH_SHAPE);
  const c = toSafeInt(a.chainId);
  if (c === null || c === 0 || c !== chainId) return refuse(R.AUTH_CHAIN_ID);
  if (!sameAddr(a.address, GIFT_SPONSOR_PINS.statelessDelegate)) return refuse(R.AUTH_DELEGATE);
  const n = toSafeInt(a.nonce);
  if (n === null || (authNonce !== undefined && n !== authNonce)) return refuse(R.AUTH_NONCE);
  if (!B32_RE.test(String(a.r)) || !B32_RE.test(String(a.s))) return refuse(R.AUTH_SHAPE);
  const y = toSafeInt(a.yParity);
  if (y !== 0 && y !== 1) return refuse(R.AUTH_SHAPE);
  return { ok: true, authorization: Object.freeze({ address: getAddress(a.address), chainId: c, nonce: n, r: a.r, s: a.s, yParity: y }) };
}
/**
 * [A-913 D] The REVOKE authorization the Piggy signs in the SAME Face ID session as the install authorization: delegate address 0x0 (clears the
 * 7702 designator), the Gift chain, nonce = install nonce + 1, same signer. Fail-closed exactly like checkAuthorization. Pure.
 * ctx: { chainId, authNonce } where authNonce = the INSTALL authorization's nonce n (required here: the revoke nonce is derived from it).
 */
export function checkRevokeAuthorization(auth, { chainId, authNonce } = {}) {
  if (!GIFT_SPONSOR_CHAINS.includes(chainId)) return refuse(R.CHAIN_ID_INVALID);
  if (!Number.isSafeInteger(authNonce) || authNonce < 0) return refuse(R.AUTH_NONCE);
  const a = normalizeAuthorization(auth);
  if (!a) return refuse(R.AUTH_SHAPE);
  const c = toSafeInt(a.chainId);
  if (c === null || c === 0 || c !== chainId) return refuse(R.AUTH_CHAIN_ID);
  if (!ADDR_RE.test(String(a.address)) || !/^0x0{40}$/i.test(a.address)) return refuse(R.REVOKE_AUTH_ADDRESS);
  if (toSafeInt(a.nonce) !== authNonce + 1) return refuse(R.AUTH_NONCE);
  if (!B32_RE.test(String(a.r)) || !B32_RE.test(String(a.s))) return refuse(R.AUTH_SHAPE);
  const y = toSafeInt(a.yParity);
  if (y !== 0 && y !== 1) return refuse(R.AUTH_SHAPE);
  return { ok: true, authorization: Object.freeze({ address: ZERO_ADDRESS, chainId: c, nonce: authNonce + 1, r: a.r, s: a.s, yParity: y }) };
}
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

/** Async: who signed the authorization (the future 7702 account). Server mirrors this. */
export async function recoverAuthorizationAuthority(authorization) {
  try { return getAddress(await recoverAuthorizationAddress({ authorization })); } catch { return null; }
}

// ── delegation: scope = Gift escrow only, commitClaim only, exact calldata for this giftId, one call, short expiry ──
export function buildCommitClaimCalldata({ giftId, commitHash }) {
  return encodeFunctionData({ abi: COMMIT_CLAIM_ABI, functionName: "commitClaim", args: [giftId, commitHash] });
}
export function buildExactExecutionTerms({ escrowAddress, giftId, commitHash }) {
  return encodePacked(["address", "uint256", "bytes"], [escrowAddress, 0n, buildCommitClaimCalldata({ giftId, commitHash })]);
}
export const buildLimitedCallsTerms = () => encodeAbiParameters([{ type: "uint256" }], [1n]);
/** TimestampEnforcer v1.3.0 terms = uint128 afterThreshold ‖ uint128 beforeThreshold (32 bytes). after = 0 (no lower bound). */
export function buildTimestampTerms({ beforeSeconds }) {
  return encodePacked(["uint128", "uint128"], [0n, BigInt(beforeSeconds)]);
}

const DELEGATION_KEYS = ["delegate", "delegator", "authority", "caveats", "salt", "signature"];
/**
 * Pure structural + semantic guard for the commitClaim delegation. Accepts ONLY:
 *   delegate = our sponsor · authority = ROOT · caveats = [ExactExecution, LimitedCalls(1), Timestamp(before)] exactly, in that order,
 *   ExactExecution terms = escrow ‖ 0 ‖ commitClaim(giftId, commitHash) byte-exact (no trailing bytes).
 * ctx: { chainId, giftId, escrowAddress, sponsorAddress, expirySeconds, nowSeconds, skewSeconds?, delegator?, commitHash?, requireSignature? }
 *   commitHash: app passes the one it computed; the relayer (which cannot know it) omits it and reads it back from the terms.
 */
export function checkDelegation(delegation, ctx = {}) {
  const { chainId, giftId, escrowAddress, sponsorAddress, expirySeconds, nowSeconds, skewSeconds = 0, delegator, commitHash, requireSignature = true } = ctx;
  if (!GIFT_SPONSOR_CHAINS.includes(chainId)) return refuse(R.CHAIN_ID_INVALID);
  if (!B32_RE.test(String(giftId || ""))) return refuse(R.GIFT_ID);
  if (!ADDR_RE.test(String(escrowAddress || "")) || !ADDR_RE.test(String(sponsorAddress || ""))) return refuse(R.CONFIG_INVALID);
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0) return refuse(R.EXPIRY_UNKNOWN);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0 || !Number.isSafeInteger(skewSeconds) || skewSeconds < 0) return refuse(R.CONFIG_INVALID);
  if (!ownKeysExactly(delegation, DELEGATION_KEYS)) return refuse(R.DELEGATION_SHAPE);
  if (!ADDR_RE.test(String(delegation.delegate)) || !ADDR_RE.test(String(delegation.delegator))) return refuse(R.DELEGATION_SHAPE);
  if (!sameAddr(delegation.delegate, sponsorAddress)) return refuse(R.DELEGATE_NOT_SPONSOR); // never ANY_DELEGATE, never another redeemer
  if (delegator !== undefined && !sameAddr(delegation.delegator, delegator)) return refuse(R.DELEGATOR_MISMATCH);
  if (lc(delegation.authority) !== GIFT_SPONSOR_PINS.root) return refuse(R.AUTHORITY_NOT_ROOT);
  const salt = toUint256(delegation.salt);
  if (salt === null) return refuse(R.DELEGATION_SHAPE);
  if (requireSignature && !SIG65_RE.test(String(delegation.signature))) return refuse(R.SIGNATURE_INVALID);
  const cv = delegation.caveats;
  if (!Array.isArray(cv) || cv.length !== 3) return refuse(R.CAVEATS_SHAPE);
  for (const c of cv) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return refuse(R.CAVEATS_SHAPE);
    const keys = Object.keys(c);
    if (!keys.every((k) => k === "enforcer" || k === "terms" || k === "args") || !("enforcer" in c) || !("terms" in c)) return refuse(R.CAVEATS_SHAPE);
    if ("args" in c && c.args !== "0x") return refuse(R.CAVEATS_SHAPE);
    if (!ADDR_RE.test(String(c.enforcer)) || !/^0x([0-9a-fA-F]{2})*$/.test(String(c.terms))) return refuse(R.CAVEATS_SHAPE);
  }
  if (!sameAddr(cv[0].enforcer, GIFT_SPONSOR_PINS.exactExecutionEnforcer)
    || !sameAddr(cv[1].enforcer, GIFT_SPONSOR_PINS.limitedCallsEnforcer)
    || !sameAddr(cv[2].enforcer, GIFT_SPONSOR_PINS.timestampEnforcer)) return refuse(R.ENFORCER_NOT_PINNED);

  // ExactExecution terms: target(20) ‖ value(32) ‖ calldata(4+32+32). Anything else is a different action.
  const t = cv[0].terms;
  if (size(t) !== 20 + 32 + 4 + 32 + 32) return refuse(R.EXEC_CALLDATA);
  if (!sameAddr(slice(t, 0, 20), escrowAddress)) return refuse(R.EXEC_TARGET);
  if (hexToBigInt(slice(t, 20, 52)) !== 0n) return refuse(R.EXEC_VALUE);
  if (lc(slice(t, 52, 56)) !== COMMIT_CLAIM_SELECTOR) return refuse(R.EXEC_METHOD);
  if (lc(slice(t, 56, 88)) !== lc(giftId)) return refuse(R.EXEC_CALLDATA);
  const termsCommitHash = slice(t, 88, 120);
  if (commitHash !== undefined && (!B32_RE.test(String(commitHash)) || lc(termsCommitHash) !== lc(commitHash))) return refuse(R.EXEC_CALLDATA);
  if (lc(t) !== lc(buildExactExecutionTerms({ escrowAddress, giftId, commitHash: termsCommitHash }))) return refuse(R.EXEC_CALLDATA); // canonical re-encode

  // LimitedCalls: exactly 1.
  let limit;
  try { [limit] = decodeAbiParameters([{ type: "uint256" }], cv[1].terms); } catch { return refuse(R.LIMIT_NOT_ONE); }
  if (size(cv[1].terms) !== 32 || limit !== 1n) return refuse(R.LIMIT_NOT_ONE);

  // Timestamp: after = 0, before in (now, now + expirySeconds + skew]. The window length is the injected param.
  if (size(cv[2].terms) !== 32) return refuse(R.EXPIRY_INVALID);
  const after = hexToBigInt(slice(cv[2].terms, 0, 16));
  const before = hexToBigInt(slice(cv[2].terms, 16, 32));
  if (after !== 0n || before > MAX_UINT128 || before <= BigInt(nowSeconds) || before > BigInt(nowSeconds + expirySeconds + skewSeconds)) return refuse(R.EXPIRY_INVALID);

  return {
    ok: true,
    commitHash: termsCommitHash,
    expiryBefore: before,
    delegation: Object.freeze({
      delegate: getAddress(delegation.delegate), delegator: getAddress(delegation.delegator), authority: GIFT_SPONSOR_PINS.root,
      caveats: Object.freeze(cv.map((c) => Object.freeze({ enforcer: getAddress(c.enforcer), terms: c.terms, args: "0x" }))),
      salt, signature: delegation.signature,
    }),
  };
}

export function delegationTypedData({ chainId, delegation }) {
  return {
    domain: { name: "DelegationManager", version: "1", chainId, verifyingContract: GIFT_SPONSOR_PINS.delegationManager },
    types: DELEGATION_TYPES,
    primaryType: "Delegation",
    message: {
      delegate: delegation.delegate, delegator: delegation.delegator, authority: delegation.authority,
      caveats: delegation.caveats.map(({ enforcer, terms }) => ({ enforcer, terms })), salt: BigInt(delegation.salt),
    },
  };
}
/** Async: who signed the delegation (must be the 7702 account / delegator). Server mirrors this. */
export async function recoverDelegationSigner({ chainId, delegation }) {
  try { return getAddress(await recoverTypedDataAddress({ ...delegationTypedData({ chainId, delegation }), signature: delegation.signature })); } catch { return null; }
}

// ── claim reveal (claim() needs these and they cannot be derived; the relayer sees the preimage = TRUST RESIDUAL) ──
export function sponsorCommitHash({ recipient, preimage, salt }) {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes32" }], [recipient, preimage, salt]));
}
/** claim = { recipient, preimage, salt, deadline }: recipient == delegator (the Piggy), keccak(abi.encode(recipient, preimage, salt)) == the committed hash. */
export function checkClaim(claim, { delegator, commitHash } = {}) {
  if (!ownKeysExactly(claim, ["recipient", "preimage", "salt", "deadline"])) return refuse(R.REQUEST_SHAPE);
  if (!ADDR_RE.test(String(claim.recipient)) || !sameAddr(claim.recipient, delegator)) return refuse(R.DELEGATOR_MISMATCH);
  if (!/^0x([0-9a-fA-F]{2})+$/.test(String(claim.preimage)) || !B32_RE.test(String(claim.salt))) return refuse(R.REQUEST_SHAPE);
  if (typeof claim.deadline !== "string" || !UINT_DEC_RE.test(claim.deadline)) return refuse(R.REQUEST_SHAPE);
  if (lc(sponsorCommitHash({ recipient: claim.recipient, preimage: claim.preimage, salt: claim.salt })) !== lc(commitHash)) return refuse(R.EXEC_CALLDATA);
  return { ok: true };
}

// ── whole-request guard (app self-check before send; relayer re-runs the same on the wire object) ──
// request = { giftId, authorization, delegation }. Authority recovered from the authorization must equal delegation.delegator
// AND the delegation signature signer; chain, delegate, scope, calldata, limit and expiry all checked.
export async function validateGiftSponsorRequest(request, ctx = {}) {
  // 3 keys (app self-check before the reveal exists) or 4 keys with `claim` (the relayer wire shape; ctx.requireClaim forces 4).
  // [A-913 D] 5 keys = the 4 + `revokeAuthorization` (signed in the same Face ID session; ctx.requireRevoke forces it).
  // 6 keys = + `gasTx` (bytes32 hash of the sender's separate gas-deposit tx; the relayer reads its receipt). ctx.requireGasTx forces it.
  const withGas = ownKeysExactly(request, ["giftId", "authorization", "delegation", "claim", "revokeAuthorization", "gasTx"]);
  const withRevoke = withGas || ownKeysExactly(request, ["giftId", "authorization", "delegation", "claim", "revokeAuthorization"]);
  const withClaim = withRevoke || ownKeysExactly(request, ["giftId", "authorization", "delegation", "claim"]);
  if (!withClaim && (ctx.requireClaim || ctx.requireRevoke || ctx.requireGasTx || !ownKeysExactly(request, ["giftId", "authorization", "delegation"]))) return refuse(R.REQUEST_SHAPE);
  if (ctx.requireRevoke && !withRevoke) return refuse(R.REQUEST_SHAPE);
  if (ctx.requireGasTx && !withGas) return refuse(R.REQUEST_SHAPE);
  if (withGas && !B32_RE.test(String(request.gasTx))) return refuse(R.REQUEST_SHAPE);
  const { giftId } = request;
  if (!B32_RE.test(String(giftId))) return refuse(R.GIFT_ID);
  const a = checkAuthorization(request.authorization, { chainId: ctx.chainId, authNonce: ctx.authNonce });
  if (!a.ok) return a;
  const d = checkDelegation(request.delegation, { ...ctx, giftId });
  if (!d.ok) return d;
  const authority = await recoverAuthorizationAuthority(a.authorization);
  if (!authority || !sameAddr(authority, d.delegation.delegator)) return refuse(R.AUTH_SIGNER);
  if (ctx.delegator !== undefined && !sameAddr(authority, ctx.delegator)) return refuse(R.AUTH_SIGNER);
  const signer = await recoverDelegationSigner({ chainId: ctx.chainId, delegation: d.delegation });
  if (!signer || !sameAddr(signer, authority)) return refuse(R.SIGNATURE_INVALID);
  let revokeAuthorization;
  if (withRevoke) {
    if (!Number.isSafeInteger(ctx.authNonce)) return refuse(R.AUTH_NONCE); // the revoke nonce is derived from the install nonce: it must be known
    const r = checkRevokeAuthorization(request.revokeAuthorization, { chainId: ctx.chainId, authNonce: ctx.authNonce });
    if (!r.ok) return r;
    const who = await recoverAuthorizationAuthority(r.authorization);
    if (!who || !sameAddr(who, authority)) return refuse(R.REVOKE_AUTH_SIGNER);
    revokeAuthorization = r.authorization;
  }
  if (withClaim) {
    const c = checkClaim(request.claim, { delegator: d.delegation.delegator, commitHash: d.commitHash });
    if (!c.ok) return c;
  }
  return { ok: true, authority, commitHash: d.commitHash, expiryBefore: d.expiryBefore, authorization: a.authorization, delegation: d.delegation, ...(revokeAuthorization ? { revokeAuthorization } : {}) };
}

// ── brand: only objects produced/validated by THIS module are accepted by money-executor (A-895 P-B style) ──
const VALIDATED_REQUESTS = new WeakSet();
const VALIDATED_AUTH_LISTS = new WeakMap(); // authorizationList array -> { chainId, redeemData } it was minted for
export const isGiftSponsorRequest = (o) => !!o && typeof o === "object" && VALIDATED_REQUESTS.has(o);

const REDEEM_ABI = [{ type: "function", name: "redeemDelegations", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "_permissionContexts", type: "bytes[]" }, { name: "_modes", type: "bytes32[]" }, { name: "_executionCallDatas", type: "bytes[]" }] }];
const DELEGATION_COMPONENTS = [
  { name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" },
  { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }, { name: "args", type: "bytes" }] },
  { name: "salt", type: "uint256" }, { name: "signature", type: "bytes" },
];
/** DelegationManager.redeemDelegations calldata for exactly this delegation (execution = its ExactExecution terms). Same encoding the relayer sends. */
export function buildRedeemCalldata(delegation) {
  const tuple = { delegate: delegation.delegate, delegator: delegation.delegator, authority: delegation.authority, caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: "0x" })), salt: BigInt(delegation.salt), signature: delegation.signature };
  return encodeFunctionData({ abi: REDEEM_ABI, functionName: "redeemDelegations", args: [[encodeAbiParameters([{ type: "tuple[]", components: DELEGATION_COMPONENTS }], [[tuple]])], [GIFT_SPONSOR_PINS.mode], [delegation.caveats[0].terms]] });
}
/** Executor-facing: the frozen one-entry authorizationList derived from a validated request, bound to that request's redeem calldata. */
export function toExecutorAuthorizationList(request) {
  if (!isGiftSponsorRequest(request)) return null;
  const list = Object.freeze([request.authorization]);
  VALIDATED_AUTH_LISTS.set(list, { chainId: request.authorization.chainId, redeemData: buildRedeemCalldata(request.delegation).toLowerCase() });
  return list;
}
/** The redeemDelegations calldata this branded list was minted for (the executor requires tx.data to equal it), else null. */
export function giftSponsorRedeemData(list) {
  return isGiftSponsorAuthorizationList(list) ? VALIDATED_AUTH_LISTS.get(list).redeemData : null;
}
/**
 * The ONLY test money-executor uses to allow `authorizationList`: the array is the exact object minted above, is
 * still one entry, and that entry still passes the pinned-delegate/chain guard. Never throws.
 */
export function isGiftSponsorAuthorizationList(list) {
  try {
    if (!Array.isArray(list) || !VALIDATED_AUTH_LISTS.has(list) || list.length !== 1 || !Object.isFrozen(list)) return false;
    const { chainId } = VALIDATED_AUTH_LISTS.get(list);
    return checkAuthorization(list[0], { chainId }).ok === true && list[0].chainId === chainId;
  } catch {
    return false;
  }
}
export const GIFT_SPONSOR_REDEEM_TO = GIFT_SPONSOR_PINS.delegationManager;

// ── signing session: ONE Face ID step = ONE authorization + ONE delegation; a second request is refused ──
/**
 * @param {object} p
 * @param {object} p.config     { chainId, escrowAddress, sponsorAddress, expirySeconds } (see normalizeGiftSponsorConfig)
 * @param {string} p.giftId     bytes32
 * @param {string} p.commitHash bytes32 = giftCommitHash({recipient, preimage, salt}) computed by the caller
 * @param {object} p.account    live Mera/viem local account of the NEW Gift Piggy: { address, signAuthorization, signTypedData }
 * @param {number} p.authNonce  the Piggy's current account nonce (the sponsor sends the tx, so no +1)
 * @param {Function} p.now      () => unix seconds (injected clock)
 * @param {Function} p.readCode (address) => bytecode — verifies the delegate's code hash before anything is signed
 * @param {Function} [p.randomSalt] () => bigint uint256 — injected, default crypto.getRandomValues(8 bytes)
 * @param {number} [p.giftDeadlineSeconds] [A-913 C] unix seconds of the Gift's own deadline. When given: before = min(now + min(expirySeconds, 300), deadline);
 *   a deadline not after `now` refuses. When absent the pre-A-913 window (now + expirySeconds) is unchanged (tests/legacy callers).
 * Returns null when anything is missing/invalid (never a half-built session).
 */
export function createGiftSponsorSession({ config, giftId, commitHash, account, authNonce, now, readCode, randomSalt = defaultSalt, giftDeadlineSeconds } = {}) {
  const cfg = normalizeGiftSponsorConfig(config);
  if (!cfg.ok) return null;
  if (!B32_RE.test(String(giftId || "")) || !B32_RE.test(String(commitHash || ""))) return null;
  if (!account || !ADDR_RE.test(String(account.address || "")) || typeof account.signAuthorization !== "function" || typeof account.signTypedData !== "function") return null;
  if (!Number.isSafeInteger(authNonce) || authNonce < 0) return null;
  if (typeof now !== "function" || typeof readCode !== "function" || typeof randomSalt !== "function") return null;
  if (giftDeadlineSeconds !== undefined && (!Number.isSafeInteger(giftDeadlineSeconds) || giftDeadlineSeconds <= 0)) return null;
  const C = cfg.config;
  let authRequested = false;
  let delegationRequested = false;
  let signedAuth = null;
  let signedRevoke = null;
  let revokeRequested = false;
  let signedDelegation = null;
  let codeChecked = false;

  const session = Object.freeze({
    /** Face ID signature #1. Verifies pinned code (address + hash) first; signs only the pinned delegate on the gift chain. */
    async signAuthorization() {
      if (authRequested) return refuse(R.SECOND_SIGNATURE);
      authRequested = true;
      const code = await checkPinnedCode({ chainId: C.chainId, readCode });
      if (!code.ok) return code;
      codeChecked = true;
      let raw;
      try {
        raw = await account.signAuthorization({ contractAddress: GIFT_SPONSOR_PINS.statelessDelegate, chainId: C.chainId, nonce: authNonce });
      } catch {
        return refuse(R.SIGN_FAILED);
      }
      const a = checkAuthorization(raw, { chainId: C.chainId, authNonce });
      if (!a.ok) return a;
      const who = await recoverAuthorizationAuthority(a.authorization);
      if (!who || !sameAddr(who, account.address)) return refuse(R.AUTH_SIGNER);
      signedAuth = a.authorization;
      return { ok: true };
    },
    /** [A-913 D] Face ID signature (same session): authorization delegating to 0x0 at nonce n+1, so the sponsor can clear the 7702 designator. Needs #1 first. */
    async signRevokeAuthorization() {
      if (revokeRequested) return refuse(R.SECOND_SIGNATURE);
      revokeRequested = true;
      if (!codeChecked || !signedAuth) return refuse(R.NOT_READY);
      let raw;
      try { raw = await account.signAuthorization({ contractAddress: ZERO_ADDRESS, chainId: C.chainId, nonce: authNonce + 1 }); } catch { return refuse(R.SIGN_FAILED); }
      const r = checkRevokeAuthorization(raw, { chainId: C.chainId, authNonce });
      if (!r.ok) return r;
      const who = await recoverAuthorizationAuthority(r.authorization);
      if (!who || !sameAddr(who, account.address)) return refuse(R.REVOKE_AUTH_SIGNER);
      signedRevoke = r.authorization;
      return { ok: true };
    },
    /** Face ID signature #2. Scope is fixed here: no target/method/value parameters exist on this call. */
    async signDelegation() {
      if (delegationRequested) return refuse(R.SECOND_SIGNATURE);
      delegationRequested = true;
      if (!codeChecked) return refuse(R.NOT_READY);
      let nowSeconds;
      let salt;
      try { nowSeconds = Math.floor(Number(now())); salt = randomSalt(); } catch { return refuse(R.SIGN_FAILED); }
      if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0 || typeof salt !== "bigint") return refuse(R.SIGN_FAILED);
      let before = nowSeconds + C.expirySeconds;
      let windowSeconds = C.expirySeconds;
      if (giftDeadlineSeconds !== undefined) {
        const e = giftSponsorExpiryBefore({ nowSeconds, giftDeadlineSeconds, capSeconds: C.expirySeconds });
        if (!e.ok) return e;
        before = e.before;
        windowSeconds = Math.min(C.expirySeconds, GIFT_SPONSOR_MAX_EXPIRY_SECONDS);
      }
      const unsigned = {
        delegate: C.sponsorAddress, delegator: getAddress(account.address), authority: GIFT_SPONSOR_PINS.root,
        caveats: [
          { enforcer: GIFT_SPONSOR_PINS.exactExecutionEnforcer, terms: buildExactExecutionTerms({ escrowAddress: C.escrowAddress, giftId, commitHash }), args: "0x" },
          { enforcer: GIFT_SPONSOR_PINS.limitedCallsEnforcer, terms: buildLimitedCallsTerms(), args: "0x" },
          { enforcer: GIFT_SPONSOR_PINS.timestampEnforcer, terms: buildTimestampTerms({ beforeSeconds: before }), args: "0x" },
        ],
        salt, signature: "0x",
      };
      const ctx = { chainId: C.chainId, giftId, escrowAddress: C.escrowAddress, sponsorAddress: C.sponsorAddress, expirySeconds: windowSeconds, nowSeconds, skewSeconds: 0, delegator: account.address, commitHash };
      const pre = checkDelegation(unsigned, { ...ctx, requireSignature: false });
      if (!pre.ok) return pre;
      let signature;
      try { signature = await account.signTypedData(delegationTypedData({ chainId: C.chainId, delegation: unsigned })); } catch { return refuse(R.SIGN_FAILED); }
      const full = checkDelegation({ ...unsigned, signature }, ctx);
      if (!full.ok) return full;
      const signer = await recoverDelegationSigner({ chainId: C.chainId, delegation: full.delegation });
      if (!signer || !sameAddr(signer, account.address)) return refuse(R.SIGNATURE_INVALID);
      signedDelegation = full.delegation;
      return { ok: true };
    },
    /** After both signatures: the branded wire request { giftId, authorization, delegation } (salt as decimal string). */
    async buildRequest({ claim = null, gasTx = null } = {}) {
      if (!signedAuth || !signedDelegation) return refuse(R.NOT_READY);
      const body = {
        giftId,
        authorization: signedAuth,
        delegation: Object.freeze({ ...signedDelegation, salt: signedDelegation.salt.toString(10) }),
      };
      if (claim !== null) body.claim = Object.freeze({ recipient: claim.recipient, preimage: claim.preimage, salt: claim.salt, deadline: claim.deadline });
      if (claim !== null && signedRevoke) body.revokeAuthorization = signedRevoke; // [A-913 D] 5th key, only with the claim and only when signed
      if (gasTx !== null) { // [A-913 A] 6th key: the sender's gas-deposit tx hash (needs the revoke authorization + claim; a malformed hash builds nothing)
        if (!B32_RE.test(String(gasTx)) || !signedRevoke || claim === null) return refuse(R.REQUEST_SHAPE);
        body.gasTx = String(gasTx).toLowerCase();
      }
      const request = Object.freeze(body);
      const check = await validateGiftSponsorRequest(request, { chainId: C.chainId, escrowAddress: C.escrowAddress, sponsorAddress: C.sponsorAddress, expirySeconds: C.expirySeconds, nowSeconds: Math.floor(Number(now())), skewSeconds: 0, delegator: account.address, authNonce, commitHash });
      if (!check.ok) return check;
      VALIDATED_REQUESTS.add(request);
      return { ok: true, request, commitHash: check.commitHash, expiryBefore: check.expiryBefore };
    },
  });
  return session;
}

function defaultSalt() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("WebCrypto unavailable");
  const h = Array.from(c.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${h}`);
}
