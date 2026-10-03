// [A-484 Lane C] 두 장 구조 MY MONEY 계약 — 네트워크 0 · 브라우저 0.
//   node app/test/two-paper-money.mjs
// main.js 의 배선은 DOM 결합이 커서 **실제 소스 텍스트**로 계약을 재고,
// 순수 마크업 함수는 직접 호출해 잰다(로직 재작성 0).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeMoneyMarkup, homeMoneyPiggyRows, homeMoneyTotalsNote } from "../src/home-paper.js";
import { projectRegistryTotals } from "../src/piggy-registry.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../src/home-paper.js", import.meta.url), "utf8");
const TS = "2026-09-21T03:00:00Z";
const val = (usd) => ({ usd, source: "pinned", at: TS });

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 가짜 총액을 만들지 않는다 ────────────────────────────────────────────────
check("no total row when any piggy lacks a sourced valuation", () => {
  const piggies = [{ id: "a", name: "Honeybun", valuation: val("200") }, { id: "b", name: "Mochi", valuation: null }];
  const totals = projectRegistryTotals({ piggies });
  const rows = homeMoneyPiggyRows({ totals, piggies });
  assert.equal(rows.some((r) => r.label === "total"), false);
  // [A-685] re-pinned: A-684 N8 English (same claim: total waits for every Piggy's value)
  assert.match(homeMoneyTotalsNote(totals), /The total shows once every Piggy's value has been read\./);
});

check("a total row appears only when every valuation is sourced", () => {
  const piggies = [{ id: "a", name: "Honeybun", valuation: val("200") }, { id: "b", name: "Mochi", valuation: val("80") }];
  const rows = homeMoneyPiggyRows({ totals: projectRegistryTotals({ piggies }), piggies });
  const total = rows.find((r) => r.label === "total");
  assert.equal(total.amount, "$280.00");
  assert.equal(total.clickable, false);
});

check("a piggy without valuation shows no invented amount", () => {
  const rows = homeMoneyPiggyRows({ piggies: [{ id: "a", name: "Honeybun", valuation: null }] });
  assert.equal(rows[0].amount, null);
});

// [A-510 Stream A] 이력: A-484 는 여기서 "real display 가 있으면 별도 at home 행" 을 단언했다.
// A-508 이후 다중 경로에는 Home 소유 돈 행이 없다 — 옛 인자를 넘겨도 행이 생기지 않아야 한다.
check("multi-Piggy rows never add a separate Home-owned `at home` row", () => {
  assert.equal(homeMoneyPiggyRows({ piggies: [] }).some((r) => r.label === "at home"), false);
  const legacyArg = homeMoneyPiggyRows({ atHome: { display: "0.5 MON" }, piggies: [] });
  assert.equal(legacyArg.length, 0);
  assert.equal(legacyArg.some((r) => r.label === "at home"), false);
});

check("no growth/change row is fabricated anywhere in the row builder", () => {
  const rows = homeMoneyPiggyRows({
    totals: projectRegistryTotals({ piggies: [{ id: "a", valuation: val("10") }] }),
    piggies: [{ id: "a", name: "A", valuation: val("10") }],
  });
  // '+$' 같은 증감 표시는 근거가 없으면 만들어지지 않는다
  assert.equal(rows.some((r) => typeof r.amount === "string" && r.amount.startsWith("+")), false);
});

// ── 2. 행은 오른쪽 HISTORY 의 정체성을 바꾼다 — 세 번째 종이가 아니다 ────────────
check("each piggy row carries its own identity id", () => {
  const rows = homeMoneyPiggyRows({ piggies: [{ id: "honeybun", name: "Honeybun" }, { id: "mochi", name: "Mochi" }] });
  const ids = rows.filter((r) => r.clickable).map((r) => r.id);
  assert.deepEqual(ids, ["homeMoneyPiggyRow--honeybun", "homeMoneyPiggyRow--mochi"]);
  assert.equal(new Set(ids).size, ids.length); // 서로 겹치지 않는다
});

check("selecting a row switches the right HISTORY identity only", () => {
  assert.match(MAIN, /homeMoneyPiggyRow--/);
  assert.match(MAIN, /state\.historyPiggyId = moneyPiggyRow\.id\.slice/);
  assert.match(MAIN, /openRecordsCard\(\)/);
  // 새 종이/새 씬을 만들지 않는다
  assert.equal(/thirdPaper|piggyDetailPaper|new Paper/i.test(MAIN.split("[A-484 Lane C]")[1] || ""), false);
});

check("away is a quiet state label, never a replacement for the amount", () => {
  const rows = homeMoneyPiggyRows({ piggies: [{ id: "m", name: "Mochi", location: "away", valuation: val("80") }] });
  assert.match(rows[0].label, /Mochi\s+away/);
  assert.equal(rows[0].amount, "$80");
});

// ── 3. 기존 HOME records 동작은 그대로다 ────────────────────────────────────────
check("HOME records still opens the full history with no identity filter", () => {
  assert.match(MAIN, /#homeRecordsButton/);
  const block = MAIN.slice(MAIN.indexOf('#homeRecordsButton') - 400, MAIN.indexOf('#homeRecordsButton') + 400);
  assert.match(block, /state\.historyPiggyId = null/);
});

check("the HOME records entry markup is untouched", () => {
  assert.match(HOME, /export function homePaperRecordsEntryMarkup/);
  assert.match(HOME, /homePaper__records/);
  assert.match(HOME, /no records yet/);
});

// ── 4. 한 마리일 때 기존 화면이 그대로 나간다 ───────────────────────────────────
check("multi-piggy rows only replace the money body when there is more than one", () => {
  assert.match(MAIN, /snapshot\.piggies\.length > 1/);
  // 기존 with/actually away 행은 여전히 소스에 있다
  assert.match(MAIN, /actually away/);
  assert.match(MAIN, /`with \$\{name\}`/);
});

check("the legacy single Piggy is still read through migration, not invented", () => {
  assert.match(MAIN, /migrateSinglePiggy\(/);
  assert.match(MAIN, /loadRegistry\(/);
});

// ── 5. 읽기 전용 — 이 층에서 돈이 움직이지 않는다 ───────────────────────────────
check("the Lane C wiring writes no money and sends no transaction", () => {
  // Lane C 로 표시된 **각 구간의 직후 40줄**만 본다 — 파일 끝까지 훑으면 무관한 코드가 섞인다.
  const lines = MAIN.split("\n");
  const regions = [];
  lines.forEach((line, i) => {
    if (line.includes("[A-484 Lane C]")) regions.push(lines.slice(i, i + 40).join("\n"));
  });
  assert.ok(regions.length >= 2, "Lane C 구간이 소스에 있어야 한다");
  for (const region of regions) {
    for (const forbidden of ["writeContract", "sendTransaction", "signTransaction", "saveRegistry("]) {
      assert.equal(region.includes(forbidden), false, `Lane C must not call ${forbidden}`);
    }
  }
});

check("the row builder produces no interactive Add money / + Piggy control", () => {
  const rows = homeMoneyPiggyRows({ piggies: [{ id: "a", name: "A" }] });
  assert.equal(rows.some((r) => /add money|\+ piggy/i.test(r.label)), false);
});

// ── 6. 두 장 한계와 종이 문법이 유지된다 ────────────────────────────────────────
check("money markup still renders inside the existing paper cards", () => {
  const html = homeMoneyMarkup({ title: "MY MONEY", time: "9:00", rows: homeMoneyPiggyRows({ piggies: [{ id: "a", name: "A" }] }) });
  assert.match(html, /homePaper__card--money/);
  assert.match(html, /homePaper__card--moneyRows/);
  assert.match(html, /MY MONEY/);
});

check("clickable rows stay ordinary paper rows, not a new panel", () => {
  const html = homeMoneyMarkup({ title: "MY MONEY", time: "", rows: homeMoneyPiggyRows({ piggies: [{ id: "a", name: "A" }] }) });
  assert.match(html, /homePaper__row--tap/);
  assert.equal(/dashboard|chart|graph|<canvas/i.test(html), false);
});

console.log(`\n${pass}/${pass} PASS`);
