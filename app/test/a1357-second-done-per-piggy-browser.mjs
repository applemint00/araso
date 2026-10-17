import assert from 'node:assert/strict';
import { launch, harnessPresent } from './helpers/a803-browser.mjs';
import { FORK_SCOPE, forkKey } from './helpers/fork-mode.mjs';
// [A-1357] "Journey 2 done" belongs to one Piggy. Same browser: an earlier Piggy finished Journey 2 (old per-chain flag "1" + its own
// Journey 2 record) → a new Piggy still gets the Journey 2 intro → Explore; the old flag moves once to the Piggy that owns it and stays stored.
// A lone Piggy with only the old flag (no Journey 2 record anywhere) keeps "done" (it can only be this Piggy's).
if (!harnessPresent()) { console.log('SKIP browser harness unavailable'); process.exit(0); }
const OLD = '0x' + 'ab'.repeat(20);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) { pass++; console.log(`PASS  ${msg}`); } else { fail++; console.log(`FAIL  ${msg}`); } };

async function run(label, seed) {
  const d = await launch({ forkMode: true });
  // the fork boot asks the server before arming Journey 2 (a974AskEntry → "status"); the harness has no fork-entry server, so answer it here
  await d.context.route('**/api/fork-entry', async (r) => {
    const body = r.request().postDataJSON() || {};
    if (body.action === 'public_state') return r.fulfill({ json: { ok: true, publicEntry: true } });
    if (body.action === 'status') return r.fulfill({ json: { ok: true, allowed: true, forkInstanceId: body.forkInstanceId } });
    return r.fallback();
  });
  try {
    await d.p.setViewportSize({ width: 390, height: 844 });
    await d.seedSolo('NewPiggy');
    const me = await d.p.evaluate(() => localStorage.getItem('araso.address'));
    await d.p.evaluate(({ seed, closed, scope, OLD }) => {
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k.startsWith('araso.secondIntroSeen') || k.startsWith('araso.secondJourneyClosed')) localStorage.removeItem(k); }
      localStorage.setItem(closed, '1'); // the old per-chain flag (written by an earlier Piggy, or this one before A-1357)
      if (seed === 'other-piggy-done') localStorage.setItem(`araso.secondJourney.${scope}.${OLD}`, JSON.stringify({ version: 1, chainId: scope, accountId: OLD }));
      sessionStorage.setItem('araso.journeySwitchUnlock.v1', String(Date.now()));
    }, { seed, closed: forkKey('araso.secondJourneyClosed'), scope: FORK_SCOPE, OLD });
    await d.p.reload({ waitUntil: 'domcontentloaded' });
    let explore = false;
    try { await d.p.waitForSelector('[data-scene="explore"]', { timeout: seed === 'lone-piggy' ? 20000 : 30000 }); explore = true; } catch { explore = false; }
    const scene = await d.p.evaluate(() => document.querySelector('[data-scene]')?.dataset.scene || null);
    const keys = await d.p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('araso.secondJourneyClosed')).map((k) => [k, localStorage.getItem(k)])));
    const lc = (s) => String(s || '').toLowerCase();
    const mine = Object.entries(keys).find(([k]) => k.endsWith('.' + lc(me)))?.[1] ?? null;
    const old = Object.entries(keys).find(([k]) => k.endsWith('.' + OLD))?.[1] ?? null;
    return { explore, scene, keys, mine, old, legacy: keys[forkKey('araso.secondJourneyClosed')] ?? null, errors: d.errors };
  } finally { await d.close(); }
}

const a = await run('a', 'other-piggy-done');
check(a.explore === true, `new Piggy after another Piggy's Journey 2: intro → Explore (explore=${a.explore} scene=${a.scene})`);
check(a.old === '1' && a.mine !== '1', `old flag moved to the Piggy that owns it only (old=${a.old} mine=${a.mine})`);
check(a.legacy === '1', `old per-chain flag kept, not deleted (${a.legacy})`);
const b = await run('b', 'lone-piggy');
check(b.explore === false && b.mine === '1', `lone Piggy with only the old flag stays done (explore=${b.explore} mine=${b.mine})`);
check(a.errors.length === 0 && b.errors.length === 0, `no page errors (${JSON.stringify([...a.errors, ...b.errors]).slice(0, 160)})`);
console.log(`A1357 browser: ${pass} PASS / ${fail} FAIL (local virtual-auth, fake fork)`);
process.exit(fail ? 1 : 0);
