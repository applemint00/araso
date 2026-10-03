// [A-556 Owner bank-style session policy — supersedes A-555 S4] 실제 Send 경로는 더는 **어느
// 종료로도** 서명 세션을 즉시 끝내지 않는다 — grant/simulate 거절, 서명/broadcast 예외, settle
// 성공/실패/미확정, 모두 endActiveSession() 을 부르지 않는다(PHASE 0 이 A-555 가 여기 넣었던
// 그 두 호출을 없앴다). 서명자는 이제 자기 5분 절대 타이머(armSignerExpiry, session-lifetime.mjs
// 가 잰다)로만 끝난다. 네트워크 0 · 브라우저 0 · 실제 Face ID 0. send-lock.mjs 와 같은 방식
// (main.js 실제 소스를 잘라 스텁 위에서 실행, 로직 재작성 0) — 이 파일은 `endActiveSession` 을
// 스파이로 넣어 **한 번도 불리지 않는다는 것**을 재는 회귀 가드다(옛 "정확히 한 번" 계약의 반대).
//
// 이 파일이 증명하지 않는 것 하나: "같은 Piggy 두 번째 송금이 Face ID 없이 세션을 재사용한다"는
// session-lifetime.mjs 의 몫이다(그 파일은 실제 activateSigningSession/sendPiggyOnce 배선을
// 가짜 시계로 몬다). 여기는 좁게 "sendPiggy 래퍼가 더는 세션을 죽이지 않는다"만 잰다.
//   node app/test/s4-send-session-end.mjs
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}
const constsSrc = cut('const SEND_PENDING_KEY = "araso.sendPending";', "\n\n");
const lockSrc = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");
const onceSrc = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");

// [A-556] wrapper 어디에도 endActiveSession() **호출**이 남아 있지 않다는 것을 소스 텍스트로도
// 고정한다 — 스파이 결과가 우연히 0이어도, 나중에 리팩터가 그 호출을 도로 끼워 넣으면 여기서
// 먼저 걸린다. 주석 속 언급(예: "여기 넣었던 endActiveSession() 호출은 없앴다")은 실제 호출이
// 아니므로 코드 줄만 남기고 전체-줄 주석은 걸러낸다(gate-c-signer.mjs 의 fnBody 와 같은 방식).
import assert from "node:assert/strict";
const lockCode = lockSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
assert.equal(lockCode.includes("endActiveSession"), false, "sendPiggy 래퍼(pending 조기-return + finally)에 endActiveSession() 호출이 남아 있음 — A-556 PHASE 0 위반");
const onceCode = onceSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
assert.match(onceCode, /touchAppSession\(\);/, "sendPiggyOnce 가 더는 touchAppSession() 을 부르지 않음 — app-idle 활동 갱신 배선 없음");
assert.equal(onceCode.includes("armSignerExpiry"), false, "sendPiggyOnce 가 armSignerExpiry() 를 직접 부름 — 송금 활동이 서명자 절대 만료를 늘리면 안 됨(카드 §2)");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function mockStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
  };
}

// send-lock.mjs 의 makeSend 와 같은 스텁 — endActiveSession/touchAppSession 을 스파이로 넣는다.
function makeSend({
  storage, settleOutcome = "done", depositThrows = false, simThrows = false,
  grantThrows = false, grantGranted = false, grantVisible = true, allowed = true,
  pendingAtStart = false, inFlightAtStart = false,
}) {
  const calls = { grant: 0, sign: 0, sendTx: 0, scenes: [], finished: [], endSession: 0, touchApp: 0 };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const state = { address: "0xabc", txHash: "", mark: "", grantTxHash: "", activeSignerAddress: "0xabc" };
  const env = {
    localStorage: storage,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    state,
    isAllowedPiggyRpId: () => allowed,
    activeAccount: { address: "0xabc" },
    activeSession: { signDigest: async () => { calls.sign += 1; return { compact: new Uint8Array([1]), recovery: 0 }; } },
    setScene: (...a) => { calls.scenes.push(a); btn.disabled = true; btn.attrs["aria-disabled"] = "true"; },
    recoverPiggy: async () => {}, noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    requestGrant: async () => {
      calls.grant += 1;
      if (grantThrows) throw new Error("relayer unreachable");
      return { txHash: grantGranted ? "0xgrant" : "", granted: grantGranted };
    },
    waitForGrantBalance: async () => grantVisible,
    simulateSend: async () => { if (simThrows) throw new Error("sim reverted"); return { depositTx: {}, before: 1n, beforeShares: 0n }; },
    touchAppSession: () => { calls.touchApp += 1; },
    createWalletClient: () => ({ sendTransaction: async () => { calls.sendTx += 1; if (depositThrows && calls.sendTx === 1) throw new Error("rpc"); return calls.sendTx === 1 ? "0xdeposit" : "0xredeem"; } }),
    MONAD_TESTNET: {}, MONAD_TESTNET_RPC: "", http: () => ({}),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) } },
    TextEncoder,
    toHex: () => "00",
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n }),
    readShmonBalance: async () => 5n,
    makeRedeemTx: () => ({}),
    publicClient: { estimateGas: async () => 1n },
    settleSend: async () => ({ outcome: settleOutcome, reason: settleOutcome === "done" ? "ok" : "redeem-unconfirmed-or-reverted", receipt: null }),
    finishTrip: (t) => calls.finished.push(t.outcome),
    formatError: (e) => String(e),
    recordSafeError: () => {},
    // [A-556] 이제는 "한 번도 안 불림" 을 재는 회귀 가드 — 옛 A-555 즉시-종료 스파이와 이름은
    // 같지만 기대값이 뒤집혔다(모든 아래 check 가 0 을 기대).
    endActiveSession: () => { calls.endSession += 1; },
  };
  if (pendingAtStart) storage.setItem("araso.sendPending", JSON.stringify({ stage: "redeem-broadcast", at: Date.now() }));
  const names = Object.keys(env);
  const factory = new Function(...names, `${constsSrc}\n${lockSrc}\n${onceSrc}\n${inFlightAtStart ? "sendInFlight = true;" : ""}\nreturn { sendPiggy, computeTripClosed, readSendPending, sendBusy, isInFlight: () => sendInFlight };`);
  return { ...factory(...names.map((n) => env[n])), calls, btn, env, state };
}

