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
    // [A-710 S1] per-event preference change (eventId → delta), so a merge can re-apply another tab's learning.
    preferenceEvents: [],
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

// [A-710 S1] { eventId, delta } rows: delta holds only finite numbers for known preference keys
// (and reasonDislike entries). Anything else is dropped, never guessed.
function normalizePreferenceEvents(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (!item || typeof item.eventId !== "string" || !item.eventId || item.eventId.length > 200) continue;
    const src = item.delta && typeof item.delta === "object" && !Array.isArray(item.delta) ? item.delta : {};
    const delta = {};
    for (const key of PREFERENCE_KEYS) if (Number.isFinite(src[key]) && src[key] !== 0) delta[key] = src[key];
    if (src.reasonDislike && typeof src.reasonDislike === "object" && !Array.isArray(src.reasonDislike)) {
      const rd = Object.fromEntries(Object.entries(src.reasonDislike).filter(([, v]) => Number.isFinite(v) && v !== 0));
      if (Object.keys(rd).length) delta.reasonDislike = rd;
    }
    out.push({ eventId: item.eventId, delta });
  }
  return out.slice(-80);
}

function preferenceDelta(before, after) {
  const delta = {};
  for (const key of PREFERENCE_KEYS) {
    const d = Number(after?.[key] ?? 0) - Number(before?.[key] ?? 0);
    if (Number.isFinite(d) && d !== 0) delta[key] = d;
  }
  const keys = new Set([...Object.keys(before?.reasonDislike || {}), ...Object.keys(after?.reasonDislike || {})]);
  const rd = {};
  for (const key of keys) {
    const d = Number(after?.reasonDislike?.[key] ?? 0) - Number(before?.reasonDislike?.[key] ?? 0);
    if (Number.isFinite(d) && d !== 0) rd[key] = d;
  }
  if (Object.keys(rd).length) delta.reasonDislike = rd;
  return delta;
}

function applyPreferenceDelta(preference, delta) {
  const next = { ...preference, reasonDislike: { ...(preference.reasonDislike || {}) } };
  for (const key of PREFERENCE_KEYS) if (Number.isFinite(delta?.[key])) next[key] = Number(next[key] || 0) + delta[key];
  for (const [key, d] of Object.entries(delta?.reasonDislike || {})) next.reasonDislike[key] = Number(next.reasonDislike[key] || 0) + d;
  return normalizePreference(next);   // same bounds as every other preference write
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
    preferenceEvents: normalizePreferenceEvents(input.preferenceEvents),
    processedEventIds: Array.isArray(input.processedEventIds) ? [...new Set(input.processedEventIds.filter(Boolean))].slice(-80) : [],
    pendingJobs: Array.isArray(input.pendingJobs) ? input.pendingJobs.map((item) => ({ ...item })) : [],
    // [A-579 repair RV-1] decision rows are re-validated on load; an invalid one is dropped (never reopened).
    receipts: Array.isArray(input.receipts) ? input.receipts.filter((item) => keepLoadedReceipt(item, base)).map((item) => ({ ...item })) : [],
    knowledgeState: input.knowledgeState && typeof input.knowledgeState === "object" ? { ...base.knowledgeState, ...input.knowledgeState } : base.knowledgeState,
    evidenceState: input.evidenceState && typeof input.evidenceState === "object" ? { ...base.evidenceState, ...input.evidenceState } : base.evidenceState,
  };
  return { state, repaired: false };
}

