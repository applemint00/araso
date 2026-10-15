// [A-913 G] Gift sponsor endpoint — Vercel Node serverless, same origin (no shared-secret hop, no always-on process).
// POST /api/gift-sponsor runs the sponsor service IN-PROCESS: shape allowlist -> relayer/src/gift-sponsor-service.mjs (G1..G11, preflight, steps) with a Vercel KV
// ledger (api/_lib/gift-sponsor-kv-store.js: conditional atomic writes + one sponsor lease across instances). Recovery of anything that stops half-way is the Cron
// route api/gift-sponsor-reconcile.js. The sponsor key is server env only (api/_lib/gift-sponsor-runtime.js), never in the browser, never logged.
// Default OFF: GIFT_SPONSOR_PRIVATE_KEY unset (or any env missing/invalid) => 503 unavailable_not_sent before any chain call.
// Two bodies. (1) CLAIM = EXACTLY { giftId, authorization, revokeAuthorization, delegation, claim } (+ optional gasTx that must equal the registered one; nested key sets exact too).
// (2) REGISTER = EXACTLY { action:"register_gas_tx", giftId, gasTx }: the sender records its gas-deposit tx right after create (record-and-read only; see service.register). POST only, <= 8 KB, no CORS headers, cross-site Origin / Sec-Fetch-Site refused. Responses: only 200 / 400 / 409 / 503 (+405/413/415/429/403/404 transport). JSON content-type required (415). Optional per-IP / per-gift rate limit (injected numbers; absent => off).

import { getGiftSponsorRuntime } from "./_lib/gift-sponsor-runtime.js";

export const PROXY_PATH = "/api/gift-sponsor";
export const MAX_BODY_BYTES = 8192;
export const MAX_RESPONSE_BYTES = 16384;

const TOP_KEYS = ["giftId", "authorization", "revokeAuthorization", "delegation", "claim"]; // + optional "gasTx" (must equal the registered hash)
const REGISTER_KEYS = ["action", "giftId", "gasTx"];
const REGISTER_LETTER_KEYS = [...REGISTER_KEYS, "note", "letterHash"];
const READ_KEYS = ["action", "giftId"];
const AUTH_KEYS = ["chainId", "address", "nonce", "r", "s", "yParity"];
const DELEG_KEYS = ["delegate", "delegator", "authority", "caveats", "salt", "signature"];
const CAVEAT_KEYS = ["enforcer", "terms", "args"];
const CLAIM_KEYS = ["recipient", "preimage", "salt", "deadline"];
const FORK_KEYS = ["forkInstanceId", "escrowAddress"];

const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const exact = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const isStr = (v) => typeof v === "string";

function authOk(a) {
  if (!exact(a, AUTH_KEYS)) return false;
  if (!(Number.isSafeInteger(a.chainId) || isStr(a.chainId)) || !(Number.isSafeInteger(a.nonce) || isStr(a.nonce))) return false;
  return [a.address, a.r, a.s].every(isStr) && (a.yParity === 0 || a.yParity === 1);
}

/** Shape allowlist only (keys + primitive types). Value semantics are the service's job. */
const exactTransport = (b, keys) => exact(b, keys) || exact(b, [...keys, ...FORK_KEYS]);
const forkBindingOk = (b) => !Object.hasOwn(b, "forkInstanceId") || (isStr(b.forkInstanceId) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(b.forkInstanceId) && isStr(b.escrowAddress));
export function isRegisterBody(b) { return (exactTransport(b, REGISTER_KEYS) || exactTransport(b, REGISTER_LETTER_KEYS)) && forkBindingOk(b) && b.action === "register_gas_tx" && isStr(b.giftId) && isStr(b.gasTx) && (!Object.hasOwn(b, "note") || (isStr(b.note) && isStr(b.letterHash))); }
export function isReadLetterBody(b) { return exactTransport(b, READ_KEYS) && forkBindingOk(b) && b.action === "read_letter" && isStr(b.giftId); }

