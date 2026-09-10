const CORE_KEYS = Object.freeze(["liquidity", "lowCost", "yield", "novelty", "clarity"]);
const DEFAULT_WEIGHTS = Object.freeze({ liquidity: 0, lowCost: 0, yield: 0, novelty: 0, clarity: 0 });
const DEFAULT_META = Object.freeze({ confidence: 0, explorationWidth: 0, reasonDislike: {} });

const SIGNAL_DELTAS = Object.freeze({
  all: { novelty: 0.08, yield: 0.05, clarity: -0.02, explorationWidth: 0.06, confidence: 0.02 },
  none: { clarity: 0.06, liquidity: 0.04, novelty: -0.04, confidence: -0.03 },
  unsure: { clarity: 0.08, liquidity: 0.02, confidence: -0.04 },
  rule_nah: { confidence: 0 },
});

const REASON_WEIGHTS = Object.freeze({
  liquidity: { liquidity: 1, clarity: 0.3 },
  lowCost: { lowCost: 1, clarity: 0.2 },
  yield: { yield: 1, lowCost: 0.2 },
  novelty: { novelty: 1, clarity: -0.15 },
  clarity: { clarity: 1, liquidity: 0.2 },
});

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const round = (value) => Math.round(value * 1000) / 1000;

function normalizePreference(preference = {}) {
  const reasonDislike = { ...(preference.reasonDislike || {}) };
  return {
    ...DEFAULT_WEIGHTS,
    ...Object.fromEntries(CORE_KEYS.map((key) => [key, preference[key] ?? 0])),
    confidence: preference.confidence ?? 0,
    explorationWidth: preference.explorationWidth ?? 0,
    reasonDislike,
  };
}

function unsafeReasons(candidate) {
  const evidence = candidate.evidence || {};
  const reasons = [];
  if (candidate.majorRisk === true || evidence.majorRisk === true) reasons.push("major_risk");
  if (candidate.permission === "dangerous" || evidence.permission === "dangerous") reasons.push("permission_dangerous");
  if (candidate.permission === "unknown" || evidence.permission === "unknown") reasons.push("permission_unknown");
  if (candidate.exit === "unknown" || evidence.exit === "unknown") reasons.push("exit_unknown");
  if (candidate.testSize === "unknown" || evidence.testSize === "unknown") reasons.push("test_size_unknown");
  if (candidate.cost === "unknown" || evidence.cost === "unknown") reasons.push("cost_unknown");
  if (candidate.sourceConflict === true || evidence.sourceConflict === true) reasons.push("source_conflict");
  return reasons;
}

export function hardSafetyFilter(candidates) {
  return candidates.map((candidate) => ({ candidate, reasons: unsafeReasons(candidate) })).filter((row) => row.reasons.length === 0).map((row) => row.candidate);
}

export function explainRejected(candidates) {
  return candidates.map((candidate) => ({ id: candidate.id, reasons: unsafeReasons(candidate) })).filter((row) => row.reasons.length > 0);
}

function reasonScore(candidate, preference) {
  const weights = REASON_WEIGHTS[candidate.reason] || {};
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + (preference[key] || 0) * weight, 0);
}

function conditionScore(candidate) {
  let score = 0;
  if (candidate.rewardExpiryHours !== undefined && candidate.rewardExpiryHours < 24) score -= 0.45;
  if (candidate.waitDays !== undefined && candidate.waitDays > 3) score -= 0.35;
  if (candidate.feeBps !== undefined && candidate.feeBps > 60) score -= 0.35;
  if (candidate.meaningfulChange === true) score += 0.35;
  return score;
}

function availabilityScore(candidate, preference) {
  if (candidate.availability === "closed") return -2;
  if (candidate.availability === "watch") return -0.25 + Math.max(0, preference.explorationWidth) * 0.25;
  return 0;
}

function reasonPenalty(candidate, preference) {
  return -(preference.reasonDislike?.[candidate.reason] || 0) * 0.85;
}

export function scoreCandidate(candidate, preference = {}) {
  const pref = normalizePreference(preference);
  const explorationNovelty = candidate.reason === "novelty" ? pref.explorationWidth * 0.35 : 0;
  return round((candidate.baseScore || 0) + reasonScore(candidate, pref) + conditionScore(candidate) + availabilityScore(candidate, pref) + reasonPenalty(candidate, pref) + explorationNovelty);
}

