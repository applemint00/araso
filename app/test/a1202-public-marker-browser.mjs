import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
process.env.VITE_ARASO_RELEASE_LEVEL='2';
const d=await launch();let pass=0;
await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:true}}));
await d.context.addInitScript(()=>{
 window.authCounts={create:0,get:0};
 const create=navigator.credentials.create.bind(navigator.credentials);
 navigator.credentials.create=(...args)=>{
  window.authCounts.create++;
  if(window.creationMode==='pending')return new Promise(()=>{});
  return create(...args).then(credential=>{
   if(window.creationMode==='fallback')Object.defineProperty(credential,'getClientExtensionResults',{value:()=>({prf:{enabled:true}})});
   return credential;
  });
 };
 navigator.credentials.get=()=>{window.authCounts.get++;return Promise.reject(new DOMException('cancelled','NotAllowedError'))};
});
try {
 for(const mode of ['fallback','pending']){
  await d.p.goto(d.BASE,{waitUntil:'networkidle'});
  await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
  await d.p.reload({waitUntil:'networkidle'});
  await d.p.evaluate(m=>{window.creationMode=m},mode);
  await d.p.locator('#inviteFaceButton').click();
  await d.p.waitForFunction(()=>window.authCounts.create===1);
  if(mode==='fallback'){
   await d.p.waitForSelector('#authTryAgainButton');
   assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:1});
  }
  assert.equal(await d.p.evaluate(()=>sessionStorage.getItem('araso.publicCreateAttempt.v1')),'attempted');
  await d.p.reload({waitUntil:'networkidle'});
  await d.p.locator('#inviteFaceButton').click();await d.p.waitForSelector('#authTryAgainButton');
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:0,get:1},mode+' reload finds first');
  await d.p.locator('#authTryAgainButton').click();await d.p.locator('#inviteFaceButton').click();
  await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:1},mode+' explicit retry not trapped');
  pass++;console.log('PASS '+mode+' -> reload find -> explicit retry create');
 }
 assert.deepEqual(d.errors,[]);
 console.log(`A1202 browser: ${pass} PASS / 0 FAIL / 0 SKIP (virtual authenticator)`);
} finally {await d.close()}
