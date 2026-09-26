// [A-560 PHASE 2/TESTS] Gift value spec — presets/decimals/binding, plus tamper/sender/replay/
// secret-persistence defense at the statement layer. Network 0 · no vm/DOM (this exercises
// `gift-value-spec.js` and `gift-piggy-claim-link.js` directly with real secp256k1 signatures,
// the same "real code, no mirror" discipline `app/test/gift-claim-link.mjs` already uses).
//   node app/test/gift-value-spec.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { recoverMessageAddress } from "viem";
import { createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import {
  GIFT_VALUE_ASSET_SYMBOL,
  GIFT_VALUE_DECIMALS,
  GIFT_VALUE_PRESET_LABELS,
  GIFT_VALUE_PRESET_ATOMIC_AMOUNTS,
  GIFT_VALUE_LABEL,
  resolveGiftValuePreset,
  buildGiftValueBinding,
  validateGiftValueBinding,
  giftValueLabel,
  giftValueAmountForReceipt,
  GIFT_GAS_POLICY,
  GIFT_GAS_BUDGET_STATUS,
  GIFT_GAS_SAFETY_MAX_BPS,
  GIFT_GAS_ENTITLEMENT_KEYS,
  giftGasBudget,
} from "../src/gift-value-spec.js";
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "../src/funding-context.js";
import {
  createClaimLink,
  sealClaimLink,
  attachGiftValue,
  claimStatement,
  settleClaim,
  CLAIM_RESULT,
  CLAIM_STATUS,
  TRANSFER_STATUS,
} from "../src/gift-piggy-claim-link.js";

const CHAIN = "monad-testnet";
const SENDER = "0x00000000000000000000000000000000000000a1";

let pass = 0;
function test(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }
async function atest(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// A real secp256k1 signer, independent of the Mera passkey/WebAuthn stack (that round-trip is
// already proven in gift-claim-wallet-birth.mjs/gift-value-loop.mjs) — this file only needs a
// real signature to exercise claimStatement()/settleClaim()'s own recover-and-compare math.
function realAccount() {
  const session = createSecp256k1SigningSession({ privateKey: crypto.randomBytes(32) });
  return { address: getEvmAddress(session.publicKey), account: toViemAccount(session) };
}

async function freshValueLink({ giftId, presetLabel = 20, senderAddress = SENDER } = {}) {
  const binding = buildGiftValueBinding({ chainScope: CHAIN, presetLabel });
  assert.equal(binding.error, null, JSON.stringify(binding));
  const made = createClaimLink({ giftId, senderAddress, chainId: CHAIN, createdAt: "2026-09-24T09:00:00Z" });
  assert.equal(made.ok, true, JSON.stringify(made));
  const attached = attachGiftValue(made.record, binding.value);
  assert.equal(attached.ok, true, JSON.stringify(attached));
  const record = await sealClaimLink(attached.record, made.token);
  return { record, token: made.token, value: binding.value };
}

// ═══ presets: 20/50/100 accept, explicit selection required, everything else rejected ═══════
test("presets: 20/50/100 resolve to exact 6-decimal atomic amounts", () => {
  assert.deepEqual(GIFT_VALUE_PRESET_LABELS, [20, 50, 100]);
  assert.equal(GIFT_VALUE_DECIMALS, 6);
  for (const [label, expected] of [[20, 20_000000], [50, 50_000000], [100, 100_000000]]) {
    const r = resolveGiftValuePreset(label);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.amountAtomic, expected);
    assert.equal(r.amountAtomic, label * 10 ** GIFT_VALUE_DECIMALS); // exact 6-decimal conversion
  }
  assert.deepEqual([...GIFT_VALUE_PRESET_ATOMIC_AMOUNTS], [20_000000, 50_000000, 100_000000]);
});

test("no default: undefined/null selection is its own distinct reason, never silently 20", () => {
  assert.equal(resolveGiftValuePreset(undefined).reason, "explicit_selection_required");
  assert.equal(resolveGiftValuePreset(null).reason, "explicit_selection_required");
});

test("reject 0/negative/other integers/decimal strings/decimal numbers — only the exact three", () => {
  for (const bad of [0, -20, 25, 200, 20.5, "20", "20_000000", NaN, {}, [], true, "50"]) {
    const r = resolveGiftValuePreset(bad);
    assert.equal(r.ok, false, `expected reject: ${JSON.stringify(bad)}`);
    assert.equal(r.reason, "unsupported_amount");
  }
});

// ═══ token identity: reused from funding-context's own allowlist, not re-declared ═══════════
test("token identity comes from funding-context's allowlist, not a duplicated constant", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const canon = FUNDING_CONTEXT_TOKEN_ALLOWLIST[CHAIN][GIFT_VALUE_ASSET_SYMBOL];
  assert.equal(b.value.tokenAddress, canon.assetId);
  assert.equal(b.value.decimals, canon.decimals);
  assert.equal(b.value.decimals, 6);
});

