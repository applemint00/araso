// [A-579 Lane G] Gift ↔ NEW Gift Piggy binding + app-side commit→claim submission adapter.
//   node app/test/gift-claim-submit.mjs
//
// Network 0 · real tx 0 · deploy 0 · production address 0 · UI/copy/CSS 0.
//
// REAL: gift-claim-entry.js (bindGiftToNewPiggy / isGiftBinding / createGiftClaimSubmitter /
//   giftCommitHash / GIFT_ESCROW_CLAIM_ABI), gift-value-spec.js giftGasBudget, gift-piggy-claim-link.js
//   record/token/hash/transfer-receipt code, the Mera secp256k1 session + viem account that signs
//   every Gift Piggy tx, viem tx parse/recover/decode.
// FAKE (in memory, this file): a Monad-like chain that recovers the raw-tx sender, enforces chainId /
//   nonce / balance-for-gas-limit×fee, mines one tx per block, and runs the adopted A escrow's own
//   commitClaim/claim rules; and a SEPARATE sender-side gas-delivery object.
// Evidence grade for the vector section (§E): A-577 MAINNET_FORK_NATIVE offline vector — the exact
//   raw txs + fixture values A-577 produced on the native anvil fork of Monad mainnet (chain 143,
//   block 107,577,653), re-derived here with the app's own code. Not a live/mainnet run.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  hexToString,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  stringToHex,
} from "viem";
import {
  GIFT_BINDING_REFUSAL,
  GIFT_CLAIM_SUBMIT_STATUS as S,
  GIFT_ESCROW_CLAIM_ABI,
  bindGiftToNewPiggy,
  createGiftClaimSubmitter,
  giftCommitHash,
  isGiftBinding,
} from "../src/gift-claim-entry.js";
import { CLAIM_STATUS, TRANSFER_STATUS, attachGiftValue, createClaimLink, sealClaimLink } from "../src/gift-piggy-claim-link.js";
import { GIFT_GAS_POLICY, buildGiftValueBinding, giftGasBudget } from "../src/gift-value-spec.js";

