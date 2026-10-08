// [A-559 PHASE S1] **Gift claim product entry seam** — pure, testable, no DOM.
//
// This file does not invent a record source, a provider, or a signed-fragment model. It
// only wires the existing `gift-piggy-claim-link.js` contract (A-495) to the two places a
// product boot needs it:
//   1) reading the claim URL fragment (pointer + capability, never a record itself), and
//   2) driving `openClaimLink`/`settleClaim` once a caller supplies a `recordSource`.
//
// `recordSource` is an **injected seam** — main.js's product default is `GIFT_RECORD_SOURCE =
// null` (same pattern as A-554's `INDEX_BACKUP_ADAPTER = null`). No durable gift record store
// exists in this repo (no address/ABI for the recovered GiftPiggy contract, no server, no
// sender-signed-fragment support in the fragment format itself). When
// `recordSource` is null, `beginGiftClaim` says so honestly (`record_source_unavailable`)
// instead of guessing, fabricating a record, or quietly falling back to some other shape.
//
// Nothing here persists or logs the raw claim token. `settleGiftClaim` signs/recovers exactly
// the way `gift-claim-wallet-birth.mjs` already proved (claimStatement → sign → recover →
// settleClaim) — no new verification rule is invented.

import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from "viem";
import {
  CLAIM_RESULT,
  attachTransferReceipt,
  claimParties,
  claimStatement,
  hashClaimToken,
  openClaimLink,
  parseClaimUrl,
  settleClaim,
} from "./gift-piggy-claim-link.js";
import { GIFT_GAS_BUDGET_STATUS, GIFT_GAS_POLICY, giftGasBudget } from "./gift-value-spec.js";
import { scopeForChainId } from "./funding-context.js";
import { GIFT_GAS_LEDGER_REASON, createGiftGasLedger, createMemoryGiftGasStore } from "./gift-gas-ledger.js";
// [A-883] Receipt evidence sidecar: mapping only. Never a substitute for the giftId gas ledger above.
import { isGiftGasClient } from "./gift-gas-client.js";
import { mapGiftEvidence } from "./receipt-evidence-gift.js";
// [A-906] 7702 sponsor-submit claim path (default OFF: config null => the A-887 /gift-gas path above stays the only path).
import { GIFT_SPONSOR_REFUSAL, createGiftSponsorSession, normalizeGiftSponsorConfig } from "./gift-sponsor-7702.js";

export const GIFT_ENTRY_STATUS = Object.freeze({
  NO_FRAGMENT: "no_fragment", // 링크 자체가 없다 — 평범한 부팅.
  MALFORMED: "malformed", // fragment 는 있지만 형식이 깨졌다(버전/토큰 모양/giftId 없음).
  RECORD_SOURCE_UNAVAILABLE: "record_source_unavailable", // 제품 기본값 — 진짜 외부 blocker.
  UNKNOWN_LINK: "unknown_link", // record source 는 있지만 이 giftId 에 대해 아무것도 없다.
  REFUSED: "refused", // openClaimLink 가 OK 가 아닌 CLAIM_RESULT 를 냈다(bad_token/expired/revoked/already_claimed_by_other).
  READY: "ready", // 열 수 있다 — 아직 정체성/인증은 아무것도 만들지 않았다.
});

/**
 * 받는 쪽이 연 URL(fragment 포함)을 읽는다. `parseClaimUrl`(A-495) 그대로 쓴다 — 새 파서 0.
 * 링크가 없으면 NO_FRAGMENT(평범한 부팅), 있지만 깨졌으면 MALFORMED — 둘 다 조용히 고치지 않는다.
 */
export function readClaimFragment(href) {
  const parsed = parseClaimUrl(href);
  if (!parsed.ok) {
    if (parsed.reason === "no_fragment" || parsed.reason === "empty") {
      return { status: GIFT_ENTRY_STATUS.NO_FRAGMENT, reason: parsed.reason };
    }
    return { status: GIFT_ENTRY_STATUS.MALFORMED, reason: parsed.reason };
  }
  return { status: GIFT_ENTRY_STATUS.READY, giftId: parsed.giftId, token: parsed.token };
}

/**
 * `pending` 는 `readClaimFragment()` 의 READY 결과 그대로다. `recordSource` 는 호출자(main.js)가
 * 주입하는 seam — 제품 기본값은 `null`이고, 그 경우 여기서 **멈춘다**: Piggy 도 인증도 만들지
 * 않는다. 이게 곧 PHASE S3 의 정확한 외부 blocker다. record source 가 있으면 그 giftId 로 레코드를
 * 가져와 `openClaimLink`(A-495)에 그대로 맡긴다 — 만료/폐기/토큰불일치/이미claim됨 판정은 여기서
 * 다시 만들지 않는다.
 */
export async function beginGiftClaim({ pending, recordSource, now } = {}) {
  if (!pending || pending.status !== GIFT_ENTRY_STATUS.READY) {
    return { status: GIFT_ENTRY_STATUS.NO_FRAGMENT };
  }
  if (!recordSource || typeof recordSource.getRecordByGiftId !== "function") {
    return { status: GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE, giftId: pending.giftId };
  }
  let record;
  try {
    record = await recordSource.getRecordByGiftId(pending.giftId);
  } catch {
    // record source 가 있지만 응답하지 못했다 — 추측으로 다른 상태를 지어내지 않는다.
    return { status: GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE, giftId: pending.giftId };
  }
  if (!record) return { status: GIFT_ENTRY_STATUS.UNKNOWN_LINK, giftId: pending.giftId };
  const opened = await openClaimLink(record, pending.token, { now });
  if (opened.result !== CLAIM_RESULT.OK) {
    // `record` rides along even on refusal — `openClaimLink` cannot yet tell "the same
    // recipient reopening their own already-claimed link" from "a stranger replaying it"
    // (it doesn't know who is asking). The caller, once it has a real recipient identity
    // (post-auth), can make that distinction itself against `record.recipientAddress` —
    // see main.js's settlePendingGiftClaimIfAny(), which reuses this same CLAIM_RESULT
    // constant rather than inventing a new one.
    return { status: GIFT_ENTRY_STATUS.REFUSED, reason: opened.result, giftId: pending.giftId, record };
  }
  return { status: GIFT_ENTRY_STATUS.READY, record, token: pending.token, giftId: pending.giftId };
}

/**
 * claim 을 닫는다. **호출자가 이미 실제 서명자로 `claimStatement`에 서명해 `signature`를 만든
 * 뒤**에만 부른다. 이 함수는 그 서명을 `recover()`로 복구해 검증하고, 나머지 전부(가장 거부·
 * sender==recipient 거부·replay 거부·값 이동 not_attempted 유지)는 `settleClaim()`(A-495)의
 * 기존 규율에 그대로 맡긴다 — 새 규칙을 만들지 않는다. 성공하면 `claimParties`도 함께 돌려준다.
 */