test("unknown chain scope fails closed (asset_id_chain_mismatch) — no asset invented", () => {
  const b = buildGiftValueBinding({ chainScope: "monad-does-not-exist", presetLabel: 20 });
  assert.equal(b.value, null);
  assert.equal(b.error, "asset_id_chain_mismatch");
});

test("missing chain scope fails closed (missing_chain_id)", () => {
  assert.equal(buildGiftValueBinding({ presetLabel: 20 }).error, "missing_chain_id");
});

test("no explicit preset -> no binding is built at all, even with a valid chain scope", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN });
  assert.equal(b.value, null);
  assert.equal(b.error, "explicit_selection_required");
});

// ═══ validateGiftValueBinding: legacy vs bound vs tampered ═══════════════════════════════════
test("validateGiftValueBinding: null value is legacy, not a defect", () => {
  assert.deepEqual(validateGiftValueBinding(null, { chainScope: CHAIN }), { ok: true, legacy: true });
});

test("validateGiftValueBinding: a correctly bound value re-validates ok, not legacy", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 50 });
  assert.deepEqual(validateGiftValueBinding(b.value, { chainScope: CHAIN }), { ok: true, legacy: false });
});

test("validateGiftValueBinding: tampered amount (not one of the three presets) rejected", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const tampered = { ...b.value, amountAtomic: 33_000000 };
  assert.equal(validateGiftValueBinding(tampered, { chainScope: CHAIN }).reason, "unsupported_amount");
});

test("validateGiftValueBinding: tampered token address rejected (wrong asset)", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const tampered = { ...b.value, tokenAddress: `0x${"9".repeat(40)}` };
  assert.equal(validateGiftValueBinding(tampered, { chainScope: CHAIN }).reason, "asset_id_chain_mismatch");
});

test("validateGiftValueBinding: tampered decimals rejected", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const tampered = { ...b.value, decimals: 18 };
  assert.equal(validateGiftValueBinding(tampered, { chainScope: CHAIN }).reason, "bad_decimals");
});

// ═══ labels: never say "funded" from identity alone, never value_transferred without a receipt ══
test("giftValueLabel: no value bound -> legacy_identity_only, receipt amount null", () => {
  const record = { value: null, transfer: { status: TRANSFER_STATUS.NOT_ATTEMPTED } };
  assert.equal(giftValueLabel(record), GIFT_VALUE_LABEL.LEGACY_IDENTITY_ONLY);
  assert.equal(giftValueAmountForReceipt(record), null);
});

test("giftValueLabel: value bound but no transfer receipt yet -> value_pending, receipt amount null", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 100 });
  const record = { value: b.value, transfer: { status: TRANSFER_STATUS.NOT_ATTEMPTED } };
  assert.equal(giftValueLabel(record), GIFT_VALUE_LABEL.VALUE_PENDING);
  assert.equal(giftValueAmountForReceipt(record), null);
});

test("giftValueLabel: value bound AND a real transfer receipt -> value_transferred, exact amount only then", () => {
  const b = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 100 });
  const record = { value: b.value, transfer: { status: TRANSFER_STATUS.SETTLED, txHash: `0x${"a".repeat(64)}`, blockNumber: 1 } };
  assert.equal(giftValueLabel(record), GIFT_VALUE_LABEL.VALUE_TRANSFERRED);
  assert.deepEqual(giftValueAmountForReceipt(record), {
    assetSymbol: "USDC", tokenAddress: b.value.tokenAddress, decimals: 6, amountAtomic: 100_000000,
  });
});

