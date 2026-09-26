import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION,
  RESULT,
  RULE_EXAMPLES,
  SEMANTIC_RULE_EXAMPLES,
  decideRule,
  decideRules,
  decideSemanticReturnRule,
} from "../src/rule-decision.js";

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

// ── semantic evidence extension (A-571 Phase C) ──────────────────────────────

check("semantic: clear mismatch + reliable fresh evidence -> nah, action none", () => {
  const decision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, {
    returnClass: "delayed",
    delay: "protocol-native withdrawal queue",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
  });
  assert.equal(decision.result, RESULT.NAH);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "semantic_return_mismatch");
  assert.equal(decision.evidence.expected, "right_back");
  assert.equal(decision.evidence.found, "delayed");
  assert.equal(decision.evidence.did, "nothing");
  assert.ok(decision.evidence.why.includes("doesn't match"));
  assert.equal(decision.evidence.source, "job_evidence_fixture");
  assert.equal(decision.evidence.block, null, "must not fabricate a block value");
});

check("semantic: ambiguous boundary -> ask, action none (ask stays first-class)", () => {
  const decision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, {
    returnClass: "same_session",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
  });
  assert.equal(decision.result, RESULT.ASK);
  assert.equal(decision.action, ACTION.ASK);
  assert.equal(decision.reason, "semantic_return_ambiguous");
  assert.ok(RESULT.ASK, "RESULT.ASK must exist as its own outcome, not a nah/unknown alias");
});

check("semantic: match -> do_it, action execute", () => {
  const decision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, {
    returnClass: "immediate",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
  });
  assert.equal(decision.result, RESULT.DO_IT);
  assert.equal(decision.action, ACTION.EXECUTE);
  assert.equal(decision.reason, "semantic_return_match");
});

check("semantic: missing evidence -> unknown, action none", () => {
  const decision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, { source: "job_evidence_fixture" });
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "missing_evidence");
});

check("semantic: stale evidence -> unknown, action none (not nah)", () => {
  const decision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, {
    returnClass: "delayed",
    source: "job_evidence_fixture",
    observedAt: "2026-01-01T00:00:00Z",
    stale: true,
  });
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "stale_evidence");
});

check("semantic: conflicting evidence -> unknown, action none (not nah)", () => {
  const decision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, {
    returnClass: "immediate",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
    conflict: true,
  });
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "source_conflict");
});

check("semantic: unknown/unlisted agreed-rule meaning -> unknown, never guessed", () => {
  const decision = decideSemanticReturnRule(
    { id: "weird", field: "returnSemantic", expected: "somewhere_in_a_few_days", agreed: true },
    { returnClass: "delayed", source: "job_evidence_fixture", observedAt: "2026-09-24T00:00:00Z" },
  );
  assert.equal(decision.result, RESULT.UNKNOWN);
  assert.equal(decision.action, ACTION.NONE);
  assert.equal(decision.reason, "unknown_meaning");
});

check("semantic: preference hint alone (rule not agreed) can never produce do or rule_nah", () => {
  const preferenceHint = { id: "pref", field: "returnSemantic", expected: "right_back", agreed: false, source: "preference_hint" };
  const wouldHaveMatched = decideSemanticReturnRule(preferenceHint, {
    returnClass: "immediate",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
  });
  const wouldHaveMismatched = decideSemanticReturnRule(preferenceHint, {
    returnClass: "delayed",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
  });
  for (const decision of [wouldHaveMatched, wouldHaveMismatched]) {
    assert.notEqual(decision.result, RESULT.DO_IT);
    assert.notEqual(decision.result, RESULT.NAH);
    assert.equal(decision.result, RESULT.UNKNOWN);
    assert.equal(decision.action, ACTION.NONE);
    assert.equal(decision.reason, "rule_not_agreed");
  }
});

check("safety/eligibility nah carries a reason class distinct from semantic mismatch, never a preference-dislike label", () => {
  const safetyDecision = decideRule(RULE_EXAMPLES.exitAvailability, { found: false, block: 30 });
  const semanticDecision = decideSemanticReturnRule(SEMANTIC_RULE_EXAMPLES.rightBackReturn, {
    returnClass: "delayed",
    source: "job_evidence_fixture",
    observedAt: "2026-09-24T00:00:00Z",
  });
  assert.equal(safetyDecision.result, RESULT.NAH);
  assert.equal(semanticDecision.result, RESULT.NAH);
  assert.notEqual(safetyDecision.reason, semanticDecision.reason, "safety/eligibility and semantic mismatch must not share a reason string");
  for (const reason of [safetyDecision.reason, semanticDecision.reason]) {
    assert.doesNotMatch(reason, /preference|dislike/i, "a nah reason must never read as a preference-dislike label");
  }
});

check("source guard: no global right_back hour/day threshold hardcoded in rule-decision.js", () => {
  const src = readFileSync(new URL("../src/rule-decision.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /right_back[\s\S]{0,60}\d+\s*(h|hour|hours|day|days)\b/i, "found a possible global right_back time threshold");
  assert.doesNotMatch(src, /\b\d+\s*(h|hour|hours|day|days)\b[\s\S]{0,60}right_back/i, "found a possible global right_back time threshold");
});

console.log(`\n${pass}/${pass} PASS`);
