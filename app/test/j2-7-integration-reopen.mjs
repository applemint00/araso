// [A-495 / lane J2-7] Second Journey 통합·재진입 증거. 네트워크 0 · 브라우저 0 · tx 0.
//   node app/test/j2-7-integration-reopen.mjs
//
// 이 파일이 재는 것(기존 테스트가 덮지 않는 이음매만):
//   1. 첫 Receipt → 남은 관심/선택 상태 → 다음 선택이 **실제 저장소 왕복(save→load)** 을 건너서도 산다.
//   2. 같은 증거가 반복돼도 preference 가 **bounded** — 폭주 0.
//   3. Receipt 를 **보기만 하는 것**은 KnowledgeState 를 승격시키지 않는다.
//   4. Receipt 이후 **자동 다음 실행 0**.
//   5. 권한/READY 는 draft 에서 **절대** 복원되지 않는다 — main.js 의 실제 함수 본문을 잘라 실행해서 잰다.
//
// 기존 커버리지(중복하지 않고 인용만):
//   - draft 왕복/금지필드/scope 격리 : app/test/second-resume-draft.mjs:21-70
//   - 복원 state 가 다음 선택 기본값  : app/test/second-job-flow.mjs:146 (객체 직접 주입, 저장소 왕복 아님)
//   - 한 번의 선택 후 bound 유지      : app/test/second-job-flow.mjs:30
//   - 멱등 eventId 재적용             : app/test/personalization-wiring.mjs "4. 멱등"
//   - mock Receipt txExecuted=false   : app/test/second-job-flow.mjs:114

import { readFileSync } from "node:fs";
import { updatePreference } from "../src/job-selector.js";
import { runSecondJourney, buildVisibleLaneChoices } from "../src/job-feed.js";
import {
  createSecondJourneyState, createMemoryStorage,
  applyExploreSelection, recordSecondJourneyReceipt,
  saveSecondJourneyState, loadSecondJourneyState,
  saveSecondJourneyDraft, secondJourneyDraftKey,
} from "../src/second-journey-state.js";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail_ = 0;
const ok = (l, c, d = "") => { if (c) { console.log(`PASS  ${l}`); pass += 1; } else { console.log(`FAIL  ${l} ${d}`); fail_ += 1; } };

const scope = { accountId: "0xabc", chainId: "monad-testnet" };
const errand = (id, reason) => ({ id, reason, lane: id, label: id });
const shown = [errand("market", "trade"), errand("grow", "grow"), errand("claim", "claim")];

// job-feed/second-journey-state 가 실제로 강제하는 bound (second-journey-state.js:5-13).
const BOUNDS = {
  liquidity: 0.6, lowCost: 0.6, yield: 0.6, novelty: 0.6, clarity: 0.6,
  confidence: 0.35, explorationWidth: 0.25,
};
const withinBounds = (pref) =>
  Object.entries(BOUNDS).every(([k, max]) => typeof pref[k] === "number" && pref[k] >= -max && pref[k] <= max)
  && Object.values(pref.reasonDislike || {}).every((v) => v >= 0 && v <= 0.35);

