// [A-499 lane R] Second Journey Receipt 제품 배선 증거. 네트워크 0 · 브라우저 0 · tx 0.
//   node app/test/second-journey-receipt-wiring.mjs
//
// 이 파일이 재는 것 (A-495 가 남긴 구멍 = recordSecondJourneyReceipt 의 caller 부재):
//   1. DEV preview/mock receipt 는 도메인 receipts 에도, Knowledge 승격에도 **들어가지 못한다**.
//   2. 수용 경계: 확정 outcome · 안정 eventId · Piggy/계정/체인 scope · 명시적 non-DEV 증거등급
//      · fork/실거래 실행 증거 필드 · permission/READY 부활 0.
//   3. 같은 eventId 는 멱등.
//   4. evidence pointer 는 EvidenceState 를 갱신하지만, Receipt 를 **보는 것**은 KnowledgeState 를 올리지 않는다.
//   5. 저장된 receipt 는 같은 scope 재진입에서 살아남고, 다른 계정/체인/Piggy 에서는 보이지 않는다.
//   6. failed/pending/unknown 은 서로 구별되고, UNKNOWN 이 재진입에서 success 가 되지 않는다.
//
// PASS 라벨: PASS_SECOND_RECEIPT_PRODUCT_WIRING (제품 배선 + 영속 동작).
// 이것은 J2-6 live/mainnet Second Job 의 PASS 가 **아니다**.

import { readFileSync } from "node:fs";
import {
  createMemoryStorage, createSecondJourneyState,
  loadSecondJourneyState, saveSecondJourneyState,
} from "../src/second-journey-state.js";
import { makeMockReceipt } from "../src/job-feed.js";
import {
  classifySecondReceipt, commitSecondJourneyReceipt, isDevMockReceipt,
  readSecondJourneyReceipts, resolveReceiptOutcome,
  REJECTION, PERSISTABLE_EVIDENCE_CLASSES, FORBIDDEN_RECEIPT_FIELDS,
} from "../src/second-journey-receipt-bridge.js";

let pass = 0, fail_ = 0;
const ok = (l, c, d = "") => { if (c) { console.log(`PASS  ${l}`); pass += 1; } else { console.log(`FAIL  ${l} ${d}`); fail_ += 1; } };

const scope = { accountId: "0xabc", chainId: "monad-testnet" };
const otherAccount = { accountId: "0xdef", chainId: "monad-testnet" };
const otherChain = { accountId: "0xabc", chainId: "monad-mainnet" };

const forkReceipt = (over = {}) => ({
  eventId: "second-fork-1",
  outcome: "done",
  evidenceClass: "PASS_FORK_SIM",
  executionMode: "fork_simulation",
  accountId: scope.accountId,
  chainId: scope.chainId,
  piggyId: "piggy-1",
  destinationId: "aave-supply",
  jobFamily: "grow_stable",
  forkBlock: 106616273,
  measuredDelta: "$5 -> 5.0165",
  recordedAt: "2026-09-21T00:00:00Z",
  evidencePointer: { kind: "fork_run", id: "A-480" },
  ...over,
});

