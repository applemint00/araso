// A1160 actual app entry functions, deterministic metadata/auth spies. No real WebAuthn.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
let source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
if(process.env.A1160_MUTATION==='disable_public') source=source.replace('return RELEASE_LEVEL >= 2 && state.publicEntryOpen === true;', 'return false;');
function fn(name){const m=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(m);return source.slice(m.index,source.indexOf('\n}',m.index)+2)}
function rig({level=2,reply={ok:true,publicEntry:true},identity=false,createReply={ok:true}}={}){
 const calls={fetch:0,create:0,get:0,render:0},map=new Map();
 const c={RELEASE_LEVEL:level,state:{address:identity?'existing':''},authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,AbortController,setTimeout,clearTimeout,
  sessionStorage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},readForkInvite:()=>null,safeLocalStorage:()=>null,readCredential:()=>null,hasReceivedPiggy:()=>false,
  fetch:async(url,options)=>{calls.fetch++;assert.equal(url,'/api/fork-entry');assert.deepEqual(JSON.parse(options.body),{action:'public_state'});if(reply===null)throw Error('offline');return {ok:true,json:async()=>reply}},
  openPiggy:()=>{calls.create++;return Promise.resolve(createReply)},checkPiggy:()=>{calls.get++;return Promise.resolve({ok:false})},render:()=>{calls.render++},
 };
 vm.createContext(c);vm.runInContext(['a1160PublicEntryOpen','a1160TakePublicCreate','a1160RefreshPublicEntry','inviteOnlyEntry','startPiggyOpen'].map(fn).join('\n'),c);
 return {c,calls};
}
let pass=0;async function check(name,run){await run();pass++;console.log('PASS '+name)}
await check('level2 public OFF/unknown stays static; no create/get even before metadata returns',async()=>{
 for(const reply of [null,{ok:true,publicEntry:false},{ok:true,publicEntry:'true'}]){const h=rig({reply});assert.equal(h.c.inviteOnlyEntry(),true);await h.c.a1160RefreshPublicEntry();await h.c.startPiggyOpen();assert.equal(h.calls.create,0);assert.equal(h.calls.get,0)}
});
await check('public ON new device: first tap creates immediately, no tap-time network/get; cancelled/failed next tap creates',async()=>{
 for(const createReply of [{ok:false},null]){
 const h=rig({createReply});await h.c.a1160RefreshPublicEntry();assert.equal(h.c.inviteOnlyEntry(),false);const result=h.c.startPiggyOpen();assert.deepEqual(h.calls,{fetch:1,create:1,get:0,render:1});await result;await h.c.startPiggyOpen();assert.equal(h.calls.create,2);assert.equal(h.calls.get,0);assert.equal(h.calls.fetch,1);
 h.c.state.address="created";await h.c.startPiggyOpen();assert.equal(h.calls.create,2);assert.equal(h.calls.get,1);
 }
});
await check('existing Piggy recovers; level1 and active/late creation never direct create',async()=>{
 const h=rig({identity:true});await h.c.a1160RefreshPublicEntry();await h.c.startPiggyOpen();assert.equal(h.calls.get,1);assert.equal(h.calls.create,0);
 const low=rig({level:1});await low.c.a1160RefreshPublicEntry();await low.c.startPiggyOpen();assert.equal(low.calls.create,0);
 for(const field of ['authAttempt','platformAuthInflight','lateCreatedCredential']){const t=rig();await t.c.a1160RefreshPublicEntry();t.c[field]={};await t.c.startPiggyOpen();assert.equal(t.calls.create,0)}
});
console.log(`A1160 app: ${pass} PASS / 0 FAIL`);
