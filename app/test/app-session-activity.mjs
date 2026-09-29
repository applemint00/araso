// [A-565 Owner 2026-09-24] "신뢰된 in-app tap/key 활동은 app-idle(10분) 창만 늘린다" — module-scope
// handleTrustedAppActivity() 훅 + 그 훅이 기존 계약(서명자 5분 절대 만료·app-idle 10분·Piggy 전환)을
// 건드리지 않는다는 것을 잰다. 실제 main.js 세션 함수들(endSignerSession/endActiveSession/
// touchAppSession/armSignerExpiry/activateSigningSession/handleTrustedAppActivity)을 그대로 잘라
// node:vm 위, 결정적 가짜 clock 으로 돌린다(session-lifetime.mjs 와 같은 기법 — 로직 재작성 0).
// 네트워크 0 · 실제 Face ID 0 · 실제 대기 0. 전체 송금 경로(sendPiggy/permission)는 이 파일 범위가
// 아니다 — 그건 session-lifetime.mjs 가 이미 잰다. 여기는 오직: (a) 이 카드가 새로 넣은 훅의 행동,
// (b) 그 훅이 기존 5개 세션 함수와 Gate C 함수들을 한 글자도 바꾸지 않았다는 것(pre-A-565 스냅샷과
// byte 비교)만 잰다.
//   node app/test/app-session-activity.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { getEvmAddress, createSecp256k1SigningSession } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
// Public checkout: the pre-change snapshot is local-only. Without it, §9/§10 print SKIP (not PASS).
const PRE = existsSync(new URL("../../_private", import.meta.url)) ? readFileSync(
  new URL("../../_private/ops/receipts/A565_app_idle_activity/pre/main.js.pre", import.meta.url),
  "utf8",
) : null;

function cut(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`소스에서 못 찾음(시작): ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error(`소스에서 못 찾음(끝): ${endMarker}`);
  return src.slice(start, end);
}

// 이름으로 함수 전체(중괄호 짝) 를 뽑는다 — 뒤에 무엇이 오든(주석·다음 함수·이 카드가 새로 붙인
// 코드) 흔들리지 않는 byte 비교용. 마커 문자열이 drift 해도 이 방식은 함수 몸통만 정확히 자른다.
function extractFunction(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`함수 없음: ${name}`);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return src.slice(start, i);
}

// ── real function slices, cut straight out of main.js (same narrow-cut technique as
// session-lifetime.mjs — SESSION_DECLS_SRC then SESSION_TIMERS_SRC, never the wide range that
// would shadow this file's isAllowedPiggyRpId/getRpId etc.). handleTrustedAppActivity lives
// inside the SAME cut region (declared right after activateSigningSession, before "씬 정리"),
// so it comes along automatically. ──────────────────────────────────────────────────────────────
const SESSION_DECLS_SRC = cut(MAIN, "let activeSession = null;", "function readCredential()");
const SESSION_TIMERS_SRC = cut(MAIN, "function endSignerSession() {", "// --- 씬 정리 (A-292 번호 9)");
const SESSION_SRC = `${SESSION_DECLS_SRC}\n${SESSION_TIMERS_SRC}`;

for (const needle of [
  "function endSignerSession(",
  "function endActiveSession(",
  "function touchAppSession(",
  "function armSignerExpiry(",
  "function activateSigningSession(",
  "function handleTrustedAppActivity(",
  "TRUSTED_APP_ACTIVITY_THROTTLE_MS",
]) {
  if (!SESSION_SRC.includes(needle)) throw new Error(`잘라낸 구간에 없음 — 마커 확인 필요: ${needle}`);
}

// ── deterministic fake clock — armCount() 는 "재무장(re-arm) 몇 번" 을 간접으로 재는 유일한
// 관측 지점이다(touchAppSession 은 clearTimeout+setTimeout 쌍을 부른다 — setTimeout 호출 수를
// 세면 "훅이 실제로 다시 껐다 켰다" 를 함수 내부를 스텁 없이도 관측할 수 있다). ─────────────────
function makeFakeClock() {
  let now = 0;
  let nextId = 1;
  let armCount = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, delay) => {
      armCount += 1;
      const id = nextId++;
      timers.set(id, { fireAt: now + delay, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let pickId = null;
        let pickAt = Infinity;
        for (const [id, t] of timers) {
          if (t.fireAt <= target && t.fireAt < pickAt) {
            pickAt = t.fireAt;
            pickId = id;
          }
        }
        if (pickId === null) break;
        const { fn } = timers.get(pickId);
        timers.delete(pickId);
        now = pickAt;
        fn();
      }
      now = target;
    },
    now: () => now,
    armCount: () => armCount,
  };
}

function mockStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
  };
}

// 하나의 buildApp() = 하나의 fresh vm context + fresh fake clock + fresh module-scope state.
function buildApp() {
  const clock = makeFakeClock();
  const calls = { scenes: [] };
  const storage = mockStorage();
  const state = { address: "", activeSignerAddress: "", scene: "sendstay" };
  const ctx = {
    state,
    console,
    createSecp256k1SigningSession,
    getEvmAddress,
    toViemAccount,
    localStorage: storage,
    setScene: (...a) => {
      calls.scenes.push(a);
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date: { now: () => clock.now() }, // handleTrustedAppActivity 의 throttle 이 읽는 유일한 "지금" — 가짜 clock 에 묶는다
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SESSION_SRC}\n` +
      `this.__api = { activateSigningSession, endActiveSession, endSignerSession, touchAppSession, handleTrustedAppActivity };\n` +
      `this.__get = () => ({ hasSigner: !!activeAccount, idleArmed: idleTimer !== null, signerArmed: signerExpiryTimer !== null });`,
    ctx,
  );
  return { clock, calls, state, storage, get: ctx.__get, ...ctx.__api };
}

