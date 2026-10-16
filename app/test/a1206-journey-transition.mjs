import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {switchJourney,consumeJourneySwitchUnlock,JOURNEY_SWITCH_UNLOCK_KEY as key,registerJourneySessionDisposer,registerJourneySwitchBusyProbe} from '../src/journey-switch.js';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=n=>{const m=new RegExp(`^function ${n}\\(`,'m').exec(src);return src.slice(m.index,src.indexOf('\n}',m.index)+2)};
const storage=initial=>{const m=new Map(Object.entries(initial||{}));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
let pass=0;const check=(name,f)=>{f();pass++;console.log('PASS '+name)};
check('switch drops signer, stores journey2+timestamp, reload; one use only',()=>{
 const store=storage(),session=storage();let disposed=0,reloaded=0;registerJourneySessionDisposer(()=>disposed++);registerJourneySwitchBusyProbe(()=>({signing:false,unconfirmed:false}));
 assert.equal(switchJourney(2,{storage:store,session,now:100000,loc:{origin:'http://localhost',replace:()=>{assert.equal(disposed,1);assert.equal(session.getItem(key),'100000');reloaded++}}}),true);
 assert.equal(reloaded,1);assert.equal(consumeJourneySwitchUnlock({storage:store,session,now:100005}),true);assert.equal(session.getItem(key),null);assert.equal(consumeJourneySwitchUnlock({storage:store,session,now:100006}),false);
});
check('31s/invalid/future/wrong journey reject and consume; manual reload locks',()=>{
 for(const [stamp,journey,now] of [['100000','2',131000],['oops','2',100001],['100002','2',100001],['100000','1',100001]]){
 const session=storage({[key]:stamp});
 // Use real switch to obtain canonical journey key, then override through its own store.
 const real=storage();switchJourney(journey,{storage:real,session:storage(),now:1,loc:{origin:'http://localhost',replace(){}}});
 assert.equal(consumeJourneySwitchUnlock({storage:real,session,now}),false);assert.equal(session.getItem(key),null);
 }
});
check('blocked switch creates no handoff marker',()=>{
 const session=storage();registerJourneySwitchBusyProbe(()=>({signing:true,unconfirmed:false}));assert.equal(switchJourney(2,{storage:storage(),session,loc:{origin:'http://localhost',replace(){throw Error('reload')}}}),false);assert.equal(session.getItem(key),null);registerJourneySwitchBusyProbe(null);
});
check('boot handoff skips lock once, arms10min timer and intro; normal boot locks',()=>{
 const boot=src.slice(src.indexOf('const a1206SwitchUnlocked ='),src.indexOf('// [A-559 PHASE S1] Gift 링크 fragment',src.indexOf('const a1206SwitchUnlocked =')));
 for(const valid of [true,false]){let touched=0;const c={consumeJourneySwitchUnlock:()=>valid,onForkProfile:()=>true,CHAIN_PROFILE:{},state:{credential:{},scene:'sendstay'},a1206SwitchIntroPending:false,appLockSurface:()=>true,LEGACY_TESTNET_PATH:false,readSendPending:()=>null,touchAppSession:()=>touched++,reconcileSendPending(){}};vm.createContext(c);vm.runInContext(boot,c);assert.equal(!!c.state.appLock,!valid);assert.equal(touched,valid?1:0);assert.equal(c.a1206SwitchIntroPending,valid)}
 assert.match(fn('touchAppSession'),/10 \* 60 \* 1000/);
});
check('handoff Home begins existing CG05 once, no tap cue, paper after1200ms',()=>{
 const timers=[];let cues=0,papers=0,lines=0;const chog={state:{},closeCard(){},startTapCue(){cues++;return true}};
 const c={state:{scene:'sendstay'},a1206SwitchIntroPending:true,a891CueChog:null,a891FirstArrivalHold:null,homeChog:chog,a891SecondIntroSeen:()=>false,localStorage:storage(),SECOND_INTRO_SEEN_KEY:'intro',document:{querySelector:()=>({})},a891ChogSay:()=>{lines++;return {}},sceneTimeout:(f,ms)=>timers.push({f,ms}),A891_SECOND_INTRO_LINES:['I found a few things.','wanna see a few more?'],A891_SECOND_INTRO_TO_PAPER_MS:1200,POST_FILE_QUIET_HOME_MS:8000,openSecondJourneyExplore:()=>{papers++;c.state.scene='explore'}};
 c.chogMoodLine=(t)=>t;c.chogMoodLines=(l)=>[...l]; /* [A-1326] the day's wording (identity here: the screen flow is what this pins) */ vm.createContext(c);vm.runInContext(fn('a891ArmPostFileQuietHome')+'\n'+fn('a891HomeChogTap'),c);c.a891ArmPostFileQuietHome();assert.equal(cues,0);assert.equal(lines,1);assert.equal(c.a1206SwitchIntroPending,false);assert.equal(timers[0].ms,1200);timers[0].f();assert.equal(papers,1);assert.equal(c.localStorage.getItem('intro'),'1');
 c.state.scene='sendstay';c.a891SecondIntroSeen=()=>true;c.a891ArmPostFileQuietHome();assert.equal(timers.length,1);
});
console.log(`A1206: ${pass} PASS / 0 FAIL / 0 SKIP`);
