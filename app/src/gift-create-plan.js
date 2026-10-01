// [A-564 Lane B] **Gift create plan** — sender-side, PURE planning helper, built from a
// sender-side audit kept outside this repository.
//
// This file does NOT:
//  · send a transaction, build a permission envelope, touch any UI, or create a provider/client.
//  · persist anything (no store, no cache, no log).
//  · generate, accept, or infer a `claimSigner` value. [A-575] The adopted escrow is A
//    commit-reveal (A-570 ADOPTION = A-568 candidate_a): it has NO claimSigner at all — its
//    5-arg `create(giftId, token, amount, expiry, claimTokenHash)` is exactly `escrowCreateArgs`
//    below, and `claim()` verifies `sha256(preimage) == claimTokenHash` after a >=1-block commit by
//    the recipient's own Gift Piggy. The pre-A-570 blocker (`claim_signer_not_safely_available`,
//    A-564 SENDER_AUDIT.md: the old escrow needed a separate ecrecover key) no longer applies and
//    is removed. A `claimSigner` input is still refused outright — under A it would be a second
//    secret with no contract meaning.
//
// What this file DOES do, reusing only existing, unmodified primitives:
//  · mints a fresh `bytes32` `giftId` via WebCrypto (same technique
//    `gift-piggy-claim-link.js`'s own `mintClaimToken()` already uses for its capability token —
//    not a new randomness source), so the SAME value can key the off-chain record, the URL
//    fragment, and the escrow's `create()` call — no string→bytes32 derivation scheme invented
//    (matches A-562's own finding, `LANE_A_MAPPING.md:94`).
//  · resolves a USDC 20/50/100 preset via `gift-value-spec.js` (`buildGiftValueBinding`,
//    unmodified) — no default, no custom amount.
//  · composes `createClaimLink` / `attachGiftValue` / `sealClaimLink`
//    (`gift-piggy-claim-link.js`, unmodified) into one non-secret record + one fragment link.
//  · [A-573] optionally attaches a sender-funded gas budget via `giftGasBudget()`
//    (`gift-value-spec.js`) — injected gas units × injected fee inputs + bounded buffer, never a
//    default price. The gas budget is computed from gas inputs ONLY: it cannot set or override
//    giftId, recipient, claimTokenHash, or any signer, and the claimSigner refusal below stays.

import {
  GIFT_LINK_VERSION,
  createClaimLink,
  attachGiftValue,
  sealClaimLink,
  buildClaimUrl,
} from "./gift-piggy-claim-link.js";
import { buildGiftValueBinding, giftGasBudget, GIFT_GAS_POLICY } from "./gift-value-spec.js";

const ADDR = /^0x[0-9a-fA-F]{40}$/;

function webcrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== "function") {
    throw new Error("WebCrypto unavailable — refusing to invent a weaker id");
  }
  return c;
}

/** Fresh `0x` + 64-hex `bytes32`, matching the escrow's `giftId` type exactly — no derivation
 * scheme, just randomness, the same way `mintClaimToken()` mints its own capability token. */
function mintGiftId() {
  const bytes = new Uint8Array(32);
  webcrypto().getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** unix seconds -> ISO 8601, same math `gift-record-source.js`'s own (unexported) `toIsoExpiry`
 * uses for the read side — kept consistent intentionally, not re-declared as policy. */
function isoFromUnixSeconds(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const ms = n * 1000;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Plans a new value-bound Gift, sender side. Pure — no tx, no permission, no UI, no provider,
 * no persistence. Every returned field is either pure computation or produced by the existing,
 * unmodified `gift-piggy-claim-link.js` / `gift-value-spec.js` primitives.
 *
 * @param {object} p
 * @param {string} p.chainScope   e.g. "monad-testnet" — the same string `gift-value-spec.js`/
 *   `funding-context.js` use. Never resolved here from a numeric chain id.
 * @param {number} p.presetLabel  must be exactly one of `20`/`50`/`100` — no default, no custom.
 * @param {string} p.senderAddress
 * @param {number} p.expiry       unix seconds (matches the escrow's `uint64 expiry` param).
 * @param {string} [p.createdAt]  ISO 8601. Defaults to `new Date().toISOString()`.
 * @param {string} [p.note]
 * @param {string} [p.origin]     if given, also returns a ready-to-share `claimUrl`.
 * @param {object} [p.gas]        [A-573] `{ gasUnits, feeInputs, safety }` passed verbatim to
 *   `giftGasBudget()`. Omitted -> `gasBudget: null` (not planned yet — never a default amount).
 *   Any failure fails the whole plan with the budget's own reason.
 *
 * Passing `claimSigner` is refused outright (`claim_signer_not_supported`) rather than silently
 * ignored — the adopted A escrow has no such field (see file header).
 */
export async function planGiftCreate({
  chainScope,
  presetLabel,
  senderAddress,
  expiry,
  createdAt = new Date().toISOString(),
  note = "",
  origin = null,
  gas,
  claimSigner,
} = {}) {
  if (claimSigner !== undefined) return { ok: false, reason: "claim_signer_not_supported" };

  let gasBudget = null;
  if (gas !== undefined) {
    const planned = giftGasBudget(gas);
    if (!planned.ok) return { ok: false, reason: planned.reason };
    gasBudget = planned.budget;
  }

  const sender = typeof senderAddress === "string" ? senderAddress.trim() : "";
  if (!ADDR.test(sender)) return { ok: false, reason: "bad_sender_address" };

  const expiresAt = isoFromUnixSeconds(expiry);
  if (!expiresAt) return { ok: false, reason: "bad_expiry" };

  const { value, error: valueError } = buildGiftValueBinding({ chainScope, presetLabel });
  if (!value) return { ok: false, reason: valueError };

  const giftId = mintGiftId();

  const created = createClaimLink({
    giftId,
    senderAddress: sender,
    chainId: chainScope,
    createdAt,
    expiresAt,
    note,
  });
  if (!created.ok) return { ok: false, reason: created.reason };

  const bound = attachGiftValue(created.record, value);
  if (!bound.ok) return { ok: false, reason: bound.reason };

  const sealed = await sealClaimLink(bound.record, created.token);
  if (!sealed) return { ok: false, reason: "seal_failed" };

  const claimUrl = typeof origin === "string" && origin
    ? buildClaimUrl(origin, { giftId, token: created.token })
    : null;

  return {
    ok: true,
    giftId,
    // Non-secret. Safe to display/store — carries only the hash, never the raw token.
    record: sealed,
    // The ONLY place the raw capability token appears. Caller puts this in the URL fragment
    // (never a query string — see `buildClaimUrl`) and does not persist it.
    fragment: Object.freeze({ giftId, token: created.token, version: GIFT_LINK_VERSION }),
    claimUrl,
    // Exactly the adopted A escrow's `create(bytes32,address,uint256,uint64,bytes32)` args
    // (A-570/A-575) — no `claimSigner` field exists in that contract.
    escrowCreateArgs: Object.freeze({
      giftId,
      token: value.tokenAddress,
      amount: value.amountAtomic,
      expiry,
      claimTokenHash: `0x${sealed.claimTokenHash}`,
    }),
    // [A-573] Sender-funded, delivery-only gas. Separate from escrowCreateArgs/record on purpose:
    // nothing here feeds giftId, recipient, claimTokenHash, or a signer.
    gasPolicy: GIFT_GAS_POLICY,
    gasBudget,
  };
}
