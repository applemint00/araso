// [A-495 Lane H] node H — **Piggy 가 둘 이상일 때** 닫았다 다시 열어도
// 각자가 자기 상태·기록·행동 범위를 그대로 가지고 있는가.
//   node app/test/h-multi-piggy-reopen.mjs
// 네트워크 0 · 브라우저 0 · 디스크 쓰기 0 · tx 0.
//
// 방식(records-history-identity.mjs 와 같음): main.js 소스에서 **실제 함수 텍스트**를
// 잘라 node:vm 에서 돌린다. 손으로 만든 fixture 로직을 대신 쓰지 않는다.
// 저장/복구는 제품의 실제 경로(piggy-registry.js saveRegistry/loadRegistry +
// main.js secondPiggyRegistrySnapshot)를 그대로 통과한다.
//
// 이 테스트는 **아무 것도 새로 설계하지 않는다.** 이미 있는 코드가 node H 를
// 만족하는지만 잰다.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  PIGGY_LOCATION,
  createPiggy,
  loadRegistry,
  migrateSinglePiggy,
  normalizePiggy,
  projectRegistryTotals,
  saveRegistry,
} from "../src/piggy-registry.js";
import { loadMyPiggiesIndex } from "../src/piggy-index.js";
import { filterHistory, historyIdentityLabel, resolveHistorySelection } from "../src/history-filter.js";
import { homeMoneyPiggyRows } from "../src/home-paper.js";
import { freeBalance } from "../src/send-money.js";

const MAIN_SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const HOME_PAPER_SRC = readFileSync(new URL("../src/home-paper.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = MAIN_SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음: ${startMarker}`);
  const end = MAIN_SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN_SRC.slice(start, end);
}

const SCOPE_SRC = cut("function secondJourneyScope()", "// [A-475]");
const SNAPSHOT_SRC = cut("// [A-484 Lane C] Third Journey 임시 UI", "// [A-495 Lane B] 지금 실제로 쓸 수 있는 충전 어댑터");
const HISTORY_SRC = cut("// [A-485 Lane A] 지금 오른쪽 종이가 보여줄 기록 줄들", "function recordsCardListMarkup(");
// [A-552] historyIdentityName 이 A-551 부터 moneyPiggiesSnapshot()(색인 정확-id 병합)을 읽는다 — 그 실제 함수들도 같이 자른다.
const RESIDENTS_SRC = cut("// [A-522 B2a] MY PIGGIES 색인 = **제품 읽기 원천**", "// HOME 주민 카드");

for (const [name, src, needle] of [
  ["secondJourneyScope", SCOPE_SRC, "function secondJourneyScope("],
  ["secondPiggyRegistrySnapshot", SNAPSHOT_SRC, "function secondPiggyRegistrySnapshot("],
  ["selectedHistoryPiggyId", SNAPSHOT_SRC, "function selectedHistoryPiggyId("],
  ["historyRows", HISTORY_SRC, "function historyRows("],
  ["historyIdentityName", HISTORY_SRC, "function historyIdentityName("],
  ["indexedResidents", RESIDENTS_SRC, "function indexedResidents("],
  ["moneyPiggiesSnapshot", RESIDENTS_SRC, "function moneyPiggiesSnapshot("],
]) {
  if (!src.includes(needle)) throw new Error(`잘라낸 구간에 ${name} 없음 — 마커 확인 필요`);
}

// ── 진짜 localStorage 자리에 들어가는 최소 대역. **앱을 닫았다 열어도 이건 남는다.** ──
function persistentStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// 앱 "한 번 열기". state 는 매번 **새로** 만든다 — 메모리에 남은 것이 없다는 뜻이다.
// 남는 것은 storage 뿐이고, 그게 실제 재개방과 같은 조건이다.
function openApp(storage, { address, piggyName = "", receipts = [], historyPiggyId = null }) {
  const state = {
    address,
    piggyName,
    receipts,
    historyPiggyId,
    recordsDetailIndex: null,
  };
  const ctx = {
    state,
    console,
    safeLocalStorage: () => storage,
    loadRegistry,
    migrateSinglePiggy,
    normalizePiggy,
    loadMyPiggiesIndex,
    projectRegistryTotals,
    resolveHistorySelection,
    filterHistory,
    historyIdentityLabel,
    displayPiggyName: () => piggyName,
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SCOPE_SRC}\n${SNAPSHOT_SRC}\n${RESIDENTS_SRC}\n${HISTORY_SRC}\n` +
      `globalThis.__snapshot = secondPiggyRegistrySnapshot;` +
      `globalThis.__selected = selectedHistoryPiggyId;` +
      `globalThis.__historyRows = historyRows;` +
      `globalThis.__identityName = historyIdentityName;` +
      `globalThis.__scope = secondJourneyScope;`,
    ctx,
  );
  return {
    state,
    scope: ctx.__scope,
    snapshot: ctx.__snapshot,
    selected: ctx.__selected,
    historyRows: ctx.__historyRows,
    identityName: ctx.__identityName,
  };
}

let pass = 0, fail = 0;
function checkTrue(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label}`); fail += 1; }
}
function check(label, got, want) {
  checkTrue(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
}

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER_ADDRESS = "0xfeedfacefeedfacefeedfacefeedfacefeedface";
const TS = "2026-09-21T04:00:00Z";
const SCOPE = { accountId: ADDRESS, chainId: "monad-testnet" };
const asset = (symbol, quantity, decimals = 6) => ({
  symbol, quantity, decimals, assetId: `id-${symbol}`, sourceTimestamp: TS,
});

// 두 마리. 서로 다른 상태(home/away)·서로 다른 자산·서로 다른 이름.
const PIGGY_A = {
  id: "piggy-a", name: "Coin", address: ADDRESS, location: PIGGY_LOCATION.HOME,
  assets: [asset("USDC", "40")], createdAt: TS,
};
const PIGGY_B = {
  id: "piggy-b", name: "Bean", address: OTHER_ADDRESS, location: PIGGY_LOCATION.AWAY,
  assets: [asset("USDC", "7.5")], createdAt: TS,
};

const RECEIPTS = [
  { date: "SEP 21", statusLabel: "gave 40", piggyId: "piggy-a" },
  { date: "SEP 20", statusLabel: "went out", piggyId: "piggy-b" },
  { date: "SEP 19", statusLabel: "came back empty" },          // 주인 미상(옛 기록)
  { date: "SEP 18", statusLabel: "gave 7.5", piggyId: "piggy-b" },
];

// ── 0. 앱이 첫 실행. 저장소는 비어 있다 ──────────────────────────────────────────────
const storage = persistentStorage();
{
  const app = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS });
  check("첫 실행 scope 는 런타임 account+chain", app.scope(), SCOPE);
  const snap = app.snapshot();
  checkTrue("저장된 레지스트리가 없으면 다중 Piggy 를 지어내지 않는다", snap.piggies.length <= 1);
}

