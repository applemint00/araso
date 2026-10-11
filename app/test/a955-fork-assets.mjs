// [A-955] Fork-only asset table (chain-profile.js): the 10 Job binding rows · native MON never on an ERC-20 path · 143 + 10143 binding
// output byte-identical to the pre-change code (sha256 pins) · WETH / AUSD / MON on non-fork profiles = asset_not_in_profile · a caller's
// profile object cannot add an asset · binding opens no execution (gates / permission requests still refuse; only a local_fork executor
// on the fork chain id gets past the executor check, and the gate still ends refused) · receipt money split (grant · job input · gas).
// Node only, no network, no tx.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as CP from "../src/chain-profile.js";
import * as EU from "../src/mainnet-job-euler.js";
import * as UP from "../src/mainnet-job-upshift.js";
import * as SM from "../src/mainnet-job-shmon.js";
import * as KU from "../src/mainnet-job-kuru.js";
import * as RV from "../src/mainnet-job-revoke.js";
import * as NV from "../src/mainnet-job-neverland.js";
import * as CV from "../src/mainnet-job-curvance.js";
import * as LP from "../src/mainnet-job-lp.js";
import * as KT from "../src/mainnet-job-kintsu.js";
import * as AB from "../src/mainnet-job-abil.js";
import { mapForkMoneySplit, mapSecondEvidence, FORK_MONEY_SPLIT_SCHEMA } from "../src/receipt-evidence-second.js";
import { FORK_CHAIN_ID } from "../src/funding-context.js";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-955 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };

const PIGGY_ADDR = "0xA98d88b97c59194f5DB518bE07A4DB23AEc0BE31";
const PIGGY = { id: "piggy-1", address: PIGGY_ADDR };
const FORK = CP.resolveChainProfile("monad-fork", { rpcUrl: "https://lab-fork.invalid", forkInstanceId: "a955" });
const MAINNET = CP.resolveChainProfile("monad-mainnet");
const TESTNET = CP.resolveChainProfile(undefined);
const USDC_143 = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const USDC_10143 = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const WETH = "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242"; // harness-measured (mainnet fork run, block 110746900): 1 WETH = 1e18 raw
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"; // harness-measured (same run): 100 AUSD = 100e6 raw
const bind = (profile, asset) => CP.bindRecordToProfile(profile, { piggyId: PIGGY.id, piggyAddress: PIGGY_ADDR, asset });

