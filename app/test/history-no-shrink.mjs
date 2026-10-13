// A1138: rendered widths, character ink and continuous motion. Local mock only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {launchHome,sleep} from './helpers/a827-sweep.mjs';
// Browser suite marker for run-all: "--strictPort" (launched by a803-browser helper).
const out=process.env.HISTORY_OUT||fs.mkdtempSync(path.join(tmpdir(),'araso-history-'));fs.mkdirSync(out,{recursive:true});
const H=await launchHome(393,659),rows=[];let failures=[];
try{
 if(await H.p.locator('#stayButton').count()){await H.p.evaluate(()=>document.querySelector('#stayButton').click());await sleep(1200)}
 assert.ok(await H.openHomePaper());await sleep(800);
 await H.p.evaluate(()=>{
  const cache=new Map();
  const rect=e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}};
  function shown(e){for(let a=e;a;a=a.parentElement){const s=getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;}
  function ink(e){if(!e||!e.naturalWidth||!shown(e))return null;const r=rect(e);if(!r.w)return null;
   let a=cache.get(e.src);if(!a){const c=document.createElement('canvas');c.width=e.naturalWidth;c.height=e.naturalHeight;const g=c.getContext('2d');g.drawImage(e,0,0);const d=g.getImageData(0,0,c.width,c.height).data;let l=c.width,t=c.height,rr=0,b=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]>16){l=Math.min(l,x);t=Math.min(t,y);rr=Math.max(rr,x+1);b=Math.max(b,y+1)}a={l:l/c.width,t:t/c.height,r:rr/c.width,b:b/c.height};cache.set(e.src,a)}return {l:r.l+a.l*r.w,r:r.l+a.r*r.w,t:r.t+a.t*r.h,b:r.t+a.b*r.h};}
  window.__historyMeasure=()=>{const a=document.querySelector('#recordsCardAnchor'),home=document.querySelector('#homePaper');const union=bs=>bs.length?{l:Math.min(...bs.map(b=>b.l)),r:Math.max(...bs.map(b=>b.r)),t:Math.min(...bs.map(b=>b.t)),b:Math.max(...bs.map(b=>b.b))}:null;const svgInk=[...document.querySelectorAll('.homeLiving svg path,.homeLiving svg ellipse,.homeLiving svg circle,.homeLiving svg polygon')].filter(shown).map(rect).filter(r=>r.w&&r.h);const seat=ink(document.querySelector('#homeSeat'))||union(svgInk);const chogs=[...document.querySelectorAll('#chogHomeStack img,#chogHomeSleep img')].map(ink).filter(Boolean);const chog=chogs.length?{l:Math.min(...chogs.map(x=>x.l)),r:Math.max(...chogs.map(x=>x.r)),t:Math.min(...chogs.map(x=>x.t)),b:Math.max(...chogs.map(x=>x.b))}:null;return {home:rect(home),history:rect(a),visible:!a.hidden&&Number(getComputedStyle(a).opacity)>.05,characters:{seat,chog,name:(()=>{const e=document.querySelector('#homeName');return e&&shown(e)?rect(e):null})()},focus:document.activeElement?.id,focusOnTrigger:document.activeElement?.matches('.homePaper__records'),scrollW:document.documentElement.scrollWidth};};
 });
 const sample=async(open)=>H.p.evaluate(async open=>{const trigger=open?[...document.querySelectorAll('.homePaper__records')].find(e=>e.getBoundingClientRect().width>0):document.querySelector('#recordsCardClose');trigger?.focus();trigger?.click();const rows=[],t0=performance.now();await new Promise(resolve=>{function step(){rows.push({time:performance.now()-t0,...__historyMeasure()});if(performance.now()-t0<600)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)});return rows;},open);
 for(const [w,h]of [[393,659],[393,852],[810,1080],[860,800],[1100,800],[1440,900],[1940,1440]]){
  await H.p.setViewportSize({width:w,height:h});await sleep(800);assert.ok(await H.openHomePaper());
  const before=await H.p.evaluate(()=>__historyMeasure());const opening=await sample(true),opened=await H.p.evaluate(()=>__historyMeasure());await H.p.screenshot({path:path.join(out,`${w}x${h}-open.png`)});const closing=await sample(false),after=await H.p.evaluate(()=>__historyMeasure());
  const frames=[...opening,...closing],widthDrift=Math.max(...frames.map(r=>Math.abs(r.home.w-before.home.w))),historyDelta=opened.history.w-before.home.w;
  const hits=[];for(const [i,r]of frames.entries())if(r.visible)for(const [n,c]of Object.entries(r.characters)){if(!c)continue;const a=r.history;if(a.l<c.r-.5&&a.r>c.l+.5&&a.t<c.b-.5&&a.b>c.t+.5)hits.push({i,n,history:a,character:c});}
  const visibleCharacters=Object.values(opened.characters).filter(Boolean);
  const edges={left:Math.min(opened.home.l,opened.history.l,...visibleCharacters.map(c=>c.l)),right:w-Math.max(opened.home.r,opened.history.r,...visibleCharacters.map(c=>c.r)),top:Math.min(opened.home.t,opened.history.t,...visibleCharacters.map(c=>c.t)),bottom:h-Math.max(opened.home.b,opened.history.b,...visibleCharacters.map(c=>c.b))};
  const pass=Object.values(edges).every(v=>v>=-.5)&&opened.focus==='recordsCardClose'&&after.focusOnTrigger&&!!opened.characters.seat&&!!opened.characters.chog&&widthDrift<.5&&Math.abs(historyDelta)<.5&&hits.length===0&&opened.scrollW<=w+1&&Math.abs(after.home.w-before.home.w)<.5;
  const result={w,h,edges,before,opened,after,opening,closing,widthDrift,historyDelta,hits,pass};rows.push(result);if(!pass)failures.push({w,h,widthDrift,historyDelta,hits:hits.length});
 }
 await H.p.emulateMedia({reducedMotion:'reduce'});await H.p.setViewportSize({width:860,height:800});await sleep(500);await sample(true);const reduced=await H.p.evaluate(()=>({rect:__historyMeasure(),animations:document.querySelector('#recordsCardAnchor').getAnimations().length}));
 const resize=[];for(const [w,h]of [[810,1080],[393,659],[860,800],[1440,900]]){await H.p.setViewportSize({width:w,height:h});await sleep(600);resize.push({w,h,...await H.p.evaluate(()=>__historyMeasure())});}
 if(reduced.animations)failures.push({reducedAnimations:reduced.animations});
 for(const r of resize)if(Math.abs(r.home.w-r.history.w)>.5||r.focus!=='recordsCardClose')failures.push({resize:r.w,focus:r.focus,delta:r.home.w-r.history.w});
 const result={mode:'actual app, isolated Chromium, virtual authenticator, no external network or transactions',rows,reduced,resize,errors:H.errors,failures,pass:failures.length===0&&H.errors.length===0};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,failures,errors:H.errors,rows:rows.map(r=>({w:r.w,h:r.h,widthDrift:r.widthDrift,historyDelta:r.historyDelta,hits:r.hits.length}))}));if(!result.pass)process.exitCode=1;
}finally{await H.close()}
