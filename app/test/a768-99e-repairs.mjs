// [A-768] 99e public-testnet repair bundle — focused negative tests per invariant. Node only · network 0 · browser 0 · real keys 0.
//   node app/test/a768-99e-repairs.mjs
// M-C-1  pre-sign assertion (First signSendStep + strict money-executor): a mock RPC that fills chainId 1 / extreme fee is refused BEFORE signing
// M-L-1  post-deposit redeem reads pinned to the deposit receipt block + bounded retry; unresolved lag stays "still out.", never a failure
// M-T-1  Piggy name escaped in Home (homeCharacter) and Return (return-view.js) with identical visible text
// M-T-2  receipt rows: label/value/sub escaped at output; tx-hash/block shapes validated; malformed stored rows fail closed per row
// M-F-1  index writers refuse corrupt/invalid/unreadable index loads; only "absent" creates an empty index
// M-F-3  legacy encoder validates numeric fields before persistence; one bad row cannot poison the store
// M-T-3  Return bell = same bytes served from /card/crayon-bell.svg (no data: URI), CSP unchanged
// Mutation runs (each guard removed -> this file FAILs) are scripted outside the repo (A-768 receipts, mutations.sh).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createWalletClient, custom, encodeFunctionData, formatEther, keccak256, parseEther, parseGwei, parseTransaction, toHex } from "viem";
import { createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { executeMoneyStep, preparedSignProblem, SIGN_GUARD, TRANSPORT_KIND } from "../src/money-executor.js";
import { decodeReceiptRow, encodeReceiptRow, receiptIdentityKey as codecReceiptIdentityKey, RECEIPT_KIND } from "../src/receipt-codec.js";
import { loadMyPiggiesIndex, myPiggiesIndexKey, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { returnSceneMarkup } from "../src/return-view.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const RETURN_SRC = readFileSync(new URL("../src/piggy-return.js", import.meta.url), "utf8");
const VERCEL = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 5).join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (!m) throw new Error(`main.js: ${name} missing`);
  return MAIN.slice(m.index, MAIN.indexOf("\n}\n", m.index) + 2);
}
function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  const end = MAIN.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`main.js: marker missing ${startMarker}`);
  return MAIN.slice(start, end);
}
const big = (k, v) => (typeof v === "bigint" ? `${v}n` : v);

// ═══ M-C-1 ══════════════════════════════════════════════════════════════════════════════════════════════════
const MONAD_TESTNET = { id: 10143, name: "Monad Testnet", nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" }, rpcUrls: { default: { http: ["http://stub"] } } };
const SHMON = "0x3a98250F98Dd388C211206983453837C8365BDc1";
const DEPOSIT_TX = { to: SHMON, value: parseEther("0.001"), data: encodeFunctionData({ abi: [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "deposit", args: [parseEther("0.001"), "0x000000000000000000000000000000000000dEaD"] }) };
const OK = Object.freeze({ type: "eip1559", chainId: 10143, nonce: 3, gas: 120000n, maxFeePerGas: parseGwei("122"), maxPriorityFeePerGas: parseGwei("2"), to: SHMON, value: 10n ** 15n, data: "0x01" });

// The 99e repro RPC (SEC_review_20261005/repro2/C/proof2.mjs shape): supports eth_fillTransaction and fills a hostile request.
// `noFill` = an honest node without eth_fillTransaction (viem then reads chainId/fees/gas itself).
function stubRpc({ fill = {}, noFill = false } = {}) {
  const log = [];
  const transport = custom({
    async request({ method, params }) {
      log.push(method);
      if (method === "eth_fillTransaction") {
        if (noFill) throw Object.assign(new Error("the method eth_fillTransaction does not exist/is not available"), { code: -32601 });
        const t = params[0];
        return { raw: "0x", tx: { ...t, chainId: "0x1", gas: "0x1c9c380", maxFeePerGas: toHex(parseGwei("120000")), maxPriorityFeePerGas: toHex(parseGwei("50000")), nonce: "0x5", type: "0x2", from: t.from, to: t.to, value: t.value || "0x0", input: t.data || t.input || "0x", ...fill } };
      }
      if (method === "eth_chainId") return "0x279f";
      if (method === "eth_getTransactionCount") return "0x5";
      if (method === "eth_estimateGas") return "0x30000";
      if (method === "eth_gasPrice") return toHex(parseGwei("102"));
      if (method === "eth_maxPriorityFeePerGas") return toHex(parseGwei("2"));
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: toHex(parseGwei("100")), number: "0x10", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), timestamp: "0x1", transactions: [], gasLimit: "0x1c9c380", gasUsed: "0x0", miner: "0x" + "00".repeat(20), difficulty: "0x0", nonce: "0x0000000000000000", sha3Uncles: "0x" + "33".repeat(32), logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x" + "44".repeat(32), stateRoot: "0x" + "55".repeat(32), receiptsRoot: "0x" + "66".repeat(32), extraData: "0x", size: "0x1", uncles: [], totalDifficulty: "0x0", mixHash: "0x" + "77".repeat(32) };
      if (method === "eth_sendRawTransaction") return keccak256(params[0]);
      throw Object.assign(new Error(`method ${method} not found`), { code: -32601 });
    },
  });
  return { transport, log };
}
function spyAccount() {
  const account = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(7) }));
  const spy = { signed: 0 };
  const signTransaction = account.signTransaction.bind(account);
  account.signTransaction = async (...a) => { spy.signed += 1; return signTransaction(...a); };
  return { account, spy };
}
const SIGN_STEP = (problem = preparedSignProblem) => new Function("keccak256", "MONAD_TESTNET", "preparedSignProblem", `${fnBody("signSendStep")}\nreturn signSendStep;`)(keccak256, MONAD_TESTNET, problem);

