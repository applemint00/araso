// [A-956] Journey 2 entry — the app side. No screen, no copy, no button: main.js calls these from the existing post-Journey-1 "tap me!"
// tap (root, testnet, release level ≥ 2, fork build config present) and before any fork money action. Every refusal is silent (the
// caller leaves Home exactly as it is).
//   · The app never tops anything up, never sees an Admin URL/token, and never decides entry from its own values: the server reads
//     Journey 1 on chain 10143 itself and answers allowed / not allowed.
//   · Tester proof = the server's challenge text signed with the LIVE Piggy signer (EIP-191 personal_sign). No new passkey prompt: no live
//     signer = no entry attempt. The text is checked against the expected shape (this Piggy, this nonce, ≤ 2 min) before it is signed,
//     so the server can never make the Piggy sign anything else through this path.
//   · Invite token: read from this device (araso.forkInvite.v1). Its format and how it reaches the device = OPEN (Owner); slot only.
//   · Re-check (stored journey "2"): checkForkPermission asks the server every time — no cached verdict; a changed forkInstanceId = re-entry.
import { releaseAllows } from "./release-gate.js";

export const FORK_INVITE_KEY = "araso.forkInvite.v1";
export const FORK_ENTRY_PATH = "/api/fork-entry";
export const FORK_ENTRY_HEADER = "Araso Journey 2 entry"; // = api/_lib/fork-auth.js FORK_CHALLENGE_HEADER
export const FORK_CHALLENGE_MAX_MS = 2 * 60 * 1000;
const TESTNET_ID = "monad-testnet";
const FORK_ID = "monad-fork";
const HASH_RE = /^0x[0-9a-f]{64}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const DEV_BUILD = typeof import.meta.env === "object" && import.meta.env !== null ? import.meta.env.DEV === true && import.meta.env.MODE !== "production" : false;

const hasForkEnv = (env) => typeof env?.VITE_ARASO_FORK_RPC_URL === "string" && env.VITE_ARASO_FORK_RPC_URL.trim() !== ""
  && typeof env?.VITE_ARASO_FORK_INSTANCE_ID === "string" && env.VITE_ARASO_FORK_INSTANCE_ID.trim() !== "";

/** The entry is offered only at root on the active testnet profile, release level ≥ 2, with the fork build config present (so the
 *  switched boot can pick the fork — boot-profile.js rule 2). */
export function forkEntryOpen({ level, profile, env } = {}) {
  return releaseAllows("second", level) && !!profile && profile.id === TESTNET_ID && profile.status === "active" && hasForkEnv(env);
}

/** True on the fork profile (the place where fork money actions need a fresh server re-check). */
export function onForkProfile(profile) {
  return !!profile && profile.id === FORK_ID && profile.status === "active";
}

/** Same-origin path; a vite dev build may name a loopback entry server (http://<loopback>:<port>/api/fork-entry) — never in production:
 *  DEV_BUILD is a build constant (false in a production build), so the dev branch is dead code there and is dropped from the bundle. */
export function forkEntryUrl(env, dev = DEV_BUILD) {
  if (DEV_BUILD) return devForkEntryUrl(env, dev);
  return FORK_ENTRY_PATH;
}
function devForkEntryUrl(env, dev) {
  const v = typeof env?.VITE_ARASO_FORK_ENTRY_URL === "string" ? env.VITE_ARASO_FORK_ENTRY_URL.trim() : "";
  const m = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/api\/fork-entry$/.exec(v);
  return dev === true && m && Number(m[1]) <= 65535 ? v : FORK_ENTRY_PATH;
}

export function readForkInvite(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { const v = storage?.getItem(FORK_INVITE_KEY); return typeof v === "string" && /^[A-Za-z0-9._~-]{16,200}$/.test(v) ? v : null; } catch { return null; }
}

