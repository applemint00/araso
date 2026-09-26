// [A-484 Lane B] 다중 Piggy 레지스트리 계약 — 네트워크 0 · 브라우저 0.
//   node app/test/piggy-registry.mjs
import assert from "node:assert/strict";
import {
  PIGGY_LOCATION,
  clearRegistry,
  createRegistry,
  loadRegistry,
  migrateSinglePiggy,
  normalizePiggy,
  piggyRegistryKey,
  projectRegistryTotals,
  saveRegistry,
} from "../src/piggy-registry.js";

// 최소 localStorage 대역. 손상/폭발 상황도 흉내 낼 수 있게 둔다.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}
const A = { accountId: "0x00000000000000000000000000000000000000a1", chainId: "monad-mainnet" };
const B = { accountId: "0x00000000000000000000000000000000000000b2", chainId: "monad-mainnet" };
const A_TESTNET = { accountId: A.accountId, chainId: "monad-testnet" };
const TS = "2026-09-21T03:00:00Z";
const asset = (symbol, quantity, decimals) => ({ symbol, quantity, decimals, sourceTimestamp: TS, assetId: `id-${symbol}` });

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. account/chain 격리 ────────────────────────────────────────────────────────
check("registry keys are scoped by account and chain", () => {
  assert.notEqual(piggyRegistryKey(A), piggyRegistryKey(B));
  assert.notEqual(piggyRegistryKey(A), piggyRegistryKey(A_TESTNET));
});

check("another account cannot read this account's registry", () => {
  const s = memoryStorage();
  saveRegistry(s, A, { piggies: [{ id: "p1", name: "Honeybun", location: PIGGY_LOCATION.HOME, assets: [] }] });
  const other = loadRegistry(s, B);
  assert.equal(other.error, "absent");
  assert.deepEqual(other.registry.piggies, []);
});

check("same account on another chain is a different registry", () => {
  const s = memoryStorage();
  saveRegistry(s, A, { piggies: [{ id: "p1", location: PIGGY_LOCATION.HOME }] });
  assert.deepEqual(loadRegistry(s, A_TESTNET).registry.piggies, []);
});

check("a registry written for another scope is rejected, not adopted", () => {
  const s = memoryStorage();
  // A 의 키 자리에 B 의 내용이 들어가 있는 상황(손상/이주 사고)
  s.setItem(piggyRegistryKey(A), JSON.stringify({ version: 1, accountId: B.accountId, chainId: B.chainId, piggies: [{ id: "x" }] }));
  const out = loadRegistry(s, A);
  assert.equal(out.error, "account_mismatch");
  assert.deepEqual(out.registry.piggies, []);
});

// ── 2. 두 Piggy 가 서로를 덮어쓰지 않는다 ─────────────────────────────────────────
check("two piggies keep separate balances and history keys", () => {
  const s = memoryStorage();
  saveRegistry(s, A, {
    piggies: [
      { id: "honeybun", name: "Honeybun", location: PIGGY_LOCATION.HOME, assets: [asset("USDC", "200", 6)] },
      { id: "mochi", name: "Mochi", location: PIGGY_LOCATION.AWAY, assets: [asset("USDC", "80", 6)] },
    ],
  });
  const { registry } = loadRegistry(s, A);
  assert.equal(registry.piggies.length, 2);
  const [h, m] = registry.piggies;
  assert.equal(h.assets[0].quantity, "200");
  assert.equal(m.assets[0].quantity, "80");
  assert.notEqual(h.historyKey, m.historyKey);
  assert.equal(m.location, PIGGY_LOCATION.AWAY);
});

check("duplicate ids do not overwrite the first record", () => {
  const s = memoryStorage();
  saveRegistry(s, A, {
    piggies: [
      { id: "dup", name: "First", assets: [asset("USDC", "10", 6)] },
      { id: "dup", name: "Second", assets: [asset("USDC", "999", 6)] },
    ],
  });
  const { registry } = loadRegistry(s, A);
  assert.equal(registry.piggies.length, 1);
  assert.equal(registry.piggies[0].name, "First");
  assert.equal(registry.piggies[0].assets[0].quantity, "10");
});

// ── 3. 손상 저장소 — 죽지도, 잔액을 지어내지도 않는다 ─────────────────────────────
check("corrupt JSON fails closed with an empty registry", () => {
  const s = memoryStorage();
  s.setItem(piggyRegistryKey(A), "{not json at all");
  const out = loadRegistry(s, A);
  assert.equal(out.error, "corrupt");
  assert.deepEqual(out.registry.piggies, []);
});

check("unknown schema version is rejected, not guessed", () => {
  const s = memoryStorage();
  s.setItem(piggyRegistryKey(A), JSON.stringify({ version: 99, accountId: A.accountId, chainId: A.chainId, piggies: [{ id: "p" }] }));
  const out = loadRegistry(s, A);
  assert.equal(out.error, "version_mismatch");
  assert.deepEqual(out.registry.piggies, []);
});

check("a throwing storage does not crash the caller", () => {
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(loadRegistry(boom, A).error, "storage_read_failed");
  assert.equal(saveRegistry(boom, A, { piggies: [] }).error, "storage_write_failed");
  assert.equal(clearRegistry(boom, A).cleared, false);
});

check("one bad row does not destroy the good rows", () => {
  const s = memoryStorage();
  s.setItem(piggyRegistryKey(A), JSON.stringify({
    version: 1, accountId: A.accountId, chainId: A.chainId,
    piggies: [{ id: "good", assets: [] }, { nope: true }, { id: "", assets: [] }],
  }));
  const { registry, error } = loadRegistry(s, A);
  assert.equal(error, null);
  assert.deepEqual(registry.piggies.map((p) => p.id), ["good"]);
});

