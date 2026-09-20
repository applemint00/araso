// 영수증 저장 왕복을 재는 테스트 — 네트워크 0 · 디스크 0 · 브라우저 0.
//   node app/test/receipt-storage.mjs
//
// [A-379 §2] A-377 의 저장 테스트는 main.js 의 로직을 다시 베껴 쓴 "미러"였다 —
// 실제 함수가 바뀌어도 거울쪽만 통과할 수 있어 독립 증거가 아니다(Owner 지적).
// 이 테스트는 main.js 소스에서 readReceipts / serializeReceiptRow / receiptIdentityKey /
// rememberReceipt 네 함수의 **실제 텍스트**를 그대로 잘라내(return-outcome.mjs 가
// waitForSuccess/settleSend/finishTrip 을 자르는 것과 같은 방식, A-048 기법) node:vm 의
// 격리된 컨텍스트에서 그 소스를 실행한다. 로직을 손으로 다시 쓰지 않는다 — 컨텍스트에
// mock localStorage 와 state 만 주입한다. 실제 사용자 localStorage/디스크는 쓰지 않고,
// 새 백업 사본도 만들지 않는다. 옛날에 잃어버린 이력의 "복구" 주장은 하지 않는다 — 이
// 테스트는 지금부터의 저장/재읽기/중복-방지 계약만 잰다.
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`끝 마커를 못 찾음: ${endMarker}`);
  return SRC.slice(start, end);
}

// readReceipts 로 시작해 rememberReceipt 끝(다음 함수 writeCredential 앞)까지 — 네 함수
// 전부를 있는 그대로 담는다. 실제 함수 소스 텍스트만 자른다(재작성 없음).
const receiptFnsSrc = cut("function readReceipts() {", "\nfunction writeCredential(credential) {");
for (const name of ["readReceipts", "serializeReceiptRow", "receiptIdentityKey", "rememberReceipt"]) {
  if (!receiptFnsSrc.includes(`function ${name}`)) {
    throw new Error(`잘라낸 소스에 ${name} 이 없다 — 마커가 main.js 구조와 어긋남`);
  }
}

// mock storage — 실제 디스크/브라우저 localStorage 를 대신하는 메모리 맵뿐이다.
function createMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => new Map(map),
  };
}

// 매 테스트 블록마다 새 격리 컨텍스트를 만든다 — 이전 블록의 state/storage 가 섞이지 않는다.
function makeSandbox() {
  const localStorage = createMockStorage();
  const state = { receipts: [], receiptIndex: 0 };
  const RECEIPTS_KEY = "araso.receipts";
  const sandbox = { localStorage, state, RECEIPTS_KEY, JSON, String, BigInt, Array };
  vm.createContext(sandbox);
  vm.runInContext(receiptFnsSrc, sandbox, { filename: "receipt-fns-from-main.js" });
  return sandbox;
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  // BigInt/문자열/불린 모두 === 값 비교로 충분하다(BigInt 는 참조가 아니라 값으로 비교됨).
  if (got === want) {
    console.log(`PASS  ${label}`);
    pass += 1;
  } else {
    console.log(`FAIL  ${label} — got ${got}, want ${want}`);
    fail += 1;
  }
}

// 실제 finishTrip 이 만드는 것과 같은 모양의 영수증(§main.js settleSend) — index 로 값을 갈라
// BigInt 왕복과 서로 다른 identity 를 함께 잰다.
function makeReceipt(i, overrides = {}) {
  const n = BigInt(i);
  return {
    before: 1000n + n,
    after: 900n + n,
    gas: 21000n + n,
    sent: 100n + n,
    txHash: `0xtx${i}`,
    depositTxHash: `0xdep${i}`,
    redeemTxHash: `0xredeem${i}`,
    grantTxHash: `0xgrant${i}`,
    depositBlockNumber: 10n + n,
    redeemBlockNumber: 11n + n,
    depositGasUsed: 21000n + n,
    redeemGasUsed: 22000n + n,
    shmonReceived: 5n + n,
    shmonAfterRedeem: 4n + n,
    status: "success",
    at: 1700000000000 + i,
    ...overrides,
  };
}

// ── 5건 저장 + 재읽기 BigInt 왕복 + 최신순 ──────────────────────────────
{
  const { state, localStorage, rememberReceipt, readReceipts } = makeSandbox();
  for (let i = 0; i < 5; i += 1) rememberReceipt(makeReceipt(i));

  check("5건 저장 -> 메모리에 5건", state.receipts.length, 5);

  const reread = readReceipts();
  // readReceipts 는 localStorage 를 다시 읽는다 — makeSandbox 의 같은 인스턴스를 쓰므로
  // 위에서 rememberReceipt 가 쓴 값을 그대로 재읽는다.
  check("재읽기 -> 5건", reread.length, 5);
  check("최신순 -> 맨 앞이 마지막에 넣은 것(txHash)", reread[0].txHash, "0xtx4");
  check("최신순 -> 맨 뒤가 처음 넣은 것(txHash)", reread[4].txHash, "0xtx0");

  // BigInt 왕복 — 저장은 문자열, 재읽기는 다시 BigInt 여야 한다.
  const row = reread[0];
  check("BigInt 왕복 -> before 는 진짜 BigInt", typeof row.before, "bigint");
  check("BigInt 왕복 -> before 값 보존", row.before, 1004n);
  check("BigInt 왕복 -> after 값 보존", row.after, 904n);
  check("BigInt 왕복 -> gas 값 보존", row.gas, 21004n);
  check("BigInt 왕복 -> sent 값 보존", row.sent, 104n);
  check("BigInt 왕복 -> depositBlockNumber 값 보존", row.depositBlockNumber, 14n);
  check("BigInt 왕복 -> redeemBlockNumber 값 보존", row.redeemBlockNumber, 15n);
  check("BigInt 왕복 -> shmonReceived 값 보존", row.shmonReceived, 9n);
  check("BigInt 왕복 -> shmonAfterRedeem 값 보존", row.shmonAfterRedeem, 8n);
  check("BigInt 왕복 -> status 보존", row.status, "success");

  // 저장은 실제 mock storage(메모리)일 뿐, 실제 디스크/사용자 localStorage 가 아니다.
  check("저장은 mock storage 안에서만", localStorage._dump().has("araso.receipts"), true);
}