const REPO = new URL("../../", import.meta.url);
const FIX = JSON.parse(readFileSync(new URL("_private/ops/harness/gift-mainnet-fork-native/fixtures/proof-input.json", REPO), "utf8"));
const ARTIFACT = JSON.parse(readFileSync(new URL("_private/ops/harness/gift-mainnet-fork-native/out/GiftPiggyUSDC.sol/GiftPiggyUSDC.json", REPO), "utf8"));
const ENTRY_SRC = readFileSync(new URL("../src/gift-claim-entry.js", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const RECORD_SRC = readFileSync(new URL("../src/gift-record-source.js", import.meta.url), "utf8");

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const big = (x) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
const lower = (a) => String(a || "").toLowerCase();

// ── A-577 numbers (from the vector's own raw txs, not re-typed) ──────────────────────────────
const CHAIN_ID = Number(FIX.chain.chainId); // 143
const SCOPE = "monad-mainnet";
const BASE_FEE = BigInt(FIX.chain.baseFeeWei); // 100 gwei
const NOW_TS = BigInt(FIX.chain.execTimestamp);
const RAW = Object.fromEntries(Object.entries(FIX.tx).map(([k, v]) => [k, parseTransaction(v)]));
const A577_UNITS = Object.freeze({ commitClaim: RAW.commit.gas, claim: RAW.claim.gas, fundingTransfer: RAW.fund.gas });
const A577_FEES = Object.freeze({ baseFeePerGasWei: BASE_FEE, priorityFeePerGasWei: 0n, source: `A-577 MAINNET_FORK_NATIVE fixture baseFee @ block ${FIX.forkBlock}` });
const ESCROW = FIX.escrowExpected;
const USDC = FIX.usdc;
const SENDER = FIX.sender;

// ── identities (deterministic DO-NOT-FUND test keys) ────────────────────────────────────────
function identity(label) {
  const prf = new Uint8Array(crypto.createHash("sha256").update(`a579-lane-g/${label}`).digest());
  const session = createSecp256k1SigningSession({ privateKey: prf });
  return { address: getEvmAddress(session.publicKey), account: toViemAccount(session) };
}
const PIGGY = identity("gift-piggy");
const OTHER = identity("other-piggy");

// ── fake Monad-like chain + escrow ──────────────────────────────────────────────────────────
function fakeChain({ chainId = CHAIN_ID, frozen = false } = {}) {
  let head = 1000n;
  const balances = new Map();
  const nonces = new Map();
  const usdc = new Map();
  const txs = new Map();
  const gifts = new Map();
  const commits = new Map();
  const log = [];
  const bal = (a) => balances.get(lower(a)) ?? 0n;
  const mine = (entry) => {
    head += 1n;
    const hash = keccak256(stringToHex(`${entry.kind}:${txs.size}:${entry.from}:${entry.to}:${head}`));
    txs.set(hash, { ...entry, blockNumber: head });
    log.push({ kind: entry.kind, from: entry.from, to: entry.to, status: entry.status, blockNumber: head });
    return hash;
  };
  function runEscrow(from, data) {
    const { functionName, args } = decodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, data });
    const g = gifts.get(lower(args[0]));
    if (functionName === "commitClaim") {
      if (!g || g.claimed || /^0x0+$/.test(args[1])) return { ok: false, kind: "commitClaim" };
      commits.set(`${lower(args[0])}:${lower(from)}`, { hash: args[1], blockNumber: head + 1n });
      return { ok: true, kind: "commitClaim" };
    }
    if (functionName === "claim") {
      const [giftId, committer, recipient, preimage, salt, deadline] = args;
      if (!g || g.claimed) return { ok: false, kind: "claim" };
      if (NOW_TS >= g.expiry || NOW_TS > deadline) return { ok: false, kind: "claim" };
      if (/^0x0+$/.test(recipient) || lower(recipient) === lower(g.sender)) return { ok: false, kind: "claim" };
      const c = commits.get(`${lower(giftId)}:${lower(committer)}`);
      if (!c || head + 1n <= c.blockNumber) return { ok: false, kind: "claim" };
      if (lower(giftCommitHash({ recipient, preimage, salt })) !== lower(c.hash)) return { ok: false, kind: "claim" };
      const sha = `0x${crypto.createHash("sha256").update(Buffer.from(preimage.slice(2), "hex")).digest("hex")}`;
      if (sha !== lower(g.claimTokenHash)) return { ok: false, kind: "claim" };
      g.claimed = true;
      commits.delete(`${lower(giftId)}:${lower(committer)}`);
      usdc.set(lower(recipient), (usdc.get(lower(recipient)) ?? 0n) + g.amount);
      return { ok: true, kind: "claim" };
    }
    return { ok: false, kind: functionName };
  }
  const chain = {
    chain: { id: chainId },
    async getBalance({ address }) { return bal(address); },
    async getTransactionCount({ address }) { return nonces.get(lower(address)) ?? 0; },
    async sendRawTransaction({ serializedTransaction }) {
      const tx = parseTransaction(serializedTransaction);
      const from = await recoverTransactionAddress({ serializedTransaction });
      if (tx.chainId !== chainId) throw new Error("wrong chain id");
      if ((nonces.get(lower(from)) ?? 0) !== tx.nonce) throw new Error("nonce");
      const fee = tx.maxFeePerGas < BASE_FEE ? null : BASE_FEE + (tx.maxPriorityFeePerGas ?? 0n);
      if (fee === null) throw new Error("fee below base");
      const cost = tx.gas * fee + (tx.value ?? 0n); // Monad: charged by gas LIMIT
      if (bal(from) < cost) throw new Error(`insufficient funds (${bal(from)}) for ${cost}`);
      balances.set(lower(from), bal(from) - cost);
      nonces.set(lower(from), tx.nonce + 1);
      const out = lower(tx.to) === lower(ESCROW) ? runEscrow(from, tx.data) : { ok: true, kind: "call" };
      return mine({ kind: out.kind, from, to: tx.to, value: tx.value ?? 0n, input: tx.data ?? "0x", status: out.ok ? "success" : "reverted", raw: serializedTransaction });
    },
    async waitForTransactionReceipt({ hash }) {
      const t = txs.get(hash);
      if (!t) throw new Error("unknown tx");
      return { status: t.status, blockNumber: t.blockNumber, from: t.from, to: t.to };
    },
    async getTransaction({ hash }) {
      const t = txs.get(hash);
      if (!t) throw new Error("unknown tx");
      return { from: t.from, to: t.to, value: t.value, input: t.input };
    },
    async readContract({ address, functionName, args }) {
      if (lower(address) !== lower(ESCROW)) throw new Error("no contract");
      if (functionName === "commits") {
        const c = commits.get(`${lower(args[0])}:${lower(args[1])}`);
        return c ? [c.hash, c.blockNumber] : [`0x${"0".repeat(64)}`, 0n];
      }
      if (functionName === "gifts") {
        const g = gifts.get(lower(args[0]));
        return g ? [g.sender, g.token, g.amount, g.expiry, g.claimed, g.claimTokenHash] : null;
      }
      throw new Error("unknown fn");
    },
    async getBlockNumber() { if (!this.frozen) head += 1n; return head; },
    frozen,
  };
  const admin = {
    log, txs, usdc, commits,
    setBalance(a, v) { balances.set(lower(a), v); },
    balance: bal,
    createGift({ giftId, amount, expiry, claimTokenHash }) { gifts.set(lower(giftId), { sender: SENDER, token: USDC, amount, expiry, claimed: false, claimTokenHash: lower(claimTokenHash) }); },
    gift: (giftId) => gifts.get(lower(giftId)),
    // the sender-side gas allowance's own transfer (not signed by the app — it is not the app's key)
    transfer({ to, value, input = "0x", status = "success" }) {
      balances.set(lower(to), bal(to) + (status === "success" ? value : 0n));
      return mine({ kind: "delivery", from: SENDER, to, value, input, status });
    },
  };
  return { chain, admin };
}

