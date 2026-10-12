import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createResponsiveLayout,responsiveFrame} from '../src/responsive-layout.js';
const src=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const core=src.slice(src.indexOf('const HK_STAGE_W ='),src.indexOf('let responsiveSolver ='));
const context=vm.createContext({Math});
vm.runInContext('const HOME_SEAT_W=150, HOME_SEAT_H=150*551/528, HOME_CENTER=1041, HOME_SEAT_L=1041-.4991*150;\n'+core+'\nthis.base=homeKeyframeLayoutBase;',context);
const solver=createResponsiveLayout(context.base);
let checked=0;
for(const h of[568,659,800,844,900,1080,1440]){
 let prev=null;
 for(let w=390;w<=2560;w++){
  const p=solver.history(w,h);
  assert.ok(Number.isFinite(p.cardW)&&p.cardW>0);
  assert.ok(p.homeLeft>=-.5&&p.histRight<=w+.5&&p.top>=-.5&&p.top+p.cardH<=h+.5,`${w}x${h} bounds`);
  if(w>=641){
   assert.ok(p.histLeft>=p.homeLeft+.611*p.cardW-.5,`${w}x${h} title`);
   assert.ok(!(p.histRight>p.L.stageLeft+.01&&p.top+p.cardH>p.L.stageTop+.01),`${w}x${h} stage`);
  }
  if(prev){assert.ok(p.cardW>=prev.cardW-1e-5,`${w}x${h} shrinking`);assert.ok(Math.abs(p.cardW-prev.cardW)/prev.cardW<.01,`${w} size jump`);if(w>641)assert.ok(p.signedGap>=prev.signedGap-1e-5,`${w} gap reverse`);}
  prev=p;checked++;
 }
}
const a=solver.history(1440,900),b=solver.history(1940,1200),c=solver.history(2560,1400);
assert.equal(a.cardW,376.5);
for(const k of['cardW','cardH','signedGap']){assert.equal(b[k],a[k]*1.05);assert.equal(c[k],b[k]);}
assert.equal(c.homeLeft-b.homeLeft,(2560-1940)/2);
assert.equal(c.top-b.top,(1400-1200)/2);
assert.equal(c.L.stageTop-b.L.stageTop,(1400-1200)/2);
assert.equal(c.L.boardTop-b.L.boardTop,(1400-1200)/2);
assert.deepEqual(responsiveFrame(1940,1200),{width:1440,height:900,scale:1.05,x:214,y:127.5});
// Returning to a width cannot depend on resize direction or an evicted cache.
const expected=solver.history(1000,900);
for(let h=600;h<650;h+=3)solver.history(1920,h);
assert.deepEqual(solver.history(1000,900),expected);
console.log(`PASS responsive layout: ${checked} sizes; 1940 cap; horizontal and vertical centring; resize determinism`);
