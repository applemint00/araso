// [A-466 Lane A] 결과 모션 "첫 1회 전체재생 → 이후 skip" 계약 — 네트워크 0 · 브라우저 0 · 디스크 0.
//   node app/test/result-motion-skip.mjs
// 소스 계약 + piggy-return 의 skip() 동작을 격리 실행으로 잰다. 실제 캔버스/자산은 쓰지 않는다.
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const VIEW = readFileSync(new URL("../src/return-view.js", import.meta.url), "utf8");
const PLAY = readFileSync(new URL("../src/piggy-return.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

let pass = 0, fail_ = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} ${detail}`); fail_ += 1; }
};

// ── 1. 저장: boolean 1개, 끝까지 간 뒤에만, reset 에서만 삭제 ──────────────────────────
{
  ok("저장 키는 하나", /const RESULT_MOTION_SEEN_KEY = "araso\.resultMotionSeen";/.test(MAIN));
  ok("state 가 저장에서 복원된다", /resultMotionSeen: localStorage\.getItem\(RESULT_MOTION_SEEN_KEY\) === "1",/.test(MAIN));
  ok("쓰는 자리는 markResultMotionSeen 하나", (MAIN.match(/localStorage\.setItem\(RESULT_MOTION_SEEN_KEY/g) || []).length === 1);
  ok("지우는 자리도 하나", (MAIN.match(/localStorage\.removeItem\(RESULT_MOTION_SEEN_KEY\)/g) || []).length === 1);
  const resetSrc = MAIN.slice(MAIN.indexOf("function resetLocalTest()"), MAIN.indexOf("function resetLocalTest()") + 2200);
  ok("  그 자리가 resetLocalTest() 안", resetSrc.includes("localStorage.removeItem(RESULT_MOTION_SEEN_KEY)"));
  ok("  reset 이 메모리 상태도 되돌린다", /state\.resultMotionSeen = false;/.test(MAIN));

  // Return 진입만으로는 서지 않는다 — 호출 지점이 끝(Home 정리)인지 확인
  ok("First 는 goHomeFromFilebox 에서 표시", /function goHomeFromFilebox\(\) \{\s*\n\s*markResultMotionSeen\(\);/.test(MAIN));
  ok("Second 는 실제 완료(persist) 자리에서만 표시", /if \(persist\) markResultMotionSeen\(\);/.test(MAIN));
  ok("  mountReturn/mountSecondReturn 진입부에서 표시하지 않는다",
    !/function mountReturn\(\)[\s\S]{0,600}markResultMotionSeen/.test(MAIN));
  const marks = (MAIN.match(/markResultMotionSeen\(\)/g) || []).length;
  ok(`  호출 지점은 정의 1 + 호출 2 = 3 (got ${marks})`, marks === 3);
}

// ── 2. 표시 규칙: 첫 결과엔 숨김, 이후에만 ────────────────────────────────────────────
{
  ok("두 Return 경로 모두 allowSkip 을 넘긴다", (MAIN.match(/allowSkip: state\.resultMotionSeen === true,/g) || []).length === 2);
  ok("기본값은 숨김(allowSkip=false)", /allowSkip = false,/.test(VIEW));
  ok("마크업 기본이 hidden", /id="returnSkip" type="button" hidden>skip<\/button>/.test(VIEW));
  ok("allowSkip 일 때만 보인다", /if \(skipBtn && allowSkip\) \{\s*\n\s*skipBtn\.hidden = false;/.test(VIEW));
}

// ── 3. 문구·시각문법은 기존 승인값 재사용, 새 수치 0 ──────────────────────────────────
{
  ok("문구는 기존 승인값 skip", /id="returnSkip"[^>]*>skip</.test(VIEW));
  ok("hatch 의 skip 문구와 동일", /id="skipHatchButton" type="button">skip</.test(MAIN));
  ok("클래스도 기존 .tiny.skip 재사용", /class="tiny skip" id="returnSkip"/.test(VIEW));
  ok("CSS 에 .tiny.skip 규칙이 이미 있다", /\.tiny\.skip \{/.test(CSS));
  ok("  returnSkip 전용 새 CSS 규칙 0", !/#returnSkip|\.returnSkip/.test(CSS));
  const skipRules = (CSS.match(/\.tiny\.skip/g) || []).length;
  ok(`  .tiny.skip 정의는 한 곳뿐 (got ${skipRules})`, skipRules === 1);
}

// ── 4. 안전 경계 — 화면만, 금융 0 ─────────────────────────────────────────────────────
{
  const skipFn = PLAY.slice(PLAY.indexOf("function skip()"), PLAY.indexOf("function start()"));
  ok("skip() 이 존재하고 playback API 로 나온다", skipFn.includes("function skip()") && /return \{ start, stop, tap, skip,/.test(PLAY));
  ok("자산 실패에서는 아무 일도 하지 않는다",
    /phase === "asset-missing" \|\| phase === "asset-error"/.test(skipFn) && skipFn.includes("return status();"));
  ok("이미 filed 면 두 번 처리하지 않는다", /if \(filedFired\) return status\(\);/.test(skipFn));
  ok("skip 은 tx/영수증/권한을 만들지 않는다",
    !/sendTransaction|rememberReceipt|executionPermission|writeSendPending|commitSendSuccess|TRIP_CLOSED_KEY/.test(skipFn));
  ok("skip 은 씬 전환을 만들지 않는다(Away→Return 0)", !/setScene|__arasoScene/.test(skipFn));
  // view 쪽 핸들러도 같은 경계
  const handler = VIEW.slice(VIEW.indexOf("if (skipBtn && allowSkip)"), VIEW.indexOf("playback.start();"));
  ok("view 핸들러는 playback.skip() 만 부른다",
    handler.includes("playback.skip()") && !/setScene|onOpenFilebox\(\)|onError\(/.test(handler));
  ok("  이미 filed 면 무시", /if \(filed\) return;/.test(handler));
  ok("실패 phase 에서 skip 버튼을 내린다", /asset-error"\) \{[\s\S]{0,120}skipBtn\.hidden = true;/.test(VIEW));
  ok("filed 되면 skip 버튼을 내린다", /onFiled: \(\) => \{[\s\S]{0,120}skipBtn\.hidden = true;/.test(VIEW));
}

// ── 5. 기존 흐름 유지 — 두 탭 의미와 저장은 그대로 ────────────────────────────────────
{
  ok("Receipt/File it 두 탭 힌트 유지", /"Receipt"/.test(VIEW) && /"File it"/.test(VIEW));
  ok("tap() 은 그대로 남아 있다", /function tap\(\)/.test(PLAY));
  ok("reduced 경로는 그대로", /if \(reduced\) \{[\s\S]{0,200}RETURN_TOTAL_S/.test(PLAY));
  ok("  시스템 정착(reduced)과 사용자 skip 은 다른 함수다",
    PLAY.indexOf("function skip()") !== -1 && !/function tap\(\)[\s\S]{0,40}function skip/.test(PLAY));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
