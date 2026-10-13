// [A-960] FAKE Upstash Redis REST endpoint — in memory, in process, no network, no port (same approach as relayer/test/gift-sponsor-vercel.mjs).
// Commands: GET · SET [NX] [PX ms] · DEL · MGET · SADD · SMEMBERS · HGETALL · EVAL (the A-960 scripts only).
// EVAL runs a JS mirror of each Lua script, chosen by the EXACT script text the adapters export — an unknown script throws. The mirror runs
// in one synchronous step = Redis's "a script is one atomic unit". Every request first waits a small, deterministic-but-mixed delay so
// concurrent callers really interleave BETWEEN commands (never inside one). Limits: the Lua itself is not executed here (no Lua in this
// environment) — the mirrors follow the scripts line by line; real-Redis execution = Owner's resource (RECEIPT open item).
// Lives in app/test/helpers/ so app/test/run-all.mjs never runs it as a suite.
import { GRANT_CAS_LUA, GRANT_RELEASE_LUA, GRANT_RESERVE_LUA, PUBLIC_GRANT_RESERVE_LUA } from "../../../api/_lib/grant-redis-store.js";
import { INVITE_BIND_LUA, INVITE_ISSUE_LUA } from "../../../api/_lib/invite-redis-store.js";
import { FORK_PUT_IF_ABSENT_LUA } from "../../../api/_lib/fork-ledger-redis-store.js";
import { CHALLENGE_TAKE_LUA } from "../../../api/_lib/fork-auth.js";

export const FAKE_KV_URL = "https://kv-a960.invalid";
export const FAKE_KV_TOKEN = "fake-kv-token-a960";

