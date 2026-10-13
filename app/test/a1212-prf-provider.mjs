import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPasskeyWithPrfOutput,isMeraError,MeraError} from '@category-labs/mera';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
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
await check('browser request: normal eval present, adaptive enable-only prf empty; no provider override',async()=>{for(const adaptive of [false,true]){let request;const c={createPasskeyWithPrfOutput,btoa,Uint8Array,Error,navigator:{credentials:{create:async r=>{request=r;return {type:'public-key',rawId:new Uint8Array([1]).buffer,response:{getTransports:()=>['internal']},getClientExtensionResults:()=>({prf:{enabled:true}})}}}}};vm.createContext(c);vm.runInContext(fn('a1202CreatePasskey'),c);const stage={};await c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'}},stage,adaptive).catch(()=>{});assert.equal('eval' in request.publicKey.extensions.prf,!adaptive);assert.equal(request.publicKey.authenticatorSelection.userVerification,'required');assert.equal(request.publicKey.authenticatorSelection.authenticatorAttachment,undefined);assert.equal(stage.value,'created');assert.ok(stage.pin)}});
await check('boot snapshot ignores newly written marker, accepts prior marker for same invite only',()=>{const m=new Map(),sessionStorage={get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)};const boot=src.slice(src.indexOf('const a1212PriorCreateAttempts ='),src.indexOf('// A1202/A1212:'));for(const prior of [false,true]){m.clear();if(prior)m.set('araso.publicCreateAttempt.v1','attempted');const c={Set,sessionStorage,readForkInvite:()=>null,safeLocalStorage:()=>null};vm.createContext(c);vm.runInContext(boot,c);m.set('araso.publicCreateAttempt.v1','attempted');assert.equal(c.a1212CreateEnableOnly(),prior)}});
await check('mutation: removing deferred pin is detected',async()=>{
 const c={createPasskeyWithPrfOutput,btoa,Uint8Array,Error};vm.createContext(c);
 vm.runInContext(fn('a1202CreatePasskey').replace('if (created.prfOutput === undefined) {','if (false) {'),c);
 const stage={};await c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'},webAuthnClient:{createCredential:async()=>({credentialId:new Uint8Array([1]),prfEnabled:true})}},stage).catch(()=>{});
 assert.throws(()=>assert.ok(stage.pin),assert.AssertionError);
});
console.log(`A1212 ${pass} PASS / 0 FAIL / 0 SKIP (SDK+VM)`);
