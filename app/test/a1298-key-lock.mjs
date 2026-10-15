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
  assert.match(say, /insertChogCueLine\("closingSoonLine", \[\.\.\.APP_CLOSING_SOON_LINES\]\)/);
});
check("a tap during the warning always counts (the 15 s throttle never swallows the wake tap)", () => {
  const h = fn("handleTrustedAppActivity");
  assert.match(h, /const waking = [^\n]*#closingSoonLine/);
  assert.match(h, /if \(!waking && now - lastTrustedAppActivityAt < TRUSTED_APP_ACTIVITY_THROTTLE_MS\) return;/);
});
check("first Send: no key-reuse branch — Face ID (recover) runs before any grant / sign, every time", () => {
  const once = fn("sendPiggyOnce");
  assert.equal(once.includes("signerMarginOk"), false);
  assert.ok(once.indexOf("recoverPiggy(") > 0 && once.indexOf("recoverPiggy(") < once.indexOf("requestGrant("));
  assert.doesNotMatch(once, /if \(!activeAccount \|\| !activeSession/);
});
check("Job Send and Gift Send ask Face ID even with a live key (fresh); no await before the get", () => {
  assert.match(MAIN, /a898SignerForPayer\(piggy, \{ allowDeviceCredential: true, fresh: true \}\)/, "Job Send");
  assert.match(fn("a898FaceId"), /a898SignerForPayer\(piggy, \{ fresh: true \}\)/, "Gift Send");
  assert.match(fn("a898SignerForPayer"), /if \(!fresh && activeAccount && /, "the reuse shortcut only for non-money callers");
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
console.log(`${pass}/6 PASS`);