function gasDeliveryOver(admin, { mutate = null, throwIt = false, badHash = false } = {}) {
  const calls = [];
  return {
    calls,
    async deliver(req) {
      calls.push({ keys: Object.keys(req).sort(), ...req });
      if (throwIt) throw new Error("allowance exhausted");
      if (badHash) return { txHash: "not-a-hash" };
      const t = { to: req.to, value: req.valueWei, input: "0x", ...(mutate ? mutate(req) : {}) };
      return { txHash: admin.transfer(t), extra: "ignored" };
    },
  };
}

async function makeGift({ admin, giftIdHex = `0x${crypto.randomBytes(32).toString("hex")}`, sender = SENDER, expirySec = BigInt(FIX.gift1.expiry) } = {}) {
  const made = createClaimLink({ giftId: giftIdHex, senderAddress: sender, chainId: SCOPE, createdAt: new Date(Number(NOW_TS) * 1000).toISOString(), expiresAt: new Date(Number(expirySec) * 1000).toISOString() });
  const value = buildGiftValueBinding({ chainScope: SCOPE, presetLabel: 20 }).value;
  const sealed = await sealClaimLink(attachGiftValue(made.record, value).record, made.token);
  admin?.createGift({ giftId: giftIdHex, amount: 20_000000n, expiry: expirySec, claimTokenHash: `0x${sealed.claimTokenHash}` });
  const claimed = { ...sealed, status: CLAIM_STATUS.CLAIMED, recipientAddress: PIGGY.address, claimedAt: new Date(Number(NOW_TS) * 1000).toISOString() };
  return { giftId: giftIdHex, token: made.token, record: claimed };
}

function bindFor(giftId, token, address = PIGGY.address) {
  const b = bindGiftToNewPiggy({ intent: { giftId, token }, piggy: { id: `piggy-${lower(address)}`, address, sequence: 1 }, preExistingAddresses: new Set(["0x00000000000000000000000000000000000000c3"]), signerAddress: address, requireSequence: true });
  assert.equal(b.ok, true, big(b));
  return b.binding;
}

function submitterFor(chain, gasDelivery, over = {}) {
  return createGiftClaimSubmitter({
    chain, gasDelivery, chainScope: SCOPE, escrowAddress: ESCROW,
    gasUnits: A577_UNITS, safety: { bufferBps: 0 }, readFeeInputs: async () => A577_FEES,
    sleep: async () => {}, maxPolls: 3, ...over,
  });
}

// ═══ A. binding ════════════════════════════════════════════════════════════════════════════
await check("A1. bindGiftToNewPiggy: frozen, registered, token-free binding to the NEW Piggy", () => {
  const intent = { giftId: "g-1", token: "secret-token-value-xxxxxxxxxxxx" };
  const b = bindGiftToNewPiggy({ intent, piggy: { id: "p", address: PIGGY.address, sequence: 2 }, preExistingAddresses: [OTHER.address], signerAddress: PIGGY.address, requireSequence: true, now: () => "T" });
  assert.equal(b.ok, true);
  assert.deepEqual({ ...b.binding }, { giftId: "g-1", recipientAddress: PIGGY.address, piggyId: "p", sequence: 2, boundAt: "T" });
  assert.ok(Object.isFrozen(b.binding));
  assert.equal(isGiftBinding(b.binding), true);
  assert.equal(isGiftBinding({ ...b.binding }), false);
  assert.equal(isGiftBinding(JSON.parse(JSON.stringify(b.binding))), false);
  assert.equal(JSON.stringify(b).includes(intent.token), false);
  // one intent → one binding
  assert.equal(bindGiftToNewPiggy({ intent, piggy: { address: OTHER.address }, preExistingAddresses: [], signerAddress: OTHER.address }).reason, GIFT_BINDING_REFUSAL.INTENT_ALREADY_BOUND);
});