/** Pointers to this Piggy's Journey 1 txs (the newest legacy receipt with both hashes). The server re-reads them; nothing here is trusted. */
export function journey1Pointers(receipts) {
  for (const r of Array.isArray(receipts) ? receipts : []) {
    if (!r || typeof r !== "object" || r.kind === "add_money") continue;
    const dep = low(r.depositTxHash); const red = low(r.redeemTxHash);
    if (HASH_RE.test(dep) && HASH_RE.test(red) && dep !== red) return { depositTxHash: dep, redeemTxHash: red };
  }
  return null;
}

/** The challenge text must be exactly the server template for THIS app origin, the fork chain, THIS Piggy + nonce, expiring within 2
 *  minutes. [A-956 review fix 2] `uri:` = this page's origin and `chainId:` = the fork chain (31337143) — a text made for another site or
 *  chain is never signed. */
export const FORK_CHAIN_ID = 31337143; // = A-946 FORK_CHAIN_ID (chain-profile.js fork profile numericChainId)
export function challengeTextOk(message, { origin, piggyAddress, nonce, expiresAt, now = Date.now() }) {
  if (typeof message !== "string" || message.length > 800) return false;
  const lines = message.split("\n");
  if (lines.length !== 8 || lines[0] !== FORK_ENTRY_HEADER) return false;
  if (typeof origin !== "string" || origin === "" || lines[1] !== `uri: ${origin}`) return false;
  if (lines[2] !== `chainId: ${FORK_CHAIN_ID}`) return false;
  if (lines[3] !== `piggy: ${low(piggyAddress)}` || !ADDR_RE.test(low(piggyAddress))) return false;
  if (!/^tester: [a-z0-9][a-z0-9._:-]{0,63}$/.test(lines[4]) || !/^fork: [a-z0-9][a-z0-9._:-]{0,63}$/.test(lines[5])) return false;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce) || lines[6] !== `nonce: ${nonce}`) return false;
  if (!Number.isSafeInteger(expiresAt) || lines[7] !== `expires: ${new Date(expiresAt).toISOString()}`) return false;
  return expiresAt > now && expiresAt - now <= FORK_CHALLENGE_MAX_MS + 5000;
}

async function post(fetchImpl, url, invite, body) {
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...(invite ? { "x-araso-invite": invite } : {}) }, body: JSON.stringify(body), credentials: "omit", cache: "no-store" });
    let j = null; try { j = await res.json(); } catch { j = null; }
    return { status: res.status, body: j && typeof j === "object" ? j : null };
  } catch { return { status: 0, body: null }; }
}

/**
 * requestForkEntry → { allowed: true, forkInstanceId } | { allowed: false, reason }. signMessage(text) = the live Piggy signer.
 * Order: challenge → shape check → sign → enter. The server verifies, reads Journey 1, records the entry and tops up.
 */
export async function requestForkEntry({ fetchImpl = globalThis.fetch, url = FORK_ENTRY_PATH, invite, publicEntry = false, piggyAddress, signMessage, journey1, origin = globalThis.location?.origin, now = () => Date.now() } = {}) {
  const piggy = low(piggyAddress);
  if (!invite && publicEntry !== true) return { allowed: false, reason: "no_invite" };
  if (!ADDR_RE.test(piggy)) return { allowed: false, reason: "no_piggy" };
  if (typeof signMessage !== "function") return { allowed: false, reason: "no_live_signer" };
  if (!journey1 || !HASH_RE.test(low(journey1.depositTxHash)) || !HASH_RE.test(low(journey1.redeemTxHash))) return { allowed: false, reason: "no_journey1" };
  const c = await post(fetchImpl, url, invite, { action: "challenge", piggyAddress: piggy });
  if (c.status !== 200 || c.body?.ok !== true) return { allowed: false, reason: c.body?.reason || "challenge_failed" };
  const { nonce, message, expiresAt } = c.body;
  if (!challengeTextOk(message, { origin, piggyAddress: piggy, nonce, expiresAt, now: now() })) return { allowed: false, reason: "challenge_shape" };
  let signature;
  try { signature = await signMessage(message); } catch { return { allowed: false, reason: "sign_failed" }; }
  if (typeof signature !== "string") return { allowed: false, reason: "sign_failed" };
  const e = await post(fetchImpl, url, invite, { action: "enter", nonce, signature, piggyAddress: piggy, journey1: { depositTxHash: low(journey1.depositTxHash), redeemTxHash: low(journey1.redeemTxHash) } });
  if (e.status !== 200 || e.body?.ok !== true || e.body.allowed !== true) return { allowed: false, reason: e.body?.reason || "enter_failed" };
  const id = low(e.body.forkInstanceId);
  if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(id)) return { allowed: false, reason: "enter_bad_answer" };
  return { allowed: true, forkInstanceId: id };
}

