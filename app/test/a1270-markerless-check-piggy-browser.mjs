import assert from 'node:assert/strict';
import { launch, harnessPresent } from './helpers/a803-browser.mjs';
// A device with no Piggy marker (a private tab, a recovered phone) can still hold a Piggy on its passkey.
// After a cancelled create its failure card offers "Check Piggy" (find only) beside "Make new";
// Check Piggy asks get once and never creates, and a failed find still creates nothing.
if (!harnessPresent()) { console.log('SKIP browser harness unavailable'); process.exit(0); }
const d = await launch();
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) { pass++; console.log(`PASS  ${msg}`); } else { fail++; console.log(`FAIL  ${msg}`); } };
await d.context.route('**/api/fork-entry', (r) => r.fulfill({ json: { ok: true, publicEntry: false, bound: false } }));
await d.context.addInitScript(() => {
  window.authCounts = { create: 0, get: 0 };
  if (!navigator.credentials) return;
  navigator.credentials.create = () => { window.authCounts.create++; return Promise.reject(new DOMException('cancelled', 'NotAllowedError')); };
  navigator.credentials.get = () => { window.authCounts.get++; return Promise.reject(new DOMException('cancelled', 'NotAllowedError')); };
});
const btns = () => d.p.evaluate(() => [...document.querySelectorAll('.authCard__actions button')].map((b) => `${b.id}:${b.textContent.trim()}`));
try {
  await d.p.goto(d.BASE, { waitUntil: 'networkidle' });
  await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await d.p.goto('about:blank');
  await d.p.goto(d.BASE + '#invite=synthetic-invite-markerless', { waitUntil: 'networkidle' });
  await d.p.locator('#inviteFaceButton').click();
  await d.p.waitForSelector('#authTryAgainButton', { timeout: 20000 });
  const card = await btns();
  check(JSON.stringify(card) === JSON.stringify(['checkButton:Check Piggy', 'authTryAgainButton:Make new']), `no marker + create cancelled → card shows Check Piggy and Make new (${JSON.stringify(card)})`);
  const before = await d.p.evaluate(() => ({ ...window.authCounts }));
  if (await d.p.locator('#checkButton').count()) {
    await d.p.locator('#checkButton').click();
    await d.p.waitForFunction((g) => window.authCounts.get > g, before.get, { timeout: 20000 }).catch(() => {});
    await d.p.waitForSelector('#checkButton, #authTryAgainButton', { timeout: 20000 });
    const after = await d.p.evaluate(() => ({ ...window.authCounts }));
    check(after.get === before.get + 1 && after.create === before.create, `Check Piggy only looks: get +1, create +0 (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
    const scene = await d.p.evaluate(() => document.querySelector('[data-scene]')?.dataset.scene);
    check(scene === 'birth' && (await d.p.evaluate(() => window.authCounts.create)) === before.create, `find failed → back on the card, nothing created (scene=${scene})`);
  } else check(false, 'Check Piggy missing — cannot tap it');
  check(d.errors.length === 0, `no page errors (${JSON.stringify(d.errors).slice(0, 160)})`);
} finally { await d.close(); }
console.log(`A1270 markerless browser: ${pass} PASS / ${fail} FAIL (local virtual-auth)`);
process.exit(fail ? 1 : 0);