await check("M-C-1 guard unit: a well-formed Monad-testnet eip1559 request passes; caps are explicit frozen constants", () => {
  assert.equal(preparedSignProblem(OK), null);
  assert.deepEqual({ ...SIGN_GUARD }, { chainId: 10143, type: "eip1559", maxGas: 2_000_000n, maxFeePerGas: 1_000_000_000_000n, maxTxFeeWei: 100_000_000_000_000_000n });
  assert.ok(Object.isFrozen(SIGN_GUARD));
});
await check("M-C-1 guard unit: every off-contract field is refused (chainId/type/7702/blob/legacy gasPrice/accessList/nonce/gas/fee/value)", () => {
  const bad = [
    [{ chainId: 1 }, "chain_id_mismatch"], [{ chainId: "10143" }, "chain_id_mismatch"], [{ chainId: 10143n }, "chain_id_mismatch"], [{ chainId: undefined }, "chain_id_mismatch"],
    [{ type: "legacy" }, "tx_type_unexpected"], [{ type: "eip7702" }, "tx_type_unexpected"], [{ type: undefined }, "tx_type_unexpected"],
    [{ authorizationList: [] }, "authorization_list_present"], [{ authorizationList: [{ address: SHMON }] }, "authorization_list_present"],
    [{ gasPrice: 1n }, "unexpected_field"], [{ blobs: [] }, "unexpected_field"], [{ maxFeePerBlobGas: 1n }, "unexpected_field"], [{ feePayerSignature: {} }, "unexpected_field"],
    [{ accessList: [{ address: SHMON, storageKeys: [] }] }, "access_list_present"],
    [{ nonce: undefined }, "nonce_invalid"], [{ nonce: -1 }, "nonce_invalid"], [{ nonce: 1.5 }, "nonce_invalid"],
    [{ gas: 30_000_000n }, "gas_out_of_bounds"], [{ gas: 0n }, "gas_out_of_bounds"], [{ gas: 21000 }, "gas_out_of_bounds"], [{ gas: undefined }, "gas_out_of_bounds"],
    [{ maxFeePerGas: parseGwei("120000") }, "fee_out_of_bounds"], [{ maxFeePerGas: 0n }, "fee_out_of_bounds"], [{ maxFeePerGas: Number.POSITIVE_INFINITY }, "fee_out_of_bounds"],
    [{ maxPriorityFeePerGas: parseGwei("123") }, "fee_out_of_bounds"], [{ maxPriorityFeePerGas: -1n }, "fee_out_of_bounds"],
    [{ gas: 2_000_000n, maxFeePerGas: parseGwei("60") }, "fee_out_of_bounds"], // 0.12 MON > 0.1 MON whole-tx cap
    [{ value: -1n }, "value_invalid"], [{ value: 1 }, "value_invalid"],
  ];
  for (const [patch, reason] of bad) assert.equal(preparedSignProblem({ ...OK, ...patch }), reason, JSON.stringify(patch, big));
  assert.equal(preparedSignProblem(null), "prepared_missing");
  assert.equal(preparedSignProblem({ get chainId() { throw new Error("x"); } }), "prepared_unreadable");
});
await check("M-C-1 First: hostile RPC (eth_fillTransaction -> chainId 1, maxFee 120000 gwei, gas 30M) -> signSendStep throws BEFORE the signer is called", async () => {
  const { account, spy } = spyAccount();
  const rpc = stubRpc();
  const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: rpc.transport });
  // precondition: this exact viem path really takes chainId from the RPC fill (the 99e finding is live in this viem version)
  const prepared = await wc.prepareTransactionRequest({ account, chain: MONAD_TESTNET, ...DEPOSIT_TX });
  assert.equal(prepared.chainId, 1, "viem took chainId from the RPC fill (99e M-C-1 precondition)");
  await assert.rejects(() => SIGN_STEP()(wc, account, DEPOSIT_TX), /send_prepared_refused:chain_id_mismatch/);
  assert.equal(spy.signed, 0, "no signature");
  assert.ok(rpc.log.includes("eth_fillTransaction"));
});
await check("M-C-1 First: hostile fill that keeps chainId 10143 but sets an extreme fee / huge gas -> refused before signature", async () => {
  for (const [fill, reason] of [[{ chainId: "0x279f", gas: "0x30000" }, "fee_out_of_bounds"], [{ chainId: "0x279f", maxFeePerGas: toHex(parseGwei("122")), maxPriorityFeePerGas: toHex(parseGwei("2")) }, "gas_out_of_bounds"]]) {
    const { account, spy } = spyAccount();
    const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: stubRpc({ fill }).transport });
    await assert.rejects(() => SIGN_STEP()(wc, account, DEPOSIT_TX), new RegExp(`send_prepared_refused:${reason}`));
    assert.equal(spy.signed, 0);
  }
});
await check("M-C-1 First control: honest RPC (no eth_fillTransaction) -> eip1559 on 10143 with bounded fee is signed once; signed bytes carry chainId 10143", async () => {
  const { account, spy } = spyAccount();
  const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: stubRpc({ noFill: true }).transport });
  const signed = await SIGN_STEP()(wc, account, DEPOSIT_TX);
  assert.equal(spy.signed, 1);
  const p = parseTransaction(signed.raw);
  assert.equal(p.chainId, 10143);
  assert.equal(p.type, "eip1559");
  assert.equal(signed.hash, keccak256(signed.raw));
});
await check("M-C-1 strict money-executor: hostile RPC -> blocked at 'sign' before signTransaction; persist_hash 0, broadcast 0", async () => {
  const { account, spy } = spyAccount();
  const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: stubRpc().transport });
  const log = [];
  const out = await executeMoneyStep({
    tx: DEPOSIT_TX,
    transport: { kind: TRANSPORT_KIND.VIEM_RAW, account, walletClient: wc, publicClient: { async sendRawTransaction() { log.push("broadcast"); return "0x"; } } },
    authorize: () => true, reserve: () => true, persistHash: () => { log.push("persist_hash"); return true; },
  });
  assert.equal(out.status, "blocked");
  assert.equal(out.phase, "sign");
  assert.equal(out.reason, "chain_id_mismatch");
  assert.equal(out.signedBeforeSend, false);
  assert.equal(spy.signed, 0);
  assert.deepEqual(log, []);
});
await check("M-C-1 strict money-executor control: honest RPC -> signed, hash persisted, then broadcast (order unchanged)", async () => {
  const { account, spy } = spyAccount();
  const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: stubRpc({ noFill: true }).transport });
  const order = [];
  const out = await executeMoneyStep({
    tx: DEPOSIT_TX,
    transport: { kind: TRANSPORT_KIND.VIEM_RAW, account, walletClient: wc, publicClient: { async sendRawTransaction({ serializedTransaction }) { order.push("broadcast"); return keccak256(serializedTransaction); } } },
    authorize: () => true, reserve: () => true, persistHash: () => { order.push("persist_hash"); return true; },
  });
  assert.equal(out.status, "broadcast");
  assert.equal(spy.signed, 1);
  assert.deepEqual(order, ["persist_hash", "broadcast"]);
});
await check("M-C-1 source: the guard sits between prepare and sign in First's shared signer (both legs) and in the strict executor path", () => {
  const s = fnBody("signSendStep");
  // [A-774] the guard and the signer both take the signing copy `toSign`, made after prepare and before the guard.
  assert.ok(s.indexOf("prepareTransactionRequest(") < s.indexOf("const toSign = { ...prepared };") && s.indexOf("const toSign = { ...prepared };") < s.indexOf("preparedSignProblem(toSign)") && s.indexOf("preparedSignProblem(toSign)") < s.indexOf("account.signTransaction(toSign,"));
  assert.ok(!s.includes("preparedSignProblem(prepared)") && !s.includes("account.signTransaction(prepared"), "nothing guards or signs the original prepared object");
  const once = fnBody("sendPiggyOnce");
  assert.ok(once.includes("signSendStep(walletClient, account, plan.depositTx)") && fnBody("prepareRedeemAfterDeposit").includes("signSendStep(walletClient, account, { ...redeemTx, gas })"), "both legs sign only via signSendStep");
  const ex = readFileSync(new URL("../src/money-executor.js", import.meta.url), "utf8");
  const strict = ex.slice(ex.indexOf("if (strict) {"));
  assert.ok(strict.indexOf("prepareTransactionRequest(") < strict.indexOf("preparedSignProblem(toSign)") && strict.indexOf("preparedSignProblem(toSign)") < strict.indexOf("account.signTransaction(toSign)"));
  assert.match(MAIN, /^import \{ preparedSignProblem \} from "\.\/money-executor\.js";$/m);
});

