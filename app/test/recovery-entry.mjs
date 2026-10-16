// [A-461 Lane B] 재방문/새로고침 착지(recovery entry) 계약 — 네트워크 0 · 브라우저 0 · 디스크 0.
//   node app/test/recovery-entry.mjs
// receipt-storage.mjs 와 같은 방식: main.js 소스에서 실제 함수 텍스트를 잘라 node:vm 에서 돌린다.
// 로직을 손으로 다시 쓰지 않는다. 실제 localStorage 는 건드리지 않는다.
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`소스에서 못 찾음(끝): ${endMarker}`);
  return SRC.slice(start, end);
}

const src = cut("function computeInitialScene(", "function migrateTestMeraKeys(");
const ctx = { readPiggyName: () => ctx.__name, __name: "", console };
vm.createContext(ctx);
vm.runInContext(`${src}\nglobalThis.__scene = computeInitialScene;`, ctx);
const scene = (cred, closed, addr, name = "") => { ctx.__name = name; return ctx.__scene(cred, closed, addr); };

let pass = 0, fail_ = 0;
const check = (label, got, want) => {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label}\n  got  ${got}\n  want ${want}`); fail_ += 1; }
};
const checkTrue = (label, cond) => {
  if (cond) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label}`); fail_ += 1; }
};

// ── 1. 착지 지점 (a~c) — 실제 로컬 재현과 일치함을 고정 ────────────────────────────────
check("a) credential·주소 둘 다 없음 → received", scene(false, false, false), "received");
check("a2) credential 없음 + 주소만 있음 → birth", scene(false, false, true), "birth");
check("b) credential 있음 + 이름 미완 → name", scene(true, false, true), "name");
check("c) 이름 완료 → sendstay", scene(true, false, true, "Harness"), "sendstay");
check("c2) 이름 완료 + 바퀴 닫힘 → sendstay (옛 filebox 분기 없음, A-411-p)", scene(true, true, true, "Harness"), "sendstay");
// 이름이 있으면 credential 유무가 앞 분기에서 이미 갈린다 — 이름만으로 birth 를 건너뛰지 않는다.
check("credential 없이 이름만 있어도 birth 우선", scene(false, false, true, "Harness"), "birth");

// ── 2. 소스 계약 — 재방문 자동 전개 규칙 ──────────────────────────────────────────────
{
  checkTrue("초기 quiet→Paper 조건은 sendstay + tripClosed + Second 미완",
    SRC.includes('state.homeQuietForExplore = state.scene === "sendstay" && state.tripClosed && !state.secondJourneyCompletedOnce;'));
  checkTrue("Second 완료면 자동 Explore 를 세우지 않는다(goHomeFromFilebox)",
    SRC.includes("state.homeQuietForExplore = !state.secondJourneyCompletedOnce;"));
  checkTrue("자동 전개 직전에도 완료 여부를 다시 본다(A-411-n §2)",
    /if \(state\.scene !== "sendstay" \|\| state\.secondJourneyCompletedOnce\) return;/.test(SRC));
  checkTrue("미확정 Send 기록이 있으면 txHash 를 닫힌 바퀴로 복구하지 않는다(A-441)",
    SRC.includes("computeTripClosed({"));
}

