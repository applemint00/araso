// [A-946] Boot-time chain profile choice — one build, the profile picked from the page path once at boot.
//   · path exactly "/j2" AND the release level opens Journey 2 (release-gate.js "second") → the shared-fork profile
//     (its RPC URL + fork instance id come from the build config; missing either = BLOCKED, chain-profile.js).
//   · every other case → the build config value exactly as before (unset = testnet, "monad-mainnet" = mainnet, anything else BLOCKED).
//   · [A-948] the stored journey (araso.journey.v1) is a second way in at "/" — rules in selectBootProfile below.
//   · "/j2" at release level 1 → exactly what "/" gives (the build config; unset = testnet). Never the fork.
//   · VITE_ARASO_FORK_RPC_URL must be the fork's PUBLIC read/send proxy, never a raw anvil URL (anvil serves anvil_* admin methods on the same URL).
//   · the fork id named directly in the build config (not through "/j2") → BLOCKED: the fork is reachable by the path rule only.
// The result is fixed for the life of the page: moving between "/" and "/j2" is a full page load, so nothing in memory (signing
// session, unlocked state) crosses over. Pure apart from reading release-gate's level default.
import { CHAIN_PROFILE_ID, blockedChainProfile, resolveChainProfile } from "./chain-profile.js";
import { RELEASE_LEVEL, releaseAllows } from "./release-gate.js";

export const FORK_BOOT_PATH = "/j2";
// The Release-2 promotion (main.js A-897 block) targets Monad mainnet only; main.js names no mainnet literal itself.
export const PROMOTION_TARGET_SCOPE = CHAIN_PROFILE_ID.MAINNET;

// [A-948] One address: the last journey the person was in is remembered on this device and reopened at boot. It is UX state only, never a
// permission (release level + the server's entry check decide; release-gate.js journeyFeatureOpen). "1" | "2"; anything else / unreadable = "1".
export const JOURNEY_KEY = "araso.journey.v1";
export const CLAIM_PATH = "/claim";

/** The stored journey ("1" | "2"). Any other value, no storage, or a throwing storage = "1". */
export function storedJourney(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { return storage?.getItem(JOURNEY_KEY) === "2" ? "2" : "1"; } catch { return "1"; }
}

const forkConfig = (env) => ({ rpcUrl: env?.VITE_ARASO_FORK_RPC_URL, forkInstanceId: env?.VITE_ARASO_FORK_INSTANCE_ID });
const hasForkEnv = (env) => typeof env?.VITE_ARASO_FORK_RPC_URL === "string" && env.VITE_ARASO_FORK_RPC_URL.trim() !== ""
  && typeof env?.VITE_ARASO_FORK_INSTANCE_ID === "string" && env.VITE_ARASO_FORK_INSTANCE_ID.trim() !== "";
function configuredProfile(env) {
  const configured = env?.VITE_ARASO_CHAIN_PROFILE;
  if (configured === CHAIN_PROFILE_ID.FORK) return blockedChainProfile("fork_only_by_path", configured);
  return resolveChainProfile(configured);
}

/**
 * The chain profile for this page load (first match wins). env = import.meta.env (or a plain object in tests).
 *   1. "/claim"                                    → the build config, exactly as before (the stored journey is ignored; Gift entry rules first)
 *   2. journey "2" + release level ≥ 2 + fork env  → the shared-fork profile
 *   3. "/j2" + release level ≥ 2                   → the shared-fork profile (A-946 path kept)
 *   4. otherwise                                   → the build config (unset = testnet). Level 1 = Journey 1 even when "2" is stored.
 */
export function selectBootProfile({ pathname, env, releaseLevel = RELEASE_LEVEL, journey = "1" } = {}) {
  if (pathname === CLAIM_PATH) return configuredProfile(env);
  const level2 = releaseAllows("second", releaseLevel);
  if (journey === "2" && level2 && hasForkEnv(env)) return resolveChainProfile(CHAIN_PROFILE_ID.FORK, forkConfig(env));
  if (pathname === FORK_BOOT_PATH && level2) return resolveChainProfile(CHAIN_PROFILE_ID.FORK, forkConfig(env));
  return configuredProfile(env);
}

/**
 * Storage key for a Second-Journey fact that used to be global. Testnet keeps the exact old key (existing values stay readable, nothing is
 * moved or deleted); every other scope gets its own key `<base>.<scope>`; a blocked profile ("" scope) gets `<base>.blocked`.
 */
export function scopedSecondKey(base, scope) {
  if (scope === CHAIN_PROFILE_ID.TESTNET) return base;
  return `${base}.${typeof scope === "string" && scope !== "" ? scope : "blocked"}`;
}
