import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPasskeyWithPrfOutput,isMeraError} from '@category-labs/mera';
let source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
if(process.env.A1202_MUTATION==='clear_after_any_cancel')source=source.replace('createStage.value === "cancelled"', 'state.authCancelled');
if(process.env.A1202_MUTATION==='never_clear')source=source.replace('createStage.value === "cancelled"', 'false');
function fn(name){const m=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(m,name);return source.slice(m.index,source.indexOf('\n}',m.index)+2)}
const key='araso.publicCreateAttempt.v1';
function rig(mode){
 const store=new Map([[key,'attempted']]);let creates=0,gets=0;
 const client={createCredential:async()=>{creates++;if(mode==='cancel')throw new DOMException('cancelled','NotAllowedError');if(mode==='unknown')throw Error('transport uncertain');return {credentialId:new Uint8Array([1,2,3]),transports:['internal'],prfEnabled:true,...(mode==='storage'?{prfOutput:new Uint8Array(32)}:{})}},getCredential:async()=>{gets++;throw new DOMException('cancelled','NotAllowedError')}};
 const c={btoa,createPasskeyWithPrfOutput,isMeraError,Uint8Array,Promise,DOMException,Object,
 state:{},authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,
 sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 isAllowedPiggyRpId:()=>true,webAuthnUnsupported:()=>false,getRpId:()=> 'localhost',
 localTestWebAuthnOption:()=>({webAuthnClient:client}),localTestPrfSaltOption:()=>({}),
 beginAuthAttempt:()=>({live:true}),finishAuthAttempt:()=>true,setScene:()=>{},takePendingGiftClaim:()=>null,
 trackPlatformAuth:()=>{},boundAuthAttempt:(_a,p)=>p,activateSigningSession:()=>({address:'synthetic'}),
 commitIdentity:()=>{throw Error('storage failed')},toHex:()=>'',recordSafeError:()=>{},endActiveSession:()=>{},
 };
 vm.createContext(c);vm.runInContext(['a1202CreatePasskey','isCancelledAuthError','openPiggy'].map(fn).join('\n'),c);
 return {c,store,counts:()=>({creates,gets})};
}
let pass=0;
for(const [mode,retained] of [['cancel',false],['fallback',true],['unknown',true],['storage',true]]){
 const h=rig(mode);await h.c.openPiggy();assert.equal(h.store.has(key),retained,mode);assert.equal(h.counts().creates,1);if(mode==='fallback'){assert.equal(h.counts().gets,0);assert.ok(h.c.lateCreatedCredential)};
 pass++;console.log(`PASS ${mode}: marker retained=${retained}`);
}
// A1212 injects a client without mutating the browser surface, including frozen credentials.
for(const frozen of [false,true]){
 const original=()=>Promise.reject(new DOMException('cancelled','NotAllowedError'));
 const credentials=frozen?Object.freeze({create:original}):Object.create({create:original});
 const c={btoa,Uint8Array,navigator:{credentials},Promise,Object,createPasskeyWithPrfOutput};
 vm.createContext(c);vm.runInContext(fn('a1202CreatePasskey'),c);const stage={value:'unknown'};
 const pending=c.a1202CreatePasskey({rp:{id:'localhost',name:'Araso'},user:{name:'owner',displayName:'owner'}},stage);
 assert.equal(stage.value,'pending');assert.equal(credentials.create,original);
 await pending.catch(()=>{});assert.equal(stage.value,'cancelled');pass++;
}
console.log(`A1202: ${pass} PASS / 0 FAIL / 0 SKIP (SDK+VM, no real credentials)`);
