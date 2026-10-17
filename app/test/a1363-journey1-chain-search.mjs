import assert from "node:assert/strict";
import { fakeJ1Chain, SHMON } from "./helpers/fake-j1-chain.mjs";
// The Journey 1 deposit/redeem hashes of a Piggy whose device lost its receipts, found on chain by nonce binary search
// (no indexer; eth_getLogs only spans 100 blocks). Bounded: 60 calls, 15 s. Anything it cannot prove = a reason, never a guess.
const { findJourney1Pointers } = await import("../src/journey1-chain-search.js");
const P = "0x" + "12".repeat(20);
let pass = 0, fail = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log(`PASS  ${name}`); } catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e?.message || e).split("\n")[0]}`); } };
const find = (chain, extra = {}) => findJourney1Pointers({ rpc: chain.rpc, address: P, target: SHMON, ...extra });

await test("first two txs = deposit then redeem, 1.5M blocks ago → both hashes, within 60 calls", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 2_500_000, kind: "deposit" }, { block: 2_500_900, kind: "redeem" }, { block: 3_100_000, kind: "other" }] });
  const r = await find(c);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.depositTxHash, r.redeemTxHash], [c.rows[0].hash, c.rows[1].hash]);
  assert.ok(c.calls.length <= 60, `calls ${c.calls.length}`);
  console.log(`      calls=${c.calls.length}`);
});
await test("deposit and redeem in the same block", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 3_999_000, kind: "deposit" }, { block: 3_999_000, kind: "redeem" }] });
  const r = await find(c);
  assert.deepEqual([r.ok, r.depositTxHash, r.redeemTxHash], [true, c.rows[0].hash, c.rows[1].hash]);
});
await test("other txs first, a failed deposit, then a good pair → the good pair", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 3_000_000, kind: "other" }, { block: 3_000_010, kind: "deposit", status: 0 }, { block: 3_000_020, kind: "deposit" }, { block: 3_000_400, kind: "redeem" }] });
  const r = await find(c);
  assert.deepEqual([r.ok, r.depositTxHash, r.redeemTxHash], [true, c.rows[2].hash, c.rows[3].hash]);
});
await test("a deposit to another contract does not count", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 3_500_000, kind: "deposit", to: "0x" + "99".repeat(20) }, { block: 3_500_100, kind: "redeem" }] });
  assert.deepEqual(await find(c), { ok: false, reason: "not_found" });
});
await test("fewer than 2 txs → too_few (3 calls, no block search)", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 3_000_000, kind: "deposit" }] });
  assert.deepEqual(await find(c), { ok: false, reason: "too_few" });
  assert.ok(c.calls.length <= 3, c.calls.join(","));
});
await test("Journey 1 older than the node's history → out_of_window", async () => {
  const c = fakeJ1Chain({ piggy: P, historyFloor: 3_000_000, txs: [{ block: 1_000_000, kind: "deposit" }, { block: 1_000_050, kind: "redeem" }, { block: 3_500_000, kind: "other" }] });
  assert.deepEqual(await find(c), { ok: false, reason: "out_of_window" });
});
await test("wrong chain → wrong_chain; rpc down → unreadable", async () => {
  const c = fakeJ1Chain({ piggy: P, chainId: 1, txs: [{ block: 1, kind: "deposit" }, { block: 2, kind: "redeem" }] });
  assert.deepEqual(await find(c), { ok: false, reason: "wrong_chain" });
  assert.deepEqual(await findJourney1Pointers({ rpc: async () => { throw new Error("offline"); }, address: P, target: SHMON }), { ok: false, reason: "unreadable" });
});
await test("call cap and time cap → limit", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 2_500_000, kind: "deposit" }, { block: 2_500_900, kind: "redeem" }] });
  assert.deepEqual(await find(c, { maxCalls: 10 }), { ok: false, reason: "limit" });
  assert.ok(c.calls.length <= 10);
  let t = 0;
  const c2 = fakeJ1Chain({ piggy: P, txs: [{ block: 2_500_000, kind: "deposit" }, { block: 2_500_900, kind: "redeem" }] });
  assert.deepEqual(await find(c2, { now: () => (t += 1000) }), { ok: false, reason: "limit" });
});
await test("deposit, a failed redeem, then a good redeem → deposit + the good redeem", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 3_800_000, kind: "deposit" }, { block: 3_800_010, kind: "redeem", status: 0 }, { block: 3_800_020, kind: "redeem" }] });
  const r = await find(c);
  assert.deepEqual([r.ok, r.depositTxHash, r.redeemTxHash], [true, c.rows[0].hash, c.rows[2].hash]);
});
await test("good deposit, a failed second deposit, then a redeem → the good deposit + redeem", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 3_800_000, kind: "deposit" }, { block: 3_800_010, kind: "deposit", status: 0 }, { block: 3_800_020, kind: "redeem" }] });
  const r = await find(c);
  assert.deepEqual([r.ok, r.depositTxHash, r.redeemTxHash], [true, c.rows[0].hash, c.rows[2].hash]);
});
await test("a network failure mid-search → unreadable, not out_of_window", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 2_500_000, kind: "deposit" }, { block: 2_500_900, kind: "redeem" }] });
  let n = 0;
  const flaky = async (m, p) => { n += 1; if (n === 6) throw new Error("socket hang up"); return c.rpc(m, p); };
  assert.deepEqual(await findJourney1Pointers({ rpc: flaky, address: P, target: SHMON }), { ok: false, reason: "unreadable" });
});
await test("a read that never answers stops at the time cap", async () => {
  const c = fakeJ1Chain({ piggy: P, txs: [{ block: 2_500_000, kind: "deposit" }, { block: 2_500_900, kind: "redeem" }] });
  let n = 0;
  const hang = (m, p) => { n += 1; return n === 4 ? new Promise(() => {}) : c.rpc(m, p); };
  const t = Date.now();
  assert.deepEqual(await findJourney1Pointers({ rpc: hang, address: P, target: SHMON, maxMs: 300 }), { ok: false, reason: "limit" });
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
});
await test("bad input → bad_input, no call", async () => {
  let n = 0;
  assert.deepEqual(await findJourney1Pointers({ rpc: async () => { n++; }, address: "0x12", target: SHMON }), { ok: false, reason: "bad_input" });
  assert.equal(n, 0);
});
console.log(`A1363 chain search: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