/** Fresh server re-check (never cached). The fork instance this page booted with must be the server's current one. */
export async function checkForkPermission({ fetchImpl = globalThis.fetch, url = FORK_ENTRY_PATH, invite, publicEntry = false, piggyAddress, forkInstanceId } = {}) {
  const piggy = low(piggyAddress);
  if (!invite && publicEntry !== true) return { allowed: false, reason: "no_invite" };
  if (!ADDR_RE.test(piggy)) return { allowed: false, reason: "no_piggy" };
  if (typeof forkInstanceId !== "string" || forkInstanceId.trim() === "") return { allowed: false, reason: "no_fork_instance" };
  const s = await post(fetchImpl, url, invite, { action: "status", piggyAddress: piggy, forkInstanceId: low(forkInstanceId) });
  if (s.status !== 200 || s.body?.ok !== true || s.body.allowed !== true) return { allowed: false, reason: s.body?.reason || "status_failed", reenter: s.body?.reenter === true };
  if (low(s.body.forkInstanceId) !== low(forkInstanceId)) return { allowed: false, reason: "fork_instance_changed", reenter: true };
  return { allowed: true };
}

// ── [A-960] invite link → first grant (보충 7). No screen, no copy. ─────────────────────────────────────────────────────────────────────
// Link: `/?i=<display>#invite=<secret>`. The secret is taken out of the address bar at boot (only the `invite=` part; a Gift `#g=…&t=…&v=…`
// in the same fragment stays byte-for-byte so the Gift reader still sees it) and kept on this device under FORK_INVITE_KEY (the same slot
// the Journey 2 entry reads). Right before the first grant the app binds the invite to the live Piggy: challenge (server text, checked
// against the expected shape first) → live Piggy signature (no new passkey) → bind. Any failure is silent; the grant call still runs and
// the server decides (not bound = 403 "not allowlisted" = the existing grant failure path).
export const INVITE_BOUND_KEY = "araso.inviteBound.v1";
export const INVITE_BIND_HEADER = "Araso invite bind"; // = api/_lib/fork-auth.js INVITE_BIND_CHALLENGE_HEADER
export const INVITE_CHAIN_ID = 10143; // Monad testnet (the grant chain)
const INVITE_TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;

/** Split the invite out of a location.hash. -> { found, token|null, hash } where `hash` is the fragment to keep ("" or "#…"). Parts other
 *  than `invite=` are kept in order and unchanged (no re-encoding). A malformed invite value is still removed (found:true, token:null). */
export function takeInviteFromHash(hash) {
  const h = typeof hash === "string" ? hash : "";
  if (h.length < 2 || h[0] !== "#") return { found: false, token: null, hash: h };
  const parts = h.slice(1).split("&");
  let token = null; let found = false;
  const keep = [];
  for (const p of parts) {
    if (p === "invite" || p.startsWith("invite=")) {
      found = true;
      let v = p.slice("invite=".length);
      try { v = decodeURIComponent(v); } catch { v = ""; }
      if (token === null && INVITE_TOKEN_RE.test(v)) token = v;
    } else keep.push(p);
  }
  if (!found) return { found: false, token: null, hash: h };
  const rest = keep.filter((p) => p !== "").join("&");
  return { found: true, token, hash: rest ? `#${rest}` : "" };
}