// ═══ secret persistence 0 in this module's own source ═══════════════════════════════════════
test("gift-value-spec.js never references secret-shaped identifiers", () => {
  const src = readFileSync(new URL("../src/gift-value-spec.js", import.meta.url), "utf8");
  assert.equal(/privateKey|prfOutput|mnemonic|"seed"/i.test(src), false);
});

// ═══ integration: attachGiftValue binds once, and never re-prices after link creation ═══════
await atest("attachGiftValue binds exactly once; a second attempt to rebind (re-price) is refused", async () => {
  const { record } = await freshValueLink({ giftId: "gv-1" });
  const again = attachGiftValue(record, buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 50 }).value);
  assert.equal(again.ok, false);
  assert.equal(again.reason, "value_already_bound");
  assert.equal(record.value.amountAtomic, 20_000000); // untouched
});

test("claimStatement is byte-identical (no value lines) when no value is bound — A-495/A-499 regression stays exact", () => {
  const withoutValue = claimStatement({
    giftId: "g", chainId: CHAIN, senderAddress: SENDER, recipientAddress: `0x${"b".repeat(40)}`,
    claimTokenHash: "a".repeat(64), claimedAt: "2026-09-24T09:00:00Z",
  });
  assert.ok(!withoutValue.includes("token:"));
  assert.ok(!withoutValue.includes("amount:"));
  assert.ok(!withoutValue.includes("decimals:"));
});

await atest("claimStatement includes token/decimals/amount once bound, and settleClaim verifies against the record's OWN value", async () => {
  const recipient = realAccount();
  const { record, token, value } = await freshValueLink({ giftId: "gv-2" });
  const claimedAt = "2026-09-24T10:00:00Z";
  const statement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: value.tokenAddress, decimals: value.decimals, amountAtomic: value.amountAtomic,
  });
  assert.ok(statement.includes(`token:${value.tokenAddress.toLowerCase()}`));
  assert.ok(statement.includes(`decimals:${value.decimals}`));
  assert.ok(statement.includes(`amount:${value.amountAtomic}`));
  const signature = await recipient.account.signMessage({ message: statement });
  const recovered = await recoverMessageAddress({ message: statement, signature });
  const settled = await settleClaim(record, {
    token, recipientAddress: recipient.address, verifiedSignerAddress: recovered, claimedAt, now: claimedAt,
  });
  assert.equal(settled.result, CLAIM_RESULT.OK, JSON.stringify(settled));
  assert.equal(settled.record.value.amountAtomic, 20_000000);
});

await atest("amount tamper: a signature over a DIFFERENT amount than the record's bound value fails closed — 20 cannot become 50", async () => {
  const recipient = realAccount();
  const { record, token, value } = await freshValueLink({ giftId: "gv-3", presetLabel: 20 });
  const claimedAt = "2026-09-24T10:05:00Z";
  const tamperedStatement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: value.tokenAddress, decimals: value.decimals, amountAtomic: 50_000000, // WRONG — record says 20
  });
  const signature = await recipient.account.signMessage({ message: tamperedStatement });
  // Sanity: the signature IS genuinely valid over the tampered ("50") message.
  const recoveredAgainstTampered = await recoverMessageAddress({ message: tamperedStatement, signature });
  assert.equal(recoveredAgainstTampered.toLowerCase(), recipient.address.toLowerCase());
  // The app never trusts a caller-supplied statement — it recomputes from the record's OWN
  // value (20) and recovers against THAT. A signature made for "50" does not recover to the
  // recipient against the true "20" statement.
  const trueStatement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: value.tokenAddress, decimals: value.decimals, amountAtomic: value.amountAtomic,
  });
  const recoveredAgainstTrue = await recoverMessageAddress({ message: trueStatement, signature });
  assert.notEqual(recoveredAgainstTrue.toLowerCase(), recipient.address.toLowerCase());
  const settled = await settleClaim(record, {
    token, recipientAddress: recipient.address, verifiedSignerAddress: recoveredAgainstTrue, claimedAt, now: claimedAt,
  });
  assert.equal(settled.result, CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE, JSON.stringify(settled));
  assert.equal(settled.record.status, CLAIM_STATUS.UNCLAIMED);
});

