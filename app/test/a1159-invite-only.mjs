import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(process.env.A1159_MAIN_PATH || new URL('../src/main.js',import.meta.url),'utf8');
const fn=name=>{const i=src.indexOf(`function ${name}(`);assert.ok(i>=0,name);return src.slice(i,src.indexOf('\n}',i)+2)};
let pass=0;
for(const row of [
 {level:1,blocked:true}, {level:1,invite:'valid',blocked:false}, {level:1,credential:{},blocked:false},
 {level:1,received:true,blocked:false}, {level:1,address:'existing',blocked:false}, {level:2,blocked:true}, {level:2,publicOpen:true,blocked:false},
]){
 const c=vm.createContext({RELEASE_LEVEL:row.level,readForkInvite:()=>row.invite??null,safeLocalStorage:()=>null,readCredential:()=>row.credential??null,hasReceivedPiggy:()=>!!row.received,a1160PublicEntryOpen:()=>row.level>=2 && row.publicOpen===true,state:{address:row.address??null}});
 assert.equal(vm.runInContext(`(${fn('inviteOnlyEntry')})()`,c),row.blocked);pass++;
}
const markup=vm.runInNewContext(`(${fn('renderInviteOnly')})()`);
assert.match(markup,/src="\/og-invite.png"/);assert.deepEqual([...markup.matchAll(/<p>(.*?)<\/p>/g)].map(x=>x[1]),['Araso is invite-only for now.','Opens to everyone at 12:00 KST.']);assert.doesNotMatch(markup,/<button|<a\b|onclick/);pass++;
const start=fn('startPiggyOpen');let calls=0;
const c=vm.createContext({inviteOnlyEntry:()=>true,readCredential:()=>{calls++},checkPiggy:()=>{calls++},openPiggy:()=>{calls++}});
const out=await vm.runInContext(`(async ${start})()`,c);assert.equal(out.reason,'invite_only');assert.equal(calls,0);pass++;
assert.ok(src.indexOf('if (inviteOnlyEntry()) {',src.indexOf('function render()')) < src.indexOf('const markup =',src.indexOf('function render()')));pass++;
console.log(`${pass} PASS / 0 FAIL / 0 SKIP`);