// ── 1. 두 마리를 **제품의 실제 저장 경로**로 넣는다 ───────────────────────────────────
{
  const saved = saveRegistry(storage, SCOPE, { piggies: [PIGGY_A, PIGGY_B] });
  check("saveRegistry 가 실제로 저장했다", saved, { saved: true, error: null });
  checkTrue("저장된 키는 account+chain 으로 범위가 잡혀 있다",
    [...storage._map.keys()].every((k) => k.includes(ADDRESS) && k.includes("monad-testnet")));
  checkTrue("저장된 값에 비밀값 냄새가 나는 필드 0",
    !/privateKey|prf|mnemonic|sessionKey/i.test(storage._map.get([...storage._map.keys()][0])));
}

// ── 2. **닫았다 다시 연다.** state 는 새로 만들어지고 storage 만 남는다 ────────────────
const reopened = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS });
{
  const snap = reopened.snapshot();
  check("재개방 후에도 두 마리가 그대로", snap.piggies.map((p) => p.id), ["piggy-a", "piggy-b"]);
  check("각자의 이름이 살아남았다", snap.piggies.map((p) => p.name), ["Coin", "Bean"]);
  check("각자의 위치가 살아남았다", snap.piggies.map((p) => p.location), ["home", "away"]);
  check("각자의 잔액 투영이 살아남았다",
    snap.piggies.map((p) => p.assets.map((a) => `${a.quantity} ${a.symbol}`).join()),
    ["40 USDC", "7.5 USDC"]);
  check("각 Piggy 의 이력 키는 자기 id 로 분리돼 있다",
    snap.piggies.map((p) => p.historyKey.endsWith(p.id)), [true, true]);
  checkTrue("평가가 없으면 총액을 지어내지 않는다",
    snap.totals.totalUsd === null && snap.totals.reason === "incomplete_valuation");
}

