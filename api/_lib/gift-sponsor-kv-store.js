// [A-913] GiftSponsorStore on Vercel KV (Upstash Redis REST). Production ledger for the serverless sponsor: no disk, no shared process, so every
// exclusivity guarantee comes from a CONDITIONAL ATOMIC write on the store:
//   register gasTx SET gastx NX + SET dep NX (giftId -> deposit tx hash recorded once; one hash per giftId)
//   reserve        ONE EVAL: gift SET NX + deposit-hash ownership + SADD ids (atomic; one entry per giftId, one deposit tx per giftId; same giftId may retry)
//   sponsor lease  SET lease owner NX PX  (one driver at a time: request or cron pass) · renew / release = EVAL compare-and-act on the owner id
// Entry updates are plain GET -> modify -> SET: they only run while the caller holds the lease (the service/reconciler fence every send with renewLease).
// Transport: POST <KV_REST_API_URL> with a JSON command array and `authorization: Bearer <KV_REST_API_TOKEN>` (env names set by the Vercel KV / Upstash integration).
// The stored plan contains the claim preimage (the Gift capability token the sponsor sees anyway - A-906 residual): the store is private to this project; never log values.
// Nothing here talks to the chain or holds a signing key.

import { applySponsorTransition } from "../../relayer/src/gift-sponsor-service.mjs";

const RENEW = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
// [F-4] reserve is ONE atomic EVAL: entry SET NX + deposit-hash ownership + SADD ids together (no crash window that leaves an entry reconcile never lists).
//   returns 1 reserved · 0 giftId already reserved · -1 deposit tx already registered/used by another gift
const RESERVE = "if redis.call('exists',KEYS[1])==1 then return 0 end "
  + "if ARGV[2]~='' then local o=redis.call('get',KEYS[3]) if o and o~=ARGV[3] then return -1 end if not o then redis.call('set',KEYS[3],ARGV[3]) end end "
  + "redis.call('set',KEYS[1],ARGV[1]) redis.call('sadd',KEYS[2],ARGV[3]) return 1";
// register giftId -> gasTx atomically: 1 created · 2 same · 3 conflict (other hash for this giftId) · 4 reused (hash belongs to another gift)
const REGISTER = "local cur=redis.call('get',KEYS[1]) if cur then if cur==ARGV[1] then return 2 else return 3 end end "
  + "local o=redis.call('get',KEYS[2]) if o and o~=ARGV[2] then return 4 end if not o then redis.call('set',KEYS[2],ARGV[2]) end redis.call('set',KEYS[1],ARGV[1]) return 1";
// fixed-window counter: INCR, and EXPIRE on the first hit
const RATE = "local c=redis.call('incr',KEYS[1]) if c==1 then redis.call('expire',KEYS[1],ARGV[1]) end return c";
const B32 = /^0x[0-9a-f]{64}$/;

export function createVercelKvGiftSponsorStore({ url, token, fetchImpl = globalThis.fetch, prefix = "gift-sponsor", timeoutMs = 8000 } = {}) {
  if (typeof url !== "string" || !/^https:\/\/[^\s/]+\/?$/.test(url) || typeof token !== "string" || token === "") return null;
  const base = url.replace(/\/$/, "");
  const K = { gift: (id) => `${prefix}:gift:${id}`, ids: `${prefix}:ids`, dep: (tx) => `${prefix}:dep:${tx}`, gastx: (id) => `${prefix}:gastx:${id}`, lease: `${prefix}:lease`, arch: (id) => `${prefix}:arch:${id}:${Date.now()}` };

  async function cmd(...args) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args.map((a) => (typeof a === "number" ? String(a) : a))), signal: ac.signal, redirect: "error" });
      if (!res || res.status !== 200) throw new Error("KV_HTTP");
      const j = JSON.parse(await res.text());
      if (j && typeof j.error === "string") throw new Error("KV_ERROR");
      return j.result;
    } finally { clearTimeout(t); }
  }
  const idOk = (id) => { if (typeof id !== "string" || !B32.test(id)) throw new Error("LEDGER_BAD_GIFT_ID"); return id; };
  const load = async (id) => { const raw = await cmd("GET", K.gift(idOk(id))); return raw ? JSON.parse(raw) : null; };
  const must = async (id) => { const e = await load(id); if (!e) throw new Error("LEDGER_NO_ENTRY"); return e; };
  const save = (e) => cmd("SET", K.gift(e.giftId), JSON.stringify(e));

  return {
    kind: "vercel-kv",
    get: (id) => load(id),
    async list() {
      const ids = (await cmd("SMEMBERS", K.ids)) ?? [];
      const out = [];
      for (const id of ids) { const e = await load(id); if (e) out.push(e); }
      return out;
    },
    async reserve(id, plan = null) {
      idOk(id);
      const entry = { giftId: id, state: "RESERVED", plan, revokeStatus: null, inflight: null, history: [{ state: "RESERVED", at: Date.now() }] };
      const dep = plan?.depositTx ?? "";
      const r = Number(await cmd("EVAL", RESERVE, 3, K.gift(id), K.ids, dep ? K.dep(dep) : K.dep("none"), JSON.stringify(entry), dep, id));
      if (r === 0) throw new Error("LEDGER_GIFT_ALREADY_RESERVED");
      if (r === -1) throw new Error("LEDGER_DEPOSIT_ALREADY_USED");
    },
    async update(id, state, patch = {}) { const e = await must(id); applySponsorTransition(e, state); Object.assign(e, patch, { state }); await save(e); },
    async mark(id, patch) { const e = await must(id); Object.assign(e, patch); await save(e); },
    async release(id) { const e = await load(id); if (e?.state === "RESERVED" && !e.inflight) { await cmd("DEL", K.gift(id)); await cmd("SREM", K.ids, id); } },
    async archive(id, reason) {
      const e = await must(id);
      await cmd("SET", K.arch(id), JSON.stringify({ ...e, archivedReason: String(reason).slice(0, 60), archivedAt: Date.now() }));
      await cmd("DEL", K.gift(id)); await cmd("SREM", K.ids, id);
    },
    async gasTxOf(giftId) { return (await cmd("GET", K.gastx(idOk(giftId)))) ?? null; },
    async registerGasTx(giftId, hash) {
      idOk(giftId);
      const r = Number(await cmd("EVAL", REGISTER, 2, K.gastx(giftId), K.dep(hash), hash, giftId));
      return ({ 1: "created", 2: "same", 3: "conflict", 4: "reused" })[r] ?? "conflict";
    },
    /** [F-6] fixed-window counter; resolves to the count INCLUDING this hit. Callers compare to their injected limit. */
    async hit(bucket, windowSeconds) { return Number(await cmd("EVAL", RATE, 1, `${prefix}:rl:${bucket}`, Math.floor(windowSeconds))); },
    async depositUsedBy(txHash) { return (await cmd("GET", K.dep(txHash))) ?? null; },
    async acquireLease(owner, ttlMs) { return (await cmd("SET", K.lease, owner, "NX", "PX", Math.floor(ttlMs))) === "OK"; },
    async renewLease(owner, ttlMs) { return Number(await cmd("EVAL", RENEW, 1, K.lease, owner, Math.floor(ttlMs))) === 1; },
    async releaseLease(owner) { await cmd("EVAL", RELEASE, 1, K.lease, owner); },
    close() {},
  };
}
