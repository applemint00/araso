// [A-1304] Public ON first visit: while public_state is still on its way, a visitor with no invite sees the
// loading art, never "invite-only for now", and no entry_blocked is sent. OFF / timeout stay fail closed.
import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();let mode='public',pass=0;
await d.context.route('**/api/fork-entry',async r=>{
 const action=r.request().postDataJSON()?.action;
 if(action==='public_state'){
  if(mode==='timeout'){await new Promise(resolve=>setTimeout(resolve,7000));return r.fulfill({json:{ok:true,publicEntry:true}}).catch(()=>{})}
  await new Promise(resolve=>setTimeout(resolve,2000));
  return r.fulfill({json:{ok:true,publicEntry:mode==='public'||mode==='returning'}});
 }
 await new Promise(resolve=>setTimeout(resolve,300));
 return r.fulfill({json:{ok:true,bound:false}});
});
await d.context.addInitScript(()=>{
 window.a1304={inviteOnlySeen:false,loadingSeen:false,events:[],t0:performance.now(),loadingEnd:null};
 const beacon=navigator.sendBeacon?.bind(navigator);
 navigator.sendBeacon=(url,body)=>{if(String(url).includes('/api/event')&&body?.text)body.text().then(t=>window.a1304.events.push(JSON.parse(t)));return beacon?beacon(url,body):true};
 new MutationObserver(()=>{
  const s=window.a1304;
  if(document.querySelector('.inviteOnly')&&/invite-only for now/.test(document.body?.innerText||''))s.inviteOnlySeen=true;
  if(document.querySelector('[data-a1223-loading]'))s.loadingSeen=true;else if(s.loadingSeen&&s.loadingEnd===null)s.loadingEnd=performance.now()-s.t0;
 }).observe(document,{childList:true,subtree:true,characterData:true});
});
const shots=process.env.A1304_SHOTS;
async function visit(which,{invite=false,existing=false}={}){
 mode=which;await d.p.setViewportSize({width:390,height:844});
 await d.p.goto(d.BASE,{waitUntil:'domcontentloaded'});
 await d.p.evaluate(existing=>{localStorage.clear();sessionStorage.clear();if(existing)localStorage.setItem('araso.piggyReceived','1')},existing);
 await d.p.goto('about:blank');await d.p.goto(d.BASE+(invite?'?i=A1304TEST#invite=synthetic-invite-a1304':''),{waitUntil:'domcontentloaded'});
}
const st=()=>d.p.evaluate(()=>window.a1304);
const steps=async()=>(await st()).events.filter(e=>e.step==='entry_blocked'||e.step==='entry_shown').map(e=>e.step+':'+e.code);
try{
 await visit('public');
 await d.p.waitForTimeout(500);if(shots)await d.p.screenshot({path:shots+'/public-0.5s-390.png'});
 await d.p.waitForTimeout(2000);if(shots)await d.p.screenshot({path:shots+'/public-2.5s-390.png'});
 await d.p.locator('#inviteFaceButton').waitFor({timeout:4000});await d.p.waitForTimeout(300);
 let s=await st();
 assert.equal(s.inviteOnlySeen,false,'public ON new visitor saw "invite-only for now" before public_state answered · events '+JSON.stringify(await steps()));
 assert.deepEqual(await steps(),['entry_shown:public'],'public ON new visitor events');
 assert.equal(s.loadingSeen,true);
 pass++;console.log('PASS public ON new visitor: loading → envelope · invite-only 0 · entry_blocked 0');
 await visit('off');
 await d.p.getByText('Araso is invite-only for now.',{exact:true}).waitFor({timeout:4000});await d.p.waitForTimeout(300);
 if(shots)await d.p.screenshot({path:shots+'/public-off-390.png'});
 assert.deepEqual(await steps(),['entry_blocked:invite_only']);
 pass++;console.log('PASS public OFF: invite-only · entry_blocked invite_only once');
 await visit('timeout');
 await d.p.getByText('Araso is invite-only for now.',{exact:true}).waitFor({timeout:6500});await d.p.waitForTimeout(300);
 if(shots)await d.p.screenshot({path:shots+'/public-timeout-390.png'});
 s=await st();assert.deepEqual(await steps(),['entry_blocked:invite_only']);
 assert.ok(s.loadingEnd===null||s.loadingEnd<5600,'loading stayed '+s.loadingEnd+' ms');
 pass++;console.log('PASS public timeout: fail closed invite-only · loading ended '+(s.loadingEnd===null?'n/a':Math.round(s.loadingEnd)+' ms'));
 await visit('off',{invite:true});
 await d.p.locator('#inviteFaceButton').waitFor({timeout:4000});
 assert.equal((await st()).inviteOnlySeen,false);assert.deepEqual(await steps(),['entry_shown:invite']);
 pass++;console.log('PASS invite link public OFF: envelope (invite)');
 await visit('returning',{existing:true});
 await d.p.locator('#inviteFaceButton').waitFor({timeout:4000});
 s=await st();assert.equal(s.inviteOnlySeen,false);assert.equal(s.loadingSeen,false,'returning visitor waited on public_state');
 pass++;console.log('PASS returning record: envelope, no loading wait');
 assert.deepEqual(d.errors,[]);console.log(`A1304 browser ${pass} PASS / 0 FAIL / 0 SKIP (local isolated, mocked public_state)`);
}finally{await d.close()}