export function selectThreeJobs(candidates, preference = {}, options = {}) {
  const pref = normalizePreference(preference);
  const safe = hardSafetyFilter(candidates);
  const chosen = [];
  const selectedReasons = new Set();
  const scored = safe.map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, pref) }));

  while (chosen.length < Math.min(3, scored.length)) {
    let best = null;
    for (const row of scored) {
      if (chosen.some((picked) => picked.id === row.candidate.id)) continue;
      const diversity = selectedReasons.has(row.candidate.reason) ? -0.25 : 0.3;
      const repeatStability = selectedReasons.has(row.candidate.reason) && pref.confidence > 0.25 ? 0.1 : 0;
      const finalScore = row.score + diversity + repeatStability;
      const candidateBest = { ...row, finalScore };
      if (!best || candidateBest.finalScore > best.finalScore || (candidateBest.finalScore === best.finalScore && candidateBest.index < best.index)) best = candidateBest;
    }
    if (!best) break;
    const why = [];
    why.push(`reason=${best.candidate.reason}`);
    why.push(`score=${round(best.score)}`);
    why.push(selectedReasons.has(best.candidate.reason) ? "why_stayed=repeat reason accepted by confidence/score" : "why_changed=adds distinct learning reason");
    if (best.candidate.meaningfulChange) why.push("why_changed=meaningful condition change");
    if ((pref.reasonDislike?.[best.candidate.reason] || 0) > 0) why.push("why_stayed=despite weak dislike, score still competitive");
    chosen.push({ ...best.candidate, selectionReason: why.join("; ") });
    selectedReasons.add(best.candidate.reason);
  }

  return options.withRejected ? { selected: chosen, rejected: explainRejected(candidates) } : chosen;
}

function normalizeSignal(signal, selectedJobs) {
  let kind = signal?.kind || "unsure";
  if (kind === "select") {
    if (selectedJobs.length === 0) kind = "none";
    else if (signal.offeredCount && selectedJobs.length >= signal.offeredCount) kind = "all";
    else if (selectedJobs.length === 1) kind = "one";
    else kind = "multi";
  }
  return kind;
}

function weakTimeDelta(kind, decisionTimeMs, baselineMs, setIndex) {
  if (!decisionTimeMs || setIndex === 1) return { confidence: 0, explorationWidth: 0, reasonDislikeBoost: 0, used: false };
  const baseline = baselineMs || decisionTimeMs;
  const ratio = baseline > 0 ? decisionTimeMs / baseline : 1;
  if ((kind === "one" || kind === "multi" || kind === "all") && ratio < 0.75) return { confidence: 0.018, explorationWidth: kind === "all" ? 0.015 : 0, reasonDislikeBoost: 0, used: true };
  if (kind === "unsure" && ratio > 1.25) return { confidence: -0.02, explorationWidth: -0.01, reasonDislikeBoost: 0, used: true };
  if (kind === "none" && ratio < 0.75) return { confidence: -0.01, explorationWidth: -0.01, reasonDislikeBoost: 0.025, used: true };
  return { confidence: 0, explorationWidth: 0, reasonDislikeBoost: 0, used: false };
}

function deltaForSelection(kind, selectedJobs) {
  const delta = { ...DEFAULT_WEIGHTS, confidence: 0, explorationWidth: 0 };
  if (SIGNAL_DELTAS[kind]) for (const [key, value] of Object.entries(SIGNAL_DELTAS[kind])) delta[key] = (delta[key] || 0) + value;
  if (kind === "one" || kind === "multi" || kind === "all") {
    const strength = kind === "one" ? 0.14 : kind === "multi" ? 0.1 : 0.065;
    for (const job of selectedJobs) {
      const reasonWeights = REASON_WEIGHTS[job.reason] || {};
      for (const [key, weight] of Object.entries(reasonWeights)) delta[key] += strength * weight;
    }
  }
  return delta;
}

