// [Second Journey Receipt bridge] 제품 배선의 **문지기**.
//
// 왜 이 파일이 생겼나: `recordSecondJourneyReceipt()` (second-journey-state.js:225) 는
// 있었지만 **제품 안에 부르는 자리가 없었다**(이전에 남겨진 구멍). 그렇다고 아무 곳에서나
// 부르면 안 된다 — 지금 Second 의 완료 경로는 **DEV mock/preview 뿐**이고(main.js
// handleSecondSend:2013 은 `devPreview` 가 아니면 아예 `return` 한다), 그 mock 을 도메인
// receipts 에 넣는 순간 **미리보기가 금융 기록으로 굳는다**.
//
// 그래서 이 파일은 "기록한다"가 아니라 **"기록해도 되는가"** 를 먼저 판정한다.
// 통과하지 못한 것은 `persisted:false` 와 사유로 돌려보내고, state 는 **한 글자도** 바뀌지 않는다.
//
// 이 파일이 하지 않는 것 (계약):
//   · 실행 · 서명 · 권한 부여 · 네트워크 · tx · 자동 다음 실행
//   · KnowledgeState 승격 (Receipt 를 보는 것은 배운 것이 아니다)
//   · permission/READY/preflight 부활 (draft 규율 second-journey-state.js:244 과 같은 금지표)
//
// **지금 상태 그대로라면 이 문은 항상 닫혀 있다.** DEV-only Second 흐름은 실제 실행으로
// 영속되지 않는다 — J2-6(live/fork 실행) 이 붙어 evidenceClass 가 실려 오기 전까지는.

import {
  loadSecondJourneyState,
  recordSecondJourneyReceipt,
  saveSecondJourneyState,
  validatePersistenceScope,
} from "./second-journey-state.js";

/** 영속 가능한 결과. `pending`/`unknown` 은 결과가 아니라 **아직 모름**이다. */
export const TERMINAL_OUTCOMES = Object.freeze(["done", "failed"]);

/**
 * 영속 가능한 증거 등급. second-job-readiness.js EVIDENCE_LABEL 과 **같은 문자열**이다
 * (그 모듈을 import 하지 않는 이유: 이 문지기는 판정 테이블이 아니라 계약만 안다).
 * fork 는 실거래가 아니다 — 등급으로 **드러난 채** 저장되고, 승격 경로는 없다.
 */
// [A-663] PASS_TESTNET_ACTUAL_TX — a real Monad testnet tx, truthfully distinct from both
// PASS_MAINNET_TX (live mainnet) and the three fork classes (simulation). Per the A-663 Owner
// correction (2026-10-01, "TESTNET shMON IS PLUMBING PROOF, NOT THE SECOND JOB"): today the
// only producer of this class is the Second-owned execution plumbing-proof lane
// (second-execution-adapter.js), which is never Explore-visible/Send-visible and never a
// Second Journey product destination — this class exists so that lane's real receipt can
// still pass through the same truthful gate as any future distinct Second product Job would.
export const PERSISTABLE_EVIDENCE_CLASSES = Object.freeze([
  "PASS_FORK_SIM",
  "PASS_FORK_SIM_WITH_PENDING",
  "PASS_APP_FORK_E2E",
  "PASS_MAINNET_TX",
  "PASS_TESTNET_ACTUAL_TX",
]);

/** 이 등급/모양이 보이면 **즉시 거절**한다. 미리보기는 기록이 아니다. */
export const DEV_EVIDENCE_CLASSES = Object.freeze([
  "dev_preview", "devPreview", "mock", "mock_receipt", "ui_preview", "fixture", "preview", "demo", "sample",
]);

const MOCK_RECEIPT_KINDS = Object.freeze(["mock_second_journey_receipt"]);

