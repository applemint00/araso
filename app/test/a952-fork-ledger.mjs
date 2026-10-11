// [A-952] Fork evidence + reward ledger contract. Node only, network 0, no file writes.
// Cases = the card's item 3: key collisions + reuse refused · new forkInstanceId invalidates old evidence · same tester / several
// Piggies -> one reward · INVALID x3 · payout record apart from evidence · developer count (10 Jobs + Gift) apart from user completion.
// Plus: both modules import with zero network / file / http I/O (source scan + fetch trap).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-952 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_FILE = "api/_lib/fork-ledger-contract.js";
const STORE_FILE = "api/_lib/fork-ledger-store-contract.js";
const src = (f) => readFileSync(path.join(REPO, f), "utf8");

const L = await import("../../api/_lib/fork-ledger-contract.js");
const S = await import("../../api/_lib/fork-ledger-store-contract.js");
const { evidenceKey, evidenceRecord, journeyVerdict, developerCoverage, rewardKey, rewardLedgerApply, rewardLedgerEmpty, payoutRecord, stampKey, stampRecord, VERDICT, DEVELOPER_COVERAGE_STEPS, DEVELOPER_COVERAGE_JOURNEY } = L;

const FORK_CHAIN = 31337143; // A-946 FORK_CHAIN_ID
const PIGGY_A = "0x" + "a1".repeat(20);
const PIGGY_B = "0x" + "b2".repeat(20);
const tx = (n) => "0x" + n.toString(16).padStart(64, "0");
const FORK_START = 50; // instance metadata: the snapshot block; rows at/below it are parent-chain history
const CTX = { forkInstanceId: "fork-1", chainId: FORK_CHAIN, piggyAddress: PIGGY_A, forkStartBlock: FORK_START };
const ev = (stepId, n, over = {}) => ({ ...CTX, txHash: tx(n), blockNumber: 100 + n, status: "success", journeyId: "j.aave", journeyVersion: 1, stepId, ...over });
const AAVE = { journeyId: "j.aave", journeyVersion: 1, steps: ["choose", "deposit", "receipt"] };

