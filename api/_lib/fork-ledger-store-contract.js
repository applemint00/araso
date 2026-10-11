// [A-952] Fork ledger STORE contract: the interface card E's storage adapter must satisfy + an in-memory implementation for
// tests ONLY. No vendor, no KV, no env, no network, no file I/O. Precedent: grant-store-contract.js (contract id + shape check
// + testOnly synthetic adapter).
//
// Interface (all async, like a KV adapter):
//   get(collection, key)                -> stored value | null
//   putIfAbsent(collection, key, value) -> { ok:true, created:true } | { ok:false, reason:"exists", existing } | { ok:false, reason:"bad_*" }
//                                          ONE atomic insert-if-missing (KV: SET NX). Never overwrites. There is no put/update/delete.
//   list(collection)                    -> stored values, ordered by key
// Collections are fixed and kept apart; a key must carry its collection's prefix, so payout rows can never land among fork evidence:
//   evidence "fork-evidence|…" · rewards "reward|…" · payouts "payout|…" · stamps "fork-stamp|…" · [A-956] entries "fork-entry|…" · topups "fork-topup|…" · entryPiggies "fork-entry-piggy|…" · journey1Uses "fork-j1|…"
//   [A-993] orphans "fork-orphan|…" (append-only marker per evidence row lost by a fork restore) · regrants "fork-regrant|…" (re-grant candidates, executes:false)
// The key must also EQUAL the key the contract rebuilds from the value (evidenceRecord / rewardKey / payoutRecord / stampRecord),
// and the value's key fields must already be canonical — so "reward|a|v1 " or "reward|a|v1|x" can never sit next to "reward|a|v1".
// A production adapter must make putIfAbsent atomic across instances; an in-memory / no-store fallback is not allowed in production.

import { KEY_PREFIX, KIND, entryPiggyRecord, entryRecord, evidenceRecord, journey1UseRecord, orphanRecord, payoutRecord, regrantRecord, rewardKey, stampRecord, topupRecord } from "./fork-ledger-contract.js";

