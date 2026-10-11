// [A-955] Lab-fork run record: native MON bound on the fork profile → FastLane shMON deposit → redeem (app calldata), one round trip on a
// local anvil fork (chain 31337143, pin 110746900, read-only proxy). The run itself is the private harness (a955-fork.mjs next to the
// record); this suite re-checks its record against the app modules, node only, no network. Skips in a checkout without the record.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData } from "viem";
import * as CP from "../src/chain-profile.js";
import * as SM from "../src/mainnet-job-shmon.js";
import { mapForkMoneySplit } from "../src/receipt-evidence-second.js";
import { FORK_CHAIN_ID } from "../src/funding-context.js";

globalThis.fetch = async () => { throw new Error("A-955 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.resolve(HERE, "..", "..", "_private/ops/receipts/A955_fork_assets/fork/raw/run.json");
if (!existsSync(RUN)) { console.log("SKIP  no lab-fork record in this checkout"); process.exit(0); }
const r = JSON.parse(readFileSync(RUN, "utf8"));
const s = r.shmon;
const E = SM.SHMON_FORK_EVIDENCE;
const shmonAbi = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "redeem", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
];

check("ran on a local fork only: chain 31337143 (not 143), pinned block hash = the shMON record, no send-like method forwarded upstream", () => {
  assert.equal(r.chainId, FORK_CHAIN_ID); assert.equal(r.chainIdLocal, FORK_CHAIN_ID); assert.notEqual(r.chainIdLocal, 143);
  assert.equal(r.pin, E.block); assert.equal(r.pinHashEqualsRecord, true); assert.equal(r.pinnedBlock.hash, E.blockHash);
  assert.equal(r.proxy.sendLikeForwarded, 0); assert.equal(r.proxy.refused.length, 0); assert.equal(r.notARealMainnetTx, true);
  assert.match(r.anvilCommand, /--host 127\.0\.0\.1 /); assert.match(r.anvilCommand, /--chain-id 31337143 /);
});
check("no anvil left: the harness's own anvil exited and its pid was gone after the kill", () => {
  assert.equal(r.anvilExited.exitCode === 0 || r.anvilExited.signal === "SIGTERM", true); assert.equal(r.anvilPidAliveAfterKill, false);
});
check("the binding the run used = the app's fork MON binding today (native, token null, 18 dp) and no ERC-20 path for it", () => {
  const today = CP.bindRecordToProfile(CP.resolveChainProfile("monad-fork", { rpcUrl: "https://lab-fork.invalid", forkInstanceId: "a955lab" }), { piggyId: "lab-piggy", piggyAddress: s.binding.piggyAddress, asset: "MON" });
  assert.deepEqual(s.binding, JSON.parse(JSON.stringify(today.binding)));
  assert.deepEqual(s.erc20PathOfBinding, { token: null, error: "native_asset_not_erc20" });
  assert.equal(s.permissionOnFork, "profile_chain_not_shmon_evidence"); assert.equal(s.gateOnFork, "profile_not_shmon_lane");
});
check("deposit 1 MON → redeem all: both success, calldata = the app module's for the bound Piggy, shares / return / gas = the shMON record", () => {
  const [dep, red] = s.steps;
  assert.deepEqual([dep.status, red.status], ["success", "success"]);
  assert.equal(dep.valueWei, E.sentWei); assert.equal(red.valueWei, "0");
  assert.equal(s.depositCalldataEqualsHarness, true); assert.equal(s.redeemCalldataEqualsHarness, true);
  const appDep = SM.encodeShmonStep("deposit", { piggyAddress: s.binding.piggyAddress, amountWei: E.sentWei, valueWei: E.sentWei }).call;
  assert.equal(appDep.data, encodeFunctionData({ abi: shmonAbi, functionName: "deposit", args: [BigInt(E.sentWei), s.binding.piggyAddress] }));
  assert.equal(dep.selector, SM.SHMON_STEPS.deposit.selector); assert.equal(red.selector, SM.SHMON_STEPS.redeem.selector);
  assert.deepEqual(s.compareRecord, { sharesMintedEqual: true, returnedEqual: true, gasEqual: true });
  assert.equal(s.balances.sharesAfterExitRaw, "0");
});
check("grant · job input · gas stay three fields (re-mapped by the app adapter = the recorded split); the deposit leg reconciles exactly", () => {
  assert.equal(s.grant.how, "anvil_setBalance"); assert.equal(s.roundTrip.depositLegReconciles, true);
  const again = mapForkMoneySplit({ chainId: FORK_CHAIN_ID, chain: "monad-fork", piggyAddress: s.binding.piggyAddress,
    virtualGrant: { asset: "MON", amountRaw: s.grant.amountRaw, native: true, grantVersion: "a955lab" },
    jobInput: { asset: "MON", amountRaw: s.roundTrip.jobInputWei, native: true, jobId: SM.SHMON_JOB_ID, step: "deposit" },
    gas: { asset: "MON", feeWei: s.roundTrip.gasWei, gasUsed: String(Number(s.steps[0].gasUsed) + Number(s.steps[1].gasUsed)) } });
  assert.deepEqual(s.moneySplit, JSON.parse(JSON.stringify(again)));
  assert.equal(BigInt(s.moneySplit.split.gas.feeWei), BigInt(s.steps[0].feeWei) + BigInt(s.steps[1].feeWei));
  assert.notEqual(s.moneySplit.split.virtualGrant.amountRaw, s.moneySplit.split.jobInput.amountRaw);
});
check("WETH / AUSD / USDC read on the fork (symbol + decimals + code) = the fork asset table rows", () => {
  for (const sym of ["WETH", "AUSD", "USDC"]) {
    const row = r.assetReads[sym];
    assert.equal(row.equal, true, sym); assert.equal(row.onFork.symbol, sym);
    assert.equal(row.table.address, CP.resolveChainProfile("monad-fork", { rpcUrl: "https://x.invalid", forkInstanceId: "x" }).assets[sym].address);
    assert.equal(row.onFork.decimals, row.table.decimals); assert.ok(row.onFork.codeBytes > 0);
  }
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
