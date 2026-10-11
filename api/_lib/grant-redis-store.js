// [A-960] Grant store on Upstash Redis (REST). The one durable store for grant · invite · fork ledger (Owner 2026-10-10: Upstash 하나).
// Contract = api/_lib/grant-store-contract.js GRANT_STORE_CONTRACT_V1 (reserve / settle / release / reconcile), unchanged:
//   reserve   ONE EVAL — invite binding (allowlist) + address-once + global cap + insert, together. Cross-instance atomic because Redis runs
//             a script as one unit. Order inside the script: not bound -> "not_allowlisted" (no slot used) · row exists -> "duplicate" ·
//             active count >= cap -> "cap_reached" · else SET row + INCR count.
//   settle / reconcile  GET row -> decideSettle (the contract's own pure rule) -> compare-and-set EVAL on the exact old value (retry on a race).
//   release   GET row -> decideRelease (contract rule) -> ONE EVAL: compare-and-set row released + DECR count. A released row stays
//             (same identity, same epoch = still "duplicate"); a second release is a no-op (count is never decremented twice).
// allowlist = invite-bound Piggy addresses: the key invite-redis-store.js writes when a tester's invite is bound (`<prefix>:invite:piggy:<addr>`).
// Lua uses only redis.call on strings (no cjson): row values are opaque JSON strings compared byte-for-byte.
// Env (server only; never VITE_): KV_REST_API_URL/KV_REST_API_TOKEN (Vercel KV / Marketplace) or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.
// The first COMPLETE pair wins (KV first, like the Gift store); halves are never mixed. Neither pair = no store = 503 (fail-closed).
// No value, token or URL is ever logged or put into an error message.
import crypto from "node:crypto";
import { DEFAULT_EPOCH, GRANT_STORE_CONTRACT_V1, decideRelease, decideSettle, isValidEpoch, isValidIdentity, normalizeReserveRequest } from "./grant-store-contract.js";

export const UPSTASH_ENV_PAIRS = Object.freeze([
  Object.freeze({ url: "KV_REST_API_URL", token: "KV_REST_API_TOKEN" }),
  Object.freeze({ url: "UPSTASH_REDIS_REST_URL", token: "UPSTASH_REDIS_REST_TOKEN" }),
]);
export const ARASO_REDIS_PREFIX = "araso:v1";
const URL_RE = /^https:\/\/[^\s/]+\/?$/;

/** Server config defaults — Owner 확정 대기 (A-960 item 7). cap = one grant per invited tester (= invite count). Amount = GRANT_WEI (0.1 MON, unchanged). */
/** [A-960 review fix] One number for both: invite count = grant cap (A-870 rule 2: cap = allowlist size). invite-redis-store.js reads it. */
export const INVITE_COUNT_DEFAULT = 20;
export const UPSTASH_GRANT_DEFAULTS = Object.freeze({ globalCap: INVITE_COUNT_DEFAULT, epoch: DEFAULT_EPOCH });

const ownStr = (env, k) => (env !== null && typeof env === "object" && Object.hasOwn(env, k) && typeof env[k] === "string" ? env[k].trim() : "");

/** -> { url, token, source } | null. Own properties only (a polluted Object.prototype cannot configure a store). */
export function readUpstashEnv(env = process.env) {
  for (const p of UPSTASH_ENV_PAIRS) {
    const url = ownStr(env, p.url); const token = ownStr(env, p.token);
    if (url !== "" && token !== "") return URL_RE.test(url) ? { url, token, source: p.url } : null;
  }
  return null;
}

/** Upstash REST command caller: POST <url> ["CMD", ...args] with Bearer token. -> cmd(...args) => result. null when url/token invalid. */
export function createUpstashRest({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (typeof url !== "string" || !URL_RE.test(url) || typeof token !== "string" || token === "" || typeof fetchImpl !== "function") return null;
  const base = url.replace(/\/$/, "");
  return async function cmd(...args) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(base, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args.map((a) => (typeof a === "number" ? String(a) : a))), signal: ac.signal, redirect: "error" });
      } catch { throw new Error("KV_UNREACHABLE"); }
      if (!res || res.status !== 200) throw new Error("KV_HTTP");
      let j;
      try { j = JSON.parse(await res.text()); } catch { throw new Error("KV_BAD_REPLY"); }
      if (!j || typeof j !== "object" || typeof j.error === "string") throw new Error("KV_ERROR");
      return j.result;
    } finally { clearTimeout(t); }
  };
}

/** The key invite-redis-store.js writes on binding (value = testerId). Shared here so the grant script reads exactly that key. */
export const invitePiggyKey = (prefix, addr) => `${prefix}:invite:piggy:${addr}`;
const rowKey = (prefix, epoch, identity) => `${prefix}:grant:${epoch}:r:${identity}`;
const countKey = (prefix, epoch) => `${prefix}:grant:${epoch}:n`;

// KEYS[1]=row KEYS[2]=active count KEYS[3]=invite-bound Piggy key · ARGV[1]=cap ARGV[2]=row json ARGV[3]="1" binding required
// -> 1 reserved · 0 duplicate · -1 cap reached · -2 not bound (allowlist)
export const GRANT_RESERVE_LUA = "if ARGV[3]=='1' and redis.call('exists',KEYS[3])==0 then return -2 end "
  + "if redis.call('exists',KEYS[1])==1 then return 0 end "
  + "local n=tonumber(redis.call('get',KEYS[2]) or '0') "
  + "if n>=tonumber(ARGV[1]) then return -1 end "
  + "redis.call('set',KEYS[1],ARGV[2]) redis.call('incr',KEYS[2]) return 1";
