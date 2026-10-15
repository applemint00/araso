// [A-906] Gift claim via 7702 sponsor-submit. Transport-agnostic service + a route factory. Default OFF:
// server.mjs mounts the route with config null => every request 503, 0 chain calls, 0 sends.
//
// Request (strict, exactly these keys; `claim` carries the reveal inputs claim() needs, which cannot be derived):
//   { giftId, authorization, revokeAuthorization, delegation, claim [, gasTx] }   [A-913: 4 keys -> 5, gasTx optional: the deposit is registered by the sender beforehand]
//   authorization = { chainId, address, nonce, r, s, yParity }          (EIP-7702 tuple signed by the Piggy)
//   delegation    = { delegate, delegator, authority, caveats:[{enforcer,terms,args}], salt, signature }
//   claim         = { recipient, preimage, salt, deadline }             (recipient must equal delegator)
//
// Server-side guards (mirror of the app guards; nothing is imported from app/):
//   G1 authorization.chainId == policy.chainId and never 0 · G2 authorization.address == pinned StatelessDeleGator impl
//   G3 impl / DelegationManager / enforcer code hashes == pinned (read from chain) · G4 authorization signer == delegation.delegator
//   G5 delegation.delegate == our sponsor, authority == root, signature recovers to delegator (EIP-712, DM domain)
//   G6 caveats == exactly {ExactExecution, LimitedCalls, Timestamp}, each once, args empty
//   G7 ExactExecution terms == escrow ‖ 0 ‖ commitClaim(giftId, keccak(recipient,preimage,salt)) (target = Gift escrow only, value 0)
//   G8 LimitedCalls terms == 1 · G9 Timestamp terms present, before in (now, now+maxExpirySeconds], after 0/<=now (maxExpirySeconds injected: UNKNOWN otherwise)
//   G10 escrow has giftId, unclaimed, unexpired, sha256(preimage)==claimTokenHash, recipient != sender · G11 one per giftId (ledger)
// [A-913] additions: G10 also requires the SENDER'S GAS DEPOSIT for this giftId to be visible on chain (chain.getGasDeposit) before anything is sent ·
//   expiry cap = 300 s (A-556 5-minute cap, GIFT_SPONSOR_MAX_EXPIRY_SECONDS; a larger injected value => policy null) and before <= gift expiry ·
//   preflight (gift-sponsor-preflight.mjs) before EVERY send · sponsor balance floor (2 x claim gas estimate) checked before a NEW request starts.
// Flow: ledger.reserve(plan) -> simulate redeem -> [install -> INSTALLED] -> redeemDelegations -> confirm commit (receipt success + Committed log + commits()==hash) -> COMMITTED
//       -> REVOKE (DelegationManager.disableDelegation, simulate first; failure NEVER blocks claim) -> REVOKED | revokeStatus -> wait a block -> simulate claim -> claim() plain tx -> CLAIMED.
// Every send carries value 0. Nothing here can send MON to the Piggy. Ambiguity after a send => UNKNOWN + `inflight` marker; recovery = gift-sponsor-reconcile.mjs
// (chain truth first, never a blind resend).
//
// chain (async): getGift(id)->{exists,claimed,sender,expiry,claimTokenHash} getCode(a) getNonce(a)->bigint getTimestamp()->bigint
//                simulate({from,to,data,value,stateOverride?}) (throws on revert) waitBlockAfter(n)
//                [A-913] getGasDeposit({giftId,sender})->{from,to,amountWei,txHash,status:"success"}|null · confirmCommit({txHash,giftId,delegator,commitHash})->bool
//                        getCommit(giftId,committer)->{hash,blockNumber}|null · isDelegationDisabled(delegationTuple)->bool · getReceipt(txHash)->{status}|null
//                        getSponsorNonces()->{latest,pending} · getSponsorBalance()->bigint · estimateClaimGasWei()->bigint|null
// sponsor: { address, send({kind:"install"|"redeem"|"revoke"|"claim",to,data,value,authorizationList?}, {onBroadcast?(txHash)}) -> {txHash,blockNumber,status:"success"|"reverted"} }

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, mkdirSync, chmodSync, openSync, closeSync, writeSync, fsyncSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  keccak256, encodeAbiParameters, encodePacked, encodeFunctionData, hashTypedData, recoverTypedDataAddress, getAddress, isAddress,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const B32 = /^0x[0-9a-f]{64}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const ROOT = `0x${"f".repeat(64)}`;
const MODE = `0x${"0".repeat(64)}`;
const ZERO = `0x${"0".repeat(40)}`;
/** [A-913 C] A-556 signer-session cap (5 minutes) reused as the ceiling for the Gift delegation window. Not a new number. */
export const GIFT_SPONSOR_MAX_EXPIRY_SECONDS = 300;
const MAX_PREIMAGE_BYTES = 256;
const lc = (s) => String(s).toLowerCase();
const short = (g) => `${String(g).slice(0, 10)}…`;
const NA = () => ({ status: 409, body: { ok: false, error: "not_available" } });
const BAD = () => ({ status: 400, body: { ok: false, error: "bad_request" } });
const UNAVAIL = () => ({ status: 503, body: { ok: false, error: "unavailable" } });
const UNAVAIL_NOT_SENT = () => ({ status: 503, body: { ok: false, error: "unavailable_not_sent" } });