export function storeInvite(token, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (typeof token !== "string" || !INVITE_TOKEN_RE.test(token)) return false;
  try {
    if (storage?.getItem(FORK_INVITE_KEY) !== token) { storage?.setItem(FORK_INVITE_KEY, token); storage?.removeItem(INVITE_BOUND_KEY); } // newest link wins
    return true;
  } catch { return false; }
}
export function inviteBoundFor(storage, piggyAddress) {
  try { const v = storage?.getItem(INVITE_BOUND_KEY); return typeof v === "string" && v !== "" && v === low(piggyAddress); } catch { return false; }
}
export function markInviteBound(storage, piggyAddress) {
  try { if (ADDR_RE.test(low(piggyAddress))) storage?.setItem(INVITE_BOUND_KEY, low(piggyAddress)); } catch { /* no-op */ }
}

/** The invite-bind text must be exactly the server template for THIS origin, chain 10143, THIS Piggy + nonce, expiring within 2 minutes. */
export function inviteBindTextOk(message, { origin, piggyAddress, nonce, expiresAt, now = Date.now() }) {
  if (typeof message !== "string" || message.length > 800) return false;
  const lines = message.split("\n");
  if (lines.length !== 7 || lines[0] !== INVITE_BIND_HEADER) return false;
  if (typeof origin !== "string" || origin === "" || lines[1] !== `uri: ${origin}`) return false;
  if (lines[2] !== `chainId: ${INVITE_CHAIN_ID}`) return false;
  if (lines[3] !== `piggy: ${low(piggyAddress)}` || !ADDR_RE.test(low(piggyAddress))) return false;
  if (!/^tester: [a-z0-9][a-z0-9._:-]{0,63}$/.test(lines[4])) return false;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce) || lines[5] !== `nonce: ${nonce}`) return false;
  if (!Number.isSafeInteger(expiresAt) || lines[6] !== `expires: ${new Date(expiresAt).toISOString()}`) return false;
  return expiresAt > now && expiresAt - now <= FORK_CHALLENGE_MAX_MS + 5000;
}

/** bindInviteBeforeGrant → { bound: true } | { bound: false, reason }. url = the grant endpoint (`${RELAYER_URL}/grant`). Never throws. */
export async function bindInviteBeforeGrant({ fetchImpl = globalThis.fetch, url, invite, piggyAddress, signMessage, origin = globalThis.location?.origin, now = () => Date.now() } = {}) {
  const piggy = low(piggyAddress);
  if (typeof url !== "string" || url === "") return { bound: false, reason: "no_url" };
  if (typeof invite !== "string" || !INVITE_TOKEN_RE.test(invite)) return { bound: false, reason: "no_invite" };
  if (!ADDR_RE.test(piggy)) return { bound: false, reason: "no_piggy" };
  if (typeof signMessage !== "function") return { bound: false, reason: "no_live_signer" };
  const c = await post(fetchImpl, url, invite, { action: "invite_challenge", piggyAddress: piggy });
  if (c.status !== 200 || c.body?.ok !== true) return { bound: false, reason: c.body?.error || "challenge_failed" };
  const { nonce, message, expiresAt } = c.body;
  if (!inviteBindTextOk(message, { origin, piggyAddress: piggy, nonce, expiresAt, now: now() })) return { bound: false, reason: "challenge_shape" };
  let signature;
  try { signature = await signMessage(message); } catch { return { bound: false, reason: "sign_failed" }; }
  if (typeof signature !== "string") return { bound: false, reason: "sign_failed" };
  const b = await post(fetchImpl, url, invite, { action: "invite_bind", nonce, signature, piggyAddress: piggy });
  if (b.status !== 200 || b.body?.ok !== true || b.body.bound !== true) return { bound: false, reason: b.body?.error || "bind_failed" };
  return { bound: true };
}
// ── [A-960] end ──