// ---- 0. purity -------------------------------------------------------------------------------------------------------------
await check("modules: no fs/http/net/child_process import, no fetch, no env/clock/random in source", () => {
  for (const f of [CONTRACT_FILE, STORE_FILE]) {
    const t = src(f).replace(/^\s*\/\/.*$/gm, "");
    const imports = [...t.matchAll(/\bimport\b[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of imports) assert.equal(spec, "./fork-ledger-contract.js", `${f} imports ${spec}`);
    assert.doesNotMatch(t, /\bimport\s*\(/, `${f}: dynamic import`);
    assert.doesNotMatch(t, /\brequire\s*\(/, `${f}: require`);
    assert.doesNotMatch(t, /node:|["'](fs|http|https|net|child_process)["']/, `${f}: node builtin`);
    assert.doesNotMatch(t, /\bfetch\b|XMLHttpRequest|WebSocket/, `${f}: network call`);
    assert.doesNotMatch(t, /process\.env|Date\.now|new Date|Math\.random/, `${f}: env/clock/random`);
  }
  assert.equal(src(CONTRACT_FILE).match(/^import /m), null, "contract module has no imports at all");
});

// ---- 1. evidence key: all fields, normalised, collisions -------------------------------------------------------------------
await check("evidenceKey: every one of the 5 fields required; a tx hash alone is refused", () => {
  const full = { ...CTX, txHash: tx(1), blockNumber: 101 };
  assert.equal(evidenceKey(full).ok, true);
  assert.deepEqual(evidenceKey({ txHash: tx(1) }).ok, false);
  for (const f of ["forkInstanceId", "chainId", "piggyAddress", "txHash", "blockNumber"]) {
    const { [f]: _drop, ...rest } = full;
    const r = evidenceKey(rest);
    assert.equal(r.ok, false, `missing ${f} accepted`); assert.equal(r.field, f);
  }
  for (const [f, v] of [["piggyAddress", "0x1234"], ["txHash", "0xzz"], ["chainId", 0], ["chainId", 1.5], ["blockNumber", -1], ["forkInstanceId", "a|b"], ["forkInstanceId", ""]]) {
    assert.equal(evidenceKey({ ...full, [f]: v }).ok, false, `${f}=${v} accepted`);
  }
});

await check("evidenceKey: normalised — case, whitespace, number vs decimal vs 0x quantity give one key", () => {
  const a = evidenceKey({ forkInstanceId: "fork-1", chainId: FORK_CHAIN, piggyAddress: PIGGY_A, txHash: tx(0xabc), blockNumber: 255 });
  const b = evidenceKey({ forkInstanceId: " FORK-1 ", chainId: "0x" + FORK_CHAIN.toString(16), piggyAddress: PIGGY_A.toUpperCase().replace("0X", "0x"), txHash: tx(0xabc).toUpperCase().replace("0X", "0x"), blockNumber: "0xff" });
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.key, b.key);
  assert.equal(a.key, `fork-evidence|fork-1|${FORK_CHAIN}|${PIGGY_A}|${tx(0xabc)}|255`);
});

await check("evidenceKey: no collision — same tx hash differs by instance / chain / address / block; '|' cannot be smuggled in", () => {
  const base = { ...CTX, txHash: tx(7), blockNumber: 107 };
  const keys = new Set([
    evidenceKey(base).key,
    evidenceKey({ ...base, forkInstanceId: "fork-2" }).key,
    evidenceKey({ ...base, chainId: 143 }).key,
    evidenceKey({ ...base, piggyAddress: PIGGY_B }).key,
    evidenceKey({ ...base, blockNumber: 108 }).key,
  ]);
  assert.equal(keys.size, 5);
  // "fork|1" + "2" vs "fork" + "1|2" style splice: refused because ids cannot carry "|"
  assert.equal(evidenceKey({ ...base, forkInstanceId: `fork-1|${FORK_CHAIN}` }).ok, false);
  assert.equal(stampKey({ testerId: "t1|fork-1", forkInstanceId: "x", journeyId: "j" }).ok, false);
  assert.equal(rewardKey({ testerId: "t1|c1", rewardCampaignVersion: "c2" }).ok, false);
});

await check("evidence reuse refused: store putIfAbsent once per key; one evidence key cannot prove two steps", async () => {
  const store = S.createMemoryForkLedgerStore();
  assert.equal(S.isForkLedgerStore(store), true);
  const r = evidenceRecord(ev("deposit", 1));
  assert.equal(r.ok, true);
  assert.deepEqual(await store.putIfAbsent("evidence", r.key, r.record), { ok: true, created: true });
  const again = await store.putIfAbsent("evidence", r.key, r.record);
  assert.equal(again.ok, false); assert.equal(again.reason, "exists");
  assert.equal((await store.list("evidence")).length, 1);
  // same tx (same key) offered for two steps / two journeys -> INVALID
  const v = journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("choose", 1), ev("deposit", 1), ev("receipt", 3)] });
  assert.equal(v.verdict, VERDICT.INVALID); assert.equal(v.reason, "evidence_reused");
  const v2 = journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("choose", 1), ev("deposit", 2), ev("receipt", 3), ev("send", 1, { journeyId: "j.gift" })] });
  assert.equal(v2.verdict, VERDICT.INVALID); assert.equal(v2.reason, "evidence_reused");
  // an identical repeat of the same row is the same proof (not reuse)
  const v3 = journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("choose", 1), ev("choose", 1), ev("deposit", 2), ev("receipt", 3)] });
  assert.equal(v3.verdict, VERDICT.COMPLETE);
  // a failed tx is not evidence
  assert.equal(evidenceRecord(ev("deposit", 9, { status: "reverted" })).reason, "tx_not_success");
});

