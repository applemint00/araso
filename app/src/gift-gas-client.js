// [A-884] Browser-side client adapter for the relayer POST /gift-gas route (A-874 route, A-869 service).
// Isolated module: NOT wired to main.js / gift-claim-entry.js / UI. It has no imports.
//
// What it does: sends exactly {giftId, to} through an INJECTED fetch and turns the reply into a frozen,
// observation-only outcome. That is all.
//
// What it never does (by construction):
//   - no global fetch fallback: if no fetch function is injected, every call is invalid_config and nothing is sent;
//   - no auth invented: no Authorization header, no token, cookies omitted (credentials: "omit");
//     a 401/403 is reported as-is, never "fixed" by the client;
//   - no fallback route: the only path it will ever talk to is exactly /gift-gas; no other relayer route,
//     no local signer, no local gas delivery, no wallet call;
//   - no automatic retry and no resend authority: one call = at most one fetch. A SENT/PENDING/UNKNOWN/duplicate
//     reply is an observation of the SERVER's ledger, never a permission for the client to send anything.
//     Concurrent calls for the same giftId share the single in-flight fetch;
//   - nothing persisted (no storage, no cookies), nothing logged (no console, no log hook).
//
// Fail closed: malformed, ambiguous (duplicate keys, extra keys, echo mismatch, state/txHash inconsistent),
// oversized, wrong content-type, redirected or unexpected-status replies => malformed_response, ok:false.
// A timeout / network error / abort after fetch was called => reachedServer:"unknown" (the server may have
// acted; the client does not assume it did not).

export const GIFT_GAS_CLIENT_PATH = "/gift-gas";
export const GIFT_GAS_CLIENT_DEFAULT_TIMEOUT_MS = 15000;
export const GIFT_GAS_CLIENT_MIN_TIMEOUT_MS = 1000;
export const GIFT_GAS_CLIENT_MAX_TIMEOUT_MS = 60000;
export const GIFT_GAS_CLIENT_MAX_RESPONSE_CHARS = 1024;

export const GIFT_GAS_TRANSPORT = Object.freeze({ HTTPS: "https", SAME_ORIGIN: "same-origin" });

export const GIFT_GAS_CLIENT_OUTCOME = Object.freeze({
  // 200 + server ledger state
  CONFIRMED: "confirmed",
  SENT: "sent",
  PENDING: "pending",
  UNKNOWN: "unknown",
  // server refusals (A-874 route / A-869 service bodies)
  NOT_AVAILABLE: "not_available", // 409
  UNAVAILABLE: "unavailable", // 503 (ambiguous: the server may have acted)
  UNAVAILABLE_NOT_SENT: "unavailable_not_sent", // 503 body unavailable_not_sent: server proves nothing was reserved or signed [A-895 P-B]
  REQUEST_TIMEOUT: "request_timeout", // 408: relayer body deadline, 0 service calls [A-895 P-B]
  BAD_REQUEST: "bad_request", // 400
  UNAUTHORIZED: "unauthorized", // 401
  FORBIDDEN: "forbidden", // 403
  NOT_FOUND: "not_found", // 404
  METHOD_NOT_ALLOWED: "method_not_allowed", // 405
  PAYLOAD_TOO_LARGE: "payload_too_large", // 413
  UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type", // 415
  // client-side
  MALFORMED_RESPONSE: "malformed_response",
  TIMEOUT: "timeout",
  NETWORK_ERROR: "network_error",
  ABORTED: "aborted",
  INVALID_REQUEST: "invalid_request",
  INVALID_CONFIG: "invalid_config",
  IN_FLIGHT_CONFLICT: "in_flight_conflict",
});
const O = GIFT_GAS_CLIENT_OUTCOME;