export async function settleGiftClaim({
  record,
  token,
  recipientAddress,
  signature,
  recover,
  claimedAt,
  now,
  signatureFingerprint = null,
} = {}) {
  const at = typeof claimedAt === "string" && claimedAt ? claimedAt : new Date(now ?? Date.now()).toISOString();
  // [A-560 PHASE 2] 값 필드는 `record.value`(레코드 자신이 들고 온 권위 있는 값)에서만 온다 —
  // 이 함수의 다른 어떤 매개변수도 금액/자산을 받지 않는다. 그래야 recipient 가 실제로 서명한
  // 문장과, 여기서 recover 에 넘기는 문장이 항상 레코드의 진짜 값을 기준으로 일치한다.
  const statement = claimStatement({
    giftId: record?.giftId,
    chainId: record?.chainId,
    senderAddress: record?.senderAddress,
    recipientAddress,
    claimTokenHash: record?.claimTokenHash,
    claimedAt: at,
    tokenAddress: record?.value?.tokenAddress ?? null,
    decimals: record?.value?.decimals ?? null,
    amountAtomic: record?.value?.amountAtomic ?? null,
  });
  if (!statement) return { result: CLAIM_RESULT.UNKNOWN_LINK, record };
  if (typeof recover !== "function") return { result: CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE, record };
  let verifiedSignerAddress;
  try {
    verifiedSignerAddress = await recover({ message: statement, signature });
  } catch {
    return { result: CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE, record };
  }
  const settled = await settleClaim(record, {
    token,
    recipientAddress,
    verifiedSignerAddress,
    signatureFingerprint,
    claimedAt: at,
    now: now ?? at,
  });
  if (settled.result !== CLAIM_RESULT.OK) return settled;
  return { ...settled, claimParties: claimParties(settled.record) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [A-579 Lane G] **Gift ↔ NEW Gift Piggy binding + commit→claim submission adapter.**
//
// Product/security canon kept (A-567/A-570/A-574/A-575/A-577):
//   · the recipient receives the Gift into a NEWLY-created Gift Piggy — never an existing one;
//   · A commit-reveal: the Gift Piggy itself signs `commitClaim(giftId, commitHash)`, then, at
//     least one block later, `claim(giftId, committer, recipient, preimage, salt, deadline)` with
//     committer == recipient == that new Piggy;
//   · Path A gas: the SENDER funds value + gas; the gas layer delivers MON to the Gift Piggy only
//     after that Piggy's address exists; the recipient is never asked to preload MON;
//   · the gas layer is delivery-only: it never chooses the recipient, never signs, never issues
//     an entitlement. It receives exactly `{ allowanceRef, to, valueWei }` and only its txHash is
//     used — and even that is re-verified on chain before anything relies on it.
// Nothing here is wired to a production transport: main.js keeps `GIFT_CLAIM_SUBMIT_CONFIG = null`.

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const lowerAddr = (a) => (typeof a === "string" ? a.toLowerCase() : "");

// Registry of bindings this module itself minted. A look-alike object built elsewhere (same
// fields, spread copy, JSON round-trip) is NOT a binding — isGiftBinding() says no.
const GIFT_BINDINGS = new WeakSet();
// Each pending intent object may be bound exactly once (one Gift → one new Piggy).
const BOUND_INTENTS = new WeakSet();

export const GIFT_BINDING_REFUSAL = Object.freeze({
  NO_GIFT_INTENT: "no_gift_intent",
  INTENT_ALREADY_BOUND: "intent_already_bound",
  BAD_PIGGY_ADDRESS: "bad_piggy_address",
  MISSING_PRE_EXISTING_SET: "missing_pre_existing_set",
  NOT_NEWLY_CREATED_PIGGY: "not_newly_created_piggy",
  SIGNER_NOT_NEW_PIGGY: "signer_not_new_piggy",
  MISSING_MODEL_A_SEQUENCE: "missing_model_a_sequence",
});

/**
 * Binds the pending Gift intent (taken at the START of a Piggy-creation flow) to the Piggy that
 * flow just created. Refuses unless: the intent is real and unbound, the Piggy address is
 * well-formed, it was NOT among the addresses known before the flow started, the live signer that
 * just derived it IS that address, and (for Model-A `+Piggy`-style births) it carries a sequence.
 * The returned binding is frozen, carries no token/secret, and is registered so only
 * module-minted bindings pass `isGiftBinding()`.
 */
export function bindGiftToNewPiggy({ intent, piggy, preExistingAddresses, signerAddress, requireSequence = false, now = () => new Date().toISOString() } = {}) {
  const R = GIFT_BINDING_REFUSAL;
  if (!intent || typeof intent !== "object" || typeof intent.giftId !== "string" || !intent.giftId) return { ok: false, reason: R.NO_GIFT_INTENT };
  if (BOUND_INTENTS.has(intent)) return { ok: false, reason: R.INTENT_ALREADY_BOUND };
  const address = typeof piggy?.address === "string" ? piggy.address.trim() : "";
  if (!ADDR_RE.test(address)) return { ok: false, reason: R.BAD_PIGGY_ADDRESS };
  let before;
  try {
    before = preExistingAddresses instanceof Set || Array.isArray(preExistingAddresses) ? [...preExistingAddresses] : null;
  } catch {
    before = null;
  }
  if (!before) return { ok: false, reason: R.MISSING_PRE_EXISTING_SET };
  if (before.some((a) => lowerAddr(a) === lowerAddr(address))) return { ok: false, reason: R.NOT_NEWLY_CREATED_PIGGY };
  if (!ADDR_RE.test(String(signerAddress || "")) || lowerAddr(signerAddress) !== lowerAddr(address)) return { ok: false, reason: R.SIGNER_NOT_NEW_PIGGY };
  const sequence = Number.isSafeInteger(piggy?.sequence) && piggy.sequence >= 1 ? piggy.sequence : null;
  if (requireSequence && sequence === null) return { ok: false, reason: R.MISSING_MODEL_A_SEQUENCE };
  const binding = Object.freeze({
    giftId: intent.giftId,
    recipientAddress: address,
    piggyId: typeof piggy?.id === "string" ? piggy.id : null,
    sequence,
    boundAt: typeof now === "function" ? now() : new Date().toISOString(),
  });
  GIFT_BINDINGS.add(binding);
  BOUND_INTENTS.add(intent);
  return { ok: true, binding };
}

export function isGiftBinding(binding) {
  return !!binding && typeof binding === "object" && GIFT_BINDINGS.has(binding);
}

// ── [A-897] Release-2 scope note + same-#1 binding ───────────────────────────────────────────────
// "NEW Gift Piggy" above is the rule for case ③ (a mainnet Piggy already exists, a later Gift arrives): unchanged.
// Case ② (the SAME #1 finished the First Journey on testnet, now opening its Gift on mainnet) does NOT create a
// Piggy: the Gift binds to that existing #1 after piggy-index.js promoteFirstPiggyToScope() admitted the same
// row into the mainnet scope. This binding is the only way a Gift binds to a Piggy that was known before the flow.
// It is NOT bindGiftToNewPiggy relaxed — every other caller still gets NOT_NEWLY_CREATED_PIGGY for a known address.
export const GIFT_PROMOTION_REFUSAL = Object.freeze({
  NOT_PROMOTED_FIRST: "not_promoted_first",
  PROMOTION_ADDRESS_MISMATCH: "promotion_address_mismatch",
});

export function bindGiftToPromotedFirstPiggy({ intent, piggy, signerAddress, now = () => new Date().toISOString() } = {}) {
  const R = GIFT_BINDING_REFUSAL;
  const P = GIFT_PROMOTION_REFUSAL;
  if (!intent || typeof intent !== "object" || typeof intent.giftId !== "string" || !intent.giftId) return { ok: false, reason: R.NO_GIFT_INTENT };
  if (BOUND_INTENTS.has(intent)) return { ok: false, reason: R.INTENT_ALREADY_BOUND };
  const address = typeof piggy?.address === "string" ? piggy.address.trim() : "";
  if (!ADDR_RE.test(address)) return { ok: false, reason: R.BAD_PIGGY_ADDRESS };
  // Only the promoted first Piggy (#1): a promotion stamp on the row, and never a sequenced row.
  if (typeof piggy?.promotedAt !== "string" || !piggy.promotedAt || (piggy.sequence !== undefined && piggy.sequence !== null)) return { ok: false, reason: P.NOT_PROMOTED_FIRST };
  if (!ADDR_RE.test(String(signerAddress || "")) || lowerAddr(signerAddress) !== lowerAddr(address)) return { ok: false, reason: R.SIGNER_NOT_NEW_PIGGY };
  const binding = Object.freeze({
    giftId: intent.giftId,
    recipientAddress: address,
    piggyId: typeof piggy?.id === "string" ? piggy.id : null,
    sequence: null,
    promotedFirst: true,
    boundAt: typeof now === "function" ? now() : new Date().toISOString(),
  });
  GIFT_BINDINGS.add(binding);
  BOUND_INTENTS.add(intent);
  return { ok: true, binding };
}

// ── [A-897] First Journey evidence reader (testnet 10143 · read-only · injected rpc · never throws) ─────────────────
// Question: "did this address finish the First Journey (shMON deposit -> redeem round trip) on testnet?"
// Ladder (Owner 2026-10-08, INBOX A-897 "Q1 Owner 결정"; receipts/A897_release2_promotion/EVIDENCE.md):
//   C4  local D/R hashes verified on chain (exact)                        -> HAS or inconclusive
//   C6  chain-log pair (Deposit/Withdraw owner = A)                       -> NOT FEASIBLE (eth_getLogs limited to 100 blocks,
//                                                                            no deployment block, no indexer allowed) - skipped
//   C5  weak fallback - Owner 2026-10-08 conditional approval (only because C6 is impossible):
//       finalized nonce N and SHMON.balanceOf(A)=S;  N>=2 and S==0 -> HAS · N==0 -> confirmed none · otherwise none
//   anything unreadable / malformed / wrong chain                         -> UNKNOWN  (caller: Gift stays unopened, retry)
// The verdict picks a branch only. It is never shown, never a balance, never a state. Gift money goes to the same #1 in every branch.
export const FIRST_JOURNEY_EVIDENCE = Object.freeze({ HAS: "has", NONE: "none_confirmed", UNKNOWN: "unknown" });
export const FIRST_JOURNEY_RPC_WHITELIST = Object.freeze(["eth_chainId", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getBlockByNumber", "eth_call"]);
const HASH32_RE = /^0x[0-9a-fA-F]{64}$/;
const HEXQ_RE = /^0x[0-9a-fA-F]+$/;
// ERC-4626 topic0 (EVIDENCE.md section 1): present as constants in the SHMON implementation bytecode.
export const SHMON_DEPOSIT_TOPIC0 = keccak256(stringToHex("Deposit(address,address,uint256,uint256)"));
export const SHMON_WITHDRAW_TOPIC0 = keccak256(stringToHex("Withdraw(address,address,address,uint256,uint256)"));
const FJ_ABI = Object.freeze([
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
]);
const BALANCE_OF_SELECTOR = "0x70a08231";
const fjUnknown = (reason, via = null) => ({ verdict: FIRST_JOURNEY_EVIDENCE.UNKNOWN, reason, via });
const topicAddr = (a) => `0x${"0".repeat(24)}${lowerAddr(a).slice(2)}`;
const hexBig = (v) => (typeof v === "string" && HEXQ_RE.test(v) && v.length <= 66 ? BigInt(v) : null);

async function fjCall(rpc, method, params) {
  if (!FIRST_JOURNEY_RPC_WHITELIST.includes(method) || typeof rpc !== "function") return { ok: false };
  try { return { ok: true, value: await rpc(method, params) }; } catch { return { ok: false }; }
}

// C4 for one tx: returns { ok:true, tx, receipt } when the on-chain facts match, { ok:false, reason, hard } otherwise.
// hard=true -> the RPC itself failed (UNKNOWN); hard=false -> the chain answered but the hash does not prove it (inconclusive).
async function fjVerifyTx(rpc, hash, { kind, address, shmon, depositWei, finalizedNumber }) {
  const rc = await fjCall(rpc, "eth_getTransactionReceipt", [hash]);
  if (!rc.ok) return { ok: false, hard: true, reason: "rpc_error" };
  const r = rc.value;
  if (r === null || r === undefined) return { ok: false, hard: false, reason: "receipt_absent" };
  if (!r || typeof r !== "object" || String(r.transactionHash || "").toLowerCase() !== hash.toLowerCase()) return { ok: false, hard: true, reason: "receipt_malformed" };
  const status = hexBig(r.status);
  const bn = hexBig(r.blockNumber);
  if (status !== 1n || bn === null || !HASH32_RE.test(String(r.blockHash || ""))) return { ok: false, hard: false, reason: "receipt_not_success" };
  if (bn > finalizedNumber) return { ok: false, hard: true, reason: "not_finalized_yet" };
  const blk = await fjCall(rpc, "eth_getBlockByNumber", ["0x" + bn.toString(16), false]);
  if (!blk.ok || !blk.value || typeof blk.value !== "object") return { ok: false, hard: true, reason: "rpc_error" };
  if (String(blk.value.hash || "").toLowerCase() !== String(r.blockHash).toLowerCase()) return { ok: false, hard: false, reason: "canonical_mismatch" };
  const tx = await fjCall(rpc, "eth_getTransactionByHash", [hash]);
  if (!tx.ok) return { ok: false, hard: true, reason: "rpc_error" };
  const t = tx.value;
  if (!t || typeof t !== "object" || String(t.hash || "").toLowerCase() !== hash.toLowerCase()) return { ok: false, hard: true, reason: "tx_malformed" };
  if (lowerAddr(t.from) !== lowerAddr(address) || lowerAddr(t.to) !== lowerAddr(shmon)) return { ok: false, hard: false, reason: "from_or_to_mismatch" };
  let decoded;
  try { decoded = decodeFunctionData({ abi: FJ_ABI, data: t.input }); } catch { return { ok: false, hard: false, reason: "selector_mismatch" }; }
  if (kind === "deposit") {
    if (decoded.functionName !== "deposit" || lowerAddr(decoded.args[1]) !== lowerAddr(address)) return { ok: false, hard: false, reason: "deposit_args_mismatch" };
    if (depositWei !== null && hexBig(t.value) !== depositWei) return { ok: false, hard: false, reason: "deposit_value_mismatch" };
  } else {
    if (decoded.functionName !== "redeem" || lowerAddr(decoded.args[1]) !== lowerAddr(address) || lowerAddr(decoded.args[2]) !== lowerAddr(address)) return { ok: false, hard: false, reason: "redeem_args_mismatch" };
  }
  // The receipt must carry the matching ERC-4626 event from SHMON with owner = A (Deposit topic2 · Withdraw topic3). No getLogs.
  const topic0 = kind === "deposit" ? SHMON_DEPOSIT_TOPIC0 : SHMON_WITHDRAW_TOPIC0;
  const ownerIdx = kind === "deposit" ? 2 : 3;
  const logs = Array.isArray(r.logs) ? r.logs : [];
  const hit = logs.some((l) => l && lowerAddr(l.address) === lowerAddr(shmon) && Array.isArray(l.topics) && String(l.topics[0] || "").toLowerCase() === topic0 && String(l.topics[ownerIdx] || "").toLowerCase() === topicAddr(address));
  if (!hit) return { ok: false, hard: false, reason: "event_missing" };
  return { ok: true, nonce: hexBig(t.nonce) };
}

/**
 * @param {object} p
 * @param {Function} p.rpc          injected read-only `async (method, params) => result` for the TESTNET (10143). null/absent -> UNKNOWN.
 * @param {string}   p.address      the #1 address recomputed from the passkey (never from storage alone)
 * @param {string}   p.shmon        SHMON proxy address
 * @param {number}   [p.chainId]    10143
 * @param {bigint}   [p.depositWei] expected msg.value of D (0.001 MON); null skips the value check
 * @param {Array}    [p.localHashes] [{ depositTxHash, redeemTxHash }] from the local Receipt store (confirm-only; may be empty)
 */
export async function readFirstJourneyEvidence({ rpc, address, shmon, chainId = 10143, depositWei = null, localHashes = [] } = {}) {
  try {
    const E = FIRST_JOURNEY_EVIDENCE;
    if (typeof rpc !== "function") return fjUnknown("no_testnet_reader");
    if (!ADDR_RE.test(String(address || "")) || !ADDR_RE.test(String(shmon || ""))) return fjUnknown("bad_address");
    const cid = await fjCall(rpc, "eth_chainId", []);
    if (!cid.ok) return fjUnknown("rpc_error");
    const live = hexBig(cid.value);
    if (live === null || live !== BigInt(chainId)) return fjUnknown("chain_mismatch");
    const fin = await fjCall(rpc, "eth_getBlockByNumber", ["finalized", false]);
    const finalizedNumber = fin.ok && fin.value && typeof fin.value === "object" ? hexBig(fin.value.number) : null;
    if (finalizedNumber === null) return fjUnknown("finality_unreadable");

    // C4 — local hashes, verified on chain. Local data only supplies the hashes; the chain decides.
    const pairs = Array.isArray(localHashes) ? localHashes.filter((h) => h && HASH32_RE.test(String(h.depositTxHash || "")) && HASH32_RE.test(String(h.redeemTxHash || ""))) : [];
    for (const pair of pairs.slice(0, 3)) {
      const ctx = { address, shmon, depositWei, finalizedNumber };
      const d = await fjVerifyTx(rpc, pair.depositTxHash, { ...ctx, kind: "deposit" });
      if (!d.ok && d.hard) return fjUnknown(d.reason, "c4");
      if (!d.ok) continue;
      const r = await fjVerifyTx(rpc, pair.redeemTxHash, { ...ctx, kind: "redeem" });
      if (!r.ok && r.hard) return fjUnknown(r.reason, "c4");
      if (!r.ok) continue;
      if (d.nonce === null || r.nonce === null || r.nonce !== d.nonce + 1n) continue;
      return { verdict: E.HAS, reason: "d_r_pair_verified", via: "c4", weakFallback: false };
    }

    // C6 skipped (EVIDENCE.md section 4). C5 — WEAK FALLBACK · Owner 2026-10-08 conditional approval.
    const nonce = await fjCall(rpc, "eth_getTransactionCount", [address, "finalized"]);
    const n = nonce.ok ? hexBig(nonce.value) : null;
    if (n === null) return fjUnknown("nonce_unreadable", "c5");
    const bal = await fjCall(rpc, "eth_call", [{ to: shmon, data: BALANCE_OF_SELECTOR + lowerAddr(address).slice(2).padStart(64, "0") }, "finalized"]);
    const s = bal.ok && typeof bal.value === "string" && /^0x[0-9a-fA-F]{64}$/.test(bal.value) ? BigInt(bal.value) : null;
    if (s === null) return fjUnknown("balance_unreadable", "c5");
    if (n === 0n) return { verdict: E.NONE, reason: "no_testnet_tx", via: "c5", weakFallback: true };
    if (n >= 2n && s === 0n) return { verdict: E.HAS, reason: "nonce_ge2_shmon_zero", via: "c5", weakFallback: true };
    return { verdict: E.NONE, reason: n === 1n ? "nonce_one" : "shmon_balance_nonzero", via: "c5", weakFallback: true };
  } catch {
    return fjUnknown("read_failed");
  }
}

// Minimal escrow ABI — exactly the adopted A contract's entries this adapter touches (deep-equal
// to the A-577 forge artifact `out/GiftPiggyUSDC.sol/GiftPiggyUSDC.json`, checked in tests).
export const GIFT_ESCROW_CLAIM_ABI = Object.freeze([
  { type: "function", name: "claim", inputs: [{ name: "giftId", type: "bytes32", internalType: "bytes32" }, { name: "committer", type: "address", internalType: "address" }, { name: "recipient", type: "address", internalType: "address" }, { name: "preimage", type: "bytes", internalType: "bytes" }, { name: "salt", type: "bytes32", internalType: "bytes32" }, { name: "deadline", type: "uint256", internalType: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "commitClaim", inputs: [{ name: "giftId", type: "bytes32", internalType: "bytes32" }, { name: "commitHash", type: "bytes32", internalType: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "commits", inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }, { name: "", type: "address", internalType: "address" }], outputs: [{ name: "hash", type: "bytes32", internalType: "bytes32" }, { name: "blockNumber", type: "uint256", internalType: "uint256" }], stateMutability: "view" },
  { type: "function", name: "gifts", inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }], outputs: [{ name: "sender", type: "address", internalType: "address" }, { name: "token", type: "address", internalType: "address" }, { name: "amount", type: "uint256", internalType: "uint256" }, { name: "expiry", type: "uint64", internalType: "uint64" }, { name: "claimed", type: "bool", internalType: "bool" }, { name: "claimTokenHash", type: "bytes32", internalType: "bytes32" }], stateMutability: "view" },
]);

/** keccak256(abi.encode(recipient, preimage, salt)) — the adopted escrow's commit formula. */
export function giftCommitHash({ recipient, preimage, salt }) {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes32" }], [recipient, preimage, salt]));
}

export const GIFT_CLAIM_SUBMIT_STATUS = Object.freeze({
  VALUE_TRANSFERRED: "value_transferred",
  BINDING_INVALID: "binding_invalid",
  GIFT_ID_MISMATCH: "gift_id_mismatch",
  SELF_GIFT: "self_gift",
  SIGNER_NOT_BOUND: "signer_not_bound",
  CHAIN_SCOPE_MISMATCH: "chain_scope_mismatch",
  BAD_TOKEN: "bad_token",
  DEADLINE_UNAVAILABLE: "deadline_unavailable",
  GAS_FEE_UNKNOWN: "gas_fee_unknown",
  GAS_BUDGET_REFUSED: "gas_budget_refused",
  GAS_DELIVERY_FAILED: "gas_delivery_failed",
  GAS_DELIVERY_UNVERIFIED: "gas_delivery_unverified",
  GAS_INSUFFICIENT_AFTER_DELIVERY: "gas_insufficient_after_delivery",
  COMMIT_FAILED: "commit_failed",
  COMMIT_UNVERIFIED: "commit_unverified",
  BLOCK_GAP_NOT_OBSERVED: "block_gap_not_observed",
  CLAIM_CALLDATA_MISMATCH: "claim_calldata_mismatch",
  CLAIM_FAILED: "claim_failed",
  CLAIM_UNVERIFIED: "claim_unverified",
  // [A-858] giftId-scoped gas-delivery ledger gate (exactly-once MON delivery per giftId).
  GAS_LEDGER_UNAVAILABLE: "gas_ledger_unavailable",
  GAS_RECONCILE_REQUIRED: "gas_reconcile_required",
  GAS_BOUND_TO_OTHER_PIGGY: "gas_bound_to_other_piggy",
});

// [A-883] `evidence` = optional observation-only sidecar ({ store, chainId, now, onReport }); default none.
const SUBMITTER_CONFIG_KEYS = Object.freeze(["chain", "gasDelivery", "chainScope", "escrowAddress", "gasUnits", "safety", "readFeeInputs", "sleep", "maxPolls", "randomBytes", "giftGasLedger", "evidence"]);
const CHAIN_METHODS = Object.freeze(["getBalance", "getTransactionCount", "sendRawTransaction", "waitForTransactionReceipt", "getTransaction", "readContract", "getBlockNumber"]);

function defaultRandomBytes(n) {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("WebCrypto unavailable");
  return c.getRandomValues(new Uint8Array(n));
}

function bytesToHex0x(bytes) {
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function toBig(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  return null;
}

/**
 * Builds the app-side commit→claim submitter. Returns `null` (never a half-built submitter) unless
 * every piece is present and well-formed. `chain` (read + raw-tx broadcast transport, viem
 * publicClient-shaped) and `gasDelivery` (the sender-side gas allowance) MUST be two separate
 * objects: the chain transport never pays, the gas layer never signs or picks a recipient.
 * A `claimSigner` (or any other unknown) config key makes the whole config refused.
 */
export function createGiftClaimSubmitter(config = {}) {
  if (!config || typeof config !== "object") return null;
  if (Object.keys(config).some((k) => !SUBMITTER_CONFIG_KEYS.includes(k))) return null; // incl. claimSigner
  const { chain, gasDelivery, chainScope, escrowAddress, gasUnits, safety, readFeeInputs, sleep = null, maxPolls = 20, randomBytes = defaultRandomBytes, giftGasLedger = null, evidence = null } = config;
  if (!chain || typeof chain !== "object" || CHAIN_METHODS.some((m) => typeof chain[m] !== "function")) return null;
  if (!gasDelivery || typeof gasDelivery.deliver !== "function" || gasDelivery === chain) return null;
  // [A-895 P-B / A-887 R1] The ONLY accepted gas layer is an A-884-client-backed delivery made by createGiftGasClientDelivery:
  // no /grant-backed, hand-written or foreign gasDelivery can reach deliver() or the ledger release path.
  if (!isGiftGasClientDelivery(gasDelivery)) return null;
  const scope = typeof chainScope === "string" ? chainScope.trim() : "";
  if (!scope) return null;
  if (!ADDR_RE.test(String(escrowAddress || ""))) return null;
  if (typeof readFeeInputs !== "function") return null;
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1) return null;
  if (typeof randomBytes !== "function") return null;
  if (GIFT_GAS_POLICY.recipientMonRequired !== 0n || GIFT_GAS_POLICY.payer !== "sender") return null;
  // Fail-fast on the static half of the budget (units + buffer); fees are read per submit.
  const staticCheck = giftGasBudget({ gasUnits, safety });
  if (!staticCheck.ok) return null;
  // [A-858] giftId-scoped delivery ledger. If none is injected, a per-submitter IN-MEMORY ledger keeps the
  // reserve-before-deliver gate on, but it is NOT durable: RELEASE BLOCKER — inject a durable ledger before go-live.
  let ledger = giftGasLedger;
  if (ledger === null) {
    const rnd = new Uint8Array(8);
    try { globalThis.crypto.getRandomValues(rnd); } catch { return null; }
    ledger = createGiftGasLedger({ store: createMemoryGiftGasStore(), deviceId: `mem-${Array.from(rnd).map((b) => b.toString(16).padStart(2, "0")).join("")}` });
  }
  if (!ledger || ["reserve", "markSent", "confirm", "markUnknown", "reconcile"].some((m) => typeof ledger[m] !== "function")) return null;
  const escrow = escrowAddress;
  const pause = typeof sleep === "function" ? sleep : () => new Promise((r) => setTimeout(r, 1000));

  async function receiptOk(hash) {
    try {
      const r = await chain.waitForTransactionReceipt({ hash });
      return r && r.status === "success" ? r : null;
    } catch {
      return null;
    }
  }

  const submitter = Object.freeze({
    /**
     * `binding` must come from bindGiftToNewPiggy(); `record` is the (off-chain settled) Gift
     * record; `token` is the raw capability token (used only to build the preimage — never
     * returned); `account` is the live Mera signer of the NEW Gift Piggy. Any other field passed
     * here (e.g. a different chain/gasDelivery/recipient) is ignored.
     * Returns `{ status, ... }` — never salt/preimage/token.
     */
    async submit({ binding, record, token, account } = {}) {
      const S = GIFT_CLAIM_SUBMIT_STATUS;
      if (!isGiftBinding(binding)) return { status: S.BINDING_INVALID };
      const giftId = binding.giftId;
      const recipient = binding.recipientAddress;
      if (!record || record.giftId !== giftId || !BYTES32_RE.test(giftId)) return { status: S.GIFT_ID_MISMATCH };
      if (lowerAddr(record.senderAddress) === lowerAddr(recipient)) return { status: S.SELF_GIFT };
      const signerIsBound = () => !!account && lowerAddr(account.address) === lowerAddr(recipient) && typeof account.signTransaction === "function";
      if (!signerIsBound()) return { status: S.SIGNER_NOT_BOUND };
      const numericChainId = chain.chain?.id;
      if (scopeForChainId(numericChainId) !== scope) return { status: S.CHAIN_SCOPE_MISMATCH };
      if (typeof token !== "string" || (await hashClaimToken(token)) !== record.claimTokenHash) return { status: S.BAD_TOKEN };
      const expiryMs = Date.parse(String(record.expiresAt || ""));
      if (!Number.isFinite(expiryMs) || expiryMs <= 0) return { status: S.DEADLINE_UNAVAILABLE };
      const deadline = BigInt(Math.floor(expiryMs / 1000));

      // ── sender-funded gas budget (fundingTransfer mandatory) ────────────────────────────
      let feeInputs;
      try { feeInputs = await readFeeInputs(); } catch { feeInputs = null; }
      const planned = giftGasBudget({ gasUnits, feeInputs, safety });
      if (!planned.ok) return { status: S.GAS_BUDGET_REFUSED, reason: planned.reason };
      const budget = planned.budget;
      if (budget.status !== GIFT_GAS_BUDGET_STATUS.ESTIMATE) return { status: S.GAS_FEE_UNKNOWN };
      const units = budget.gasUnitsByStep;
      const fee = budget.feePerGasWei;
      const priority = toBig(feeInputs?.priorityFeePerGasWei) ?? 0n;
      // Path A: deliver the whole commit+claim share (+ its buffer) — never reduced by whatever MON
      // the recipient may already hold (recipient MON requirement = 0).
      const deliverWei = budget.costWei - units.fundingTransfer * fee;
      const needWei = (units.commitClaim + units.claim) * fee;
      const txHashes = {};

      // ── [A-858] reserve BEFORE deliver: no reservation, no deliver(). One giftId, one destination, one delivery. ──
      const LR = GIFT_GAS_LEDGER_REASON;
      let priorDelivery = null; // set when this giftId's delivery is already CONFIRMED (resume): never deliver again
      const reserved = await ledger.reserve(giftId, recipient, deliverWei);
      // deliver() runs ONLY on an explicit fresh reservation; anything else is a resume or a refusal.
      const freshReservation = reserved?.ok === true && reserved?.reserved === true;
      if (reserved?.ok === true && !freshReservation) return { status: S.GAS_LEDGER_UNAVAILABLE };
      if (!reserved || reserved.ok !== true) {
        if (reserved?.reason === LR.ALREADY_DELIVERED) priorDelivery = reserved.txHash;
        else if (reserved?.reason === LR.BOUND_TO_OTHER_DESTINATION || reserved?.reason === LR.BOUND_TO_OTHER_DEVICE) return { status: S.GAS_BOUND_TO_OTHER_PIGGY };
        else if (reserved?.reason === LR.MUST_RECONCILE) {
          const rec = await ledger.reconcile(giftId, { chainReader: chain });
          if (rec?.ok === true) priorDelivery = rec.txHash;
          else if (rec?.reason === LR.LEDGER_UNAVAILABLE) return { status: S.GAS_LEDGER_UNAVAILABLE };
          else return { status: S.GAS_RECONCILE_REQUIRED };
        } else return { status: S.GAS_LEDGER_UNAVAILABLE };
        // a prior (CONFIRMED) delivery must come with a well-formed hash, or we do not trust the ledger answer
        if (typeof priorDelivery !== "string" || !BYTES32_RE.test(priorDelivery)) return { status: S.GAS_LEDGER_UNAVAILABLE };
      }

      // ── MON delivery to the (now existing) Gift Piggy — gas layer sees 3 fields only ─────
      if (!freshReservation) {
        txHashes.delivery = priorDelivery;
      } else {
        let delivered;
        try {
          delivered = await gasDelivery.deliver(Object.freeze({ allowanceRef: giftId, to: recipient, valueWei: deliverWei }));
        } catch (err) {
          // [A-895 P-B] PROVABLY NOT SENT (a definite pre-action refusal from the server, tagged by the adapter itself):
          // release the local reservation so a retry is allowed. Any other throw may have been broadcast: stay blocked.
          if (isProvablyNotSent(err) && typeof ledger.release === "function") {
            const rel = await ledger.release(giftId);
            if (rel?.ok === true) return { status: S.GAS_DELIVERY_FAILED };
          }
          await ledger.markUnknown(giftId); // may have been broadcast: stay blocked, never auto-redeliver
          return { status: S.GAS_DELIVERY_FAILED };
        }
        const deliveryHash = typeof delivered?.txHash === "string" ? delivered.txHash : "";
        if (!BYTES32_RE.test(deliveryHash)) {
          await ledger.markUnknown(giftId);
          return { status: S.GAS_DELIVERY_FAILED };
        }
        // [A-895 P-B] ONE amount authority: the server-echoed valueWei (the amount it signed and sent). It must be a positive
        // integer within the client's fee-derived bound (<= deliverWei); anything else is refused BEFORE markSent and stays
        // blocked (UNKNOWN). The on-chain check below uses the echoed value, not deliverWei.
        const echoedWei = toBig(delivered?.valueWei);
        if (echoedWei === null || echoedWei <= 0n || echoedWei > deliverWei) {
          await ledger.markUnknown(giftId);
          return { status: S.GAS_DELIVERY_FAILED };
        }
        txHashes.delivery = deliveryHash;
        const sent = await ledger.markSent(giftId, deliveryHash, echoedWei); // hash (+ echoed amount) durable before any receipt check
        if (!sent.ok) return { status: S.GAS_LEDGER_UNAVAILABLE, txHashes: { ...txHashes } };
        const dReceipt = await receiptOk(deliveryHash);
        let dTx = null;
        try { dTx = await chain.getTransaction({ hash: deliveryHash }); } catch { dTx = null; }
        if (!dReceipt || !dTx || lowerAddr(dTx.to) !== lowerAddr(recipient) || toBig(dTx.value) !== echoedWei
          || (dTx.input ?? "0x") !== "0x") {
          await ledger.markUnknown(giftId);
          return { status: S.GAS_DELIVERY_UNVERIFIED, txHashes: { ...txHashes } };
        }
        const confirmed = await ledger.confirm(giftId, deliveryHash);
        if (!confirmed.ok) return { status: S.GAS_LEDGER_UNAVAILABLE, txHashes: { ...txHashes } };
      }
      let balance = null;
      try { balance = toBig(await chain.getBalance({ address: recipient })); } catch { balance = null; }
      if (balance === null || balance < needWei) return { status: S.GAS_INSUFFICIENT_AFTER_DELIVERY, txHashes: { ...txHashes } };

      // ── commit (signed by the Gift Piggy itself) ────────────────────────────────────────
      // [A-579 repair N-1] salt/preimage/commitHash are built inside a guard: a throwing randomBytes (no
      // WebCrypto) or encoder fails closed as COMMIT_FAILED instead of rejecting the whole settle.
      // Nothing from the throw (message, salt, token) is returned.
      let salt;
      let preimage;
      let commitHash;
      try {
        const saltBytes = randomBytes(32);
        if (!(saltBytes instanceof Uint8Array) || saltBytes.length !== 32) return { status: S.COMMIT_FAILED, txHashes: { ...txHashes } };
        salt = bytesToHex0x(saltBytes);
        preimage = stringToHex(token);
        commitHash = giftCommitHash({ recipient, preimage, salt });
      } catch {
        return { status: S.COMMIT_FAILED, txHashes: { ...txHashes } };
      }
      const txBase = { type: "eip1559", chainId: numericChainId, maxFeePerGas: fee, maxPriorityFeePerGas: priority, to: escrow, value: 0n };
      let nonce;
      try { nonce = await chain.getTransactionCount({ address: recipient, blockTag: "pending" }); } catch { return { status: S.COMMIT_FAILED, txHashes: { ...txHashes } }; }
      let commitReceipt;
      try {
        if (!signerIsBound()) return { status: S.SIGNER_NOT_BOUND, txHashes: { ...txHashes } };
        const raw = await account.signTransaction({ ...txBase, nonce, gas: units.commitClaim, data: encodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, functionName: "commitClaim", args: [giftId, commitHash] }) });
        txHashes.commit = await chain.sendRawTransaction({ serializedTransaction: raw });
        commitReceipt = await receiptOk(txHashes.commit);
      } catch {
        commitReceipt = null;
      }
      if (!commitReceipt) return { status: S.COMMIT_FAILED, txHashes: { ...txHashes } };
      const commitBlock = toBig(commitReceipt.blockNumber);
      try {
        const [storedHash, storedBlock] = await chain.readContract({ address: escrow, abi: GIFT_ESCROW_CLAIM_ABI, functionName: "commits", args: [giftId, recipient] });
        if (String(storedHash).toLowerCase() !== commitHash.toLowerCase() || toBig(storedBlock) !== commitBlock) return { status: S.COMMIT_UNVERIFIED, txHashes: { ...txHashes } };
      } catch {
        return { status: S.COMMIT_UNVERIFIED, txHashes: { ...txHashes } };
      }

      // ── wait for >= 1 block after the commit (contract: block.number > commit.blockNumber) ─
      let gap = false;
      for (let i = 0; i < maxPolls; i += 1) {
        let head = null;
        try { head = toBig(await chain.getBlockNumber()); } catch { head = null; }
        if (head !== null && head > commitBlock) { gap = true; break; }
        await pause();
      }
      if (!gap) return { status: S.BLOCK_GAP_NOT_OBSERVED, txHashes: { ...txHashes } };

      // ── claim: committer == recipient == the bound NEW Gift Piggy ───────────────────────
      if (!signerIsBound()) return { status: S.SIGNER_NOT_BOUND, txHashes: { ...txHashes } };
      const claimData = encodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, functionName: "claim", args: [giftId, recipient, recipient, preimage, salt, deadline] });
      const decoded = decodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, data: claimData });
      if (decoded.functionName !== "claim" || decoded.args[0].toLowerCase() !== giftId.toLowerCase()
        || lowerAddr(decoded.args[1]) !== lowerAddr(recipient) || lowerAddr(decoded.args[2]) !== lowerAddr(recipient)
        || lowerAddr(decoded.args[1]) !== lowerAddr(binding.recipientAddress)) {
        return { status: S.CLAIM_CALLDATA_MISMATCH, txHashes: { ...txHashes } };
      }
      let claimReceipt;
      try {
        const raw = await account.signTransaction({ ...txBase, nonce: nonce + 1, gas: units.claim, data: claimData });
        txHashes.claim = await chain.sendRawTransaction({ serializedTransaction: raw });
        claimReceipt = await receiptOk(txHashes.claim);
      } catch {
        claimReceipt = null;
      }
      if (!claimReceipt) return { status: S.CLAIM_FAILED, txHashes: { ...txHashes } };
      try {
        const cTx = await chain.getTransaction({ hash: txHashes.claim });
        const g = await chain.readContract({ address: escrow, abi: GIFT_ESCROW_CLAIM_ABI, functionName: "gifts", args: [giftId] });
        const claimed = Array.isArray(g) ? g[4] : g?.claimed;
        if (lowerAddr(cTx?.from) !== lowerAddr(recipient) || lowerAddr(cTx?.to) !== lowerAddr(escrow) || claimed !== true) {
          return { status: S.CLAIM_UNVERIFIED, txHashes: { ...txHashes } };
        }
      } catch {
        return { status: S.CLAIM_UNVERIFIED, txHashes: { ...txHashes } };
      }
      const blockNumber = Number(toBig(claimReceipt.blockNumber));
      const attached = attachTransferReceipt(record, { txHash: txHashes.claim, blockNumber, status: "success" });
      return {
        status: S.VALUE_TRANSFERRED,
        txHashes: { ...txHashes },
        transfer: { txHash: txHashes.claim, blockNumber },
        record: attached.ok ? attached.record : null,
      };
    },
  });

  // [A-883] No evidence sidecar injected => the very same submitter object as before (byte-for-byte behaviour).
  const evCfg = giftEvidenceConfig(evidence);
  if (!evCfg) return submitter;
  return Object.freeze({
    // Same submit, then an observation-only sidecar on the settled result. The result object is returned
    // unchanged (same identity); a rejection passes through untouched; the sidecar never throws.
    submit(args) {
      return submitter.submit(args).then((result) => {
        recordGiftEvidence(evCfg, { args, result, chain, escrow, ledger });
        return result;
      });
    },
  });
}