/** Receipt 에 실려 와도 **절대 저장하지 않는** 필드 — draft 금지표와 같은 규율. */
export const FORBIDDEN_RECEIPT_FIELDS = Object.freeze([
  "executionPermission", "permission", "permissionGranted", "agreedRule",
  "preflight", "readiness", "ready", "signed", "approved", "signature",
  "prfSalt", "credentialId", "privateKey", "secret",
  "knowledgeState", "observedDemonstrations", "inferredFromPreference",
]);

export const REJECTION = Object.freeze({
  NO_RECEIPT: "no_receipt",
  DEV_MOCK: "dev_mock_receipt",
  NOT_CONFIRMED: "outcome_not_confirmed",
  MISSING_EVENT_ID: "missing_event_id",
  MISSING_SCOPE: "missing_scope",
  SCOPE_MISMATCH: "scope_mismatch",
  MISSING_PIGGY: "missing_piggy",
  MISSING_EVIDENCE_CLASS: "missing_evidence_class",
  UNKNOWN_EVIDENCE_CLASS: "unknown_evidence_class",
  EVIDENCE_MODE_MISMATCH: "evidence_mode_mismatch",
  LIVE_EVIDENCE_WITHOUT_TX: "live_evidence_without_tx",
  FORBIDDEN_FIELD: "forbidden_field_present",
  // [A-693 D2] setItem returned but the stored bytes do not contain the receipt (or cannot be read back).
  SAVE_NOT_VERIFIED: "save_not_verified",
});

// [A-663] TESTNET_ACTUAL is its own mode string — never "live" (mainnet) and never
// "fork_simulation" — so a real testnet tx can never be mistaken for either at this gate.
const EXECUTION_MODES = Object.freeze({ FORK: "fork_simulation", LIVE: "live", TESTNET_ACTUAL: "testnet_actual" });

const str = (v) => (typeof v === "string" ? v.trim() : "");
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * "이건 DEV 미리보기/mock 인가?" — 한 곳에서만 판정한다.
 * job-feed.js makeMockReceipt() 출력(`receiptKind:"mock_second_journey_receipt"`,
 * `txExecuted:false`, `realActionExecuted:false`, `proofPlaceholders`)을 정확히 잡는다.
 */
export function isDevMockReceipt(candidate = {}, context = {}) {
  if (!candidate || typeof candidate !== "object") return true;
  if (context.devPreview === true || candidate.devPreview === true) return true;
  if (MOCK_RECEIPT_KINDS.includes(str(candidate.receiptKind))) return true;
  if (Array.isArray(candidate.proofPlaceholders) && candidate.proofPlaceholders.length > 0) return true;
  if (DEV_EVIDENCE_CLASSES.includes(str(candidate.evidenceClass))) return true;
  if (str(candidate.cost?.source) === "mock_placeholder") return true;
  if (candidate.realActionExecuted === false) return true;
  if (str(candidate.stateChange) === "mock_state_change_only") return true;
  return false;
}

/**
 * **영속 가능한 Second Receipt 의 정확한 수용 경계.**
 * 통과 시 저장될 형태(정제본)를 함께 돌려준다 — 입력 객체를 그대로 저장하지 않는다.
 *
 * @returns {{persistable:boolean, reason:string|null, receipt:object|null}}
 */