// ---- 2. verdict: chosen journey only, three states --------------------------------------------------------------------------
await check("journeyVerdict: COMPLETE / INCOMPLETE (missing listed in step order) for the chosen journey only", () => {
  const all = [ev("choose", 1), ev("deposit", 2), ev("receipt", 3)];
  const c = journeyVerdict({ ...AAVE, context: CTX, evidence: all });
  assert.equal(c.verdict, VERDICT.COMPLETE); assert.deepEqual(c.missing, []); assert.equal(c.scope, "user");
  const inc = journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("deposit", 2)] });
  assert.equal(inc.verdict, VERDICT.INCOMPLETE); assert.deepEqual(inc.missing, ["choose", "receipt"]); assert.deepEqual(inc.covered, ["deposit"]);
  // another journey's rows (even from another instance) do not count and are not judged
  const other = [ev("send", 11, { journeyId: "j.gift" }), ev("x", 12, { journeyId: "j.kuru", forkInstanceId: "fork-0" })];
  assert.equal(journeyVerdict({ ...AAVE, context: CTX, evidence: other }).verdict, VERDICT.INCOMPLETE);
  assert.equal(journeyVerdict({ ...AAVE, context: CTX, evidence: [...all, ...other] }).verdict, VERDICT.COMPLETE);
  // other version of the same journey is not this journey
  assert.equal(journeyVerdict({ ...AAVE, context: CTX, evidence: all.map((e) => ({ ...e, journeyVersion: 2 })) }).verdict, VERDICT.INCOMPLETE);
  // no 10-Job forcing: a one-step journey completes on its own
  assert.equal(journeyVerdict({ journeyId: "j.kuru-swap", journeyVersion: 1, steps: ["swap"], context: CTX, evidence: [ev("swap", 20, { journeyId: "j.kuru-swap" })] }).verdict, VERDICT.COMPLETE);
});

await check("INVALID x3: fork instance mismatch · chain mismatch · address mismatch", () => {
  const good = [ev("choose", 1), ev("deposit", 2)];
  const cases = [
    [{ forkInstanceId: "fork-9" }, "fork_instance_mismatch"],
    [{ chainId: 143 }, "chain_mismatch"],
    [{ piggyAddress: PIGGY_B }, "address_mismatch"],
  ];
  for (const [over, reason] of cases) {
    const v = journeyVerdict({ ...AAVE, context: CTX, evidence: [...good, ev("receipt", 3, over)] });
    assert.equal(v.verdict, VERDICT.INVALID, reason); assert.equal(v.reason, reason);
  }
  // bad input is INVALID too (fail closed), never a throw
  for (const bad of [undefined, null, 42, {}, { ...AAVE }, { ...AAVE, context: CTX, evidence: "x" }, { ...AAVE, steps: [], context: CTX, evidence: [] },
    { ...AAVE, steps: ["a", "A"], context: CTX, evidence: [] }, { ...AAVE, context: CTX, evidence: [{ junk: 1 }] }, { ...AAVE, context: CTX, evidence: [ev("other-step", 5)] }]) {
    assert.equal(journeyVerdict(bad).verdict, VERDICT.INVALID);
  }
});

await check("new forkInstanceId invalidates old evidence (no carry-over across a reset)", () => {
  const old = [ev("choose", 1), ev("deposit", 2), ev("receipt", 3)];
  assert.equal(journeyVerdict({ ...AAVE, context: CTX, evidence: old }).verdict, VERDICT.COMPLETE);
  const NEW = { ...CTX, forkInstanceId: "fork-2" };
  const v = journeyVerdict({ ...AAVE, context: NEW, evidence: old });
  assert.equal(v.verdict, VERDICT.INVALID); assert.equal(v.reason, "fork_instance_mismatch");
  // a snapshot replay that repeats the same tx hash + block on the new instance is a different key (new proof, not the old one)
  assert.notEqual(evidenceKey({ ...CTX, txHash: tx(1), blockNumber: 101 }).key, evidenceKey({ ...NEW, txHash: tx(1), blockNumber: 101 }).key);
  const fresh = old.map((e) => ({ ...e, forkInstanceId: "fork-2" }));
  assert.equal(journeyVerdict({ ...AAVE, context: NEW, evidence: fresh }).verdict, VERDICT.COMPLETE);
});

