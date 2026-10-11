// [A-956] Journey 2 entry — tester proof (server side). No network, no file I/O, no env reads here (the route passes config in).
//
//   testerId  = derived from a SERVER-CONFIG invite token (the request carries the token; the server only accepts tokens it was configured
//               with and never stores or logs the token itself — only its derived id). Token format + distribution = OPEN (Owner); this is
//               the slot. Local runs use one test token from env (value never committed).
//   challenge = server-made nonce (128-bit), bound to { app origin (uri), fork chainId, testerId, piggyAddress, forkInstanceId }, expires after 2 minutes, single use
//               (consume() removes it before any other check, so a replay — even of a valid signature — finds nothing).
//   proof     = the app signs the challenge text with the live Piggy signer (EIP-191 personal_sign, no new passkey); the server rebuilds
//               the text from ITS OWN record (never from the request) and recovers the signer address; it must equal the Piggy address.
import crypto from "node:crypto";
import { recoverMessageAddress } from "viem";

export const FORK_CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const FORK_CHALLENGE_HEADER = "Araso Journey 2 entry";
const NONCE_RE = /^[0-9a-f]{32}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const SIG_RE = /^0x[0-9a-f]{130}$/;
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest();
const lowAddr = (v) => (typeof v === "string" && ADDR_RE.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);

/**
 * Invite-token table from server config. `tokens` = the configured invite tokens (local: one test token from env). Kept only as digests.
 * testerFor(token) -> testerId | null. testerId = "tester-" + first 16 hex of sha256("araso.fork.tester|" + token): stable, not reversible.
 */
export function createInviteTable(tokens) {
  const list = (Array.isArray(tokens) ? tokens : []).filter((t) => typeof t === "string" && TOKEN_RE.test(t));
  const digests = list.map((t) => sha256(`araso.fork.invite|${t}`));
  const ids = list.map((t) => `tester-${sha256(`araso.fork.tester|${t}`).toString("hex").slice(0, 16)}`);
  return Object.freeze({
    size: digests.length,
    testerFor(token) {
      if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
      const d = sha256(`araso.fork.invite|${token}`);
      let hit = -1;
      for (let k = 0; k < digests.length; k += 1) if (crypto.timingSafeEqual(d, digests[k])) hit = k; // constant work over the table
      return hit >= 0 ? ids[hit] : null;
    },
  });
}

/** [A-960] Invite binding reuses this challenge (nonce · 2 min · single use · server-rebuilt text) under its own purpose and header, so a
 *  signature made for one purpose can never be verified for the other (the record carries the purpose; verify checks it). */
export const INVITE_BIND_CHALLENGE_HEADER = "Araso invite bind";
export const CHALLENGE_PURPOSE = Object.freeze({ forkEntry: "fork-entry", inviteBind: "invite-bind" });

