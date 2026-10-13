import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();let reply={ok:true,bound:false},reads=0,pass=0;
await d.context.route('**/api/fork-entry',async route=>{if(route.request().postDataJSON()?.action==='public_state')return route.fulfill({json:{ok:true,publicEntry:false}});reads++;assert.deepEqual(route.request().postDataJSON(),{action:'invite_state'});assert.ok(route.request().headers()['x-araso-invite']);if(reply===null)return route.abort();return route.fulfill({json:reply})});
await d.context.addInitScript(()=>{
 window.authCounts={get:0,create:0,gesture:false};if(!navigator.credentials)return;
 const create=navigator.credentials.create.bind(navigator.credentials);
 navigator.credentials.get=()=>{window.authCounts.get++;return Promise.reject(new DOMException('cancelled','NotAllowedError'))};
 navigator.credentials.create=(...a)=>{window.authCounts.create++;window.authCounts.gesture=navigator.userActivation.isActive;return create(...a)};
});
try{
 await d.p.goto(d.BASE+'#invite=synthetic-invite-1158',{waitUntil:'networkidle'});
 assert.equal(reads,1);
 await d.p.evaluate(()=>{const now=Date.now.bind(Date);Date.now=()=>now()+10*60*1000});
 await d.p.locator('#inviteFaceButton').dblclick();
 await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});
 assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:0,create:1,gesture:true});assert.equal(reads,1);pass++;
 for(const [name,result,existing] of [['bound',{ok:true,bound:true},false],['offline',null,false],['existing',{ok:true,bound:false},true]]){
  reply=result;await d.p.evaluate(existing=>{localStorage.clear();sessionStorage.clear();if(existing)localStorage.setItem('araso.piggyReceived','1')},existing);
  await d.p.goto('about:blank');
  await d.p.goto(d.BASE+'#invite=synthetic-invite-1158',{waitUntil:'networkidle'});
  await d.p.locator('#inviteFaceButton').click();await d.p.waitForSelector(existing ? '#checkButton' : '#authTryAgainButton');
  assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:1,create:0,gesture:false},name);pass++;
 }
 assert.deepEqual(d.errors,[]);pass++;
 console.log(`${pass} PASS / 0 FAIL / 0 SKIP: unbound create+gesture+duplicate0, bound get, offline get, existing get, pageerror0`);
}finally{await d.close()}
