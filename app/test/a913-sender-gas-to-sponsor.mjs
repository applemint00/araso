// [A-913 A] Sender gas -> pinned sponsor, in the SAME create step as the escrow create (one signer session, no extra prompt).
//   node app/test/a913-sender-gas-to-sponsor.mjs      (no network, no tx)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeFunctionData, parseAbi } from "viem";
import { planGiftCreate, planGiftGasDeposit, buildGiftCreateStepCalls, confirmGiftCreateStep, registerGasDeposit, buildGasTxRegistration, needsGasRegistration } from "../src/gift-create-plan.js";
import { planGiftSend, openGiftSend } from "../src/gift-send-paper.js";
import { isStorableLinkRecord } from "../src/gift-piggy-claim-link.js";
import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "../src/funding-context.js";
import { GIFT_SPONSOR_PINS } from "../src/gift-sponsor-7702.js";

let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const CHAIN = "monad-testnet";
const SENDER = "0x00000000000000000000000000000000000000a1";
const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c";
const RECIPIENT = "0xDbA40Dd271190e1B090F80fB1999323952F6b761";
const EXPIRY = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
// ARBITRARY TEST FIXTURES - not measured gas, not a fee, not a product amount.
const GAS = Object.freeze({ gasUnits: { install: 50_000n, commitClaim: 50_000n, revoke: 50_000n, claim: 80_000n, fundingTransfer: 10_000n }, feeInputs: { maxFeePerGasWei: 100_000_000_000n, source: "test-fixture" }, safety: { bufferBps: 2000 } });
const base = (o = {}) => planGiftCreate({ chainScope: CHAIN, presetLabel: 20, senderAddress: SENDER, expiry: EXPIRY, createdAt: "2026-09-24T00:00:00.000Z", origin: "https://araso.app", ...o });
const SP = { sponsorAddress: SPONSOR, chainId: 10143 };
const H = (c) => `0x${c.repeat(64)}`;