// ── 1. the 10 Job binding rows (asset = what each module passes to bindRecordToProfile) ──────────────────────────────────────────
const ROWS = [
  ["Aave v3 USDC", "USDC"], ["Neverland USDC", "USDC"], ["Curvance USDC", "USDC"], ["FastLane shMON", SM.SHMON_FORK_EVIDENCE.entryAsset.symbol],
  ["Euler K3 WETH", EU.EULER_FORK_EVIDENCE.asset.symbol], ["Kuru swap", "USDC"], ["Kuru limit", "USDC"], ["USDC revoke", "USDC"],
  ["Curve LP", "USDC"], ["Upshift earnAUSD", UP.UPSHIFT_FORK_EVIDENCE.asset.symbol],
];
const WANT_FORK = { USDC: [USDC_143, 6, false], MON: [null, 18, true], WETH: [WETH, 18, false], AUSD: [AUSD, 6, false] };
check("10 Job rows: every Job's input asset binds on the fork profile (USDC · MON native · WETH · AUSD), token + decimals = the table", () => {
  assert.equal(ROWS.length, 10);
  for (const [job, asset] of ROWS) {
    const { binding, error } = bind(FORK, asset);
    assert.equal(error, null, job);
    const [token, decimals, native] = WANT_FORK[asset];
    assert.deepEqual([binding.chainId, binding.chain, binding.asset, binding.token, binding.decimals, binding.native === true], [FORK_CHAIN_ID, "monad-fork", asset, token, decimals, native], job);
    assert.ok(Object.isFrozen(binding));
  }
});
check("10 Job rows on 143 / 10143: USDC rows bind as before; MON / WETH / AUSD rows = asset_not_in_profile", () => {
  for (const [job, asset] of ROWS) for (const [p, usdc] of [[MAINNET, USDC_143], [TESTNET, USDC_10143]]) {
    const r = bind(p, asset);
    if (asset === "USDC") { assert.equal(r.error, null, job); assert.equal(r.binding.token, usdc); assert.equal("native" in r.binding, false); }
    else assert.deepEqual(r, { binding: null, error: "asset_not_in_profile" }, `${job} on ${p.id}`);
  }
});
check("Euler WETH / Upshift AUSD / shMON MON bind on the fork with the Job modules' own pinned address + decimals", () => {
  const w = bind(FORK, "WETH").binding, a = bind(FORK, "AUSD").binding, m = bind(FORK, "MON").binding;
  assert.equal(w.token, EU.EULER_FORK_EVIDENCE.asset.address); assert.equal(w.decimals, EU.EULER_FORK_EVIDENCE.asset.decimals);
  assert.equal(a.token, UP.UPSHIFT_FORK_EVIDENCE.asset.address); assert.equal(a.decimals, UP.UPSHIFT_FORK_EVIDENCE.asset.decimals);
  assert.equal(m.decimals, SM.SHMON_FORK_EVIDENCE.entryAsset.decimals); assert.equal(m.native, SM.SHMON_FORK_EVIDENCE.entryAsset.native);
});
check("the fork table holds exactly USDC · MON · WETH · AUSD (only the assets the audit needs); case / unknown / prototype names refused", () => {
  assert.deepEqual(Object.keys(FORK.assets).sort(), ["AUSD", "MON", "USDC", "WETH"]);
  assert.ok(Object.isFrozen(FORK.assets)); for (const r of Object.values(FORK.assets)) assert.ok(Object.isFrozen(r));
  assert.deepEqual(FORK.assets.MON, { symbol: "MON", address: null, decimals: 18, native: true });
  for (const a of ["usdc", "mon", "shMON", "earnAUSD", "k3WETH", "USDT0", "WMON", "__proto__", "toString", "constructor", "", null, 1]) assert.equal(bind(FORK, a).error, "asset_not_in_profile", String(a));
  assert.equal(MAINNET.assets, undefined); assert.equal(TESTNET.assets, undefined);
});