// ── 1. DEV preview / mock 은 거절된다 ────────────────────────────────────────
{
  const mock = makeMockReceipt({ id: "aave-supply" }, { status: "JOB_READY", reasonCode: "ready_fixture" }, { signal: "one" });
  ok("job-feed 의 실제 mock 출력이 mock 으로 식별된다", isDevMockReceipt(mock) === true);

  const v = classifySecondReceipt(mock, { scope });
  ok("  mock 은 persistable 이 아니다", v.persistable === false && v.reason === REJECTION.DEV_MOCK, v.reason);

  const base = createSecondJourneyState(scope);
  const store = createMemoryStorage();
  const res = commitSecondJourneyReceipt({ state: base, receipt: mock, scope, storage: store });
  ok("  mock 은 도메인 receipts 에 들어가지 않는다", res.state.receipts.length === 0 && res.persisted === false);
  ok("  mock 은 저장소에도 쓰이지 않는다", Object.keys(store.dump()).length === 0, JSON.stringify(store.dump()));
  ok("  state 객체 자체가 그대로 반환된다(부분 변경 0)", res.state === base);
  ok("  mock 은 processedEventIds 도 태우지 않는다", res.state.processedEventIds.length === 0);
  ok("  mock 은 KnowledgeState 를 승격시키지 않는다",
    res.state.knowledgeState.observedDemonstrations.length === 0 && res.state.knowledgeState.inferredFromPreference === false);

  // devPreview 문맥이면 **완벽히 생긴 fork receipt 도** 거절된다.
  const dev = commitSecondJourneyReceipt({ state: base, receipt: forkReceipt(), scope, storage: store, context: { devPreview: true } });
  ok("  devPreview 문맥에서는 어떤 receipt 도 영속되지 않는다", dev.persisted === false && dev.reason === REJECTION.DEV_MOCK);
  ok("  receipt 자신이 devPreview 표를 달아도 거절",
    classifySecondReceipt(forkReceipt({ devPreview: true }), { scope }).reason === REJECTION.DEV_MOCK);
  ok("  placeholder 증명이 실려 있으면 거절",
    classifySecondReceipt(forkReceipt({ proofPlaceholders: ["mock receipt"] }), { scope }).reason === REJECTION.DEV_MOCK);
  ok("  mock cost source 도 거절",
    classifySecondReceipt(forkReceipt({ cost: { amount: "0", source: "mock_placeholder" } }), { scope }).reason === REJECTION.DEV_MOCK);
}

// ── 2. 수용 경계 ─────────────────────────────────────────────────────────────
{
  ok("정상 fork receipt 는 통과한다", classifySecondReceipt(forkReceipt(), { scope }).persistable === true);

  const cases = [
    ["outcome 없음", forkReceipt({ outcome: undefined }), REJECTION.NOT_CONFIRMED],
    ["outcome pending", forkReceipt({ outcome: "pending" }), REJECTION.NOT_CONFIRMED],
    ["outcome unknown", forkReceipt({ outcome: "unknown" }), REJECTION.NOT_CONFIRMED],
    ["eventId 없음", forkReceipt({ eventId: "" }), REJECTION.MISSING_EVENT_ID],
    ["piggyId 없음", forkReceipt({ piggyId: "" }), REJECTION.MISSING_PIGGY],
    ["증거등급 없음", forkReceipt({ evidenceClass: "" }), REJECTION.MISSING_EVIDENCE_CLASS],
    ["모르는 증거등급", forkReceipt({ evidenceClass: "PASS_SOMETHING" }), REJECTION.UNKNOWN_EVIDENCE_CLASS],
    ["fork 등급 + live 모드", forkReceipt({ executionMode: "live" }), REJECTION.EVIDENCE_MODE_MISMATCH],
    ["mainnet 등급 + fork 모드", forkReceipt({ evidenceClass: "PASS_MAINNET_TX" }), REJECTION.EVIDENCE_MODE_MISMATCH],
    ["mainnet 등급인데 txHash 없음", forkReceipt({ evidenceClass: "PASS_MAINNET_TX", executionMode: "live" }), REJECTION.LIVE_EVIDENCE_WITHOUT_TX],
    ["다른 계정 표기", forkReceipt({ accountId: "0xdef" }), REJECTION.SCOPE_MISMATCH],
    ["다른 체인 표기", forkReceipt({ chainId: "monad-mainnet" }), REJECTION.SCOPE_MISMATCH],
  ];
  for (const [label, candidate, reason] of cases) {
    const v = classifySecondReceipt(candidate, { scope });
    ok(`  거절: ${label}`, v.persistable === false && v.reason === reason, `${v.reason}`);
  }
  ok("  scope 자체가 미인증이면 거절",
    classifySecondReceipt(forkReceipt(), { scope: { accountId: "", chainId: "" } }).reason === REJECTION.MISSING_SCOPE);

  // 실거래 등급은 실 tx 해시가 있을 때만 성립한다.
  const live = classifySecondReceipt(forkReceipt({
    evidenceClass: "PASS_MAINNET_TX", executionMode: "live",
    txHash: "0x" + "a".repeat(64), blockNumber: 12345, txExecuted: true,
  }), { scope });
  ok("  실거래 등급 + txHash 면 통과하고 실행 증거가 실린다",
    live.persistable === true && live.receipt.txHash === "0x" + "a".repeat(64)
    && live.receipt.blockNumber === 12345 && live.receipt.txExecuted === true);
  ok("  fork receipt 에는 txHash/txExecuted 가 지어내지지 않는다",
    classifySecondReceipt(forkReceipt(), { scope }).receipt.txHash === undefined
    && classifySecondReceipt(forkReceipt(), { scope }).receipt.txExecuted === undefined);
  ok("  fork 실행 증거 필드는 그대로 실린다",
    classifySecondReceipt(forkReceipt(), { scope }).receipt.forkBlock === 106616273);
  ok("  fork 등급이 실거래 등급으로 승격되는 경로가 없다",
    classifySecondReceipt(forkReceipt(), { scope }).receipt.evidenceClass === "PASS_FORK_SIM");
}

