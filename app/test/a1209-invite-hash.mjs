import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {takeInviteFromHash,storeInvite,readForkInvite} from '../src/fork-entry-client.js';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf('let a1209Invite ='),src.indexOf('// [A-1158] Read before'));
const i=src.indexOf('function inviteOnlyEntry('),entry=src.slice(i,src.indexOf('\n}',i)+2);
const token='synthetic-invite-a1209',hash='#invite='+token+'&g=keep&t=keep&v=1';
function boot({mode='ok',url=hash,source=block}={}){
 const map=new Map(),frames=[];let writes=0,replaces=0;
 const storage={getItem:k=>mode==='mismatch'?null:map.get(k)??null,setItem(k,v){writes++;if(mode==='throw')throw Error('blocked');map.set(k,v)},removeItem:k=>map.delete(k)};
 const c={location:{hash:url,pathname:'/',search:'?i=display'},history:{replaceState(a,b,url){replaces++;c.location.hash=url.includes('#')?url.slice(url.indexOf('#')):''}},safeLocalStorage:()=>storage,a960TakeInviteFromHash:takeInviteFromHash,a960StoreInvite:storeInvite,a960ReadInvite:readForkInvite,requestAnimationFrame:f=>frames.push(f),a1160PublicEntryOpen:()=>false,readCredential:()=>null,hasReceivedPiggy:()=>false,state:{address:null}};
 vm.createContext(c);vm.runInContext(source+'\n'+entry,c);
 return {c,frames,map,get writes(){return writes},get replaces(){return replaces},frame:()=>frames.shift()?.(),entry:()=>c.inviteOnlyEntry()};
}
let pass=0;const check=(n,f)=>{f();pass++;console.log('PASS '+n)};
check('persist+readback before two frames; Gift/query intact',()=>{const d=boot();assert.equal(d.replaces,0);assert.equal(d.entry(),false);d.frame();assert.equal(d.replaces,0);d.frame();assert.equal(d.replaces,1);assert.equal(d.c.location.hash,'#g=keep&t=keep&v=1')});
check('throw/mismatch retain hash, show envelope, retry persistence',()=>{for(const mode of ['throw','mismatch']){const d=boot({mode});assert.equal(d.entry(),false);assert.ok(d.writes>=2);d.frame();d.frame();assert.equal(d.replaces,0);assert.equal(d.c.location.hash,hash)}});
check('restart before first paint with lost storage retains invitation',()=>{const first=boot();assert.equal(first.replaces,0);const second=boot({url:first.c.location.hash,mode:'throw'});assert.equal(second.entry(),false);assert.equal(second.c.location.hash,hash)});
check('lost readback before cleanup and changed URL cannot erase link',()=>{for(const change of ['lost','url']){const d=boot();if(change==='lost')d.map.clear();else d.c.location.hash='#invite=another-synthetic-invite';d.frame();d.frame();assert.equal(d.replaces,0)}});
check('missing or malformed invitation remains invite-only',()=>{for(const url of ['', '#invite=bad']){const d=boot({url});assert.equal(d.entry(),true);assert.equal(d.replaces,0)}});
check('mutation: removing persistence condition is caught',()=>{const bad=block.replace('stored && a960ReadInvite(safeLocalStorage()) === a960Taken.token','true').replace('location.hash === originalHash && a960ReadInvite(safeLocalStorage()) === a960Taken.token','true');const d=boot({mode:'throw',source:bad});d.frame();d.frame();assert.throws(()=>assert.equal(d.replaces,0),assert.AssertionError)});
console.log(`A1209 ${pass} PASS / 0 FAIL / 0 SKIP (synthetic tokens only)`);
