// [A-441] First Send 단일 실행 · 확정 전 재진입 fail-closed 를 재는 테스트 — 네트워크 0 · 브라우저 0 · 키 0.
//   node app/test/send-lock.mjs
// return-outcome.mjs 와 같은 방식: main.js 에서 실제 함수 소스만 잘라 스텁 위에서 돌린다(로직 재작성 0).
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { preparedSignProblem } from "../src/money-executor.js";

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

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
// [A-707 M2-beta] harness wiring: sign-before-send replaces walletClient.sendTransaction. The fake account signs a deterministic raw tx per nonce
// ("0xa0" deposit, "0xa1" redeem) and the fake node returns keccak256(raw), so the recorded hashes below are the REAL keccak of those raws.
const HASH_DEPOSIT = keccak256("0xa0");
const HASH_REDEEM = keccak256("0xa1");
function fakeLocks() {
  const held = new Map();
  return {
    held,
    async request(name, opts, cb) {
      if (held.has(name)) return opts.ifAvailable ? cb(null) : new Promise(() => {});
      held.set(name, true);
      try { return await cb({ name, mode: "exclusive" }); } finally { held.delete(name); }
    },
    async query() { return { held: [...held.keys()].map((name) => ({ name })), pending: [] }; },
  };
}

function mockStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    has: (k) => m.has(k),
  };
}

// 전체 sendPiggy + sendPiggyOnce 를 스텁 위에서 만든다. settleOutcome 으로 결말을 고른다.
function makeSend({ storage, settleOutcome = "done", gate = null, depositThrows = false, simThrows = false, allowed = true }) {
  const calls = { grant: 0, sign: 0, sendTx: 0, prepared: 0, scenes: [], finished: [], endSession: 0 };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const env = {
    localStorage: storage,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    state: { address: "0xabc", txHash: "", mark: "", grantTxHash: "" },
    isAllowedPiggyRpId: () => allowed,
    signerSince: Date.now(), // [A-896 harness wiring] live signer stamped now (wall clock) so sendPiggyOnce's 60 s margin check sees a fresh signer
    activeAccount: { address: "0xabc", signTransaction: async (prepared) => `0xa${prepared.nonce}` },
    navigator: { locks: fakeLocks() },
    keccak256,
    activeSession: { signDigest: async () => { calls.sign += 1; return { compact: new Uint8Array([1]), recovery: 0 }; } },
    // [A-444] 진짜 setScene 은 재렌더한다 — 진행 중이면 markup(busy)이 버튼을 disabled 로 다시 그린다.
    setScene: (...a) => { calls.scenes.push(a); btn.disabled = true; btn.attrs["aria-disabled"] = "true"; },
    recoverPiggy: async () => {}, noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    requestGrant: async () => { calls.grant += 1; if (gate) await gate; return { txHash: "0xgrant" }; },
    simulateSend: async () => { if (simThrows) throw new Error("sim reverted"); return { depositTx: {}, before: 1n, beforeShares: 0n }; },
    touchAppSession() {}, // [A-556] rename: touchSession -> touchAppSession (app-idle only, harness wiring)
    // [A-768 M-C-1/M-L-1 harness wiring] the fake prepare returns a well-formed Monad-testnet eip1559 request (the pre-sign guard now checks it),
    // the REAL preparedSignProblem is injected, and the fake node answers the deposit-block nonce read (deposit nonce + 1).
    createWalletClient: () => ({ prepareTransactionRequest: async () => ({ type: "eip1559", chainId: 10143, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: calls.prepared++ }) }),
    preparedSignProblem,
    MONAD_TESTNET: {}, MONAD_TESTNET_RPC: "", http: () => ({}),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) }, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) },
    TextEncoder,
    toHex: () => "00",
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n }),
    readShmonBalance: async () => 5n,
    makeRedeemTx: () => ({}),
    publicClient: { estimateGas: async () => 1n, getTransactionCount: async () => calls.prepared, sendRawTransaction: async ({ serializedTransaction }) => { calls.sendTx += 1; if (depositThrows && calls.sendTx === 1) throw new Error("rpc"); return keccak256(serializedTransaction); } },
    settleSend: async () => ({ outcome: settleOutcome, reason: settleOutcome === "done" ? "ok" : "redeem-unconfirmed-or-reverted", receipt: null }),
    finishTrip: (t) => calls.finished.push(t.outcome),
    formatError: (e) => String(e),
    // [A-451] 새 helper 스텁 — 기록만(원문 0), 새 grant 없음 경로라 대기 0.
    recordSafeError: () => {},
    waitForGrantBalance: async () => true,
    // [A-555 S4] 하네스 배선만 — sendPiggy wrapper finally 가 부르는 실제 세션 종료 함수의 스파이.
    // 이 파일은 session/activeAccount 전역을 흉내내지 않는다(그건 s4-send-session-end.mjs 몫).
    endActiveSession: () => { calls.endSession += 1; },
  };
  const names = Object.keys(env);
  const factory = new Function(...names, `${constsSrc}\n${lockSrc}\n${onceSrc}\nreturn { sendPiggy, computeTripClosed, readSendPending, sendBusy, holdSendTabLock, isInFlight: () => sendInFlight };`);
  const made = factory(...names.map((n) => env[n]));
  made.holdSendTabLock(); // boot step: the tab lifetime lock (fake locks grant it synchronously)
  return { ...made, calls, btn, env };
}

