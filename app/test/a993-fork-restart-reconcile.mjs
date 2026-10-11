// [A-993] Fork restart reconcile — LEDGER SIDE ONLY. Node only, network 0, no file writes.
// A-981 found the loss window: snapshot → 1 tx → SIGKILL → resume on the SAME forkInstanceId → the tx is gone from the chain but its
// A-952 evidence row still counts. Cases:
//   1 evidence rows may carry blockHash (key unchanged; old rows without it stay valid)
//   2 markOrphaned(rowId, reason) is append-only: a separate marker row in its own collection; the evidence row is kept, nothing deleted
//   3 journeyVerdict / developerCoverage skip orphaned rows (absent list = A-952 behaviour unchanged)
//   4 reconcile: Public reads only → ORPHANED_BY_RESTORE marked · OK / MOVED / HASH_CHANGED / OTHER_INSTANCE reported ·
//     TOPUP_AFTER_SNAPSHOT = a re-grant CANDIDATE row under a new grantVersion (executes:false; no Admin call, no payout)
//   5 one reward per tester (A-952) still holds across orphan + redo
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-993 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (f) => readFileSync(path.join(REPO, f), "utf8");
const L = await import("../../api/_lib/fork-ledger-contract.js");
const S = await import("../../api/_lib/fork-ledger-store-contract.js");
let R = null;
try { R = await import("../../api/_lib/fork-restart-reconcile.js"); } catch (e) { console.log(`(reconcile module not loadable: ${String(e.message).split("\n")[0]})`); }
const { evidenceKey, evidenceRecord, journeyVerdict, developerCoverage, rewardLedgerApply, rewardLedgerEmpty, VERDICT } = L;

const FORK = "fork-143-110874000-20261010t193035z-cfa25f14";
const CHAIN = 31337143;
const PIGGY = "0x" + "a1".repeat(20);
const PIGGY2 = "0x" + "b2".repeat(20);
const tx = (n) => "0x" + n.toString(16).padStart(64, "0");
const bh = (n) => "0x" + (0xb0000 + n).toString(16).padStart(64, "0");
const CTX = { forkInstanceId: FORK, chainId: CHAIN, piggyAddress: PIGGY, forkStartBlock: 110874000 };
const ev = (stepId, n, over = {}) => ({ ...CTX, txHash: tx(n), blockNumber: 110874000 + n, blockHash: bh(n), status: "success", journeyId: "j.aave", journeyVersion: 1, stepId, ...over });
const AAVE = { journeyId: "j.aave", journeyVersion: 1, steps: ["deposit", "withdraw"] };
const rec = (x) => { const r = evidenceRecord(x); assert.equal(r.ok, true, JSON.stringify(r)); return r.record; };

// ---- 1. blockHash ----------------------------------------------------------------------------------------------------------
await check("1 evidenceRecord records an optional blockHash (lower-cased); the A-952 key is unchanged with or without it", () => {
  const withH = evidenceRecord(ev("deposit", 1, { blockHash: bh(1).toUpperCase().replace("0X", "0x") }));
  assert.equal(withH.ok, true); assert.equal(withH.record.blockHash, bh(1));
  const { blockHash: _x, ...noHashInput } = ev("deposit", 1);
  const noH = evidenceRecord(noHashInput);
  assert.equal(noH.ok, true); assert.equal(Object.prototype.hasOwnProperty.call(noH.record, "blockHash"), false, "absent stays absent (old rows unchanged)");
  assert.equal(withH.key, noH.key); assert.equal(withH.key, evidenceKey(noHashInput).key);
  for (const v of ["0x1234", "nothex", 12, "0x" + "g".repeat(64)]) {
    const r = evidenceRecord(ev("deposit", 1, { blockHash: v }));
    assert.equal(r.ok, false, `blockHash=${v} accepted`); assert.equal(r.field, "blockHash");
  }
  assert.equal(evidenceRecord(ev("deposit", 1, { blockHash: null })).ok, true, "null = not given");
});
await check("1 store: rows with and without blockHash both accepted; a non-canonical blockHash value is refused", async () => {
  const store = S.createMemoryForkLedgerStore();
  const a = rec(ev("deposit", 1)); const { blockHash: _y, ...bIn } = ev("withdraw", 2); const b = rec(bIn);
  assert.equal((await store.putIfAbsent("evidence", a.key, a)).ok, true);
  assert.equal((await store.putIfAbsent("evidence", b.key, b)).ok, true);
  const c = rec(ev("deposit", 3));
  assert.equal((await store.putIfAbsent("evidence", c.key, { ...c, blockHash: c.blockHash.toUpperCase().replace("0X", "0x") })).reason, "value_not_canonical");
  assert.equal((await store.putIfAbsent("evidence", c.key, { ...c, blockHash: "0x12" })).reason, "bad_value");
});

