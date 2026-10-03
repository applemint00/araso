// [A-485 Lane A] Piggy 별 HISTORY 필터 계약 — 네트워크 0 · 브라우저 0.
//   node app/test/history-filter.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HISTORY_SCOPE,
  filterHistory,
  historyIdentityLabel,
  receiptOwnerId,
  resolveHistorySelection,
} from "../src/history-filter.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

const A = { piggyId: "honeybun", date: "SEP 19", txHash: "0xa1" };
const A2 = { piggyId: "honeybun", date: "SEP 18", txHash: "0xa2" };
const B = { piggyId: "mochi", date: "SEP 17", txHash: "0xb1" };
const LEGACY = { date: "SEP 10", txHash: "0xL1" };              // piggyId 없음
const LEGACY_EMPTY = { piggyId: "   ", date: "SEP 09", txHash: "0xL2" };
const ALL = [A, B, A2, LEGACY, LEGACY_EMPTY];

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. A 는 A 것만, B 는 B 것만 ────────────────────────────────────────────────
check("each Piggy sees only its own receipts", () => {
  const a = filterHistory(ALL, "honeybun");
  const b = filterHistory(ALL, "mochi");
  assert.deepEqual(a.rows.map((r) => r.receipt.txHash), ["0xa1", "0xa2"]);
  assert.deepEqual(b.rows.map((r) => r.receipt.txHash), ["0xb1"]);
  assert.equal(a.scope, HISTORY_SCOPE.PIGGY);
});

check("no cross-Piggy leakage in either direction", () => {
  const a = filterHistory(ALL, "honeybun");
  assert.equal(a.rows.some((r) => r.receipt.piggyId === "mochi"), false);
  const b = filterHistory(ALL, "mochi");
  assert.equal(b.rows.some((r) => r.receipt.piggyId === "honeybun"), false);
});

check("original indices survive filtering so detail view stays correct", () => {
  const a = filterHistory(ALL, "honeybun");
  assert.deepEqual(a.rows.map((r) => r.index), [0, 2]); // ALL 안의 실제 자리
  const b = filterHistory(ALL, "mochi");
  assert.deepEqual(b.rows.map((r) => r.index), [1]);
});

// ── 2. 주인을 모르는 기록은 **추측해서 배정하지 않는다** ─────────────────────────
check("ownerless receipts are never assigned to a Piggy", () => {
  assert.equal(receiptOwnerId(LEGACY), null);
  assert.equal(receiptOwnerId(LEGACY_EMPTY), null);  // 빈 문자열은 주인이 아니다
  assert.equal(receiptOwnerId(null), null);
  assert.equal(receiptOwnerId({ piggyId: 42 }), null);
  for (const id of ["honeybun", "mochi", "anything"]) {
    const rows = filterHistory(ALL, id).rows;
    assert.equal(rows.some((r) => receiptOwnerId(r.receipt) === null), false, `${id} must not absorb ownerless receipts`);
  }
});

check("ownerless receipts stay visible on the legacy/global path", () => {
  const all = filterHistory(ALL, null);
  assert.equal(all.scope, HISTORY_SCOPE.ALL);
  assert.equal(all.rows.length, ALL.length);
  assert.equal(all.ownerUnknownCount, 2);
  assert.ok(all.rows.some((r) => r.receipt.txHash === "0xL1"));
});

check("an unknown Piggy id yields an empty list, not someone else's records", () => {
  assert.deepEqual(filterHistory(ALL, "nobody").rows, []);
});

// ── 3. 전환은 결정적이다 ────────────────────────────────────────────────────────
check("switching A -> B changes identity and list deterministically", () => {
  const first = filterHistory(ALL, "honeybun");
  const second = filterHistory(ALL, "mochi");
  const backAgain = filterHistory(ALL, "honeybun");
  assert.notDeepEqual(first.rows.map((r) => r.index), second.rows.map((r) => r.index));
  assert.deepEqual(first.rows.map((r) => r.index), backAgain.rows.map((r) => r.index));
  assert.equal(second.piggyId, "mochi");
});

check("the header identity follows the selected Piggy, and never borrows a name", () => {
  const piggies = [{ id: "honeybun", name: "Honeybun" }, { id: "mochi", name: "Mochi" }];
  assert.equal(historyIdentityLabel({ piggyId: "mochi", piggies, fallbackName: "Chog" }), "Mochi");
  assert.equal(historyIdentityLabel({ piggyId: null, piggies, fallbackName: "Chog" }), "Chog");
  // 이름이 없으면 id 를 쓴다 — 다른 Piggy 이름을 가져오지 않는다
  assert.equal(historyIdentityLabel({ piggyId: "ghost", piggies, fallbackName: "Chog" }), "ghost");
  assert.equal(historyIdentityLabel({ piggyId: "ghost", piggies: [], fallbackName: "Chog" }), "ghost");
});

