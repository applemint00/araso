import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { acquireForkOwner, atomicForkJson, readForkCheckpoint, auditForkJournal, openForkGiftJournal } from "../src/fork-gift-state.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "a1063-state-"));
const id = `0x${"11".repeat(32)}`, tx = `0x${"22".repeat(32)}`;
const cp = { forkInstanceId: "fork-143-test", block: 10, snapshotHash: "abc" };
const ownerOptions = { pid: 101, identity: (pid) => pid === 101 ? "boot:start101" : null };
try {
  const lock = path.join(dir, "owner");
  const owner = acquireForkOwner(lock, ownerOptions);
  assert.throws(() => acquireForkOwner(lock, ownerOptions), /OWNER_LIVE/);
  assert.equal(existsSync(`${lock}.takeover`), false);
  owner.close();
  atomicForkJson(lock, { pid: 999, start: "boot:old", token: "dead" });
  const takeover = acquireForkOwner(lock, ownerOptions);
  assert.equal(takeover.recovered, true); takeover.close();
  atomicForkJson(lock, { pid: 101, start: "boot:old-pid", token: "reused" });
  const reused = acquireForkOwner(lock, ownerOptions); assert.equal(reused.recovered, true); reused.close();
  atomicForkJson(lock, { pid: 999, start: "unknown", token: "old" });
  assert.throws(() => acquireForkOwner(lock, { pid: 101, identity: (pid) => { if (pid === 101) return "mine"; throw new Error("unknown"); } }), /unknown/);
  assert.equal(JSON.parse(readFileSync(lock)).token, "old");

  const snapshot = path.join(dir, "snapshot.json");
  const state = "mock snapshot bytes";
  atomicForkJson(snapshot, { v: 1, chainId: 31337143, forkInstanceId: cp.forkInstanceId, block: 10, state, sha256: createHash("sha256").update(state).digest("hex") });
  assert.equal(readForkCheckpoint(snapshot).block, 10);
  const invalid = JSON.parse(readFileSync(snapshot)); invalid.state += "changed"; atomicForkJson(snapshot, invalid);
  assert.throws(() => readForkCheckpoint(snapshot), /CHECKPOINT_INVALID/);

  const ledgerDir = path.join(dir, "ledger");
  let store = await openForkGiftJournal({ dir: ledgerDir, checkpoint: cp, inspect: async () => "ok", ownerOptions });
  store.reserve(id, { depositTx: tx }); store.update(id, "INSTALLED", { installTx: tx }); store.update(id, "COMMITTED", { commitTx: tx });
  store.update(id, "CLAIMED", { claimTx: tx, revokeStatus: "done" }); store.close();
  const file = path.join(ledgerDir, "gift-sponsor-fork-ledger.json");
  const original = JSON.parse(readFileSync(file)).entries;
  let inspected = 0;
  // A-981: same instance ID, restored older snapshot, terminal CLAIMED tx vanished.
  await assert.rejects(openForkGiftJournal({ dir: ledgerDir, checkpoint: { ...cp, block: 8, snapshotHash: "older" }, inspect: async () => { inspected++; return "absent"; }, ownerOptions }), /FORK_RESTORE_NEEDS_HUMAN/);
  assert.equal(inspected, 1);
  let raw = JSON.parse(readFileSync(file));
  assert.deepEqual(raw.entries, original); assert.deepEqual(raw.forkCheckpoint, cp);
  assert.equal(raw.forkReview.findings[0].reason, "orphaned_by_restore");
  assert.equal(existsSync(`${file}.lock`), false); assert.equal(existsSync(`${file}.owner`), false);
  // Chain returning later cannot silently clear the quarantine.
  await assert.rejects(openForkGiftJournal({ dir: ledgerDir, checkpoint: cp, inspect: async () => "ok", ownerOptions }), /FORK_RESTORE_NEEDS_HUMAN/);
  assert.equal(JSON.parse(readFileSync(file)).forkReview.findings.some((f) => f.reason === "orphaned_by_restore"), true);
  raw = { version: 3, entries: {}, archived: [{ giftId: id, state: "CLAIMED" }], gasTxs: { [id]: tx }, forkCheckpoint: cp };
  inspected = 0;
  const audit = await auditForkJournal(raw, cp, async () => { inspected++; return "absent"; });
  assert.equal(inspected, 2); assert.equal(audit.needsHuman, true);
  assert.equal((await auditForkJournal(raw, cp, async () => { throw new Error("RPC down"); })).needsHuman, true);
  assert.equal((await auditForkJournal(raw, { ...cp, forkInstanceId: "fork-143-other" }, async () => "ok")).needsHuman, true);

  // A legacy lock has no owner proof: never blindly unlink it.
  const unowned = path.join(dir, "unowned");
  const blank = await openForkGiftJournal({ dir: unowned, checkpoint: cp, inspect: async () => "ok", ownerOptions }); blank.close();
  const uf = path.join(unowned, "gift-sponsor-fork-ledger.json");
  writeFileSync(`${uf}.lock`, "");
  await assert.rejects(openForkGiftJournal({ dir: unowned, checkpoint: cp, inspect: async () => "ok", ownerOptions }), /UNOWNED_LEDGER_LOCK/);
  assert.equal(existsSync(`${uf}.lock`), true);
  atomicForkJson(`${uf}.owner`, { pid: 999, start: "dead", token: "old" });
  const recovered = await openForkGiftJournal({ dir: unowned, checkpoint: cp, inspect: async () => "ok", ownerOptions }); recovered.close();
  assert.equal(existsSync(`${uf}.lock`), false);
  const corrupt = { version: 3, entries: "bad", archived: [], gasTxs: {} }; atomicForkJson(uf, corrupt);
  await assert.rejects(openForkGiftJournal({ dir: unowned, checkpoint: cp, inspect: async () => "ok", ownerOptions }), /FORK_LEDGER_CORRUPT/);
  assert.deepEqual(JSON.parse(readFileSync(uf)), corrupt);
  console.log("PASS a1063 fork journal: same-ID rollback, all rows, quarantine persistence, checkpoint, owner live/dead/reused/unknown, unowned lock, corrupt input");
} finally { rmSync(dir, { recursive: true, force: true }); }
