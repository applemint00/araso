// Chain profile — which network this app build runs against, chosen explicitly and closed.
//
// Rules this file enforces:
//   · Three profiles exist: "monad-testnet" (10143), "monad-mainnet" (143) and "monad-fork" (the shared mainnet fork for Journey 2,
//     its own numeric id; active only with its build config — see resolveChainProfile).
//   · No value (unset / empty) = testnet. That is the only default. Mainnet is chosen only
//     when the build config says exactly "monad-mainnet".
//   · Anything else (a typo, a number, a different case, a non-string) is a BLOCKED profile:
//     no scope, no persistence, no execution. It never falls back to either network.
//   · The testnet-only legacy paths (first shMON send, relayer grant, legacy receipt rows
//     that carry no chain id) are open only on the testnet profile.
//   · Mainnet live execution is off in this build. Nothing here signs, sends or reads a network.

import { FORK_CHAIN_ID, FORK_SCOPE, FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "./funding-context.js";

export const CHAIN_PROFILE_ID = Object.freeze({
  TESTNET: "monad-testnet",
  MAINNET: "monad-mainnet",
  FORK: FORK_SCOPE,
});

export const CHAIN_PROFILE_STATUS = Object.freeze({
  ACTIVE: "active",
  BLOCKED: "blocked",
});

function usdcFor(scope) {
  const row = FUNDING_CONTEXT_TOKEN_ALLOWLIST[scope]?.USDC;
  return row ? Object.freeze({ symbol: "USDC", address: row.assetId, decimals: row.decimals }) : null;
}

// ── Fork-only asset table ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Only the shared-fork profile carries an `assets` table. The testnet and mainnet profiles carry none: their record binding stays
// USDC only (the `usdc` row), exactly as before. A row here is a binding fact (symbol, address, decimals), never a permission: every Job
// module keeps its own permission request, liveExecution check, size cap and executor gate.
//   · MON is the chain's own coin: no contract address (`address: null`, `native: true`). It never takes an ERC-20 path (approve,
//     transfer, allowance): erc20TokenOfBinding() refuses a native binding.
//   · WETH / AUSD: the input assets of the fork Euler (WETH) and Upshift (AUSD) Jobs. Address and decimals are the values the mainnet fork
//     harness ran with at block 110746900 (1 WETH = 1e18 raw, 100 AUSD = 100e6 raw), the same values the Job modules pin; never from docs.
//   · Nothing else: an asset no fork Job takes as input has no row (share / receipt tokens are outputs, read as balances, never bound).
const NATIVE_MON = Object.freeze({ symbol: "MON", address: null, decimals: 18, native: true });
const FORK_ASSETS = Object.freeze({
  USDC: usdcFor(FORK_SCOPE),
  MON: NATIVE_MON,
  WETH: Object.freeze({ symbol: "WETH", address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", decimals: 18 }),
  AUSD: Object.freeze({ symbol: "AUSD", address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", decimals: 6 }),
});
// Which profile carries a table: the fork only. Kept outside PROFILES so the testnet / mainnet profile objects stay byte-identical.
const ASSET_TABLES = Object.freeze({ [FORK_SCOPE]: FORK_ASSETS });
// [fork-parent] The parent chain a fork profile copies (numeric). The fork only; outside PROFILES for the same byte-identity reason.
// Read back from this table by chainMatchesExecutor, never from a caller's object.
const FORK_PARENT = Object.freeze({ [FORK_SCOPE]: 143 });

const PROFILES = Object.freeze({
  [CHAIN_PROFILE_ID.TESTNET]: Object.freeze({
    id: CHAIN_PROFILE_ID.TESTNET,
    status: CHAIN_PROFILE_STATUS.ACTIVE,
    numericChainId: 10143,
    scope: CHAIN_PROFILE_ID.TESTNET,
    legacyFirstJourney: true,
    usdc: usdcFor(CHAIN_PROFILE_ID.TESTNET),
    jobId: null,
    liveExecution: false,
    reason: null,
  }),
  [CHAIN_PROFILE_ID.MAINNET]: Object.freeze({
    id: CHAIN_PROFILE_ID.MAINNET,
    status: CHAIN_PROFILE_STATUS.ACTIVE,
    numericChainId: 143,
    scope: CHAIN_PROFILE_ID.MAINNET,
    legacyFirstJourney: false,
    usdc: usdcFor(CHAIN_PROFILE_ID.MAINNET),
    // The one Job this profile carries. One asset (USDC), one errand per Piggy.
    jobId: "aave-usdc",
    // Read-only RPC for the product reader (CSP connect-src already allows it, vercel.json). Reads only; no write path uses it.
    // Testnet / blocked profiles have no rpcUrl, so their reader rows stay `no_rpc`.
    rpcUrl: "https://rpc.monad.xyz",
    // Off. Turning it on is a separate Owner decision; see the mainnet lane module.
    liveExecution: false,
    reason: null,
  }),
  // The shared mainnet fork (Journey 2). Its RPC URL and fork instance id are build config (never written here); without both the
  // profile resolves BLOCKED. No live execution, no Job yet, no legacy testnet paths.
  [CHAIN_PROFILE_ID.FORK]: Object.freeze({
    id: CHAIN_PROFILE_ID.FORK,
    status: CHAIN_PROFILE_STATUS.ACTIVE,
    numericChainId: FORK_CHAIN_ID,
    scope: FORK_SCOPE,
    legacyFirstJourney: false,
    usdc: usdcFor(FORK_SCOPE),
    jobId: null,
    liveExecution: false,
    reason: null,
  }),
});

const FORK_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// ── [fork-link] RPC address judge — the one place that says which RPC URL the app may read from ───────────────────────────────
//   · https: exactly the rule every site used before (/^https:\/\/[^\s]+$/). Production, testnet and the 143 paths see only this.
//   · http: ONLY on the vite dev server (RPC_DEV_BUILD, a build constant: import.meta.env.DEV and not mode "production"; never an env
//     value, a query or a stored value), ONLY for the shared-fork profile, ONLY `http://127.0.0.1:<port>` with nothing else
//     (no other host, no "localhost", no userinfo, no path / query / fragment, no leading-zero port), and — for a read — only after
//     that exact URL answered `araso_guardInfo` as the shared-fork Public Guard for this page's fork instance (checkForkGuard). A raw
//     anvil port or the Admin port has no such method, so it stays refused.
//   · In a production build RPC_DEV_BUILD is the literal false: the whole http branch below is dead code and is dropped from the
//     bundle (a954 test: vite build + grep).
const HTTPS_RPC = /^https:\/\/[^\s]+$/;
export const RPC_DEV_BUILD = typeof import.meta.env === "object" && import.meta.env !== null ? import.meta.env.DEV === true && import.meta.env.MODE !== "production" : false;

/**
 * @param {unknown} url
 * @param {{profile?: object|string|null, dev?: boolean}} [options]  profile = the profile the read runs on (a reader without one passes
 *   nothing); dev = the caller's RPC_DEV_BUILD. The http branch needs dev === true AND this module's own build constant.
 * @returns {boolean}
 */
export function rpcUrlAllowed(url, { profile = null, dev = false } = {}) {
  if (typeof url !== "string") return false;
  if (HTTPS_RPC.test(url)) return true;
  if (RPC_DEV_BUILD) return devForkRpcAllowed(url, profile, dev);
  return false;
}

export const FORK_GUARD_METHOD = "araso_guardInfo";
export const FORK_GUARD_NAME = "araso-a949-public-guard";
const DEV_LOOPBACK_RPC = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/;
// The fork profile this page resolved on the dev server, and whether its URL answered as the Guard. One page = one boot profile.
let devGuard = null; // { rpcUrl, forkInstanceId, status: "pending" | "verified" | "blocked", reason, info, seq }
let devGuardSeq = 0;

function devLoopbackRpc(url) {
  const m = DEV_LOOPBACK_RPC.exec(url);
  if (!m || Number(m[1]) > 65535) return false;
  try { const u = new URL(url); return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port === m[1] && !u.username && !u.password && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash; } catch { return false; }
}

function devForkRpcAllowed(url, profile, dev) {
  if (dev !== true || !devLoopbackRpc(url)) return false;
  if (profile === CHAIN_PROFILE_ID.FORK) return true; // resolve-time shape check only (resolveChainProfile); a read never passes the id string
  const g = devGuard;
  if (!g || g.status !== "verified" || g.rpcUrl !== url) return false;
  if (profile === null || profile === undefined) return true; // a reader that carries no profile: only the verified Guard of this page's fork
  return typeof profile === "object" && profile.id === CHAIN_PROFILE_ID.FORK && profile.status === CHAIN_PROFILE_STATUS.ACTIVE
    && profile.rpcUrl === url && profile.forkInstanceId === g.forkInstanceId;
}

function startDevGuardCheck(profile) {
  devGuardSeq += 1;
  devGuard = Object.freeze({ rpcUrl: profile.rpcUrl, forkInstanceId: profile.forkInstanceId, status: "pending", reason: null, info: null, seq: devGuardSeq });
  if (typeof fetch === "function") checkForkGuard(profile, { fetchImpl: fetch.bind(globalThis) }).catch(() => {});
}

/** Dev server only: what this page knows about its fork Guard (null when no dev fork profile was resolved, and always in production). */
export function devForkGuardState() {
  if (!RPC_DEV_BUILD || !devGuard) return null;
  const { rpcUrl, forkInstanceId, status, reason, info } = devGuard;
  return Object.freeze({ rpcUrl, forkInstanceId, status, reason, info });
}

/**
 * Dev server only: asks the fork profile's loopback URL who it is. Verified only when it answers `araso_guardInfo` with the Guard name,
 * chain 31337143 and THIS profile's forkInstanceId, and its node answers eth_chainId 31337143. Anything else = blocked (reads refused).
 * @returns {Promise<{status: "verified"|"blocked", reason: string|null, info: object|null}>}
 */
export async function checkForkGuard(profile, { fetchImpl } = {}) {
  const done = (status, reason, info = null) => Object.freeze({ status, reason, info });
  if (!RPC_DEV_BUILD) return done("blocked", "not_dev_build");
  if (!profile || profile.id !== CHAIN_PROFILE_ID.FORK || profile.status !== CHAIN_PROFILE_STATUS.ACTIVE || !devLoopbackRpc(profile.rpcUrl || "")) return done("blocked", "not_dev_fork_profile");
  if (typeof fetchImpl !== "function") return done("blocked", "no_transport");
  devGuardSeq += 1;
  const seq = devGuardSeq;
  const mine = devGuard && devGuard.rpcUrl === profile.rpcUrl && devGuard.forkInstanceId === profile.forkInstanceId;
  if (!mine) devGuard = Object.freeze({ rpcUrl: profile.rpcUrl, forkInstanceId: profile.forkInstanceId, status: "pending", reason: null, info: null, seq });
  const ask = async (method) => {
    const response = await fetchImpl(profile.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) });
    if (!response || response.ok !== true || typeof response.json !== "function") return { error: "http" };
    const body = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : { error: "shape" };
  };
  let out;
  try {
    const info = await ask(FORK_GUARD_METHOD);
    const r = info.result;
    if (info.error || !r || typeof r !== "object") out = done("blocked", "not_public_guard");
    else if (r.guard !== FORK_GUARD_NAME) out = done("blocked", "not_public_guard");
    else if (Number(r.chainId) !== FORK_CHAIN_ID) out = done("blocked", "guard_chain_mismatch");
    else if (r.forkInstanceId !== profile.forkInstanceId) out = done("blocked", "fork_instance_mismatch");
    else {
      const cid = await ask("eth_chainId");
      out = typeof cid.result === "string" && /^0x[0-9a-fA-F]+$/.test(cid.result) && Number(BigInt(cid.result)) === FORK_CHAIN_ID
        ? done("verified", null, Object.freeze({ guard: r.guard, chainId: FORK_CHAIN_ID, forkInstanceId: r.forkInstanceId }))
        : done("blocked", "fork_chain_mismatch");
    }
  } catch { out = done("blocked", "guard_unreachable"); }
  // Only the newest check for this URL + instance writes the page state (a slower, older check never overwrites a newer answer).
  if (seq === devGuardSeq && devGuard && devGuard.rpcUrl === profile.rpcUrl && devGuard.forkInstanceId === profile.forkInstanceId) {
    devGuard = Object.freeze({ rpcUrl: profile.rpcUrl, forkInstanceId: profile.forkInstanceId, status: out.status, reason: out.reason, info: out.info, seq });
  }
  return out;
}

function blockedProfile(reason, requested) {
  return Object.freeze({
    id: null,
    status: CHAIN_PROFILE_STATUS.BLOCKED,
    numericChainId: null,
    scope: "",
    legacyFirstJourney: false,
    usdc: null,
    jobId: null,
    liveExecution: false,
    reason,
    requested: typeof requested === "string" ? requested.slice(0, 64) : typeof requested,
    selectedBy: "config",
  });
}

/**
 * Resolves the build's chain profile.
 * @param {unknown} raw  the build config value (e.g. VITE_ARASO_CHAIN_PROFILE)
 * @returns frozen profile; `status: "blocked"` for any value that is not exactly a known id
 */
export function resolveChainProfile(raw, forkConfig = null) {
  if (raw === CHAIN_PROFILE_ID.FORK) {
    // The fork needs both values from the build config: a public https RPC URL and the fork instance id. Missing / malformed = BLOCKED.
    const rpcUrl = typeof forkConfig?.rpcUrl === "string" ? forkConfig.rpcUrl.trim() : "";
    const forkInstanceId = typeof forkConfig?.forkInstanceId === "string" ? forkConfig.forkInstanceId.trim() : "";
    // previous rule: if (!/^https:\/\/[^\s]+$/.test(rpcUrl) || !FORK_INSTANCE_ID.test(forkInstanceId)) return blockedProfile("fork_config_missing", raw);
    if (!rpcUrlAllowed(rpcUrl, { profile: CHAIN_PROFILE_ID.FORK, dev: RPC_DEV_BUILD }) || !FORK_INSTANCE_ID.test(forkInstanceId)) return blockedProfile("fork_config_missing", raw); // [fork-link]
    const forkProfile = Object.freeze({ ...PROFILES[CHAIN_PROFILE_ID.FORK], assets: ASSET_TABLES[CHAIN_PROFILE_ID.FORK], forkOf: FORK_PARENT[CHAIN_PROFILE_ID.FORK], rpcUrl, forkInstanceId, selectedBy: "path" });
    if (RPC_DEV_BUILD && !HTTPS_RPC.test(rpcUrl)) startDevGuardCheck(forkProfile); // [fork-link] dev server only: the loopback URL must answer as the shared-fork Public Guard
    return forkProfile;
  }
  if (raw === undefined || raw === null || raw === "") {
    return Object.freeze({ ...PROFILES[CHAIN_PROFILE_ID.TESTNET], selectedBy: "default" });
  }
  if (typeof raw !== "string") return blockedProfile("chain_profile_not_string", raw);
  if (raw !== raw.trim()) return blockedProfile("chain_profile_whitespace", raw);
  const profile = Object.prototype.hasOwnProperty.call(PROFILES, raw) ? PROFILES[raw] : null;
  if (!profile) return blockedProfile("unknown_chain_profile", raw);
  return Object.freeze({ ...profile, selectedBy: "config" });
}

/** A BLOCKED profile with a named reason (used by boot-profile.js when the fork id is configured outside the "/j2" rule). */
export function blockedChainProfile(reason, requested) {
  return blockedProfile(typeof reason === "string" && reason ? reason : "blocked", requested);
}

export function isProfileActive(profile) {
  // own keys only: an id like "__proto__" / "constructor" / "toString" never names a profile
  return !!profile && profile.status === CHAIN_PROFILE_STATUS.ACTIVE && Object.prototype.hasOwnProperty.call(PROFILES, profile.id)
    && PROFILES[profile.id].numericChainId === profile.numericChainId && PROFILES[profile.id].scope === profile.scope;
}

/**
 * [fork-parent] Executor chain judge — may an executor that says `executorChainId` act under this profile?
 *   · the same chain as the profile: true (exactly the old `executor.chainId === profile.numericChainId` comparison, unchanged);
 *   · otherwise only when the profile is an ACTIVE known profile whose OWN `forkOf` equals the value in this file's FORK_PARENT table for
 *     that profile (a number) and equals `executorChainId`. Today only "monad-fork" (31337143) has one: forkOf 143.
 * A `forkOf` attached to another profile, a string "143", an inherited (__proto__) forkOf or a changed value is refused.
 * This answers the executor question only. Evidence (a read, a receipt, a tx) is judged by its own chain id = profile.numericChainId.
 */
export function chainMatchesExecutor(profile, executorChainId) {
  if (!profile || typeof profile !== "object") return false;
  if (executorChainId === profile.numericChainId) return true;
  if (!Number.isSafeInteger(executorChainId) || !isProfileActive(profile)) return false;
  const own = Object.prototype.hasOwnProperty;
  if (!own.call(FORK_PARENT, profile.id) || !own.call(profile, "forkOf")) return false;
  const parent = FORK_PARENT[profile.id];
  return Number.isSafeInteger(parent) && profile.forkOf === parent && parent === executorChainId;
}

/** The testnet-only legacy paths (first send, grant, un-chained receipt rows) are open here only. */
export function legacyTestnetPathOpen(profile) {
  return isProfileActive(profile) && profile.id === CHAIN_PROFILE_ID.TESTNET && profile.legacyFirstJourney === true;
}

/** The persistence scope string for this profile. "" when blocked (every store refuses ""). */
export function profileScope(profile) {
  return isProfileActive(profile) ? profile.scope : "";
}

/**
 * Issuance-authority profile gate: does issuing a NEW Piggy sequence number (+Piggy / Gift Piggy) on this
 * index chain scope require a verified per-chain write-once registry?
 *   · testnet scope ("monad-testnet")  -> false. The origin-device provenance gate stays the only issuance gate.
 *   · the shared fork's scope ("monad-fork") -> false, the same rule as testnet: fork-local Piggies with virtual money only. [fork-issuance]
 *   · every other value -> true (fail closed): the live scope "monad-mainnet", its numeric "143", and any
 *     unknown / misspelt / non-string scope. Issuance there refuses BEFORE any passkey prompt unless an
 *     authority is injected (main.js ships it null). A blocked profile's "" is also refused upstream (invalid_chain).
 * Only the exact testnet and fork scopes are exempt. It reads no network and enables nothing.
 */
export function issuanceAuthorityRequiredForScope(scope) {
  if (scope === PROFILES[CHAIN_PROFILE_ID.FORK].scope) return false; // [fork-issuance] the shared fork's own scope follows testnet (fork-local Piggies only); "143" / mainnet unchanged
  return scope !== PROFILES[CHAIN_PROFILE_ID.TESTNET].scope;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const lower = (v) => String(v || "").toLowerCase();

// The asset table of an active profile, read from this module's own ASSET_TABLES by profile id (a caller's profile object cannot add,
// replace or remove a row: its own `assets` field is never read), or null.
function assetTableOf(profile) {
  return Object.prototype.hasOwnProperty.call(ASSET_TABLES, profile.id) ? ASSET_TABLES[profile.id] : null;
}

// The row for `asset` on this profile, or null. Without a table: USDC only, from the profile's `usdc` row (the original rule).
function profileToken(profile, asset) {
  const table = assetTableOf(profile);
  if (!table) return asset === "USDC" ? profile.usdc : null;
  return typeof asset === "string" && Object.prototype.hasOwnProperty.call(table, asset) ? table[asset] : null;
}

/**
 * The binding every persisted mainnet record/intent carries: chain + asset + token + Piggy.
 * A native asset (fork table MON) binds with `token: null` and `native: true`; every other binding keeps the original shape.
 * A binding is never a permission: it opens no execution path.
 * @returns {{binding: object|null, error: string|null}}
 */
export function bindRecordToProfile(profile, { piggyId, piggyAddress, asset = "USDC" } = {}) {
  if (!isProfileActive(profile)) return { binding: null, error: "profile_blocked" };
  const token = profileToken(profile, asset);
  if (!token) return { binding: null, error: "asset_not_in_profile" };
  const id = typeof piggyId === "string" ? piggyId.trim() : "";
  if (!id || id.length > 80) return { binding: null, error: "missing_piggy" };
  if (!ADDR.test(piggyAddress || "")) return { binding: null, error: "missing_piggy_address" };
  const native = token.native === true;
  return {
    binding: Object.freeze({
      chainId: profile.numericChainId,
      chain: profile.scope,
      asset: token.symbol,
      token: native ? null : token.address,
      decimals: token.decimals,
      ...(native ? { native: true } : {}),
      piggyId: id,
      piggyAddress,
    }),
    error: null,
  };
}

export const NATIVE_ASSET_NOT_ERC20 = "native_asset_not_erc20";

/**
 * The ERC-20 contract a binding names, for an ERC-20 path (approve / transfer / allowance / balanceOf). A native binding (MON) has
 * none and is refused here; it moves only as a call's value.
 * @returns {{token: string|null, error: string|null}}
 */
export function erc20TokenOfBinding(binding) {
  if (!binding || typeof binding !== "object") return { token: null, error: "binding_missing" };
  if (binding.native === true || binding.token === null) return { token: null, error: NATIVE_ASSET_NOT_ERC20 };
  if (typeof binding.token !== "string" || !ADDR.test(binding.token)) return { token: null, error: "binding_token_invalid" };
  return { token: binding.token, error: null };
}

/**
 * Re-checks a stored record against the running profile and the Piggy in hand.
 * A record without a chain id (legacy rows) is never read as this profile's state.
 * @returns {{ok: boolean, reason: string|null}}
 */
export function checkRecordBinding(record, profile, { piggyId, piggyAddress } = {}) {
  if (!isProfileActive(profile)) return { ok: false, reason: "profile_blocked" };
  if (!record || typeof record !== "object") return { ok: false, reason: "no_record" };
  if (record.chainId === undefined || record.chainId === null) return { ok: false, reason: "unbound_record" };
  if (record.chainId !== profile.numericChainId) return { ok: false, reason: "chain_mismatch" };
  if (record.chain !== profile.scope) return { ok: false, reason: "chain_scope_mismatch" };
  const token = profileToken(profile, record.asset);
  if (!token) return { ok: false, reason: "asset_mismatch" };
  if (assetTableOf(profile)) {
    // table profiles (the fork): a native row matches only a native record (no token); an ERC-20 row only a non-native record
    const native = token.native === true;
    if (native ? (record.native !== true || record.token !== null) : (record.native !== undefined || lower(record.token) !== lower(token.address))) return { ok: false, reason: "token_mismatch" };
  } else if (lower(record.token) !== lower(token.address)) return { ok: false, reason: "token_mismatch" };
  if (record.decimals !== token.decimals) return { ok: false, reason: "decimals_mismatch" };
  if (typeof record.piggyId !== "string" || record.piggyId !== piggyId) return { ok: false, reason: "piggy_mismatch" };
  if (!ADDR.test(record.piggyAddress || "") || lower(record.piggyAddress) !== lower(piggyAddress)) return { ok: false, reason: "piggy_address_mismatch" };
  return { ok: true, reason: null };
}

// ── Gift escrow config ────────────────────────────────────────────────────────────────────────
// No mainnet Gift escrow is deployed. The product value stays null until a separate deploy step
// produces a verified address. A contract deployed inside a local fork may be wired for tests
// only, and is refused for product use.
export const GIFT_DEPLOYMENT = Object.freeze({
  LIVE_VERIFIED: "live_verified",
  FORK_LOCAL_TEST_ONLY: "fork_local_test_only",
});

export const MAINNET_GIFT_ESCROW_CONFIG = null;

/**
 * @param profile  resolved chain profile
 * @param config   { chainScope, contractAddress, deployment, verifiedAtBlock? } or null
 * @param options  { allowForkLocal } — tests only
 * @returns {{config: object|null, status: string}}
 */
export function resolveGiftEscrowConfig(profile, config, { allowForkLocal = false } = {}) {
  if (!isProfileActive(profile)) return { config: null, status: "profile_blocked" };
  if (config === null || config === undefined) return { config: null, status: "release_blocked_no_deployment" };
  if (typeof config !== "object" || Array.isArray(config)) return { config: null, status: "invalid_config" };
  if (config.chainScope !== profile.scope) return { config: null, status: "chain_scope_mismatch" };
  if (!ADDR.test(config.contractAddress || "") || /^0x0{40}$/.test(config.contractAddress)) return { config: null, status: "invalid_address" };
  if (config.deployment === GIFT_DEPLOYMENT.FORK_LOCAL_TEST_ONLY) {
    if (allowForkLocal !== true) return { config: null, status: "fork_artifact_not_product" };
    return { config: Object.freeze({ chainScope: config.chainScope, contractAddress: config.contractAddress, deployment: config.deployment }), status: "fork_local_test_only" };
  }
  if (config.deployment === GIFT_DEPLOYMENT.LIVE_VERIFIED) {
    if (!Number.isInteger(config.verifiedAtBlock) || config.verifiedAtBlock <= 0) return { config: null, status: "live_not_verified" };
    return { config: Object.freeze({ chainScope: config.chainScope, contractAddress: config.contractAddress, deployment: config.deployment, verifiedAtBlock: config.verifiedAtBlock }), status: "live_verified" };
  }
  return { config: null, status: "unknown_deployment" };
}
