// [A-993] Fork RESTART RECONCILE — ledger side only (A-981 RECEIPT proposal 1–4; the screen copy is a separate card + Owner wording).
// A-981 loss window: snapshot → tx → SIGKILL → resume on the SAME forkInstanceId → the tx is gone from the restored chain, but its A-952
// evidence row still names the current instance, so journeyVerdict would count it. This module compares the stored rows with the
// restored chain and records what it finds, append-only:
//   markOrphaned(rowId, reason)  -> appends ONE marker row to "orphans" (putIfAbsent). The evidence row is kept as it is; nothing is
//                                   deleted or edited (the store has no delete/update). journeyVerdict skips marked rows (`orphaned`).
//   reconcile({ resume })        -> reads the chain through the PUBLIC Guard only (araso_guardInfo, eth_blockNumber,
//                                   eth_getTransactionReceipt, eth_getBlockByHash — any other method is refused before the call):
//        OK                   receipt found, same blockNumber, status 0x1 (and same blockHash, block readable, when the row has one)
//        ORPHANED_BY_RESTORE  CONFIRMED absent → markOrphaned(…, "orphaned_by_restore"). [review fix 1] confirmed = eth_chainId is the
//                             fork's · the row is explained by the restore (resume record of THIS instance and the row above its
//                             snapshot block, with head ≥ that block) or the head is at/above the row's block · two receipt reads
//                             (confirmGapMs apart) both null · eth_getTransactionByHash null too
//        NOT_YET_SYNCED       null receipt but the head is below the row and no resume record explains it → not marked
//        NOT_CONFIRMED        the confirm reads disagree (receipt appeared / tx known) → not marked
//        READ_ERROR           an RPC error / bad reply for this row → not marked (a 429 or non-JSON never orphans)
//        MOVED                receipt at another block, or a failed status        → reported only (not marked)
//        HASH_CHANGED         row blockHash ≠ receipt blockHash / block unreadable → reported only (not marked)
//        OTHER_INSTANCE       row of another forkInstanceId (A-952 already refuses it) · ALREADY_ORPHANED (marker exists; not re-read)
//      Top-ups: each key in resume.topupsAfterSnapshot (the A-949 resume record; A-949 or A-956 key form) of THIS instance →
//        TOPUP_AFTER_SNAPSHOT + a RE-GRANT CANDIDATE row ("regrants", new grantVersion = nextGrantVersion, executes:false).
//        Nothing here calls the Admin, tops up, pays, signs or sends. rewardsToReview lists reward keys whose (instance, Piggy, journey)
//        has an orphaned row — listed only, never changed.
//   The instance is read before and after the receipts; if it changed in between, nothing is written ("fork_instance_changed").
import { KIND, ORPHAN_REASON, REGRANT_REASON, nextGrantVersion, orphanRecord, regrantRecord, topupKey } from "./fork-ledger-contract.js";
import { isForkLedgerStore } from "./fork-ledger-store-contract.js";

