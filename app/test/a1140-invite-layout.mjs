// Browser-only regression: helper starts local vite with "--strictPort".
// Run with ARASO_TEST_BROWSER=1 and A1140_OUT=<private receipt directory>.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {launch,sleep} from './helpers/a803-browser.mjs';
import {layoutOracle} from './helpers/a831-sweep.mjs';

const out=process.env.A1140_OUT||mkdtempSync(path.join(tmpdir(),'araso-invite-'));
mkdirSync(out,{recursive:true});
const cardAt=layoutOracle(readFileSync(new URL('../src/main.js',import.meta.url),'utf8'));
const H=await launch({forkMode:true}),p=H.p;
const sizes=[[690,800],[699,800],[700,800],[701,800],[800,800],[860,800],[861,800],[900,800],[1000,800],[1100,800],[1439,900],[1440,900]];
const rows=[];
try{
 for(const [w,h] of sizes){
  await p.setViewportSize({width:w,height:h});await p.goto(H.BASE,{waitUntil:'networkidle'});await sleep(150);
  const row=await p.evaluate(()=>{
   const rect=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height};};
   return {w:innerWidth,h:innerHeight,kind:document.querySelector('.invite')?.dataset.kind,env:rect('.invite__env'),face:rect('.invite__face'),chog:rect('.invite__chogNative'),hero:rect('.invite__hero'),scale:document.querySelector('.invite')?.style.transform};
  });
  rows.push(row);await p.screenshot({path:path.join(out,`invite_${w}x${h}.png`)});
  console.log(`${w} ${row.kind} env=${row.env?.w.toFixed(2)} scale=${row.scale}`);
 }
 for(const w of [861,1000,1100]){
  const r=rows.find(x=>x.w===w),card=cardAt(w,800,0).cardW,target=553.3*card/376.5;
  r.homeCardW=card;r.expectedEnvelopeW=target;
  assert.ok(Math.abs(r.env.w-target)<=2,`${w} envelope ${r.env.w} != ${target} from HomeCard ${card}`);
  assert.ok(r.env.l>=0&&r.env.r<=w,`${w} envelope outside viewport`);
  assert.ok(r.face.l>=0&&r.face.r<=w,`${w} button outside viewport`);
 }
 for(const [a,b] of [[699,700],[700,701],[860,861],[1439,1440]]){
  const x=rows.find(r=>r.w===a),y=rows.find(r=>r.w===b);
  assert.ok(Math.abs(x.env.w-y.env.w)<4,`${a}/${b} envelope size jump`);
  for(const k of ['env','face'])assert.ok(Math.abs(x[k].l-y[k].l)<8&&Math.abs(x[k].t-y[k].t)<8,`${a}/${b} ${k} position jump`);
 }
 assert.equal(H.errors.length,0,`browser errors ${H.errors}`);
}finally{writeFileSync(path.join(out,'measure.json'),JSON.stringify({rows,errors:H.errors},null,2));await H.close();}
console.log('PASS A-1140 Invite HomeCard-ratio envelopes, containment, boundary continuity');
