import assert from 'node:assert/strict';
import {layoutOracle} from './helpers/a831-sweep.mjs';
import {responsiveFrame} from '../src/responsive-layout.js';

// Independent reference expectations: A-829 side/floor/brand anchors and
// Owner's later 1940/+5% cap. Never derive these from the fitted card budget.
const layout=layoutOracle();
let count=0;
for(const h of [568,600,659,700,800,844,900,1080,1440]){
 let prev;
 for(let w=390;w<=2560;w++){
  const a=layout(w,h),f=responsiveFrame(w,h),x=f.width;
  const side=x<=810?20+32*(x-390)/420:52+68*(x-810)/630;
  const bottom=x<=810?.071+.009*(x-390)/420:.08;
  const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-6,`${w}x${h} ${label}: ${actual} / ${expected}`);
  near(a.M,f.x+side*f.scale,'left margin');
  near(a.stageLeft+a.stageW,w-a.M,'right character edge');
  near(a.floorY,f.y+f.height*(1-bottom)*f.scale,'floor');
  near(a.asTop,2*a.asFont+f.y,'brand top');
  assert.ok(a.cardX>=a.M-.01,`${w}x${h} paper left margin`);
  assert.ok(a.cardX+a.cardW<=w-a.M+.01,`${w}x${h} paper right margin`);
  if(prev)assert.ok(Math.abs(a.cardY-prev.cardY)<1.6,`${w}x${h} paper y step`);
  prev=a;count++;
 }
}
assert.ok(Math.abs(layout(393,659).cardW-283.217)<.5,'A-1144: 393x659 follows the phone width key');
console.log(`PASS four-edge reference and vertical continuity: ${count} sizes`);