// ── 2. 143 / 10143 binding output byte-identical (pins computed from the pre-change chain-profile.js) ────────────────────────────
function bindingMatrix(profile) {
  const P = { piggyId: "piggy-1", piggyAddress: PIGGY_ADDR };
  const assets = [undefined, "USDC", "MON", "WETH", "AUSD", "usdc", "", null, 1, "shMON", "__proto__", "toString", "constructor"];
  const piggies = [P, { ...P, piggyId: " " }, { ...P, piggyAddress: "0x12" }, {}];
  const rows = [];
  for (const a of assets) for (const p of piggies) rows.push(CP.bindRecordToProfile(profile, a === undefined ? p : { ...p, asset: a }));
  rows.push(CP.bindRecordToProfile(profile));
  const good = CP.bindRecordToProfile(profile, P).binding;
  const recs = good ? [good, { ...good, asset: "MON" }, { ...good, asset: "WETH", token: WETH, decimals: 18 },
    { ...good, native: true }, { ...good, token: null }, { ...good, decimals: 18 }, { ...good, chainId: 1 }, { ...good, piggyId: "x" }, {}, null] : [null];
  for (const r of recs) rows.push(CP.checkRecordBinding(r, profile, { piggyId: P.piggyId, piggyAddress: P.piggyAddress }));
  rows.push(JSON.parse(JSON.stringify(profile)));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
check("143 binding HASH unchanged (bind × check × profile object, sha256 = pre-change value)", () => {
  assert.equal(bindingMatrix(MAINNET), "2cca8cd8f8ef92b550f2fd08f8914342b5ecbe2f8fcdfb4acb59ea77d94a7b4c");
  assert.equal(bindingMatrix(CP.resolveChainProfile("143")), "78d5b9e1755e77c81c2d09bcf94f9614bddfe10268d39f0a1c291b206e96963a"); // blocked "143" string
});
check("10143 binding HASH unchanged (explicit id and the unset default)", () => {
  assert.equal(bindingMatrix(CP.resolveChainProfile("monad-testnet")), "9c232df66cbf062a45d00d2c6944fde9bd401a5c2a1fc2f4b3bb5c8bbd087b4c");
  assert.equal(bindingMatrix(CP.resolveChainProfile("")), "a4711c66f8f8d1f108b2778df3da2b728af3b4d6b9f4004392bc5a2275271fe7");
});

// ── 3. no asset injection through a caller's profile object ───────────────────────────────────────────────────────────────────
check("a forged profile cannot add / replace / remove a row: 143 + forged assets table still binds USDC only; fork ignores its own `assets` field", () => {
  const evil = { WETH: { symbol: "WETH", address: WETH, decimals: 18 }, MON: { symbol: "MON", address: null, decimals: 18, native: true } };
  for (const a of ["WETH", "MON", "AUSD"]) assert.equal(bind({ ...MAINNET, assets: evil }, a).error, "asset_not_in_profile", a);
  assert.equal(bind({ ...MAINNET, assets: evil }, "USDC").binding.token, USDC_143);
  assert.equal(bind({ ...TESTNET, assets: evil }, "WETH").error, "asset_not_in_profile");
  const forkSwap = { ...FORK, assets: { WETH: { symbol: "WETH", address: "0x0000000000000000000000000000000000000001", decimals: 6 } }, usdc: { symbol: "USDC", address: "0x0000000000000000000000000000000000000002", decimals: 18 } };
  assert.equal(bind(forkSwap, "WETH").binding.token, WETH); assert.equal(bind(forkSwap, "USDC").binding.token, USDC_143); assert.equal(bind(forkSwap, "MON").binding.native, true);
  assert.equal(bind({ ...FORK, numericChainId: 143 }, "WETH").error, "profile_blocked");
});

// ── 4. native MON never on an ERC-20 path ────────────────────────────────────────────────────────────────────────────────────
const MON_B = bind(FORK, "MON").binding;
check("erc20TokenOfBinding: native MON binding refused (native_asset_not_erc20); ERC-20 bindings give their token", () => {
  assert.deepEqual(CP.erc20TokenOfBinding(MON_B), { token: null, error: CP.NATIVE_ASSET_NOT_ERC20 });
  assert.equal(CP.NATIVE_ASSET_NOT_ERC20, "native_asset_not_erc20");
  assert.deepEqual(CP.erc20TokenOfBinding({ ...bind(FORK, "WETH").binding, native: true }), { token: null, error: "native_asset_not_erc20" });
  for (const a of ["USDC", "WETH", "AUSD"]) assert.deepEqual(CP.erc20TokenOfBinding(bind(FORK, a).binding), { token: WANT_FORK[a][0], error: null });
  assert.equal(CP.erc20TokenOfBinding(null).error, "binding_missing"); assert.equal(CP.erc20TokenOfBinding({ token: "0x12" }).error, "binding_token_invalid");
});
const NOW_MS = Date.parse("2026-10-10T00:00:00Z");
const rd = (valueRaw, extra = {}) => ({ valueRaw, block: 1, readAt: new Date(NOW_MS - 1000).toISOString(), ...extra });
const live = (binding, extra = {}) => ({ piggyAddress: PIGGY_ADDR, binding, signerAddress: PIGGY_ADDR, nowMs: NOW_MS, ...extra });
check("a native MON binding on each ERC-20 approve / transfer / allowance path is refused (Euler · Upshift · Kuru · revoke live steps)", () => {
  assert.equal(EU.eulerLiveStep("approve", live(MON_B, { amountRaw: "1" })).error, "native_asset_not_erc20");
  assert.equal(EU.eulerLiveStep("deposit", live(MON_B, { amountRaw: "1" })).error, "native_asset_not_erc20");
  assert.equal(UP.upshiftLiveStep("approve", live(MON_B, { amountRaw: "1" })).error, "native_asset_not_erc20");
  for (const step of ["approveMarket", "approveMargin", "depositMargin", "revokeMarket"]) assert.equal(KU.kuruLiveStep(step, live(MON_B, { amountRaw: "1" })).error, "native_asset_not_erc20", step);
  assert.equal(RV.revokeLiveStep("revoke", live(MON_B, { spender: "aavePool", allowanceRaw: "1" })).error, "native_asset_not_erc20");
  // the same paths with a binding that is not native still meet their earlier refusals (unchanged)
  assert.match(EU.eulerLiveStep("approve", live(bind(FORK, "AUSD").binding, { amountRaw: "1" })).error, /^binding_asset_not_/);
  assert.match(UP.upshiftLiveStep("approve", live(bind(FORK, "WETH").binding, { amountRaw: "1" })).error, /^binding_asset_not_/);
});
check("the native MON path (shMON) builds a value-carrying call with no approve and no token; a WETH binding there is refused", () => {
  const dep = SM.shmonLiveStep("deposit", live(MON_B, { amountWei: "1000", minSharesRaw: "995", reads: { previewDeposit: rd("1000", { forRaw: "1000" }) } }));
  assert.equal(dep.error, null); assert.equal(dep.call.value, "1000"); assert.equal(dep.call.to, SM.SHMON_FORK_EVIDENCE.vault);
  assert.equal(dep.call.data.slice(0, 10), SM.SHMON_STEPS.deposit.selector);
  assert.equal(SM.shmonLiveStep("deposit", live(bind(FORK, "WETH").binding, { amountWei: "1000", minSharesRaw: "995", reads: { previewDeposit: rd("1000", { forRaw: "1000" }) } })).error, "binding_not_native_mon");
});

// ── 5. binding opens no execution ────────────────────────────────────────────────────────────────────────────────────────────
const LOCAL_FORK = { kind: "local_fork", chainId: FORK_CHAIN_ID, forkBlock: 110746900, send: () => { throw new Error("never"); }, receipt: () => { throw new Error("never"); } };
const LIVE_EXEC = { ...LOCAL_FORK, kind: "live" };
const GATES = [
  ["euler", EU.eulerExecutionGate, EU.EULER_JOB_ID, "approve", "WETH"], ["upshift", UP.upshiftExecutionGate, UP.UPSHIFT_JOB_ID, "approve", "AUSD"],
  ["shmon", SM.shmonExecutionGate, SM.SHMON_JOB_ID, "deposit", "MON"], ["kuru", KU.kuruExecutionGate, KU.KURU_JOB_ID, "sellMon", "USDC"],
  ["revoke", RV.revokeExecutionGate, RV.REVOKE_JOB_ID, "revoke", "USDC"],
];
check("after a fork binding passes, every gate still refuses: real fork profile (no Job) · forged Job · live executor · liveExecution true", () => {
  for (const [name, gate, jobId, step] of GATES) {
    assert.equal(gate({ profile: FORK, piggy: PIGGY, executor: LOCAL_FORK, step }).allowed, false);
    assert.match(gate({ profile: FORK, piggy: PIGGY, executor: LOCAL_FORK, step }).reason, /^profile_not_/);
    const named = { ...FORK, jobId };
    for (const ex of [null, LIVE_EXEC, { ...LOCAL_FORK, chainId: 143 }, LOCAL_FORK]) {
      const g = gate({ profile: named, piggy: PIGGY, executor: ex, step });
      assert.deepEqual([g.allowed, g.liveExecution, g.executionPermission], [false, false, false], `${name}`);
    }
    assert.equal(gate({ profile: named, piggy: PIGGY, executor: null, step }).reason, "no_executor", name);
    assert.equal(gate({ profile: named, piggy: PIGGY, executor: LIVE_EXEC, step }).reason, "live_execution_disabled", name);
    assert.equal(gate({ profile: named, piggy: PIGGY, executor: { ...LOCAL_FORK, chainId: 10143 }, step }).reason, "executor_chain_mismatch", name);
    assert.match(gate({ profile: named, piggy: PIGGY, executor: LOCAL_FORK, step }).reason, /^unknown_field:/, name); // only fork-local gets this far
    assert.equal(gate({ profile: { ...named, liveExecution: true }, piggy: PIGGY, executor: LOCAL_FORK, step }).reason, "live_execution_disabled", name);
  }
});
check("before the table these fork gates stopped at the binding; now they stop later — never at allowed (the binding is not the gate)", () => {
  for (const [name, gate, jobId, step, asset] of GATES) {
    const r = gate({ profile: { ...FORK, jobId }, piggy: PIGGY, executor: LOCAL_FORK, step });
    assert.notEqual(r.reason, "asset_not_in_profile", `${name} ${asset}`); assert.equal(r.allowed, false);
  }
});
check("permission requests issue nothing: the fork is refused by each evidence chain check; 143 still refused at the binding (WETH · AUSD · MON)", () => {
  // pre-A-965: the fork was refused here with profile_chain_not_{euler,upshift,shmon}_evidence. Now the chain line asks
  // chainMatchesExecutor (fork forkOf 143 = the evidence chain), so the fork builds the request — which still issues nothing.
  for (const r of [EU.eulerPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" }), UP.upshiftPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" }), SM.shmonPermissionRequest({ profile: FORK, piggy: PIGGY, amountWei: "1" })]) {
    assert.equal(r.error, null); assert.equal(r.request.permission, null); assert.equal(r.request.createsPermission, false); // pre-A-965
  }
  assert.equal(EU.eulerPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "1" }).error, "asset_not_in_profile");
  assert.equal(UP.upshiftPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "1" }).error, "asset_not_in_profile");
  assert.equal(SM.shmonPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountWei: "1" }).error, "asset_not_in_profile");
  assert.equal(KU.kuruPermissionRequest({ profile: FORK, piggy: PIGGY, action: KU.KURU_ACTION.SELL, amountRaw: "1" }).error, "native_mon_permission_not_modelled");
  for (const p of [FORK, MAINNET, TESTNET]) assert.equal(p.liveExecution, false);
});
check("the 6 existing executors on the fork profile: USDC bindings unchanged; their gates still refuse (no allowed)", () => {
  const ex = [[NV.neverlandExecutionGate, NV.NEVERLAND_JOB_ID, "approve"], [CV.curvanceExecutionGate, CV.CURVANCE_JOB_ID, "approve"], [LP.lpExecutionGate, LP.LP_JOB_ID, "approve"], [AB.abilExecutionGate, AB.ABIL_JOB_ID, "buy"]];
  for (const [gate, jobId, step] of ex) for (const e of [null, LOCAL_FORK, LIVE_EXEC]) assert.equal(gate({ profile: { ...FORK, jobId }, piggy: PIGGY, executor: e, step }).allowed, false);
  for (const lv of [false, true]) assert.equal(KT.kintsuExecutionGate({ profile: { ...FORK, jobId: KT.KINTSU_JOB_ID, liveExecution: lv }, piggy: PIGGY, executor: LOCAL_FORK, step: "deposit" }).allowed, false);
  assert.deepEqual(bind(FORK, "USDC"), CP.bindRecordToProfile({ ...FORK }, { piggyId: PIGGY.id, piggyAddress: PIGGY_ADDR }));
});
check("checkRecordBinding on the fork: each bound record re-checks ok; native/ERC-20 cross-overs and forged tokens refused", () => {
  for (const a of ["USDC", "MON", "WETH", "AUSD"]) assert.deepEqual(CP.checkRecordBinding(bind(FORK, a).binding, FORK, { piggyId: PIGGY.id, piggyAddress: PIGGY_ADDR }), { ok: true, reason: null }, a);
  const chk = (r) => CP.checkRecordBinding(r, FORK, { piggyId: PIGGY.id, piggyAddress: PIGGY_ADDR }).reason;
  assert.equal(chk({ ...MON_B, token: WETH }), "token_mismatch");
  const { native: _n, ...noNative } = MON_B; assert.equal(chk(noNative), "token_mismatch");
  assert.equal(chk({ ...bind(FORK, "WETH").binding, native: true }), "token_mismatch");
  assert.equal(chk({ ...bind(FORK, "WETH").binding, decimals: 6 }), "decimals_mismatch");
  assert.equal(chk({ ...MON_B, asset: "shMON" }), "asset_mismatch");
  assert.equal(CP.checkRecordBinding(bind(FORK, "WETH").binding, MAINNET, { piggyId: PIGGY.id, piggyAddress: PIGGY_ADDR }).reason, "chain_mismatch");
});

