import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();let pass=0;
await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:false,bound:false}}));
await d.context.addInitScript(()=>{
 const mode=new URLSearchParams(location.search).get('storageMode');
 const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 Storage.prototype.getItem=function(k){if(k==='araso.forkInvite.v1'&&mode==='mismatch')return null;return get.call(this,k)};
 Storage.prototype.setItem=function(k,v){if(k==='araso.forkInvite.v1'&&mode==='throw')throw new DOMException('blocked','QuotaExceededError');return set.call(this,k,v)};
});
try{
 await d.p.setViewportSize({width:390,height:844});
 await d.p.goto(d.BASE,{waitUntil:'networkidle'});
 for(const mode of ['ok','throw','mismatch']){
  await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
  await d.p.goto(d.BASE+'?storageMode='+mode+'#invite=synthetic-invite-a1209',{waitUntil:'networkidle'});
  await d.p.waitForSelector('#inviteFaceButton');
  assert.equal(await d.p.locator('.inviteOnly').count(),0);
  assert.equal(await d.p.evaluate(()=>location.hash.length>0),mode!=='ok');
  await d.p.reload({waitUntil:'networkidle'});
  await d.p.waitForSelector('#inviteFaceButton');
  assert.equal(await d.p.locator('.inviteOnly').count(),0);pass++;
 }
 assert.deepEqual(d.errors,[]);
 console.log(`A1209 browser ${pass} PASS / 0 FAIL / 0 SKIP: storage success/throw/mismatch + reload envelope (local, auth0)`);
}finally{await d.close()}