// ═══ A-774 eip1559 gasPrice echo (A-768 M-C-1 compat) ═════════════════════════════════════════════════════════
// A fill-supporting node (geth/anvil) returns gasPrice on an eip1559 tx and viem copies it into the prepared request. Both signers
// make a signing COPY, drop gasPrice from it ONLY for type eip1559 with both max-fee fields present, and hand that same copy to the
// guard and to the signer. The original prepared object is never mutated. preparedSignProblem itself is unchanged.
const ECHO_GAS_PRICE = parseGwei("146");
function mockPrepared(patch) {
  return { ...OK, chainId: 10143, gasPrice: ECHO_GAS_PRICE, ...patch };
}
function a774First(prepared) {
  const { account, spy } = spyAccount();
  const seen = { guarded: [], signed: [] };
  const problem = (p) => { seen.guarded.push(p); return preparedSignProblem(p); };
  const signTransaction = account.signTransaction;
  account.signTransaction = async (p, o) => { seen.signed.push(p); return signTransaction(p, o); };
  const wc = { async prepareTransactionRequest() { return prepared; } };
  return { run: () => SIGN_STEP(problem)(wc, account, DEPOSIT_TX), account, spy, seen };
}
function a774Strict(prepared) {
  const { account, spy } = spyAccount();
  const seen = { signed: [] };
  const signTransaction = account.signTransaction;
  account.signTransaction = async (p, o) => { seen.signed.push(p); return signTransaction(p, o); };
  const log = [];
  const run = () => executeMoneyStep({
    tx: DEPOSIT_TX,
    transport: { kind: TRANSPORT_KIND.VIEM_RAW, account, walletClient: { async prepareTransactionRequest() { return prepared; } }, publicClient: { async sendRawTransaction({ serializedTransaction }) { log.push("broadcast"); return keccak256(serializedTransaction); } } },
    authorize: () => true, reserve: () => true, persistHash: () => { log.push("persist_hash"); return true; },
  });
  return { run, account, spy, seen, log };
}
await check("A-774 mock 1 First: eip1559 + both max fees + echoed gasPrice -> gasPrice dropped from the signing copy; guard passes; the guarded copy IS the signed object; signed bytes == that copy; original prepared keeps gasPrice", async () => {
  const prepared = mockPrepared({});
  const before = { ...prepared };
  const m = a774First(prepared);
  const signed = await m.run();
  assert.equal(m.spy.signed, 1, "signed once");
  assert.equal(m.seen.guarded.length, 1);
  assert.equal(m.seen.signed.length, 1);
  assert.equal(m.seen.signed[0], m.seen.guarded[0], "the SAME copy goes to the guard and to the signer");
  assert.notEqual(m.seen.guarded[0], prepared, "the guard never sees the original object");
  assert.equal("gasPrice" in m.seen.guarded[0], false, "gasPrice removed from the signing copy");
  const { gasPrice: _g, ...expected } = before;
  assert.deepEqual(m.seen.guarded[0], expected, "copy == original minus gasPrice, nothing else changed");
  assert.equal(prepared.gasPrice, ECHO_GAS_PRICE, "original prepared object still carries gasPrice (untouched)");
  assert.deepEqual(prepared, before, "original prepared object unchanged");
  // serialized payload == the guarded copy: deterministic (RFC 6979) re-sign of the guarded copy gives the same bytes, and the parsed tx carries no gasPrice
  const { account: plain } = spyAccount();
  assert.equal(signed.raw, await plain.signTransaction(expected), "raw == signature over the guarded copy");
  const p = parseTransaction(signed.raw);
  assert.equal(p.type, "eip1559");
  assert.equal(p.gasPrice, undefined, "no gasPrice in the signed bytes");
  for (const k of ["chainId", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "value", "data"]) assert.equal(String(p[k]), String(expected[k]), k);
  assert.equal(p.to.toLowerCase(), expected.to.toLowerCase());
  assert.equal(signed.hash, keccak256(signed.raw));
});
await check("A-774 mock 1 strict money-executor: same echo -> signed once, persisted, broadcast; signed copy has no gasPrice; original prepared keeps gasPrice", async () => {
  const prepared = mockPrepared({});
  const before = { ...prepared };
  const m = a774Strict(prepared);
  const out = await m.run();
  assert.equal(out.status, "broadcast", JSON.stringify(out, big));
  assert.equal(m.spy.signed, 1);
  assert.deepEqual(m.log, ["persist_hash", "broadcast"]);
  assert.notEqual(m.seen.signed[0], prepared);
  assert.equal("gasPrice" in m.seen.signed[0], false);
  const { gasPrice: _g, ...expected } = before;
  assert.deepEqual(m.seen.signed[0], expected);
  assert.deepEqual(prepared, before, "original prepared object unchanged (gasPrice kept)");
  assert.equal(prepared.gasPrice, ECHO_GAS_PRICE);
});
await check("A-774 mock 1 real viem: an honest fill node (chainId 10143, bounded fees) that echoes gasPrice -> viem's prepared request has gasPrice, First signs once with no gasPrice", async () => {
  const { account, spy } = spyAccount();
  const fill = { chainId: "0x279f", gas: "0x30000", maxFeePerGas: toHex(parseGwei("122")), maxPriorityFeePerGas: toHex(parseGwei("2")), gasPrice: toHex(ECHO_GAS_PRICE) };
  const wc = createWalletClient({ account, chain: MONAD_TESTNET, transport: stubRpc({ fill }).transport });
  const pre = await wc.prepareTransactionRequest({ account, chain: MONAD_TESTNET, ...DEPOSIT_TX });
  assert.equal(pre.type, "eip1559");
  assert.ok(typeof pre.gasPrice === "bigint" && pre.gasPrice > 0n, "precondition: viem copies the echoed gasPrice (fee-multiplied) into an eip1559 request (the A-773 anvil finding)");
  assert.equal(preparedSignProblem(pre), "unexpected_field", "precondition: the unchanged guard refuses the raw prepared object");
  const signed = await SIGN_STEP()(wc, account, DEPOSIT_TX);
  assert.equal(spy.signed, 1);
  const p = parseTransaction(signed.raw);
  assert.equal(p.chainId, 10143);
  assert.equal(p.type, "eip1559");
  assert.equal(p.gasPrice, undefined);
});
await check("A-774 mock 2: eip1559 + gasPrice + one max-fee field missing -> refused before signature (First and strict); original untouched", async () => {
  for (const missing of ["maxFeePerGas", "maxPriorityFeePerGas"]) {
    for (const blank of [undefined, null, "absent"]) {
      const patch = {};
      if (blank !== "absent") patch[missing] = blank;
      const prepared = mockPrepared(patch);
      if (blank === "absent") delete prepared[missing];
      const before = { ...prepared };
      const f = a774First(prepared);
      await assert.rejects(() => f.run(), /send_prepared_refused:/, `${missing}=${blank}`);
      assert.equal(f.spy.signed, 0);
      assert.equal(f.seen.guarded[0].gasPrice, ECHO_GAS_PRICE, "gasPrice NOT dropped when a fee field is missing");
      assert.deepEqual(prepared, before);
      const st = a774Strict(prepared);
      const out = await st.run();
      assert.equal(out.status, "blocked");
      assert.equal(out.phase, "sign");
      assert.equal(st.spy.signed, 0);
      assert.deepEqual(st.log, []);
      assert.deepEqual(prepared, before);
    }
  }
});
await check("A-774 mock 3: legacy / undefined type + gasPrice (even with both max fees) -> refused before signature (First and strict); original untouched", async () => {
  for (const type of ["legacy", undefined, "eip2930", "eip7702"]) {
    for (const fees of [{}, { maxFeePerGas: undefined, maxPriorityFeePerGas: undefined }]) {
      const prepared = mockPrepared({ type, ...fees });
      const before = { ...prepared };
      const f = a774First(prepared);
      await assert.rejects(() => f.run(), /send_prepared_refused:tx_type_unexpected/, String(type));
      assert.equal(f.spy.signed, 0);
      assert.equal(f.seen.guarded[0].gasPrice, ECHO_GAS_PRICE);
      assert.deepEqual(prepared, before);
      const st = a774Strict(prepared);
      const out = await st.run();
      assert.equal(out.status, "blocked");
      assert.equal(out.reason, "tx_type_unexpected");
      assert.equal(st.spy.signed, 0);
      assert.deepEqual(st.log, []);
    }
  }
});
await check("A-774 still refused with a gasPrice echo stripped: wrong chainId / authorizationList / fee bounds (First and strict)", async () => {
  for (const [patch, reason] of [[{ chainId: 1 }, "chain_id_mismatch"], [{ authorizationList: [] }, "authorization_list_present"], [{ maxFeePerGas: parseGwei("120000") }, "fee_out_of_bounds"], [{ maxPriorityFeePerGas: parseGwei("123") }, "fee_out_of_bounds"], [{ gas: 30_000_000n }, "gas_out_of_bounds"], [{ gas: 2_000_000n, maxFeePerGas: parseGwei("60") }, "fee_out_of_bounds"], [{ type: "eip7702" }, "tx_type_unexpected"]]) {
    const f = a774First(mockPrepared(patch));
    await assert.rejects(() => f.run(), new RegExp(`send_prepared_refused:${reason}`), JSON.stringify(patch, big));
    assert.equal(f.spy.signed, 0);
    const st = a774Strict(mockPrepared(patch));
    const out = await st.run();
    assert.equal(out.reason, reason);
    assert.equal(st.spy.signed, 0);
  }
});
await check("A-774 source: preparedSignProblem unchanged (gasPrice still forbidden); strip is conditioned on eip1559 + both max fees in both signers", () => {
  assert.equal(preparedSignProblem({ ...OK, gasPrice: 1n }), "unexpected_field");
  const cond = 'toSign.type === "eip1559" && toSign.maxFeePerGas !== undefined && toSign.maxFeePerGas !== null && toSign.maxPriorityFeePerGas !== undefined && toSign.maxPriorityFeePerGas !== null) delete toSign.gasPrice;';
  const s = fnBody("signSendStep");
  assert.ok(s.includes(cond) && s.indexOf(cond) < s.indexOf("preparedSignProblem(toSign)"));
  const ex = readFileSync(new URL("../src/money-executor.js", import.meta.url), "utf8");
  const strict = ex.slice(ex.indexOf("if (strict) {"));
  // [A-791 re-pin, named reason: the strict path and the VIEM_SEND compat path now share ONE signing-copy helper
  // (signingCopy) so both guard and sign the same object. The strip condition is byte-identical, it lives only in that
  // helper (still exactly one `delete gasPrice` in the file), and both paths call it before preparedSignProblem.]
  const helper = ex.slice(ex.indexOf("export function signingCopy("), ex.indexOf("function passed("));
  assert.ok(helper.includes(cond), "signingCopy carries the exact A-774 strip condition");
  assert.ok(strict.includes("const toSign = signingCopy(prepared);") && strict.indexOf("const toSign = signingCopy(prepared);") < strict.indexOf("preparedSignProblem(toSign)"));
  const viemSend = ex.slice(ex.indexOf("let viemSendRequest = null;"), ex.indexOf("// Compat transports: the hash exists only once the send returns."));
  assert.ok(viemSend.indexOf("signingCopy(") > 0 && viemSend.indexOf("signingCopy(") < viemSend.indexOf("preparedSignProblem(toSign)"), "VIEM_SEND builds the same signing copy before the guard");
  assert.equal((MAIN.match(/delete [a-zA-Z.]*gasPrice/g) || []).length, 1);
  assert.equal((ex.match(/delete [a-zA-Z.]*gasPrice/g) || []).length, 1);
});

