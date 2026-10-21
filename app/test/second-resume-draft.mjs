// [A-475] Send 전 exact resume — 최소 draft 계약. 네트워크 0 · 브라우저 0 · tx 0.
//   node app/test/second-resume-draft.mjs
import { readFileSync } from "node:fs";
import {
  saveSecondJourneyDraft, loadSecondJourneyDraft, clearSecondJourneyDraft,
  secondJourneyDraftKey, normalizeSecondJourneyDraft, createMemoryStorage,
} from "../src/second-journey-state.js";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail_ = 0;
const ok = (l, c, d = "") => { if (c) { console.log(`PASS  ${l}`); pass += 1; } else { console.log(`FAIL  ${l} ${d}`); fail_ += 1; } };

const scope = { accountId: "0xabc", chainId: "monad-testnet" };
const other = { accountId: "0xdef", chainId: "monad-testnet" };
const otherChain = { accountId: "0xabc", chainId: "monad-mainnet" };
const draft = { step: "readiness", seedStage: "a", selectedIds: ["grow"], pickedCandidateId: "cand-1", chosenDestinationId: "cand-1", jitAnswer: "few_days", amount: "12.34" };

// ── 1. 왕복 ──────────────────────────────────────────────────────────────────
{
  const st = createMemoryStorage();
  ok("저장 성공", saveSecondJourneyDraft(st, scope, draft).saved === true);
  const got = loadSecondJourneyDraft(st, scope).draft;
  ok("금액 그대로", got?.amount === "12.34");
  ok("JIT 답 그대로", got?.jitAnswer === "few_days");
  ok("step 그대로", got?.step === "readiness");
  ok("선택 그대로", JSON.stringify(got?.selectedIds) === JSON.stringify(["grow"]));
  ok("키가 account+chain scoped", secondJourneyDraftKey(scope) === "araso.secondJourneyDraft.monad-testnet.0xabc");
  ok("clear 후 사라진다", (clearSecondJourneyDraft(st, scope), loadSecondJourneyDraft(st, scope).draft === null));
}

// ── 2. 다른 계정/체인 draft 혼입 0 ───────────────────────────────────────────
{
  const st = createMemoryStorage();
  saveSecondJourneyDraft(st, scope, draft);
  ok("다른 계정에서 안 보인다", loadSecondJourneyDraft(st, other).draft === null);
  ok("다른 체인에서 안 보인다", loadSecondJourneyDraft(st, otherChain).draft === null);
  ok("키가 서로 다르다", secondJourneyDraftKey(scope) !== secondJourneyDraftKey(other));
}

// ── 3. 금지 필드는 저장되지 않는다 ───────────────────────────────────────────
{
  const st = createMemoryStorage();
  saveSecondJourneyDraft(st, scope, {
    ...draft, executionPermission: true, permission: true, agreedRule: { ok: true },
    preflight: { status: "JOB_READY" }, readiness: "JOB_READY", outcome: "done",
    txHash: "0x" + "1".repeat(64), mockReceipt: { attempted: true }, prfSalt: "secret",
    animationProgress: 0.7, evidence: { eligibility: "ok" },
  });
  const raw = st.getItem(secondJourneyDraftKey(scope));
  for (const banned of ["executionPermission", "agreedRule", "preflight", "JOB_READY", "outcome", "txHash", "mockReceipt", "prfSalt", "animationProgress", "evidence", '"permission"']) {
    ok(`저장물에 ${banned} 없음`, !raw.includes(banned));
  }
  const got = loadSecondJourneyDraft(st, scope).draft;
  ok("  복원값에도 permission 없음", got.executionPermission === undefined && got.permission === undefined);
}