// ── [A-883] Gift receipt evidence sidecar (observation only) ───────────────────────────────────────────────────
// Runs only after submit() has settled. Maps the result's txHashes {delivery, commit, claim} with mapGiftEvidence and
// appends each tx seed to an injected A-868 evidence store. It never reads, writes, reserves, confirms or replaces
// the giftId gas ledger: a store that IS the ledger is refused, and ledger state is never derived from evidence.
// The claim token, salt and preimage are never passed in. Every failure is swallowed into report.evidenceErrors.
function giftEvidenceConfig(evidence) {
  if (evidence === null || evidence === undefined) return null;
  try {
    if (typeof evidence !== "object") return null;
    const store = evidence.store ?? null;
    const onReport = typeof evidence.onReport === "function" ? evidence.onReport : null;
    if (!store && !onReport) return null;
    return { store, onReport, chainId: evidence.chainId, now: evidence.now };
  } catch {
    return null;
  }
}

function swallowGiftAsync(value) {
  try {
    if (value && typeof value.then === "function") value.then(undefined, () => {});
  } catch { /* evidence layer only */ }
}

// [A-895 P-B / A-883 I1] Refuse by SHAPE as well as identity: an evidence store that exposes any gas-ledger mutator is a ledger
// (or a wrapper around one) and is never appended to. Evidence stores expose append/readAll only.
const GIFT_LEDGER_MUTATORS = Object.freeze(["reserve", "markSent", "confirm", "markUnknown", "reconcile", "release"]);
function looksLikeGiftLedger(store) {
  try { return GIFT_LEDGER_MUTATORS.some((m) => typeof store[m] === "function"); } catch { return true; }
}

