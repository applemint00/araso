import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const view=readFileSync(new URL('../src/return-view.js',import.meta.url),'utf8');
const start=main.indexOf('function returnFitBoard(');
const adapter=main.slice(start,main.indexOf('\nfunction computeHomeFloorViewportNudge',start));
const fs=view.indexOf('  const fit = (motion = null) => {');
const fitter=view.slice(fs,view.indexOf('\n  fit(play ?',fs));
for(const dpr of [1,2,3])for(const dx of [-49,62.5,179.6]){
 let writes=0,pw=0,ph=0,dom;
 const canvas={style:{},get width(){return pw},set width(v){writes++;pw=v},get height(){return ph},set height(v){writes++;ph=v}};
 const c={canvas,window:{innerWidth:390,innerHeight:844,devicePixelRatio:dpr},BOARD_W:1256,BOARD_H:772,HOME_CENTER:1041,HOME_FLOOR:648,
  hkClamp:(x,a,b)=>Math.max(a,Math.min(b,x)),fitHomeBoard:()=>({left:-498,top:280,s:.78}),returnLayout:()=>({dxChar:dx,dyChar:10}),
  applyHomeFloorToReturnCluster:(_f,x,y)=>{dom={x,y};return null},computeHomeFloorViewportNudge:()=>null,
  keyframeCanvasFloor:()=>({k:.78/(390/1256),nudgeViewportX:0,nudgeViewportY:0})};
 vm.createContext(c);vm.runInContext(adapter+'\nconst fitBoard=returnFitBoard;\n'+fitter+'\nglobalThis.run=fit;globalThis.adapt=returnFitBoard;',c);
 c.run();const initial={x:parseFloat(canvas.style.left),y:parseFloat(canvas.style.top),w:pw,h:ph};
 const initialWrites=writes;
 for(let i=0;i<=100;i++){
  const settle=i/100;c.run({settle});
  assert.equal(writes,initialWrites,'live translation must not reset canvas pixels');
  assert.ok(Math.abs(parseFloat(canvas.style.left)-(initial.x-dx*settle))<1e-8);
  assert.ok(Math.abs(parseFloat(canvas.style.top)-(initial.y-10*settle))<1e-8);
  assert.equal(dom.x,dx*(1-settle));assert.equal(dom.y,10*(1-settle));
 }
 assert.equal(c.adapt({settle:1}).floor.nudgeViewportX,0);
 assert.equal(c.adapt().floor.nudgeViewportX,dx,'receipt gate default preserved');
}
console.log('PASS shared Return/Home translation, constant backing store, default gate and final endpoint (DPR1/2/3)');
