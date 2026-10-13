import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createMemoryStorage, createSecondJourneyState, applyExploreSelection, saveSecondJourneyState, loadSecondJourneyState, recordSecondJourneyReceipt } from '../src/second-journey-state.js';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('const secondBellRung ='), source.indexOf('// [A-791] A-762 routing consumed as evidence.')).replaceAll('import.meta.env', 'env');
let pass = 0;
function test(name, run) { run(); pass++; console.log(`PASS ${name}`); }
function harness({ enabled = true, fork = true, completed = true, release = true, random = 0 } = {}) {
  let now = 0, id = 0, button = null, opens = 0;
  const timers = new Map(), cleanups = [], listeners = {};
  const stage = { querySelector: () => button, appendChild: b => { button = b; } };
  const ctx = { console, Promise, Set, Math: { random: () => random, floor: Math.floor, max: Math.max }, Date: { now: () => now },
    env: { VITE_ARASO_TEST_REPEAT_BELL: enabled ? '1' : '' }, CHAIN_PROFILE: {}, RELEASE_LEVEL: 2,
    onForkProfile: () => fork, journeyFeatureOpen: () => release,
    state: { secondJourneyCompletedOnce: completed, address: 'piggy', scene: 'sendstay', appLock: null, sendCardVisible: false, secondJourney: { selectedIds: ['grow'], step: 'candidates', waitingForPlace: false } },
    secondLaneMode: () => true,
    document: { visibilityState: 'visible', querySelector: sel => sel === '#secondHomeBell' ? button : stage,
      createElement: () => ({ setAttribute() {}, addEventListener: (_, f) => { ctx.click = f; }, remove: () => { button = null; } }) },
    setTimeout: (f, ms) => { timers.set(++id, { f, due: now + ms }); return id; }, clearTimeout: i => timers.delete(i),
    onSceneTeardown: f => cleanups.push(f), sceneListener: (_, type, f) => { listeners[type] = f; },
    openSecondJourneyExplore: () => { opens++; ctx.state.scene = 'explore'; ctx.state.secondJourney.step = 'candidates'; }, render() {},
  };
  vm.createContext(ctx); vm.runInContext(section, ctx);
  const tick = ms => { now += ms; for (const [i, t] of [...timers]) if (t.due <= now) { timers.delete(i); t.f(); } };
  const visibility = value => { ctx.document.visibilityState = value; listeners.visibilitychange(); };
  const rerender = () => { for (const f of cleanups.splice(0)) f(); button = null; if (ctx.a1172BellEnabled() && !ctx.a1172BellEligible()) ctx.a1172ResetBell(); if (ctx.state.scene === 'sendstay' && !ctx.state.appLock) ctx.armSecondHomeWait(); };
  return { ctx, tick, visibility, rerender, timers, bell: () => button, opens: () => opens };
}
test('completed fork Home: 20s lower bound, one existing bell, tap uses existing Explore entry', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.tick(19999); assert.equal(h.bell(), null); h.tick(1); assert.ok(h.bell());
  assert.equal(h.bell().id, 'secondHomeBell'); assert.match(h.bell().innerHTML, /crayon-bell.svg/);
  h.rerender(); assert.ok(h.bell()); h.ctx.click(); assert.equal(h.bell(), null); assert.equal(h.opens(), 1);
  assert.equal(h.ctx.state.secondJourney.step, 'candidates'); h.tick(100000); assert.equal(h.bell(), null);
});
test('90s upper bound and same-Home render preserves the original deadline', () => {
  const h = harness({ random: 0.999999 }); h.ctx.armSecondHomeWait(); h.tick(10000); h.rerender(); h.tick(79999); assert.equal(h.bell(), null); h.tick(1); assert.ok(h.bell());
});
test('flag off / nonfork / not completed / release closed: no timer, no invented bell; old candidate still mounts', () => {
  for (const options of [{ enabled: false }, { fork: false }, { completed: false }, { release: false }]) {
    const h = harness(options); h.ctx.armSecondHomeWait(); h.tick(200000); assert.equal(h.bell(), null); assert.equal(h.timers.size, 0);
    h.ctx.state.secondJourney.bellCandidateId = 'existing'; h.ctx.mountSecondHomeBell(); assert.ok(h.bell()); h.ctx.click(); assert.equal(h.opens(), 1);
  }
});
test('Away, Return and lock cancel; returning Home starts a new delay', () => {
  for (const mode of ['secondAway', 'secondReturn', 'locked']) {
    const h = harness(); h.ctx.armSecondHomeWait(); h.tick(15000);
    if (mode === 'locked') h.ctx.state.appLock = {}; else h.ctx.state.scene = mode;
    h.rerender(); h.tick(100000); assert.equal(h.bell(), null); assert.equal(h.timers.size, 0);
    h.ctx.state.appLock = null; h.ctx.state.scene = 'sendstay'; h.rerender(); h.tick(19999); assert.equal(h.bell(), null); h.tick(1); assert.ok(h.bell());
  }
});
test('hidden cancels/removes test bell; visible resamples; no background bell', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.tick(20000); assert.ok(h.bell());
  h.visibility('hidden'); assert.equal(h.bell(), null); h.tick(200000); assert.equal(h.bell(), null);
  h.visibility('visible'); h.tick(19999); assert.equal(h.bell(), null); h.tick(1); assert.ok(h.bell());
});
test('existing A851 bell and random timer share one element and one click', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.ctx.state.secondJourney.bellCandidateId = 'existing'; h.ctx.mountSecondHomeBell();
  const old = h.bell(); h.tick(20000); assert.equal(h.bell(), old); h.ctx.click(); assert.equal(h.opens(), 1); assert.equal(h.bell(), null);
});
test('identity changes discard a stale timer, no automatic execution or selection APIs', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.ctx.state.address = 'another'; h.tick(20000); assert.equal(h.bell(), null);
  const added = section.slice(section.indexOf('// [A-1172]'));
  assert.doesNotMatch(added, /requestPrf|sendTransaction|requestGrant|selectedIds\s*=|fetch\(|localStorage/);
  assert.match(source, /function render\(\) \{\n  if \(import.meta.env.VITE_ARASO_TEST_REPEAT_BELL === "1" && a1172BellEnabled\(\) && !a1172BellEligible\(\)\) a1172ResetBell\(\);/);
});
// Actual fork opener and existing local learning functions; UI timer itself writes nothing.
{
  const h = harness(); const storage = createMemoryStorage(), scope = { accountId: 'bell-user', chainId: 'fork' };
  let domain = createSecondJourneyState(scope);
  domain = applyExploreSelection(domain, { kind: 'one', errands: [{ id: 'grow', lane: 'Grow' }] }, { preference: { ...domain.preference, novelty: 0.2 } }, { eventId: 'selection', now: 'now' }).state;
  domain = recordSecondJourneyReceipt(domain, { eventId: 'previous-execution', outcome: 'done' }).state;
  assert.equal(saveSecondJourneyState(storage, scope, domain).saved, true);
  Object.assign(h.ctx, {
    ensureSecondJourneyDomainState: () => loadSecondJourneyState(storage, scope).state,
    applySecondDraftIfAny() {}, recomputeSecondJourneyFlow() {}, keepSecondLaneDraftIfValid() {},
    setScene: scene => { h.ctx.state.scene = scene; }, refreshSecondLaneCandidates: async () => {},
    a974AskEntry: async () => true,
  });
  const start = source.indexOf('function a974OpenForkExplore()');
  const end = source.indexOf('function a974ForkReader()', start);
  const wstart = source.indexOf('  const a974PrevOpen = openSecondJourneyExplore;');
  const wend = source.indexOf('  // post-file quiet Home:', wstart);
  vm.runInContext(source.slice(start, end) + source.slice(wstart, wend), h.ctx);
  h.ctx.armSecondHomeWait(); h.tick(20000); h.ctx.click(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.ctx.state.scene, 'explore'); assert.equal(h.ctx.state.secondJourney.step, 'candidates');
  assert.deepEqual(Array.from(h.ctx.state.secondJourney.selectedIds), ['grow']);
  const reopened = loadSecondJourneyState(storage, scope).state;
  assert.equal(reopened.preference.novelty, 0.2); assert.equal(reopened.receipts.length, 1);
  assert.match(source.slice(source.indexOf('function handleCandidatePick'), source.indexOf('function handleCandidateOk')), /persistSecondDraft\(\)[\s\S]*recordSecondPick\("pick"/);
  assert.match(source.slice(source.indexOf('function recordSecondLaneDecision'), source.indexOf('// ok on a lane candidate:')), /recordSecondJourneyDecisionReceiptDurably\(safeLocalStorage\(\), scope, decision.receipt\)/);
  pass++; console.log('PASS actual fork bell entry resumes candidates with stored interests/preference/receipt intact; existing pick and decision storage paths retained');
}
console.log(`A1172 ${pass} PASS / 0 FAIL (controlled clock, mocked DOM; no browser/auth/network)`);
