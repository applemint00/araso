// A1160: real service, client and Redis adapters; offline RPC/Admin/Redis transport.
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fakeUpstash } from './helpers/a960-fake-upstash.mjs';
import { publicEntryConfig } from '../../api/_lib/public-entry.js';
import { createForkEntryService, upstashForkEntryParts, JOURNEY1 } from '../../api/_lib/fork-entry.js';
import { createForkEntryHandler } from '../../api/fork-entry.js';
import { requestForkEntry, checkForkPermission } from '../src/fork-entry-client.js';
const origin='https://app.example.test', instance='public-test-fork';
const abi=parseAbi(['function deposit(uint256 assets,address receiver) payable returns(uint256)','function redeem(uint256 shares,address receiver,address owner) returns(uint256)']);
const h=n=>'0x'+n.toString(16).padStart(64,'0');
const account=()=>privateKeyToAccount(generatePrivateKey());
let pass=0;async function test(n,run){await run();pass++;console.log('PASS '+n)}
function rig({enabled=true,cap=2}={}) {
 const kv=fakeUpstash(), env={UPSTASH_REDIS_REST_URL:kv.url,UPSTASH_REDIS_REST_TOKEN:kv.token,ARASO_PUBLIC_ENTRY:enabled?'1':'0',ARASO_PUBLIC_GRANT_CAP:String(cap)};
 const parts=upstashForkEntryParts(env,{fetchImpl:kv.fetchImpl}), txs=new Map(), topups=new Map();let seq=10, current=instance, rpcCalls=0;
 const j1=who=>{
  const piggy=who.address.toLowerCase(),dep=h(seq++),red=h(seq++);
  for(const [hash,input,block] of [[dep,encodeFunctionData({abi,functionName:'deposit',args:[1n,piggy]}),1],[red,encodeFunctionData({abi,functionName:'redeem',args:[1n,piggy,piggy]}),2]]) txs.set(hash,{tx:{hash,from:piggy,to:JOURNEY1.target,input,chainId:'0x279f'},rc:{transactionHash:hash,from:piggy,to:JOURNEY1.target,status:'0x1',blockNumber:'0x'+block}});
  return {depositTxHash:dep,redeemTxHash:red};
 };
 const testnetRpc=async(method,params)=>{rpcCalls++;if(method==='eth_chainId')return '0x279f';const t=txs.get(params[0]);return method==='eth_getTransactionByHash'?t?.tx:t?.rc};
 const admin={instance:async()=>({ok:true,forkInstanceId:current,chainId:31337143}),topup:async({piggyAddress,asset,grantVersion})=>{const key=[current,piggyAddress,asset,grantVersion].join(':');const noop=topups.has(key);topups.set(key,true);return {ok:true,amountRaw:'1',forkInstanceId:current,noop}}};
 const make=()=>createForkEntryService({config:{appOrigin:origin,grantVersion:'v1',invites:parts.invites,publicEntry:parts.publicEntry,publicBudget:parts.publicBudget},store:parts.store,challenges:parts.challenges,admin,testnetRpc,now:()=>kv.clock.t});
 const services=[make(),make()];let index=0;
 const handlers=services.map(service=>createForkEntryHandler({service,inviteStore:parts.invites,publicEntry:publicEntryConfig(env),allowedOrigins:[origin],now:()=>kv.clock.t}));
 const fetchImpl=async(_url,init)=>{
  const req={method:'POST',headers:{...init.headers,origin,'sec-fetch-site':'same-origin'},body:JSON.parse(init.body)};
  let json;const res={statusCode:0,setHeader(){},end:body=>{json=JSON.parse(body)}};
  await handlers[index++%2](req,res);return {status:res.statusCode,ok:res.statusCode===200,json:async()=>json};
 };
 const enter=(who,journey1,invite=null,publicEntry=true)=>requestForkEntry({fetchImpl,invite,publicEntry,piggyAddress:who.address,journey1,origin,now:()=>kv.clock.t,signMessage:message=>who.signMessage({message})});
 return {kv,parts,services,enter,j1,fetchImpl,topups,txs,rpcCalls:()=>rpcCalls,setInstance:v=>{current=v}};
}
await test('public client -> signed challenge -> server Journey1 -> one capped topup bundle, repeat idempotent',async()=>{
 const r=rig({cap:1}),who=account(),p=r.j1(who);
 assert.equal((await r.enter(who,p)).allowed,true);const count=r.topups.size;assert.ok(count>0);
 assert.equal((await r.enter(who,p)).allowed,true);assert.equal(r.topups.size,count);
 assert.equal((await checkForkPermission({fetchImpl:r.fetchImpl,publicEntry:true,piggyAddress:who.address,forkInstanceId:instance})).allowed,true);
 const other=account();assert.equal((await r.enter(other,r.j1(other))).reason,'public_cap_reached');assert.equal(r.topups.size,count);
 // Cap persists across new fork instances; no free new bundle just because the instance changed.
 r.setInstance('new-instance');assert.equal((await r.enter(who,p)).reason,'public_cap_reached');
});
await test('two server instances race: public cap admits exactly two identities',async()=>{
 const r=rig({cap:2}),people=Array.from({length:8},account);
 const answers=await Promise.all(people.map(w=>r.enter(w,r.j1(w))));assert.equal(answers.filter(a=>a.allowed).length,2);
});
await test('switch OFF / cap missing closes public; invited path still works when public quota exhausted',async()=>{
 for(const opts of [{enabled:false},{cap:0}]){const r=rig(opts),w=account();assert.equal((await r.enter(w,r.j1(w))).allowed,false);assert.equal(r.topups.size,0)}
 const r=rig({cap:1}),a=account();await r.enter(a,r.j1(a));
 const invited=account(),t=await r.parts.invites.issue();assert.equal(t.ok,true);
 assert.equal((await r.enter(invited,r.j1(invited),t.token)).allowed,true);
});
await test('wrong signer / forged Journey1 / invalid invite cannot reserve quota or top up',async()=>{
 const r=rig({cap:1}),a=account(),b=account(),p=r.j1(a);
 const challenge=await r.services[0].challenge({piggyAddress:a.address});assert.equal(challenge.ok,true);
 const signature=await b.signMessage({message:challenge.message});
 const bad=await r.services[1].enter({piggyAddress:a.address,nonce:challenge.nonce,signature,journey1:p});assert.equal(bad.allowed,false);assert.equal(r.topups.size,0);
 assert.equal((await r.enter(b,p)).allowed,false);assert.equal(r.topups.size,0);
 assert.equal((await r.enter(a,p,'invalid-present-token')).allowed,false);
 assert.equal((await r.enter(a,p)).allowed,true); // negatives consumed no public slot
});
await test('public flag metadata exposes one boolean and fails closed; unknown body fields rejected',async()=>{
 for(const [opts,expected] of [[{},true],[{enabled:false},false],[{cap:0},false]]){
  const r=rig(opts);const response=await r.fetchImpl('',{headers:{'content-type':'application/json'},body:JSON.stringify({action:'public_state'})});assert.deepEqual(await response.json(),{ok:true,publicEntry:expected});
  const bad=await r.fetchImpl('',{headers:{'content-type':'application/json'},body:JSON.stringify({action:'public_state',cap:999})});assert.equal(bad.status,400);
 }
});
console.log(`A1160 public: ${pass} PASS / 0 FAIL (mock transports, no live auth/tx)`);
