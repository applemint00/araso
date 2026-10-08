// [A-913 F/G/H] Code-hash preflight (read-only), service 503 on mismatch. Node only, no network, no port.
// node relayer/test/gift-sponsor-preflight.mjs
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { GIFT_SPONSOR_PIN_TABLE, createGiftSponsorPolicy } from "../src/gift-sponsor-service.mjs";
import { createPreflightGate, describePreflightFailure, preflightTargets, runGiftSponsorPreflight } from "../src/gift-sponsor-preflight.mjs";
import { CODES, IMPL, DM, EXACT, LIMIT, TS, POLICY, build, wire, rigWorld, gid } from "./_a913-fixtures.mjs";

let pass = 0;
const test = async (label, fn) => { await fn(); console.log(`PASS  ${label}`); pass += 1; };
const getCodeOf = (codes) => async (a) => codes[a.toLowerCase()] ?? "0x";

await test("preflight: all five targets match -> ok; the five names/addresses are exactly impl, DM, ExactExecution, LimitedCalls, Timestamp", async () => {
  const t = preflightTargets(POLICY);
  assert.deepEqual(t.map((x) => x.name), ["delegateImpl", "delegationManager", "exactExecutionEnforcer", "limitedCallsEnforcer", "timestampEnforcer"]);
  const r = await runGiftSponsorPreflight({ policy: POLICY, getCode: getCodeOf(CODES) });
  assert.equal(r.ok, true); assert.equal(r.rows.length, 5);
});

for (const addr of [IMPL, DM, EXACT, LIMIT, TS]) {
  await test(`preflight: code of ${addr.slice(0, 8)} differs -> ok:false, logged by name (no code bytes)`, async () => {
    const logs = []; const gate = createPreflightGate({ policy: POLICY, getCode: getCodeOf({ ...CODES, [addr.toLowerCase()]: "0x60ff" }), log: (m) => logs.push(m) });
    assert.equal(await gate(), false); assert.equal(gate.status().failures, 1);
    assert.ok(logs[0].includes("preflight FAILED") && logs[0].includes("code_hash_mismatch")); assert.ok(!logs[0].includes("60ff"));
  });
}
await test("preflight: empty code / RPC error / missing getCode -> ok:false (fail closed)", async () => {
  assert.equal((await runGiftSponsorPreflight({ policy: POLICY, getCode: getCodeOf({ ...CODES, [IMPL.toLowerCase()]: "0x" }) })).ok, false);
  const e = await runGiftSponsorPreflight({ policy: POLICY, getCode: async () => { throw new Error("rpc"); } });
  assert.equal(e.ok, false); assert.equal(e.reason, "rpc_error");
  assert.equal((await runGiftSponsorPreflight({ policy: POLICY })).ok, false);
  assert.equal((await runGiftSponsorPreflight({ policy: null, getCode: getCodeOf(CODES) })).ok, false);
  assert.match(describePreflightFailure(e), /rpc_error/);
});
await test("preflight reads are eth_getCode only: the gate calls getCode and nothing else; one read per target per pass", async () => {
  const calls = []; const gate = createPreflightGate({ policy: POLICY, getCode: async (a) => { calls.push(a.toLowerCase()); return CODES[a.toLowerCase()]; } });
  await gate(); await gate();
  assert.equal(calls.length, 10); assert.equal(new Set(calls).size, 5);
});
await test("real 143 pin table: policy built from it carries the five pinned hashes and the TimestampEnforcer FORK-READ hash (LIVE-READ pending coordinator script)", () => {
  const T = GIFT_SPONSOR_PIN_TABLE; const h = T.hashes[143];
  const p = createGiftSponsorPolicy({ chainId: 143, escrow: "0x00000000000000000000000000000000000000e5", sponsorAddress: "0x00000000000000000000000000000000000000f1", ...T.addresses, ...h, maxExpirySeconds: 300, gasUnits: { install: 1n, commit: 1n, revoke: 1n, claim: 1n }, gasBufferBps: 0 });
  assert.ok(p); const t = preflightTargets(p);
  assert.deepEqual(t.map((x) => x.expected), [h.implCodeHash, h.delegationManagerCodeHash, h.exactExecutionCodeHash, h.limitedCallsCodeHash, h.timestampCodeHash]);
  assert.deepEqual(t.map((x) => x.address), [T.addresses.delegateImpl, T.addresses.delegationManager, T.addresses.exactExecutionEnforcer, T.addresses.limitedCallsEnforcer, T.addresses.timestampEnforcer]);
});

await test("service: preflight mismatch -> 503 unavailable_not_sent, logged, 0 sends (before any send)", async () => {
  let ok = false; const r = rigWorld(70, { preflight: async () => ok }); const b = await build(70); r.world.commitHash = b.commitHash;
  const out = await r.service.handle(wire(b));
  assert.equal(out.status, 503); assert.equal(out.body.error, "unavailable_not_sent"); assert.equal(r.world.sends.length, 0);
  ok = true; assert.equal((await r.service.handle(wire(b))).status, 200);
});

console.log(`\nPASS ${pass}  FAIL 0`);
