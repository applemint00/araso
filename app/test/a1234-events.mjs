import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createEventHandler } from '../../api/event.js';
import { createTracker, installErrorTracking } from '../src/track.js';
import { EVENT_CODES, validEvent } from '../src/event-schema.js';
let pass = 0;
async function test(name, fn) { await fn(); console.log('PASS '+name); pass++; }
const headers = { origin: 'https://arasoo.vercel.app', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
async function invoke({ body = { step: 'send', code: 'ok' }, h = headers, method = 'POST', chunks, fail = false } = {}) {
  const calls = [];
  const req = chunks ? Readable.from(chunks) : {};
  Object.assign(req, { method, headers: h, ...(chunks ? {} : { body }) });
  const res = { setHeader() {}, end() {} };
  await createEventHandler({ cmd: async (...args) => { calls.push(args); if (fail) throw Error('private failure'); return 1; }, now: () => new Date('2026-10-14T05:00:00Z') })(req, res);
  return { status: res.statusCode, calls };
}
await test('exact record, UTC bucket, latest 5000 and fourteen-day TTL', async () => {
  const r = await invoke(); assert.equal(r.status, 204);
  assert.deepEqual(r.calls, [
    ['LPUSH', 'araso:v1:event:20261014', JSON.stringify({t:'2026-10-14T05:00:00.000Z',step:'send',code:'ok'})],
    ['LTRIM', 'araso:v1:event:20261014', 0, 4999], ['EXPIRE','araso:v1:event:20261014',1209600],
  ]);
});
for (const [name, body] of Object.entries({ unknown_step:{step:'address',code:'ok'}, unknown_code:{step:'send',code:'private'}, wrong_pair:{step:'grant',code:'public'}, extra:{step:'send',code:'ok',address:'secret'}, missing:{step:'send'}, array:[], null:null, prototype:{step:'__proto__',code:'ok'}, object_code:{step:'send',code:{}}, inherited:Object.create({step:'send',code:'ok'}) })) {
  await test('reject '+name+' before store',async()=>{const r=await invoke({body});assert.equal(r.status,400);assert.equal(r.calls.length,0)});
}
await test('byte cap on parsed body and declared wire length',async()=>{
 for(const x of [{body:' '.repeat(257)},{body:{step:'send',code:'ok',x:'é'.repeat(128)}},{h:{...headers,'content-length':'257'}}]){const r=await invoke(x);assert.equal(r.status,400);assert.equal(r.calls.length,0)}
});
await test('stream byte cap; boundary 256 accepts, 257 rejects',async()=>{
 const raw=JSON.stringify({step:'send',code:'ok'});const good=await invoke({chunks:[raw,' '.repeat(256-Buffer.byteLength(raw))]});assert.equal(good.status,204);
 const bad=await invoke({chunks:[raw,' '.repeat(257-Buffer.byteLength(raw))]});assert.equal(bad.status,400);assert.equal(bad.calls.length,0);
 const utf=await invoke({chunks:['é'.repeat(129)]});assert.equal(utf.status,400);
});
await test('malformed JSON and non JSON content type reject',async()=>{for(const x of [{body:'{'},{h:{...headers,'content-type':'text/plain'}}])assert.equal((await invoke(x)).status,400)});
await test('other origin, cross-site, opaque cross-site and missing origin evidence reject',async()=>{
 for(const h of [{...headers,origin:'https://evil.example'},{...headers,'sec-fetch-site':'cross-site'},{...headers,origin:'null','sec-fetch-site':'cross-site'},{'content-type':'application/json'}]){const r=await invoke({h});assert.equal(r.status,403);assert.equal(r.calls.length,0)}
 assert.equal((await invoke({h:{...headers,origin:'null'}})).status,204);
});
await test('POST only and store failure are bounded',async()=>{assert.equal((await invoke({method:'GET'})).status,405);assert.equal((await invoke({fail:true})).status,503)});
await test('thirteen steps, all allowlisted pairs accepted',async()=>{assert.equal(Object.keys(EVENT_CODES).length,13);for(const [step,codes] of Object.entries(EVENT_CODES))for(const code of codes)assert.equal((await invoke({body:{step,code}})).status,204)});
await test('auth tap accepts only create and find',async()=>{for(const code of ['create','find'])assert.equal((await invoke({body:{step:'auth_tap',code}})).status,204);assert.equal((await invoke({body:{step:'auth_tap',code:'other'}})).status,400)});
await test('beacon contains only step/code with JSON MIME; milestones deduplicate',async()=>{
 const sent=[];const track=createTracker({navigator:{sendBeacon:(...x)=>sent.push(x)}});
 track('entry_shown','public');track('entry_shown','public');track('send','ok');track('send','ok');track('send','secret');
 assert.equal(sent.length,3);assert.equal(sent[0][0],'/api/event');assert.equal(sent[0][1].type,'application/json');assert.deepEqual(JSON.parse(await sent[0][1].text()),{step:'entry_shown',code:'public'});
});
await test('fetch fallback and every transport failure are ignored',async()=>{
 const sent=[];const track=createTracker({fetch:(...args)=>{sent.push(args);return Promise.reject(Error('offline'))}});track('send','ok');await new Promise(r=>setImmediate(r));assert.equal(sent[0][1].keepalive,true);
 assert.doesNotThrow(()=>createTracker({navigator:{sendBeacon(){throw Error('blocked')}}})('send','ok'));
 assert.doesNotThrow(()=>createTracker({fetch(){throw Error('blocked')}})('send','ok'));
});
await test('error observers never send messages, stacks, URLs or rejection objects',async()=>{
 const listeners={},sent=[];installErrorTracking({addEventListener:(k,fn)=>listeners[k]=fn},(...args)=>sent.push(args));
 listeners.error({message:'private message',filename:'private url',error:new TypeError('private data')});listeners.unhandledrejection({reason:{credential:'secret'}});listeners.error({error:{name:'__proto__'}});
 assert.deepEqual(sent,[['js_error','type'],['js_error','rejection'],['js_error','error']]);
});
assert.equal(validEvent({step:'send',code:'ok',ip:'secret'}),false);
console.log(`A1234 ${pass} PASS`);
