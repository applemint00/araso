// [A-960] Fork ledger store on Upstash Redis (REST) — the A-952 store contract (fork-ledger-store-contract.js) unchanged:
//   get(collection, key)                -> stored value (frozen copy) | null
//   putIfAbsent(collection, key, value) -> ONE EVAL: SET row NX + SADD the collection index together (no row the list cannot see).
//                                          Taken -> { ok:false, reason:"exists", existing } with the stored value. Never overwrites.
//   list(collection)                    -> stored values ordered by key (index members sorted, then MGET)
// Every write is validated first by the contract's own storeWriteProblem (collection · prefix · canonical key/value), exactly like the
// memory adapter. There is no put/update/delete. Keys: `<prefix>:fork:<collection>:<key>` · index `<prefix>:fork:<collection>:idx`.
// Lua uses only redis.call on strings (no cjson). Nothing here logs.
import { FORK_LEDGER_COLLECTIONS, FORK_LEDGER_STORE_CONTRACT, storeWriteProblem } from "./fork-ledger-store-contract.js";
import { ARASO_REDIS_PREFIX, createUpstashRest, readUpstashEnv } from "./grant-redis-store.js";

// KEYS[1]=row KEYS[2]=collection index · ARGV[1]=value json ARGV[2]=ledger key -> 1 created · <string> the existing value
export const FORK_PUT_IF_ABSENT_LUA = "if not redis.call('set',KEYS[1],ARGV[1],'NX') then return redis.call('get',KEYS[1]) end "
  + "redis.call('sadd',KEYS[2],ARGV[2]) return 1";

const MGET_CHUNK = 100;
const deepFreeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };
const parse = (raw) => { if (typeof raw !== "string") throw new Error("FORK_STORE_BAD_ROW"); try { return deepFreeze(JSON.parse(raw)); } catch { throw new Error("FORK_STORE_BAD_ROW"); } };
const hasCol = (c) => typeof c === "string" && Object.prototype.hasOwnProperty.call(FORK_LEDGER_COLLECTIONS, c);

export function createUpstashForkLedgerStore({ cmd, prefix = ARASO_REDIS_PREFIX } = {}) {
  if (typeof cmd !== "function") return null;
  const rowKey = (c, k) => `${prefix}:fork:${c}:${k}`;
  const idxKey = (c) => `${prefix}:fork:${c}:idx`;
  return Object.freeze({
    contract: FORK_LEDGER_STORE_CONTRACT,
    kind: "upstash",
    async get(collection, key) {
      if (!hasCol(collection) || typeof key !== "string") return null;
      const raw = await cmd("GET", rowKey(collection, key));
      return raw === null || raw === undefined ? null : parse(raw);
    },
    async putIfAbsent(collection, key, value) {
      const problem = storeWriteProblem(collection, key, value);
      if (problem) return { ok: false, reason: problem };
      const r = await cmd("EVAL", FORK_PUT_IF_ABSENT_LUA, 2, rowKey(collection, key), idxKey(collection), JSON.stringify(value), key);
      if (Number(r) === 1 && typeof r !== "string") return { ok: true, created: true };
      if (typeof r === "string") return { ok: false, reason: "exists", existing: parse(r) };
      throw new Error("FORK_STORE_BAD_REPLY");
    },
    async list(collection) {
      if (!hasCol(collection)) return [];
      const keys = (await cmd("SMEMBERS", idxKey(collection))) ?? [];
      if (!Array.isArray(keys)) throw new Error("FORK_STORE_BAD_REPLY");
      const sorted = keys.map(String).sort();
      const out = [];
      for (let i = 0; i < sorted.length; i += MGET_CHUNK) {
        const part = sorted.slice(i, i + MGET_CHUNK);
        const vals = await cmd("MGET", ...part.map((k) => rowKey(collection, k)));
        if (!Array.isArray(vals) || vals.length !== part.length) throw new Error("FORK_STORE_BAD_REPLY");
        for (const v of vals) if (v !== null && v !== undefined) out.push(parse(v));
      }
      return out;
    },
  });
}

/** Fork ledger store from server env (same env pairs as the grant store) or null (fail-closed). */
export function forkLedgerStoreFromEnv(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = readUpstashEnv(env);
  if (!cfg) return null;
  const cmd = createUpstashRest({ url: cfg.url, token: cfg.token, fetchImpl });
  return cmd ? createUpstashForkLedgerStore({ cmd }) : null;
}
