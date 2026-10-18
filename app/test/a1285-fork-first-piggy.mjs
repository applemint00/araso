// A-1285 [Fork Money · the first Piggy that came 1st testnet → 2nd fork stands in Money] — node only, network 0, keys 0, tx 0.
//   node app/test/a1285-fork-first-piggy.mjs
// Part U: node:vm over the ACTUAL main.js a1285SeatFirstPiggyOnFork (real piggy-registry.js / piggy-index.js / funding-reconcile.js,
//         an in-memory localStorage, a stub read-only client): what it seats, when it seats nothing.
// Part S: the security line (99d:303) — no birth mark / issuance right reaches the fork: + Piggy's origin check still refuses
//         origin_index_missing, also after the fork index is removed and Money opens again.
// Part P: source pins — wired only on the fork (A977_FORK), the A-897 mainnet promotion functions and the Gift send code are
//         byte-identical to ea9f22a.
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PI from "../src/piggy-index.js";
import * as PR from "../src/piggy-registry.js";
import * as FR from "../src/funding-reconcile.js";
import { moneyTabView } from "../src/money-tab.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`PASS  ${label}`); } catch (e) { fail += 1; console.log(`FAIL  ${label}\n      ${String(e?.message || e).split("\n")[0]}`); }
}
const cutFn = (src, name) => {
  const i = src.indexOf(`function ${name}(`); if (i < 0) return null;
  const start = src.lastIndexOf("\n", i) + 1;
  let d = 0, st = false;
  const body = src.indexOf(") {\n", i); // the body brace (a destructured parameter has braces too)
  for (let j = body + 2; j < src.length; j += 1) {
    if (src[j] === "{") { d += 1; st = true; } else if (src[j] === "}") { d -= 1; if (st && d === 0) return src.slice(start, j + 1); }
  }
  return null;
};

const ADDR = "0xFffAB9EdbeB5A2640D822e57A4Cf28883403b762";
const OTHER = "0x1111111111111111111111111111111111111111";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const LOCATOR = { credentialId: "lkHeOmsGfPS7g7Q9HLkY1l_cM62rjI0KY7w1ZN0mFZ8", transports: ["internal"], prfSalt: "896d46ac4ac191885c46137439db7bb52fb05cff3ecd34af7cdae0a1e0c00db9" };
const FIRST_ROW = { id: `legacy-${ADDR.toLowerCase()}`, name: "Pgr", address: ADDR, locator: LOCATOR, createdAt: "2026-10-15T07:43:52.999Z", lastControlProofAt: "2026-10-15T07:43:52.999Z", provenance: "birth" };
const FORK = { chainId: "monad-fork", accountId: ADDR };

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}
function testnetIndex(rows = [FIRST_ROW]) {
  return { [PI.myPiggiesIndexKey("monad-testnet")]: JSON.stringify({ version: 1, chainId: "monad-testnet", issuedThrough: 0, piggies: rows }) };
}
function client({ raw = 100_000_000n, broken = false } = {}) {
  return {
    readContract: async ({ address, functionName, args }) => {
      if (broken) throw new Error("rpc down");
      assert.equal(functionName, "balanceOf"); assert.equal(address, USDC); assert.equal(String(args[0]).toLowerCase(), ADDR.toLowerCase());
      return raw;
    },
    getBlockNumber: async () => 110874123n,
  };
}
function world({ scope = "monad-fork", address = ADDR, secondDone = true, storage = memStorage(testnetIndex()) } = {}) {
  const ctx = vm.createContext({
    state: { address, piggyName: "", secondJourneyCompletedOnce: secondDone },
    RUNTIME_CHAIN_SCOPE: scope,
    CHAIN_PROFILE: { usdc: { symbol: "USDC", address: USDC, decimals: 6 } },
    safeLocalStorage: () => storage,
    loadRegistry: PR.loadRegistry, saveRegistry: PR.saveRegistry, normalizePiggy: PR.normalizePiggy,
    loadMyPiggiesIndex: PI.loadMyPiggiesIndex, readErc20Balance: FR.readErc20Balance, measuredHoldingRow: FR.measuredHoldingRow,
  });
  vm.runInContext(`${cutFn(MAIN, "secondJourneyScope")}\nconst A1285_FIRST_PIGGY_SOURCE_SCOPE = "monad-testnet";\n${cutFn(MAIN, "a1285SeatFirstPiggyOnFork")}\nglobalThis.seat = a1285SeatFirstPiggyOnFork;`, ctx);
  return { storage, seat: (o = {}) => ctx.seat({ storage, now: () => "2026-10-15T08:00:00.000Z", ...o }) };
}
const forkRows = (storage) => PR.loadRegistry(storage, FORK).registry.piggies;

