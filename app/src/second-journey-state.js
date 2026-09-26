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
  const shapeError = decisionShapeError(receipt, 0);
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
