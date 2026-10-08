// [A-915] SIGN_GUARD on Monad 143 for EXACTLY the three sender create-step shapes (+ the existing A-913 brand path, covered by a913-sign-guard-143.mjs).
//   node app/test/a915-create-143-sign-guard.mjs     (no network, no tx)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256, maxUint256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SIGN_GUARD, preparedSignProblem as P, executeMoneyStep } from "../src/money-executor.js";
import { planGiftCreate, buildGiftCreateStepCalls, armGiftCreateStep, disarmAllGiftCreateSteps, giftCreateStepMatch, giftCreateConfigProblem } from "../src/gift-create-plan.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c";   // ARBITRARY TEST FIXTURE - not a deployed escrow
const OTHER = "0x00000000000000000000000000000000000000b2";
const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const USDC143 = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const sender = privateKeyToAccount(generatePrivateKey());
const EXPIRY = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
// ARBITRARY TEST FIXTURES - not measured gas, not a fee, not a product amount.
const GAS = Object.freeze({ gasUnits: { install: 50_000n, commitClaim: 50_000n, revoke: 50_000n, claim: 80_000n, fundingTransfer: 10_000n }, feeInputs: { maxFeePerGasWei: 100_000_000_000n, source: "test-fixture" }, safety: { bufferBps: 2000 } });
const plan143 = (o = {}) => planGiftCreate({ chainScope: "monad-mainnet", presetLabel: 20, senderAddress: sender.address, expiry: EXPIRY, gas: GAS, sponsor: { sponsorAddress: SPONSOR, chainId: 143 }, origin: "https://araso.app", ...o });
const prep = (call, o = {}) => ({ chainId: 143, type: "eip1559", nonce: 3, gas: 120_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, to: call.to, data: call.data, value: call.value, ...o });
const APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];
const CREATE_ABI = [{ type: "function", name: "create", stateMutability: "nonpayable", inputs: [{ name: "giftId", type: "bytes32" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "claimTokenHash", type: "bytes32" }], outputs: [] }];

const plan = await plan143(); assert.equal(plan.ok, true, plan.reason);
const built = buildGiftCreateStepCalls(plan, { escrowAddress: ESCROW }); assert.equal(built.ok, true, built.reason);
const [APPROVE, CREATE, DEPOSIT] = built.calls;
const a = plan.escrowCreateArgs;

