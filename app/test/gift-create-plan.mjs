// [A-564 LANE B/TESTS] Gift create plan — sender-side, pure. Proves: giftId identical across
// link/record/escrow args; claimTokenHash is the same commitment A-562's record source would
// decode back; exact 20/50/100 presets only; a changed giftId cannot read/claim a different
// gift through the real (unmodified) gift-record-source.js; no raw token/claimSigner secret
// anywhere in output or source; claimSigner is refused, not silently accepted; legacy
// createClaimLink stays compatible; no permission object is ever created. Network 0.
//   node app/test/gift-create-plan.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planGiftCreate } from "../src/gift-create-plan.js";
import * as giftCreatePlanModule from "../src/gift-create-plan.js";
import {
  createClaimLink,
  CLAIM_STATUS,
  GIFT_LINK_VERSION,
  hashClaimToken,
  parseClaimUrl,
} from "../src/gift-piggy-claim-link.js";
import { createGiftRecordSource } from "../src/gift-record-source.js";
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "../src/funding-context.js";
import {
  GIFT_VALUE_DECIMALS,
  GIFT_GAS_POLICY,
  GIFT_GAS_BUDGET_STATUS,
  GIFT_GAS_ENTITLEMENT_KEYS,
} from "../src/gift-value-spec.js";

let pass = 0;
function test(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }
async function atest(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

const CHAIN = "monad-testnet";
const CHAIN_NUMERIC_ID = 10143;
const USDC = FUNDING_CONTEXT_TOKEN_ALLOWLIST[CHAIN].USDC.assetId;
const CONTRACT_ADDRESS = "0x00000000000000000000000000000000BADC0DE0";
const SENDER = "0x00000000000000000000000000000000000000a1";
const CLAIM_SIGNER = "0x00000000000000000000000000000000000000b2"; // used only to prove the claimSigner INPUT is refused
const T0 = "2026-09-24T00:00:00.000Z";
const FUTURE_EXPIRY_SECONDS = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,86}$/;

function validPlan(overrides = {}) {
  return planGiftCreate({
    chainScope: CHAIN,
    presetLabel: 20,
    senderAddress: SENDER,
    expiry: FUTURE_EXPIRY_SECONDS,
    createdAt: T0,
    origin: "https://araso.app",
    ...overrides,
  });
}

// ── basic shape / success path ──────────────────────────────────────────────────────────────
await atest("valid plan: ok, giftId is bytes32", async () => {
  const plan = await validPlan();
  assert.equal(plan.ok, true);
  assert.match(plan.giftId, BYTES32);
});

await atest("giftId is the token commitment across record and escrow args", async () => {
  const plan = await validPlan();
  assert.equal(plan.record.giftId, plan.giftId);
  assert.equal(plan.escrowCreateArgs.giftId, plan.giftId);
  assert.equal(plan.giftId, `0x${await hashClaimToken(plan.fragment.token)}`);
});

await atest("two plans mint different giftId values (real randomness, not a fixed id)", async () => {
  const a = await validPlan();
  const b = await validPlan();
  assert.notEqual(a.giftId, b.giftId);
});

await atest("fragment.token matches the primitive's own capability-token shape", async () => {
  const plan = await validPlan();
  assert.match(plan.fragment.token, TOKEN_RE);
  assert.equal(plan.fragment.version, GIFT_LINK_VERSION);
});

await atest("claimUrl is built only when origin is given, via the real buildClaimUrl", async () => {
  const withOrigin = await validPlan({ origin: "https://araso.app" });
  assert.ok(typeof withOrigin.claimUrl === "string" && withOrigin.claimUrl.includes("#t="));
  const withoutOrigin = await validPlan({ origin: null });
  assert.equal(withoutOrigin.claimUrl, null);
});

await atest("claimUrl stays short; the selected letter is hash-bound only in the registration record", async () => {
  const note = "02\nDana\nfor you\nSam";
  const plan = await validPlan({ note, presetLabel: 20 });
  const parsed = parseClaimUrl(plan.claimUrl);
  assert.deepEqual(parsed, { ok: true, token: plan.fragment.token });
  assert.equal(plan.claimUrl.includes("&n="), false);
  assert.equal(plan.claimUrl.includes("&a="), false);
  assert.match(plan.record.letterHash, HEX64);
});

// ── claimTokenHash: same commitment record <-> escrow args, and matches the real getter shape ──
await atest("claimTokenHash: record and escrowCreateArgs carry the SAME commitment, two encodings", async () => {
  const plan = await validPlan();
  assert.match(plan.record.claimTokenHash, HEX64); // bare 64-hex, no 0x (record's own shape)
  assert.match(plan.escrowCreateArgs.claimTokenHash, BYTES32); // 0x + 64-hex (escrow's own shape)
  assert.equal(plan.escrowCreateArgs.claimTokenHash.toLowerCase(), `0x${plan.record.claimTokenHash}`);
});