// ═══ M-L-1 ══════════════════════════════════════════════════════════════════════════════════════════════════
const DEP_BLOCK = 4242n;
const HELPER_SRC = cut("const POST_DEPOSIT_READ_TRIES", "\n// 부팅 때 한 번");
function makeHelper({ shares, nonceAt, estimate, prepareNonce, problem = preparedSignProblem } = {}) {
  const calls = { shares: [], nonce: [], estimate: [], prepare: [], sign: 0, sleeps: 0 };
  const publicClient = {
    async getTransactionCount(args) { calls.nonce.push(args.blockNumber); return nonceAt(args.blockNumber, calls.nonce.length); },
    async estimateGas(args) { calls.estimate.push(args.blockNumber); return estimate ? estimate(args.blockNumber, calls.estimate.length) : 77000n; },
  };
  const walletClient = { async prepareTransactionRequest(t) { calls.prepare.push(t); return { ...OK, gas: t.gas, nonce: prepareNonce ? prepareNonce(calls.prepare.length) : 8, to: t.to, data: t.data }; } };
  const account = { address: "0x" + "ab".repeat(20), async signTransaction(p) { calls.sign += 1; return `0x0${p.nonce}`; } };
  const env = {
    readShmonBalance: async (address, blockNumber) => { calls.shares.push(blockNumber); return shares(blockNumber, calls.shares.length); },
    publicClient,
    makeRedeemTx: (s) => { if (s <= 0n) throw new Error("no shMON received"); return { to: SHMON, data: `0xba${s}` }; },
    keccak256, MONAD_TESTNET, preparedSignProblem: problem,
    setTimeout: (fn) => { calls.sleeps += 1; fn(); return 0; },
  };
  const names = Object.keys(env);
  const f = new Function(...names, `${fnBody("signSendStep")}\n${HELPER_SRC}\nreturn prepareRedeemAfterDeposit;`)(...names.map((n) => env[n]));
  const run = () => f({ walletClient, account, depositReceipt: { blockNumber: DEP_BLOCK, status: "success" }, beforeShares: 10n, depositNonce: 7 });
  return { run, calls };
}
await check("M-L-1 reads are pinned to the deposit receipt block: shMON balance, nonce and gas all read at blockNumber = depositReceipt.blockNumber; the pinned gas goes to prepare", async () => {
  const h = makeHelper({ shares: (b) => (b === DEP_BLOCK ? 15n : 10n), nonceAt: (b) => (b === DEP_BLOCK ? 8 : 7) });
  const out = await h.run();
  assert.equal(out.kind, "ready");
  assert.equal(out.shmonReceived, 5n);
  assert.equal(out.redeemSigned.nonce, 8);
  assert.deepEqual(h.calls.shares, [DEP_BLOCK]);
  assert.deepEqual(h.calls.nonce, [DEP_BLOCK]);
  assert.deepEqual(h.calls.estimate, [DEP_BLOCK]);
  assert.equal(h.calls.prepare[0].gas, 77000n, "prepare does not re-estimate on a lagging latest");
  assert.equal(h.calls.sign, 1);
  assert.equal(h.calls.sleeps, 0, "no wait on the happy path");
});
await check("M-L-1 lagging reader: the pinned block is unknown for 2 tries (throws) while latest shows 0 shMON -> bounded retry, then ready (no false failure)", async () => {
  const h = makeHelper({ shares: (b, i) => { if (b === DEP_BLOCK && i <= 4) throw new Error("header not found"); return b === DEP_BLOCK ? 15n : 10n; }, nonceAt: () => 8 });
  const out = await h.run();
  assert.equal(out.kind, "ready");
  assert.equal(h.calls.sleeps, 2);
  assert.equal(h.calls.sign, 1);
});
await check("M-L-1 lagging nonce (deposit-block count / pending count still at the deposit nonce) -> retried, never 'send_redeem_nonce_unexpected'; the lower-nonce signature is discarded", async () => {
  const h = makeHelper({ shares: () => 15n, nonceAt: (_b, i) => (i < 3 ? 7 : 8), prepareNonce: (i) => (i === 1 ? 7 : 8) });
  const out = await h.run();
  assert.equal(out.kind, "ready");
  assert.equal(out.redeemSigned.nonce, 8);
  assert.equal(h.calls.sleeps, 3);
});
await check("M-L-1 unresolved lag (shMON never visible) -> 'lagging' after exactly POST_DEPOSIT_READ_TRIES (5) reads x 500ms; nothing signed; no throw", async () => {
  const h = makeHelper({ shares: () => 10n, nonceAt: () => 8 });
  const out = await h.run();
  assert.deepEqual(out, { kind: "lagging" });
  assert.equal(h.calls.shares.length, 5);
  assert.equal(h.calls.sleeps, 4);
  assert.equal(h.calls.sign, 0);
  assert.match(HELPER_SRC, /const POST_DEPOSIT_READ_TRIES = 5;/);
  assert.match(HELPER_SRC, /const POST_DEPOSIT_READ_MS = 500;/);
});
await check("M-L-1 genuine conflicts are NOT retried: nonce above deposit+1 throws; a pre-sign guard refusal throws (not reclassified as lag)", async () => {
  await assert.rejects(() => makeHelper({ shares: () => 15n, nonceAt: () => 9 }).run(), /send_redeem_nonce_unexpected/);
  const refused = makeHelper({ shares: () => 15n, nonceAt: () => 8, problem: () => "chain_id_mismatch" });
  await assert.rejects(() => refused.run(), /send_prepared_refused:chain_id_mismatch/);
  assert.equal(refused.calls.sign, 0);
});

