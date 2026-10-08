// [A-560 PHASE 2] **Gift value spec** — the product/runtime policy layer for a Gift that carries
// real value, sitting on top of the asset-agnostic primitive in `gift-piggy-claim-link.js`
// (A-495/A-559, unchanged in shape) the same way `funding-context.js` (A-553) sits on top of the
// raw funding path. This file decides *what values are even legal* for a Gift; it never talks to
// a signer, a record store, or the DOM.
//
// Owner product decision (INBOX A-560, 2026-09-24, newest wins):
//   asset = USDC on Monad · decimals = 6 · presets = 20 / 50 / 100 USDC, exactly.
//   No default amount. No custom amount. Explicit selection required — anything else is rejected.
//
// Token identity is **not** re-declared here. It is read from `funding-context.js`'s own
// allowlist (A-553, already proven chain-explicit and provider-independent) so there is exactly
// one canonical {chain scope -> USDC address/decimals} table in this repo, not two that could
// drift apart.
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "./funding-context.js";

export const GIFT_VALUE_ASSET_SYMBOL = "USDC";
export const GIFT_VALUE_DECIMALS = 6;

// The only three atomic amounts this product's Gift can carry in this slice. Order matches the
// Owner's own list (20 / 50 / 100). Values are exact integers (USDC has 6 decimals, so the
// largest preset, 100_000000, is far below Number.MAX_SAFE_INTEGER — no BigInt needed here).
const PRESET_ATOMIC_BY_LABEL = Object.freeze({
  20: 20_000000,
  50: 50_000000,
  100: 100_000000,
});
export const GIFT_VALUE_PRESET_LABELS = Object.freeze([20, 50, 100]);
export const GIFT_VALUE_PRESET_ATOMIC_AMOUNTS = Object.freeze(
  GIFT_VALUE_PRESET_LABELS.map((label) => PRESET_ATOMIC_BY_LABEL[label]),
);

function tokenForChainScope(chainScope) {
  const allowed = FUNDING_CONTEXT_TOKEN_ALLOWLIST[chainScope]?.[GIFT_VALUE_ASSET_SYMBOL];
  if (!allowed) return null;
  // Defense in depth: if funding-context's own canon ever disagreed with this spec's decimals
  // constant, fail closed rather than silently trusting whichever one is looser.
  if (allowed.decimals !== GIFT_VALUE_DECIMALS) return null;
  return allowed;
}

/**
 * Resolves an explicit preset selection to its exact atomic amount. `presetLabel` must be
 * *exactly* one of `20`/`50`/`100` (the Number, not a decimal string, not a truthy stand-in) —
 * this is the "no default, no custom amount" gate. `undefined`/`null` (nothing chosen) is its
 * own distinct reason from "chose something, but it isn't one of the three".
 */
export function resolveGiftValuePreset(presetLabel) {
  if (presetLabel === undefined || presetLabel === null) {
    return { ok: false, reason: "explicit_selection_required" };
  }
  const match = GIFT_VALUE_PRESET_LABELS.find((label) => label === presetLabel);
  if (match === undefined) return { ok: false, reason: "unsupported_amount" };
  return { ok: true, presetLabel: match, amountAtomic: PRESET_ATOMIC_BY_LABEL[match] };
}

/**
 * Builds the immutable value fields a sender's Gift link is allowed to carry, for a specific
 * chain scope (e.g. `"monad-testnet"`, the same string `funding-context.js` uses — not a numeric
 * chain id, and not resolved here from one; the caller must already know which scope it's on).
 * This is a pure data/runtime seam — it is not wired to any UI element in this card.
 */
export function buildGiftValueBinding({ chainScope, presetLabel } = {}) {
  const preset = resolveGiftValuePreset(presetLabel);
  if (!preset.ok) return { value: null, error: preset.reason };
  const scope = typeof chainScope === "string" ? chainScope.trim() : "";
  if (!scope) return { value: null, error: "missing_chain_id" };
  const token = tokenForChainScope(scope);
  if (!token) return { value: null, error: "asset_id_chain_mismatch" };
  return {
    value: Object.freeze({
      tokenAddress: token.assetId,
      decimals: token.decimals,
      amountAtomic: preset.amountAtomic,
    }),
    error: null,
  };
}

/**
 * Re-checks a value binding that travels with a record (e.g. read back from wherever it was
 * persisted) against the *current* allowlist — the same defense-in-depth `validateFundingContext`
 * (A-553) already does for funding. `value === null` is not a defect: it is a legacy,
 * identity-only Gift and must be labeled that way, never silently promoted to "funded".
 */
