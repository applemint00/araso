// [A-562 LANE B/TESTS] Gift on-chain record source — maps the real GiftPiggyUSDC forge getter
// tuple shape into the A-559 record shape, fails closed on any wrong chain/contract/token/
// decimals/amount/malformed-tuple condition, and proves end-to-end tamper rejection through the
// real gift-claim-entry.js/gift-piggy-claim-link.js product path (no mirror/reimplementation).
// Network 0 · no real RPC · no signer/tx.
//   node app/test/gift-record-source.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { recoverMessageAddress } from "viem";
import { createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createGiftRecordSource } from "../src/gift-record-source.js";
import { CLAIM_STATUS, TRANSFER_STATUS, claimStatement } from "../src/gift-piggy-claim-link.js";
import { beginGiftClaim, GIFT_ENTRY_STATUS, settleGiftClaim } from "../src/gift-claim-entry.js";
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "../src/funding-context.js";
import { GIFT_VALUE_DECIMALS } from "../src/gift-value-spec.js";

let pass = 0;
function test(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }
async function atest(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

const CHAIN = "monad-testnet";
const CHAIN_NUMERIC_ID = 10143; // funding-context.js CHAIN_SCOPE_BY_NUMERIC_ID[10143] === "monad-testnet"
const OTHER_CHAIN_NUMERIC_ID = 143; // "monad-mainnet"
const USDC = FUNDING_CONTEXT_TOKEN_ALLOWLIST[CHAIN].USDC.assetId; // real checksummed allowlist address, not re-typed
const CONTRACT_ADDRESS = "0x00000000000000000000000000000000BADC0DE0"; // shape-only, injected — never hardcoded product default
const SENDER = "0x00000000000000000000000000000000000000a1";
// [A-575] retired pre-A-570 field value — used ONLY to prove the 7-field shape is refused.
const RETIRED_CLAIM_SIGNER = "0x00000000000000000000000000000000000000b2";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

// [Control: derive from the real forge artifact, not a hand-typed guess] Confirms the exact
// `gifts(bytes32)` output shape the module's own minimal ABI must match — verified against the
// real compiled artifact. [A-575] = the ADOPTED A commit-reveal contract (byte-identical A-568
// candidate_a copy, built by `forge build` in the local mainnet-fork harness).
// Public checkout: the artifact is local-only. Without it this control prints SKIP (not PASS) and the
// adapter checks below compare against the same pinned shape the control asserts.
const PINNED_OUTPUT_SHAPE = ["sender:address", "token:address", "amount:uint256", "expiry:uint64", "claimed:bool", "claimTokenHash:bytes32"];
const ARTIFACT = existsSync(new URL("../../_private", import.meta.url)) ? JSON.parse(
  readFileSync(new URL("../../_private/ops/harness/gift-mainnet-fork/out/GiftPiggyUSDC.sol/GiftPiggyUSDC.json", import.meta.url)),
) : null;
if (ARTIFACT === null) console.log("SKIP  control: real forge artifact gifts() shape — local artifact absent (public checkout)");
const GIFTS_ABI_ENTRY = ARTIFACT === null ? null : ARTIFACT.abi.find((item) => item.type === "function" && item.name === "gifts");
if (ARTIFACT !== null) assert.ok(GIFTS_ABI_ENTRY, "control: real forge artifact must expose a gifts() getter — if this fails, the artifact path/name is wrong, not that the getter is absent");
const REAL_OUTPUT_SHAPE = ARTIFACT === null ? PINNED_OUTPUT_SHAPE : GIFTS_ABI_ENTRY.outputs.map((o) => `${o.name}:${o.type}`);
assert.deepEqual(
  REAL_OUTPUT_SHAPE,
  PINNED_OUTPUT_SHAPE,
  "real artifact gifts() getter shape changed — gift-record-source.js's tuple mapping must be updated to match",
);

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

// A real, deterministic bytes32 claimTokenHash "commitment" the way the escrow's create() would
// have stored it — sha256 of a raw capability token, same function gift-piggy-claim-link.js's
// own hashClaimToken() uses, just computed with node:crypto instead of WebCrypto for a plain
// non-DOM test file (identical algorithm, not a different one).
const RAW_TOKEN = "aVeryRealisticCapabilityTokenForTestingOnly1234567890AB";
const CLAIM_TOKEN_HASH_HEX = sha256Hex(RAW_TOKEN); // 64 lowercase hex, no 0x — the app record shape
const CLAIM_TOKEN_HASH_BYTES32 = `0x${CLAIM_TOKEN_HASH_HEX}`; // what the chain getter actually returns

const FUTURE_EXPIRY_SECONDS = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

/** A real 20 USDC gift's on-chain tuple, exactly the field order/types the real artifact has. */
function goodTuple({
  sender = SENDER,
  token = USDC,
  amount = 20_000000n,
  expiry = BigInt(FUTURE_EXPIRY_SECONDS),
  claimed = false,
  claimTokenHash = CLAIM_TOKEN_HASH_BYTES32,
} = {}) {
  return [sender, token, amount, expiry, claimed, claimTokenHash];
}

/** Fake viem-style client — readContract only, no write/signer, same convention
 * funding-runtime-core.mjs's fakeClient()/funding-reconcile.js's contract already use. */
function fakeClient({ chainId = CHAIN_NUMERIC_ID, tuple = goodTuple(), throws = false } = {}) {
  return {
    chain: { id: chainId },
    async readContract({ address, abi, functionName, args }) {
      if (throws) throw new Error("rpc down");
      assert.equal(address, CONTRACT_ADDRESS, "adapter must call readContract at the injected contract address only");
      assert.equal(functionName, "gifts");
      assert.equal(args.length, 1);
      assert.ok(abi[0].name === "gifts" && abi[0].outputs.length === 6, "adapter ABI must be the exact 6-field A gifts() getter");
      assert.deepEqual(abi[0].outputs.map((o) => `${o.name}:${o.type}`), REAL_OUTPUT_SHAPE, "adapter ABI must match the real A artifact");
      return tuple;
    },
  };
}

const GIFT_ID_BYTES32 = "0x" + "11".repeat(32);

// ── config gate ──────────────────────────────────────────────────────────────────────────────
test("absent config: missing client -> null (no source built)", () => {
  assert.equal(createGiftRecordSource({ chainScope: CHAIN, contractAddress: CONTRACT_ADDRESS }), null);
});
test("absent config: missing chainScope -> null", () => {
  assert.equal(createGiftRecordSource({ client: fakeClient(), contractAddress: CONTRACT_ADDRESS }), null);
});
test("absent config: missing contractAddress -> null", () => {
  assert.equal(createGiftRecordSource({ client: fakeClient(), chainScope: CHAIN }), null);
});
test("absent config: malformed contractAddress -> null", () => {
  assert.equal(createGiftRecordSource({ client: fakeClient(), chainScope: CHAIN, contractAddress: "not-an-address" }), null);
});
test("absent config: client without readContract -> null", () => {
  assert.equal(createGiftRecordSource({ client: {}, chainScope: CHAIN, contractAddress: CONTRACT_ADDRESS }), null);
});

// ── real getter-shape mapping ────────────────────────────────────────────────────────────────
await atest("maps the real getter tuple into the exact A-559 record shape", async () => {
  const source = createGiftRecordSource({ client: fakeClient(), chainScope: CHAIN, contractAddress: CONTRACT_ADDRESS });
  const record = await source.getRecordByGiftId(GIFT_ID_BYTES32);
  assert.ok(record, "expected a mapped record");
  assert.equal(record.giftId, GIFT_ID_BYTES32);
  assert.equal(record.senderAddress, SENDER);
  assert.equal(record.chainId, CHAIN);
  assert.equal(record.claimTokenHash, CLAIM_TOKEN_HASH_HEX);
  assert.equal(record.status, CLAIM_STATUS.UNCLAIMED);
  assert.equal(record.recipientAddress, null);
  assert.equal(record.transfer.status, TRANSFER_STATUS.NOT_ATTEMPTED);
  assert.equal(record.value.tokenAddress, USDC);
  assert.equal(record.value.decimals, GIFT_VALUE_DECIMALS);
  assert.equal(record.value.amountAtomic, 20_000000);
  assert.equal(new Date(record.expiresAt).getTime(), FUTURE_EXPIRY_SECONDS * 1000);
});

await atest("claimed=true on-chain -> CLAIMED (covers both real claim and refund honestly)", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ claimed: true }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const record = await source.getRecordByGiftId(GIFT_ID_BYTES32);
  assert.equal(record.status, CLAIM_STATUS.CLAIMED);
  assert.equal(record.recipientAddress, null, "recipient is never knowable from this getter — never fabricated");
});

