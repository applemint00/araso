const STATE_VERSION = 1;
const STORAGE_PREFIX = "araso.secondJourney";
const PREFERENCE_KEYS = Object.freeze(["liquidity", "lowCost", "yield", "novelty", "clarity", "confidence", "explorationWidth"]);
const PREFERENCE_BOUNDS = Object.freeze({
  liquidity: [-0.6, 0.6],
  lowCost: [-0.6, 0.6],
  yield: [-0.6, 0.6],
  novelty: [-0.6, 0.6],
  clarity: [-0.6, 0.6],
  confidence: [-0.35, 0.35],
  explorationWidth: [-0.25, 0.25],
});

function emptyPreference() {
  return {
    reasonDislike: {},
    liquidity: 0,
    lowCost: 0,
    yield: 0,
    novelty: 0,
    clarity: 0,
    confidence: 0,
    explorationWidth: 0,
  };
}

function normalizeScope(scope = {}) {
  return {
    accountId: scope.accountId || "unknown-account",
    chainId: scope.chainId || "unknown-chain",
  };
}

export function validatePersistenceScope(scope = {}) {
  const accountId = typeof scope.accountId === "string" ? scope.accountId.trim() : "";
  const chainId = typeof scope.chainId === "string" ? scope.chainId.trim() : "";
  if (!accountId || !chainId) return { error: "missing_scope" };
  if (accountId === "unknown-account" || chainId === "unknown-chain") return { error: "missing_scope" };
  return { accountId, chainId };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function secondJourneyStorageKey(scope = {}) {
  const clean = normalizeScope(scope);
  return `${STORAGE_PREFIX}.${clean.chainId}.${clean.accountId}`;
}

export function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

export function createSecondJourneyState(scope = {}) {
  const clean = normalizeScope(scope);
  return {
    version: STATE_VERSION,
    accountId: clean.accountId,
    chainId: clean.chainId,
    interests: [],
    preference: emptyPreference(),
    processedEventIds: [],
    pendingJobs: [],
    receipts: [],
    knowledgeState: { observedDemonstrations: [], inferredFromPreference: false },
    evidenceState: { pointers: [] },
  };
}

function normalizePreference(input = {}) {
  const next = emptyPreference();
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const key of PREFERENCE_KEYS) {
    const value = Number(source[key] ?? next[key]);
    const [min, max] = PREFERENCE_BOUNDS[key];
    next[key] = Number.isFinite(value) ? clamp(value, min, max) : next[key];
  }
  if (typeof source.reasonDislike === "object" && source.reasonDislike && !Array.isArray(source.reasonDislike)) {
    next.reasonDislike = Object.fromEntries(Object.entries(source.reasonDislike).map(([key, value]) => {
      const numeric = Number(value);
      return [key, Number.isFinite(numeric) ? clamp(numeric, 0, 0.35) : 0];
    }));
  }
  return next;
}

export function normalizeSecondJourneyState(input, scope = {}, options = {}) {
  if (options.requirePersistedIdentity) {
    const validScope = validatePersistenceScope(scope);
    if (validScope.error) return { state: createSecondJourneyState(scope), repaired: true, error: validScope.error };
  }
  const base = createSecondJourneyState(scope);
  if (!input || typeof input !== "object" || Array.isArray(input)) return { state: base, repaired: true, error: "malformed_state" };
  if (options.requirePersistedIdentity && input.version !== STATE_VERSION) {
    return { state: base, repaired: true, error: "unsupported_version" };
  }
  if (input.version !== undefined && input.version !== STATE_VERSION) {
    return { state: base, repaired: true, error: "unsupported_version" };
  }
  if (options.requirePersistedIdentity) {
    const validInputScope = validatePersistenceScope({ accountId: input.accountId, chainId: input.chainId });
    if (validInputScope.error) return { state: base, repaired: true, error: "missing_identity" };
  }
  if (options.requirePersistedIdentity && (input.accountId !== base.accountId || input.chainId !== base.chainId)) {
    return { state: base, repaired: true, error: "scope_mismatch" };
  }
  if ((input.accountId && input.accountId !== base.accountId) || (input.chainId && input.chainId !== base.chainId)) {
    return { state: base, repaired: false, error: "scope_mismatch" };
  }
  const state = {
    ...base,
    ...input,
    accountId: base.accountId,
    chainId: base.chainId,
    interests: Array.isArray(input.interests) ? input.interests.filter((item) => item && item.errandId).map((item) => ({ ...item })) : [],
    preference: normalizePreference(input.preference),
    processedEventIds: Array.isArray(input.processedEventIds) ? [...new Set(input.processedEventIds.filter(Boolean))].slice(-80) : [],
    pendingJobs: Array.isArray(input.pendingJobs) ? input.pendingJobs.map((item) => ({ ...item })) : [],
    receipts: Array.isArray(input.receipts) ? input.receipts.map((item) => ({ ...item })) : [],
    knowledgeState: input.knowledgeState && typeof input.knowledgeState === "object" ? { ...base.knowledgeState, ...input.knowledgeState } : base.knowledgeState,
    evidenceState: input.evidenceState && typeof input.evidenceState === "object" ? { ...base.evidenceState, ...input.evidenceState } : base.evidenceState,
  };
  return { state, repaired: false };
}

