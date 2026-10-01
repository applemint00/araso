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

// ── semantic evidence extension ──────────────────────────────
//
// Narrow, additive extension for rules the user agreed to in MEANING, not a number
// (e.g. "I want it right back"). `decideRule`/`decideRules`/`compare` above are
// untouched — this is a separate function with its own evidence shape, so the
// existing numeric API cannot regress by construction.
//
// The evidence input (`returnClass`) is a classification of a Job's OWN live/protocol
// return mechanics ("immediate" / "same_session" / "delayed"), produced upstream by
// whatever reads that Job's real evidence. This module never converts a duration into
// that class itself: there is no hour/day constant, arithmetic, or mapping anywhere in
// this file. A specific Job's delay value (if present) rides along in `evidence.delay`
// as a free-text field for the receipt — it is never compared numerically here and it
// never becomes a global definition of any meaning.

const RETURN_CLASS = Object.freeze({
  IMMEDIATE: "immediate",
  SAME_SESSION: "same_session",
  DELAYED: "delayed",
});

// Only meanings explicitly listed here are understood. An expected meaning not in this
// table is unknown evidence, not a guess — see `decideSemanticReturnRule`.
//
// [semantic evidence extension] `needsDuration`: classes where the meaning can only be judged against the Job's
// OWN stated duration. The meaning is never turned into a number here. If the Job does not
// state its duration (`value.durationKnown !== true`) the answer is `unknown`. If it does,
// the answer is `ask`: the user confirms the Job's own duration, and nothing is guessed.
const SEMANTIC_RETURN_MEANING = Object.freeze({
  right_back: Object.freeze({
    match: Object.freeze([RETURN_CLASS.IMMEDIATE]),
    ambiguous: Object.freeze([RETURN_CLASS.SAME_SESSION]),
    mismatch: Object.freeze([RETURN_CLASS.DELAYED]),
    needsDuration: Object.freeze([]),
  }),
  few_days: Object.freeze({
    match: Object.freeze([RETURN_CLASS.IMMEDIATE, RETURN_CLASS.SAME_SESSION]),
    ambiguous: Object.freeze([]),
    mismatch: Object.freeze([]),
    needsDuration: Object.freeze([RETURN_CLASS.DELAYED]),
  }),
  no_rush: Object.freeze({
    match: Object.freeze([RETURN_CLASS.IMMEDIATE, RETURN_CLASS.SAME_SESSION]),
    ambiguous: Object.freeze([]),
    mismatch: Object.freeze([]),
    needsDuration: Object.freeze([RETURN_CLASS.DELAYED]),
  }),
});

function semanticEvidenceShape(rule, value, why) {
  return {
    ruleId: rule?.id ?? "unknown",
    field: rule?.field ?? "returnSemantic",
    comparator: "semantic_return_match",
    expected: rule?.expected ?? "UNKNOWN",
    found: value?.returnClass ?? "UNKNOWN",
    did: "nothing",
    why,
    delay: value?.delay ?? null,
    source: value?.source || "unknown",
    observedAt: value?.observedAt ?? null,
    block: null,
  };
}

function semanticMissingEvidence(value) {
  if (!value) return "missing_evidence";
  if (value.returnClass === undefined || value.returnClass === null || value.returnClass === "") return "missing_evidence";
  if (!value.source) return "missing_evidence";
  if (value.observedAt === undefined || value.observedAt === null) return "missing_evidence";
  if (value.conflict === true || value.sourceConflict === true) return "source_conflict";
  if (value.stale === true) return "stale_evidence";
  return "";
}

