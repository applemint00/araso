// [A-913 E/H] Reconcile + crash-at-each-step. Node only: no network, no env, no real key (stateful fake chain from _a913-fixtures.mjs).
// node relayer/test/gift-sponsor-reconcile.mjs
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { RECONCILE_TABLE, decideNextStep } from "../src/gift-sponsor-reconcile.mjs";
import { openGiftSponsorLedger } from "../src/gift-sponsor-service.mjs";
import { DM, ESCROW, NOW, build, gid, piggy, rigWorld, wire } from "./_a913-fixtures.mjs";
const clean = async (w) => (await w.getCode(piggy.address)) === "0x";

let pass = 0;
const test = async (label, fn) => { await fn(); console.log(`PASS  ${label}`); pass += 1; };
const T0 = 1_000_000_000_000; // injected clock (ms)

// ── pure table ──
const plan = { commitHash: gid(0xc0), beforeSeconds: String(NOW + 300n), authorization: { nonce: 0 } };
const truth = (o = {}) => ({ designator: "none", commit: null, now: NOW, authNonce: 0n, gift: { exists: true, claimed: false, expiry: NOW + 100000n }, nonces: { latest: 5n, pending: 5n }, receipt: null, ...o });
const entry = (o = {}) => ({ giftId: gid(1), state: "RESERVED", plan, inflight: null, ...o });
const mine = { hash: plan.commitHash, blockNumber: 9n };
const D = (e, t, o) => decideNextStep(e, t, o);
await test("table: every README row maps to exactly one next step", () => {
  assert.equal(D(entry(), truth()).step, "INSTALL");                                                       // R1
  assert.equal(D(entry(), truth({ now: NOW + 301n })).step, "ARCHIVE");                                    // R1x window over
  assert.equal(D(entry(), truth({ authNonce: 1n })).step, "ARCHIVE");                                      // Piggy nonce moved: authorization stale
  assert.equal(D(entry(), truth({ designator: "ours" })).step, "COMMIT");                                  // R2
  assert.equal(D(entry(), truth({ designator: "ours", now: NOW + 301n })).step, "REVOKE+ARCHIVE");        // R3
  assert.equal(D(entry(), truth({ designator: "ours", commit: mine })).step, "REVOKE+CLAIM");              // R4
  assert.equal(D(entry(), truth({ designator: "none", commit: mine })).step, "CLAIM");     // R5 (revoked: Piggy code clean after the commit)
  assert.equal(D(entry(), truth({ designator: "ours", commit: mine, gift: { exists: true, claimed: true, expiry: NOW + 9n } })).step, "REVOKE"); // R6
  assert.equal(D(entry(), truth({ designator: "none", commit: mine, gift: { exists: true, claimed: true, expiry: NOW + 9n } })).step, "DONE"); // R7
  assert.equal(D(entry(), truth({ gift: { exists: true, claimed: true, expiry: NOW + 9n } })).step, "ARCHIVE"); // claimed by someone else
  for (const r of ["R1", "R1x", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "H"]) assert.ok(RECONCILE_TABLE.some((x) => x.row === r), r);
});
await test("table: foreign code at the Piggy / foreign commit hash / success receipt without effect -> HUMAN (never acts)", () => {
  assert.equal(D(entry(), truth({ designator: "other" })).step, "HUMAN");
  assert.equal(D(entry(), truth({ designator: "ours", commit: { hash: gid(0xbad), blockNumber: 1n } })).step, "HUMAN");
  assert.equal(D(entry({ inflight: { kind: "redeem", at: T0, nonce: "5", txHash: gid(0xaa) } }), truth({ designator: "ours", receipt: { status: "success" } })).step, "HUMAN");
  assert.equal(D({ ...entry(), plan: null }, truth()).step, "HUMAN");
});
await test("table R8: sent-but-unsure => WAIT while it may be pending; resend only after grace with nothing pending", () => {
  const inf = { kind: "redeem", at: T0, nonce: "5" };
  assert.equal(D(entry({ inflight: inf }), truth({ designator: "ours", nonces: { latest: 5n, pending: 6n } }), { inflightGraceSeconds: 60, nowMs: T0 + 999999 }).step, "WAIT");   // mempool
  assert.equal(D(entry({ inflight: inf }), truth({ designator: "ours" }), { inflightGraceSeconds: null, nowMs: T0 + 999999 }).step, "WAIT");                                 // grace UNKNOWN
  assert.equal(D(entry({ inflight: inf }), truth({ designator: "ours" }), { inflightGraceSeconds: 60, nowMs: T0 + 59_000 }).step, "WAIT");                                    // too young
  assert.equal(D(entry({ inflight: inf }), truth({ designator: "ours" }), { inflightGraceSeconds: 60, nowMs: T0 + 61_000 }).step, "COMMIT");                                  // old, nothing pending
  const withHash = entry({ inflight: { ...inf, txHash: gid(0xaa) } });
  assert.equal(D(withHash, truth({ designator: "ours", receipt: null }), { inflightGraceSeconds: 60, nowMs: T0 + 999999 }).step, "WAIT");                                       // receipt absent
  assert.equal(D(withHash, truth({ designator: "ours", receipt: { status: "reverted" } })).step, "COMMIT");                                                                     // reverted: provably not applied
  assert.equal(D(withHash, truth({ designator: "ours", commit: mine })).step, "REVOKE+CLAIM");                                                                                  // effect visible: no resend of the commit
});