// ---- 3. reward: one per tester per campaign version -------------------------------------------------------------------------
// A real verdict object from journeyVerdict (the only thing rewardLedgerApply accepts).
const verdictFor = ({ testerId = "tester-7", piggyAddress = PIGGY_A, forkInstanceId = "fork-1", journeyId = "j.aave", complete = true } = {}) => {
  const ctx = { ...CTX, piggyAddress, forkInstanceId, ...(testerId === null ? {} : { testerId }) };
  const rows = [ev("s1", 60, { piggyAddress, forkInstanceId, journeyId })];
  if (complete) rows.push(ev("s2", 61, { piggyAddress, forkInstanceId, journeyId }));
  return journeyVerdict({ journeyId, journeyVersion: 1, steps: ["s1", "s2"], context: ctx, evidence: rows });
};
const entry = (over = {}, v = {}) => ({ testerId: "tester-7", rewardCampaignVersion: "fork-reward-v1", verdict: verdictFor(v), ...over });

await check("rewardKey = testerId + rewardCampaignVersion only (normalised)", () => {
  const k = rewardKey({ testerId: " Tester-7 ", rewardCampaignVersion: "FORK-REWARD-V1" });
  assert.equal(k.key, "reward|tester-7|fork-reward-v1");
  assert.equal(rewardKey({ testerId: "tester-7" }).ok, false);
  assert.equal(rewardKey({ rewardCampaignVersion: "v1" }).ok, false);
});

await check("same tester, several Piggies / journeys / fork instances -> one reward; ledger never mutated", () => {
  const L0 = rewardLedgerEmpty();
  const r1 = rewardLedgerApply(L0, entry());
  assert.equal(r1.ok, true);
  assert.equal(Object.keys(L0.entries).length, 0, "input ledger mutated");
  assert.notEqual(r1.ledger, L0);
  const snap = JSON.stringify(r1.ledger);
  for (const [over, v] of [[{}, { piggyAddress: PIGGY_B }], [{}, { journeyId: "j.gift" }], [{}, { forkInstanceId: "fork-2" }], [{ testerId: "TESTER-7" }, {}]]) {
    assert.equal(v === undefined || entry(over, v).verdict.verdict, VERDICT.COMPLETE);
    const r = rewardLedgerApply(r1.ledger, entry(over, v));
    assert.equal(r.ok, false); assert.equal(r.reason, "duplicate_reward");
    assert.equal(r.ledger, r1.ledger, "refusal must return the same ledger");
  }
  assert.equal(JSON.stringify(r1.ledger), snap);
  assert.equal(Object.isFrozen(r1.ledger) && Object.isFrozen(r1.ledger.entries), true);
  // next campaign version = a separate reward
  const r2 = rewardLedgerApply(r1.ledger, entry({ rewardCampaignVersion: "fork-reward-v2" }));
  assert.equal(r2.ok, true); assert.equal(Object.keys(r2.ledger.entries).length, 2); assert.equal(Object.keys(r1.ledger.entries).length, 1);
  // not COMPLETE / mismatched explicit key / bad ledger -> refused
  assert.equal(rewardLedgerApply(L0, entry({}, { complete: false })).reason, "not_complete");
  assert.equal(rewardLedgerApply(L0, entry({ rewardKey: "reward|someone-else|fork-reward-v1" })).reason, "reward_key_mismatch");
  assert.equal(rewardLedgerApply({ entries: {} }, entry()).reason, "invalid_ledger");
  assert.equal(rewardLedgerApply(null, null).ok, false);
});

