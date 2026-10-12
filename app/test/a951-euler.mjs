// [A-951] Euler K3 WETH executor model (mainnet-job-euler.js): calldata byte-equal to the A-787 lane A fork harness encoding, every
// refusal path, the gate never allows (live off included), readiness never ready, constants = the A-787 run record. Node only, no network, no tx.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import * as EU from "../src/mainnet-job-euler.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-951 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "..", "src", "mainnet-job-euler.js"), "utf8");
// The private run record / harness, when this checkout has them (walk up: app/test or a private worktree copy).
const findPrivate = (rel) => { const p = privatePath(rel); return existsSync(p) ? p : null; }; // [A-1033] one root; pre-A-1033: walked up 6 parents from app/test
// Harness actor (a787-laneA-run.mjs :22) — the Piggy in every vector, so the comparison is against the exact recorded calls.
const ACTOR = "0x0e1aF437Cc134921dedA89ADaDe025f655b5B8e4";
// The harness's own ABI strings (a787-laneA-run.mjs :23 erc20 · :34 evAbi), copied verbatim — encoding with these is the harness encoding.
const H_ERC20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const H_EV = parseAbi(["function deposit(uint256,address) returns (uint256)", "function redeem(uint256,address,address) returns (uint256)"]);
const EV_VAULT = "0x2C803c8C3C57b9D4A9abA011615561315c2b6aC1", WETH = "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242"; // harness ADDR (:18)
const W1 = 10n ** 18n, SH = 991583922407801588n;
const SHARE_CAP = SH * 10100n / 10000n;
const call = (step, args) => { const r = EU.encodeEulerStep(step, { piggyAddress: ACTOR, ...args }); assert.equal(r.error, null, r.error); return r.call; };

// (a) calldata == harness
check("(a) approve == harness approve(WETH → vault, 1e18)", () => { const c = call("approve", { amountRaw: W1.toString() }); assert.equal(c.to, WETH); assert.equal(c.spender, EV_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [EV_VAULT, W1] })); assert.equal(c.data.slice(0, 10), "0x095ea7b3"); });
check("(a) deposit == harness deposit(1e18, actor)", () => { const c = call("deposit", { amountRaw: W1.toString() }); assert.equal(c.to, EV_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_EV, functionName: "deposit", args: [W1, ACTOR] })); assert.equal(c.data.slice(0, 10), "0x6e553f65"); });
check("(a) redeem == harness redeem(all shares, actor, actor)", () => { const c = call("redeem", { heldSharesRaw: SH.toString() }); assert.equal(c.to, EV_VAULT); assert.equal(c.data, encodeFunctionData({ abi: H_EV, functionName: "redeem", args: [SH, ACTOR, ACTOR] })); assert.equal(c.data.slice(0, 10), "0xba087652"); });
check("(a) never unlimited: approve amount is exactly the request", () => { const c = call("approve", { amountRaw: "5" }); assert.equal(c.amountRaw, "5"); assert.ok(!c.data.endsWith("f".repeat(64))); });