export function fakeUpstash({ url = FAKE_KV_URL, token = FAKE_KV_TOKEN, jitter = true } = {}) {
  const str = new Map(); const hashes = new Map(); const sets = new Map(); const exp = new Map();
  const clock = { t: 1_800_000_000_000 };
  const bodies = []; // every raw request body (to prove what never reaches the store)
  const evals = []; // script names, in order
  let tick = 0;
  let down = false;
  const alive = (k) => {
    if (exp.has(k) && exp.get(k) <= clock.t) { str.delete(k); hashes.delete(k); exp.delete(k); }
    return str.has(k) || hashes.has(k);
  };
  const get = (k) => (alive(k) && str.has(k) ? str.get(k) : null);
  const exists = (k) => (alive(k) ? 1 : 0);
  const hget = (k, f) => (alive(k) && hashes.has(k) && hashes.get(k).has(f) ? hashes.get(k).get(f) : null);
  const hset = (k, ...fv) => { alive(k); const h = hashes.get(k) ?? new Map(); for (let i = 0; i + 1 < fv.length; i += 2) h.set(fv[i], fv[i + 1]); hashes.set(k, h); };
  const setNx = (k, v) => { if (alive(k)) return false; str.set(k, v); exp.delete(k); return true; };
  const num = (v) => { const n = Number(v ?? "0"); return Number.isFinite(n) ? n : 0; };

  const SCRIPTS = new Map([
    [GRANT_RESERVE_LUA, ["grant.reserve", (K, A) => {
      if (A[2] === "1" && exists(K[2]) === 0) return -2;
      if (exists(K[0]) === 1) return 0;
      if (num(get(K[1])) >= Number(A[0])) return -1;
      str.set(K[0], A[1]); str.set(K[1], String(num(get(K[1])) + 1)); return 1;
    }]],
    [PUBLIC_GRANT_RESERVE_LUA, ["grant.publicReserve", (K, A) => {
      if (exists(K[0]) === 1) return 0;
      const invited = exists(K[2]) === 1, counter = invited ? K[1] : K[3], cap = Number(invited ? A[0] : A[2]);
      if (!Number.isSafeInteger(cap) || cap < 1) return -2;
      if (num(get(counter)) >= cap) return -1;
      str.set(K[0], JSON.stringify({ ...JSON.parse(A[1]), publicBudget: !invited }));
      str.set(counter, String(num(get(counter)) + 1)); return 1;
    }]],
    [GRANT_CAS_LUA, ["grant.cas", (K, A) => { if (get(K[0]) !== A[0]) return 0; str.set(K[0], A[1]); return 1; }]],
    [GRANT_RELEASE_LUA, ["grant.release", (K, A) => { if (get(K[0]) !== A[0]) return 0; str.set(K[0], A[1]); str.set(K[1], String(num(get(K[1])) - 1)); return 1; }]],
    [INVITE_ISSUE_LUA, ["invite.issue", (K, A) => {
      if (num(get(K[1])) >= Number(A[3])) return -1;
      if (exists(K[0]) === 1) return 0;
      hset(K[0], "testerId", A[0], "expiresAt", A[1], "issuedAt", A[2], "piggy", "");
      exp.set(K[0], clock.t + Number(A[4]));
      str.set(K[1], String(num(get(K[1])) + 1)); return 1;
    }]],
    [INVITE_BIND_LUA, ["invite.bind", (K, A) => {
      if (exists(K[0]) === 0) return -1;
      const tester = hget(K[0], "testerId"); if (!tester) return -1;
      const bound = hget(K[0], "piggy");
      if (bound) return bound === A[0] ? 1 : -3;
      const e = Number(hget(K[0], "expiresAt") ?? "0");
      if (!Number.isFinite(e) || e <= Number(A[1])) return -2;
      if (!setNx(K[1], tester)) return -4;
      hset(K[0], "piggy", A[0], "boundAt", A[1]); exp.delete(K[0]); return 2;
    }]],
    [FORK_PUT_IF_ABSENT_LUA, ["fork.putIfAbsent", (K, A) => {
      if (!setNx(K[0], A[0])) return get(K[0]);
      const s = sets.get(K[1]) ?? new Set(); s.add(A[1]); sets.set(K[1], s); return 1;
    }]],
    [CHALLENGE_TAKE_LUA, ["challenge.take", (K) => { const v = get(K[0]); if (v !== null) { str.delete(K[0]); exp.delete(K[0]); } return v; }]],
  ]);

  const run = (a) => {
    const [c, ...r] = a;
    if (c === "GET") return get(r[0]);
    if (c === "SET") {
      const [k, v, ...o] = r; const nx = o.includes("NX"); const px = o.includes("PX") ? Number(o[o.indexOf("PX") + 1]) : null;
      if (nx && alive(k)) return null;
      hashes.delete(k); str.set(k, v); if (px) exp.set(k, clock.t + px); else exp.delete(k); return "OK";
    }
    if (c === "DEL") { const had = alive(r[0]); str.delete(r[0]); hashes.delete(r[0]); exp.delete(r[0]); return had ? 1 : 0; }
    if (c === "MGET") return r.map((k) => get(k));
    if (c === "SADD") { const s = sets.get(r[0]) ?? new Set(); s.add(r[1]); sets.set(r[0], s); return 1; }
    if (c === "SMEMBERS") return [...(sets.get(r[0]) ?? [])];
    if (c === "HGETALL") { if (!alive(r[0]) || !hashes.has(r[0])) return []; return [...hashes.get(r[0])].flat(); }
    if (c === "EVAL") {
      const s = SCRIPTS.get(r[0]); if (!s) throw new Error("fake KV: unknown script");
      const nk = Number(r[1]); const keys = r.slice(2, 2 + nk); const argv = r.slice(2 + nk);
      evals.push(s[0]); return s[1](keys, argv);
    }
    throw new Error(`fake KV: unsupported ${c}`);
  };

  const fetchImpl = async (u, init) => {
    if (String(u) !== url) throw new Error("fake KV: wrong url");
    if (init?.method !== "POST" || init?.headers?.authorization !== `Bearer ${token}`) return { status: 401, text: async () => JSON.stringify({ error: "unauthorized" }) };
    bodies.push(init.body);
    const n = (tick += 1);
    if (jitter) await new Promise((res) => setTimeout(res, (n * 7) % 3));
    if (down) return { status: 503, text: async () => "" };
    let result;
    try { result = run(JSON.parse(init.body)); } catch (e) { return { status: 200, text: async () => JSON.stringify({ error: String(e.message) }) }; }
    return { status: 200, text: async () => JSON.stringify({ result }) };
  };

  return {
    url, token, fetchImpl, clock, bodies, evals,
    setDown(v) { down = v === true; },
    /** every key and stored value (strings, hash fields, set members) as one text, for "never stored" checks */
    dump() {
      const out = [];
      for (const [k, v] of str) out.push(k, v);
      for (const [k, h] of hashes) { out.push(k); for (const [f, v] of h) out.push(f, v); }
      for (const [k, s] of sets) { out.push(k, ...s); }
      return out.join("\n");
    },
    ttlOf(k) { return exp.has(k) ? exp.get(k) - clock.t : null; },
  };
}