// ── 1. 첫 Receipt → 남은 관심/선택 → 다음 선택이 재진입을 넘어 산다 ──────────
let reopened = null;
{
  const store = createMemoryStorage();
  const base = createSecondJourneyState(scope);

  // (a) 첫 Receipt 가 기록된다 — 이것이 Second 의 출발선이다.
  const afterReceipt = recordSecondJourneyReceipt(base, {
    eventId: "first-shmon-receipt", sourceTask: "A-174",
    txExecuted: false, evidencePointer: { kind: "receipt", id: "r1" },
  }, { eventId: "first-shmon-receipt" });
  ok("첫 Receipt 가 기록된다", afterReceipt.state.receipts.length === 1 && afterReceipt.duplicate === false);
  ok("  같은 Receipt 두 번은 중복으로 막힌다",
    recordSecondJourneyReceipt(afterReceipt.state, { eventId: "first-shmon-receipt" }, { eventId: "first-shmon-receipt" }).duplicate === true);

  // (b) 관심/선호가 쌓인다.
  const pick = updatePreference(afterReceipt.state.preference,
    { kind: "one", selectedJobs: [shown[1]], offeredJobs: shown, offeredCount: 3, setIndex: 1 });
  const selected = applyExploreSelection(afterReceipt.state,
    { kind: "one", errandIds: ["grow"], errands: [shown[1]] }, pick,
    { eventId: "explore-save-a-grow", now: "2026-09-21T00:00:00Z" });

  // (c) 실제 저장소로 나갔다가 **새 핸들**로 다시 들어온다 = 재진입.
  ok("저장이 성공한다", saveSecondJourneyState(store, scope, selected.state).saved === true);
  const raw = store.dump()[Object.keys(store.dump())[0]];
  const reload = loadSecondJourneyState(createMemoryStorage({ [`araso.secondJourney.${scope.chainId}.${scope.accountId}`]: raw }), scope);
  reopened = reload.state;

  ok("재진입 후 Receipt 가 남아 있다", reopened.receipts.some((r) => r.eventId === "first-shmon-receipt"));
  ok("재진입 후 evidence pointer 가 남아 있다", reopened.evidenceState.pointers.length === 1);
  ok("재진입 후 관심이 남아 있다", reopened.interests.some((i) => i.errandId === "grow"));
  ok("재진입 후 preference 가 그대로다", JSON.stringify(reopened.preference) === JSON.stringify(selected.state.preference));
  ok("  0 벡터로 리셋되지 않았다", JSON.stringify(reopened.preference) !== JSON.stringify(base.preference));
  ok("  repaired 되지 않았다(무손실 왕복)", reload.repaired === false && !reload.error);
  ok("재진입 후 멱등 키도 남아 다시 학습되지 않는다",
    applyExploreSelection(reopened, { kind: "one", errandIds: ["grow"], errands: [shown[1]] }, pick,
      { eventId: "explore-save-a-grow" }).duplicate === true);

  // (d) 다음 선택이 그 상태를 기본값으로 이어받는다 — 저장소를 실제로 지나온 state 로.
  const next = runSecondJourney({ secondJourneyState: reopened, selectionKind: "one", selectedErrandIds: ["market"], eventId: "next-1" });
  ok("다음 선택의 기준선 = 재진입한 preference",
    JSON.stringify(next.preferenceState.before) === JSON.stringify(reopened.preference));
  ok("  state 오류 없이 흐른다", next.stateError === undefined);
  ok("  이전 관심도 함께 유지된다", next.explicitInterestState.interests.some((i) => i.errandId === "grow"));
}

// ── 2. 반복 증거 → bounded 변화만, 폭주 0 ────────────────────────────────────
{
  let st = createSecondJourneyState(scope);
  const store = createMemoryStorage();
  let prevJson = null, sameFor = 0;
  for (let i = 0; i < 40; i += 1) {
    // 매번 **다른** eventId — 멱등 가드로 가려지지 않게 진짜 반복 증거를 넣는다.
    const upd = updatePreference(st.preference, { kind: "none", selectedJobs: [], offeredJobs: shown, offeredCount: 3, setIndex: i });
    st = applyExploreSelection(st, { kind: "none", errandIds: [], errands: [] }, upd, { eventId: `rep-${i}` }).state;
    saveSecondJourneyState(store, scope, st);
    st = loadSecondJourneyState(store, scope).state;   // 매 바퀴 재진입까지 섞는다
    if (!withinBounds(st.preference)) { ok(`반복 ${i} 회에서 bound 이탈`, false, JSON.stringify(st.preference)); break; }
    const json = JSON.stringify(st.preference);
    if (json === prevJson) sameFor += 1; else sameFor = 0;
    prevJson = json;
  }
  ok("반복 40회 + 매 회 재진입 후에도 모든 축이 bound 안", withinBounds(st.preference), JSON.stringify(st.preference));
  ok("  reasonDislike 도 0.35 를 넘지 않는다",
    Object.values(st.preference.reasonDislike).every((v) => v <= 0.35), JSON.stringify(st.preference.reasonDislike));
  ok("  결국 포화해 더는 움직이지 않는다(폭주 0)", sameFor >= 3, `sameFor=${sameFor}`);
  ok("  processedEventIds 가 무한히 자라지 않는다(<=80)", st.processedEventIds.length <= 80, String(st.processedEventIds.length));
  ok("  고정 성격 라벨이 생기지 않는다", st.fixedPersonalityLabel === undefined);
}