// ── 2b. permission/READY 부활 0 ──────────────────────────────────────────────
{
  for (const field of FORBIDDEN_RECEIPT_FIELDS) {
    const v = classifySecondReceipt(forkReceipt({ [field]: true }), { scope });
    ok(`  금지 필드 ${field} 가 실리면 통째로 거절`, v.persistable === false && v.reason === REJECTION.FORBIDDEN_FIELD, v.reason);
  }
  // allow-list 라서, 모르는 필드는 정제본에 아예 없다.
  const v = classifySecondReceipt(forkReceipt({ somethingElse: "x", mockReceipt: { attempted: true } }), { scope });
  ok("  모르는 필드는 저장 형태에 들어오지 않는다(allow-list)",
    v.persistable === true && v.receipt.somethingElse === undefined && v.receipt.mockReceipt === undefined);

  const store = createMemoryStorage();
  const res = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: store });
  const raw = store.getItem(Object.keys(store.dump())[0]);
  for (const banned of ["executionPermission", "agreedRule", "preflight", "JOB_READY", "prfSalt", "observedDemonstrations\":[\"", '"permission"']) {
    ok(`  저장물에 ${banned} 없음`, !raw.includes(banned));
  }
  ok("  저장된 receipt 가 pendingJobs 를 만들지 않는다", (res.state.pendingJobs || []).length === 0);
  ok("  저장된 receipt 가 권한 필드를 만들지 않는다",
    res.state.executionPermission === undefined && res.state.agreedRule === undefined);
}

// ── 3. 멱등 ──────────────────────────────────────────────────────────────────
{
  const store = createMemoryStorage();
  const first = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: store });
  ok("첫 영속이 성공한다", first.persisted === true && first.saved === true && first.state.receipts.length === 1);

  const again = commitSecondJourneyReceipt({ state: first.state, receipt: forkReceipt({ measuredDelta: "위조" }), scope, storage: store });
  ok("  같은 eventId 두 번째는 duplicate", again.duplicate === true && again.persisted === false);
  ok("  receipts 가 늘지 않는다", again.state.receipts.length === 1);
  ok("  기존 내용이 덮어써지지 않는다", again.state.receipts[0].measuredDelta === "$5 -> 5.0165");
  ok("  evidence pointer 도 늘지 않는다", again.state.evidenceState.pointers.length === 1);

  const third = commitSecondJourneyReceipt({ state: again.state, receipt: forkReceipt({ eventId: "second-fork-2" }), scope, storage: store });
  ok("  다른 eventId 는 정상적으로 쌓인다", third.state.receipts.length === 2 && third.persisted === true);
}