// ---- 2. markOrphaned append-only ---------------------------------------------------------------------------------------------
await check("2 orphanRecord: own kind + key namespace, built from a CANONICAL evidence key; reason from the fixed set only", () => {
  const e = rec(ev("deposit", 1));
  const o = L.orphanRecord({ evidenceKey: e.key, reason: "orphaned_by_restore" });
  assert.equal(o.ok, true);
  assert.equal(o.key, `fork-orphan|${e.key.slice("fork-evidence|".length)}`);
  assert.equal(o.record.kind, L.KIND.ORPHAN); assert.equal(o.record.evidenceKey, e.key);
  assert.equal(o.record.forkInstanceId, FORK); assert.equal(o.record.piggyAddress, PIGGY); assert.equal(o.record.reason, L.ORPHAN_REASON.ORPHANED_BY_RESTORE);
  assert.equal(L.orphanRecord({ evidenceKey: e.key, reason: "because" }).field, "reason");
  assert.equal(L.orphanRecord({ evidenceKey: e.key.replace("|110874001", "|0x6a9c6d1"), reason: "orphaned_by_restore" }).ok, false, "non-canonical key refused");
  assert.equal(L.orphanRecord({ evidenceKey: "fork-evidence|x", reason: "orphaned_by_restore" }).ok, false);
  assert.equal(L.orphanRecord({ evidenceKey: `reward|${FORK}|v1`, reason: "orphaned_by_restore" }).ok, false);
});
await check("2 markOrphaned(rowId, reason): marker row appended; the evidence row is kept byte-equal; second mark = no overwrite; unknown row refused", async () => {
  assert.ok(R, "fork-restart-reconcile.js missing");
  const store = S.createMemoryForkLedgerStore();
  const e = rec(ev("deposit", 1));
  await store.putIfAbsent("evidence", e.key, e);
  const before = JSON.stringify(await store.list("evidence"));
  const rc = R.createForkRestartReconciler({ store, publicRpc: async () => { throw new Error("no rpc needed"); } });
  const m1 = await rc.markOrphaned(e.key, "orphaned_by_restore");
  assert.equal(m1.ok, true); assert.equal(m1.created, true);
  assert.equal(JSON.stringify(await store.list("evidence")), before, "evidence collection unchanged (no delete, no edit)");
  const orphans = await store.list("orphans");
  assert.equal(orphans.length, 1); assert.equal(orphans[0].evidenceKey, e.key);
  const m2 = await rc.markOrphaned(e.key, "orphaned_by_restore");
  assert.equal(m2.ok, true); assert.equal(m2.created, false); assert.equal((await store.list("orphans")).length, 1);
  assert.equal((await rc.markOrphaned(rec(ev("withdraw", 9)).key, "orphaned_by_restore")).reason, "no_such_row");
  assert.equal((await rc.markOrphaned(e.key, "cleanup")).reason, "bad_reason");
  assert.equal(typeof store.delete, "undefined"); assert.equal(typeof rc.unmark, "undefined");
});
await check("2 store: an orphan row can never land in evidence (or vice versa); orphan key must equal the rebuilt one", async () => {
  const store = S.createMemoryForkLedgerStore();
  const e = rec(ev("deposit", 1));
  const o = L.orphanRecord({ evidenceKey: e.key, reason: "orphaned_by_restore" }).record;
  assert.equal((await store.putIfAbsent("evidence", o.key, o)).reason, "bad_key");
  assert.equal((await store.putIfAbsent("orphans", e.key, e)).reason, "bad_key");
  assert.equal((await store.putIfAbsent("orphans", o.key, { ...o, reason: "other" })).reason, "bad_value");
  assert.equal((await store.putIfAbsent("orphans", o.key, o)).ok, true);
});

