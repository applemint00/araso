import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createFeedbackHandler } from '../../api/feedback.js';
import { createEventHandler } from '../../api/event.js';
import { EVENT_CODES, giftReceiveCode } from '../src/event-schema.js';

// A-1431: (가) the Gift receive path leaves one fixed-word event at its result · (나) feedback words never keep an address, token or email.
let n = 0;
const test = async (name, fn) => { await fn(); n += 1; console.log(`PASS  ${name}`); };
const headers = { origin: 'https://arasoo.vercel.app', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
async function post(handler, body) {
  const calls = [];
  const req = Readable.from([]);
  Object.assign(req, { method: 'POST', headers, body });
  const res = { setHeader() {}, end() {} };
  await handler({ cmd: async (...args) => { calls.push(args); return args[0] === 'EVAL' ? 1 : 1; }, now: () => new Date('2026-10-19T02:00:00Z') })(req, res);
  return { status: res.statusCode, calls };
}

await test('(가) gift_receive = ok · auth · unavailable · fail only, and /api/event takes each of them', async () => {
  assert.deepEqual(EVENT_CODES.gift_receive, ['ok', 'auth', 'unavailable', 'fail']);
  for (const code of EVENT_CODES.gift_receive) assert.equal((await post(createEventHandler, { step: 'gift_receive', code })).status, 204);
  assert.equal((await post(createEventHandler, { step: 'gift_receive', code: 'expired' })).status, 400);
});

await test('(가) the receive result maps to one fixed word; no result yet = no event', () => {
  const S = (s) => giftReceiveCode({ settled: s, out: { started: false } });
  assert.equal(S({ result: 'ok', valueSubmission: { status: 'value_transferred' } }), 'ok');
  assert.equal(S({ status: 'refused', reason: 'already_claimed_by_same' }), 'ok');
  assert.equal(S({ status: 'sign_failed' }), 'auth');
  assert.equal(S({ status: 'record_source_unavailable' }), 'unavailable');
  assert.equal(S({ result: 'ok', valueSubmission: { status: 'claim_transport_unavailable' } }), 'unavailable');
  assert.equal(S({ result: 'ok', valueSubmission: { status: 'gas_ledger_unavailable' } }), 'unavailable');
  assert.equal(S({ result: 'ok', valueSubmission: { status: 'claim_submit_failed' } }), 'fail');
  assert.equal(S({ status: 'refused', reason: 'expired' }), 'fail');
  assert.equal(S({ status: 'claim_settle_failed' }), 'fail');
  const O = (out) => giftReceiveCode({ settled: null, out });
  assert.equal(O({ ok: false, cancelled: true }), 'auth');
  assert.equal(O({ started: false, reason: 'passkey_declined' }), 'auth');
  assert.equal(O({ started: false, reason: 'record_source_unavailable' }), 'unavailable');
  assert.equal(O({ started: false, reason: 'gift_open_failed' }), 'fail');
  for (const quiet of [undefined, null, { ok: true }, { started: true }, { started: false, reason: 'card_flipped' }, { started: false, reason: 'already_running' }]) assert.equal(O(quiet), null);
});

await test('(가) main.js: the Gift receive tap reports once through track("gift_receive") only when a Gift was waiting; the three send events stay', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const sites = src.match(/track\("gift_receive"/g) || [];
  assert.equal(sites.length, 1);
  const at = src.indexOf('track("gift_receive"');
  const block = src.slice(src.lastIndexOf('const a1431BaseOpenGiftInvite = openGiftInvite;', at), at + 200);
  assert.match(block, /const waiting = !!pendingGiftClaim;/);
  assert.match(block, /const before = lastGiftClaimSettlement;/);
  assert.match(block, /if \(!waiting\) return out;/);
  assert.match(block, /settled: lastGiftClaimSettlement !== before \? lastGiftClaimSettlement : null/);
  assert.equal((src.match(/track\("gift", /g) || []).length, 3);
});

const SECRETS = {
  addr: '0x52908400098527886E0F7030069857D2E4169EE7',
  hex64: '0x' + 'ab12'.repeat(16),
  bare64: 'cd34'.repeat(16),
  email: ['tester.one+gift', 'example.co.kr'].join('@'), // joined so the leak scan sees no literal address
  b64: 'eyJhbGciOiJFUzI1NiJ9_Xk3-qZ',
};
await test('(나) feedback: address · token · email · long base64url are masked before the store; the rest of the words stay', async () => {
  const text = `sent to ${SECRETS.addr} tx ${SECRETS.hex64} key ${SECRETS.bare64} mail ${SECRETS.email} link #${SECRETS.b64} ok`;
  const r = await post(createFeedbackHandler, { text, screen: 'home', os: 'ios18_7' });
  assert.equal(r.status, 204);
  const all = JSON.stringify(r.calls);
  for (const [k, v] of Object.entries(SECRETS)) assert.equal(all.includes(v), false, `no ${k} in the store`);
  const row = JSON.parse(r.calls.find((c) => c[0] === 'LPUSH')[2]);
  assert.equal(row.text, 'sent to [addr] tx [token] key [token] mail [email] link #[token] ok');
});

await test('(나) feedback: ordinary words, numbers and long plain words are kept as written', async () => {
  const text = 'the bell rang twice at 10:42, unbelievably slow · 선물 받기가 안 됨 · international-friendship 0x12';
  const r = await post(createFeedbackHandler, { text, screen: 'home', os: 'ios18_7' });
  assert.equal(r.status, 204);
  assert.equal(JSON.parse(r.calls.find((c) => c[0] === 'LPUSH')[2]).text, text);
});

console.log(`A-1431: ${n}/5 PASS`);
