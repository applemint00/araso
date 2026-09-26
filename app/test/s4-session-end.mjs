// [A-556 Owner bank-style session policy — supersedes A-533/A-555 S4] 돈 권한을 쓰면
// nonce 는 소비되지만, **살아 있는 서명자 세션은 더는 그 자리에서 끝나지 않는다** — 네트워크 0,
// 실제 Face ID 0. (옛 제목 그대로 "consuming a permission ends the signing session immediately"
// 는 이 카드가 뒤집는 문장이다 — 아래 첫 두 check 가 새 계약을 잰다.)
//   node app/test/s4-session-end.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const cut = (from, to) => { const i = MAIN.indexOf(from); const j = MAIN.indexOf(to, i + from.length); assert.ok(i > 0 && j > i, from); return MAIN.slice(i, j); };
// [A-556] endActiveSession() 은 이제 endSignerSession() 을 부른다 — 둘 다 한 슬라이스에 담아야
// 격리 vm 에서 ReferenceError 없이 돈다. 이 범위는 armSignerExpiry/touchAppSession 은 뺀다
// (이 파일의 관심사는 "권한 소비가 서명자를 끝내는가" 뿐 — 타이머 산수는 session-lifetime.mjs).
const END = cut("function endSignerSession() {", "function touchAppSession() {");
const CONSUME = cut("function consumeMoneyPermission() {", "// [A-486 Lane B]");

function harness({ throws = false } = {}) {
  const ctx = {
    state: { activeSignerAddress: "0xabc", moneyIntent: { permission: { nonce: "n1" } } },
    activeSession: { ended: 0, end() { this.ended += 1; } },
    activeAccount: { address: "0xabc" }, idleTimer: 1, signerExpiryTimer: 1, clearTimeout() {},
    consumedPermissionNonces: new Set(),
    consume: (env, set) => { if (throws) throw new Error("boom"); set.add(env.nonce); return { consumed: true }; },
  };
  vm.createContext(ctx);
  vm.runInContext(`var activeSession = this.activeSession, activeAccount = this.activeAccount, idleTimer = 1, signerExpiryTimer = 1;\n${END}\n${CONSUME}\nthis.run = () => { const s = activeSession; let out, err; try { out = consumeMoneyPermission(); } catch (e) { err = e; } return { out, err, s, live: activeSession, acct: activeAccount }; };`, ctx);
  return ctx;
}

let pass = 0;
const check = (label, fn) => { fn(); console.log(`PASS  ${label}`); pass += 1; };

check("consuming a permission consumes the nonce but leaves a live signing session alone", () => {
  const h = harness(); const r = h.run();
  assert.equal(r.out.consumed, true);
  assert.equal(r.s.ended, 0);              // .end() never called
  assert.notEqual(r.live, null);           // activeSession still the same live object
  assert.notEqual(r.acct, null);           // activeAccount still live
  assert.equal(h.state.activeSignerAddress, "0xabc"); // untouched
  assert.ok(h.consumedPermissionNonces.has("n1"));    // but the nonce IS consumed — one-shot permission still holds
});
check("session survives even when consumption throws (nonce not added, session untouched either way)", () => {
  const h = harness({ throws: true }); const r = h.run();
  assert.ok(r.err);
  assert.equal(r.s.ended, 0);
  assert.notEqual(r.live, null);
  assert.equal(h.state.activeSignerAddress, "0xabc");
  assert.equal(h.consumedPermissionNonces.has("n1"), false); // consume() threw before adding
});
check("authorizeMoneyAction still falls back to state.activeSignerAddress when there is no live account object (Piggy-switch/mismatch end paths, unrelated to permission consumption)", () => {
  assert.match(cut("function authorizeMoneyAction(request) {", "// [A-512 Gate C]"), /activeAccount\?\.address \?\? state\.activeSignerAddress/);
});
check("+ Piggy birth session still ends in finally (A-531 unchanged — a control-proof derivation, not a money-permission consumption)", () => {
  // [A-579 Lane G] the Model-A admission body moved into ONE shared helper, runModelAAdmission(),
  // used by both beginAddPiggy and beginGiftPiggy — the finally{endActiveSession()} lives there now,
  // and both callers must go through it (no second admission path without that teardown).
  assert.match(cut("async function runModelAAdmission", "\n}\n"), /finally\s*\{[^}]*endActiveSession\(\)/);
  assert.match(cut("async function beginAddPiggy", "\n}\n"), /await runModelAAdmission\(root\.credential\)/);
  assert.match(cut("async function beginGiftPiggy", "\n}\n"), /await runModelAAdmission\(root\.credential, \{/);
  assert.equal(cut("async function beginAddPiggy", "\n}\n").includes("admitModelAPiggy("), false);
  assert.equal(cut("async function beginGiftPiggy", "\n}\n").includes("admitModelAPiggy("), false);
});
check("endSignerSession() clears signer state + its own 5m timer but does NOT touch the app-idle timer", () => {
  const clearedTimers = [];
  const ctx = {
    activeSession: { ended: 0, end() { this.ended += 1; } }, activeAccount: { address: "0xabc" },
    state: { activeSignerAddress: "0xabc" }, idleTimer: "APP_IDLE_UNTOUCHED", signerExpiryTimer: "SIGNER_TIMER",
    clearedTimers, clearTimeout(t) { clearedTimers.push(t); },
  };
  vm.createContext(ctx);
  vm.runInContext(`var activeSession = this.activeSession, activeAccount = this.activeAccount, idleTimer = this.idleTimer, signerExpiryTimer = this.signerExpiryTimer;\n${cut("function endSignerSession() {", "function endActiveSession() {")}\nthis.run = () => { endSignerSession(); return { live: activeSession, acct: activeAccount, addr: state.activeSignerAddress, signerExpiryTimer }; };`, ctx);
  const out = ctx.run();
  assert.equal(out.live, null);
  assert.equal(out.acct, null);
  assert.equal(out.addr, "");
  assert.equal(out.signerExpiryTimer, null);
  assert.deepEqual(ctx.clearedTimers, ["SIGNER_TIMER"]); // idleTimer never passed to clearTimeout
});
check("endActiveSession() clears signer state AND the app-idle timer (full teardown — app-lock/Piggy-switch/unload paths)", () => {
  const clearedTimers = [];
  const ctx = {
    activeSession: { ended: 0, end() { this.ended += 1; } }, activeAccount: { address: "0xabc" },
    state: { activeSignerAddress: "0xabc" }, idleTimer: "APP_IDLE", signerExpiryTimer: "SIGNER_TIMER",
    clearedTimers, clearTimeout(t) { clearedTimers.push(t); },
  };
  vm.createContext(ctx);
  vm.runInContext(`var activeSession = this.activeSession, activeAccount = this.activeAccount, idleTimer = this.idleTimer, signerExpiryTimer = this.signerExpiryTimer;\n${END}\nthis.run = () => { endActiveSession(); return { live: activeSession, acct: activeAccount, addr: state.activeSignerAddress, idleTimer, signerExpiryTimer }; };`, ctx);
  const out = ctx.run();
  assert.equal(out.live, null);
  assert.equal(out.acct, null);
  assert.equal(out.addr, "");
  assert.equal(out.idleTimer, null);
  assert.equal(out.signerExpiryTimer, null);
  assert.deepEqual(ctx.clearedTimers, ["SIGNER_TIMER", "APP_IDLE"]);
});

console.log(`\n${pass}/${pass} PASS`);