// ── 같은 마지막 tx 반복 -> 중복 저장 없음 ────────────────────────────────
{
  const { state, rememberReceipt, receiptIdentityKey } = makeSandbox();
  for (let i = 0; i < 5; i += 1) rememberReceipt(makeReceipt(i));
  const beforeKey = receiptIdentityKey(state.receipts[0]);

  // 바로 직전과 완전히 같은 tx 식별자(redeemTxHash)를 가진 receipt 가 또 들어온다 —
  // 값의 다른 부분(at)이 달라도 identity 가 같으면 새 항목을 쌓지 않는다.
  rememberReceipt(makeReceipt(4, { at: 9999999999999 }));

  check("동일 마지막 tx 반복 -> 개수 그대로(5)", state.receipts.length, 5);
  check("동일 마지막 tx 반복 -> identity 그대로", receiptIdentityKey(state.receipts[0]), beforeKey);
  check("동일 마지막 tx 반복 -> 맨 앞 at 값도 안 바뀜(새로 안 쌓임)", state.receipts[0].at, 1700000000004);
}

// ── 서로 다른 실제 identity 는 각각 보존된다 ─────────────────────────────
{
  const { state, rememberReceipt, receiptIdentityKey } = makeSandbox();
  rememberReceipt(makeReceipt(0));
  rememberReceipt(makeReceipt(1));
  // redeemTxHash 가 없고 txHash 만 있는 receipt(§receiptIdentityKey: redeemTxHash 우선,
  // 없으면 txHash) — 그래도 서로 다른 실제 tx 증거라 별개 항목으로 남아야 한다.
  rememberReceipt(makeReceipt(2, { redeemTxHash: "" }));

  check("서로 다른 identity 3건 -> 모두 보존", state.receipts.length, 3);
  const keys = state.receipts.map((r) => receiptIdentityKey(r));
  check("서로 다른 identity -> 중복 없이 3개 unique", new Set(keys).size, 3);
  check("txHash-only identity 도 보존", receiptIdentityKey(state.receipts[0]), "0xtx2");
}

// ── [A-425] 맨 앞이 아닌 기존 identity 재입력 -> 이력·순서·at 불변, 기존 index 를 가리킴 ──
{
  const { state, rememberReceipt, readReceipts, receiptIdentityKey } = makeSandbox();
  rememberReceipt(makeReceipt(0)); // A
  rememberReceipt(makeReceipt(1)); // B -> [B,A]
  rememberReceipt(makeReceipt(0, { at: 9999999999999 })); // A 다시

  check("[B,A]+A -> 개수 2", state.receipts.length, 2);
  check("[B,A]+A -> 순서 B,A", state.receipts.map((r) => receiptIdentityKey(r)).join(","), "0xredeem1,0xredeem0");
  check("[B,A]+A -> receiptIndex 1", state.receiptIndex, 1);
  check("[B,A]+A -> 기존 A at 불변", state.receipts[1].at, 1700000000000);
  const reread = readReceipts();
  check("[B,A]+A -> 재읽기 중복 0", new Set(reread.map((r) => receiptIdentityKey(r))).size, reread.length);
  check("[B,A]+A -> 재읽기 개수 2", reread.length, 2);
}

// ── [A-425] txHash-only identity 도 비인접 중복을 막는다 ──
{
  const { state, rememberReceipt } = makeSandbox();
  rememberReceipt(makeReceipt(0, { redeemTxHash: "" }));
  rememberReceipt(makeReceipt(1));
  rememberReceipt(makeReceipt(0, { redeemTxHash: "" }));
  check("txHash-only 비인접 재입력 -> 개수 2", state.receipts.length, 2);
  check("txHash-only 비인접 재입력 -> index 1", state.receiptIndex, 1);
}

// ── [A-425] identity 없는 두 Receipt 는 합치지 않는다 ──
{
  const { state, rememberReceipt } = makeSandbox();
  rememberReceipt(makeReceipt(0, { redeemTxHash: "", txHash: "" }));
  rememberReceipt(makeReceipt(1, { redeemTxHash: "", txHash: "" }));
  check("identity 없는 2건 -> 둘 다 보관", state.receipts.length, 2);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
