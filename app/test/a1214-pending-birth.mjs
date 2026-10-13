import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPasskeyWithPrfOutput,isMeraError} from '@category-labs/mera';
import {prfSaltFromHex} from '../src/piggy-session.js';
const toHex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
import {loadMyPiggiesIndex,registerControlledPiggy,markBornPiggyIssuance} from '../src/piggy-index.js';
import {bindGiftToNewPiggy,GIFT_ENTRY_STATUS} from '../src/gift-claim-entry.js';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=n=>{const m=new RegExp(`^(?:async )?function ${n}\\(`,'m').exec(src);assert.ok(m,n);return src.slice(m.index,src.indexOf('\n}',m.index)+2)};
const names=['a1214RememberBirth','a1214ReadPendingBirth','a1214ClearPendingBirth','a1202CreatePasskey','isCancelledAuthError','namedAuthError','identityStorageKeys','snapshotIdentity','restoreIdentity','commitIdentity','indexedPiggyId','indexControlledPiggy','recoverPiggy','openPiggy','checkPiggy'];
const addr='0x'+'12'.repeat(20);
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
function rig({inline=false,mutate=s=>s}={}){
 const counts={create:0,get:0,claim:0,restore:0,scene:null};const localStorage=store(),sessionStorage=store();
 let pending={giftId:'synthetic-gift'},failGet=false,failSettle=false;
 const c={console,Error,Promise,Set,Uint8Array,btoa,toHex,createPasskeyWithPrfOutput,isMeraError,
 localStorage,sessionStorage,PASSKEY_STORAGE_KEY:'araso.passkey',PIGGY_RECEIVED_KEY:'araso.received',bornPiggyPending:null,
 state:{credential:null,address:'',activeSignerAddress:''},authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,
 safeLocalStorage:()=>localStorage,secondJourneyScope:()=>({chainId:'10143'}),loadMyPiggiesIndex,registerControlledPiggy,markBornPiggyIssuance,
 readPiggyName:()=>localStorage.getItem('araso.name')||'',hasPlayedBirth:()=>localStorage.getItem('araso.birthPlayed')==='1',hasReceivedPiggy:()=>localStorage.getItem('araso.received')==='1',
 prfSaltFromHex,storedPrfSalt:()=>null,
 isAllowedPiggyRpId:()=>true,webAuthnUnsupported:()=>false,getRpId:()=> 'localhost',
 localTestWebAuthnOption:()=>({webAuthnClient:{createCredential:async()=>{counts.create++;return {credentialId:new Uint8Array([1,2,3]),transports:['internal'],prfEnabled:true,...(inline?{prfOutput:new Uint8Array(32).fill(4)}:{})}}}}),
 localTestPrfSaltOption:()=>({prfSalt:new Uint8Array(32).fill(9)}),
 beginAuthAttempt:()=>({live:true}),finishAuthAttempt:()=>true,trackPlatformAuth:p=>p,boundAuthAttempt:(_a,p)=>p,clearTimeout(){},
 activateSigningSession:()=>{c.state.activeSignerAddress=addr;return {account:{},address:addr}},endActiveSession:()=>{c.state.activeSignerAddress=''},
 setScene:s=>counts.scene=s,recordSafeError(){},noteRecoverSuccess(){},noteRecoverFailure(){},INDEX_BACKUP_ADAPTER:null,
 restoreRecoveredFirstJourney:async()=>counts.restore++,
 takePendingGiftClaim:()=>{const p=pending;pending=null;return p},restorePendingGiftClaim:p=>{pending ||=p},knownPiggyAddresses:()=>new Set(c.state.address?[c.state.address]:[]),
 bindGiftToNewPiggy,GIFT_ENTRY_STATUS,lastGiftClaimSettlement:null,
 settleBoundGiftClaim:async(binding,intent)=>{assert.equal(binding.recipientAddress,addr);assert.equal(binding.giftId,intent.giftId);counts.claim++;if(failSettle)throw Error('settle');return {status:'mock_claimed'}},
 requestPrf:async pin=>{counts.get++;if(failGet)throw new DOMException('cancelled','NotAllowedError');return {credentialId:pin?.credentialId||'AQID',prfOutput:new Uint8Array(32).fill(4)}},
 };
 vm.createContext(c);vm.runInContext(mutate(names.map(fn).join('\n')),c);
 return {c,counts,localStorage,sessionStorage,pending:()=>pending,failGet:()=>failGet=true,failSettle:()=>failSettle=true};
}
let pass=0;async function check(n,f){await f();pass++;console.log('PASS '+n)}
async function expectBorn(h){await h.c.checkPiggy();assert.equal(h.counts.scene,'hatch');assert.equal(h.counts.claim,1);assert.equal(h.localStorage.getItem('araso.received'),'1');assert.ok(loadMyPiggiesIndex(h.localStorage,'10143').index.piggies[0].provenance);assert.equal(h.counts.restore,0)}
await check('deferred Gift -> one explicit get -> received/born/claim once, no replay',async()=>{const h=rig();await h.c.openPiggy();assert.equal(h.counts.claim,0);assert.ok(h.pending());await expectBorn(h);assert.equal(h.sessionStorage.getItem('araso.pendingBirth.v1'),null);await h.c.checkPiggy();assert.equal(h.counts.claim,1);assert.equal(h.counts.scene,'sendstay')});
await check('reload loses in-memory pin, exact tab metadata resumes Hatch/born/Gift',async()=>{const h=rig();await h.c.openPiggy();h.c.lateCreatedCredential=null;const pin=h.c.a1214ReadPendingBirth();assert.equal(pin.credentialId,'AQID');assert.equal(toHex(pin.prfSalt),'09'.repeat(32));assert.deepEqual(Object.keys(JSON.parse(h.sessionStorage.getItem('araso.pendingBirth.v1'))).sort(),['chainId','credentialId','prfSaltHex','transports']);await expectBorn(h)});
await check('existing identity recovery never hatches or claims even with stale marker',async()=>{const h=rig();await h.c.openPiggy();h.c.lateCreatedCredential=null;h.c.state.credential={credentialId:'AQID'};h.c.state.address=addr;await h.c.checkPiggy();assert.equal(h.counts.scene,'sendstay');assert.equal(h.counts.claim,0);assert.ok(h.pending());assert.equal(h.counts.restore,1)});
await check('absent/invalid/unreadable evidence defaults to recovery',async()=>{for(const evidence of ['absent','name','hatch','index','unreadable','scope']){const h=rig();await h.c.openPiggy();h.c.lateCreatedCredential=null;if(evidence==='absent')h.sessionStorage.removeItem('araso.pendingBirth.v1');if(evidence==='name')h.localStorage.setItem('araso.name','existing');if(evidence==='hatch')h.localStorage.setItem('araso.birthPlayed','1');if(evidence==='index')h.c.loadMyPiggiesIndex=()=>({error:null,index:{piggies:[{provenance:'born'}]}});if(evidence==='scope')h.c.secondJourneyScope=()=>({chainId:'other'});if(evidence==='unreadable')h.c.loadMyPiggiesIndex=()=>({error:'corrupt'});assert.equal(h.c.a1214ReadPendingBirth(),null);await h.c.checkPiggy();assert.equal(h.counts.scene,'sendstay');assert.equal(h.counts.claim,0)}});
await check('cancelled get restores Gift and retains pending birth',async()=>{const h=rig();await h.c.openPiggy();h.failGet();await h.c.checkPiggy();assert.ok(h.pending());assert.equal(h.counts.claim,0);assert.ok(h.sessionStorage.getItem('araso.pendingBirth.v1'));assert.equal(h.c.state.address,'')});
await check('Gift settlement failure does not undo birth or repeat claim',async()=>{const h=rig();await h.c.openPiggy();h.failSettle();await expectBorn(h);assert.equal(h.c.lastGiftClaimSettlement.status,'claim_settle_failed');assert.equal(h.pending(),null)});
await check('inline PRF keeps normal birth/claim and creates no pending marker',async()=>{const h=rig({inline:true});await h.c.openPiggy();assert.equal(h.counts.scene,'hatch');assert.equal(h.counts.get,0);assert.equal(h.counts.claim,1);assert.equal(h.sessionStorage.getItem('araso.pendingBirth.v1'),null);assert.ok(loadMyPiggiesIndex(h.localStorage,'10143').index.piggies[0].provenance)});
await check('mutation reverting received:true fails born assertion',async()=>{const h=rig({mutate:s=>s.replace('...(options.pin?.pendingBirth ? { received: true } : {}),','')});await h.c.openPiggy();await assert.rejects(()=>expectBorn(h),assert.AssertionError)});
console.log(`A1214 ${pass} PASS / 0 FAIL / 0 SKIP (SDK + VM + real identity/index/Gift binding; settlement mocked)`);
