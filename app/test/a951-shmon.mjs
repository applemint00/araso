// [A-951] FastLane shMON executor model (mainnet-job-shmon.js): calldata byte-equal to the fork harness encoding (A-787 lane D /
// A-652 shmonAbi), every refusal path, the gate never allows, readiness never ready, constants = the A-787 lane D run record.
// Node only, no network, no tx.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, toFunctionSelector } from "viem";
import * as S from "../src/mainnet-job-shmon.js";
import { EVIDENCE_LABEL } from "../src/second-job-readiness.js";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-951 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "mainnet-job-shmon.js");
const PIGGY = "0xa98d88b97c59194f5db518be07a4db23aec0be31"; // the lane D piggy fixture, lowercased
// The harness's own ABI items (a787-laneD-fork.mjs :166-177 / a652-mainnet-fork-lab.mjs :164-176), copied verbatim.
const v4626 = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "redeem", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
];
const shmonAbi = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  ...v4626.filter((f) => f.name !== "deposit"),
];
const E = S.SHMON_FORK_EVIDENCE, M = E.measured, VAULT = E.vault;
const AMT = 1000000000000000000n;
const call = (step, args) => { const r = S.encodeShmonStep(step, { piggyAddress: PIGGY, ...args }); assert.equal(r.error, null, r.error); return r.call; };

// (a) calldata byte-equal to the harness
check("deposit == harness deposit(AMT, PIGGY) with value = AMT", () => {
  const c = call("deposit", { amountWei: AMT.toString() });
  assert.equal(c.to, VAULT); assert.equal(c.value, AMT.toString());
  assert.equal(c.data, encodeFunctionData({ abi: shmonAbi, functionName: "deposit", args: [AMT, PIGGY] }));
  assert.equal(c.data.slice(0, 10), "0x6e553f65");
});
check("redeem == harness redeem(shares, PIGGY, PIGGY) (whole measured position)", () => {
  const c = call("redeem", { heldSharesRaw: M.sharesAfterEntryRaw });
  assert.equal(c.to, VAULT); assert.equal(c.value, "0"); assert.equal(c.sharesRaw, M.sharesAfterEntryRaw);
  assert.equal(c.data, encodeFunctionData({ abi: shmonAbi, functionName: "redeem", args: [BigInt(M.sharesAfterEntryRaw), PIGGY, PIGGY] }));
  assert.equal(c.data.slice(0, 10), "0xba087652");
});
check("smaller deposit (0.1 MON, lane D size-curve row) == harness encoding", () => {
  const c = call("deposit", { amountWei: "100000000000000000", valueWei: "100000000000000000" });
  assert.equal(c.data, encodeFunctionData({ abi: shmonAbi, functionName: "deposit", args: [100000000000000000n, PIGGY] }));
});
check("step selectors == keccak of their signatures", () => { for (const s of Object.values(S.SHMON_STEPS)) if (s.signature) assert.equal(toFunctionSelector(`function ${s.signature}`), s.selector, s.signature); });
check("expected shares / MON back stay UNKNOWN; no minimum invented", () => { assert.equal(call("deposit", { amountWei: "1" }).expectedSharesRaw, "UNKNOWN"); const r = call("redeem", { heldSharesRaw: "5" }); assert.equal(r.expectedMonWei, "UNKNOWN"); assert.equal(r.minOutWei, "UNKNOWN"); });

