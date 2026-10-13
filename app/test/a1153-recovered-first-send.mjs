// Local Chromium + virtual authenticator only (helper uses node_modules/.bin/vite).
// RPC responses are intercepted; no transactions.
import assert from "node:assert/strict";
import { launch, harnessPresent } from "./helpers/a803-browser.mjs";

if (!harnessPresent()) { console.log('SKIP A1153 Chromium: local browser harness unavailable'); process.exit(0); }

const d = await launch();
await d.context.addInitScript(() => {
  window.authCounts = {get:0,create:0};
  if (!navigator.credentials) return; // about:blank has no secure-origin CredentialsContainer.
  for (const method of ['get','create']) {
    const original = navigator.credentials[method].bind(navigator.credentials);
    navigator.credentials[method] = (...args) => { window.authCounts[method]++; return original(...args); };
  }
});
let nonce = "0x0", rpcBroken = false, writes = 0;
await d.context.route("https://testnet-rpc.monad.xyz/**", async route => {
  const q = route.request().postDataJSON();
  const reply = x => {
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_call'].includes(x.method)) {
      writes++; return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "unexpected RPC" } };
    }
    const result = x.method === 'eth_chainId' ? '0x279f' : x.method === 'eth_getBlockByNumber' ? { number: '0x10' } : x.method === 'eth_getTransactionCount' ? nonce : `0x${'0'.repeat(64)}`;
    return { jsonrpc: '2.0', id: x.id, ...(rpcBroken ? { error: { code: -32000, message: 'offline' } } : { result }) };
  };
  await route.fulfill({ json: Array.isArray(q) ? q.map(reply) : reply(q) });
});
let failed = 0;
try {
  await d.seedSolo("hommy", { stay: false });
  const index = await d.p.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /myPiggies/.test(k))));
  for (const [label, stale, completed, broken] of [
    ['fresh', false, false, false], ['stale-other-account', true, false, false],
    ['completed', false, true, false], ['unknown', false, false, true],
    ['missing-name', false, false, false],
  ]) {
    nonce = completed ? '0x2' : '0x0'; rpcBroken = broken;
    await d.p.goto('about:blank');
    await d.p.goto(d.BASE);
    await d.p.evaluate(({ stale, index }) => {
      localStorage.clear(); sessionStorage.clear();
      for (const [k,v] of Object.entries(index)) localStorage.setItem(k,v);
      if (stale) { localStorage.setItem('araso.tripClosed','1'); localStorage.setItem('araso.txHash', `0x${'ab'.repeat(32)}`); }
    }, { stale, index: label === 'missing-name' ? {} : index });
    await d.p.reload({ waitUntil: 'networkidle' });
    await d.p.locator('#inviteFaceButton').click();
    await d.p.waitForSelector('[data-scene="sendstay"]', { timeout: 20000 });
    await d.p.waitForTimeout(1500);
    assert.deepEqual(await d.p.evaluate(() => window.authCounts), {get:1,create:0});
    for (const phase of ['recovered', 'reloaded']) {
      if (phase === 'reloaded') { await d.p.reload({ waitUntil: 'networkidle' }); await d.p.waitForTimeout(1500); }
      const got = await d.p.evaluate(() => ({ scene: document.querySelector('[data-scene]')?.dataset.scene,
        send: !!document.querySelector('#sendCardAnchor'), name: document.querySelector('#homeName')?.textContent?.trim(),
        tripClosed: localStorage.getItem('araso.tripClosed'),
        scoped: Object.entries(localStorage).filter(([k]) => k.startsWith('araso.firstJourney.')).map(([,v])=>JSON.parse(v).verdict),
      }));
      console.log(JSON.stringify({ label, phase, profile: d.scope, legacyTestnetPath: d.scope === 'monad-testnet', ...got }));
      try { assert.equal(got.send, !completed && !broken); assert.equal(got.scene,'sendstay'); assert.equal(got.name,label === 'missing-name' ? 'Piggy' : 'hommy'); }
      catch(e) { failed++; console.log(`FAIL ${label}/${phase}: ${e.message}`); }
    }
  }
  assert.equal(writes,0); assert.deepEqual(d.errors,[]);
} finally { await d.close(); }
console.log(`A1153 Chromium: ${10-failed} PASS / ${failed} FAIL / 0 SKIP; transaction RPC ${writes}`);
if (failed) process.exitCode = 1;