function keepLoadedReceipt(item, scope) {
  if (!item || typeof item !== "object" || item.schema !== DECISION_RECEIPT_SCHEMA) return true; // other receipt types unchanged
  try { return !validateDecisionReceipt(item, scope).error; } catch { return false; }
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

// ── [A-710 S1 · closes A-693 M-3] merge-on-save ─────────────────────────────────────────────
// Before A-710 a save replaced the whole stored state with the caller's in-memory copy, so a
// stale tab (or the bridge's duplicate-retry branch) erased receipt / decision rows another
// tab had written since it loaded. Now every save re-reads what is stored, merges, writes once,
// and reads back: `saved:true` only when the stored bytes decode to a state that holds every
// row this save intended to keep. Merge rules:
//   · receipts           union by eventId. Stored rows keep their order; rows only this caller
//                        has go in front (they are its new rows). A row the store already
//                        dropped by its own 20-row cap (its eventId is in the stored
//                        processedEventIds but the row is gone) is not resurrected.
//   · processedEventIds  union, stored order first, last 80 kept (unchanged cap).
//   · evidence pointers  union, last 40 kept (unchanged cap). pendingJobs: union.
//   · interests          union by errandId, the later `updatedAt` wins. No product path removes
//                        an interest today; removal semantics across tabs are UNKNOWN (a
//                        removal would need a tombstone) and are not invented here.
//   · interests (cont.)  timestamps are compared as times; a placeholder ("UNKNOWN_TIME") never
//                        beats a real time.
//   · preference         if the caller has seen every stored event, its value is the newest and wins.
//                        Otherwise (a stale tab) the stored value is kept and the caller's own new
//                        events are re-applied on top of it from their recorded per-event deltas
//                        (`preferenceEvents`), so neither tab's learning is lost.
//   · knowledgeState     same rule; when the caller is stale, stored scalars are kept and
//                        observedDemonstrations are unioned.
// A stored state that is unreadable for any reason other than corrupt JSON (future version,
// foreign identity) is never overwritten: `stored_state_unreadable`.
const RECEIPT_CAP = 20;
const PROCESSED_CAP = 80;
const POINTER_CAP = 40;

const rowKey = (row) => (row && typeof row.eventId === "string" && row.eventId ? `e:${row.eventId}` : `j:${JSON.stringify(row)}`);

function unionBy(stored, incoming, keyOf) {
  const seen = new Set(stored.map(keyOf));
  return [...stored, ...incoming.filter((item) => !seen.has(keyOf(item)))];
}

export function mergeSecondJourneyStates(stored, incoming) {
  const storedProcessed = new Set(stored.processedEventIds);
  const storedReceiptKeys = new Set(stored.receipts.map(rowKey));
  const incomingOnly = incoming.receipts.filter((row) => {
    if (storedReceiptKeys.has(rowKey(row))) return false;
    // dropped by the store's own cap → stays dropped
    return !(row && typeof row.eventId === "string" && storedProcessed.has(row.eventId));
  });
  const incomingProcessed = new Set(incoming.processedEventIds);
  const callerSawAll = stored.processedEventIds.every((id) => incomingProcessed.has(id));
  const callerNewEvents = incoming.processedEventIds.filter((id) => !storedProcessed.has(id));
  const deltas = new Map((incoming.preferenceEvents || []).map((row) => [row.eventId, row.delta]));
  let preference = stored.preference;
  if (callerSawAll) preference = incoming.preference;
  else for (const id of callerNewEvents) if (deltas.has(id)) preference = applyPreferenceDelta(preference, deltas.get(id));
  const storedKs = stored.knowledgeState || {};
  const incomingKs = incoming.knowledgeState || {};
  const knowledgeState = callerSawAll ? incomingKs : {
    ...incomingKs,
    ...storedKs,
    observedDemonstrations: unionBy(storedKs.observedDemonstrations || [], incomingKs.observedDemonstrations || [], (item) => JSON.stringify(item)),
  };
  const timeOf = (item) => { const t = Date.parse(item?.updatedAt); return Number.isFinite(t) ? t : -Infinity; };
  const interests = new Map(stored.interests.map((item) => [item.errandId, { ...item }]));
  for (const item of incoming.interests) {
    const prev = interests.get(item.errandId);
    if (!prev || timeOf(item) > timeOf(prev)) interests.set(item.errandId, { ...item });
  }
  return {
    ...stored,
    interests: [...interests.values()],
    preference,
    preferenceEvents: unionBy(stored.preferenceEvents || [], incoming.preferenceEvents || [], (row) => row.eventId).slice(-PROCESSED_CAP),
    knowledgeState,
    processedEventIds: [...new Set([...stored.processedEventIds, ...incoming.processedEventIds])].slice(-PROCESSED_CAP),
    pendingJobs: unionBy(stored.pendingJobs, incoming.pendingJobs, (item) => JSON.stringify(item)),
    receipts: [...incomingOnly, ...stored.receipts].slice(0, RECEIPT_CAP),
    evidenceState: {
      ...stored.evidenceState,
      pointers: unionBy(Array.isArray(stored.evidenceState.pointers) ? stored.evidenceState.pointers : [], Array.isArray(incoming.evidenceState.pointers) ? incoming.evidenceState.pointers : [], (item) => JSON.stringify(item)).slice(-POINTER_CAP), // [A-895 M-F-2] non-array pointers = empty, never throws (pre-A-895: `|| []`)
    },
  };
}

function storedHoldsAll(storage, scope, intended) {
  try {
    const back = loadSecondJourneyState(storage, scope);
    if (back.error || back.repaired) return { ok: false, state: null };
    const keys = new Set(back.state.receipts.map(rowKey));
    const errands = new Set(back.state.interests.map((item) => item.errandId));
    const ok = intended.receipts.every((row) => keys.has(rowKey(row)))
      && intended.interests.every((item) => errands.has(item.errandId));
    return { ok, state: ok ? back.state : null };
  } catch {
    return { ok: false, state: null };
  }
}

export function saveSecondJourneyState(storage, scope, state) {
  const key = secondJourneyStorageKey(scope);
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) return { key, saved: false, error: validScope.error };
  if (!storage || typeof storage.setItem !== "function") return { key, saved: false, error: "storage_unavailable" };
  const normalized = normalizeSecondJourneyState(state, scope, { requirePersistedIdentity: true });
  if (normalized.error) return { key, saved: false, error: normalized.error };
  // [A-710 S1] read what is stored now (same synchronous task as the write below — no await).
  let merged = normalized.state;
  if (typeof storage.getItem === "function") {
    const current = loadSecondJourneyState(storage, scope);
    if (current.error && current.error !== "corrupt_json") return { key, saved: false, error: "stored_state_unreadable" };
    if (!current.error) merged = mergeSecondJourneyStates(current.state, normalized.state);
  }
  try {
    storage.setItem(key, JSON.stringify(merged));
  } catch {
    return { key, saved: false, error: "storage_write_failed" };
  }
  // [A-710 S1] durability before success: a fresh read must show every row this save kept.
  const verified = storedHoldsAll(storage, scope, merged);
  if (!verified.ok) return { key, saved: false, error: "save_not_verified" };
  return { key, saved: true, state: verified.state };
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
  const preference = preferenceUpdate?.preference || next.preference;
  return {
    state: {
      ...next,
      interests: addsInterest ? upsertInterests(next.interests, selectedErrands, eventId, now) : next.interests,
      preference,
      // [A-710 S1] what this event changed, so a later merge can re-apply it on top of another tab's value.
      preferenceEvents: eventId ? [...next.preferenceEvents, { eventId, delta: preferenceDelta(next.preference, normalizePreference(preference)) }].slice(-80) : next.preferenceEvents,
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

// ── [A-576] action-0 decision Receipt (nah / ask / unknown) ────────────────────────
// A Send-side execution receipt (second-journey-receipt-bridge.js) only takes done/failed
// plus an execution evidence class. A stop that happens before Send (the Job's own
// evidence did not match what the user said for this selection) is a separate record
// type. It is still written to the same `receipts` array and the same storage key
// (recordSecondJourneyReceipt → saveSecondJourneyState), with no sidecar log.
// Contract: action 0 only. No tx fields, no permission fields, and preference,
// interests and knowledgeState are left untouched.
export const DECISION_RECEIPT_SCHEMA = "second_journey_decision_receipt_v1";
const DECISION_VALUES = Object.freeze(["nah", "ask", "unknown"]);
const DECISION_FORBIDDEN_FIELDS = Object.freeze([
  "executionPermission", "permission", "permissionGranted", "agreedRule", "preflight", "readiness", "ready",
  "signed", "approved", "signature", "txHash", "blockNumber", "prfSalt", "credentialId", "privateKey", "secret",
  "knowledgeState", "observedDemonstrations", "inferredFromPreference", "preference", "outcome",
]);
const DECISION_KEYS = Object.freeze([
  "schema", "eventId", "accountId", "chainId", "destinationId", "jobId", "decision", "reason", "category",
  "expected", "found", "did", "why", "delay", "action", "actionCount", "txExecuted", "evidence", "executionContext", "selection", "recordedAt",
]);
const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";

// [A-579] Deep shape check. A-576 checked forbidden fields at the top level only, so a nested
// `evidence.txHash` or `selection.permission` was accepted and copied verbatim (review NOTE-3).
// Now every key at every depth (objects and arrays) is checked, case-insensitively, and no
// string anywhere may carry a 32-byte hex run (tx hash / key / signature shaped).
const DECISION_FORBIDDEN_LOWER = new Set(DECISION_FORBIDDEN_FIELDS.map((field) => field.toLowerCase()));
const DECISION_MAX_DEPTH = 6;
const DECISION_MAX_ARRAY = 64;
const HEX_32_BYTES = /(?:0x)?[0-9a-fA-F]{64}/;

function decisionShapeError(value, depth) {
  if (depth > DECISION_MAX_DEPTH) return "receipt_too_complex";
  if (typeof value === "string") return HEX_32_BYTES.test(value) ? "secret_shaped_value" : null;
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    if (value.length > DECISION_MAX_ARRAY) return "receipt_too_complex";
    for (const item of value) {
      const error = decisionShapeError(item, depth + 1);
      if (error) return error;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    if (DECISION_FORBIDDEN_LOWER.has(key.toLowerCase())) return "forbidden_field_present";
    if (HEX_32_BYTES.test(key)) return "secret_shaped_value";
    const error = decisionShapeError(item, depth + 1);
    if (error) return error;
  }
  return null;
}

// [A-579 repair RV-1] The validated object and the stored object must be the same object.
// A-579 scanned the live input (Object.entries = own enumerable only) and then stored a copy
// built with `key in receipt` + JSON.stringify, so toJSON, inherited fields and stateful
// getters could make the stored row differ from what was checked (review RV-1, 4 vectors).
// Now: refuse any input that is not plain data (non-plain prototype, own `toJSON`, accessor
// property, symbol key) anywhere in the tree, take ONE JSON snapshot, validate that snapshot,
// and hand back exactly that snapshot for storage.
function decisionPlainDataError(value, depth) {
  if (depth > DECISION_MAX_DEPTH) return "receipt_too_complex";
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" ? "receipt_not_plain_data" : null;
  }
  const proto = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return "receipt_not_plain_data";
  if (isArray && value.length > DECISION_MAX_ARRAY) return "receipt_too_complex";
  if (Object.getOwnPropertySymbols(value).length > 0) return "receipt_not_plain_data";
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (isArray && key === "length") continue;
    if (key === "toJSON") return "receipt_not_plain_data";
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || typeof descriptor.get === "function" || typeof descriptor.set === "function") return "receipt_not_plain_data";
    const error = decisionPlainDataError(descriptor.value, depth + 1);
    if (error) return error;
  }
  return null;
}

function snapshotDecisionReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { error: "no_receipt" };
  let plainError;
  try { plainError = decisionPlainDataError(receipt, 0); } catch { plainError = "receipt_not_plain_data"; }
  if (plainError) return { error: plainError };
  let snapshot;
  try { snapshot = JSON.parse(JSON.stringify(receipt)); } catch { return { error: "receipt_not_plain_data" }; }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { error: "no_receipt" };
  return { error: null, snapshot };
}

// Returns `{ error, receipt }`. On success `receipt` is the validated JSON snapshot (only the
// DECISION_KEYS), which is the one and only object a caller may store.
export function validateDecisionReceipt(input, state = {}) {
  const snap = snapshotDecisionReceipt(input);
  if (snap.error) return { error: snap.error };
  const full = validateDecisionSnapshot(snap.snapshot, state);
  if (full.error) return full;
  const receipt = Object.fromEntries(DECISION_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(snap.snapshot, key)).map((key) => [key, snap.snapshot[key]]));
  // the stored subset is validated again, so what is checked is exactly what is stored.
  const stored = validateDecisionSnapshot(receipt, state);
  if (stored.error) return stored;
  return { error: null, receipt };
}

function validateDecisionSnapshot(receipt, state) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { error: "no_receipt" };
  if (receipt.schema !== DECISION_RECEIPT_SCHEMA) return { error: "wrong_schema" };
  for (const field of DECISION_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(receipt, field)) return { error: "forbidden_field_present" };
  }
  // [A-859] A finalized block hash is public chain data but is 32-byte-hex shaped, so the secret-shape scan would reject it.
  // Exempt exactly one slot: evidence.provenance.observation.blockHash, and only when it is a well-formed hash.
  // Everything else (any other key/value, any other path) is still scanned.
  const shapeSubject = (() => {
    const obs = receipt.evidence?.provenance?.observation;
    if (!obs || typeof obs !== "object" || obs.finality !== "finalized" || obs.tagUsed !== "finalized" || !Number.isInteger(obs.block)
      || typeof obs.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(obs.blockHash)) return receipt;
    return { ...receipt, evidence: { ...receipt.evidence, provenance: { ...receipt.evidence.provenance, observation: { ...obs, blockHash: "0xFINALIZED_BLOCK_HASH" } } } };
  })();
  const shapeError = decisionShapeError(shapeSubject, 0);
  if (shapeError) return { error: shapeError };
  if (!nonEmpty(receipt.eventId) || receipt.eventId.length > 200) return { error: "missing_event_id" };
  if (receipt.accountId !== state.accountId || receipt.chainId !== state.chainId) return { error: "scope_mismatch" };
  if (!DECISION_VALUES.includes(receipt.decision)) return { error: "not_action0_decision" };
  if (receipt.action !== "none" || receipt.actionCount !== 0 || receipt.txExecuted !== false || receipt.did !== "nothing") {
    return { error: "not_action0" };
  }
  if (!nonEmpty(receipt.expected) || !nonEmpty(receipt.found) || !nonEmpty(receipt.why)) return { error: "missing_expected_found_why" };
  const evidence = receipt.evidence;
  if (!evidence || typeof evidence !== "object") return { error: "missing_evidence" };
  // nah needs the evidence it rests on. ask/unknown may say that evidence is missing (source/observedAt null).
  if (receipt.decision === "nah" && (!nonEmpty(evidence.source) || !nonEmpty(evidence.observedAt))) return { error: "nah_without_provenance" };
  // [A-579] nah is `expected · found · (block N)`: it names the block its evidence was read at.
  if (receipt.decision === "nah" && (!Number.isInteger(evidence.block) || evidence.block < 0)) return { error: "nah_without_block" };
  // [A-859] A receipt that claims a finalized observation must carry the integer block it was pinned to and its hash.
  const observed = evidence.provenance && typeof evidence.provenance === "object" ? evidence.provenance.observation : null;
  if (observed && typeof observed === "object" && observed.finality === "finalized") {
    if (!Number.isInteger(observed.block) || observed.block < 0) return { error: "finalized_block_mismatch" };
    // Block equality is required only where the Receipt rests on the read (nah / live_observation). Conflict and stale
    // paths keep evidence.block null by design and must still be recordable as UNKNOWN.
    if ((receipt.decision === "nah" || evidence.evidenceMode === "live_observation") && observed.block !== evidence.block) return { error: "finalized_block_mismatch" };
    if (typeof observed.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(observed.blockHash)) return { error: "finalized_without_hash" };
  }
  // [A-579] Chain honesty: the Receipt says which runtime chain it was decided in and that
  // it is not executable there. Evidence from another chain may be cited, never executed.
  const context = receipt.executionContext;
  if (!context || typeof context !== "object" || Array.isArray(context)) return { error: "missing_execution_context" };
  if (context.executable !== false) return { error: "execution_context_overclaims" };
  if (context.runtimeChain !== receipt.chainId) return { error: "execution_context_chain_mismatch" };
  const selection = receipt.selection;
  if (!selection || !nonEmpty(selection.source)) return { error: "missing_selection_source" };
  if (selection.source.length > 64) return { error: "selection_source_too_long" };
  if (selection.ownerFinancialChoice !== false || selection.createsPermission !== false) return { error: "selection_overclaims" };
  return { error: null };
}

