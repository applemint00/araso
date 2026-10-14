import { checkRequestOrigin, isJsonContentType } from './grant.js';
import { ARASO_REDIS_PREFIX, createUpstashRest, readUpstashEnv } from './_lib/grant-redis-store.js';
import { validEvent } from '../app/src/event-schema.js';

const MAX_BYTES = 256;
const TTL_SECONDS = 14 * 24 * 60 * 60;
function reply(res, status) {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.end();
}
async function readEvent(req) {
  const length = req.headers?.['content-length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > MAX_BYTES)) return null;
  let raw = req.body;
  if (raw === undefined || raw === null) {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > MAX_BYTES) return null;
      chunks.push(data);
    }
    raw = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    if (Buffer.byteLength(raw) > MAX_BYTES) return null;
    raw = JSON.parse(raw.toString());
  } else if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BYTES) return null;
  return validEvent(raw) ? { step: raw.step, code: raw.code } : null;
}
export function createEventHandler({ cmd = null, env = process.env, now = () => new Date() } = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405);
    const headers = req.headers ?? {};
    // Reuse grant policy, requiring positive same-origin browser evidence here.
    if (checkRequestOrigin(headers) || (headers['sec-fetch-site'] !== 'same-origin' && headers.origin !== 'https://arasoo.vercel.app')) return reply(res, 403);
    if (!isJsonContentType(headers['content-type'])) return reply(res, 400);
    let value;
    try { value = await readEvent(req); } catch { return reply(res, 400); }
    if (!value) return reply(res, 400);
    try {
      const cfg = cmd ? null : readUpstashEnv(env);
      const store = cmd || (cfg && createUpstashRest(cfg));
      if (!store) return reply(res, 503);
      const t = now().toISOString();
      const key = `${ARASO_REDIS_PREFIX}:event:${t.slice(0, 10).replaceAll('-', '')}`;
      await store('LPUSH', key, JSON.stringify({ t, step: value.step, code: value.code }));
      await store('LTRIM', key, 0, 4999);
      await store('EXPIRE', key, TTL_SECONDS);
      return reply(res, 204);
    } catch { return reply(res, 503); }
  };
}
export default createEventHandler();
