import http from "node:http";
const ORIGIN = "https://arasoo.vercel.app";

/** Exact fork route only. Host validation remains the existing front's first gate. */
export function createForkGiftProxy({ ready, port = 18551, request = http.request }) {
  return (req, res) => {
    const cors = req.headers.origin === ORIGIN ? { "access-control-allow-origin": ORIGIN, vary: "Origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } : { vary: "Origin" };
    const fail = (status) => { res.writeHead(status, { ...cors, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ ok: false, error: "unavailable" })); req.resume(); };
    if (req.url !== "/gift-sponsor") return fail(404);
    if (req.headers.origin !== ORIGIN) return fail(403);
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); req.resume(); return; }
    if (req.method !== "POST") return fail(405);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] || "")) return fail(415);
    if (!ready()) return fail(503);
    const limit = 16384, chunks = []; let size = 0, over = false;
    const tooBig = () => { over = true; fail(413); res.once("finish", () => req.destroy()); };
    const length = req.headers["content-length"];
    if (length !== undefined && (!/^[0-9]{1,6}$/.test(length) || Number(length) > limit)) return tooBig();
    req.on("error", () => res.destroy());
    req.on("data", (c) => { if (over) return; size += c.length; if (size > limit) return tooBig(); chunks.push(c); });
    req.on("end", () => {
      if (over) return;
      if (!ready()) return fail(503);
      const body = Buffer.concat(chunks);
      const up = request({ host: "127.0.0.1", port, path: "/gift-sponsor", method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "content-length": body.length } }, (r) => {
        const pieces = []; let bytes = 0;
        r.on("data", (c) => { bytes += c.length; if (bytes > limit) r.destroy(); else pieces.push(c); });
        r.on("error", () => { if (!res.headersSent) fail(502); else res.destroy(); });
        r.on("end", () => { if (bytes > limit) return; res.writeHead(r.statusCode || 502, { ...cors, "content-type": "application/json", "cache-control": "no-store" }); res.end(Buffer.concat(pieces)); });
      });
      up.setTimeout(150000, () => up.destroy());
      up.on("error", () => { if (!res.headersSent) fail(502); else res.destroy(); });
      res.on("close", () => { if (!res.writableFinished) up.destroy(); });
      up.end(body);
    });
  };
}

/** A timeout/worker crash never authorizes a final snapshot during an ambiguous send. */
export async function drainForkBeforeSnapshot({ drain, snapshot, failClosed }) {
  try { await drain(); } catch { await failClosed(); return false; }
  await snapshot(); return true;
}
