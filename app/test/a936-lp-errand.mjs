// [A-936] LP errand: one lane, the 2-string copy block, placement by the existing order (Owner 08:2x / 08:3x: mainnet-possible → open first,
// otherwise watch right after grow), FORK-only receipt data, no execution. Node only, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as JF from "../src/job-feed.js";
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const ids = JF.EXPLORE_ERRANDS.map((e) => e.id);
const BASE8 = ["market", "order", "clean", "claim", "asset-piece", "grow", "move", "stay"];
check("exactly one lp errand, lane LP, reason liquidity", () => { const lp = JF.EXPLORE_ERRANDS.filter((e) => e.id === "lp"); assert.equal(lp.length, 1); assert.equal(lp[0].lane, "LP"); assert.equal(lp[0].reason, "liquidity"); });
check("no other errand shares the LP lane (candidate family mapping stays 1:1)", () => assert.equal(JF.EXPLORE_ERRANDS.filter((e) => e.lane === "LP").length, 1));
check("label = the copy constant (exactly 2 strings in the block)", () => { assert.equal(JF.EXPLORE_ERRANDS.find((e) => e.id === "lp").label, JF.LP_ERRAND_COPY.label); // pre-A-944: ["label","receiptLine"]
  assert.deepEqual(Object.keys(JF.LP_ERRAND_COPY).sort(), ["description", "label", "receiptLine"]); });
check("A-944 copy: label approved, receiptLine still open", () => { assert.equal(JF.LP_ERRAND_COPY.label, "help with trades"); assert.equal(JF.LP_ERRAND_COPY.receiptLine, "[COPY OPEN · Owner]"); });
check("this build: live closed → watch 0.34, right after grow", () => { assert.equal(JF.LP_PATH_READY, false); const lp = JF.LP_ERRAND; assert.equal(lp.availability, "watch"); assert.equal(lp.baseScore, 0.34); assert.equal(ids.indexOf("lp"), ids.indexOf("grow") + 1); });
check("the other 8 keep their relative order", () => assert.deepEqual(ids.filter((id) => id !== "lp"), BASE8));
check("rounds of 3 → 3/3/3, lp = round 3 first", () => { assert.equal(ids.length, 9); assert.equal(ids.indexOf("lp"), 6); });
check("open rule: a score above today's top would be first (insert-by-score, no sort/slot rule)", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "job-feed.js"), "utf8");
  assert.match(src, /baseScore: LP_PATH_READY \? 0\.46 : 0\.34/); assert.match(src, /availability: LP_PATH_READY \? "open" : "watch"/);
  const top = Math.max(...JF.EXPLORE_ERRANDS.filter((e) => e.id !== "lp").map((e) => e.baseScore)); assert.ok(0.46 > top);
});
check("open placement exercised: an open LP (0.46) is inserted FIRST, watch (0.34) right after grow (insertByScore on the real base list)", () => {
  const open = JF.insertByScore(JF.BASE_EXPLORE_ERRANDS, { ...JF.LP_ERRAND, baseScore: 0.46, availability: "open" }).map((e) => e.id);
  assert.equal(open[0], "lp"); assert.deepEqual(open.slice(1), BASE8);
  const watch = JF.insertByScore(JF.BASE_EXPLORE_ERRANDS, JF.LP_ERRAND).map((e) => e.id);
  assert.equal(watch.indexOf("lp"), watch.indexOf("grow") + 1); assert.deepEqual(watch.filter((id) => id !== "lp"), BASE8);
});
check("FORK grade only — never LIVE / READY", () => { assert.equal(JF.LP_FORK_RECEIPT.grade, "FORK"); const f = JF.lpForkReceiptFields("Honeybun", new Date(0)); assert.equal(f.grade, "FORK"); assert.match(f.statusLabel, /^fork · /); assert.ok(!/live|ready/i.test(JSON.stringify(f))); });
check("FORK receipt data = A-808 values; venue/pair kept out of the receipt fields", () => { const f = JF.lpForkReceiptFields("x", new Date(0)); assert.equal(f.wentOut, "10 USDC"); assert.equal(f.cameBack, "9.999506 USDC"); assert.ok(!JSON.stringify(f).includes("Curve")); assert.equal(JF.LP_FORK_RECEIPT.forkBlock, 110874000); });
check("no execution path: the LP errand is not executable here (job-feed carries no executor / tx code for it)", () => { const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "job-feed.js"), "utf8"); const lpBlock = src.slice(src.indexOf("[A-936] LP errand copy"), src.indexOf("export function lpForkReceiptFields")); assert.ok(!/sendTransaction|writeContract|executeMoneyStep|money-executor/.test(lpBlock)); });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
