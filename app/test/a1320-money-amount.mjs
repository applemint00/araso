import assert from "node:assert/strict";
import { realAssetsLine, moneyTabView } from "../src/money-tab.js";
import { homeMoneyAmountText } from "../src/home-paper.js";

// The Money line uses the Home amount rule (4 places, 6 under 0.001, zeros dropped); no $ value is invented for USDC.
const piggy = (quantity, symbol = "USDC") => ({ id: "p", name: "Honeybun", location: "home", assets: [{ symbol, quantity }], valuation: null });

assert.equal(realAssetsLine([piggy("99.886735")]), "99.8867 USDC");
assert.equal(realAssetsLine([piggy("38")]), "38 USDC");
assert.equal(realAssetsLine([piggy("20.5"), piggy("0.0005", "MON")]), "20.5 USDC · 0.0005 MON");
assert.equal(realAssetsLine([piggy("0.000123")]), "0.000123 USDC");
assert.equal(homeMoneyAmountText("1.23456789"), "1.2346");
assert.equal(homeMoneyAmountText(""), null);
assert.equal(homeMoneyAmountText("x"), null);
const v = moneyTabView({ piggies: [piggy("99.886735")], totals: { totalUsd: null } });
assert.equal(v.assets, "99.8867 USDC");
assert.equal(v.piggies[0].amount, "$99.89");
console.log("PASS  a1320 Money amount line: 9/9");