export function loadSecondJourneyState(storage, scope = {}) {
  const key = secondJourneyStorageKey(scope);
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) return { key, state: createSecondJourneyState(scope), repaired: true, error: validScope.error };
  if (!storage || typeof storage.getItem !== "function") return { key, state: createSecondJourneyState(scope), repaired: false, error: "storage_unavailable" };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { key, state: createSecondJourneyState(scope), repaired: false };
    return { key, ...normalizeSecondJourneyState(JSON.parse(raw), scope, { requirePersistedIdentity: true }) };
  } catch {
    return { key, state: createSecondJourneyState(scope), repaired: true, error: "corrupt_json" };
  }
}

export function saveSecondJourneyState(storage, scope, state) {
  const key = secondJourneyStorageKey(scope);
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) return { key, saved: false, error: validScope.error };
  if (!storage || typeof storage.setItem !== "function") return { key, saved: false, error: "storage_unavailable" };
  const normalized = normalizeSecondJourneyState(state, scope, { requirePersistedIdentity: true });
  if (normalized.error) return { key, saved: false, error: normalized.error };
  try {
    storage.setItem(key, JSON.stringify(normalized.state));
    return { key, saved: true };
  } catch {
    return { key, saved: false, error: "storage_write_failed" };
  }
}

function hasProcessed(state, eventId) {
  return Boolean(eventId && state.processedEventIds.includes(eventId));
}

function markProcessed(state, eventId) {
  if (!eventId) return state.processedEventIds;
  return [...new Set([...state.processedEventIds, eventId])].slice(-80);
}

function upsertInterests(existing, selectedErrands, eventId, now) {
  const byId = new Map(existing.map((item) => [item.errandId, { ...item }]));
  for (const errand of selectedErrands) {
    const previous = byId.get(errand.id);
    byId.set(errand.id, {
      errandId: errand.id,
      label: errand.label,
      lane: errand.lane,
      status: previous?.status || "interested",
      selectedAt: previous?.selectedAt || now,
      updatedAt: now,
      sourceEventId: previous?.sourceEventId || eventId || null,
      explicit: true,
    });
  }
  return [...byId.values()];
}

export function applyExploreSelection(state, selection, preferenceUpdate, options = {}) {
  const eventId = options.eventId || null;
  if (hasProcessed(state, eventId)) return { state, duplicate: true, preferenceApplied: false };
  const kind = selection?.kind || "unsure";
  const selectedErrands = selection?.errands || [];
  const now = options.now || "UNKNOWN_TIME";
  const next = normalizeSecondJourneyState(state, { accountId: state.accountId, chainId: state.chainId }).state;
  const addsInterest = kind === "one" || kind === "multi" || kind === "all";
  return {
    state: {
      ...next,
      interests: addsInterest ? upsertInterests(next.interests, selectedErrands, eventId, now) : next.interests,
      preference: preferenceUpdate?.preference || next.preference,
      processedEventIds: markProcessed(next, eventId),
    },
    duplicate: false,
    preferenceApplied: true,
  };
}

export function removeInterest(state, errandId, options = {}) {
  return {
    ...state,
    interests: state.interests.filter((item) => item.errandId !== errandId),
    processedEventIds: markProcessed(state, options.eventId || null),
  };
}

export function recordSecondJourneyReceipt(state, receipt, options = {}) {
  const eventId = options.eventId || receipt?.eventId || null;
  if (hasProcessed(state, eventId)) return { state, duplicate: true };
  return {
    state: {
      ...state,
      receipts: receipt ? [{ ...receipt }, ...state.receipts].slice(0, 20) : state.receipts,
      evidenceState: receipt?.evidencePointer ? { pointers: [...state.evidenceState.pointers, receipt.evidencePointer].slice(-40) } : state.evidenceState,
      processedEventIds: markProcessed(state, eventId),
    },
    duplicate: false,
  };
}
