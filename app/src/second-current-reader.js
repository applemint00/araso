// [A-694] Second S1 current reader. READ-ONLY plumbing: it reports what is held NOW, per
// candidate, and nothing else.
//
// Contract:
//   · Read-only JSON-RPC methods only (RETURN_READ_METHODS whitelist). No sign / send / broadcast
//     exists in this module; the vendored ABI fragments contain views only.
//   · Transport (`fetchImpl`), clock (`now`) and `rpcUrl` are injected. Without them nothing is
//     read and every readable candidate reports `no_transport` / `no_rpc`. This module holds no URL.
//   · Output is a report, not a decision. It never carries a go/permission field; each candidate has
//     a `status` describing HOW MUCH could be read, plus `read` (values) or null, plus `reason`.
//   · Never throws.
//   · Candidates that rest on an assumption say so in `status` (Neverland, Curvance, Protect).
//     A value that could not be read is null, never a guessed number.
import { decodeFunctionResult, encodeFunctionData, toFunctionSelector } from "viem";
import { LANE_RECEIPT_TOKEN, LANE_SELECTORS, readLanePreAction } from "./mainnet-job-lane.js";
import { RETURN_READ_METHODS, buildExecutionPlan, readReturnObservation } from "./second-job-readiness.js";
import { ERC20_VIEW_ABI, ERC4626_VIEW_ABI, POOL_VIEW_ABI } from "./abi/second-reader-abi.js";

export const CURRENT_READER_STATUS = Object.freeze({
  AAVE_BUILDABLE: "aave_buildable",
  NEVERLAND_DERIVED_ASSUMED: "neverland_derived_assumed",
  CURVANCE_ERC4626: "curvance_erc4626",
  PROTECT_CALLER_SUPPLIED: "protect_caller_supplied",
  KINTSU_OBSERVATION: "kintsu_observation",
  ABIL_QUOTE_INCOMPLETE: "abil_quote_incomplete",
  UNAVAILABLE: "unavailable",
  // failure statuses (shared)
  READ_FAILED: "read_failed",
  ASSUMPTION_BROKEN: "assumption_broken",
  TARGET_MISSING: "target_missing",
});

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const lower = (v) => String(v || "").toLowerCase();
const CHAIN = "monad-mainnet";

const UNAVAILABLE = Object.freeze([
  Object.freeze({ id: "kuru", reason: "no_exported_address_or_abi" }),
  Object.freeze({ id: "merkl", reason: "no_exported_address_or_abi" }),
  Object.freeze({ id: "move", reason: "no_exported_address_or_abi" }),
]);

/** True when the vendored selectors equal the lane's pinned ones. A mismatch means the vendored ABI drifted. */
export function vendoredSelectorsMatchLane() {
  const pick = (abi, name) => abi.find((f) => f.name === name);
  return toFunctionSelector(pick(ERC20_VIEW_ABI, "balanceOf")) === LANE_SELECTORS.balanceOf
    && toFunctionSelector(pick(ERC20_VIEW_ABI, "allowance")) === LANE_SELECTORS.allowance
    && toFunctionSelector(pick(POOL_VIEW_ABI, "getReserveData")) === LANE_SELECTORS.getReserveData;
}

class ReadError extends Error {
  constructor(status) { super(status); this.status = status; }
}

function makeReader({ rpcUrl, fetchImpl, now }) {
  if (typeof rpcUrl !== "string" || !/^https:\/\/[^\s]+$/.test(rpcUrl)) return { fail: "no_rpc" };
  if (typeof fetchImpl !== "function" || typeof now !== "function") return { fail: "no_transport" };
  let id = 0;
  const rpc = async (method, params) => {
    if (!RETURN_READ_METHODS.includes(method)) throw new ReadError("method_not_read_only");
    let response;
    try {
      response = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method, params }) });
    } catch { throw new ReadError("rpc_unreachable"); }
    if (!response || response.ok !== true || typeof response.json !== "function") throw new ReadError("rpc_unreachable");
    let body;
    try { body = await response.json(); } catch { throw new ReadError("unreadable_result"); }
    if (!body || typeof body !== "object" || body.error || typeof body.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) throw new ReadError("unreadable_result");
    return body.result;
  };
  const call = async (to, abi, functionName, args, blockTag) => {
    const data = encodeFunctionData({ abi, functionName, args });
    const raw = await rpc("eth_call", [{ to, data }, blockTag]);
    try { return decodeFunctionResult({ abi, functionName, data: raw }); } catch { throw new ReadError("unreadable_result"); }
  };
  const pin = async () => {
    const chainId = Number(BigInt(await rpc("eth_chainId", [])));
    const block = Number(BigInt(await rpc("eth_blockNumber", [])));
    if (!Number.isSafeInteger(chainId) || !Number.isSafeInteger(block) || block < 0) throw new ReadError("unreadable_result");
    return { chainId, block, blockTag: `0x${block.toString(16)}` };
  };
  const stamp = () => {
    const at = now();
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new ReadError("unreadable_result");
    return at;
  };
  return { rpc, call, pin, stamp };
}