// Exact server error bodies per status (relayer/src/server.mjs createGiftGasRoute + gift-gas-service.mjs).
const ERROR_BY_STATUS = Object.freeze({
  400: Object.freeze({ error: "bad_request", outcome: O.BAD_REQUEST }),
  401: Object.freeze({ error: "unauthorized", outcome: O.UNAUTHORIZED }),
  403: Object.freeze({ error: "forbidden", outcome: O.FORBIDDEN }),
  404: Object.freeze({ error: "not found", outcome: O.NOT_FOUND }),
  405: Object.freeze({ error: "method not allowed", outcome: O.METHOD_NOT_ALLOWED }),
  409: Object.freeze({ error: "not_available", outcome: O.NOT_AVAILABLE }),
  413: Object.freeze({ error: "payload too large", outcome: O.PAYLOAD_TOO_LARGE }),
  415: Object.freeze({ error: "unsupported media type", outcome: O.UNSUPPORTED_MEDIA_TYPE }),
  408: Object.freeze({ error: "request timeout", outcome: O.REQUEST_TIMEOUT }),
  // [A-895 P-B] two exact 503 bodies: the service emits "unavailable_not_sent" ONLY on paths before ledger.reserve
  // (nothing reserved, nothing signed); every other 503 keeps the ambiguous "unavailable".
  503: Object.freeze({ error: "unavailable", outcome: O.UNAVAILABLE }),
});
const ERROR_BODY_503_NOT_SENT = "unavailable_not_sent";

const STATE_OUTCOME = Object.freeze({ CONFIRMED: O.CONFIRMED, SENT: O.SENT, PENDING: O.PENDING, UNKNOWN: O.UNKNOWN });
const RECORD_KEYS = Object.freeze(["giftId", "ok", "state", "to", "txHash", "valueWei"]);
const ERROR_KEYS = Object.freeze(["error", "ok"]);

const GIFT_ID = /^0x[0-9a-f]{64}$/; // lowercase bytes32 only, same as the server policy (uppercase refused)
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDR = `0x${"0".repeat(40)}`;
const TX_HASH = /^0x[0-9a-f]{64}$/;
const WEI = /^[1-9][0-9]{0,77}$/;
const JSON_CT = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