// ── 4. EvidenceState 는 올라가고 KnowledgeState 는 올라가지 않는다 ───────────
{
  const store = createMemoryStorage();
  const res = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: store });
  ok("evidence pointer 가 EvidenceState 에 쌓인다",
    res.state.evidenceState.pointers.length === 1 && res.state.evidenceState.pointers[0].id === "A-480");
  ok("  KnowledgeState 는 비어 있다",
    res.state.knowledgeState.observedDemonstrations.length === 0 && res.state.knowledgeState.inferredFromPreference === false);

  // 보는 것은 배우는 것이 아니다 — 읽기 함수는 state 를 바꾸지 않는다.
  const before = JSON.stringify(res.state);
  const rows = readSecondJourneyReceipts(res.state);
  ok("  Receipt 를 읽어도 state 가 그대로다", JSON.stringify(res.state) === before);
  ok("  읽기 결과는 복사본이다", rows.length === 1 && rows[0] !== res.state.receipts[0]);
  rows[0].outcome = "done-tampered";
  ok("  읽기 결과를 고쳐도 state 는 오염되지 않는다", res.state.receipts[0].outcome === "done");

  // knowledgeState 를 실어 보내는 오염 시도는 애초에 거절된다(§2b 금지필드와 같은 문).
  ok("  knowledgeState 를 실은 receipt 는 거절",
    classifySecondReceipt(forkReceipt({ knowledgeState: { observedDemonstrations: ["aave-supply"] } }), { scope }).reason === REJECTION.FORBIDDEN_FIELD);

  // 소스 계약: bridge 어디에도 observedDemonstrations 를 채우는 리터럴이 없다.
  const src = readFileSync(new URL("../src/second-journey-receipt-bridge.js", import.meta.url), "utf8");
  ok("  bridge 소스에 observedDemonstrations 를 채우는 리터럴이 없다",
    (src.match(/observedDemonstrations\s*:\s*\[[^\]]+\]/g) || []).length === 0);
  ok("  bridge 소스에 권한을 켜는 대입이 없다",
    !/executionPermission\s*[:=]\s*true/.test(src) && !/permission\s*=\s*true/.test(src));
}

// ── 5. 재진입 · scope 격리 ───────────────────────────────────────────────────
{
  const store = createMemoryStorage();
  commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: store });

  // 새 핸들로 다시 들어온다 = 재진입.
  const reopened = loadSecondJourneyState(createMemoryStorage(store.dump()), scope);
  ok("재진입 후 receipt 가 남아 있다", reopened.state.receipts.length === 1 && reopened.state.receipts[0].eventId === "second-fork-1");
  ok("  무손실 왕복", reopened.repaired === false && !reopened.error);
  ok("  재진입 후에도 evidence pointer 가 남아 있다", reopened.state.evidenceState.pointers.length === 1);
  ok("  재진입 후 같은 eventId 는 여전히 멱등",
    commitSecondJourneyReceipt({ state: reopened.state, receipt: forkReceipt(), scope, storage: store }).duplicate === true);
  ok("  재진입해도 KnowledgeState 는 비어 있다", reopened.state.knowledgeState.observedDemonstrations.length === 0);

  ok("다른 계정에서는 보이지 않는다", loadSecondJourneyState(createMemoryStorage(store.dump()), otherAccount).state.receipts.length === 0);
  ok("  다른 체인에서도 보이지 않는다", loadSecondJourneyState(createMemoryStorage(store.dump()), otherChain).state.receipts.length === 0);
  ok("  다른 Piggy 로 필터하면 보이지 않는다",
    readSecondJourneyReceipts(reopened.state, { piggyId: "piggy-2" }).length === 0
    && readSecondJourneyReceipts(reopened.state, { piggyId: "piggy-1" }).length === 1);

  // 다른 scope 의 state 위에는 얹히지 않는다.
  const foreign = commitSecondJourneyReceipt({ state: createSecondJourneyState(otherAccount), receipt: forkReceipt(), scope, storage: store });
  ok("  다른 계정의 state 에 얹히지 않는다", foreign.persisted === false && foreign.reason === REJECTION.SCOPE_MISMATCH);
}