await check("A2. binding refusals: no intent / bad address / missing pre-existing set / EXISTING Piggy / signer ≠ new Piggy / Model-A sequence required", () => {
  const R = GIFT_BINDING_REFUSAL;
  const base = () => ({ intent: { giftId: "g", token: "t" }, piggy: { address: PIGGY.address, sequence: 1 }, preExistingAddresses: [], signerAddress: PIGGY.address, requireSequence: true });
  const cases = [
    [{ intent: null }, R.NO_GIFT_INTENT],
    [{ intent: { token: "t" } }, R.NO_GIFT_INTENT],
    [{ piggy: { address: "0x1234" } }, R.BAD_PIGGY_ADDRESS],
    [{ preExistingAddresses: undefined }, R.MISSING_PRE_EXISTING_SET],
    [{ preExistingAddresses: [PIGGY.address.toLowerCase()] }, R.NOT_NEWLY_CREATED_PIGGY],
    [{ preExistingAddresses: new Set([PIGGY.address]) }, R.NOT_NEWLY_CREATED_PIGGY],
    [{ signerAddress: OTHER.address }, R.SIGNER_NOT_NEW_PIGGY],
    [{ signerAddress: "" }, R.SIGNER_NOT_NEW_PIGGY],
    [{ piggy: { address: PIGGY.address } }, R.MISSING_MODEL_A_SEQUENCE],
    [{ piggy: { address: PIGGY.address, sequence: 0 } }, R.MISSING_MODEL_A_SEQUENCE],
  ];
  for (const [over, reason] of cases) {
    const out = bindGiftToNewPiggy({ ...base(), ...over });
    assert.equal(out.ok, false);
    assert.equal(out.reason, reason, big(over));
  }
  // first-birth path (openPiggy) does not require a sequence
  assert.equal(bindGiftToNewPiggy({ ...base(), piggy: { address: PIGGY.address }, requireSequence: false }).ok, true);
});

// ═══ B. submitter config fail-closed ═══════════════════════════════════════════════════════
await check("B1. createGiftClaimSubmitter is null unless every piece is present; claimSigner / unknown keys / shared chain+gas object / missing fundingTransfer all refuse", () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const ok = { chain, gasDelivery: gd, chainScope: SCOPE, escrowAddress: ESCROW, gasUnits: A577_UNITS, safety: { bufferBps: 0 }, readFeeInputs: async () => A577_FEES };
  assert.ok(createGiftClaimSubmitter(ok));
  for (const [label, over] of [
    ["no chain", { chain: null }],
    ["chain missing a method", { chain: { ...chain, getBlockNumber: undefined } }],
    ["no gasDelivery", { gasDelivery: null }],
    ["gasDelivery === chain", { gasDelivery: Object.assign(chain, { deliver() {} }) }],
    ["no scope", { chainScope: "" }],
    ["bad escrow", { escrowAddress: "0x1234" }],
    ["no fee reader", { readFeeInputs: undefined }],
    ["gasUnits without fundingTransfer", { gasUnits: { commitClaim: 1n, claim: 1n } }],
    ["claimSigner", { claimSigner: OTHER.address }],
    ["unknown key", { recipient: OTHER.address }],
    ["bad maxPolls", { maxPolls: 0 }],
  ]) {
    assert.equal(createGiftClaimSubmitter({ ...ok, ...over }), null, label);
    delete chain.deliver;
  }
  assert.equal(createGiftClaimSubmitter(), null);
});

await check("B2. product default stays null/fail-closed in main.js (config null, no production address, no debug hook)", () => {
  assert.match(MAIN, /const GIFT_CLAIM_SUBMIT_CONFIG = null;/);
  assert.match(MAIN, /const GIFT_RECORD_CONFIG = null;/);
  assert.match(MAIN, /const GIFT_CLAIM_SUBMITTER = GIFT_CLAIM_SUBMIT_CONFIG && GIFT_RECORD_CONFIG\n {2}\? createGiftClaimSubmitter\(GIFT_CLAIM_SUBMIT_CONFIG\)\n {2}: null;/);
  const code = MAIN.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n"); // comments may name the hook they forbid
  assert.equal(/__arasoGift|window\.__\w*Gift/i.test(code), false);
  assert.equal(/0x[0-9a-fA-F]{40}/.test(ENTRY_SRC), false, "gift-claim-entry.js must hold no address");
  assert.equal(GIFT_GAS_POLICY.recipientMonRequired, 0n);
  assert.equal(GIFT_GAS_POLICY.deliveryPath, "A_mon_after_recipient_address");
});