// ── 4. 고른 Piggy 가 사라지면 전체로 되돌아간다 ─────────────────────────────────
check("a selection that no longer exists falls back to the global path", () => {
  const piggies = [{ id: "honeybun" }];
  assert.equal(resolveHistorySelection("honeybun", piggies), "honeybun");
  assert.equal(resolveHistorySelection("mochi", piggies), null);   // 다른 Piggy 를 보여주지 않는다
  assert.equal(resolveHistorySelection("", piggies), null);
  assert.equal(resolveHistorySelection(null, piggies), null);
});

check("resetting the selection does not disturb the global list", () => {
  const before = filterHistory(ALL, null).rows.map((r) => r.index);
  filterHistory(ALL, "honeybun");
  const after = filterHistory(ALL, null).rows.map((r) => r.index);
  assert.deepEqual(after, before);
});

// ── 5. HOME records 경로는 새 코드에 기대지 않는다 ──────────────────────────────
check("the global path in main.js does not touch the registry or the filter", () => {
  const i = MAIN.indexOf("function historyRows()");
  assert.ok(i > 0, "historyRows must exist");
  const body = MAIN.slice(i, i + 700);
  const globalBranch = body.slice(0, body.indexOf("const piggies"));
  assert.match(globalBranch, /if \(!state\.historyPiggyId\) return state\.receipts\.map/);
  assert.equal(globalBranch.includes("secondPiggyRegistrySnapshot"), false);
  assert.equal(globalBranch.includes("filterHistory"), false);
});

check("HOME records button still resets the selection to global", () => {
  const i = MAIN.indexOf("#homeRecordsButton");
  const block = MAIN.slice(i - 500, i + 300);
  assert.match(block, /state\.historyPiggyId = null/);
});

check("a selected Piggy does not borrow the account address in the header", () => {
  // [A-685] re-pinned: A-684 no-address masthead (same claim, stricter: the header borrows no address at all)
  const mast = MAIN.slice(MAIN.indexOf("function recordsMastheadMarkup("));
  const mastFn = mast.slice(0, mast.indexOf("\n}\n"));
  assert.ok(mastFn.includes("recordsCard__identityName"));
  assert.equal(/state\.address|identityAddress/.test(mastFn.replace(/\/\/[^\n]*/g, "")), false);
});

// ── 7. [A-540] 카드마다 자기 records — 위임 클릭이 historyPiggyId 만 바꾼다 ─────────────
check("resident records delegation targets exactly .homePaper__records[data-piggy-id]", () => {
  assert.match(MAIN, /event\.target\.closest\("\.homePaper__records\[data-piggy-id\]"\)/);
});

check("clicking a resident's records entry changes only historyPiggyId — never the signer/session/permission/money selection", () => {
  const i = MAIN.indexOf('const residentRecordsButton = event.target.closest(".homePaper__records[data-piggy-id]");');
  assert.ok(i > 0, "resident records branch must exist");
  const end = MAIN.indexOf("\n  }", MAIN.indexOf("openRecordsCard();", i));
  const branch = MAIN.slice(i, end);
  assert.match(branch, /state\.historyPiggyId = residentRecordsButton\.dataset\.piggyId \|\| null/);
  assert.match(branch, /openRecordsCard\(\)/);
  // exactly one state.* assignment in this branch, and it is historyPiggyId — no applyPiggySelection/
  // moneyIntent/session/permission mutation rides along with a records click.
  assert.deepEqual(branch.match(/state\.\w+ =/g), ["state.historyPiggyId ="]);
  assert.equal(branch.includes("applyPiggySelection"), false);
  assert.equal(branch.includes("activateSigningSession"), false);
  assert.equal(branch.includes("issuePermission"), false);
  assert.equal(branch.includes("moneyIntent"), false);
});

check("no duplicate #homeRecordsButton when the Home paper has 2+ resident cards", () => {
  // 다중 카드 마크업은 카드마다 homePaperRecordsEntryMarkup(count, id) 를 부르고, id 가 있으면
  // data-piggy-id 만 단다(§home-paper.js) — #homeRecordsButton 은 한 마리 폴백 경로(id 없음)
  // 에서만, 그리고 그 경로는 카드를 정확히 한 장만 그린다.
  const HOME_PAPER = readFileSync(new URL("../src/home-paper.js", import.meta.url), "utf8");
  assert.match(HOME_PAPER, /const attr = piggyId \? ` data-piggy-id="\$\{escapeHtml\(piggyId\)\}"` : ` id="homeRecordsButton"`;/);
});

// ── 8. 빈/이상 입력에도 죽지 않는다 ─────────────────────────────────────────────
check("empty or malformed input is handled without throwing", () => {
  assert.deepEqual(filterHistory([], null).rows, []);
  assert.deepEqual(filterHistory(null, null).rows, []);
  assert.deepEqual(filterHistory(undefined, "x").rows, []);
  assert.equal(historyIdentityLabel({}), "");
});

console.log(`\n${pass}/${pass} PASS`);