let pass = 0;
function check(label, fn) {
  if (PRE === null && /pre-A-565 snapshot/.test(label)) {
    console.log(`SKIP  ${label} — local snapshot absent (public checkout)`);
    return;
  }
  fn();
  console.log(`PASS  ${label}`);
  pass += 1;
}

const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const THROTTLE = 15 * 1000; // main.js TRUSTED_APP_ACTIVITY_THROTTLE_MS 와 같은 값 — 숫자 자체가 아니라 동작을 잰다
const prfOutput = crypto.randomBytes(32);
const trusted = (type) => ({ isTrusted: true, type });
const untrusted = (type) => ({ isTrusted: false, type });

// ══ 1. no active app session → the event does nothing ══════════════════════════════════════════
check("no active app session (idleTimer not armed) -> trusted activity does nothing", () => {
  const app = buildApp();
  assert.equal(app.get().idleArmed, false);
  const before = app.clock.armCount();
  app.handleTrustedAppActivity(trusted("pointerdown"));
  assert.equal(app.clock.armCount(), before, "no auth ever happened — nothing to touch");
});

// ══ 2. trusted pointer activity refreshes app-idle ══════════════════════════════════════════════
check("trusted pointer activity refreshes the app-idle window once a session is active", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput);
  app.clock.advance(THROTTLE + 1000);
  const before = app.clock.armCount();
  app.handleTrustedAppActivity(trusted("pointerdown"));
  assert.equal(app.clock.armCount(), before + 1, "touchAppSession() re-armed idle");
  assert.equal(app.get().signerArmed, true, "signer timer untouched by the activity call");
});

// ══ 3. trusted key activity refreshes app-idle ══════════════════════════════════════════════════
check("trusted key activity refreshes the app-idle window once a session is active", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput);
  app.clock.advance(THROTTLE + 1000);
  const before = app.clock.armCount();
  app.handleTrustedAppActivity(trusted("keydown"));
  assert.equal(app.clock.armCount(), before + 1);
});

