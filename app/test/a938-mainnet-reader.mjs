// [A-938] Mainnet product reader: chain-profile "monad-mainnet" carries a read-only rpcUrl and main.js passes it (+ fetch + clock) to
// readSecondCurrent at its two calls. Node only, network 0 (global fetch throws; the mock world = second-current-reader.mjs world(), copied
// verbatim below with only URL_ changed). Testnet / blocked profiles: no rpcUrl → rows stay no_rpc, fetch called 0 times.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult } from "viem";

import { resolveChainProfile } from "../src/chain-profile.js";
import { ABIL_RECORDED, CURRENT_READER_STATUS as S, SECOND_READER_ROUTE_IDS, readSecondCurrent, routeSecondCurrentRead, vendoredSelectorsMatchLane } from "../src/second-current-reader.js";
import { ABIL_POOL_VIEW_ABI, ABIL_ROUTER_VIEW_ABI, ERC20_DECIMALS_VIEW_ABI, ERC20_VIEW_ABI, ERC4626_VIEW_ABI, POOL_VIEW_ABI } from "../src/abi/second-reader-abi.js";
import { LANE_RECEIPT_TOKEN, buildLanePermissionPreview, decideCurrentCandidates } from "../src/mainnet-job-lane.js";
import { validateDecisionReceipt } from "../src/second-journey-state.js";
import { RETURN_READ_METHODS } from "../src/second-job-readiness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };

const URL_ = "https://rpc.monad.xyz"; // [A-938] = the mainnet profile rpcUrl; every request goes to the stub fetch below, never the network
const NOW = "2026-10-03T00:00:00Z";
const PROFILE = resolveChainProfile("monad-mainnet");
const USDC = PROFILE.usdc.address;
const PIGGY = "0x1111111111111111111111111111111111111111";
const AAVE_POOL = "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef";
const NEVER_POOL = "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585";
const CURVANCE = "0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774";
const KINTSU = "0xA3227C5969757783154C60bF0bC1944180ed81B9";
const NEVER_RECEIPT = "0x2222222222222222222222222222222222222222";
const PROTECT_TOKEN = "0x3333333333333333333333333333333333333333";
const SPENDER = "0x4444444444444444444444444444444444444444";
const BLOCK = 109000000;
const CONFIG = (6n << 48n) | (1n << 56n);
const ZERO = "0x0000000000000000000000000000000000000000";
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function world({ neverAave = true, curvanceAsset = USDC, kintsuFee = 10 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, URL_);
    const req = JSON.parse(init.body);
    calls.push(req);
    const ok = (result) => ({ ok: true, json: async () => ({ id: req.id, result }) });
    const err = () => ({ ok: true, json: async () => ({ id: req.id, error: { code: -32000, message: "unexpected" } }) });
    if (req.method === "eth_chainId") return ok("0x8f");
    if (req.method === "eth_blockNumber") return ok(`0x${BLOCK.toString(16)}`);
    if (req.method === "eth_getCode") { assert.equal(req.params[1], `0x${BLOCK.toString(16)}`); return ok("0x6080"); }
    if (req.method !== "eth_call") return err();
    const [{ to, data }, tag] = req.params;
    assert.equal(tag, `0x${BLOCK.toString(16)}`, "every call pinned to the one block");
    const word = (v) => ok(encodeAbiParameters([{ type: "uint256" }], [BigInt(v)]));
    const reserve = (aToken) => ok(encodeFunctionResult({ abi: POOL_VIEW_ABI, functionName: "getReserveData", result: {
      configuration: CONFIG, liquidityIndex: 0n, currentLiquidityRate: 0n, variableBorrowIndex: 0n, currentVariableBorrowRate: 0n, currentStableBorrowRate: 0n,
      lastUpdateTimestamp: 1, id: 0, aTokenAddress: aToken, stableDebtTokenAddress: ZERO, variableDebtTokenAddress: ZERO, interestRateStrategyAddress: ZERO,
      accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n } }));
    if (data === "0xfde73f7d" && eq(to, KINTSU)) return word(kintsuFee);
    if (eq(to, AAVE_POOL)) return reserve(LANE_RECEIPT_TOKEN.address);
    if (eq(to, NEVER_POOL)) return neverAave ? reserve(NEVER_RECEIPT) : err();
    // [A-716] aBIL pool / router / token answer with the recorded A-652 values.
    const R = ABIL_RECORDED;
    const v = (abi) => { try { return decodeFunctionData({ abi, data }); } catch { return null; } };
    const addrOut = (a) => ok(encodeAbiParameters([{ type: "address" }], [a]));
    if (eq(to, R.pool)) {
      const f = v(ABIL_POOL_VIEW_ABI)?.functionName;
      if (f === "token0") return addrOut(R.token);
      if (f === "token1") return addrOut(R.usdc);
      if (f === "fee") return word(R.fee);
      if (f === "factory") return addrOut(R.factory);
      if (f === "liquidity") return word("69905557358485131");
      return err();
    }
    if (eq(to, R.router)) return v(ABIL_ROUTER_VIEW_ABI) ? addrOut(R.factory) : err();
    if (eq(to, R.token)) {
      if (v(ERC20_DECIMALS_VIEW_ABI)) return word(R.tokenDecimals);
      const f = v(ERC20_VIEW_ABI)?.functionName;
      if (f === "balanceOf") return word(777);
      if (f === "allowance") return word(0);
      return err();
    }
    const fn = (() => { try { return [ERC4626_VIEW_ABI, ERC20_VIEW_ABI].map((abi) => { try { return decodeFunctionData({ abi, data }); } catch { return null; } }).find(Boolean); } catch { return null; } })();
    if (!fn) return err();
    if (eq(to, CURVANCE)) {
      if (fn.functionName === "asset") return ok(encodeAbiParameters([{ type: "address" }], [curvanceAsset]));
      if (fn.functionName === "balanceOf") return word(7000000);
      if (fn.functionName === "convertToAssets") return word(7100000);
      if (fn.functionName === "totalAssets") return word(900000000);
    }
    if (fn.functionName === "balanceOf" && eq(to, USDC)) return word(5000000);
    if (fn.functionName === "balanceOf" && eq(to, LANE_RECEIPT_TOKEN.address)) return word(123);
    if (fn.functionName === "balanceOf" && eq(to, NEVER_RECEIPT)) return word(456);
    if (fn.functionName === "allowance" && eq(to, USDC)) return word(0);
    if (fn.functionName === "allowance" && eq(to, PROTECT_TOKEN)) { assert.ok(eq(fn.args[1], SPENDER)); return word(99); }
    return err();
  };
  return { calls, input: { profile: PROFILE, piggyAddress: PIGGY, rpcUrl: URL_, fetchImpl, now: () => NOW, protectTarget: { token: PROTECT_TOKEN, spender: SPENDER } } };
}
const byId = (r, id) => r.candidates.find((c) => c.id === id);

