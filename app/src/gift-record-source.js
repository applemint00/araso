// [A-562 LANE B] **Gift on-chain record source** — a provider-independent adapter that reads a
// `GiftPiggyUSDC` escrow (adopted A commit-reveal shape since A-575 — see below; not deployed
// anywhere) and maps its `gifts(bytes32)` getter tuple into the exact A-559 record
// shape `gift-claim-entry.js`'s `beginGiftClaim({ recordSource })` already expects
// (`getRecordByGiftId(giftId)` -> record | null).
//
// This file does NOT invent a provider, a store, or a signed-fragment model. It only:
//   · reads (never writes) via an injected viem-style `client.readContract`,
//   · trusts only an injected, already-verified `chainScope` + `contractAddress` (no hardcoded
//     deployment address anywhere in this file),
//   · reuses `gift-value-spec.js`'s existing USDC/decimals/preset policy (`validateGiftValueBinding`)
//     rather than re-declaring it,
//   · fails closed (returns `null`, never a fabricated record) on any malformed/zero/wrong-chain/
//     wrong-token/wrong-amount/wrong-decimals condition.
//
// [A-575] Getter shape = the ADOPTED A commit-reveal escrow (A-570 ADOPTION: A-568 candidate_a,
// `<private>`).
// That contract has no `claimSigner` any more: `gifts(bytes32)` returns 6 fields
// (sender, token, amount, expiry, claimed, claimTokenHash), and `claim()` itself verifies
// `sha256(preimage) == claimTokenHash` after a >=1-block commit. The pre-A-570 7-field getter
// (with `claimSigner`, A-562) cannot decode this contract's return data at all — the A-575
// mainnet-fork run showed the 7-field decode throws on real fork bytes — so this adapter now
// reads the 6-field shape only. `claimTokenHash` is the same sha256 commitment
// `gift-piggy-claim-link.js`'s `hashClaimToken()` produces (A-562 Lane A origin of the field).
//
// giftId format: this adapter treats `giftId` as ALREADY the on-chain `bytes32` mapping key
// (`0x` + 64 hex chars) — it does not invent a string->bytes32 derivation scheme (that would be
// a product decision this card was not asked to make). A `giftId` that is not already shaped
// this way is simply unrecognized by this source (`null`, mapped to `unknown_link` by
// `beginGiftClaim`), not an error and not a guess.

import { CLAIM_STATUS, GIFT_LINK_VERSION, TRANSFER_STATUS } from "./gift-piggy-claim-link.js";
import { GIFT_VALUE_ASSET_SYMBOL, GIFT_VALUE_DECIMALS, validateGiftValueBinding } from "./gift-value-spec.js";
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST, scopeForChainId } from "./funding-context.js";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/; // matches gift-piggy-claim-link.js's own HEX64 shape (no 0x, lowercase)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

// Minimal ABI — only the exact getter this adapter calls. Field order matches the adopted A
// contract's compiled ABI for `gifts(bytes32)` exactly (A-575: verified against the forge
// artifact of the byte-identical candidate_a copy in `<private>`):
// sender, token, amount, expiry, claimed, claimTokenHash.
const GIFTS_GETTER_ABI = Object.freeze([
  {
    type: "function",
    name: "gifts",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "sender", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "claimed", type: "bool" },
      { name: "claimTokenHash", type: "bytes32" },
    ],
  },
]);

function fullAddressEqual(a, b) {
  // Full-address equality only — never a prefix/substring match.
  return ADDR.test(String(a || "")) && ADDR.test(String(b || ""))
    && String(a).toLowerCase() === String(b).toLowerCase();
}

/** bytes32 hex (`0x` + 64 hex, any case) -> the plain lowercase-hex-no-0x shape
 * `gift-piggy-claim-link.js`'s own `claimTokenHash` field already uses. Rejects anything that
 * doesn't decode cleanly rather than guessing. */