// ── 6. receipt money split: grant · job input · gas ─────────────────────────────────────────────────────────────────────────────
const SPLIT_IN = { chainId: FORK_CHAIN_ID, chain: "monad-fork", piggyAddress: PIGGY_ADDR,
  virtualGrant: { asset: "MON", amountRaw: "5000000000000000000", native: true, grantVersion: "v1" },
  jobInput: { asset: "MON", amountRaw: "1000000000000000000", native: true, jobId: SM.SHMON_JOB_ID, step: "deposit" },
  gas: { asset: "MON", feeWei: "36195422169034336", gasUsed: "192847" } };
check("mapForkMoneySplit: three separate fields, never summed, fork-only labels (no readRequest / seed)", () => {
  const r = mapForkMoneySplit(SPLIT_IN);
  assert.equal(r.ok, true); const s = r.split;
  assert.equal(s.schema, FORK_MONEY_SPLIT_SCHEMA); assert.equal(s.kind, "fork_money_split"); assert.equal(s.authority, "observation_only");
  assert.deepEqual(s.virtualGrant, { asset: "MON", amountRaw: "5000000000000000000", native: true, virtual: true, grantVersion: "v1" });
  assert.deepEqual(s.jobInput, { asset: "MON", amountRaw: "1000000000000000000", native: true, jobId: "fastlane-shmon", step: "deposit" });
  assert.deepEqual(s.gas, { asset: "MON", native: true, feeWei: "36195422169034336", gasUsed: "192847" });
  assert.deepEqual([s.summed, s.readEligible, s.readRequest, s.seed, s.chain.chainId], [false, false, null, null, String(FORK_CHAIN_ID)]);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.gas));
  assert.equal(JSON.stringify(s).includes("6036195422169034336"), false, "no summed total anywhere");
});
check("mapForkMoneySplit refusals: non-fork chain · gas not MON · non-raw amounts · empty", () => {
  assert.equal(mapForkMoneySplit({ ...SPLIT_IN, chainId: 143, chain: "monad-mainnet" }).reason, "not_fork_chain");
  assert.equal(mapForkMoneySplit({ ...SPLIT_IN, chainId: 10143, chain: "monad-testnet" }).reason, "not_fork_chain");
  assert.equal(mapForkMoneySplit({ ...SPLIT_IN, chain: "monad-mainnet" }).reason, "chain_mismatch");
  assert.equal(mapForkMoneySplit({ ...SPLIT_IN, gas: { asset: "USDC", feeWei: "1" } }).reason, "gas_not_native_mon");
  assert.equal(mapForkMoneySplit({ ...SPLIT_IN, jobInput: { asset: "WETH", amountRaw: "1.5" } }).reason, "jobInput_amount_not_raw");
  assert.equal(mapForkMoneySplit({ ...SPLIT_IN, virtualGrant: { asset: "MON", amountRaw: "-1" } }).reason, "virtualGrant_amount_not_raw");
  assert.equal(mapForkMoneySplit({ chainId: FORK_CHAIN_ID }).reason, "nothing_to_split");
  assert.equal(mapForkMoneySplit(null).reason, "record_invalid");
});
check("mapSecondEvidence: without forkMoney the result keeps its exact keys; with it, a new forkMoneySplit field (never a staged item)", () => {
  const base = mapSecondEvidence({ decisionReceipts: [] });
  assert.deepEqual(Object.keys(base), ["ok", "journey", "staged", "stateObservations", "refused"]);
  const withSplit = mapSecondEvidence({ decisionReceipts: [], forkMoney: SPLIT_IN });
  assert.deepEqual(Object.keys(withSplit), ["ok", "journey", "staged", "stateObservations", "refused", "forkMoneySplit"]);
  assert.equal(withSplit.staged.length, 0); assert.equal(withSplit.forkMoneySplit.jobInput.amountRaw, "1000000000000000000");
  const bad = mapSecondEvidence({ forkMoney: { ...SPLIT_IN, chainId: 143, chain: "monad-mainnet" } });
  assert.equal(bad.forkMoneySplit, null); assert.deepEqual(bad.refused, [{ source: "second.fork_money", reason: "not_fork_chain" }]);
});

check("no network was touched", () => assert.equal(fetchCalls, 0));
// [A-955 opus review] a forged profile whose id is an inherited Object key is never active and binds nothing.
{
  const CP = await import("../src/chain-profile.js");
  for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const forged = { id, status: "active", usdc: { symbol: "USDC", address: "0x" + "1".repeat(40), decimals: 6 } };
    if (CP.isProfileActive(forged) !== false) throw new Error(`forged id ${id} counted as active`);
    const b = CP.bindRecordToProfile(forged, { piggyId: "p", piggyAddress: "0x" + "2".repeat(40), asset: "USDC" });
    if (b.binding !== null) throw new Error(`forged id ${id} bound`);
  }
  console.log("PASS  forged inherited-key profile ids (__proto__ / constructor / toString / hasOwnProperty) are never active and bind nothing");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