function recordGiftEvidence(cfg, { args, result, chain, escrow, ledger }) {
  const report = { journey: "gift", authority: "observation_only", ledgerBoundary: "gift_gas_ledger_separate", staged: [], stored: [], refused: [], evidenceErrors: [] };
  try {
    const txHashes = result && typeof result === "object" ? result.txHashes : null;
    if (!txHashes || typeof txHashes !== "object") return; // nothing was broadcast: nothing to observe
    const binding = args && typeof args === "object" ? args.binding : null;
    if (!isGiftBinding(binding)) {
      report.evidenceErrors.push({ reason: "evidence_binding_invalid" });
    } else {
      let numeric = null;
      try { numeric = chain.chain?.id ?? null; } catch { numeric = null; }
      const injected = cfg.chainId;
      if (injected !== undefined && injected !== null && numeric !== null && String(injected) !== String(numeric)) {
        report.evidenceErrors.push({ reason: "chain_mismatch" });
      } else {
        const mapped = mapGiftEvidence({
          giftId: binding.giftId,
          txHashes: { delivery: txHashes.delivery, commit: txHashes.commit, claim: txHashes.claim },
          submitStatus: result.status,
          chainId: injected ?? numeric,
          recipient: binding.recipientAddress,
          escrow,
          now: cfg.now,
        });
        if (!mapped || mapped.ok !== true) {
          report.evidenceErrors.push({ reason: typeof mapped?.reason === "string" ? mapped.reason : "evidence_mapping_failed" });
        } else {
          report.giftRef = mapped.giftRef;
          report.staged = [...mapped.items];
          report.refused = [...mapped.refused];
          if (cfg.store && (cfg.store === ledger || looksLikeGiftLedger(cfg.store))) {
            report.evidenceErrors.push({ reason: "evidence_store_is_gift_gas_ledger" });
          } else if (cfg.store) {
            for (const item of mapped.items) {
              let r;
              try {
                if (typeof cfg.store.append !== "function") r = { ok: false, reason: "evidence_store_unavailable" };
                else {
                  const res = cfg.store.append(item.seed);
                  if (res && typeof res.then === "function") { swallowGiftAsync(res); r = { ok: false, reason: "evidence_store_async_unconfirmed" }; }
                  else if (res && res.ok === true) r = { ok: true, outcome: typeof res.outcome === "string" ? res.outcome : null };
                  else r = { ok: false, reason: typeof res?.reason === "string" ? res.reason.slice(0, 64) : "evidence_store_refused" };
                }
              } catch {
                r = { ok: false, reason: "evidence_store_threw" };
              }
              report.stored.push(Object.freeze({ evidenceKey: item.evidenceKey, ...r }));
              if (!r.ok) report.evidenceErrors.push(Object.freeze({ evidenceKey: item.evidenceKey, reason: r.reason }));
            }
          }
        }
      }
    }
  } catch {
    report.evidenceErrors.push({ reason: "evidence_mapping_threw" });
  }
  if (!cfg.onReport) return;
  try {
    for (const k of ["staged", "stored", "refused", "evidenceErrors"]) Object.freeze(report[k]);
    swallowGiftAsync(cfg.onReport(Object.freeze(report)));
  } catch { /* evidence layer only */ }
}