export function updatePreference(preference = {}, signal = {}) {
  const pref = normalizePreference(preference);
  const selectedJobs = signal.selectedJobs || [];
  const offeredJobs = signal.offeredJobs || [];
  const kind = normalizeSignal(signal, selectedJobs);
  const delta = deltaForSelection(kind, selectedJobs);
  const time = weakTimeDelta(kind, signal.decisionTimeMs, signal.baselineDecisionTimeMs, signal.setIndex);
  delta.confidence += time.confidence;
  delta.explorationWidth += time.explorationWidth;

  const next = { reasonDislike: { ...pref.reasonDislike } };
  for (const key of CORE_KEYS) next[key] = round(clamp(pref[key] + delta[key], -0.6, 0.6));
  next.confidence = round(clamp(pref.confidence + delta.confidence, -0.35, 0.35));
  next.explorationWidth = round(clamp(pref.explorationWidth + delta.explorationWidth, -0.25, 0.25));

  if (kind === "none" || kind === "unsure") {
    const dislikeStep = kind === "none" ? 0.08 : 0.035;
    for (const job of offeredJobs) next.reasonDislike[job.reason] = round(clamp((next.reasonDislike[job.reason] || 0) + dislikeStep + time.reasonDislikeBoost, 0, 0.35));
  }
  if (kind === "one" || kind === "multi" || kind === "all") {
    for (const job of selectedJobs) next.reasonDislike[job.reason] = round(clamp((next.reasonDislike[job.reason] || 0) - 0.04, 0, 0.35));
  }

  return {
    preference: next,
    signal: kind,
    delta: Object.fromEntries(Object.entries(delta).filter(([, value]) => typeof value === "number").map(([key, value]) => [key, round(value)])),
    timeSignal: { used: time.used, decisionTimeMs: signal.decisionTimeMs || null, baselineDecisionTimeMs: signal.baselineDecisionTimeMs || null, setIndex: signal.setIndex || null },
    signalSeparation: kind === "rule_nah" ? "rule/safety rejection; not a taste dislike" : kind === "none" ? "preference dislike; not rule nah" : "preference hint",
    fixedPersonalityLabel: null,
  };
}

export function varyCandidatePool(candidates, step, mode = "responsive") {
  return candidates.map((candidate) => {
    const next = { ...candidate, evidence: { ...(candidate.evidence || {}) } };
    if (mode === "stable") return next;
    if (candidate.id === "reward-expiry" && step >= 2) { next.rewardExpiryHours = 18; next.meaningfulChange = true; }
    if (candidate.id === "vault-wait" && step >= 3) { next.waitDays = 4; next.meaningfulChange = true; }
    if (candidate.id === "fee-watch" && step >= 4) { next.feeBps = 70; next.meaningfulChange = true; }
    if (candidate.id === "new-tokenized" && step >= 3) { next.baseScore = (next.baseScore || 0) + 0.18; next.meaningfulChange = true; }
    return next;
  });
}

export function runSelectorTrace(initialCandidates, events, initialPreference = {}, options = {}) {
  let preference = normalizePreference(initialPreference);
  let pool = initialCandidates;
  let baselineDecisionTimeMs = null;
  return events.map((event, index) => {
    pool = varyCandidatePool(pool, index + 1, options.mode || "responsive");
    const { selected, rejected } = selectThreeJobs(pool, preference, { withRejected: true });
    if (index === 0) baselineDecisionTimeMs = event.decisionTimeMs ?? baselineDecisionTimeMs;
    const picked = (event.pick || []).map((id) => selected.find((job) => job.id === id)).filter(Boolean);
    const update = updatePreference(preference, {
      kind: event.kind || "select",
      selectedJobs: picked,
      offeredJobs: selected,
      offeredCount: selected.length,
      decisionTimeMs: event.decisionTimeMs,
      baselineDecisionTimeMs,
      setIndex: index + 1,
    });
    const previousIds = index === 0 ? selected.map((job) => job.id) : events[index - 1]._selectedIds || [];
    const selectedIds = selected.map((job) => job.id);
    event._selectedIds = selectedIds;
    const learnedMeEvent = index > 0 && selected.some((job) => event.pick?.includes(job.id)) && JSON.stringify(previousIds) !== JSON.stringify(selectedIds);
    const row = {
      set: index + 1,
      selected: selected.map((job) => ({ id: job.id, reason: job.reason, selectionReason: job.selectionReason })),
      rejected,
      mockUserSelection: { kind: update.signal, ids: picked.map((job) => job.id), decisionTimeMs: event.decisionTimeMs || null },
      preferenceBefore: preference,
      preferenceAfter: update.preference,
      delta: update.delta,
      timeSignal: update.timeSignal,
      signalSeparation: update.signalSeparation,
      stateVariation: pool.filter((job) => ["reward-expiry", "vault-wait", "fee-watch", "new-tokenized"].includes(job.id)).map((job) => ({ id: job.id, feeBps: job.feeBps, waitDays: job.waitDays, rewardExpiryHours: job.rewardExpiryHours, availability: job.availability, meaningfulChange: job.meaningfulChange || false })),
      learned_me_event: learnedMeEvent,
    };
    preference = update.preference;
    return row;
  });
}
