// [A-951] Upshift earnAUSD executor model (mainnet-job-upshift.js): calldata byte-equal to the A-787 lane A fork harness encoding, every
// refusal path, the queued exit proven only to the request (beyond = UNKNOWN), the gate never allows (live off included), readiness never
// ready, constants = the A-787 run record. Node only, no network, no tx.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import * as UP from "../src/mainnet-job-upshift.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-951 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "..", "src", "mainnet-job-upshift.js"), "utf8");
const findPrivate = (rel) => { const p = privatePath(rel); return existsSync(p) ? p : null; }; // [A-1033] one root; pre-A-1033: walked up 6 parents from app/test
// Harness actor (a787-laneA-run.mjs :22) — the Piggy in every vector, so the comparison is against the exact recorded calls.
const ACTOR = "0x0e1aF437Cc134921dedA89ADaDe025f655b5B8e4";
// The harness's own ABI strings (a787-laneA-run.mjs :23 erc20 · :25 upAbi), copied verbatim.
const H_ERC20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const H_UP = parseAbi(["function deposit(address,uint256,address) returns (uint256)", "function instantRedeem(uint256,address) returns (uint256,uint256)", "function requestRedeem(uint256,address) returns (uint256,uint256)"]);
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", UP_VAULT = "0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA", UP_LP = "0x103222f020e98Bba0AD9809A011FDF8e6F067496"; // harness ADDR (:16-17)
const AMT = 100_000_000n, SH = 95643316n;
const SHARE_CAP = SH * 10100n / 10000n;
const call = (step, args) => { const r = UP.encodeUpshiftStep(step, { piggyAddress: ACTOR, ...args }); assert.equal(r.error, null, r.error); return r.call; };

// (a) calldata == harness
check("(a) approve == harness approve(AUSD → vault, 100e6)", () => { const c = call("approve", { amountRaw: AMT.toString() }); assert.equal(c.to, AUSD); assert.equal(c.spender, UP_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [UP_VAULT, AMT] })); });
check("(a) deposit == harness deposit(AUSD, 100e6, actor)", () => { const c = call("deposit", { amountRaw: AMT.toString() }); assert.equal(c.to, UP_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_UP, functionName: "deposit", args: [AUSD, AMT, ACTOR] })); assert.equal(c.data.slice(0, 10), "0xf45346dc"); });
check("(a) instantRedeem == harness instantRedeem(all shares, actor)", () => { const c = call("instantRedeem", { heldSharesRaw: SH.toString() }); assert.equal(c.to, UP_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_UP, functionName: "instantRedeem", args: [SH, ACTOR] })); assert.equal(c.data.slice(0, 10), "0x22928208"); });
check("(a) approveShares == harness approve(earnAUSD → vault, shares)", () => { const c = call("approveShares", { heldSharesRaw: SH.toString() }); assert.equal(c.to, UP_LP); assert.equal(c.spender, UP_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [UP_VAULT, SH] })); });
check("(a) requestRedeem == harness requestRedeem(all shares, actor); marked pending, after = UNKNOWN", () => { const c = call("requestRedeem", { heldSharesRaw: SH.toString() }); assert.equal(c.to, UP_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_UP, functionName: "requestRedeem", args: [SH, ACTOR] })); assert.equal(c.data.slice(0, 10), "0x107703ab"); assert.equal(c.outcome, "pending"); assert.equal(c.afterThis, "UNKNOWN"); });
check("(a) never unlimited: both approves are exactly the request", () => { for (const [s, k] of [["approve", "amountRaw"], ["approveShares", "heldSharesRaw"]]) { const c = call(s, { [k]: "7" }); assert.equal(c.amountRaw, "7"); assert.ok(!c.data.endsWith("f".repeat(64))); } });

