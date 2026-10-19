// [A-447] Home 정착 경계 두 곳의 계약을 재는 테스트 — 네트워크 0 · 브라우저 0.
//   node app/test/home-arrival.mjs
// mountHome/mountSecondReturn 은 DOM·모션 결합이 커서 통째로 스텁하기 어렵다. 그래서 실제 main.js
// 소스에서 해당 함수 본문만 잘라 "순서 계약"을 잰다(행동 증거는 Playwright 실화면 — OUTBOX A-447).
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}
let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

const mountHomeSrc = cut("function mountHome({ cardClaimed = state.sendCardVisible } = {}) {", "\n// Home 3분 무입력 졸기 타이머");
const settleSrc = cut("  const settle = ({ keepPose = false } = {}) => {", "\n  const startRect = state.homeStartRect;");
const finishSrc = cut("  const finishSecondJourney = ({ persist = false } = {}) => {", "\n  // [A-421] First(mountReturn)와 같은 알람 생명주기");
const initialSceneAt = SRC.indexOf("state.scene = computeInitialScene(!!state.credential, state.tripClosed, !!state.address);");
const reentrySendAt = SRC.indexOf('state.sendCardVisible = LEGACY_TESTNET_PATH && state.scene === "sendstay" && !state.tripClosed;');

// ── 1. 이름표: 걷기 전에 숨김, 정착에서 보임, 즉시 정착 경로는 숨기지 않음 ──────────────
const hideAt = mountHomeSrc.indexOf('style.setProperty("visibility", "hidden")');
const reducedBranch = mountHomeSrc.indexOf("if (!state.homeArrival || prefersReducedMotion() || !fit) {");
const noStartRect = mountHomeSrc.indexOf("if (!startRect) {");
check("name tag hidden only on the walk path (after reduced/revisit early return)", hideAt > reducedBranch && reducedBranch > 0, true);
check("  … and after the no-startRect early return", hideAt > noStartRect && noStartRect > 0, true);
check("  hidden exactly once in mountHome", mountHomeSrc.split('setProperty("visibility", "hidden")').length - 1, 1);
check("settle() shows the name tag", /#homeName"\)\?\.style\.removeProperty\("visibility"\)/.test(settleSrc), true);

// ── 2. Second 완료: First Send 카드 표를 sendstay 진입 전에 내린다 ──────────────────────
const lowerAt = finishSrc.indexOf("state.sendCardVisible = false;");
const sceneAt = finishSrc.indexOf('setScene("sendstay"');
check("finishSecondJourney lowers sendCardVisible", lowerAt > 0, true);
check("  before entering sendstay", lowerAt > 0 && lowerAt < sceneAt, true);
check("  completion flag still set (auto Explore suppression kept)", finishSrc.includes("state.secondJourneyCompletedOnce = true;"), true);
const secondReturnSrc = cut("function mountSecondReturn() {", "\nfunction goHomeFromFilebox()");
// [A-462] 세 경로 모두 여전히 finishSecondJourney 를 지난다(화면 동작 불변). 달라진 것은
// **영속 저장 여부**뿐이다 — onOpenFilebox 만 persist:true(그 계약은 recovery-entry.mjs 가 잰다).
check("onOpenFilebox/onError/onIdleEnter all route to finishSecondJourney",
  /onOpenFilebox: \(\) => finishSecondJourney\(/.test(secondReturnSrc) && /onError: \(\) => finishSecondJourney\(/.test(secondReturnSrc) && /sceneTimeout\(\(\) => finishSecondJourney\(\{ persist: false \}\), 0\)/.test(secondReturnSrc), true);

// ── 3. First 최초 정착의 Send 카드 reveal 은 그대로 ─────────────────────────────────
check("First reveal pacing [A-1433 A1–A2]: 2 s breath → Chog's three lines → card at the later of arrival + 20 s · the lines said + 1 s · the grant (pre: \"work's coming!\" → card → job lines)",
  /if \(isFirstArrival && !state\.sendCardVisible\) \{[\s\S]*prefetchFirstGrant\(\);[\s\S]*const minAt = Math\.max\(arrivedAt \+ PACE_HOME_TO_CARD_MIN_MS, cueEndAt \? cueEndAt \+ PACE_BREATH_MS : 0\);[\s\S]*Math\.max\(minAt, firstGrantReadyAt\)[\s\S]*sayFirstSendCue\(\);\s*revealSendCard\(\);[\s\S]*sceneTimeout\(announceFirstSend, PACE_SEAT_BREATH_MS\);/.test(settleSrc), true);

// ── 4. First 실패 뒤 reload/redeploy: testnet의 미완료 Home만 Send 카드 복구 ─────────
check("First re-entry restores Send only after the initial scene is known", reentrySendAt > initialSceneAt && initialSceneAt > 0, true);
check("First re-entry gate is testnet + Home + trip not closed",
  /state\.sendCardVisible = LEGACY_TESTNET_PATH && state\.scene === "sendstay" && !state\.tripClosed;/.test(SRC), true);
check("re-entry restore assignment exists exactly once",
  SRC.split('state.sendCardVisible = LEGACY_TESTNET_PATH && state.scene === "sendstay" && !state.tripClosed;').length - 1, 1);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
