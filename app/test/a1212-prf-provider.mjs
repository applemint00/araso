import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPasskeyWithPrfOutput,isMeraError,MeraError} from '@category-labs/mera';
let src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
if(process.env.A1257_MUTATION==='drop_platform')src=src.replace('authenticatorAttachment: "platform", ','');
const fn=n=>{const m=new RegExp(`^(?:async )?function ${n}\\(`,'m').exec(src);assert.ok(m,n);return src.slice(m.index,src.indexOf('\n}',m.index)+2)};
let pass=0;async function check(n,f){await f();pass++;console.log('PASS '+n)}
function rig(mode){
 const counts={create:0,get:0,commit:0,scene:null,phase:null};const bytes=new Uint8Array([1,2,3]);
 const client={createCredential:async()=>{counts.create++;return {credentialId:bytes,transports:['internal'],prfEnabled:mode!=='unsupported',...(mode==='inline'?{prfOutput:new Uint8Array(32).fill(4)}:{})}},getCredential:()=>{throw Error('automatic get')}};
 const c={createPasskeyWithPrfOutput,isMeraError,btoa,Uint8Array,Promise,Error,console,
 state:{credential:null,address:'',freshRecoveryTried:false},authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,
 sessionStorage:{removeItem(){},setItem(){}},localStorage:{setItem(){}},PIGGY_RECEIVED_KEY:'received',
 isAllowedPiggyRpId:()=>true,webAuthnUnsupported:()=>false,getRpId:()=> 'localhost',
 localTestWebAuthnOption:()=>({webAuthnClient:client}),localTestPrfSaltOption:()=>({prfSalt:new Uint8Array(32).fill(9)}),
 beginAuthAttempt:()=>({live:true}),finishAuthAttempt:()=>true,setScene:s=>counts.scene=s,takePendingGiftClaim:()=>null,
 trackPlatformAuth:p=>p,boundAuthAttempt:(_a,p)=>p,activateSigningSession:()=>({account:{},address:'synthetic'}),
 commitIdentity:v=>{counts.commit++;c.state.credential=v.credential;c.state.address=v.address;counts.identity=v},toHex:bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''),
 recordSafeError:p=>counts.phase=p,endActiveSession(){},indexControlledPiggy(){},noteRecoverSuccess(){},noteRecoverFailure(){},hasPlayedBirth:()=>false,
 storedPrfSalt:()=>null,clearTimeout(){},INDEX_BACKUP_ADAPTER:null,restoreRecoveredFirstJourney:()=>{throw Error('new birth must not restore old journey')},
 requestPrf:(pin,{prfSalt})=>{counts.get++;assert.equal(pin.credentialId,'AQID');assert.deepEqual([...prfSalt],new Array(32).fill(9));return Promise.resolve({credentialId:'AQID',prfOutput:new Uint8Array(32).fill(4)})},
 };
 vm.createContext(c);vm.runInContext(['a1202CreatePasskey','isCancelledAuthError','openPiggy','checkPiggy','recoverPiggy'].map(fn).join('\n'),c);
 return {c,counts};
}
await check('inline PRF -> Hatch, create1/get0',async()=>{const h=rig('inline');await h.c.openPiggy();assert.equal(h.counts.scene,'hatch');assert.equal(h.counts.get,0);assert.equal(h.counts.create,1);assert.equal(h.counts.commit,1)});
await check('enabled without output -> no auto get/no identity -> explicit pinned get synchronously -> Hatch',async()=>{const h=rig('deferred');await h.c.openPiggy();assert.equal(h.counts.get,0);assert.equal(h.counts.commit,0);assert.equal(h.counts.scene,'birth');assert.equal(h.c.lateCreatedCredential.credentialId,'AQID');const p=h.c.checkPiggy();assert.equal(h.counts.get,1);await p;assert.equal(h.counts.scene,'hatch');assert.equal(h.counts.create,1);assert.equal(h.counts.identity.prfSaltHex,'09'.repeat(32));assert.equal(h.c.lateCreatedCredential,null)});
await check('unsupported PRF -> failure reason, pinned metadata and no extra creation',async()=>{const h=rig('unsupported');await h.c.openPiggy();assert.equal(h.counts.phase,'prf_unavailable');assert.equal(h.counts.scene,'birth');assert.equal(h.counts.get,0);assert.equal(h.counts.create,1);assert.equal(h.counts.commit,0);assert.equal(h.c.lateCreatedCredential.prfUnavailable,true)});
await check('pinned failure cannot fall back to another credential',async()=>{const h=rig('deferred');await h.c.openPiggy();h.c.requestPrf=()=>{h.counts.get++;return Promise.reject(new MeraError('PASSKEY_OPERATION_FAILED','failure'))};await h.c.checkPiggy();assert.equal(h.counts.get,1);assert.equal(h.counts.commit,0);assert.ok(h.c.lateCreatedCredential)});
await check('browser request: platform-only for normal eval and adaptive enable-only; no provider override',async()=>{for(const adaptive of [false,true]){let request;const c={createPasskeyWithPrfOutput,btoa,Uint8Array,Error,navigator:{credentials:{create:async r=>{request=r;return {type:'public-key',rawId:new Uint8Array([1]).buffer,response:{getTransports:()=>['internal']},getClientExtensionResults:()=>({prf:{enabled:true}})}}}}};vm.createContext(c);vm.runInContext(fn('a1202CreatePasskey'),c);const stage={};await c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'}},stage,adaptive).catch(()=>{});assert.equal('eval' in request.publicKey.extensions.prf,!adaptive);assert.equal(request.publicKey.authenticatorSelection.userVerification,'required');assert.equal(request.publicKey.authenticatorSelection.authenticatorAttachment,'platform');assert.equal(stage.value,'created');assert.ok(stage.pin)}});
await check('fresh boot accepts only a live 30-minute cross-tab marker for public and invite entry',()=>{
 const now=Date.parse('2026-10-14T11:00:00Z');
 const boot=src.slice(src.indexOf('const A1212_CREATE_ATTEMPT_TTL_MS ='),src.indexOf('// A1214:'));
 for(const invite of [null,'invite-a1254'])for(const [age,expected] of [[0,true],[30*60*1000,true],[30*60*1000+1,false]]){
  const key=invite?'araso.inviteCreateAttempt.v1.'+invite:'araso.publicCreateAttempt.v1',m=new Map([[key,String(now-age)]]),events=[];
  const localStorage={get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
  const c={Set,Number,Date:class extends Date{static now(){return now}},localStorage,readForkInvite:()=>invite,safeLocalStorage:()=>localStorage,a1158AttemptKey:v=>'araso.inviteCreateAttempt.v1.'+v,track:(...x)=>events.push(x)};
  vm.createContext(c);vm.runInContext(boot,c);
  assert.equal(c.a1212CreateEnableOnly(),expected,`${invite||'public'} age ${age}`);
  assert.deepEqual(events,expected?[['flow_error','create_lost']]:[]);
 }
 const m=new Map(),localStorage={get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
 const c={Set,Number,Date,localStorage,readForkInvite:()=>null,safeLocalStorage:()=>localStorage,a1158AttemptKey:v=>'araso.inviteCreateAttempt.v1.'+v,track(){}};
 vm.createContext(c);vm.runInContext(boot,c);m.set('araso.publicCreateAttempt.v1',String(Date.now()));
 assert.equal(c.a1212CreateEnableOnly(),false,'this boot cannot consume its own new marker');
});
await check('create writes a timestamp immediately and clears it on success, cancel, or failure for public and invite entry',async()=>{
 for(const invite of [null,'invite-a1254'])for(const outcome of ['success','cancel','failure']){
  const key=invite?'araso.inviteCreateAttempt.v1.'+invite:'araso.publicCreateAttempt.v1',m=new Map();let creates=0;
  const localStorage={get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
  const client={createCredential:async()=>{creates++;assert.ok(Number(m.get(key))>0,'timestamp exists before create');if(outcome==='cancel'){const e=Error('cancel');e.name='NotAllowedError';throw e}if(outcome==='failure')throw Error('failure');return {credentialId:new Uint8Array([1]),prfEnabled:true,prfOutput:new Uint8Array(32)}}};
  const c={createPasskeyWithPrfOutput,btoa,Uint8Array,Error,Number,Date,localStorage,readForkInvite:()=>invite,safeLocalStorage:()=>localStorage,a1158AttemptKey:v=>'araso.inviteCreateAttempt.v1.'+v,track(){}};
  vm.createContext(c);vm.runInContext(['a1212CreateAttemptKey','a1212MarkCreateAttempt','a1212ClearCreateAttempt','a1202CreatePasskey'].map(fn).join('\n'),c);
  await c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'},webAuthnClient:client},{value:'unknown'}).catch(()=>{});
  assert.equal(creates,1);assert.equal(m.has(key),false,`${invite||'public'} ${outcome}`);
 }
});
await check('mutation: removing result cleanup leaves the marker and is detected',async()=>{
 const key='araso.publicCreateAttempt.v1',m=new Map(),localStorage={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
 const c={createPasskeyWithPrfOutput,btoa,Uint8Array,Error,Number,Date,localStorage,readForkInvite:()=>null,safeLocalStorage:()=>localStorage,a1158AttemptKey:v=>'araso.inviteCreateAttempt.v1.'+v};
 vm.createContext(c);vm.runInContext(['a1212CreateAttemptKey','a1212MarkCreateAttempt','a1212ClearCreateAttempt'].map(fn).join('\n')+fn('a1202CreatePasskey').replace('if (typeof a1212ClearCreateAttempt === "function") a1212ClearCreateAttempt(createAttemptKey);','if (false) a1212ClearCreateAttempt(createAttemptKey);'),c);
 await c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'},webAuthnClient:{createCredential:async()=>({credentialId:new Uint8Array([1]),prfEnabled:true,prfOutput:new Uint8Array(32)})}},{value:'unknown'});
 assert.throws(()=>assert.equal(m.has(key),false),assert.AssertionError);
});
await check('mutation: removing deferred pin is detected',async()=>{
 const c={createPasskeyWithPrfOutput,btoa,Uint8Array,Error};vm.createContext(c);
 vm.runInContext(fn('a1202CreatePasskey').replace('if (created.prfOutput === undefined) {','if (false) {'),c);
 const stage={};await c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'},webAuthnClient:{createCredential:async()=>({credentialId:new Uint8Array([1]),prfEnabled:true})}},stage).catch(()=>{});
 assert.throws(()=>assert.ok(stage.pin),assert.AssertionError);
});
console.log(`A1212 ${pass} PASS / 0 FAIL / 0 SKIP (SDK+VM)`);
