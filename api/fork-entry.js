// [A-956/A-1027] POST /api/fork-entry — Journey 2 entry (card E). Local mode uses process-memory stores only when explicitly enabled.
// Production mode uses the existing Upstash invite/challenge/ledger stores and the signed remote fork Admin; any incomplete configuration
// stays closed with 503. This module never logs env values, invite tokens or HMAC material.
//
// Body (JSON, ≤ 8 KiB) — { action, ... }; the invite token rides in the `x-araso-invite` header (never in the body, never logged):
//   invite_state {}                                                      → { ok, bound } (read-only first-journey hint)
//   challenge  { piggyAddress }                                            → { nonce, message, expiresAt }
//   enter      { nonce, signature, piggyAddress, journey1:{ depositTxHash, redeemTxHash } } → { allowed, forkScope, forkInstanceId, grants }
//   status     { piggyAddress, forkInstanceId }                            → { allowed, reason?, reenter? }   (re-check before fork money)
//   complete   { piggyAddress, journeyId, txHashes }                       → completion slot; 404 unless opened in code (no payout)
// testerId = server auth (invite token) only · Journey 1 = the server's own chain-10143 read · top-up = A-949 Admin at 127.0.0.1 with the
// token from env · request fields beyond the action's list = 400. Same-origin browser calls only (plus code-injected local dev origins).
import { appOriginOk, createInviteTable, createMemoryChallengeStore } from "./_lib/fork-auth.js";
import { createForkEntryService, jsonRpc, upstashForkEntryParts } from "./_lib/fork-entry.js";
import { forkAdminClientFromEnv, guardOrigin } from "./_lib/fork-grant-client.js";
import { createMemoryForkLedgerStore } from "./_lib/fork-ledger-store-contract.js";
import { inviteStoreFromEnv } from "./_lib/invite-redis-store.js";

export const FORK_ENTRY_MAX_BODY = 8 * 1024;
export const FORK_INVITE_HEADER = "x-araso-invite";
export const FORK_ENTRY_ENV = Object.freeze({
  local: "ARASO_FORK_ENTRY_LOCAL", // "1" = this process is the local entry server (memory stores allowed)
  invites: "ARASO_FORK_INVITE_TOKENS", // comma-separated invite tokens (local: one test token; value never committed)
  testnetRpc: "ARASO_FORK_TESTNET_RPC_URL", // chain 10143 read for Journey 1 (default: the public Monad testnet RPC)
  forkRpc: "ARASO_FORK_PUBLIC_RPC_URL", // the fork's Public Guard (completion slot reads only)
  grantVersion: "ARASO_FORK_GRANT_VERSION", // default "a956-g1" (amounts = A-949 Admin placeholders; Owner OPEN). Never change it within one forkInstanceId (a new value = a new grant key = everyone topped up again)
  appOrigin: "ARASO_FORK_APP_ORIGIN", // the app origin named in the challenge `uri:` line (required)
});
const DEFAULT_TESTNET_RPC = "https://testnet-rpc.monad.xyz";
const GRANT_VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const INVITE_REFUSALS = new Set(["not_invited", "invite_not_bound", "invite_bound_to_other_piggy", "piggy_bound_to_other_tester"]);
const ACTION_FIELDS = Object.freeze({
  invite_state: ["action"],
  challenge: ["action", "piggyAddress"],
  enter: ["action", "nonce", "signature", "piggyAddress", "journey1"],
  status: ["action", "piggyAddress", "forkInstanceId"],
  complete: ["action", "piggyAddress", "journeyId", "txHashes"],
});

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
const isJson = (raw) => typeof raw === "string" && raw.split(";")[0].trim().toLowerCase() === "application/json";

/** null = fine. Same-origin browser calls (or no browser headers) pass; a cross-site Origin passes only if listed in code (local dev). */
export function forkEntryOriginProblem(headers, allowedOrigins = []) {
  const h = headers ?? {};
  const origin = typeof h.origin === "string" ? h.origin : undefined;
  if (origin !== undefined && allowedOrigins.includes(origin)) return null;
  const site = h["sec-fetch-site"];
  if (site !== undefined && (typeof site !== "string" || site.trim().toLowerCase() !== "same-origin")) return "cross-site request";
  if (origin !== undefined && origin !== "null") return "origin not allowed";
  return null;
}