// (d) bounds and fixed target
const refuse = [
  ["deposit", { amountWei: (AMT + 1n).toString() }, "amount_above_fork_proven_size"],
  ["deposit", { amountWei: "10000000000000000000" }, "amount_above_fork_proven_size"],
  ["deposit", { amountWei: "0" }, "amount_not_exact"],
  ["deposit", { amountWei: "1.5" }, "amount_not_exact"],
  ["deposit", { amountWei: 1000 }, "amount_not_exact"],
  ["deposit", { amountWei: "1000", valueWei: "999" }, "value_not_equal_assets"],
  ["deposit", { amountWei: "1000", vault: "0xA3227C5969757783154C60bF0bC1944180ed81B9" }, "vault_not_fork_evidence"],
  ["redeem", { heldSharesRaw: M.sharesAfterEntryRaw, vault: "0x0000000000000000000000000000000000000001" }, "vault_not_fork_evidence"],
  ["redeem", {}, "held_shares_not_measured"],
  ["redeem", { heldSharesRaw: "0" }, "held_shares_not_measured"],
  ["redeem", { heldSharesRaw: (BigInt(M.sharesAfterEntryRaw) + 1n).toString() }, "shares_above_fork_proven_position"],
  ["redeem", { heldSharesRaw: "1000", sharesRaw: "999" }, "unproven_step:redeemPartial"],
  ["redeemPartial", {}, "unproven_step:redeemPartial"],
  ["withdraw", {}, "unproven_step:withdraw"],
  ["mint", {}, "unproven_step:mint"],
  ["redeemAboveHeld", {}, "unproven_step:redeemAboveHeld"],
  ["approve", {}, "unknown_step"],
];
for (const [step, args, want] of refuse) check(`refuse ${step} ${JSON.stringify(args)} → ${want}`, () => assert.equal(S.encodeShmonStep(step, { piggyAddress: PIGGY, ...args }).error, want));
check("vault given in another case is still the recorded vault", () => assert.equal(S.encodeShmonStep("deposit", { piggyAddress: PIGGY, amountWei: "1", vault: VAULT.toLowerCase() }).error, null));
check("refuse a missing / bad Piggy address", () => { assert.equal(S.encodeShmonStep("deposit", { amountWei: "1" }).error, "missing_piggy_address"); assert.equal(S.encodeShmonStep("deposit", { amountWei: "1", piggyAddress: ["0x" + "1".repeat(40)] }).error, "missing_piggy_address"); });
check("stage machine: only fork-proven transitions", () => {
  let s = S.SHMON_STAGE.NONE;
  for (const step of ["deposit", "redeem"]) { const r = S.shmonStageAfter(s, step); assert.equal(r.error, null, `${step}: ${r.error}`); s = r.stage; }
  assert.equal(s, S.SHMON_STAGE.REDEEMED);
  assert.equal(S.shmonStageAfter(S.SHMON_STAGE.NONE, "redeem").error, "step_not_valid_from_stage");
  assert.equal(S.shmonStageAfter(S.SHMON_STAGE.HOLDING, "withdraw").error, "unproven_step:withdraw");
  assert.equal(S.shmonStageAfter("returned", "deposit").error, "unknown_stage");
});

