// [A-510 Stream C] $0 Piggy — **$0 은 모름이 아니다.** 네트워크 0 · 체인 0.
//   node app/test/zero-piggy.mjs
//
// A-508 캐논: $0 Piggy 는 보이고, MY MONEY 합계를 숨기지 않는다. 모르는 값은 여전히 모름이다.
// MY MONEY 는 Piggy 총액을 **한 번씩만** 더한다 — `at home`/`working with` 은 그 총액 안의 상태다.
import assert from "node:assert/strict";
import { createPiggy, isKnownZeroValuation, normalizePiggy, projectRegistryTotals } from "../src/piggy-registry.js";
import { homeMoneyPiggyRows, homeMoneyTotalsNote } from "../src/home-paper.js";

const TS = "2026-09-22T04:00:00Z";
const val = (usd) => ({ usd, source: "aave-v3-oracle", at: TS });
const p = (id, valuation, extra = {}) => normalizePiggy({ id, name: id, location: "home", valuation, ...extra }).piggy;

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("known zero and unknown are different things", () => {
  assert.equal(isKnownZeroValuation(val("0")), true);
  assert.equal(isKnownZeroValuation(val("0.00")), true);
  assert.equal(isKnownZeroValuation(val("0.01")), false);
  assert.equal(isKnownZeroValuation(null), false);           // 모름은 0 이 아니다
  assert.equal(p("x", val("0")).valuation.usd, "0");        // 저장 계약이 $0 을 지우지 않는다
});

check("all known including one $0 → total exists and counts the $0 as zero", () => {
  const t = projectRegistryTotals({ piggies: [p("honeybun", val("200")), p("mochi", val("7")), p("bebe", val("0"))] });
  assert.equal(t.totalUsd, "207.00");
  assert.equal(t.reason, null);
  assert.equal(t.knownZeroCount, 1);
});

check("several $0 Piggies — total is $0.00 and still shown", () => {
  const t = projectRegistryTotals({ piggies: [p("a", val("0")), p("b", val("0"))] });
  assert.equal(t.totalUsd, "0.00");
  const rows = homeMoneyPiggyRows({ totals: t, piggies: t.perPiggy });
  assert.equal(rows[0].label, "total");
  assert.equal(rows[0].amount, "$0.00");
  assert.equal(homeMoneyTotalsNote(t), "");
});

check("unknown among known stays unknown — no total is fabricated, nothing becomes 0", () => {
  const t = projectRegistryTotals({ piggies: [p("honeybun", val("200")), p("mochi", null)] });
  assert.equal(t.totalUsd, null);
  assert.equal(t.reason, "incomplete_valuation");
  assert.equal(t.unknownCount, 1);
  const rows = homeMoneyPiggyRows({ totals: t, piggies: t.perPiggy });
  assert.equal(rows.find((r) => r.id === "homeMoneyPiggyRow--mochi").amount, null); // 모름 → 0 으로 바꾸지 않음
});

check("a $0 Piggy is not what hides the total", () => {
  const withZero = projectRegistryTotals({ piggies: [p("honeybun", val("200")), p("bebe", val("0"))] });
  assert.equal(withZero.totalUsd, "200.00");
  const withUnknown = projectRegistryTotals({ piggies: [p("honeybun", val("200")), p("bebe", null)] });
  assert.equal(withUnknown.totalUsd, null);
});

check("a $0 Piggy row stays visible and reads $0, not blank", () => {
  const piggies = [p("honeybun", val("200")), p("bebe", val("0"))];
  const rows = homeMoneyPiggyRows({ totals: projectRegistryTotals({ piggies }), piggies });
  const bebe = rows.find((r) => r.id === "homeMoneyPiggyRow--bebe");
  assert.ok(bebe, "$0 Piggy must have a row");
  assert.equal(bebe.amount, "$0");
  assert.equal(bebe.clickable, true);
});

check("a newborn +Piggy lands as a visible $0 row without breaking the total", () => {
  const { piggies } = createPiggy({ piggies: [p("honeybun", val("200"))], newPiggy: { id: "bebe", name: "Bebe" }, at: TS });
  const t = projectRegistryTotals({ piggies });
  assert.equal(t.totalUsd, "200.00");
  const rows = homeMoneyPiggyRows({ totals: t, piggies });
  assert.equal(rows.find((r) => r.id === "homeMoneyPiggyRow--bebe").amount, "$0");
});

check("total counts each Piggy once — at home / working with are never added again", () => {
  // Honeybun $200 = at home $180 + working with $20. 총액은 Piggy 평가 하나로만 들어간다.
  const honeybun = p("honeybun", val("200"), {
    assets: [
      { symbol: "USDC", quantity: "180", decimals: 6, sourceTimestamp: TS },
      { symbol: "aUSDC", quantity: "20", decimals: 6, sourceTimestamp: TS },
    ],
  });
  const t = projectRegistryTotals({ piggies: [honeybun, p("mochi", val("7"))] });
  assert.equal(t.totalUsd, "207.00");
  const rows = homeMoneyPiggyRows({ totals: t, piggies: t.perPiggy });
  assert.equal(rows.filter((r) => r.label === "at home" || r.label === "working with").length, 0);
  assert.equal(rows.length, 3); // total + 두 Piggy
});

console.log(`\n${pass}/${pass} PASS`);
