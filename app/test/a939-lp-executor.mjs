// [A-939] LP executor model (mainnet-job-lp.js): calldata byte-equal to the A-808 fork harness encoding, every refusal path, the gate never
// allows, readiness never ready, constants = the A-808 run record. Node only, no network, no tx.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import * as LP from "../src/mainnet-job-lp.js";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-939 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIGGY = "0x8e2839f8000000000000000000000000000c8c29"; // lowercase fixture (viem rejects a mixed-case non-checksum address)
// The harness's own ABI strings (a808-lp-fork.mjs :47 · :51 · :65), copied verbatim — encoding with these is the harness encoding.
const H_ERC20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const H_ADD = parseAbi(["function add_liquidity(uint256[] amounts,uint256 min_mint_amount,address receiver) returns (uint256)"]);
const H_RM1 = parseAbi(["function remove_liquidity_one_coin(uint256 burn,int128 i,uint256 min_received,address receiver) returns (uint256)"]);
const POOL = LP.LP_FORK_EVIDENCE.pool, USDC = LP.LP_FORK_EVIDENCE.coins[1].address;
const M = LP.LP_FORK_EVIDENCE.measured;
const call = (step, args) => { const r = LP.encodeLpStep(step, { piggyAddress: PIGGY, ...args }); assert.equal(r.error, null, r.error); return r.call; };