// (c) gate / readiness / permission
const liveProfile = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", jobId: S.SHMON_JOB_ID, liveExecution: true, usdc: { symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 } };
const offProfile = { ...liveProfile, liveExecution: false };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110746900, send: () => {}, receipt: () => {} };
const piggy = { id: "p", address: PIGGY };
check("gate: live profile refused with live_execution_disabled", () => { const g = S.shmonExecutionGate({ profile: liveProfile, piggy, executor: forkExec, step: "deposit" }); assert.equal(g.allowed, false); assert.equal(g.reason, "live_execution_disabled"); });
check("gate: live off + local fork executor still refused (MON not bindable today)", () => { const g = S.shmonExecutionGate({ profile: offProfile, piggy, executor: forkExec, step: "deposit" }); assert.equal(g.allowed, false); assert.equal(g.reason, "asset_not_in_profile"); });
check("gate: refusal order (step proof → profile → live → Job) and never allowed", () => {
  for (const step of ["deposit", "redeem"]) assert.equal(S.shmonExecutionGate({ profile: offProfile, piggy, executor: forkExec, step }).allowed, false);
  assert.equal(S.shmonExecutionGate({ profile: offProfile, piggy, executor: forkExec, step: "withdraw" }).reason, "unproven_step:withdraw");
  assert.equal(S.shmonExecutionGate({ profile: { ...offProfile, jobId: "aave-usdc" }, piggy, executor: forkExec, step: "deposit" }).reason, "profile_not_shmon_lane");
  assert.equal(S.shmonExecutionGate({ profile: null, piggy, executor: forkExec, step: "deposit" }).reason, "profile_blocked");
});
check("readiness never ready / executable / live, fork review conditions listed open", () => { const r = S.shmonReadiness({ stage: "redeemed", profile: liveProfile, executor: forkExec }); assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.liveExecution, false); assert.equal(r.sharesAssumedEqualToMon, false); assert.ok(r.blockedBy.includes("fork_review_conditions_open")); assert.ok(r.blockedBy.includes("unknown_field:exitLossCause")); assert.equal(S.shmonReadiness({ stage: "returned" }).stage, "unknown"); });
check("permission request: refused at the USDC-only binding; never issues", () => {
  assert.equal(S.shmonPermissionRequest({ profile: offProfile, piggy, amountWei: "1" }).error, "asset_not_in_profile");
  assert.equal(S.shmonPermissionRequest({ profile: { ...offProfile, numericChainId: 10143 }, piggy, amountWei: "1" }).error, "profile_blocked");
  assert.equal(S.shmonPermissionRequest({ profile: null, piggy, amountWei: "1" }).request, null);
});
check("fields: unproven read UNKNOWN", () => { assert.equal(S.shmonField("exitLossCause"), "UNKNOWN"); assert.equal(S.shmonField("vault"), VAULT); assert.equal(S.shmonField("nope"), "UNKNOWN"); });
check("header keeps the 9 review conditions OPEN", () => { const src = readFileSync(SRC, "utf8"); assert.equal((src.match(/^\/\/ {3}\[ \] [1-9] /gm) || []).length, 9); assert.ok(!/\[x\]/i.test(src)); });
check("module imports no executor / signer / network; no private path or card id; no rate wording in code", () => {
  const src = readFileSync(SRC, "utf8");
  const code = src.replace(/^\/\/.*$/gm, "");
  assert.ok(!/money-executor|executeMoneyStep|issuePermission|fetch\(|createWalletClient|sendTransaction/.test(code));
  assert.ok(!/_private/.test(src)); assert.ok(!/\bA-\d{3}\b/.test(src));
  assert.ok(!/\b(apy|yield|venue)\b|["'`>](safe|instant)\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")));
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./chain-profile.js", "./mainnet-job-common.js", "./permission-envelope.js", "./second-job-readiness.js", "viem"]);
});
check("evidence label is the shared PASS_FORK_SIM word", () => assert.equal(E.label, EVIDENCE_LABEL.FORK_SIM));