// Full First run on the REAL sendPiggy/sendPiggyOnce text (send-lock.mjs harness shape).
function fakeLocks() {
  const held = new Map();
  return {
    async request(name, opts, cb) { if (held.has(name)) return opts.ifAvailable ? cb(null) : new Promise(() => {}); held.set(name, true); try { return await cb({ name, mode: "exclusive" }); } finally { held.delete(name); } },
    async query() { return { held: [...held.keys()].map((name) => ({ name })), pending: [] }; },
  };
}
function mockStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) };
}
function makeFirst({ visibleShares }) {
  const storage = mockStorage();
  const calls = { sendRaw: 0, scenes: [], prepared: 0, settle: 0, errors: [] };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const state = { address: "0xabc", txHash: "", mark: "", grantTxHash: "", awayRestore: null };
  const env = {
    localStorage: storage, state, document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    isAllowedPiggyRpId: () => true,
    signerSince: Date.now(), // [A-896 harness wiring] live signer stamped now (wall clock) so sendPiggyOnce's 60 s margin check sees a fresh signer
    activeAccount: { address: "0xabc", signTransaction: async (p) => `0xa${p.nonce}` },
    navigator: { locks: fakeLocks() }, keccak256,
    activeSession: { signDigest: async () => ({ compact: new Uint8Array([1]), recovery: 0 }) },
    setScene: (...a) => { calls.scenes.push(a); },
    recoverPiggy: async () => {}, noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    requestGrant: async () => ({ txHash: "" }),
    simulateSend: async () => ({ depositTx: {}, before: 1n, beforeShares: 0n }),
    touchAppSession() {},
    createWalletClient: () => ({ prepareTransactionRequest: async (t) => ({ type: "eip1559", chainId: 10143, gas: t.gas ?? 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: calls.prepared++ }) }),
    preparedSignProblem,
    MONAD_TESTNET: {}, MONAD_TESTNET_RPC: "", http: () => ({}),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) }, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) },
    TextEncoder, toHex: () => "00",
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: DEP_BLOCK }),
    readShmonBalance: async (_a, blockNumber) => visibleShares(blockNumber),
    makeRedeemTx: (s) => { if (s <= 0n) throw new Error("no shMON received"); return { to: SHMON }; },
    publicClient: { estimateGas: async () => 1n, getTransactionCount: async () => 1, sendRawTransaction: async ({ serializedTransaction }) => { calls.sendRaw += 1; return keccak256(serializedTransaction); } },
    settleSend: async () => { calls.settle += 1; return { outcome: "done", reason: "ok", receipt: null }; },
    finishTrip: () => {}, formatError: (e) => String(e),
    recordSafeError: (where, e) => calls.errors.push([where, e?.name || String(e?.message || e)]),
    waitForGrantBalance: async () => true, endActiveSession: () => {},
    setTimeout: (fn) => { fn(); return 0; },
  };
  const constsSrc = cut('const SEND_PENDING_KEY = "araso.sendPending";', "\n\n");
  const lockSrc = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");
  const onceSrc = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");
  const names = Object.keys(env);
  const made = new Function(...names, `${constsSrc}\n${lockSrc}\n${onceSrc}\nreturn { sendPiggy, readSendPending, sendBusy, holdSendTabLock };`)(...names.map((n) => env[n]));
  made.holdSendTabLock();
  return { ...made, calls, state, storage };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
