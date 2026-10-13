import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {keccak256} from 'viem';
import {createPasskeyWithPrfOutput,isMeraError} from '@category-labs/mera';
let source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
if(process.env.A1202_MUTATION==='clear_after_any_cancel')source=source.replace('createStage.value === "cancelled"', 'state.authCancelled');
if(process.env.A1202_MUTATION==='never_clear')source=source.replace('createStage.value === "cancelled"', 'false');
function fn(name){const m=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(m,name);return source.slice(m.index,source.indexOf('\n}',m.index)+2)}
const invite='synthetic-invite-a1210',fingerprint=keccak256(new TextEncoder().encode(invite));
const key='araso.inviteCreateAttempt.v1.'+fingerprint,retry='araso.freshCreate.v1.'+fingerprint;
function rig(mode,mutate=false){
 const store=new Map([[key,'attempted']]);let creates=0,gets=0;
 const client={createCredential:async()=>{creates++;if(mode==='cancel')throw new DOMException('cancelled','NotAllowedError');if(mode==='unknown')throw Error('transport uncertain');return {credentialId:new Uint8Array([1,2,3]),transports:['internal'],prfEnabled:true,...(mode==='storage'?{prfOutput:new Uint8Array(32)}:{})}},getCredential:async()=>{gets++;throw new DOMException('cancelled','NotAllowedError')}};
 const c={TextEncoder,keccak256,FRESH_DEVICE_RECOVERY_FIRST:true,location:{pathname:'/',search:''},
 readForkInvite:()=>invite,safeLocalStorage:()=>null,readCredential:()=>null,hasReceivedPiggy:()=>false,
 localStorage:{getItem:()=>invite},checkPiggy:async()=>{gets++;return {ok:false,cancelled:true}},
 createPasskeyWithPrfOutput,isMeraError,Uint8Array,Promise,DOMException,Object,
 state:{},authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,
 sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 isAllowedPiggyRpId:()=>true,webAuthnUnsupported:()=>false,getRpId:()=> 'localhost',
 localTestWebAuthnOption:()=>({webAuthnClient:client}),localTestPrfSaltOption:()=>({}),
 beginAuthAttempt:()=>({live:true}),finishAuthAttempt:()=>true,setScene:()=>{},takePendingGiftClaim:()=>null,
 trackPlatformAuth:()=>{},boundAuthAttempt:(_a,p)=>p,activateSigningSession:()=>({address:'synthetic'}),
 commitIdentity:()=>{throw Error('storage failed')},toHex:()=>'',recordSafeError:()=>{},endActiveSession:()=>{},
 };
 vm.createContext(c);vm.runInContext(['a1202CreatePasskey','isCancelledAuthError','openPiggy','startPiggyOpen','a1158AttemptKey'].map(fn).join('\n').replace(mutate?'createStage.value === \"cancelled\"':'MUTATION_DISABLED','false'),c);
 return {c,store,counts:()=>({creates,gets})};
}
let pass=0;
for(const mode of ['cancel','fallback','unknown']){
 const h=rig(mode);await h.c.openPiggy();
 assert.equal(h.store.get(retry),mode==='cancel'?'ready':undefined,mode);
 const before=h.counts();await h.c.startPiggyOpen();const after=h.counts();
 assert.equal(after.creates-before.creates,mode==='cancel'?1:0,mode);
 assert.equal(after.gets-before.gets,mode==='cancel'?0:1,mode);
 pass++;console.log('PASS '+mode+' next tap routing');
}
{
 const h=rig('cancel');await h.c.openPiggy();h.c.state.freshRecoveryTried=false;
 await h.c.startPiggyOpen();assert.equal(h.counts().gets,0);pass++;console.log('PASS retry survives reset of in-memory choice');
}
{
 const h=rig('cancel',true);await h.c.openPiggy();await h.c.startPiggyOpen();
 assert.throws(()=>assert.equal(h.counts().gets,0),assert.AssertionError);pass++;console.log('PASS mutation removing confirmed-cancel handling is caught');
}
console.log(`A1210 ${pass} PASS / 0 FAIL / 0 SKIP (SDK+VM)`);
