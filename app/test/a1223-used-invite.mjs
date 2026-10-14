import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {keccak256} from 'viem';
let src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
if(process.env.A1223_MUTATION==='drop_bound')src=src.replace('if (out?.ok === true && out.bound === true) a1223BoundInvite = a1158AttemptKey(invite);','');
const fn=n=>{const m=new RegExp(`^(?:async )?function ${n}\\(`,'m').exec(src);assert.ok(m,n);return src.slice(m.index,src.indexOf('\n}',m.index)+2)};
const block=src.slice(src.indexOf('let a1223BoundInvite'),src.indexOf('void a1158PrefetchInvite();'));
function rig({bound=true,publicOpen=false,existing=false,offline=false,hang=false}={}){
 let token='synthetic-invite-a1223',finish;const timers=new Map();let next=0;const calls={get:0,create:0,fetch:0,bind:0};const map=new Map();
 const c={state:{address:existing?'existing':'',publicEntryOpen:publicOpen},RELEASE_LEVEL:2,readCredential:()=>null,hasReceivedPiggy:()=>false,
 a1209EntryInvite:()=>token,a960ReadInvite:()=>token,readForkInvite:()=>token,safeLocalStorage:()=>null,
 authAttempt:null,platformAuthInflight:null,lateCreatedCredential:null,TextEncoder,keccak256,AbortController,
 setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:i=>timers.delete(i),
 sessionStorage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},
 fetch:async()=>{calls.fetch++;if(offline)throw Error('offline');if(hang)await new Promise(r=>finish=r);return {ok:true,json:async()=>({ok:true,bound})}},
 a1160TakePublicCreate:()=>true,openPiggy:()=>{calls.create++;return Promise.resolve()},checkPiggy:()=>{calls.get++;return Promise.resolve({ok:false})},
 FRESH_DEVICE_RECOVERY_FIRST:true,localStorage:{getItem:()=>null},location:{pathname:'/',search:''},
 activeAccount:{address:'existing'},a960InviteBoundFor:()=>false,a960BindInviteBeforeGrant:async()=>{calls.bind++;return {bound:false}},RELAYER_URL:'mock',
 };
 vm.createContext(c);vm.runInContext(block+'\n'+['a1160PublicEntryOpen','inviteOnlyEntry','startPiggyOpen','renderInviteOnly','inviteHero','a960BindInvite'].map(fn).join('\n'),c);
 return {c,calls,map,timeout:()=>[...timers.values()].forEach(f=>f()),finish:()=>finish(),change:()=>token='another-synthetic-invite'};
}
let pass=0;async function check(n,f){await f();pass++;console.log('PASS '+n)}
await check('bound fresh OFF: used copy, no auth/create, memory fingerprint only',async()=>{const h=rig();await h.c.a1158PrefetchInvite();assert.equal(h.c.a1223UsedInviteBlocked(),true);await h.c.startPiggyOpen();assert.deepEqual(h.calls,{get:0,create:0,fetch:1,bind:0});assert.equal(h.map.size,0);assert.notEqual(vm.runInContext('a1223BoundInvite',h.c),'synthetic-invite-a1223');const html=h.c.renderInviteOnly(true);assert.match(html,/This invite was already used\./);assert.match(html,/If it was you, open Araso where you made your Piggy\./);assert.doesNotMatch(html,/<button/);h.change();assert.equal(h.c.a1223UsedInviteBlocked(),false)});
await check('bound public ON: public create, skip old invite binding even after identity saved',async()=>{const h=rig({publicOpen:true});await h.c.a1158PrefetchInvite();assert.equal(h.c.a1223UsedInviteBlocked(),false);await h.c.startPiggyOpen();assert.equal(h.calls.create,1);h.c.state.address='existing';await h.c.a960BindInvite('existing');assert.equal(h.calls.bind,0)});
await check('unbound keeps create; offline keeps find-first; existing bypasses metadata',async()=>{for(const opts of [{bound:false},{offline:true},{existing:true}]){const h=rig(opts);await h.c.a1158PrefetchInvite();await h.c.startPiggyOpen();assert.equal(h.calls.create,opts.bound===false?1:0);assert.equal(h.calls.get,opts.bound===false?0:1)}});
await check('pending gates taps; deadline restores envelope and ignores late bound result',async()=>{const h=rig({hang:true});const p=h.c.a1158PrefetchInvite();assert.equal(h.c.a1223EntryWaiting(),true);await h.c.startPiggyOpen();assert.equal(h.calls.get+h.calls.create,0);h.timeout();assert.equal(h.c.a1223EntryWaiting(),false);await h.c.startPiggyOpen();assert.equal(h.calls.get,1);h.finish();await p;assert.equal(h.c.a1223UsedInviteBlocked(),false)});
await check('await public verdict for bound invite; then public open bypasses used screen',async()=>{const h=rig();h.c.state.a1223PublicPending=true;await h.c.a1158PrefetchInvite();assert.equal(h.c.a1223EntryWaiting(),true);h.c.state.publicEntryOpen=true;h.c.state.a1223PublicPending=false;h.c.a1223FinishEntry();assert.equal(h.c.a1223IgnoreUsedInvite(),true)});
await check('copy exact; Gift custom lines and recovery detail unchanged',()=>{const h=rig();h.c.INVITE_EGG_SVG='';const html=h.c.inviteHero('/invite');assert.match(html,/your money,/);assert.match(html,/as a little Piggy/);const gift=h.c.inviteHero('/invite',['gift one','gift two']);assert.match(gift,/gift one/);assert.doesNotMatch(gift,/your money,/);assert.match(fn('openPiggy'),/Face ID may appear once\./);assert.match(fn('checkPiggy'),/Face ID may appear once\./)});
console.log(`A1223 ${pass} PASS / 0 FAIL / 0 SKIP (VM, no auth/tx)`);
