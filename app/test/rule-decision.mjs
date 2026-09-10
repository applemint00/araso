import assert from "node:assert/strict";
import { ACTION, RESULT, RULE_EXAMPLES, decideRule, decideRules } from "../src/rule-decision.js";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("do_it for satisfied amount equality boundary", () => {
  const decision = decideRule(RULE_EXAMPLES.amountLimit, { found: 1000000000000000n, block: 10, source: "fixture" });
  assert.equal(decision.result, RESULT.DO_IT);
  assert.equal(decision.action, ACTION.EXECUTE);
  assert.equal(decision.evidence.expected, "1000000000000000");
  assert.equal(decision.evidence.found, "1000000000000000");
  assert.equal(decision.evidence.block, 10);
});

check("nah/action 0 for hard amount breach", () => {
  const decision = decideRule(RULE_EXAMPLES.amountLimit, { found: 1000000000000001n, block: 11 });
  assert.equal(decision.result, RESULT.NAH);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "hard_rule_breach");
});

check("small in-bound fee change returns do_it with receipt note", () => {
  const rule = { ...RULE_EXAMPLES.feeCost, previousFound: 48, materialityPct: 0.2 };
  const decision = decideRule(rule, { found: 49, block: 12, changed: true });
  assert.equal(decision.result, RESULT.DO_IT);
  assert.equal(decision.action, ACTION.EXECUTE);
  assert.ok(decision.receipt_note.includes("expected lte 50"));
});

check("material-but-not-breach wait change returns ask", () => {
  const rule = { ...RULE_EXAMPLES.waitLockup, previousFound: 1, materialityPct: 0.25 };
  const decision = decideRule(rule, { found: 2, block: 13 });
  assert.equal(decision.result, RESULT.ASK);
  assert.equal(decision.action, ACTION.ASK);
  assert.equal(decision.reason, "material_change_inside_rule");
});

check("exit unavailable returns nah/action 0", () => {
  const decision = decideRule(RULE_EXAMPLES.exitAvailability, { found: false, block: 14 });
  assert.equal(decision.result, RESULT.NAH);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.evidence.comparator, "is");
});

check("reward expiry boundary passes at equality and fails below", () => {
  const atBoundary = decideRule(RULE_EXAMPLES.rewardExpiry, { found: 24, block: 15 });
  const below = decideRule(RULE_EXAMPLES.rewardExpiry, { found: 23, block: 16 });
  assert.equal(atBoundary.result, RESULT.DO_IT);
  assert.equal(below.result, RESULT.NAH);
  assert.equal(below.action, ACTION.NONE);
});

check("unknown/action 0 for missing block", () => {
  const decision = decideRule(RULE_EXAMPLES.feeCost, { found: 40 });
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "missing_block");
});

check("unknown/action 0 for source conflict", () => {
  const decision = decideRule(RULE_EXAMPLES.feeCost, { found: 40, block: 17, sourceConflict: true });
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "source_conflict");
});

check("learned preference alone is not a rule", () => {
  const decision = decideRule({ id: "fee", field: "feeBps", comparator: "lte", expected: 50, agreed: false }, { found: 40, block: 18 });
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "rule_not_agreed");
});

check("aggregate keeps unknown/nah distinct and action 0", () => {
  const unknown = decideRules([RULE_EXAMPLES.feeCost, RULE_EXAMPLES.exitAvailability], { fee: { found: 30 }, exit: { found: true, block: 19 } });
  const nah = decideRules([RULE_EXAMPLES.feeCost, RULE_EXAMPLES.exitAvailability], { fee: { found: 30, block: 20 }, exit: { found: false, block: 20 } });
  assert.equal(unknown.result, RESULT.UNKNOWN);
  assert.equal(unknown.action, ACTION.NONE);
  assert.equal(nah.result, RESULT.NAH);
  assert.equal(nah.action, ACTION.NONE);
});

console.log(`\n${pass}/${pass} PASS`);