export const FORK_LEDGER_STORE_CONTRACT = "araso.fork-ledger-store/v1";
export const FORK_LEDGER_COLLECTIONS = Object.freeze({
  evidence: Object.freeze({ prefix: KEY_PREFIX.EVIDENCE, kind: KIND.EVIDENCE }),
  rewards: Object.freeze({ prefix: KEY_PREFIX.REWARD, kind: KIND.REWARD }),
  payouts: Object.freeze({ prefix: KEY_PREFIX.PAYOUT, kind: KIND.PAYOUT }),
  stamps: Object.freeze({ prefix: KEY_PREFIX.STAMP, kind: KIND.STAMP }),
  entries: Object.freeze({ prefix: KEY_PREFIX.ENTRY, kind: KIND.ENTRY }), // [A-956] Journey 2 entry (one Piggy per tester per fork instance)
  topups: Object.freeze({ prefix: KEY_PREFIX.TOPUP, kind: KIND.TOPUP }), // [A-956] fork top-up outcome (one per fork + Piggy + asset + grantVersion)
  entryPiggies: Object.freeze({ prefix: KEY_PREFIX.ENTRY_PIGGY, kind: KIND.ENTRY_PIGGY }), // [A-956] one tester per Piggy per fork instance
  journey1Uses: Object.freeze({ prefix: KEY_PREFIX.JOURNEY1_USE, kind: KIND.JOURNEY1_USE }), // [A-956] one tester per Journey 1 tx
  orphans: Object.freeze({ prefix: KEY_PREFIX.ORPHAN, kind: KIND.ORPHAN }), // [A-993] one marker per orphaned evidence row (the row is kept)
  regrants: Object.freeze({ prefix: KEY_PREFIX.REGRANT, kind: KIND.REGRANT }), // [A-993] one candidate per fork + Piggy + asset + new grantVersion
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const KEY_MAX = 400;

/** Shape check for any adapter (memory now, KV in card E). */
export function isForkLedgerStore(store) {
  return !!store && store.contract === FORK_LEDGER_STORE_CONTRACT && ["get", "putIfAbsent", "list"].every((m) => typeof store[m] === "function");
}

// Rebuild { key, fields } from a value with the contract's own key function, per collection.
const REBUILD = Object.freeze({
  evidence: (v) => { const r = evidenceRecord(v); return r.ok ? { key: r.key, fields: r.record } : null; },
  rewards: (v) => { const r = rewardKey(v); return r.ok ? { key: r.key, fields: r.fields } : null; },
  payouts: (v) => { const r = payoutRecord({ rewardKey: v.rewardKey, mainnetTxHash: v.mainnetTxHash, amount: v.amount, ownerNote: v.ownerNote }); return r.ok ? { key: r.key, fields: r.record } : null; },
  stamps: (v) => { const r = stampRecord(v); return r.ok ? { key: r.key, fields: r.record } : null; },
  entries: (v) => { const r = entryRecord(v); return r.ok ? { key: r.key, fields: r.record } : null; }, // [A-956]
  topups: (v) => { const r = topupRecord(v); return r.ok ? { key: r.key, fields: r.record } : null; }, // [A-956]
  entryPiggies: (v) => { const r = entryPiggyRecord(v); return r.ok ? { key: r.key, fields: r.record } : null; }, // [A-956]
  journey1Uses: (v) => { const r = journey1UseRecord(v); return r.ok ? { key: r.key, fields: r.record } : null; }, // [A-956]
  orphans: (v) => { const r = orphanRecord({ evidenceKey: v.evidenceKey, reason: v.reason }); return r.ok ? { key: r.key, fields: r.record } : null; }, // [A-993]
  regrants: (v) => { const r = regrantRecord({ forkInstanceId: v.forkInstanceId, piggyAddress: v.piggyAddress, asset: v.asset, previousGrantVersion: v.previousGrantVersion, grantVersion: v.grantVersion, reason: v.reason }); return r.ok ? { key: r.key, fields: r.record } : null; }, // [A-993]
});

/** Pure validation every adapter applies before touching storage. -> null when fine, else a reason. */
export function storeWriteProblem(collection, key, value) {
  const c = Object.prototype.hasOwnProperty.call(FORK_LEDGER_COLLECTIONS, collection) ? FORK_LEDGER_COLLECTIONS[collection] : null;
  if (!c) return "bad_collection";
  if (typeof key !== "string" || key.length > KEY_MAX || !key.startsWith(c.prefix)) return "bad_key";
  if (!isObj(value) || value.kind !== c.kind || value.key !== key) return "bad_value";
  const rebuilt = REBUILD[collection](value);
  if (!rebuilt) return "bad_value";
  if (rebuilt.key !== key) return "key_not_canonical";
  for (const [f, want] of Object.entries(rebuilt.fields)) if (value[f] !== want) return "value_not_canonical";
  return null;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };

/** In-memory adapter. TEST ONLY (testOnly: true). Values are copied on write and frozen copies are returned on read. */
export function createMemoryForkLedgerStore() {
  const data = new Map(Object.keys(FORK_LEDGER_COLLECTIONS).map((c) => [c, new Map()]));
  const col = (c) => (Object.prototype.hasOwnProperty.call(FORK_LEDGER_COLLECTIONS, c) ? data.get(c) : null);
  return {
    contract: FORK_LEDGER_STORE_CONTRACT,
    kind: "memory",
    testOnly: true,
    async get(collection, key) {
      const m = col(collection); if (!m || typeof key !== "string") return null;
      return m.has(key) ? deepFreeze(clone(m.get(key))) : null;
    },
    async putIfAbsent(collection, key, value) {
      const problem = storeWriteProblem(collection, key, value);
      if (problem) return { ok: false, reason: problem };
      const m = col(collection);
      if (m.has(key)) return { ok: false, reason: "exists", existing: deepFreeze(clone(m.get(key))) };
      m.set(key, clone(value)); // check + insert in one synchronous step = atomic within this process
      return { ok: true, created: true };
    },
    async list(collection) {
      const m = col(collection); if (!m) return [];
      return [...m.keys()].sort().map((k) => deepFreeze(clone(m.get(k))));
    },
  };
}
