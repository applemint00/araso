import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();let mode='bound',pass=0;
await d.context.route('**/api/fork-entry',async r=>{
 const action=r.request().postDataJSON()?.action;
 if(action==='public_state'){if(mode==='public')await new Promise(resolve=>setTimeout(resolve,850));return r.fulfill({json:{ok:true,publicEntry:mode==='public'}})}
 if(mode==='offline')return r.abort();
 if(mode==='timeout'){await new Promise(resolve=>setTimeout(resolve,5500));return r.fulfill({json:{ok:true,bound:true}}).catch(()=>{})}
 await new Promise(resolve=>setTimeout(resolve,500));
 return r.fulfill({json:{ok:true,bound:mode==='bound'||mode==='public'}});
});
await d.context.addInitScript(()=>{
 window.authCounts={create:0,get:0};window.envelopeSeen=false;
 new MutationObserver(()=>{if(document.querySelector('#inviteFaceButton'))window.envelopeSeen=true}).observe(document,{childList:true,subtree:true});
 if(!navigator.credentials)return;
 for(const key of ['create','get'])navigator.credentials[key]=()=>{window.authCounts[key]++;return Promise.reject(new DOMException('cancelled','NotAllowedError'))};
});
async function visit(which,{width=390,invite=true,existing=false}={}){
 mode=which;await d.p.setViewportSize({width,height:844});
 await d.p.goto(d.BASE,{waitUntil:'domcontentloaded'});
 await d.p.evaluate(existing=>{localStorage.clear();sessionStorage.clear();if(existing)localStorage.setItem('araso.piggyReceived','1')},existing);
 await d.p.goto('about:blank');await d.p.goto(d.BASE+(invite?'?i=A1223TEST#invite=synthetic-invite-a1223':''),{waitUntil:'domcontentloaded'});
}
try{
 for(const width of [390,1440]){
  await visit('bound',{width});
  await d.p.locator('[data-a1223-loading]').waitFor();assert.equal(await d.p.locator('#inviteFaceButton').count(),0);
  await d.p.getByText('This invite was already used.',{exact:true}).waitFor();
  assert.equal(await d.p.locator('.inviteOnly p').nth(1).innerText(),'If it was you, open Araso where you made your Piggy.');
  assert.equal(await d.p.evaluate(()=>window.envelopeSeen),false);
  assert.equal(await d.p.locator('button').count(),0);assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:0,get:0});
  assert.equal(await d.p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.A1223_SHOTS)await d.p.screenshot({path:process.env.A1223_SHOTS+'/used-'+width+'.png'});
  pass++;console.log('PASS bound OFF no envelope/auth '+width);
 }
 await visit('public');await d.p.locator('#inviteFaceButton').waitFor();assert.equal(await d.p.locator('.inviteOnly').count(),0);await d.p.locator('.testerIntro').waitFor({state:'detached'});
 await d.p.locator('#inviteFaceButton').click();await d.p.locator('#authTryAgainButton').waitFor();assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:1,get:0});pass++;console.log('PASS used invite public ON enters public create');
 for(const which of ['unbound','offline','timeout']){
  await visit(which);await d.p.locator('#inviteFaceButton').waitFor({timeout:9000});
  assert.equal(await d.p.locator('.invite__line1').first().innerText(),'your money,');assert.equal(await d.p.locator('.invite__line2').first().innerText(),'as a little Piggy');
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{create:0,get:0});
  if(which==='timeout'){await d.p.waitForTimeout(1000);assert.equal(await d.p.locator('.inviteOnly').count(),0)}
  pass++;console.log('PASS envelope fallback '+which);
 }
 await visit('bound',{existing:true});await d.p.locator('#inviteFaceButton').waitFor();assert.equal(await d.p.locator('.inviteOnly').count(),0);pass++;console.log('PASS existing record keeps envelope');
 await visit('bound',{invite:false});await d.p.getByText('Araso is invite-only for now.',{exact:true}).waitFor();pass++;console.log('PASS no invite unchanged');
 assert.deepEqual(d.errors,[]);console.log(`A1223 browser ${pass} PASS / 0 FAIL / 0 SKIP (local isolated, mocked metadata/auth)`);
}finally{await d.close()}
