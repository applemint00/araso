import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {keccak256} from 'viem';
const src=readFileSync(process.env.A1158_MAIN_PATH || new URL('../src/main.js',import.meta.url),'utf8');
const i=src.indexOf('async function startPiggyOpen()'),fn=src.slice(i,src.indexOf('\n}\n',i)+2);
const helpers=src.slice(src.indexOf('let a1223BoundInvite'),src.indexOf('void a1158PrefetchInvite();'));
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
function tab({reply={ok:true,bound:false},existing=false,invite='synthetic-invite-1158',shared=storage(),pending=false}={}){
 const state={address:existing?'existing':'',freshRecoveryTried:false},calls={get:0,create:0,fetch:0};let resolve;
 const ctx=vm.createContext({state,sessionStorage:shared,localStorage:{getItem:()=>invite},safeLocalStorage:()=>null,a960ReadInvite:()=>invite,TextEncoder,keccak256,Date,AbortController,setTimeout,clearTimeout,authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,location:{pathname:'/',search:''},FRESH_DEVICE_RECOVERY_FIRST:true,readCredential:()=>null,hasReceivedPiggy:()=>false,
 fetch:async(url,init)=>{calls.fetch++;assert.equal(url,'/api/fork-entry');assert.deepEqual(JSON.parse(init.body),{action:'invite_state'});if(pending)await new Promise(r=>resolve=r);if(reply===null)throw Error('offline');return {ok:true,json:async()=>reply}},
 checkPiggy:async()=>{calls.get++;return {ok:false,cancelled:true}},openPiggy:async()=>{calls.create++;}});
 vm.runInContext(helpers+'\n'+fn,ctx);
 return {calls,state,shared,ctx,prefetch:()=>vm.runInContext('a1158PrefetchInvite()',ctx),open:()=>vm.runInContext('startPiggyOpen()',ctx),resolve:()=>resolve()};
}
let pass=0;async function check(n,f){await f();pass++;console.log('PASS '+n)}
await check('unbound first tap calls create synchronously with no tap-time fetch',async()=>{const d=tab();await d.prefetch();const result=d.open();assert.deepEqual(d.calls,{get:0,create:1,fetch:1});await result});
await check('used invite blocks auth; offline/malformed keep get-first',async()=>{for(const reply of [{ok:true,bound:true},null,{ok:true,bound:'false'},{ok:false,bound:false}]){const d=tab({reply});await d.prefetch();await d.open();assert.equal(d.calls.get,reply?.bound===true?0:1);assert.equal(d.calls.create,0)}});
await check('existing identity checks stored invite metadata; no invite never prefetches',async()=>{for(const opts of [{existing:true},{invite:null}]){const d=tab(opts);await d.prefetch();await d.open();assert.deepEqual(d.calls,{get:1,create:0,fetch:opts.existing?1:0})}});
await check('A1223 pending metadata blocks early tap, then unbound permits create',async()=>{const d=tab({pending:true});const p=d.prefetch();await d.open();assert.equal(d.calls.get+d.calls.create,0);d.resolve();await p;await d.open();assert.equal(d.calls.create,1)});
await check('uncertain creation reload preserves recovery before another create',async()=>{const a=tab();await a.prefetch();await a.open();const b=tab({shared:a.shared});await b.prefetch();await b.open();assert.deepEqual(b.calls,{get:1,create:0,fetch:1});await b.open();assert.equal(b.calls.create,1)});
await check('late-created or platform-active protection wins over metadata',async()=>{for(const field of ['lateCreatedCredential','platformAuthInflight']){const d=tab();await d.prefetch();d.ctx[field]={};await d.open();assert.equal(d.calls.create,0);assert.equal(d.calls.get,1)}});
await check('invite hint remains valid ten minutes later, still one use',async()=>{const d=tab();await d.prefetch();d.ctx.Date={now:()=>Date.now()+10*60*1000};await d.open();assert.equal(d.calls.create,1);await d.open();assert.equal(d.calls.create,1);assert.equal(d.calls.get,1)});
console.log(`${pass} PASS / 0 FAIL / 0 SKIP`);
