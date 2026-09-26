// [A-486 Lane B → A-510 Stream A] 같은 종이 위 동작 UI 계약 — 네트워크 0 · 브라우저 0.
//   node app/test/t3-action-ui.mjs
//
// 이력: A-486 은 여기서 give some / bring some home / bring all home 인라인 동작을 단언했다
// (canBringHome 행렬 · "bring all home · 3.75 USDC" · homePiggyAction--<id>--give_some).
// 그 동작은 Home 이 따로 돈을 가진다는 옛 모델의 것이라 A-508 에서 제거됐다 — 아래 §1 은 **제거됨**을 단언한다.
// 남은 계약: 텍스트 동작 껍데기 재사용 · 금액 선택지 상한 · 클릭=의도 · ok=권한 대기 · 새 에셋 0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as homePaper from "../src/home-paper.js";
const { amountChoiceMarkup, amountChoices, confirmButtonMarkup } = homePaper;
import { PERMISSION_STATE } from "../src/permission-envelope.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../src/home-paper.js", import.meta.url), "utf8");
const TS = "2026-09-21T04:00:00Z";
const asset = (q) => ({ symbol: "USDC", quantity: q, decimals: 6, sourceTimestamp: TS, assetId: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" });
const piggy = (id, q, location = "home") => ({ id, name: id, location, assets: q ? [asset(q)] : [] });

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. Home 소유 돈 동작은 제거됐다 (A-508) ─────────────────────────────────────
check("give some / bring home controls no longer exist in the paper module", () => {
  for (const gone of ["PIGGY_ACTION", "canBringHome", "piggyInlineActionsMarkup", "shortfallNoteMarkup"]) {
    assert.equal(gone in homePaper, false, `${gone} must be gone`);
  }
  const code = HOME.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const gone of ["give some", "bring some home", "bring all home", "give_some", "bring_all_home"]) {
    assert.equal(code.includes(gone), false, `${gone} must not be live paper copy`);
  }
});

check("main.js has no live caller of the removed Home-owned actions", () => {
  const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const gone of ["piggyInlineActionsMarkup", "canBringHome", "PIGGY_ACTION", "shortfallNoteMarkup", "homePiggyAction--", "atHome:"]) {
    assert.equal(code.includes(gone), false, `${gone} must not be live in main.js`);
  }
});

check("amount choices are bounded by what that Piggy holds, not a Home balance", () => {
  const i = MAIN.indexOf("function moneyIntentMarkup(");
  const block = MAIN.slice(i, i + 900);
  assert.match(block, /const availability = held\?\.quantity \?\? null;/);
  assert.equal(block.includes("homeMoneyNativeWei"), false);
});

// ── 2. 새 버튼 가족을 만들지 않는다 ─────────────────────────────────────────────
check("the ok button reuses the same shell and is disabled until valid", () => {
  const off = confirmButtonMarkup({ enabled: false });
  const on = confirmButtonMarkup({ enabled: true });
  assert.match(off, /class="homePaper__records"/);
  assert.match(off, /disabled/);
  assert.equal(/disabled/.test(on), false);
});

// ── 3. 금액 선택지는 가진 것을 넘지 않는다 ──────────────────────────────────────
check("preset amounts larger than the balance are not offered", () => {
  assert.deepEqual(amountChoices("100").map((c) => c.value), ["20", "50", "custom"]);
  assert.deepEqual(amountChoices("30").map((c) => c.value), ["20", "custom"]);
});

check("a small balance offers exactly what is held, never a rounded-up preset", () => {
  const choices = amountChoices("3.5");
  assert.deepEqual(choices.map((c) => c.value), ["3.5", "custom"]);
  assert.match(choices[0].label, /all · 3\.5/);
});

check("no balance offers nothing at all", () => {
  assert.deepEqual(amountChoices("0"), []);
  assert.deepEqual(amountChoices(null), []);
  assert.deepEqual(amountChoices("abc"), []);
});