// (d) amount cap / pinned targets / unproven steps (claim beyond the request = UNKNOWN)
const refuse = [
  ["approve", { amountRaw: (AMT + 1n).toString() }, "amount_above_fork_proven_size"],
  ["deposit", { amountRaw: (AMT + 1n).toString() }, "amount_above_fork_proven_size"],
  ["deposit", { amountRaw: "0" }, "amount_not_exact"],
  ["approve", { amountRaw: "-1" }, "amount_not_exact"],
  ["instantRedeem", {}, "shares_not_measured"],
  ["instantRedeem", { heldSharesRaw: (SHARE_CAP + 1n).toString() }, "shares_above_fork_proven_position"],
  ["approveShares", { heldSharesRaw: (SHARE_CAP + 1n).toString() }, "shares_above_fork_proven_position"],
  ["requestRedeem", { heldSharesRaw: (SHARE_CAP + 1n).toString() }, "shares_above_fork_proven_position"],
  ["approve", { amountRaw: "1", token: UP_LP }, "token_not_fork_proven"],
  ["approveShares", { heldSharesRaw: "1", token: AUSD }, "token_not_fork_proven"],
  ["approve", { amountRaw: "1", spender: "0xE0b7DEab801D864650DEc58CbD1b3c441D058C79" }, "spender_not_fork_proven"],
  ["deposit", { amountRaw: "1", vault: "0x2C803c8C3C57b9D4A9abA011615561315c2b6aC1" }, "vault_not_fork_proven"],
  ["claim", {}, "unproven_step:claim"],
  ["revoke", {}, "unproven_step:revoke"],
  ["depositAboveForkSize", {}, "unproven_step:depositAboveForkSize"],
  ["redeem", {}, "unknown_step"],
];
for (const [step, args, want] of refuse) check(`(d) refuse ${step} ${JSON.stringify(args)} → ${want}`, () => assert.equal(UP.encodeUpshiftStep(step, { piggyAddress: ACTOR, ...args }).error, want));
check("(d) a matching pinned token per step is accepted (AUSD for approve, earnAUSD for approveShares)", () => { assert.equal(call("approve", { amountRaw: "1", token: AUSD.toLowerCase(), spender: UP_VAULT }).to, AUSD); assert.equal(call("approveShares", { heldSharesRaw: "1", token: UP_LP, vault: UP_VAULT }).to, UP_LP); });
check("(d) refuse a missing / bad Piggy address", () => { assert.equal(UP.encodeUpshiftStep("approve", { amountRaw: "1" }).error, "missing_piggy_address"); assert.equal(UP.encodeUpshiftStep("deposit", { amountRaw: "1", piggyAddress: "0x12" }).error, "missing_piggy_address"); });
check("stage machine: instant path ends exited; queued path ends pending with no proven next step", () => {
  let s = UP.UPSHIFT_STAGE.NONE;
  for (const step of ["approve", "deposit", "instantRedeem"]) { const r = UP.upshiftStageAfter(s, step); assert.equal(r.error, null, `${step}: ${r.error}`); s = r.stage; }
  assert.equal(s, UP.UPSHIFT_STAGE.OUT);
  s = UP.UPSHIFT_STAGE.IN_VAULT;
  for (const step of ["approveShares", "requestRedeem"]) { const r = UP.upshiftStageAfter(s, step); assert.equal(r.error, null, `${step}: ${r.error}`); s = r.stage; }
  assert.equal(s, UP.UPSHIFT_STAGE.QUEUED);
  assert.equal(UP.upshiftStageAfter(s, "claim").error, "unproven_step:claim");
  for (const step of ["approve", "deposit", "instantRedeem", "approveShares", "requestRedeem"]) assert.equal(UP.upshiftStageAfter(s, step).error, "step_not_valid_from_stage");
  assert.equal(UP.upshiftStageAfter(UP.UPSHIFT_STAGE.IN_VAULT, "requestRedeem").error, "step_not_valid_from_stage");
  const o = UP.upshiftOutcome(UP.UPSHIFT_STAGE.QUEUED); assert.equal(o.outcome, "pending"); assert.equal(o.afterThis, "UNKNOWN"); assert.equal(o.eta, "UNKNOWN"); assert.equal(o.amountBack, "UNKNOWN");
  assert.equal(UP.upshiftOutcome("bogus").outcome, "unknown");
});
check("claim step is recorded as time-warp-only (not proven)", () => { assert.equal(UP.UPSHIFT_STEPS.claim.proof, UP.UPSHIFT_PROOF.UNPROVEN); assert.equal(UP.UPSHIFT_STEPS.claim.forkStatus, "time_warp_only"); assert.equal(UP.upshiftField("queuedClaim"), "UNKNOWN"); assert.equal(UP.UPSHIFT_FORK_EVIDENCE.label, "PASS_FORK_SIM_WITH_PENDING"); });