export function recordSecondJourneyDecisionReceipt(state, receipt) {
  const verdict = validateDecisionReceipt(receipt, state);
  if (verdict.error) return { state, recorded: false, duplicate: false, error: verdict.error };
  const clean = verdict.receipt; // [A-579 repair RV-1] exactly the validated snapshot
  const applied = recordSecondJourneyReceipt(state, clean, { eventId: clean.eventId });
  return { state: applied.state, recorded: !applied.duplicate, duplicate: applied.duplicate, error: null };
}

export function readSecondJourneyDecisionReceipts(state, { destinationId = null } = {}) {
  const rows = Array.isArray(state?.receipts) ? state.receipts : [];
  return rows
    .filter((row) => row && row.schema === DECISION_RECEIPT_SCHEMA && row.accountId === state.accountId && row.chainId === state.chainId
      && (!destinationId || row.destinationId === destinationId))
    // [A-579 repair RV-1] re-validate on read: a stored row that no longer passes is not surfaced.
    .map((row) => validateDecisionReceipt(row, state))
    .filter((verdict) => !verdict.error)
    .map((verdict) => verdict.receipt);
}

// ── [A-710 E1] durable action-0 decision Receipt + store-level reopen ───────────────────────
// Same schema, same storage key, same `receipts` array as A-576/A-579 (no sidecar). The record
// path starts from the STORED state (never a stale in-memory copy), saves through the merging
// save above, then re-opens from storage: `saved:true` only when the reopened rows contain it.
// Reopen is headless/store-level only; a visible decision-Receipt surface is a DESIGN gate.
export function reopenSecondJourneyDecisionReceipts(storage, scope, { destinationId = null } = {}) {
  const loaded = loadSecondJourneyState(storage, scope);
  if (loaded.error || loaded.repaired) return { receipts: [], error: loaded.error || "stored_state_unreadable" };
  return { receipts: readSecondJourneyDecisionReceipts(loaded.state, { destinationId }), error: null };
}

