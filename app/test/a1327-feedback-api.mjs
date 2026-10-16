import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createFeedbackHandler } from '../../api/feedback.js';
import { validFeedback, FEEDBACK_MAX_CHARS } from '../src/feedback-schema.js';

// Tester feedback: the words, one fixed screen word and the coarse os bucket only. No IP, user agent, address or key is ever stored.
const headers = { origin: 'https://arasoo.vercel.app', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' };
const good = { text: 'the bell rang twice', screen: 'home', os: 'ios18_7' };
async function invoke({ body = good, h = headers, method = 'POST', rate = 1, fail = false, noStore = false } = {}) {
  const req = Readable.from([]);
  Object.assign(req, { method, headers: h, body });
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() { this.ended = true; } };
  const calls = [];
  const cmd = noStore ? null : async (...args) => { calls.push(args); if (fail) throw Error('private failure'); return args[0] === 'EVAL' ? rate : 1; };
  await createFeedbackHandler({ cmd, env: noStore ? {} : undefined, now: () => new Date('2026-10-16T10:00:00Z') })(req, res);
  return { status: res.statusCode, calls, res };
}
let n = 0;
const test = async (name, fn) => { await fn(); n += 1; console.log(`PASS  ${name}`); };

await test('204 stores one line: t · screen · os · text only (no IP / UA)', async () => {
  const r = await invoke();
  assert.equal(r.status, 204);
  const push = r.calls.find((c) => c[0] === 'LPUSH');
  assert.ok(push, 'LPUSH');
  assert.match(push[1], /:feedback$/);
  const row = JSON.parse(push[2]);
  assert.deepEqual(Object.keys(row).sort(), ['os', 'screen', 't', 'text']);
  assert.deepEqual({ ...row, t: undefined }, { t: undefined, text: 'the bell rang twice', screen: 'home', os: 'ios18_7' });
  const all = JSON.stringify(r.calls);
  for (const leak of ['203.0.113.9', 'iPhone OS', 'Mozilla']) assert.equal(all.includes(leak), false, `no ${leak}`);
  assert.ok(r.calls.some((c) => c[0] === 'LTRIM' && c[2] === 0 && c[3] === 1999));
  assert.ok(r.calls.some((c) => c[0] === 'EXPIRE' && c[2] === 14 * 24 * 60 * 60));
  assert.equal(r.res.headers['cache-control'], 'no-store');
});
await test('text is trimmed and kept to 500 characters; longer, empty or control-only is refused', async () => {
  assert.equal(FEEDBACK_MAX_CHARS, 500);
  const ok = await invoke({ body: { ...good, text: `  ${'가'.repeat(500)}  ` } });
  assert.equal(ok.status, 204);
  assert.equal(JSON.parse(ok.calls.find((c) => c[0] === 'LPUSH')[2]).text, '가'.repeat(500));
  for (const text of ['가'.repeat(501), '', '   ', '\u0000\u0007']) assert.equal((await invoke({ body: { ...good, text } })).status, 400, JSON.stringify(text.slice(0, 5)));
});
await test('screen and os are fixed words; extra keys refused', async () => {
  for (const body of [{ ...good, screen: 'Couldn\'t open' }, { ...good, os: 'iPhone 15' }, { ...good, address: '0x' + '1'.repeat(40) }, { text: 'x', screen: 'home' }, null, [], 'x']) {
    const r = await invoke({ body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.calls.length, 0);
  }
  assert.equal(validFeedback(good), true);
});
await test('same-origin browser only (event.js policy); POST only; JSON only', async () => {
  for (const h of [{ ...headers, origin: 'https://evil.example' }, { ...headers, 'sec-fetch-site': 'cross-site' }, { 'content-type': 'application/json' }]) {
    const r = await invoke({ h });
    assert.equal(r.status, 403);
    assert.equal(r.calls.length, 0);
  }
  assert.equal((await invoke({ method: 'GET' })).status, 405);
  assert.equal((await invoke({ h: { ...headers, 'content-type': 'text/plain' } })).status, 400);
  assert.equal((await invoke({ body: '{' })).status, 400);
});
await test('a shared window limit (no per-person key): over the limit = 429, nothing stored', async () => {
  const r = await invoke({ rate: 10_000 });
  assert.equal(r.status, 429);
  assert.equal(r.calls.some((c) => c[0] === 'LPUSH'), false);
  const rl = r.calls.find((c) => c[0] === 'EVAL');
  assert.match(rl[3], /:feedback:rl$/);
});
await test('store missing or failing = 503 (no detail out)', async () => {
  assert.equal((await invoke({ noStore: true })).status, 503);
  assert.equal((await invoke({ fail: true })).status, 503);
});
console.log(`A-1327 feedback api: ${n}/${n} PASS`);