export function classifySecondReceipt(candidate, { scope = {}, context = {} } = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { persistable: false, reason: REJECTION.NO_RECEIPT, receipt: null };
  }

  // ① DEV/mock 은 **다른 어떤 필드가 맞아도** 통과하지 못한다. 가장 먼저 닫는다.
  if (isDevMockReceipt(candidate, context)) {
    return { persistable: false, reason: REJECTION.DEV_MOCK, receipt: null };
  }

  // ② 확정된 결과만. pending/unknown/없음은 결과가 아니다.
  const outcome = str(candidate.outcome);
  if (!TERMINAL_OUTCOMES.includes(outcome)) {
    return { persistable: false, reason: REJECTION.NOT_CONFIRMED, receipt: null };
  }

  // ③ 안정적인 event id — 멱등의 유일한 근거.
  const eventId = str(candidate.eventId);
  if (!eventId || eventId.length > 128) {
    return { persistable: false, reason: REJECTION.MISSING_EVENT_ID, receipt: null };
  }

  // ④ 계정/체인 scope + 선택된 Piggy.
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) return { persistable: false, reason: REJECTION.MISSING_SCOPE, receipt: null };
  const rAccount = str(candidate.accountId);
  const rChain = str(candidate.chainId);
  if ((rAccount && rAccount !== validScope.accountId) || (rChain && rChain !== validScope.chainId)) {
    return { persistable: false, reason: REJECTION.SCOPE_MISMATCH, receipt: null };
  }
  const piggyId = str(candidate.piggyId);
  if (!piggyId) return { persistable: false, reason: REJECTION.MISSING_PIGGY, receipt: null };

  // ⑤ 증거 등급이 **명시적으로** 실려야 한다. 없으면 "아마 진짜겠지" 로 넘기지 않는다.
  const evidenceClass = str(candidate.evidenceClass);
  if (!evidenceClass) return { persistable: false, reason: REJECTION.MISSING_EVIDENCE_CLASS, receipt: null };
  if (!PERSISTABLE_EVIDENCE_CLASSES.includes(evidenceClass)) {
    return { persistable: false, reason: REJECTION.UNKNOWN_EVIDENCE_CLASS, receipt: null };
  }

  // ⑥ 등급과 실행 모드가 서로 말이 맞아야 한다. fork 라벨이 live 로 새지 않는다.
  const executionMode = str(candidate.executionMode);
  const isLiveClass = evidenceClass === "PASS_MAINNET_TX";
  // [A-663] 테스트넷 실거래 등급도 같은 원칙 — 자기 전용 모드 문자열과만 맞는다.
  const isTestnetActualClass = evidenceClass === "PASS_TESTNET_ACTUAL_TX";
  if (isLiveClass && executionMode !== EXECUTION_MODES.LIVE) {
    return { persistable: false, reason: REJECTION.EVIDENCE_MODE_MISMATCH, receipt: null };
  }
  if (isTestnetActualClass && executionMode !== EXECUTION_MODES.TESTNET_ACTUAL) {
    return { persistable: false, reason: REJECTION.EVIDENCE_MODE_MISMATCH, receipt: null };
  }
  if (!isLiveClass && !isTestnetActualClass && executionMode !== EXECUTION_MODES.FORK) {
    return { persistable: false, reason: REJECTION.EVIDENCE_MODE_MISMATCH, receipt: null };
  }
  // 실거래 등급(mainnet live 또는 testnet actual)은 **실제 tx 해시** 없이는 성립하지 않는다.
  if ((isLiveClass || isTestnetActualClass) && outcome === "done" && !TX_HASH.test(str(candidate.txHash))) {
    return { persistable: false, reason: REJECTION.LIVE_EVIDENCE_WITHOUT_TX, receipt: null };
  }

  // ⑦ 금지 필드가 실려 오면 **조용히 지우지 않고 거절한다** — 부른 쪽이 틀렸다는 뜻이기 때문.
  for (const field of FORBIDDEN_RECEIPT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) {
      return { persistable: false, reason: REJECTION.FORBIDDEN_FIELD, receipt: null };
    }
  }

  // 정제본 — allow-list 다. 모르는 필드는 **들어오지 못한다**.
  const receipt = {
    schema: "second_journey_receipt_v1",
    eventId,
    outcome,
    evidenceClass,
    executionMode,
    accountId: validScope.accountId,
    chainId: validScope.chainId,
    piggyId,
    destinationId: str(candidate.destinationId) || null,
    jobFamily: str(candidate.jobFamily) || null,
    recordedAt: str(candidate.recordedAt) || str(context.now) || "UNKNOWN_TIME",
    sourceTask: str(candidate.sourceTask) || null,
  };
  // 실제/fork 실행 증거는 **있을 때만** 싣는다. 없는 것을 지어내지 않는다.
  if (TX_HASH.test(str(candidate.txHash))) receipt.txHash = str(candidate.txHash);
  if (Number.isFinite(Number(candidate.blockNumber))) receipt.blockNumber = Number(candidate.blockNumber);
  if (Number.isFinite(Number(candidate.forkBlock))) receipt.forkBlock = Number(candidate.forkBlock);
  if (candidate.txExecuted === true) receipt.txExecuted = true;
  if (str(candidate.measuredDelta)) receipt.measuredDelta = str(candidate.measuredDelta);
  if (str(candidate.failureReason)) receipt.failureReason = str(candidate.failureReason);
  // [A-1312 ④] the departure moment (ms) the Receipt shows as "went out", kept like the first trip's (A-1277)
  if (Number.isSafeInteger(candidate.wentOutAt) && candidate.wentOutAt > 0) receipt.wentOutAt = candidate.wentOutAt;
  if (candidate.evidencePointer && typeof candidate.evidencePointer === "object") {
    receipt.evidencePointer = { ...candidate.evidencePointer };
  }
  return { persistable: true, reason: null, receipt };
}