await check("store: rewards putIfAbsent — second Piggy of the same tester is refused", async () => {
  const store = S.createMemoryForkLedgerStore();
  const a = rewardLedgerApply(rewardLedgerEmpty(), entry());
  const b = rewardLedgerApply(rewardLedgerEmpty(), entry({}, { piggyAddress: PIGGY_B }));
  assert.equal(a.key, b.key);
  assert.equal((await store.putIfAbsent("rewards", a.key, a.record)).ok, true);
  const second = await store.putIfAbsent("rewards", b.key, b.record);
  assert.equal(second.reason, "exists"); assert.equal(second.existing.piggyAddress, PIGGY_A);
  assert.equal((await store.list("rewards")).length, 1);
  // stored values are copies: mutating the returned row cannot touch the store
  const got = await store.get("rewards", a.key);
  assert.throws(() => { got.piggyAddress = PIGGY_B; });
});

// ---- 4. payout: record only, apart from evidence ----------------------------------------------------------------------------
await check("payoutRecord: record shape only (executes:false), no fork-evidence fields, one payout per reward, own collection", async () => {
  const p = payoutRecord({ rewardKey: "reward|tester-7|fork-reward-v1", mainnetTxHash: tx(0x99), amount: "10", ownerNote: "paid by hand" });
  assert.equal(p.ok, true);
  assert.equal(p.record.executes, false); assert.equal(p.record.mainnetChainId, "143"); assert.equal(p.record.kind, L.KIND.PAYOUT);
  assert.equal(p.key, "payout|reward|tester-7|fork-reward-v1");
  assert.equal(payoutRecord({ rewardKey: "reward|tester-7|fork-reward-v1", mainnetTxHash: tx(0x99), amount: "10.500000" }).record.amount, "10.5");
  for (const f of ["forkInstanceId", "chainId", "piggyAddress", "txHash", "blockNumber", "journeyId", "stepId", "evidenceKey"]) assert.equal(f in p.record, false, `payout carries ${f}`);
  // input that mixes in fork evidence is refused
  const mixed = payoutRecord({ rewardKey: "reward|tester-7|fork-reward-v1", mainnetTxHash: tx(0x99), amount: "10", forkInstanceId: "fork-1", txHash: tx(1) });
  assert.equal(mixed.ok, false); assert.equal(mixed.reason, "fork_evidence_field_in_payout");
  for (const bad of [{ amount: "0" }, { amount: "10.1234567" }, { amount: 10 }, { amount: "-1" }, { mainnetTxHash: "0x12" }, { rewardKey: "fork-evidence|x" }, { rewardKey: tx(1) }]) {
    assert.equal(payoutRecord({ rewardKey: "reward|tester-7|fork-reward-v1", mainnetTxHash: tx(0x99), amount: "10", ...bad }).ok, false, JSON.stringify(bad));
  }
  const store = S.createMemoryForkLedgerStore();
  assert.equal((await store.putIfAbsent("evidence", p.key, p.record)).reason, "bad_key", "payout must not enter the evidence collection");
  assert.equal((await store.putIfAbsent("payouts", p.key, p.record)).ok, true);
  const dup = payoutRecord({ rewardKey: "reward|tester-7|fork-reward-v1", mainnetTxHash: tx(0x98), amount: "10" });
  assert.equal((await store.putIfAbsent("payouts", dup.key, dup.record)).reason, "exists", "second payout record for one reward");
  const e = evidenceRecord(ev("deposit", 2));
  assert.equal((await store.putIfAbsent("payouts", e.key, e.record)).reason, "bad_key", "evidence must not enter payouts");
  assert.equal((await store.putIfAbsent("payouts", "payout|reward|x|y", e.record)).reason, "bad_value");
  assert.equal((await store.list("evidence")).length, 0);
});