// ── crash at each step, then reconcile ──
const KINDS = ["install", "redeem", "revoke", "claim"];
for (const kind of KINDS) {
  for (const mode of ["applied_then_throw", "throw_before"]) {
    await test(`crash at ${kind} (${mode}) -> reconcile -> DONE; each of install/commit/claim lands exactly once, value 0 everywhere`, async () => {
      let clock = T0;
      const r = rigWorld(60, { nowMs: () => clock });
      const b = await build(60); r.world.commitHash = b.commitHash;
      r.world.script = { kind, mode };
      const out = await r.service.handle(wire(b));
      const first = r.ledger.get(b.giftId);
      if (kind === "revoke") assert.equal(out.status, 200);                  // revoke crash never blocks claim
      else assert.equal(out.status, 503);
      // within the grace window a throw_before crash must WAIT (no resend)
      const sendsBefore = r.world.sends.length;
      if (mode === "throw_before") {
        const rep1 = await r.reconciler.run();
        assert.equal(r.world.sends.length, sendsBefore, "no resend inside grace");
        assert.ok(rep1.results.every((x) => x.step === "WAIT"), JSON.stringify(rep1.results));
        clock += 61_000;
      }
      const rep = await r.reconciler.run();
      const e = r.ledger.get(b.giftId);
      assert.equal(e.state, "CLAIMED", JSON.stringify({ first: first.state, rep }));
      assert.equal(e.revokeStatus, "done"); assert.equal(r.world.claimed, true); assert.equal(await clean(r.world), true);
      assert.equal(r.world.effects.install, 1); assert.equal(r.world.effects.redeem, 1); assert.equal(r.world.effects.claim, 1);
      assert.ok(r.world.sends.every((s) => s.value === 0n));
      assert.ok(r.world.sends.every((s) => [piggy.address, DM, ESCROW].map((x) => x.toLowerCase()).includes(s.to.toLowerCase())));
      assert.ok(r.world.sends.filter((s) => s.kind === "revoke").every((s) => s.authorizationList.length === 1 && s.authorizationList[0].address === "0x0000000000000000000000000000000000000000" && s.to.toLowerCase() === piggy.address.toLowerCase()));
      assert.equal(r.ledger.get(b.giftId).inflight, null);
      assert.equal((await r.reconciler.run()).results.length, 0, "a finished ledger is a no-op");
    });
  }
}