// ── 4. 한 마리 시절 이주는 결정적이다 ────────────────────────────────────────────
check("legacy single Piggy migrates deterministically", () => {
  const a = migrateSinglePiggy({ address: "0x4386A2237DF924453A14575238Ad0565eB39D4C6", name: "Chog" });
  const b = migrateSinglePiggy({ address: "0x4386a2237df924453a14575238ad0565eb39d4c6", name: "Chog" });
  assert.equal(a.error, null);
  assert.equal(a.piggy.id, b.piggy.id); // 대소문자가 달라도 같은 id
  assert.equal(a.piggy.name, "Chog");
  assert.equal(a.piggy.location, PIGGY_LOCATION.UNKNOWN); // 위치를 추측하지 않는다
  assert.deepEqual(a.piggy.assets, []);                   // 잔액을 지어내지 않는다
});

check("migration without a usable address yields nothing, not a fake piggy", () => {
  assert.equal(migrateSinglePiggy({ address: "" }).piggy, null);
  assert.equal(migrateSinglePiggy({ address: "not-an-address" }).error, "no_legacy_identity");
});

// ── 5. 모르는 평가는 모르는 채로 — 스테이블을 $1 로 치지 않는다 ──────────────────
check("valuation without source or timestamp is dropped", () => {
  const { piggy } = normalizePiggy({ id: "p", valuation: { usd: "200" } });
  assert.equal(piggy.valuation, null);
  const { piggy: p2 } = normalizePiggy({ id: "p", valuation: { usd: "200", source: "x", at: TS } });
  assert.deepEqual(p2.valuation, { usd: "200", source: "x", at: TS });
});

check("an asset without a read timestamp is not projected", () => {
  const { piggy } = normalizePiggy({ id: "p", assets: [{ symbol: "USDC", quantity: "100", decimals: 6 }] });
  assert.deepEqual(piggy.assets, []);
});

check("no total is produced while any piggy lacks valuation", () => {
  const totals = projectRegistryTotals({
    piggies: [
      { id: "a", valuation: { usd: "200", source: "s", at: TS } },
      { id: "b", valuation: null },
    ],
  });
  assert.equal(totals.totalUsd, null);
  assert.equal(totals.reason, "incomplete_valuation");
});

check("a total appears only when every piggy has a sourced valuation", () => {
  const totals = projectRegistryTotals({
    piggies: [
      { id: "a", valuation: { usd: "200", source: "s", at: TS } },
      { id: "b", valuation: { usd: "80.5", source: "s", at: TS } },
    ],
  });
  assert.equal(totals.totalUsd, "280.50");
  assert.deepEqual(totals.valuationSources, ["s"]);
  assert.equal(totals.valuationOldestAt, TS);
});

check("an empty registry has no total and says why", () => {
  const totals = projectRegistryTotals(createRegistry(A));
  assert.equal(totals.totalUsd, null);
  assert.equal(totals.reason, "no_piggies");
});

// ── 6. 비밀값은 저장 자체가 거부된다 ─────────────────────────────────────────────
check("secret-like fields are refused, at any depth", () => {
  for (const bad of [
    { id: "p", privateKey: "0xdead" },
    { id: "p", prfOutput: "abc" },
    { id: "p", meta: { sessionKey: "s" } },
    { id: "p", meta: { deep: { mnemonic: "word word" } } },
    { id: "p", passkeySecret: "x" },
  ]) {
    const { piggy, error } = normalizePiggy(bad);
    assert.equal(piggy, null, `expected refusal for ${JSON.stringify(bad)}`);
    assert.match(error, /^secret_like_field:/);
  }
});

check("saving refuses the whole registry if any row smells like a secret", () => {
  const s = memoryStorage();
  const res = saveRegistry(s, A, { piggies: [{ id: "ok" }, { id: "bad", seed: "x" }] });
  assert.equal(res.saved, false);
  assert.match(res.error, /^secret_like_field:/);
  assert.equal(s.getItem(piggyRegistryKey(A)), null); // 부분 저장도 없다
});

check("what is written to storage contains no secret-like key", () => {
  const s = memoryStorage();
  saveRegistry(s, A, { piggies: [{ id: "p", name: "Honeybun", address: "0x4386A2237DF924453A14575238Ad0565eB39D4C6", assets: [asset("USDC", "1", 6)] }] });
  const raw = s.getItem(piggyRegistryKey(A)).toLowerCase();
  for (const word of ["privatekey", "prf", "secret", "mnemonic", "seed", "sessionkey"]) {
    assert.equal(raw.includes(word), false, `serialized registry must not contain "${word}"`);
  }
});

// ── 7. 이 레지스트리는 진실이 아니라 투영이다 ────────────────────────────────────
check("location defaults to unknown rather than pretending home", () => {
  const { piggy } = normalizePiggy({ id: "p" });
  assert.equal(piggy.location, PIGGY_LOCATION.UNKNOWN);
  const { piggy: bogus } = normalizePiggy({ id: "p", location: "somewhere" });
  assert.equal(bogus.location, PIGGY_LOCATION.UNKNOWN);
});

check("an unusable address is dropped instead of stored wrong", () => {
  const { piggy } = normalizePiggy({ id: "p", address: "0x123" });
  assert.equal(piggy.address, null);
});

console.log(`\n${pass}/${pass} PASS`);