export function validateGiftValueBinding(value, { chainScope } = {}) {
  if (value === null || value === undefined) return { ok: true, legacy: true };
  if (typeof value !== "object") return { ok: false, reason: "malformed_value" };
  const { tokenAddress, decimals, amountAtomic } = value;
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(tokenAddress || ""))) {
    return { ok: false, reason: "bad_token_address" };
  }
  if (!Number.isInteger(decimals) || decimals !== GIFT_VALUE_DECIMALS) {
    return { ok: false, reason: "bad_decimals" };
  }
  if (!GIFT_VALUE_PRESET_ATOMIC_AMOUNTS.includes(amountAtomic)) {
    return { ok: false, reason: "unsupported_amount" };
  }
  const scope = typeof chainScope === "string" ? chainScope.trim() : "";
  if (!scope) return { ok: false, reason: "missing_chain_id" };
  const token = tokenForChainScope(scope);
  if (!token || token.assetId !== tokenAddress || token.decimals !== decimals) {
    return { ok: false, reason: "asset_id_chain_mismatch" };
  }
  return { ok: true, legacy: false };
}

// The exact, honest label a receipt/UI is allowed to use for a Gift record. This never invents
// "funded" from identity alone, and never says `value_transferred` without the primitive's own
// real transfer receipt (`gift-piggy-claim-link.js`'s `TRANSFER_STATUS`/`proofLevel` stay the
// single source of truth for whether value actually moved — this only adds the legacy/pending
// distinction the Owner asked for on top of that existing axis).
export const GIFT_VALUE_LABEL = Object.freeze({
  LEGACY_IDENTITY_ONLY: "legacy_identity_only",
  VALUE_PENDING: "value_pending",
  VALUE_TRANSFERRED: "value_transferred",
});

export function giftValueLabel(record) {
  if (!record || typeof record !== "object") return GIFT_VALUE_LABEL.LEGACY_IDENTITY_ONLY;
  if (record.value === null || record.value === undefined) return GIFT_VALUE_LABEL.LEGACY_IDENTITY_ONLY;
  if (record.transfer && record.transfer.status === "settled") return GIFT_VALUE_LABEL.VALUE_TRANSFERRED;
  return GIFT_VALUE_LABEL.VALUE_PENDING; // bound to a real USDC amount, but no transfer receipt yet — never faked.
}

