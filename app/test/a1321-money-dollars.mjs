import assert from "node:assert/strict";
import { moneyTabView } from "../src/money-tab.js";

// Screen = dollars (1 USDC shows as $1), ledger = USDC untouched. A Piggy holding anything else without a value stays unknown on its own row.
const at = "2026-10-16T00:00:00.000Z";
const piggy = (id, assets, valuation = null, location = "home") => ({ id, name: id, location, assets, valuation });
const usdc = (q) => ({ symbol: "USDC", quantity: q, decimals: 6, sourceTimestamp: at });
const mon = (q) => ({ symbol: "MON", quantity: q, decimals: 18, sourceTimestamp: at });
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };

{
  const p = piggy("appi", [usdc("99.886735")]);
  const before = JSON.stringify(p);
  const v = moneyTabView({ piggies: [p], totals: { totalUsd: null } });
  ok(v.total === "$99.89", `total ${v.total}`);
  ok(v.piggies[0].amount === "$99.89", `row ${v.piggies[0].amount}`);
  ok(v.assets === "99.8867 USDC", `assets ${v.assets}`);
  ok(JSON.stringify(p) === before, "ledger row untouched");
}
{
  const v = moneyTabView({ piggies: [piggy("a", [usdc("38")]), piggy("b", [usdc("40")])], totals: { totalUsd: null } });
  ok(v.total === "$78.00" && v.piggies.map((r) => r.amount).join() === "$38.00,$40.00", `two ${v.total} ${v.piggies.map((r) => r.amount)}`);
}
{
  const v = moneyTabView({ piggies: [piggy("a", [usdc("38")]), piggy("m", [mon("4.1")])], totals: { totalUsd: null } });
  ok(v.piggies[0].amount === "$38.00" && v.piggies[1].amount === "unknown", `mixed rows ${v.piggies.map((r) => r.amount)}`);
  ok(v.total === "unknown", `mixed total stays not-a-headline (${v.total})`);
}
{
  const v = moneyTabView({ piggies: [piggy("a", [usdc("38")]), piggy("v", [mon("4.1")], { usd: "12.40", source: "x", at })], totals: { totalUsd: null } });
  ok(v.total === "$50.40", `valued + usdc ${v.total}`);
}
{
  const v = moneyTabView({ piggies: [piggy("v", [usdc("20"), mon("4.1")], { usd: "32.40", source: "x", at })], totals: { totalUsd: "32.40" } });
  ok(v.total === "$32.40" && v.piggies[0].amount === "$32.40", "registry valuation still wins");
}
{
  const v = moneyTabView({ piggies: [piggy("e", [])], totals: { totalUsd: null } });
  ok(v.piggies[0].amount === "unknown" && v.total === "unknown", "no assets read = unknown (no $0 invented)");
}
console.log(`PASS  a1321 Money dollars on screen: ${n}/${n}`);
