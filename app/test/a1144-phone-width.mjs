// A-1144: Owner's phone width key, with the 550..640 join to v10.
// Browser suite marker: "--strictPort" (the helper starts local Vite).
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {layoutOracle,launchHome,sleep} from './helpers/a831-sweep.mjs';
import {measure,showSendCard} from './helpers/a827-sweep.mjs';
import {createResponsiveLayout} from '../src/responsive-layout.js';
import {CHOG_HOME_GEOMETRY as cg} from '../src/chog-home.js';

export const phoneCases=[[393,659,283.217142857],[393,852,283.217142857],[375,667,271.442307692],[390,844,282.3],[430,932,294.528571429]];
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<.5,`${label}: ${a} != ${b}`);
export function assertPhoneWidths(layout){
 for(const [w,h,cw] of phoneCases)near(layout(w,h).cardW,cw,`${w}x${h} phone width`);
 for(const w of [375,390,393,430])for(const h of [659,667,844,852,932])
  near(layout(w,h).cardW,layout(w,932).cardW,`${w}x${h} toolbar height invariance`);
 near(layout(640,900).cardW,325.578470825,'640x900 v10 join');
 // A-1144: this paper fits beside Piggy; proximity reserve must not shrink it.
 near(layout(572,700).cardW,317.4342441314554,'572x700 keeps the joined target width');
}

export function assertPhoneConnection(solver){
 let count=0;
 for(const h of [568,600,659,700,844,900,1080,1440]){
  let previous=solver.history(550,h);
  for(let w=551;w<=641;w++){
   const p=solver.history(w,h),L=p.L;
   assert.ok(Math.abs(p.histLeft-previous.histLeft)<=3.001,`${w}x${h} History jump`);
   assert.ok(Math.abs(p.top-previous.top)<=1.6,`${w}x${h} paper vertical jump`);
   const residents=[
    {l:L.boardLeft+L.S*(cg.cornerTransform.x+cg.inkLocal.left*cg.homeScale),t:L.boardTop+L.S*(cg.cornerTransform.y+cg.inkLocal.top*cg.homeScale)},
    {l:L.stageLeft+L.stageW-L.S*150,t:L.stageTop}
   ];
   assert.ok(residents.every(r=>p.histRight<=r.l+.02||p.top+p.cardH<=r.t+.02),`${w}x${h} History character collision`);
   previous=p;count++;
  }
 }
 return count;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assertPhoneWidths(layoutOracle());
 const raw=layoutOracle(undefined,true);
 console.log(`PASS A-1144 phone connection: ${assertPhoneConnection(createResponsiveLayout((w,h,limit)=>raw(w,h,0,limit)))} samples`);
 console.log('PASS A-1144 phone width and toolbar invariance');
 if(process.env.ARASO_TEST_BROWSER==='1'){
  const out=process.env.A1144_OUT||mkdtempSync(path.join(tmpdir(),'araso-phone-width-'));
  mkdirSync(out,{recursive:true});
  const H=await launchHome(393,659),rows=[],height600=[];
  try{
   await showSendCard(H);
   for(const [w,h,cw]of phoneCases){
    const m=await measure(H,w,h,{settle:750});
    near(m.card.w*282/285,cw,`${w}x${h} rendered Send scale`);
    assert.ok(m.card.l>=-.5&&m.card.r<=w+.5&&m.card.t>=-.5&&m.card.b<=h+.5,`${w}x${h} Send bounds`);
    rows.push({mode:'send',...m});
    await H.p.screenshot({path:path.join(out,`send-${w}x${h}.png`)});
   }
   await H.p.evaluate(()=>document.querySelector('#stayButton')?.click());await sleep(1300);
   for(const [w,h,cw]of phoneCases){
    await H.p.setViewportSize({width:w,height:h});await sleep(750);
    assert.ok(await H.openHomePaper());await sleep(500);
    const m=await measure(H,w,h,{resize:false});
    near(m.paper.w,cw,`${w}x${h} rendered Home width`);
    assert.ok(m.paper.l>=-.5&&m.paper.r<=w+.5&&m.paper.t>=-.5&&m.paper.b<=h+.5,`${w}x${h} Home bounds`);
    rows.push({mode:'paper',...m});
    await H.p.screenshot({path:path.join(out,`paper-${w}x${h}.png`)});
   }
   const same=rows.filter(r=>r.mode==='paper'&&r.vw===393);
   near(same[0].paper.w,same[1].paper.w,'rendered toolbar height invariance');
   // Owner requested measurement of the lower-height limit; record failures
   // explicitly instead of repinning the requested width or hiding shrink.
   for(const w of [375,390,393,430]){
    await H.p.setViewportSize({width:w,height:600});await sleep(750);
    assert.ok(await H.openHomePaper());await sleep(500);
    const m=await measure(H,w,600,{resize:false});
    const expected=w<=390?282.3*w/390:282.3+(410.7-282.3)*(w-390)/420;
    height600.push({w,h:600,expected,actual:m.paper.w,shrink:expected-m.paper.w,noShrink:Math.abs(expected-m.paper.w)<.5});
    await H.p.screenshot({path:path.join(out,`paper-${w}x600.png`)});
   }
   console.log('AUDIT height600: '+JSON.stringify(height600));
   assert.deepEqual(H.errors,[]);
   console.log('PASS A-1144 actual DOM: 5 phone sizes, Home and Send, no clipping');
  }finally{writeFileSync(path.join(out,'phone.json'),JSON.stringify({rows,height600,errors:H.errors},null,2));await H.close();}
 }
}
