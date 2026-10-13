import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const output=process.env.A1159_RECEIPT;
if(output)mkdirSync(output,{recursive:true});
let pass=0;
for(const level of ['1','2']){
 process.env.VITE_ARASO_RELEASE_LEVEL=level;
 const d=await launch(); let publicOpen=false;
 await d.context.addInitScript(()=>{
  window.authCounts={get:0,create:0};window.apiCalls=[];
  const fetch0=window.fetch.bind(window);window.fetch=(url,...args)=>{const u=new URL(typeof url==='string'?url:url.url,location.href);if(u.pathname.startsWith('/api/')||u.origin!==location.origin)window.apiCalls.push(u.pathname);return fetch0(url,...args)};
  if(!navigator.credentials)return;
  const create=navigator.credentials.create.bind(navigator.credentials);
  navigator.credentials.get=()=>{window.authCounts.get++;return Promise.reject(new DOMException('cancelled','NotAllowedError'))};
  navigator.credentials.create=(...args)=>{window.authCounts.create++;return create(...args)};
 });
 await d.context.route('**/api/fork-entry',r=>r.fulfill({json:r.request().postDataJSON()?.action==='public_state'?{ok:true,publicEntry:publicOpen}:{ok:true,bound:false}}));
 try{
  if(level==='1'){
   for(const [width,height] of [[390,844],[1440,900]]){
    await d.p.setViewportSize({width,height});
    await d.p.goto(d.BASE+'?i=display-only&a995b-loading=1',{waitUntil:'networkidle'});
    await d.p.locator('.inviteOnly img').evaluate(i=>i.decode());
    assert.deepEqual(await d.p.locator('.inviteOnly p').allTextContents(),['Araso is invite-only for now.','Opens to everyone at 12:00 KST.']);
    assert.equal(await d.p.locator('button,.invite,.testerIntro,.a995bLoading').count(),0);
    assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:0,create:0});assert.deepEqual(await d.p.evaluate(()=>window.apiCalls),['/api/fork-entry']);
    const geometry=await d.p.locator('.inviteOnly img').evaluate(i=>{const r=i.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,overflow:document.documentElement.scrollWidth>innerWidth}});
    assert.ok(Math.abs(geometry.width/geometry.height-1200/630)<0.001);assert.ok(Math.abs(geometry.x+geometry.width/2-width/2)<1);assert.equal(geometry.overflow,false);
    if(output)await d.p.screenshot({path:`${output}/invite-only-${width}.png`});pass++;
   }
   await d.p.goto('about:blank');await d.p.goto(d.BASE+'#invite=synthetic-invite-1159',{waitUntil:'networkidle'});
   assert.equal(await d.p.locator('.inviteOnly').count(),0);await d.p.locator('#inviteFaceButton').dblclick();
   await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:0,create:1});pass++;
   await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('araso.piggyReceived','1')});
   await d.p.reload({waitUntil:'networkidle'});assert.equal(await d.p.locator('.inviteOnly').count(),0);
   await d.p.locator('#inviteFaceButton').click();await d.p.waitForSelector('#checkButton');assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:1,create:0});pass++;
  }else{
   await d.p.goto(d.BASE,{waitUntil:'networkidle'});assert.equal(await d.p.locator('.inviteOnly').count(),1);assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:0,create:0});pass++;
   publicOpen=true;await d.p.reload({waitUntil:'networkidle'});assert.equal(await d.p.locator('.inviteOnly').count(),0);
   await d.p.locator('#inviteFaceButton').click();await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:0,create:1});pass++;
  }
  assert.deepEqual(d.errors,[]);
 }finally{await d.close()}
}
console.log(`${pass} PASS / 0 FAIL / 0 SKIP: closed static390/1440 auth0 metadata-only, invite-create, existing-get, level2 closed/public-create`);