check("choice markup marks the selected one without a new control family", () => {
  const html = amountChoiceMarkup(amountChoices("100"), { selected: "20" });
  assert.match(html, /homePaper__records--on/);
  assert.equal(html.split("homePaper__records--on").length - 1, 1); // 정확히 하나만 선택
});

// ── 4. 누른다고 실행되지 않는다 ─────────────────────────────────────────────────
check("ok moves to awaiting_permission, never to executed", () => {
  const i = MAIN.indexOf("#homeActionOk");
  // A-495 에서 부족분 충전 분기가 앞에 붙어 블록이 길어졌다 — 구간을 넓혀 같은 계약을 잰다.
  const block = MAIN.slice(i - 200, i + 1200);
  // A-492 에서 리터럴 대신 enum 을 쓴다 — 값은 그대로 "awaiting_permission" 이다.
  assert.match(block, /status: (PERMISSION_STATE\.AWAITING|"awaiting_permission")/);
  assert.equal(PERMISSION_STATE.AWAITING, "awaiting_permission");
  assert.equal(/executionPermission\s*=\s*true/.test(block), false);
  assert.equal(block.includes("executed"), false);
});

check("the UI never sets executionPermission anywhere", () => {
  const laneB = MAIN.split("[A-486 Lane B]").slice(1).map((chunk) => chunk.slice(0, 1500)).join("\n");
  assert.equal(/executionPermission/.test(laneB), false);
});

check("the awaiting state says plainly that nothing was sent", () => {
  assert.match(MAIN, /아직 아무것도 보내지 않았어/);
});

// ── 5. 두 장 문법과 기존 동작 ───────────────────────────────────────────────────
check("no third paper, no Piggy Detail page is introduced", () => {
  // Lane B 가 **새로** 만든 구간만 본다. (A-412 의 기존 homePiggyDetailMarkup 은 이 카드가
  // 건드리지 않은 예전 왼쪽-종이 뷰이지, 새 페이지가 아니다.)
  const laneB = MAIN.split("[A-486 Lane B]").slice(1).map((c) => c.slice(0, 1500)).join("\n");
  for (const banned of ["thirdPaper", "piggyDetailPage", "dashboard", "homePiggyDetailMarkup"]) {
    assert.equal(laneB.includes(banned), false, `must not introduce ${banned}`);
  }
  // 의도/충전 표시는 MY MONEY 본문에 문자열로 이어붙는다(새 앵커/씬 0)
  assert.match(MAIN, /homeMoneyMarkup\(\{ title: "MY MONEY", time, rows, note: homeMoneyTotalsNote\(snapshot\.totals\) \}\) \+ intentMarkup \+ fundingMarkup/);
});

check("HOME records behaviour is untouched", () => {
  const i = MAIN.indexOf("#homeRecordsButton");
  const block = MAIN.slice(i - 500, i + 300);
  assert.match(block, /state\.historyPiggyId = null/);
  assert.match(HOME, /export function homePaperRecordsEntryMarkup/);
});

check("a newborn Piggy is never asked for a type or purpose", () => {
  const laneB = MAIN.split("[A-486 Lane B]").slice(1).map((c) => c.slice(0, 1500)).join("\n")
    + (HOME.split("[A-486 Lane B]")[1] || "");
  for (const banned of ["purpose", "accountType", "piggyType", "Worker", "Gift account", "Card account"]) {
    assert.equal(laneB.includes(banned), false, `must not ask for ${banned}`);
  }

});

// ── 6. 새 디자인 에셋 0 ─────────────────────────────────────────────────────────
check("no new asset, svg or motion is introduced by the action markup", () => {
  const html = amountChoiceMarkup(amountChoices("100")) + confirmButtonMarkup({});
  for (const banned of ["<svg", "<img", "@keyframes", "animation:", ".png", ".gif"]) {
    assert.equal(html.includes(banned), false, `markup must not contain ${banned}`);
  }
});

console.log(`\n${pass}/${pass} PASS`);