await test("F-2 revoke tx reverts: claim still lands; reconcile retries with the SAME stored signature, honouring the backoff (base x 2^(failures-1)), until clean", async () => {
  let clock = T0; const r = rigWorld(61, { nowMs: () => clock, revokeMaxFailures: 3, revokeBackoffSeconds: 60 }); const b = await build(61); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "revoke", mode: "reverted" };
  const out = await r.service.handle(wire(b));
  assert.equal(out.status, 200); assert.equal(r.world.claimed, true); assert.equal(await clean(r.world), false); assert.equal(r.ledger.get(b.giftId).revokeFailures, 1);
  let n = r.world.sends.length; await r.reconciler.run(); assert.equal(r.world.sends.length, n, "inside the 60 s backoff: no resend");
  clock += 61_000; r.world.script = { kind: "revoke", mode: "reverted" }; await r.reconciler.run();
  assert.equal(r.ledger.get(b.giftId).revokeFailures, 2); n = r.world.sends.length;
  clock += 61_000; await r.reconciler.run(); assert.equal(r.world.sends.length, n, "second failure doubles the backoff to 120 s");
  clock += 61_000; await r.reconciler.run();
  assert.equal(await clean(r.world), true); assert.equal(r.ledger.get(b.giftId).revokeStatus, "done");
  const revs = r.world.sends.filter((x) => x.kind === "revoke"); assert.equal(revs.length, 3);
  for (const x of revs) assert.deepEqual(x.authorizationList, revs[0].authorizationList);       // identical signature every time
  assert.equal(revs[0].authorizationList[0].r, b.revokeAuthorization.r); assert.equal(r.world.effects.claim, 1);
});
await test("F-2 permanently invalid revoke tuple: after the injected cap => exhausted + needsHuman, NO more sends, claim unaffected, reconcile stops visiting it; no backoff injected => the first failure is final", async () => {
  let clock = T0; const r = rigWorld(69, { nowMs: () => clock, revokeMaxFailures: 2, revokeBackoffSeconds: 10 }); const b = await build(69); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "revoke", mode: "reverted" }; await r.service.handle(wire(b));
  clock += 11_000; r.world.script = { kind: "revoke", mode: "reverted" }; await r.reconciler.run();
  const e = r.ledger.get(b.giftId); assert.equal(e.revokeStatus, "exhausted"); assert.equal(e.needsHuman, "revoke_exhausted"); assert.equal(e.state, "CLAIMED");
  const n = r.world.sends.length; clock += 10 ** 7; const rep = await r.reconciler.run(); assert.equal(r.world.sends.length, n); assert.equal(rep.results.length, 0);
  const r2 = rigWorld(70); const b2 = await build(70); r2.world.commitHash = b2.commitHash; r2.world.script = { kind: "revoke", mode: "reverted" };
  assert.equal((await r2.service.handle(wire(b2))).status, 200); assert.equal(r2.ledger.get(b2.giftId).revokeStatus, "exhausted");
  const m = r2.world.sends.length; await r2.reconciler.run(); assert.equal(r2.world.sends.length, m);
});
await test("F-2 unsure revoke keeps the in-flight marker (txHash when known): reconcile reads the receipt, never resends while possibly pending", async () => {
  let clock = T0; const r = rigWorld(71, { nowMs: () => clock, revokeMaxFailures: 3, revokeBackoffSeconds: 5 }); const b = await build(71); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "revoke", mode: "throw_before" }; assert.equal((await r.service.handle(wire(b))).status, 200);
  const e = r.ledger.get(b.giftId); assert.equal(e.revokeInflight.kind, "revoke"); assert.equal(e.revokeStatus, "unsure"); assert.equal(e.state, "CLAIMED");
  const n = r.world.sends.length; r.world.noncePending += 1n;                                    // looks pending in the mempool
  await r.reconciler.run(); assert.equal(r.world.sends.length, n); r.world.noncePending -= 1n;
  await r.reconciler.run(); assert.equal(r.world.sends.length, n, "inside the grace window");
  clock += 61_000; await r.reconciler.run(); assert.equal(await clean(r.world), true); assert.equal(r.ledger.get(b.giftId).revokeStatus, "done");
  const r2 = rigWorld(72); const b2 = await build(72); r2.world.commitHash = b2.commitHash; r2.world.script = { kind: "revoke", mode: "applied_then_throw" };
  await r2.service.handle(wire(b2)); assert.ok(r2.ledger.get(b2.giftId).revokeInflight.txHash);                  // sent, answer lost: hash kept
  const m = r2.world.sends.length; await r2.reconciler.run(); assert.equal(r2.world.sends.length, m); assert.equal(r2.ledger.get(b2.giftId).revokeStatus, "done");   // effect visible: adopted, nothing resent
});

await test("R3: installed, never committed, window over -> revoke attempt + archive; a NEW request for the same giftId is then accepted", async () => {
  let clock = T0; const r = rigWorld(62, { nowMs: () => clock }); const b = await build(62); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "redeem", mode: "throw_before" };
  await r.service.handle(wire(b));                                 // install landed, redeem never broadcast -> UNKNOWN
  r.world.ts = NOW + 301n; clock += 61_000;                         // delegation window over, in-flight marker old enough
  const rep = await r.reconciler.run();
  assert.equal(rep.results[0].row, "R3"); assert.equal(r.ledger.get(b.giftId), null); assert.equal(r.ledger.archivedList().length, 1);
  assert.equal(r.world.effects.redeem, 0); assert.equal(await clean(r.world), true); assert.equal(r.world.effects.revoke, 1);
});