// ── 3. 선택은 **새 화면/Village 를 만들지 않는다** ──────────────────────────────────
{
  const rows = homeMoneyPiggyRows({
    totals: reopened.snapshot().totals,
    piggies: reopened.snapshot().piggies,
    selectedPiggyId: null,
  });
  check("두 마리는 같은 MY MONEY 종이 위 두 줄이다",
    rows.filter((r) => r.clickable).map((r) => r.id),
    ["homeMoneyPiggyRow--piggy-a", "homeMoneyPiggyRow--piggy-b"]);
  checkTrue("away 는 금액이 아니라 조용한 라벨",
    rows.some((r) => r.label === "Bean  away") && rows.every((r) => r.amount !== "away"));

  // 행을 누르는 제품 코드의 실제 분기 — 새 씬/라우트를 만들지 않는다.
  const branch = MAIN_SRC.slice(
    MAIN_SRC.indexOf('const moneyPiggyRow = event.target.closest'),
    MAIN_SRC.indexOf('if (event.target.closest("#homeRecordsButton"))'),
  );
  checkTrue("행 분기를 소스에서 찾았다", branch.includes("homeMoneyPiggyRow--"));
  checkTrue("행을 눌러도 씬 전환 0 (setScene 없음)", !branch.includes("setScene"));
  checkTrue("행을 눌러도 새 라우트/네비 0 (pushState/hash 없음)",
    !branch.includes("pushState") && !branch.includes("location.hash"));
  check("행이 바꾸는 것은 오른쪽 종이의 정체성 하나뿐",
    (branch.match(/state\.\w+ =/g) || []), ["state.historyPiggyId ="]);
  checkTrue("여는 것은 기존 records 카드", branch.includes("openRecordsCard()"));
  for (const word of ["Village", "village", "piggyList", "piggyDetailScene", "piggyPicker"]) {
    checkTrue(`다중 Piggy 를 위한 새 화면 이름 0: ${word}`,
      !HOME_PAPER_SRC.includes(word) && !SNAPSHOT_SRC.includes(word));
  }

  // 두 마리일 때 실제로 그리는 분기 — 같은 MY MONEY 종이 하나에 인라인으로만 붙는다.
  const renderBranch = MAIN_SRC.slice(
    MAIN_SRC.indexOf("if (snapshot.piggies.length > 1)"),
    MAIN_SRC.indexOf('return homeMoneyMarkup({\n    title: "MY MONEY",'),
  );
  checkTrue("두 마리 분기를 소스에서 찾았다", renderBranch.includes("homeMoneyPiggyRows("));
  checkTrue("두 마리여도 그리는 것은 기존 MY MONEY 종이", renderBranch.includes("homeMoneyMarkup({ title: \"MY MONEY\""));
  checkTrue("두 마리 분기가 별도 Piggy Detail 페이지로 가지 않는다",
    !renderBranch.includes("homePiggyDetailMarkup"));
  checkTrue("두 마리 분기에 씬 전환 0", !renderBranch.includes("setScene"));
}

// ── 4. 선택 상태도 재개방을 넘어 **정직하게** 처리된다 ────────────────────────────────
{
  const prefix = "homeMoneyPiggyRow--";
  const picked = `${prefix}piggy-b`.slice(prefix.length);
  const app = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS, historyPiggyId: picked });
  check("재개방 후 고른 Piggy 가 그대로 풀린다", app.selected(), "piggy-b");
  check("오른쪽 종이 머리는 **그 Piggy 의** 이름", app.identityName(), "Bean");
  check("B 를 고르면 B 기록만", app.historyRows().map((r) => r.receipt.statusLabel),
    ["went out", "gave 7.5"]);
  checkTrue("A 의 기록은 한 줄도 새지 않는다",
    app.historyRows().every((r) => r.receipt.piggyId === "piggy-b"));
  checkTrue("주인 미상 옛 기록은 특정 Piggy 목록에 섞이지 않는다",
    app.historyRows().every((r) => r.receipt.piggyId !== undefined));
  check("원래 인덱스를 잃지 않는다(상세 보기용)", app.historyRows().map((r) => r.index), [1, 3]);

  const appA = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS, historyPiggyId: "piggy-a" });
  check("A 를 고르면 A 기록만", appA.historyRows().map((r) => r.receipt.statusLabel), ["gave 40"]);
  check("A 의 머리 이름", appA.identityName(), "Coin");

  const appAll = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS });
  check("고른 게 없으면 전체 경로 그대로(회귀 0)", appAll.historyRows().length, RECEIPTS.length);

  // 없는 Piggy 를 들고 열면 **다른 Piggy 를 대신 보여주지 않는다**.
  const ghost = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS, historyPiggyId: "piggy-ghost" });
  check("사라진 Piggy 는 조용히 전체로 되돌아간다", ghost.historyRows().length, RECEIPTS.length);
  check("되돌아가면서 선택도 비워진다", ghost.state.historyPiggyId, null);
}