await atest("claimTokenHash actually equals sha256(fragment.token) via the real hashClaimToken()", async () => {
  const plan = await validPlan();
  const expected = await hashClaimToken(plan.fragment.token);
  assert.equal(plan.record.claimTokenHash, expected);
});

await atest("claimTokenHash round-trips through gift-record-source.js's own decode shape (A-562 getter)", async () => {
  const plan = await validPlan();
  // Same normalization gift-record-source.js's (unexported) normalizeClaimTokenHash performs:
  // 0x-bytes32 -> strip 0x -> lowercase -> compare to the record's own HEX64 field.
  const decoded = plan.escrowCreateArgs.claimTokenHash.slice(2).toLowerCase();
  assert.equal(decoded, plan.record.claimTokenHash);
});

// ── exact 20/50/100 presets, no default, no custom amount ──────────────────────────────────
for (const [label, atomic] of [[20, 20_000000], [50, 50_000000], [100, 100_000000]]) {
  await atest(`preset ${label} resolves to exact atomic amount ${atomic}`, async () => {
    const plan = await validPlan({ presetLabel: label });
    assert.equal(plan.ok, true);
    assert.equal(plan.escrowCreateArgs.amount, atomic);
    assert.equal(plan.record.value.amountAtomic, atomic);
    assert.equal(plan.record.value.decimals, GIFT_VALUE_DECIMALS);
    assert.equal(plan.record.value.tokenAddress, USDC);
  });
}

for (const bad of [undefined, null, 0, -20, 30, 21, "20", 20.5, true, {}]) {
  await atest(`presetLabel ${JSON.stringify(bad)} is rejected (no default, no custom amount)`, async () => {
    const plan = await validPlan({ presetLabel: bad });
    assert.equal(plan.ok, false);
    assert.ok(["explicit_selection_required", "unsupported_amount"].includes(plan.reason));
  });
}

// ── claimSigner: refused outright, never accepted/ignored ──────────────────────────────────
await atest("passing claimSigner is refused, not silently accepted or ignored", async () => {
  const plan = await validPlan({ claimSigner: CLAIM_SIGNER });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "claim_signer_not_supported");
});

// ── [A-575] adopted A commit-reveal: no claimSigner field, no stale claimSigner blocker ─────
await atest("escrowCreateArgs has NO claimSigner field at all (not null, not a placeholder)", async () => {
  const plan = await validPlan();
  assert.equal("claimSigner" in plan.escrowCreateArgs, false);
});

await atest("[A-575] plan carries no stale pre-A-570 claimSigner blocker (A escrow has no claimSigner)", async () => {
  const plan = await validPlan();
  assert.equal(plan.ok, true);
  assert.equal("blocker" in plan, false);
  assert.equal("blockerDetail" in plan, false);
  assert.equal("GIFT_CREATE_BLOCKER" in giftCreatePlanModule, false);
});

await atest("[A-575] escrowCreateArgs keys = exactly the adopted A create(giftId, token, amount, expiry, claimTokenHash)", async () => {
  const plan = await validPlan();
  assert.deepEqual(Object.keys(plan.escrowCreateArgs), ["giftId", "token", "amount", "expiry", "claimTokenHash"]);
});

await atest("escrowCreateArgs still carries every OTHER field an escrow create() call needs", async () => {
  const plan = await validPlan();
  assert.equal(plan.escrowCreateArgs.token, USDC);
  assert.equal(plan.escrowCreateArgs.amount, 20_000000);
  assert.equal(plan.escrowCreateArgs.expiry, FUTURE_EXPIRY_SECONDS);
  assert.match(plan.escrowCreateArgs.claimTokenHash, BYTES32);
});

// ── input validation: sender / chain / expiry ───────────────────────────────────────────────
await atest("bad senderAddress rejected", async () => {
  const plan = await validPlan({ senderAddress: "0xnope" });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "bad_sender_address");
});

await atest("missing/unknown chainScope rejected", async () => {
  const plan = await validPlan({ chainScope: "unknown-chain" });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "asset_id_chain_mismatch");
});

for (const bad of [undefined, null, 0, -1, "not-a-number", NaN]) {
  await atest(`bad expiry ${JSON.stringify(bad)} rejected`, async () => {
    const plan = await validPlan({ expiry: bad });
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, "bad_expiry");
  });
}

// ── no secret persistence/logging ───────────────────────────────────────────────────────────
await atest("record never carries the raw fragment token — only its hash", async () => {
  const plan = await validPlan();
  const recordJson = JSON.stringify(plan.record);
  assert.equal(recordJson.includes(plan.fragment.token), false);
});

