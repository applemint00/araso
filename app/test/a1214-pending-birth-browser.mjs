import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();
await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:false,bound:false}}));
await d.context.addInitScript(()=>{
 window.authCounts={create:0,get:0};
 if(!navigator.credentials)return;
 const create=navigator.credentials.create.bind(navigator.credentials),get=navigator.credentials.get.bind(navigator.credentials);
 navigator.credentials.create=options=>{window.authCounts.create++;return create(options).then(c=>{Object.defineProperty(c,'getClientExtensionResults',{value:()=>({prf:{enabled:true}})});return c})};
 navigator.credentials.get=options=>{window.authCounts.get++;if(window.cancelNextGet){window.cancelNextGet=false;return Promise.reject(new DOMException('cancelled','NotAllowedError'))}window.getGesture=navigator.userActivation.isActive;return get(options)};
});
try {
 await d.p.goto(d.BASE,{waitUntil:'networkidle'});
 await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
 await d.p.goto('about:blank');await d.p.goto(d.BASE+'#invite=synthetic-invite-a1214',{waitUntil:'networkidle'});
 await d.p.locator('#inviteFaceButton').click();
 await d.p.waitForSelector('#checkButton');
 assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:0});
 assert.equal(await d.p.evaluate(()=>localStorage.getItem('araso.passkey')),null);
 assert.ok(await d.p.evaluate(()=>sessionStorage.getItem('araso.pendingBirth.v1')));
 await d.p.reload({waitUntil:'networkidle'});
 if(process.env.A1220_CANCEL==='1'){
  await d.p.evaluate(()=>window.cancelNextGet=true);
  await d.p.locator('#inviteFaceButton').click();
  await d.p.locator('#checkButton').waitFor({state:'visible'});
  assert.equal(await d.p.locator('#authTryAgainButton').count(),0);
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:0,get:1});
  await d.p.evaluate(()=>window.authCounts={create:0,get:0});
  await d.p.locator('#checkButton').click();
 }else await d.p.locator('#inviteFaceButton').click();
 await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});
 assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:0,get:1});
 assert.equal(await d.p.evaluate(()=>window.getGesture),true);
 assert.equal(await d.p.evaluate(()=>sessionStorage.getItem('araso.pendingBirth.v1')),null);
 const rows=await d.p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('araso.myPiggiesIndex.v1.')).flatMap(k=>JSON.parse(localStorage.getItem(k)).piggies));
 assert.ok(rows.some(r=>r.provenance==='birth'));
 assert.deepEqual(d.errors,[]);
 if(process.env.A1220_CANCEL==='1')console.log('A1220 cancellation: no Make new button; next tap create0/get1 PASS');
 console.log('A1214 browser 1 PASS / 0 FAIL / 0 SKIP: deferred create -> reload -> one pinned get -> Hatch + born; local virtual authenticator, no live auth/tx');
} catch(error) {
 console.log('diagnostic',await d.p.evaluate(()=>({counts:window.authCounts,scene:document.querySelector('[data-scene]')?.dataset.scene,buttons:Array.from(document.querySelectorAll('button')).map(b=>b.id),error:JSON.parse(localStorage.getItem('araso.lastSendError')||'null')})));
 throw error;
} finally {await d.close()}