// ── 5. **다른 계정으로 열면 남의 Piggy 가 보이지 않는다** ──────────────────────────────
{
  const other = openApp(storage, { address: OTHER_ADDRESS, piggyName: "", receipts: [] });
  const snap = other.snapshot();
  checkTrue("다른 account 는 이 레지스트리를 읽지 못한다",
    !snap.piggies.some((p) => p.id === "piggy-a" || p.id === "piggy-b"));
  checkTrue("읽지 못했다고 잔액을 지어내지도 않는다",
    snap.piggies.every((p) => (p.assets || []).length === 0));
}

// ── 6. [A-510] 고른 Piggy 의 **돈 범위**가 자기 밖으로 나가지 않는다 ─────────────────────
// 이력: A-495 Lane H 는 여기서 give/bring 인라인 동작과 applyMoneyAction(GIVE/BRING_ALL)을 쟀다.
// 그 동작은 A-508 에서 제거됐다 — 대신 **각 Piggy 자기 돈** 경계와 +Piggy 무자금 탄생을 잰다.
{
  const [a, b] = reopened.snapshot().piggies;
  checkTrue("MY MONEY 에 Home 소유 `at home` 행이 없다",
    !homeMoneyPiggyRows({ totals: reopened.snapshot().totals, piggies: [a, b] }).some((r) => r.label === "at home"));
  check("home 인 A 는 자기 돈을 자유 잔액으로 쓴다", freeBalance(a, "USDC").quantity, "40");
  check("away 인 B 의 돈은 즉시 쓸 수 있는 돈이 아니다", freeBalance(b, "USDC").quantity, "0");

  const born = createPiggy({ piggies: [a, b], newPiggy: { id: "piggy-c", name: "Bebe" }, at: TS });
  checkTrue("+Piggy 는 성공한다", born.ok === true);
  check("A 는 한 단위도 바뀌지 않는다", born.piggies.find((p) => p.id === "piggy-a").assets[0].quantity, "40");
  check("B 도 그대로", born.piggies.find((p) => p.id === "piggy-b").assets[0].quantity, "7.5");
  check("새 Piggy 는 알려진 $0", born.piggy.valuation.usd, "0");
}

// ── 7. 탄생을 저장하고 **또 한 번 닫았다 연다** ──────────────────────────────────
{
  const [a, b] = reopened.snapshot().piggies;
  const born = createPiggy({ piggies: [a, b], newPiggy: { id: "piggy-c", name: "Bebe" }, at: TS });
  const saved = saveRegistry(storage, SCOPE, { piggies: born.piggies });
  check("탄생한 투영이 실제 경로로 저장된다", saved, { saved: true, error: null });

  const again = openApp(storage, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS });
  const snap = again.snapshot();
  check("두 번째 재개방에서 세 마리", snap.piggies.map((p) => p.id), ["piggy-a", "piggy-b", "piggy-c"]);
  check("A 의 잔액이 살아남았다", snap.piggies.find((p) => p.id === "piggy-a").assets[0].quantity, "40");
  check("B 의 위치도 그대로", snap.piggies.find((p) => p.id === "piggy-b").location, "away");
  check("$0 Piggy 도 재개방 후 보인다(알려진 0)", snap.piggies.find((p) => p.id === "piggy-c").valuation?.usd, "0");
  const row = homeMoneyPiggyRows({ totals: snap.totals, piggies: snap.piggies }).find((r) => r.id === "homeMoneyPiggyRow--piggy-c");
  check("$0 Piggy 행은 $0 으로 읽힌다", row?.amount, "$0");
}

// ── 8. 저장값이 깨져도 **잔액을 지어내지 않는다** ────────────────────────────────────
{
  const broken = persistentStorage();
  saveRegistry(broken, SCOPE, { piggies: [PIGGY_A, PIGGY_B] });
  const key = [...broken._map.keys()][0];
  broken._map.set(key, "{not json");
  const app = openApp(broken, { address: ADDRESS, piggyName: "Coin", receipts: RECEIPTS });
  const snap = app.snapshot();
  checkTrue("손상된 레지스트리는 두 마리인 척하지 않는다", snap.piggies.length <= 1);
  checkTrue("손상 후에도 없는 잔액을 만들지 않는다",
    snap.piggies.every((p) => (p.assets || []).length === 0));
  const direct = loadRegistry(broken, SCOPE);
  check("이유를 정직하게 말한다", direct.error, "corrupt");
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
if (fail > 0) process.exit(1);