// (c) gate refuses with live off; never allows
const offProfile = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", jobId: UP.UPSHIFT_JOB_ID, liveExecution: false, usdc: { symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 } };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110746900, send: () => {}, receipt: () => {} };
const PIGGY = { id: "p", address: ACTOR };
check("(c) gate with liveExecution false refuses every proven step (profile binds no AUSD)", () => {
  for (const step of ["approve", "deposit", "instantRedeem", "approveShares", "requestRedeem"]) { const g = UP.upshiftExecutionGate({ profile: offProfile, piggy: PIGGY, executor: forkExec, step }); assert.equal(g.allowed, false); assert.equal(g.liveExecution, false); assert.equal(g.reason, "asset_not_in_profile"); }
});
check("(c) gate refuses a live profile, a non-Upshift profile, no profile, the claim step", () => {
  assert.equal(UP.upshiftExecutionGate({ profile: { ...offProfile, liveExecution: true }, piggy: PIGGY, executor: forkExec, step: "approve" }).reason, "live_execution_disabled");
  assert.equal(UP.upshiftExecutionGate({ profile: { ...offProfile, jobId: "aave-usdc" }, piggy: PIGGY, executor: forkExec, step: "approve" }).reason, "profile_not_upshift_lane");
  assert.equal(UP.upshiftExecutionGate({ profile: undefined, piggy: PIGGY, step: "deposit" }).reason, "profile_blocked");
  assert.equal(UP.upshiftExecutionGate({ profile: offProfile, piggy: PIGGY, executor: forkExec, step: "claim" }).reason, "unproven_step:claim");
});
check("(c) permission request issues nothing: AUSD is not a profile asset today", () => {
  assert.deepEqual(UP.upshiftPermissionRequest({ profile: offProfile, piggy: PIGGY, amountRaw: "1" }), { request: null, error: "asset_not_in_profile" });
  assert.equal(UP.upshiftPermissionRequest({ profile: null, piggy: PIGGY, amountRaw: "1" }).error, "profile_blocked");
});
check("readiness never ready / executable / live / return-complete, even at a queued stage", () => {
  const r = UP.upshiftReadiness({ stage: UP.UPSHIFT_STAGE.QUEUED, profile: { ...offProfile, liveExecution: true }, executor: forkExec });
  assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.liveExecution, false); assert.equal(r.returnComplete, false); assert.equal(r.outcome, "pending");
  assert.ok(r.blockedBy.includes("fork_review_conditions_open")); assert.ok(r.blockedBy.includes("unproven_step:claim")); assert.ok(r.blockedBy.includes("unknown_field:queuedClaim"));
});
check("header keeps the 10 fork review conditions OPEN", () => { assert.equal((SRC.match(/^\/\/ {3}\[ \] \d+ /gm) || []).length, 10); assert.ok(!/\[x\]/i.test(SRC)); });
check("module imports no executor / signer / network; no card id or private path in shipped strings", () => {
  const code = SRC.replace(/^\/\/.*$/gm, "");
  assert.ok(!/money-executor|executeMoneyStep|issuePermission|fetch\(|createWalletClient|sendTransaction/.test(code));
  assert.deepEqual([...SRC.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort(), ["./chain-profile.js", "./mainnet-job-common.js", "./mainnet-job-euler.js", "./permission-envelope.js", "./second-job-readiness.js", "viem"]);
  assert.equal(PRIVATE_RE.test(SRC), false); assert.equal(/\bA-\d{3}\b/.test(SRC), false);
});

// (b) constants == the recorded harness values
const RUN = findPrivate("ops/receipts/A787_second_broad_fork/laneA/raw_run.json");
const HARNESS = findPrivate("ops/harness/a787-laneA-run.mjs");
if (RUN) {
  const r = JSON.parse(readFileSync(RUN, "utf8")), U = r.upshift, F = UP.UPSHIFT_FORK_EVIDENCE, M = F.measured;
  const i1 = U.noWarp_instant_round_trip, q = U.noWarp_queued;
  check("(b) constants == the A-787 run record (pin · identity · state · measured · gas)", () => {
    assert.equal(r.meta.chainId, F.chainId); assert.equal(r.meta.pin.number, F.block); assert.equal(new Date(r.meta.pin.timestamp * 1000).toISOString().replace(".000Z", "Z"), F.blockTimestamp);
    assert.equal(U.identity.vault, F.vault); assert.equal(U.identity.lpToken, F.shareToken.address); assert.equal(U.identity.asset, F.asset.address); assert.ok(U.identity.proxyImpl.startsWith(F.vaultImplementation));
    assert.equal(U.state.previewDeposit100, M.previewSharesRaw); assert.equal(i1.deposit.sharesMinted, M.realizedSharesRaw); assert.equal(q.deposit.sharesMinted, M.realizedSharesRaw);
    assert.deepEqual(i1.previewRedemption_instant_for_shares, [...M.redeemPreviewForSharesRaw]);
    assert.equal(i1.ausdReturned, M.returnedRaw); assert.equal(i1.netDeltaAusdBaseUnits, M.deltaRaw); assert.equal(i1.ausdDeposited, F.sentRaw); assert.equal(i1.sharesLeft, "0");
    assert.equal(i1.deposit.allowanceAfter, F.allowanceAfterDepositRaw);
    assert.equal(U.state.instantRedemptionFee, M.redeemFeeFieldAtPin); assert.equal(U.state.withdrawalFee, M.withdrawalFeeAtPin); assert.equal(U.state.lagDuration, M.lagDurationSecondsAtPin);
    assert.equal(q.afterRequest.sharesAfterRequest, M.sharesAfterRequestRaw); assert.equal(q.afterRequest.ausdAfterRequest, q.deposit.ausdAfter); // no AUSD back at the request
    assert.deepEqual(q.earlyClaimAttempts.map((x) => x.res.status), ["PRE_SIM_REVERT", "PRE_SIM_REVERT"]);
    assert.deepEqual(q.earlyClaimAttempts.map((x) => x.res.revert.match(/0x[0-9a-f]{8}/)[0]), [...M.earlyClaimReverts]);
    assert.ok(/TIME_WARP/.test(U.timeWarp_queued.LABEL)); // the only successful claim is under a time warp
    const G = F.gasUsed;
    assert.deepEqual([i1.deposit.ap.gasUsed, i1.deposit.dp.gasUsed, i1.instantRedeem.gasUsed, q.lpApprove.gasUsed, q.requestRedeem.gasUsed].map(Number), [G.approve, G.deposit, G.instantRedeem, G.approveShares, G.requestRedeem]);
    for (const t of [i1.deposit.ap, i1.deposit.dp, i1.instantRedeem, q.lpApprove, q.requestRedeem]) assert.equal(t.status, "SUCCESS");
    assert.equal(r.meta.actor, ACTOR);
  });
  check("(a) app calldata == the recorded harness call args (all 5 proven steps)", () => {
    const enc = (abi, fn, args) => encodeFunctionData({ abi, functionName: fn, args });
    assert.equal(call("approve", { amountRaw: i1.deposit.ap.args[1] }).data, enc(H_ERC20, "approve", [i1.deposit.ap.args[0], BigInt(i1.deposit.ap.args[1])]));
    assert.equal(call("deposit", { amountRaw: i1.deposit.dp.args[1] }).data, enc(H_UP, "deposit", [i1.deposit.dp.args[0], BigInt(i1.deposit.dp.args[1]), i1.deposit.dp.args[2]]));
    assert.equal(call("instantRedeem", { heldSharesRaw: i1.instantRedeem.args[0] }).data, enc(H_UP, "instantRedeem", [BigInt(i1.instantRedeem.args[0]), i1.instantRedeem.args[1]]));
    assert.equal(call("approveShares", { heldSharesRaw: q.lpApprove.args[1] }).data, enc(H_ERC20, "approve", [q.lpApprove.args[0], BigInt(q.lpApprove.args[1])]));
    assert.equal(call("requestRedeem", { heldSharesRaw: q.requestRedeem.args[0] }).data, enc(H_UP, "requestRedeem", [BigInt(q.requestRedeem.args[0]), q.requestRedeem.args[1]]));
    assert.deepEqual([i1.deposit.ap.to, i1.deposit.dp.to, i1.instantRedeem.to, q.lpApprove.to, q.requestRedeem.to], [AUSD, UP_VAULT, UP_VAULT, UP_LP, UP_VAULT]);
  });
} else console.log("SKIP  constants vs the private A-787 run record (public checkout)");
if (HARNESS) {
  check("(b) harness source still names the same vault / share token / AUSD / ABI strings", () => {
    const h = readFileSync(HARNESS, "utf8");
    assert.ok(h.includes(`AUSD: "${AUSD}"`)); assert.ok(h.includes(`UP_VAULT: "${UP_VAULT}"`)); assert.ok(h.includes(`UP_LP: "${UP_LP}"`));
    for (const s of ['"function deposit(address,uint256,address) returns (uint256)"', '"function instantRedeem(uint256,address) returns (uint256,uint256)"', '"function requestRedeem(uint256,address) returns (uint256,uint256)"']) assert.ok(h.includes(s), s);
  });
} else console.log("SKIP  harness source check (public checkout)");
check("network calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