export function recordSecondJourneyDecisionReceiptDurably(storage, scope, receipt) {
  const loaded = loadSecondJourneyState(storage, scope);
  if (loaded.error || loaded.repaired) return { saved: false, recorded: false, duplicate: false, state: null, error: loaded.error || "stored_state_unreadable" };
  const rec = recordSecondJourneyDecisionReceipt(loaded.state, receipt);
  if (rec.error) return { saved: false, recorded: false, duplicate: false, state: loaded.state, error: rec.error };
  const eventId = typeof receipt?.eventId === "string" ? receipt.eventId : "";
  const present = () => reopenSecondJourneyDecisionReceipts(storage, scope).receipts.some((row) => row.eventId === eventId);
  if (rec.duplicate) {
    // already processed in the store: verify it is really there; never rewrite over it.
    return present()
      ? { saved: true, recorded: false, duplicate: true, state: loaded.state, error: null }
      : { saved: false, recorded: false, duplicate: true, state: loaded.state, error: "save_not_verified" };
  }
  const out = saveSecondJourneyState(storage, scope, rec.state);
  if (!out.saved) return { saved: false, recorded: true, duplicate: false, state: rec.state, error: out.error || "save_not_verified" };
  if (!present()) return { saved: false, recorded: true, duplicate: false, state: out.state, error: "save_not_verified" };
  return { saved: true, recorded: true, duplicate: false, state: out.state, error: null };
}