/**
 * [A-693 D2/D3] Read the STORED second-journey state back and ask whether this event is in it.
 * `true` only when a fresh getItem -> decode shows the receipt row (or, for a non-row event, its id).
 * Any read/parse/scope problem is `false`: unknown stays unsaved.
 */
function storedHasReceipt(storage, scope, eventId) {
  if (!storage || typeof storage.getItem !== "function") return false;
  try {
    const loaded = loadSecondJourneyState(storage, scope);
    if (loaded.error || loaded.repaired) return false;
    return (loaded.state.receipts || []).some((row) => row && row.eventId === eventId);
  } catch {
    return false;
  }
}

/**
 * **제품이 부르는 유일한 함수.** 완료 경계에서 한 번만 부른다.
 *
 * 통과하지 못하면 `state` 를 **입력 그대로** 돌려준다(부분 변경 0, 저장 0).
 * 통과하면 recordSecondJourneyReceipt → saveSecondJourneyState → 다시 읽어 확인 순으로 나간다.
 *
 * [A-693] 반환 모양은 그대로이되 의미가 정직해졌다:
 *   · `saved`     저장소를 **다시 읽어** 이 receipt 가 들어 있음을 확인했을 때만 true (D2)
 *   · `persisted` 이번 호출이 새 기록을 **실제로 저장 확인**했을 때만 true (= saved 이면서 duplicate 아님).
 *                 저장이 실패하면 false — 예전처럼 "메모리에만 있는데 persisted:true" 가 없다.
 *   · `recorded`  (신규) 메모리 state 에 이 receipt 가 들어갔는가
 * 같은 eventId 두 번째 호출은 `duplicate:true` 이고 state 는 늘지 않는다. 저장소에 이미 확인되면
 * `saved:true`(다시 쓰지 않는다 — 다른 탭 상태를 덮지 않기 위해), 아직 없으면 **다시 저장해서 확인**한다 (D3).
 *
 * @param {object} p
 * @param {object} p.state   현재 second journey 도메인 state
 * @param {object} p.receipt 후보 receipt (mock 이면 거절된다)
 * @param {object} p.scope   { accountId, chainId }
 * @param {object} [p.storage] localStorage 호환. 없으면 메모리 state 만 갱신한다 (saved:false).
 * @param {object} [p.context] { devPreview, now }
 */