await check("M-L-1 First end to end, reader never catches up: deposit broadcast once, redeem never sent, record kept (Send locked), Away 'still out.' (awayRestore pending) — NOT 'could not get ready'", async () => {
  const t = makeFirst({ visibleShares: () => 0n });
  await t.sendPiggy(); await tick();
  assert.equal(t.calls.sendRaw, 1, "deposit only");
  assert.equal(t.calls.settle, 0);
  assert.equal(t.readSendPending()?.stage, "deposit-broadcast", "deposit record kept");
  assert.equal(t.sendBusy(), true, "Send stays locked");
  assert.equal(t.state.awayRestore, "pending");
  assert.deepEqual(t.calls.scenes.at(-1), ["away", "Piggy went out.", "Can go out once."]);
  assert.equal(t.calls.scenes.some((s) => s[1] === "Piggy could not get ready."), false);
  assert.deepEqual(t.calls.errors.at(-1), ["send", "PostDepositReadLag"]);
});
await check("M-L-1 First end to end, shMON visible only at the pinned deposit block (latest lags): redeem signed+sent, settle runs", async () => {
  const t = makeFirst({ visibleShares: (b) => (b === DEP_BLOCK ? 5n : 0n) });
  await t.sendPiggy(); await tick(); await tick();
  assert.equal(t.calls.sendRaw, 2);
  assert.equal(t.calls.settle, 1);
  assert.equal(t.calls.scenes.some((s) => s[1] === "Piggy could not get ready."), false);
});

// ═══ M-T-1 ══════════════════════════════════════════════════════════════════════════════════════════════════
const EVIL_NAME = `<img src=x onerror="alert(1)">&Bo's`;
const ESCAPED_NAME = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;Bo's";
const ESCAPE_SRC = fnBody("escapeHtml");
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
await check("M-T-1 Home homeCharacter(name): the name is escaped (no live <img>), visible text identical; a plain name is byte-identical", () => {
  const homeCharacter = new Function("MOTION_DIR", "chogHomeMarkupForExplore", `${ESCAPE_SRC}\n${fnBody("homeCharacter")}\nreturn homeCharacter;`)("/motion", () => "");
  const html = homeCharacter(EVIL_NAME);
  const span = html.match(/<span class="homeChar__name" id="homeName">([^]*?)<\/span>/)[1];
  assert.equal(span, ESCAPED_NAME);
  assert.equal(decode(span), EVIL_NAME, "visible text identical");
  assert.equal(/<img src=x/.test(html), false);
  assert.match(homeCharacter("Honeybun"), /<span class="homeChar__name" id="homeName">Honeybun<\/span>/);
});
await check("M-T-1 Return returnSceneMarkup({name}): the name is escaped, visible text identical; a plain name is byte-identical", () => {
  const html = returnSceneMarkup({ name: EVIL_NAME, line: "", receiptRowsMarkup: "" });
  const span = html.match(/id="returnName" hidden>([^]*?)<\/span>/)[1];
  assert.equal(span, ESCAPED_NAME);
  assert.equal(decode(span), EVIL_NAME);
  assert.equal(/<img src=x/.test(html), false);
  assert.match(returnSceneMarkup({ name: "Honeybun" }), /id="returnName" hidden>Honeybun<\/span>/);
});
await check("M-T-1 source: no raw ${name} left in the Home/Return name slots", () => {
  assert.equal(/id="homeName">\$\{name\}/.test(MAIN), false);
  const rv = readFileSync(new URL("../src/return-view.js", import.meta.url), "utf8");
  assert.equal(/id="returnName" hidden>\$\{name\}/.test(rv), false);
});