// ── fail-closed: chain / contract / token / decimals / amount / malformed tuple ─────────────
await atest("wrong chain (client connected elsewhere) -> null", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ chainId: OTHER_CHAIN_NUMERIC_ID }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("unknown numeric chain id -> null (scopeForChainId has no mapping)", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ chainId: 999999 }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("wrong token address (not the chain's canonical USDC) -> null", async () => {
  const wrongToken = "0x00000000000000000000000000000000000000ff";
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ token: wrongToken }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("lowercased (non-checksummed) token address is still accepted (case-insensitive full-address equality)", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ token: USDC.toLowerCase() }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const record = await source.getRecordByGiftId(GIFT_ID_BYTES32);
  assert.ok(record, "a real viem client checksums decoded addresses (verified against viem directly); this only guards the comparison itself");
});

for (const badAmount of [0n, -1n, 19_000000n, 21_000000n, 99_999999n, 1n]) {
  await atest(`unsupported amount ${badAmount} (not exactly 20/50/100 preset atomic) -> null`, async () => {
    const source = createGiftRecordSource({
      client: fakeClient({ tuple: goodTuple({ amount: badAmount }) }),
      chainScope: CHAIN,
      contractAddress: CONTRACT_ADDRESS,
    });
    assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
  });
}

for (const preset of [20_000000n, 50_000000n, 100_000000n]) {
  await atest(`exact preset amount ${preset} accepted`, async () => {
    const source = createGiftRecordSource({
      client: fakeClient({ tuple: goodTuple({ amount: preset }) }),
      chainScope: CHAIN,
      contractAddress: CONTRACT_ADDRESS,
    });
    const record = await source.getRecordByGiftId(GIFT_ID_BYTES32);
    assert.equal(record.value.amountAtomic, Number(preset));
  });
}