await atest("token/asset tamper: a different token address in the signed statement also fails closed", async () => {
  const recipient = realAccount();
  const { record, value } = await freshValueLink({ giftId: "gv-4" });
  const claimedAt = "2026-09-24T10:10:00Z";
  const wrongToken = `0x${"9".repeat(40)}`;
  const trueStatement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: value.tokenAddress, decimals: value.decimals, amountAtomic: value.amountAtomic,
  });
  const tamperedStatement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: wrongToken, decimals: value.decimals, amountAtomic: value.amountAtomic,
  });
  assert.notEqual(trueStatement, tamperedStatement);
  const signature = await recipient.account.signMessage({ message: tamperedStatement });
  const recoveredAgainstTrue = await recoverMessageAddress({ message: trueStatement, signature });
  assert.notEqual(recoveredAgainstTrue.toLowerCase(), recipient.address.toLowerCase());
});

await atest("sender == recipient is still rejected for a value-bound gift", async () => {
  const senderAccount = realAccount();
  const { record, token } = await freshValueLink({ giftId: "gv-5", senderAddress: senderAccount.address });
  const claimedAt = "2026-09-24T10:15:00Z";
  const settled = await settleClaim(record, {
    token, recipientAddress: senderAccount.address, verifiedSignerAddress: senderAccount.address, claimedAt, now: claimedAt,
  });
  assert.equal(settled.result, CLAIM_RESULT.SENDER_IS_RECIPIENT);
});

await atest("replay is still rejected for a value-bound gift (second attempt settles to already-claimed, no second transfer)", async () => {
  const recipient = realAccount();
  const { record, token, value } = await freshValueLink({ giftId: "gv-6" });
  const claimedAt = "2026-09-24T10:20:00Z";
  const statement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: value.tokenAddress, decimals: value.decimals, amountAtomic: value.amountAtomic,
  });
  const signature = await recipient.account.signMessage({ message: statement });
  const recovered = await recoverMessageAddress({ message: statement, signature });
  const first = await settleClaim(record, { token, recipientAddress: recipient.address, verifiedSignerAddress: recovered, claimedAt, now: claimedAt });
  assert.equal(first.result, CLAIM_RESULT.OK);
  const replay = await settleClaim(first.record, { token, recipientAddress: recipient.address, verifiedSignerAddress: recovered, claimedAt, now: claimedAt });
  assert.equal(replay.result, CLAIM_RESULT.ALREADY_CLAIMED_BY_SAME);
});

await atest("secret persistence 0: a fully settled value-bound record never contains the raw token or any secret-shaped field", async () => {
  const recipient = realAccount();
  const { record, token, value } = await freshValueLink({ giftId: "gv-7" });
  const claimedAt = "2026-09-24T10:25:00Z";
  const statement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress: recipient.address, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: value.tokenAddress, decimals: value.decimals, amountAtomic: value.amountAtomic,
  });
  const signature = await recipient.account.signMessage({ message: statement });
  const recovered = await recoverMessageAddress({ message: statement, signature });
  const settled = await settleClaim(record, { token, recipientAddress: recipient.address, verifiedSignerAddress: recovered, claimedAt, now: claimedAt });
  const dump = JSON.stringify(settled.record);
  assert.equal(dump.includes(token), false, "raw claim token leaked");
  assert.equal(/privateKey|prfOutput|mnemonic|"seed"/i.test(dump), false, "secret-shaped field name leaked");
});