// ── 3. [A-462] Second 완료 사실은 **영속**한다 — A-461 PREMISE_CONFLICT 해소 ──────────────
// Owner 판정(2026-09-21): "Second 까지 끝낸 사용자는 완료 사실을 저장한다. 재방문 = 조용한
// Home(sendstay), Explore 자동재실행 0." 이전에는 완료 표가 세션 메모리뿐이라 새로고침하면
// 항상 false 가 되어 정본(A-411-n §2 / A-421)을 어겼다(A-461 Lane B 재현 g).
{
  // [A-946 RE-PIN] the key is now per chain scope; on testnet scopedSecondKey returns exactly "araso.secondJourneyClosed" (a946 test). pre-A-946: /const SECOND_JOURNEY_CLOSED_KEY = "araso\.secondJourneyClosed";/
  checkTrue("완료 사실을 담는 저장 키가 있다", /const SECOND_JOURNEY_CLOSED_KEY = scopedSecondKey\("araso\.secondJourneyClosed", RUNTIME_CHAIN_SCOPE\);/.test(SRC));
  checkTrue("state 가 저장 키에서 읽어 초기화된다(재방문에 살아남는다)",
    /secondJourneyCompletedOnce: localStorage\.getItem\(SECOND_JOURNEY_CLOSED_KEY\) === "1",/.test(SRC));
  checkTrue("재방문 자동 전개는 Second 미완일 때만",
    SRC.includes('state.homeQuietForExplore = state.scene === "sendstay" && state.tripClosed && !state.secondJourneyCompletedOnce;'));
  checkTrue("완료 시점에 저장한다", /localStorage\.setItem\(SECOND_JOURNEY_CLOSED_KEY, "1"\);/.test(SRC));

  // 저장하는 것은 **완료 사실 하나뿐** — 선택/권한/금액 같은 일시 상태는 저장하지 않는다.
  const writes = (SRC.match(/localStorage\.setItem\(SECOND_JOURNEY_CLOSED_KEY[^)]*\)/g) || []).length;
  check("  저장하는 자리는 정확히 1곳", writes, 1);

  // onError 는 **자산 로딩 실패**(return-view.js: asset-missing/asset-error)이지 완료가 아니다.
  checkTrue("onError 는 완료 사실로 저장하지 않는다",
    /onError: \(\) => finishSecondJourney\(\{ persist: false \}\)/.test(SRC));
  checkTrue("정상 완료 경로(파일 열기)만 저장한다", /onOpenFilebox: \(\) => finishSecondJourney\(\{ persist: true \}\)/.test(SRC));
  checkTrue("DEV 씬점프(onIdleEnter)는 저장하지 않는다", /finishSecondJourney\(\{ persist: false \}\), 0\)/.test(SRC));
  checkTrue("기본값이 persist:false — 새 호출부가 실수로 저장하지 않는다", /finishSecondJourney = \(\{ persist = false \} = \{\}\) =>/.test(SRC));
  // 2자리: Home(폴더) 탭 + filed 뒤 저절로 Home — 1차와 같은 정착("Later Returns … settle Home the same way").
  check("  persist:true 를 넘기는 자리는 정확히 2곳", (SRC.match(/finishSecondJourney\(\{ persist: true \}\)/g) || []).length, 2);
  // [A-1297] Chog says "done!" between the filed check and the settle (one line, same hold)
  checkTrue("  두 번째 자리 = filed 뒤 secondReturn 에서만, 1차 hold 뒤", /if \(!returnView\?\.filed\) return true;\s*(?:a891ChogSay\([^\n]*"secondDoneLine"[^\n]*\n\s*)?sceneTimeout\(\(\) => \{ if \(valid\(\) && state\.scene === "secondReturn"\) finishSecondJourney\(\{ persist: true \}\); \}, A891_FILED_LINE_HOLD_MS\);/.test(SRC));

  // 지우는 곳은 reset 하나뿐 — 일반 Home 이동/기록 열기/새로고침에서는 0.
  const removes = (SRC.match(/localStorage\.removeItem\(SECOND_JOURNEY_CLOSED_KEY\)/g) || []).length;
  check("  지우는 자리는 정확히 1곳(리셋)", removes, 1);
  const resetSrc = SRC.slice(SRC.indexOf("function resetLocalTest()"), SRC.indexOf("function resetLocalTest()") + 2000);
  checkTrue("  그 1곳이 resetLocalTest() 안이다", resetSrc.includes("localStorage.removeItem(SECOND_JOURNEY_CLOSED_KEY)"));

  // [A-462] 화면에 그려지는 Journey 번호는 **세션 카운트**를 쓴다 — 저장값을 쓰면 새로고침 뒤
  // 2 가 3 으로 바뀌어 사용자 화면이 달라진다(CLAUDE.md 3항). 라우팅만 바꾸고 화면은 그대로.
  checkTrue("Journey 번호는 세션 카운트를 쓴다",
    SRC.includes("const journeyNumber = 1 + (state.tripClosed ? 1 : 0) + (state.secondCompletedThisSession ? 1 : 0);"));
  checkTrue("  저장된 완료값을 화면 숫자에 쓰지 않는다",
    !/journeyNumber = [^;]*secondJourneyCompletedOnce/.test(SRC));
  checkTrue("  세션 카운트는 false 로 시작한다", /secondCompletedThisSession: false,/.test(SRC));
  checkTrue("  리셋에서 되돌린다", /state\.secondCompletedThisSession = false;/.test(SRC));

  // 완료 flag 는 영수증·금융 성공을 만들지 않는다.
  checkTrue("완료 flag 로 receipt 를 만들지 않는다",
    !/SECOND_JOURNEY_CLOSED_KEY[\s\S]{0,400}(rememberReceipt|receipts\.push|serializeReceiptRow)/.test(SRC));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