function normalizeClaimTokenHash(bytes32Hex) {
  if (!BYTES32.test(String(bytes32Hex || ""))) return null;
  if (String(bytes32Hex).toLowerCase() === ZERO_BYTES32) return null; // never created / commitment absent
  const hex = String(bytes32Hex).slice(2).toLowerCase();
  return HEX64.test(hex) ? hex : null;
}

function toIsoExpiry(expiryUnixSeconds) {
  const n = Number(expiryUnixSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n * 1000;
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return iso;
}

/** Positional (array) or named (object) tuple — accept either shape a viem-style client might
 * hand back for a multi-output getter, but always read the SAME six fields by name/position.
 * A 7-element positional tuple (the retired pre-A-570 claimSigner shape) is refused, not
 * re-mapped: its positions mean different things. */
function unpackGiftTuple(tuple) {
  if (Array.isArray(tuple)) {
    if (tuple.length !== 6) return null;
    const [sender, token, amount, expiry, claimed, claimTokenHash] = tuple;
    return { sender, token, amount, expiry, claimed, claimTokenHash };
  }
  if (tuple && typeof tuple === "object") {
    if ("claimSigner" in tuple) return null; // retired pre-A-570 shape — never silently accepted
    const { sender, token, amount, expiry, claimed, claimTokenHash } = tuple;
    if (sender !== undefined && token !== undefined && amount !== undefined) {
      return { sender, token, amount, expiry, claimed, claimTokenHash };
    }
  }
  return null;
}

/**
 * Builds a read-only Gift record source over a `GiftPiggyUSDC`-shaped escrow.
 *
 * `client` — injected viem-style object exposing `readContract({address, abi, functionName,
 *   args})` (same convention `funding-reconcile.js`'s `readErc20Balance` already uses) and,
 *   for chain binding, a `client.chain.id` the same way `main.js`'s existing
 *   `scopeForChainId(client?.chain?.id)` check already reads it.
 * `chainScope` — an already-verified chain scope string (e.g. `"monad-testnet"`), the SAME
 *   string `funding-context.js`/`gift-value-spec.js` use. Never resolved here from a numeric id.
 * `contractAddress` — an already-verified, non-hardcoded escrow address. This file contains no
 *   deployment address of its own.
 *
 * Returns `null` (not a half-built source) if the config itself is malformed — the caller
 * (`main.js`) must then leave `GIFT_RECORD_SOURCE` unavailable, exactly as it does today.
 */
export function createGiftRecordSource({ client, chainScope, contractAddress } = {}) {
  if (!client || typeof client.readContract !== "function") return null;
  const scope = typeof chainScope === "string" ? chainScope.trim() : "";
  if (!scope) return null;
  const address = typeof contractAddress === "string" ? contractAddress.trim() : "";
  if (!ADDR.test(address)) return null;

  return Object.freeze({
    /**
     * Returns the A-559 record shape for `giftId`, or `null` if this source cannot honestly
     * supply one (wrong chain, no such gift, malformed/zero on-chain fields, token/amount/
     * decimals outside the current gift-value-spec allowlist, or a read failure). Never throws;
     * never fabricates a field from anything other than this one on-chain read.
     */
    async getRecordByGiftId(giftId) {
      if (!BYTES32.test(String(giftId || ""))) return null; // not shaped as this source's key

      // Chain binding — same fail-closed pattern main.js already uses
      // (`scopeForChainId(client?.chain?.id) !== context.chainId`), not re-derived differently.
      const clientScope = scopeForChainId(client?.chain?.id);
      if (clientScope !== scope) return null;

      let raw;
      try {
        raw = await client.readContract({
          address,
          abi: GIFTS_GETTER_ABI,
          functionName: "gifts",
          args: [giftId],
        });
      } catch {
        return null; // read failure — never guess a different state
      }

      const tuple = unpackGiftTuple(raw);
      if (!tuple) return null;
      const { sender, token, amount, expiry, claimed, claimTokenHash } = tuple;

      // Existence + shape gate. `create()` refuses amount==0/token==0/claimTokenHash==0, so any
      // of these being zero/malformed means either no gift was ever created for this id, or the
      // read decoded something this adapter does not trust — either way, refuse, don't guess.
      if (!ADDR.test(String(sender || "")) || fullAddressEqual(sender, ZERO_ADDRESS)) return null;
      if (!ADDR.test(String(token || "")) || fullAddressEqual(token, ZERO_ADDRESS)) return null;
      if (typeof amount !== "bigint" || amount <= 0n) return null;
      if (typeof expiry !== "bigint" && typeof expiry !== "number") return null;
      if (typeof claimed !== "boolean") return null;

      const amountAtomic = Number(amount);
      if (!Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) return null;

      // Token identity — full-address equality (case-insensitive) against the SAME canonical
      // allowlist gift-value-spec.js itself reads (funding-context.js), not a separately declared
      // copy. A real viem client checksums decoded addresses (verified directly against viem —
      // see gift-record-source.mjs's test), so this normally matches byte-for-byte already; the
      // case-insensitive compare is defense-in-depth against a client that does not checksum,
      // never a looser check than "the exact canonical USDC address for this chain".
      const canonicalUsdc = FUNDING_CONTEXT_TOKEN_ALLOWLIST[scope]?.[GIFT_VALUE_ASSET_SYMBOL];
      if (!canonicalUsdc || !fullAddressEqual(token, canonicalUsdc.assetId)) return null;

      // Decimals + preset amount — reuse gift-value-spec.js's existing policy, never re-declared
      // here. Wrong decimals/amount fail closed here; token is passed in its CANONICAL casing
      // (not the chain's raw decoded casing) so validateGiftValueBinding's own strict address
      // comparison always matches once the case-insensitive check above already passed.
      const value = { tokenAddress: canonicalUsdc.assetId, decimals: GIFT_VALUE_DECIMALS, amountAtomic };
      const validated = validateGiftValueBinding(value, { chainScope: scope });
      if (!validated.ok || validated.legacy) return null; // on-chain gifts are never legacy/valueless

      const claimTokenHashHex = normalizeClaimTokenHash(claimTokenHash);
      if (!claimTokenHashHex) return null;

      const expiresAt = toIsoExpiry(expiry);
      if (!expiresAt) return null;

      // [Honest limitation, documented not hidden] `claimed` conflates two on-chain outcomes —
      // a real recipient `claim()` and a post-expiry sender `refund()` both set the same flag.
      // This source cannot distinguish them from this getter alone (no separate on-chain field
      // exists for it), so both map to CLAIMED. Either way, `openClaimLink()`'s ALREADY_CLAIMED_
      // BY_OTHER path fires — since this record never carries a `recipientAddress` (unknowable
      // from this getter), it can never be misreported as "already claimed by the same person
      // asking" — it always fails closed to "not currently claimable", never a fabricated claim.
      const status = claimed ? CLAIM_STATUS.CLAIMED : CLAIM_STATUS.UNCLAIMED;

      return Object.freeze({
        version: GIFT_LINK_VERSION,
        giftId,
        senderAddress: sender,
        chainId: scope,
        claimTokenHash: claimTokenHashHex,
        status,
        createdAt: null, // not stored on-chain; openClaimLink/settleClaim never read this field
        expiresAt,
        note: "",
        recipientAddress: null, // not stored on-chain (only known once a real claim tx is emitted)
        claimedAt: null,
        claimProof: null,
        transfer: { status: TRANSFER_STATUS.NOT_ATTEMPTED, txHash: null, blockNumber: null },
        value: Object.freeze({ tokenAddress: canonicalUsdc.assetId, decimals: GIFT_VALUE_DECIMALS, amountAtomic }),
      });
    },
  });
}