const COMMIT_CLAIM_ABI = [{ type: "function", name: "commitClaim", inputs: [{ name: "giftId", type: "bytes32" }, { name: "commitHash", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" }];
const CLAIM_ABI = [{ type: "function", name: "claim", inputs: [{ name: "giftId", type: "bytes32" }, { name: "committer", type: "address" }, { name: "recipient", type: "address" }, { name: "preimage", type: "bytes" }, { name: "salt", type: "bytes32" }, { name: "deadline", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }];
const DELEGATION_COMPONENTS = [
  { name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" },
  { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }, { name: "args", type: "bytes" }] },
  { name: "salt", type: "uint256" }, { name: "signature", type: "bytes" },
];
const DELEGATION_TUPLE = { name: "_delegation", type: "tuple", components: DELEGATION_COMPONENTS };
const DISABLE_ABI = [{ type: "function", name: "disableDelegation", inputs: [DELEGATION_TUPLE], outputs: [], stateMutability: "nonpayable" }];
const REDEEM_ABI = [{ type: "function", name: "redeemDelegations", inputs: [{ name: "_permissionContexts", type: "bytes[]" }, { name: "_modes", type: "bytes32[]" }, { name: "_executionCallDatas", type: "bytes[]" }], outputs: [], stateMutability: "nonpayable" }];
const TYPES = {
  Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
  Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
};

const isAddr = (v) => typeof v === "string" && ADDR.test(v) && isAddress(v, { strict: false });
const codeHash = (code) => (typeof code === "string" && HEX.test(code) && code.length > 2 ? keccak256(code) : null);
const hasOnly = (o, keys) => typeof o === "object" && o !== null && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
function uintOf(v) {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v)) return BigInt(v);
  return null;
}

// Own copy of the pin table (relayer must not import app/). Sources: A-814 PREFLIGHT §1 (10143), Part F raw/partf_fork.json (143, fork-read).
export const GIFT_SPONSOR_PIN_TABLE = Object.freeze({
  addresses: Object.freeze({
    delegationManager: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
    delegateImpl: "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b",
    exactExecutionEnforcer: "0x146713078d39ecc1f5338309c28405ccf85abfbb",
    limitedCallsEnforcer: "0x04658b29f6b82ed55274221a06fc97d318e25416",
    timestampEnforcer: "0x1046bb45c8d673d4ea75321280db34899413c069",
  }),
  hashes: Object.freeze({
    10143: Object.freeze({
      delegationManagerCodeHash: "0x292b39ef44a63d81e9a8080b185a5449ed4b8ce74436177ca8f475fefd78807b",
      implCodeHash: "0x399646560cadf8e8f30b232c75d0be4e629939b4eba8019589c6d0d4b69ff9f9",
      exactExecutionCodeHash: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e",
      limitedCallsCodeHash: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468",
      // timestampCodeHash on 10143: UNKNOWN (not pinned) => must be injected, shape-checked only
    }),
    143: Object.freeze({
      delegationManagerCodeHash: "0x85674a6f4a65e3b61df3b6d45a89f2bf6165efda91a83610b797ff917f64866f",
      implCodeHash: "0xd4dee59ae6be4a997964e8f19ae6905f0a233c6ae88d9bc5d945bc60738376c1",
      exactExecutionCodeHash: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e",
      limitedCallsCodeHash: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468",
      timestampCodeHash: "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c", // FORK-READ (anvil fork of 143), not a live-chain read
    }),
  }),
});
export const GIFT_SPONSOR_ALLOWED_CHAINS = Object.freeze([143, 10143]);

/** Server-owned pins + injected unknowns. Any missing/invalid/unpinned field => null => every request 503.
 *  `pins` defaults to the table above; only tests inject another. */
export function createGiftSponsorPolicy(cfg, pins = GIFT_SPONSOR_PIN_TABLE) {
  if (typeof cfg !== "object" || cfg === null) return null;
  if (!Number.isSafeInteger(cfg.chainId) || !(pins === GIFT_SPONSOR_PIN_TABLE ? GIFT_SPONSOR_ALLOWED_CHAINS : Object.keys(pins.hashes).map(Number)).includes(cfg.chainId)) return null;
  const addrs = ["escrow", "delegationManager", "delegateImpl", "sponsorAddress", "exactExecutionEnforcer", "limitedCallsEnforcer", "timestampEnforcer"];
  const out = {};
  for (const k of addrs) { if (!isAddr(cfg[k]) || lc(cfg[k]) === ZERO) return null; out[k] = lc(cfg[k]); }
  for (const k of ["implCodeHash", "delegationManagerCodeHash", "exactExecutionCodeHash", "limitedCallsCodeHash", "timestampCodeHash"]) {
    if (typeof cfg[k] !== "string" || !B32.test(lc(cfg[k]))) return null; out[k] = lc(cfg[k]);
  }
  for (const [k, v] of Object.entries(pins.addresses)) if (out[k] !== v) return null;
  for (const [k, v] of Object.entries(pins.hashes[cfg.chainId])) if (out[k] !== v) return null;
  const mx = cfg.maxExpirySeconds; // injected; [A-913 C] must be within the A-556 5-minute cap (a larger value is refused, never clamped)
  if (!(Number.isSafeInteger(mx) && mx > 0 && mx <= GIFT_SPONSOR_MAX_EXPIRY_SECONDS)) return null;
  // [A-913 G10] gas units per sponsored step (install · commit · revoke · claim) and the safety buffer: UNKNOWN numbers => injected, refused when missing.
  // The minimum sender deposit is COMPUTED per Gift from these x the current fee (minGasDepositWei) - it is not a configured amount.
  const gu = cfg.gasUnits; const units = {};
  if (typeof gu !== "object" || gu === null) return null;
  for (const k of ["install", "commit", "revoke", "claim"]) {
    let v; try { v = typeof gu[k] === "bigint" ? gu[k] : (typeof gu[k] === "string" && /^[1-9][0-9]{0,15}$/.test(gu[k]) ? BigInt(gu[k]) : (Number.isSafeInteger(gu[k]) ? BigInt(gu[k]) : null)); } catch { v = null; }
    if (v === null || v <= 0n) return null; units[k] = v;
  }
  if (!(Number.isSafeInteger(cfg.gasBufferBps) && cfg.gasBufferBps >= 0 && cfg.gasBufferBps <= 5000)) return null; // 5000 = A-573 structural ceiling
  if (new Set(addrs.map((k) => out[k])).size !== addrs.length) return null;
  return Object.freeze({ ...out, chainId: cfg.chainId, maxExpirySeconds: BigInt(mx), gasUnits: Object.freeze(units), gasBufferBps: cfg.gasBufferBps });
}

/** [A-913] GiftSponsorStore interface (every method may be sync OR async; callers always `await`):
 *    get(id) · list() · reserve(id, plan) [create-if-absent, throws on existing or reused deposit tx] · update(id, state, patch) · mark(id, patch) · release(id) [RESERVED only]
 *    archive(id, reason) · depositUsedBy(txHash) -> giftId|null
 *    optional cross-instance lease (serverless): acquireLease(owner, ttlMs) -> bool · renewLease(owner, ttlMs) -> bool · releaseLease(owner)
 *  Implementations: openGiftSponsorLedger() below (file / memory: local + tests, single process) and api/_lib/gift-sponsor-kv-store.js (Vercel KV / Upstash REST: production).
 *
 *  [A-913 D] One-per-giftId sponsor ledger (file-backed when a path is given; in-memory otherwise).
 *  States (rank order): RESERVED < INSTALLED < COMMITTED < REVOKED < CLAIMED, plus UNKNOWN (ambiguous after a send).
 *    RESERVED  nothing sent yet            INSTALLED  type-4 install mined
 *    COMMITTED commitClaim mined AND confirmed (receipt success + Committed log + commits() == commitHash)
 *    REVOKED   revoke type-4 mined and the Piggy code is clean (0x)     CLAIMED  claim() mined
 *  Revoke is best-effort and never blocks claim, so COMMITTED -> CLAIMED is legal; then `revokeStatus` (done|unavailable|failed|unsure) tells reconcile
 *  whether a cleanup is still owed. States only move forward (rank never decreases), except UNKNOWN which can be entered from any non-CLAIMED state and left
 *  again ONLY by reconcile with chain proof (update(id, <state>) from UNKNOWN). `lastGoodState` remembers where UNKNOWN came from.
 *  `inflight` = { kind, at, nonce, txHash? } is written BEFORE every broadcast: "sent but unsure" is recognisable after a crash and is never blindly resent.
 *  `plan` = the validated request material (delegation, authorization, claim inputs, commitHash, deposit proof) so reconcile can continue without the browser.
 *  It contains the claim preimage (the Gift capability token the relayer sees anyway — A-906 residual): the file is 0600 in a 0700 dir, never logged.
 *  file mode: single writer (`<file>.lock` O_EXCL, never removed automatically), atomic tmp+fsync+rename. */
const STATE_RANK = Object.freeze({ RESERVED: 0, INSTALLED: 1, COMMITTED: 2, REVOKED: 3, CLAIMED: 4 });
export const SPONSOR_LEDGER_STATES = Object.freeze([...Object.keys(STATE_RANK), "UNKNOWN"]);

/** Shared state-machine rule for every store: forward only; UNKNOWN from any non-CLAIMED; out of UNKNOWN only to a real state not below `lastGoodState`. Mutates `e` (history, lastGoodState). */
export function applySponsorTransition(e, state) {
  if (state === e.state) return;
  if (state === "UNKNOWN") { if (e.state === "CLAIMED") throw new Error("LEDGER_BAD_TRANSITION"); }
  else if (!(state in STATE_RANK)) throw new Error("LEDGER_BAD_STATE");
  else if (e.state !== "UNKNOWN" && STATE_RANK[state] < STATE_RANK[e.state]) throw new Error("LEDGER_BAD_TRANSITION");
  else if (e.state === "UNKNOWN" && e.lastGoodState && STATE_RANK[state] < STATE_RANK[e.lastGoodState]) throw new Error("LEDGER_BAD_TRANSITION");
  if (state === "UNKNOWN") e.lastGoodState = e.state; else delete e.lastGoodState;
  e.history.push({ state, at: Date.now() });
}

export function openGiftSponsorLedger(file = null) {
  let data = { version: 3, entries: {}, archived: [], gasTxs: {}, letters: {} };
  let lockPath = null;
  if (file) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { chmodSync(path.dirname(file), 0o700); } catch { /* best effort */ }
    lockPath = `${file}.lock`;
    try { closeSync(openSync(lockPath, "wx", 0o600)); } catch (e) { throw new Error(e && e.code === "EEXIST" ? "LEDGER_LOCKED" : "LEDGER_LOCK_FAILED"); }
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (parsed?.version !== 3 || typeof parsed.entries !== "object" || parsed.entries === null || !Array.isArray(parsed.archived)) throw new Error("LEDGER_SCHEMA");
        for (const [k, e] of Object.entries(parsed.entries)) if (!B32.test(k) || e?.giftId !== k || !SPONSOR_LEDGER_STATES.includes(e.state)) throw new Error("LEDGER_SCHEMA");
        data = { gasTxs: {}, letters: {}, ...parsed };
      }
    } catch (e) { try { unlinkSync(lockPath); } catch { /* ignore */ } throw new Error(e?.message === "LEDGER_SCHEMA" ? "LEDGER_SCHEMA" : "LEDGER_CORRUPT"); }
  }
  const save = () => {
    if (!file) return;
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try { writeSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
  };
  const clone = (e) => structuredClone(e);
  const must = (id) => { if (!Object.hasOwn(data.entries, id)) throw new Error("LEDGER_NO_ENTRY"); return data.entries[id]; };
  return {
    get: (id) => (Object.hasOwn(data.entries, id) ? clone(data.entries[id]) : null),
    list: () => Object.values(data.entries).map(clone),
    archivedList: () => structuredClone(data.archived),
    /** reserve throws on any existing entry (one per giftId). `plan` is the persisted request material. */
    reserve(id, plan = null) {
      if (Object.hasOwn(data.entries, id)) throw new Error("LEDGER_GIFT_ALREADY_RESERVED");
      if (plan?.depositTx && Object.values(data.entries).some((e) => e.plan?.depositTx === plan.depositTx)) throw new Error("LEDGER_DEPOSIT_ALREADY_USED");
      data.entries[id] = { giftId: id, state: "RESERVED", plan, revokeStatus: null, inflight: null, history: [{ state: "RESERVED", at: Date.now() }] };
      save();
    },
    /** Move to `state` (forward only; UNKNOWN from any non-CLAIMED; out of UNKNOWN only to a real state) and merge `patch`. */
    update(id, state, patch = {}) { applySponsorTransition(must(id), state); Object.assign(data.entries[id], patch, { state }); save(); },
    /** Patch fields without changing state (inflight marker, revokeStatus, notes). */
    mark(id, patch) { Object.assign(must(id), patch); save(); },
    /** Only before anything was sent (state RESERVED and no inflight). */
    release(id) { const e = data.entries[id]; if (e?.state === "RESERVED" && !e.inflight) { delete data.entries[id]; save(); } },
    /** Move an entry whose chain truth proves nothing is owed (nothing committed, or window expired) out of the active set so a fresh request may proceed. */
    archive(id, reason) { const e = must(id); data.archived.push({ ...e, archivedReason: String(reason).slice(0, 60), archivedAt: Date.now() }); delete data.entries[id]; save(); },
    gasTxOf: (giftId) => (Object.hasOwn(data.gasTxs, giftId) ? data.gasTxs[giftId] : null),
    /** record giftId -> deposit tx hash once: "created" | "same" | "conflict" (other hash for this giftId) | "reused" (hash registered for another giftId) */
    registerGasTx(giftId, hash) {
      if (Object.hasOwn(data.gasTxs, giftId)) return data.gasTxs[giftId] === hash ? "same" : "conflict";
      if (Object.values(data.gasTxs).includes(hash) || Object.values(data.entries).some((e) => e.plan?.depositTx === hash && e.giftId !== giftId)) return "reused";
      data.gasTxs[giftId] = hash; save(); return "created";
    },
    letterOf: (giftId) => (Object.hasOwn(data.letters, giftId) ? data.letters[giftId] : null),
    registerLetter(giftId, letter) {
      if (Object.hasOwn(data.letters, giftId)) return JSON.stringify(data.letters[giftId]) === JSON.stringify(letter) ? "same" : "conflict";
      data.letters[giftId] = letter; save(); return "created";
    },
    depositUsedBy: (txHash) => Object.values(data.entries).find((e) => e.plan?.depositTx === txHash)?.giftId ?? data.archived.find((e) => e.plan?.depositTx === txHash)?.giftId ?? null,
    close() { if (lockPath) { try { unlinkSync(lockPath); } catch { /* already gone */ } lockPath = null; } },
  };
}

/** Strict shape + field syntax only. No policy, no chain. */
export function validateGiftSponsorRequest(body) {
  const REQ5 = ["giftId", "authorization", "revokeAuthorization", "delegation", "claim"];
  if (!hasOnly(body, REQ5) && !hasOnly(body, [...REQ5, "gasTx"])) return null;
  if (Object.hasOwn(body, "gasTx") && (typeof body.gasTx !== "string" || !B32.test(lc(body.gasTx)))) return null;
  if (typeof body.giftId !== "string" || !B32.test(body.giftId)) return null;
  const a = body.authorization;
  if (!hasOnly(a, ["chainId", "address", "nonce", "r", "s", "yParity"])) return null;
  const chainId = uintOf(a.chainId); const nonce = uintOf(a.nonce);
  if (chainId === null || nonce === null || !isAddr(a.address) || !B32.test(lc(a.r)) || !B32.test(lc(a.s)) || (a.yParity !== 0 && a.yParity !== 1)) return null;
  const ra = body.revokeAuthorization;
  if (!hasOnly(ra, ["chainId", "address", "nonce", "r", "s", "yParity"])) return null;
  const rChainId = uintOf(ra.chainId); const rNonce = uintOf(ra.nonce);
  if (rChainId === null || rNonce === null || !isAddr(ra.address) || !B32.test(lc(ra.r)) || !B32.test(lc(ra.s)) || (ra.yParity !== 0 && ra.yParity !== 1)) return null;
  const d = body.delegation;
  if (!hasOnly(d, ["delegate", "delegator", "authority", "caveats", "salt", "signature"])) return null;
  const salt = uintOf(d.salt);
  if (!isAddr(d.delegate) || !isAddr(d.delegator) || typeof d.authority !== "string" || !B32.test(lc(d.authority)) || salt === null) return null;
  if (typeof d.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(d.signature)) return null;
  if (!Array.isArray(d.caveats) || d.caveats.length === 0 || d.caveats.length > 8) return null;
  const caveats = [];
  for (const c of d.caveats) {
    if (!hasOnly(c, ["enforcer", "terms", "args"]) || !isAddr(c.enforcer) || typeof c.terms !== "string" || !HEX.test(c.terms) || c.terms.length > 2 + 2 * 512
      || typeof c.args !== "string" || !HEX.test(c.args)) return null;
    caveats.push({ enforcer: lc(c.enforcer), terms: lc(c.terms), args: lc(c.args) });
  }
  const c = body.claim;
  if (!hasOnly(c, ["recipient", "preimage", "salt", "deadline"])) return null;
  const deadline = uintOf(c.deadline);
  if (!isAddr(c.recipient) || typeof c.preimage !== "string" || !HEX.test(c.preimage) || c.preimage.length < 4 || c.preimage.length > 2 + 2 * MAX_PREIMAGE_BYTES
    || typeof c.salt !== "string" || !B32.test(lc(c.salt)) || deadline === null) return null;
  return {
    giftId: body.giftId,
    authorization: { chainId, address: lc(a.address), nonce, r: lc(a.r), s: lc(a.s), yParity: a.yParity },
    revokeAuthorization: { chainId: rChainId, address: lc(ra.address), nonce: rNonce, r: lc(ra.r), s: lc(ra.s), yParity: ra.yParity },
    gasTx: Object.hasOwn(body, "gasTx") ? lc(body.gasTx) : null,
    delegation: { delegate: lc(d.delegate), delegator: lc(d.delegator), authority: lc(d.authority), caveats, salt, signature: lc(d.signature) },
    claim: { recipient: lc(c.recipient), preimage: lc(c.preimage), salt: lc(c.salt), deadline },
  };
}

/** Thrown by a sponsor step. notSent=true => provably nothing was broadcast by THIS step (safe to retry later); false => ambiguous (UNKNOWN + inflight). */
export class SponsorStepError extends Error {
  constructor(code, notSent, txHash = null) { super(code); this.code = code; this.notSent = notSent === true; this.txHash = txHash; }
}

/** Rebuild every transaction the sponsor will send from the persisted plan (pure; used by the live flow AND reconcile). Signatures are reused, never re-signed. */
export function buildSponsorCalls(policy, plan) {
  const d = plan.delegation;
  const caveats = d.caveats.map((c) => ({ enforcer: getAddress(c.enforcer), terms: c.terms, args: c.args }));
  const tuple = { delegate: getAddress(d.delegate), delegator: getAddress(d.delegator), authority: d.authority, caveats, salt: BigInt(d.salt), signature: d.signature };
  const exec = d.caveats.find((c) => c.enforcer === policy.exactExecutionEnforcer).terms;
  const ctx = encodeAbiParameters([{ type: "tuple[]", components: DELEGATION_COMPONENTS }], [[tuple]]);
  const authList = (a) => [{ address: getAddress(a.address), chainId: Number(a.chainId), nonce: Number(a.nonce), r: a.r, s: a.s, yParity: a.yParity }];
  return {
    tuple,
    delegator: tuple.delegator,
    designator: lc(`0xef0100${policy.delegateImpl.slice(2)}`),
    authList: authList(plan.authorization),
    revokeAuthList: authList(plan.revokeAuthorization),          // type-4 {address 0x0, nonce n+1}, Piggy-signed (A-814 D)
    redeemData: encodeFunctionData({ abi: REDEEM_ABI, functionName: "redeemDelegations", args: [[ctx], [MODE], [exec]] }),
    claimData: encodeFunctionData({ abi: CLAIM_ABI, functionName: "claim", args: [plan.giftId, tuple.delegator, tuple.delegator, plan.claim.preimage, plan.claim.salt, BigInt(plan.claim.deadline)] }),
  };
}

/** [A-913 G10] Minimum sender gas deposit for one Gift = (install + commit + revoke + claim gas units) x fee-per-gas x (1 + bufferBps/10000, ceiling).
 *  Mirrors app giftGasBudget (no import from app/). `feePerGasWei` missing/zero => null => the request is refused (never a default price). */
export function minGasDepositWei(policy, feePerGasWei) {
  let fee; try { fee = typeof feePerGasWei === "bigint" ? feePerGasWei : (typeof feePerGasWei === "string" ? BigInt(feePerGasWei) : null); } catch { fee = null; }
  if (fee === null || fee <= 0n) return null;
  const u = policy.gasUnits;
  const base = (u.install + u.commit + u.revoke + u.claim) * fee;
  return base + (base * BigInt(policy.gasBufferBps) + 9999n) / 10000n;
}

/** The sponsor transactions as idempotent-checkable steps (install · commit · revoke · claim). Shared by the live flow and the reconciler.
 *  Every send: value 0 · preflight first · lease still held · `inflight` marker durable BEFORE the broadcast · nothing here chooses a recipient.
 *  NEVER sends a signed authorization to eth_estimateGas / eth_call (A-814 REVIEW F2): the only simulation is the redeem with a local state override. */
export function createSponsorSteps({ ledger, policy, chain, sponsor, preflight, log = () => {}, nowMs = () => Date.now(), owner = null, leaseMs = 0, revokeMaxFailures = null, revokeBackoffSeconds = null }) {
  const say = (code, giftId) => { try { log(`gift-sponsor ${code}${giftId ? ` ${short(giftId)}` : ""}`); } catch { /* logger must not break flow */ } };
  const planOf = async (id) => { const e = await ledger.get(id); if (!e?.plan) throw new SponsorStepError("no_plan", true); return { e, calls: buildSponsorCalls(policy, e.plan) }; };
  const piggyIsClean = async (calls) => { const c = lc(String(await chain.getCode(calls.delegator))); return c === "0x" || c === ""; };

  async function guardedSend(id, kind, args) {
    if (args.value !== 0n) throw new SponsorStepError("value_nonzero", true); // belt and braces: no MON in any path
    let ok = false;
    try { ok = typeof preflight === "function" ? (await preflight()) === true : false; } catch { ok = false; }
    if (!ok) throw new SponsorStepError("preflight", true);
    if (owner && typeof ledger.renewLease === "function") { let held = false; try { held = (await ledger.renewLease(owner, leaseMs)) === true; } catch { held = false; } if (!held) throw new SponsorStepError("lease_lost", true); }
    let nonces;
    try { nonces = await chain.getSponsorNonces(); } catch { throw new SponsorStepError("nonce_read", true); }
    const slot = kind === "revoke" ? "revokeInflight" : "inflight";            // revoke has its own marker: it must survive the claim that follows it
    await ledger.mark(id, { [slot]: { kind, at: nowMs(), nonce: String(nonces.pending) } }); // durable BEFORE broadcast
    let r;
    try {
      r = await sponsor.send({ kind, ...args }, { onBroadcast: async (txHash) => { try { const cur = await ledger.get(id); await ledger.mark(id, { [slot]: { ...cur[slot], txHash } }); } catch { /* best effort */ } } });
    } catch { throw new SponsorStepError("send_failed", false); }
    if (!r || r.status !== "success") throw new SponsorStepError("not_success", false, r?.txHash ?? null);
    return r;
  }

  const steps = {
    /** eth_call of the redeem with the delegator code overridden to the designator (local state override; the redeem carries no authorization). Throws notSent. */
    async simulateRedeem(id) {
      const { calls } = await planOf(id);
      try { await chain.simulate({ from: sponsor.address, to: policy.delegationManager, data: calls.redeemData, value: 0n, stateOverride: { [calls.delegator]: { code: calls.designator } } }); }
      catch { throw new SponsorStepError("sim_redeem", true); }
    },
    /** type-4 install (also when the Piggy already carries our designator: re-delegating to the same impl is harmless and keeps the nonce aligned for the revoke authorization). */
    async install(id) {
      const { calls } = await planOf(id);
      const r = await guardedSend(id, "install", { to: calls.delegator, data: "0x", value: 0n, authorizationList: calls.authList });
      await ledger.update(id, "INSTALLED", { installTx: r.txHash, inflight: null });
      return r;
    },
    /** redeemDelegations -> commitClaim executed from the Piggy. COMMITTED only after receipt success + Committed log + commits()==hash. */
    async commit(id) {
      const { e, calls } = await planOf(id);
      await steps.simulateRedeem(id);
      const r = await guardedSend(id, "redeem", { to: policy.delegationManager, data: calls.redeemData, value: 0n });
      let ok = false;
      try { ok = (await chain.confirmCommit({ txHash: r.txHash, giftId: id, delegator: calls.delegator, commitHash: e.plan.commitHash })) === true; } catch { ok = false; }
      if (!ok) throw new SponsorStepError("commit_unconfirmed", false, r.txHash);
      await ledger.update(id, "COMMITTED", { commitTx: r.txHash, commitBlock: String(r.blockNumber), inflight: null });
      return r;
    },
    /** [A-913 D] REVOKE = type-4 tx {to: Piggy, authorizationList: [Piggy-signed {address 0x0, nonce n+1}]} submitted by the sponsor (A-814 D), BEFORE claim.
     *  NEVER throws and never blocks claim: "done" | "failed" | "unsure" | "backoff" | "exhausted". Reuses the stored signature (no re-signing). Idempotent: Piggy already clean => "done", no tx.
     *  No simulation: the signed authorization is never sent to estimateGas / eth_call.
     *  [F-2] "unsure" (the send threw, tx may still be pending) KEEPS the in-flight marker: reconcile reads the receipt first and never resends while it may be pending.
     *  A MINED revoke that leaves the Piggy dirty (reverted, or an authorization the chain skipped) is a FAILURE: revokeFailures++ and a backoff (base x 2^(failures-1)) before the next try.
     *  After `revokeMaxFailures` failures (injected; the cap only applies when a backoff base is injected too, else the first failure is final) => "exhausted": no more sends,
     *  needsHuman recorded, claim unaffected. Failures that never reached the chain (preflight, lease, nonce read) burn no gas and are not counted. */
    async revoke(id) {
      let outcome = "failed";
      try {
        const { e, calls } = await planOf(id);
        let clean = false;
        try { clean = await piggyIsClean(calls); } catch { clean = false; }
        const failures = e.revokeFailures ?? 0;
        const cap = revokeBackoffSeconds ? Math.max(1, revokeMaxFailures ?? 1) : 1;
        let revokeTx = null; let patch = null;
        if (clean) outcome = "done";
        else if (failures >= cap) { outcome = "exhausted"; patch = { revokeStatus: "exhausted", needsHuman: "revoke_exhausted", revokeInflight: null }; }
        else if (failures >= 1 && nowMs() < (e.revokeNextAt ?? 0)) { outcome = "backoff"; patch = {}; }
        else {
          let r = null; let failed = false;
          try { r = await guardedSend(id, "revoke", { to: calls.delegator, data: "0x", value: 0n, authorizationList: calls.revokeAuthList }); }
          catch (err) {
            if (err instanceof SponsorStepError && err.notSent) outcome = "failed";                    // never reached the chain: nothing burned, nothing counted
            else if (err instanceof SponsorStepError && err.code === "not_success") { outcome = "failed"; failed = true; }   // mined and reverted: counted
            else { outcome = "unsure"; patch = { revokeStatus: "unsure" }; }                         // send threw: may be pending => keep inflight
          }
          if (r) {
            let nowClean = false;
            try { nowClean = await piggyIsClean(calls); } catch { nowClean = false; }
            revokeTx = r.txHash;
            if (nowClean) outcome = "done"; else { outcome = "failed"; failed = true; }                // mined but the Piggy is not clean: the chain skipped the tuple
          }
          if (failed) {
            const n = failures + 1;
            patch = { revokeStatus: "failed", revokeInflight: null, revokeFailures: n, revokeNextAt: nowMs() + (revokeBackoffSeconds ? revokeBackoffSeconds * 1000 * 2 ** (n - 1) : 0), ...(n >= cap ? { needsHuman: "revoke_exhausted" } : {}) };
            if (n >= cap) patch.revokeStatus = "exhausted";
          }
        }
        const cur = await ledger.get(id);
        if (outcome === "done") patch = { revokeStatus: "done", revokeInflight: null };
        else if (outcome === "failed" && patch === null) patch = { revokeStatus: "failed", revokeInflight: null };
        if (revokeTx) patch = { ...patch, revokeTx };
        if (outcome === "done" && cur.state === "COMMITTED") await ledger.update(id, "REVOKED", patch);
        else if (patch && Object.keys(patch).length) await ledger.mark(id, patch);
        if (patch?.revokeStatus === "exhausted") outcome = "exhausted";
      } catch { try { await ledger.mark(id, { revokeStatus: "failed" }); } catch { /* failstop */ } outcome = "failed"; }
      say(`revoke(${outcome})`, id);
      return outcome;
    },
    async claim(id) {
      const { e, calls } = await planOf(id);
      try {
        if (e.commitBlock) await chain.waitBlockAfter(BigInt(e.commitBlock));
        await chain.simulate({ from: sponsor.address, to: policy.escrow, data: calls.claimData, value: 0n });
      } catch { throw new SponsorStepError("sim_claim", true); }
      const r = await guardedSend(id, "claim", { to: policy.escrow, data: calls.claimData, value: 0n });
      await ledger.update(id, "CLAIMED", { claimTx: r.txHash, inflight: null });
      return r;
    },
  };
  return steps;
}

export function createGiftSponsorService({ ledger, policy, chain, sponsor, preflight, log = () => {}, maxQueue = 8, nowMs = () => Date.now(), leaseSeconds = null, ownerId = null, revokeMaxFailures = null, revokeBackoffSeconds = null }) {
  const say = (code, giftId) => { try { log(`gift-sponsor ${code}${giftId ? ` ${short(giftId)}` : ""}`); } catch { /* logger must not break flow */ } };
  let queue = Promise.resolve();
  let pending = 0;
  const cap = Number.isSafeInteger(maxQueue) && maxQueue >= 1 ? maxQueue : 8;
  const enqueue = (fn) => { pending += 1; const run = queue.then(fn, fn); queue = run.then(() => {}, () => {}); run.then(() => { pending -= 1; }, () => { pending -= 1; }); return run; };
  const ready = !!(ledger && typeof ledger.reserve === "function" && policy && chain && sponsor && typeof sponsor.send === "function" && typeof preflight === "function"
    && typeof sponsor.address === "string" && lc(sponsor.address) === policy.sponsorAddress);
  // Cross-instance exclusion (Vercel: no shared process). With a lease-capable store ONE driver (request or cron pass) holds the sponsor lease for its whole flow
  // (nonce safety + no double drive); a stale driver is fenced because every send renews the lease first. Lease length = INJECTED (UNKNOWN: > the function's maxDuration).
  const leased = typeof ledger?.acquireLease === "function";
  const leaseMs = Number.isSafeInteger(leaseSeconds) && leaseSeconds > 0 ? leaseSeconds * 1000 : 0;
  const owner = ownerId ?? `drv-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const steps = ready ? createSponsorSteps({ ledger, policy, chain, sponsor, preflight, log, nowMs, owner: leased ? owner : null, leaseMs, revokeMaxFailures, revokeBackoffSeconds }) : null;

  /** Run `fn` while holding the sponsor lease. Returns { busy:true } when another driver holds it (nothing done). */
  async function withLease(fn) {
    if (!leased) return fn();
    if (!(leaseMs > 0)) { say("lease_seconds_unknown"); return { busy: true }; }          // UNKNOWN number => injected, else nothing runs
    let got = false; try { got = (await ledger.acquireLease(owner, leaseMs)) === true; } catch { got = false; }
    if (!got) return { busy: true };
    try { return await fn(); } finally { try { await ledger.releaseLease(owner); } catch { /* expires on its own */ } }
  }

  /** [A-913 G] health body: sponsor balance vs floor = 2 x current claim gas estimate (policy claim units x current fee). ok:false => no NEW request starts. */
  async function health() {
    const reasons = [];
    let balance = null; let floor = null;
    if (!ready) return { ok: false, reasons: ["not_configured"], balanceWei: null, floorWei: null, preflight: null };
    try { balance = BigInt(await chain.getSponsorBalance()); } catch { reasons.push("balance_unreadable"); }
    try {
      const fee = await chain.getFeePerGasWei();
      if (typeof fee === "bigint" && fee > 0n) floor = 2n * policy.gasUnits.claim * fee; else reasons.push("fee_unknown");   // no fee input => never a default price
    } catch { reasons.push("fee_unreadable"); }
    if (balance !== null && floor !== null && balance < floor) reasons.push("below_floor");
    return { ok: reasons.length === 0, reasons, balanceWei: balance === null ? null : balance.toString(), floorWei: floor === null ? null : floor.toString(), preflight: typeof preflight.status === "function" ? preflight.status() : null };
  }

  /** Pure guards G1..G9 + chain-read guards G3,G10. Returns { ok:false, code } or { ok:true, plan }. */
  async function guard(v) {
    const { giftId, authorization: au, revokeAuthorization: rv, gasTx, delegation: d, claim: cl } = v;
    const p = policy;
    if (au.chainId === 0n || au.chainId !== BigInt(p.chainId)) return { code: "chainId" };                       // G1
    if (au.address !== p.delegateImpl) return { code: "delegate" };                                              // G2
    if ([p.escrow, p.delegationManager, p.sponsorAddress, ZERO].includes(d.delegator)) return { code: "delegator" };
    if (d.delegate !== p.sponsorAddress) return { code: "redeemer" };                                            // G5
    if (d.authority !== ROOT) return { code: "authority" };
    if (cl.recipient !== d.delegator) return { code: "recipient" };
    let signer;
    try { signer = await recoverAuthorizationAddress({ authorization: { address: au.address, chainId: Number(au.chainId), nonce: Number(au.nonce), r: au.r, s: au.s, yParity: au.yParity } }); }
    catch { return { code: "auth_sig" }; }
    if (lc(signer) !== d.delegator) return { code: "auth_signer" };                                              // G4
    // [A-913 D] revoke authorization: same chain, address 0x0 (clears the designator), nonce = install nonce + 1, signed by the same Piggy
    if (rv.chainId !== au.chainId) return { code: "revoke_chainId" };
    if (rv.address !== ZERO) return { code: "revoke_address" };
    if (rv.nonce !== au.nonce + 1n) return { code: "revoke_nonce" };
    let rsigner;
    try { rsigner = await recoverAuthorizationAddress({ authorization: { address: rv.address, chainId: Number(rv.chainId), nonce: Number(rv.nonce), r: rv.r, s: rv.s, yParity: rv.yParity } }); }
    catch { return { code: "revoke_sig" }; }
    if (lc(rsigner) !== d.delegator) return { code: "revoke_signer" };
    // G6 caveat set: exactly three known enforcers, once each, empty args
    const want = [p.exactExecutionEnforcer, p.limitedCallsEnforcer, p.timestampEnforcer];
    if (d.caveats.length !== 3 || want.some((e, i) => d.caveats[i].enforcer !== e) || d.caveats.some((c) => c.args !== "0x")) return { code: "caveats" }; // fixed order
    const byE = (e) => d.caveats.find((c) => c.enforcer === e).terms;
    // G7 exact execution: escrow only, value 0, commitClaim for THIS giftId, commit hash bound to recipient=delegator
    const commitHash = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes32" }], [getAddress(cl.recipient), cl.preimage, cl.salt]));
    const commitCall = encodeFunctionData({ abi: COMMIT_CLAIM_ABI, functionName: "commitClaim", args: [giftId, commitHash] });
    const exec = lc(encodePacked(["address", "uint256", "bytes"], [getAddress(p.escrow), 0n, commitCall]));
    if (byE(p.exactExecutionEnforcer) !== exec) return { code: "exact_execution" };
    if (byE(p.limitedCallsEnforcer) !== lc(encodeAbiParameters([{ type: "uint256" }], [1n]))) return { code: "limited_calls" }; // G8
    // chain-time reads
    let g; let now; let nonce; let codes;
    try {
      now = BigInt(await chain.getTimestamp());
      g = await chain.getGift(giftId);
      const addrs = [p.delegateImpl, p.delegationManager, p.exactExecutionEnforcer, p.limitedCallsEnforcer, p.timestampEnforcer, d.delegator];
      codes = await Promise.all(addrs.map((a) => chain.getCode(a)));
      nonce = BigInt(await chain.getNonce(d.delegator));
    } catch { return { code: "chain_read", unavailable: true }; }
    // G9 expiry (A-556 cap, injected <= 300) and never beyond the Gift's own expiry
    const t = byE(p.timestampEnforcer);
    if (!/^0x[0-9a-f]{64}$/.test(t)) return { code: "expiry_shape" };
    const after = BigInt(`0x${t.slice(2, 34)}`); const before = BigInt(`0x${t.slice(34)}`);
    if (before === 0n || before <= now || before - now > p.maxExpirySeconds || after !== 0n) return { code: "expiry" };
    if (cl.deadline <= now) return { code: "claim_deadline" };
    // G3 code hashes
    const pins = [p.implCodeHash, p.delegationManagerCodeHash, p.exactExecutionCodeHash, p.limitedCallsCodeHash, p.timestampCodeHash];
    if (pins.some((h, i) => codeHash(codes[i]) !== h)) return { code: "code_hash" };
    // delegator state: plain EOA or already our impl; either way the install authorization nonce must equal the Piggy's chain nonce
    // (the install tx is always sent: re-delegating to the same impl is harmless and consumes nonce n so the revoke authorization at n+1 is valid)
    const designator = lc(`0xef0100${p.delegateImpl.slice(2)}`);
    const dcode = typeof codes[5] === "string" ? lc(codes[5]) : "";
    if (!(dcode === "0x" || dcode === "" || dcode === designator)) return { code: "delegator_code" };
    if (au.nonce !== nonce) return { code: "auth_nonce" };
    // G5 delegation signature
    const message = { delegate: getAddress(d.delegate), delegator: getAddress(d.delegator), authority: d.authority, caveats: d.caveats.map(({ enforcer, terms }) => ({ enforcer: getAddress(enforcer), terms })), salt: d.salt };
    try {
      const rec = await recoverTypedDataAddress({ domain: { name: "DelegationManager", version: "1", chainId: p.chainId, verifyingContract: getAddress(p.delegationManager) }, types: TYPES, primaryType: "Delegation", message, signature: d.signature });
      if (lc(rec) !== d.delegator) return { code: "delegation_sig" };
    } catch { return { code: "delegation_sig" }; }
    // G10 escrow state
    const sender = g && typeof g.sender === "string" && ADDR.test(g.sender) ? lc(g.sender) : null;
    if (!g || g.exists !== true || g.claimed !== false || sender === null || typeof g.expiry !== "bigint" || g.expiry <= now || cl.deadline > g.expiry
      || sender === d.delegator || typeof g.claimTokenHash !== "string"
      || lc(g.claimTokenHash) !== `0x${createHash("sha256").update(Buffer.from(cl.preimage.slice(2), "hex")).digest("hex")}`) return { code: "gift" };
    if (before > g.expiry) return { code: "expiry" }; // the delegation never outlives the Gift (expiry = min(5 min, Gift deadline))
    // G10 (A-913): the SENDER's gas deposit was REGISTERED by the sender right after create (register()); the claim looks it up in the store and re-checks the receipt now.
    // A request that carries `gasTx` must match the stored hash. Nothing registered => fail closed.
    let stored;
    try { stored = typeof ledger.gasTxOf === "function" ? await ledger.gasTxOf(giftId) : null; } catch { return { code: "gas_deposit_read", unavailable: true }; }
    if (!stored) return { code: "gas_deposit_tx_missing" };
    if (gasTx !== null && gasTx !== stored) return { code: "gas_deposit_tx_mismatch" };
    const dep = await checkDeposit({ giftId, sender, hash: stored });
    if (!dep.ok) return dep;
    const depValue = dep.value;
    const record = {
      giftId, install: true, sender, depositTx: stored, depositValueWei: depValue.toString(), commitHash, beforeSeconds: before.toString(),
      authorization: { chainId: Number(au.chainId), address: au.address, nonce: Number(au.nonce), r: au.r, s: au.s, yParity: au.yParity },
      revokeAuthorization: { chainId: Number(rv.chainId), address: rv.address, nonce: Number(rv.nonce), r: rv.r, s: rv.s, yParity: rv.yParity },
      delegation: { delegate: d.delegate, delegator: d.delegator, authority: d.authority, caveats: d.caveats, salt: d.salt.toString(), signature: d.signature },
      claim: { recipient: cl.recipient, preimage: cl.preimage, salt: cl.salt, deadline: cl.deadline.toString() },
    };
    return { ok: true, plan: { install: true, record } };
  }

  /** Receipt check shared by register() and the claim guard: status success · from = the Gift's sender Piggy · to = pinned sponsor · data = giftId ·
   *  value >= minGasDepositWei(units x CURRENT fee x buffer). No fee input => unavailable (never a default price). */
  async function checkDeposit({ giftId, sender, hash }) {
    let fee;
    try { fee = await chain.getFeePerGasWei(); } catch { return { code: "fee_read", unavailable: true }; }
    const minDep = minGasDepositWei(policy, fee);
    if (minDep === null) return { code: "fee_unknown", unavailable: true };
    let tx;
    try { tx = typeof chain.getGasDepositTx === "function" ? await chain.getGasDepositTx(hash) : null; } catch { return { code: "gas_deposit_read", unavailable: true }; }
    let value = null;
    try { value = tx && (typeof tx.value === "bigint" || typeof tx.value === "string") ? BigInt(tx.value) : null; } catch { value = null; }
    if (!tx || tx.status !== "success" || typeof tx.to !== "string" || typeof tx.from !== "string" || typeof tx.data !== "string"
      || lc(tx.to) !== policy.sponsorAddress || lc(tx.from) !== sender || lc(tx.data) !== lc(giftId) || value === null || value < minDep) return { code: "gas_deposit" };
    return { ok: true, value };
  }

  /** [A-913 G10 (c)] Registration: the sender's app records giftId -> gasTx right after create. Record-and-read only (no new relayer authority, no send, no signing).
   *  Same giftId + same hash = no-op (200 already); a different hash for the giftId, or a hash already registered for another giftId = 409. */
  async function register(body) {
    const withLetter = hasOnly(body, ["action", "giftId", "gasTx", "note", "letterHash"]);
    if (!((withLetter || hasOnly(body, ["action", "giftId", "gasTx"])) && body.action === "register_gas_tx" && typeof body.giftId === "string" && B32.test(body.giftId) && typeof body.gasTx === "string" && B32.test(lc(body.gasTx)))) return BAD();
    if (withLetter) {
      if (typeof body.note !== "string" || body.note.length > 140 || typeof body.letterHash !== "string" || !/^[0-9a-f]{64}$/.test(body.letterHash) || createHash("sha256").update(body.note).digest("hex") !== body.letterHash) return BAD();
      const parts = body.note.split("\n");
      if (parts.length !== 4 || !["01", "02", "04"].includes(parts[0]) || parts[1].length > 80 || parts[2].length > 140 || parts[3].length > 40 || body.note.includes("\r") || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(body.note)) return BAD();
    }
    if (!ready || typeof ledger.registerGasTx !== "function" || (withLetter && typeof ledger.registerLetter !== "function")) return UNAVAIL_NOT_SENT();
    const giftId = body.giftId; const hash = lc(body.gasTx);
    let g;
    try { g = await chain.getGift(giftId); } catch { return UNAVAIL_NOT_SENT(); }
    const sender = g && typeof g.sender === "string" && ADDR.test(g.sender) ? lc(g.sender) : null;
    if (!g || g.exists !== true || g.claimed !== false || sender === null) { say("register_refused(gift)", giftId); return NA(); }
    let prior; try { prior = await ledger.gasTxOf(giftId); } catch { return UNAVAIL_NOT_SENT(); }
    const letter = withLetter ? { note: body.note, letterHash: body.letterHash } : null;
    if (prior && prior === hash) {
      if (letter) { let lr; try { lr = await ledger.registerLetter(giftId, letter); } catch { return UNAVAIL_NOT_SENT(); } if (lr === "conflict") return NA(); }
      say("register_noop", giftId); return { status: 200, body: { ok: true, registered: true, already: true, giftId } };
    }
    if (prior) { say("register_refused(different_hash)", giftId); return NA(); }
    const dep = await checkDeposit({ giftId, sender, hash });
    if (!dep.ok) { say(`register_refused(${dep.code})`, giftId); return dep.unavailable ? UNAVAIL_NOT_SENT() : NA(); }
    let res; try { res = await ledger.registerGasTx(giftId, hash); } catch { return UNAVAIL_NOT_SENT(); }
    if (res === "created" || res === "same") {
      if (letter) { let lr; try { lr = await ledger.registerLetter(giftId, letter); } catch { return UNAVAIL_NOT_SENT(); } if (lr === "conflict") return NA(); }
      say("register_ok", giftId); return { status: 200, body: { ok: true, registered: true, already: res === "same", giftId } };
    }
    say(`register_refused(${res})`, giftId); return NA();
  }

  async function readLetter(body) {
    if (!(hasOnly(body, ["action", "giftId"]) && body.action === "read_letter" && typeof body.giftId === "string" && B32.test(body.giftId))) return BAD();
    if (!ready || typeof ledger.letterOf !== "function") return UNAVAIL_NOT_SENT();
    let g; let letter;
    try { g = await chain.getGift(body.giftId); letter = await ledger.letterOf(body.giftId); } catch { return UNAVAIL_NOT_SENT(); }
    if (!g || g.exists !== true || !letter || typeof g.amount !== "bigint" || g.amount <= 0n) return NA();
    return { status: 200, body: { ok: true, giftId: body.giftId, note: letter.note, letterHash: letter.letterHash, amountAtomic: g.amount.toString(), decimals: 6 } };
  }

  async function processRequest(v) {
    if (!ready) { say("not_ready"); return UNAVAIL_NOT_SENT(); }
    let existing; try { existing = await ledger.get(v.giftId); } catch { return UNAVAIL_NOT_SENT(); }
    if (existing) { say("refused_dup", v.giftId); return NA(); }                                                  // G11
    const h = await health();
    if (!h.ok) { say(`refused_health(${h.reasons.join(",")})`, v.giftId); return UNAVAIL_NOT_SENT(); }          // balance floor / unknown fee
    // [A-913 F] code-hash preflight BEFORE the guards: a swapped contract is a 503 (unavailable_not_sent), never a per-request 409 refusal
    let pfOk = false; try { pfOk = (await preflight()) === true; } catch { pfOk = false; }
    if (!pfOk) { say("refused_preflight", v.giftId); return UNAVAIL_NOT_SENT(); }
    const gr = await guard(v);
    if (!gr.ok) { say(`refused(${gr.code})`, v.giftId); return gr.unavailable ? UNAVAIL_NOT_SENT() : NA(); }
    const { plan } = gr;
    const id = v.giftId;
    const out = await withLease(async () => {
      try { await ledger.reserve(id, plan.record); } catch { say("refused_dup", id); return NA(); }
      // simulate the redeem BEFORE any send (delegator code overridden to the delegation designator when not installed yet)
      try { await steps.simulateRedeem(id); } catch { try { await ledger.release(id); } catch { /* stays RESERVED */ } say("sim_redeem_failed", id); return UNAVAIL_NOT_SENT(); }
      let installTxHash = null; let sent = false;
      try {
        const ins = await steps.install(id); installTxHash = ins.txHash; sent = true;
        const red = await steps.commit(id);
        const rv = await steps.revoke(id);                                                                        // best effort, BEFORE claim, never blocks
        const cl = await steps.claim(id);
        say("claimed", id);
        return { status: 200, body: { ok: true, state: "CLAIMED", giftId: id, installTxHash, commitTxHash: red.txHash, revoke: rv, revokeTxHash: (await ledger.get(id))?.revokeTx ?? null, claimTxHash: cl.txHash, txHash: cl.txHash } };
      } catch (err) {
        if (err instanceof SponsorStepError && err.notSent) {
          if (!sent) { try { await ledger.mark(id, { inflight: null }); await ledger.release(id); } catch { /* stays RESERVED: reconcile archives it */ } say(`halted_before_send(${err.code})`, id); return UNAVAIL_NOT_SENT(); }
          try { await ledger.mark(id, { inflight: null }); } catch { /* failstop */ }
          say(`halted_not_sent(${err.code})`, id); return UNAVAIL();                                            // earlier steps landed: reconcile continues from chain truth
        }
        try { await ledger.update(id, "UNKNOWN"); } catch { /* failstop */ }
        say("unknown_after_reserve", id);
        return UNAVAIL(); // ambiguous: reconcile reads chain truth first, never an automatic resend
      }
    });
    if (out && out.busy === true) { say("busy", id); return UNAVAIL_NOT_SENT(); }                              // another driver holds the sponsor lease: nothing was reserved
    return out;
  }

  return {
    handle: (body) => {
      const v = validateGiftSponsorRequest(body);
      if (!v) return Promise.resolve(BAD());
      if (pending >= cap) { say("queue_full"); return Promise.resolve(UNAVAIL_NOT_SENT()); }
      return enqueue(async () => { try { return await processRequest(v); } catch { say("internal_error", v.giftId); return UNAVAIL(); } });
    },
    health,
    steps,
    ready,
    register: (body) => (pending >= cap ? Promise.resolve(UNAVAIL_NOT_SENT()) : enqueue(async () => { try { return await register(body); } catch { return UNAVAIL_NOT_SENT(); } })),
    readLetter: (body) => (pending >= cap ? Promise.resolve(UNAVAIL_NOT_SENT()) : enqueue(async () => { try { return await readLetter(body); } catch { return UNAVAIL_NOT_SENT(); } })),
    /** Run `fn` inside this instance's queue AND the cross-instance lease (the reconciler uses it so a pass never interleaves with a live claim). */
    runExclusive: (fn) => enqueue(() => withLease(fn)),
  };
}

// ─── route (same A-874/A-887 boundary as /gift-gas: deny-all auth hook, exact Origin list, JSON only, deadlines) ───
export const GIFT_SPONSOR_MAX_BODY_BYTES = 16384;
const CT = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const ORIGIN_SHAPE = /^https?:\/\/[^\s/?#]+$/;
function out(res, status, body, close = false) {
  if (res.writableEnded || res.headersSent) return;
  const h = { "content-type": "application/json", "cache-control": "no-store" };
  if (close) h.connection = "close";
  res.writeHead(status, h); res.end(JSON.stringify(body));
}

export function createGiftSponsorRoute(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const log = typeof c.log === "function" ? c.log : () => {};
  const say = (code) => { try { log(`gift-sponsor route ${code}`); } catch { /* ignore */ } };
  const authorize = typeof c.authorize === "function" ? c.authorize : () => false;
  const origins = new Set((Array.isArray(c.allowedOrigins) ? c.allowedOrigins : []).filter((o) => typeof o === "string" && ORIGIN_SHAPE.test(o)));
  const policy = c.policy && typeof c.policy === "object" ? c.policy : null;
  const configured = !!(c.service && typeof c.service.handle === "function")
    || !!(c.ledger && typeof c.ledger.reserve === "function" && policy && c.chain && c.sponsor && typeof c.sponsor.send === "function" && typeof c.preflight === "function");
  // [A-913] a prebuilt `service` (server.mjs shares it with the reconciler so both use ONE serialized queue); otherwise built here. No preflight => not configured => 503.
  const service = c.service && typeof c.service.handle === "function" ? c.service
    : (configured ? createGiftSponsorService({ ledger: c.ledger, policy, chain: c.chain, sponsor: c.sponsor, preflight: c.preflight, log, maxQueue: c.maxQueue, nowMs: c.nowMs }) : null);
  const dl = (v, d) => (Number.isSafeInteger(v) && v >= 1 && v <= 60000 ? v : d);
  const authMs = dl(c.authTimeoutMs, 3000); const bodyMs = dl(c.bodyTimeoutMs, 5000);
  const reject = (res, s, e, code) => { say(code); out(res, s, { ok: false, error: e }, true); };

  const giftSponsorRoute = function giftSponsorRoute(req, res) {
    if (req.method !== "POST") return reject(res, 405, "method not allowed", "rejected(method)");
    if (!service) return reject(res, 503, "unavailable", "rejected(not configured)");
    const h = req.headers ?? {};
    if (h.origin !== undefined && !origins.has(h.origin)) return reject(res, 403, "forbidden", "rejected(origin)");
    if (h.origin === undefined && h["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(h["sec-fetch-site"])) return reject(res, 403, "forbidden", "rejected(fetch-site)");
    if (typeof h["content-type"] !== "string" || !CT.test(h["content-type"].trim())) return reject(res, 415, "unsupported media type", "rejected(content-type)");
    if (h["content-length"] !== undefined) {
      const n = /^[0-9]{1,6}$/.test(String(h["content-length"])) ? Number(h["content-length"]) : NaN;
      if (Number.isNaN(n)) return reject(res, 400, "bad_request", "rejected(content-length)");
      if (n > GIFT_SPONSOR_MAX_BODY_BYTES) return reject(res, 413, "payload too large", "rejected(size)");
    }
    void (async () => {
      let allowed = false; let timer = null;
      try {
        const timeout = new Promise((r) => { timer = setTimeout(() => r(false), authMs); });
        allowed = (await Promise.race([Promise.resolve(authorize(Object.freeze({ method: req.method, url: req.url, headers: Object.freeze({ ...h }) }))), timeout])) === true;
      } catch { allowed = false; } finally { if (timer !== null) clearTimeout(timer); }
      if (!allowed) return reject(res, 401, "unauthorized", "rejected(unauthorized)");
      const chunks = []; let size = 0; let closed = false;
      const bt = setTimeout(() => { if (closed) return; closed = true; reject(res, 408, "request timeout", "rejected(body timeout)"); req.destroy(); }, bodyMs);
      req.on("error", () => { closed = true; clearTimeout(bt); });
      req.on("close", () => clearTimeout(bt));
      req.on("data", (chunk) => {
        if (closed) return;
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += b.length;
        if (size > GIFT_SPONSOR_MAX_BODY_BYTES) { closed = true; clearTimeout(bt); reject(res, 413, "payload too large", "rejected(size)"); req.destroy(); return; }
        chunks.push(b);
      });
      req.on("end", () => {
        clearTimeout(bt);
        if (closed) return;
        closed = true;
        void (async () => {
          let parsed;
          try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { return reject(res, 400, "bad_request", "rejected(json)"); }
          let r; try { r = await service.handle(parsed); } catch { r = null; }
          if (!r || !Number.isInteger(r.status) || typeof r.body !== "object" || r.body === null) { say("service_error"); return out(res, 503, { ok: false, error: "unavailable" }); }
          return out(res, r.status, r.body);
        })();
      });
    })();
  };
  giftSponsorRoute.service = service;
  return giftSponsorRoute;
}