await check("before arming: all three create-step shapes on 143 are chain_id_mismatch (nothing is open by default)", () => {
  disarmAllGiftCreateSteps();
  for (const c of built.calls) assert.equal(P(prep(c)), "chain_id_mismatch", c.label);
});
const armed = armGiftCreateStep(plan, built.calls, { escrowAddress: ESCROW });
await check("arm: a verified plan + its exact calls arms; the three shapes then pass the guard", () => {
  assert.equal(armed.ok, true, armed.reason);
  assert.equal(P(prep(APPROVE)), null); assert.equal(P(prep(CREATE)), null); assert.equal(P(prep(DEPOSIT)), null);
  assert.equal(giftCreateStepMatch(prep(APPROVE)), "approve"); assert.equal(giftCreateStepMatch(prep(CREATE)), "create"); assert.equal(giftCreateStepMatch(prep(DEPOSIT)), "gas_deposit");
  assert.equal(P(prep(APPROVE, { value: undefined })), null, "viem may leave value undefined on a zero-value call");
});
await check("approve: pinned USDC, spender = pinned escrow, exact amount; wrong spender / max-uint / other amount / wrong token / value => refused", () => {
  const ap = (spender, amount, o = {}) => prep(APPROVE, { data: encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, amount] }), ...o });
  assert.equal(P(ap(OTHER, BigInt(a.amount))), "chain_id_mismatch", "wrong spender");
  assert.equal(P(ap(SPONSOR, BigInt(a.amount))), "chain_id_mismatch", "sponsor as spender");
  assert.equal(P(ap(ESCROW, maxUint256)), "chain_id_mismatch", "max-uint approve");
  assert.equal(P(ap(ESCROW, BigInt(a.amount) + 1n)), "chain_id_mismatch", "amount + 1");
  assert.equal(P(ap(ESCROW, BigInt(a.amount) - 1n)), "chain_id_mismatch", "amount - 1");
  assert.equal(P(ap(ESCROW, 0n)), "chain_id_mismatch", "revoke-style zero");
  assert.equal(P(ap(ESCROW, BigInt(a.amount), { to: OTHER })), "chain_id_mismatch", "wrong token contract");
  assert.equal(P(ap(ESCROW, BigInt(a.amount), { value: 1n })), "chain_id_mismatch", "extra native value");
  assert.equal(P(prep(APPROVE, { data: `${APPROVE.data}00` })), "chain_id_mismatch", "trailing byte");
  assert.equal(P(prep(APPROVE, { data: "0x" })), "chain_id_mismatch", "empty data");
});
await check("create: pinned escrow, the planned args only; wrong to / any arg change / value / selector => refused", () => {
  const cr = (args, o = {}) => prep(CREATE, { data: encodeFunctionData({ abi: CREATE_ABI, functionName: "create", args }), ...o });
  const ok = [a.giftId, a.token, BigInt(a.amount), BigInt(a.expiry), a.claimTokenHash];
  assert.equal(P(cr(ok)), null, "re-encoded identical args");
  assert.equal(P(cr(ok, { to: OTHER })), "chain_id_mismatch", "wrong escrow");
  assert.equal(P(cr(ok, { value: 1n })), "chain_id_mismatch", "extra value");
  assert.equal(P(cr([`0x${"11".repeat(32)}`, ...ok.slice(1)])), "chain_id_mismatch", "other giftId");
  assert.equal(P(cr([ok[0], OTHER, ...ok.slice(2)])), "chain_id_mismatch", "other token");
  assert.equal(P(cr([ok[0], ok[1], maxUint256, ok[3], ok[4]])), "chain_id_mismatch", "max-uint amount");
  assert.equal(P(cr([ok[0], ok[1], ok[2] + 1n, ok[3], ok[4]])), "chain_id_mismatch", "other amount");
  assert.equal(P(cr([ok[0], ok[1], ok[2], ok[3] + 1n, ok[4]])), "chain_id_mismatch", "other expiry");
  assert.equal(P(cr([ok[0], ok[1], ok[2], ok[3], `0x${"22".repeat(32)}`])), "chain_id_mismatch", "other claimTokenHash");
  assert.equal(P(prep(CREATE, { data: `0x12345678${CREATE.data.slice(10)}` })), "chain_id_mismatch", "other selector");
});
await check("gas deposit: pinned sponsor, data = giftId, value = the computed gasBudget exactly; wrong to / value +-1 / zero / data / extra data => refused", () => {
  assert.equal(DEPOSIT.value, plan.gasDeposit.value); assert.ok(DEPOSIT.value > 0n); assert.equal(DEPOSIT.data, a.giftId);
  assert.equal(P(prep(DEPOSIT, { to: OTHER })), "chain_id_mismatch", "wrong payee");
  assert.equal(P(prep(DEPOSIT, { to: ESCROW })), "chain_id_mismatch", "escrow as payee");
  assert.equal(P(prep(DEPOSIT, { value: DEPOSIT.value + 1n })), "chain_id_mismatch", "value + 1");
  assert.equal(P(prep(DEPOSIT, { value: DEPOSIT.value - 1n })), "chain_id_mismatch", "value - 1");
  assert.equal(P(prep(DEPOSIT, { value: 0n })), "chain_id_mismatch", "zero value");
  assert.equal(P(prep(DEPOSIT, { value: undefined })), "chain_id_mismatch", "no value");
  assert.equal(P(prep(DEPOSIT, { data: `0x${"33".repeat(32)}` })), "chain_id_mismatch", "other giftId");
  assert.equal(P(prep(DEPOSIT, { data: "0x" })), "chain_id_mismatch", "empty data");
  assert.equal(P(prep(DEPOSIT, { data: `${DEPOSIT.data}00` })), "chain_id_mismatch", "extra data byte");
});
await check("an armed shape still obeys every other guard line: type / forbidden fields / bounds / chain", () => {
  for (const c of built.calls) {
    assert.equal(P(prep(c, { type: "legacy" })), "tx_type_unexpected", c.label);
    assert.equal(P(prep(c, { type: "eip7702" })), "tx_type_unexpected", c.label);
    assert.equal(P(prep(c, { authorizationList: [] })), "authorization_list_present", c.label);
    assert.equal(P(prep(c, { gasPrice: 1n })), "unexpected_field", c.label);
    assert.equal(P(prep(c, { blobs: ["0x"] })), "unexpected_field", c.label);
    assert.equal(P(prep(c, { accessList: [{ address: ESCROW, storageKeys: [] }] })), "access_list_present", c.label);
    assert.equal(P(prep(c, { gas: 3_000_000n })), "gas_out_of_bounds", c.label);
    assert.equal(P(prep(c, { maxFeePerGas: 2_000_000_000_000n })), "fee_out_of_bounds", c.label);
    assert.equal(P(prep(c, { nonce: -1 })), "nonce_invalid", c.label);
    for (const chainId of [0, 1, 142, 144, 10143, 10144, "143", 143n, 143.5, null, undefined]) {
      if (chainId === 10143) continue; // 10143 is its own (unchanged) path: the shape is not armed there but a plain eip1559 tx is allowed on 10143
      assert.equal(P(prep(c, { chainId })), "chain_id_mismatch", `${c.label} ${String(chainId)}`);
    }
  }
});
await check("10143 unchanged: plain eip1559 passes exactly as before (armed or not); 143 with no armed match stays chain_id_mismatch", () => {
  const plain10143 = { chainId: 10143, type: "eip1559", nonce: 1, gas: 100_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n, to: OTHER, value: 5n, data: "0x" };
  assert.equal(P(plain10143), null);
  assert.equal(P({ ...plain10143, authorizationList: [{}] }), "authorization_list_present");
  assert.equal(P({ ...plain10143, chainId: 143 }), "chain_id_mismatch");
  assert.equal(P({ ...plain10143, chainId: 143, to: ESCROW, data: "0x" }), "chain_id_mismatch");
  assert.equal(SIGN_GUARD.chainId, 10143); assert.equal(Object.isFrozen(SIGN_GUARD), true);
  assert.deepEqual(Object.keys(SIGN_GUARD), ["chainId", "type", "maxGas", "maxFeePerGas", "maxTxFeeWei"]);
});
await check("arming is not shared across gifts: a second gift's calls are open only after ITS arm, the first gift's calls never open the second", async () => {
  const p2 = await plan143({ presetLabel: 50 }); const b2 = buildGiftCreateStepCalls(p2, { escrowAddress: ESCROW });
  for (const c of b2.calls) assert.equal(P(prep(c)), "chain_id_mismatch", `${c.label} before arm`);
  const arm2 = armGiftCreateStep(p2, b2.calls, { escrowAddress: ESCROW }); assert.equal(arm2.ok, true);
  for (const c of b2.calls) assert.equal(P(prep(c)), null, `${c.label} after arm`);
  arm2.disarm();
  for (const c of b2.calls) assert.equal(P(prep(c)), "chain_id_mismatch", `${c.label} after disarm`);
  for (const c of built.calls) assert.equal(P(prep(c)), null, `${c.label} gift 1 still armed`);
});
await check("expiry: an armed step stops opening after the 5-minute cap (A-556), and disarm closes it at once", async () => {
  const p3 = await plan143(); const b3 = buildGiftCreateStepCalls(p3, { escrowAddress: ESCROW });
  const t0 = 1_800_000_000_000;
  const arm3 = armGiftCreateStep(p3, b3.calls, { escrowAddress: ESCROW, nowMs: t0 });
  assert.equal(arm3.ok, true);
  assert.equal(giftCreateStepMatch(prep(b3.calls[0]), { nowMs: t0 + 299_999 }), "approve");
  assert.equal(giftCreateStepMatch(prep(b3.calls[0]), { nowMs: t0 + 300_000 }), null);
  assert.equal(giftCreateStepMatch(prep(b3.calls[2]), { nowMs: t0 + 400_000 }), null);
  arm3.disarm(); assert.equal(giftCreateStepMatch(prep(b3.calls[1]), { nowMs: t0 + 1 }), null);
});
await check("arm refuses (opens nothing): unset / malformed / zero escrow, testnet scope, wrong token, max-uint or non-preset amount, tampered calls, non-143 sponsor chain, zero budget", async () => {
  disarmAllGiftCreateSteps();
  const refused = (r, reason) => { assert.equal(r.ok, false); if (reason) assert.equal(r.reason, reason); };
  refused(armGiftCreateStep(plan, built.calls, {}), "escrow_address_invalid");
  refused(armGiftCreateStep(plan, built.calls, { escrowAddress: "0x1234" }), "escrow_address_invalid");
  refused(armGiftCreateStep(plan, built.calls, { escrowAddress: `0x${"0".repeat(40)}` }), "escrow_address_invalid");
  refused(armGiftCreateStep(plan, built.calls, { escrowAddress: USDC143 }), "escrow_address_invalid");
  refused(armGiftCreateStep(plan, built.calls, { escrowAddress: SPONSOR }), "sponsor_address_invalid");
  refused(armGiftCreateStep(plan, built.calls, { escrowAddress: OTHER }), "create_step_mismatch");  // calls were built for ESCROW
  refused(armGiftCreateStep(plan, [built.calls[0], built.calls[1]], { escrowAddress: ESCROW }), "create_step_incomplete");
  refused(armGiftCreateStep(plan, [built.calls[1], built.calls[0], built.calls[2]], { escrowAddress: ESCROW }), "create_step_mismatch");
  refused(armGiftCreateStep(plan, [{ ...APPROVE, value: 1n }, CREATE, DEPOSIT], { escrowAddress: ESCROW }), "create_step_mismatch");
  const t = await planGiftCreate({ chainScope: "monad-testnet", presetLabel: 20, senderAddress: sender.address, expiry: EXPIRY, gas: GAS, sponsor: { sponsorAddress: SPONSOR, chainId: 143 } });
  refused(armGiftCreateStep(t, buildGiftCreateStepCalls(t, { escrowAddress: ESCROW }).calls, { escrowAddress: ESCROW }), "sponsor_chain_invalid");
  const t2 = await plan143({ sponsor: { sponsorAddress: SPONSOR, chainId: 10143 } });
  refused(armGiftCreateStep(t2, buildGiftCreateStepCalls(t2, { escrowAddress: ESCROW }).calls, { escrowAddress: ESCROW }), "sponsor_chain_invalid");
  const forge = (patch) => ({ ...plan, escrowCreateArgs: Object.freeze({ ...a, ...patch }) });
  for (const [name, patch, reason] of [["max-uint amount", { amount: maxUint256 }, "unsupported_amount"], ["non-preset amount", { amount: 21_000_000 }, "unsupported_amount"], ["other token", { token: OTHER }, "asset_id_chain_mismatch"], ["zero expiry", { expiry: 0 }, "bad_expiry"]]) {
    const fp = forge(patch); const fb = buildGiftCreateStepCalls(fp, { escrowAddress: ESCROW });
    refused(armGiftCreateStep(fp, fb.ok ? fb.calls : [], { escrowAddress: ESCROW }), reason);
  }
  const zeroBudget = { ...plan, gasDeposit: Object.freeze({ ...plan.gasDeposit, value: 0n }) };
  refused(armGiftCreateStep(zeroBudget, buildGiftCreateStepCalls(zeroBudget, { escrowAddress: ESCROW }).calls ?? [], { escrowAddress: ESCROW }), "gas_budget_unknown");
  const badData = { ...plan, gasDeposit: Object.freeze({ ...plan.gasDeposit, data: `0x${"44".repeat(32)}` }) };
  refused(armGiftCreateStep(badData, buildGiftCreateStepCalls(badData, { escrowAddress: ESCROW }).calls ?? [], { escrowAddress: ESCROW }), "create_step_incomplete");
  refused(armGiftCreateStep(null, [], { escrowAddress: ESCROW }));
  for (const c of built.calls) assert.equal(P(prep(c)), "chain_id_mismatch", `nothing armed by the refusals: ${c.label}`);
  assert.equal(giftCreateConfigProblem(null), "config_missing"); assert.equal(giftCreateConfigProblem({ sponsorAddress: SPONSOR }), "escrow_address_invalid");
  assert.equal(giftCreateConfigProblem({ escrowAddress: ESCROW }), "sponsor_address_invalid"); assert.equal(giftCreateConfigProblem({ escrowAddress: ESCROW, sponsorAddress: SPONSOR }), null);
});
await check("executeMoneyStep (strict path): an armed call reaches the signer once; a tampered one NEVER reaches it or the network", async () => {
  armGiftCreateStep(plan, built.calls, { escrowAddress: ESCROW });
  const run = async (call, o = {}) => {
    let signs = 0; let sends = 0;
    const transport = { kind: "viem_raw", walletClient: { prepareTransactionRequest: async () => prep(call, o) },
      account: { address: sender.address, signTransaction: async () => { signs += 1; return "0x02abcd"; } }, publicClient: { sendRawTransaction: async () => { sends += 1; return keccak256("0x02abcd"); } } };
    const r = await executeMoneyStep({ tx: { to: call.to, data: call.data, value: call.value }, transport, authorize: () => true, reserve: () => true, persistHash: () => true });
    return { r, signs, sends };
  };
  for (const c of built.calls) { const ok = await run(c); assert.equal(ok.r.status, "broadcast", c.label); assert.equal(ok.signs, 1); }
  const bad = await run(DEPOSIT, { value: DEPOSIT.value + 1n }); assert.equal(bad.r.reason, "chain_id_mismatch"); assert.equal(bad.signs, 0); assert.equal(bad.sends, 0);
  const max = await run(APPROVE, { data: encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [ESCROW, maxUint256] }) }); assert.equal(max.r.reason, "chain_id_mismatch"); assert.equal(max.signs, 0); assert.equal(max.sends, 0);
  const wrongTo = await run(CREATE, { to: OTHER }); assert.equal(wrongTo.r.reason, "chain_id_mismatch"); assert.equal(wrongTo.signs, 0);
});
await check("source invariants: money-executor names 143 only via the constant; the create-step exception is one armed-match call; no max-uint literal in the guard path", () => {
  const exe = readFileSync(path.resolve(HERE, "../src/money-executor.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.equal((exe.match(/\b143\b/g) || []).length, 1);
  assert.equal((exe.match(/giftCreateStepMatch\(/g) || []).length, 1);
  assert.match(exe, /const createStep = !sponsorList && prepared\.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID \? giftCreateStepMatch\(prepared\) : null;/);
  assert.match(exe, /&& !createStep\) return "chain_id_mismatch"/);
  const plan_src = readFileSync(path.resolve(HERE, "../src/gift-create-plan.js"), "utf8");
  const blk = plan_src.slice(plan_src.indexOf("// ── [A-915]"));
  assert.ok(blk.includes("amount === MAX_UINT256"), "arm refuses max-uint");
  assert.equal(/sendTransaction|sendRawTransaction|signTransaction|fetch\(|localStorage/.test(blk), false, "the guard module sends/stores nothing");
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