// ═══ C. happy path (A-577 gas numbers) ═════════════════════════════════════════════════════
await check("C1. value_transferred: delivery (exactly {allowanceRef,to,valueWei}, to = bound NEW Piggy, value = A-577 fund value) → Piggy-signed commit → ≥1 block → Piggy-signed claim (committer == recipient == Piggy); USDC lands in the Piggy; no secret in the result", async () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const sub = submitterFor(chain, gd);
  const g = await makeGift({ admin });
  const binding = bindFor(g.giftId, g.token);
  assert.equal(admin.balance(PIGGY.address), 0n); // recipient holds 0 MON — never required
  const out = await sub.submit({ binding, record: g.record, token: g.token, account: PIGGY.account });
  assert.equal(out.status, S.VALUE_TRANSFERRED, big(out));
  assert.equal(gd.calls.length, 1);
  assert.deepEqual(gd.calls[0].keys, ["allowanceRef", "to", "valueWei"]);
  assert.equal(gd.calls[0].allowanceRef, g.giftId);
  assert.equal(gd.calls[0].to, binding.recipientAddress);
  assert.equal(gd.calls[0].valueWei, BigInt(FIX.fundValueWei)); // 20,298,700,000,000,000 wei = (commit+claim limits) × 100 gwei
  assert.deepEqual(admin.log.map((l) => l.kind), ["delivery", "commitClaim", "claim"]);
  assert.ok(admin.log.every((l) => l.status === "success"));
  assert.ok(admin.log[2].blockNumber > admin.log[1].blockNumber + 0n);
  for (const k of ["commit", "claim"]) {
    const t = admin.txs.get(out.txHashes[k]);
    assert.equal(lower(await recoverTransactionAddress({ serializedTransaction: t.raw })), lower(PIGGY.address), `${k} signed by the Gift Piggy`);
  }
  const claimArgs = decodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, data: admin.txs.get(out.txHashes.claim).input }).args;
  assert.equal(lower(claimArgs[1]), lower(PIGGY.address));
  assert.equal(lower(claimArgs[2]), lower(PIGGY.address));
  assert.equal(admin.usdc.get(lower(PIGGY.address)), 20_000000n);
  assert.equal(admin.gift(g.giftId).claimed, true);
  assert.equal(out.record.transfer.status, TRANSFER_STATUS.SETTLED);
  assert.equal(out.record.transfer.txHash, out.txHashes.claim);
  const dump = big(out);
  assert.equal(dump.includes(g.token), false);
  assert.equal(dump.includes(stringToHex(g.token).slice(2)), false, "preimage leaked");
  assert.equal(/salt|preimage|prf|privateKey/i.test(dump), false);
  assert.equal(admin.balance(PIGGY.address), 0n); // charged by limit: the delivery is exactly consumed
});

await check("C2. a recipient that already holds MON still gets the FULL delivery — the app never leans on recipient MON (preload requirement 0)", async () => {
  const { chain, admin } = fakeChain();
  admin.setBalance(PIGGY.address, 10n ** 18n);
  const gd = gasDeliveryOver(admin);
  const g = await makeGift({ admin });
  const out = await submitterFor(chain, gd).submit({ binding: bindFor(g.giftId, g.token), record: g.record, token: g.token, account: PIGGY.account });
  assert.equal(out.status, S.VALUE_TRANSFERRED);
  assert.equal(gd.calls[0].valueWei, BigInt(FIX.fundValueWei));
});