// ══ 4. synthetic/untrusted events never refresh ═════════════════════════════════════════════════
check("untrusted or malformed events never refresh, even past the throttle window", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput);
  app.clock.advance(THROTTLE + 1000);
  const before = app.clock.armCount();
  app.handleTrustedAppActivity(untrusted("pointerdown"));
  app.handleTrustedAppActivity({ type: "keydown" }); // isTrusted missing entirely
  app.handleTrustedAppActivity(null);
  app.handleTrustedAppActivity(undefined);
  assert.equal(app.clock.armCount(), before, "isTrusted !== true in every case — handler returns before touching any timer");
});

// ══ 5. throttle: rapid trusted taps inside the window re-arm only once ══════════════════════════
check("throttle: repeated trusted activity inside the window re-arms only once, then again after it elapses", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput); // t=0
  const afterAuth = app.clock.armCount();
  app.handleTrustedAppActivity(trusted("pointerdown")); // very first activity ever -> never throttled
  const afterFirst = app.clock.armCount();
  assert.equal(afterFirst, afterAuth + 1, "first-ever trusted activity always goes through");
  app.handleTrustedAppActivity(trusted("pointerdown")); // same instant -> throttled
  app.handleTrustedAppActivity(trusted("keydown")); // same instant -> throttled
  assert.equal(app.clock.armCount(), afterFirst, "repeats inside the throttle window re-arm nothing");
  app.clock.advance(THROTTLE + 1);
  app.handleTrustedAppActivity(trusted("pointerdown")); // window elapsed -> goes through again
  assert.equal(app.clock.armCount(), afterFirst + 1, "once the throttle window elapses, activity re-arms again");
});

// ══ 6. signer 5m absolute deadline unchanged by continuous activity ═════════════════════════════
check("signer's 5m absolute deadline fires on schedule despite continuous trusted activity", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput); // t=0: signer@5m, idle@10m
  for (let i = 0; i < 14; i += 1) {
    app.clock.advance(20 * 1000); // 20s > throttle — each tap goes through
    app.handleTrustedAppActivity(trusted("pointerdown"));
  }
  assert.equal(app.get().hasSigner, true, "still alive at t=4m40s under continuous activity");
  app.clock.advance(20 * 1000); // total elapsed = 5m00s exactly
  assert.equal(app.get().hasSigner, false, "signer died at exactly its ORIGINAL 5m absolute deadline — activity never extended it");
});

// ══ 7. no trusted activity at all → 10m idle still locks ════════════════════════════════════════
check("no trusted activity at all: 10m idle still locks and shows the existing resting scene", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput);
  app.clock.advance(TEN_MIN + 1000);
  assert.equal(app.get().hasSigner, false);
  assert.equal(app.get().idleArmed, false);
  assert.deepEqual(app.calls.scenes.at(-1), ["sendstay", "Piggy is resting.", "Open again when you need it."], "same resting copy as A-556 — no new UI text");
});

// ══ 8. after signer expiry, activity keeps app-idle alive but signer stays gone ═════════════════
check("after signer expiry, continued trusted activity keeps the app-idle session alive while the signer stays gone", () => {
  const app = buildApp();
  app.activateSigningSession(prfOutput); // t=0: signer@5m, idle@10m
  app.clock.advance(FIVE_MIN + 1000); // t=5m01s — signer's own absolute timer fires
  assert.equal(app.get().hasSigner, false, "signer expired");
  assert.equal(app.get().idleArmed, true, "app-idle untouched by signer expiry — endSignerSession never clears idleTimer");
  app.clock.advance(4 * 60 * 1000); // t=9m01s — still inside the ORIGINAL 10m window
  app.handleTrustedAppActivity(trusted("pointerdown")); // refreshes idle -> new deadline ~t=19m01s
  app.clock.advance(2 * 60 * 1000); // t=11m01s — past the ORIGINAL 10m mark
  assert.equal(app.get().idleArmed, true, "app session is still alive past the original 10m mark because activity refreshed it");
  assert.equal(app.get().hasSigner, false, "signer stays gone — the hook never calls activateSigningSession/armSignerExpiry");
});