let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-938 test: network forbidden"); };
const MAIN = readFileSync(path.join(HERE, "..", "src", "main.js"), "utf8");
const TESTNET = resolveChainProfile("monad-testnet");
const FIVE = ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"];
// exactly the main.js call shape (rpcUrl from the profile, a fetch, an ISO clock)
const productCall = (profile, fetchImpl) => readSecondCurrent({ profile, piggyAddress: PIGGY, rpcUrl: profile.rpcUrl, fetchImpl, now: () => NOW });

await check("profiles: mainnet rpcUrl = https://rpc.monad.xyz · testnet / default / blocked have none · liveExecution stays false", () => {
  assert.equal(PROFILE.rpcUrl, "https://rpc.monad.xyz");
  for (const p of [TESTNET, resolveChainProfile(undefined), resolveChainProfile("nope"), resolveChainProfile(" monad-mainnet")]) assert.equal(p.rpcUrl, undefined, p.id);
  for (const p of [PROFILE, TESTNET]) assert.equal(p.liveExecution, false);
});
await check("mainnet, product call shape → Aave row real-shaped with the pinned block · Neverland / Curvance read", async () => {
  const w = world();
  const r = await productCall(PROFILE, w.input.fetchImpl);
  const aave = byId(r, "aave-usdc");
  assert.equal(aave.status, S.AAVE_BUILDABLE);
  assert.equal(aave.read.block, BLOCK); assert.equal(aave.read.chainId, 143);
  assert.equal(aave.read.holdings.usdcRaw, "5000000");
  for (const id of ["neverland-usdc", "curvance-usdc"]) assert.notEqual(byId(r, id).status, S.READ_FAILED, id);
  assert.ok(w.calls.length > 0);
});
await check("mainnet: every request is a read-only method", async () => {
  const w = world(); await productCall(PROFILE, w.input.fetchImpl);
  for (const c of w.calls) assert.ok(RETURN_READ_METHODS.includes(c.method), c.method);
});
await check("testnet, same call shape → the five read rows stay no_rpc · fetch called 0 times", async () => {
  let n = 0;
  const r = await productCall(TESTNET, async () => { n += 1; throw new Error("must not be called"); });
  for (const id of FIVE) assert.deepEqual([byId(r, id).status, byId(r, id).reason], [S.READ_FAILED, "no_rpc"], id);
  assert.equal(n, 0);
});
await check("main.js: both readSecondCurrent calls pass the profile rpcUrl + fetch + ISO clock; no other rpcUrl source", () => {
  const callRe = /readSecondCurrent\(\{ profile: CHAIN_PROFILE, piggyAddress: state\.address \|\| "", rpcUrl: CHAIN_PROFILE\.rpcUrl, fetchImpl: fetch, now: \(\) => new Date\(\)\.toISOString\(\) \}\)/g;
  assert.equal([...MAIN.matchAll(callRe)].length, 2);
  assert.equal([...MAIN.matchAll(/readSecondCurrent\(/g)].length, 2);
});
await check("network 0 in this test", () => { assert.equal(netCalls, 0); });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