// ── 1. 성공한 실제 send: settle 이 끝난 뒤에도 세션은 살아 있다(bank-style) ────────────────
{
  const t = makeSend({ storage: mockStorage(), settleOutcome: "done" });
  await t.sendPiggy(); await tick(); await tick();
  check("1. success: settle finished (done)", t.calls.finished[0], "done");
  check("1. success: endActiveSession NOT called — signer session survives a completed send", t.calls.endSession, 0);
  check("1. success: touchAppSession called (app-idle refreshed by ordinary send activity)", t.calls.touchApp, 1);
  // [A-699 M2-alpha] declared expectation update: the clear moved from commitSendSuccess into the real finishTrip (behind the verified receipt save); finishTrip is a stub here.
  check("1. success: pending not cleared by commitSendSuccess ([A-699]: finishTrip clears after the verified receipt)", t.env.localStorage.has("araso.sendPending"), true);
}

// ── 2. settle 실패/미확정: 세션은 여전히 살아 있다, pending 은 유지 ─────────────────────────
{
  const t = makeSend({ storage: mockStorage(), settleOutcome: "failed" });
  await t.sendPiggy(); await tick(); await tick();
  check("2. settle failed: finishTrip failed", t.calls.finished[0], "failed");
  check("2. settle failed: endActiveSession NOT called", t.calls.endSession, 0);
  check("2. settle failed: pending KEPT (unchanged contract)", t.env.localStorage.has("araso.sendPending"), true);
  check("2. settle failed: txHash NOT written", t.env.localStorage.getItem("araso.txHash"), null);
}

// ── 3. 서명 뒤·broadcast 중 예외: 세션은 살아 있고, pending stage 는 마지막 기록 그대로 ──────
{
  const t = makeSend({ storage: mockStorage(), depositThrows: true });
  await t.sendPiggy(); await tick();
  check("3. deposit threw: endActiveSession NOT called", t.calls.endSession, 0);
  check("3. deposit threw: pending stage stays at last written stage (deposit-sending)", JSON.parse(t.env.localStorage.getItem("araso.sendPending") || "{}").stage, "deposit-sending");
  check("3. deposit threw: SEND_PENDING_KEY not cleared (fail-closed, unchanged)", t.env.localStorage.has("araso.sendPending"), true);
  check("3. deposit threw: lock released (not settling, unchanged)", t.isInFlight(), false);
}

