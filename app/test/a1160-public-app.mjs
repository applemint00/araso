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
  sessionStorage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},readForkInvite:()=>null,a1209EntryInvite:()=>null,safeLocalStorage:()=>null,readCredential:()=>null,hasReceivedPiggy:()=>false,
  fetch:async(url,options)=>{calls.fetch++;assert.equal(url,'/api/fork-entry');assert.deepEqual(JSON.parse(options.body),{action:'public_state'});if(reply===null)throw Error('offline');return {ok:true,json:async()=>reply}},
  openPiggy:()=>{calls.create++;return Promise.resolve(createReply)},checkPiggy:()=>{calls.get++;return Promise.resolve({ok:false})},render:()=>{calls.render++},
 };
 vm.createContext(c);vm.runInContext(['a1160PublicEntryOpen','a1160TakePublicCreate','a1160RefreshPublicEntry','inviteOnlyEntry','startPiggyOpen'].map(fn).join('\n'),c);
 return {c,calls,map};
}
let pass=0;async function check(name,run){await run();pass++;console.log('PASS '+name)}
await check('level2 public OFF/unknown stays static; no create/get even before metadata returns',async()=>{
 for(const reply of [null,{ok:true,publicEntry:false},{ok:true,publicEntry:'true'}]){const h=rig({reply});assert.equal(h.c.inviteOnlyEntry(),true);await h.c.a1160RefreshPublicEntry();await h.c.startPiggyOpen();assert.equal(h.calls.create,0);assert.equal(h.calls.get,0)}
});
await check('public ON: uncertain create retains marker across reload; recovery cancellation allows next explicit create',async()=>{
 const h=rig({createReply:null});await h.c.a1160RefreshPublicEntry();
 await h.c.startPiggyOpen();assert.equal(h.calls.create,1);assert.equal(h.map.get('araso.publicCreateAttempt.v1'),'attempted');
 // Fresh JS state with the same tab storage.
 const reloaded=rig();for(const [k,v] of h.map)reloaded.map.set(k,v);
 await reloaded.c.a1160RefreshPublicEntry();
 reloaded.c.checkPiggy=()=>{reloaded.calls.get++;return Promise.resolve({ok:false,cancelled:true})};
 await reloaded.c.startPiggyOpen();assert.equal(reloaded.calls.get,1);assert.equal(reloaded.calls.create,0);
 await reloaded.c.startPiggyOpen();assert.equal(reloaded.calls.create,1);assert.equal(reloaded.calls.fetch,1);
 reloaded.c.state.address='created';await reloaded.c.startPiggyOpen();assert.equal(reloaded.calls.create,1);assert.equal(reloaded.calls.get,2);
});
await check('existing Piggy recovers; level1 and active/late creation never direct create',async()=>{
 const h=rig({identity:true});await h.c.a1160RefreshPublicEntry();await h.c.startPiggyOpen();assert.equal(h.calls.get,1);assert.equal(h.calls.create,0);
 const low=rig({level:1});await low.c.a1160RefreshPublicEntry();await low.c.startPiggyOpen();assert.equal(low.calls.create,0);
 for(const field of ['authAttempt','platformAuthInflight','lateCreatedCredential']){const t=rig();await t.c.a1160RefreshPublicEntry();t.c[field]={};await t.c.startPiggyOpen();assert.equal(t.calls.create,0)}
});
console.log(`A1160 app: ${pass} PASS / 0 FAIL`);