// ── 6. failed / pending / unknown 은 구별되고, UNKNOWN 은 success 가 되지 않는다 ──
{
  const store = createMemoryStorage();
  const failed = forkReceipt({ eventId: "second-fork-failed", outcome: "failed", failureReason: "entry_reverted" });
  const res = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: failed, scope, storage: store });
  ok("failed 는 영속된다", res.persisted === true && res.state.receipts[0].outcome === "failed");
  ok("  failed 가 done 으로 바뀌지 않는다", res.state.receipts[0].outcome !== "done");
  ok("  실패 사유가 남는다", res.state.receipts[0].failureReason === "entry_reverted");

  ok("pending 은 영속되지 않는다",
    commitSecondJourneyReceipt({ state: res.state, receipt: forkReceipt({ eventId: "p1", outcome: "pending" }), scope, storage: store }).reason === REJECTION.NOT_CONFIRMED);
  ok("unknown 도 영속되지 않는다",
    commitSecondJourneyReceipt({ state: res.state, receipt: forkReceipt({ eventId: "u1", outcome: "unknown" }), scope, storage: store }).reason === REJECTION.NOT_CONFIRMED);

  ok("해석: done/failed/pending/unknown 이 서로 다르다",
    resolveReceiptOutcome({ outcome: "done" }) === "done"
    && resolveReceiptOutcome({ outcome: "failed" }) === "failed"
    && resolveReceiptOutcome({ outcome: "pending" }) === "pending"
    && resolveReceiptOutcome({ outcome: "unknown" }) === "unknown");
  ok("  결과가 없거나 헛소리면 unknown 이다",
    resolveReceiptOutcome({}) === "unknown" && resolveReceiptOutcome({ outcome: "ok" }) === "unknown"
    && resolveReceiptOutcome(null) === "unknown");

  // 저장물이 손으로 오염돼도 재진입이 success 를 만들지 않는다.
  const key = Object.keys(store.dump())[0];
  const poisoned = JSON.parse(store.getItem(key));
  poisoned.receipts[0].outcome = "mystery";
  const dirty = createMemoryStorage({ [key]: JSON.stringify(poisoned) });
  const back = loadSecondJourneyState(dirty, scope).state;
  ok("  재진입한 알 수 없는 outcome 은 여전히 unknown", resolveReceiptOutcome(back.receipts[0]) === "unknown");
  ok("  그 어떤 경로도 done 을 만들어내지 않았다", back.receipts.every((r) => r.outcome !== "done"));
}

