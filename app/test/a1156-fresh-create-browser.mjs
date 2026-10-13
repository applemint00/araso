// Local virtual authenticator; helper starts node_modules/.bin/vite. No real key or money.
import assert from 'node:assert/strict';
import {launch,harnessPresent} from './helpers/a803-browser.mjs';
if(!harnessPresent()){console.log('SKIP browser harness unavailable');process.exit(0)}
const d=await launch();
await d.context.addInitScript(()=>{
 window.authCounts={get:0,create:0};if(!navigator.credentials)return;
 const get=navigator.credentials.get.bind(navigator.credentials),create=navigator.credentials.create.bind(navigator.credentials);
 navigator.credentials.get=(...a)=>{window.authCounts.get++;if(!localStorage.getItem('virtual-created'))return Promise.reject(new DOMException('cancelled','NotAllowedError'));return get(...a)};
 navigator.credentials.create=async(...a)=>{window.authCounts.create++;const out=await create(...a);localStorage.setItem('virtual-created','1');return out};
});
let pass=0;
try{
 await d.p.goto(d.BASE+'#invite=synthetic-invite-1156',{waitUntil:'networkidle'});
 assert.equal(new URL(d.p.url()).hash,'');
 await d.p.locator('#inviteFaceButton').click();
 await d.p.waitForSelector('#authTryAgainButton');
 assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:1,create:0});pass++;
 await d.p.reload({waitUntil:'networkidle'});
 await d.p.locator('#inviteFaceButton').dblclick();
 await d.p.waitForSelector('[data-scene="hatch"], [data-scene="name"]',{timeout:20000});
 assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:0,create:1});pass++;
 assert.equal(await d.p.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('araso.freshCreate.'))),false);pass++;
 // Existing-device received marker and platform passkey remain, but no local credential/address.
 await d.p.evaluate(()=>{localStorage.removeItem('araso.passkey');localStorage.removeItem('araso.address');localStorage.setItem('araso.piggyReceived','1')});
 await d.p.reload({waitUntil:'networkidle'});
 await d.p.locator('#inviteFaceButton').click();
 await d.p.waitForSelector('[data-scene="sendstay"]',{timeout:20000});
 assert.deepEqual(await d.p.evaluate(()=>window.authCounts),{get:1,create:0});pass++;
 assert.deepEqual(d.errors,[]);pass++;
 console.log(`${pass} PASS / 0 FAIL / 0 SKIP: cancellation, reload-create, duplicate0, existing-get, pageerror0`);
}finally{await d.close()}
