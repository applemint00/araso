// [A-915] main.js wiring of the Gift create step on Monad 143: one signer session, three exact calls through the one chokepoint,
// registerGasDeposit right after create, retry on the next open, live OFF. The main.js A-915 blocks are cut out and run in a vm with stubs.
//   node app/test/a915-create-wiring.mjs      (no network, no tx)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, keccak256, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { GIFT_CREATE_CHAIN_ID, buildGiftCreateStepCalls, confirmGiftCreateStep, giftCreateConfigProblem, needsGasRegistration, registerGasDeposit, disarmAllGiftCreateSteps } from "../src/gift-create-plan.js";
import { preparedSignProblem } from "../src/money-executor.js";
import { planGiftSend, openGiftSend, giftSendReduce, lockQuote, runGiftCreateCalls } from "../src/gift-send-paper.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.join(HERE, "..", "src", "main.js"), "utf8");
let pass = 0; let fail = 0;
async function check(label, fn) { disarmAllGiftCreateSteps(); try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const a = MAIN.indexOf("// ── [A-915] Gift create on Monad mainnet"); const b = MAIN.indexOf("// ── [A-915] end ──");
assert.ok(a > 0 && b > a, "A-915 block present");
const BLOCK = MAIN.slice(a, b);
const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c";   // ARBITRARY TEST FIXTURE - not a deployed escrow
const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const sender = privateKeyToAccount(generatePrivateKey());
const PAYER = { id: "p-1", name: "Honeybun", address: sender.address };
// ARBITRARY TEST FIXTURES - not measured gas, not a fee, not a product amount.
const GAS = Object.freeze({ gasUnits: { install: 50_000n, commitClaim: 50_000n, revoke: 50_000n, claim: 80_000n, fundingTransfer: 10_000n }, feeInputs: { maxFeePerGasWei: 100_000_000_000n, source: "test-fixture" }, safety: { bufferBps: 2000 } });
const NOW_S = Math.floor(Date.now() / 1000);
const draft = () => { let d = openGiftSend({ piggy: PAYER, selected: PAYER, chainScope: "monad-mainnet" }).draft; d = giftSendReduce(d, { type: "set_preset", preset: 20 }); return giftSendReduce(d, { type: "pick_front", front: "01" }); };
const ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function create(bytes32 giftId, address token, uint256 amount, uint64 expiry, bytes32 claimTokenHash)"]);

const settle = () => new Promise((r) => setTimeout(r, 0));
function makeStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, _m: m }; }
// fake 143 clients: the "chain" mines whatever is broadcast; receipts are success unless `revert` names the call index
function fakeChain({ revertIndex = -1, tamper = null } = {}) {
  const log = { prepared: [], signed: [], sent: [], waited: [] };
  const walletClient = { prepareTransactionRequest: async ({ account: _a, ...tx }) => {
    const p = { chainId: 143, type: "eip1559", nonce: log.prepared.length, gas: 120_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, ...tx };
    const out = tamper ? tamper(p, log.prepared.length) : p; log.prepared.push(out); return out; } };
  const account = (acct) => ({ address: acct.address, signTransaction: async (t) => { const raw = `0x02${String(log.signed.length + 1).padStart(2, "0")}${"ab".repeat(20)}`; log.signed.push({ t, raw }); return raw; } });
  const publicClient = { sendRawTransaction: async ({ serializedTransaction }) => { log.sent.push(serializedTransaction); return keccak256(serializedTransaction); },
    waitForTransactionReceipt: async ({ hash }) => { log.waited.push(hash); const i = log.sent.map((r) => keccak256(r)).indexOf(hash); return { status: i === revertIndex ? "reverted" : "success" }; } };
  return { log, walletClient, publicClient, account };
}

