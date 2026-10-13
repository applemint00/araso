// Actual application functions over deterministic spies: no browser, keys or network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { waitForPasskey } from '../src/passkey-wait.js';
let source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
// Negative controls operate on the loaded source only; the working tree is never replaced.
if (process.env.A1171_MUTATION === 'server_before_auth') {
  source = source.replace('      // No server await or render before the pinned get: keep the click gesture.', '      await a956ForkMoneyAllowed();');
}
if (process.env.A1171_MUTATION === 'drop_server_check') {
  source = source.replace('      if (!(await a956ForkMoneyAllowed())) { console.debug("fork_send", "server_refused"); return; }', '');
}
function fn(name) {
  const m = new RegExp(`^(?:  )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(m, name);
  let k = source.indexOf('(', m.index), n = 0;
  for (; k < source.length; k++) { if (source[k] === '(') n++; if (source[k] === ')' && --n === 0) break; }
  // Parameters in these functions have no nested parentheses.
  k = source.indexOf('{', k);
  let depth = 0, quote = null;
  for (let i = k; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(m.index, i + 1);
  }
  throw Error(`missing end ${name}`);
}
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
let pass = 0;
async function check(label, run) { await run(); pass++; console.log(`PASS ${label}`); }
function clock() {
  let next = 0; const tasks = new Map();
  return { setTimer(fn, ms) { assert.equal(ms, 45000); tasks.set(++next, fn); return next; }, clearTimer(id) { tasks.delete(id); }, fire() { for (const [id, fn] of [...tasks]) { tasks.delete(id); fn(); } }, tasks };
}
await check('get starts before caller returns; timeout rejects, retry succeeds, late PRF is wiped', async () => {
  const t = clock(), first = deferred(); let calls = 0;
  const p = waitForPasskey(() => { calls++; return first.promise; }, t);
  assert.equal(calls, 1);
  const rejected = assert.rejects(p, { name: 'AuthWaitTimeout' }); t.fire(); await rejected;
  const second = await waitForPasskey(() => { calls++; return { prfOutput: new Uint8Array(32).fill(2) }; }, t);
  assert.equal(calls, 2); assert.equal(second.prfOutput[0], 2); assert.equal(t.tasks.size, 0);
  const late = new Uint8Array(32).fill(3); first.resolve({ prfOutput: late }); await flush(); assert.ok(late.every(v => v === 0));
});
await check('cancel/reject and synchronous throw settle without orphan timers', async () => {
  const t = clock();
  await assert.rejects(waitForPasskey(() => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })), t), { name: 'NotAllowedError' });
  await assert.rejects(waitForPasskey(() => { throw Error('sync'); }, t), /sync/);
  assert.equal(t.tasks.size, 0);
});
function harness({ auth = null, allowed = true, live = false } = {}) {
  const events = [], t = clock(), piggy = { id: 'test-piggy', address: 'payer', locator: { credentialId: 'pinned' } };
  const sj = { chosenDestinationId: 'job', step: 'readiness', decisionEventSeq: 0 };
  const ctx = {
    console: { debug: (...v) => events.push(['log', ...v]) }, Uint8Array, Date, String, Number, Promise, Error,
    waitForPasskey: (start, options) => { assert.equal(options.timeoutMs, 45000); return waitForPasskey(start, t); },
    UNLOCK_UI_WAIT_MS: 45000, getRpId: () => 'example.test', localTestWebAuthnOption: () => ({}),
    getPasskeyPrfOutput: () => { events.push('get'); return auth?.promise ?? Promise.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) }); },
    isCancelledAuthError: e => e?.name === 'NotAllowedError',
    state: { address: 'payer', appLock: null, scene: 'explore', secondJourney: sj, selectedPiggy: piggy },
    activeAccount: live ? { address: 'payer' } : null,
    authRequestForPiggy: () => ({ request: { credential: { credentialId: 'pinned' } } }),
    activateSigningSession: bytes => { events.push('activate'); assert.equal(bytes[0], 5); ctx.activeAccount = { address: 'payer' }; return { address: 'payer', account: ctx.activeAccount }; },
    endSignerSession: () => { ctx.activeAccount = null; events.push('end'); },
    a898SenderPiggy: () => piggy, a977Lower: v => String(v || '').toLowerCase(),
    a977Busy: false, a977Current: null, a956Signing: 0, a956EntryBusy: false,
    isAllowedPiggyRpId: () => true, webAuthnUnsupported: () => false, storedPrfSalt: () => null,
    forkEntryUrl: () => '/api/fork-entry', readForkInvite: () => 'test-invite', readReceipts: () => [], journey1Pointers: () => ({}),
    requestForkEntry: async () => { events.push('entry'); return { allowed }; },
    a956SwitchJourney: () => events.push('switch'),
    a956ForkMoneyAllowed: async () => { events.push('server'); return allowed; },
    fork: { publicClient: { getBlockNumber: async () => { events.push('block'); return 1n; } }, chain: {}, transport: {}, read: {} },
    dropSecondDraft() {}, setScene: scene => { ctx.state.scene = scene; },
    a974ForkChainId: 1, CHAIN_PROFILE: {}, createWalletClient: () => ({}), a977StrictTransport: () => ({}),
    a977RunJob: async () => { events.push('execute'); return { status: 'refused' }; },
    safeLocalStorage: () => ({}), a977Settle() {}, render: () => events.push('render'),
    selectedRegistryPiggy: () => piggy, PERMISSION_STATE: { AWAITING: 'awaiting', FAILED: 'failed', PERMITTED: 'permitted' },
    bindSigner: (p, addr) => ({ ok: p.address === addr, signerAddress: addr, reason: 'mismatch' }),
    cancelPermission: () => ({ state: 'cancelled' }), secondJourneyScope: () => ({ chainId: 'fork' }),
    permissionNonce: () => 'nonce', issuePermission: () => { events.push('permission'); return { envelope: {} }; },
  };
  vm.createContext(ctx);
  vm.runInContext([fn('requestPrf'), fn('a898SignerForPayer'), fn('a977Send'), fn('requestMoneyPermission'), fn('a956Enter').replaceAll('import.meta.env', '({})')].join('\n'), ctx);
  return { ctx, events, t, sj, piggy };
}
await check('Job: get is synchronous before server; duplicate busy remains until settled', async () => {
  const d = deferred(), h = harness({ auth: d });
  const p = h.ctx.a977Send(h.sj, 'job'); assert.deepEqual(h.events, ['get']); assert.equal(h.ctx.a977Busy, true);
  d.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) }); await p;
  assert.ok(h.events.indexOf('get') < h.events.indexOf('server')); assert.ok(h.events.indexOf('server') < h.events.indexOf('execute')); assert.equal(h.ctx.a977Busy, false);
});
await check('Job: active signer skips get; server refusal preserves signer and executes nothing', async () => {
  const h = harness({ live: true, allowed: false }), signer = h.ctx.activeAccount;
  await h.ctx.a977Send(h.sj, 'job'); assert.ok(!h.events.includes('get')); assert.ok(!h.events.includes('execute')); assert.equal(h.ctx.activeAccount, signer);
});
await check('Job: cancel => server0, execution0, busy released', async () => {
  const d = deferred(), h = harness({ auth: d }); const p = h.ctx.a977Send(h.sj, 'job');
  d.reject(Object.assign(new Error(), { name: 'NotAllowedError' })); await p;
  assert.ok(!h.events.includes('server')); assert.ok(!h.events.includes('execute')); assert.equal(h.ctx.a977Busy, false);
});
await check('Job: 45s timeout releases busy; late result cannot activate, retry can authenticate', async () => {
  const d = deferred(), h = harness({ auth: d }); const p = h.ctx.a977Send(h.sj, 'job'); h.t.fire(); await p;
  assert.equal(h.ctx.a977Busy, false); assert.equal(h.ctx.activeAccount, null);
  const late = new Uint8Array(32).fill(5); d.resolve({ credentialId: 'pinned', prfOutput: late }); await flush();
  assert.ok(late.every(v => v === 0)); assert.ok(!h.events.includes('server'));
  h.ctx.getPasskeyPrfOutput = () => { h.events.push('get_retry'); return Promise.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) }); };
  await h.ctx.a977Send(h.sj, 'job'); assert.ok(h.events.includes('get_retry')); assert.ok(h.events.includes('execute'));
});
await check('Job: identity changes during auth => no signer/no server/no tx', async () => {
  const d = deferred(), h = harness({ auth: d }); const p = h.ctx.a977Send(h.sj, 'job'); h.ctx.state.address = 'other';
  d.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) }); await p;
  assert.equal(h.ctx.activeAccount, null); assert.ok(!h.events.includes('server'));
});
await check('Job: identity changes during server wait => no execution', async () => {
  const d = deferred(), h = harness({ live: true }); h.ctx.a956ForkMoneyAllowed = () => d.promise;
  const p = h.ctx.a977Send(h.sj, 'job'); h.ctx.state.appLock = {}; d.resolve(true); await p; assert.ok(!h.events.includes('execute'));
});
await check('Money: get before permission server, denial keeps signer but issues no envelope', async () => {
  const d = deferred(), h = harness({ auth: d }); h.ctx.state.moneyIntent = { status: 'awaiting', piggyId: h.piggy.id };
  const p = h.ctx.requestMoneyPermission({ checkPermission: h.ctx.a956ForkMoneyAllowed }); assert.deepEqual(h.events, ['get']);
  d.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) }); await p;
  assert.ok(h.events.indexOf('get') < h.events.indexOf('server')); assert.ok(h.events.includes('permission'));
  const h2 = harness({ allowed: false }); h2.ctx.state.moneyIntent = { status: 'awaiting', piggyId: h2.piggy.id };
  await h2.ctx.requestMoneyPermission({ checkPermission: h2.ctx.a956ForkMoneyAllowed }); assert.ok(h2.ctx.activeAccount); assert.ok(!h2.events.includes('permission'));
});
await check('Money: existing signer skips get and still checks server', async () => {
  const h = harness({ live: true }); h.ctx.state.moneyIntent = { status: 'awaiting', piggyId: h.piggy.id };
  await h.ctx.requestMoneyPermission({ checkPermission: h.ctx.a956ForkMoneyAllowed }); assert.ok(!h.events.includes('get')); assert.ok(h.events.includes('server')); assert.ok(h.events.includes('permission'));
});
await check('Entry: one synchronous pinned get, duplicate ignored, timeout releases busy/signing, late result discarded', async () => {
  const d = deferred(), h = harness({ auth: d }); h.ctx.state.scene = 'sendstay'; h.ctx.state.credential = { credentialId: 'pinned' };
  const p = h.ctx.a956Enter(); assert.deepEqual(h.events, ['get']); await h.ctx.a956Enter(); assert.equal(h.events.filter(v => v === 'get').length, 1);
  h.t.fire(); await p; assert.equal(h.ctx.a956EntryBusy, false); assert.equal(h.ctx.a956Signing, 0);
  const late = new Uint8Array(32).fill(5); d.resolve({ credentialId: 'pinned', prfOutput: late }); await flush();
  assert.ok(late.every(v => v === 0)); assert.ok(!h.events.includes('entry')); assert.ok(!h.events.includes('switch'));
  h.ctx.getPasskeyPrfOutput = () => Promise.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) });
  await h.ctx.a956Enter(); assert.ok(h.events.includes('switch'));
});
await check('Money wrapper: duplicate click starts one get; timeout allows a fresh tap without server/permission', async () => {
  const d = deferred(), h = harness({ auth: d }); h.ctx.state.moneyIntent = { status: 'awaiting', piggyId: h.piggy.id };
  h.ctx.a956BaseRequestMoneyPermission = h.ctx.requestMoneyPermission; h.ctx.counted = f => f; h.ctx.onForkProfile = () => true;
  const start = source.indexOf('  let permissionBusy = false;');
  const end = source.indexOf('  proveFundingTargetControl = counted', start);
  vm.runInContext(source.slice(start, end), h.ctx);
  const p = h.ctx.requestMoneyPermission(); await h.ctx.requestMoneyPermission(); assert.equal(h.events.filter(v => v === 'get').length, 1);
  h.t.fire(); await p; assert.ok(!h.events.includes('server')); assert.ok(!h.events.includes('permission'));
  h.ctx.state.moneyIntent = { status: 'awaiting', piggyId: h.piggy.id };
  h.ctx.getPasskeyPrfOutput = () => Promise.resolve({ credentialId: 'pinned', prfOutput: new Uint8Array(32).fill(5) });
  await h.ctx.requestMoneyPermission(); assert.ok(h.events.includes('permission'));
});
await check('Payer: wrong credential or derived address never creates a usable signer', async () => {
  for (const mode of ['credential', 'address']) {
    const h = harness();
    if (mode === 'credential') h.ctx.getPasskeyPrfOutput = () => Promise.resolve({ credentialId: 'other', prfOutput: new Uint8Array(32).fill(5) });
    else h.ctx.activateSigningSession = () => { h.ctx.activeAccount = { address: 'other' }; return { address: 'other' }; };
    assert.equal((await h.ctx.a898SignerForPayer(h.piggy)).ok, false); assert.equal(h.ctx.activeAccount, null);
  }
});
await check('Money: changed intent during server wait is not overwritten and receives no permission', async () => {
  const d = deferred(), h = harness({ live: true }); h.ctx.state.moneyIntent = { status: 'awaiting', piggyId: h.piggy.id };
  const p = h.ctx.requestMoneyPermission({ checkPermission: () => d.promise }); const newer = { status: 'awaiting', piggyId: 'new' }; h.ctx.state.moneyIntent = newer;
  d.resolve(true); await p; assert.equal(h.ctx.state.moneyIntent, newer); assert.ok(!h.events.includes('permission'));
});
await check('Job click wrapper: two taps start exactly one get while busy', async () => {
  const d = deferred(), h = harness({ auth: d });
  h.ctx.a977BaseSend = () => {}; h.ctx.isForkJob = () => true;
  const a = source.indexOf('  handleSecondSend = () => {', source.indexOf('  const a977BaseSend = handleSecondSend;'));
  vm.runInContext(source.slice(a, source.indexOf('  async function a977Send(', a)), h.ctx);
  h.ctx.handleSecondSend(); h.ctx.handleSecondSend(); assert.equal(h.events.filter(v => v === 'get').length, 1);
  h.t.fire(); await flush(); assert.equal(h.ctx.a977Busy, false);
});
await check('Gift payer: signer starts before the presentation refresh, cancellation still settles UI', async () => {
  const h = harness(), d = deferred(); h.ctx.state.giftSend = { stage: 'compose', draftId: 'draft', payer: h.piggy };
  Object.assign(h.ctx, {
    a898Evaluate: () => ({}), lockQuote: () => ({}), a898RegistryPiggy: () => h.piggy,
    giftSendReduce: (old, action) => ({ ...old, stage: action.type === 'faceid_start' ? 'faceid' : 'declined' }),
    a898SignerForPayer: () => { h.events.push('get'); return d.promise; },
    refreshHomePaperMount: () => h.events.push('render'),
  });
  vm.runInContext(fn('a898FaceId'), h.ctx); const p = h.ctx.a898FaceId(); assert.deepEqual(h.events, ['get', 'render']);
  d.resolve({ ok: false }); await p; assert.equal(h.ctx.state.giftSend.stage, 'declined');
});
function unlockHarness(options) {
  const h = harness(options);
  Object.assign(h.ctx, { setTimeout: h.t.setTimer, clearTimeout: h.t.clearTimer,
    touchAppSession() {}, recordSafeError() {}, endActiveSession: h.ctx.endSignerSession });
  Object.assign(h.ctx.state, { scene: 'sendstay', credential: { credentialId: 'pinned' }, appLock: { phase: 'waiting' } });
  vm.runInContext([fn('unlockApp'), fn('settleUnlock'), fn('unlockWaitTimeoutError')].join('\n'), h.ctx);
  return h;
}
await check('Unlock then tap me: same PRF activates saved payer; tap me adds zero gets', async () => {
  const h = unlockHarness(); h.ctx.unlockApp(); assert.equal(h.events[0], 'get'); await flush();
  assert.equal(h.ctx.state.appLock, null); assert.ok(h.ctx.activeAccount);
  await h.ctx.a956Enter(); assert.equal(h.events.filter(x => x === 'get').length, 1); assert.ok(h.events.includes('switch'));
});
await check('Unlock: wrong derived address, changed identity, timeout and late PRF remain locked and wipe', async () => {
  for (const mode of ['mismatch', 'changed', 'timeout']) {
    const d = deferred(), h = unlockHarness({ auth: d }); h.ctx.unlockApp();
    if (mode === 'mismatch') h.ctx.activateSigningSession = () => { h.ctx.activeAccount = { address: 'other' }; return { address: 'other' }; };
    if (mode === 'changed') h.ctx.state.address = 'other';
    if (mode === 'timeout') { h.t.fire(); await flush(); }
    const bytes = new Uint8Array(32).fill(5); d.resolve({ credentialId: 'pinned', prfOutput: bytes }); await flush();
    assert.equal(h.ctx.state.appLock.phase, 'failed'); assert.equal(h.ctx.activeAccount, null); assert.ok(bytes.every(x => x === 0));
    assert.ok(!h.events.includes('entry'));
  }
});
console.log(`A-1171: ${pass} PASS / 0 FAIL (node spies, no real WebAuthn)`);
