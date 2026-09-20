// [A-459 Lane C] 오른쪽 HISTORY 종이의 머리(masthead)와 Piggy identity 계약을 재는 테스트.
//   node app/test/records-history-identity.mjs
// 네트워크 0 · 브라우저 0 · 디스크 쓰기 0 · 실제 localStorage 0.
// receipt-storage.mjs 와 같은 방식: main.js 소스에서 실제 함수 텍스트를 잘라 node:vm 격리
// 컨텍스트에서 돌린다 — 마크업 로직을 손으로 다시 쓰지 않는다.
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`소스에서 못 찾음(끝): ${endMarker}`);
  return SRC.slice(start, end);
}

const src = cut("// [A-459 Lane C] 오른쪽 HISTORY 종이 머리", "// 선택한 영수증 상세");
if (!src.includes("function recordsMastheadMarkup(") || !src.includes("function recordsCardListMarkup(")) {
  throw new Error("잘라낸 구간에 masthead/list 마크업 함수가 없음 — 마커 확인 필요");
}

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
function build({ receipts, address, name }) {
  const ctx = {
    state: { receipts, address, recordsDetailIndex: null },
    displayPiggyName: () => name,
    escapeHtml: (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    receiptPaperFields: ({ receipt }) => ({ name, date: receipt.date, statusLabel: receipt.statusLabel }),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nglobalThis.__list = recordsCardListMarkup;\nglobalThis.__mast = recordsMastheadMarkup;`, ctx);
  return { list: ctx.__list, masthead: ctx.__mast };
}

let pass = 0, fail_ = 0;
const checkTrue = (label, cond) => {
  if (cond) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label}`); fail_ += 1; }
};
const check = (label, got, want) => checkTrue(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

const threeReceipts = [
  { date: "SEP 19", statusLabel: "brought back 0.01" },
  { date: "SEP 18", statusLabel: "brought back 0.02" },
  { date: "SEP 17", statusLabel: "came back empty" },
];

// ── 1. 기록이 있을 때: masthead 1회 · identity 1회 · 주소 정확히 1회 ────────────────────
{
  const { list } = build({ receipts: threeReceipts, address: ADDRESS, name: "Harness" });
  const html = list();
  check("masthead 는 정확히 1회", (html.match(/recordsCard__masthead/g) || []).length, 1);
  check("identity 줄은 정확히 1회", (html.match(/recordsCard__identity"/g) || []).length, 1);
  check("주소는 정확히 1회 (Job 마다 반복 0)", (html.match(new RegExp(ADDRESS, "g")) || []).length, 1);
  checkTrue("HISTORY 계층 표식 있음", html.includes('class="recordsCard__tier">HISTORY<'));
  checkTrue("HISTORY 는 좁은 page 칸에 넣지 않는다(격자 안 벌림)", !/recordsCard__page"[^>]*>HISTORY/.test(html));
  checkTrue("Piggy 이름 표시", html.includes("Harness"));
  checkTrue("요일 small 태그 있음", /<small>[A-Z]+<\/small>/.test(html));
  checkTrue("날짜는 대문자 월+일", /<span class="recordsCard__date">[A-Z]+ \d+/.test(html));
  check("row 는 전체 3개(최신순·전체 접근 유지)", (html.match(/recordsCard__row"/g) || []).length, 3);
  // [A-460] 텍스트 전용 — folder 그림/슬립 0
  checkTrue("folder 패널 0", !html.includes("recordsCard__panel--folder"));
  checkTrue("recordsFolder slip 0", !html.includes("recordsFolder"));
  checkTrue("folder-back.png 0", !html.includes("folder-back"));
  checkTrue("folder-front.png 0", !html.includes("folder-front"));
  checkTrue("HISTORY 목록에 <img> 0", !/<img/.test(html));
  checkTrue("caption 은 보관 수만", html.includes("kept 3") && !html.includes("showing latest"));
  checkTrue("close 버튼 유지", html.includes('id="recordsCardClose"'));
  checkTrue("행에는 주소가 없다", !/recordsCard__row[\s\S]*?0x[0-9a-fA-F]{40}/.test(html));
}

// ── 2. 기록이 없을 때도 같은 껍데기 — 단 가짜 receipt 0 ─────────────────────────────────
{
  const { list } = build({ receipts: [], address: ADDRESS, name: "Harness" });
  const html = list();
  checkTrue("빈 상태에도 masthead", html.includes("recordsCard__masthead"));
  checkTrue("빈 상태에도 identity", html.includes("recordsCard__identity"));
  checkTrue("빈 상태에도 주소 1회", (html.match(new RegExp(ADDRESS, "g")) || []).length === 1);
  checkTrue("빈 상태 문구 유지", html.includes("No records yet"));
  checkTrue("가짜 receipt row 0", !html.includes("recordsCard__row"));
  checkTrue("빈 상태에도 folder 그림 0", !html.includes("recordsFolder") && !html.includes("folder-back") && !html.includes("folder-front"));
  checkTrue("빈 상태에 <img> 0", !/<img/.test(html));
}

// ── 3. 주소가 없으면 지어내지 않는다 ───────────────────────────────────────────────────
{
  for (const [label, addr] of [["빈 문자열", ""], ["null", null], ["undefined", undefined]]) {
    const { list } = build({ receipts: threeReceipts, address: addr, name: "Harness" });
    const html = list();
    checkTrue(`주소 ${label} -> address span 0`, !html.includes("recordsCard__identityAddress"));
    checkTrue(`  주소 ${label} -> 0x 40hex 0`, !/0x[0-9a-fA-F]{40}/.test(html));
    checkTrue(`  그래도 이름·masthead 는 보인다 (${label})`, html.includes("recordsCard__masthead") && html.includes("Harness"));
  }
}

// ── 4. DOM 에는 실제 주소 그대로 — 자르거나 치환하지 않는다 ─────────────────────────────
{
  const { list } = build({ receipts: [], address: ADDRESS, name: "Harness" });
  const html = list();
  checkTrue("주소 원문 그대로(…·省略 0)", html.includes(ADDRESS));
  checkTrue("줄임표 0", !html.includes("…") && !html.includes("..."));
}

// ── 5. 새 라벨 copy 를 발명하지 않는다 ─────────────────────────────────────────────────
{
  const { list } = build({ receipts: [], address: ADDRESS, name: "Harness" });
  const html = list();
  for (const word of ["address", "Address", "wallet", "Wallet", "account", "Account", "주소"]) {
    checkTrue(`라벨 문구 '${word}' 0`, !html.includes(`>${word}`) && !html.includes(`${word}:`));
  }
}

// ── 6. CSS 계약 — Explore masthead 값을 공유하고 새 수치를 만들지 않는다 ─────────────────
{
  checkTrue("masthead 폰트 룰 공유", /\.secondJourney__masthead,\s*\n\.recordsCard__masthead,\s*\n\.recordsCard__tier \{/.test(CSS));
  // [A-460] HISTORY 계층도 같은 글자값을 **직접** 받아야 한다(형제라 상속 안 됨 — A-459 오보고 교정)
  // 공유 masthead 규칙 블록(선택자 ~ 첫 닫는 중괄호) 안에 tier 가 들어 있어야 한다.
  {
    const i = CSS.indexOf(".secondJourney__masthead,");
    const shared = CSS.slice(i, CSS.indexOf("}", i));
    checkTrue("HISTORY tier 가 공유 글자값을 직접 받는다", shared.includes(".recordsCard__tier"));
    checkTrue("  공유 블록에 Playfair 700 10px 값 그대로", shared.includes('font: 700 10px/1 "Playfair Display"'));
  }
  checkTrue("date 룰 공유", /\.secondJourney__date,\s*\n\.recordsCard__date \{/.test(CSS));
  checkTrue("dot 룰 공유", /\.secondJourney__dot,\s*\n\.recordsCard__dot \{/.test(CSS));
  checkTrue("page 룰 공유", /\.secondJourney__page,\s*\n\.recordsCard__page \{/.test(CSS));
  checkTrue("주소 글자값은 caption 룰 공유", /\.recordsCard__caption,\s*\n\.recordsCard__identityAddress \{/.test(CSS));
  checkTrue("긴 주소 wrap 처리", /\.recordsCard__identityAddress \{[\s\S]*?overflow-wrap: anywhere/.test(CSS));
  const block = CSS.slice(CSS.indexOf(".recordsCard__masthead {"), CSS.indexOf(".recordsCard__identity {"));
  checkTrue("records masthead/tier 블록에 새 font-size 0", !/font-size|line-height|letter-spacing/.test(block));
  // records 전용 override 블록(위 block 슬라이스)에 격자 재정의가 없어야 한다 — Explore 격자를 그대로 쓴다.
  checkTrue("Explore 격자를 덮지 않는다", !block.includes("grid-template-columns"));
  checkTrue("격자 정의는 공유 룰 1곳뿐", (CSS.match(/grid-template-columns: 60px 1fr 14px/g) || []).length === 1);
}

// ── 7. Send 카드 주소 0 (A-454) 유지 ──────────────────────────────────────────────────
{
  checkTrue("Send 카드 address 빈 값 유지", /address:\s*""/.test(SRC));
}

// ── 8. [A-460] 소스 계약 — HISTORY 경로에 folder/receipt 그림 재사용 0 ──────────────────
{
  // 주석은 빼고 **실행되는 코드**만 본다 — 아래 주석들이 'folder-back' 같은 낱말을 설명으로 쓴다.
  const listSrc = SRC.slice(SRC.indexOf("function recordsCardListMarkup() {"), SRC.indexOf("function recordsCardBodyMarkup() {"))
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  checkTrue("records 마크업에 folder-back/front 0", !listSrc.includes("folder-back") && !listSrc.includes("folder-front"));
  checkTrue("records 마크업에 recordsFolder 0", !listSrc.includes("recordsFolder"));
  checkTrue("records detail 이 receiptPaperMarkup 을 쓰지 않는다", !listSrc.includes("receiptPaperMarkup"));
  checkTrue("records 마크업에 <img> 0", !listSrc.includes("<img"));
  // 그림은 사라져도 데이터·동작은 남는다
  checkTrue("back to list 유지", listSrc.includes('id="recordsCardBack"'));
  checkTrue("close 유지", listSrc.includes('id="recordsCardClose"'));
  checkTrue("detail 이 receiptRows 사용", listSrc.includes("receiptRows(receipt)"));
  checkTrue("detail 이 receiptCheck 사용", listSrc.includes("receiptCheck(receipt)"));
  checkTrue("내부 tx/raw 를 새로 넓히지 않음(receiptRows 밖 필드 추가 0)", !/depositTxHash|grantTxHash|shmonReceived/.test(listSrc));
  // piggy-return 연출의 folder 그림은 그대로 살아 있다(다른 경로)
  const returnSrc = readFileSync(new URL("../src/piggy-return.js", import.meta.url), "utf8");
  checkTrue("piggy-return 의 folder 연출은 건드리지 않음", returnSrc.includes("folder-back") && returnSrc.includes("folder-front"));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