// ---- 5. stamp: separate from A-897 alpha! ------------------------------------------------------------------------------------
await check("stampKey: own namespace, not the A-897 alpha! stamp key; per tester + fork instance + journey", () => {
  const k = stampKey({ testerId: "tester-7", forkInstanceId: "fork-1", journeyId: "j.aave" });
  assert.equal(k.key, "fork-stamp|tester-7|fork-1|j.aave");
  const a897 = /const A897_STAMP_PLAYED_KEY = "([^"]+)"/.exec(src("app/src/main.js"));
  assert.ok(a897, "A-897 stamp key literal not found in main.js");
  assert.equal(k.key.startsWith(a897[1]) || a897[1].startsWith(k.key.split("|")[0]), false);
  assert.doesNotMatch(k.key, /alpha|promotion/);
  assert.notEqual(stampKey({ testerId: "tester-7", forkInstanceId: "fork-2", journeyId: "j.aave" }).key, k.key);
  for (const f of ["testerId", "forkInstanceId", "journeyId"]) assert.equal(stampKey({ testerId: "t", forkInstanceId: "f", journeyId: "j", [f]: undefined }).ok, false);
  assert.equal(stampKey({ testerId: "t", forkInstanceId: "f", journeyId: DEVELOPER_COVERAGE_JOURNEY }).ok, false);
  assert.equal(stampRecord({ testerId: "t", forkInstanceId: "f", journeyId: "j" }).record.kind, L.KIND.STAMP);
});

// ---- 6. developer count vs user completion -----------------------------------------------------------------------------------
await check("developer count (10 Jobs + Gift = 11) is apart from user completion (chosen journey)", () => {
  assert.equal(DEVELOPER_COVERAGE_STEPS.length, 11);
  assert.equal(DEVELOPER_COVERAGE_STEPS.filter((s) => s.startsWith("job.")).length, 10);
  assert.equal(DEVELOPER_COVERAGE_STEPS.filter((s) => s.startsWith("gift.")).length, 1);
  const dev = (s, n) => ev(s, 1000 + n, { journeyId: DEVELOPER_COVERAGE_JOURNEY });
  // a user finishes only a Gift journey -> user COMPLETE, developer count 0/11 (user rows never feed the developer count)
  const GIFT = { journeyId: "j.gift", journeyVersion: 1, steps: ["send", "claim"] };
  const userRows = [ev("send", 40, { journeyId: "j.gift" }), ev("claim", 41, { journeyId: "j.gift" })];
  assert.equal(journeyVerdict({ ...GIFT, context: CTX, evidence: userRows }).verdict, VERDICT.COMPLETE);
  const d0 = developerCoverage({ context: CTX, evidence: userRows });
  assert.equal(d0.completedCount, 0); assert.equal(d0.complete, false); assert.equal(d0.scope, "developer");
  // developer coverage complete (11/11) does not complete a user journey with missing steps
  const devRows = DEVELOPER_COVERAGE_STEPS.map((s, n) => dev(s, n));
  const d1 = developerCoverage({ context: CTX, evidence: [...devRows, ...userRows] });
  assert.equal(d1.completedCount, 11); assert.equal(d1.complete, true);
  const u = journeyVerdict({ ...AAVE, context: CTX, evidence: devRows });
  assert.equal(u.verdict, VERDICT.INCOMPLETE); assert.deepEqual(u.missing, AAVE.steps);
  // developer namespace cannot be judged as a user journey nor stamped
  assert.equal(journeyVerdict({ journeyId: DEVELOPER_COVERAGE_JOURNEY, journeyVersion: 1, steps: [...DEVELOPER_COVERAGE_STEPS], context: CTX, evidence: devRows }).reason, "reserved_journey");
  assert.equal(rewardLedgerApply(rewardLedgerEmpty(), entry({ journeyId: DEVELOPER_COVERAGE_JOURNEY })).ok, false);
  assert.equal(journeyVerdict({ journeyId: DEVELOPER_COVERAGE_JOURNEY, journeyVersion: 1, steps: ["x"], context: { ...CTX, testerId: "tester-7" }, evidence: [] }).verdict, VERDICT.INVALID);
  // partial developer coverage lists what is missing
  const d2 = developerCoverage({ context: CTX, evidence: devRows.slice(0, 10) });
  assert.equal(d2.completedCount, 10); assert.deepEqual(d2.missing, ["gift.send-claim"]);
  // other-instance developer rows are not counted
  assert.equal(developerCoverage({ context: { ...CTX, forkInstanceId: "fork-2" }, evidence: devRows }).completedCount, 0);
});