// loads the A-915 block with a config and the page-level names it reads (activeAccount · activeSession · state · localStorage · fetch)
function load({ cfg, chain = fakeChain(), appLock = false, account = true, client = undefined, storage = makeStorage() } = {}) {
  const wrapped = chain.account(sender);
  const ctx = { A915_CFG_INPUT: cfg === undefined ? null : (cfg && { ...cfg, makeClients: cfg.makeClients ?? (() => ({ walletClient: chain.walletClient, publicClient: chain.publicClient })), ...(client ? { client } : {}) }),
    activeAccount: account ? wrapped : null, activeSession: account ? {} : null, state: { appLock }, localStorage: storage, fetch: async () => { throw new Error("network forbidden"); },
    GIFT_CREATE_CHAIN_ID, giftCreateConfigProblem, buildGiftCreateStepCalls, confirmGiftCreateStep, needsGasRegistration, registerGasDeposit, runGiftCreateCalls };
  const code = BLOCK.replace("const A915_GIFT_CREATE_CONFIG = null;", "const A915_GIFT_CREATE_CONFIG = A915_CFG_INPUT;");
  assert.notEqual(code, BLOCK, "config line replaced");
  const api = new Function(...Object.keys(ctx), `${code}\nreturn { a915Cfg, a915PreFaceIdRefusal, a915PlanExtras, a915GiftCreateExecutor, a915RetryGasRegistrations, a915StoreRead };`)(...Object.values(ctx));
  return { api, chain, storage, ctx };
}
const CFG = (o = {}) => ({ chainId: GIFT_CREATE_CHAIN_ID, escrowAddress: ESCROW, sponsorAddress: SPONSOR, gas: GAS, giftExpiryUnix: () => NOW_S + 7 * 24 * 3600, receiptTimeoutMs: 1000, ...o });
const okReg = (calls) => ({ register: async (body) => { calls.push(body); return { status: 200, body: { ok: true, registered: true, giftId: body.giftId } }; } });
async function plan(api) { const p = await planGiftSend({ draft: draft(), senderAddress: sender.address, expiry: undefined, gas: null, origin: "https://araso.app", ...api.a915PlanExtras() }); return p; }

