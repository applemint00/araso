// [A-1305 ⑥ · Owner 10:0x (가)] "Major change coming." gate. public_state says hold:true and this device has no pass mark →
// everyone (a Piggy on the device too) sees the invite-only picture with that one line; no Face ID ask, no Home.
// A device that opened `#hold-pass=<token>` (server hold_pass ok) keeps a boolean mark and goes the usual way; hold off = unchanged.
import assert from 'node:assert/strict';
import {launch,harnessPresent,sleep} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const GOOD='A1305-test-pass-token-0123456789abcdefghijkl'; // 43 chars, base64url alphabet (test only)
const d=await launch();let hold=false,pass=0,fail=0;const passCalls=[];
await d.context.route('**/api/fork-entry',async r=>{
 const b=r.request().postDataJSON()||{};
 if(b.action==='public_state')return r.fulfill({json:{ok:true,publicEntry:true,...(hold?{hold:true}:{})}});
 if(b.action==='hold_pass'){passCalls.push(b.token);return r.fulfill({json:{ok:b.token===GOOD}})}
 return r.fallback();
});
await d.context.addInitScript(()=>{
 window.a1305={gets:0,events:[]};
 const beacon=navigator.sendBeacon?.bind(navigator);
 navigator.sendBeacon=(url,body)=>{if(String(url).includes('/api/event')&&body?.text)body.text().then(t=>window.a1305.events.push(JSON.parse(t)));return beacon?beacon(url,body):true};
 if(navigator.credentials){const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=(o)=>{window.a1305.gets++;return get(o)}}
});
const shots=process.env.A1305_SHOTS;
const check=async(name,fn)=>{try{await fn();pass++;console.log('PASS',name)}catch(e){fail++;console.log('FAIL',name,'—',String(e.message).split('\n')[0])}};
const reopen=async(hash='')=>{await d.p.goto('about:blank');await d.p.goto(d.BASE+hash,{waitUntil:'domcontentloaded'})};
const gateText=()=>d.p.evaluate(()=>document.querySelector('.inviteOnly')?.innerText.trim()??null);
try{
 await d.p.setViewportSize({width:390,height:844});
 hold=false;await d.seedSolo('Holdy');
 assert.equal(await d.scene(),'sendstay','seed reached Home');
 await check('hold ON · Piggy on the device · no mark → "Major change coming." only · no Face ID · no Home',async()=>{
  hold=true;await reopen();await sleep(3500);
  const s=await d.p.evaluate(()=>({scene:document.querySelector('[data-scene]')?.dataset.scene??null,gets:window.a1305.gets,events:window.a1305.events.map(e=>e.step+':'+e.code)}));
  if(shots)await d.p.screenshot({path:shots+'/hold-gate-390.png'});
  assert.equal(await gateText(),'Major change coming.',`gate text · scene ${s.scene}`);
  assert.equal(s.gets,0,'Face ID asks');
  assert.ok(s.events.includes('entry_blocked:hold'),`events ${JSON.stringify(s.events)}`);
  assert.equal(await d.p.locator('#homePaper, #inviteFaceButton, #loginChogButton').count(),0,'no Home / Face ID surface');
 });
 await check('hold ON · wrong #hold-pass → gate stays · no mark · hash gone',async()=>{
  await reopen('#hold-pass=wrong-token-wrong-token-wrong-token-wrong-t');await sleep(3500);
  assert.equal(await gateText(),'Major change coming.');
  assert.equal(await d.p.evaluate(()=>location.hash),'');
  assert.equal(await d.p.evaluate(()=>localStorage.getItem('araso.holdPass.v1')),null);
 });
 await check('hold ON · good #hold-pass → mark (boolean, no token stored) · hash gone · usual way (lock → Home)',async()=>{
  await reopen('#'+'hold-pass='+GOOD);await sleep(3000);
  assert.equal(await d.p.evaluate(()=>location.hash),'');
  assert.equal(await d.p.evaluate(()=>localStorage.getItem('araso.holdPass.v1')),'1');
  assert.equal(await d.p.evaluate(t=>Object.keys(localStorage).some(k=>String(localStorage.getItem(k)).includes(t)),GOOD),false,'token not in storage');
  assert.equal(await d.p.locator('.inviteOnly').count(),0);
  await d.unlock();assert.equal(await d.waitScene(['sendstay'],15000),'sendstay');
 });
 await check('hold ON · marked device reopens → usual way',async()=>{
  await reopen();await sleep(2500);assert.equal(await d.p.locator('.inviteOnly').count(),0);
  await d.unlock();assert.equal(await d.waitScene(['sendstay'],15000),'sendstay');
  if(shots)await d.p.screenshot({path:shots+'/hold-marked-home-390.png'});
 });
 await check('hold OFF · unmarked device → unchanged (lock → Home)',async()=>{
  hold=false;await d.p.evaluate(()=>localStorage.removeItem('araso.holdPass.v1'));await reopen();await sleep(2500);
  assert.equal(await d.p.locator('.inviteOnly').count(),0);
  await d.unlock();assert.equal(await d.waitScene(['sendstay'],15000),'sendstay');
 });
 await check('hold ON · new visitor (no Piggy) → gate too',async()=>{
  hold=true;await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});await reopen();await sleep(3000);
  assert.equal(await gateText(),'Major change coming.');
 });
 await check('no page errors',()=>assert.deepEqual(d.errors,[]));
}finally{await d.close()}
console.log(`A1305 hold ${pass} PASS / ${fail} FAIL / 0 SKIP (local isolated, mocked public_state/hold_pass)`);
if(fail)process.exit(1);