await atest("zero sender -> null (no such gift / malformed)", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ sender: ZERO_ADDRESS }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("[A-575] retired pre-A-570 7-field claimSigner tuple -> null (never re-mapped)", async () => {
  const [sender, token, amount, expiry, claimed, claimTokenHash] = goodTuple();
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: [sender, token, amount, RETIRED_CLAIM_SIGNER, expiry, claimed, claimTokenHash] }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("zero claimTokenHash (never sealed) -> null, never a fabricated hash", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ claimTokenHash: ZERO_BYTES32 }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("malformed claimTokenHash (wrong length) -> null", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ claimTokenHash: "0xabcd" }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("zero expiry -> null", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ expiry: 0n }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("non-boolean claimed field (malformed tuple) -> null", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ claimed: "true" }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("short/malformed tuple (missing fields) -> null", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: [SENDER, USDC, 20_000000n] }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("named-object tuple shape is also accepted (not only arrays)", async () => {
  const objTuple = {
    sender: SENDER, token: USDC, amount: 20_000000n,
    expiry: BigInt(FUTURE_EXPIRY_SECONDS), claimed: false, claimTokenHash: CLAIM_TOKEN_HASH_BYTES32,
  };
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: objTuple }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const record = await source.getRecordByGiftId(GIFT_ID_BYTES32);
  assert.ok(record);
  assert.equal(record.senderAddress, SENDER);
});

