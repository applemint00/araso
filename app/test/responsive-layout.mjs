import {CHOG_HOME_GEOMETRY} from '../src/chog-home.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createResponsiveLayout,responsiveFrame} from '../src/responsive-layout.js';
const src=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const core=src.slice(src.indexOf('const HK_STAGE_W ='),src.indexOf('let responsiveSolver ='));
const context=vm.createContext({Math,CHOG_HOME_GEOMETRY});
vm.runInContext('const HOME_SEAT_W=150, HOME_SEAT_H=150*551/528, HOME_CENTER=1041, HOME_SEAT_L=1041-.4991*150;\n'+core+'\nthis.base=homeKeyframeLayoutBase;',context);
const solver=createResponsiveLayout((w,h,limit)=>context.base(w,h,0,limit));
let checked=0;
for(const h of[568,659,800,844,900,1080,1440]){
 let prev=null, prevSolo=null;
 for(let w=390;w<=2560;w++){
  const solo=solver.layout(w,h);
  if(prevSolo) assert.ok(Math.abs(solo.cardW-prevSolo.cardW)/prevSolo.cardW<.01,`${w}x${h} solo size jump`);
  prevSolo=solo;
  const p=solver.history(w,h);
  assert.equal(p.cardW,solo.cardW,`${w}x${h} rendered History width must equal closed Home`);
  assert.equal(p.L.cardW,solo.cardW,`${w}x${h} History must start from the rendered solo scale`);
  assert.equal(p.L.cardX,solo.cardX,`${w}x${h} History must start from the rendered solo position`);
  assert.ok(Number.isFinite(p.cardW)&&p.cardW>0);
  assert.ok(p.homeLeft>=-.5&&p.histRight<=w+.5&&p.top>=-.5&&p.top+p.cardH<=h+.5,`${w}x${h} bounds`);
  if(w>=641){
   // Owner permits title occlusion; protect actual character regions, not the
   // empty upper-left area of their joint bounding rectangle.
   const L=p.L,cg=CHOG_HOME_GEOMETRY;
   const chars=[{l:L.boardLeft+L.S*(cg.cornerTransform.x+cg.inkLocal.left*cg.homeScale),t:L.boardTop+L.S*(cg.cornerTransform.y+cg.inkLocal.top*cg.homeScale)},{l:L.boardLeft+L.S*(1041-.4991*150),t:L.stageTop}];
   for(const c of chars)assert.ok(!(p.histRight>c.l+.01&&p.top+p.cardH>c.t+.01),`${w}x${h} character`);
  }
  if(prev){assert.ok(Math.abs(p.cardW-prev.cardW)/prev.cardW<.01,`${w} size jump`);assert.ok(Math.abs(p.histLeft-prev.histLeft)<6&&Math.abs(p.homeLeft-prev.homeLeft)<6,`${w} position jump`);}
  prev=p;checked++;
 }
}
const a=solver.history(1440,900),b=solver.history(1940,1200),c=solver.history(2560,1200);
// A-1144 supersedes the 430 v10 height-based width; phone History follows its rail.
for(const [w,h,cardW,histLeft] of [[390,844,283,87],[640,900,326,275],[810,1080,411,347],[1000,700,293,289],[1100,800,335,331],[1280,800,335,466]]) {
 const q=solver.history(w,h);
 assert.ok(Math.abs(q.cardW-cardW)<2,`${w}x${h} v10 card`);
 assert.ok(Math.abs(q.histLeft-histLeft)<2,`${w}x${h} v10 History x`);
}
assert.ok(Math.abs(solver.history(430,932).cardW-294.528571429)<.5,'A-1144 430 phone width');
assert.equal(a.cardW,376.5);
for(const k of['cardW','cardH','signedGap']){assert.ok(Math.abs(b[k]-a[k]*1.05)<1e-9,`${k} 1.05 scale`);assert.ok(Math.abs(c[k]-b[k])<1e-9,`${k} fixed cap`);}
assert.equal(c.homeLeft-b.homeLeft,(2560-1940)/2);
assert.deepEqual(responsiveFrame(1940,1200),{width:1440,height:1200/1.05,scale:1.05,x:214,y:0});
for(const h of [700,900,1080,1440]) {
 const x=[1439,1440,1441].map(w=>solver.history(w,h));
 for(let i=1;i<x.length;i++)for(const k of ['cardW','top','homeLeft','histLeft'])
  assert.ok(Math.abs(x[i][k]-x[i-1][k])<3,`${h} boundary ${k}`);
}
// Returning to a width cannot depend on resize direction or an evicted cache.
const expected=solver.history(1000,900);
for(let h=600;h<650;h+=3)solver.history(1920,h);
assert.deepEqual(solver.history(1000,900),expected);
console.log(`PASS responsive layout: ${checked} sizes; v10 frames; 1940 width cap; full-height frame; resize determinism`);