// ═══ D. negatives — every one fails closed with an exact status ════════════════════════════
async function scenario({ chainOpts = {}, gdOpts = {}, subOver = {}, submitOver = {}, giftOver = {}, bindAddress, account = PIGGY.account } = {}) {
  const { chain, admin } = fakeChain(chainOpts);
  const gd = gasDeliveryOver(admin, gdOpts);
  const sub = submitterFor(chain, gd, subOver);
  const g = await makeGift({ admin, ...giftOver });
  const binding = bindFor(g.giftId, g.token, bindAddress);
  const out = await sub.submit({ binding, record: g.record, token: g.token, account, ...submitOver(g, binding) });
  return { out, admin, gd, g };
}
const noOver = () => ({});
for (const [label, opts, status, expectKinds] of [
  ["delivery to a different address", { gdOpts: { mutate: () => ({ to: OTHER.address }) }, submitOver: noOver }, S.GAS_DELIVERY_UNVERIFIED, ["delivery"]],
  ["delivery short by 1 wei", { gdOpts: { mutate: (r) => ({ value: r.valueWei - 1n }) }, submitOver: noOver }, S.GAS_DELIVERY_UNVERIFIED, ["delivery"]],
  ["delivery carrying calldata", { gdOpts: { mutate: () => ({ input: "0xdeadbeef" }) }, submitOver: noOver }, S.GAS_DELIVERY_UNVERIFIED, ["delivery"]],
  ["delivery reverted", { gdOpts: { mutate: () => ({ status: "reverted" }) }, submitOver: noOver }, S.GAS_DELIVERY_UNVERIFIED, ["delivery"]],
  ["delivery throws", { gdOpts: { throwIt: true }, submitOver: noOver }, S.GAS_DELIVERY_FAILED, []],
  ["delivery returns a non-hash", { gdOpts: { badHash: true }, submitOver: noOver }, S.GAS_DELIVERY_FAILED, []],
  ["fee inputs missing", { subOver: { readFeeInputs: async () => null }, submitOver: noOver }, S.GAS_FEE_UNKNOWN, []],
  ["fee reader throws", { subOver: { readFeeInputs: async () => { throw new Error("rpc"); } }, submitOver: noOver }, S.GAS_FEE_UNKNOWN, []],
  ["chain never advances past the commit block", { chainOpts: { frozen: true }, submitOver: noOver }, S.BLOCK_GAP_NOT_OBSERVED, ["delivery", "commitClaim"]],
  ["signer is another Piggy", { account: OTHER.account, submitOver: noOver }, S.SIGNER_NOT_BOUND, []],
  ["chain scope mismatch (testnet transport, mainnet scope)", { chainOpts: { chainId: 10143 }, submitOver: noOver }, S.CHAIN_SCOPE_MISMATCH, []],
  ["self-gift (sender is the bound Piggy)", { giftOver: { sender: PIGGY.address }, submitOver: noOver }, S.SELF_GIFT, []],
  ["wrong token for the record", { submitOver: () => ({ token: "b".repeat(43) }) }, S.BAD_TOKEN, []],
  ["forged look-alike binding", { submitOver: (_g, b) => ({ binding: { ...b } }) }, S.BINDING_INVALID, []],
  ["record for another giftId", { submitOver: (g) => ({ record: { ...g.record, giftId: `0x${"11".repeat(32)}` } }) }, S.GIFT_ID_MISMATCH, []],
]) {
  await check(`D. ${label} → ${status}; txs = [${expectKinds.join(", ")}]`, async () => {
    const { out, admin } = await scenario(opts);
    assert.equal(out.status, status, big(out));
    assert.deepEqual(admin.log.map((l) => l.kind), expectKinds);
    assert.equal(admin.log.some((l) => l.kind === "claim"), false);
  });
}

await check("D. already-claimed gift: commit reverts on chain → commit_failed, claim never sent", async () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const g = await makeGift({ admin });
  admin.gift(g.giftId).claimed = true;
  const out = await submitterFor(chain, gd).submit({ binding: bindFor(g.giftId, g.token), record: g.record, token: g.token, account: PIGGY.account });
  assert.equal(out.status, S.COMMIT_FAILED);
  assert.deepEqual(admin.log.map((l) => `${l.kind}:${l.status}`), ["delivery:success", "commitClaim:reverted"]);
});

await check("D. signer swapped between commit and claim → signer_not_bound before the claim is signed", async () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const g = await makeGift({ admin });
  let signed = 0;
  const swapping = {
    get address() { return signed === 0 ? PIGGY.address : OTHER.address; },
    async signTransaction(tx) { signed += 1; return PIGGY.account.signTransaction(tx); },
  };
  const out = await submitterFor(chain, gd).submit({ binding: bindFor(g.giftId, g.token), record: g.record, token: g.token, account: swapping });
  assert.equal(out.status, S.SIGNER_NOT_BOUND);
  assert.equal(signed, 1);
  assert.deepEqual(admin.log.map((l) => l.kind), ["delivery", "commitClaim"]);
});