// ---- 8. review fixes (opus spot-check) ---------------------------------------------------------------------------------------
await check("[fix 1] store: key must equal the contract-rebuilt key and value fields must be canonical, for all 4 collections", async () => {
  const store = S.createMemoryForkLedgerStore();
  const rw = rewardLedgerApply(rewardLedgerEmpty(), entry()).record;
  assert.equal((await store.putIfAbsent("rewards", rw.key, rw)).ok, true);
  for (const raw of [rw.key + " ", rw.key + "|x", "reward|Tester-7|fork-reward-v1", "reward|tester-7|fork-reward-v2"]) {
    const r = await store.putIfAbsent("rewards", raw, { ...rw, key: raw });
    assert.equal(r.ok, false, `raw key ${JSON.stringify(raw)} stored`); assert.equal(r.reason, "key_not_canonical");
  }
  const uc = "reward|tester-8|fork-reward-v1";
  assert.equal((await store.putIfAbsent("rewards", uc, { ...rw, key: uc, testerId: "TESTER-8" })).reason, "value_not_canonical");
  const e = evidenceRecord(ev("deposit", 2));
  assert.equal((await store.putIfAbsent("evidence", e.key + "|x", { ...e.record, key: e.key + "|x" })).reason, "key_not_canonical");
  assert.equal((await store.putIfAbsent("evidence", e.key, { ...e.record, stepId: "Deposit" })).reason, "value_not_canonical");
  assert.equal((await store.putIfAbsent("evidence", e.key, e.record)).ok, true);
  const st = stampRecord({ testerId: "tester-7", forkInstanceId: "fork-1", journeyId: "j.aave" });
  const stBad = st.key.replace("fork-1", "fork-2");
  assert.equal((await store.putIfAbsent("stamps", stBad, { ...st.record, key: stBad })).reason, "key_not_canonical");
  assert.equal((await store.putIfAbsent("stamps", st.key, st.record)).ok, true);
  const p = payoutRecord({ rewardKey: rw.key, mainnetTxHash: tx(0x77), amount: "10", ownerNote: "" });
  const pBad = "payout|reward|tester-9|fork-reward-v1";
  assert.equal((await store.putIfAbsent("payouts", pBad, { ...p.record, key: pBad })).reason, "key_not_canonical");
  assert.equal((await store.putIfAbsent("payouts", p.key, { ...p.record, amount: "10.0" })).reason, "value_not_canonical");
  assert.equal((await store.putIfAbsent("payouts", p.key, p.record)).ok, true);
  for (const c of ["rewards", "evidence", "stamps", "payouts"]) assert.equal((await store.list(c)).length, 1, c);
});

await check("[fix 2] replay floor: rows at or below forkStartBlock are INVALID pre_fork_evidence; Piggy (sender) mismatch stays INVALID", () => {
  for (const blockNumber of [FORK_START, FORK_START - 1, 0]) {
    const v = journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("choose", 1), ev("deposit", 2), ev("receipt", 3, { blockNumber })] });
    assert.equal(v.verdict, VERDICT.INVALID, `block ${blockNumber}`); assert.equal(v.reason, "pre_fork_evidence");
  }
  assert.equal(journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("choose", 1), ev("deposit", 2), ev("receipt", 3, { blockNumber: FORK_START + 1 })] }).verdict, VERDICT.COMPLETE);
  const { forkStartBlock: _drop, ...noFloor } = CTX;
  const nf = journeyVerdict({ ...AAVE, context: noFloor, evidence: [] });
  assert.equal(nf.verdict, VERDICT.INVALID); assert.equal(nf.field, "forkStartBlock");
  const addr = journeyVerdict({ ...AAVE, context: CTX, evidence: [ev("choose", 1), ev("deposit", 2, { piggyAddress: PIGGY_B })] });
  assert.equal(addr.verdict, VERDICT.INVALID); assert.equal(addr.reason, "address_mismatch");
  // pre-fork developer rows are not counted either
  const dev = DEVELOPER_COVERAGE_STEPS.map((s, n) => ev(s, 2000 + n, { journeyId: DEVELOPER_COVERAGE_JOURNEY, blockNumber: FORK_START }));
  assert.equal(developerCoverage({ context: CTX, evidence: dev }).completedCount, 0);
});