// ── 7. 지금 제품의 Second 흐름은 여전히 비영속이다 (회귀 방지) ──────────────
{
  const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  ok("main.js 는 아직 domain receipts 에 mock 을 넣지 않는다",
    !/recordSecondJourneyReceipt\s*\(/.test(MAIN));
  ok("  main.js 의 mockReceipt 는 메모리 전용 주석 계약을 유지한다",
    /sj\.mockReceipt\s*=\s*sj\.flow\.mockReceipt/.test(MAIN));
  ok("  bridge 가 export 하는 진입점은 commit 하나뿐이다(부르는 자리가 한 곳)",
    /export function commitSecondJourneyReceipt/.test(
      readFileSync(new URL("../src/second-journey-receipt-bridge.js", import.meta.url), "utf8")));
  ok("  영속 가능한 증거등급 목록에 DEV/mock 이 없다",
    PERSISTABLE_EVIDENCE_CLASSES.every((c) => !/mock|preview|dev|fixture/i.test(c)));
}

// ── 7. [A-693] persisted/saved are truthful; the duplicate branch retries a failed save ──────────────
{
  const flaky = () => {
    const base = createMemoryStorage();
    const f = { setThrows: false, silentDrop: false, sets: 0 };
    return { f, getItem: (k) => base.getItem(k), setItem: (k, v) => { f.sets += 1; if (f.setThrows) throw new Error("boom"); if (!f.silentDrop) base.setItem(k, v); }, removeItem: (k) => base.removeItem(k) };
  };
  const stored = (st) => loadSecondJourneyState(st, scope).state.receipts.map((r) => r.eventId);

  const a = flaky(); a.f.setThrows = true;
  const failedSave = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: a });
  ok("D2 저장이 throw 하면 persisted:false · saved:false · 사유가 남는다 (예전: persisted:true)",
    failedSave.persisted === false && failedSave.saved === false && failedSave.reason === "storage_write_failed" && failedSave.duplicate === false);
  ok("  메모리 state 에는 들어가 있다(recorded:true) — 영속과 구별된다", failedSave.recorded === true && failedSave.state.receipts.length === 1);

  const b = flaky(); b.f.silentDrop = true;
  const dropped = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: b });
  ok("D2 setItem 이 조용히 버려지면 읽어서 확인하지 못하므로 saved:false (save_not_verified)",
    dropped.saved === false && dropped.persisted === false && dropped.reason === REJECTION.SAVE_NOT_VERIFIED);

  const noStore = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope });
  ok("D2 storage 가 없으면 메모리만: persisted:false · saved:false · recorded:true", noStore.persisted === false && noStore.saved === false && noStore.recorded === true);

  // D3: first save failed -> the same eventId again re-saves and verifies
  a.f.setThrows = false;
  const retried = commitSecondJourneyReceipt({ state: failedSave.state, receipt: forkReceipt(), scope, storage: a });
  ok("D3 첫 저장 실패 후 같은 eventId 재호출은 duplicate 이지만 다시 저장하고 확인한다",
    retried.duplicate === true && retried.saved === true && retried.persisted === true && retried.reason === null);
  ok("  저장소에 정확히 한 번 들어 있다", stored(a).length === 1 && stored(a)[0] === "second-fork-1");

  // D3: already stored -> verified, no rewrite (another tab's newer state is not overwritten)
  const before = a.f.sets;
  const dup = commitSecondJourneyReceipt({ state: retried.state, receipt: forkReceipt(), scope, storage: a });
  ok("D3 이미 저장돼 있으면 duplicate · saved:true · persisted:false, 다시 쓰지 않는다",
    dup.duplicate === true && dup.saved === true && dup.persisted === false && a.f.sets === before && dup.state.receipts.length === 1);

  // D3: duplicate in memory, store still failing -> honest false, nothing claimed
  const c = flaky(); c.f.setThrows = true;
  const first = commitSecondJourneyReceipt({ state: createSecondJourneyState(scope), receipt: forkReceipt(), scope, storage: c });
  const second = commitSecondJourneyReceipt({ state: first.state, receipt: forkReceipt(), scope, storage: c });
  ok("D3 저장소가 계속 실패하면 duplicate 이어도 saved:false (거짓 확인 없음)", second.duplicate === true && second.saved === false && second.persisted === false && typeof second.reason === "string");

  // main.js harness reads `out.persisted` as "committed": it is now only true for a verified save
  ok("호환: 반환 모양의 기존 키(state/persisted/duplicate/saved/reason/receipt)가 모두 남아 있다",
    ["state", "persisted", "duplicate", "saved", "reason", "receipt"].every((k) => k in failedSave && k in dup));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
if (fail_ === 0) console.log("PASS_SECOND_RECEIPT_PRODUCT_WIRING  (product wiring + persistence only — NOT J2-6 live/mainnet second Job)");
process.exit(fail_ === 0 ? 0 : 1);