// ── [A-573] sender-funded Gift gas: policy + pure budget arithmetic ─────────────────────────
// Fixture numbers below are ARBITRARY TEST INPUTS — not measured gas, not a current fee, not a
// product amount. They exist only to prove exact bigint arithmetic.
// [A-579 Lane G] fundingTransfer is now REQUIRED (A-574 Path A) — the fixture carries all three
// steps; the split is chosen so the 140_000 total (and every expected number below) is unchanged.
const GAS_FIXTURE = Object.freeze({ commitClaim: 50_000n, claim: 80_000n, fundingTransfer: 10_000n });
const FEE_FIXTURE = Object.freeze({ maxFeePerGasWei: 100_000_000_000n, source: "test-fixture" });

test("A-573 policy: sender pays, recipient MON preload requirement is exactly 0n", () => {
  assert.equal(GIFT_GAS_POLICY.payer, "sender");
  assert.equal(GIFT_GAS_POLICY.recipientMonRequired, 0n);
  assert.equal(typeof GIFT_GAS_POLICY.recipientMonRequired, "bigint");
  assert.ok(Object.isFrozen(GIFT_GAS_POLICY));
});

test("A-573 policy: gas layer is delivery-only with zero entitlement authority", () => {
  assert.equal(GIFT_GAS_POLICY.gasLayerAuthority, "delivery_only");
  assert.equal(GIFT_GAS_POLICY.gasLayerMayChooseRecipient, false);
  assert.equal(GIFT_GAS_POLICY.gasLayerMayIssueEntitlement, false);
  assert.equal(GIFT_GAS_POLICY.gasLayerIsAuthorizationSigner, false);
  for (const key of GIFT_GAS_ENTITLEMENT_KEYS) assert.equal(key in GIFT_GAS_POLICY, false, key);
});

test("A-579 policy: the only delivery path is A — MON to the recipient's Gift Piggy after its address exists", () => {
  assert.equal(GIFT_GAS_POLICY.deliveryPath, "A_mon_after_recipient_address");
});

test("A-573 policy: unused-gas handling is recorded as UNDECIDED, not silently adopted", () => {
  assert.equal(GIFT_GAS_POLICY.unusedGasHandling, "UNDECIDED");
  assert.deepEqual([...GIFT_GAS_POLICY.unusedGasOptions], ["return_to_sender", "keep_reserved", "explicit_expiry_refund"]);
});

test("A-573 budget: exact bigint arithmetic, maxFee basis, ceil buffer", () => {
  const r = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety: { bufferBps: 2000 } });
  assert.equal(r.ok, true, JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)));
  const b = r.budget;
  assert.equal(b.status, GIFT_GAS_BUDGET_STATUS.ESTIMATE);
  assert.equal(b.totalGasUnits, 140_000n);
  assert.equal(b.feePerGasWei, 100_000_000_000n);
  assert.equal(b.feeBasis, "max_fee_per_gas");
  assert.equal(b.feeSource, "test-fixture");
  assert.equal(b.baseCostWei, 14_000_000_000_000_000n);
  assert.equal(b.bufferWei, 2_800_000_000_000_000n);
  assert.equal(b.costWei, 16_800_000_000_000_000n);
  assert.equal(b.payer, "sender");
  assert.equal(b.recipientMonRequired, 0n);
  assert.ok(Object.isFrozen(b));
});