await check("D. transport override attempts inside submit() are ignored — the configured chain/gasDelivery are the only ones used", async () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const evil = { calls: 0, deliver() { this.calls += 1; return { txHash: `0x${"00".repeat(32)}` }; } };
  const g = await makeGift({ admin });
  const out = await submitterFor(chain, gd).submit({ binding: bindFor(g.giftId, g.token), record: g.record, token: g.token, account: PIGGY.account, chain: evil, gasDelivery: evil, recipient: OTHER.address, escrowAddress: OTHER.address });
  assert.equal(out.status, S.VALUE_TRANSFERRED);
  assert.equal(evil.calls, 0);
  assert.equal(gd.calls.length, 1);
  assert.equal(admin.usdc.get(lower(OTHER.address)) ?? 0n, 0n);
});

await check("D. [A-579 repair N-1] randomBytes throws AFTER the MON delivery (no WebCrypto) → submit resolves commit_failed (no reject), no commit/claim sent, no secret or error text in the result", async () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const g = await makeGift({ admin });
  const secretMsg = "WebCrypto unavailable SECRET-XYZ";
  const sub = submitterFor(chain, gd, { randomBytes: () => { throw new Error(secretMsg); } });
  const out = await sub.submit({ binding: bindFor(g.giftId, g.token), record: g.record, token: g.token, account: PIGGY.account });
  assert.equal(out.status, S.COMMIT_FAILED, big(out));
  assert.deepEqual(admin.log.map((l) => l.kind), ["delivery"]);
  assert.deepEqual(Object.keys(out).sort(), ["status", "txHashes"]);
  assert.deepEqual(Object.keys(out.txHashes), ["delivery"]);
  const dump = big(out);
  for (const leak of [secretMsg, "SECRET", g.token, stringToHex(g.token).slice(2)]) assert.equal(dump.includes(leak), false, leak);
  assert.equal(/salt|preimage|prf|privateKey|stack/i.test(dump), false);
  // a wrong-shaped randomBytes result stays commit_failed as before
  const { chain: c2, admin: a2 } = fakeChain();
  const g2 = await makeGift({ admin: a2 });
  const out2 = await submitterFor(c2, gasDeliveryOver(a2), { randomBytes: () => new Uint8Array(8) }).submit({ binding: bindFor(g2.giftId, g2.token), record: g2.record, token: g2.token, account: PIGGY.account });
  assert.equal(out2.status, S.COMMIT_FAILED);
});

// ═══ E. A-577 MAINNET_FORK_NATIVE offline vector ═══════════════════════════════════════════
await check("E1. ABI: the adapter's escrow ABI entries deep-equal the A-577 forge artifact; the record source reads the 6-field gifts() (no claimSigner)", () => {
  for (const entry of GIFT_ESCROW_CLAIM_ABI) {
    const art = ARTIFACT.abi.find((e) => e.type === "function" && e.name === entry.name);
    assert.deepEqual(JSON.parse(JSON.stringify(entry)), art, entry.name);
  }
  const gifts = ARTIFACT.abi.find((e) => e.name === "gifts");
  assert.deepEqual(gifts.outputs.map((o) => o.name), ["sender", "token", "amount", "expiry", "claimed", "claimTokenHash"]);
  assert.equal(ARTIFACT.abi.some((e) => JSON.stringify(e).includes("claimSigner")), false);
  assert.equal(/name:\s*"claimSigner"/.test(RECORD_SRC), false);
});

await check("E2. commitHash / preimage / claimTokenHash: the app's formulas reproduce A-577's fixture values and its Piggy-signed raw txs byte for byte", async () => {
  const g1 = FIX.gift1;
  const token = hexToString(g1.preimage);
  assert.equal(`0x${crypto.createHash("sha256").update(token).digest("hex")}`, g1.claimTokenHash); // sha256(UTF-8 token)
  assert.equal(stringToHex(token), g1.preimage);
  assert.equal(giftCommitHash({ recipient: FIX.piggy, preimage: g1.preimage, salt: g1.salt }), g1.commitHash);
  const commitData = encodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, functionName: "commitClaim", args: [g1.giftId, g1.commitHash] });
  assert.equal(commitData, RAW.commit.data);
  const claimData = encodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, functionName: "claim", args: [g1.giftId, FIX.piggy, FIX.piggy, g1.preimage, g1.salt, BigInt(g1.deadline)] });
  assert.equal(claimData, RAW.claim.data);
  for (const k of ["commit", "claim"]) {
    assert.equal(lower(await recoverTransactionAddress({ serializedTransaction: FIX.tx[k] })), lower(FIX.piggy));
    assert.equal(RAW[k].chainId, 143);
    assert.equal(lower(RAW[k].to), lower(ESCROW));
  }
  assert.equal(lower(RAW.fund.to), lower(FIX.piggy));
  assert.equal(RAW.fund.data ?? "0x", "0x");
  assert.equal(lower(await recoverTransactionAddress({ serializedTransaction: FIX.tx.fund })), lower(SENDER));
});