// ═══ Part U ═══
await check("U1 fork · Journey 2 done · empty fork registry · this device's first Piggy on testnet → one identity row at home with the measured fork USDC, valuation unknown", async () => {
  const w = world();
  const r = await w.seat({ client: client() });
  assert.equal(r.seated, true, JSON.stringify(r));
  const rows = forkRows(w.storage);
  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.deepEqual([p.id, p.name, p.address, p.location], [FIRST_ROW.id, "Pgr", ADDR, "home"]);
  assert.deepEqual(p.locator, LOCATOR, "the passkey locator (credential id · PRF salt, not secret) comes along, so the Gift signer can ask Face ID");
  assert.equal(p.valuation, null, "no $ value invented (no stable = $1 assumption)");
  assert.equal(p.assets.length, 1);
  assert.deepEqual([p.assets[0].symbol, p.assets[0].quantity, p.assets[0].assetId, p.assets[0].source, p.assets[0].blockNumber], ["USDC", "100", USDC, "measured", "110874123"]);
  for (const k of ["provenance", "promotedAt", "sequence", "issuedThrough"]) assert.equal(p[k] ?? null, null, `${k} not carried`);
});
await check("U2 the Money tab model reads it: Gift is pickable, the name is the Piggy's name (not legacy-0x…), the screen shows the USDC as $ 1:1 while the stored valuation stays null", async () => {
  const w = world(); await w.seat({ client: client() });
  const rows = forkRows(w.storage);
  assert.equal(rows[0].valuation ?? null, null, "ledger: no valuation written");
  const v = moneyTabView({ piggies: rows, canAct: true });
  assert.equal(v.canGift, true);
  assert.equal(v.piggies[0].name, "Pgr");
  assert.equal(v.assets, "100 USDC");
  assert.equal(v.piggies[0].amount, "$100.00", "screen = dollars, USDC 1:1 (README:202 · Owner 10-16)");
});
await check("U2b before the seat (= RED): the legacy migration row is unknown, so Gift is off and the name is the id", () => {
  const { piggy } = PR.migrateSinglePiggy({ address: ADDR, name: "" });
  const v = moneyTabView({ piggies: [piggy], canAct: true });
  assert.deepEqual([v.canGift, v.piggies[0].name], [false, "Piggy"]);
});
await check("U3 balance unreadable → the row still stands at home with no assets (the Gift amount meets the existing refusal); nothing invented", async () => {
  const w = world(); const r = await w.seat({ client: client({ broken: true }) });
  assert.equal(r.seated, true);
  const p = forkRows(w.storage)[0];
  assert.deepEqual([p.location, p.assets.length, p.valuation], ["home", 0, null]);
});
await check("U4 seats nothing: testnet scope · Journey 2 not done · no account · fork registry already has a row · registry unreadable", async () => {
  assert.equal((await world({ scope: "monad-testnet" }).seat({ client: client() })).reason, "not_here");
  assert.equal((await world({ secondDone: false }).seat({ client: client() })).reason, "not_here");
  assert.equal((await world({ address: "" }).seat({ client: client() })).reason, "not_here");
  const has = memStorage(testnetIndex());
  PR.saveRegistry(has, FORK, { version: 1, accountId: ADDR, chainId: "monad-fork", piggies: [{ id: "born-on-fork", name: "Mochi", address: OTHER, location: "home", assets: [] }] });
  const key = PR.piggyRegistryKey(FORK); const before = has.getItem(key);
  assert.equal((await world({ storage: has }).seat({ client: client() })).reason, "registry_has_rows");
  assert.equal(has.getItem(key), before, "an existing fork registry is never rewritten");
  const bad = memStorage({ ...testnetIndex(), [key]: "{not json" });
  assert.equal((await world({ storage: bad }).seat({ client: client() })).reason, "registry_unreadable");
});
await check("U5 only THIS device's first Piggy: no testnet row · a row for another address · a numbered (+Piggy) row → nothing seated", async () => {
  assert.equal((await world({ storage: memStorage() }).seat({ client: client() })).reason, "no_first_piggy_row");
  assert.equal((await world({ storage: memStorage(testnetIndex([{ ...FIRST_ROW, id: "x", address: OTHER }])) }).seat({ client: client() })).reason, "no_first_piggy_row");
  assert.equal((await world({ storage: memStorage(testnetIndex([{ ...FIRST_ROW, sequence: 2 }])) }).seat({ client: client() })).reason, "no_first_piggy_row");
});
await check("U6 once: a second Money open finds the row and writes nothing", async () => {
  const w = world(); await w.seat({ client: client() });
  const k = PR.piggyRegistryKey(FORK); const v1 = w.storage.getItem(k);
  assert.equal((await w.seat({ client: client({ raw: 5n }) })).reason, "registry_has_rows");
  assert.equal(w.storage.getItem(k), v1);
});