test("A-573/A-579 budget: required fundingTransfer step is summed; Number inputs accepted as exact integers", () => {
  const r = giftGasBudget({
    gasUnits: { commitClaim: 50000, claim: 90000, fundingTransfer: 21000 },
    feeInputs: { maxFeePerGasWei: 7, source: "test-fixture" },
    safety: { bufferBps: 0 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.budget.totalGasUnits, 161_000n);
  assert.equal(r.budget.gasUnitsByStep.fundingTransfer, 21_000n);
  assert.equal(r.budget.costWei, 1_127_000n);
  assert.equal(r.budget.bufferWei, 0n);
});

test("A-573 budget: buffer rounds UP (ceil), never down", () => {
  const r = giftGasBudget({
    gasUnits: { commitClaim: 1n, claim: 1n, fundingTransfer: 1n },
    feeInputs: { maxFeePerGasWei: 1n, source: "test-fixture" },
    safety: { bufferBps: 1 },
  });
  assert.equal(r.budget.baseCostWei, 3n);
  assert.equal(r.budget.bufferWei, 1n);
  assert.equal(r.budget.costWei, 4n);
});

test("A-573 budget: base+priority basis sums the two; priority 0 allowed", () => {
  const r = giftGasBudget({
    gasUnits: GAS_FIXTURE,
    feeInputs: { baseFeePerGasWei: 10n, priorityFeePerGasWei: 0n, source: "test-fixture" },
    safety: { bufferBps: 0 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.budget.feeBasis, "base_plus_priority");
  assert.equal(r.budget.feePerGasWei, 10n);
  assert.equal(r.budget.costWei, 1_400_000n);
});

for (const missing of [undefined, null]) {
  test(`A-573 budget: feeInputs ${String(missing)} -> UNKNOWN cost, gas units kept, no invented price`, () => {
    const r = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: missing, safety: { bufferBps: 2000 } });
    assert.equal(r.ok, true);
    assert.equal(r.budget.status, GIFT_GAS_BUDGET_STATUS.UNKNOWN);
    assert.equal(r.budget.totalGasUnits, 140_000n);
    assert.equal(r.budget.costWei, null);
    assert.equal(r.budget.feePerGasWei, null);
    assert.equal(r.budget.feeSource, null);
    assert.equal(r.budget.unknownReason, "fee_inputs_missing");
    assert.equal(r.budget.recipientMonRequired, 0n);
  });
}

for (const [label, feeInputs, reason] of [
  ["no source", { maxFeePerGasWei: 1n }, "fee_source_required"],
  ["blank source", { maxFeePerGasWei: 1n, source: "  " }, "fee_source_required"],
  ["max + base together", { maxFeePerGasWei: 1n, baseFeePerGasWei: 1n, source: "t" }, "fee_inputs_ambiguous"],
  ["base without priority", { baseFeePerGasWei: 1n, source: "t" }, "fee_inputs_invalid"],
  ["zero max fee", { maxFeePerGasWei: 0n, source: "t" }, "fee_inputs_invalid"],
  ["string max fee", { maxFeePerGasWei: "100", source: "t" }, "fee_inputs_invalid"],
  ["fee object empty", { source: "t" }, "fee_inputs_invalid"],
  ["fee not an object", 5n, "fee_inputs_invalid"],
]) {
  test(`A-573 budget: malformed fee inputs (${label}) rejected, not treated as UNKNOWN`, () => {
    const r = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs, safety: { bufferBps: 0 } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
  });
}

test("A-573 budget: buffer exactly at the cap is accepted; one above is rejected (never clamped)", () => {
  const at = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety: { bufferBps: GIFT_GAS_SAFETY_MAX_BPS } });
  assert.equal(at.ok, true);
  const above = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety: { bufferBps: GIFT_GAS_SAFETY_MAX_BPS + 1 } });
  assert.equal(above.ok, false);
  assert.equal(above.reason, "safety_buffer_above_cap");
});

for (const [label, safety, reason] of [
  ["missing safety", undefined, "safety_buffer_missing"],
  ["missing bufferBps", {}, "safety_buffer_missing"],
  ["negative", { bufferBps: -1 }, "safety_buffer_invalid"],
  ["fractional", { bufferBps: 1.5 }, "safety_buffer_invalid"],
  ["string", { bufferBps: "2000" }, "safety_buffer_invalid"],
]) {
  test(`A-573 budget: safety ${label} rejected (no default buffer)`, () => {
    const r = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
  });
}

