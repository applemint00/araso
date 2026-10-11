// [A-956] Server → A-949 fork Admin client. SERVER ONLY: the Admin URL and bearer token come from server env (never VITE_*, never
// in a response, an error text or a log line). The Admin must be loopback: exactly http://127.0.0.1:<port> (A-949 binds it there).
//   instance() -> { ok, forkInstanceId, chainId, forkStartBlock } | { ok:false, reason }   (GET /admin/instance — the CURRENT instance)
//   topup({ piggyAddress, asset, grantVersion }) -> { ok, noop, key, amountRaw, forkInstanceId } | { ok:false, reason }
// Idempotency lives in the Admin (A-949: key forkInstanceId|piggy|asset|grantVersion, mutations serialized, repeat = noop:true), so two
// concurrent entries for the same Piggy produce exactly one top-up per asset. Errors are reason codes only (no URL, no token, no body).
// [A-959] The assets a top-up may name = the rows of the fork profile's own asset table (app/src/chain-profile.js, A-955: USDC · MON ·
// WETH · AUSD). No list of asset names lives here: an asset that is not a row of that table = bad_asset, before any Admin call.
// [A-987] Signed-HTTPS mode (Admin remote path A): when the Admin lives in a remote container (Railway), Vercel cannot reach its loopback
// port. Then — and only when server env holds BOTH an https Guard URL and an HMAC secret — topup() POSTs <guard>/araso-admin/v1/topup with
// an HMAC over (ts, nonce, sha256(body)); the container front checks it and forwards to its loopback Admin (P2). The Admin bearer never
// leaves the container. instance() in this mode = the Guard's public `araso_guardInfo` (no secret sent). Signing string = signTopup() below.
// Both modes' env present (mixed) or one mode half-configured = null client = the route refuses (fail closed), as with no env at all.
import crypto from "node:crypto";
import { FORK_GUARD_METHOD, FORK_GUARD_NAME, resolveChainProfile } from "../../app/src/chain-profile.js";

export const FORK_ADMIN_URL_ENV = "ARASO_FORK_ADMIN_URL";
export const FORK_ADMIN_TOKEN_ENV = "ARASO_FORK_ADMIN_TOKEN";
export const FORK_GUARD_URL_ENV = "ARASO_FORK_GUARD_URL"; // [A-987] https origin of the public Guard (Railway), no path
export const FORK_ADMIN_HMAC_SECRET_ENV = "ARASO_FORK_ADMIN_HMAC_SECRET"; // [A-987] same value as the container's HMAC secret
export const SIGNED_TOPUP_PATH = "/araso-admin/v1/topup";
export const SIG_HEADER = "x-araso-sig";
export const TS_HEADER = "x-araso-ts";
export const NONCE_HEADER = "x-araso-nonce";
const HMAC_SECRET_MIN = 32;
const TS_RE = /^(0|[1-9][0-9]{0,15})$/;
const NONCE_HEX_RE = /^[0-9a-f]{32}$/;
const ADMIN_URL_RE = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// pre-A-987 P2 r2: const GRANT_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const GRANT_VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/; // [A-987 P2 r2] lower-case only = api/fork-entry.js + the container GRANT_VERSION shape

// [A-959] The fork profile's asset table, read through the profile resolver (the table itself is not exported; the resolver attaches it
// to the fork profile only). The rpcUrl / forkInstanceId here are placeholders that only satisfy the resolver's shape check — nothing
// reads them, and the table does not depend on them. Frozen rows: { symbol, address|null, decimals, native? }.
const FORK_TABLE_PROBE = Object.freeze({ rpcUrl: "https://fork-asset-table.invalid", forkInstanceId: "fork-asset-table" });
export function forkAssetTable() {
  const p = resolveChainProfile("monad-fork", FORK_TABLE_PROBE);
  return p && p.status === "active" && p.assets && typeof p.assets === "object" ? p.assets : Object.freeze({});
}
/** The asset names a grant may name, in table order (USDC · MON · WETH · AUSD today). */
export function forkGrantAssets() { return Object.freeze(Object.keys(forkAssetTable())); }
/** true only for a row of the fork asset table (own property; exact name, no case folding). */
export function isForkGrantAsset(asset) {
  return typeof asset === "string" && Object.prototype.hasOwnProperty.call(forkAssetTable(), asset);
}

