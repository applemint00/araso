import { launch, harnessPresent, sleep } from './helpers/a803-browser.mjs';
import { FORK_ENTRY_HEADER } from '../src/fork-entry-client.js';
import { fakeJ1Chain } from './helpers/fake-j1-chain.mjs';
// A Piggy that finished Journey 1 but never entered Journey 2, opened on a device without its receipts: the server says "not entered",
// so the app finds the Journey 1 deposit/redeem on chain itself and sends them to the existing entry (challenge → sign → enter).
// The server check is unchanged: the enter carries exactly the chain's hashes. A Piggy with nothing on chain stays on the quiet Home.
if (!harnessPresent()) { console.log('SKIP browser harness unavailable'); process.exit(0); }
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) { pass++; console.log(`PASS  ${msg}`); } else { fail++; console.log(`FAIL  ${msg}`); } };
const FORK_ID = 'a950-local';

async function run(onChain) {
  const d = await launch({ forkMode: true });
  const calls = []; let enterBody = null; let chain = null;
  await d.context.route('**/api/fork-entry', async (r) => {
    const body = r.request().postDataJSON() || {};
    calls.push(body.action);
    if (body.action === 'public_state') return r.fulfill({ json: { ok: true, publicEntry: true } });
    if (body.action === 'status') return r.fulfill({ json: { ok: true, allowed: false, reason: 'not_entered' } });
    if (body.action === 'challenge') {
      const nonce = 'c0'.repeat(16), expiresAt = Date.now() + 60_000;
      const message = [FORK_ENTRY_HEADER, `uri: ${new URL(d.BASE).origin}`, 'chainId: 31337143', `piggy: ${body.piggyAddress}`, 'tester: public-test', `fork: ${FORK_ID}`, `nonce: ${nonce}`, `expires: ${new Date(expiresAt).toISOString()}`].join('\n');
      return r.fulfill({ json: { ok: true, nonce, message, expiresAt } });
    }
    if (body.action === 'enter') { enterBody = body; return r.fulfill({ json: { ok: true, allowed: true, forkInstanceId: FORK_ID } }); }
    return r.fulfill({ status: 400, json: { ok: false, reason: 'unknown' } });
  });
  await d.context.route('https://testnet-rpc.monad.xyz/**', async (r) => {
    const req = r.request().postDataJSON() || {};
    if (!chain) return r.fulfill({ json: { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'not ready' } } });
    try { return r.fulfill({ json: { jsonrpc: '2.0', id: req.id, result: await chain.rpc(req.method, req.params) } }); }
    catch (e) { return r.fulfill({ json: { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: String(e.message) } } }); }
  });
  try {
    await d.p.setViewportSize({ width: 390, height: 844 });
    await d.p.goto(d.BASE, { waitUntil: 'networkidle' });
    await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('araso.journey.v1', '1'); });
    await d.seedSolo('Recovered');
    const me = await d.p.evaluate(() => localStorage.getItem('araso.address'));
    chain = fakeJ1Chain({ piggy: me, txs: onChain ? [{ block: 3_200_000, kind: 'deposit' }, { block: 3_200_700, kind: 'redeem' }] : [] });
    await d.p.evaluate(() => {
      localStorage.setItem('araso.journey.v1', '1');
      localStorage.setItem('araso.tripClosed', '1');
      for (const k of ['araso.receipts', 'araso.txHash']) localStorage.removeItem(k);
    });
    calls.length = 0;
    await d.p.reload({ waitUntil: 'domcontentloaded' });
    await sleep(800);
    await d.unlock();
    let journey = null;
    for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
      journey = await d.p.evaluate(() => localStorage.getItem('araso.journey.v1')).catch(() => journey);
      if (journey === '2') break;
    }
    const scene = await d.p.evaluate(() => document.querySelector('[data-scene]')?.dataset.scene).catch(() => null);
    return { journey, scene, calls: [...calls], enterBody, rows: chain.rows, rpcCalls: chain.calls.length, errors: d.errors };
  } finally { await d.close(); }
}

const yes = await run(true);
check(yes.calls.filter((a) => a === 'enter').length === 1, `first-time Piggy, no receipts, Journey 1 on chain → one enter (${yes.calls.join(',')})`);
const j1 = yes.enterBody?.journey1 || {};
check(j1.depositTxHash === yes.rows[0]?.hash && j1.redeemTxHash === yes.rows[1]?.hash, `enter carries the chain's deposit/redeem hashes (${String(j1.depositTxHash).slice(0, 10)} · ${String(j1.redeemTxHash).slice(0, 10)})`);
check(yes.journey === '2', `allowed → Journey 2 (journey=${yes.journey})`);
check(yes.rpcCalls <= 60, `testnet reads within 60 (${yes.rpcCalls})`);
const no = await run(false);
check(!no.calls.includes('enter') && no.journey === '1' && no.scene === 'sendstay', `nothing on chain → no enter, quiet Home stays (journey=${no.journey} scene=${no.scene} ${no.calls.join(',')})`);
check(yes.errors.length === 0 && no.errors.length === 0, `no page errors (${JSON.stringify([...yes.errors, ...no.errors]).slice(0, 160)})`);
console.log(`A1363 first entry from chain browser: ${pass} PASS / ${fail} FAIL (local virtual-auth, fake fork, fake testnet)`);
process.exit(fail ? 1 : 0);