// (d) amount cap / pinned targets / unproven steps
const refuse = [
  ["approve", { amountRaw: (W1 + 1n).toString() }, "amount_above_fork_proven_size"],
  ["deposit", { amountRaw: (W1 + 1n).toString() }, "amount_above_fork_proven_size"],
  ["approve", { amountRaw: "0" }, "amount_not_exact"],
  ["approve", { amountRaw: "1.5" }, "amount_not_exact"],
  ["deposit", { amountRaw: 1000 }, "amount_not_exact"],
  ["redeem", {}, "shares_not_measured"],
  ["redeem", { heldSharesRaw: (SHARE_CAP + 1n).toString() }, "shares_above_fork_proven_position"],
  ["approve", { amountRaw: "1", token: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" }, "token_not_fork_proven"],
  ["approve", { amountRaw: "1", spender: "0x502e4a0B61dEBA3015Eb9E51116B832003B22c2C" }, "spender_not_fork_proven"],
  ["deposit", { amountRaw: "1", vault: "0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA" }, "vault_not_fork_proven"],
  ["redeem", { heldSharesRaw: "1", vault: "not-an-address" }, "vault_not_fork_proven"],
  ["withdraw", {}, "unproven_step:withdraw"],
  ["revoke", {}, "unproven_step:revoke"],
  ["depositAboveForkSize", {}, "unproven_step:depositAboveForkSize"],
  ["swap", {}, "unknown_step"],
];
for (const [step, args, want] of refuse) check(`(d) refuse ${step} ${JSON.stringify(args)} → ${want}`, () => assert.equal(EU.encodeEulerStep(step, { piggyAddress: ACTOR, ...args }).error, want));
check("(d) a matching (case-insensitive) pinned token / spender / vault is accepted", () => { const c = call("approve", { amountRaw: "1", token: WETH.toLowerCase(), spender: EV_VAULT, vault: EV_VAULT.toLowerCase() }); assert.equal(c.to, WETH); });
check("(d) refuse a missing / bad Piggy address", () => { assert.equal(EU.encodeEulerStep("approve", { amountRaw: "1" }).error, "missing_piggy_address"); assert.equal(EU.encodeEulerStep("approve", { amountRaw: "1", piggyAddress: ["0x" + "1".repeat(40)] }).error, "missing_piggy_address"); assert.equal(EU.encodeEulerStep("approve", null).error, "missing_piggy_address"); });
check("stage machine: only fork-proven transitions", () => {
  let s = EU.EULER_STAGE.NONE;
  for (const step of ["approve", "deposit", "redeem"]) { const r = EU.eulerStageAfter(s, step); assert.equal(r.error, null, `${step}: ${r.error}`); s = r.stage; }
  assert.equal(s, EU.EULER_STAGE.OUT);
  assert.equal(EU.eulerStageAfter(EU.EULER_STAGE.NONE, "redeem").error, "step_not_valid_from_stage");
  assert.equal(EU.eulerStageAfter(EU.EULER_STAGE.OUT, "revoke").error, "unproven_step:revoke");
  assert.equal(EU.eulerStageAfter("bogus", "approve").error, "unknown_stage");
});
check("unknown fields read UNKNOWN; proven fields read the pinned value", () => { assert.equal(EU.eulerField("slippageGuard"), "UNKNOWN"); assert.equal(EU.eulerField("nope"), "UNKNOWN"); assert.equal(EU.eulerField("vault"), EV_VAULT); });

// (c) gate refuses with live off; never allows
const offProfile = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", jobId: EU.EULER_JOB_ID, liveExecution: false, usdc: { symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 } };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110746900, send: () => {}, receipt: () => {} };
const PIGGY = { id: "p", address: ACTOR };
check("(c) gate with liveExecution false refuses every proven step (profile binds no WETH)", () => {
  for (const step of ["approve", "deposit", "redeem"]) { const g = EU.eulerExecutionGate({ profile: offProfile, piggy: PIGGY, executor: forkExec, step }); assert.equal(g.allowed, false); assert.equal(g.liveExecution, false); assert.equal(g.executionPermission, false); assert.equal(g.reason, "asset_not_in_profile"); }
});
check("(c) gate refuses a live profile, a non-Euler profile, no profile, an unproven step", () => {
  assert.equal(EU.eulerExecutionGate({ profile: { ...offProfile, liveExecution: true }, piggy: PIGGY, executor: forkExec, step: "approve" }).reason, "live_execution_disabled");
  assert.equal(EU.eulerExecutionGate({ profile: { ...offProfile, jobId: "aave-usdc" }, piggy: PIGGY, executor: forkExec, step: "approve" }).reason, "profile_not_euler_lane");
  assert.equal(EU.eulerExecutionGate({ profile: null, piggy: PIGGY, step: "approve" }).reason, "profile_blocked");
  assert.equal(EU.eulerExecutionGate({ profile: offProfile, piggy: PIGGY, executor: forkExec, step: "withdraw" }).reason, "unproven_step:withdraw");
  assert.equal(EU.eulerExecutionGate(undefined).allowed, false);
});
check("(c) permission request issues nothing: WETH is not a profile asset today", () => {
  assert.deepEqual(EU.eulerPermissionRequest({ profile: offProfile, piggy: PIGGY, amountRaw: "1" }), { request: null, error: "asset_not_in_profile" });
  assert.equal(EU.eulerPermissionRequest({ profile: { ...offProfile, status: "blocked" }, piggy: PIGGY, amountRaw: "1" }).error, "profile_blocked");
  assert.equal(EU.eulerPermissionRequest({ profile: { ...offProfile, id: "monad-testnet", numericChainId: 10143, scope: "monad-testnet" }, piggy: PIGGY, amountRaw: "1" }).error, "profile_chain_not_euler_evidence");
});
check("readiness never ready / executable / live, fork review conditions listed open", () => { const r = EU.eulerReadiness({ stage: "exited", profile: { ...offProfile, liveExecution: true }, executor: forkExec }); assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.liveExecution, false); assert.equal(r.executionPermission, false); assert.ok(r.blockedBy.includes("fork_review_conditions_open")); assert.ok(r.blockedBy.includes("unknown_field:slippageGuard")); assert.equal(EU.eulerReadiness({ stage: "x" }).stage, "unknown"); });
check("header keeps the 9 fork review conditions OPEN", () => { assert.equal((SRC.match(/^\/\/ {3}\[ \] \d+ /gm) || []).length, 9); assert.ok(!/\[x\]/i.test(SRC)); });
check("module imports no executor / signer / network; no card id or private path in shipped strings", () => {
  const code = SRC.replace(/^\/\/.*$/gm, "");
  assert.ok(!/money-executor|executeMoneyStep|issuePermission|fetch\(|createWalletClient|sendTransaction/.test(code));
  assert.deepEqual([...SRC.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort(), ["./chain-profile.js", "./mainnet-job-common.js", "./permission-envelope.js", "./second-job-readiness.js", "viem"]);
  assert.equal(PRIVATE_RE.test(SRC), false); assert.equal(/\bA-\d{3}\b/.test(SRC), false);
});

// (b) constants == the recorded harness values
const RUN = findPrivate("ops/receipts/A787_second_broad_fork/laneA/raw_run.json");
const HARNESS = findPrivate("ops/harness/a787-laneA-run.mjs");
if (RUN) {
  const r = JSON.parse(readFileSync(RUN, "utf8")), E = r.euler, rt = E.noWarp_round_trip, F = EU.EULER_FORK_EVIDENCE;
  check("(b) constants == the A-787 run record (pin · vault · asset · queues · measured · gas)", () => {
    assert.equal(r.meta.chainId, F.chainId); assert.equal(r.meta.pin.number, F.block); assert.equal(new Date(r.meta.pin.timestamp * 1000).toISOString().replace(".000Z", "Z"), F.blockTimestamp);
    assert.equal(E.identity.vault, F.vault); assert.equal(E.state.asset, F.asset.address); assert.equal(E.state.name, F.vaultName); assert.equal(E.state.symbol, F.shareSymbol);
    assert.equal(E.state.supplyQueue0, F.strategyVault); assert.equal(E.state.withdrawQueue0, F.strategyVault);
    assert.equal(E.state.previewDeposit_1WETH, F.measured.previewSharesRaw); assert.equal(rt.sharesMinted, F.measured.realizedSharesRaw);
    assert.equal(rt.maxRedeem, F.measured.maxRedeemRaw); assert.equal(rt.previewRedeem, F.measured.previewRedeemRaw);
    assert.equal(rt.wethReturned, F.measured.returnedRaw); assert.equal(rt.netDeltaWei, F.measured.deltaRaw); assert.equal(rt.wethDeposited, F.sentRaw);
    assert.equal(E.state.fee, F.measured.feeAtPin); assert.equal(E.state.lostAssets, F.measured.lostAssetsAtPin); assert.equal(E.state.timelock, F.measured.timelockSecondsAtPin);
    assert.equal(Number(rt.approve.gasUsed), F.gasUsed.approve); assert.equal(Number(rt.deposit.gasUsed), F.gasUsed.deposit); assert.equal(Number(rt.redeem.gasUsed), F.gasUsed.redeem);
    for (const t of [rt.approve, rt.deposit, rt.redeem]) assert.equal(t.status, "SUCCESS");
    assert.equal(r.meta.actor, ACTOR);
  });
  check("(a) app calldata == the recorded harness call args (approve · deposit · redeem)", () => {
    assert.equal(call("approve", { amountRaw: rt.approve.args[1] }).data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [rt.approve.args[0], BigInt(rt.approve.args[1])] }));
    assert.equal(rt.approve.to, F.asset.address); assert.equal(rt.deposit.to, F.vault); assert.equal(rt.redeem.to, F.vault);
    assert.equal(call("deposit", { amountRaw: rt.deposit.args[0] }).data, encodeFunctionData({ abi: H_EV, functionName: "deposit", args: [BigInt(rt.deposit.args[0]), rt.deposit.args[1]] }));
    assert.equal(call("redeem", { heldSharesRaw: rt.redeem.args[0] }).data, encodeFunctionData({ abi: H_EV, functionName: "redeem", args: [BigInt(rt.redeem.args[0]), rt.redeem.args[1], rt.redeem.args[2]] }));
  });
} else console.log("SKIP  constants vs the private A-787 run record (public checkout)");
if (HARNESS) {
  check("(b) harness source still names the same vault / WETH / ABI strings", () => {
    const h = readFileSync(HARNESS, "utf8");
    assert.ok(h.includes(`EV_VAULT: "${EV_VAULT}"`)); assert.ok(h.includes(`WETH: "${WETH}"`));
    assert.ok(h.includes('"function deposit(uint256,address) returns (uint256)"')); assert.ok(h.includes('"function redeem(uint256,address,address) returns (uint256)"'));
    assert.ok(h.includes('"function approve(address,uint256) returns (bool)"'));
  });
} else console.log("SKIP  harness source check (public checkout)");
check("network calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
