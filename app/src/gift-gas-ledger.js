// [A-858] giftId-scoped, exactly-once MON gas-delivery ledger (app side). Pure module: no network,
// no signing, no clock default beyond an injected `now`. See A-854 invariants I1-I3 (+ I2 reserve-
// before-send, same shape as relayer/src/ledger.mjs).
//
// State machine (V1 = exactly-once per giftId; there is no N-retry path):
//   (none) --reserve--> PENDING --confirm--> CONFIRMED (terminal)
//   PENDING --markUnknown--> UNKNOWN --confirm (only via reconcile with chain proof)--> CONFIRMED
//   [A-895 P-B] The ONE exception: release() deletes a PENDING entry that has NO txHash, on this device, when the caller
//   holds proof that nothing was sent (a definite pre-action refusal). Nothing with a txHash, and nothing UNKNOWN or
//   CONFIRMED, is ever released.
//   Otherwise nothing returns to "(none)". PENDING/UNKNOWN never lets a second deliver() happen: the only
//   exit is reconcile() finding the delivery on chain. A lost tx hash (crash between send and
//   markSent) stays blocked until a human decides (not automated here).
//
// The browser ledger only protects ONE device. A different device has its own store; the
// cross-device barrier is the server-side ledger (relayer/src/gift-gas-ledger.mjs).
// Entries never carry a token, salt or preimage.

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const STATES = new Set(["PENDING", "CONFIRMED", "UNKNOWN"]);

export const GIFT_GAS_LEDGER_REASON = Object.freeze({
  LEDGER_UNAVAILABLE: "ledger_unavailable",
  MUST_RECONCILE: "must_reconcile",
  ALREADY_DELIVERED: "already_delivered",
  BOUND_TO_OTHER_DESTINATION: "bound_to_other_destination",
  BOUND_TO_OTHER_DEVICE: "bound_to_other_device",
  BAD_INPUT: "bad_input",
  NOT_FOUND: "not_found",
  BAD_STATE: "bad_state",
});
const R = GIFT_GAS_LEDGER_REASON;

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const key = (giftId) => (typeof giftId === "string" && BYTES32.test(giftId) ? giftId.toLowerCase() : null);
const addr = (a) => (typeof a === "string" && ADDR.test(a) ? a.toLowerCase() : null);
const lc = (a) => (typeof a === "string" ? a.toLowerCase() : "");

/** Throws on any schema violation; the ledger turns a throw into ledger_unavailable (fail closed). */
export function validateLedgerData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 1
    || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) throw new Error("LEDGER_SCHEMA");
  for (const [k, e] of Object.entries(data.entries)) {
    if (!BYTES32.test(k) || k !== k.toLowerCase()) throw new Error("LEDGER_SCHEMA: key");
    if (!e || typeof e !== "object" || Array.isArray(e) || e.giftId !== k) throw new Error("LEDGER_SCHEMA: entry");
    if (!ADDR.test(e.to) || e.to !== e.to.toLowerCase()) throw new Error("LEDGER_SCHEMA: to");
    if (typeof e.valueWei !== "string" || !/^[0-9]+$/.test(e.valueWei) || BigInt(e.valueWei) <= 0n) throw new Error("LEDGER_SCHEMA: valueWei");
    if (!STATES.has(e.state)) throw new Error("LEDGER_SCHEMA: state");
    if (!(e.txHash === null || (typeof e.txHash === "string" && BYTES32.test(e.txHash)))) throw new Error("LEDGER_SCHEMA: txHash");
    if (e.state === "CONFIRMED" && e.txHash === null) throw new Error("LEDGER_SCHEMA: confirmed without txHash");
    if (typeof e.deviceId !== "string" || !e.deviceId) throw new Error("LEDGER_SCHEMA: deviceId");
  }
  return data;
}

/**
 * Test/in-memory store. Holds the serialized JSON (so a "crash" = a new ledger over the same store
 * and corruption is injectable). `transact(fn)` is serialized per store: fn(data) -> { data, result }.
 */