await check("W1 source: marker blocks, live config OFF, // comments only, no direct send API, no chain-id literal, imports from the two modules only", () => {
  assert.match(BLOCK, /^\/\/ ── \[A-915\] Gift create on Monad mainnet/);
  assert.match(BLOCK, /\nconst A915_GIFT_CREATE_CONFIG = null;\n/);
  assert.equal(/\/\*|\*\//.test(BLOCK), false);
  assert.equal(/sendTransaction|sendRawTransaction|signTransaction|writeContract|\.send\(/.test(BLOCK), false, "every broadcast goes through executeMoneyStep");
  assert.equal(/maxUint|MaxUint|0xffffffff/i.test(BLOCK), false);
  assert.equal(/0x[0-9a-fA-F]{40}/.test(BLOCK), false, "no address literal (escrow stays UNKNOWN)");
  assert.match(MAIN, /import \{ GIFT_CREATE_CHAIN_ID, buildGiftCreateStepCalls, confirmGiftCreateStep, giftCreateConfigProblem, needsGasRegistration, registerGasDeposit \} from "\.\/gift-create-plan\.js";/);
  assert.match(MAIN, /import \{ runGiftCreateCalls \} from "\.\/gift-send-paper\.js";/);
  assert.ok(BLOCK.includes("buildGiftCreateStepCalls(") && BLOCK.includes("runGiftCreateCalls(") && BLOCK.includes("registerGasDeposit(") && BLOCK.includes("needsGasRegistration("));
  // main.js keeps the guards other suites pin (a653 N16 / a763 H1 / a791 M7): no mainnet chain id or scope literal, and it never names the money chokepoint or imports money-executor for sending
  assert.equal((MAIN.match(/\b143\b/g) || []).length, 0); assert.equal((MAIN.match(/["'`]monad-mainnet["'`]/g) || []).length, 0);
  assert.equal(/executeMoneyStep|TRANSPORT_KIND/.test(MAIN), false);
});
await check("W2 a898FaceId hooks: typeof-guarded, before faceid_start, executor fallback keeps GIFT_SEND_CONFIG.executor, plan extras last", () => {
  const f = MAIN.slice(MAIN.indexOf("async function a898FaceId() {"), MAIN.indexOf("async function a898Act("));
  assert.ok(f.indexOf("a915PreFaceIdRefusal") > 0 && f.indexOf("a915PreFaceIdRefusal") < f.indexOf('type: "faceid_start"'));
  assert.ok(f.indexOf("a898SignerForPayer(piggy") > f.indexOf('type: "faceid_start"')); // [A-1298] now with { fresh: true } (a money Send asks Face ID)
  assert.match(f, /typeof a915PreFaceIdRefusal === "function"/); assert.match(f, /typeof a915GiftCreateExecutor === "function"/); assert.match(f, /typeof a915PlanExtras === "function"/);
  assert.match(f, /const executor = GIFT_SEND_CONFIG\.executor \|\| \(typeof a915GiftCreateExecutor/);
  assert.match(f, /origin: location\.origin, \.\.\.\(typeof a915PlanExtras === "function" \? a915PlanExtras\(\) : \{\}\) \}\)/);
  // [A-1360 RE-PIN · Owner 15:4x "열린 동안 보내기 승인만"] the finally still ends a signer made for another payer; the device Piggy's key stays open
  assert.ok(/finally\s*\{[^}]*if \(String\(piggy\.address\)\.toLowerCase\(\) !== String\(state\.address \|\| ""\)\.toLowerCase\(\)\) endSignerSession\(\);\s*refreshHomePaperMount\(\);/.test(f), "another payer's signer still ends");
});
await check("W3 OFF (config null): no executor, no plan extras, no refusal, nothing stored, retry is a no-op", async () => {
  const { api, storage } = load({ cfg: null });
  assert.equal(api.a915Cfg(), null); assert.equal(api.a915GiftCreateExecutor(), null); assert.deepEqual(api.a915PlanExtras(), {}); assert.equal(api.a915PreFaceIdRefusal(), null);
  await api.a915RetryGasRegistrations(); assert.equal(storage._m.size, 0);
});
await check("W4 turned on but unusable => refused BEFORE Face ID (escrow unset / malformed / zero, sponsor unset, deadline passed, clients missing)", () => {
  const why = (o) => load({ cfg: CFG(o) }).api.a915PreFaceIdRefusal();
  assert.equal(why({ escrowAddress: undefined }), "escrow_address_invalid");
  assert.equal(why({ escrowAddress: "0x1234" }), "escrow_address_invalid");
  assert.equal(why({ escrowAddress: `0x${"0".repeat(40)}` }), "escrow_address_invalid");
  assert.equal(why({ sponsorAddress: undefined }), "sponsor_address_invalid");
  assert.equal(why({ giftExpiryUnix: () => NOW_S - 1 }), "bad_expiry");
  assert.equal(why({ giftExpiryUnix: () => NaN }), "bad_expiry");
  assert.equal(why({ receiptTimeoutMs: 0 }), "executor_unavailable");
  assert.equal(why({ chainId: 10143 }), "executor_unavailable");
  assert.equal(why({ chainId: undefined }), "executor_unavailable");
  assert.equal(why({}), null);
  assert.equal(load({ cfg: CFG({ escrowAddress: undefined }) }).api.a915GiftCreateExecutor(), null, "no executor for a bad config");
});
await check("W5 happy path: ONE signer session, approve -> create -> gas deposit in order, then register letter hash, link issued", async () => {
  const regs = []; const { api, chain, storage } = load({ cfg: CFG(), client: okReg(regs) });
  const p = await plan(api); assert.equal(p.ok, true, p.reason);
  assert.ok(p.gasDeposit && p.gasDeposit.chainId === 143 && p.gasDeposit.to === SPONSOR);
  const r = await api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER });
  assert.deepEqual({ ok: r.ok, link: r.link }, { ok: true, link: p.claimUrl });
  assert.equal(chain.log.signed.length, 3); assert.equal(chain.log.sent.length, 3);
  const [ap, cr, dp] = chain.log.prepared;
  assert.equal(ap.to.toLowerCase(), p.escrowCreateArgs.token.toLowerCase()); const dap = decodeFunctionData({ abi: ABI, data: ap.data });
  assert.equal(dap.functionName, "approve"); assert.equal(dap.args[0].toLowerCase(), ESCROW.toLowerCase()); assert.equal(dap.args[1], BigInt(p.escrowCreateArgs.amount)); assert.notEqual(dap.args[1], maxUint256);
  assert.equal(cr.to.toLowerCase(), ESCROW.toLowerCase()); const dcr = decodeFunctionData({ abi: ABI, data: cr.data }); assert.equal(dcr.functionName, "create"); assert.equal(dcr.args[0], p.giftId);
  assert.equal(dp.to.toLowerCase(), SPONSOR.toLowerCase()); assert.equal(dp.data, p.giftId); assert.equal(dp.value, p.gasDeposit.value);
  assert.equal(regs.length, 1); assert.deepEqual(Object.keys(regs[0]), ["action", "giftId", "gasTx", "note", "letterHash"]);
  assert.equal(regs[0].action, "register_gas_tx"); assert.equal(regs[0].giftId, p.giftId); assert.equal(regs[0].gasTx, keccak256(chain.log.sent[2]));
  assert.equal(regs[0].note, p.record.note); assert.equal(regs[0].letterHash, p.record.letterHash);
  const st = api.a915StoreRead(); assert.equal(st.length, 1); assert.equal(st[0].gasDeposit.registered, true); assert.equal(st[0].gasDeposit.txHash, regs[0].gasTx);
  assert.equal(st[0].note, p.record.note); assert.equal(st[0].letterHash, p.record.letterHash);
  const raw = [...storage._m.values()].join(""); assert.equal(raw.includes(p.fragment.token), false, "claim token never stored");
  // after the step every shape is closed again
  for (const c of buildGiftCreateStepCalls(p, { escrowAddress: ESCROW }).calls) assert.equal(preparedSignProblem({ chainId: 143, type: "eip1559", nonce: 1, gas: 100_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n, to: c.to, data: c.data, value: c.value }), "chain_id_mismatch", `${c.label} closed after the step`);
});
await check("W6 registration failure keeps the link, stays in the sender's record, and is retried on the next open (200 -> done; no more retries)", async () => {
  const storage = makeStorage(); const bad = { register: async () => ({ status: 503, body: null }) };
  const first = load({ cfg: CFG(), client: bad, storage });
  const p = await plan(first.api); const r = await first.api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER });
  assert.equal(r.ok, true, "the Gift link is still issued");
  assert.equal(first.api.a915StoreRead()[0].gasDeposit.registered, undefined); assert.equal(needsGasRegistration({ giftId: p.giftId, gasDeposit: first.api.a915StoreRead()[0].gasDeposit }), true);
  const throwing = load({ cfg: CFG(), client: { register: async () => { throw new Error("offline"); } }, storage }); await settle();
  assert.equal(throwing.api.a915StoreRead()[0].gasDeposit.registered, undefined, "offline: still pending");
  const regs = []; const next = load({ cfg: CFG(), client: okReg(regs), storage }); await settle(); // loading the block already runs the next-open retry once
  assert.equal(regs.length, 1); assert.equal(regs[0].giftId, p.giftId); assert.equal(next.api.a915StoreRead()[0].gasDeposit.registered, true);
  const again = []; const after = load({ cfg: CFG(), client: okReg(again), storage }); await settle(); await after.api.a915RetryGasRegistrations(); assert.equal(again.length, 0, "registered once, never again");
});
await check("W7 a 409 refusal is kept as registerRefused and never retried (fail closed: the claim will 409)", async () => {
  const storage = makeStorage(); const refuse = { register: async () => ({ status: 409, body: { ok: false } }) };
  const first = load({ cfg: CFG(), client: refuse, storage }); const p = await plan(first.api);
  assert.equal((await first.api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER })).ok, true);
  assert.equal(first.api.a915StoreRead()[0].gasDeposit.registerRefused, true);
  const calls = []; const next = load({ cfg: CFG(), client: okReg(calls), storage }); await settle(); await next.api.a915RetryGasRegistrations(); assert.equal(calls.length, 0);
});
await check("W8 approve reverts => create and deposit are never signed, no link, no registration", async () => {
  const regs = []; const { api, chain } = load({ cfg: CFG(), chain: fakeChain({ revertIndex: 0 }), client: okReg(regs) });
  const p = await plan(api); const r = await api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER });
  assert.equal(r.ok, false); assert.equal(r.reason, "create_unconfirmed"); assert.equal(chain.log.signed.length, 1); assert.equal(regs.length, 0); assert.equal(r.link, undefined);
});
await check("W9 deposit reverts => gas_deposit_unconfirmed, NO link, nothing registered", async () => {
  const regs = []; const { api, chain } = load({ cfg: CFG(), chain: fakeChain({ revertIndex: 2 }), client: okReg(regs) });
  const p = await plan(api); const r = await api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER });
  assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: "gas_deposit_unconfirmed" }); assert.equal(chain.log.signed.length, 3); assert.equal(regs.length, 0);
});
await check("W10 the guard stops a drifted call BEFORE the signer: a prepare that changes the deposit value signs nothing for that call", async () => {
  const regs = []; const chain = fakeChain({ tamper: (p, i) => (i === 2 ? { ...p, value: p.value + 1n } : p) });
  const { api } = load({ cfg: CFG(), chain, client: okReg(regs) });
  const p = await plan(api); const r = await api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER });
  assert.equal(r.ok, false); assert.equal(chain.log.signed.length, 2, "approve + create only"); assert.equal(regs.length, 0); assert.equal(r.link, undefined);
  const evil = fakeChain({ tamper: (p, i) => (i === 0 ? { ...p, data: p.data.replace(/[0-9a-f]{64}$/, "f".repeat(64)) } : p) });
  const e = load({ cfg: CFG(), chain: evil, client: okReg([]) }); const p2 = await plan(e.api); const r2 = await e.api.a915GiftCreateExecutor()({ plan: p2, lock: {}, payer: PAYER });
  assert.equal(r2.ok, false); assert.equal(evil.log.signed.length, 0, "a max-uint approve never reaches the signer");
});
await check("W11 signer mismatch / no signer / app locked / plan without sponsor or link => executor_unavailable, signer untouched", async () => {
  const { api, chain } = load({ cfg: CFG() }); const p = await plan(api); const run = api.a915GiftCreateExecutor();
  assert.equal((await run({ plan: p, lock: {}, payer: { ...PAYER, address: "0x00000000000000000000000000000000000000c3" } })).reason, "executor_unavailable");
  const locked = load({ cfg: CFG(), appLock: true }); assert.equal((await locked.api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER })).reason, "executor_unavailable");
  const none = load({ cfg: CFG(), account: false }); assert.equal((await none.api.a915GiftCreateExecutor()({ plan: p, lock: {}, payer: PAYER })).reason, "executor_unavailable");
  const noSponsor = await planGiftSend({ draft: draft(), senderAddress: sender.address, expiry: NOW_S + 86400, gas: GAS, origin: "https://araso.app" });
  assert.equal((await run({ plan: noSponsor, lock: {}, payer: PAYER })).ok, false);
  const noLink = { ...p, claimUrl: null }; assert.equal((await run({ plan: noLink, lock: {}, payer: PAYER })).reason, "executor_unavailable");
  assert.equal(chain.log.signed.length, 0);
});
await check("W12 plan extras: expiry + pinned sponsor on 143 + gas inputs; UNKNOWN fee inputs => plan refused (no default amount)", async () => {
  const { api } = load({ cfg: CFG() }); const x = api.a915PlanExtras();
  assert.deepEqual(Object.keys(x).sort(), ["expiry", "gas", "sponsor"]); assert.deepEqual(x.sponsor, { sponsorAddress: SPONSOR, chainId: 143 });
  const unknown = load({ cfg: CFG({ gas: { gasUnits: GAS.gasUnits, safety: GAS.safety } }) }).api;
  const p = await plan(unknown); assert.equal(p.ok, false); assert.equal(p.reason, "gas_budget_unknown");
  const fn = load({ cfg: CFG({ gas: () => GAS }) }).api; assert.equal((await plan(fn)).ok, true);
});
await check("W13 a898FaceId integration (real code cut): OFF = unchanged; turned on + bad config = 'unavailable' before the signer; turned on + good = executor gets the sponsor plan", async () => {
  const code = MAIN.slice(MAIN.indexOf("async function a898FaceId() {"), MAIN.indexOf("async function a898Act("));
  const run = async ({ cfg, executorOnly = false }) => {
    const L = load({ cfg });
    const d0 = draft(); const state = { giftSend: d0, selectedPiggy: PAYER }; let signerCalls = 0; let ended = 0; let got = null;
    const evaluation = { faceIdLine: { exact: true, parts: { usd: "20", monIn: null, feeUsd: "0.1" }, text: "x" }, canFaceId: true, payWith: "usdc", preset: 20, quoteAtMs: 1 };
    const ctx = { state, endSignerSession: () => { ended += 1; }, refreshHomePaperMount() {}, location: { origin: "https://araso.app" }, giftSendReduce, lockQuote, reconcileQuote: () => ({ ok: true }), planGiftSend,
      a898Evaluate: () => evaluation, a898RegistryPiggy: () => PAYER, a898RefreshMarket: async () => {}, a898ForgetDraft() {},
      GIFT_SEND_CONFIG: { executor: null, gas: null }, a898SignerForPayer: async () => { signerCalls += 1; return { ok: true, signerAddress: PAYER.address }; },
      a915PreFaceIdRefusal: L.api.a915PreFaceIdRefusal, a915PlanExtras: L.api.a915PlanExtras,
      a915GiftCreateExecutor: () => (L.api.a915GiftCreateExecutor() ? async (args) => { got = args; return { ok: true, link: "https://araso.app/claim#x" }; } : null) };
    await new Function(...Object.keys(ctx), `${code}; return a898FaceId;`)(...Object.values(ctx))();
    return { state, signerCalls, ended, got };
  };
  const off = await run({ cfg: null }); assert.equal(off.signerCalls, 1); assert.equal(off.state.giftSend.stage, "unavailable"); assert.equal(off.state.giftSend.refusal, "executor_unavailable"); assert.equal(off.got, null);
  const bad = await run({ cfg: CFG({ escrowAddress: undefined }) }); assert.equal(bad.signerCalls, 0, "refused before Face ID"); assert.equal(bad.ended, 0); assert.equal(bad.state.giftSend.stage, "unavailable"); assert.equal(bad.state.giftSend.refusal, "escrow_address_invalid");
  const on = await run({ cfg: CFG() }); assert.equal(on.signerCalls, 1); assert.equal(on.ended, 1); assert.equal(on.state.giftSend.stage, "done");
  assert.equal(on.got.plan.ok, true); assert.equal(on.got.plan.gasDeposit.chainId, 143); assert.equal(on.got.plan.gasDeposit.to, SPONSOR); assert.equal(on.got.plan.escrowCreateArgs.expiry > NOW_S, true);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