// KEYS[1]=row · ARGV[1]=expected old value ARGV[2]=new value -> 1 written · 0 the row changed meanwhile
export const GRANT_CAS_LUA = "if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end redis.call('set',KEYS[1],ARGV[2]) return 1";
// KEYS[1]=row KEYS[2]=active count · ARGV[1]=expected old ARGV[2]=new (released) -> 1 released (count -1) · 0 the row changed meanwhile
export const GRANT_RELEASE_LUA = "if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end redis.call('set',KEYS[1],ARGV[2]) redis.call('decr',KEYS[2]) return 1";

const CAS_TRIES = 8;

/**
 * createUpstashGrantStore({ cmd, prefix, requireBinding }) -> full A-870 grant store.
 * requireBinding (default true) = only invite-bound addresses can reserve (reason "not_allowlisted"). The conformance harness runs with false.
 */
export function createUpstashGrantStore({ cmd, prefix = ARASO_REDIS_PREFIX, requireBinding = true, now = () => Date.now(), randomId = () => `g${crypto.randomBytes(16).toString("hex")}` } = {}) {
  if (typeof cmd !== "function") return null;
  const load = async (epoch, identity) => {
    const raw = await cmd("GET", rowKey(prefix, epoch, identity));
    if (raw === null || raw === undefined) return { raw: null, rec: null };
    if (typeof raw !== "string") throw new Error("GRANT_STORE_BAD_ROW");
    let rec; try { rec = JSON.parse(raw); } catch { throw new Error("GRANT_STORE_BAD_ROW"); }
    return { raw, rec };
  };
  const target = (req) => {
    if (!req || typeof req !== "object" || !isValidIdentity(req.identity)) throw new Error("invalid request");
    const epoch = req.epoch === undefined ? DEFAULT_EPOCH : req.epoch;
    if (!isValidEpoch(epoch)) throw new Error("invalid request");
    return { identity: req.identity, epoch };
  };
  async function apply(kind, req) {
    const { identity, epoch } = target(req);
    const { reservationId, outcome, txHash, broadcast, nonceConsumed } = req;
    for (let i = 0; i < CAS_TRIES; i += 1) {
      const { raw, rec } = await load(epoch, identity);
      const own = rec && rec.reservationId === reservationId ? rec : null;
      const d = decideSettle(own, { kind, outcome, txHash, broadcast, nonceConsumed });
      if (!d.ok) throw new Error(`${kind} refused: ${d.reason}`);
      const next = { ...rec, outcome };
      if (txHash) next.txHash = txHash;
      if (broadcast) next.broadcast = true;
      if (nonceConsumed) next.nonceConsumed = true;
      if (Number(await cmd("EVAL", GRANT_CAS_LUA, 1, rowKey(prefix, epoch, identity), raw, JSON.stringify(next))) === 1) return;
    }
    throw new Error("GRANT_STORE_CONTENTION");
  }
  return {
    contract: GRANT_STORE_CONTRACT_V1,
    kind: "upstash",
    requireBinding: requireBinding === true,
    async reserve(req) {
      const n = normalizeReserveRequest(req);
      if (!n) throw new Error("invalid reserve request"); // judgement impossible = throw (handler 503)
      const reservationId = randomId();
      const row = JSON.stringify({ epoch: n.epoch, identity: n.identity, reservationId, outcome: null, released: false, at: now() });
      const r = Number(await cmd("EVAL", GRANT_RESERVE_LUA, 3, rowKey(prefix, n.epoch, n.identity), countKey(prefix, n.epoch), invitePiggyKey(prefix, n.identity), n.globalCap, row, requireBinding === true ? "1" : "0"));
      if (r === 1) return { ok: true, reservationId };
      if (r === 0) return { ok: false, reason: "duplicate" };
      if (r === -1) return { ok: false, reason: "cap_reached" };
      if (r === -2) return { ok: false, reason: "not_allowlisted" };
      throw new Error("GRANT_STORE_BAD_REPLY");
    },
    async settle(req) { return apply("settle", req); },
    async reconcile(req) { return apply("reconcile", req); },
    /** operator path only (never called by /api/grant). Frees the cap slot once, only when decideRelease allows. */
    async release(req) {
      const { identity, epoch } = target(req);
      for (let i = 0; i < CAS_TRIES; i += 1) {
        const { raw, rec } = await load(epoch, identity);
        if (!rec || rec.reservationId !== req.reservationId) return { ok: false, reason: "not_found" };
        if (rec.released === true) return { ok: true }; // already released: no second DECR
        const d = decideRelease(rec);
        if (!d.ok) return d;
        if (Number(await cmd("EVAL", GRANT_RELEASE_LUA, 2, rowKey(prefix, epoch, identity), countKey(prefix, epoch), raw, JSON.stringify({ ...rec, released: true }))) === 1) return { ok: true };
      }
      throw new Error("GRANT_STORE_CONTENTION");
    },
  };
}

/** Production registry entry for api/grant.js DURABLE_GRANT_STORE_BACKENDS.upstash. Throws when env is missing (the caller turns it into 503). */
export function upstashGrantBackendFromEnv(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = readUpstashEnv(env);
  if (!cfg) throw new Error("UPSTASH_NOT_CONFIGURED");
  const cmd = createUpstashRest({ url: cfg.url, token: cfg.token, fetchImpl });
  const store = cmd ? createUpstashGrantStore({ cmd }) : null;
  if (!store) throw new Error("UPSTASH_NOT_CONFIGURED");
  return { store, policy: { globalCap: UPSTASH_GRANT_DEFAULTS.globalCap, epoch: UPSTASH_GRANT_DEFAULTS.epoch } };
}