// ── 4. 손상·구버전·scope 불일치는 조용히 버린다 ──────────────────────────────
{
  const st = createMemoryStorage();
  st.setItem(secondJourneyDraftKey(scope), "{ not json");
  ok("깨진 JSON → null(크래시 0)", loadSecondJourneyDraft(st, scope).draft === null);
  st.setItem(secondJourneyDraftKey(scope), JSON.stringify({ ...draft, version: 99, accountId: "0xabc", chainId: "monad-testnet" }));
  ok("옛 버전 → null", loadSecondJourneyDraft(st, scope).draft === null);
  st.setItem(secondJourneyDraftKey(scope), JSON.stringify({ ...draft, version: 1, accountId: "0xzzz", chainId: "monad-testnet" }));
  ok("소유자 불일치 → null", loadSecondJourneyDraft(st, scope).draft === null);
  ok("모르는 step → null", normalizeSecondJourneyDraft({ version: 1, ...scope, step: "nope" }, scope).draft === null);
  ok("scope 없으면 저장 거부", saveSecondJourneyDraft(createMemoryStorage(), { accountId: "", chainId: "" }, draft).saved === false);
}

// ── 5. 소스 계약 ─────────────────────────────────────────────────────────────
{
  ok("Send 진입에서 draft 를 닫는다", /sj\.outcome = "pending";[\s\S]{0,200}dropSecondDraft\(\);/.test(SRC));
  ok("완료에서도 닫는다", /markResultMotionSeen\(\);\s*\n\s*dropSecondDraft\(\);/.test(SRC));
  ok("리셋에서도 닫는다", /state\.secondJourney\.outcome = null;\s*\n\s*dropSecondDraft\(\);/.test(SRC));
  ok("보낸 뒤에는 저장하지 않는다", /if \(sj\.outcome\) return;/.test(SRC));
  // 저장은 조작 지점마다 직접 일어난다. (파일 내 beforeunload 는 A-292 세션 종료용이라 draft 와 무관 —
  // draft 가 그 이벤트에 **기대지 않는다**는 것만 잰다.)
  ok("입력 변화마다 저장한다", (SRC.match(/persistSecondDraft\(\);/g) || []).length >= 5);
  {
    // 주석은 빼고 **실행되는 코드**만 본다 — 주석이 "beforeunload 에 기대지 않는다"고 설명한다.
    const code = SRC.split("\n").map((line) => line.split("//")[0]).join("\n");  // 줄 안 주석까지 제거
    ok("  draft 가 beforeunload 에 기대지 않는다",
      !/beforeunload[^\n]*persistSecondDraft/.test(code) && !/persistSecondDraft[^\n]*beforeunload/.test(code));
  }
  ok("복귀는 Explore 진입에서 한 번", /applySecondDraftIfAny\(sj, domainState\)(?: == null\) sj\.step = "intro";|;)/.test(SRC)); // [E42] 초안 없으면 intro 카드. pre-E42: applySecondDraftIfAny(sj, domainState);
  ok("  복귀 직후 반드시 재계산한다", /applySecondDraftIfAny\(sj, domainState\)(?: == null\) sj\.step = "intro";|;)\s*\n\s*recomputeSecondJourneyFlow\(\);/.test(SRC));
  const fnStart = SRC.indexOf("function applySecondDraftIfAny");
  const fn = SRC.slice(fnStart, SRC.indexOf("\n}", fnStart) + 2);
  ok("복귀 함수가 permission 을 복원하지 않는다", !/permission/.test(fn));
  ok("  READY/preflight 도 복원하지 않는다", !/JOB_READY|preflight|executionPermission/.test(fn));
  ok("stale destination 은 버리고 fallback", /step === "readiness" && !sj\.chosenDestinationId\) step = "candidates"/.test(fn));
  ok("  선택이 없으면 interests 로", /step === "candidates" && !sj\.selectedIds\.length\) step = "interests"/.test(fn));
  // First 오염 0
  ok("draft 경로가 First 키를 건드리지 않는다",
    !/SEND_PENDING_KEY|TRIP_CLOSED_KEY|araso\.txHash/.test(SRC.slice(SRC.indexOf("function currentSecondDraft"), SRC.indexOf("function safeLocalStorage"))));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