async function readBody(req) {
  const pre = req.body;
  if (pre !== undefined && pre !== null && typeof pre === "object" && !Buffer.isBuffer(pre)) {
    return JSON.stringify(pre).length > FORK_ENTRY_MAX_BODY ? { ok: false, status: 413 } : { ok: true, value: pre };
  }
  let raw = typeof pre === "string" || Buffer.isBuffer(pre) ? pre.toString() : "";
  if (!raw) for await (const chunk of req) { raw += chunk; if (raw.length > FORK_ENTRY_MAX_BODY) return { ok: false, status: 413 }; }
  if (raw.length > FORK_ENTRY_MAX_BODY) return { ok: false, status: 413 };
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v } : { ok: false, status: 400 }; } catch { return { ok: false, status: 400 }; }
}

/** Handler over an injected service (tests + the local server). allowedOrigins = code-only list of local dev origins. */
export function createForkEntryHandler({ service, inviteStore = null, now = () => Date.now(), allowedOrigins = [] } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return respond(res, 405, { ok: false, reason: "method_not_allowed" });
    if (!service && !inviteStore) return respond(res, 503, { ok: false, reason: "entry_unavailable" });
    const headers = req.headers ?? {};
    const originProblem = forkEntryOriginProblem(headers, allowedOrigins);
    if (originProblem) return respond(res, 403, { ok: false, reason: "origin_refused" });
    if (!isJson(headers["content-type"])) return respond(res, 415, { ok: false, reason: "json_only" });
    const body = await readBody(req);
    if (!body.ok) return respond(res, body.status, { ok: false, reason: body.status === 413 ? "too_large" : "bad_json" });
    const b = body.value;
    const action = typeof b.action === "string" && Object.prototype.hasOwnProperty.call(ACTION_FIELDS, b.action) ? b.action : null;
    if (!action) return respond(res, 400, { ok: false, reason: "bad_action" });
    if (Object.keys(b).some((k) => !ACTION_FIELDS[action].includes(k))) return respond(res, 400, { ok: false, reason: "unexpected_field" });
    const inviteToken = typeof headers[FORK_INVITE_HEADER] === "string" ? headers[FORK_INVITE_HEADER] : null;
    // First-journey metadata only. No bind, grant, identity disclosure or Journey 2 release-gate change.
    if (action === "invite_state") {
      try {
        if (!inviteStore) return respond(res, 503, { ok: false, reason: "entry_unavailable" });
        const row = await inviteStore.lookup(inviteToken);
        if (!row || (row.piggy === "" && !(row.expiresAt > now()))) return respond(res, 403, { ok: false, reason: "not_invited" });
        if (row.piggy !== "" && !/^0x[0-9a-f]{40}$/.test(row.piggy)) return respond(res, 503, { ok: false, reason: "entry_unavailable" });
        return respond(res, 200, { ok: true, bound: row.piggy !== "" });
      } catch { return respond(res, 503, { ok: false, reason: "entry_unavailable" }); }
    }
    if (!service) return respond(res, 503, { ok: false, reason: "entry_unavailable" });
    const out = await service[action]({ ...b, inviteToken });
    if (!out || out.ok !== true) return respond(res, out?.status || 503, { ok: false, reason: out?.reason || "entry_unavailable" });
    const { ok: _ok, status: _s, ...rest } = out;
    return respond(res, 200, { ok: true, ...rest });
  };
}

const looksProduction = (env) => {
  const own = (k) => (env && Object.prototype.hasOwnProperty.call(env, k) ? env[k] : undefined);
  return own("VERCEL") !== undefined || own("VERCEL_ENV") !== undefined || own("NODE_ENV") === "production";
};

/** The local entry service from server env, or null (fail closed). Memory stores = one local process only. */
export function localForkEntryServiceFromEnv(env = process.env, { fetchImpl = globalThis.fetch, now } = {}) {
  const own = (k) => (env && Object.prototype.hasOwnProperty.call(env, k) ? env[k] : undefined);
  if (own(FORK_ENTRY_ENV.local) !== "1" || looksProduction(env)) return null;
  const admin = forkAdminClientFromEnv(env, fetchImpl);
  const tokens = String(own(FORK_ENTRY_ENV.invites) || "").split(",").map((t) => t.trim()).filter(Boolean);
  const invites = createInviteTable(tokens);
  if (!admin || invites.size === 0 || !appOriginOk(own(FORK_ENTRY_ENV.appOrigin))) return null;
  const testnetUrl = String(own(FORK_ENTRY_ENV.testnetRpc) || DEFAULT_TESTNET_RPC);
  const forkUrl = own(FORK_ENTRY_ENV.forkRpc);
  return createForkEntryService({
    config: { invites, appOrigin: String(own(FORK_ENTRY_ENV.appOrigin) || ""), grantVersion: String(own(FORK_ENTRY_ENV.grantVersion) || "a956-g1") },
    store: createMemoryForkLedgerStore(),
    challenges: createMemoryChallengeStore(),
    admin,
    testnetRpc: jsonRpc({ url: testnetUrl, fetchImpl }),
    forkRpc: typeof forkUrl === "string" && forkUrl ? jsonRpc({ url: forkUrl, fetchImpl }) : null,
    ...(now ? { now } : {}),
  });
}

