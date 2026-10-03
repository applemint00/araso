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

const waitForSuccessSrc = cut("async function waitForSuccess(", "\nasync function settleSend(");
const settleSendSrc = cut("async function settleSend(", "// 결말 하나가 화면과 저장을 같이 정한다");
// [A-441] finishTrip 과 sendPiggy 사이에 단일 실행 helper 가 들어와 끝 표지를 그 절 머리로 옮김.
const finishTripSrc = cut("function finishTrip(trip)", "\n// [A-441] First Send 단일 실행");

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
  const readShmonBalance = async () => {
    if (balanceThrows) throw new Error("rpc down");
    return 0n;
  };
  return eval(`(() => { ${waitForSuccessSrc}
${settleSendSrc}
return settleSend; })()`);
}

const okReceipt = { status: "success", gasUsed: 21000n, effectiveGasPrice: 2n, blockNumber: 22n };
const depositReceipt = { status: "success", gasUsed: 21000n, effectiveGasPrice: 2n, blockNumber: 21n };
const settleInput = {
  before: 100n,
  address: "0xa",
  grantTxHash: "0xgrant",
  depositTxHash: "0xdeposit",
  depositReceipt,
  redeemTxHash: "0xredeem",
  shmonReceived: 7n,
};

{
  const settleSend = makeSettle({ receipt: { ...okReceipt, status: "reverted" } });
  const t = await settleSend(settleInput);
  check("redeem reverted -> 실행 실패", t.outcome, "failed");
  check("redeem reverted -> 사유", t.reason, "redeem-unconfirmed-or-reverted");
  check("redeem reverted -> 영수증 없음", t.receipt, null);
}
{
  const settleSend = makeSettle({ receiptThrows: true });
  const t = await settleSend(settleInput);
  check("redeem 확정 실패 -> 실행 실패", t.outcome, "failed");
  check("redeem 확정 실패 -> 사유", t.reason, "redeem-unconfirmed-or-reverted");
}
{
  const settleSend = makeSettle({ receipt: okReceipt, balanceThrows: true });
  const t = await settleSend(settleInput);
  check("잔고 조회만 실패 -> 완료", t.outcome, "done");
  check("잔고 조회만 실패 -> 사유 balance-unavailable", t.reason, "balance-unavailable");
}
{
  const settleSend = makeSettle({ receipt: okReceipt });
  const t = await settleSend(settleInput);
  check("success + 잔고 정상 -> 완료", t.outcome, "done");
  check("success + 잔고 정상 -> 영수증 있음", t.receipt !== null, true);
  check("영수증에 status 가 담긴다", t.receipt?.status, "success");
  check("영수증 gas = deposit + redeem gas", t.receipt?.gas, 84000n);
  check("영수증에 grant tx 가 담긴다", t.receipt?.grantTxHash, "0xgrant");
  check("영수증에 deposit block 이 담긴다", t.receipt?.depositBlockNumber, 21n);
  check("영수증에 redeem block 이 담긴다", t.receipt?.redeemBlockNumber, 22n);
}

