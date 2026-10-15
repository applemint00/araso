import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coarseOsBucket } from '../src/os-bucket.js';
import { createTracker } from '../src/track.js';
import { validEvent } from '../src/event-schema.js';

const samples = new Map([
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_10 like Mac OS X)', 'ios18_7'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)', 'ios18'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X)', 'ios17'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X)', 'ios_old'],
  ['Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)', 'ipados'],
  ['Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'android'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'mac'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
  ['', 'other'],
]);
for (const [ua, expected] of samples) assert.equal(coarseOsBucket(ua), expected, ua || 'empty UA');
assert.equal(coarseOsBucket(null), 'other');

// Crawlers and link-preview fetchers get their own word so they never look like a person who stopped at the envelope.
const bots = [
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +https://www.anthropic.com/)',
  'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; +https://www.bytedance.com/)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/)',
  'TelegramBot (like TwitterBot)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  'CCBot/2.0 (https://commoncrawl.org/faq/)',
];
for (const ua of bots) assert.equal(coarseOsBucket(ua), 'bot', ua);
// People keep their bucket (incl. a phone brand that ends in "bot" and a desktop Linux browser).
for (const [ua, expected] of [
  ['Mozilla/5.0 (Linux; Android 13; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', 'android'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'other'],
]) assert.equal(coarseOsBucket(ua), expected, ua);
assert.equal(validEvent({ step: 'os', code: 'bot' }), true);

const sent = [];
const track = createTracker({ navigator: { sendBeacon: (...args) => sent.push(args) } });
// Blob payloads are checked by A1234; here the transport count proves page-local one-shot behavior.
track('os', 'ios18_7');
track('os', 'ios18_7');
assert.equal(sent.length, 1);
assert.equal(validEvent({ step: 'os', code: 'ios19' }), false);
assert.equal(validEvent({ step: 'os', code: 'ios18_7' }), true);

const osCall = 'track("os", coarseOsBucket(globalThis.navigator?.userAgent));';
let main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
if (process.env.A1258_MUTATION === 'drop_os') main = main.replace(osCall, '');
assert.ok(main.includes(osCall), 'boot emits one coarse OS event');
assert.equal(main.split(osCall).length - 1, 1, 'boot OS call appears once');
assert.ok(main.indexOf(osCall) < main.indexOf('track("flow_error", "create_lost")'), 'OS event is emitted before create_lost');
assert.ok(main.indexOf(osCall) < main.indexOf('render();'), 'OS event is emitted before first render');

console.log('A1258 UA buckets (9 people + 13 bots + 2 look-alikes) / one-shot / schema / boot ordering PASS');
