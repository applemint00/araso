// A-870 — grant durable store contract conformance (synthetic adapter only; no provider, no network).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRANT_STORE_CONTRACT_V1, GRANT_SETTLE_OUTCOMES, DEFAULT_EPOCH, decideRelease, decideSettle,
  createSyntheticRemote, createSyntheticStoreInstance, runGrantStoreConformance,
} from "../../api/_lib/grant-store-contract.js";
import { GRANT_STORE_CONTRACT, GRANT_SETTLE_OUTCOMES as G_OUT, DURABLE_GRANT_STORE_BACKENDS } from "../../api/grant.js";

// A-792 compatibility (read-only look at api/grant.js exports)
assert.equal(GRANT_STORE_CONTRACT_V1, GRANT_STORE_CONTRACT);
assert.deepEqual([...GRANT_SETTLE_OUTCOMES], [...G_OUT]);
assert.equal(Object.keys(DURABLE_GRANT_STORE_BACKENDS).length, 0, "no provider selected");
assert.equal(DEFAULT_EPOCH, "default");
assert.equal(decideSettle({ outcome: "send_failed" }, { kind: "reconcile", outcome: "aborted_before_send", broadcast: true }).reason, "never_to_aborted");
assert.equal(decideSettle({ outcome: "send_failed" }, { kind: "settle", outcome: "confirmed" }).reason, "write_once");
assert.equal(decideSettle({ outcome: null, released: true }, { kind: "settle", outcome: "confirmed" }).reason, "released");
assert.equal(decideSettle({ outcome: "send_failed" }, { kind: "reconcile", outcome: "confirmed" }).reason, "evidence_required");
assert.deepEqual(decideRelease(null), { ok: false, reason: "not_found" });

let fails = 0;
for (const yieldMs of [0, 1]) {
  const make = async (n = 2) => {
    const remote = createSyntheticRemote();
    return Array.from({ length: n }, () => createSyntheticStoreInstance(remote, { yieldMs }));
  };
  const results = await runGrantStoreConformance(make);
  for (const r of results) {
    if (!r.pass) fails++;
    console.log(`${r.pass ? "PASS" : "FAIL"} [y${yieldMs}] ${r.name}${r.pass ? "" : " :: " + r.detail}`);
  }
}

// negative control: a non-atomic adapter MUST fail the race checks (harness has teeth)
{
  const rows = new Map();
  const naive = () => ({
    ...createSyntheticStoreInstance(createSyntheticRemote()),
    async reserve({ identity, globalCap, epoch = "default" }) {
      const seen = rows.has(epoch + identity);
      const n = [...rows.values()].filter((e) => e === epoch).length;
      await new Promise((r) => setTimeout(r, 1)); // check-then-act gap
      if (seen) return { ok: false, reason: "duplicate" };
      if (n >= globalCap) return { ok: false, reason: "cap_reached" };
      rows.set(epoch + identity, epoch);
      return { ok: true, reservationId: "x" + rows.size };
    },
  });
  rows.clear();
  const bad = await runGrantStoreConformance(async (n = 2) => Array.from({ length: n }, naive));
  assert.ok(bad.some((r) => !r.pass && r.name.startsWith("race")), "naive adapter must fail a race check");
  console.log("PASS negative control: non-atomic adapter fails race checks");
}

// scope guards
const src = readFileSync(new URL("../../api/_lib/grant-store-contract.js", import.meta.url), "utf8");
assert.ok(!/process\.env|fetch\(|require\(|from "(?!node:)[^"]+"/.test(src.replace(/\/\/.*$/gm, "")), "no env/network/imports in contract");

if (fails) { console.error(`FAIL ${fails}`); process.exit(1); }
console.log("A-870 PASS");