export function createMemoryGiftGasStore() {
  let raw = null;
  let tail = Promise.resolve();
  const ctl = { unavailable: false, failSaves: 0 };
  const store = {
    ctl,
    corrupt() { raw = "{not json"; },
    snapshot() { return raw === null ? null : JSON.parse(raw); },
    async transact(fn) {
      const run = tail.then(async () => {
        if (ctl.unavailable) throw new Error("STORE_UNAVAILABLE");
        const data = raw === null ? { version: 1, entries: {} } : JSON.parse(raw);
        const out = fn(data);
        if (out.write) {
          if (ctl.failSaves > 0) { ctl.failSaves -= 1; throw new Error("STORE_WRITE_FAILED"); }
          raw = JSON.stringify(out.data);
        }
        return out.result;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return store;
}

/** localStorage-backed store. Requires navigator.locks (null without it); always reads back after a write. */
export function createBrowserGiftGasStore(storage, { storageKey = "araso.giftGasLedger.v1", locks = globalThis.navigator?.locks } = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return null;
  // Without a cross-tab lock the localStorage read-modify-write races across tabs: refuse to build the store.
  if (!locks || typeof locks.request !== "function") return null;
  const run = (fn) => {
    const body = async () => {
      const text = storage.getItem(storageKey);
      const data = text === null ? { version: 1, entries: {} } : JSON.parse(text);
      const out = fn(data);
      if (out.write) {
        const next = JSON.stringify(out.data);
        storage.setItem(storageKey, next);
        if (storage.getItem(storageKey) !== next) throw new Error("STORE_READBACK_MISMATCH");
      }
      return out.result;
    };
    return locks.request(storageKey, body);
  };
  return { transact: run };
}

export function createGiftGasLedger({ store, deviceId, now = () => new Date().toISOString() } = {}) {
  if (!store || typeof store.transact !== "function") return null;
  if (typeof deviceId !== "string" || !deviceId) return null;

  // Every operation = one atomic, schema-validated transaction. Any throw => ledger_unavailable.
  async function tx(fn) {
    try {
      return await store.transact((data) => {
        validateLedgerData(data);
        const out = fn(data);
        if (out.write) validateLedgerData(out.data);
        return out;
      });
    } catch {
      return fail(R.LEDGER_UNAVAILABLE);
    }
  }
  const touch = (e) => { e.updatedAt = now(); };

  return Object.freeze({
    deviceId,
    /** Reserve BEFORE deliver(). ok:true only after the PENDING row is durable; binds the first destination. */
    async reserve(giftId, to, valueWei) {
      const k = key(giftId);
      const dest = addr(to);
      const value = typeof valueWei === "bigint" ? valueWei : null;
      if (!k || !dest || value === null || value <= 0n) return fail(R.BAD_INPUT);
      return tx((data) => {
        const e = data.entries[k];
        if (!e) {
          data.entries[k] = { giftId: k, to: dest, valueWei: value.toString(), state: "PENDING", txHash: null, deviceId, reservedAt: now(), updatedAt: now() };
          return { write: true, data, result: { ok: true, state: "PENDING", reserved: true } };
        }
        if (e.to !== dest) return { result: fail(R.BOUND_TO_OTHER_DESTINATION) };
        if (e.deviceId !== deviceId) return { result: fail(R.BOUND_TO_OTHER_DEVICE) };
        if (e.state === "CONFIRMED") return { result: fail(R.ALREADY_DELIVERED, { state: e.state, txHash: e.txHash }) };
        return { result: fail(R.MUST_RECONCILE, { state: e.state, txHash: e.txHash }) };
      });
    },
    /**
     * Persist the hash the moment deliver() returns, before any receipt check.
     * [A-895 P-B] Optional `valueWei` (bigint): the server-echoed amount that was actually sent. It replaces the reserved
     * value on the first hash write only, so a later reconcile() checks the chain against the echoed amount.
     */
    async markSent(giftId, txHash, valueWei) {
      const k = key(giftId);
      if (!k || typeof txHash !== "string" || !BYTES32.test(txHash)) return fail(R.BAD_INPUT);
      if (valueWei !== undefined && (typeof valueWei !== "bigint" || valueWei <= 0n)) return fail(R.BAD_INPUT);
      return tx((data) => {
        const e = data.entries[k];
        if (!e) return { result: fail(R.NOT_FOUND) };
        if (e.state === "CONFIRMED" || (e.txHash && e.txHash !== txHash)) return { result: e.txHash === txHash ? { ok: true, state: e.state } : fail(R.BAD_STATE, { state: e.state }) };
        const firstHash = e.txHash === null;
        e.txHash = txHash;
        if (valueWei !== undefined && firstHash) e.valueWei = valueWei.toString();
        touch(e);
        return { write: true, data, result: { ok: true, state: e.state } };
      });
    },
    /**
     * [A-895 P-B] Provably-not-sent release. Deletes ONLY a PENDING entry with no txHash that this device reserved.
     * Anything else (UNKNOWN, CONFIRMED, has a hash, other device, missing) is refused and left untouched.
     */
    async release(giftId) {
      const k = key(giftId);
      if (!k) return fail(R.BAD_INPUT);
      return tx((data) => {
        const e = data.entries[k];
        if (!e) return { result: fail(R.NOT_FOUND) };
        if (e.deviceId !== deviceId) return { result: fail(R.BOUND_TO_OTHER_DEVICE) };
        if (e.state !== "PENDING" || e.txHash !== null) return { result: fail(R.BAD_STATE, { state: e.state }) };
        delete data.entries[k];
        return { write: true, data, result: { ok: true, released: true } };
      });
    },
    async confirm(giftId, txHash) {
      const k = key(giftId);
      if (!k || typeof txHash !== "string" || !BYTES32.test(txHash)) return fail(R.BAD_INPUT);
      return tx((data) => {
        const e = data.entries[k];
        if (!e) return { result: fail(R.NOT_FOUND) };
        if (e.state === "CONFIRMED") return { result: e.txHash === txHash ? { ok: true, state: "CONFIRMED" } : fail(R.BAD_STATE, { state: e.state }) };
        if (e.txHash && e.txHash !== txHash) return { result: fail(R.BAD_STATE, { state: e.state }) };
        e.txHash = txHash; e.state = "CONFIRMED"; touch(e);
        return { write: true, data, result: { ok: true, state: "CONFIRMED" } };
      });
    },
    async markUnknown(giftId) {
      const k = key(giftId);
      if (!k) return fail(R.BAD_INPUT);
      return tx((data) => {
        const e = data.entries[k];
        if (!e) return { result: fail(R.NOT_FOUND) };
        if (e.state !== "PENDING") return { result: { ok: true, state: e.state } };
        e.state = "UNKNOWN"; touch(e);
        return { write: true, data, result: { ok: true, state: "UNKNOWN" } };
      });
    },
    async get(giftId) {
      const k = key(giftId);
      if (!k) return fail(R.BAD_INPUT);
      return tx((data) => {
        const e = data.entries[k];
        return { result: e ? { ok: true, entry: Object.freeze({ ...e }) } : fail(R.NOT_FOUND) };
      });
    },
    /**
     * Re-verify a recorded delivery on chain. `chainReader` = { getTransaction, waitForTransactionReceipt }.
     * Only a successful receipt of a plain transfer of exactly the reserved value to the bound
     * destination yields CONFIRMED. Anything else stays blocked (PENDING/UNKNOWN) — never "go deliver again".
     */
    async reconcile(giftId, { chainReader } = {}) {
      const k = key(giftId);
      if (!k) return fail(R.BAD_INPUT);
      const cur = await this.get(giftId);
      if (!cur.ok) return cur;
      const e = cur.entry;
      if (e.state === "CONFIRMED") return { ok: true, state: "CONFIRMED", txHash: e.txHash };
      if (e.deviceId !== deviceId) return fail(R.BOUND_TO_OTHER_DEVICE);
      if (!e.txHash) return fail(R.MUST_RECONCILE, { state: e.state, detail: "no_tx_hash" });
      if (!chainReader || typeof chainReader.getTransaction !== "function" || typeof chainReader.waitForTransactionReceipt !== "function") {
        return fail(R.MUST_RECONCILE, { state: e.state, detail: "no_chain_reader" });
      }
      let receipt = null;
      let t = null;
      try {
        receipt = await chainReader.waitForTransactionReceipt({ hash: e.txHash });
        t = await chainReader.getTransaction({ hash: e.txHash });
      } catch {
        return fail(R.MUST_RECONCILE, { state: e.state, detail: "chain_unreadable" });
      }
      const matches = receipt && receipt.status === "success" && t && lc(t.to) === e.to
        && typeof t.value === "bigint" && t.value === BigInt(e.valueWei) && (t.input ?? "0x") === "0x";
      if (!matches) {
        await this.markUnknown(giftId);
        return fail(R.MUST_RECONCILE, { state: "UNKNOWN", detail: "not_verified_on_chain" });
      }
      const c = await this.confirm(giftId, e.txHash);
      return c.ok ? { ok: true, state: "CONFIRMED", txHash: e.txHash } : c;
    },
  });
}
