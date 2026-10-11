// [A-901] Relay quote proxy — Vercel Node serverless. TRANSPORT ONLY.
// Relay requires `x-api-key` on quote/v2 and its docs say the key stays server-side. The browser (CSP connect-src 'self')
// posts the quote request to this same-origin function; this function adds the key and forwards ONE upstream call:
//   POST https://api.relay.link/quote/v2   (nothing else — the upstream URL is a constant, no caller-controlled path/query/host)
// All A-895 P-A calldata binding / validation still runs in the app on the response (app/src/funding-rail-relay.js).
//
// Key: env `RELAY_API_KEY` (server-only; never `VITE_`). It is never logged, never put in a response, never echoed:
//   - upstream response HEADERS are dropped entirely (only status class + JSON body come back);
//   - if the upstream body somehow contains the key string it is replaced before returning.
// Same-origin only: no CORS headers are ever set, and a cross-site Origin / Sec-Fetch-Site is refused.
// Server release gate: env `ARASO_SERVER_RELEASE_LEVEL` must be an integer >= 2 before a quote can reach the key/upstream path.
// Unset / level 1 / unreadable → the existing 404 not_found response. At level >= 2, missing key → 503 relay_key_missing.
// Upstream timeout → 504 · oversize body → 413 · non-POST → 405.

export const RELAY_KEY_ENV = "RELAY_API_KEY";
export const RELAY_RELEASE_LEVEL_ENV = "ARASO_SERVER_RELEASE_LEVEL";
export const RELAY_UPSTREAM_URL = "https://api.relay.link/quote/v2";
export const PROXY_PATH = "/api/relay-quote";
export const MAX_BODY_BYTES = 4096;
export const MAX_RESPONSE_BYTES = 1048576;
export const UPSTREAM_TIMEOUT_MS = 8000;

function ownEnv(env, k) {
  if (env === null || typeof env !== "object") return undefined;
  return Object.hasOwn(env, k) ? env[k] : undefined;
}

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  const pre = req.body;
  if (typeof pre === "string") return Buffer.from(pre, "utf8");
  if (Buffer.isBuffer(pre)) return pre;
  if (pre !== undefined && pre !== null && typeof pre === "object") return Buffer.from(JSON.stringify(pre), "utf8");
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    n += b.length;
    if (n > MAX_BODY_BYTES) return null; // over cap (stop reading)
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

// [A-901 C2] Body allowlist = exactly the shape buildRelayQuoteRequest (app/src/funding-rail-relay.js) produces. The proxy is NOT a
// general quote relay: fixed destination (Monad 143 + Monad USDC), pinned origin chain(s), EXACT_INPUT, includeProtocolData:true,
// and NO other key (no appFees / referrer / ...). Constants are duplicated on purpose (transport module imports no app code);
// a901 asserts they match the adapter's.
export const ALLOWED_ORIGIN_CHAINS = Object.freeze([8453]);
export const ALLOWED_DEST_CHAIN = 143;
export const ALLOWED_DEST_CURRENCY = "0x754704bc059f8c67012fed69bc8a327a5aafb603";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^[0-9]{1,40}$/;
const REQUIRED_KEYS = ["user", "recipient", "refundTo", "originChainId", "originCurrency", "destinationChainId", "destinationCurrency", "tradeType", "amount", "topupGas", "includeProtocolData"];
export function isAllowedQuoteBody(b) {
  if (b === null || typeof b !== "object" || Array.isArray(b)) return false;
  const keys = Object.keys(b);
  const topup = b.topupGas === true;
  const allowed = topup ? [...REQUIRED_KEYS, "topupGasAmount"] : REQUIRED_KEYS;
  if (keys.length !== allowed.length || !keys.every((k) => allowed.includes(k))) return false;
  const isA = (x) => typeof x === "string" && ADDR.test(x);
  return isA(b.user) && isA(b.recipient) && isA(b.refundTo) && isA(b.originCurrency)
    && Number.isInteger(b.originChainId) && ALLOWED_ORIGIN_CHAINS.includes(b.originChainId)
    && b.destinationChainId === ALLOWED_DEST_CHAIN
    && typeof b.destinationCurrency === "string" && b.destinationCurrency.toLowerCase() === ALLOWED_DEST_CURRENCY
    && b.tradeType === "EXACT_INPUT"
    && typeof b.amount === "string" && UINT.test(b.amount) && !/^0+$/.test(b.amount)
    && (b.topupGas === true || b.topupGas === false)
    && b.includeProtocolData === true
    && (!topup || (typeof b.topupGasAmount === "string" && UINT.test(b.topupGasAmount) && !/^0+$/.test(b.topupGasAmount)));
}

