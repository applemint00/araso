import assert from 'node:assert/strict';
import {keccak256} from 'viem';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
let pass=0;
for(const mode of (process.env.A1212_CASE?[process.env.A1212_CASE]:['inline','deferred','unsupported','adaptive'])){
const d=await launch();
const token='synthetic-invite-a1212',marker='araso.inviteCreateAttempt.v1.'+keccak256(new TextEncoder().encode(token));
await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:false,bound:false}}));
await d.context.addInitScript(()=>{
 window.authCounts={create:0,get:0};window.createEval=null;window.pinned=false;window.getGesture=false;
 if(!navigator.credentials)return;
 const create=navigator.credentials.create.bind(navigator.credentials),get=navigator.credentials.get.bind(navigator.credentials);
 navigator.credentials.create=(options)=>{
  window.authCounts.create++;window.createEval=!!options.publicKey.extensions.prf.eval;
  return create(options).then(c=>{
   window.createdRaw=Array.from(new Uint8Array(c.rawId));
   if(window.creationMode==='deferred'||window.creationMode==='adaptive')Object.defineProperty(c,'getClientExtensionResults',{value:()=>({prf:{enabled:true}})});
   if(window.creationMode==='unsupported')Object.defineProperty(c,'getClientExtensionResults',{value:()=>({prf:{enabled:false}})});
   return c;
  });
 };
 navigator.credentials.get=options=>{
  window.authCounts.get++;window.getGesture=navigator.userActivation.isActive;
  window.pinned=JSON.stringify(Array.from(new Uint8Array(options.publicKey.allowCredentials?.[0]?.id||[])))===JSON.stringify(window.createdRaw);
  if(window.rejectGet)return Promise.reject(new DOMException('cancelled','NotAllowedError'));
  return get(options);
 };
});
try{
 await d.p.goto(d.BASE,{waitUntil:'networkidle'});

  await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
  await d.p.goto('about:blank');await d.p.goto(d.BASE+'#invite='+token,{waitUntil:'networkidle'});
  if(mode==='adaptive'){
   await d.p.evaluate(k=>sessionStorage.setItem(k,'attempted'),marker);
   await d.p.reload({waitUntil:'networkidle'});
   await d.p.evaluate(()=>window.rejectGet=true);
   await d.p.locator('#inviteFaceButton').click();await d.p.waitForSelector('#authTryAgainButton');
   await d.p.locator('#authTryAgainButton').click();
  }
  await d.p.evaluate(m=>{window.creationMode=m;window.rejectGet=false},mode);
  await d.p.locator('#inviteFaceButton').click();
  if(mode==='inline'){
   await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});
   assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:0});
  }else{
   await d.p.waitForSelector('#checkButton',{timeout:20000});
   assert.equal(await d.p.locator('#authTryAgainButton').count(),0);
   assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:mode==='adaptive'?1:0});
   assert.equal(await d.p.evaluate(()=>localStorage.getItem('araso.passkey')),null);
   if(mode==='unsupported'){
    assert.equal(await d.p.evaluate(()=>JSON.parse(localStorage.getItem('araso.lastSendError')).phase),'prf_unavailable');
   }else{
    await d.p.locator('#checkButton').click();
    await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});
    assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:mode==='adaptive'?2:1});
    assert.equal(await d.p.evaluate(()=>window.pinned&&window.getGesture),true);
   }
  }
  assert.equal(await d.p.evaluate(()=>window.createEval),mode!=='adaptive');
  pass++;console.log('PASS '+mode);
 assert.deepEqual(d.errors,[]);

}catch(error){
 console.log('diagnostic',await d.p.evaluate(()=>({counts:window.authCounts,eval:window.createEval,scene:document.querySelector('[data-scene]')?.dataset.scene,error:JSON.parse(localStorage.getItem('araso.lastSendError')||'null'),buttons:Array.from(document.querySelectorAll('button')).map(b=>b.id)})));
 throw error;
}finally{await d.close()}

}
console.log(`A1212 browser ${pass} PASS / 0 FAIL / 0 SKIP (isolated local virtual authenticators, simulated provider results)`);
