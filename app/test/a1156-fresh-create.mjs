import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {keccak256} from 'viem';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const begin=src.indexOf('async function startPiggyOpen()');
const fn=src.slice(begin,src.indexOf('\n}\n',begin)+2);
let pass=0;
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
function tab(shared,invite='test-invite-one',existing=false){
 const localStorage=storage();localStorage.setItem('araso.forkInvite.v1',invite);
 const state={address:existing?'existing':'',freshRecoveryTried:false};const calls={get:0,create:0};
 const ctx=vm.createContext({state,sessionStorage:shared,localStorage,TextEncoder,keccak256,location:{pathname:'/',search:'?i=test'},FRESH_DEVICE_RECOVERY_FIRST:true,
 readCredential:()=>null,hasReceivedPiggy:()=>false,checkPiggy:async()=>{calls.get++;return {ok:false,cancelled:true}},openPiggy:async()=>{calls.create++}});
 return {state,calls,open:vm.runInContext(`(${fn})`,ctx)};
}
async function check(name,f){await f();pass++;console.log('PASS '+name)}
await check('cancel get does not create; same-document second explicit tap creates',async()=>{const d=tab(storage());await d.open();assert.deepEqual(d.calls,{get:1,create:0});await d.open();assert.deepEqual(d.calls,{get:1,create:1})});
await check('same invite reload preserves next explicit create',async()=>{const s=storage();const a=tab(s);await a.open();const b=tab(s);await b.open();assert.deepEqual(b.calls,{get:0,create:1})});
await check('different invite still finds first',async()=>{const s=storage();await tab(s).open();const b=tab(s,'different-invite');await b.open();assert.deepEqual(b.calls,{get:1,create:0})});
await check('existing identity always finds even with ready creation marker',async()=>{const s=storage();await tab(s).open();const b=tab(s,'test-invite-one',true);await b.open();await b.open();assert.deepEqual(b.calls,{get:2,create:0})});
await check('creation consumes retry before call; reload finds first if identity save never finishes',async()=>{const s=storage();await tab(s).open();await tab(s).open();const c=tab(s);await c.open();assert.deepEqual(c.calls,{get:1,create:0})});
console.log(`${pass} PASS / 0 FAIL / 0 SKIP`);