// ── [A-475] Send 전 draft — "다시 쓰게 만들지 않는다" ────────────────────────────────
// 사용자가 카드를 보다 나갔다 와도 마지막으로 하던 자리로 돌아오게 하는 **최소 상태**다.
// 위 도메인 상태(관심·선호)와 **섞지 않는다** — 이건 배운 것이 아니라 쓰다 만 것이다.
// 그래서 키도 저장 함수도 따로 두되, scope 검증·버전·fail-safe 는 같은 규율을 그대로 쓴다.
//
// **저장하지 않는 것(계약)**: executionPermission · signed/approved · READY/preflight 결과 ·
// safety/eligibility 판정 캐시 · txHash/금융 결과 · outcome(done/failed) · mock 성공 ·
// 애니메이션 진행/타이머 · 인증 비밀/PRF/키. 복귀 후 권한과 READY 는 **항상 새로 계산한다.**
const DRAFT_VERSION = 1;
const DRAFT_PREFIX = "araso.secondJourneyDraft";
const DRAFT_STEPS = Object.freeze(["interests", "candidates", "jit", "readiness"]);

export function secondJourneyDraftKey(scope = {}) {
  const clean = normalizeScope(scope);
  return `${DRAFT_PREFIX}.${clean.chainId}.${clean.accountId}`;
}

const cleanId = (value) => (typeof value === "string" && value.trim() && value.length <= 64 ? value.trim() : null);
const cleanIdList = (value) =>
  Array.isArray(value) ? [...new Set(value.map(cleanId).filter(Boolean))].slice(0, 12) : [];

