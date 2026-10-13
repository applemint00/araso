import assert from 'node:assert/strict';
import {sceneOracle} from './helpers/a837-sweep.mjs';
const O=sceneOracle();
let count=0;
for(const h of [568,659,800,900,1080,1440]){
 let prev=null;
 for(let w=320;w<=2560;w++){
  const L=O.L(w,h),n=O.name(L,w,h);
  const left=(w-n.cardW)/2,bottom=n.cardTop+n.cardW*300/460;
  const chogRight=n.chogLeft+107.6*n.chogG,chogTop=h-n.chogBottom-139.9*n.chogG;
  const gap=12*L.S;
  assert.ok(n.cardW>1,`Name infeasible ${w}x${h}`);
  assert.ok(left>=chogRight+gap-.02||bottom<=chogTop-gap+.02,`Name/Chog collision ${w}x${h}: left=${left}, right=${chogRight}, bottom=${bottom}, top=${chogTop}`);
  if(prev){assert.ok(n.cardW>=prev.cardW-.001,`Name shrinks ${w}x${h}`);assert.ok(n.cardW/prev.cardW<=1.01,`Name width step ${w}x${h}`);}
  prev=n;count++;
 }
}
console.log(`PASS Name card: ${count} sizes, no Chog intersection, monotonic width, <=1% adjacent growth`);