// ── 4. grant/simulate 거절: 세션은 여전히 살아 있다(재시도에 다시 Face ID 를 강요하지 않는다) ──
{
  const t = makeSend({ storage: mockStorage(), grantThrows: true });
  await t.sendPiggy(); await tick();
  check("4a. grant threw: endActiveSession NOT called", t.calls.endSession, 0);
  check("4a. grant threw: no pending written (pre-broadcast, unchanged)", t.env.localStorage.has("araso.sendPending"), false);
  check("4a. grant threw: no sign/sendTransaction (unchanged)", `${t.calls.sign}/${t.calls.sendTx}`, "0/0");
}
{
  const t = makeSend({ storage: mockStorage(), simThrows: true });
  await t.sendPiggy(); await tick();
  check("4b. simulate rejected: endActiveSession NOT called", t.calls.endSession, 0);
  check("4b. simulate rejected: no pending written (unchanged)", t.env.localStorage.has("araso.sendPending"), false);
  check("4b. simulate rejected: lock released, Send usable again (unchanged)", t.isInFlight(), false);
}
{
  // grant 자체는 통과했지만 새 grant 잔고가 상한 안에 안 보이는 경로(exit 4, lane_a AUDIT.md).
  const t = makeSend({ storage: mockStorage(), grantGranted: true, grantVisible: false });
  await t.sendPiggy(); await tick();
  check("4c. grant-visibility timeout: endActiveSession NOT called", t.calls.endSession, 0);
  check("4c. grant-visibility timeout: no pending written (unchanged)", t.env.localStorage.has("araso.sendPending"), false);
  check("4c. grant-visibility timeout: no sign/sendTransaction (unchanged)", `${t.calls.sign}/${t.calls.sendTx}`, "0/0");
}

// ── 5. 모든 종료 경로에서 세션은 살아 있다(bank-style 의 핵심 회귀 가드) ─────────────────────
{
  const outcomes = [
    makeSend({ storage: mockStorage(), settleOutcome: "done" }),
    makeSend({ storage: mockStorage(), settleOutcome: "failed" }),
    makeSend({ storage: mockStorage(), depositThrows: true }),
    makeSend({ storage: mockStorage(), grantThrows: true }),
    makeSend({ storage: mockStorage(), simThrows: true }),
    makeSend({ storage: mockStorage(), grantGranted: true, grantVisible: false }),
    makeSend({ storage: mockStorage(), allowed: false }),
  ];
  for (const t of outcomes) { await t.sendPiggy(); await tick(); await tick(); }
  check("5. every terminal path leaves the signer session alone (7 exits, 0 endActiveSession calls each)", outcomes.every((t) => t.calls.endSession === 0), true);
}

// ── 6. 중복 호출 lock: 진행 중이면 아무것도 새로 시작하지 않고, 세션도 건드리지 않는다(unchanged) ──
{
  const t = makeSend({ storage: mockStorage(), inFlightAtStart: true });
  await t.sendPiggy();
  check("6. sendInFlight guard: returns before try -> endActiveSession NOT called (unchanged)", t.calls.endSession, 0);
  check("6. sendInFlight guard: no grant started (unchanged)", t.calls.grant, 0);
}

// ── 7. pending 조기-return: A-555 의 fail-safe endActiveSession() 은 PHASE 0 에서 없어졌다 ──
{
  const t = makeSend({ storage: mockStorage(), pendingAtStart: true });
  await t.sendPiggy();
  check("7. pending early-return: endActiveSession NOT called — A-555 fail-safe removed (PHASE 0)", t.calls.endSession, 0);
  check("7. pending early-return: no grant/sign/send started (unchanged)", `${t.calls.grant}/${t.calls.sign}/${t.calls.sendTx}`, "0/0/0");
  check("7. pending early-return: pending record itself untouched (unchanged)", t.env.localStorage.has("araso.sendPending"), true);
  check("7. pending early-return: existing 'confirming' copy unchanged (no new UI text)", t.calls.scenes.at(-1)[2], "Confirmation is still catching up.");
}

// ── 8. rpId 가드(획득 전): 세션이 없어도 아무것도 부르지 않는다(unchanged 무해성) ───────────
{
  const t = makeSend({ storage: mockStorage(), allowed: false });
  await t.sendPiggy(); await tick();
  check("8. blocked origin (before acquisition): endActiveSession NOT called", t.calls.endSession, 0);
  check("8. blocked origin: no grant (unchanged)", t.calls.grant, 0);
}

// ── 9/10. 회귀 0: 기존 pending/영수증/outcome 계약은 이 변경으로 안 바뀐다 ──────────────────
{
  const t = makeSend({ storage: mockStorage(), settleOutcome: "done" });
  await t.sendPiggy(); await tick(); await tick();
  check("9. success still writes txHash exactly once (unchanged)", t.env.localStorage.getItem("araso.txHash"), "0xredeem");
  check("9. [A-699 declared update] commitSendSuccess no longer clears pending (finishTrip does, behind the verified receipt)", t.env.localStorage.has("araso.sendPending"), true);
  check("9. success still releases the lock (unchanged)", t.isInFlight(), false);
}
{
  const t = makeSend({ storage: mockStorage({ "araso.sendPending": "{not json" }) });
  check("9. garbled pending still fail-closed as pending(unknown) (unchanged)", t.readSendPending()?.stage, "unknown");
}
check("10. source: endActiveSession never appears inside settleSend's own body (unchanged)", !cut("async function settleSend(", "\nfunction finishTrip(trip) {").includes("endActiveSession"), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