// ── [A-887] Gift gas delivery through the injected /gift-gas client (A-884 client · A-874 route) ───────────────────
// createGiftGasClientDelivery(client) turns an A-884 gift-gas client into the `gasDelivery` object the submitter above
// takes. It is the ONLY delivery main.js wires (main.js refuses a submit config that brings its own gasDelivery), so
// there is no /grant fallback, no local signer and no second route: deliver() makes at most one
// client.request({giftId, to}) and nothing else. The server decides the amount (A-869 policy); the request never
// carries valueWei.
//   · SENT / CONFIRMED with a well-formed txHash, exact giftId/to echo and a valid echoed valueWei => { txHash, valueWei } only. The submitter still
//     re-verifies that tx on chain (receipt success, to, value === deliverWei, empty input) before relying on it.
//   · everything else (PENDING, UNKNOWN, 409/503/4xx, timeout, network, malformed, invalid config, in-flight
//     conflict, a hostile client) => deliver() throws a fixed code. The submitter's existing catch then marks the
//     giftId ledger UNKNOWN and returns GAS_DELIVERY_FAILED: never redelivered automatically, never a permission.
// The client outcome is observation-only (authority "observation_only"); nothing here turns it into authority.
const wsHas = Function.prototype.call.bind(WeakSet.prototype.has); // captured at load: later page-side WeakSet.prototype overwrites are ignored
const wsAdd = Function.prototype.call.bind(WeakSet.prototype.add);
const GIFT_GAS_CLIENT_DELIVERIES = new WeakSet();
export const GIFT_GAS_CLIENT_DELIVERY_REFUSAL = Object.freeze({
  BAD_REQUEST: "gift_gas_delivery_bad_request",
  NOT_DELIVERED: "gift_gas_delivery_not_delivered",
  CLIENT_FAILED: "gift_gas_delivery_client_failed",
  // [A-895 P-B] the server DEFINITELY refused before doing anything (nothing reserved/signed/broadcast): safe to release.
  NOT_SENT: "gift_gas_delivery_refused_not_sent",
});
// Definite pre-action refusals: client outcome -> the ONLY http status it may come with. 409 (not_available) is NOT here:
// it can mean "bound to another destination" and so is ambiguous. 503 counts only for the exact unavailable_not_sent body
// (the service emits it only before ledger.reserve). 408 = relayer body deadline (0 service calls, exact body required).
// Timeout / network / aborted / malformed / unknown / any other state are never definite.
const GIFT_GAS_DEFINITE_REFUSAL = Object.freeze({
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, method_not_allowed: 405,
  request_timeout: 408, payload_too_large: 413, unsupported_media_type: 415, unavailable_not_sent: 503,
});
const PROVABLY_NOT_SENT = new WeakSet();
function isProvablyNotSent(err) {
  return !!err && typeof err === "object" && wsHas(PROVABLY_NOT_SENT, err);
}
const WEI_DEC_RE = /^[1-9][0-9]{0,77}$/;
const GIFT_GAS_ACCEPTED = Object.freeze({ sent: "SENT", confirmed: "CONFIRMED" });
const LOWER_TX_RE = /^0x[0-9a-f]{64}$/;