function sameOrigin(req) {
  const h = req.headers || {};
  const site = h["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  // [A-1053 · A-1031 opus condition 1] a matching Origin is REQUIRED (before the release level or the key is read): a request with no Origin
  // (curl / server-side) is refused like a cross-origin one. Browsers send Origin on every same-origin POST, so the app path is unchanged.
  // pre-A-1053: `if (origin !== undefined) { …host check… } return true;` (no Origin passed)
  const origin = h.origin;
  if (typeof origin !== "string" || origin === "") return false;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  if (!h.host || host !== h.host) return false;
  return true;
}

export function createRelayQuoteHandler({ fetchImpl, env, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  return async function handler(req, res) {
    try {
      if (req.method !== "POST") { res.setHeader("allow", "POST"); return respond(res, 405, { ok: false, error: "method_not_allowed" }); }
      // path allowlist: exactly the proxy path, no suffix, no query (the upstream is fixed to quote/v2).
      if (typeof req.url === "string" && req.url !== "" && req.url !== PROXY_PATH) return respond(res, 404, { ok: false, error: "not_found" });
      if (!sameOrigin(req)) return respond(res, 403, { ok: false, error: "cross_origin_refused" });
      const e = env === undefined ? process.env : env;
      const rawLevel = ownEnv(e, RELAY_RELEASE_LEVEL_ENV);
      const levelText = rawLevel == null ? "" : String(rawLevel).trim();
      const level = /^[1-9]\d*$/.test(levelText) ? Number(levelText) : 1;
      if (!Number.isSafeInteger(level) || level < 2) return respond(res, 404, { ok: false, error: "not_found" });
      const rawKey = ownEnv(e, RELAY_KEY_ENV);
      const key = typeof rawKey === "string" ? rawKey.trim() : "";
      if (key === "") return respond(res, 503, { ok: false, error: "relay_key_missing" });
      const cl = Number(req.headers && req.headers["content-length"]);
      if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) return respond(res, 413, { ok: false, error: "body_too_large" });
      const buf = await readBody(req);
      if (buf === null || buf.length > MAX_BODY_BYTES) return respond(res, 413, { ok: false, error: "body_too_large" });
      const text = buf.toString("utf8");
      let parsed;
      try { parsed = JSON.parse(text); } catch { return respond(res, 400, { ok: false, error: "bad_json" }); }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return respond(res, 400, { ok: false, error: "bad_json" });
      if (!isAllowedQuoteBody(parsed)) return respond(res, 400, { ok: false, error: "body_not_allowed" });
      // [A-909 N4] Choice: NORMALIZE (not refuse). JSON.parse keeps the last duplicate key; the upstream gets only
      // JSON.stringify of the validated, allowlisted object, so a duplicate key can never reach Relay's parser.
      // isAllowedQuoteBody guarantees exactly the allowlisted keys, so the object is rebuilt key by key in that order.
      const forwardBody = JSON.stringify(Object.fromEntries(Object.keys(parsed).map((k) => [k, parsed[k]])));

      const f = fetchImpl || globalThis.fetch;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let up, upText;
      try {
        up = await f(RELAY_UPSTREAM_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key },
          body: forwardBody, // [A-909 N4] re-serialized from the VALIDATED object, never the raw text
          signal: ac.signal,
          redirect: "error",
        });
        upText = await up.text();
      } catch (err) {
        if (ac.signal.aborted || (err && err.name === "AbortError")) return respond(res, 504, { ok: false, error: "relay_upstream_timeout" });
        return respond(res, 502, { ok: false, error: "relay_upstream_unreachable" });
      } finally {
        clearTimeout(timer);
      }
      if (typeof upText !== "string" || upText.length > MAX_RESPONSE_BYTES) return respond(res, 502, { ok: false, error: "relay_upstream_bad_response" });
      if (upText.includes(key)) upText = upText.split(key).join("[redacted]");
      const status = Number(up.status);
      if (!Number.isInteger(status) || status < 200 || (status > 299 && status < 400) || status > 499) return respond(res, 502, { ok: false, error: "relay_upstream_error" });
      return respond(res, status, upText === "" ? "{}" : upText);
    } catch {
      return respond(res, 500, { ok: false, error: "relay_proxy_error" });
    }
  };
}

export default createRelayQuoteHandler();
