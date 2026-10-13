// [A-960] Tester invites on Upstash Redis (REST) — 보충 7: one link `/?i=<display>#invite=<secret>`, the secret is a 128-bit server-made
// random token. Only its SHA-256 digest is stored (key name); the raw token is returned ONCE by issue() to the operator and never stored
// or logged. testerId = a server-made random id (not derived from the token). Opening a link uses nothing: the invite is bound only when
// the Piggy proves control (EIP-191 challenge, fork-auth.js purpose "invite-bind") — once, atomically, to the first Piggy.
//   issue    ONE EVAL: issued counter < max (default 20) + token hash row (HSET) with a TTL (default 7 days) + counter INCR
//   bind     ONE EVAL: row exists · already bound to the same Piggy = ok (idempotent) · bound to another Piggy = refused · expired =
//            refused · Piggy key SET NX (one tester per Piggy) · row records the Piggy and loses its TTL (a bound invite does not expire)
//   testerFor(token) -> testerId | null (unbound and expired = null) — the shape fork-auth createInviteTable has, but async.
// The Piggy key `<prefix>:invite:piggy:<addr>` is the grant allowlist (grant-redis-store.js GRANT_RESERVE_LUA reads it).
// Lua uses only redis.call on strings (no cjson). Nothing here logs.
import crypto from "node:crypto";
import { ARASO_REDIS_PREFIX, INVITE_COUNT_DEFAULT, createUpstashRest, invitePiggyKey, readUpstashEnv } from "./grant-redis-store.js";

/** Server config defaults — Owner 확정 대기 (A-960 item 7). */
export const INVITE_DEFAULTS = Object.freeze({ maxInvites: INVITE_COUNT_DEFAULT /* [A-960 review fix] = grant cap */, ttlMs: 7 * 24 * 60 * 60 * 1000 });
export const INVITE_TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

export const inviteTokenDigest = (token) => crypto.createHash("sha256").update(`araso.invite.v1|${token}`).digest("hex");
const tokKey = (prefix, digest) => `${prefix}:invite:tok:${digest}`;
const issuedKey = (prefix) => `${prefix}:invite:issued`;

// KEYS[1]=token row KEYS[2]=issued counter · ARGV[1]=testerId ARGV[2]=expiresAt ARGV[3]=issuedAt ARGV[4]=max ARGV[5]=ttl ms
// -> 1 issued · 0 collision (retry with a new token) · -1 max reached
export const INVITE_ISSUE_LUA = "local n=tonumber(redis.call('get',KEYS[2]) or '0') "
  + "if n>=tonumber(ARGV[4]) then return -1 end "
  + "if redis.call('exists',KEYS[1])==1 then return 0 end "
  + "redis.call('hset',KEYS[1],'testerId',ARGV[1],'expiresAt',ARGV[2],'issuedAt',ARGV[3],'piggy','') "
  + "redis.call('pexpire',KEYS[1],ARGV[5]) redis.call('incr',KEYS[2]) return 1";
// KEYS[1]=token row KEYS[2]=Piggy key · ARGV[1]=piggy ARGV[2]=now ms
// -> 2 bound now · 1 already bound to this Piggy · -1 not invited · -2 expired · -3 invite bound to another Piggy · -4 Piggy bound to another tester
export const INVITE_BIND_LUA = "if redis.call('exists',KEYS[1])==0 then return -1 end "
  + "local tester=redis.call('hget',KEYS[1],'testerId') "
  + "if not tester or tester=='' then return -1 end "
  + "local bound=redis.call('hget',KEYS[1],'piggy') "
  + "if bound and bound~='' then if bound==ARGV[1] then return 1 end return -3 end "
  + "local exp=tonumber(redis.call('hget',KEYS[1],'expiresAt') or '0') "
  + "if not exp or exp<=tonumber(ARGV[2]) then return -2 end "
  + "if not redis.call('set',KEYS[2],tester,'NX') then return -4 end "
  + "redis.call('hset',KEYS[1],'piggy',ARGV[1],'boundAt',ARGV[2]) redis.call('persist',KEYS[1]) return 2";

