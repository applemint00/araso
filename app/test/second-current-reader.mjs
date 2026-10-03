// [A-694] Second S1 current reader. Node only, no network: `fetch` is replaced by a thrower and the
// reader gets a local fake transport. Nothing here opens a socket.
//   node app/test/second-current-reader.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult } from "viem";

import { resolveChainProfile } from "../src/chain-profile.js";
import { CURRENT_READER_STATUS as S, readSecondCurrent, vendoredSelectorsMatchLane } from "../src/second-current-reader.js";
import { ERC20_VIEW_ABI, ERC4626_VIEW_ABI, POOL_VIEW_ABI } from "../src/abi/second-reader-abi.js";
import { LANE_RECEIPT_TOKEN } from "../src/mainnet-job-lane.js";
import { RETURN_READ_METHODS } from "../src/second-job-readiness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };

const URL_ = "https://fork.local.invalid/rpc";
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

// 1. Full read: per-candidate statuses and values.
{
  const w = world();
  const r = await readSecondCurrent(w.input);
  assert.equal(r.candidates.length, 9);
  assert.deepEqual(r.candidates.map((c) => c.id), ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon", "abil-spot", "kuru", "merkl", "move"]);
  const aave = byId(r, "aave-usdc");
  assert.equal(aave.status, S.AAVE_BUILDABLE);
  assert.equal(aave.read.holdings.usdcRaw, "5000000");
  assert.equal(aave.read.holdings.receiptRaw, "123");
  assert.equal(aave.read.receiptToken.matchesRecorded, true);
  const nev = byId(r, "neverland-usdc");
  assert.equal(nev.status, S.NEVERLAND_DERIVED_ASSUMED);
  assert.equal(nev.read.receiptToken.derived, true);
  assert.equal(nev.read.holdings.receiptRaw, "456");
  assert.ok(nev.assumptions.length >= 1);
  const cur = byId(r, "curvance-usdc");
  assert.equal(cur.status, S.CURVANCE_ERC4626);
  assert.deepEqual(cur.read.holdings, { sharesRaw: "7000000", assetsRaw: "7100000" });
  const pro = byId(r, "protect-revoke-allowance");
  assert.equal(pro.status, S.PROTECT_CALLER_SUPPLIED);
  assert.equal(pro.read.allowanceRaw, "99");
  const kin = byId(r, "kintsu-smon");
  assert.equal(kin.status, S.KINTSU_OBSERVATION);
  assert.equal(kin.read.exitFeeBips, 10);
  assert.equal(byId(r, "abil-spot").status, S.ABIL_QUOTE_INCOMPLETE);
  assert.equal(byId(r, "abil-spot").read, null);
  for (const id of ["kuru", "merkl", "move"]) assert.equal(byId(r, id).status, S.UNAVAILABLE);

  // No go / permission vocabulary anywhere in the output.
  const text = JSON.stringify(r);
  assert.ok(!/READY/.test(text), "output never contains READY");
  assert.ok(!/executionPermission/.test(text), "output never contains executionPermission");
  assert.ok(!/permission/i.test(text.replace(/"reason":"[^"]*"/g, "")), "no permission field");

  // Read-only JSON-RPC only.
  assert.ok(w.calls.length > 20);
  for (const c of w.calls) assert.ok(RETURN_READ_METHODS.includes(c.method), `method ${c.method} is read-only`);
}

// 2. No transport / no rpc: nothing read, static rows kept, never throws.
{
  const none = await readSecondCurrent({ profile: PROFILE, piggyAddress: PIGGY });
  assert.equal(byId(none, "aave-usdc").status, S.READ_FAILED);
  assert.equal(byId(none, "aave-usdc").reason, "no_rpc");
  assert.equal(byId(none, "kintsu-smon").read, null);
  assert.equal(byId(none, "abil-spot").status, S.ABIL_QUOTE_INCOMPLETE);
  const noFetch = await readSecondCurrent({ profile: PROFILE, piggyAddress: PIGGY, rpcUrl: URL_ });
  assert.equal(byId(noFetch, "curvance-usdc").reason, "no_transport");
  const http = await readSecondCurrent({ profile: PROFILE, piggyAddress: PIGGY, rpcUrl: "http://x.invalid", fetchImpl: async () => { throw new Error("x"); }, now: () => NOW });
  assert.equal(byId(http, "neverland-usdc").reason, "no_rpc");
  const down = await readSecondCurrent({ ...world().input, fetchImpl: async () => { throw new Error("down"); } });
  for (const id of ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"]) {
    assert.equal(byId(down, id).status, S.READ_FAILED);
    assert.equal(byId(down, id).read, null);
  }
  const badAddr = await readSecondCurrent({ ...world().input, piggyAddress: "nope" });
  assert.equal(byId(badAddr, "aave-usdc").reason, "missing_piggy_address");
}

// 3. Assumptions failing are reported, not hidden.
{
  const notAave = await readSecondCurrent(world({ neverAave: false }).input);
  assert.equal(byId(notAave, "neverland-usdc").status, S.READ_FAILED);
  assert.equal(byId(notAave, "neverland-usdc").read, null);
  const wrongAsset = await readSecondCurrent(world({ curvanceAsset: PROTECT_TOKEN }).input);
  assert.equal(byId(wrongAsset, "curvance-usdc").status, S.ASSUMPTION_BROKEN);
  const feeChanged = await readSecondCurrent(world({ kintsuFee: 11 }).input);
  assert.equal(byId(feeChanged, "kintsu-smon").status, S.KINTSU_OBSERVATION, "reader reports the value; judging it is not its job");
  assert.equal(byId(feeChanged, "kintsu-smon").read.exitFeeBips, 11);
}

// 4. Protect never guesses a target.
{
  const w = world();
  const r = await readSecondCurrent({ ...w.input, protectTarget: null });
  assert.equal(byId(r, "protect-revoke-allowance").status, S.TARGET_MISSING);
  const r2 = await readSecondCurrent({ ...w.input, protectTarget: { token: PROTECT_TOKEN } });
  assert.equal(byId(r2, "protect-revoke-allowance").status, S.TARGET_MISSING);
}

// 5. Vendored ABI: selectors match the lane, view functions only.
{
  assert.equal(vendoredSelectorsMatchLane(), true);
  for (const abi of [ERC20_VIEW_ABI, POOL_VIEW_ABI, ERC4626_VIEW_ABI]) for (const f of abi) assert.equal(f.stateMutability, "view", `${f.name} is view`);
}

// 6. Static: no send / sign / broadcast symbol reachable from the reader or its vendored ABI.
{
  const files = [path.join(HERE, "../src/second-current-reader.js"), ...readdirSync(path.join(HERE, "../src/abi")).map((f) => path.join(HERE, "../src/abi", f))];
  const FORBIDDEN = /sendTransaction|sendRawTransaction|eth_send|eth_sign|personal_sign|signMessage|signTypedData|signTransaction|writeContract|simulateContract|privateKey|mnemonic|walletClient|createWalletClient|"approve"|"supply"|"withdraw"|"deposit"|"redeem"|nonpayable|payable/;
  for (const f of files) {
    const code = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!FORBIDDEN.test(code), `${path.basename(f)} has no write/sign symbol`);
  }
  const src = readFileSync(files[0], "utf8");
  assert.ok(!/from "\.\/main\.js"|document\.|window\.|localStorage/.test(src), "no UI / storage coupling");
  assert.ok(!/https?:\/\/[a-z0-9]/i.test(src.replace(/\^https:\\\/\\\/[^\n]*/g, "").replace(/\/\/ .*/g, "")), "no URL constant");
}

console.log("second-current-reader: PASS");
