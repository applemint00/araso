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
// sender-signed-fragment support in the fragment format itself — see lane_a/AUDIT.md). When
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
});

const SUBMITTER_CONFIG_KEYS = Object.freeze(["chain", "gasDelivery", "chainScope", "escrowAddress", "gasUnits", "safety", "readFeeInputs", "sleep", "maxPolls", "randomBytes"]);
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
  const { chain, gasDelivery, chainScope, escrowAddress, gasUnits, safety, readFeeInputs, sleep = null, maxPolls = 20, randomBytes = defaultRandomBytes } = config;
  if (!chain || typeof chain !== "object" || CHAIN_METHODS.some((m) => typeof chain[m] !== "function")) return null;
  if (!gasDelivery || typeof gasDelivery.deliver !== "function" || gasDelivery === chain) return null;
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

  return Object.freeze({
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

      // ── MON delivery to the (now existing) Gift Piggy — gas layer sees 3 fields only ─────
      let delivered;
      try {
        delivered = await gasDelivery.deliver(Object.freeze({ allowanceRef: giftId, to: recipient, valueWei: deliverWei }));
      } catch {
        return { status: S.GAS_DELIVERY_FAILED };
      }
      const deliveryHash = typeof delivered?.txHash === "string" ? delivered.txHash : "";
      if (!BYTES32_RE.test(deliveryHash)) return { status: S.GAS_DELIVERY_FAILED };
      txHashes.delivery = deliveryHash;
      const dReceipt = await receiptOk(deliveryHash);
      let dTx = null;
      try { dTx = await chain.getTransaction({ hash: deliveryHash }); } catch { dTx = null; }
      if (!dReceipt || !dTx || lowerAddr(dTx.to) !== lowerAddr(recipient) || toBig(dTx.value) !== deliverWei
        || (dTx.input ?? "0x") !== "0x") {
        return { status: S.GAS_DELIVERY_UNVERIFIED, txHashes: { ...txHashes } };
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
}
