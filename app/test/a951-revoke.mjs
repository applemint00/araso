// [A-951] USDC approval revoke executor model (mainnet-job-revoke.js): calldata byte-equal to the A-787 lane B harness encoding
// (approve(spender, 0)), revoke only to 0 and only for the allowlisted spenders, the gate never allows, readiness never ready,
// constants = the lane B run record. Node only, no network, no tx.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import * as R from "../src/mainnet-job-revoke.js";
import { EVIDENCE_LABEL } from "../src/second-job-readiness.js";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-951 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "mainnet-job-revoke.js");
const PIGGY = "0xb701520e24343cbd399a6d7bbd2a5634a7c542e6"; // the lane B user fixture, lowercased
// The harness's own ABI string (a787-laneB-run.mjs :26), copied verbatim — encoding with it is the harness encoding.
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
// lane B constants (a787-laneB-run.mjs :15-18)
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const AAVE_POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";
const KURU = { market: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394", margin: "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5", router: "0xd651346d7c789536ebf06dc72aE3C8502cd695CC" };
const HARNESS_SPENDERS = { aavePool: AAVE_POOL, kuruMarket: KURU.market, kuruMargin: KURU.margin };
const call = (args) => { const r = R.encodeRevokeStep("revoke", { piggyAddress: PIGGY, allowanceRaw: "5000000", ...args }); assert.equal(r.error, null, r.error); return r.call; };

// (a) calldata byte-equal to the harness, per allowlisted spender
for (const [id, sp] of Object.entries(HARNESS_SPENDERS)) {
  check(`revoke ${id} == harness approve(${id}, 0n) on USDC`, () => {
    for (const spender of [sp, sp.toLowerCase(), id]) {
      const c = call({ spender });
      assert.equal(c.to, USDC); assert.equal(c.value, "0"); assert.equal(c.amountRaw, "0"); assert.equal(c.spender, sp); assert.equal(c.spenderId, id);
      assert.equal(c.data, encodeFunctionData({ abi: erc20, functionName: "approve", args: [sp, 0n] }));
      assert.equal(c.data.slice(0, 10), "0x095ea7b3"); assert.ok(c.data.endsWith("0".repeat(64)));
    }
  });
}
check("revoke from a max allowance == harness approve(Aave pool, 0) after approve(max)", () => { const c = call({ spender: AAVE_POOL, allowanceRaw: (2n ** 256n - 1n).toString() }); assert.equal(c.data, encodeFunctionData({ abi: erc20, functionName: "approve", args: [AAVE_POOL, 0n] })); });
check("step selectors == keccak of their signatures", () => { for (const s of Object.values(R.REVOKE_STEPS)) if (s.signature) assert.equal(toFunctionSelector(`function ${s.signature}`), s.selector, s.signature); });
check("allowlist is exactly the three lane B spenders", () => { assert.deepEqual(R.REVOKE_FORK_EVIDENCE.spenders.map((s) => [s.id, s.address]), Object.entries(HARNESS_SPENDERS)); });

// (d) only to 0, only allowlisted spenders, only USDC
const refuse = [
  [{ spender: KURU.router }, "spender_not_allowlisted"],
  [{ spender: "0x942644106B073E30D72c2C5D7529D5C296ea91ab" }, "spender_not_allowlisted"], // a pool revoked in another lane, not this allowlist
  [{ spender: "0x0000000000000000000000000000000000000000" }, "spender_not_allowlisted"],
  [{ spender: "aave" }, "spender_not_allowlisted"],
  [{ spender: undefined }, "spender_not_allowlisted"],
  [{ spender: AAVE_POOL, amountRaw: "1" }, "revoke_amount_not_zero"],
  [{ spender: AAVE_POOL, amountRaw: "5000000" }, "revoke_amount_not_zero"],
  [{ spender: AAVE_POOL, amountRaw: (2n ** 256n - 1n).toString() }, "revoke_amount_not_zero"],
  [{ spender: AAVE_POOL, amountRaw: 0 }, "revoke_amount_not_zero"],
  [{ spender: AAVE_POOL, amountRaw: "00" }, "revoke_amount_not_zero"],
  [{ spender: AAVE_POOL, token: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" }, "token_not_usdc"],
  [{ spender: AAVE_POOL, allowanceRaw: undefined }, "allowance_not_measured"],
  [{ spender: AAVE_POOL, allowanceRaw: "5e6" }, "allowance_not_measured"],
  [{ spender: AAVE_POOL, allowanceRaw: "0" }, "allowance_already_zero"],
];
for (const [args, want] of refuse) check(`refuse revoke ${JSON.stringify(args)} → ${want}`, () => assert.equal(R.encodeRevokeStep("revoke", { piggyAddress: PIGGY, allowanceRaw: "5000000", ...args }).error, want));
check("token given as the recorded USDC (any case) is accepted", () => assert.equal(R.encodeRevokeStep("revoke", { piggyAddress: PIGGY, allowanceRaw: "1", spender: AAVE_POOL, token: USDC.toLowerCase() }).error, null));
check("unproven / unknown steps refused", () => { for (const s of R.REVOKE_UNPROVEN_STEPS) assert.equal(R.encodeRevokeStep(s, { piggyAddress: PIGGY, spender: AAVE_POOL, allowanceRaw: "1" }).error, `unproven_step:${s}`); assert.equal(R.encodeRevokeStep("approve", {}).error, "unknown_step"); });
check("refuse a missing / bad Piggy address", () => { assert.equal(R.encodeRevokeStep("revoke", { spender: AAVE_POOL, allowanceRaw: "1" }).error, "missing_piggy_address"); assert.equal(R.encodeRevokeStep("revoke", { spender: AAVE_POOL, allowanceRaw: "1", piggyAddress: ["0x" + "1".repeat(40)] }).error, "missing_piggy_address"); });
check("stage machine: open → revoked only; revoked → refused (already zero)", () => {
  assert.deepEqual(R.revokeStageAfter(R.REVOKE_STAGE.OPEN, "revoke"), { stage: R.REVOKE_STAGE.REVOKED, error: null });
  assert.equal(R.revokeStageAfter(R.REVOKE_STAGE.REVOKED, "revoke").error, "allowance_already_zero");
  assert.equal(R.revokeStageAfter(R.REVOKE_STAGE.OPEN, "approveNonZero").error, "unproven_step:approveNonZero");
  assert.equal(R.revokeStageAfter("none", "revoke").error, "unknown_stage");
});

// (c) gate / readiness / permission
const liveProfile = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", jobId: R.REVOKE_JOB_ID, liveExecution: true, usdc: { symbol: "USDC", address: USDC, decimals: 6 } };
const offProfile = { ...liveProfile, liveExecution: false };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110746900, send: () => {}, receipt: () => {} };
const piggy = { id: "p", address: PIGGY };
check("gate: live profile refused with live_execution_disabled", () => { const g = R.revokeExecutionGate({ profile: liveProfile, piggy, executor: forkExec, step: "revoke" }); assert.equal(g.allowed, false); assert.equal(g.reason, "live_execution_disabled"); });
check("gate: live off + local fork executor still refused (unknown field first, never allowed)", () => { const g = R.revokeExecutionGate({ profile: offProfile, piggy, executor: forkExec, step: "revoke" }); assert.equal(g.allowed, false); assert.equal(g.reason, "unknown_field:allowanceDiscovery"); });
check("gate: no executor / live executor / wrong Job / unproven step refused", () => {
  assert.equal(R.revokeExecutionGate({ profile: offProfile, piggy, step: "revoke" }).reason, "no_executor");
  assert.equal(R.revokeExecutionGate({ profile: offProfile, piggy, executor: { ...forkExec, kind: "live" }, step: "revoke" }).reason, "live_execution_disabled");
  assert.equal(R.revokeExecutionGate({ profile: { ...offProfile, jobId: "aave-usdc" }, piggy, executor: forkExec, step: "revoke" }).reason, "profile_not_revoke_lane");
  assert.equal(R.revokeExecutionGate({ profile: offProfile, piggy, executor: forkExec, step: "revokePermit2" }).reason, "unproven_step:revokePermit2");
});
check("readiness never ready / executable / live, fork review conditions listed open", () => { const r = R.revokeReadiness({ stage: "allowance_open", profile: liveProfile, executor: forkExec }); assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.liveExecution, false); assert.equal(r.principalMoves, false); assert.ok(r.blockedBy.includes("fork_review_conditions_open")); assert.equal(R.revokeReadiness({}).stage, "unknown"); });
check("permission request: amount 0, destination = allowlisted spender, never issues", () => {
  const { request, error } = R.revokePermissionRequest({ profile: offProfile, piggy, spender: "kuruMargin", eventId: "e1" });
  assert.equal(error, null); assert.equal(request.amount, "0"); assert.equal(request.destination, KURU.margin); assert.equal(request.permission, null); assert.equal(request.createsPermission, false); assert.equal(request.amountDisplay, "0.000000 USDC");
  assert.equal(R.revokePermissionRequest({ profile: offProfile, piggy, spender: KURU.router }).error, "spender_not_allowlisted");
  assert.equal(R.revokePermissionRequest({ profile: { ...offProfile, usdc: { ...offProfile.usdc, address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" } }, piggy, spender: "aavePool" }).error, "profile_asset_not_revoke_evidence");
});
check("header keeps the 7 review conditions OPEN", () => { const src = readFileSync(SRC, "utf8"); assert.equal((src.match(/^\/\/ {3}\[ \] [1-9] /gm) || []).length, 7); assert.ok(!/\[x\]/i.test(src)); });
check("module imports no executor / signer / network; no private path or card id; no rate wording in code", () => {
  const src = readFileSync(SRC, "utf8");
  const code = src.replace(/^\/\/.*$/gm, "");
  assert.ok(!/money-executor|executeMoneyStep|issuePermission|fetch\(|createWalletClient|sendTransaction/.test(code));
  assert.ok(!/_private/.test(src)); assert.ok(!/\bA-\d{3}\b/.test(src));
  assert.ok(!/\b(apy|yield|venue)\b|["'`>](safe|instant)\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")));
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./chain-profile.js", "./mainnet-job-common.js", "./permission-envelope.js", "./second-job-readiness.js", "viem"]);
});
check("evidence label is the shared PASS_FORK_SIM word", () => assert.equal(R.REVOKE_FORK_EVIDENCE.label, EVIDENCE_LABEL.FORK_SIM));

// (b) constants == the private run record (skipped in a public checkout)
let root = HERE; while (root !== path.dirname(root) && !existsSync(path.join(root, "_private/ops/receipts/A787_second_broad_fork"))) root = path.dirname(root);
const RUN = path.join(root, "_private/ops/receipts/A787_second_broad_fork/laneB/raw/laneB_run.json");
if (existsSync(RUN)) {
  const r = JSON.parse(readFileSync(RUN, "utf8"));
  const sc = r.scenarios.find((s) => s.scenario === "protect_revoke_stale_allowance");
  const E = R.REVOKE_FORK_EVIDENCE;
  check("constants == the lane B run record (block · USDC · spenders · gas · measured)", () => {
    assert.equal(r.forkBlock, E.block); assert.equal(r.chainId, E.chainId);
    assert.equal(new Date(r.forkBlockTimestamp * 1000).toISOString().replace(".000Z", "Z"), E.blockTimestamp);
    assert.equal(r.identity.USDC.address, E.token.address); assert.equal(r.identity.USDC.codeBytes, E.token.codeBytes);
    assert.equal(sc.label, E.label);
    assert.deepEqual(sc.rows.map((x) => [x.spender, x.address]), E.spenders.map((s) => [s.id, s.address]));
    for (const x of sc.rows) {
      assert.equal(x.allowanceBefore, E.measured.setupAllowanceRaw); assert.equal(x.allowanceAfter, E.measured.allowanceAfterRaw);
      assert.equal(x.usdcBalanceBefore, E.measured.usdcBalanceBeforeRaw); assert.equal(x.usdcBalanceAfter, E.measured.usdcBalanceAfterRaw); assert.equal(x.principalMoved, E.measured.principalMoved);
      assert.equal(x.revoke.status, "success"); assert.equal(Number(x.revoke.gasUsed), E.gasUsed.revoke); assert.equal(Number(x.revoke.gasEstimate), E.gasEstimate.revoke);
      assert.equal(x.revokeWhenAlreadyZero.status, "success"); assert.equal(Number(x.revokeWhenAlreadyZero.gasUsed), E.gasUsed.revokeAlreadyZero); assert.equal(Number(x.revokeWhenAlreadyZero.gasEstimate), E.gasEstimate.revokeAlreadyZero);
      assert.equal(Number(x.setupApproveGasUsed), E.gasUsed.setupApprove);
    }
    assert.equal(Number(sc.unlimitedApproval.revokeGasUsed), E.gasUsed.revokeFromMax); assert.equal(Number(sc.unlimitedApproval.approveGasUsed), E.gasUsed.setupApproveMax); assert.equal(sc.unlimitedApproval.allowanceAfter, E.measured.fromMaxAllowanceAfterRaw);
    assert.ok(/UNKNOWN/.test(sc.enumerationOfForeignAllowances));
  });
} else console.log("SKIP  constants vs the private lane B run record (public checkout)");
check("network calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
