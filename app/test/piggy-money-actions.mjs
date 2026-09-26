// [A-485 Lane B → A-510 Stream A] `+ Piggy` 탄생 + 남은 돈 원시동작 계약 — 네트워크 0 · 체인 0.
//   node app/test/piggy-money-actions.mjs
//
// 이력: 이 파일은 A-485 에서 "집 + 모든 Piggy 의 합은 변하지 않는다"(CREATE/GIVE/BRING 보존식)를 단언했다.
// 그 보존식은 **Home 이 따로 돈을 가진다**는 옛 모델의 것이라 A-508 에서 역사가 됐다.
// 역사가 된 단언: CREATE 가 atHome 에서 차감 · GIVE(집→Piggy) · BRING_SOME/BRING_ALL(Piggy→집) ·
// insufficient_at_home · nothing_to_bring_home · position_*_not_liquid(bring 경로).
// 증거는 _private/ops/receipts/A485_t3_actions · A486_ui_runtime 에 그대로 남아 있다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PIGGY_BIRTH_ACTION, PIGGY_LOCATION, createPiggy, moneyActionKey, normalizePiggy,
  quantityToUnits, unitsToQuantity,
} from "../src/piggy-registry.js";

const SRC = readFileSync(new URL("../src/piggy-registry.js", import.meta.url), "utf8");
const TS = "2026-09-22T04:00:00Z";
const USDC = { symbol: "USDC", decimals: 6, sourceTimestamp: TS };
const piggy = (id, qty) =>
  normalizePiggy({ id, name: id, location: PIGGY_LOCATION.HOME, assets: qty ? [{ ...USDC, quantity: qty }] : [] }).piggy;

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. + Piggy = 탄생만 ────────────────────────────────────────────────────────
check("+Piggy creates exactly one Piggy and takes no money from anywhere", () => {
  const before = [piggy("honeybun", "200")];
  const r = createPiggy({ piggies: before, newPiggy: { id: "bebe", name: "Bebe" }, at: TS });
  assert.equal(r.ok, true);
  assert.equal(r.piggies.length, 2);
  assert.equal(r.piggies[0].assets[0].quantity, "200");       // 다른 Piggy 돈은 그대로
  assert.deepEqual(r.piggy.assets, []);
  assert.equal(r.receipt.action, PIGGY_BIRTH_ACTION);
  assert.equal(r.receipt.funded, false);
  assert.equal("atHome" in r, false);
});

check("a newborn Piggy is a known $0, not unknown", () => {
  const { piggy: born } = createPiggy({ newPiggy: { id: "bebe" }, at: TS });
  assert.deepEqual(born.valuation, { usd: "0", source: "birth_unfunded", at: TS });
  assert.equal(born.location, PIGGY_LOCATION.HOME);
});

check("a newborn Piggy carries no type or purpose", () => {
  const { piggy: born } = createPiggy({ newPiggy: { id: "bebe", type: "savings", purpose: "x" }, at: TS });
  assert.equal("type" in born, false);
  assert.equal("purpose" in born, false);
  assert.ok(born.historyKey.includes("bebe"));
});

check("birth refuses bad input and changes nothing", () => {
  const rows = [piggy("dup", "1")];
  assert.equal(createPiggy({ piggies: rows, newPiggy: {}, at: TS }).reason, "missing_new_piggy_id");
  assert.equal(createPiggy({ piggies: rows, newPiggy: { id: "dup" }, at: TS }).reason, "duplicate_piggy_id");
  assert.equal(createPiggy({ piggies: rows, newPiggy: { id: "x" } }).reason, "missing_time");
  const r = createPiggy({ piggies: rows, newPiggy: { id: "dup" }, at: TS });
  assert.equal(r.piggies, null);
  assert.equal(rows.length, 1);
});

check("birth never accepts secret-like fields", () => {
  const r = createPiggy({ newPiggy: { id: "x", privateKey: "0xabc" }, at: TS });
  assert.equal(r.ok, true);                          // 알 수 없는 입력 필드는 복사되지 않는다
  assert.equal(JSON.stringify(r.piggy).includes("0xabc"), false);
});

// ── 2. 남긴 원시동작 ──────────────────────────────────────────────────────────
check("exact integer units round-trip and refuse extra precision", () => {
  assert.equal(quantityToUnits("3.75", 6), 3750000n);
  assert.equal(unitsToQuantity(3750000n, 6), "3.75");
  assert.equal(unitsToQuantity(0n, 6), "0");
  assert.equal(quantityToUnits("1.0000001", 6), null);
  assert.equal(quantityToUnits("abc", 6), null);
  assert.equal(quantityToUnits("1", 37), null);
});

check("the idempotency key is stable for the same action", () => {
  const k = { action: PIGGY_BIRTH_ACTION, targetPiggyId: "bebe", amount: null, asset: null, at: TS };
  assert.equal(moneyActionKey(k), moneyActionKey({ ...k }));
  assert.notEqual(moneyActionKey(k), moneyActionKey({ ...k, targetPiggyId: "mochi" }));
});

// ── 3. Home 소유 돈 경로가 살아 있지 않다 ──────────────────────────────────────
check("no Home-owned give/bring accounting remains in the registry", () => {
  // 주석(이력) 줄을 뺀 **코드만** 본다.
  const code = SRC.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  for (const gone of ["applyMoneyAction", "MONEY_ACTION", "give_some", "bring_some_home", "bring_all_home", "insufficient_at_home", "atHome"]) {
    assert.equal(code.includes(gone), false, `${gone} must not be live code`);
  }
  for (const banned of ["writeContract", "sendTransaction", "fetch(", "eth_"]) {
    assert.equal(SRC.includes(banned), false, `registry must not contain ${banned}`);
  }
});

console.log(`\n${pass}/${pass} PASS`);