// ── 1. 동시 두 호출 → grant/서명/sendTransaction 1회 ─────────────────────────────
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const storage = mockStorage();
  const t = makeSend({ storage, gate });
  const p1 = t.sendPiggy();
  const p2 = t.sendPiggy(); // 첫 호출이 grant 대기 중
  await tick();
  check("concurrent: 2nd call returns without work (grant 1)", t.calls.grant, 1);
  check("  button disabled immediately", t.btn.disabled, true);
  check("  aria-disabled set", t.btn.attrs["aria-disabled"], "true");
  release();
  await p1; await p2; await tick(); await tick();
  check("  sign 1 / sendTransaction 2 (deposit+redeem) for one run", `${t.calls.sign}/${t.calls.sendTx}`, "1/2");
}

// ── 2. 성공 뒤에만 txHash · 미확정 기록 제거 · 잠금 해제 ───────────────────────────
{
  const storage = mockStorage();
  const t = makeSend({ storage, settleOutcome: "done" });
  await t.sendPiggy(); await tick(); await tick();
  check("success: araso.txHash = redeem hash", storage.getItem("araso.txHash"), HASH_REDEEM);
  // [A-699 M2-alpha] declared expectation update: commitSendSuccess no longer clears the pending record; the clear is in the
  // REAL finishTrip, behind the verified receipt save (stubbed in this harness; end-to-end in money-safety-first.mjs).
  check("  pending NOT cleared by commitSendSuccess (clear moved behind the verified receipt save)", storage.has("araso.sendPending"), true);
  check("  lock released after settle", t.isInFlight(), false);
  check("  finishTrip done", t.calls.finished[0], "done");
}

// ── 3. 미확정/실패 → txHash 0 · 기록 유지 · 재탭 재제출 0 ──────────────────────────
{
  const storage = mockStorage();
  const t = makeSend({ storage, settleOutcome: "failed" });
  await t.sendPiggy(); await tick(); await tick();
  check("unconfirmed: araso.txHash not written", storage.getItem("araso.txHash"), null);
  check("  pending kept (stage redeem-broadcast)", JSON.parse(storage.getItem("araso.sendPending")).stage, "redeem-broadcast");
  check("  pending keeps both hashes", JSON.parse(storage.getItem("araso.sendPending")).redeemTxHash, HASH_REDEEM);
  check("  pending carries the deposit hash and both nonces (0 then 1)", `${JSON.parse(storage.getItem("araso.sendPending")).depositTxHash === HASH_DEPOSIT}/${JSON.parse(storage.getItem("araso.sendPending")).nonce}`, "true/1");
  const before = `${t.calls.grant}/${t.calls.sign}/${t.calls.sendTx}`;
  await t.sendPiggy(); await tick();
  check("  re-tap with pending: no grant/sign/send", `${t.calls.grant}/${t.calls.sign}/${t.calls.sendTx}`, before);
  check("  re-tap shows existing confirming copy", t.calls.scenes.at(-1)[2], "Confirmation is still catching up.");
  check("  sendBusy true (render lock)", t.sendBusy(), true);
}

// ── 4. 방송 여부 모르는 deposit 예외 → 기록 유지(fail-closed) ─────────────────────
{
  const storage = mockStorage();
  const t = makeSend({ storage, depositThrows: true });
  await t.sendPiggy(); await tick();
  // [A-707 M2-beta] declared expectation update: the deposit hash is persisted BEFORE the broadcast call, so a throwing broadcast leaves a SIGNED record
  // (stage deposit-broadcast, phase signed, hash + nonce) instead of the hash-less deposit-sending. It stays (broadcast may have happened) and locks Send.
  check("deposit send threw: pending kept (signed deposit record with the hash, phase signed)", `${JSON.parse(storage.getItem("araso.sendPending") || "{}").stage}/${JSON.parse(storage.getItem("araso.sendPending") || "{}").phase}/${JSON.parse(storage.getItem("araso.sendPending") || "{}").depositTxHash === HASH_DEPOSIT}`, "deposit-broadcast/signed/true");
  check("  lock released (no settle)", t.isInFlight(), false);
  check("  txHash not written", storage.getItem("araso.txHash"), null);
}

