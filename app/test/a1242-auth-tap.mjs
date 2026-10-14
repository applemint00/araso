import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { validEvent } from '../src/event-schema.js';
import { createTracker } from '../src/track.js';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function fn(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `missing ${name}`);
  let cursor = source.indexOf('(', match.index), parens = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    if (source[cursor] === ')' && --parens === 0) break;
  }
  const start = source.indexOf('{', cursor);
  let depth = 0, quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

let pass = 0;
async function check(label, run) { await run(); pass += 1; console.log(`PASS ${label}`); }
function beaconTracker(events) {
  return createTracker({ navigator: { sendBeacon: () => { events.push('sendBeacon'); return true; } } });
}

await check('schema accepts create/find and rejects any other auth_tap code', () => {
  assert.equal(validEvent({ step: 'auth_tap', code: 'create' }), true);
  assert.equal(validEvent({ step: 'auth_tap', code: 'find' }), true);
  assert.equal(validEvent({ step: 'auth_tap', code: 'other' }), false);
});

await check('find starts WebAuthn without queuing an auth tap beacon', async () => {
  const events = [];
  const context = {
    Uint8Array,
    UNLOCK_UI_WAIT_MS: 45_000,
    waitForPasskey: start => start(),
    track: beaconTracker(events),
    getPasskeyPrfOutput: () => { events.push('webauthn:get'); return Promise.resolve({ prfOutput: new Uint8Array(32) }); },
    getRpId: () => 'example.test',
    localTestWebAuthnOption: () => ({}),
    isCancelledAuthError: () => false,
    console: { debug() {} },
  };
  vm.createContext(context);
  vm.runInContext(fn('requestPrf'), context);
  const result = context.requestPrf();
  assert.deepEqual(events, ['webauthn:get']);
  await result;
});

function createHarness(client) {
  const events = [];
  const request = {
    rp: {}, user: {}, challenge: new Uint8Array(1), algorithms: [-7], timeout: 120_000,
    attestation: 'none', residentKey: 'required', userVerification: 'required', prfSalt: new Uint8Array(32),
  };
  const credential = {
    type: 'public-key', rawId: new Uint8Array([1]).buffer,
    response: { getTransports: () => [] },
    getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).buffer } } }),
  };
  const context = {
    Uint8Array, Error, Promise, btoa: value => value,
    track: beaconTracker(events),
    navigator: { credentials: { create: () => { events.push('webauthn:create'); return Promise.resolve(credential); } } },
    createPasskeyWithPrfOutput: async options => options.webAuthnClient.createCredential(request),
  };
  vm.createContext(context);
  vm.runInContext(fn('a1202CreatePasskey'), context);
  return { context, events, request, client };
}

await check('browser create starts WebAuthn without queuing an auth tap beacon', async () => {
  const harness = createHarness(null);
  await harness.context.a1202CreatePasskey({}, { value: 'idle' });
  assert.equal(harness.events[0], 'webauthn:create');
});

await check('injected client create starts WebAuthn without queuing an auth tap beacon', async () => {
  const harness = createHarness(true);
  const client = { createCredential: async () => { harness.events.push('local-client:create'); return {
    credentialId: new Uint8Array([1]), transports: [], prfOutput: new Uint8Array(32),
  }; } };
  await harness.context.a1202CreatePasskey({ webAuthnClient: client }, { value: 'idle' });
  assert.equal(harness.events[0], 'local-client:create');
});

console.log(`A-1242: ${pass} PASS / 0 FAIL (node spies, no real WebAuthn)`);