// Plan lookup is used ONLY to take the pinned destination address from the readiness table.
// The plan object itself (it carries permission fields) is never copied into the report.
function destinationOf(id, address, allowanceTarget = null) {
  const out = buildExecutionPlan(id, { context: { address, chain: CHAIN }, allowanceTarget });
  const plan = out?.plan;
  if (!plan) return { ok: false, reason: out?.reason || "no_plan" };
  return { ok: true, destination: plan.destination, protocol: plan.protocol, family: plan.family };
}

const row = (id, status, reason, read = null, extra = {}) => ({ id, status, reason, read, ...extra });
const failRow = (id, reason) => row(id, CURRENT_READER_STATUS.READ_FAILED, reason);
const errReason = (e) => (e instanceof ReadError ? e.status : "unreadable_result");

async function readAave({ profile, piggyAddress, rpcUrl, fetchImpl, now }) {
  const out = await readLanePreAction({ profile, piggyAddress, rpcUrl, fetchImpl, now });
  if (out.status !== "ok" || !out.read) return failRow("aave-usdc", out.status);
  const r = out.read;
  return row("aave-usdc", CURRENT_READER_STATUS.AAVE_BUILDABLE, "read_via_lane_pre_action", {
    source: r.source, observedAt: r.observedAt, chainId: r.chainId, block: r.block, pool: r.pool, codePresent: r.codePresent,
    receiptToken: { symbol: LANE_RECEIPT_TOKEN.symbol, address: r.reserve.aTokenAddress, matchesRecorded: lower(r.reserve.aTokenAddress) === lower(LANE_RECEIPT_TOKEN.address) },
    reserve: { ...r.reserve },
    holdings: { usdcRaw: r.piggy.usdcRaw, receiptRaw: r.piggy.aTokenRaw, allowanceToPoolRaw: r.piggy.allowanceRaw },
  });
}

// Neverland is an Aave-v3-shaped pool by ASSUMPTION. The receipt token is derived on chain from
// getReserveData(USDC); nothing about it is pinned in this repo.
async function readNeverland(reader, piggyAddress, usdc) {
  const dest = destinationOf("neverland-usdc", piggyAddress);
  if (!dest.ok) return failRow("neverland-usdc", dest.reason);
  try {
    const { chainId, block, blockTag } = await reader.pin();
    const code = await reader.rpc("eth_getCode", [dest.destination, blockTag]);
    const reserve = await reader.call(dest.destination, POOL_VIEW_ABI, "getReserveData", [usdc], blockTag);
    const receipt = reserve?.aTokenAddress;
    if (!ADDR.test(receipt || "") || /^0x0{40}$/.test(receipt)) {
      return row("neverland-usdc", CURRENT_READER_STATUS.ASSUMPTION_BROKEN, "no_receipt_token_for_usdc", { chainId, block, pool: dest.destination, codePresent: code.length > 2 });
    }
    const usdcRaw = await reader.call(usdc, ERC20_VIEW_ABI, "balanceOf", [piggyAddress], blockTag);
    const receiptRaw = await reader.call(receipt, ERC20_VIEW_ABI, "balanceOf", [piggyAddress], blockTag);
    const allowanceRaw = await reader.call(usdc, ERC20_VIEW_ABI, "allowance", [piggyAddress, dest.destination], blockTag);
    return row("neverland-usdc", CURRENT_READER_STATUS.NEVERLAND_DERIVED_ASSUMED, "aave_v3_shape_assumed_receipt_token_derived", {
      source: `read-only rpc ${RETURN_READ_METHODS.join("/")} @${block}`, observedAt: reader.stamp(), chainId, block, pool: dest.destination, codePresent: code.length > 2,
      receiptToken: { address: receipt, derived: true },
      holdings: { usdcRaw: usdcRaw.toString(), receiptRaw: receiptRaw.toString(), allowanceToPoolRaw: allowanceRaw.toString() },
    }, { assumptions: ["pool exposes aave v3 getReserveData", "aTokenAddress is the receipt token"] });
  } catch (e) {
    // A decode failure here usually means the pool is not Aave-shaped: that is the assumption failing.
    return failRow("neverland-usdc", errReason(e));
  }
}