function giftGasDeliveryError(code) {
  const e = new Error(code);
  e.code = code;
  if (code === GIFT_GAS_CLIENT_DELIVERY_REFUSAL.NOT_SENT) wsAdd(PROVABLY_NOT_SENT, e);
  return e;
}

// Data-property read only: an accessor (getter) on a hostile object is treated as missing; a throwing Proxy => undefined.
function ownData(o, k) {
  try {
    const d = Object.getOwnPropertyDescriptor(o, k);
    return d && Object.prototype.hasOwnProperty.call(d, "value") ? d.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * [A-895 P-B] Pure classifier of one A-884 client outcome (exported so hostile shapes can be tested directly).
 * Returns { kind: "accepted", txHash, valueWei(bigint) } | { kind: "not_sent" } | { kind: "not_delivered" }. Never throws.
 */
export function classifyGiftGasOutcome(out, giftId, dest) {
  const nd = { kind: "not_delivered" };
  if (!out || typeof out !== "object") return nd;
  const outcome = ownData(out, "outcome");
  const txHash = ownData(out, "txHash");
  const valueWei = ownData(out, "valueWei");
  if (ownData(out, "ok") === false
    && ownData(out, "authority") === "observation_only"
    && ownData(out, "localDelivery") === false
    && ownData(out, "reachedServer") === "yes"
    && typeof outcome === "string" && Object.prototype.hasOwnProperty.call(GIFT_GAS_DEFINITE_REFUSAL, outcome)
    && ownData(out, "httpStatus") === GIFT_GAS_DEFINITE_REFUSAL[outcome]) {
    return { kind: "not_sent" };
  }
  const accepted = ownData(out, "ok") === true
    && ownData(out, "authority") === "observation_only"
    && ownData(out, "localDelivery") === false
    && ownData(out, "reachedServer") === "yes"
    && ownData(out, "httpStatus") === 200
    && typeof outcome === "string" && Object.prototype.hasOwnProperty.call(GIFT_GAS_ACCEPTED, outcome)
    && ownData(out, "state") === GIFT_GAS_ACCEPTED[outcome]
    && ownData(out, "giftId") === giftId
    && ownData(out, "to") === dest
    && typeof txHash === "string" && LOWER_TX_RE.test(txHash)
    && typeof valueWei === "string" && WEI_DEC_RE.test(valueWei);
  return accepted ? { kind: "accepted", txHash, valueWei: BigInt(valueWei) } : nd;
}

export function createGiftGasClientDelivery(client) {
  if (!isGiftGasClient(client)) return null; // [A-895 P-B F1] only clients made by createGiftGasClient()
  if (!client || typeof client !== "object") return null;
  if (ownData(client, "configError")) return null;
  const request = ownData(client, "request");
  if (typeof request !== "function") return null;
  const delivery = Object.freeze({
    async deliver(req) {
      const R = GIFT_GAS_CLIENT_DELIVERY_REFUSAL;
      const ref = req && typeof req === "object" ? ownData(req, "allowanceRef") : undefined;
      const to = req && typeof req === "object" ? ownData(req, "to") : undefined;
      if (typeof ref !== "string" || !BYTES32_RE.test(ref) || typeof to !== "string" || !ADDR_RE.test(to)) throw giftGasDeliveryError(R.BAD_REQUEST);
      const giftId = ref.toLowerCase(); // same bytes32; the server policy takes lowercase only
      const dest = to.toLowerCase();
      let out;
      try {
        out = await request.call(client, { giftId, to: dest });
      } catch {
        throw giftGasDeliveryError(R.CLIENT_FAILED);
      }
      if (!out || typeof out !== "object") throw giftGasDeliveryError(R.CLIENT_FAILED);
      const verdict = classifyGiftGasOutcome(out, giftId, dest);
      if (verdict.kind === "not_sent") throw giftGasDeliveryError(R.NOT_SENT);
      if (verdict.kind !== "accepted") throw giftGasDeliveryError(R.NOT_DELIVERED);
      // valueWei = the server-echoed amount (A-884 validated); the submitter bounds it and verifies the chain against it.
      return Object.freeze({ txHash: verdict.txHash, valueWei: verdict.valueWei });
    },
  });
  wsAdd(GIFT_GAS_CLIENT_DELIVERIES, delivery);
  return delivery;
}

export function isGiftGasClientDelivery(delivery) {
  return !!delivery && typeof delivery === "object" && wsHas(GIFT_GAS_CLIENT_DELIVERIES, delivery);
}

// ── [A-897 P1-fix C2] case 2 vs case 3 boundary: was this #1 already USED on the live scope (Monad mainnet 143)? ───────────────
// Cowork 2026-10-08 (INBOX A-897 "[답 · P1 review C2]" -> (a)): the local index alone does not decide 2 vs 3. When the local live-scope index has no
// #1, read the recomputed #1 address at `finalized` on the live chain: nonce > 0, or MON balance > 0, or USDC balance > 0  =>  "used" (case 3,
// A-567 new Gift Piggy). No activity => "unused" (case 2 + the evidence ladder). Any failure / malformed / wrong chain => "unknown" (unopened/retry).
// Read-only, injected rpc, never throws, nothing is shown. No new number or provider (the caller reuses RETURN_EVIDENCE_READ_CONFIG's reader).
export const MAINNET_ACTIVITY = Object.freeze({ USED: "used", UNUSED: "unused", UNKNOWN: "unknown" });
export const MAINNET_ACTIVITY_RPC_WHITELIST = Object.freeze(["eth_chainId", "eth_getTransactionCount", "eth_getBalance", "eth_call"]);
export async function readMainnetActivity({ rpc, address, usdc = null, chainId = 143 } = {}) {
  const U = MAINNET_ACTIVITY;
  const unknown = (reason) => ({ verdict: U.UNKNOWN, reason });
  try {
    if (typeof rpc !== "function") return unknown("no_mainnet_reader");
    if (!ADDR_RE.test(String(address || "")) || !ADDR_RE.test(String(usdc || ""))) return unknown("bad_address");
    const call = async (method, params) => {
      if (!MAINNET_ACTIVITY_RPC_WHITELIST.includes(method)) return { ok: false };
      try { return { ok: true, value: await rpc(method, params) }; } catch { return { ok: false }; }
    };
    const cid = await call("eth_chainId", []);
    const live = cid.ok ? hexBig(cid.value) : null;
    if (live === null) return unknown("rpc_error");
    if (live !== BigInt(chainId)) return unknown("chain_mismatch");
    const nonce = await call("eth_getTransactionCount", [address, "finalized"]);
    const n = nonce.ok ? hexBig(nonce.value) : null;
    if (n === null) return unknown("nonce_unreadable");
    const mon = await call("eth_getBalance", [address, "finalized"]);
    const m = mon.ok ? hexBig(mon.value) : null;
    if (m === null) return unknown("balance_unreadable");
    const tok = await call("eth_call", [{ to: usdc, data: BALANCE_OF_SELECTOR + lowerAddr(address).slice(2).padStart(64, "0") }, "finalized"]);
    const t = tok.ok && typeof tok.value === "string" && /^0x[0-9a-fA-F]{64}$/.test(tok.value) ? BigInt(tok.value) : null;
    if (t === null) return unknown("usdc_unreadable");
    if (n > 0n) return { verdict: U.USED, reason: "nonce_gt0" };
    if (m > 0n) return { verdict: U.USED, reason: "mon_balance_gt0" };
    if (t > 0n) return { verdict: U.USED, reason: "usdc_balance_gt0" };
    return { verdict: U.UNUSED, reason: "no_activity" };
  } catch {
    return unknown("read_failed");
  }
}

// ── [A-906] Gift claim via 7702 sponsor-submit (LOCAL · default OFF) ───────────────────────────────────────────────
// The receiving Gift Piggy only SIGNS (same single Face ID step; no new UI/copy): a 7702 authorization to the pinned MetaMask
// StatelessDeleGator + ONE single-use commitClaim delegation (gift-sponsor-7702.js guards). The sponsor (relayer, injected
// `sponsorClient`) redeems it and pays gas, then submits claim() as a plain tx. The Piggy receives 0 MON; the /gift-gas
// path above is untouched and remains the path whenever this config is null. Nothing here enables itself: main.js passes
// no sponsor config, so selectGiftClaimPath() returns the current path.
//   sponsorClient = { submit({giftId, authorization, delegation, claim:{recipient, preimage, salt, deadline}}) -> { status, body } }  (the relayer's handle() return)
//   (one POST /gift-sponsor; the relayer redeems the commit, waits the block gap, sends claim(); the app re-verifies both on chain.)
export const GIFT_SPONSOR_SUBMIT_STATUS = Object.freeze({
  VALUE_TRANSFERRED: "value_transferred",
  BINDING_INVALID: "binding_invalid",
  GIFT_ID_MISMATCH: "gift_id_mismatch",
  SELF_GIFT: "self_gift",
  SIGNER_NOT_BOUND: "signer_not_bound",
  CHAIN_SCOPE_MISMATCH: "chain_scope_mismatch",
  BAD_TOKEN: "bad_token",
  DEADLINE_UNAVAILABLE: "deadline_unavailable",
  GUARD_REFUSED: "guard_refused", // + reason from GIFT_SPONSOR_REFUSAL; nothing was sent
  COMMIT_FAILED: "commit_failed",
  COMMIT_UNVERIFIED: "commit_unverified",
  CLAIM_FAILED: "claim_failed",
  CLAIM_UNVERIFIED: "claim_unverified",
  ALREADY_CLAIMED_VERIFIED: "already_claimed_verified", // relayer refused/unavailable but the chain shows OUR commit + claimed gift
});
const SPONSOR_SUBMITTER_KEYS = Object.freeze(["config", "chain", "sponsorClient", "chainScope", "now", "randomBytes"]);
const SPONSOR_CHAIN_METHODS = Object.freeze(["getTransactionCount", "readContract", "getTransaction", "waitForTransactionReceipt", "getCode"]);
const SPONSOR_SUBMITTERS = new WeakSet();

export function createGiftSponsorClaimSubmitter(cfg = {}) {
  if (!cfg || typeof cfg !== "object") return null;
  if (Object.keys(cfg).some((k) => !SPONSOR_SUBMITTER_KEYS.includes(k))) return null;
  const { config, chain, sponsorClient, chainScope, now = () => Math.floor(Date.now() / 1000), randomBytes = defaultRandomBytes } = cfg;
  const norm = normalizeGiftSponsorConfig(config);
  if (!norm.ok) return null;
  const C = norm.config;
  if (!chain || typeof chain !== "object" || SPONSOR_CHAIN_METHODS.some((m) => typeof chain[m] !== "function")) return null;
  if (!sponsorClient || typeof sponsorClient.submit !== "function") return null;
  const scope = typeof chainScope === "string" ? chainScope.trim() : "";
  if (!scope || scopeForChainId(C.chainId) !== scope) return null;
  if (typeof now !== "function" || typeof randomBytes !== "function") return null;
  const S = GIFT_SPONSOR_SUBMIT_STATUS;

  const submitter = Object.freeze({
    async submit({ binding, record, token, account, gasTx } = {}) {
      if (!isGiftBinding(binding)) return { status: S.BINDING_INVALID };
      const giftId = binding.giftId;
      const recipient = binding.recipientAddress;
      if (!record || record.giftId !== giftId || !BYTES32_RE.test(giftId)) return { status: S.GIFT_ID_MISMATCH };
      if (lowerAddr(record.senderAddress) === lowerAddr(recipient)) return { status: S.SELF_GIFT };
      if (!account || lowerAddr(account.address) !== lowerAddr(recipient)) return { status: S.SIGNER_NOT_BOUND };
      if (chain.chain?.id !== C.chainId) return { status: S.CHAIN_SCOPE_MISMATCH };
      if (typeof token !== "string" || (await hashClaimToken(token)) !== record.claimTokenHash) return { status: S.BAD_TOKEN };
      const expiryMs = Date.parse(String(record.expiresAt || ""));
      if (!Number.isFinite(expiryMs) || expiryMs <= 0) return { status: S.DEADLINE_UNAVAILABLE };
      const deadline = BigInt(Math.floor(expiryMs / 1000));
      const refused = (reason, txHashes = {}) => ({ status: S.GUARD_REFUSED, reason, txHashes: { ...txHashes } });

      let salt; let preimage; let commitHash; let authNonce;
      try {
        const saltBytes = randomBytes(32);
        if (!(saltBytes instanceof Uint8Array) || saltBytes.length !== 32) return { status: S.COMMIT_FAILED };
        salt = bytesToHex0x(saltBytes);
        preimage = stringToHex(token);
        commitHash = giftCommitHash({ recipient, preimage, salt });
        authNonce = Number(await chain.getTransactionCount({ address: recipient, blockTag: "latest" }));
      } catch {
        return { status: S.COMMIT_FAILED };
      }
      // ── Face ID: authorization + one delegation. The session refuses a second request of either kind. ──
      // [A-913 C] Timestamp before = min(now + 300, this Gift's own deadline); after = 0. Internal only, never shown.
      // [A-913] An already-passed Gift deadline is refused BEFORE Face ID on the existing guard_refused path (no new copy).
      const deadlineSec = Number(deadline);
      const nowSec = Math.floor(Number(now()));
      if (!Number.isSafeInteger(deadlineSec) || !Number.isSafeInteger(nowSec) || deadlineSec <= nowSec) return refused(GIFT_SPONSOR_REFUSAL.GIFT_DEADLINE_INVALID);
      const session = createGiftSponsorSession({ config: C, giftId, commitHash, account, authNonce, now, readCode: async (address) => chain.getCode({ address }), giftDeadlineSeconds: deadlineSec });
      if (!session) return refused(GIFT_SPONSOR_REFUSAL.CONFIG_INVALID);
      const a = await session.signAuthorization();
      if (!a.ok) return refused(a.reason);
      // [A-913 D] same Face ID session: the revoke authorization (0x0 @ nonce n+1). Fail-closed: no revoke signature => nothing is sent.
      const rv = await session.signRevokeAuthorization();
      if (!rv.ok) return refused(rv.reason);
      const d = await session.signDelegation();
      if (!d.ok) return refused(d.reason);
      const built = await session.buildRequest({ claim: { recipient, preimage, salt, deadline: deadline.toString(10) }, ...(typeof gasTx === "string" && BYTES32_RE.test(gasTx) ? { gasTx } : {}) });
      if (!built.ok) return refused(built.reason);

      // ONE relayer call. sponsorClient.submit(request) resolves to the relayer's { status, body } exactly as handle() returns it.
      //   200 body = { ok:true, state:"CLAIMED", giftId, installTxHash:null|bytes32, commitTxHash, claimTxHash } (commit = the redeemDelegations tx)
      const txHashes = {};
      let res;
      try { res = await sponsorClient.submit(built.request); } catch { res = null; }
      const readGift = async () => {
        try {
          const [storedHash] = await chain.readContract({ address: C.escrowAddress, abi: GIFT_ESCROW_CLAIM_ABI, functionName: "commits", args: [giftId, recipient] });
          const g = await chain.readContract({ address: C.escrowAddress, abi: GIFT_ESCROW_CLAIM_ABI, functionName: "gifts", args: [giftId] });
          return { committedByUs: String(storedHash).toLowerCase() === built.commitHash.toLowerCase(), claimed: (Array.isArray(g) ? g[4] : g?.claimed) === true };
        } catch { return null; }
      };
      const body = res && typeof res === "object" ? res.body : null;
      const okShape = res?.status === 200 && !!body && typeof body === "object" && !Array.isArray(body)
        && ["ok", "state", "giftId", "installTxHash", "commitTxHash", "claimTxHash"].every((k) => Object.prototype.hasOwnProperty.call(body, k))
        && body.ok === true && body.state === "CLAIMED" && lowerAddr(body.giftId) === lowerAddr(giftId)
        && (body.installTxHash === null || BYTES32_RE.test(String(body.installTxHash)))
        && BYTES32_RE.test(String(body.commitTxHash)) && BYTES32_RE.test(String(body.claimTxHash));
      if (!okShape) {
        // 409 (replay / retry after our own earlier success): the chain, not the refusal, decides. Never reports commit_failed for a claimed gift.
        if (res?.status === 409 || res?.status === 503) {
          const st = await readGift();
          if (st && st.committedByUs && st.claimed) return { status: S.ALREADY_CLAIMED_VERIFIED, txHashes };
        }
        return { status: S.COMMIT_FAILED, txHashes };
      }
      if (body.installTxHash !== null) txHashes.install = body.installTxHash;
      // [A-913 D] optional: the relayer revokes the delegation right after the commit confirms. Informational only; a missing/null revoke never blocks the claim.
      if (typeof body.revokeTxHash === "string" && BYTES32_RE.test(body.revokeTxHash)) txHashes.revoke = body.revokeTxHash;
      txHashes.commit = body.commitTxHash;
      txHashes.claim = body.claimTxHash;
      // Never trust the relayer's word: verify on chain.
      let claimReceipt;
      try {
        const cr = await chain.waitForTransactionReceipt({ hash: txHashes.commit });
        if (!cr || cr.status !== "success") return { status: S.COMMIT_FAILED, txHashes };
        const [storedHash] = await chain.readContract({ address: C.escrowAddress, abi: GIFT_ESCROW_CLAIM_ABI, functionName: "commits", args: [giftId, recipient] });
        if (String(storedHash).toLowerCase() !== built.commitHash.toLowerCase()) return { status: S.COMMIT_UNVERIFIED, txHashes };
      } catch {
        return { status: S.COMMIT_UNVERIFIED, txHashes };
      }
      try {
        claimReceipt = await chain.waitForTransactionReceipt({ hash: txHashes.claim });
        if (!claimReceipt || claimReceipt.status !== "success") return { status: S.CLAIM_FAILED, txHashes };
        const cTx = await chain.getTransaction({ hash: txHashes.claim });
        const g = await chain.readContract({ address: C.escrowAddress, abi: GIFT_ESCROW_CLAIM_ABI, functionName: "gifts", args: [giftId] });
        const claimed = Array.isArray(g) ? g[4] : g?.claimed;
        if (lowerAddr(cTx?.to) !== lowerAddr(C.escrowAddress) || lowerAddr(cTx?.from) !== lowerAddr(C.sponsorAddress) || claimed !== true) return { status: S.CLAIM_UNVERIFIED, txHashes };
      } catch {
        return { status: S.CLAIM_UNVERIFIED, txHashes };
      }
      const blockNumber = Number(toBig(claimReceipt.blockNumber));
      const attached = attachTransferReceipt(record, { txHash: txHashes.claim, blockNumber, status: "success" });
      return { status: S.VALUE_TRANSFERRED, txHashes, transfer: { txHash: txHashes.claim, blockNumber }, record: attached.ok ? attached.record : null };
    },
  });
  SPONSOR_SUBMITTERS.add(submitter);
  return submitter;
}

export const isGiftSponsorClaimSubmitter = (x) => !!x && typeof x === "object" && SPONSOR_SUBMITTERS.has(x);

/**
 * Claim path switch. A sponsor submitter (made by createGiftSponsorClaimSubmitter, so config was valid) wins; otherwise
 * the current /gift-gas submitter is used unchanged. Default (no sponsor config anywhere) => path "gift_gas".
 */
export function selectGiftClaimPath({ sponsorSubmitter = null, legacySubmitter = null } = {}) {
  if (sponsorSubmitter !== null && sponsorSubmitter !== undefined) {
    return isGiftSponsorClaimSubmitter(sponsorSubmitter) ? { path: "sponsor_7702", submitter: sponsorSubmitter } : { path: "none", submitter: null };
  }
  return { path: "gift_gas", submitter: legacySubmitter ?? null };
}
