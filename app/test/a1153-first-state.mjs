import assert from "node:assert/strict";
import { readRecoveredFirst, saveRecoveredFirst, recoveredFirstVerdict } from "../src/first-journey-recovery.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const A = `0x${'12'.repeat(20)}`, B = `0x${'34'.repeat(20)}`;
const store = new Map();
const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
let count=0;
function check(name, f) { f(); count++; console.log(`PASS ${name}`); }
check('other account legacy flags retained and excluded only after chain verification', () => {
  storage.setItem('araso.tripClosed','1'); storage.setItem('araso.txHash','old-other-tx');
  assert.equal(readRecoveredFirst(storage,A),null);
  assert.equal(saveRecoveredFirst(storage,A,'none').verdict,'none');
  assert.equal(readRecoveredFirst(storage,A).verdict,'none');
  assert.equal(readRecoveredFirst(storage,B),null);
  assert.equal(storage.getItem('araso.tripClosed'),'1');
});
check('old-version tab new tx closes a recovered stale tab', () => {
  storage.setItem('araso.txHash','new-tx');
  assert.equal(readRecoveredFirst(storage,A).verdict,'has');
  assert.equal(saveRecoveredFirst(storage,A,'none').verdict,'has');
});
check('completion is monotonic across concurrent refresh/save', () => {
  saveRecoveredFirst(storage,B,'has');
  assert.equal(saveRecoveredFirst(storage,B,'none').verdict,'has');
  assert.equal(saveRecoveredFirst(storage,B,'unknown').verdict,'has');
});
check('malformed and unavailable storage fail closed', () => {
  store.set(`araso.firstJourney.10143.${A}`,'bad json');
  assert.equal(readRecoveredFirst(storage,A).verdict,'unknown');
  const broken = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.equal(readRecoveredFirst(broken,A).verdict,'unknown');
  assert.equal(saveRecoveredFirst(broken,A,'none').verdict,'unknown');
});
check('only no finalized TX + no pending TX opens First; partial deposit/unknown stay closed', () => {
  assert.equal(recoveredFirstVerdict({verdict:'none_confirmed',reason:'no_testnet_tx'},'0x0'),'none');
  for (const reason of ['nonce_one','shmon_balance_nonzero','rpc_error']) assert.equal(recoveredFirstVerdict({verdict:'none_confirmed',reason},'0x0'),'unknown');
  assert.equal(recoveredFirstVerdict({verdict:'none_confirmed',reason:'no_testnet_tx'},'0x1'),'unknown');
  assert.equal(recoveredFirstVerdict({verdict:'unknown'},'0x0'),'unknown');
  assert.equal(recoveredFirstVerdict({verdict:'has'},null),'has');
});
check('actual First guard re-reads recovered scope on each call', () => {
  const src = readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const begin=src.indexOf('function firstTripClosedShared()');
  const fn=src.slice(begin,src.indexOf('\n}\n',begin)+2);
  store.clear(); saveRecoveredFirst(storage,A,'none');
  const state={address:A,tripClosed:false,firstJourneyRecovery:{verdict:'none'}};
  const ctx=vm.createContext({state,localStorage:storage,readRecoveredFirst});
  const guard=vm.runInContext(`(${fn})`,ctx);
  assert.equal(guard(),false);
  saveRecoveredFirst(storage,A,'has');
  assert.equal(guard(),true);
  state.firstJourneyRecovery=null; state.tripClosed=false;
  storage.setItem('araso.tripClosed','1');
  assert.equal(guard(),true);
});
check('actual finishTrip closes scoped state only on a successful outcome', () => {
  const src = readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const begin=src.indexOf('function finishTrip(trip)');
  const fn=src.slice(begin,src.indexOf('\n}\n',begin)+2);
  store.clear(); saveRecoveredFirst(storage,A,'none');
  const state={address:A,tripClosed:false,firstJourneyRecovery:{verdict:'none'}};
  const ctx=vm.createContext({state,localStorage:storage,saveRecoveredFirst,TRIP_CLOSED_KEY:'araso.tripClosed',setScene:()=>{},setTimeout:()=>{}});
  const finish=vm.runInContext(`(${fn})`,ctx);
  finish({outcome:'failed'});
  assert.equal(readRecoveredFirst(storage,A).verdict,'none');
  finish({outcome:'done'});
  assert.equal(readRecoveredFirst(storage,A).verdict,'has');
});
console.log(`${count} PASS / 0 FAIL / 0 SKIP`);