// (b) constants == the private run record (skipped in a public checkout)
let root = HERE; while (root !== path.dirname(root) && !existsSync(path.join(root, "_private/ops/receipts/A787_second_broad_fork"))) root = path.dirname(root);
const RUN = path.join(root, "_private/ops/receipts/A787_second_broad_fork/laneD/raw/fastlane-shmon.json");
const RUN652 = path.join(root, "_private/ops/receipts/A652_mainnet_fork_lab/raw/fastlane-shmon.json");
const EDGES = path.join(root, "_private/ops/receipts/A787_second_broad_fork/laneD/raw/edges-and-warp.json");
if (existsSync(RUN)) {
  const r = JSON.parse(readFileSync(RUN, "utf8"));
  const st = (n) => r.steps.find((s) => s.step === n);
  check("constants == the lane D run record (vault · code · block · selectors · gas · measured)", () => {
    assert.equal(r.contracts.vault.address, E.vault); assert.equal(r.contracts.vault.codeBytes, E.vaultCodeBytes); assert.equal(r.contracts.vault.codeKeccak, E.vaultCodeKeccak);
    assert.equal(r.contracts.share.symbol, E.share.symbol); assert.equal(r.contracts.share.decimals, E.share.decimals);
    assert.equal(r.preview.asset, E.assetSentinel);
    assert.equal(r.block.number, E.block); assert.equal(r.block.hash, E.blockHash); assert.equal(r.block.timestampIso.replace(".000Z", "Z"), E.blockTimestamp); assert.equal(r.chainId, E.chainId);
    assert.equal(st("1_deposit").selector, S.SHMON_STEPS.deposit.selector); assert.equal(st("2_redeem_immediate").selector, S.SHMON_STEPS.redeem.selector);
    assert.equal(Number(st("1_deposit").gasUsed), E.gasUsed.deposit); assert.equal(Number(st("2_redeem_immediate").gasUsed), E.gasUsed.redeem);
    assert.equal(st("1_deposit").value, E.sentWei);
    assert.equal(r.preview.previewDeposit1MON, M.previewDepositRaw); assert.equal(r.preview.convertToShares1MON, M.convertToSharesRaw);
    assert.equal(r.balances.sharesAfterEntryRaw, M.sharesAfterEntryRaw); assert.equal(r.preExit.maxRedeem, M.maxRedeemRaw);
    assert.equal(r.preExit.previewRedeemAll, M.previewRedeemAllWei); assert.equal(r.preExit.convertToAssetsAll, M.convertToAssetsAllWei);
    assert.equal(r.roundTrip.returnedWeiExGas, M.returnedWeiExGas); assert.equal(r.roundTrip.haircutWei, M.haircutWei);
    assert.equal(Math.round(r.roundTrip.haircutBps_x100 * 100), M.haircutBpsX100);
    assert.equal(r.roundTrip.decomposition.exitGapConvertVsPreviewWei, M.exitGapConvertVsPreviewWei);
    assert.equal(r.balances.sharesAfterExitRaw, E.sharesAfterExitRaw); assert.equal(r.allowance.approvalsUsed, E.approvalsUsed);
    assert.equal(st("3_probe_redeem_too_much").status, "reverted"); assert.ok(st("3_probe_redeem_too_much").estimateError.data.startsWith(E.revertProbe.selector));
    assert.equal(r.label, E.label);
  });
  check("harness step calldata (deposit / redeem) re-encoded == app calldata", () => {
    assert.equal(st("1_deposit").to, VAULT); assert.equal(st("2_redeem_immediate").to, VAULT);
    const from = st("1_deposit").from.toLowerCase();
    assert.equal(S.encodeShmonStep("deposit", { piggyAddress: from, amountWei: st("1_deposit").value }).call.data, encodeFunctionData({ abi: shmonAbi, functionName: "deposit", args: [BigInt(st("1_deposit").value), from] }));
    assert.equal(S.encodeShmonStep("redeem", { piggyAddress: from, heldSharesRaw: r.preExit.shareRaw }).call.data, encodeFunctionData({ abi: shmonAbi, functionName: "redeem", args: [BigInt(r.preExit.shareRaw), from, from] }));
  });
} else console.log("SKIP  constants vs the private lane D run record (public checkout)");
if (existsSync(RUN652)) {
  const r = JSON.parse(readFileSync(RUN652, "utf8"));
  check("prior-block numbers == the earlier fork record", () => { assert.equal(r.block.number, M.priorBlock.block); assert.equal(r.balances.sharesAfterEntryRaw, M.priorBlock.sharesAfterEntryRaw); assert.equal(r.roundTrip.returnedWeiExGas, M.priorBlock.returnedWeiExGas); assert.equal(Math.round(r.roundTrip.haircutBps_x100 * 100), M.priorBlock.haircutBpsX100); });
}
if (existsSync(EDGES)) {
  const rows = JSON.parse(readFileSync(EDGES, "utf8")).candidates["fastlane-shmon"].rows;
  check("size curve: only 0.1 / 1 / 10 MON ran; the lane size is the 1 MON row", () => { assert.deepEqual(rows.map((x) => x.amountMON), ["0.1", "1", "10"]); assert.equal(rows[1].returnedWeiExGas, M.returnedWeiExGas); assert.equal(S.SHMON_FORK_SIZE_WEI, AMT.toString()); });
}
check("network calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