// ---- 3. journeyVerdict skips orphaned rows -----------------------------------------------------------------------------------
await check("3 journeyVerdict: an orphaned step does not count (INCOMPLETE, step missing); a redo with a new tx completes; no list = A-952 behaviour", () => {
  const d = rec(ev("deposit", 1)); const w = rec(ev("withdraw", 2));
  const base = { ...AAVE, context: { ...CTX, testerId: "tester-7" }, evidence: [d, w] };
  assert.equal(journeyVerdict(base).verdict, VERDICT.COMPLETE, "no orphaned list = unchanged");
  const o = L.orphanRecord({ evidenceKey: w.key, reason: "orphaned_by_restore" }).record;
  for (const orphaned of [[o], [w.key], [o.key]]) {
    const v = journeyVerdict({ ...base, orphaned });
    assert.equal(v.verdict, VERDICT.INCOMPLETE, JSON.stringify(orphaned).slice(0, 40)); assert.deepEqual([...v.missing], ["withdraw"]);
  }
  const redo = rec(ev("withdraw", 3));
  assert.equal(journeyVerdict({ ...base, evidence: [d, w, redo], orphaned: [o] }).verdict, VERDICT.COMPLETE, "redo counts");
  assert.equal(journeyVerdict({ ...base, orphaned: "x" }).verdict, VERDICT.INVALID);
  assert.equal(journeyVerdict({ ...base, orphaned: [{}] }).verdict, VERDICT.INVALID);
  assert.equal(journeyVerdict({ ...base, orphaned: [] }).verdict, VERDICT.COMPLETE);
});
await check("3 developerCoverage skips orphaned rows too", () => {
  const r = rec(ev("job.aave-usdc", 1, { journeyId: "developer-coverage" }));
  assert.equal(developerCoverage({ context: CTX, evidence: [r] }).completedCount, 1);
  assert.equal(developerCoverage({ context: CTX, evidence: [r], orphaned: [r.key] }).completedCount, 0);
});
await check("5 one reward per tester holds: COMPLETE → orphan → redo → COMPLETE again = still one reward (duplicate_reward)", () => {
  const d = rec(ev("deposit", 1)); const w = rec(ev("withdraw", 2)); const w2 = rec(ev("withdraw", 3));
  const ctx = { ...CTX, testerId: "tester-7" };
  const v1 = journeyVerdict({ ...AAVE, context: ctx, evidence: [d, w] });
  const a1 = rewardLedgerApply(rewardLedgerEmpty(), { testerId: "tester-7", rewardCampaignVersion: "camp-1", verdict: v1 });
  assert.equal(a1.ok, true);
  const v2 = journeyVerdict({ ...AAVE, context: ctx, evidence: [d, w, w2], orphaned: [w.key] });
  assert.equal(v2.verdict, VERDICT.COMPLETE);
  const a2 = rewardLedgerApply(a1.ledger, { testerId: "tester-7", rewardCampaignVersion: "camp-1", verdict: v2 });
  assert.equal(a2.ok, false); assert.equal(a2.reason, "duplicate_reward");
  const v3 = journeyVerdict({ ...AAVE, context: { ...ctx, piggyAddress: PIGGY2 }, evidence: [rec(ev("deposit", 4, { piggyAddress: PIGGY2 })), rec(ev("withdraw", 5, { piggyAddress: PIGGY2 }))] });
  assert.equal(rewardLedgerApply(a1.ledger, { testerId: "tester-7", rewardCampaignVersion: "camp-1", verdict: v3 }).reason, "duplicate_reward", "another Piggy, same tester");
});