// ═══ M-T-2 ══════════════════════════════════════════════════════════════════════════════════════════════════
const R = new Function("formatEther", "SEND_AMOUNT", "FIRST_SEND_USD", `${ESCAPE_SRC}\n${fnBody("shortHash")}\n${fnBody("formatMoney")}\n${fnBody("sentRowValue")}\n${fnBody("receiptRows")}\n${fnBody("receiptRowMarkup")}\nreturn { receiptRows, receiptRowMarkup };`)(formatEther, 10n ** 15n, "$5");
const H1 = "0x" + "cd".repeat(32);
const LEGACY = { before: 5n * 10n ** 17n, sent: 10n ** 15n, gas: 10n ** 12n, after: 498999n * 10n ** 12n, txHash: H1, redeemTxHash: H1, redeemBlockNumber: 101n };
await check("M-T-2 healthy receipt renders byte-identical markup to the pre-A-768 template (Sent $5 + faint MON, Cost, Left, Tx, Block)", () => {
  const html = R.receiptRows(LEGACY).map(R.receiptRowMarkup).join("");
  const old = [["Sent", '$5 <span class="receipt-sub">0.001 MON</span>'], ["Cost", "0.000001 MON"], ["Left", "0.499 MON"], ["Tx", `${H1.slice(0, 10)}…${H1.slice(-6)}`], ["Block", "101"]]
    .map(([l, v]) => `<p class="receipt-row"><span class="label">${l}</span><span class="value">${v}</span></p>`).join("");
  assert.equal(html, old);
});
await check("M-T-2 hostile stored values never render as markup: tx hash / block / add_money fields with <img onerror> -> 'Unknown', escaped output only", () => {
  const evil = `<img src=x onerror=alert(1)>`;
  const legacyRows = R.receiptRows({ ...LEGACY, redeemTxHash: evil, txHash: evil, redeemBlockNumber: evil });
  const add = R.receiptRows({ kind: "add_money", txHash: evil, blockNumber: `1<script>` });
  for (const rows of [legacyRows, add]) {
    const html = rows.map(R.receiptRowMarkup).join("");
    assert.equal(/<img|<script/.test(html), false, html);
    assert.equal(rows.find((r) => r.label === "Tx").value, "Unknown");
    assert.equal(rows.find((r) => r.label === "Block").value, "Unknown");
  }
  const html = R.receiptRowMarkup({ label: "<b>x</b>", value: evil, sub: `"><svg onload=1>` });
  assert.equal(/<b>|<img|<svg/.test(html), false, html);
  assert.equal(R.receiptRows({ kind: "add_money", txHash: "0x" + "a".repeat(63), blockNumber: "0x10" })[0].value, "Unknown");
  assert.equal(R.receiptRows({ kind: "add_money", txHash: "0x" + "a".repeat(64), blockNumber: "0x10" })[1].value, "Unknown");
  assert.equal(R.receiptRows({ kind: "add_money", txHash: "0x" + "a".repeat(64), blockNumber: 7 })[1].value, "7");
  assert.equal(R.receiptRows({ kind: "add_money", txHash: "", blockNumber: "12" })[0].value, "", "empty hash stays empty (unchanged)");
});
await check("M-T-2 source: filebox + HISTORY detail render rows only through receiptRowMarkup (no raw ${row.label}/${row.value})", () => {
  assert.equal(/\$\{row\.(label|value)\}/.test(MAIN), false);
  assert.equal((MAIN.match(/\.map\(receiptRowMarkup\)/g) || []).length, 2);
});
await check("M-T-2 decode: wrong-typed hash fields and non-integer numerics throw (row-level fail closed); healthy legacy rows still decode", () => {
  const good = encodeReceiptRow({ ...LEGACY, at: 1 });
  assert.equal(decodeReceiptRow(good).redeemTxHash, H1);
  for (const patch of [{ txHash: { x: 1 } }, { redeemTxHash: 42 }, { depositTxHash: ["0x"] }, { grantTxHash: {} }, { redeemBlockNumber: "0x10" }, { redeemBlockNumber: " 12" }, { before: "1e18" }, { gas: "-1" }, { sent: undefined }]) {
    assert.throws(() => decodeReceiptRow({ ...good, ...patch }), /receipt: invalid/, JSON.stringify(patch));
  }
});
function receiptStore(raw) {
  const m = new Map(raw === undefined ? [] : [["araso.receipts", raw]]);
  const localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const state = { receipts: [], receiptIndex: 0 };
  const api = new Function("localStorage", "state", "RECEIPTS_KEY", "decodeReceiptRow", "encodeReceiptRow", "codecReceiptIdentityKey", "RECEIPT_KIND", "LEGACY_TESTNET_PATH",
    `${cut("function readReceipts() {", "\nfunction writeCredential(credential) {")}\nreturn { readReceipts, rememberReceipt };`)(localStorage, state, "araso.receipts", decodeReceiptRow, encodeReceiptRow, codecReceiptIdentityKey, RECEIPT_KIND, true);
  return { api, raw: () => m.get("araso.receipts"), state };
}
await check("M-T-2/M-F-3 malformed stored rows fail closed per row: healthy history still reads, nothing is erased from storage", () => {
  const good1 = encodeReceiptRow({ ...LEGACY, at: 1 });
  const good2 = encodeReceiptRow({ ...LEGACY, redeemTxHash: "0x" + "ef".repeat(32), txHash: "0x" + "ef".repeat(32), at: 2 });
  const rows = [good1, { ...good1, before: "undefined" }, { ...good1, redeemTxHash: { evil: 1 } }, { kind: "add_money", chainId: "x" }, good2, null, 7];
  const raw = JSON.stringify(rows);
  const s = receiptStore(raw);
  assert.deepEqual(s.api.readReceipts().map((r) => r.redeemTxHash), [H1, "0x" + "ef".repeat(32)]);
  assert.equal(s.raw(), raw, "read never rewrites");
});

// ═══ M-F-3 ══════════════════════════════════════════════════════════════════════════════════════════════════
await check("M-F-3 legacy encoder refuses missing/non-integer required fields BEFORE persistence (no 'undefined' strings); optional fields validated too", () => {
  const ok = encodeReceiptRow({ ...LEGACY, at: 1 });
  assert.deepEqual([ok.before, ok.after, ok.gas, ok.sent, ok.redeemBlockNumber, ok.depositBlockNumber], ["500000000000000000", "498999000000000000", "1000000000000", "1000000000000000", "101", "0"]);
  for (const patch of [{ before: undefined }, { after: null }, { gas: "abc" }, { sent: 1.5 }, { sent: -1n }, { before: Number.NaN }, { redeemBlockNumber: "x" }, { shmonReceived: {} }, { txHash: 12 }]) {
    assert.throws(() => encodeReceiptRow({ ...LEGACY, ...patch }), /receipt: invalid/, JSON.stringify(patch, big));
  }
  assert.equal(JSON.stringify(ok).includes("undefined"), false);
});
await check("M-F-3 rememberReceipt: a bad receipt is refused with storage byte-identical; a stored bad row no longer blocks later saves (kept verbatim)", () => {
  const good1 = encodeReceiptRow({ ...LEGACY, at: 1 });
  const bad = { ...good1, before: "undefined" };
  const raw = JSON.stringify([good1, bad]);
  const s = receiptStore(raw);
  assert.throws(() => s.api.rememberReceipt({ ...LEGACY, redeemTxHash: "0x" + "12".repeat(32), sent: undefined }), /receipt: invalid/);
  assert.equal(s.raw(), raw, "nothing written for the bad receipt");
  const fresh = { ...LEGACY, redeemTxHash: "0x" + "34".repeat(32), txHash: "0x" + "34".repeat(32), at: 3 };
  assert.equal(s.api.rememberReceipt(fresh), true);
  const after = JSON.parse(s.raw());
  assert.equal(after.length, 3);
  assert.deepEqual(after[1], good1);
  assert.deepEqual(after[2], bad, "bad row kept verbatim, not erased");
  assert.equal(s.api.readReceipts().length, 2, "healthy history visible");
});