const httpsRpcUrl = (value) => {
  if (typeof value !== "string" || value !== value.trim()) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname && !u.username && !u.password && !u.hash ? u.href : null;
  } catch { return null; }
};

// [A-1053 · A-1031 opus condition 2] the hosted entry opens only at server release level >= 2 (same variable and parsing as api/relay-quote.js:
// unset / empty / not a positive integer = 1). Below 2 the service is null → the existing closed answer (503 entry_unavailable).
export const FORK_ENTRY_SERVER_LEVEL_ENV = "ARASO_SERVER_RELEASE_LEVEL";
const serverReleaseLevel = (v) => { const t = v == null ? "" : String(v).trim(); const n = /^[1-9]\d*$/.test(t) ? Number(t) : 1; return Number.isSafeInteger(n) ? n : 1; };

/** [A-1027] Hosted entry service from server env, or null (fail closed). All durable parts share the A-960 Upstash namespace. */
export function productionForkEntryServiceFromEnv(env = process.env, { fetchImpl = globalThis.fetch, now } = {}) {
  const own = (k) => (env && Object.prototype.hasOwnProperty.call(env, k) ? env[k] : undefined);
  if (!looksProduction(env) || own(FORK_ENTRY_ENV.local) === "1") return null;
  if (serverReleaseLevel(own(FORK_ENTRY_SERVER_LEVEL_ENV)) < 2) return null; // [A-1053] pre-A-1053: no level gate (opened at level 1 when the fork env was complete)
  const appOrigin = own(FORK_ENTRY_ENV.appOrigin);
  const publicRpcUrl = guardOrigin(own(FORK_ENTRY_ENV.forkRpc));
  const configuredTestnet = own(FORK_ENTRY_ENV.testnetRpc);
  const testnetRpcUrl = configuredTestnet === undefined || configuredTestnet === "" ? DEFAULT_TESTNET_RPC : httpsRpcUrl(configuredTestnet);
  const grantVersion = own(FORK_ENTRY_ENV.grantVersion);
  const parts = upstashForkEntryParts(env, { fetchImpl });
  const admin = forkAdminClientFromEnv(env, fetchImpl);
  if (!parts || !admin || !appOriginOk(appOrigin) || !publicRpcUrl || !testnetRpcUrl || typeof grantVersion !== "string" || !GRANT_VERSION_RE.test(grantVersion)) return null;
  const service = createForkEntryService({
    config: { invites: parts.invites, appOrigin, grantVersion },
    store: parts.store,
    challenges: parts.challenges,
    admin,
    testnetRpc: jsonRpc({ url: testnetRpcUrl, fetchImpl }),
    forkRpc: jsonRpc({ url: publicRpcUrl, fetchImpl }),
    ...(now ? { now } : {}),
  });
  const productionAuth = async (method, input) => {
    const out = await service[method](input);
    return out && INVITE_REFUSALS.has(out.reason) ? { ok: false, status: 403, reason: out.reason } : out;
  };
  return Object.freeze(Object.fromEntries(["challenge", "enter", "status", "complete"].map((method) => [method, (input) => productionAuth(method, input)])));
}

/** Chooses exactly one mode. Production markers can never fall back to the local memory path. */
export function forkEntryServiceFromEnv(env = process.env, options = {}) {
  return looksProduction(env) ? productionForkEntryServiceFromEnv(env, options) : localForkEntryServiceFromEnv(env, options);
}

let defaultHandler = null;
export default async function handler(req, res) {
  if (!defaultHandler) {
    const appOrigin = appOriginOk(process.env[FORK_ENTRY_ENV.appOrigin]) ? process.env[FORK_ENTRY_ENV.appOrigin] : null;
    defaultHandler = createForkEntryHandler({ service: forkEntryServiceFromEnv(process.env), inviteStore: inviteStoreFromEnv(process.env), allowedOrigins: appOrigin ? [appOrigin] : [] });
  }
  return defaultHandler(req, res);
}