async function readCurvance(reader, piggyAddress, usdc) {
  const dest = destinationOf("curvance-usdc", piggyAddress);
  if (!dest.ok) return failRow("curvance-usdc", dest.reason);
  try {
    const { chainId, block, blockTag } = await reader.pin();
    const code = await reader.rpc("eth_getCode", [dest.destination, blockTag]);
    const asset = await reader.call(dest.destination, ERC4626_VIEW_ABI, "asset", [], blockTag);
    if (lower(asset) !== lower(usdc)) {
      return row("curvance-usdc", CURRENT_READER_STATUS.ASSUMPTION_BROKEN, "vault_asset_is_not_usdc", { chainId, block, vault: dest.destination, asset });
    }
    const shares = await reader.call(dest.destination, ERC4626_VIEW_ABI, "balanceOf", [piggyAddress], blockTag);
    const assets = await reader.call(dest.destination, ERC4626_VIEW_ABI, "convertToAssets", [shares], blockTag);
    const total = await reader.call(dest.destination, ERC4626_VIEW_ABI, "totalAssets", [], blockTag);
    return row("curvance-usdc", CURRENT_READER_STATUS.CURVANCE_ERC4626, "erc4626_views", {
      source: `read-only rpc ${RETURN_READ_METHODS.join("/")} @${block}`, observedAt: reader.stamp(), chainId, block, vault: dest.destination, codePresent: code.length > 2,
      holdings: { sharesRaw: shares.toString(), assetsRaw: assets.toString() }, vaultTotalAssetsRaw: total.toString(),
    });
  } catch (e) {
    return failRow("curvance-usdc", errReason(e));
  }
}

// Protect reads the allowance of a CALLER-SUPPLIED {token, spender}. Nothing is discovered here.
async function readProtect(reader, piggyAddress, target) {
  const token = typeof target?.token === "string" ? target.token.trim() : "";
  const spender = typeof target?.spender === "string" ? target.spender.trim() : "";
  if (!ADDR.test(token) || !ADDR.test(spender)) return row("protect-revoke-allowance", CURRENT_READER_STATUS.TARGET_MISSING, "protect_target_not_supplied");
  try {
    const { chainId, block, blockTag } = await reader.pin();
    const allowance = await reader.call(token, ERC20_VIEW_ABI, "allowance", [piggyAddress, spender], blockTag);
    return row("protect-revoke-allowance", CURRENT_READER_STATUS.PROTECT_CALLER_SUPPLIED, "caller_supplied_target", {
      source: `read-only rpc ${RETURN_READ_METHODS.join("/")} @${block}`, observedAt: reader.stamp(), chainId, block,
      target: { token, spender }, allowanceRaw: allowance.toString(),
    });
  } catch (e) {
    return failRow("protect-revoke-allowance", errReason(e));
  }
}

async function readKintsu({ rpcUrl, fetchImpl, now }) {
  const out = await readReturnObservation("kintsu-smon", { rpcUrl, fetchImpl, now });
  if (out.status !== "ok" || !out.observation) return failRow("kintsu-smon", out.status);
  return row("kintsu-smon", CURRENT_READER_STATUS.KINTSU_OBSERVATION, "return_observation_only", { ...out.observation },
    { note: "contract-state observation (chain / code / exit fee); the account's sMON balance is not read here" });
}

/**
 * Read what the Piggy holds now, per Second candidate.
 * @param {{profile: object, piggyAddress: string, rpcUrl?: string, fetchImpl?: Function, now?: Function, protectTarget?: {token: string, spender: string}}} input
 * @returns {Promise<{kind: string, piggyAddress: string|null, candidates: object[]}>}
 */
export async function readSecondCurrent({ profile, piggyAddress, rpcUrl, fetchImpl, now, protectTarget = null } = {}) {
  const address = typeof piggyAddress === "string" ? piggyAddress.trim() : "";
  const candidates = [];
  const usdc = profile?.usdc?.address;
  const unreadable = (id, reason) => failRow(id, reason);
  if (!ADDR.test(address)) {
    for (const id of ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"]) candidates.push(unreadable(id, "missing_piggy_address"));
  } else {
    const reader = makeReader({ rpcUrl, fetchImpl, now });
    if (reader.fail) {
      for (const id of ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"]) candidates.push(unreadable(id, reader.fail));
    } else {
      const usdcOk = ADDR.test(usdc || "");
      candidates.push(await readAave({ profile, piggyAddress: address, rpcUrl, fetchImpl, now }));
      candidates.push(usdcOk ? await readNeverland(reader, address, usdc) : unreadable("neverland-usdc", "profile_usdc_missing"));
      candidates.push(usdcOk ? await readCurvance(reader, address, usdc) : unreadable("curvance-usdc", "profile_usdc_missing"));
      candidates.push(await readProtect(reader, address, protectTarget));
      candidates.push(await readKintsu({ rpcUrl, fetchImpl, now }));
    }
  }
  candidates.push(row("abil-spot", CURRENT_READER_STATUS.ABIL_QUOTE_INCOMPLETE, "no_quoter_or_token_address_in_exported_surface"));
  for (const u of UNAVAILABLE) candidates.push(row(u.id, CURRENT_READER_STATUS.UNAVAILABLE, u.reason));
  return { kind: "second_current_read", piggyAddress: address || null, candidates };
}
