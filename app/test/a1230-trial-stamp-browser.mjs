import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch(), shots=process.env.A1230_SHOTS, rows=[];let pass=0;
if(shots)mkdirSync(shots,{recursive:true});
await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:false,bound:false}}));
const sizes=[[390,844],[430,932],[1440,900]];
async function stampCheck(scene,width){
 const m=await d.p.evaluate((scene)=>{
  const e=document.querySelector(scene==='invite'?'.trialStamp--invite':'.trialStamp--send');
  if(!e)return {missing:true};
  const r=e.getBoundingClientRect(),st=getComputedStyle(e);
  const scale=scene==='invite'?parseFloat(document.querySelector('.invite').style.getPropertyValue('--invS')):document.querySelector('#sendCard').getBoundingClientRect().width/document.querySelector('#sendCard').offsetWidth;
  const selectors=scene==='invite'?['.invite__envImg--closed','#inviteFaceButton','[data-chog-invite]','.invite__tape','.arasoBrand','.invite__explain']:['#sendCard','#chogHelp','.arasoBrand'].filter(s=>document.querySelector(s)); // [A-1434 A6] the Send stamp sits outside the card, above it (pre: inside it, clear of its lines)
  const overlap=selectors.filter(s=>{const b=document.querySelector(s).getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top});
  const bounds={left:0,top:0,right:innerWidth,bottom:innerHeight}; // [A-1434] both stamps stay on the screen (pre: the Send stamp inside the card)
  return {text:e.textContent,font:parseFloat(st.fontSize)*scale,border:parseFloat(st.borderTopWidth)*scale,accessible:!e.closest('[aria-hidden="true"]'),pointer:st.pointerEvents,overlap,inside:r.left>=bounds.left&&r.top>=bounds.top&&r.right<=bounds.right&&r.bottom<=bounds.bottom,rect:r.toJSON()};
 },scene);
 assert.equal(m.text,scene==='invite'?'trial phase · free':'tutorial · free');assert.ok(Math.abs(m.font-(width===1440?22:scene==='invite'?15:17))<.1); /* [A-1434 A6] Send stamp: "tutorial · free" · hand font 17 px (pre: "trial phase · free" 15 px) */assert.ok(Math.abs(m.border-1.5)<.9);assert.ok(m.accessible&&m.inside);assert.equal(m.pointer,'none');assert.deepEqual(m.overlap,[]);
 rows.push({scene:scene+'-stamp',width,...m});
}
function check(label){pass++;console.log('PASS '+label)}
try{
 await d.p.goto(d.BASE+'#invite=synthetic-invite-a1230',{waitUntil:'networkidle'});
 for(const [width,height] of sizes){
  await d.p.setViewportSize({width,height});await d.p.waitForTimeout(800);
  const metrics=await d.p.evaluate(()=>{
   const e=document.querySelector('.invite__explain'),r=e.getBoundingClientRect(),a=document.querySelector('[data-chog-invite]').getBoundingClientRect();
   const overlaps=s=>{const b=document.querySelector(s).getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top};
   return {gap:innerWidth===1440?a.left-r.right:r.left-a.right,center:Math.abs(r.top+r.height/2-a.top-a.height/2),font:parseFloat(getComputedStyle(e).fontSize)*parseFloat(document.querySelector('.invite').style.getPropertyValue('--invS')),accessible:!e.closest('[aria-hidden="true"]'),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overlap:overlaps('.invite__hero')||overlaps('#inviteFaceButton'),rect:r.toJSON()};
  });
  assert.ok(Math.abs(metrics.gap-(width===1440?14:10))<0.1);assert.ok(metrics.center<0.1);assert.ok(Math.abs(metrics.font-(width===1440?20:15))<0.1);assert.ok(metrics.accessible&&metrics.inside&&!metrics.overlap);
  await stampCheck('invite',width);rows.push({scene:'invite',width,...metrics});if(shots)await d.p.screenshot({path:`${shots}/invite-${width}.png`});check(`invite ${width}: gap/font/center/accessibility/overlap`);
 }
 // Virtual local authenticator only. The scaffold blocks all external requests.
 await d.context.route('**/api/fork-entry',r=>r.fulfill({json:{ok:true,publicEntry:true,bound:false}}));
 await d.seedSolo('Honeybun',{stay:false});await d.p.locator('#sendCard').waitFor({timeout:30000});await d.p.waitForTimeout(600);
 for(const [width,height] of sizes){
  await d.p.setViewportSize({width,height});await d.p.waitForTimeout(1200);
  const metrics=await d.p.evaluate(()=>{
   // [A-1434 A5–A7 · 시안 v3] two ink lines ("You sign." with its gold underline · "Piggy takes your money to work.") under the more info button;
   // pre-A-1434: one gold line .sendCard__explain "You sign. Piggy takes your money to work." the size of the "0.001 MON test" detail
   const card=document.querySelector('#sendCard').getBoundingClientRect();
   const line=(sel)=>{const e=document.querySelector(sel),r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const ink=range.getBoundingClientRect();const overlaps=s=>{const b=document.querySelector(s).getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top};return {text:e.textContent.trim(),color:getComputedStyle(e).color,lines:range.getClientRects().length,inside:ink.left>=card.left&&ink.right<=card.right&&ink.bottom<=card.bottom,overlap:['#sendButton','.sendCard__message','#sendMoreInfo','.sendCard__rule'].some(overlaps),rect:r.toJSON()}};
   const sign=line('.sendCard__signWord'),takes=line('.sendCard__takes');
   return {text:sign.text+' '+takes.text,color:sign.color===takes.color?sign.color:'mixed',lines:Math.max(sign.lines,takes.lines),inside:sign.inside&&takes.inside,overlap:sign.overlap||takes.overlap,underline:getComputedStyle(document.querySelector('.sendCard__signLine path')).stroke,rect:sign.rect};
  });
  assert.equal(metrics.text,'You sign. Piggy takes your money to work.');assert.equal(metrics.color,'rgb(20, 18, 16)');assert.equal(metrics.underline,'rgb(224, 177, 0)');assert.equal(metrics.lines,1);assert.ok(metrics.inside&&!metrics.overlap);
  await stampCheck('send',width);rows.push({scene:'send',width,...metrics});if(shots)await d.p.screenshot({path:`${shots}/send-${width}.png`});check(`send ${width}: one line/detail size/containment/overlap`);
 }
 await d.p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});await d.p.goto('about:blank');await d.p.goto(d.BASE,{waitUntil:'networkidle'});
 await d.p.evaluate(()=>{for(const name of ['get','create'])navigator.credentials[name]=()=>new Promise(()=>{})});
 await d.p.locator('#inviteFaceButton').click();await d.p.waitForTimeout(1000);
 assert.match(await d.p.locator('#inviteFaceButton').innerText(),/checking/i);assert.equal(await d.p.locator('.invite__explain').isVisible(),true);assert.match(await d.p.locator('.invite__explain').innerText(),/Your Piggy keeps your money/);check('checking keeps readable explanation');
 assert.deepEqual(d.errors,[]);
 if(shots)writeFileSync(`${shots}/metrics.json`,JSON.stringify(rows,null,2));
 console.log(`A1230 browser ${pass} PASS / 0 FAIL / 0 SKIP (local Chromium, mocked metadata/virtual auth, no live/tx)`);
}finally{await d.close()}