await atest("[A-575] named-object tuple still carrying retired claimSigner -> null", async () => {
  const objTuple = {
    sender: SENDER, token: USDC, amount: 20_000000n, claimSigner: RETIRED_CLAIM_SIGNER,
    expiry: BigInt(FUTURE_EXPIRY_SECONDS), claimed: false, claimTokenHash: CLAIM_TOKEN_HASH_BYTES32,
  };
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: objTuple }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("read failure (rpc throws) -> null, never a guessed state", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ throws: true }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  assert.equal(await source.getRecordByGiftId(GIFT_ID_BYTES32), null);
});

await atest("giftId not shaped as bytes32 -> null (this source doesn't invent a string->bytes32 derivation)", async () => {
  const source = createGiftRecordSource({ client: fakeClient(), chainScope: CHAIN, contractAddress: CONTRACT_ADDRESS });
  assert.equal(await source.getRecordByGiftId("not-a-bytes32-id"), null);
  assert.equal(await source.getRecordByGiftId(""), null);
  assert.equal(await source.getRecordByGiftId(undefined), null);
});

// ── absent config end-to-end through gift-claim-entry.js (record_source_unavailable) ────────
await atest("absent config -> beginGiftClaim() says record_source_unavailable, 0 auth/action", async () => {
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: GIFT_ID_BYTES32, token: RAW_TOKEN },
    recordSource: null, // exactly what main.js's GIFT_RECORD_SOURCE stays while GIFT_RECORD_CONFIG is null
  });
  assert.equal(opened.status, GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE);
});

// ── real end-to-end product path through this record source (open -> settle) ────────────────
function realAccount() {
  const session = createSecp256k1SigningSession({ privateKey: crypto.randomBytes(32) });
  return { address: getEvmAddress(session.publicKey), account: toViemAccount(session) };
}

await atest("full product path: open -> real signature -> settle, via this record source", async () => {
  const recipient = realAccount();
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ amount: 50_000000n }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: GIFT_ID_BYTES32, token: RAW_TOKEN },
    recordSource: source,
  });
  assert.equal(opened.status, GIFT_ENTRY_STATUS.READY, JSON.stringify(opened));
  assert.equal(opened.record.value.amountAtomic, 50_000000);

  const claimedAt = new Date().toISOString();
  const statement = claimStatement({
    giftId: opened.record.giftId,
    chainId: opened.record.chainId,
    senderAddress: opened.record.senderAddress,
    recipientAddress: recipient.address,
    claimTokenHash: opened.record.claimTokenHash,
    claimedAt,
    tokenAddress: opened.record.value.tokenAddress,
    decimals: opened.record.value.decimals,
    amountAtomic: opened.record.value.amountAtomic,
  });
  const signature = await recipient.account.signMessage({ message: statement });

  const settled = await settleGiftClaim({
    record: opened.record,
    token: RAW_TOKEN,
    recipientAddress: recipient.address,
    signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  assert.equal(settled.result, "ok", JSON.stringify(settled));
  assert.equal(settled.record.status, CLAIM_STATUS.CLAIMED);
  assert.equal(settled.claimParties.distinct, true);
});

