// A-1298 (Owner 04:0x–04:2x "10분하자 심플하게" · "샌드는 트잭이라 해야해" · "은행앱들처럼"): one 10-minute clock for the app and its key,
// a "closing soon" line 30 s before the lock (a tap = 10 more minutes), and every money Send (first Send · Job Send · Gift Send) asks
// Face ID at the tap — the 10-minute key only signs things that move no money.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const fn = (name) => {
  const m = new RegExp(`^(?:  )?(?:async )?function ${name}\\(`, "m").exec(MAIN);
  assert.ok(m, name);
  const body = MAIN.indexOf(") {\n", m.index);
  let d = 0;
  for (let j = body + 2; j < MAIN.length; j += 1) {
    if (MAIN[j] === "{") d += 1;
    else if (MAIN[j] === "}" && --d === 0) return MAIN.slice(m.index, j + 1);
  }
  throw new Error(name);
};
let pass = 0;
const check = (label, f) => { f(); pass += 1; console.log(`PASS  ${label}`); };

check("one clock: no 5-minute signer timer; the app clock arms the 9:30 line and the 10:00 lock together", () => {
  assert.doesNotMatch(fn("armSignerExpiry"), /setTimeout/);
  const touch = fn("touchAppSession");
  assert.match(touch, /setTimeout\(sayClosingSoon, 10 \* 60 \* 1000 - 30 \* 1000\)/);
  assert.match(touch, /\}, 10 \* 60 \* 1000\);/);
});
check("closing soon: the two Owner lines, one at a time, on the screen's Chog; nothing on the lock / entry", () => {
  assert.match(MAIN, /const APP_CLOSING_SOON_LINES = Object\.freeze\(\["closing soon\.", "if you want to explore more, tap to wake me up\."\]\);/);
  const say = fn("sayClosingSoon");
  assert.match(say, /state\.appLock \|\| state\.scene === "received" \|\| state\.scene === "birth"\) return;/);
  // [A-1326 RE-PIN · FIRST_JOURNEY_PACING_20261015.md:41 "closing soon." day wording] pre-A-1326: [...APP_CLOSING_SOON_LINES]
  assert.match(say, /insertChogCueLine\("closingSoonLine", chogMoodLines\(APP_CLOSING_SOON_LINES\)\)/);
});
check("a tap during the warning always counts (the 15 s throttle never swallows the wake tap)", () => {
  const h = fn("handleTrustedAppActivity");
  assert.match(h, /const waking = [^\n]*#closingSoonLine/);
  assert.match(h, /if \(!waking && now - lastTrustedAppActivityAt < TRUSTED_APP_ACTIVITY_THROTTLE_MS\) return;/);
});
// [A-1360 RE-PIN · Owner 15:4x "열린 동안 보내기 승인만" (81_ENTRY_FLOW 끝 [15:4x] newest-wins over A-1298 "Face ID every time")]
// pre-A-1360: the first Send ran Face ID (recover) every time; Job / Gift Send passed fresh: true.
check("first Send: Face ID (recover) only when the key is not open; our approval sheet before any grant / sign, every time", () => {
  const once = fn("sendPiggyOnce");
  assert.equal(once.includes("signerMarginOk"), false);
  assert.match(once, /const keyOpen = !state\.appLock && [^;]*Boolean\(activeSession\) && Boolean\(activeAccount\)\s*&& String\(activeAccount\.address\)\.toLowerCase\(\) === String\(state\.address \|\| ""\)\.toLowerCase\(\)[^;]*signerSince > 0[^;]*;\s*if \(!keyOpen\) \{/);
  assert.ok(once.indexOf("recoverPiggy(") > once.indexOf("if (!keyOpen) {") && once.indexOf("askSendAllow(") > once.indexOf("recoverPiggy("));
  assert.ok(once.indexOf("askSendAllow(") < once.indexOf("requestGrant("), "the sheet comes before the grant / sign");
});
check("Job Send and Gift Send use the open key (no fresh) and ask our approval sheet before moving money; no await before the get", () => {
  assert.match(MAIN, /a898SignerForPayer\(piggy, \{ allowDeviceCredential: true \}\);[^\n]*\n\s*if \(!signer\.ok\) \{ a977Fail\("auth"\); return; \}\n\s*if \(typeof askSendAllow === "function" && !\(await askSendAllow\(jobSendAllowContent\(sj, jobKey\)\)\)\) return;/, "Job Send");
  assert.match(fn("a898FaceId"), /a898SignerForPayer\(piggy\);/, "Gift Send");
  assert.match(fn("a898FaceId"), /askSendAllow\(\{ title: "Gift a Piggy"/, "Gift Send sheet");
  assert.match(fn("a898SignerForPayer"), /if \(!fresh && activeAccount && /, "the reuse shortcut (open key) stays");
  assert.equal(/a898SignerForPayer\([^)]*fresh: true/.test(MAIN), false, "no money caller forces Face ID any more");
});
check("a898SignerForPayer(fresh) runs the passkey even when the live key is this Piggy; without fresh it reuses (non-money callers)", async () => {
  const run = (fresh) => {
    const calls = { prf: 0 };
    const ctx = {
      state: { appLock: null, address: "0xA", credential: null }, activeAccount: { address: "0xA" }, CHAIN_PROFILE: {},
      onForkProfile: () => false, storedPrfSalt: () => null, console,
      authRequestForPiggy: () => ({ request: { credential: { credentialId: "c" }, prfSalt: null } }),
      requestPrf: async () => { calls.prf += 1; return { credentialId: "c", prfOutput: new Uint8Array(32) }; },
      activateSigningSession: () => ({ address: "0xA" }), endSignerSession: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(`${fn("a898SignerForPayer")}\nthis.go = a898SignerForPayer;`, ctx);
    return ctx.go({ address: "0xA", locator: { credentialId: "c" } }, { fresh }).then((r) => ({ r, calls }));
  };
  return Promise.all([run(true), run(false)]).then(([f, nf]) => {
    assert.equal(f.calls.prf, 1, "fresh: one passkey");
    assert.equal(nf.calls.prf, 0, "not fresh: the live key is reused");
  });
});
check("first end: once after the first receipt (live key) Chog says \"tap me to find out\"; no tap 5 s = Journey 2 by the key; a tap = the Home paper, Journey 2 after it closes", () => {
  assert.match(fn("a891AfterFiling"), /if \(teach\) a1298FindOutPending = true;/);
  assert.match(MAIN, /a1298FindOutPending\) \{ a1298FindOutPending = false; a1298FindOut\(a1357EnterOrCue\); return; \}/); // [A-1357] enter, or the existing cue again when the entry did not happen
  const out = fn("a1298FindOut");
  assert.match(out, /startTapCue\?\.\(chogMoodLine\("tap me to find out"\)\)/ /* [A-1326 RE-PIN · PACING :39 day wording] pre-A-1326: startTapCue?.("tap me to find out") */);
  assert.match(out, /setTimeout\(\(\) => \{[\s\S]*enter\(\);\s*\}, A1298_FIND_OUT_MS\);/);
  assert.match(MAIN, /const A1298_FIND_OUT_MS = 5000;/);
  const tap = fn("a1298FindOutTap");
  assert.match(tap, /if \(chog\.state\?\.pinned\) \{ setTimeout\(wait, 300\); return; \}\s*enter\(\);/, "Journey 2 only after the paper closes");
});
check("the silent first-arrival hold is gone", () => {
  assert.equal(/a891FirstArrivalHold|a891StartFirstArrivalHold/.test(MAIN), false);
});
console.log(`${pass}/8 PASS`);