/** Loopback-only Admin origin, or null. */
export function adminOrigin(url) {
  if (typeof url !== "string") return null;
  const m = ADMIN_URL_RE.exec(url.trim());
  if (!m || Number(m[1]) > 65535) return null;
  try { const u = new URL(url.trim()); if (u.hostname !== "127.0.0.1" || u.username || u.password || u.search || u.hash) return null; return `http://127.0.0.1:${u.port}`; } catch { return null; }
}

/** [A-987] https Guard origin ("https://<host>[:port]"), or null. No userinfo / query / fragment / path other than "/", no surrounding
 *  whitespace (nothing is trimmed: a padded value fails closed), no loopback / unspecified host (127.0.0.0/8 · localhost · [::1] · 0.0.0.0
 *  · [::]), no port 0. The host part (lowercase, port only if non-default) is what the signature binds (guardHost). */
export function guardOrigin(url) {
  if (typeof url !== "string") return null;
  if (!/^https:\/\/[^/?#@\s]+\/?$/.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || /^127\./.test(h) || h === "0.0.0.0" || h === "[::1]" || h === "[::]" || h.startsWith("[")) return null;
    if (u.port === "0" || /:0+$/.test(url.replace(/\/$/, ""))) return null;
    return `https://${u.host}`;
  } catch { return null; }
}
/** [A-987 r2] The host the signature binds: lowercase hostname + ":port" only when non-default (WHATWG URL host), or null. */
export function guardHost(url) { const o = guardOrigin(url); return o ? o.slice("https://".length) : null; }

export const SIGN_SCHEME = "araso-admin-v1";
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[1-9][0-9]{0,4})?$/;
const PATH_RE = /^\/[A-Za-z0-9._~\/-]{0,200}$/;
const METHOD_RE = /^[A-Z]{1,10}$/;

/**
 * [A-987 r2] Canonical top-up signature (the P2 verifier must rebuild exactly this):
 *   bodyBytes = the exact bytes sent as the HTTP body (UTF-8 of JSON.stringify({ piggyAddress, asset, grantVersion }) on the client side;
 *               the verifier hashes the raw bytes it received, never a re-serialization)
 *   host      = the CONFIGURED Guard host (guardHost(ARASO_FORK_GUARD_URL)): lowercase, ":port" only if non-default. The verifier uses its
 *               OWN configured public host, never the received Host header.
 *   ts        = unix time in whole SECONDS, decimal ASCII, no sign / leading zeros          -> header X-Araso-Ts
 *   nonce     = 16 crypto-random bytes as 32 lowercase hex chars                          -> header X-Araso-Nonce
 *   signing string = "araso-admin-v1\n" + method + "\n" + host + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + lowercase-hex(sha256(bodyBytes))
 *                    (ASCII, 6 LF, no trailing LF; method "POST", path "/araso-admin/v1/topup")
 *   X-Araso-Sig = lowercase-hex(HMAC-SHA256(key = UTF-8 bytes of the secret, msg = signing string))   (64 hex chars, no prefix)
 * Pure: same inputs -> same output. Returns { ts, nonce, bodySha256, signingString, sig } or null on bad input. Never returns the secret.
 */
export function signTopup({ secret, host, method = "POST", path = SIGNED_TOPUP_PATH, ts, nonce, body }) {
  if (typeof secret !== "string" || secret.length < HMAC_SECRET_MIN) return null;
  if (typeof host !== "string" || !HOST_RE.test(host)) return null;
  if (typeof method !== "string" || !METHOD_RE.test(method)) return null;
  if (typeof path !== "string" || !PATH_RE.test(path)) return null;
  const tsStr = typeof ts === "number" && Number.isSafeInteger(ts) && ts >= 0 ? String(ts) : typeof ts === "string" ? ts : null;
  if (!tsStr || !TS_RE.test(tsStr)) return null;
  if (typeof nonce !== "string" || !NONCE_HEX_RE.test(nonce)) return null;
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body instanceof Uint8Array ? Buffer.from(body) : null;
  if (!bytes) return null;
  const bodySha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const signingString = [SIGN_SCHEME, method, host, path, tsStr, nonce, bodySha256].join("\n");
  const sig = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(signingString, "utf8").digest("hex");
  return { ts: tsStr, nonce, bodySha256, signingString, sig };
}