// ── 3. Receipt 를 보는 것만으로 KnowledgeState 가 승격되지 않는다 ────────────
{
  const base = createSecondJourneyState(scope);
  const viewed = recordSecondJourneyReceipt(base, {
    eventId: "view-1", evidencePointer: { kind: "receipt", id: "r2" },
    // 아래는 "봤다"는 사실이 학습으로 둔갑하는지 보려고 일부러 섞는 오염 시도다.
    knowledgeState: { observedDemonstrations: ["aave-supply"], inferredFromPreference: true },
    observedDemonstrations: ["aave-supply"],
  }, { eventId: "view-1" }).state;

  ok("Receipt 를 봐도 observedDemonstrations 는 비어 있다",
    (viewed.knowledgeState.observedDemonstrations || []).length === 0, JSON.stringify(viewed.knowledgeState));
  ok("  inferredFromPreference 는 여전히 false", viewed.knowledgeState.inferredFromPreference === false);
  ok("  Receipt 안에 실린 knowledgeState 는 state 로 새지 않는다",
    JSON.stringify(viewed.knowledgeState) === JSON.stringify(base.knowledgeState));
  ok("  대신 EvidenceState 에만 포인터가 쌓인다", viewed.evidenceState.pointers.length === 1);

  const store = createMemoryStorage();
  saveSecondJourneyState(store, scope, viewed);
  const back = loadSecondJourneyState(store, scope).state;
  ok("  재진입해도 KnowledgeState 는 비어 있다", (back.knowledgeState.observedDemonstrations || []).length === 0);

  const flow = runSecondJourney({ secondJourneyState: back, selectionKind: "one", selectedErrandIds: ["grow"], eventId: "k-1" });
  ok("  흐름 출력의 KnowledgeState 도 preference 에서 유래하지 않는다",
    flow.knowledgeState.inferredFromPreference === false
    && flow.knowledgeState.source === "not_updated_by_preference"
    && flow.knowledgeState.observedDemonstrations.length === 0);

  // 소스 계약: 제품 코드 어디에도 observedDemonstrations 를 채우는 자리가 없다.
  const feed = readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8");
  const stateSrc = readFileSync(new URL("../src/second-journey-state.js", import.meta.url), "utf8");
  const fills = [...SRC, feed, stateSrc].length && [SRC, feed, stateSrc]
    .flatMap((s) => s.match(/observedDemonstrations\s*:\s*\[[^\]]+\]/g) || []);
  ok("  소스에 observedDemonstrations 를 채우는 리터럴이 없다", fills.length === 0, JSON.stringify(fills));
}