// ── finishTrip: 바퀴가 닫히는 조건 ────────────────────────────────────
// [A-379 §1] 옛 기대("완료 -> away")는 A-320 이후의 실제 finishTrip 과 어긋났다 —
// 현재 코드는 성공 + **실제 영수증**이 있을 때만 return 씬으로 간다(main.js finishTrip,
// `if (trip.receipt) { state.returnArrival = true; setScene("return", ...) }`).
// 영수증이 없는 완료는 그대로 기존 away → filebox 확인 경로를 탄다. 세 계약을 각각의
// 케이스로 나누고, 기대값을 코드가 아니라 canon(주석 [A-320])에 맞춘다.
//
// rememberReceipt 는 여기서 실제 함수가 아니라 스텁이다 — 저장 자체의 중복-방지 계약
// (같은 tx 반복 저장 금지)은 실제 함수를 격리 VM 에서 도는 receipt-storage.mjs 가 잰다.
// 이 파일은 finishTrip 이 receipt 가 있을 때 저장 함수를 **호출한다는 사실**만 별도
// 케이스로 확인하고, 그 저장 함수 내부의 중복 조건과는 분리해 둔다.
function runFinish(trip, { autoTimeout = true } = {}) {
  const store = new Map();
  const state = {
    tripOutcome: "",
    tripReason: "",
    tripClosed: false,
    awayLine: "I'll check it.",
    returnArrival: false,
    receipts: [],
  };
  const scenes = [];
  let rememberCalls = 0;
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const TRIP_CLOSED_KEY = "araso.tripClosed";
  const rememberReceipt = (r) => {
    rememberCalls += 1;
    state.receipts.unshift(r);
    return true; // [A-699 declared harness update] the real rememberReceipt returns true only when the row is verified in storage
  };
  const SEND_PENDING_KEY = "araso.sendPending"; // [A-699] finishTrip's success branch compare-and-clears this record
  const readSendPending = () => { const raw = store.get(SEND_PENDING_KEY); return raw ? JSON.parse(raw) : null; };
  const setScene = (scene, message = "", detail = "") => scenes.push({ scene, message, detail });
  // 실제 finishTrip 은 영수증 없는 완료에서 1200ms 뒤 filebox 로 넘어간다("기존 확인 경로").
  // 그 경로를 검증하려면 콜백을 실제로 실행해야 한다 — 기본은 즉시 실행.
  const setTimeout = autoTimeout ? (fn) => fn() : () => {};
  const finishTrip = eval(`(${finishTripSrc})`);
  finishTrip(trip);
  return { state, scenes, store, rememberCalls };
}

{
  const { state, scenes } = runFinish({ outcome: "failed", reason: "reverted", receipt: null });
  check("failed -> 바퀴 안 닫힘", state.tripClosed, false);
  check("failed -> 돌아왔다고 말하지 않음", state.awayLine, "I'll check it.");
  check("failed -> Owner 원본 문구", scenes[0].message, "couldn't finish this one.");
  check("failed -> Home(sendstay) 로 간다", scenes[0].scene, "sendstay");
  check("failed -> returnArrival 세우지 않음", state.returnArrival, false);
}
{
  // 실제 성공 + 실제 영수증 -> return, returnArrival true (A-320 계약).
  const { state, scenes, store, rememberCalls } = runFinish({
    outcome: "done",
    reason: "ok",
    receipt: { txHash: "0xh", status: "success" },
  });
  check("성공+영수증 -> 바퀴 닫힘", state.tripClosed, true);
  check("성공+영수증 -> 저장에 남는다", store.get("araso.tripClosed"), "1");
  check("성공+영수증 -> return 씬으로 간다", scenes[0].scene, "return");
  check("성공+영수증 -> returnArrival true", state.returnArrival, true);
  check("성공+영수증 -> away/filebox 로는 안 간다", scenes.length, 1);
}
{
  // 저장 호출 자체는 별도 케이스로 — 저장 함수 내부의 중복-방지 조건과는 분리한다
  // (그 조건은 receipt-storage.mjs 가 실제 rememberReceipt 로 잰다).
  const { rememberCalls } = runFinish({
    outcome: "done",
    reason: "ok",
    receipt: { txHash: "0xh2", status: "success" },
  });
  check("성공+영수증 -> rememberReceipt 정확히 1회 호출", rememberCalls, 1);
}
{
  // done 이지만 실제 영수증이 없음 -> 기존 확인 경로(away -> filebox), return 아님.
  const { state, scenes, rememberCalls } = runFinish({ outcome: "done", reason: "balance-unavailable", receipt: null });
  check("영수증 없는 완료 -> 바퀴 닫힘", state.tripClosed, true);
  check("영수증 없는 완료 -> 저장할 영수증 없음", state.receipts.length, 0);
  check("영수증 없는 완료 -> rememberReceipt 호출 안 함", rememberCalls, 0);
  check("영수증 없는 완료 -> away 로 먼저 간다", scenes[0].scene, "away");
  check("영수증 없는 완료 -> returnArrival 세우지 않음", state.returnArrival, false);
  check("영수증 없는 완료 -> 뒤이어 filebox 확인 경로로 넘어간다", scenes[1]?.scene, "filebox");
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
