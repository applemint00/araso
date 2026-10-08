// [A-792] Deterministic LOCAL TEST adapter for the api/grant.js durable-store contract (GRANT_STORE_CONTRACT).
// TEST-ONLY. It is NOT durable and NOT shared across processes/instances — it is exactly-once only inside this
// one Node process, which is all a test needs. It is never registered in DURABLE_GRANT_STORE_BACKENDS and no
// env/config value can select it; tests inject it with createGrantHandler({ store, policy }).
// It also carries `testOnly: true`, so the handler refuses it when production markers (VERCEL / NODE_ENV) are set.
//
// Atomicity model: JS runs one task at a time, so a reserve() whose check-and-insert happens in ONE synchronous
// block (no await in between) is atomic against every other reserve() in this process. The optional `yields`
// before the critical section only shuffles arrival order to make races real — it never splits check and insert.
// Lives in app/test/helpers/ so app/test/run-all.mjs (top-level *.mjs only) never runs it as a suite.

export const LOCAL_TEST_STORE_KIND = "local-test-memory";

export function createLocalTestGrantStore({ contract, yields = 0 } = {}) {
  if (typeof contract !== "string") throw new Error("createLocalTestGrantStore: pass GRANT_STORE_CONTRACT");
  const reservations = new Map(); // identity → { reservationId, seq, outcome, txHash }
  const settles = []; // { identity, reservationId, outcome, txHash }
  const reserveCalls = []; // identity per reserve() call, arrival order
  let seq = 0;
  let failSettle = false;

  const pause = async (n) => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
  };

  return {
    contract,
    kind: LOCAL_TEST_STORE_KIND,
    testOnly: true,
    async reserve({ identity, globalCap }) {
      reserveCalls.push(identity);
      await pause(typeof yields === "function" ? yields(reserveCalls.length) : yields);
      // ---- critical section: check + insert in one synchronous block (atomic within this process) ----
      if (reservations.has(identity)) return { ok: false, reason: "duplicate" };
      if (reservations.size >= globalCap) return { ok: false, reason: "cap_reached" };
      seq += 1;
      const reservationId = `local-test-${seq}`;
      reservations.set(identity, { reservationId, seq, outcome: null, txHash: null });
      // ---- end critical section ----
      return { ok: true, reservationId };
    },
    async settle({ identity, reservationId, outcome, txHash }) {
      if (failSettle) throw new Error("local-test: settle down");
      const r = reservations.get(identity);
      if (!r || r.reservationId !== reservationId) throw new Error("local-test: settle for unknown reservation");
      r.outcome = outcome;
      r.txHash = txHash ?? null;
      settles.push({ identity, reservationId, outcome, txHash: txHash ?? null });
      // Record only. The slot is never released (no automatic re-grant).
    },
    // ---- test introspection (not part of the contract) ----
    size: () => reservations.size,
    get: (identity) => reservations.get(identity) ?? null,
    settles: () => settles.slice(),
    reserveCalls: () => reserveCalls.slice(),
    setFailSettle(v) {
      failSettle = !!v;
    },
  };
}