export function commitSecondJourneyReceipt({ state, receipt: candidate, scope = {}, storage = null, context = {} } = {}) {
  if (!state || typeof state !== "object") {
    return { state, persisted: false, duplicate: false, saved: false, recorded: false, reason: REJECTION.NO_RECEIPT, receipt: null };
  }
  const verdict = classifySecondReceipt(candidate, { scope, context });
  if (!verdict.persistable) {
    return { state, persisted: false, duplicate: false, saved: false, recorded: false, reason: verdict.reason, receipt: null };
  }
  // state 자신의 소유자와도 맞아야 한다 — 다른 Piggy/계정의 state 에 얹지 않는다.
  if (state.accountId !== verdict.receipt.accountId || state.chainId !== verdict.receipt.chainId) {
    return { state, persisted: false, duplicate: false, saved: false, recorded: false, reason: REJECTION.SCOPE_MISMATCH, receipt: null };
  }

  const applied = recordSecondJourneyReceipt(state, verdict.receipt, { eventId: verdict.receipt.eventId });
  const eventId = verdict.receipt.eventId;

  if (applied.duplicate) {
    // [A-693 D3] 메모리에 이미 있다 ≠ 저장됐다. 첫 저장이 실패했을 수 있으니 저장소를 확인하고, 없으면 다시 쓴다.
    if (!storage) {
      return { state: applied.state, persisted: false, duplicate: true, saved: false, recorded: false, reason: null, receipt: verdict.receipt };
    }
    if (storedHasReceipt(storage, scope, eventId)) {
      return { state: applied.state, persisted: false, duplicate: true, saved: true, recorded: false, reason: null, receipt: verdict.receipt };
    }
    // [A-710 S1 · A-693 M-3] this retry used to write the in-memory state over the whole store; the save now
    // merges with what is stored and reads back, and the caller gets the verified merged state.
    const retry = saveSecondJourneyState(storage, scope, applied.state);
    const retryVerified = retry.saved === true && storedHasReceipt(storage, scope, eventId);
    return {
      state: retryVerified && retry.state ? retry.state : applied.state,
      persisted: retryVerified,
      duplicate: true,
      saved: retryVerified,
      recorded: false,
      reason: retryVerified ? null : retry.error || REJECTION.SAVE_NOT_VERIFIED,
      receipt: verdict.receipt,
    };
  }

  let saved = false;
  let saveError = null;
  let mergedState = null;
  if (storage) {
    // [A-710 S1 · A-693 M-3] merge-on-save: rows another tab stored since `state` was loaded are kept.
    const result = saveSecondJourneyState(storage, scope, applied.state);
    saveError = result.error || null;
    if (result.saved === true) {
      saved = storedHasReceipt(storage, scope, eventId);
      if (!saved) saveError = REJECTION.SAVE_NOT_VERIFIED;
      else mergedState = result.state || null;
    }
  }
  return { state: mergedState || applied.state, persisted: saved, duplicate: false, saved, recorded: true, reason: saveError, receipt: verdict.receipt };
}

/**
 * **보기만 하는 읽기.** 이 함수는 state 를 바꾸지 않는다 — 특히 KnowledgeState 를.
 * `outcome` 은 저장된 값 그대로다: done/failed 가 서로 섞이지 않고, 없던 성공이 생기지 않는다.
 */
export function readSecondJourneyReceipts(state, { piggyId = null } = {}) {
  const rows = Array.isArray(state?.receipts) ? state.receipts : [];
  const scoped = rows.filter((r) => r && r.schema === "second_journey_receipt_v1"
    && r.accountId === state.accountId && r.chainId === state.chainId
    && (!piggyId || r.piggyId === piggyId));
  return scoped.map((r) => ({ ...r }));
}

/**
 * 저장물에서 되살린 receipt 의 결과 해석. **모르는 것은 끝까지 모르는 것이다.**
 * 알려진 terminal 값이 아니면 `"unknown"` 이며, 어떤 경로로도 `"done"` 이 되지 않는다.
 */
export function resolveReceiptOutcome(receipt) {
  const outcome = str(receipt?.outcome);
  if (outcome === "done" || outcome === "failed") return outcome;
  if (outcome === "pending") return "pending";
  return "unknown";
}
