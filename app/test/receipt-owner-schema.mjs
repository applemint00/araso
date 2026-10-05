// [A-544 Repair A] receipt owner tag — 스키마 왕복 + 소스 계약을 재는 테스트.
//   node app/test/receipt-owner-schema.mjs
//
// receipt-storage.mjs/return-outcome.mjs/send-lock.mjs 와 같은 기법(A-048): main.js 의
// 실제 함수/구간 **텍스트만** 잘라내 node:vm 격리 컨텍스트나 소스 문자열 검사로 잰다.
// 로직을 손으로 다시 쓰지 않는다.
//
// §1 은 readReceipts()/serializeReceiptRow()/rememberReceipt() 의 실제 소스로 저장 왕복을
// 재고(receipt-storage.mjs 와 같은 vm 기법), history-filter.js 의 진짜 receiptOwnerId() 로
// "주인이 됐는가"를 판정한다(가짜 판정을 새로 쓰지 않는다).
// §2 는 sendPiggyOnce()/settleSend() 의 실제 소스 텍스트에서 "실행 계정에서, 비동기
// tx/settle 체인 전에 딱 한 번 잡아 그대로 넘긴다"는 계약을 문자열 위치로 증명한다.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { receiptOwnerId } from "../src/history-filter.js";
import { decodeReceiptRow, encodeReceiptRow, receiptIdentityKey as codecReceiptIdentityKey, RECEIPT_KIND } from "../src/receipt-codec.js";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`끝 마커를 못 찾음: ${endMarker}`);
  return SRC.slice(start, end);
}

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

// ── §1 저장 왕복 (실제 readReceipts/serializeReceiptRow/rememberReceipt, 격리 vm) ──────────
const receiptFnsSrc = cut("function readReceipts() {", "\nfunction writeCredential(credential) {");
for (const name of ["readReceipts", "serializeReceiptRow", "receiptIdentityKey", "rememberReceipt"]) {
  if (!receiptFnsSrc.includes(`function ${name}`)) {
    throw new Error(`잘라낸 소스에 ${name} 이 없다 — 마커가 main.js 구조와 어긋남`);
  }
}
function makeSandbox() {
  const map = new Map();
  const localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const state = { receipts: [], receiptIndex: 0 };
  const RECEIPTS_KEY = "araso.receipts";
  // [A-553 HARNESS] 같은 이유로(receipt-storage.mjs 참조) 실제 receipt-codec.js export 를 주입한다.
  const sandbox = {
    localStorage, state, RECEIPTS_KEY, JSON, String, BigInt, Array,
    decodeReceiptRow, encodeReceiptRow, codecReceiptIdentityKey, RECEIPT_KIND,
  };
  vm.createContext(sandbox);
  vm.runInContext(receiptFnsSrc, sandbox, { filename: "receipt-owner-fns.js" });
  return sandbox;
}
function baseReceipt(overrides = {}) {
  return {
    before: 100n, after: 90n, gas: 1n, sent: 1n,
    txHash: "0xa", depositTxHash: "0xd", redeemTxHash: "0xr", grantTxHash: "0xg",
    depositBlockNumber: 1n, redeemBlockNumber: 2n, depositGasUsed: 1n, redeemGasUsed: 1n,
    shmonReceived: 1n, shmonAfterRedeem: 1n, status: "success", at: 1,
    ...overrides,
  };
}