await check("[fix 3] rewardLedgerApply accepts only an issued COMPLETE verdict bound to the same tester / Piggy / fork / journey", () => {
  const L0 = rewardLedgerEmpty();
  const v = verdictFor();
  assert.equal(v.testerId, "tester-7"); assert.equal(v.piggyAddress, PIGGY_A); assert.equal(v.forkInstanceId, "fork-1"); assert.equal(v.forkStartBlock, String(FORK_START));
  assert.equal(Object.isFrozen(v), true);
  const ok = rewardLedgerApply(L0, entry({ verdict: v, piggyAddress: PIGGY_A, forkInstanceId: "fork-1", journeyId: "j.aave", journeyVersion: 1 }));
  assert.equal(ok.ok, true); assert.equal(ok.record.piggyAddress, PIGGY_A); assert.equal(ok.record.journeyId, "j.aave");
  const cases = [
    [{ verdict: "COMPLETE" }, "verdict_not_issued"],
    [{ verdict: { ...v } }, "verdict_not_issued"],
    [{ verdict: JSON.parse(JSON.stringify(v)) }, "verdict_not_issued"],
    [{ verdict: undefined }, "verdict_not_issued"],
    [{ verdict: verdictFor({ complete: false }) }, "not_complete"],
    [{ verdict: verdictFor({ testerId: null }) }, "verdict_without_tester"],
    [{ verdict: verdictFor({ testerId: "tester-8" }) }, "verdict_tester_mismatch"],
    [{ verdict: v, piggyAddress: PIGGY_B }, "verdict_mismatch"],
    [{ verdict: v, forkInstanceId: "fork-2" }, "verdict_mismatch"],
    [{ verdict: v, journeyId: "j.gift" }, "verdict_mismatch"],
    [{ verdict: v, journeyVersion: 2 }, "verdict_mismatch"],
  ];
  for (const [over, reason] of cases) {
    const r = rewardLedgerApply(L0, entry(over));
    assert.equal(r.ok, false, reason); assert.equal(r.reason, reason); assert.equal(r.ledger, L0);
  }
  // an INVALID verdict (e.g. pre-fork) cannot earn a reward either
  const inv = journeyVerdict({ journeyId: "j.aave", journeyVersion: 1, steps: ["s1"], context: { ...CTX, testerId: "tester-7" }, evidence: [ev("s1", 1, { blockNumber: 10 })] });
  assert.equal(rewardLedgerApply(L0, entry({ verdict: inv })).reason, "not_complete");
});

// ---- 7. hostile input + no network -------------------------------------------------------------------------------------------
await check("no throw on hostile input; store rejects unknown collections; no fetch call made", async () => {
  const junk = [undefined, null, 0, "", [], {}, { __proto__: { forkInstanceId: "x" } }, Object.create(null)];
  for (const j of junk) {
    for (const fn of [evidenceKey, evidenceRecord, journeyVerdict, developerCoverage, rewardKey, payoutRecord, stampKey, stampRecord]) fn(j);
    rewardLedgerApply(j, j);
  }
  const store = S.createMemoryForkLedgerStore();
  assert.equal((await store.putIfAbsent("grants", "reward|a|b", { kind: L.KIND.REWARD, key: "reward|a|b" })).reason, "bad_collection");
  assert.equal(await store.get("__proto__", "x"), null);
  assert.deepEqual(await store.list("constructor"), []);
  assert.equal(store.testOnly, true);
  assert.equal(S.isForkLedgerStore({ contract: S.FORK_LEDGER_STORE_CONTRACT, get() {}, list() {} }), false);
  assert.equal(netCalls, 0);
});

console.log(`\nA-952 fork ledger: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
