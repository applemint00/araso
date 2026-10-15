// [A-1299] Grant room and grant wallet as words for public_state (Owner 04:3x "그란트 안되는 일 없이"): the watch warns before new
// people meet cap_reached or an empty grant wallet. Words only — never a count, a cap, a balance or an address. Read-only: one GET of
// the public grant counter and one balance read of the relayer address (no reserve, no send). Reads are cached briefly because every
// app boot asks public_state, and a slow read never holds public_state (room left out, wallet "unknown").
import { createPublicClient, defineChain, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, GRANT_WEI, RPC_URL } from "../../relayer/src/policy.mjs";
import { ARASO_REDIS_PREFIX, createUpstashRest, readUpstashEnv } from "./grant-redis-store.js";
import { DEFAULT_EPOCH } from "./grant-store-contract.js";
import { publicEntryConfig } from "./public-entry.js";

export const GRANT_ROOM_LOW_SHARE = 0.8; // public counter / cap at or above this = "low"; at or above 1 = "full"
export const GRANT_WALLET_LOW_WEI = GRANT_WEI * 20n; // fewer than 20 grants left in the grant wallet = "low"

/** "ok" | "low" | "full", or null when it cannot be said (no cap, unreadable count). */
export function grantRoomWord(count, cap) {
  if (!(typeof cap === "number" && cap > 0) || typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  const share = count / cap;
  return share >= 1 ? "full" : share >= GRANT_ROOM_LOW_SHARE ? "low" : "ok";
}
/** "ok" | "low" | "unknown" (unreadable). */
export function grantWalletWord(balanceWei) {
  if (typeof balanceWei !== "bigint" || balanceWei < 0n) return "unknown";
  return balanceWei < GRANT_WALLET_LOW_WEI ? "low" : "ok";
}

const within = (p, ms) => Promise.race([Promise.resolve().then(p), new Promise((_, no) => setTimeout(() => no(new Error("slow")), ms))]);

/** createGrantStatus({ cap, readPublicCount, readWalletBalance }) -> async () => { grantRoom?, grantWallet } (cached ttlMs). */
export function createGrantStatus({ cap, readPublicCount, readWalletBalance, ttlMs = 30_000, timeoutMs = 1_500, now = () => Date.now() } = {}) {
  let last = null; let at = -Infinity;
  return async function grantStatus() {
    if (last && now() - at < ttlMs) return last;
    const [count, balance] = await Promise.all([
      typeof readPublicCount === "function" ? within(readPublicCount, timeoutMs).catch(() => null) : null,
      typeof readWalletBalance === "function" ? within(readWalletBalance, timeoutMs).catch(() => null) : null,
    ]);
    const room = grantRoomWord(count, cap);
    last = Object.freeze({ ...(room ? { grantRoom: room } : {}), grantWallet: grantWalletWord(balance) });
    at = now();
    return last;
  };
}

export const publicCountKeyFor = (prefix, epoch) => `${prefix}:grant:${epoch}:public:n`; // = grant-redis-store publicCountKey

/** The reads from already-built parts (tests inject them). */
export function grantStatusFromParts({ cap, cmd, prefix = ARASO_REDIS_PREFIX, epoch = DEFAULT_EPOCH, relayerAddress = null, getBalance = null, ...opts } = {}) {
  return createGrantStatus({
    cap,
    readPublicCount: typeof cmd === "function" ? async () => {
      const raw = await cmd("GET", publicCountKeyFor(prefix, epoch));
      const n = raw === null || raw === undefined ? 0 : Number(raw);
      return Number.isSafeInteger(n) ? n : null;
    } : null,
    readWalletBalance: relayerAddress && typeof getBalance === "function" ? () => getBalance({ address: relayerAddress }) : null,
    ...opts,
  });
}

/** Production wiring: Upstash counter + the relayer wallet on the grant chain. Missing pieces = that word unreadable (never a throw). */
export function grantStatusFromEnv(env = process.env) {
  const own = (k) => (env && Object.hasOwn(env, k) ? env[k] : undefined);
  const { cap } = publicEntryConfig(env);
  let cmd = null;
  try { const u = readUpstashEnv(env); cmd = u ? createUpstashRest(u) : null; } catch { cmd = null; }
  let relayerAddress = null; let getBalance = null;
  try {
    const key = own("RELAYER_PRIVATE_KEY");
    if (typeof key === "string" && key) {
      relayerAddress = privateKeyToAccount(key).address; // the address only; the key never leaves this line
      const chain = defineChain({ id: CHAIN_ID, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
      const client = createPublicClient({ chain, transport: viemHttp(RPC_URL) });
      getBalance = (a) => client.getBalance(a);
    }
  } catch { relayerAddress = null; getBalance = null; }
  return grantStatusFromParts({ cap, cmd: typeof cmd === "function" ? cmd : null, relayerAddress, getBalance });
}
