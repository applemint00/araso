// Actual application functions; deterministic offline spies, no keys or network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { onForkProfile } from '../src/fork-entry-client.js';
import { authRequestForPiggy, switchSelection } from '../src/piggy-session.js';
let source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
if (process.env.A1183_MUTATION === 'end_first') source = source.replace('if (!retainUnlockedSigner) endActiveSession();', 'endActiveSession();');
if (process.env.A1183_MUTATION === 'no_fallback') source = source.replace('a898SignerForPayer(piggy, { allowDeviceCredential: true, fresh: true })', 'a898SignerForPayer(piggy, { fresh: true })');
function fn(name) {
  const match = new RegExp(`^(?:  )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  let start = source.indexOf('(', match.index), nesting = 0;
  for (; start < source.length; start++) {
    if (source[start] === '(') nesting++;
    if (source[start] === ')' && --nesting === 0) break;
  }
  start = source.indexOf('{', start);
  let depth = 0, quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(match.index, i + 1);
  }
  throw Error(name);
}
const payer = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
function harness({ live = true, forkProfile = true, allowed = true } = {}) {
  const events = [], piggy = { id: 'legacy', address: payer };
  const sj = { chosenDestinationId: 'job', decisionEventSeq: 0 };
  const c = {
    console: { debug: (...args) => events.push(args.join(':')) }, Uint8Array,
    state: { address: payer, credential: { credentialId: 'device_pin', transports: ['internal'] }, selectedPiggy: null, appLock: null,
      moneyIntent: { permission: { nonce: 'old' } }, funding: {}, scene: 'explore', secondJourney: sj },
    activeSession: live ? {} : null, activeAccount: live ? { address: payer } : null,
    consumedPermissionNonces: new Set(), switchSelection, authRequestForPiggy,
    endActiveSession: () => { events.push('end'); c.activeAccount = null; c.activeSession = null; },
    endSignerSession: () => c.endActiveSession(),
    addMoneyPiggies: () => [piggy], a898RegistryPiggy: () => piggy,
    onForkProfile, storedPrfSalt: () => new Uint8Array(32).fill(9),
    requestPrf: (credential, { prfSalt }) => { assert.equal(prfSalt[0], 9); events.push('get'); assert.equal(credential.credentialId, 'device_pin'); return Promise.resolve({ credentialId: 'device_pin', prfOutput: new Uint8Array(32) }); },
    activateSigningSession: () => { c.activeAccount = { address: payer }; c.activeSession = {}; return { address: payer }; },
    a977Lower: v => String(v || '').toLowerCase(), a977Busy: false, a977Current: null, a956Signing: 0,
    a956ForkMoneyAllowed: async () => { events.push('status'); return allowed; },
    fork: { publicClient: { getBlockNumber: async () => 1n }, chain: {}, transport: {}, read: {} },
    dropSecondDraft() {}, setScene: scene => { c.state.scene = scene; },
    a974ForkChainId: 1, CHAIN_PROFILE: { id: forkProfile ? 'monad-fork' : 'monad-testnet', status: 'active' }, createWalletClient: () => ({}), a977StrictTransport: () => ({}),
    a977RunJob: async () => { events.push('execute'); return { status: 'refused' }; },
    safeLocalStorage: () => ({}), a977Settle() {}, render() {},
  };
  vm.createContext(c);
  vm.runInContext(['applyPiggySelection', 'a898SenderPiggy', 'a898SignerForPayer', 'a977Send'].map(fn).join('\n'), c);
  return { c, events, piggy, sj, send: () => c.a977Send(sj, 'job') };
}
let pass = 0;
async function check(name, run) { await run(); pass++; console.log('PASS ' + name); }
// [A-1298 · Owner "샌드는 트잭이라 해야해"] a Job Send moves money: Face ID every time, even with a live key (pre-A-1298: the live signer was reused, get0)
await check('unlock -> first selection -> Send asks Face ID again (get1) before status1/execute1; old authority discarded', async () => {
  const h = harness();
  await h.send(); assert.deepEqual(h.events.filter(x => ['get', 'status', 'execute'].includes(x)), ['get', 'status', 'execute']);
  assert.equal(String(h.c.activeAccount?.address).toLowerCase(), String(payer).toLowerCase(), 'the fresh signer is this Piggy');
  assert.equal(h.c.state.selectedPiggy.address, payer); assert.equal(h.c.state.moneyIntent, null);
  assert.equal(h.c.state.funding, null); assert.ok(h.c.consumedPermissionNonces.has('old'));
});
await check('expired signer -> device get1 synchronously before status1/execute1', async () => {
  const h = harness({ live: false }); const p = h.send();
  assert.equal(h.events.filter(x => x === 'get').length, 1); assert.ok(!h.events.includes('status'));
  await p; assert.deepEqual(h.events.filter(x => ['get', 'status', 'execute'].includes(x)), ['get', 'status', 'execute']);
});
await check('different address selection ends previous signer', () => {
  const h = harness(); h.c.applyPiggySelection(h.piggy); h.c.applyPiggySelection({ id: 'other', address: other });
  assert.equal(h.c.activeAccount, null); assert.deepEqual(h.events, ['end']);
});
await check('first selection with different signer also ends it', () => {
  const h = harness(); h.c.activeAccount.address = other; h.c.applyPiggySelection(h.piggy);
  assert.equal(h.c.activeAccount, null);
});
await check('derived address mismatch fails before status and destroys signer', async () => {
  const h = harness({ live: false }); h.c.activateSigningSession = () => { h.c.activeAccount = { address: other }; return { address: other }; };
  await h.send(); assert.equal(h.c.activeAccount, null); assert.ok(!h.events.includes('status')); assert.ok(!h.events.includes('execute'));
});
await check('server refusal remains mandatory with a live signer (after the Send\'s own Face ID)', async () => {
  const h = harness({ allowed: false }); await h.send(); assert.deepEqual(h.events.filter(x => ['get', 'status', 'execute'].includes(x)), ['get', 'status']);
});
await check('zero or several Piggies without selection remains unavailable', async () => {
  for (const n of [0, 2]) { const h = harness(); h.c.addMoneyPiggies = () => Array(n).fill(h.piggy); await h.send(); assert.ok(!h.events.includes('status')); assert.ok(!h.events.includes('execute')); }
});
await check('non-fork, ordinary payer caller, wrong device address and malformed locator never fall back', async () => {
  for (const mode of ['nonfork', 'ordinary', 'address', 'locator']) {
    const h = harness({ live: false, forkProfile: mode !== 'nonfork' });
    if (mode === 'address') h.c.state.address = other;
    if (mode === 'locator') h.piggy.locator = {};
    const result = await h.c.a898SignerForPayer(h.piggy, { allowDeviceCredential: mode !== 'ordinary' });
    assert.equal(result.ok, false); assert.ok(!h.events.includes('get'));
  }
});
await check('credential changed, wrong credential, cancellation or lock during get => status0/execute0', async () => {
  for (const mode of ['changed', 'wrong', 'cancel', 'lock']) {
    const h = harness({ live: false }); let resolve, reject;
    h.c.requestPrf = () => new Promise((r, j) => { resolve = r; reject = j; });
    const p = h.send(); const bytes = new Uint8Array(32).fill(7);
    if (mode === 'changed') h.c.state.credential = { credentialId: 'other_pin' };
    if (mode === 'lock') h.c.state.appLock = {};
    if (mode === 'cancel') reject(Error('cancel')); else resolve({ credentialId: mode === 'wrong' ? 'wrong' : 'device_pin', prfOutput: bytes });
    await p; assert.equal(h.c.activeAccount, null); assert.ok(!h.events.includes('status')); assert.ok(!h.events.includes('execute'));
    if (mode !== 'cancel') assert.ok(bytes.every(x => x === 0));
  }
});
console.log(`A-1183: ${pass} PASS / 0 FAIL (offline actual-function spies; no real auth/tx)`);