/** The exact text the Piggy signs. Built by the server from its own record; the app checks the same shape before signing. */
export function challengeMessage({ purpose, uri, chainId, testerId, piggyAddress, forkInstanceId, nonce, expiresAt }) {
  if (purpose === CHALLENGE_PURPOSE.inviteBind) { // [A-960] 7 lines, no fork line
    return [
      INVITE_BIND_CHALLENGE_HEADER,
      `uri: ${uri}`,
      `chainId: ${chainId}`,
      `piggy: ${piggyAddress}`,
      `tester: ${testerId}`,
      `nonce: ${nonce}`,
      `expires: ${new Date(expiresAt).toISOString()}`,
    ].join("\n");
  }
  return [
    FORK_CHALLENGE_HEADER,
    `uri: ${uri}`, // [A-956 review fix 2] domain: the app origin from server config
    `chainId: ${chainId}`, // [A-956 review fix 2] the fork chain this entry is for
    `piggy: ${piggyAddress}`,
    `tester: ${testerId}`,
    `fork: ${forkInstanceId}`,
    `nonce: ${nonce}`,
    `expires: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");
}

/**
 * Challenge store. In-memory = ONE local server process only (testOnly-style: a hosted multi-instance server needs an atomic
 * take-and-delete store, e.g. KV GETDEL — OPEN with the hosting move). consume() is synchronous take-and-delete = single use.
 */
export function createMemoryChallengeStore({ max = 10000 } = {}) {
  const m = new Map();
  return {
    kind: "memory",
    localOnly: true,
    put(nonce, rec) {
      if (m.size >= max) { const first = m.keys().next().value; m.delete(first); }
      m.set(nonce, Object.freeze({ ...rec }));
    },
    consume(nonce) {
      if (typeof nonce !== "string" || !m.has(nonce)) return null;
      const rec = m.get(nonce);
      m.delete(nonce);
      return rec;
    },
    size: () => m.size,
  };
}

/** App origin accepted in the challenge `uri:` line: https://<host>[:port], or a loopback http origin for the local dev app. */
export function appOriginOk(v) {
  return typeof v === "string" && (/^https:\/\/[a-z0-9.-]+(:[1-9][0-9]{0,4})?$/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$/.test(v));
}

// [A-960] the record build is shared by the sync (memory store) and async (Redis store) issue paths. -> { ok, rec } | { ok:false, reason }
function buildChallenge({ purpose, uri, chainId, testerId, piggyAddress, forkInstanceId, now, randomHex }) {
  const invite = purpose === CHALLENGE_PURPOSE.inviteBind;
  if (purpose !== undefined && !invite && purpose !== CHALLENGE_PURPOSE.forkEntry) return { ok: false, reason: "bad_purpose" };
  if (!appOriginOk(uri)) return { ok: false, reason: "no_app_origin" };
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return { ok: false, reason: "no_chain" };
  const piggy = lowAddr(piggyAddress);
  if (!piggy) return { ok: false, reason: "bad_piggy" };
  if (typeof testerId !== "string" || !ID_RE.test(testerId)) return { ok: false, reason: "no_tester" };
  if (!invite && (typeof forkInstanceId !== "string" || !ID_RE.test(forkInstanceId))) return { ok: false, reason: "no_fork_instance" };
  const nonce = randomHex();
  if (!NONCE_RE.test(nonce)) return { ok: false, reason: "nonce_failed" };
  const expiresAt = now + FORK_CHALLENGE_TTL_MS;
  const rec = invite
    ? { purpose: CHALLENGE_PURPOSE.inviteBind, uri, chainId, nonce, testerId, piggyAddress: piggy, expiresAt }
    : { uri, chainId, nonce, testerId, piggyAddress: piggy, forkInstanceId, expiresAt };
  return { ok: true, rec };
}
const defaultRandomHex = () => crypto.randomBytes(16).toString("hex");

/** issueChallenge -> { ok, nonce, message, expiresAt } | { ok:false, reason } (synchronous store: memory) */
export function issueChallenge({ store, purpose, uri, chainId, testerId, piggyAddress, forkInstanceId, now = Date.now(), randomHex = defaultRandomHex }) {
  const b = buildChallenge({ purpose, uri, chainId, testerId, piggyAddress, forkInstanceId, now, randomHex });
  if (!b.ok) return b;
  store.put(b.rec.nonce, b.rec);
  return { ok: true, nonce: b.rec.nonce, message: challengeMessage(b.rec), expiresAt: b.rec.expiresAt };
}

/** [A-960] Same as issueChallenge, but awaits store.put (Redis store; works with the memory store too). */
export async function issueChallengeAsync({ store, purpose, uri, chainId, testerId, piggyAddress, forkInstanceId, now = Date.now(), randomHex = defaultRandomHex }) {
  const b = buildChallenge({ purpose, uri, chainId, testerId, piggyAddress, forkInstanceId, now, randomHex });
  if (!b.ok) return b;
  await store.put(b.rec.nonce, b.rec);
  return { ok: true, nonce: b.rec.nonce, message: challengeMessage(b.rec), expiresAt: b.rec.expiresAt };
}

/**
 * verifyChallenge — consume the nonce FIRST (single use, whatever happens next), then: not expired · same tester (from auth) · same Piggy
 * as the request · signature recovers to that Piggy over the server-rebuilt text. -> { ok, record } | { ok:false, reason }
 */
export async function verifyChallenge({ store, nonce, signature, testerId, piggyAddress, purpose = CHALLENGE_PURPOSE.forkEntry, now = Date.now() }) {
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return { ok: false, reason: "bad_nonce" };
  const rec = await store.consume(nonce); // [A-960] await: a Redis store answers async (memory store: plain value)
  if (!rec) return { ok: false, reason: "unknown_or_used_nonce" };
  if ((rec.purpose || CHALLENGE_PURPOSE.forkEntry) !== purpose) return { ok: false, reason: "purpose_mismatch" }; // [A-960]
  if (!(now < rec.expiresAt)) return { ok: false, reason: "challenge_expired" };
  if (rec.testerId !== testerId) return { ok: false, reason: "tester_mismatch" };
  const piggy = lowAddr(piggyAddress);
  if (!piggy || rec.piggyAddress !== piggy) return { ok: false, reason: "piggy_mismatch" };
  const sig = typeof signature === "string" ? signature.trim().toLowerCase() : "";
  if (!SIG_RE.test(sig)) return { ok: false, reason: "bad_signature" };
  let signer = null;
  try { signer = (await recoverMessageAddress({ message: challengeMessage(rec), signature: sig })).toLowerCase(); } catch { signer = null; }
  if (signer !== rec.piggyAddress) return { ok: false, reason: "signer_not_piggy" };
  return { ok: true, record: rec };
}

// [A-960] Challenge store on Upstash Redis for serverless (many instances): put = SET NX with a TTL (challenge life + 30 s slack; the record's
// own expiresAt is still checked) · consume = ONE EVAL get-and-delete (single use across instances). `cmd` = createUpstashRest(...).
export const CHALLENGE_TAKE_LUA = "local v=redis.call('get',KEYS[1]) if v then redis.call('del',KEYS[1]) end return v";
export function createRedisChallengeStore({ cmd, prefix = "araso:v1" } = {}) {
  if (typeof cmd !== "function") return null;
  const key = (nonce) => `${prefix}:challenge:${nonce}`;
  return Object.freeze({
    kind: "upstash",
    async put(nonce, rec) {
      if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) throw new Error("CHALLENGE_BAD_NONCE");
      const r = await cmd("SET", key(nonce), JSON.stringify(rec), "NX", "PX", FORK_CHALLENGE_TTL_MS + 30000);
      if (r !== "OK") throw new Error("CHALLENGE_PUT_FAILED");
    },
    async consume(nonce) {
      if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return null;
      const raw = await cmd("EVAL", CHALLENGE_TAKE_LUA, 1, key(nonce));
      if (typeof raw !== "string") return null;
      try { return Object.freeze(JSON.parse(raw)); } catch { return null; }
    },
  });
}