function readTopupAnswer(status, json) {
  if (status !== 200 || !json || !json.record) return { ok: false, reason: status === 401 ? "admin_unauthorized" : "topup_failed" };
  const amountRaw = String(json.record.amountRaw || "");
  if (!/^[1-9][0-9]*$/.test(amountRaw)) return { ok: false, reason: "topup_bad_answer" };
  return { ok: true, noop: json.noop === true, key: String(json.key || ""), amountRaw, forkInstanceId: String(json.record.forkInstanceId || "").toLowerCase() };
}

function checkTopupArgs({ piggyAddress, asset, grantVersion }) {
  if (typeof piggyAddress !== "string" || !ADDR_RE.test(piggyAddress)) return { ok: false, reason: "bad_piggy" };
  if (!isForkGrantAsset(asset)) return { ok: false, reason: "bad_asset" };
  if (typeof grantVersion !== "string" || !GRANT_VERSION_RE.test(grantVersion)) return { ok: false, reason: "bad_grant_version" };
  return null;
}

export function createForkAdminClient({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const origin = adminOrigin(url);
  const tok = typeof token === "string" && token.length >= 16 ? token : null;
  if (!origin || !tok || typeof fetchImpl !== "function") return null;
  const call = async (method, path, body) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(`${origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(ctl ? { signal: ctl.signal } : {}),
        redirect: "error",
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status: res.status, json };
    } catch {
      return { status: 0, json: null };
    } finally { if (timer) clearTimeout(timer); }
  };
  return Object.freeze({
    async instance() {
      const { status, json } = await call("GET", "/admin/instance");
      if (status !== 200 || !json || json.ready !== true || !json.meta) return { ok: false, reason: status === 401 ? "admin_unauthorized" : "admin_unavailable" };
      const id = String(json.meta.forkInstanceId || "").toLowerCase();
      const start = Number(json.meta.parentBlockNumber);
      const chainId = Number(json.meta.chainId);
      if (!ID_RE.test(id) || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(chainId)) return { ok: false, reason: "admin_bad_instance" };
      return { ok: true, forkInstanceId: id, chainId, forkStartBlock: start };
    },
    async topup({ piggyAddress, asset, grantVersion }) {
      if (typeof piggyAddress !== "string" || !ADDR_RE.test(piggyAddress)) return { ok: false, reason: "bad_piggy" };
      // pre-A-959: if (asset !== "MON" && asset !== "USDC") return { ok: false, reason: "bad_asset" };
      if (!isForkGrantAsset(asset)) return { ok: false, reason: "bad_asset" }; // [A-959] the fork profile asset table decides
      if (typeof grantVersion !== "string" || !GRANT_VERSION_RE.test(grantVersion)) return { ok: false, reason: "bad_grant_version" };
      const { status, json } = await call("POST", "/admin/topup", { piggyAddress, asset, grantVersion });
      return readTopupAnswer(status, json); // [A-987] same parse as before, shared with the signed mode
    },
  });
}

/**
 * [A-987] Signed-HTTPS client. guardUrl = https Guard origin; secret = HMAC secret (>= 32 chars). Same interface as createForkAdminClient.
 *   topup()    -> POST <guard>/araso-admin/v1/topup, body = the exact bytes signed, headers X-Araso-Ts / -Nonce / -Sig. No bearer.
 *   instance() -> POST <guard>/ JSON-RPC araso_guardInfo (public, nothing secret sent). Must name the A-949 Guard and carry
 *                 forkInstanceId + chainId + forkStartBlock; a Guard answer without forkStartBlock = admin_bad_instance (fail closed).
 * Redirects are never followed (redirect: "error"); errors are reason codes only (no URL, no secret, no body).
 */
export function createSignedForkAdminClient({ guardUrl, secret, fetchImpl = globalThis.fetch, timeoutMs = 20000, nowMs = () => Date.now(), randomBytes = (n) => crypto.randomBytes(n) } = {}) {
  const origin = guardOrigin(guardUrl);
  const host = origin ? origin.slice("https://".length) : null;
  const key = typeof secret === "string" && secret.length >= HMAC_SECRET_MIN ? secret : null;
  if (!origin || !key || typeof fetchImpl !== "function") return null;
  const post = async (path, headers, bodyBytes) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: bodyBytes,
        ...(ctl ? { signal: ctl.signal } : {}),
        redirect: "error",
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status: res.status, json };
    } catch {
      return { status: 0, json: null };
    } finally { if (timer) clearTimeout(timer); }
  };
  return Object.freeze({
    async instance() {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: FORK_GUARD_METHOD, params: [] }), "utf8");
      const { status, json } = await post("/", {}, body);
      const r = json && typeof json === "object" ? json.result : null;
      if (status !== 200 || !r || typeof r !== "object") return { ok: false, reason: "admin_unavailable" };
      const id = String(r.forkInstanceId || "").toLowerCase();
      const chainId = Number(r.chainId);
      const start = r.forkStartBlock === undefined || r.forkStartBlock === null || r.forkStartBlock === "" ? NaN : Number(r.forkStartBlock);
      if (r.guard !== FORK_GUARD_NAME || !ID_RE.test(id) || !Number.isSafeInteger(chainId) || !Number.isSafeInteger(start) || start < 0) return { ok: false, reason: "admin_bad_instance" };
      return { ok: true, forkInstanceId: id, chainId, forkStartBlock: start };
    },
    async topup({ piggyAddress, asset, grantVersion }) {
      const bad = checkTopupArgs({ piggyAddress, asset, grantVersion });
      if (bad) return bad;
      const bodyBytes = Buffer.from(JSON.stringify({ piggyAddress, asset, grantVersion }), "utf8");
      const nonce = Buffer.from(randomBytes(16)).toString("hex");
      const s = signTopup({ secret: key, host, method: "POST", path: SIGNED_TOPUP_PATH, ts: Math.floor(nowMs() / 1000), nonce, body: bodyBytes });
      if (!s) return { ok: false, reason: "topup_failed" };
      const { status, json } = await post(SIGNED_TOPUP_PATH, { [TS_HEADER]: s.ts, [NONCE_HEADER]: s.nonce, [SIG_HEADER]: s.sig }, bodyBytes);
      return readTopupAnswer(status, json);
    },
  });
}

/** From server env (own properties only). Missing / non-loopback URL or token = null (the route then refuses: fail closed).
 *  [A-987] Signed mode only when ARASO_FORK_GUARD_URL + ARASO_FORK_ADMIN_HMAC_SECRET are both set and valid and NO loopback var is set;
 *  any signed var next to any loopback var (mixed), or one signed var alone (partial) = null. */
export function forkAdminClientFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const own = (k) => (env && Object.prototype.hasOwnProperty.call(env, k) ? env[k] : undefined);
  const set = (k) => { const v = own(k); return typeof v === "string" ? v !== "" : v !== undefined && v !== null; }; // [A-987 r2] no trim: whitespace = set (then invalid = null)
  const signedAny = set(FORK_GUARD_URL_ENV) || set(FORK_ADMIN_HMAC_SECRET_ENV);
  const loopAny = set(FORK_ADMIN_URL_ENV) || set(FORK_ADMIN_TOKEN_ENV);
  if (signedAny && loopAny) return null;
  if (signedAny) return createSignedForkAdminClient({ guardUrl: own(FORK_GUARD_URL_ENV), secret: own(FORK_ADMIN_HMAC_SECRET_ENV), fetchImpl });
  return createForkAdminClient({ url: own(FORK_ADMIN_URL_ENV), token: own(FORK_ADMIN_TOKEN_ENV), fetchImpl });
}
