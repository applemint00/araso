// [A-544 Repair B / A-543 / A-515 §11] `+ Piggy` + 그 peek(빼꼼)의 소스 계약을 재는 테스트.
//   node app/test/plus-piggy-visibility-gate.mjs
//
// 실제 브라우저 render 증거(1-6 매트릭스 스크린샷/DOM 카운트, non-zero per-Piggy HISTORY)는
// _private/ops/receipts/A544_receipt_owner_visibility/{screenshots,rects}/ 에 있다(RECEIPT.md
// 참고) — 이 파일은 그 render 증거가 기대는 "코드가 실제로 이렇게 생겼다"는 소스 계약만,
// 네트워크/브라우저 0 으로 빠르게 반복 재는 부분이다(A-048 기법: 실제 소스 텍스트만 자른다).
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`끝 마커를 못 찾음: ${endMarker}`);
  return SRC.slice(start, end);
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) {
    console.log(`PASS  ${label}`);
    pass += 1;
  } else {
    console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    fail += 1;
  }
}

// ── §1 canonical 조건은 하나뿐이다(A-543 CODE INVARIANT: 여러 곳에서 다른 조건으로
//     중복 정의하지 않는다) ─────────────────────────────────────────────────────────────────
const CANON = 'scene === "sendstay" && mode === "home" && state.secondJourneyCompletedOnce === true';
const occurrences = SRC.split(CANON).length - 1;
check("canonical 조건 문자열이 main.js 안에 정확히 1곳에만 있다", occurrences, 1);

const showAddPiggyTabSrc = cut("function showAddPiggyTab(scene, mode) {", "\n\n");
check("showAddPiggyTab() 자체가 그 canonical 조건을 그대로 return 한다", showAddPiggyTabSrc.includes(`return ${CANON};`), true);

// ── §2 mountHomeResidentModule() 의 게이트 — predicate 가 거짓이면 +Piggy 뿐 아니라
//     peek(.homePeekBody/.homePeekHandClip) 도, 그 둘에 남을 수 있는 stale .hasPeek 도
//     전부 뗀다(A-544 Repair B — A-540 은 .homePlusPiggyTab 만 뗐던 것의 수리) ──────────────
// [A-624] signature gained `{ reopen = false } = {}` (breakpoint remount keeps the open state) —
// marker updated; the gate/teardown-order contract below is unchanged.
const mountSrc = cut("function mountHomeResidentModule({ reopen = false } = {}) {", "\nfunction remountHomeResidentsForBreakpoint() {");
const gateIfPos = mountSrc.indexOf('if (!showAddPiggyTab(state.scene, "home")) {');
check("mountHomeResidentModule() 안에 predicate 거짓 분기가 있다", gateIfPos >= 0, true);
const gateBlock = gateIfPos >= 0 ? mountSrc.slice(gateIfPos, gateIfPos + 400) : "";
check(
  "그 분기가 .homePlusPiggyTab/.homePeekBody/.homePeekHandClip 을 한 querySelectorAll 로 함께 뗀다",
  /querySelectorAll\(["']\.homePlusPiggyTab,\s*\.homePeekBody,\s*\.homePeekHandClip["']\)/.test(gateBlock),
  true,
);
check(
  "그 분기가 stale .hasPeek 클래스도 지운다(카드/윈도 어느 쪽에 남아 있든)",
  /querySelectorAll\(["']\.hasPeek["']\)[\s\S]{0,80}classList\.remove\(["']hasPeek["']\)/.test(gateBlock),
  true,
);
// 게이트는 mount 가 실제로 끝난 뒤(모듈이 tab/peek DOM 을 이미 붙인 뒤)에만 실행돼야 한다 —
// mountResidentPaper(...).then(...) 콜백 안이라야 mount 된 DOM 을 뗄 수 있다.
const thenPos = mountSrc.indexOf(".then((api) => {");
check("게이트가 mountResidentPaper(...).then() 콜백 안에 있다(mount 뒤에 뗀다)", thenPos >= 0 && thenPos < gateIfPos, true);

// ── §3 predicate 가 참이면 아무것도 떼지 않는다(패키지가 mount 한 그대로 남는다) ────────────
check(
  "predicate 가 참인 분기(가드 밖)에서는 .homePlusPiggyTab/.homePeekBody/.homePeekHandClip 을 떼는 코드가 없다",
  mountSrc.slice(0, gateIfPos).match(/\.homePlusPiggyTab["'][\s\S]{0,20}\)\.forEach\(\(el\) => el\.remove\(\)\)/) === null,
  true,
);

// ── §4 MY MONEY/piggyDetail 모드에서는 이 모듈 자체가 mount 되지 않는다(선택자가
//     data-paper-mode="home" 만 잡는다 -> money/piggyDetail 에서는 애초에 아무것도 안 붙는다,
//     "+Piggy 0/peek 0" 이 이중으로 보장된다: predicate 자체도 mode==="home" 을 요구한다) ─────
check(
  "mountHomeResidentModule() 은 data-paper-mode=\"home\" 인 paper 가 없으면 곧장 return 한다",
  /const paper = document\.querySelector\('\.homePaper\[data-paper-mode="home"\]'\);\s*\n\s*if \(!paper\) return;/.test(mountSrc),
  true,
);
const homePadMarkupSrc = cut("function homePadMarkup(scene) {", "\n\n");
check(
  "homePadMarkup() 은 mode!==\"home\" 이면(money/piggyDetail) data-paper-mode 를 그 mode 그대로 심는다(home 으로 위장하지 않는다)",
  /return homePaperMarkup\(\{ mode, \.\.\.base, bodyMarkup \}\);/.test(homePadMarkupSrc),
  true,
);
check(
  "homePaperEffectiveMode() 는 sendstay 안에서 state.homePaperMode 를 그대로 쓴다(money/piggyDetail 이 home 으로 뭉개지지 않는다)",
  cut("function homePaperEffectiveMode(scene) {", "\n}\n").includes('scene === "sendstay" ? state.homePaperMode : "home"'),
  true,
);

// ── §5 teardown 은 매 mount 전에 먼저 돈다(재mount/모드전환/씬전환에서 중복 DOM 0) ──────────
// [A-624] measured from the body's opening line (the signature grew by `{ reopen = false } = {}`).
const teardownFirstCall = mountSrc.indexOf("teardownHomeResidentModule();") - mountSrc.indexOf("{ reopen = false } = {}) {");
check("mountHomeResidentModule() 은 자기 몸에서 teardownHomeResidentModule() 을 가장 먼저 부른다", teardownFirstCall >= 0 && teardownFirstCall < 60, true);
const refreshSrc = cut("function refreshHomePaperMount() {", "\n}\n");
check("refreshHomePaperMount() 도 innerHTML 교체 전에 teardown, 교체 뒤에 mount 한다(순서 보존)", /teardownHomeResidentModule\(\);[\s\S]*mount\.innerHTML[\s\S]*mountHomeResidentModule\(\);/.test(refreshSrc), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
