// Return 결말 분리를 재는 테스트 — 네트워크 0 · 브라우저 0.
//   node app/test/return-outcome.mjs
//
// main.js 는 브라우저 모듈이라 통째로 import 하면 viem/mera 가 딸려 온다.
// 그래서 재려는 두 함수의 소스만 잘라내 스텁 위에서 돌린다
// (A-048 이 마이그레이션을 node 스텁으로 잰 것과 같은 방식).
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}

const settleSendSrc = cut("async function settleSend(", "// 결말 하나가 화면과 저장을 같이 정한다");
const finishTripSrc = cut("function finishTrip(trip)", "\nasync function sendPiggy(");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) {
    console.log(`PASS  ${label}`);
    pass += 1;
  } else {
    console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    fail += 1;
  }
}

// ── settleSend 4케이스 ────────────────────────────────────────────────
const SEND_AMOUNT = 1000000000000000n;

function makeSettle({ receipt, receiptThrows, balanceThrows }) {
  const publicClient = {
    async waitForTransactionReceipt() {
      if (receiptThrows) throw new Error("not confirmed");
      return receipt;
    },
    async getBalance() {
      if (balanceThrows) throw new Error("rpc down");
      return 90n;
    },
  };
  return eval(`(${settleSendSrc.replace(/^async function settleSend/, "async function settleSend")})`);
}

const okReceipt = { status: "success", gasUsed: 21000n, effectiveGasPrice: 2n };

{
  const settleSend = makeSettle({ receipt: { ...okReceipt, status: "reverted" } });
  const t = await settleSend({ before: 100n, address: "0xa", txHash: "0xh" });
  check("reverted -> 실행 실패", t.outcome, "failed");
  check("reverted -> 사유 reverted", t.reason, "reverted");
  check("reverted -> 영수증 없음", t.receipt, null);
}
{
  const settleSend = makeSettle({ receiptThrows: true });
  const t = await settleSend({ before: 100n, address: "0xa", txHash: "0xh" });
  check("tx 확정 실패 -> 실행 실패", t.outcome, "failed");
  check("tx 확정 실패 -> 사유 unconfirmed", t.reason, "unconfirmed");
}
{
  const settleSend = makeSettle({ receipt: okReceipt, balanceThrows: true });
  const t = await settleSend({ before: 100n, address: "0xa", txHash: "0xh" });
  check("잔고 조회만 실패 -> 완료", t.outcome, "done");
  check("잔고 조회만 실패 -> 사유 balance-unavailable", t.reason, "balance-unavailable");
}
{
  const settleSend = makeSettle({ receipt: okReceipt });
  const t = await settleSend({ before: 100n, address: "0xa", txHash: "0xh" });
  check("success + 잔고 정상 -> 완료", t.outcome, "done");
  check("success + 잔고 정상 -> 영수증 있음", t.receipt !== null, true);
  check("영수증에 status 가 담긴다", t.receipt?.status, "success");
  check("영수증 gas = gasUsed * effectiveGasPrice", t.receipt?.gas, 42000n);
}

// ── finishTrip: 바퀴가 닫히는 조건 ────────────────────────────────────
function runFinish(trip) {
  const store = new Map();
  const state = { tripOutcome: "", tripReason: "", tripClosed: false, awayLine: "I'll check it.", receipts: [] };
  const scenes = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const TRIP_CLOSED_KEY = "araso.tripClosed";
  const rememberReceipt = (r) => state.receipts.unshift(r);
  const setScene = (scene, message = "", detail = "") => scenes.push({ scene, message, detail });
  const setTimeout = () => {};
  const finishTrip = eval(`(${finishTripSrc})`);
  finishTrip(trip);
  return { state, scenes, store };
}

{
  const { state, scenes } = runFinish({ outcome: "failed", reason: "reverted", receipt: null });
  check("실패 -> 바퀴 안 닫힘", state.tripClosed, false);
  check("실패 -> 돌아왔다고 말하지 않음", state.awayLine, "I'll check it.");
  check("실패 -> Owner 원본 문구", scenes[0].message, "couldn't finish this one.");
  check("실패 -> filebox 로 안 간다", scenes[0].scene, "sendstay");
}
{
  const { state, scenes, store } = runFinish({
    outcome: "done",
    reason: "ok",
    receipt: { txHash: "0xh", status: "success" },
  });
  check("완료 -> 바퀴 닫힘", state.tripClosed, true);
  check("완료 -> 저장에 남는다", store.get("araso.tripClosed"), "1");
  check("완료 -> 영수증 저장", state.receipts.length, 1);
  check("완료 -> away 로 간다", scenes[0].scene, "away");
}
{
  const { state } = runFinish({ outcome: "done", reason: "balance-unavailable", receipt: null });
  check("숫자만 없는 완료 -> 바퀴 닫힘", state.tripClosed, true);
  check("숫자만 없는 완료 -> 저장할 영수증 없음", state.receipts.length, 0);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