await atest("source scan: no secret-shaped identifier anywhere in gift-create-plan.js's own text", () => {
  const src = readFileSync(new URL("../src/gift-create-plan.js", import.meta.url), "utf8");
  const secretLike = /privatekey|private_key|\bprf\b|prfoutput|mnemonic|seed|sessionsecret|signingkey|keymaterial/i;
  const matches = src.match(secretLike);
  assert.equal(matches, null, `unexpected secret-shaped identifier: ${matches}`);
});

await atest("source scan: gift-create-plan.js never imports/creates a permission envelope", () => {
  const src = readFileSync(new URL("../src/gift-create-plan.js", import.meta.url), "utf8");
  assert.equal(src.includes("permission-envelope"), false);
  assert.equal(src.includes("issuePermission"), false);
});

await atest("source scan: gift-create-plan.js never sends a transaction or touches a provider", () => {
  const src = readFileSync(new URL("../src/gift-create-plan.js", import.meta.url), "utf8");
  assert.equal(/writeContract|sendTransaction|\.request\(/.test(src), false);
});

// ── legacy identity-only createClaimLink stays compatible (primitive untouched by this file) ──
test("legacy identity-only createClaimLink() still works exactly as before (no value, short giftId)", () => {
  const made = createClaimLink({ giftId: "g-001", senderAddress: SENDER, chainId: CHAIN, createdAt: T0 });
  assert.equal(made.ok, true);
  assert.equal(made.record.value, null);
  assert.equal(made.record.status, CLAIM_STATUS.UNCLAIMED);
});

// ── integration: a changed giftId cannot read/claim a different gift via gift-record-source ──
function tupleFor(claimTokenHashBytes32) {
  // [A-575] adopted A getter: sender, token, amount, expiry, claimed, claimTokenHash (6 fields).
  return [SENDER, USDC, 20_000000n, BigInt(FUTURE_EXPIRY_SECONDS), false, claimTokenHashBytes32];
}

/** Mock viem-style client keyed by giftId — only the gift's OWN id gets its own tuple back;
 * every other id gets an empty/zero tuple (what a real chain returns for a never-created gift),
 * exactly like `gift-record-source.mjs`'s own fakeClient() convention (read-only, no write). */
function fakeClientKeyedByGiftId(byGiftId) {
  return {
    chain: { id: CHAIN_NUMERIC_ID },
    async readContract({ address, functionName, args }) {
      assert.equal(address, CONTRACT_ADDRESS);
      assert.equal(functionName, "gifts");
      const id = args[0];
      return byGiftId[id] ?? [
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        0n,
        0n,
        false,
        `0x${"0".repeat(64)}`,
      ];
    },
  };
}

await atest("changed/different giftId cannot read another gift's record through gift-record-source.js", async () => {
  const planA = await validPlan();
  const byGiftId = { [planA.giftId]: tupleFor(planA.escrowCreateArgs.claimTokenHash) };
  const source = createGiftRecordSource({
    client: fakeClientKeyedByGiftId(byGiftId),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });

  // The plan's own giftId reads back its own real record.
  const own = await source.getRecordByGiftId(planA.giftId);
  assert.ok(own, "the plan's own giftId must read its own record");
  assert.equal(own.claimTokenHash, planA.record.claimTokenHash);

  // A single-hex-char-flipped giftId (a different key entirely on-chain) reads nothing — it
  // cannot silently return gift A's record, and cannot be used to claim gift A.
  const flippedChar = planA.giftId[3] === "0" ? "1" : "0";
  const tamperedGiftId = `${planA.giftId.slice(0, 3)}${flippedChar}${planA.giftId.slice(4)}`;
  assert.notEqual(tamperedGiftId, planA.giftId);
  const tampered = await source.getRecordByGiftId(tamperedGiftId);
  assert.equal(tampered, null);

  // A second, real, independently-planned gift's id also cannot read gift A's record.
  const planB = await validPlan();
  const otherGiftRead = await source.getRecordByGiftId(planB.giftId);
  assert.equal(otherGiftRead, null); // planB was never "created" in this mock chain
});

// ── [A-573] sender-funded gas budget in the sender's plan — zero entitlement authority ───────
// ARBITRARY TEST FIXTURES — not measured gas, not a current fee, not a product amount.
const GAS_INPUT = Object.freeze({
  // [A-579 Lane G] fundingTransfer required (A-574 Path A); split keeps the 140_000 total unchanged.
  gasUnits: { commitClaim: 50_000n, claim: 80_000n, fundingTransfer: 10_000n },
  feeInputs: { maxFeePerGasWei: 100_000_000_000n, source: "test-fixture" },
  safety: { bufferBps: 2000 },
});

await atest("A-573: plan without gas -> gasBudget null (no default amount) and sender-pays policy attached", async () => {
  const plan = await validPlan();
  assert.equal(plan.ok, true);
  assert.equal(plan.gasBudget, null);
  assert.equal(plan.gasPolicy, GIFT_GAS_POLICY);
  assert.equal(plan.gasPolicy.payer, "sender");
  assert.equal(plan.gasPolicy.recipientMonRequired, 0n);
});

await atest("A-573: plan with gas carries value AND an exact gas budget together", async () => {
  const plan = await validPlan({ gas: GAS_INPUT });
  assert.equal(plan.ok, true);
  assert.equal(plan.escrowCreateArgs.amount, 20_000000);
  assert.equal(plan.gasBudget.status, GIFT_GAS_BUDGET_STATUS.ESTIMATE);
  assert.equal(plan.gasBudget.totalGasUnits, 140_000n);
  assert.equal(plan.gasBudget.costWei, 16_800_000_000_000_000n);
  assert.equal(plan.gasBudget.recipientMonRequired, 0n);
});

await atest("A-573: plan with gas but no fee inputs -> UNKNOWN cost, plan still ok", async () => {
  const plan = await validPlan({ gas: { gasUnits: GAS_INPUT.gasUnits, safety: GAS_INPUT.safety } });
  assert.equal(plan.ok, true);
  assert.equal(plan.gasBudget.status, GIFT_GAS_BUDGET_STATUS.UNKNOWN);
  assert.equal(plan.gasBudget.costWei, null);
});

await atest("A-573: invalid gas input fails the whole plan with the budget's own reason", async () => {
  const bad = await validPlan({ gas: { ...GAS_INPUT, safety: { bufferBps: 999_999 } } });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "safety_buffer_above_cap");
  const badUnits = await validPlan({ gas: { ...GAS_INPUT, gasUnits: { commitClaim: -1n, claim: 1n } } });
  assert.equal(badUnits.ok, false);
  assert.equal(badUnits.reason, "gas_units_invalid");
});