// 표시가 있는(tagged) 영수증은 그 id 그대로 왕복한다.
{
  const { rememberReceipt, readReceipts } = makeSandbox();
  rememberReceipt(baseReceipt({ redeemTxHash: "0xhoney", piggyId: "legacy-0xhoneybun" }));
  const reread = readReceipts();
  check("tagged 영수증 -> piggyId 그대로 왕복", reread[0].piggyId, "legacy-0xhoneybun");
  check("tagged 영수증 -> receiptOwnerId() 가 그 id 를 본다", receiptOwnerId(reread[0]), "legacy-0xhoneybun");
}
// 앞뒤 공백은 trim 되어 정확한 문자열로 보존된다(§Repair A "정확한 id 문자열을 trim 뒤 보존").
{
  const { rememberReceipt, readReceipts } = makeSandbox();
  rememberReceipt(baseReceipt({ redeemTxHash: "0xmochi", piggyId: "  legacy-0xmochi  " }));
  const reread = readReceipts();
  check("피기id 앞뒤 공백 -> trim 되어 보존", reread[0].piggyId, "legacy-0xmochi");
}
// 옛 ownerless 기록(피기id 필드 자체가 없음)은 왕복 뒤에도 ownerless 그대로다 — 추론 0.
{
  const { rememberReceipt, readReceipts } = makeSandbox();
  rememberReceipt(baseReceipt({ redeemTxHash: "0xlegacy" }));
  const reread = readReceipts();
  check("옛 ownerless 기록 -> piggyId 필드 자체가 생기지 않는다", "piggyId" in reread[0], false);
  check("옛 ownerless 기록 -> receiptOwnerId() null", receiptOwnerId(reread[0]), null);
}
// 빈칸/공백뿐/문자열 아님 -> 어떤 경우에도 주인이 되지 않는다(추측 배정 0).
for (const [label, bad] of [["빈 문자열", ""], ["공백만", "   "], ["숫자", 123], ["null", null], ["true", true], ["빈 배열", []]]) {
  const { rememberReceipt, readReceipts } = makeSandbox();
  rememberReceipt(baseReceipt({ redeemTxHash: `0xbad-${label}`, piggyId: bad }));
  const reread = readReceipts();
  check(`piggyId=${label} -> 저장 뒤 필드 없음(주인 안 됨)`, "piggyId" in reread[0], false);
  check(`piggyId=${label} -> receiptOwnerId() null`, receiptOwnerId(reread[0]), null);
}
// 같은 계정 안에서도 서로 다른 영수증 두 건은 각자의 피기 id 를 유지한다(교차 오염 0).
{
  const { rememberReceipt, readReceipts } = makeSandbox();
  rememberReceipt(baseReceipt({ redeemTxHash: "0xhb", piggyId: "legacy-hb" }));
  rememberReceipt(baseReceipt({ redeemTxHash: "0xmo", piggyId: "piggy-mo" }));
  rememberReceipt(baseReceipt({ redeemTxHash: "0xlg" })); // ownerless
  const reread = readReceipts(); // 최신순: lg, mo, hb
  check("3건 각자 piggyId 보존 -> lg ownerless", "piggyId" in reread[0], false);
  check("3건 각자 piggyId 보존 -> mo", reread[1].piggyId, "piggy-mo");
  check("3건 각자 piggyId 보존 -> hb", reread[2].piggyId, "legacy-hb");
}

// ── §2 소스 계약: sendPiggyOnce 는 실행 계정에서, 비동기 tx/settle 체인 전에 캡처해
//     그대로 settleSend 로 넘긴다 — historyPiggyId/현재 UI 선택은 절대 쓰지 않는다 ─────────
const onceSrc = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");
const settleSendSrc = cut("async function settleSend(", "// 결말 하나가 화면과 저장을 같이 정한다");

const capturePos = onceSrc.indexOf("indexedPiggyId(account.address)");
check("sendPiggyOnce 소스 -> indexedPiggyId(account.address) 호출이 있다", capturePos >= 0, true);

const accountAssignPos = onceSrc.indexOf("const account = activeAccount;");
check("캡처가 account 확정 직후 자리에 있다(그 전이 아니다)", accountAssignPos >= 0 && capturePos > accountAssignPos, true);

// [A-707 M2-beta] declared marker update: the first async tx-chain step is now signSendStep(...) (sign-before-send); walletClient.sendTransaction no longer exists.
const firstSendTxPos = onceSrc.indexOf("signSendStep(walletClient, account, plan.depositTx)");
check("캡처가 첫 sign/send(비동기 tx 체인 시작)보다 앞에 있다", firstSendTxPos >= 0 && capturePos < firstSendTxPos, true);

const markSettlingPos = onceSrc.indexOf("markSettling();");
check("캡처가 markSettling() 호출보다 앞에 있다", markSettlingPos >= 0 && capturePos < markSettlingPos, true);

const settleCallPos = onceSrc.indexOf("settleSend({");
check("캡처가 settleSend 호출보다 앞에 있다", settleCallPos >= 0 && capturePos < settleCallPos, true);

check(
  "캡처한 executingPiggyId 를 그대로 settleSend 에 넘긴다(다른 값으로 안 바꿔치기)",
  /settleSend\(\{[\s\S]{0,120}piggyId:\s*executingPiggyId,/.test(onceSrc),
  true,
);

check("sendPiggyOnce 는 state.historyPiggyId/선택 UI 를 owner 원천으로 쓰지 않는다(현재 HISTORY 선택 미참조, 실행 코드에 없음)", onceSrc.includes("state.historyPiggyId"), false);

check("settleSend 소스는 state.historyPiggyId 를 참조하지 않는다(넘겨받은 값만 쓴다)", settleSendSrc.includes("state.historyPiggyId"), false);
check("settleSend 는 호출자가 넘긴 piggyId 파라미터 값만 쓴다(내부에서 새로 추론하지 않음)", /piggyId:\s*piggyId\.trim\(\)/.test(settleSendSrc), true);
check("settleSend 는 piggyId 를 옵션으로 받는다(기본값 있음 -> 옛 호출부 호환)", /async function settleSend\(\{[^}]*piggyId\s*=\s*""/.test(settleSendSrc), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
