// [A-472] Explore 선택이 실제로 preference 에 반영되는지 — 계산과 저장이 만나는지. 네트워크 0 · 브라우저 0.
//   node app/test/personalization-wiring.mjs
import { readFileSync } from "node:fs";
import { updatePreference } from "../src/job-selector.js";
import { applyExploreSelection, createSecondJourneyState } from "../src/second-journey-state.js";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail_ = 0;
const ok = (l, c, d = "") => { if (c) { console.log(`PASS  ${l}`); pass += 1; } else { console.log(`FAIL  ${l} ${d}`); fail_ += 1; } };

// ── 1. 소스 계약 — 더 이상 기존 preference 를 되먹이지 않는다 ─────────────────
ok("save 경로가 updatePreference 를 쓴다", /const preferenceUpdate = updatePreference\(domainState\.preference, \{\s*\n\s*kind,/.test(SRC));
ok("none 경로도 updatePreference 를 쓴다", /kind: "none",/.test(SRC) && /updatePreference\(domainState\.preference/.test(SRC));
ok("되먹이던 옛 코드가 사라졌다", !/preference: domainState\.preference, delta: \{\}/.test(SRC));
ok("save 의 evidence 는 화면에 보여준 세트", /offeredJobs: displayed,/.test(SRC));
ok("none 의 evidence 도 보여준 세트", /const displayedNone = computeExploreDisplayErrands\(sj\);/.test(SRC) && /offeredJobs: displayedNone,/.test(SRC));
ok("멱등 eventId 헬퍼가 있다", /function exploreEventId\(action, seedStage, ids\)/.test(SRC));
ok("  save/none 둘 다 멱등 키를 쓴다", /eventId: exploreEventId\("save"/.test(SRC) && /eventId: exploreEventId\("none"/.test(SRC));
ok("  랜덤 eventId 가 사라졌다", !/explore-(save|none)-\$\{Date\.now\(\)\}/.test(SRC));

// ── 2. 실제 동작 — 선택이 preference 를 움직인다 ──────────────────────────────
const errand = (id, reason) => ({ id, reason, lane: id, label: id });
const shown = [errand("market", "trade"), errand("grow", "grow"), errand("claim", "claim")];
const base = createSecondJourneyState({ accountId: "0xabc", chainId: "monad-testnet" });

const pick = updatePreference(base.preference, { kind: "one", selectedJobs: [shown[1]], offeredJobs: shown, offeredCount: 3, setIndex: 1 });
ok("선택하면 preference 가 0 벡터에서 움직인다", JSON.stringify(pick.preference) !== JSON.stringify(base.preference));
ok("  고른 항목의 reasonDislike 는 늘지 않는다", (pick.preference.reasonDislike.grow || 0) <= 0);

const none = updatePreference(base.preference, { kind: "none", selectedJobs: [], offeredJobs: shown, offeredCount: 3, setIndex: 1 });
ok("none 은 보여준 항목에만 dislike 를 올린다",
  (none.preference.reasonDislike.trade || 0) > 0 && (none.preference.reasonDislike.claim || 0) > 0);
ok("  보여주지 않은 항목에는 0", (none.preference.reasonDislike.order || 0) === 0);

// ── 3. 저장까지 실제로 흘러간다 ───────────────────────────────────────────────
const saved = applyExploreSelection(base,
  { kind: "one", errandIds: ["grow"], errands: [shown[1]] }, pick,
  { eventId: "explore-save-a-grow", now: new Date().toISOString() });
ok("저장 상태의 preference 가 계산값과 같다", JSON.stringify(saved.state.preference) === JSON.stringify(pick.preference));
ok("  0 벡터가 아니다", JSON.stringify(saved.state.preference) !== JSON.stringify(base.preference));
ok("  interests 도 함께 남는다", (saved.state.interests || []).some((i) => i.errandId === "grow"));

// ── 4. 멱등 — 같은 저장 두 번이 재강화하지 않는다 ─────────────────────────────
const again = applyExploreSelection(saved.state,
  { kind: "one", errandIds: ["grow"], errands: [shown[1]] }, pick,
  { eventId: "explore-save-a-grow", now: new Date().toISOString() });
ok("같은 eventId 재적용은 preference 를 바꾸지 않는다",
  JSON.stringify(again.state.preference) === JSON.stringify(saved.state.preference));
ok("  processedEventIds 도 늘지 않는다",
  (again.state.processedEventIds || []).length === (saved.state.processedEventIds || []).length);

// ── 5. 경계 — preference 가 권한/룰/READY 를 열지 않는다 ──────────────────────
ok("저장 상태에 permission/READY 가 생기지 않는다",
  saved.state.executionPermission === undefined && saved.state.agreedRule === undefined);
ok("rule_nah 는 taste dislike 로 누적되지 않는다",
  (updatePreference(base.preference, { kind: "rule_nah", selectedJobs: [], offeredJobs: shown }).preference.reasonDislike.trade || 0) === 0);
ok("job-feed 가 permission/rule 을 여전히 고정한다",
  readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8").includes("executionPermission: false"));

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
