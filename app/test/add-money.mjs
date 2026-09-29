// [A-493 Lane A] Add money 계약 — 네트워크 0 · 체인 0.
//   node app/test/add-money.mjs
// 핵심: **레일이 없으면 열리지 않는다.** 그리고 **가스 후원을 Add money 라고 부르지 않는다.**
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADD_MONEY_RECEIPT_FIELDS,
  ADD_MONEY_STATUS,
  FUNDING_KIND,
  NOT_ADD_MONEY,
  REGISTERED_RAILS,
  classifyFundingPath,
  isAddMoneyAvailable,
  requestAddMoney,
} from "../src/add-money.js";

const SRC = readFileSync(new URL("../src/add-money.js", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../src/home-paper.js", import.meta.url), "utf8");
const good = { asset: "USDC", amount: "10", chain: "monad-testnet", source: "external_wallet", destination: "0x4386A2237DF924453A14575238Ad0565eB39D4C6" };

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 지금은 레일이 없다 ───────────────────────────────────────────────────────
check("no funding rail is registered today", () => {
  assert.deepEqual(REGISTERED_RAILS, []);
  assert.equal(isAddMoneyAvailable(), false);
});

check("a perfectly valid request still fails closed because there is no rail", () => {
  const out = requestAddMoney(good);
  assert.equal(out.ok, false);
  assert.equal(out.status, ADD_MONEY_STATUS.NO_RAIL);
  assert.equal(out.reason, "no_user_funding_rail_registered");
  assert.equal(out.rail, null);
  // 요청이 유효했다는 사실은 남긴다 — "요청이 이상해서" 와 구분되게
  assert.deepEqual(out.request.asset, "USDC");
});

// ── 2. 모르면 열리지 않는다 ─────────────────────────────────────────────────────
check("an unknown asset, amount, chain, source or destination is refused", () => {
  for (const [field, over] of [
    ["asset", { asset: "" }], ["amount", { amount: "0" }], ["amount", { amount: "abc" }],
    ["chain", { chain: "" }], ["source", { source: "" }], ["destination", { destination: "0x123" }],
  ]) {
    const out = requestAddMoney({ ...good, ...over });
    assert.equal(out.status, ADD_MONEY_STATUS.INVALID, `${field} should be invalid`);
    assert.match(out.reason, new RegExp(field));
  }
});

check("an invalid request is distinguished from a missing rail", () => {
  assert.equal(requestAddMoney({ ...good, amount: "0" }).status, ADD_MONEY_STATUS.INVALID);
  assert.equal(requestAddMoney(good).status, ADD_MONEY_STATUS.NO_RAIL);
});

// ── 3. 가스 후원은 Add money 가 아니다 ──────────────────────────────────────────
check("the gas grant is explicitly classified as sponsorship, not Add money", () => {
  const grant = classifyFundingPath("api-grant");
  assert.equal(grant.isAddMoney, false);
  assert.equal(grant.kind, FUNDING_KIND.GAS_SPONSORSHIP);
  assert.match(grant.reason, /사용자 돈이 아니다/);
  assert.equal(classifyFundingPath("local-relayer-grant").isAddMoney, false);
});

check("shMON deposit is named as the opposite direction, not a funding rail", () => {
  const dep = classifyFundingPath("shmon-deposit");
  assert.equal(dep.isAddMoney, false);
  assert.match(dep.reason, /방향이 반대/);
});

check("the owner-prefunded harness is not a code path", () => {
  assert.equal(classifyFundingPath("owner-prefunded-harness").isAddMoney, false);
});

check("an unknown path is not silently treated as Add money", () => {
  const out = classifyFundingPath("something-new");
  assert.equal(out.isAddMoney, false);
  assert.equal(out.reason, "unknown_path");
});

check("every non-Add-money path is listed with a reason", () => {
  assert.ok(NOT_ADD_MONEY.length >= 4);
  for (const row of NOT_ADD_MONEY) {
    assert.ok(row.id && row.kind && row.reason.length > 10);
  }
});

// ── 4. 열리려면 진짜 레일이어야 한다 ────────────────────────────────────────────
check("a sponsorship rail can never satisfy Add money, even if enabled", () => {
  const fake = [{ id: "grant", kind: FUNDING_KIND.GAS_SPONSORSHIP, enabled: true }];
  assert.equal(isAddMoneyAvailable({ rails: fake }), false);
  assert.equal(requestAddMoney(good, { rails: fake }).status, ADD_MONEY_STATUS.NO_RAIL);
});

check("a disabled user-funds rail does not open it either", () => {
  const off = [{ id: "someday", kind: FUNDING_KIND.USER_FUNDS, enabled: false }];
  assert.equal(isAddMoneyAvailable({ rails: off }), false);
});

check("only an enabled user-funds rail opens the request", () => {
  const on = [{ id: "someday", kind: FUNDING_KIND.USER_FUNDS, enabled: true }];
  const out = requestAddMoney(good, { rails: on });
  assert.equal(out.ok, true);
  assert.equal(out.status, ADD_MONEY_STATUS.READY);
  assert.equal(out.rail, "someday");
});

// ── 5. 가짜 버튼을 만들지 않았다 ────────────────────────────────────────────────
// [A-646 update] A-493 의 "Add money 컨트롤 0" 은 A-645 NEXT_APP_INPUT S1(입구 허용)·S9(레일 0 = 정직한
// unavailable)로 대체됐다. 남는 계약: 입구는 **하나**, 게이트 뒤에서만 그리고, 레일은 여전히 0 이며,
// 이 입구가 가짜 방법/레일을 켜지 않는다.
check("the one Add money entry is gated and still opens no fake rail", () => {
  assert.equal((HOME.match(/id="homeAddMoney"/g) || []).length, 1, "exactly one entry markup");
  assert.match(MAIN, /const addMoneyEntry = addMoneyEntryAllowed\(\) \? addMoneyEntryMarkup\(\) : "";/);
  assert.match(MAIN, /function addMoneyEntryAllowed\(\) \{\n\s+return state\.secondJourneyCompletedOnce === true && state\.scene === "sendstay" && state\.homePaperMode === "money";/);
  assert.match(MAIN, /const FUNDING_ADAPTERS = \[\];/);
  assert.equal(REGISTERED_RAILS.length, 0);
  assert.equal(isAddMoneyAvailable(), false);
});

check("the module moves no money and assumes no stable price", () => {
  for (const banned of ["writeContract", "sendTransaction", "fetch("]) {
    assert.equal(SRC.includes(banned), false, `add-money must not contain ${banned}`);
  }
  // 스테이블을 $1 로 치는 코드가 없어야 한다 — 단어가 아니라 **환산 로직**을 본다.
  assert.equal(/usd\s*[:=]\s*(amount|1\b)/i.test(SRC), false, "must not convert amount to USD 1:1");
  assert.equal(/toFixed\(2\)/.test(SRC), false, "this layer does not produce USD figures");
});

check("the receipt shape is defined ahead of the rail", () => {
  for (const f of ["railId", "asset", "amount", "chain", "source", "destination", "txHash", "status", "at"]) {
    assert.ok(ADD_MONEY_RECEIPT_FIELDS.includes(f), `receipt must define ${f}`);
  }
});

console.log(`\n${pass}/${pass} PASS`);