const BIND_RESULT = Object.freeze({ 2: "bound", 1: "already_bound", [-1]: "not_invited", [-2]: "invite_expired", [-3]: "invite_bound_to_other_piggy", [-4]: "piggy_bound_to_other_tester" });

const fields = (raw) => {
  if (Array.isArray(raw)) { const o = {}; for (let i = 0; i + 1 < raw.length; i += 2) o[String(raw[i])] = String(raw[i + 1]); return o; }
  if (raw && typeof raw === "object") return { ...raw };
  return {};
};

export function createUpstashInviteStore({ cmd, prefix = ARASO_REDIS_PREFIX, maxInvites = INVITE_DEFAULTS.maxInvites, ttlMs = INVITE_DEFAULTS.ttlMs, now = () => Date.now(), randomBytes = (n) => crypto.randomBytes(n) } = {}) {
  if (typeof cmd !== "function" || !Number.isSafeInteger(maxInvites) || maxInvites < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) return null;
  async function lookup(token) {
    if (typeof token !== "string" || !INVITE_TOKEN_RE.test(token)) return null;
    const f = fields(await cmd("HGETALL", tokKey(prefix, inviteTokenDigest(token))));
    if (typeof f.testerId !== "string" || f.testerId === "") return null;
    return { testerId: f.testerId, piggy: f.piggy || "", expiresAt: Number(f.expiresAt) };
  }
  return Object.freeze({
    kind: "upstash",
    size: maxInvites, // fork-entry's "table not empty" check; the live count is the issued counter
    /** Operator only. -> { ok:true, token, testerId, expiresAt } (token shown once) | { ok:false, reason:"max_reached" } */
    async issue() {
      for (let i = 0; i < 4; i += 1) {
        const token = randomBytes(16).toString("base64url"); // [A-1115] 128 bit, 22 chars (pre-A-1115: randomBytes(32) = 256 bit, 43 chars)
        const testerId = `tester-${randomBytes(8).toString("hex")}`;
        const t = now(); const expiresAt = t + ttlMs;
        const r = Number(await cmd("EVAL", INVITE_ISSUE_LUA, 2, tokKey(prefix, inviteTokenDigest(token)), issuedKey(prefix), testerId, expiresAt, t, maxInvites, ttlMs));
        if (r === 1) return { ok: true, token, testerId, expiresAt };
        if (r === -1) return { ok: false, reason: "max_reached" };
      }
      throw new Error("INVITE_ISSUE_FAILED");
    },
    lookup,
    /** testerId for a usable token: bound (any age) or unbound and not expired. */
    // Read-only canonical binding for signed public re-entry on a device without the invite.
    async testerForPiggy(address) {
      const piggy = typeof address === "string" ? address.toLowerCase() : "";
      if (!ADDR_RE.test(piggy)) return null;
      const value = await cmd("GET", invitePiggyKey(prefix, piggy));
      return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value) ? value : null;
    },
    async testerFor(token) {
      const r = await lookup(token);
      if (!r) return null;
      if (r.piggy === "" && !(r.expiresAt > now())) return null;
      return r.testerId;
    },
    /** Bind once to the first Piggy (call only after the Piggy signature was verified). -> { ok, status } */
    async bind({ token, piggyAddress }) {
      const piggy = typeof piggyAddress === "string" ? piggyAddress.trim().toLowerCase() : "";
      if (typeof token !== "string" || !INVITE_TOKEN_RE.test(token)) return { ok: false, status: "not_invited" };
      if (!ADDR_RE.test(piggy)) return { ok: false, status: "bad_piggy" };
      const r = Number(await cmd("EVAL", INVITE_BIND_LUA, 2, tokKey(prefix, inviteTokenDigest(token)), invitePiggyKey(prefix, piggy), piggy, now()));
      const status = BIND_RESULT[r];
      if (!status) throw new Error("INVITE_STORE_BAD_REPLY");
      return { ok: r > 0, status };
    },
  });
}

/** Invite store from server env (same env pairs as the grant store) or null (fail-closed). */
export function inviteStoreFromEnv(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = readUpstashEnv(env);
  if (!cfg) return null;
  const cmd = createUpstashRest({ url: cfg.url, token: cfg.token, fetchImpl });
  return cmd ? createUpstashInviteStore({ cmd }) : null;
}