/** The amount a receipt is allowed to state — `null` unless a real transfer receipt exists. */
export function giftValueAmountForReceipt(record) {
  if (giftValueLabel(record) !== GIFT_VALUE_LABEL.VALUE_TRANSFERRED) return null;
  return {
    assetSymbol: GIFT_VALUE_ASSET_SYMBOL,
    tokenAddress: record.value.tokenAddress,
    decimals: record.value.decimals,
    amountAtomic: record.value.amountAtomic,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [A-573] **Gift gas — sender-funded, delivery-only.** Owner decision (INBOX A-573, 2026-09-24,
// newest wins): the Gift sender funds BOTH the Gift value (20/50/100 USDC above) AND the small
// MON gas the recipient's new Gift Piggy needs for `commitClaim` + reveal `claim` (A-568
// candidate A / A-570 delta). The recipient is never asked to preload MON to receive a Gift.
//
// The gas layer carries NO entitlement. It never holds, chooses, or overrides a recipient, a
// giftId, a claimTokenHash, a committer, or a signer — it only delivers gas to (or submits
// already-authorized calldata for) a Piggy that the commit-reveal claim itself authorizes.
//
// No gas amount is declared here as product policy. `giftGasBudget()` only multiplies INJECTED
// gas-unit estimates by INJECTED fee inputs plus an explicit bounded buffer; when fee inputs are
// absent it returns UNKNOWN cost rather than inventing a price. Unused-gas handling (return to
// sender / keep reserved / explicit expiry refund) is NOT decided here — later product/accounting
// decision, recorded as `UNDECIDED` below.
export const GIFT_GAS_POLICY = Object.freeze({
  payer: "sender",
  recipientMonRequired: 0n,
  gasLayerAuthority: "delivery_only",
  gasLayerMayChooseRecipient: false,
  gasLayerMayIssueEntitlement: false,
  gasLayerIsAuthorizationSigner: false,
  unusedGasHandling: "UNDECIDED",
  unusedGasOptions: Object.freeze(["return_to_sender", "keep_reserved", "explicit_expiry_refund"]),
  // [A-579 Lane G · A-574 Path A] The ONLY delivery path: the sender-side gas allowance delivers
  // MON to the recipient's NEW Gift Piggy after that Piggy's address exists (never before, never
  // to an address the gas layer chose), then the Gift Piggy itself submits commitClaim -> claim.
  deliveryPath: "A_mon_after_recipient_address",
});

export const GIFT_SPONSOR_GAS_STEPS = Object.freeze(["install", "commitClaim", "revoke", "claim"]);
export const GIFT_GAS_BUDGET_STATUS = Object.freeze({
  ESTIMATE: "ESTIMATE",
  UNKNOWN: "UNKNOWN",
});

// Structural ceiling on the safety buffer (basis points), not a price: a caller may choose any
// explicit buffer from 0 up to this cap, and anything above it is rejected rather than clamped.
export const GIFT_GAS_SAFETY_MAX_BPS = 5000;
const BPS_DENOMINATOR = 10000n;

// Steps the budget covers (A-570 delta: commitClaim -> next block -> claim, plus the simple MON
// transfer that delivers the gas to the Gift Piggy). [A-579 Lane G] `fundingTransfer` is now
// REQUIRED (A-574 Path A: the sender pays the delivery transfer too — a budget without it
// under-counts what the sender actually spends). No optional steps remain.
const GAS_STEPS_REQUIRED = Object.freeze(["commitClaim", "claim", "fundingTransfer"]);
// [A-913 A] The sponsor path additionally pays install + revoke from the sponsor wallet. They are OPTIONAL here (legacy budgets are unchanged) and
// REQUIRED by gift-create-plan.js planGiftGasDeposit (GIFT_SPONSOR_GAS_STEPS): a deposit whose budget lacks any of the four is refused (UNKNOWN, no default).
const GAS_STEPS_OPTIONAL = Object.freeze(["install", "revoke"]);
const GAS_STEPS = Object.freeze([...GAS_STEPS_REQUIRED, ...GAS_STEPS_OPTIONAL]);

// Keys that would give the gas layer entitlement/claim authority. Refused by name anywhere in
// the budget input, and never present in the budget output.
export const GIFT_GAS_ENTITLEMENT_KEYS = Object.freeze([
  "recipient", "recipientAddress", "giftId", "claimTokenHash", "claimSigner", "signer",
  "committer", "commitHash", "preimage", "salt", "token", "tokenAddress", "amount",
  "amountAtomic", "senderAddress", "deadline", "expiry",
]);

const BUDGET_INPUT_KEYS = Object.freeze(["gasUnits", "feeInputs", "safety"]);
const FEE_INPUT_KEYS = Object.freeze(["maxFeePerGasWei", "baseFeePerGasWei", "priorityFeePerGasWei", "source"]);
const SAFETY_KEYS = Object.freeze(["bufferBps"]);

function refusedKey(obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (GIFT_GAS_ENTITLEMENT_KEYS.includes(key)) return "gas_entitlement_field_refused";
    if (!allowed.includes(key)) return "gas_unknown_field";
  }
  return null;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** bigint or safe-integer Number, strictly positive — anything else (string, float, negative,
 * zero, NaN, boolean) is null. No parsing, no coercion. */
function toPositiveBigInt(v) {
  if (typeof v === "bigint") return v > 0n ? v : null;
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return BigInt(v);
  return null;
}

function readGasUnits(gasUnits) {
  if (!isPlainObject(gasUnits)) return { error: "gas_units_missing" };
  const refused = refusedKey(gasUnits, GAS_STEPS);
  if (refused) return { error: refused };
  const byStep = {};
  for (const step of GAS_STEPS) {
    const raw = gasUnits[step];
    if (raw === undefined) {
      if (GAS_STEPS_REQUIRED.includes(step)) return { error: "gas_units_missing" };
      continue;
    }
    const units = toPositiveBigInt(raw);
    if (units === null) return { error: "gas_units_invalid" };
    byStep[step] = units;
  }
  return { byStep: Object.freeze(byStep) };
}

function readSafety(safety) {
  if (!isPlainObject(safety)) return { error: "safety_buffer_missing" };
  const refused = refusedKey(safety, SAFETY_KEYS);
  if (refused) return { error: refused };
  const { bufferBps } = safety;
  if (bufferBps === undefined) return { error: "safety_buffer_missing" };
  if (typeof bufferBps !== "number" || !Number.isSafeInteger(bufferBps) || bufferBps < 0) {
    return { error: "safety_buffer_invalid" };
  }
  if (bufferBps > GIFT_GAS_SAFETY_MAX_BPS) return { error: "safety_buffer_above_cap" };
  return { bufferBps };
}

/** `undefined`/`null` feeInputs = not measured -> UNKNOWN (not an error). Present but malformed
 * = error: a half-specified price is never silently treated as "unknown" or "zero". */
function readFeeInputs(feeInputs) {
  if (feeInputs === undefined || feeInputs === null) return { missing: true };
  if (!isPlainObject(feeInputs)) return { error: "fee_inputs_invalid" };
  const refused = refusedKey(feeInputs, FEE_INPUT_KEYS);
  if (refused) return { error: refused };
  const source = typeof feeInputs.source === "string" ? feeInputs.source.trim() : "";
  if (!source) return { error: "fee_source_required" };
  const hasMax = feeInputs.maxFeePerGasWei !== undefined;
  const hasBase = feeInputs.baseFeePerGasWei !== undefined;
  const hasPriority = feeInputs.priorityFeePerGasWei !== undefined;
  if (hasMax && (hasBase || hasPriority)) return { error: "fee_inputs_ambiguous" };
  if (hasMax) {
    const fee = toPositiveBigInt(feeInputs.maxFeePerGasWei);
    if (fee === null) return { error: "fee_inputs_invalid" };
    return { feePerGasWei: fee, feeBasis: "max_fee_per_gas", source };
  }
  if (hasBase && hasPriority) {
    const base = toPositiveBigInt(feeInputs.baseFeePerGasWei);
    // Priority may legitimately be 0 — the only fee field where zero is allowed.
    const p = feeInputs.priorityFeePerGasWei;
    const priority = p === 0 || p === 0n ? 0n : toPositiveBigInt(p);
    if (base === null || priority === null) return { error: "fee_inputs_invalid" };
    return { feePerGasWei: base + priority, feeBasis: "base_plus_priority", source };
  }
  return { error: "fee_inputs_invalid" };
}

/**
 * Sender-side Gift gas budget. Pure — no network, no provider, no default price, no default gas.
 *
 * @param {object} p
 * @param {object} p.gasUnits   `{ commitClaim, claim, fundingTransfer }` — injected gas limits (all three required, A-579)
 *   each tx will be submitted with (bigint or safe positive integer). Budget = limit × fee, an
 *   upper bound on what the chain can charge for that tx at that fee.
 * @param {object|null} [p.feeInputs]  `{ maxFeePerGasWei, source }` OR
 *   `{ baseFeePerGasWei, priorityFeePerGasWei, source }`. Omitted/null -> status UNKNOWN,
 *   `costWei: null`. `source` (where the numbers came from) is mandatory when present.
 * @param {object} p.safety     `{ bufferBps }` — explicit integer 0..GIFT_GAS_SAFETY_MAX_BPS;
 *   above the cap is rejected, never clamped.
 *
 * Returns `{ ok: true, budget }` or `{ ok: false, reason }`. The budget carries only gas/fee
 * fields plus the sender-pays policy — no entitlement key (see GIFT_GAS_ENTITLEMENT_KEYS).
 */
export function giftGasBudget(input) {
  if (!isPlainObject(input)) return { ok: false, reason: "gas_units_missing" };
  const refused = refusedKey(input, BUDGET_INPUT_KEYS);
  if (refused) return { ok: false, reason: refused };

  const units = readGasUnits(input.gasUnits);
  if (units.error) return { ok: false, reason: units.error };
  const safety = readSafety(input.safety);
  if (safety.error) return { ok: false, reason: safety.error };
  const fee = readFeeInputs(input.feeInputs);
  if (fee.error) return { ok: false, reason: fee.error };

  const totalGasUnits = Object.values(units.byStep).reduce((sum, u) => sum + u, 0n);
  const common = {
    payer: GIFT_GAS_POLICY.payer,
    recipientMonRequired: GIFT_GAS_POLICY.recipientMonRequired,
    gasUnitsByStep: units.byStep,
    totalGasUnits,
    bufferBps: safety.bufferBps,
  };

  if (fee.missing) {
    return {
      ok: true,
      budget: Object.freeze({
        ...common,
        status: GIFT_GAS_BUDGET_STATUS.UNKNOWN,
        feePerGasWei: null,
        feeBasis: null,
        feeSource: null,
        baseCostWei: null,
        bufferWei: null,
        costWei: null,
        unknownReason: "fee_inputs_missing",
      }),
    };
  }

  const baseCostWei = totalGasUnits * fee.feePerGasWei;
  // Ceiling division — the buffer never rounds a budget down.
  const bufferWei = (baseCostWei * BigInt(safety.bufferBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
  return {
    ok: true,
    budget: Object.freeze({
      ...common,
      status: GIFT_GAS_BUDGET_STATUS.ESTIMATE,
      feePerGasWei: fee.feePerGasWei,
      feeBasis: fee.feeBasis,
      feeSource: fee.source,
      baseCostWei,
      bufferWei,
      costWei: baseCostWei + bufferWei,
    }),
  };
}