// ══ 9. Piggy switch / Gate C money functions are untouched by this card ════════════════════════
check("Piggy-switch and Gate C money functions are byte-identical to the pre-A-565 snapshot (out of scope for this card)", () => {
  assert.equal(extractFunction(MAIN, "authorizeMoneyAction"), extractFunction(PRE, "authorizeMoneyAction"));
  assert.equal(extractFunction(MAIN, "applyPiggySelection"), extractFunction(PRE, "applyPiggySelection"));
  assert.equal(extractFunction(MAIN, "consumeMoneyPermission"), extractFunction(PRE, "consumeMoneyPermission"));
});

// ══ 10. the five existing session functions are untouched by this card ═════════════════════════
// [A-633 B] touchAppSession 만 예외 하나: app-idle 만료 콜백에 모바일 잠금 분기 한 줄(+주석 2줄)이 **추가**됐다.
// 그 세 줄을 빼면 pre-A-565 스냅숏과 byte-동일해야 한다(다른 어떤 줄도 바뀌지 않았다는 증명). 나머지 넷은 그대로 byte-동일.
const A633_IDLE_LOCK_LINES =
  "    // [A-633 B] 모바일/app 표면만: 풀린 Home 을 잠금 화면처럼 남기지 않고 LOGIN_CHECKING 으로 잠근다.\n" +
  "    // 웹(641+)·지원되지 않는 origin 은 아래 기존 resting 동작 그대로다.\n" +
  "    if (lockAppAfterIdle()) return;\n";
check("endSignerSession/endActiveSession/touchAppSession/armSignerExpiry/activateSigningSession are byte-identical to the pre-A-565 snapshot", () => {
  for (const name of ["endSignerSession", "endActiveSession", "touchAppSession", "armSignerExpiry", "activateSigningSession"]) {
    let now = extractFunction(MAIN, name);
    if (name === "touchAppSession") {
      assert.equal(now.split(A633_IDLE_LOCK_LINES).length, 2, "A-633 idle-lock branch present exactly once");
      now = now.replace(A633_IDLE_LOCK_LINES, "");
    }
    assert.equal(now, extractFunction(PRE, name), `${name} changed — this card must only ADD a new hook, never edit these`);
  }
});

// ══ 11. source guard: the new hook calls no auth/signer-arming function ════════════════════════
check("source guard: handleTrustedAppActivity's body calls no auth/signer-arming function", () => {
  const body = extractFunction(MAIN, "handleTrustedAppActivity");
  for (const forbidden of ["armSignerExpiry(", "activateSigningSession(", "requestPrf("]) {
    assert.equal(body.includes(forbidden), false, `forbidden call present in handleTrustedAppActivity: ${forbidden}`);
  }
  assert.ok(body.includes("touchAppSession()"), "the only session call the hook makes is touchAppSession()");
});

// ══ 12. wiring guard: exactly one module-scope pointerdown + keydown listener ═══════════════════
check("wiring guard: exactly one module-scope pointerdown + keydown listener, capture+passive, outside render()", () => {
  const pointerLines = MAIN.match(/^window\.addEventListener\("pointerdown", handleTrustedAppActivity,.*\)\s*;$/gm) || [];
  const keyLines = MAIN.match(/^window\.addEventListener\("keydown", handleTrustedAppActivity,.*\)\s*;$/gm) || [];
  assert.equal(pointerLines.length, 1, "exactly one top-level (column 0, i.e. outside any function) pointerdown wire");
  assert.equal(keyLines.length, 1, "exactly one top-level keydown wire");
  assert.ok(pointerLines[0].includes("capture: true") && pointerLines[0].includes("passive: true"));
  assert.ok(keyLines[0].includes("capture: true") && keyLines[0].includes("passive: true"));
});

console.log(`\n${pass}/${pass} PASS`);