// ── 4. Receipt 이후 자동 다음 실행 0 ─────────────────────────────────────────
{
  const after = recordSecondJourneyReceipt(createSecondJourneyState(scope),
    { eventId: "recp", evidencePointer: { kind: "receipt", id: "r3" } }, { eventId: "recp" }).state;
  ok("Receipt 가 pendingJobs 를 만들지 않는다", (after.pendingJobs || []).length === 0);
  ok("  Receipt 가 권한을 만들지 않는다", after.executionPermission === undefined && after.agreedRule === undefined);

  const flow = runSecondJourney({ secondJourneyState: after, selectionKind: "one", selectedErrandIds: ["grow"], jitAnswer: "few_days", eventId: "auto-1" });
  ok("  다음 흐름이 실행권을 켜지 않는다", flow.preferenceState.executionPermission === false);
  ok("  tx 가 실행되지 않는다", flow.txExecuted === false && flow.mockReceipt.txExecuted === false);
  ok("  실제 행동도 0", flow.mockReceipt.realActionExecuted === false);
  ok("  권한 없이는 preflight 가 READY 가 아니다",
    !flow.preflight || flow.preflight.executionPermission === false, JSON.stringify(flow.preflight?.status));

  // 소스 계약: Receipt/완료 자리에서 다음 Send 를 스스로 부르지 않는다.
  const code = SRC.split("\n").map((l) => l.split("//")[0]).join("\n");
  ok("  타이머가 Send 를 자동으로 부르지 않는다",
    !/set(Timeout|Interval)\([^)]*(handleSecondSend|sendSecond|startSecondSend)/.test(code));
  // Send 는 이름이 실제로 존재해야 위 검사가 헛돌지 않는다.
  ok("  Send 진입점이 실제로 존재한다", /function handleSecondSend\(/.test(code));
  // [A-977 RE-PIN] the fork block wraps the Send entry (base kept + reassigned, fork profile only); its refs are counted apart. pre-A-977: all of main.js
  // const refs = (code.match(/handleSecondSend/g) || []).length; // pre-A-977
  const a977s = SRC.indexOf("// ── [A-977] Job 10 on the shared fork"), a977e = SRC.indexOf("// ── [A-977] end Job 10");
  const outside977 = (a977s > 0 && a977e > a977s ? SRC.slice(0, a977s) + SRC.slice(a977e) : SRC).split("\n").map((l) => l.split("//")[0]).join("\n");
  const refs = (outside977.match(/handleSecondSend/g) || []).length;
  ok("  Send 는 정의 1 + 사용자 click 바인딩 1 뿐 — 스스로 부르는 자리 0",
    refs === 2 && /addEventListener\("click", handleSecondSend\)/.test(code), `refs=${refs}`);
}

// ── 5. 권한/READY 는 draft 에서 복원되지 않는다 — 실제 함수 본문을 잘라 실행 ──
{
  // main.js 의 applySecondDraftIfAny 본문을 그대로 잘라 온다(source-cut 관례).
  // import.meta 는 함수 밖에서 못 쓰므로 토큰만 주입 파라미터로 치환한다 — 로직은 손대지 않는다.
  const start = SRC.indexOf("function applySecondDraftIfAny");
  const body = SRC.slice(start, SRC.indexOf("\n}", start) + 2);
  ok("applySecondDraftIfAny 본문을 잘라냈다", start > 0 && body.includes("loadSecondJourneyDraft"));

  const cut = body.replace(/import\.meta\.env/g, "IMPORT_META_ENV");
  const factory = new Function(
    "IMPORT_META_ENV", "loadSecondJourneyDraft", "safeLocalStorage", "secondJourneyScope",
    "computeExploreDisplayErrands", "buildVisibleLaneChoices",
    `${cut}; return applySecondDraftIfAny;`,
  );

  const store = createMemoryStorage();
  // 저장 경로가 금지 필드를 거른다는 건 second-resume-draft.mjs:44 가 잰다.
  // 여기서는 **저장물이 이미 오염돼 있어도** 복원이 문을 열지 않는지를 본다.
  saveSecondJourneyDraft(store, scope, { step: "readiness", seedStage: "a", selectedIds: ["grow"], pickedCandidateId: "aave-supply", chosenDestinationId: "aave-supply", jitAnswer: "few_days", amount: "12.34" });
  const key = secondJourneyDraftKey(scope);
  const poisoned = { ...JSON.parse(store.getItem(key)), permission: true, executionPermission: true, preflight: { status: "JOB_READY" }, readiness: "JOB_READY", outcome: "done", txHash: "0x" + "1".repeat(64) };
  store.setItem(key, JSON.stringify(poisoned));

  const { loadSecondJourneyDraft } = await import("../src/second-journey-state.js");
  const applyReal = factory(
    { DEV: false },
    loadSecondJourneyDraft,
    () => store,
    () => scope,
    () => shown,
    buildVisibleLaneChoices,
  );

  const sj = {
    step: "interests", seedStage: "a", selectedIds: [], amount: "", jitAnswer: null,
    pickedCandidateId: null, chosenDestinationId: null,
    permission: false, devPreview: false,
    flow: { destinations: [{ id: "aave-supply" }] },
  };
  const step = applyReal(sj, createSecondJourneyState(scope));

  ok("쓰다 만 자리로는 돌아온다", step === "readiness" && sj.amount === "12.34" && sj.jitAnswer === "few_days");
  ok("  선택도 돌아온다", JSON.stringify(sj.selectedIds) === JSON.stringify(["grow"]));
  ok("권한은 복원되지 않는다", sj.permission === false);
  ok("  executionPermission 이 생기지 않는다", sj.executionPermission === undefined);
  ok("  preflight/READY 가 복원되지 않는다", sj.preflight === undefined && sj.readiness === undefined);
  ok("  outcome/txHash 도 복원되지 않는다", sj.outcome === undefined && sj.txHash === undefined);
  ok("  복원 함수 본문에 permission/READY 문자열 자체가 없다",
    !/permission|JOB_READY|preflight|txHash|outcome/.test(body));

  // stale destination: 지금 후보에 없으면 그 값만 버리고 한 단계 내려간다.
  const sj2 = { ...sj, step: "interests", selectedIds: [], amount: "", jitAnswer: null, pickedCandidateId: null, chosenDestinationId: null, flow: { destinations: [{ id: "other-only" }] } };
  const step2 = applyReal(sj2, createSecondJourneyState(scope));
  ok("stale destination 은 버리고 candidates 로 내려간다",
    step2 === "candidates" && sj2.chosenDestinationId === null, `${step2}/${sj2.chosenDestinationId}`);
  ok("  그래도 권한은 여전히 false", sj2.permission === false && sj2.executionPermission === undefined);
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
