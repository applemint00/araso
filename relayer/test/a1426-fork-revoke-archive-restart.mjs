// A-1426: R3 REVOKE+ARCHIVE leaves an archived INSTALLED row with revokeStatus "done";
// on restart the fork audit must read that row's Piggy as clean (0x), not quarantine it.
import assert from "node:assert/strict";
import { auditForkJournal } from "../src/fork-gift-state.mjs";
import { forkJournalInspector } from "../src/fork-gift-worker.mjs";

const escrow = `0x${"ee".repeat(20)}`, delegator = `0x${"d1".repeat(20)}`, impl = `0x${"a7".repeat(20)}`;
const id = `0x${"6a".repeat(32)}`, depositTx = `0x${"01".repeat(32)}`, installTx = `0x${"02".repeat(32)}`, revokeTx = `0x${"03".repeat(32)}`;
const cp = { forkInstanceId: "fork-143-test", block: 10, snapshotHash: "abc" };
const delegated = `0xef0100${impl.slice(2)}`;

const client = (code) => ({
  getTransactionReceipt: async ({ hash }) => ({ status: "success", blockNumber: 5n, blockHash: `0x${"bb".repeat(32)}`, transactionHash: hash }),
  getBlock: async () => ({ hash: `0x${"bb".repeat(32)}` }),
  getCode: async ({ address }) => { assert.equal(address, delegator); return code; },
  readContract: async () => { throw new Error("no commit read expected"); },
});
const row = (extra) => ({ giftId: id, state: "INSTALLED", plan: { depositTx, delegation: { delegator }, authorization: { address: impl } }, installTx, inflight: null, ...extra });
const raw = (r) => ({ version: 3, entries: {}, archived: [r], gasTxs: {}, forkCheckpoint: cp });
const audit = (r, code) => auditForkJournal(raw(r), cp, forkJournalInspector(client(code), escrow));

let fails = 0;
const check = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };

await check("R3 archived INSTALLED + revokeStatus done + revokeTx success + Piggy code 0x → needsHuman false", async () => {
  const a = await audit(row({ revokeStatus: "done", revokeTx, revokeInflight: null }), "0x");
  assert.deepEqual(a.findings, []); assert.equal(a.needsHuman, false);
});
await check("same row, getCode undefined (no code) → needsHuman false", async () => {
  assert.equal((await audit(row({ revokeStatus: "done", revokeTx, revokeInflight: null }), undefined)).needsHuman, false);
});
await check("opposite · INSTALLED without revokeStatus + code 0x → unexplained_mismatch", async () => {
  const a = await audit(row({}), "0x");
  assert.equal(a.needsHuman, true); assert.equal(a.findings[0].reason, "unexplained_mismatch");
});
await check("opposite · INSTALLED + revokeStatus done + code 0xef0100… (still delegated) → unexplained_mismatch", async () => {
  const a = await audit(row({ revokeStatus: "done", revokeTx, revokeInflight: null }), delegated);
  assert.equal(a.needsHuman, true); assert.equal(a.findings[0].reason, "unexplained_mismatch");
});
await check("opposite · INSTALLED + revokeStatus done but no revokeTx + code 0x → unexplained_mismatch", async () => {
  const a = await audit(row({ revokeStatus: "done", revokeInflight: null }), "0x");
  assert.equal(a.needsHuman, true); assert.equal(a.findings[0].reason, "unexplained_mismatch");
});
await check("unchanged · INSTALLED (live delegation) + code 0xef0100… → ok", async () => {
  assert.equal((await audit(row({}), delegated)).needsHuman, false);
});
await check("unchanged · stored quarantine stays (previous_quarantine) even when the row is now clean", async () => {
  const r = raw(row({ revokeStatus: "done", revokeTx, revokeInflight: null }));
  r.forkReview = { needsHuman: true, findings: [{ giftId: id, reason: "unexplained_mismatch" }] };
  const a = await auditForkJournal(r, cp, forkJournalInspector(client("0x"), escrow));
  assert.equal(a.needsHuman, true); assert.ok(a.findings.some((f) => f.reason === "previous_quarantine"));
});

console.log(fails ? `FAIL a1426 fork revoke+archive restart: ${fails} failed` : "PASS a1426 fork revoke+archive restart");
process.exit(fails ? 1 : 0);
