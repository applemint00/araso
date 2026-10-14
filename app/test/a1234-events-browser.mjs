// Browser suite: helper starts Vite with "--strictPort" on a free local port.
import assert from 'node:assert/strict';
import { launch, harnessPresent } from './helpers/a803-browser.mjs';
import { validEvent } from '../src/event-schema.js';
if (!harnessPresent()) { console.log('SKIP browser harness unavailable'); process.exit(0); }
const d = await launch(); let open = true, bound = false;
try {
  await d.context.route('**/api/fork-entry', r => r.fulfill({ json: r.request().postDataJSON()?.action === 'public_state' ? {ok:true,publicEntry:open} : {ok:true,bound} }));
  await d.context.addInitScript(() => {
    window.events = [];
    navigator.sendBeacon = (url, body) => { body.text().then(s => window.events.push({url, body:JSON.parse(s)})); return false; };
    if (navigator.credentials) for (const key of ['create','get']) navigator.credentials[key] = () => Promise.reject(new DOMException('cancelled','NotAllowedError'));
  });
  async function visit(invite = false) {
    await d.p.goto(d.BASE, {waitUntil:'domcontentloaded'});
    await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await d.p.goto('about:blank');
    await d.p.goto(d.BASE+(invite?'?i=TEST#invite=synthetic-invite-a1234':''),{waitUntil:'domcontentloaded'});
  }
  async function event(step, code) { await d.p.waitForFunction(([s,c]) => window.events.some(e=>e.body.step===s&&e.body.code===c),[step,code]); }
  await visit(); await d.p.locator('#inviteFaceButton').waitFor(); await event('entry_shown','public');
  await d.p.locator('.testerIntro').waitFor({state:'detached'});
  assert.equal(await d.p.locator('.trialStamp--invite').innerText(),'trial phase · free');
  await d.p.locator('#inviteFaceButton').click(); await d.p.locator('#authTryAgainButton').waitFor(); await event('passkey_create','cancel');
  assert.equal(await d.p.locator('#authTryAgainButton').isVisible(),true); // beacon false did not change auth/UI
  await d.p.evaluate(()=>{window.dispatchEvent(new ErrorEvent('error',{error:new TypeError('private payload')}));window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:'private rejection'}));});
  await event('js_error','type'); await event('js_error','rejection');
  const records=await d.p.evaluate(()=>window.events);assert.ok(records.every(e=>e.url==='/api/event'&&validEvent(e.body)));assert.ok(!JSON.stringify(records).includes('private'));
  open=false;bound=true;await visit(true);await d.p.locator('.inviteOnly').waitFor();await event('entry_shown','used');await event('entry_blocked','used');
  bound=false;await visit(true);await d.p.locator('#inviteFaceButton').waitFor();await event('entry_shown','invite');
  await visit(false);await d.p.locator('.inviteOnly').waitFor();await event('entry_blocked','invite_only');
  console.log('A1234 browser 4 entry routes / cancel / error privacy / beacon failure UI PASS; mock auth only, tx0');
} finally { await d.close(); }
