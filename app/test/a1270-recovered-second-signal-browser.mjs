import { launch, harnessPresent, sleep } from './helpers/a803-browser.mjs';
// A recovered device: the Piggy is found and Journey 1 is marked done, but this device holds no Journey 1 receipts.
// It cannot send the server the Journey 1 hashes, so it must not stall on the quiet Home: when the server already
// admitted this Piggy (status → allowed), the app moves to Journey 2 without asking it to enter again.
if (!harnessPresent()) { console.log('SKIP browser harness unavailable'); process.exit(0); }
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) { pass++; console.log(`PASS  ${msg}`); } else { fail++; console.log(`FAIL  ${msg}`); } };

async function run(allowed) {
  const d = await launch({ forkMode: true });
  const calls = [];
  await d.context.route('**/api/fork-entry', async (r) => {
    const body = r.request().postDataJSON() || {};
    calls.push(body.action);
    if (body.action === 'public_state') return r.fulfill({ json: { ok: true, publicEntry: true } });
    if (body.action === 'status') return r.fulfill({ json: { ok: true, allowed, forkInstanceId: body.forkInstanceId } });
    return r.fulfill({ status: 409, json: { ok: false, reason: 'journey1_missing' } });
  });
  try {
    await d.p.setViewportSize({ width: 390, height: 844 });
    await d.p.goto(d.BASE, { waitUntil: 'networkidle' });
    await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('araso.journey.v1', '1'); });
    await d.seedSolo('Recovered');
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
    for (let t0 = Date.now(); Date.now() - t0 < 20000; await sleep(300)) {
      journey = await d.p.evaluate(() => localStorage.getItem('araso.journey.v1')).catch(() => journey);
      if (journey === '2') break;
    }
    return { journey, calls: [...calls], errors: d.errors };
  } finally { await d.close(); }
}

const yes = await run(true);
check(yes.journey === '2', `recovered device, no receipts, server status allowed → Journey 2 (journey=${yes.journey})`);
check(yes.calls.includes('status') && !yes.calls.includes('enter') && !yes.calls.includes('challenge'), `asks status only, never enter (${yes.calls.join(',')})`);
const no = await run(false);
check(no.journey === '1', `status not allowed → stays on Journey 1 (journey=${no.journey})`);
check(!no.calls.includes('enter'), `no enter without Journey 1 hashes (${no.calls.join(',')})`);
check(yes.errors.length === 0 && no.errors.length === 0, `no page errors (${JSON.stringify([...yes.errors, ...no.errors]).slice(0, 160)})`);
console.log(`A1270 recovered browser: ${pass} PASS / ${fail} FAIL (local virtual-auth, fake fork)`);
process.exit(fail ? 1 : 0);
