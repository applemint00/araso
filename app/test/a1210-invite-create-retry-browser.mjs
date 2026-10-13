import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();let pass=0;
await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:false,bound:false}}));
await d.context.addInitScript(()=>{
 window.authCounts={create:0,get:0};
 if(!navigator.credentials)return;
 const create=navigator.credentials.create.bind(navigator.credentials);
 navigator.credentials.create=(...args)=>{
  window.authCounts.create++;
  if(window.creationMode==='cancel'){window.creationMode='normal';return Promise.reject(new DOMException('cancelled','NotAllowedError'))}
  return create(...args).then(credential=>{
   if(window.creationMode==='fallback')Object.defineProperty(credential,'getClientExtensionResults',{value:()=>({prf:{enabled:true}})});
   return credential;
  });
 };
 navigator.credentials.get=()=>{window.authCounts.get++;return Promise.reject(new DOMException('cancelled','NotAllowedError'))};
});
try{
 await d.p.goto(d.BASE,{waitUntil:'networkidle'});
 for(const mode of ['cancel','fallback']){
  await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
  await d.p.goto('about:blank');
  await d.p.goto(d.BASE+'#invite=synthetic-invite-a1210',{waitUntil:'networkidle'});
  await d.p.evaluate(m=>window.creationMode=m,mode);
  await d.p.locator('#inviteFaceButton').click();await d.p.waitForSelector(mode==='cancel'?'#authTryAgainButton':'#checkButton');
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:0});
  if(mode==='cancel'){await d.p.locator('#authTryAgainButton').click();await d.p.locator('#inviteFaceButton').click()}
  else await d.p.locator('#checkButton').click();
  await d.p.waitForSelector(mode==='cancel'?'[data-scene="hatch"], [data-scene="name"]':'#checkButton',{timeout:20000});
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),mode==='cancel'?{create:2,get:0}:{create:1,get:1});
  pass++;console.log('PASS '+mode+' -> Make new -> next tap');
 }
 assert.deepEqual(d.errors,[]);
 console.log(`A1210 browser ${pass} PASS / 0 FAIL / 0 SKIP (local virtual authenticator)`);
}finally{await d.close()}
