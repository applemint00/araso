const RESULT = Object.freeze({ DO_IT: "do_it", ASK: "ask", NAH: "nah", UNKNOWN: "unknown" });
const ACTION = Object.freeze({ EXECUTE: "execute", ASK: "ask", NONE: "none" });

function evidenceShape(rule, value, comparator, expected, found, block) {
  return {
    ruleId: rule.id,
    field: rule.field,
    comparator,
    expected: String(expected),
    found: found === null || found === undefined ? "UNKNOWN" : String(found),
    block: block ?? null,
    source: value?.source || "fixture",
  };
}

function missingEvidence(rule, value) {
  if (!value || value.found === undefined || value.found === null) return "missing_value";
  if (value.conflict === true || value.sourceConflict === true) return "source_conflict";
  if (rule.requiresBlock !== false && (value.block === undefined || value.block === null)) return "missing_block";
  return "";
}

function compare(found, comparator, expected) {
  if (comparator === "lte") return found <= expected;
  if (comparator === "lt") return found < expected;
  if (comparator === "gte") return found >= expected;
  if (comparator === "gt") return found > expected;
  if (comparator === "eq") return found === expected;
  if (comparator === "is") return found === expected;
  throw new Error(`unsupported comparator: ${comparator}`);
}

function distance(rule, found, expected) {
  if (typeof found === "boolean" || typeof expected === "boolean") return found === expected ? 0 : Infinity;
  const nFound = Number(found);
  const nExpected = Number(expected);
  if (!Number.isFinite(nFound) || !Number.isFinite(nExpected)) return Infinity;
  const denominator = Math.max(1, Math.abs(nExpected));
  return Math.abs(nFound - nExpected) / denominator;
}

function isMaterial(rule, found, expected) {
  if (compare(found, rule.comparator, expected)) {
    const previous = rule.previousFound;
    if (previous === undefined || previous === null) return false;
    const drift = distance(rule, found, previous);
    return drift > (rule.materialityPct ?? 0.05);
  }
  return false;
}

function receiptNote(rule, value, expected) {
  const found = value.found;
  return `${rule.field}: expected ${rule.comparator} ${expected}; found ${found} at block ${value.block}`;
}

export function decideRule(rule, value) {
  if (!rule?.agreed) {
    return {
      result: RESULT.UNKNOWN,
      action: ACTION.NONE,
      reason: "rule_not_agreed",
      evidence: evidenceShape(rule || { id: "unknown", field: "unknown" }, value, rule?.comparator || "unknown", rule?.expected ?? "UNKNOWN", value?.found, value?.block),
    };
  }
  const missing = missingEvidence(rule, value);
  if (missing) {
    return {
      result: RESULT.UNKNOWN,
      action: ACTION.NONE,
      reason: missing,
      evidence: evidenceShape(rule, value, rule.comparator, rule.expected, value?.found, value?.block),
    };
  }
  const expected = rule.expected;
  const found = value.found;
  const ok = compare(found, rule.comparator, expected);
  const evidence = evidenceShape(rule, value, rule.comparator, expected, found, value.block);
  if (!ok) {
    return { result: RESULT.NAH, action: ACTION.NONE, reason: "hard_rule_breach", evidence };
  }
  if (isMaterial(rule, found, expected)) {
    return { result: RESULT.ASK, action: ACTION.ASK, reason: "material_change_inside_rule", evidence };
  }
  const note = value.changed === true || rule.previousFound !== undefined ? receiptNote(rule, value, expected) : "";
  return { result: RESULT.DO_IT, action: ACTION.EXECUTE, reason: note ? "in_rule_change" : "rule_satisfied", evidence, receipt_note: note };
}

export function decideRules(rules, values) {
  const decisions = rules.map((rule) => decideRule(rule, values[rule.id] || values[rule.field]));
  const firstUnknown = decisions.find((decision) => decision.result === RESULT.UNKNOWN);
  if (firstUnknown) return { result: RESULT.UNKNOWN, action: ACTION.NONE, decisions };
  const firstNah = decisions.find((decision) => decision.result === RESULT.NAH);
  if (firstNah) return { result: RESULT.NAH, action: ACTION.NONE, decisions };
  const firstAsk = decisions.find((decision) => decision.result === RESULT.ASK);
  if (firstAsk) return { result: RESULT.ASK, action: ACTION.ASK, decisions };
  return { result: RESULT.DO_IT, action: ACTION.EXECUTE, decisions };
}

export const RULE_EXAMPLES = Object.freeze({
  amountLimit: { id: "amount", field: "amountWei", comparator: "lte", expected: 1000000000000000n, agreed: true, materialityPct: 0.05 },
  waitLockup: { id: "wait", field: "waitDays", comparator: "lte", expected: 2, agreed: true, materialityPct: 0.25 },
  feeCost: { id: "fee", field: "feeBps", comparator: "lte", expected: 50, agreed: true, materialityPct: 0.2 },
  exitAvailability: { id: "exit", field: "exitAvailable", comparator: "is", expected: true, agreed: true, requiresBlock: true },
  rewardExpiry: { id: "reward", field: "rewardExpiryHours", comparator: "gte", expected: 24, agreed: true, materialityPct: 0.25 },
});

export { RESULT, ACTION };
