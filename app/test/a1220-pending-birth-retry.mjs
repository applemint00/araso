import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=n=>{const m=new RegExp(`^(?:async )?function ${n}\\(`,'m').exec(source);return source.slice(m.index,source.indexOf('\n}',m.index)+2)};
function rig(pending,publicEntry){
 let get=0,create=0;const storage=new Map();
 const c={state:{freshRecoveryTried:false},lateCreatedCredential:null,authAttempt:null,platformAuthInflight:null,
 readCredential:()=>null,hasReceivedPiggy:()=>false,a1214ReadPendingBirth:()=>pending?{credentialId:'synthetic',pendingBirth:true}:null,
 inviteOnlyEntry:()=>false,a1160PublicEntryOpen:()=>publicEntry,a1160TakePublicCreate:()=>!storage.has('attempted'),
 readForkInvite:()=>publicEntry?null:'synthetic-invite',safeLocalStorage:()=>null,a1158TakeUnboundInvite:()=>false,
 localStorage:{getItem:()=>null},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:()=>storage.delete('attempted')},
 FRESH_DEVICE_RECOVERY_FIRST:true,location:{pathname:'/',search:''},
 checkPiggy:async()=>{get++;return {ok:false,cancelled:true}},openPiggy:async()=>{create++},isAllowedPiggyRpId:()=>true,
 };storage.set('attempted','1');vm.createContext(c);vm.runInContext(fn('startPiggyOpen'),c);
 const card=fn('renderAuthCard');const prefix=card.slice(0,card.indexOf('  const body ='))+'return recoveryOnly;\n}';vm.runInContext(prefix,c);
 return {c,counts:()=>({get,create})};
}
let pass=0;
for(const publicEntry of [false,true]){
 const h=rig(true,publicEntry);await h.c.startPiggyOpen();const before=h.counts();await h.c.startPiggyOpen();const after=h.counts();
 assert.deepEqual({get:after.get-before.get,create:after.create-before.create},{get:1,create:0});
 assert.equal(h.c.renderAuthCard({authCancelled:true}),true);
 assert.equal(h.c.renderAuthCard({unlockRetry:true}),false);
 pass++;console.log('PASS pending birth cancel -> next tap recovery only: '+(publicEntry?'public':'invite'));
 const plain=rig(false,publicEntry);await plain.c.startPiggyOpen();await plain.c.startPiggyOpen();assert.deepEqual(plain.counts(),{get:1,create:1});assert.equal(plain.c.renderAuthCard({}),false);
 pass++;console.log('PASS no birth record retains explicit create retry: '+(publicEntry?'public':'invite'));
}
console.log(`A1220 ${pass} PASS / 0 FAIL / 0 SKIP (actual router and auth-card decision in VM)`);