await atest("A-573: gas input cannot smuggle recipient/giftId/claimTokenHash/signer into the plan", async () => {
  for (const key of ["recipient", "giftId", "claimTokenHash", "claimSigner", "signer", "committer"]) {
    const top = await validPlan({ gas: { ...GAS_INPUT, [key]: "0x00000000000000000000000000000000000000c3" } });
    assert.equal(top.ok, false, key);
    assert.equal(top.reason, "gas_entitlement_field_refused", key);
    const nested = await validPlan({ gas: { ...GAS_INPUT, feeInputs: { ...GAS_INPUT.feeInputs, [key]: "0xc3" } } });
    assert.equal(nested.ok, false, key);
    assert.equal(nested.reason, "gas_entitlement_field_refused", key);
  }
});

await atest("A-573: gas budget does not change escrowCreateArgs/record/fragment shape; budget has no entitlement key", async () => {
  const withGas = await validPlan({ gas: GAS_INPUT });
  const without = await validPlan();
  assert.deepEqual(Object.keys(withGas.escrowCreateArgs).sort(), Object.keys(without.escrowCreateArgs).sort());
  assert.deepEqual(Object.keys(withGas.fragment).sort(), Object.keys(without.fragment).sort());
  assert.deepEqual(Object.keys(withGas.record).sort(), Object.keys(without.record).sort());
  assert.equal("claimSigner" in withGas.escrowCreateArgs, false);
  assert.equal("recipient" in withGas.escrowCreateArgs, false);
  for (const key of GIFT_GAS_ENTITLEMENT_KEYS) assert.equal(key in withGas.gasBudget, false, key);
  // giftId/claimTokenHash still come only from the plan's own minting/sealing.
  assert.equal(withGas.escrowCreateArgs.giftId, withGas.giftId);
  assert.equal(withGas.escrowCreateArgs.claimTokenHash.toLowerCase(), `0x${withGas.record.claimTokenHash}`);
});

await atest("A-573: claimSigner refusal still wins even when a valid gas budget is supplied", async () => {
  const plan = await validPlan({ gas: GAS_INPUT, claimSigner: CLAIM_SIGNER });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "claim_signer_not_supported");
});

await atest("A-573 source scan: gift-create-plan.js has no 0.05 MON constant and no gas-price lookup", () => {
  const src = readFileSync(new URL("../src/gift-create-plan.js", import.meta.url), "utf8");
  assert.equal(/0\.05|50000000000000000|50_000_000_000_000_000|5e16/.test(src), false);
  assert.equal(/estimateGas|getGasPrice|eth_gasPrice|eth_feeHistory|fetch\(/.test(src), false);
});

console.log(`\n${pass} passed`);