await check("plan with sponsor + ESTIMATE budget: gasDeposit = { to: sponsor, value: costWei (with buffer), data: giftId }", async () => {
  const p = await base({ gas: GAS, sponsor: SP });
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.gasBudget.costWei, 28_800_000_000_000_000n); // 240_000 gas (install+commit+revoke+claim+transfer) x 100 gwei + 20% buffer
  assert.equal(p.gasDeposit.value, p.gasBudget.costWei);
  assert.equal(p.gasDeposit.to, SPONSOR);
  assert.equal(p.gasDeposit.data, p.giftId);
  assert.equal(p.gasDeposit.chainId, 10143);
  assert.equal(Object.isFrozen(p.gasDeposit), true);
});
await check("recorded on the gift record (non-secret, still storable); txHash null until broadcast", async () => {
  const p = await base({ gas: GAS, sponsor: SP });
  assert.deepEqual({ ...p.record.gasDeposit }, { to: SPONSOR, valueWei: "28800000000000000", data: p.giftId, chainId: 10143, txHash: null });
  assert.equal(isStorableLinkRecord(p.record), true);
  assert.ok(!JSON.stringify(p.record).includes(p.fragment.token));
});
await check("UNKNOWN fee inputs / no gas input / zero budget => REFUSED (never a default amount)", async () => {
  assert.equal((await base({ gas: { gasUnits: GAS.gasUnits, safety: GAS.safety }, sponsor: SP })).reason, "gas_budget_unknown");
  assert.equal((await base({ sponsor: SP })).reason, "gas_budget_unknown");
  assert.equal((await base({ gas: { gasUnits: GAS.gasUnits, feeInputs: { maxFeePerGasWei: 0n, source: "x" }, safety: GAS.safety }, sponsor: SP })).ok, false);
  assert.equal(planGiftGasDeposit({ gasBudget: { status: "ESTIMATE", costWei: 0n }, sponsorAddress: SPONSOR, chainId: 143 }).reason, "gas_budget_unknown");
  assert.equal(planGiftGasDeposit({ gasBudget: { status: "UNKNOWN", costWei: null }, sponsorAddress: SPONSOR, chainId: 143 }).reason, "gas_budget_unknown");
  assert.equal(planGiftGasDeposit({}).reason, "gas_budget_unknown");
});
await check("budget must cover install + commit + revoke + claim: a budget without install or revoke is UNKNOWN => refused", async () => {
  for (const drop of ["install", "revoke", "commitClaim", "claim"]) {
    const { [drop]: _x, ...rest } = GAS.gasUnits;
    const r = await base({ gas: { ...GAS, gasUnits: rest }, sponsor: SP });
    assert.equal(r.ok, false, drop);
    if (drop === "install" || drop === "revoke") assert.equal(r.reason, "gas_budget_unknown", drop);
  }
});
await check("sponsor address / chain must be valid; zero address and chain 0/1 refused", async () => {
  const b = (await base({ gas: GAS })).gasBudget;
  for (const sponsorAddress of [undefined, "", "0x123", `0x${"0".repeat(40)}`, "nope"]) assert.equal(planGiftGasDeposit({ gasBudget: b, sponsorAddress, chainId: 143 }).reason, "sponsor_address_invalid");
  for (const chainId of [0, 1, 10144, "143", undefined]) assert.equal(planGiftGasDeposit({ gasBudget: b, sponsorAddress: SPONSOR, chainId }).reason, "sponsor_chain_invalid");
  assert.equal(planGiftGasDeposit({ gasBudget: b, sponsorAddress: SPONSOR, chainId: 143 }).ok, true);
});
await check("without `sponsor` the plan is the legacy plan: gasDeposit null, record has no gasDeposit", async () => {
  const p = await base({ gas: GAS });
  assert.equal(p.gasDeposit, null);
  assert.equal("gasDeposit" in p.record, false);
});
await check("ONE step, fixed order approve -> create -> gas_deposit; payees are only token, escrow, sponsor (recipient gets 0 MON)", async () => {
  const p = await base({ gas: GAS, sponsor: SP });
  const s = buildGiftCreateStepCalls(p, { escrowAddress: ESCROW });
  assert.equal(s.ok, true, s.reason);
  assert.deepEqual(s.calls.map((c) => c.label), ["approve", "create", "gas_deposit"]);
  const usdc = FUNDING_CONTEXT_TOKEN_ALLOWLIST[CHAIN].USDC.assetId;
  assert.equal(s.calls[0].to.toLowerCase(), usdc.toLowerCase());
  assert.equal(s.calls[1].to, ESCROW);
  assert.equal(s.calls[2].to, SPONSOR);
  assert.deepEqual(s.calls.map((c) => c.value), [0n, 0n, p.gasBudget.costWei]);
  assert.ok(s.calls.every((c) => c.to.toLowerCase() !== RECIPIENT.toLowerCase()));
  const ap = decodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns (bool)"]), data: s.calls[0].data });
  assert.equal(ap.args[0], ESCROW); assert.equal(ap.args[1], BigInt(p.escrowCreateArgs.amount));
  const cr = decodeFunctionData({ abi: parseAbi(["function create(bytes32,address,uint256,uint64,bytes32)"]), data: s.calls[1].data });
  assert.equal(cr.args[0], p.giftId); assert.equal(cr.args[2], BigInt(p.escrowCreateArgs.amount)); assert.equal(cr.args[4], p.escrowCreateArgs.claimTokenHash);
  assert.equal(s.calls[2].data, p.giftId); // a tag the relayer's G10 can find; an EOA ignores calldata
  assert.equal(Object.isFrozen(s.calls), true);
});
await check("step refused without a sponsor plan or without an escrow address", async () => {
  const legacy = await base({ gas: GAS });
  assert.equal(buildGiftCreateStepCalls(legacy, { escrowAddress: ESCROW }).reason, "gas_budget_unknown");
  const p = await base({ gas: GAS, sponsor: SP });
  for (const escrowAddress of [undefined, "0x1", `0x${"0".repeat(40)}`]) assert.equal(buildGiftCreateStepCalls(p, { escrowAddress }).reason, "escrow_address_invalid");
});
await check("link only when EVERY call confirmed; failed deposit => gas_deposit_unconfirmed; deposit hash recorded", async () => {
  const p = await base({ gas: GAS, sponsor: SP });
  const ok = (h) => ({ status: "success", hash: H(h) });
  const good = confirmGiftCreateStep(p, [ok("1"), ok("2"), ok("3")]);
  assert.equal(good.ok, true);
  assert.equal(good.record.gasDeposit.txHash, H("3"));
  assert.equal(p.record.gasDeposit.txHash, null); // input not mutated
  assert.equal(confirmGiftCreateStep(p, [ok("1"), ok("2"), { status: "reverted", hash: H("3") }]).reason, "gas_deposit_unconfirmed");
  assert.equal(confirmGiftCreateStep(p, [ok("1"), ok("2"), { status: "success", hash: "0x12" }]).reason, "gas_deposit_unconfirmed");
  assert.equal(confirmGiftCreateStep(p, [ok("1"), { status: "reverted", hash: H("2") }, ok("3")]).reason, "create_unconfirmed");
  assert.equal(confirmGiftCreateStep(p, [ok("1"), ok("2")]).reason, "create_step_incomplete");
  assert.equal(confirmGiftCreateStep(await base({ gas: GAS }), [ok("1"), ok("2"), ok("3")]).reason, "gas_budget_unknown");
});
await check("registration (Cowork c): exactly {action,giftId,gasTx}; 200 registered -> ok; same hash again ok; 409 -> refused (not retried); offline/5xx/garbage -> pending + retry; never throws", async () => {
  const p = await base({ gas: GAS, sponsor: SP });
  const ok = (h) => ({ status: "success", hash: H(h) });
  const rec = confirmGiftCreateStep(p, [ok("1"), ok("2"), ok("3")]).record;
  assert.equal(needsGasRegistration(p.record), false);      // no tx hash yet
  assert.equal(buildGasTxRegistration(p.record), null);
  assert.deepEqual({ ...buildGasTxRegistration(rec) }, { action: "register_gas_tx", giftId: p.giftId, gasTx: H("3") });
  assert.deepEqual(Object.keys(buildGasTxRegistration(rec)), ["action", "giftId", "gasTx"]);
  const seen = [];
  const good = { register: async (b) => { seen.push(b); return { status: 200, body: { ok: true, registered: true, already: false, giftId: p.giftId } }; } };
  const r1 = await registerGasDeposit({ record: rec, client: good });
  assert.equal(r1.ok, true); assert.equal(r1.record.gasDeposit.registered, true); assert.equal(needsGasRegistration(r1.record), false);
  assert.equal(rec.gasDeposit.registered, undefined);        // input untouched
  assert.equal((await registerGasDeposit({ record: r1.record, client: good })).reason, "nothing_to_register"); // done: no second call
  assert.equal(seen.length, 1);
  const refused = await registerGasDeposit({ record: rec, client: { register: async () => ({ status: 409, body: { ok: false, error: "not_available" } }) } });
  assert.equal(refused.ok, false); assert.equal(refused.retry, false); assert.equal(needsGasRegistration(refused.record), false);
  for (const client of [{ register: async () => { throw new Error("offline"); } }, { register: async () => ({ status: 503, body: { ok: false } }) }, { register: async () => ({ status: 200, body: { ok: true, registered: true, giftId: H("9") } }) }, { register: async () => null }, null, {}]) {
    const r = await registerGasDeposit({ record: rec, client });
    assert.equal(r.ok, false); assert.equal(r.retry, true); assert.equal(needsGasRegistration(r.record), true);
  }
});
await check("planGiftSend forwards the sponsor: UNKNOWN budget refuses the whole send plan", async () => {
  const opened = openGiftSend({ payer: { id: "p1", name: "Honeybun", address: SENDER }, chainScope: CHAIN });
  const draft = { ...(opened.draft || {}), preset: 20, front: "01", to: "A", message: "hi", from: "B", payer: { id: "p1", name: "Honeybun", address: SENDER }, chainScope: CHAIN };
  const ok = await planGiftSend({ draft, senderAddress: SENDER, expiry: EXPIRY, gas: GAS, sponsor: SP, origin: "https://araso.app" });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.gasDeposit.value, ok.gasBudget.costWei);
  const noFee = await planGiftSend({ draft, senderAddress: SENDER, expiry: EXPIRY, gas: { gasUnits: GAS.gasUnits, safety: GAS.safety }, sponsor: SP });
  assert.equal(noFee.reason, "gas_budget_unknown");
});
await check("scope: the sponsor address is injected (no hard-coded sponsor/amount in the planner), no new UI copy, no main.js wiring", () => {
  const plan = readFileSync(new URL("../src/gift-create-plan.js", import.meta.url), "utf8");
  assert.ok(!plan.includes(SPONSOR));
  assert.ok(!/\b(?:ether|parseEther|gwei)\b/i.test(plan.replace(/\/\/.*$/gm, "")));
  const paper = readFileSync(new URL("../src/gift-send-paper.js", import.meta.url), "utf8");
  assert.ok(!/gas_deposit|gasDeposit/.test(paper.slice(paper.indexOf("[A-898 MARKUP]"))));
  assert.ok(GIFT_SPONSOR_PINS.delegationManager);
});
console.log(`\nA-913 sender gas -> sponsor: ${pass} PASS${fail ? ` · ${fail} FAIL` : ""}`);
process.exit(fail ? 1 : 0);
