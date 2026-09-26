// [A-492 Lane B] SEND_MONEY 계약 — 네트워크 0 · 체인 0.
//   node app/test/send-money.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADDRESS_STATUS,
  SEND_MONEY_ACTION,
  applySendResult,
  buildSendPreview,
  canSendTo,
  checkDestination,
  freeBalance,
  resolveAmount,
} from "../src/send-money.js";

const SRC = readFileSync(new URL("../src/send-money.js", import.meta.url), "utf8");
const TS = "2026-09-21T05:00:00Z";
const SELF = "0x00000000000000000000000000000000000000a1";
const OTHER_PIGGY = "0x00000000000000000000000000000000000000b2";
const HOME = "0x00000000000000000000000000000000000000c3";
const OUT = "0x4386A2237DF924453A14575238Ad0565eB39D4C6";
const usdc = (q) => ({ symbol: "USDC", quantity: q, decimals: 6, sourceTimestamp: TS, assetId: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" });
const piggy = (q, location = "home") => ({ id: "honeybun", name: "Honeybun", address: SELF, location, assets: q ? [usdc(q)] : [] });

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 주소 검사 — 조용히 고치지 않는다 ─────────────────────────────────────────
check("a malformed or empty address is refused, never repaired", () => {
  assert.equal(checkDestination("").status, ADDRESS_STATUS.EMPTY);
  assert.equal(checkDestination("0x123").status, ADDRESS_STATUS.MALFORMED);
  assert.equal(checkDestination("not an address").status, ADDRESS_STATUS.MALFORMED);
  assert.equal(checkDestination("0x123").address, null);
});

check("sending to itself is identified and blocked", () => {
  const c = checkDestination(SELF, { selfAddress: SELF });
  assert.equal(c.status, ADDRESS_STATUS.SELF);
  assert.equal(canSendTo(c), false);
});

// [A-510 Stream A] 이력: A-492 는 "Home 주소 = bring money home" 을 따로 분류했다.
// A-508 이후 Home 은 주소도 돈도 없다 — 특별 분류가 사라졌고, 옛 인자는 무시된다.
check("there is no Home-address special case — Home owns no address (A-508)", () => {
  assert.equal("HOME" in ADDRESS_STATUS, false);
  const c = checkDestination(HOME, { selfAddress: SELF, homeAddress: HOME });
  assert.equal(c.status, ADDRESS_STATUS.OK);
});

check("another of my own Piggies is flagged but still allowed", () => {
  const c = checkDestination(OTHER_PIGGY, { selfAddress: SELF, otherPiggyAddresses: [OTHER_PIGGY] });
  assert.equal(c.status, ADDRESS_STATUS.OWN_OTHER_PIGGY);
  assert.equal(canSendTo(c), true);
});

check("a plain external address is fine, case-insensitively matched", () => {
  const c = checkDestination(OUT.toLowerCase(), { selfAddress: SELF });
  assert.equal(c.status, ADDRESS_STATUS.OK);
  assert.equal(canSendTo(c), true);
});

// ── 2. 자유 잔액만 센다 — 포지션을 풀지 않는다 ──────────────────────────────────
check("money that is away or pending is not free to send", () => {
  for (const [loc, reason] of [["away", "funds_away_working"], ["pending", "funds_pending"]]) {
    const free = freeBalance(piggy("5", loc), "USDC");
    assert.equal(free.quantity, "0");
    assert.equal(free.heldButNotFree, "5");
    assert.equal(free.reason, reason);
  }
});

check("send all resolves to the exact free amount, never to locked money", () => {
  assert.equal(resolveAmount("all", freeBalance(piggy("3.75"), "USDC")).amount, "3.75");
  // 나가 있는 돈에 대고 all 을 눌러도 금액이 나오지 않는다
  const awayAll = resolveAmount("all", freeBalance(piggy("3.75", "away"), "USDC"));
  assert.equal(awayAll.amount, null);
  assert.equal(awayAll.reason, "funds_away_working");
});

check("an amount larger than the free balance is refused", () => {
  const free = freeBalance(piggy("2"), "USDC");
  assert.equal(resolveAmount("2.000001", free).reason, "exceeds_free_balance");
  assert.equal(resolveAmount("0", free).reason, "invalid_amount");
  assert.equal(resolveAmount("abc", free).reason, "invalid_amount");
});

check("the module never unwinds a protocol position", () => {
  for (const banned of ["withdraw(", "redeem(", "requestUnlock", "exitPosition", "unwind"]) {
    assert.equal(SRC.includes(banned), false, `send money must not call ${banned}`);
  }
});

// ── 3. 승인 직전 미리보기 — 숨기지 않는다 ───────────────────────────────────────
check("the preview shows network, exact asset, amount and destination", () => {
  const p = buildSendPreview({
    piggy: piggy("10"), symbol: "USDC", requested: "2.5", chain: "monad-mainnet",
    destinationCheck: checkDestination(OUT, { selfAddress: SELF }),
  });
  assert.equal(p.ready, true);
  assert.equal(p.action, SEND_MONEY_ACTION);
  assert.equal(p.chain, "monad-mainnet");
  assert.equal(p.asset, "USDC");
  assert.equal(p.amount, "2.5");
  assert.equal(p.destination, OUT);
});

check("an unknown fee is shown as unknown, not as zero", () => {
  const p = buildSendPreview({ piggy: piggy("10"), symbol: "USDC", requested: "1", chain: "monad-mainnet", destinationCheck: checkDestination(OUT) });
  assert.equal(p.feeEstimate, null);
  assert.notEqual(p.feeEstimate, "0");
});

check("money that stays behind is named in the preview", () => {
  const p = buildSendPreview({ piggy: piggy("5", "away"), symbol: "USDC", requested: "all", chain: "monad-mainnet", destinationCheck: checkDestination(OUT) });
  assert.equal(p.ready, false);
  assert.deepEqual(p.stays, { quantity: "5", reason: "funds_away_working" });
  assert.equal(p.blocked, "funds_away_working");
});

check("a bad destination blocks the preview with a reason", () => {
  const p = buildSendPreview({ piggy: piggy("5"), symbol: "USDC", requested: "1", chain: "monad-mainnet", destinationCheck: checkDestination("0x1") });
  assert.equal(p.ready, false);
  assert.match(p.blocked, /destination_/);
});

// ── 4. 결과 반영 — 성공했을 때만 ────────────────────────────────────────────────
check("a failed transaction changes nothing", () => {
  const before = piggy("5");
  const p = buildSendPreview({ piggy: before, symbol: "USDC", requested: "2", chain: "monad-mainnet", destinationCheck: checkDestination(OUT) });
  const out = applySendResult({ piggy: before, preview: p, txHash: "0xdead", status: "reverted", at: TS });
  assert.equal(out.ok, false);
  assert.equal(out.piggy, null);
  assert.equal(before.assets[0].quantity, "5"); // 입력도 그대로
});

check("a successful send reduces only that Piggy's balance", () => {
  const before = piggy("5");
  const p = buildSendPreview({ piggy: before, symbol: "USDC", requested: "2", chain: "monad-mainnet", destinationCheck: checkDestination(OUT) });
  const out = applySendResult({ piggy: before, preview: p, txHash: "0xabc", status: "success", at: TS });
  assert.equal(out.ok, true);
  assert.equal(out.piggy.assets[0].quantity, "3");
  // 정체성·주소·통제권은 그대로다 — 이건 SEND_PIGGY 가 아니다
  assert.equal(out.piggy.id, before.id);
  assert.equal(out.piggy.address, before.address);
  assert.equal(out.piggy.location, before.location);
});

check("sending all empties the asset row without deleting the Piggy", () => {
  const before = piggy("3.75");
  const p = buildSendPreview({ piggy: before, symbol: "USDC", requested: "all", chain: "monad-mainnet", destinationCheck: checkDestination(OUT) });
  const out = applySendResult({ piggy: before, preview: p, txHash: "0xabc", status: "success", at: TS });
  assert.deepEqual(out.piggy.assets, []);
  assert.equal(out.piggy.id, "honeybun");   // Piggy 는 남는다
});

check("the receipt records action, piggy, exact asset, amount, destination and tx", () => {
  const before = piggy("5");
  const p = buildSendPreview({ piggy: before, symbol: "USDC", requested: "2", chain: "monad-mainnet", destinationCheck: checkDestination(OUT) });
  const { receipt } = applySendResult({ piggy: before, preview: p, txHash: "0xabc", status: "success", at: TS });
  assert.equal(receipt.action, "send_money");
  assert.equal(receipt.piggyId, "honeybun");
  assert.equal(receipt.asset, "USDC");
  assert.equal(receipt.amount, "2");
  assert.equal(receipt.destination, OUT);
  assert.equal(receipt.piggyBefore, "5");
  assert.equal(receipt.piggyAfter, "3");
  assert.equal(receipt.txHash, "0xabc");
});

// ── 5. 이건 SEND_PIGGY 가 아니다 ────────────────────────────────────────────────
check("nothing here transfers Piggy ownership", () => {
  // `export` 는 JS 키워드라 단어로 막을 수 없다 — **지갑 export 개념**만 막는다.
  for (const banned of ["send_piggy", "SEND_PIGGY", "transferOwnership", "handoff", "exportWallet", "exportKey", "privateKey"]) {
    assert.equal(SRC.includes(banned), false, `send money must not mention ${banned}`);
  }
  // 소유권을 건드리는 필드를 결과에 넣지 않는다
  for (const banned of ["newOwner", "owner:", "control:"]) {
    assert.equal(SRC.includes(banned), false, `send money must not set ${banned}`);
  }
});

console.log(`\n${pass}/${pass} PASS`);
