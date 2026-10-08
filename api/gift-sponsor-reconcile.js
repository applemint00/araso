// [A-913 E/G] Vercel Cron recovery loop for the Gift sponsor. GET /api/gift-sponsor-reconcile (schedule in vercel.json "crons").
// Vercel Cron calls with `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET env exists; this route accepts ONLY that header and refuses everything if
// CRON_SECRET is unset (fail closed). One pass = gift-sponsor-reconcile.mjs run(): for each unfinished giftId read chain truth and take only the next certain step
// (never a blind resend; a tx "sent but unsure" is read first). The pass runs under the same sponsor lease as live requests, so it never interleaves with a claim.
// Response: counts + the sponsor /health summary (balance vs floor); no secret, no ledger content, no key.

import { timingSafeEqual, createHash } from "node:crypto";
import { getGiftSponsorRuntime } from "./_lib/gift-sponsor-runtime.js";

export const CRON_PATH = "/api/gift-sponsor-reconcile";
const digest = (s) => createHash("sha256").update(String(s)).digest();
function respond(res, status, body) { res.statusCode = status; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body)); }

export function createGiftSponsorReconcileHandler({ getRuntime = () => getGiftSponsorRuntime(), env = undefined } = {}) {
  return async function handler(req, res) {
    try {
      if (req.method !== "GET") { res.setHeader("allow", "GET"); return respond(res, 405, { ok: false, error: "method_not_allowed" }); }
      const e = env === undefined ? process.env : env;
      const secret = typeof e.CRON_SECRET === "string" ? e.CRON_SECRET : "";
      const got = req.headers && typeof req.headers.authorization === "string" ? req.headers.authorization : "";
      if (secret.length < 16 || !got.startsWith("Bearer ") || !timingSafeEqual(digest(got.slice(7)), digest(secret))) return respond(res, 401, { ok: false, error: "unauthorized" });
      let rt; try { rt = getRuntime(); } catch { rt = null; }
      if (!rt || !rt.service || rt.service.ready !== true) return respond(res, 200, { ok: true, state: "off" });
      const report = await rt.reconciler.run();
      if (report && report.busy === true) return respond(res, 200, { ok: true, state: "busy" });
      const health = await rt.service.health();
      return respond(res, 200, { ok: true, state: "ran", steps: report.results.length, remaining: report.remaining.length, health });
    } catch {
      return respond(res, 500, { ok: false, error: "reconcile_error" });
    }
  };
}

export default createGiftSponsorReconcileHandler();
