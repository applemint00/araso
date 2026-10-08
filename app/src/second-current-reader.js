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
import { ABIL_POOL_VIEW_ABI, ABIL_ROUTER_VIEW_ABI, ERC20_DECIMALS_VIEW_ABI, ERC20_VIEW_ABI, ERC4626_VIEW_ABI, POOL_VIEW_ABI } from "./abi/second-reader-abi.js";

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
  // A row whose value could not be established: missing / stale / conflicting / unsupported (see `unknownClass`).
  UNKNOWN: "unknown",
});

// aBIL spot: every value below is quoted from already-recorded evidence. Nothing here is a new fact.
//   router / pool / token, token0 aBIL / token1 USDC, fee 3000, decimals 18
//                                   → A-652 MAINNET_FORK_MATRIX.md:96 (and raw/abil-spot.json `resolution`)
//   router factory() = pool factory() = 0xC1e98D0A…Aa21 → A-652 MAINNET_FORK_MATRIX.md:26
//   chain 143, block 108,999,816, USDC 0x7547…b603 → A-652 MAINNET_FORK_MATRIX.md:1/:31
//   router is the readiness destination           → second-job-readiness.js abil-spot `destination`
// Not recorded anywhere: a quoter, a price view, dividend, eligibility. Those stay UNKNOWN.
export const ABIL_RECORDED = Object.freeze({
  chainId: 143,
  evidenceBlock: 108999816,
  router: "0xFE951b693A2FE54BE5148614B109E316B567632F",
  pool: "0xb8700E0D0Df2B0b09A1374FbCdCC85E2E14F7898",
  token: "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f",
  tokenSymbol: "aBIL",
  tokenDecimals: 18,
  usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  fee: 3000,
  factory: "0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21",
  source: "A-652 mainnet fork lab (MAINNET_FORK_MATRIX §7, raw/abil-spot.json)",
});
export const ABIL_UNKNOWN_CLASS = Object.freeze(["missing", "stale", "conflicting", "unsupported"]);
const ABIL_ALWAYS_UNKNOWN = Object.freeze(["quote", "dividend", "eligibility"]);

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