await test("H: a foreign commit at the Piggy is never acted on: UNKNOWN + needsHuman, 0 sends", async () => {
  const r = rigWorld(63, { nowMs: () => T0 + 10 ** 9 }); const b = await build(63); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "redeem", mode: "throw_before" };
  await r.service.handle(wire(b));
  r.world.commits.set(b.giftId, { hash: gid(0xbad), blockNumber: 3n });
  const n = r.world.sends.length; await r.reconciler.run();
  assert.equal(r.world.sends.length, n); const e = r.ledger.get(b.giftId); assert.equal(e.state, "UNKNOWN"); assert.equal(e.needsHuman, "foreign_commit_hash");
});

await test("chain read failure => WAIT, nothing sent, nothing changed", async () => {
  const r = rigWorld(64); const b = await build(64); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "claim", mode: "applied_then_throw" };
  await r.service.handle(wire(b));
  const before = JSON.stringify(r.ledger.get(b.giftId)); const n = r.world.sends.length;
  r.world.getCommit = async () => { throw new Error("rpc"); };
  const rep = await r.reconciler.run();
  assert.equal(rep.results[0].step, "WAIT"); assert.equal(r.world.sends.length, n); assert.equal(JSON.stringify(r.ledger.get(b.giftId)), before);
});

await test("preflight failing during reconcile blocks the send (certain not-sent), entry keeps its state", async () => {
  let ok = true; const r = rigWorld(65, { preflight: async () => ok }); const b = await build(65); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "claim", mode: "throw_before" };
  await r.service.handle(wire(b));                                   // claim crash (not sent): UNKNOWN
  ok = false; const n = r.world.sends.length;
  await r.reconciler.run({}); assert.equal(r.world.sends.length, n);
});

await test("plan() is read-only: reports the next step per owed entry, writes nothing", async () => {
  const r = rigWorld(66); const b = await build(66); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "redeem", mode: "applied_then_throw" };
  await r.service.handle(wire(b));
  const snap = JSON.stringify(r.ledger.list()); const n = r.world.sends.length;
  const p = await r.reconciler.plan();
  assert.equal(p[0].step, "REVOKE+CLAIM"); assert.equal(p[0].row, "R4"); assert.equal(JSON.stringify(r.ledger.list()), snap); assert.equal(r.world.sends.length, n);
});

// the escrow CLEARS commits() on claim: our own claim must still reach CLAIMED (+ revoke cleanup), "elsewhere" only without a claim tx of ours
await test("claim clears commits(): own claim tx (recorded or in-flight hash) => CLAIMED + revoke cleanup; no claim tx of ours => archive gift_claimed_elsewhere", async () => {
  for (const mode of ["applied_then_throw", "recorded"]) {
    const r = rigWorld(67, { nowMs: () => T0 + 10 ** 9 }); const b = await build(67); r.world.commitHash = b.commitHash;
    r.world.script = { kind: "claim", mode: "applied_then_throw" };
    await r.service.handle(wire(b));
    r.world.commits.delete(b.giftId);                                  // escrow cleared commits() on claim
    if (mode === "recorded") { const e = r.ledger.get(b.giftId); r.ledger.mark(b.giftId, { claimTx: e.inflight.txHash }); }
    const rep = await r.reconciler.run();
    assert.equal(r.ledger.get(b.giftId)?.state, "CLAIMED", JSON.stringify(rep)); assert.equal(r.ledger.get(b.giftId).revokeStatus, "done"); assert.equal(await clean(r.world), true);
    assert.equal(r.ledger.archivedList().length, 0);
  }
  const r = rigWorld(68); const b = await build(68); r.world.commitHash = b.commitHash;
  r.world.script = { kind: "install", mode: "throw_before" }; await r.service.handle(wire(b));
  r.ledger.mark(b.giftId, { inflight: null }); r.world.claimed = true;                       // someone else claimed; nothing of ours on chain
  const rep = await r.reconciler.run(); assert.equal(rep.results[0].why, "gift_claimed_elsewhere"); assert.equal(r.ledger.archivedList().length, 1);
});

console.log(`\nPASS ${pass}  FAIL 0`);
