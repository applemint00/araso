// Chain profile — which network this app build runs against, chosen explicitly and closed.
//
// Rules this file enforces:
//   · Exactly two profiles exist: "monad-testnet" (10143) and "monad-mainnet" (143).
//   · No value (unset / empty) = testnet. That is the only default. Mainnet is chosen only
//     when the build config says exactly "monad-mainnet".
//   · Anything else (a typo, a number, a different case, a non-string) is a BLOCKED profile:
//     no scope, no persistence, no execution. It never falls back to either network.
//   · The testnet-only legacy paths (first shMON send, relayer grant, legacy receipt rows
//     that carry no chain id) are open only on the testnet profile.
//   · Mainnet live execution is off in this build. Nothing here signs, sends or reads a network.

import { FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "./funding-context.js";

export const CHAIN_PROFILE_ID = Object.freeze({
  TESTNET: "monad-testnet",
  MAINNET: "monad-mainnet",
});

export const CHAIN_PROFILE_STATUS = Object.freeze({
  ACTIVE: "active",
  BLOCKED: "blocked",
});

function usdcFor(scope) {
  const row = FUNDING_CONTEXT_TOKEN_ALLOWLIST[scope]?.USDC;
  return row ? Object.freeze({ symbol: "USDC", address: row.assetId, decimals: row.decimals }) : null;
}

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
    // Off. Turning it on is a separate Owner decision; see the mainnet lane module.
    liveExecution: false,
    reason: null,
  }),
});

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
export function resolveChainProfile(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return Object.freeze({ ...PROFILES[CHAIN_PROFILE_ID.TESTNET], selectedBy: "default" });
  }
  if (typeof raw !== "string") return blockedProfile("chain_profile_not_string", raw);
  if (raw !== raw.trim()) return blockedProfile("chain_profile_whitespace", raw);
  const profile = Object.prototype.hasOwnProperty.call(PROFILES, raw) ? PROFILES[raw] : null;
  if (!profile) return blockedProfile("unknown_chain_profile", raw);
  return Object.freeze({ ...profile, selectedBy: "config" });
}

export function isProfileActive(profile) {
  return !!profile && profile.status === CHAIN_PROFILE_STATUS.ACTIVE && !!PROFILES[profile.id]
    && PROFILES[profile.id].numericChainId === profile.numericChainId && PROFILES[profile.id].scope === profile.scope;
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
 *   · every other value -> true (fail closed): the live scope "monad-mainnet", its numeric "143", and any
 *     unknown / misspelt / non-string scope. Issuance there refuses BEFORE any passkey prompt unless an
 *     authority is injected (main.js ships it null). A blocked profile's "" is also refused upstream (invalid_chain).
 * Only the exact testnet scope is exempt. It reads no network and enables nothing.
 */
export function issuanceAuthorityRequiredForScope(scope) {
  return scope !== PROFILES[CHAIN_PROFILE_ID.TESTNET].scope;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const lower = (v) => String(v || "").toLowerCase();

/**
 * The binding every persisted mainnet record/intent carries: chain + asset + token + Piggy.
 * @returns {{binding: object|null, error: string|null}}
 */
export function bindRecordToProfile(profile, { piggyId, piggyAddress, asset = "USDC" } = {}) {
  if (!isProfileActive(profile)) return { binding: null, error: "profile_blocked" };
  const token = asset === "USDC" ? profile.usdc : null;
  if (!token) return { binding: null, error: "asset_not_in_profile" };
  const id = typeof piggyId === "string" ? piggyId.trim() : "";
  if (!id || id.length > 80) return { binding: null, error: "missing_piggy" };
  if (!ADDR.test(piggyAddress || "")) return { binding: null, error: "missing_piggy_address" };
  return {
    binding: Object.freeze({
      chainId: profile.numericChainId,
      chain: profile.scope,
      asset: token.symbol,
      token: token.address,
      decimals: token.decimals,
      piggyId: id,
      piggyAddress,
    }),
    error: null,
  };
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
  const token = record.asset === "USDC" ? profile.usdc : null;
  if (!token) return { ok: false, reason: "asset_mismatch" };
  if (lower(record.token) !== lower(token.address)) return { ok: false, reason: "token_mismatch" };
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