check("approve exact == harness approveExact(USDC → pool, 10e6)", () => { const c = call("approve", { amountRaw: "10000000" }); assert.equal(c.to, USDC); assert.equal(c.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [POOL, 10000000n] })); });
check("add_liquidity == harness ([0,10e6,0], calc×0.999, receiver)", () => {
  const c = call("addLiquidity", { amountRaw: "10000000", previewLpRaw: M.previewLpRaw });
  const min = (BigInt(M.previewLpRaw) * 999n) / 1000n;
  assert.equal(c.to, POOL); assert.equal(c.minLpRaw, min.toString());
  assert.equal(c.data, encodeFunctionData({ abi: H_ADD, functionName: "add_liquidity", args: [[0n, 10000000n, 0n], min, PIGGY] }));
  assert.equal(c.data.slice(0, 10), "0xa7256d09");
});
check("exit half == harness remove_liquidity_one_coin(LP/2, 1, calc×0.999, receiver)", () => {
  const c = call("exitHalf", { heldLpRaw: M.realizedLpRaw, previewUsdcRaw: "4999753" });
  const burn = BigInt(M.realizedLpRaw) / 2n, min = (4999753n * 999n) / 1000n;
  assert.equal(c.burnLpRaw, burn.toString());
  assert.equal(c.data, encodeFunctionData({ abi: H_RM1, functionName: "remove_liquidity_one_coin", args: [burn, 1n, min, PIGGY] }));
  assert.equal(c.data.slice(0, 10), "0x081579a5");
});
check("exit rest burns the whole measured remainder", () => { const c = call("exitRest", { heldLpRaw: "4669809397694629244", previewUsdcRaw: "4999753" }); assert.equal(c.burnLpRaw, "4669809397694629244"); assert.equal(c.data, encodeFunctionData({ abi: H_RM1, functionName: "remove_liquidity_one_coin", args: [4669809397694629244n, 1n, (4999753n * 999n) / 1000n, PIGGY] })); });
check("revoke == harness approve(pool, 0)", () => { const c = call("revoke", {}); assert.equal(c.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [POOL, 0n] })); });
check("never unlimited: approve amount is exactly the request", () => { const c = call("approve", { amountRaw: "5000000" }); assert.equal(c.amountRaw, "5000000"); assert.ok(!c.data.endsWith("f".repeat(64))); });
const refuse = [
  ["approve", { amountRaw: "10000001" }, "amount_above_fork_proven_size"],
  ["approve", { amountRaw: "0" }, "amount_not_exact"],
  ["approve", { amountRaw: "1.5" }, "amount_not_exact"],
  ["addLiquidity", { amountRaw: "10000000" }, "lp_preview_not_measured"],
  ["exitHalf", { previewUsdcRaw: "1" }, "lp_not_measured"],
  ["exitHalf", { heldLpRaw: M.realizedLpRaw }, "usdc_preview_not_measured"],
  ["exitRest", { heldLpRaw: (BigInt(M.realizedLpRaw) + 1n).toString(), previewUsdcRaw: "1" }, "lp_above_fork_proven_position"],
  ["exitOtherCoin", {}, "unproven_step:exitOtherCoin"],
  ["addAboveForkSize", {}, "unproven_step:addAboveForkSize"],
  ["swap", {}, "unknown_step"],
];
for (const [step, args, want] of refuse) check(`refuse ${step} ${JSON.stringify(args)} → ${want}`, () => assert.equal(LP.encodeLpStep(step, { piggyAddress: PIGGY, ...args }).error, want));
check("refuse a missing / bad Piggy address", () => { assert.equal(LP.encodeLpStep("approve", { amountRaw: "1" }).error, "missing_piggy_address"); assert.equal(LP.encodeLpStep("approve", { amountRaw: "1", piggyAddress: ["0x" + "1".repeat(40)] }).error, "missing_piggy_address"); });
check("stage machine: only fork-proven transitions", () => {
  let s = LP.LP_STAGE.NONE;
  for (const step of ["approve", "addLiquidity", "exitHalf", "exitRest", "revoke"]) { const r = LP.lpStageAfter(s, step); assert.equal(r.error, null, `${step}: ${r.error}`); s = r.stage; }
  assert.equal(s, LP.LP_STAGE.REVOKED);
  assert.equal(LP.lpStageAfter(LP.LP_STAGE.NONE, "exitHalf").error, "step_not_valid_from_stage");
});
const liveProfile = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", jobId: LP.LP_JOB_ID, liveExecution: true, usdc: { symbol: "USDC", address: USDC, decimals: 6 } };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110874000, send: () => {}, receipt: () => {} };
check("gate never allows: live profile refused, local fork executor still refused (unknown fields / not wired)", () => {
  assert.equal(LP.lpExecutionGate({ profile: liveProfile, piggy: { id: "p", address: PIGGY }, executor: forkExec, step: "approve" }).allowed, false);
  const offProfile = { ...liveProfile, liveExecution: false };
  const g = LP.lpExecutionGate({ profile: offProfile, piggy: { id: "p", address: PIGGY }, executor: forkExec, step: "approve" });
  assert.equal(g.allowed, false); assert.ok(g.reason.length > 0);
});
check("readiness never ready / executable / live, fork review conditions listed open", () => { const r = LP.lpReadiness({ stage: "exited", profile: liveProfile, executor: forkExec }); assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.liveExecution, false); assert.ok(r.blockedBy.includes("fork_review_conditions_open")); });
check("header keeps the 9 A-808 review conditions OPEN", () => { const src = readFileSync(path.join(HERE, "..", "src", "mainnet-job-lp.js"), "utf8"); assert.equal((src.match(/^\/\/ {3}\[ \] [1-9] /gm) || []).length, 9); assert.ok(!/\[x\]/i.test(src)); });
check("module imports no executor / signer / network", () => { const src = readFileSync(path.join(HERE, "..", "src", "mainnet-job-lp.js"), "utf8"); assert.ok(!/money-executor|executeMoneyStep|issuePermission|fetch\(|createWalletClient|sendTransaction/.test(src.replace(/^\/\/.*$/gm, ""))); });
const RUN = path.join(HERE, "..", "..", "_private/ops/receipts/A808_second_lp_fork/raw/a808_run.json");
if (existsSync(RUN)) {
  const r = JSON.parse(readFileSync(RUN, "utf8"));
  check("constants == the A-808 run record (pool · coins · selectors · block)", () => {
    assert.equal(r.identity.poolListFactory2, LP.LP_FORK_EVIDENCE.pool);
    assert.deepEqual(r.identity.coins, LP.LP_FORK_EVIDENCE.coins.map((c) => c.address));
    assert.equal(r.identity.selectors.add_dyn.selector, LP.LP_STEPS.addLiquidity.selector);
    assert.equal(r.identity.codeBytes, LP.LP_FORK_EVIDENCE.poolCodeBytes);
    assert.equal(r.identity.vp0, LP.LP_FORK_EVIDENCE.measured.virtualPriceAtPin);
  });
} else console.log("SKIP  constants vs the private A-808 run record (public checkout)");
check("network calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