// ── 5. broadcast 전 실패(simulate 거절) → 기록 없음 · 잠금 해제 · 재시도 가능 ─────────────
{
  const storage = mockStorage();
  const t = makeSend({ storage, simThrows: true });
  await t.sendPiggy(); await tick();
  check("pre-broadcast failure: no pending", storage.has("araso.sendPending"), false);
  check("  no sign / no sendTransaction", `${t.calls.sign}/${t.calls.sendTx}`, "0/0");
  check("  lock released", t.isInFlight(), false);
  check("  sendBusy false (Send usable again)", t.sendBusy(), false);
}

// ── 5b. [A-444] 실제 버튼 상태 ───────────────────────────────────────────────
{
  const t = makeSend({ storage: mockStorage(), simThrows: true });
  await t.sendPiggy(); await tick();
  check("A-444 safe failure (re-rendered disabled) -> DOM Send enabled", t.btn.disabled, false);
  check("  aria-disabled removed", "aria-disabled" in t.btn.attrs, false);
}
{
  const t = makeSend({ storage: mockStorage(), settleOutcome: "failed" });
  await t.sendPiggy(); await tick(); await tick();
  check("A-444 pending after unconfirmed -> DOM Send disabled", t.btn.disabled, true);
  check("  aria-disabled true", t.btn.attrs["aria-disabled"], "true");
}
{
  const t = makeSend({ storage: mockStorage(), depositThrows: true });
  await t.sendPiggy(); await tick();
  check("A-444 deposit threw (pending) -> DOM Send stays disabled", t.btn.disabled, true);
}
{
  const t = makeSend({ storage: mockStorage(), allowed: false });
  await t.sendPiggy(); await tick();
  check("A-444 blocked origin -> DOM Send disabled", t.btn.disabled, true);
  check("  no grant on blocked origin", t.calls.grant, 0);
}
{
  const t = makeSend({ storage: mockStorage(), settleOutcome: "done" });
  await t.sendPiggy(); await tick(); await tick();
  // [A-699 M2-alpha] declared expectation update: with finishTrip stubbed the record is still there, so Send stays locked;
  // "success -> Send enabled" is asserted end-to-end with the real finishTrip in money-safety-first.mjs (G-series).
  check("A-444 success (finishTrip stubbed: pending not cleared by commit) -> DOM Send stays locked", t.btn.disabled, true);
}
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = makeSend({ storage: mockStorage(), gate });
  const p = t.sendPiggy();
  await tick();
  check("A-444 settling/in-flight -> DOM Send disabled", t.btn.disabled, true);
  release(); await p; await tick(); await tick();
}

// ── 6. 새로고침 복구: 확정 전 txHash 가 닫힌 바퀴가 되지 않는다 ────────────────────
{
  const t = makeSend({ storage: mockStorage() });
  check("reload: pending + txHash(legacy) → not closed", t.computeTripClosed({ tripClosedFlag: null, txHash: HASH_REDEEM, pending: { stage: "redeem-broadcast" } }), false);
  check("reload: legacy txHash-only (no pending) → closed (bridge kept)", t.computeTripClosed({ tripClosedFlag: null, txHash: "0xold", pending: null }), true);
  check("reload: tripClosed flag → closed", t.computeTripClosed({ tripClosedFlag: "1", txHash: "", pending: null }), true);
  check("reload: nothing → not closed", t.computeTripClosed({ tripClosedFlag: null, txHash: "", pending: null }), false);
}

// ── 7. 손상된 기록도 '없음'이 아니다(fail-closed) ───────────────────────────────
{
  const t = makeSend({ storage: mockStorage({ "araso.sendPending": "{not json" }) });
  check("garbled pending → treated as pending(unknown)", t.readSendPending()?.stage, "unknown");
}

// ── 8. 소스 계약: sendPiggyOnce 는 txHash 를 직접 쓰지 않는다 ─────────────────────
check("source: sendPiggyOnce writes no araso.txHash", /localStorage\.setItem\("araso\.txHash"/.test(onceSrc), false);
check("source: commitSendSuccess only in done branch", /if \(trip\.outcome === "done"\) commitSendSuccess\(redeemTxHash\)/.test(onceSrc), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
