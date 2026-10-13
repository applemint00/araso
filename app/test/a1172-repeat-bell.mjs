import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createMemoryStorage, createSecondJourneyState, applyExploreSelection, saveSecondJourneyState, loadSecondJourneyState, recordSecondJourneyReceipt, saveSecondJourneyDraft, loadSecondJourneyDraft, secondJourneyDraftKey } from '../src/second-journey-state.js';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('const secondBellRung ='), source.indexOf('// [A-791] A-762 routing consumed as evidence.')).replaceAll('import.meta.env', 'env');
let pass = 0;
function test(name, run) { run(); pass++; console.log(`PASS ${name}`); }
function harness({ enabled = true, fork = true, completed = true, release = true, random = 0 } = {}) {
  let now = 0, id = 0, button = null, opens = 0;
  const timers = new Map(), cleanups = [], listeners = {}, storage = createMemoryStorage();
  const stage = { querySelector: () => button, appendChild: b => { button = b; } };
  const ctx = { console, Promise, Set, Math: { random: () => random, floor: Math.floor, max: Math.max }, Date: { now: () => now },
    env: { VITE_ARASO_TEST_REPEAT_BELL: enabled ? '1' : '' }, CHAIN_PROFILE: {}, RELEASE_LEVEL: 2,
    onForkProfile: () => fork, journeyFeatureOpen: () => release, HOME_FIRST_JOURNEY_CARD_MS: 1200, homeChog: {},
    state: { secondJourneyCompletedOnce: completed, address: 'piggy', scene: 'sendstay', appLock: null, sendCardVisible: false, secondJourney: { selectedIds: ['grow'], step: 'candidates', waitingForPlace: false } },
    secondLaneMode: () => true,
    safeLocalStorage: () => storage, loadSecondJourneyDraft,
    secondJourneyScope: () => ({ accountId: ctx.state.address, chainId: "monad-fork" }),
    document: { visibilityState: 'visible', addEventListener: (type, f) => { listeners[type] = f; }, querySelector: sel => sel === '#secondHomeBell' ? button : stage,
      createElement: () => ({ setAttribute() {}, addEventListener: (_, f) => { ctx.click = f; }, remove: () => { button = null; } }) },
    setTimeout: (f, ms) => { timers.set(++id, { f, due: now + ms }); return id; }, clearTimeout: i => timers.delete(i),
    onSceneTeardown: f => cleanups.push(f), sceneListener: (_, type, f) => { listeners[type] = f; },
    openSecondJourneyExplore: () => { opens++; ctx.state.scene = 'explore'; ctx.state.secondJourney.step = 'candidates'; button = null; }, render() {},
  };
  vm.createContext(ctx); vm.runInContext(section, ctx);
  const tick = ms => { now += ms; for (const [i, t] of [...timers]) if (t.due <= now) { timers.delete(i); t.f(); } };
  const visibility = value => { ctx.document.visibilityState = value; listeners.visibilitychange(); };
  const rerender = () => { for (const f of cleanups.splice(0)) f(); button = null; ctx.a1182ObserveOpen(); if (!ctx.a1182HomeVisible()) ctx.a1172ResetBell(); if (ctx.state.scene === 'sendstay' && !ctx.state.appLock) ctx.armSecondHomeWait(); };
  return { ctx, storage, tick, visibility, rerender, timers, bell: () => button, opens: () => opens };
}
test('A1182 completed fork Home: one 1200ms beat then automatic candidates, click0', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.tick(1199); assert.equal(h.opens(), 0); h.tick(1);
  assert.equal(h.opens(), 1); assert.equal(h.ctx.click, undefined); assert.equal(h.ctx.state.secondJourney.step, 'candidates');
  h.rerender(); h.ctx.state.scene = 'sendstay'; h.rerender(); h.tick(200000); assert.equal(h.opens(), 1);
});
test('same Home rerender preserves due time; no random scheduler', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.tick(500); h.rerender(); h.tick(699); assert.equal(h.opens(), 0); h.tick(1); assert.equal(h.opens(), 1);
  assert.doesNotMatch(section, /Math.random/);
});
test('flag off / nonfork / incomplete / release closed: no stand-in; real A851 candidate auto opens', () => {
  for (const options of [{ enabled: false }, { fork: false }, { completed: false }, { release: false }]) {
    const h = harness(options); h.ctx.armSecondHomeWait(); h.tick(200000); assert.equal(h.opens(), 0);
    h.ctx.state.secondJourney.bellCandidateId = 'existing'; h.ctx.a1172ArmBell(); h.tick(1); assert.equal(h.opens(), 1); assert.equal(h.ctx.click, undefined);
  }
});
test('Away/Return/lock/Send suppress pending notification; next foreground permits one', () => {
  for (const mode of ['secondAway', 'secondReturn', 'locked', 'send']) {
    const h = harness(); h.ctx.armSecondHomeWait(); h.tick(500);
    if (mode === 'locked') h.ctx.state.appLock = {}; else if(mode === 'send') h.ctx.state.sendCardVisible = true; else h.ctx.state.scene = mode;
    h.rerender(); h.tick(20000); assert.equal(h.opens(), 0);
    h.ctx.state.appLock = null; h.ctx.state.sendCardVisible = false; h.ctx.state.scene = 'sendstay'; h.rerender(); h.tick(20000); assert.equal(h.opens(), 0);
    h.visibility('hidden'); h.visibility('visible'); h.tick(1200); assert.equal(h.opens(), 1);
  }
});
test('foreground observed even outside Home; hidden0 and duplicate visible events do not rearm', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.visibility('hidden'); h.tick(20000); assert.equal(h.opens(), 0);
  h.ctx.state.scene = 'secondAway'; h.rerender(); h.visibility('visible'); h.tick(20000); assert.equal(h.opens(), 0);
  h.ctx.state.scene = 'sendstay'; h.rerender(); h.tick(1200); assert.equal(h.opens(), 1);
  h.ctx.state.scene = 'sendstay'; h.rerender(); h.visibility('visible'); h.tick(20000); assert.equal(h.opens(), 1);
});
test('A851 and stand-in overlap: one automatic open, no selection/financial APIs', () => {
  const h = harness(); h.ctx.state.secondJourney.bellCandidateId = 'existing'; h.ctx.armSecondHomeWait(); h.ctx.a1172ArmBell(); h.tick(1200);
  assert.equal(h.opens(), 1); h.ctx.mountSecondHomeBell(); assert.equal(h.opens(), 1);
  const added = section.slice(section.indexOf('function mountSecondHomeBell'));
  assert.doesNotMatch(added, /requestPrf|sendTransaction|requestGrant|selectedIds\s*=|fetch\(/);
  assert.doesNotMatch(added, /addEventListener\("click"/);
});
test('changed identity invalidates late timer', () => {
  const h = harness(); h.ctx.armSecondHomeWait(); h.ctx.state.address = 'another'; h.tick(20000); assert.equal(h.opens(), 0);
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
  h.ctx.armSecondHomeWait(); h.tick(1200); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.ctx.state.scene, 'explore'); assert.equal(h.ctx.state.secondJourney.step, 'candidates');
  assert.deepEqual(Array.from(h.ctx.state.secondJourney.selectedIds), ['grow']);
  const reopened = loadSecondJourneyState(storage, scope).state;
  assert.equal(reopened.preference.novelty, 0.2); assert.equal(reopened.receipts.length, 1);
  assert.match(source.slice(source.indexOf('function handleCandidatePick'), source.indexOf('function handleCandidateOk')), /persistSecondDraft\(\)[\s\S]*recordSecondPick\("pick"/);
  assert.match(source.slice(source.indexOf('function recordSecondLaneDecision'), source.indexOf('// ok on a lane candidate:')), /recordSecondJourneyDecisionReceiptDurably\(safeLocalStorage\(\), scope, decision.receipt\)/);
  pass++; console.log('PASS actual fork bell entry resumes candidates with stored interests/preference/receipt intact; existing pick and decision storage paths retained');
}
// Answer (1): use the REAL persisted draft reader and REAL restore function.
for (const step of ['interests', 'candidates', 'readiness']) {
  const h = harness({ completed: false }), scope = h.ctx.secondJourneyScope();
  const draft = { step, seedStage: 'done', selectedIds: ['grow'], pickedCandidateId: 'job', chosenDestinationId: 'job', amount: '2' };
  assert.equal(saveSecondJourneyDraft(h.storage, scope, draft).saved, true);
  Object.assign(h.ctx, {
    ensureSecondJourneyDomainState: () => ({ interests: [] }), inferSeedStage: () => 'a',
    computeExploreDisplayErrands: () => [{ id: 'grow' }], buildVisibleLaneChoices: () => [{ id: 'grow' }],
    recomputeSecondJourneyFlow() {}, keepSecondLaneDraftIfValid() {},
    setScene: scene => { h.ctx.state.scene = scene; }, refreshSecondLaneCandidates: async () => {}, a974AskEntry: async () => true,
  });
  const restoreStart = source.indexOf('function applySecondDraftIfAny(');
  const restoreEnd = source.indexOf('// [A-405]', restoreStart);
  const openStart = source.indexOf('function a974OpenForkExplore()');
  const openEnd = source.indexOf('function a974ForkReader()', openStart);
  const wrapStart = source.indexOf('  const a974PrevOpen = openSecondJourneyExplore;');
  const wrapEnd = source.indexOf('  // post-file quiet Home:', wrapStart);
  vm.runInContext((source.slice(restoreStart, restoreEnd) + source.slice(openStart, openEnd) + source.slice(wrapStart, wrapEnd)).replaceAll('import.meta.env', 'env'), h.ctx);
  h.ctx.armSecondHomeWait(); h.tick(1199); assert.equal(h.bell(), null); h.tick(1); assert.ok(h.bell());
  assert.equal(h.ctx.click, undefined); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.ctx.state.scene, 'explore'); assert.equal(h.ctx.state.secondJourney.step, step);
  assert.deepEqual(Array.from(h.ctx.state.secondJourney.selectedIds), ['grow']);
  assert.equal(h.ctx.state.secondJourney.chosenDestinationId, 'job'); assert.equal(h.ctx.state.secondJourney.amount, '2');
  pass++; console.log(`PASS unfinished persisted draft: bell auto -> existing fork opener -> real restore ${step}/selection/amount`);
}
test('draft eligibility refuses other account/chain, malformed storage and missing storage', () => {
  for (const mode of ['account', 'chain', 'corrupt', 'missing']) {
    const h = harness({ completed: false }), scope = h.ctx.secondJourneyScope();
    const savedScope = { ...scope, ...(mode === 'account' ? { accountId: 'other' } : mode === 'chain' ? { chainId: 'other' } : {}) };
    if (mode === 'corrupt') h.storage.setItem(secondJourneyDraftKey(scope), '{broken');
    else if (mode !== 'missing') saveSecondJourneyDraft(h.storage, savedScope, { step: 'candidates', selectedIds: ['grow'] });
    else h.ctx.safeLocalStorage = () => null;
    h.ctx.armSecondHomeWait(); h.tick(100000); assert.equal(h.bell(), null); assert.equal(h.timers.size, 0);
  }
});
for (const mode of ['hidden', 'reopened', 'locked', 'refused']) {
  const h = harness(); let resolve;
  Object.assign(h.ctx, {
    a974AskEntry: () => new Promise(r => { resolve = r; }),
    a974OpenForkExplore: () => { h.ctx.state.scene = 'explore'; },
    openSecondJourneyExplore: () => {}, // previous entry refuses without entry evidence
  });
  const start = source.indexOf('  const a974PrevOpen = openSecondJourneyExplore;');
  vm.runInContext(source.slice(start, source.indexOf('  // post-file quiet Home:', start)), h.ctx);
  h.ctx.armSecondHomeWait(); h.tick(1200);
  if (mode === 'hidden' || mode === 'reopened') h.visibility('hidden');
  if (mode === 'reopened') h.visibility('visible');
  if (mode === 'locked') h.ctx.state.appLock = {};
  resolve(mode !== 'refused'); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.ctx.state.scene, 'sendstay');
  pass++; console.log(`PASS asynchronous bell entry ${mode}: stale/refused server answer opens nothing`);
}
console.log(`A1172 ${pass} PASS / 0 FAIL (controlled clock, mocked DOM; no browser/auth/network)`);