export function isAllowedSponsorBody(b) {
  if (!(exactTransport(b, TOP_KEYS) || exactTransport(b, [...TOP_KEYS, "gasTx"])) || !forkBindingOk(b) || !isStr(b.giftId) || (Object.hasOwn(b, "gasTx") && !isStr(b.gasTx))) return false;
  if (!authOk(b.authorization) || !authOk(b.revokeAuthorization)) return false;
  if (!exact(b.delegation, DELEG_KEYS)) return false;
  const d = b.delegation;
  if (![d.delegate, d.delegator, d.authority, d.salt, d.signature].every(isStr)) return false;
  if (!Array.isArray(d.caveats) || d.caveats.length === 0 || d.caveats.length > 8) return false;
  if (!d.caveats.every((c) => exact(c, CAVEAT_KEYS) && CAVEAT_KEYS.every((k) => isStr(c[k])))) return false;
  if (!exact(b.claim, CLAIM_KEYS) || !CLAIM_KEYS.every((k) => isStr(b.claim[k]))) return false;
  return true;
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
    if (n > MAX_BODY_BYTES) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function clientIp(req) {
  const h = req.headers || {};
  const xf = typeof h["x-forwarded-for"] === "string" ? h["x-forwarded-for"].split(",")[0].trim() : "";
  const ip = xf || (typeof h["x-real-ip"] === "string" ? h["x-real-ip"].trim() : "");
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : "unknown";
}

function sameOrigin(req) {
  const h = req.headers || {};
  const site = h["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  const origin = h.origin;
  if (origin !== undefined) {
    let host;
    try { host = new URL(origin).host; } catch { return false; }
    if (!h.host || host !== h.host) return false;
  }
  return true;
}

/** `getRuntime` is injectable for tests; production resolves the runtime from server env (null => OFF). */
export function createGiftSponsorHandler({ getRuntime = () => getGiftSponsorRuntime() } = {}) {
  return async function handler(req, res) {
    try {
      if (req.method !== "POST") { res.setHeader("allow", "POST"); return respond(res, 405, { ok: false, error: "method_not_allowed" }); }
      if (typeof req.url === "string" && req.url !== "" && req.url !== PROXY_PATH) return respond(res, 404, { ok: false, error: "not_found" });
      if (!sameOrigin(req)) return respond(res, 403, { ok: false, error: "cross_origin_refused" });
      const ct = req.headers && req.headers["content-type"];                                  // [F-6] JSON only
      if (typeof ct !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(ct.trim())) return respond(res, 415, { ok: false, error: "unsupported_media_type" });
      const cl = Number(req.headers && req.headers["content-length"]);
      if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) return respond(res, 413, { ok: false, error: "body_too_large" });
      const buf = await readBody(req);
      if (buf === null || buf.length > MAX_BODY_BYTES) return respond(res, 413, { ok: false, error: "body_too_large" });
      let parsed;
      try { parsed = JSON.parse(buf.toString("utf8")); } catch { return respond(res, 400, { ok: false, error: "bad_request" }); }
      const registering = isRegisterBody(parsed);
      const reading = isReadLetterBody(parsed);
      if (!registering && !reading && !isAllowedSponsorBody(parsed)) return respond(res, 400, { ok: false, error: "bad_request" });
      let rt;
      try { rt = getRuntime(); } catch { rt = null; }                                          // misconfigured env == OFF (never half-running)
      if (!rt || !rt.service || rt.service.ready !== true) return respond(res, 503, { ok: false, error: "unavailable_not_sent" });
      if (Object.hasOwn(parsed, "forkInstanceId") && String(parsed.escrowAddress).toLowerCase() !== String(rt.policy?.escrow || "").toLowerCase()) return respond(res, 400, { ok: false, error: "bad_request" });
      const serviceBody = Object.hasOwn(parsed, "forkInstanceId") ? Object.fromEntries(Object.entries(parsed).filter(([k]) => !FORK_KEYS.includes(k))) : parsed;
      if (typeof rt.rateLimit === "function") {                                                // [F-6] per-IP / per-gift limit (injected numbers; absent => no limiter)
        let allowed = false;
        try { allowed = (await rt.rateLimit({ ip: clientIp(req), giftId: parsed.giftId })) === true; } catch { return respond(res, 503, { ok: false, error: "unavailable_not_sent" }); }
        if (!allowed) return respond(res, 429, { ok: false, error: "rate_limited" });
      }
      const r = registering ? await rt.service.register(serviceBody) : reading ? await rt.service.readLetter(serviceBody) : await rt.service.handle(serviceBody); // validated object only
      if (!r || ![200, 400, 409, 503].includes(r.status) || !isObj(r.body)) return respond(res, 503, { ok: false, error: "unavailable" });
      return respond(res, r.status, r.body);
    } catch {
      return respond(res, 500, { ok: false, error: "unavailable" });
    }
  };
}

export default createGiftSponsorHandler();
