// [A-472] animationComplete != actionConfirmed — Second 의 재생/실행 경계. 네트워크 0 · 브라우저 0 · tx 0.
//   node app/test/second-away-boundary.mjs
import vm from "node:vm";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail_ = 0;
const ok = (l, c, d = "") => { if (c) { console.log(`PASS  ${l}`); pass += 1; } else { console.log(`FAIL  ${l} ${d}`); fail_ += 1; } };

// ── 1. settleSecondOutcome 실제 실행 (소스 절단) ──────────────────────────────
const start = SRC.indexOf("function settleSecondOutcome(");
const end = SRC.indexOf("function mountSecondAway()");
if (start < 0 || end < 0) throw new Error("소스에서 못 찾음: settleSecondOutcome");
const ctx = { state: { secondJourney: {} }, console };
vm.createContext(ctx);
vm.runInContext(`${SRC.slice(start, end)}\nglobalThis.__settle = settleSecondOutcome;`, ctx);
const settle = (sj, forced) => { ctx.state.secondJourney = sj; return ctx.__settle(forced); };

const READY = { attempted: true, decidedStatus: "JOB_READY" };
ok("mock 이 실행 확정이면 done", settle({ outcome: "pending", mockReceipt: READY }) === "done");
ok("mockReceipt 없으면 failed(fail-closed)", settle({ outcome: "pending", mockReceipt: null }) === "failed");
ok("attempted=false 면 failed", settle({ outcome: "pending", mockReceipt: { attempted: false, decidedStatus: "JOB_READY" } }) === "failed");
ok("decidedStatus 가 READY 아니면 failed", settle({ outcome: "pending", mockReceipt: { attempted: true, decidedStatus: "NAH" } }) === "failed");
ok("forced failed 는 그대로", settle({ outcome: "pending", mockReceipt: READY }, "failed") === "failed");
ok("이미 확정된 결과는 덮어쓰지 않는다", settle({ outcome: "failed", mockReceipt: READY }) === "failed");
ok("  done 도 유지", settle({ outcome: "done", mockReceipt: null }) === "done");

// ── 2. 소스 계약 — 재생이 귀환을 만들지 않는다 ────────────────────────────────
ok("advanceToReturn 이 outcome 게이트를 통과해야 한다",
  /if \(state\.secondJourney\.outcome !== "done"\) return;/.test(SRC));
ok("  그 게이트가 advanced=true 보다 먼저 온다",
  SRC.indexOf('outcome !== "done") return;') < SRC.indexOf("advanced = true;"));
ok("자산 실패는 전진하지 않고 failed 로 접는다",
  /asset-missing" \|\| st\.phase === "asset-error"\) \{\s*\n\s*settleSecondOutcome\("failed"\);\s*\n\s*return;/.test(SRC));
{
  // 자산 실패 분기 본문(브레이스 사이)에 전진 호출이 없어야 한다.
  const i = SRC.indexOf('st.phase === "asset-missing" || st.phase === "asset-error"');
  const body = SRC.slice(i, SRC.indexOf("}", i));
  ok("  자산 실패 분기에 advanceToReturn 호출 0", !body.includes("advanceToReturn"));
  ok("  자산 실패 분기가 failed 로 접는다", body.includes('settleSecondOutcome("failed")'));
}
{
  const i = SRC.indexOf('st.phase === "complete" || st.phase === "reduced-final"');
  const body = SRC.slice(i, SRC.indexOf("}", i));
  const settleAt = body.indexOf("settleSecondOutcome()");
  const advanceAt = body.indexOf("advanceToReturn()");
  ok("재생 완료는 결과를 읽은 뒤에만 전진", settleAt >= 0 && advanceAt > settleAt);
}
ok("Send 게이트 통과 직후 pending 을 세운다", /sj\.outcome = "pending";/.test(SRC));

// ── 3. 실패에서 완료가 영속되지 않는다 ────────────────────────────────────────
ok("persist 는 outcome done 과 AND", /const persistNow = persist && confirmed;/.test(SRC));
ok("  저장도 persistNow 로 잠긴다", /if \(persistNow\) \{[\s\S]{0,120}writeSecondFlag\(localStorage, "araso\.secondJourneyClosed"/.test(SRC)); // [A-1357 RE-PIN] pre: SECOND_JOURNEY_CLOSED_KEY, "1"
ok("  reset 이 outcome 을 되돌린다", /state\.secondJourney\.outcome = null;/.test(SRC));

// ── 4. First 회귀 방지 — Second 가 First 표를 오염시키지 않는다 ───────────────
{
  const i = SRC.indexOf("function settleSecondOutcome(");
  const j = SRC.indexOf("function mountSecondReturn()");
  const secondSrc = SRC.slice(i, j > i ? j : SRC.length);
  ok("Second 경로가 SEND_PENDING_KEY 를 건드리지 않는다", !secondSrc.includes("SEND_PENDING_KEY"));
  ok("Second 경로가 TRIP_CLOSED_KEY 를 건드리지 않는다", !secondSrc.includes("TRIP_CLOSED_KEY"));
  ok("Second 경로가 araso.txHash 를 쓰지 않는다", !/setItem\("araso\.txHash"/.test(secondSrc));
  ok("Second 경로가 sendInFlight 를 건드리지 않는다", !secondSrc.includes("sendInFlight"));
  ok("outcome 은 state 최상위가 아니라 secondJourney 안에 있다",
    /mockReceipt: null[\s\S]{0,400}\n  outcome: null,/.test(SRC));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