/** The read-only JSON-RPC reader used by this module (whitelist-bounded). Exposed so the whitelist can be tested. */
export function makeReadOnlyReader(input = {}) {
  return makeReader(input);
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

// aBIL: what can be shown from the recorded evidence, at one pinned block. A value that cannot be shown is UNKNOWN —
// the row is then `unknown` with read:null, never a partial guess. The quote is UNKNOWN even on a full read.
const abilUnknown = (unknownClass, reason) => row("abil-spot", CURRENT_READER_STATUS.UNKNOWN, `${unknownClass}:${reason}`, null, { unknownClass, unknown: [...ABIL_ALWAYS_UNKNOWN] });
const abilClassOf = (e) => (e instanceof ReadError && e.status === "rpc_unreachable" ? "missing" : "unsupported");

async function readAbil(reader, piggyAddress, usdc) {
  const R = ABIL_RECORDED;
  const dest = destinationOf("abil-spot", piggyAddress);
  if (!dest.ok) return abilUnknown("missing", dest.reason);
  if (lower(dest.destination) !== lower(R.router)) return abilUnknown("conflicting", "router_differs_from_recorded");
  if (lower(usdc) !== lower(R.usdc)) return abilUnknown("conflicting", "usdc_differs_from_recorded");
  try {
    const { chainId, block, blockTag } = await reader.pin();
    if (chainId !== R.chainId) return abilUnknown("conflicting", "chain_differs_from_recorded");
    // Evidence-side staleness only (no clock constant): a head below the recorded evidence block cannot show it.
    if (block < R.evidenceBlock) return abilUnknown("stale", "rpc_head_behind_recorded_evidence");
    for (const [name, at] of [["router", R.router], ["pool", R.pool], ["token", R.token]]) {
      const code = await reader.rpc("eth_getCode", [at, blockTag]);
      if (code.length <= 2) return abilUnknown("missing", `no_code_at_${name}`);
    }
    const found = {
      token0: await reader.call(R.pool, ABIL_POOL_VIEW_ABI, "token0", [], blockTag),
      token1: await reader.call(R.pool, ABIL_POOL_VIEW_ABI, "token1", [], blockTag),
      fee: Number(await reader.call(R.pool, ABIL_POOL_VIEW_ABI, "fee", [], blockTag)),
      poolFactory: await reader.call(R.pool, ABIL_POOL_VIEW_ABI, "factory", [], blockTag),
      routerFactory: await reader.call(R.router, ABIL_ROUTER_VIEW_ABI, "factory", [], blockTag),
      tokenDecimals: Number(await reader.call(R.token, ERC20_DECIMALS_VIEW_ABI, "decimals", [], blockTag)),
    };
    const expected = { token0: R.token, token1: R.usdc, fee: R.fee, poolFactory: R.factory, routerFactory: R.factory, tokenDecimals: R.tokenDecimals };
    for (const [k, want] of Object.entries(expected)) {
      const same = typeof want === "string" ? lower(found[k]) === lower(want) : found[k] === want;
      if (!same) return abilUnknown("conflicting", `${k}_differs_from_recorded`);
    }
    const liquidity = await reader.call(R.pool, ABIL_POOL_VIEW_ABI, "liquidity", [], blockTag);
    const usdcRaw = await reader.call(R.usdc, ERC20_VIEW_ABI, "balanceOf", [piggyAddress], blockTag);
    const abilRaw = await reader.call(R.token, ERC20_VIEW_ABI, "balanceOf", [piggyAddress], blockTag);
    const usdcToRouter = await reader.call(R.usdc, ERC20_VIEW_ABI, "allowance", [piggyAddress, R.router], blockTag);
    const abilToRouter = await reader.call(R.token, ERC20_VIEW_ABI, "allowance", [piggyAddress, R.router], blockTag);
    return row("abil-spot", CURRENT_READER_STATUS.ABIL_QUOTE_INCOMPLETE, "pool_identity_matches_recorded_quote_unknown", {
      source: `read-only rpc ${RETURN_READ_METHODS.join("/")} @${block}`, observedAt: reader.stamp(), chainId, block, codePresent: true,
      router: R.router, pool: R.pool, token: { address: R.token, symbol: R.tokenSymbol, decimals: found.tokenDecimals },
      identityMatchesRecorded: true, poolLiquidityRaw: liquidity.toString(),
      holdings: { usdcRaw: usdcRaw.toString(), abilRaw: abilRaw.toString(), usdcAllowanceToRouterRaw: usdcToRouter.toString(), abilAllowanceToRouterRaw: abilToRouter.toString() },
      quote: { value: null, status: "UNKNOWN", reason: "no_recorded_quoter_or_price_view" },
      recorded: { source: R.source, block: R.evidenceBlock },
    }, { unknown: [...ABIL_ALWAYS_UNKNOWN] });
  } catch (e) {
    return abilUnknown(abilClassOf(e), errReason(e));
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
  let abil;
  if (!ADDR.test(address)) {
    for (const id of ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"]) candidates.push(unreadable(id, "missing_piggy_address"));
    abil = abilUnknown("missing", "missing_piggy_address");
  } else {
    const reader = makeReader({ rpcUrl, fetchImpl, now });
    if (reader.fail) {
      for (const id of ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"]) candidates.push(unreadable(id, reader.fail));
      abil = abilUnknown("missing", reader.fail);
    } else {
      const usdcOk = ADDR.test(usdc || "");
      candidates.push(await readAave({ profile, piggyAddress: address, rpcUrl, fetchImpl, now }));
      candidates.push(usdcOk ? await readNeverland(reader, address, usdc) : unreadable("neverland-usdc", "profile_usdc_missing"));
      candidates.push(usdcOk ? await readCurvance(reader, address, usdc) : unreadable("curvance-usdc", "profile_usdc_missing"));
      candidates.push(await readProtect(reader, address, protectTarget));
      candidates.push(await readKintsu({ rpcUrl, fetchImpl, now }));
      abil = usdcOk ? await readAbil(reader, address, usdc) : abilUnknown("missing", "profile_usdc_missing");
    }
  }
  candidates.push(abil);
  for (const u of UNAVAILABLE) candidates.push(row(u.id, CURRENT_READER_STATUS.UNAVAILABLE, u.reason));
  return { kind: "second_current_read", piggyAddress: address || null, candidates };
}

// ── [Second mainnet merge] read-only routing ─────────────────────────────────────────────────────────────────
// Routes each reader row to its own protocol. Nothing is decided, coerced or filled in here:
//   · `read` is a deep, frozen copy of the row's own read (null stays null; "UNKNOWN" stays "UNKNOWN");
//   · the row's own `unknown`, `unknownClass`, `assumptions` and `note` are carried over untouched, and each
//     protocol adds only the gaps this reader itself knows it does not read (`readerGaps`);
//   · a status that does not belong to the row's protocol is not trusted: evidence becomes "unknown" with
//     unknownClass "conflicting", and the original status and read are still kept for inspection;
//   · a missing row is a route with evidence "unknown" / unknownClass "missing", never an omission.
// Every route is decision "unknown", action "none", no permission, no live execution.
const S = CURRENT_READER_STATUS;
const SHARED_FAILURE = Object.freeze([S.READ_FAILED, S.ASSUMPTION_BROKEN, S.TARGET_MISSING, S.UNKNOWN, S.UNAVAILABLE]);
export const SECOND_READER_ROUTES = Object.freeze({
  "aave-usdc": Object.freeze({
    protocol: "aave", observedStatuses: Object.freeze([S.AAVE_BUILDABLE]),
    evidenceKeys: Object.freeze(["reserve", "receiptToken", "holdings"]),
    readerGaps: Object.freeze(["gas_fee_usd"]),
  }),
  "neverland-usdc": Object.freeze({
    protocol: "neverland", observedStatuses: Object.freeze([S.NEVERLAND_DERIVED_ASSUMED]),
    evidenceKeys: Object.freeze(["receiptToken", "holdings"]),
    // The receipt token is derived through an assumed pool shape (see readNeverland); the reader never proves it.
    readerGaps: Object.freeze(["receipt_token_shape_assumed", "reserve_flags", "exit_timing", "exit_liquidity", "gas_fee_usd"]),
  }),
  "curvance-usdc": Object.freeze({
    protocol: "curvance", observedStatuses: Object.freeze([S.CURVANCE_ERC4626]),
    evidenceKeys: Object.freeze(["holdings", "vaultTotalAssetsRaw"]),
    // assetsRaw is the vault's own conversion view at one block, not a realized exit amount.
    readerGaps: Object.freeze(["realized_exit_assets", "holding_period", "exit_liquidity", "gas_fee_usd"]),
  }),
  "abil-spot": Object.freeze({
    protocol: "abil", observedStatuses: Object.freeze([S.ABIL_QUOTE_INCOMPLETE]),
    evidenceKeys: Object.freeze(["identityMatchesRecorded", "holdings", "quote", "recorded"]),
    readerGaps: ABIL_ALWAYS_UNKNOWN,
  }),
  "kintsu-smon": Object.freeze({
    protocol: "kintsu", observedStatuses: Object.freeze([S.KINTSU_OBSERVATION]),
    evidenceKeys: Object.freeze([]),
    // Contract-state observation only (see readKintsu): the account's balance and any return are never read.
    readerGaps: Object.freeze(["account_share_balance", "return_eta", "final_return_value"]),
  }),
});
export const SECOND_READER_ROUTE_IDS = Object.freeze(Object.keys(SECOND_READER_ROUTES));

const ownHas = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
function frozenCopy(value) {
  if (value === null || value === undefined) return null;
  let copy;
  try { copy = structuredClone(value); } catch { return null; }
  const freeze = (v) => { if (v && typeof v === "object") { for (const k of Object.keys(v)) freeze(v[k]); Object.freeze(v); } return v; };
  return freeze(copy);
}
const stringList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * One reader row routed to its protocol. `jobId` picks the route when the row is missing.
 * @returns {object} frozen route; never throws.
 */
export function routeSecondCurrentRow(rowIn, jobId = null) {
  const id = ownHas(rowIn, "id") && typeof rowIn.id === "string" ? rowIn.id : jobId;
  const lock = { decision: "unknown", action: "none", actionCount: 0, executionPermission: false, liveExecution: false };
  if (typeof id !== "string" || !ownHas(SECOND_READER_ROUTES, id)) {
    return Object.freeze({ kind: "second_reader_route", jobId: null, protocol: null, status: S.UNKNOWN, reason: "unrouted_candidate", evidence: "unknown", unknownClass: "unsupported", read: null, unknown: Object.freeze([]), assumptions: Object.freeze([]), note: null, ...lock });
  }
  const route = SECOND_READER_ROUTES[id];
  const gaps = (own) => Object.freeze([...new Set([...own, ...route.readerGaps])]);
  if (!rowIn || typeof rowIn !== "object" || (jobId && rowIn.id !== jobId)) {
    return Object.freeze({ kind: "second_reader_route", jobId: id, protocol: route.protocol, status: S.UNKNOWN, reason: "row_missing", evidence: "unknown", unknownClass: "missing", read: null, unknown: gaps([]), assumptions: Object.freeze([]), note: null, ...lock });
  }
  const status = typeof rowIn.status === "string" ? rowIn.status : S.UNKNOWN;
  const read = frozenCopy(rowIn.read);
  const own = stringList(rowIn.unknown);
  const ownClass = typeof rowIn.unknownClass === "string" ? rowIn.unknownClass : null;
  let evidence = "unknown";
  let unknownClass = ownClass;
  let reason = typeof rowIn.reason === "string" ? rowIn.reason : "no_reason";
  if (route.observedStatuses.includes(status)) {
    const missingKey = route.evidenceKeys.find((k) => !ownHas(read, k));
    if (read && !missingKey) evidence = "observed";
    else { unknownClass = unknownClass || "missing"; reason = `evidence_missing:${missingKey || "read"}`; }
  } else if (!SHARED_FAILURE.includes(status)) {
    unknownClass = "conflicting";
    reason = `status_not_for_protocol:${status}`;
  } else {
    unknownClass = unknownClass || (status === S.ASSUMPTION_BROKEN ? "conflicting" : "missing");
  }
  return Object.freeze({
    kind: "second_reader_route", jobId: id, protocol: route.protocol, status, reason, evidence, unknownClass,
    read, unknown: gaps(own), assumptions: Object.freeze(stringList(rowIn.assumptions)), note: typeof rowIn.note === "string" ? rowIn.note : null,
    ...lock,
  });
}

/**
 * The whole reader result routed: one route per Second mainnet protocol (missing rows included), plus every
 * other row kept as-is under `unrouted` (copied, never dropped).
 */
export function routeSecondCurrentRead(result) {
  const rows = result && typeof result === "object" && Array.isArray(result.candidates) ? result.candidates : [];
  const routes = SECOND_READER_ROUTE_IDS.map((id) => routeSecondCurrentRow(rows.find((r) => r && r.id === id) || null, id));
  const unrouted = rows.filter((r) => !(r && typeof r.id === "string" && ownHas(SECOND_READER_ROUTES, r.id))).map((r) => frozenCopy(r));
  return Object.freeze({ kind: "second_reader_routes", piggyAddress: result?.piggyAddress ?? null, routes: Object.freeze(routes), unrouted: Object.freeze(unrouted) });
}