// [A-895 P-B F1] Brand: only objects returned by createGiftGasClient() are real clients. The submitter-side adapter
// (gift-claim-entry.js createGiftGasClientDelivery) accepts nothing else, so a hand-written { request } cannot stand in.
const wsHas = Function.prototype.call.bind(WeakSet.prototype.has); // captured at load: later page-side WeakSet.prototype.has overwrites are ignored
const wsAdd = Function.prototype.call.bind(WeakSet.prototype.add);
const GIFT_GAS_CLIENTS = new WeakSet();
export function isGiftGasClient(c) {
  return !!c && typeof c === "object" && wsHas(GIFT_GAS_CLIENTS, c);
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function isPlainObject(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** Data-property value only (getters/setters refused, so the value cannot change between check and use). */
function dataValue(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d || !own(d, "value")) return { ok: false };
  return { ok: true, value: d.value };
}

function outcome(fields) {
  return Object.freeze({
    authority: "observation_only", // never a send/resend permission
    localDelivery: false,
    ...fields,
  });
}

const refused = (o, reachedServer, extra = {}) => outcome({ ok: false, outcome: o, settled: false, reachedServer, ...extra });

/**
 * Strict client-side request check. Exactly {giftId, to}; nothing else (amount, token, ... are refused).
 * Returns a frozen { ok:true, giftId, to(lowercase) } or { ok:false, reason }.
 */
export function validateGiftGasClientRequest(input) {
  try {
    if (!isPlainObject(input)) return Object.freeze({ ok: false, reason: "not_plain_object" });
    if (Object.getOwnPropertySymbols(input).length !== 0) return Object.freeze({ ok: false, reason: "extra_or_missing_keys" });
    const keys = Object.getOwnPropertyNames(input);
    if (keys.length !== 2 || !keys.includes("giftId") || !keys.includes("to")) return Object.freeze({ ok: false, reason: "extra_or_missing_keys" });
    const g = dataValue(input, "giftId");
    const t = dataValue(input, "to");
    if (!g.ok || !t.ok) return Object.freeze({ ok: false, reason: "accessor_property" });
    if (typeof g.value !== "string" || !GIFT_ID.test(g.value)) return Object.freeze({ ok: false, reason: "bad_gift_id" });
    if (typeof t.value !== "string" || !ADDR.test(t.value)) return Object.freeze({ ok: false, reason: "bad_to" });
    const to = t.value.toLowerCase();
    if (to === ZERO_ADDR) return Object.freeze({ ok: false, reason: "zero_to" });
    return Object.freeze({ ok: true, giftId: g.value, to });
  } catch {
    return Object.freeze({ ok: false, reason: "invalid" });
  }
}

/** Resolve the one allowed endpoint under the transport policy. Returns { ok, url, mode } or { ok:false, reason }. */
export function resolveGiftGasEndpoint({ transport, endpoint, pageOrigin } = {}) {
  try {
    if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2048 || /[\s\\]/.test(endpoint)) {
      return Object.freeze({ ok: false, reason: "bad_endpoint" });
    }
    let u;
    let mode;
    if (transport === GIFT_GAS_TRANSPORT.HTTPS) {
      if (!/^https:\/\//i.test(endpoint)) return Object.freeze({ ok: false, reason: "not_https" });
      u = new URL(endpoint);
      if (u.protocol !== "https:") return Object.freeze({ ok: false, reason: "not_https" });
      mode = "cors";
    } else if (transport === GIFT_GAS_TRANSPORT.SAME_ORIGIN) {
      if (typeof pageOrigin !== "string") return Object.freeze({ ok: false, reason: "no_page_origin" });
      const po = new URL(pageOrigin);
      if ((po.protocol !== "https:" && po.protocol !== "http:") || po.origin !== pageOrigin) {
        return Object.freeze({ ok: false, reason: "bad_page_origin" });
      }
      u = new URL(endpoint, pageOrigin);
      if (u.origin !== pageOrigin) return Object.freeze({ ok: false, reason: "cross_origin" });
      mode = "same-origin";
    } else {
      return Object.freeze({ ok: false, reason: "bad_transport" });
    }
    if (u.username !== "" || u.password !== "" || endpoint.includes("@")) return Object.freeze({ ok: false, reason: "credentials_in_url" });
    if (u.search !== "" || u.hash !== "" || endpoint.includes("?") || endpoint.includes("#")) {
      return Object.freeze({ ok: false, reason: "query_or_fragment" });
    }
    if (u.pathname !== GIFT_GAS_CLIENT_PATH) return Object.freeze({ ok: false, reason: "wrong_path" });
    return Object.freeze({ ok: true, url: u.href, mode });
  } catch {
    return Object.freeze({ ok: false, reason: "bad_endpoint" });
  }
}

/**
 * Parse one /gift-gas reply against the request it answers. Pure; never throws.
 * @param {{ status: number, contentType: string|null, text: string, redirected?: boolean }} reply
 * @param {{ giftId: string, to: string }} req  validated request (to lowercase)
 */
export function parseGiftGasResponse(reply, req) {
  const bad = (why, httpStatus = null) => refused(O.MALFORMED_RESPONSE, "yes", { httpStatus, reason: why });
  try {
    if (!reply || typeof reply !== "object") return bad("no_reply");
    if (!req || typeof req !== "object" || typeof req.giftId !== "string" || typeof req.to !== "string") return bad("no_request");
    const { status, contentType, text } = reply;
    if (!Number.isInteger(status)) return bad("bad_status");
    if (reply.redirected === true) return bad("redirected", status);
    if (status !== 200 && !own(ERROR_BY_STATUS, status)) return bad("unexpected_status", status);
    if (typeof contentType !== "string" || !JSON_CT.test(contentType.trim())) return bad("content_type", status);
    if (typeof text !== "string" || text.length === 0 || text.length > GIFT_GAS_CLIENT_MAX_RESPONSE_CHARS) return bad("body_size", status);
    let body;
    try { body = JSON.parse(text); } catch { return bad("json", status); }
    // canonical compact JSON only: duplicate keys / padding / alternate encodings are ambiguous -> refused
    if (!isPlainObject(body) || JSON.stringify(body) !== text) return bad("non_canonical", status);
    const keys = Object.keys(body).sort();

    if (status !== 200) {
      const want = status === 503 && body.error === ERROR_BODY_503_NOT_SENT
        ? Object.freeze({ error: ERROR_BODY_503_NOT_SENT, outcome: O.UNAVAILABLE_NOT_SENT })
        : ERROR_BY_STATUS[status];
      if (keys.length !== ERROR_KEYS.length || keys.some((k, i) => k !== ERROR_KEYS[i])) return bad("error_shape", status);
      if (body.ok !== false || body.error !== want.error) return bad("error_body", status);
      return refused(want.outcome, "yes", { httpStatus: status });
    }

    if (keys.length !== RECORD_KEYS.length || keys.some((k, i) => k !== RECORD_KEYS[i])) return bad("record_shape", status);
    if (body.ok !== true) return bad("record_ok", status);
    if (typeof body.state !== "string" || !own(STATE_OUTCOME, body.state)) return bad("record_state", status);
    if (body.giftId !== req.giftId) return bad("gift_id_echo", status);
    if (body.to !== req.to) return bad("to_echo", status);
    if (typeof body.valueWei !== "string" || !WEI.test(body.valueWei)) return bad("value_wei", status);
    const tx = body.txHash;
    if (tx !== null && (typeof tx !== "string" || !TX_HASH.test(tx))) return bad("tx_hash", status);
    // ledger invariants (A-869): PENDING = nothing signed; SENT/CONFIRMED = txHash recorded
    if (body.state === "PENDING" && tx !== null) return bad("pending_with_tx", status);
    if ((body.state === "SENT" || body.state === "CONFIRMED") && tx === null) return bad("signed_state_without_tx", status);

    return outcome({
      ok: body.state !== "UNKNOWN",
      outcome: STATE_OUTCOME[body.state],
      state: body.state,
      settled: body.state === "CONFIRMED",
      reachedServer: "yes",
      httpStatus: 200,
      giftId: body.giftId,
      to: body.to,
      valueWei: body.valueWei,
      txHash: tx,
    });
  } catch {
    return bad("parse_failed");
  }
}

function abortPromise(signal) {
  return new Promise((_, rej) => {
    if (signal.aborted) { rej(new Error("aborted")); return; }
    signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
  });
}

/**
 * @param {object} cfg
 * @param {(url: string, init: object) => Promise<Response>} cfg.fetch  REQUIRED, injected. No global fallback.
 * @param {"https"|"same-origin"} cfg.transport
 * @param {string} cfg.endpoint     https: absolute https URL with path exactly /gift-gas; same-origin: "/gift-gas" or a same-origin URL
 * @param {string} [cfg.pageOrigin] required for same-origin (e.g. location.origin, injected by the caller)
 * @param {number} [cfg.timeoutMs]  integer in [1000, 60000], default 15000
 * @param {{ setTimeout: Function, clearTimeout: Function }} [cfg.timers]  injectable for tests
 *
 * [A-895 P-B / A-884 L1] cfg, cfg.timers and opts are read through OWN DATA properties only: an inherited
 * (prototype-polluted) fetch / transport / endpoint / timers / signal, or an accessor, counts as missing.
 */
export function createGiftGasClient(cfg = {}) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const pick = (o, k) => { const d = dataValue(o, k); return d.ok ? d.value : undefined; };
  let configError = null;
  const fetchFn = typeof pick(c, "fetch") === "function" ? pick(c, "fetch") : null;
  if (!fetchFn) configError = "no_fetch";
  const ep = resolveGiftGasEndpoint({ transport: pick(c, "transport"), endpoint: pick(c, "endpoint"), pageOrigin: pick(c, "pageOrigin") });
  if (!configError && !ep.ok) configError = ep.reason;
  const rawTimeout = pick(c, "timeoutMs");
  const timeoutMs = rawTimeout === undefined ? GIFT_GAS_CLIENT_DEFAULT_TIMEOUT_MS : rawTimeout;
  if (!configError && (!Number.isInteger(timeoutMs) || timeoutMs < GIFT_GAS_CLIENT_MIN_TIMEOUT_MS || timeoutMs > GIFT_GAS_CLIENT_MAX_TIMEOUT_MS)) configError = "bad_timeout";
  const tm = pick(c, "timers");
  const tmSet = tm && typeof tm === "object" ? pick(tm, "setTimeout") : undefined;
  const tmClr = tm && typeof tm === "object" ? pick(tm, "clearTimeout") : undefined;
  const timers = typeof tmSet === "function" && typeof tmClr === "function"
    ? { setTimeout: tmSet, clearTimeout: tmClr }
    : { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
  if (!configError && typeof AbortController !== "function") configError = "no_abort_controller";

  const inFlight = new Map(); // giftId -> { to, promise, ac, live }   (memory only; cleared on settle)

  // One shared network attempt per giftId. `ac` is owned by the entry, not by any caller (A-884 L3).
  async function once(req, ac) {
    let timedOut = false;
    const timer = timers.setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const stop = abortPromise(ac.signal);
    stop.catch(() => {});
    const lost = () => refused(timedOut ? O.TIMEOUT : (ac.signal.aborted ? O.ABORTED : O.NETWORK_ERROR), "unknown");
    try {
      let res;
      try {
        res = await Promise.race([
          fetchFn.call(undefined, ep.url, {
            method: "POST",
            mode: ep.mode,
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ giftId: req.giftId, to: req.to }),
            signal: ac.signal,
          }),
          stop,
        ]);
      } catch {
        return lost();
      }
      if (!res || typeof res !== "object" || typeof res.text !== "function") {
        return refused(O.MALFORMED_RESPONSE, "yes", { httpStatus: null, reason: "no_response_object" });
      }
      const status = res.status;
      const httpStatus = Number.isInteger(status) ? status : null;
      let contentType = null;
      try { contentType = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") : null; } catch { contentType = null; }
      let text;
      try {
        text = await Promise.race([res.text(), stop]);
      } catch {
        if (ac.signal.aborted) return refused(timedOut ? O.TIMEOUT : O.ABORTED, "unknown", { httpStatus });
        return refused(O.MALFORMED_RESPONSE, "yes", { httpStatus, reason: "body_read" });
      }
      const redirected = res.redirected === true || res.type === "opaqueredirect"
        || (typeof res.url === "string" && res.url !== "" && res.url !== ep.url);
      return parseGiftGasResponse({ status, contentType, text, redirected }, req);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /**
   * [A-884 L3] Each caller gets its own result promise. A caller's own signal resolves ONLY that caller with
   * aborted/unknown; the shared fetch is aborted only when every attached caller has aborted.
   */
  function attach(entry, signal) {
    entry.live += 1;
    return new Promise((resolve) => {
      let done = false;
      let onAbort = null;
      const settle = (r) => {
        if (done) return;
        done = true;
        if (signal && onAbort) { try { signal.removeEventListener("abort", onAbort); } catch { /* ignore */ } }
        resolve(r);
      };
      entry.promise.then(settle, () => settle(refused(O.NETWORK_ERROR, "unknown")));
      if (signal) {
        onAbort = () => {
          if (done) return;
          entry.live -= 1;
          if (entry.live <= 0) entry.ac.abort(); // last joiner: the shared attempt ends; its aborted/unknown result settles this caller
          else settle(refused(O.ABORTED, "unknown")); // other joiners keep waiting: only THIS caller is aborted
        };
        try { signal.addEventListener("abort", onAbort, { once: true }); } catch { settle(refused(O.NETWORK_ERROR, "unknown")); entry.live -= 1; if (entry.live <= 0) entry.ac.abort(); }
        if (signal.aborted) onAbort();
      }
    });
  }

  const client = Object.freeze({
    configError,
    /**
     * One status/request call to POST /gift-gas. Never throws. Never retries. Never sends anything else.
     * @param {{ giftId: string, to: string }} input
     * @param {{ signal?: AbortSignal }} [opts]
     */
    request(input, opts) {
      try {
        if (configError) return Promise.resolve(refused(O.INVALID_CONFIG, "no", { reason: configError }));
        const v = validateGiftGasClientRequest(input);
        if (!v.ok) return Promise.resolve(refused(O.INVALID_REQUEST, "no", { reason: v.reason }));
        const signal = opts && typeof opts === "object" ? pick(opts, "signal") : undefined;
        if (signal !== undefined && (signal === null || typeof signal !== "object" || typeof signal.addEventListener !== "function" || typeof signal.aborted !== "boolean")) {
          return Promise.resolve(refused(O.INVALID_REQUEST, "no", { reason: "bad_signal" }));
        }
        if (signal && signal.aborted) return Promise.resolve(refused(O.ABORTED, "no"));
        const cur = inFlight.get(v.giftId);
        if (cur) {
          if (cur.to !== v.to) return Promise.resolve(refused(O.IN_FLIGHT_CONFLICT, "no"));
          return attach(cur, signal); // share the one in-flight fetch; never a second request
        }
        // [A-884 L2] register the entry (with a deferred shared promise) BEFORE any fetch can run, so a re-entrant
        // request() from inside fetch joins this entry instead of starting a second fetch.
        let resolveShared;
        const entry = { to: v.to, ac: new AbortController(), live: 0, promise: new Promise((r) => { resolveShared = r; }) };
        inFlight.set(v.giftId, entry);
        const out = attach(entry, signal);
        let started;
        try { started = once(v, entry.ac); } catch { started = Promise.resolve(refused(O.NETWORK_ERROR, "unknown")); }
        started
          .catch(() => refused(O.NETWORK_ERROR, "unknown"))
          .then((r) => { if (inFlight.get(v.giftId) === entry) inFlight.delete(v.giftId); resolveShared(r); });
        return out;
      } catch {
        return Promise.resolve(refused(O.INVALID_REQUEST, "no", { reason: "invalid" }));
      }
    },
  });
  wsAdd(GIFT_GAS_CLIENTS, client);
  return client;
}
