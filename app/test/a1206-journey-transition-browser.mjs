import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch({forkMode:true});
await d.context.route('**/api/fork-entry',async r=>{const a=r.request().postDataJSON()?.action;if(a==='public_state')return r.fulfill({json:{ok:true,publicEntry:true}});return r.fallback()});
try{
 await d.p.setViewportSize({width:390,height:844});
 await d.seedSolo('Transition');
 await d.p.evaluate(()=>{
  for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k.startsWith('araso.secondIntroSeen'))localStorage.removeItem(k)}
  sessionStorage.setItem('araso.journeySwitchUnlock.v1',String(Date.now()));
 });
 await d.p.reload({waitUntil:'domcontentloaded'});
 await d.p.waitForFunction(()=>sessionStorage.getItem('araso.journeySwitchUnlock.v1')===null);
 await d.p.waitForSelector('[data-scene="explore"]',{timeout:30000});
 assert.equal(await d.p.locator('#loginChogButton').count(),0);
 assert.equal(await d.p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('araso.secondIntroSeen')&&localStorage.getItem(k)==='1')),true);
 await d.p.reload({waitUntil:'domcontentloaded'});
 await d.p.waitForSelector('#loginChogButton',{timeout:15000});
 assert.equal(await d.p.evaluate(()=>sessionStorage.getItem('araso.journeySwitchUnlock.v1')),null);
 assert.deepEqual(d.errors,[]);
 console.log('A1206 browser: handoff -> intro/Explore without lock; manual reload locks; 2 PASS / 0 FAIL / 0 SKIP (local virtual-auth, fake fork)');
}finally{await d.close()}