export function normalizeSecondJourneyDraft(input, scope = {}) {
  const clean = normalizeScope(scope);
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  // 버전이나 소유자가 다르면 **되살리지 않는다**(다른 Piggy/계정/체인 draft 혼입 0).
  if (src.version !== DRAFT_VERSION) return { draft: null, error: "version_mismatch" };
  if (src.accountId !== clean.accountId || src.chainId !== clean.chainId) return { draft: null, error: "scope_mismatch" };
  const step = DRAFT_STEPS.includes(src.step) ? src.step : null;
  if (!step) return { draft: null, error: "unknown_step" };
  const amount = typeof src.amount === "string" && src.amount.length <= 24 ? src.amount : "";
  const jitAnswer = typeof src.jitAnswer === "string" && src.jitAnswer.length <= 64 ? src.jitAnswer : null;
  return {
    draft: {
      version: DRAFT_VERSION,
      accountId: clean.accountId,
      chainId: clean.chainId,
      step,
      seedStage: cleanId(src.seedStage) || "a",
      selectedIds: cleanIdList(src.selectedIds),
      pickedCandidateId: cleanId(src.pickedCandidateId),
      chosenDestinationId: cleanId(src.chosenDestinationId),
      jitAnswer,
      amount,
      savedAt: typeof src.savedAt === "string" ? src.savedAt : null,
    },
    error: null,
  };
}

export function saveSecondJourneyDraft(storage, scope, draft) {
  const key = secondJourneyDraftKey(scope);
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) return { key, saved: false, error: validScope.error };
  if (!storage || typeof storage.setItem !== "function") return { key, saved: false, error: "storage_unavailable" };
  const clean = normalizeScope(scope);
  const normalized = normalizeSecondJourneyDraft({ ...draft, version: DRAFT_VERSION, accountId: clean.accountId, chainId: clean.chainId }, scope);
  if (!normalized.draft) return { key, saved: false, error: normalized.error };
  try {
    storage.setItem(key, JSON.stringify(normalized.draft));
    return { key, saved: true };
  } catch {
    return { key, saved: false, error: "storage_write_failed" };
  }
}

export function loadSecondJourneyDraft(storage, scope = {}) {
  const key = secondJourneyDraftKey(scope);
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) return { key, draft: null, error: validScope.error };
  if (!storage || typeof storage.getItem !== "function") return { key, draft: null, error: "storage_unavailable" };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { key, draft: null, error: null };
    // 망가졌거나 옛 버전이면 **조용히 버린다** — 빈 카드나 무한 복귀보다 처음부터가 낫다.
    return { key, ...normalizeSecondJourneyDraft(JSON.parse(raw), scope) };
  } catch {
    return { key, draft: null, error: "corrupt_json" };
  }
}

export function clearSecondJourneyDraft(storage, scope = {}) {
  const key = secondJourneyDraftKey(scope);
  if (!storage || typeof storage.removeItem !== "function") return { key, cleared: false };
  try {
    storage.removeItem(key);
    return { key, cleared: true };
  } catch {
    return { key, cleared: false };
  }
}

// ── [A-851] Home re-check: which candidates just became go-able ─────────────────────────────────────────────────
// Pure. A candidate in the picked lanes (visibleIds) counts only when its own reader row is readable AND its decision is
// a match (go-able: ask for the exact permission next, never a permission itself). STRICT fail-closed (Cowork: "any
// unreadable row = no new candidate"): if ANY picked-lane row is unreadable (missing, failed, no reading), nothing counts,
// even a readable go-able row beside it. nah / unknown decisions and ids already rung this session never count.
// Reads nothing, stores nothing, grants nothing.
const A851_UNREADABLE_ROW = Object.freeze(["read_failed", "unknown", "assumption_broken", "target_missing", "unavailable"]);
export function newlyGoableCandidateIds({ read = null, decisions = [], visibleIds = [], rungIds = [] } = {}) {
  const rows = Array.isArray(read?.candidates) ? read.candidates : [];
  const visible = Array.isArray(visibleIds) ? visibleIds : [];
  const rung = new Set(rungIds instanceof Set ? [...rungIds] : Array.isArray(rungIds) ? rungIds : []);
  const readable = (id) => {
    const row = rows.find((r) => r && r.id === id);
    return !!row && typeof row.status === "string" && !A851_UNREADABLE_ROW.includes(row.status) && !!row.read && typeof row.read === "object";
  };
  if (visible.some((id) => !readable(id))) return [];
  const out = [];
  for (const d of Array.isArray(decisions) ? decisions : []) {
    if (!d || typeof d.candidateId !== "string" || d.decision !== "match" || d.action !== "ask" || d.executionPermission !== false) continue;
    if (!visible.includes(d.candidateId) || rung.has(d.candidateId) || out.includes(d.candidateId)) continue;
    out.push(d.candidateId);
  }
  return out;
}