// ---- 4. reconcile ------------------------------------------------------------------------------------------------------------
function chain({ instance = FORK.toUpperCase().replace("FORK-", "fork-"), head = 110874008 } = {}) {
  const rcs = new Map(); const calls = []; const st = { instance, head, flipAfter: null, chainId: CHAIN, lateReceipt: new Set(), pendingTx: new Set(), throwFor: new Set(), seen: new Map() };
  const rpc = async (method, params = []) => {
    calls.push(method);
    if (method === "araso_guardInfo") { const id = st.flipAfter !== null && calls.length > st.flipAfter ? "fork-143-110874000-20261011t000000z-00000000" : st.instance; return { guard: "a949", chainId: CHAIN, forkInstanceId: id }; }
    if (method === "eth_blockNumber") return `0x${st.head.toString(16)}`;
    if (method === "eth_chainId") return `0x${st.chainId.toString(16)}`;
    if (method === "eth_getTransactionByHash") { const k = String(params[0]).toLowerCase(); return st.pendingTx.has(k) ? { hash: k, blockNumber: null } : null; }
    if (method === "eth_getTransactionReceipt") {
      const k = String(params[0]).toLowerCase(); if (st.throwFor.has(k)) throw new Error("429 / non-JSON");
      const n = (st.seen.get(k) || 0) + 1; st.seen.set(k, n);
      if (st.lateReceipt.has(k) && n === 1) return null; // a lagging node: null first, the receipt on the confirm read
      return st.lateReceipt.has(k) ? { transactionHash: k, status: "0x1", blockNumber: `0x${(110874000 + Number(BigInt(k))).toString(16)}`, blockHash: bh(Number(BigInt(k))) } : rcs.get(k) ?? null;
    }
    if (method === "eth_getBlockByHash") return { hash: params[0] };
    throw new Error(`unexpected ${method}`);
  };
  const add = (n, { block = 110874000 + n, status = "0x1", blockHash = bh(n) } = {}) => rcs.set(tx(n), { transactionHash: tx(n), status, blockNumber: `0x${block.toString(16)}`, blockHash });
  return { rpc, add, calls, st };
}
async function seeded() {
  const store = S.createMemoryForkLedgerStore();
  const rows = {
    ok: rec(ev("deposit", 1)), lost: rec(ev("withdraw", 9)), moved: rec(ev("deposit", 2, { piggyAddress: PIGGY2 })), hash: rec(ev("withdraw", 3, { piggyAddress: PIGGY2 })),
    failed: rec(ev("deposit", 4, { stepId: "deposit", journeyId: "j.other" })), other: rec(ev("deposit", 5, { forkInstanceId: "fork-old-1" })),
  };
  for (const r of Object.values(rows)) assert.equal((await store.putIfAbsent("evidence", r.key, r)).ok, true);
  const C = chain();
  C.add(1); C.add(2, { block: 110874006 }); C.add(3, { blockHash: bh(77) }); C.add(4, { status: "0x0" }); C.add(5);
  return { store, rows, C };
}
const RESUME = { forkInstanceId: "fork-143-110874000-20261010T193035Z-cfa25f14", snapshotBlock: 110874008, topupsAfterSnapshot: [
  `fork-143-110874000-20261010T193035Z-cfa25f14|${PIGGY}|USDC|a981-ab12cd`, // A-949 Admin ledger key form
  `fork-topup|${FORK}|${PIGGY2}|MON|a956-g1.r1`, // A-956 store key form, already a re-grant once
  `fork-143-110874000-20261009T000000Z-deadbeef|${PIGGY}|MON|g1`, // other instance → not a candidate
] };
await check("4 reconcile: ORPHANED_BY_RESTORE marked (only that class) · OK / MOVED / HASH_CHANGED / OTHER_INSTANCE reported · evidence rows kept", async () => {
  assert.ok(R, "fork-restart-reconcile.js missing");
  const { store, rows, C } = await seeded();
  const before = JSON.stringify(await store.list("evidence"));
  const rep = await R.createForkRestartReconciler({ store, publicRpc: C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(rep.ok, true, JSON.stringify(rep).slice(0, 200));
  const cls = Object.fromEntries(rep.evidence.map((r) => [r.key, r.class]));
  assert.equal(cls[rows.ok.key], "OK"); assert.equal(cls[rows.lost.key], "ORPHANED_BY_RESTORE"); assert.equal(cls[rows.moved.key], "MOVED");
  assert.equal(cls[rows.hash.key], "HASH_CHANGED"); assert.equal(cls[rows.failed.key], "MOVED"); assert.equal(cls[rows.other.key], "OTHER_INSTANCE");
  assert.deepEqual(rep.marked, [rows.lost.key]);
  const orphans = await store.list("orphans");
  assert.equal(orphans.length, 1); assert.equal(orphans[0].evidenceKey, rows.lost.key); assert.equal(orphans[0].reason, "orphaned_by_restore");
  assert.equal(JSON.stringify(await store.list("evidence")), before, "no evidence row deleted or edited");
  assert.equal(rep.executes, false); assert.equal(rep.payout, "none");
  assert.equal(netCalls, 0);
});
await check("4 reconcile: Public READS only (guardInfo / blockNumber / receipts); a run is idempotent (already-orphaned rows skipped, nothing re-marked)", async () => {
  const { store, rows, C } = await seeded();
  const rc = R.createForkRestartReconciler({ store, publicRpc: C.rpc, minIntervalMs: 0, confirmGapMs: 0 });
  await rc.reconcile({ resume: RESUME });
  assert.deepEqual([...new Set(C.calls)].sort(), ["araso_guardInfo", "eth_blockNumber", "eth_chainId", "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt"]);
  const n = C.calls.length;
  const rep2 = await rc.reconcile({ resume: RESUME });
  assert.deepEqual(rep2.marked, []); assert.equal(rep2.evidence.find((r) => r.key === rows.lost.key).class, "ALREADY_ORPHANED");
  assert.ok(C.calls.slice(n).filter((m) => m === "eth_getTransactionReceipt").length === 4, "the orphaned row and the other-instance row are not re-read");
  assert.equal((await store.list("orphans")).length, 1); assert.equal((await store.list("regrants")).length, 2);
  // a reader that is not one of the allowed methods is never reached: the wrapper refuses before calling
  const spy = []; const bad = R.createForkRestartReconciler({ store, publicRpc: async (m) => { spy.push(m); return null; }, minIntervalMs: 0, confirmGapMs: 0 });
  assert.equal(typeof bad.adminTopup, "undefined");
  assert.equal(R.PUBLIC_READ_METHODS.includes("eth_sendRawTransaction"), false);
});
await check("4 reconcile: TOPUP_AFTER_SNAPSHOT → re-grant CANDIDATE row under a new grantVersion (executes:false); other-instance key skipped; no Admin, no payout", async () => {
  const { store, C } = await seeded();
  const rep = await R.createForkRestartReconciler({ store, publicRpc: C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.deepEqual(rep.topups.map((t) => t.class), ["TOPUP_AFTER_SNAPSHOT", "TOPUP_AFTER_SNAPSHOT", "TOPUP_OTHER_INSTANCE"]);
  const rg = await store.list("regrants");
  assert.equal(rg.length, 2);
  const usdc = rg.find((r) => r.asset === "USDC"); const mon = rg.find((r) => r.asset === "MON");
  assert.equal(usdc.previousGrantVersion, "a981-ab12cd"); assert.equal(usdc.grantVersion, "a981-ab12cd.r1"); assert.equal(usdc.piggyAddress, PIGGY);
  assert.equal(mon.previousGrantVersion, "a956-g1.r1"); assert.equal(mon.grantVersion, "a956-g1.r2");
  for (const r of rg) { assert.equal(r.executes, false); assert.equal(r.kind, L.KIND.REGRANT); assert.equal(r.forkInstanceId, FORK); assert.equal(r.reason, "topup_after_snapshot"); }
  assert.equal((await store.list("topups")).length, 0, "no top-up outcome written"); assert.equal((await store.list("payouts")).length, 0);
  assert.equal((await store.list("rewards")).length, 0);
});
await check("4 reconcile: resume record of ANOTHER instance → no candidates; instance changes during the run → abort, nothing marked", async () => {
  const { store, C } = await seeded();
  const rep = await R.createForkRestartReconciler({ store, publicRpc: C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: { ...RESUME, forkInstanceId: "fork-other-2" } });
  assert.equal(rep.ok, true); assert.equal(rep.topups.length, 0); assert.equal((await store.list("regrants")).length, 0);
  assert.equal(rep.marked.length, 0, "[review fix 1] without a resume record of THIS instance, a row above the restored head is not marked");
  assert.equal(rep.evidence.find((e) => e.txHash === tx(9)).class, "NOT_YET_SYNCED");
  const s1 = await seeded(); s1.C.st.head = 110874020;
  const rh = await R.createForkRestartReconciler({ store: s1.store, publicRpc: s1.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({});
  assert.equal(rh.marked.length, 1, "head past the row + confirmed absent → marked without a resume record");
  const s2 = await seeded(); s2.C.st.flipAfter = 3;
  const r2 = await R.createForkRestartReconciler({ store: s2.store, publicRpc: s2.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(r2.ok, false); assert.equal(r2.reason, "fork_instance_changed");
  assert.equal((await s2.store.list("orphans")).length, 0); assert.equal((await s2.store.list("regrants")).length, 0);
  const r3 = await R.createForkRestartReconciler({ store: s2.store, publicRpc: async () => { throw new Error("down"); }, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({});
  assert.equal(r3.ok, false); assert.equal(r3.reason, "public_unavailable");
});
await check("4 reconcile: rewards resting on an orphaned journey are LISTED for review, never changed", async () => {
  const store = S.createMemoryForkLedgerStore();
  const d = rec(ev("deposit", 1)); const w = rec(ev("withdraw", 9));
  for (const r of [d, w]) await store.putIfAbsent("evidence", r.key, r);
  const v = journeyVerdict({ ...AAVE, context: { ...CTX, testerId: "tester-7" }, evidence: [d, w] });
  const ap = rewardLedgerApply(rewardLedgerEmpty(), { testerId: "tester-7", rewardCampaignVersion: "camp-1", verdict: v });
  await store.putIfAbsent("rewards", ap.key, ap.record);
  const C = chain({ head: 110874020 }); C.add(1);
  const rep = await R.createForkRestartReconciler({ store, publicRpc: C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({});
  assert.deepEqual(rep.rewardsToReview, [ap.key]);
  assert.equal((await store.list("rewards")).length, 1); assert.deepEqual(await store.get("rewards", ap.key), ap.record);
});
// ---- review fix 1: a null receipt alone never orphans ---------------------------------------------------------------------------
await check("review fix 1: lagging node (null then receipt) · pending tx · RPC error → NOT marked; wrong chainId → abort; confirmed absence → marked", async () => {
  const a = await seeded(); a.C.st.lateReceipt.add(tx(9));
  const ra = await R.createForkRestartReconciler({ store: a.store, publicRpc: a.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(ra.evidence.find((e) => e.txHash === tx(9)).class, "OK", "the confirm read found it"); assert.deepEqual(ra.marked, []);
  const b = await seeded(); b.C.st.pendingTx.add(tx(9));
  const rb = await R.createForkRestartReconciler({ store: b.store, publicRpc: b.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(rb.evidence.find((e) => e.txHash === tx(9)).class, "NOT_CONFIRMED"); assert.deepEqual(rb.marked, []);
  const c = await seeded(); c.C.st.throwFor.add(tx(9)); c.C.st.throwFor.add(tx(1));
  const rcx = await R.createForkRestartReconciler({ store: c.store, publicRpc: c.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(rcx.ok, true); assert.equal(rcx.evidence.find((e) => e.txHash === tx(9)).class, "READ_ERROR"); assert.equal(rcx.evidence.find((e) => e.txHash === tx(1)).class, "READ_ERROR");
  assert.deepEqual(rcx.marked, []); assert.equal((await c.store.list("orphans")).length, 0);
  const d = await seeded(); d.C.st.chainId = 143;
  const rd = await R.createForkRestartReconciler({ store: d.store, publicRpc: d.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(rd.ok, false); assert.equal(rd.reason, "wrong_chain"); assert.equal((await d.store.list("orphans")).length, 0);
  const e = await seeded();
  const re = await R.createForkRestartReconciler({ store: e.store, publicRpc: e.C.rpc, minIntervalMs: 0, confirmGapMs: 0 }).reconcile({ resume: RESUME });
  assert.equal(e.C.st.seen.get(tx(9)), 2, "two receipt reads before marking"); assert.equal(re.marked.length, 1);
});
// ---- review fix 2: an orphan marker never hides an INVALID row ----------------------------------------------------------------
await check("review fix 2: orphaned foreign-instance / pre-fork / unknown-step row in the chosen journey stays INVALID", () => {
  const d = rec(ev("deposit", 1)); const w = rec(ev("withdraw", 2));
  const ctx = { ...CTX, testerId: "tester-7" };
  for (const [bad, reason] of [[rec(ev("withdraw", 3, { forkInstanceId: "fork-old-1" })), "fork_instance_mismatch"], [rec(ev("withdraw", 4, { blockNumber: 100 })), "pre_fork_evidence"], [rec(ev("other", 5)), "unknown_step"]]) {
    const v = journeyVerdict({ ...AAVE, context: ctx, evidence: [d, w, bad], orphaned: [bad.key] });
    assert.equal(v.verdict, VERDICT.INVALID, reason); assert.equal(v.reason, reason);
  }
});
// ---- review fix 3: re-grant version never collides with an existing top-up ----------------------------------------------------
await check("review fix 3: candidate grantVersion skips versions already in topups / regrants; a rerun reuses the same candidate", async () => {
  const { store, C } = await seeded();
  for (const gv of ["a981-ab12cd.r1", "a981-ab12cd.r2"]) { const t = L.topupRecord({ forkInstanceId: FORK, piggyAddress: PIGGY, asset: "USDC", grantVersion: gv, testerId: "tester-7", amountRaw: "10000000" }); await store.putIfAbsent("topups", t.key, t.record); }
  const rc = R.createForkRestartReconciler({ store, publicRpc: C.rpc, minIntervalMs: 0, confirmGapMs: 0 });
  await rc.reconcile({ resume: RESUME });
  const usdc = (await store.list("regrants")).filter((r) => r.asset === "USDC");
  assert.equal(usdc.length, 1); assert.equal(usdc[0].grantVersion, "a981-ab12cd.r3"); assert.equal(usdc[0].previousGrantVersion, "a981-ab12cd");
  await rc.reconcile({ resume: RESUME });
  assert.equal((await store.list("regrants")).filter((r) => r.asset === "USDC").length, 1, "idempotent: same lost top-up = same candidate");
  assert.equal(L.regrantRecord({ forkInstanceId: FORK, piggyAddress: PIGGY, asset: "USDC", previousGrantVersion: "g1.r2", grantVersion: "g1.r1", reason: "topup_after_snapshot" }).ok, false, "never a version at or below the previous");
  assert.equal(L.regrantRecord({ forkInstanceId: FORK, piggyAddress: PIGGY, asset: "USDC", previousGrantVersion: "g1", grantVersion: "h1.r1", reason: "topup_after_snapshot" }).ok, false, "same base only");
});
await check("source: reconcile module imports only the ledger contracts; no Admin client, no write RPC, no payout, no delete", () => {
  const t = src("api/_lib/fork-restart-reconcile.js").replace(/^\s*\/\/.*$/gm, "");
  const imports = [...t.matchAll(/\bimport\b[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./fork-ledger-contract.js", "./fork-ledger-store-contract.js"]);
  assert.doesNotMatch(t, /fork-grant-client|\/admin\/|adminTopup|sendRawTransaction|eth_sendTransaction|anvil_|evm_|payoutRecord|\.delete\(|\bfetch\b|process\.env/);
  assert.doesNotMatch(t, /putIfAbsent\("(evidence|topups|rewards|payouts|stamps)"/, "writes only orphans / regrants");
});

console.log(`\nA-993 fork restart reconcile: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