await check("E3. gas: giftGasBudget over A-577's own tx gas limits + fork baseFee gives costWei − fundingTransfer×fee == A-577's delivered fund value (Path A formula identical)", () => {
  const b = giftGasBudget({ gasUnits: A577_UNITS, feeInputs: A577_FEES, safety: { bufferBps: 0 } }).budget;
  assert.equal(b.status, "ESTIMATE");
  assert.equal(b.costWei - b.gasUnitsByStep.fundingTransfer * b.feePerGasWei, BigInt(FIX.fundValueWei));
  assert.equal(RAW.fund.value, BigInt(FIX.fundValueWei));
  assert.equal(b.recipientMonRequired, 0n);
});

await check("E4. the adapter driven over the fake chain with the A-577 vector's giftId, token and gas produces commit/claim calldata identical in shape to A-577's (only the random salt differs)", async () => {
  const { chain, admin } = fakeChain();
  const gd = gasDeliveryOver(admin);
  const token = hexToString(FIX.gift1.preimage);
  const g = await makeGift({ admin, giftIdHex: FIX.gift1.giftId });
  // re-seal the record with the vector's real token so claimTokenHash is A-577's
  const made = createClaimLink({ giftId: FIX.gift1.giftId, senderAddress: SENDER, chainId: SCOPE, createdAt: g.record.createdAt, expiresAt: g.record.expiresAt, token });
  const sealed = await sealClaimLink(attachGiftValue(made.record, buildGiftValueBinding({ chainScope: SCOPE, presetLabel: 20 }).value).record, token);
  assert.equal(`0x${sealed.claimTokenHash}`, FIX.gift1.claimTokenHash);
  admin.createGift({ giftId: FIX.gift1.giftId, amount: 20_000000n, expiry: BigInt(FIX.gift1.expiry), claimTokenHash: FIX.gift1.claimTokenHash });
  const record = { ...sealed, status: CLAIM_STATUS.CLAIMED, recipientAddress: PIGGY.address, claimedAt: g.record.claimedAt };
  const binding = bindGiftToNewPiggy({ intent: { giftId: FIX.gift1.giftId, token }, piggy: { address: PIGGY.address }, preExistingAddresses: [], signerAddress: PIGGY.address }).binding;
  const out = await submitterFor(chain, gd).submit({ binding, record, token, account: PIGGY.account });
  assert.equal(out.status, S.VALUE_TRANSFERRED, big(out));
  const ours = decodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, data: admin.txs.get(out.txHashes.claim).input });
  const theirs = decodeFunctionData({ abi: GIFT_ESCROW_CLAIM_ABI, data: RAW.claim.data });
  assert.equal(ours.args[0], theirs.args[0]);           // same giftId
  assert.equal(ours.args[3], theirs.args[3]);           // same preimage (= stringToHex(token))
  assert.equal(ours.args[1], ours.args[2]);             // committer == recipient (as in A-577)
  assert.equal(theirs.args[1], theirs.args[2]);
  assert.equal(parseTransaction(admin.txs.get(out.txHashes.commit).raw).gas, RAW.commit.gas); // same gas limits
  assert.equal(parseTransaction(admin.txs.get(out.txHashes.claim).raw).gas, RAW.claim.gas);
  assert.equal(parseTransaction(admin.txs.get(out.txHashes.claim).raw).maxFeePerGas, RAW.claim.maxFeePerGas);
  assert.equal(gd.calls[0].valueWei, RAW.fund.value);   // same Path A delivery
});

// ═══ F. no-relayer / no-entitlement source scan ════════════════════════════════════════════
await check("F. gas layer has no entitlement: the only object handed to gasDelivery is the frozen {allowanceRef,to,valueWei}; gift-claim-entry.js never imports relayer/, fetch, or a signer key", () => {
  assert.match(ENTRY_SRC, /gasDelivery\.deliver\(Object\.freeze\(\{ allowanceRef: giftId, to: recipient, valueWei: deliverWei \}\)\)/);
  assert.equal((ENTRY_SRC.match(/gasDelivery\.deliver\(/g) || []).length, 1); // one call site (the other reference is the config type check)
  for (const banned of ["relayer/", "fetch(", "privateKey", "claimSigner:", "localStorage", "sessionStorage"]) {
    assert.equal(ENTRY_SRC.includes(banned), false, banned);
  }
});

console.log(`\n${pass}/${pass} PASS`);