await atest("tamper: signer signs for a different amount than the record's true on-chain value -> rejected", async () => {
  const recipient = realAccount();
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ amount: 20_000000n }) }), // record's TRUE value is 20
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: GIFT_ID_BYTES32, token: RAW_TOKEN },
    recordSource: source,
  });
  assert.equal(opened.status, GIFT_ENTRY_STATUS.READY);

  const claimedAt = new Date().toISOString();
  // Recipient is shown/signs a statement claiming 100 instead of the record's real 20 —
  // settleGiftClaim always rebuilds the statement from record.value (never a caller amount), so
  // the signature recovered against THAT rebuilt statement will not equal the recipient at all.
  const tamperedStatement = claimStatement({
    giftId: opened.record.giftId,
    chainId: opened.record.chainId,
    senderAddress: opened.record.senderAddress,
    recipientAddress: recipient.address,
    claimTokenHash: opened.record.claimTokenHash,
    claimedAt,
    tokenAddress: opened.record.value.tokenAddress,
    decimals: opened.record.value.decimals,
    amountAtomic: 100_000000, // tamper
  });
  const signature = await recipient.account.signMessage({ message: tamperedStatement });

  const settled = await settleGiftClaim({
    record: opened.record,
    token: RAW_TOKEN,
    recipientAddress: recipient.address,
    signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  assert.equal(settled.result, "not_proven_by_signature");
});

await atest("tamper: different token address than the record's true on-chain token -> rejected", async () => {
  const recipient = realAccount();
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ amount: 20_000000n }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: GIFT_ID_BYTES32, token: RAW_TOKEN },
    recordSource: source,
  });
  const claimedAt = new Date().toISOString();
  const tamperedStatement = claimStatement({
    giftId: opened.record.giftId,
    chainId: opened.record.chainId,
    senderAddress: opened.record.senderAddress,
    recipientAddress: recipient.address,
    claimTokenHash: opened.record.claimTokenHash,
    claimedAt,
    tokenAddress: "0x00000000000000000000000000000000000000ff", // tamper
    decimals: opened.record.value.decimals,
    amountAtomic: opened.record.value.amountAtomic,
  });
  const signature = await recipient.account.signMessage({ message: tamperedStatement });
  const settled = await settleGiftClaim({
    record: opened.record,
    token: RAW_TOKEN,
    recipientAddress: recipient.address,
    signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  assert.equal(settled.result, "not_proven_by_signature");
});

await atest("sender cannot claim their own on-chain gift (sender==recipient)", async () => {
  const sender = realAccount();
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ sender: sender.address }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: GIFT_ID_BYTES32, token: RAW_TOKEN },
    recordSource: source,
  });
  assert.equal(opened.status, GIFT_ENTRY_STATUS.READY);
  const claimedAt = new Date().toISOString();
  const statement = claimStatement({
    giftId: opened.record.giftId,
    chainId: opened.record.chainId,
    senderAddress: opened.record.senderAddress,
    recipientAddress: sender.address,
    claimTokenHash: opened.record.claimTokenHash,
    claimedAt,
    tokenAddress: opened.record.value.tokenAddress,
    decimals: opened.record.value.decimals,
    amountAtomic: opened.record.value.amountAtomic,
  });
  const signature = await sender.account.signMessage({ message: statement });
  const settled = await settleGiftClaim({
    record: opened.record,
    token: RAW_TOKEN,
    recipientAddress: sender.address,
    signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  assert.equal(settled.result, "sender_is_recipient");
});

await atest("replay: an on-chain gift already claimed (status CLAIMED) cannot be opened again", async () => {
  const source = createGiftRecordSource({
    client: fakeClient({ tuple: goodTuple({ claimed: true }) }),
    chainScope: CHAIN,
    contractAddress: CONTRACT_ADDRESS,
  });
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: GIFT_ID_BYTES32, token: RAW_TOKEN },
    recordSource: source,
  });
  assert.equal(opened.status, GIFT_ENTRY_STATUS.REFUSED);
  assert.equal(opened.reason, "already_claimed_by_other");
});

test("no secret/raw-token-shaped field anywhere in this module's own source", () => {
  const src = readFileSync(new URL("../src/gift-record-source.js", import.meta.url), "utf8");
  assert.ok(!/rawToken|privateKey|mnemonic|prfOutput/i.test(src), "secret-shaped identifier found in gift-record-source.js");
});

console.log(`\n${pass} PASS`);