export const PUBLIC_READ_METHODS = Object.freeze(["araso_guardInfo", "eth_chainId", "eth_blockNumber", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByHash"]);
export const FORK_CHAIN_ID = "31337143"; // A-946 fork chain id
export const RECONCILE_CLASS = Object.freeze({ OK: "OK", ORPHANED_BY_RESTORE: "ORPHANED_BY_RESTORE", MOVED: "MOVED", HASH_CHANGED: "HASH_CHANGED",
  OTHER_INSTANCE: "OTHER_INSTANCE", ALREADY_ORPHANED: "ALREADY_ORPHANED", NOT_YET_SYNCED: "NOT_YET_SYNCED", NOT_CONFIRMED: "NOT_CONFIRMED", READ_ERROR: "READ_ERROR", TOPUP_AFTER_SNAPSHOT: "TOPUP_AFTER_SNAPSHOT", TOPUP_OTHER_INSTANCE: "TOPUP_OTHER_INSTANCE", TOPUP_BAD_KEY: "TOPUP_BAD_KEY" });

const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : null);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const decOf = (q) => { try { return typeof q === "string" || typeof q === "number" ? BigInt(q).toString() : null; } catch { return null; } };

// A top-up key from the A-949 Admin ledger ("<fork>|<piggy>|<ASSET>|<grantVersion>") or the A-956 store ("fork-topup|…") -> fields | null
function parseTopupKey(key) {
  if (typeof key !== "string") return null;
  const p = key.trim().split("|");
  const q = p.length === 5 && p[0] === "fork-topup" ? p.slice(1) : p.length === 4 ? p : null;
  if (!q) return null;
  const t = topupKey({ forkInstanceId: q[0], piggyAddress: q[1], asset: q[2], grantVersion: q[3] });
  return t.ok ? t.fields : null;
}

/**
 * createForkRestartReconciler({ store, publicRpc, minIntervalMs = 60 })
 *   store      : an A-952 fork ledger store (memory in tests, Upstash in production)
 *   publicRpc  : async (method, params) -> result, pointed at the PUBLIC Guard URL (no token). Only PUBLIC_READ_METHODS are ever passed.
 *   minIntervalMs : pause between receipt reads (A-978 per-IP limit 20 req/s; default ≈ 16/s)
 */
export function createForkRestartReconciler({ store, publicRpc, minIntervalMs = 60, confirmGapMs = 1500, expectedChainId = FORK_CHAIN_ID } = {}) {
  if (!isForkLedgerStore(store) || typeof publicRpc !== "function") return null;
  const read = async (method, params = []) => {
    if (!PUBLIC_READ_METHODS.includes(method)) throw new Error("A993_NOT_A_PUBLIC_READ");
    return publicRpc(method, params);
  };
  const pace = () => (minIntervalMs > 0 ? new Promise((r) => setTimeout(r, minIntervalMs)) : null);
  const gap = () => (confirmGapMs > 0 ? new Promise((r) => setTimeout(r, confirmGapMs)) : null);
  const rcOk = (rc) => rc === null || isObj(rc); // anything else = a bad reply (READ_ERROR), never "absent"

  async function markOrphaned(rowId, reason) {
    try {
      if (!Object.values(ORPHAN_REASON).includes(reason)) return { ok: false, reason: "bad_reason" };
      const row = typeof rowId === "string" ? await store.get("evidence", rowId) : null;
      if (!row || row.kind !== KIND.EVIDENCE) return { ok: false, reason: "no_such_row" };
      const o = orphanRecord({ evidenceKey: row.key, reason });
      if (!o.ok) return { ok: false, reason: "bad_row" };
      const put = await store.putIfAbsent("orphans", o.key, o.record);
      if (put.ok) return { ok: true, created: true, key: o.key };
      if (put.reason === "exists") return { ok: true, created: false, key: o.key, existing: put.existing };
      return { ok: false, reason: "store_failed" };
    } catch { return { ok: false, reason: "store_failed" }; }
  }

  async function instanceId() {
    const g = await read("araso_guardInfo", []);
    return isObj(g) ? low(g.forkInstanceId) : null;
  }

  async function reconcile({ resume = null } = {}) {
    let current, head, chainId;
    try { current = await instanceId(); chainId = decOf(await read("eth_chainId", [])); head = decOf(await read("eth_blockNumber", [])); } catch { return { ok: false, reason: "public_unavailable" }; }
    if (!current || head === null) return { ok: false, reason: "public_unavailable" };
    if (chainId !== expectedChainId) return { ok: false, reason: "wrong_chain" }; // [review fix 1]
    const resumeHere = isObj(resume) && low(resume.forkInstanceId) === current && decOf(resume.snapshotBlock) !== null ? BigInt(decOf(resume.snapshotBlock)) : null;
    let all, orphanRows;
    try { all = await store.list("evidence"); orphanRows = await store.list("orphans"); } catch { return { ok: false, reason: "store_failed" }; }
    const orphaned = new Set(orphanRows.map((o) => o.evidenceKey));
    const evidence = []; const toMark = [];
    try {
      for (const row of all) {
        const base = { key: row.key, piggyAddress: row.piggyAddress, journeyId: row.journeyId, stepId: row.stepId, txHash: row.txHash, blockNumber: row.blockNumber, ...(row.blockHash ? { blockHash: row.blockHash } : {}) };
        if (row.forkInstanceId !== current) { evidence.push({ ...base, class: RECONCILE_CLASS.OTHER_INSTANCE }); continue; }
        if (orphaned.has(row.key)) { evidence.push({ ...base, class: RECONCILE_CLASS.ALREADY_ORPHANED }); continue; }
        const afterSnapshotBlock = resumeHere !== null ? BigInt(row.blockNumber) > resumeHere : null;
        let cls = RECONCILE_CLASS.OK;
        try { // [review fix 1] per row: an RPC error / bad reply = READ_ERROR (skipped), never an orphan
          const rc = await read("eth_getTransactionReceipt", [row.txHash]); await pace();
          if (!rcOk(rc)) cls = RECONCILE_CLASS.READ_ERROR;
          else if (rc === null) {
            const explained = (afterSnapshotBlock === true && BigInt(head) >= resumeHere) || BigInt(head) >= BigInt(row.blockNumber);
            if (!explained) cls = RECONCILE_CLASS.NOT_YET_SYNCED;
            else {
              await gap();
              const rc2 = await read("eth_getTransactionReceipt", [row.txHash]); await pace();
              const t = await read("eth_getTransactionByHash", [row.txHash]); await pace();
              if (!rcOk(rc2) || !(t === null || isObj(t))) cls = RECONCILE_CLASS.READ_ERROR;
              else cls = rc2 === null && t === null ? RECONCILE_CLASS.ORPHANED_BY_RESTORE : RECONCILE_CLASS.NOT_CONFIRMED;
              if (isObj(rc2) && decOf(rc2.blockNumber) === row.blockNumber && low(rc2.status) === "0x1" && (!row.blockHash || low(rc2.blockHash) === row.blockHash)) cls = RECONCILE_CLASS.OK;
            }
          } else if (decOf(rc.blockNumber) !== row.blockNumber || low(rc.status) !== "0x1") cls = RECONCILE_CLASS.MOVED;
          else if (row.blockHash) {
            if (low(rc.blockHash) !== row.blockHash) cls = RECONCILE_CLASS.HASH_CHANGED;
            else { const b = await read("eth_getBlockByHash", [row.blockHash, false]); await pace(); if (!isObj(b) || low(b.hash) !== row.blockHash) cls = RECONCILE_CLASS.HASH_CHANGED; }
          }
        } catch (e) { if (String(e && e.message) === "A993_NOT_A_PUBLIC_READ") throw e; cls = RECONCILE_CLASS.READ_ERROR; }
        evidence.push({ ...base, class: cls, afterSnapshotBlock });
        if (cls === RECONCILE_CLASS.ORPHANED_BY_RESTORE) toMark.push(row);
      }
      if ((await instanceId()) !== current) return { ok: false, reason: "fork_instance_changed" }; // a restart during the reads: write nothing
    } catch { return { ok: false, reason: "public_unavailable" }; }

    const marked = [];
    for (const row of toMark) {
      const m = await markOrphaned(row.key, ORPHAN_REASON.ORPHANED_BY_RESTORE);
      if (!m.ok) return { ok: false, reason: m.reason, marked };
      if (m.created) marked.push(row.key);
    }

    const topups = [];
    const sameInstance = isObj(resume) && low(resume.forkInstanceId) === current;
    let used = null; // [review fix 3] grantVersions already used per fork|piggy|asset (topups + regrants) and existing candidates
    if (sameInstance && Array.isArray(resume.topupsAfterSnapshot) && resume.topupsAfterSnapshot.length) {
      try {
        used = { versions: new Map(), candidates: new Map() };
        const slot = (r) => `${r.forkInstanceId}|${r.piggyAddress}|${r.asset}`;
        for (const r of [...await store.list("topups"), ...await store.list("regrants")]) { const k = slot(r); if (!used.versions.has(k)) used.versions.set(k, new Set()); used.versions.get(k).add(r.grantVersion); }
        for (const r of await store.list("regrants")) used.candidates.set(`${slot(r)}|${r.previousGrantVersion}`, r);
      } catch { return { ok: false, reason: "store_failed", marked }; }
    }
    for (const k of sameInstance && Array.isArray(resume.topupsAfterSnapshot) ? resume.topupsAfterSnapshot : []) {
      const t = parseTopupKey(k);
      if (!t) { topups.push({ key: String(k).slice(0, 200), class: RECONCILE_CLASS.TOPUP_BAD_KEY }); continue; }
      if (t.forkInstanceId !== current) { topups.push({ key: k, class: RECONCILE_CLASS.TOPUP_OTHER_INSTANCE }); continue; }
      const slotKey = `${t.forkInstanceId}|${t.piggyAddress}|${t.asset}`;
      const prior = used.candidates.get(`${slotKey}|${t.grantVersion}`);
      if (prior) { topups.push({ key: k, class: RECONCILE_CLASS.TOPUP_AFTER_SNAPSHOT, candidate: prior.key, grantVersion: prior.grantVersion, created: false }); continue; }
      const taken = used.versions.get(slotKey) || new Set();
      let gv = nextGrantVersion(t.grantVersion);
      for (let n = 0; gv && taken.has(gv) && n < 1000; n++) gv = nextGrantVersion(gv);
      if (!gv || taken.has(gv)) { topups.push({ key: k, class: RECONCILE_CLASS.TOPUP_AFTER_SNAPSHOT, candidate: null, reason: "grantVersion" }); continue; }
      const r = regrantRecord({ forkInstanceId: t.forkInstanceId, piggyAddress: t.piggyAddress, asset: t.asset, previousGrantVersion: t.grantVersion, grantVersion: gv, reason: REGRANT_REASON.TOPUP_AFTER_SNAPSHOT });
      if (!r.ok) { topups.push({ key: k, class: RECONCILE_CLASS.TOPUP_AFTER_SNAPSHOT, candidate: null, reason: r.field }); continue; }
      let put; try { put = await store.putIfAbsent("regrants", r.key, r.record); } catch { return { ok: false, reason: "store_failed", marked }; }
      if (!put.ok && put.reason !== "exists") return { ok: false, reason: "store_failed", marked };
      topups.push({ key: k, class: RECONCILE_CLASS.TOPUP_AFTER_SNAPSHOT, candidate: r.key, grantVersion: r.record.grantVersion, created: put.ok === true });
      if (!used.versions.has(slotKey)) used.versions.set(slotKey, new Set()); used.versions.get(slotKey).add(gv); used.candidates.set(`${slotKey}|${t.grantVersion}`, r.record);
    }

    // rewards whose (instance, Piggy, journey) has an orphaned row: LISTED for the Owner / a later card, never changed here
    const lost = evidence.filter((e) => e.class === RECONCILE_CLASS.ORPHANED_BY_RESTORE || e.class === RECONCILE_CLASS.ALREADY_ORPHANED);
    let rewardsToReview = [];
    if (lost.length) {
      try {
        rewardsToReview = (await store.list("rewards")).filter((r) => r.forkInstanceId === current && lost.some((e) => e.piggyAddress === r.piggyAddress && e.journeyId === r.journeyId)).map((r) => r.key);
      } catch { return { ok: false, reason: "store_failed", marked }; }
    }
    const count = evidence.reduce((m, e) => ((m[e.class] = (m[e.class] || 0) + 1), m), {});
    return { ok: true, forkInstanceId: current, restoredHead: head, resumeUsed: sameInstance, evidence, classes: count, marked, topups, rewardsToReview, executes: false, payout: "none" };
  }

  return Object.freeze({ markOrphaned, reconcile });
}
