import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sceneOracle} from './helpers/a837-sweep.mjs';
import {a911Z,a911SideM,a911Bottom} from '../src/a911-screens.js';
const O=sceneOracle();
for(const height of [659,800,900]){
 let prev;
 for(let width=800;width<=2560;width++){
  const L=O.L(width,height),r=O.ret(L),n=O.name(L,width,height);
  assert.ok(r.top-.09*r.rh>=L.asBottom, `Read Receipt covers brand ${width}x${height}`);
  if(prev){assert.ok(r.rw>=prev.rw-.01,`Receipt shrink ${width}x${height}`);assert.ok(Math.abs(r.top-prev.top)<2,`Receipt y jump ${width}x${height}`);assert.ok(n.cardW>=prev.nameW-.01,`Name shrink ${width}x${height}`);}
  prev={...r,nameW:n.cardW};
 }
}
for(const width of [1440,1940,2560]){
 const a=O.L(width,1080),b=O.L(width,1440),na=O.name(a,width,1080),nb=O.name(b,width,1440),ra=O.ret(a),rb=O.ret(b);
 assert.equal(na.cardW,nb.cardW);assert.ok(Math.abs(nb.cardTop-na.cardTop-180)<1e-8);
 assert.equal(ra.rw,rb.rw);assert.ok(Math.abs(rb.top-ra.top-180)<1e-8);
}
assert.ok(Math.abs(a911Z(1940)/a911Z(1440)-1.05)<1e-9);
assert.equal(a911Z(2560),a911Z(1940));
assert.ok(Math.abs(a911SideM(2560)-a911SideM(1940)-310)<1e-9);
assert.ok(Math.abs(a911Bottom(1940,1440)-a911Bottom(1940,1080)-180)<1e-9);
const css=fs.readFileSync(new URL('../src/style.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
assert.doesNotMatch(css,/\.secondJourneyCard[^{}]*\{[^}]*width:\s*380px/,'Second readiness must retain the same paper');
console.log('PASS responsive consumers: monotonic Name/Receipt, continuous Receipt placement, centred large frames, own-screen cap, same Second paper');