// Decides a single agreed rule whose expected value is a user-agreed MEANING
// (e.g. "right_back"), not a number. Mirrors `decideRule`'s outcome/action shape
// (`unknown`/`nah`/`ask`/`do_it`, action always `none` except a confirmed match).
//
// Distinct reason strings on purpose (`semantic_return_mismatch`,
// `semantic_return_ambiguous`, `rule_not_agreed`, `missing_evidence`, ...): a
// safety/eligibility rejection elsewhere in the system (e.g. `RULE_EXAMPLES.exitAvailability`
// failing with reason `hard_rule_breach`) never shares a reason string with this
// function's outcomes, so nothing downstream can fold "safety said no" and "the Job's
// return timing didn't match what the user meant" into one preference-dislike signal.
// Likewise a bare preference hint is never fed in here as an agreed rule — this function
// still requires `rule.agreed === true`, same gate as `decideRule`, so a preference alone
// can never reach `nah` or `do_it` through this path either.
export function decideSemanticReturnRule(rule, value) {
  if (!rule?.agreed) {
    return {
      result: RESULT.UNKNOWN,
      action: ACTION.NONE,
      reason: "rule_not_agreed",
      evidence: semanticEvidenceShape(rule, value, "no agreed rule to check evidence against"),
    };
  }
  const meaning = SEMANTIC_RETURN_MEANING[rule.expected];
  if (!meaning) {
    return {
      result: RESULT.UNKNOWN,
      action: ACTION.NONE,
      reason: "unknown_meaning",
      evidence: semanticEvidenceShape(rule, value, `"${rule.expected}" is not an understood agreed-rule meaning`),
    };
  }
  const missing = semanticMissingEvidence(value);
  if (missing) {
    return {
      result: RESULT.UNKNOWN,
      action: ACTION.NONE,
      reason: missing,
      evidence: semanticEvidenceShape(rule, value, "evidence missing, stale, or conflicting — not guessed"),
    };
  }
  const returnClass = value.returnClass;
  if (meaning.mismatch.includes(returnClass)) {
    return {
      result: RESULT.NAH,
      action: ACTION.NONE,
      reason: "semantic_return_mismatch",
      evidence: semanticEvidenceShape(
        rule,
        value,
        `return doesn't match: expected "${rule.expected}", found "${returnClass}"${value.delay ? ` (${value.delay})` : ""}`,
      ),
    };
  }
  if (meaning.ambiguous.includes(returnClass)) {
    return {
      result: RESULT.ASK,
      action: ACTION.ASK,
      reason: "semantic_return_ambiguous",
      evidence: semanticEvidenceShape(
        rule,
        value,
        `boundary unclear: expected "${rule.expected}", found "${returnClass}" — ask rather than guess`,
      ),
    };
  }
  if (meaning.needsDuration.includes(returnClass)) {
    if (value.durationKnown !== true) {
      return {
        result: RESULT.UNKNOWN,
        action: ACTION.NONE,
        reason: "return_duration_unknown",
        evidence: semanticEvidenceShape(
          rule,
          value,
          `the Job does not state how long "${returnClass}" takes, so "${rule.expected}" cannot be checked — not guessed`,
        ),
      };
    }
    return {
      result: RESULT.ASK,
      action: ACTION.ASK,
      reason: "semantic_return_duration_confirm",
      evidence: semanticEvidenceShape(
        rule,
        value,
        `the Job states its own duration; confirm it against "${rule.expected}" rather than guess`,
      ),
    };
  }
  if (meaning.match.includes(returnClass)) {
    return {
      result: RESULT.DO_IT,
      action: ACTION.EXECUTE,
      reason: "semantic_return_match",
      evidence: semanticEvidenceShape(rule, value, `return matches: expected "${rule.expected}", found "${returnClass}"`),
    };
  }
  return {
    result: RESULT.UNKNOWN,
    action: ACTION.NONE,
    reason: "unclassified_return",
    evidence: semanticEvidenceShape(rule, value, `"${returnClass}" is not a classified return class`),
  };
}

export const SEMANTIC_RULE_EXAMPLES = Object.freeze({
  rightBackReturn: { id: "return_semantic", field: "returnSemantic", expected: "right_back", agreed: true },
});

export { RESULT, ACTION, RETURN_CLASS, SEMANTIC_RETURN_MEANING };