for (const [label, gasUnits, reason] of [
  ["missing gasUnits", undefined, "gas_units_missing"],
  ["missing claim", { commitClaim: 1n }, "gas_units_missing"],
  ["missing commitClaim", { claim: 1n }, "gas_units_missing"],
  ["negative bigint", { commitClaim: -1n, claim: 1n }, "gas_units_invalid"],
  ["negative number", { commitClaim: 1n, claim: -5 }, "gas_units_invalid"],
  ["zero", { commitClaim: 0n, claim: 1n }, "gas_units_invalid"],
  ["fractional", { commitClaim: 1.5, claim: 1n }, "gas_units_invalid"],
  ["string", { commitClaim: "50000", claim: 1n }, "gas_units_invalid"],
  ["NaN", { commitClaim: NaN, claim: 1n }, "gas_units_invalid"],
  ["unsafe integer", { commitClaim: Number.MAX_SAFE_INTEGER + 1, claim: 1n }, "gas_units_invalid"],
  ["invalid fundingTransfer", { commitClaim: 1n, claim: 1n, fundingTransfer: -1n }, "gas_units_invalid"],
  // [A-579 Lane G] A-574 Path A: the delivery transfer is part of what the sender pays — a budget
  // without it is refused instead of silently under-counting.
  ["missing fundingTransfer (A-579 required)", { commitClaim: 1n, claim: 1n }, "gas_units_missing"],
  ["unknown step", { commitClaim: 1n, claim: 1n, refund: 1n }, "gas_unknown_field"],
]) {
  test(`A-573 budget: gas units ${label} rejected`, () => {
    const r = giftGasBudget({ gasUnits, feeInputs: FEE_FIXTURE, safety: { bufferBps: 0 } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
  });
}

test("A-573 budget: every entitlement key is refused at every input level", () => {
  for (const key of GIFT_GAS_ENTITLEMENT_KEYS) {
    const top = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety: { bufferBps: 0 }, [key]: "0x01" });
    assert.equal(top.reason, "gas_entitlement_field_refused", `top-level ${key}`);
    const inUnits = giftGasBudget({ gasUnits: { ...GAS_FIXTURE, [key]: 1n }, feeInputs: FEE_FIXTURE, safety: { bufferBps: 0 } });
    assert.equal(inUnits.reason, "gas_entitlement_field_refused", `gasUnits.${key}`);
    const inFee = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: { ...FEE_FIXTURE, [key]: "0x01" }, safety: { bufferBps: 0 } });
    assert.equal(inFee.reason, "gas_entitlement_field_refused", `feeInputs.${key}`);
    const inSafety = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety: { bufferBps: 0, [key]: "0x01" } });
    assert.equal(inSafety.reason, "gas_entitlement_field_refused", `safety.${key}`);
  }
});

test("A-573 budget: output (ESTIMATE and UNKNOWN) carries no entitlement key", () => {
  const est = giftGasBudget({ gasUnits: GAS_FIXTURE, feeInputs: FEE_FIXTURE, safety: { bufferBps: 0 } }).budget;
  const unk = giftGasBudget({ gasUnits: GAS_FIXTURE, safety: { bufferBps: 0 } }).budget;
  for (const b of [est, unk]) {
    for (const key of GIFT_GAS_ENTITLEMENT_KEYS) assert.equal(key in b, false, key);
    for (const key of GIFT_GAS_ENTITLEMENT_KEYS) assert.equal(key in b.gasUnitsByStep, false, key);
  }
});

test("A-573 source scan: no 0.05 MON (or its wei form) as a constant/default in gift-value-spec.js", () => {
  // TEST-ONLY candidate (INBOX A-573: "~0.05 MON/Gift only as an initial conservative local/test
  // budget candidate") — named here solely to prove src does NOT encode it as policy.
  const TEST_ONLY_CANDIDATE_WEI = 50_000_000_000_000_000n;
  const src = readFileSync(new URL("../src/gift-value-spec.js", import.meta.url), "utf8");
  assert.equal(/0\.05/.test(src), false, "0.05 literal in src");
  assert.equal(src.includes(String(TEST_ONLY_CANDIDATE_WEI)), false, "0.05 MON wei literal in src");
  assert.equal(/50_000_000_000_000_000|5e16|5n\s*\*\s*10n\s*\*\*\s*16n/.test(src), false, "0.05 MON alt literal in src");
});

test("A-573 source scan: gift gas helper never touches a provider/network", () => {
  const src = readFileSync(new URL("../src/gift-value-spec.js", import.meta.url), "utf8");
  assert.equal(/fetch\(|estimateGas|getGasPrice|eth_gasPrice|eth_feeHistory|\.request\(|createPublicClient/.test(src), false);
});

console.log(`\n${pass}/${pass} PASS`);
