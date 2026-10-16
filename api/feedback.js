import { checkRequestOrigin, isJsonContentType } from './grant.js';
import { ARASO_REDIS_PREFIX, createUpstashRest, readUpstashEnv } from './_lib/grant-redis-store.js';
import { feedbackText, validFeedback } from '../app/src/feedback-schema.js';

const MAX_BYTES = 4096;
const TTL_SECONDS = 14 * 24 * 60 * 60; // same as api/event.js
const KEEP = 2000;
// One shared fixed window for everyone (same counter as gift-sponsor-kv-store.js): no per-person key, so nothing about the sender is kept.
const RATE = "local c=redis.call('incr',KEYS[1]) if c==1 then redis.call('expire',KEYS[1],ARGV[1]) end return c";
const RATE_WINDOW_SECONDS = 600;
const RATE_LIMIT = 60;
function reply(res, status) {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.end();
}
async function readFeedback(req) {
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
  return validFeedback(raw) ? { text: feedbackText(raw.text), screen: raw.screen, os: raw.os } : null;
}
export function createFeedbackHandler({ cmd = null, env = process.env, now = () => new Date() } = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405);
    const headers = req.headers ?? {};
    // the api/event.js origin policy: positive same-origin browser evidence
    if (checkRequestOrigin(headers) || (headers['sec-fetch-site'] !== 'same-origin' && headers.origin !== 'https://arasoo.vercel.app')) return reply(res, 403);
    if (!isJsonContentType(headers['content-type'])) return reply(res, 400);
    let value;
    try { value = await readFeedback(req); } catch { return reply(res, 400); }
    if (!value) return reply(res, 400);
    try {
      const cfg = cmd ? null : readUpstashEnv(env);
      const store = cmd || (cfg && createUpstashRest(cfg));
      if (!store) return reply(res, 503);
      const key = `${ARASO_REDIS_PREFIX}:feedback`;
      if (Number(await store('EVAL', RATE, 1, `${key}:rl`, RATE_WINDOW_SECONDS)) > RATE_LIMIT) return reply(res, 429);
      await store('LPUSH', key, JSON.stringify({ t: now().toISOString(), screen: value.screen, os: value.os, text: value.text }));
      await store('LTRIM', key, 0, KEEP - 1);
      await store('EXPIRE', key, TTL_SECONDS);
      return reply(res, 204);
    } catch { return reply(res, 503); }
  };
}
export default createFeedbackHandler();