// ═══ Part S ═══ (99d:303: index removed → origin_index_missing must stay the + Piggy answer on the fork)
await check("S1 after seating, the fork Piggy index is still absent and + Piggy's origin check refuses origin_index_missing", async () => {
  const w = world(); await w.seat({ client: client() });
  assert.equal(w.storage.getItem(PI.myPiggiesIndexKey("monad-fork")), null, "no fork index written");
  assert.equal(PI.checkOriginDeviceIndex(w.storage, "monad-fork", { credentialId: LOCATOR.credentialId }).reason, "origin_index_missing");
  assert.equal(PI.checkOriginDeviceIndex(w.storage, "monad-testnet", { credentialId: LOCATOR.credentialId }).ok, true, "the testnet origin (the real birth mark) is untouched");
});
await check("S2 fork index removed (and the fork registry too) → Money opens again → seated again, + Piggy still origin_index_missing (no issuance right regained)", async () => {
  const w = world(); await w.seat({ client: client() });
  w.storage.removeItem(PI.myPiggiesIndexKey("monad-fork"));
  w.storage.removeItem(PR.piggyRegistryKey(FORK));
  assert.equal((await w.seat({ client: client() })).seated, true);
  assert.equal(PI.checkOriginDeviceIndex(w.storage, "monad-fork", { credentialId: LOCATOR.credentialId }).reason, "origin_index_missing");
  assert.deepEqual([...w.storage._m.keys()].filter((k) => /monad-fork/.test(k)), [PR.piggyRegistryKey(FORK)], "only the fork registry key is written");
});

// ═══ Part P ═══
const BASE = (() => { try { return execFileSync("git", ["show", "ea9f22a:app/src/main.js"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } })();
await check("P1 wired only on the fork: the Money-open wrapper sits under if (A977_FORK) and reads through the A-977 fork client; no promotion, no index write", () => {
  const i = MAIN.indexOf("a905OpenMoneyTab = function a905OpenMoneyTabA1285(");
  assert.ok(i > 0);
  assert.match(MAIN.slice(MAIN.lastIndexOf("if (A977_FORK) {", i), i), /const a1285PrevOpenMoney = a905OpenMoneyTab;/);
  assert.match(MAIN.slice(i, i + 600), /a1285SeatFirstPiggyOnFork\(\{ client: a977ForkClients\(\)\.publicClient \}\)/);
  assert.equal(/promoteFirstPiggyToScope|promoteFirstPiggyRegistry|markBornPiggyIssuance|registerControlledPiggy|myPiggiesIndexKey/.test(cutFn(MAIN, "a1285SeatFirstPiggyOnFork")), false);
});
await check("P2 mainnet path unchanged: the A-897 functions are byte-identical to ea9f22a", () => {
  assert.ok(BASE, "git base ea9f22a unreadable");
  const names = [...BASE.matchAll(/^(?:async )?function (a897[A-Za-z0-9_]*)\(/gm)].map((m) => m[1]);
  assert.ok(names.length >= 3, `a897 functions found: ${names.length}`);
  for (const n of names) assert.equal(cutFn(MAIN, n), cutFn(BASE, n), `${n} changed`);
});
await check("P3 Gift send / Money read code byte-identical to ea9f22a", () => {
  assert.ok(BASE, "git base ea9f22a unreadable");
  // [A-1298] the only allowed delta: a money Send asks Face ID even with a live key (fresh) — everything else byte-identical
  const undo1298 = (src) => String(src || "")
    .replace("a898SignerForPayer(piggy, { fresh: true }); // [A-1298] a Gift Send moves money: Face ID every time", "a898SignerForPayer(piggy);")
    .replace("{ allowDeviceCredential = false, fresh = false }", "{ allowDeviceCredential = false }")
    .replace("if (!fresh && activeAccount", "if (activeAccount");
  // [A-1360 · Owner 15:4x "열린 동안 보내기 승인만"] the next allowed delta: the Gift Send uses the open key (no fresh), asks our approval sheet,
  // and keeps the device Piggy's key at the end — undone here, everything else still byte-identical
  const undo1360 = (src) => String(src || "")
    .replace("a898SignerForPayer(piggy); // [A-1360] the open key is used (Face ID only when it is not open) · pre-A-1360: { fresh: true }", "a898SignerForPayer(piggy);")
    .replace("let cur = state.giftSend;", "const cur = state.giftSend;")
    .replace(/\n    if \(proved\.ok === true && typeof askSendAllow === "function"\) \{ \/\/ \[A-1360\][\s\S]*?\n    \}(?=\n    const sel = state\.selectedPiggy;)/, "")
    .replace(/\/\/ \[A-1360\] the device Piggy's key stays open[^\n]*\n    if \(String\(piggy\.address\)\.toLowerCase\(\) !== String\(state\.address \|\| ""\)\.toLowerCase\(\)\) endSignerSession\(\);/, "endSignerSession();");
  for (const n of ["a898FaceId", "a898SignerForPayer", "a898Holdings", "a898RegistryPiggy", "moneyPiggiesSnapshot", "secondPiggyRegistrySnapshot", "indexedResidents"]) assert.equal(undo1298(undo1360(cutFn(MAIN, n))), cutFn(BASE, n), `${n} changed`);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