// ═══ M-F-1 ══════════════════════════════════════════════════════════════════════════════════════════════════
const CHAIN = "monad-testnet";
const KEY = myPiggiesIndexKey(CHAIN);
const ADDR_A = "0x" + "a1".repeat(20);
const ADDR_B = "0x" + "b2".repeat(20);
const ADDR_C = "0x" + "c3".repeat(20);
const CRED = { credentialId: Buffer.from("root-cred").toString("base64url") };
function idxStorage(init, { throwOnGet = false } = {}) {
  const m = new Map(init === undefined ? [] : [[KEY, init]]);
  return { getItem: (k) => { if (throwOnGet) throw new Error("blocked"); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: () => m.get(KEY) };
}
const twoRow = (() => {
  const s = idxStorage();
  assert.equal(registerControlledPiggy(s, CHAIN, { name: "A", address: ADDR_A, signerAddress: ADDR_A, locator: CRED, at: "2026-10-05T00:00:00Z" }).ok, true);
  assert.equal(registerControlledPiggy(s, CHAIN, { name: "B", address: ADDR_B, signerAddress: ADDR_B, locator: CRED, at: "2026-10-05T00:00:01Z" }).ok, true);
  return JSON.parse(s.raw());
})();
await check("M-F-1 writers refuse corrupt / truncated / future-version / wrong-chain / unreadable index loads (no clean one-row rewrite); storage bytes unchanged", () => {
  const cases = [
    ["truncated JSON", JSON.stringify(twoRow).slice(0, 40)],
    ["future version", JSON.stringify({ ...twoRow, version: 2 })],
    ["wrong chain", JSON.stringify({ ...twoRow, chainId: "other" })],
    ["piggies not an array", JSON.stringify({ ...twoRow, piggies: {} })],
  ];
  for (const [label, raw] of cases) {
    const s = idxStorage(raw);
    const out = registerControlledPiggy(s, CHAIN, { name: "C", address: ADDR_C, signerAddress: ADDR_C, locator: CRED, at: "2026-10-05T00:00:02Z" });
    assert.equal(out.ok, false, label);
    assert.equal(out.reason, "index_unreadable", label);
    assert.equal(s.raw(), raw, `${label}: bytes unchanged`);
    assert.equal(renameIndexedPiggy(s, CHAIN, { id: `piggy-${ADDR_A}`, name: "Z" }).reason, "index_unreadable", `${label}: rename refuses`);
    assert.equal(s.raw(), raw);
  }
  const blocked = idxStorage(JSON.stringify(twoRow), { throwOnGet: true });
  assert.equal(registerControlledPiggy(blocked, CHAIN, { address: ADDR_A, signerAddress: ADDR_A, locator: CRED, at: "t" }).reason, "index_unreadable");
});
await check("M-F-1 'absent' is the only empty-create case; a healthy index is still updated in place (other rows kept)", () => {
  const s = idxStorage();
  assert.equal(registerControlledPiggy(s, CHAIN, { name: "A", address: ADDR_A, signerAddress: ADDR_A, locator: CRED, at: "t1" }).ok, true);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 1);
  const h = idxStorage(JSON.stringify(twoRow));
  assert.equal(registerControlledPiggy(h, CHAIN, { address: ADDR_A, signerAddress: ADDR_A, locator: CRED, at: "t2" }).ok, true);
  assert.deepEqual(loadMyPiggiesIndex(h, CHAIN).index.piggies.map((p) => p.address), [ADDR_A, ADDR_B]);
  assert.equal(renameIndexedPiggy(h, CHAIN, { id: `piggy-${ADDR_B}`, name: "Bee" }).ok, true);
  assert.equal(renameIndexedPiggy(idxStorage(), CHAIN, { id: "x", name: "Bee" }).reason, "not_indexed", "absent rename: nothing to rename");
});

// ═══ M-T-3 ══════════════════════════════════════════════════════════════════════════════════════════════════
await check("M-T-3 the bell is served from /card/crayon-bell.svg: same 969 bytes as the pre-A-768 inline markup (sha256 a232a079…), no data: URI left", () => {
  const file = new URL("../public/card/crayon-bell.svg", import.meta.url);
  assert.ok(existsSync(file));
  const bytes = readFileSync(file);
  assert.equal(bytes.length, 969);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "a232a0797c8d4cc90310d9f7c4ee748935c0ef5d38a6ce8a8e2de0cab1ef8f2a");
  const svg = bytes.toString("utf8");
  assert.equal(/<metadata|<script|\son\w+=|href=|xlink|<foreignObject|<image/i.test(svg), false, "stripped: no metadata/script/handlers/external refs");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100">/);
  assert.match(RETURN_SRC, /^const BELL_SRC = "\/card\/crayon-bell\.svg";$/m);
  assert.equal(/data:image|BELL_SVG_MARKUP\s*=|encodeURIComponent\(/.test(RETURN_SRC), false);
});
await check("M-T-3 geometry and CSP unchanged: BELL_GAP/BELL_SIZE and the blit are the same; vercel.json img-src stays 'self' only (no data:)", () => {
  assert.match(RETURN_SRC, /const BELL_GAP = 24;/);
  assert.match(RETURN_SRC, /const BELL_SIZE = 64;/);
  assert.match(RETURN_SRC, /blit\(BELL_KEY, BELL_BOX\);/);
  assert.match(RETURN_SRC, /im\.src = BELL_SRC;/);
  const csp = JSON.parse(VERCEL).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /img-src 'self';/);
  assert.equal(/data:/.test(csp), false);
});

console.log(`\nA-768: ${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
