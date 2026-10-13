import assert from 'node:assert/strict';
import {createForkEntryHandler} from '../../api/fork-entry.js';
import {createUpstashInviteStore} from '../../api/_lib/invite-redis-store.js';
import {createUpstashRest} from '../../api/_lib/grant-redis-store.js';
import {fakeUpstash,FAKE_KV_URL,FAKE_KV_TOKEN} from './helpers/a960-fake-upstash.mjs';
const kv=fakeUpstash();
const store=createUpstashInviteStore({cmd:createUpstashRest({url:FAKE_KV_URL,token:FAKE_KV_TOKEN,fetchImpl:kv.fetchImpl}),now:()=>kv.clock.t,ttlMs:1000});
const handler=createForkEntryHandler({inviteStore:store,now:()=>kv.clock.t});
async function call(token,body={action:'invite_state'},headers={}){
 const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},end(s){this.body=JSON.parse(s)}};
 await handler({method:'POST',headers:{'content-type':'application/json','sec-fetch-site':'same-origin','x-araso-invite':token,...headers},body},res);return res;
}
let pass=0;async function check(n,f){await f();pass++;console.log('PASS '+n)}
const issued=await store.issue();
await check('unbound returns exactly boolean, no writes or identity disclosure',async()=>{const before=kv.dump(),n=kv.evals.length;const r=await call(issued.token);assert.equal(r.statusCode,200);assert.deepEqual(r.body,{ok:true,bound:false});assert.equal(r.headers['cache-control'],'no-store');assert.equal(kv.dump(),before);assert.equal(kv.evals.length,n)});
await check('bound stays bound after original expiry',async()=>{await store.bind({token:issued.token,piggyAddress:'0x'+'12'.repeat(20)});kv.clock.t+=2000;assert.deepEqual((await call(issued.token)).body,{ok:true,bound:true})});
await check('expired/missing/invalid use identical refusal',async()=>{const x=await store.issue();kv.clock.t+=2000;for(const t of [x.token,undefined,'bad','missing-invite-token']){const r=await call(t);assert.equal(r.statusCode,403);assert.deepEqual(r.body,{ok:false,reason:'not_invited'})}});
await check('body token/address and cross-site denied',async()=>{for(const extra of [{token:issued.token},{piggyAddress:'not-accepted'}])assert.equal((await call(issued.token,{action:'invite_state',...extra})).statusCode,400);assert.equal((await call(issued.token,undefined,{'sec-fetch-site':'cross-site'})).statusCode,403)});
await check('metadata does not open release-gated journey actions',async()=>{assert.equal((await call(issued.token,{action:'challenge'})).statusCode,503)});
await check('store unavailable fails closed without exception detail',async()=>{kv.setDown(true);assert.deepEqual((await call(issued.token)).body,{ok:false,reason:'entry_unavailable'})});
console.log(`${pass} PASS / 0 FAIL / 0 SKIP`);
